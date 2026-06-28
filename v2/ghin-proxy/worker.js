/* =========================================================================
 * ghin-proxy — Cloudflare Worker that turns a GHIN number into a handicap
 * index, so the Lama Palooza app can auto-fill it.
 *
 * WHY THIS EXISTS: GHIN has no public API. The browser can't call GHIN
 * directly (it needs an authenticated token, and CORS blocks cross-origin
 * calls). This tiny server logs in to GHIN with YOUR credentials, looks up the
 * golfer, and returns just the index — with CORS headers the app is allowed to
 * use. Your credentials never touch the browser; they live only as Worker
 * secrets.
 *
 * The app calls:  GET https://<your-worker>/?ghin=3140328
 * and expects:    { "index": 8.4, "name": "Jane Doe" }
 *
 * UNOFFICIAL: this uses the same private endpoints the GHIN website/app use.
 * They aren't documented and can change. If the lookup stops working, the most
 * likely fix is the login payload below — see README.md.
 *
 * SETUP (see README.md for the click-by-click):
 *   wrangler secret put GHIN_USER     # your GHIN email (or GHIN number)
 *   wrangler secret put GHIN_PASSWORD # your GHIN password
 *   # optional:
 *   wrangler secret put GHIN_LOGIN_TOKEN  # static site token, if login needs it
 *   [vars] ALLOW_ORIGIN = "https://zpolaha13.github.io"   # lock to your site
 * ========================================================================= */

const GHIN_BASE = 'https://api2.ghin.com/api/v1';

// cache the bearer token across requests in this isolate (cheap, avoids
// logging in on every lookup). Tokens are good for a while; we refresh on 401.
let cachedToken = null;

function cors(origin) {
  return {
    'Access-Control-Allow-Origin': origin || '*',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Cache-Control': 'no-store',
  };
}

async function login(env) {
  const body = {
    user: {
      email_or_ghin: env.GHIN_USER,
      password: env.GHIN_PASSWORD,
      remember_me: true,
    },
    // Some GHIN deployments require a static "site token" on login. If yours
    // does, set GHIN_LOGIN_TOKEN (grab it from the login request in your
    // browser devtools — see README). Harmless to send when present.
    token: env.GHIN_LOGIN_TOKEN || undefined,
    source: 'GHINcom',
  };
  const r = await fetch(`${GHIN_BASE}/golfer_login.json`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!r.ok) throw new Error('GHIN login failed (HTTP ' + r.status + ')');
  const data = await r.json();
  const token = (data && (data.golfer_user?.golfer_user_token || data.token || data.access_token));
  if (!token) throw new Error('GHIN login returned no token');
  cachedToken = token;
  return token;
}

async function searchGolfer(token, ghin) {
  // Exact endpoint captured from ghin.com's own network traffic.
  const url = `${GHIN_BASE}/golfers.json?golfer_id=${encodeURIComponent(ghin)}&status=Active&per_page=1&page=1&source=GHINcom`;
  return fetch(url, { headers: { Authorization: 'Bearer ' + token, accept: 'application/json' } });
}

export default {
  async fetch(request, env) {
    const origin = env.ALLOW_ORIGIN || '*';
    const headers = cors(origin);
    if (request.method === 'OPTIONS') return new Response(null, { headers });

    const ghin = (new URL(request.url)).searchParams.get('ghin');
    if (!ghin || !/^\d{1,12}$/.test(ghin)) {
      return new Response(JSON.stringify({ error: 'pass ?ghin=<number>' }), { status: 400, headers: { ...headers, 'Content-Type': 'application/json' } });
    }

    // Relay mode: if the caller passes a token (e.g. one you copied from a
    // logged-in ghin.com tab — valid ~12h), use it directly and skip login.
    // This avoids storing GHIN credentials at all. Falls back to login() if no
    // token is supplied and GHIN_USER/PASSWORD secrets are set.
    const url0 = new URL(request.url);
    const relayToken = url0.searchParams.get('token') || (request.headers.get('x-ghin-token') || '');

    try {
      let token = relayToken || cachedToken || (await login(env));
      let r = await searchGolfer(token, ghin);
      if (r.status === 401 && !relayToken) { token = await login(env); r = await searchGolfer(token, ghin); } // token expired -> retry once
      if (r.status === 401 && relayToken) throw new Error('token expired — copy a fresh one from ghin.com');
      if (!r.ok) throw new Error('GHIN search failed (HTTP ' + r.status + ')');

      const data = await r.json();
      const g = (data && (data.golfers && data.golfers[0])) || (Array.isArray(data) ? data[0] : null);
      if (!g) return new Response(JSON.stringify({ error: 'golfer not found' }), { status: 404, headers: { ...headers, 'Content-Type': 'application/json' } });

      // handicap_index may be a string like "8.4" or "+1.2" (plus = below scratch)
      const raw = g.handicap_index ?? g.hi_value ?? g.handicap;
      const index = typeof raw === 'string' ? Number(raw.replace('+', '-')) : Number(raw);
      const name = [g.first_name, g.last_name].filter(Boolean).join(' ') || g.player_name || undefined;

      return new Response(JSON.stringify({ index, name, ghin }), { headers: { ...headers, 'Content-Type': 'application/json' } });
    } catch (e) {
      return new Response(JSON.stringify({ error: String(e.message || e) }), { status: 502, headers: { ...headers, 'Content-Type': 'application/json' } });
    }
  },
};
