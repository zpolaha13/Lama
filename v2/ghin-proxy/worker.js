/* =========================================================================
 * ghin-proxy — Cloudflare Worker that looks golfers up in GHIN for the golf
 * trip app, so nobody has to paste a GHIN token.
 *
 * WHY THIS EXISTS: GHIN has no public API. The browser can't call GHIN
 * directly without an authenticated token. This tiny server logs in to GHIN
 * with YOUR credentials (stored only as Worker secrets), looks golfers up, and
 * returns just what the app needs, with CORS headers the app is allowed to use.
 *
 * The app calls:
 *   GET /?ghin=3140328                     -> { "index": 8.4, "name": "Jane Doe", "ghin": "3140328" }
 *   GET /?last=Doe&first=Jane&state=NC     -> { "golfers": [ { ghin, name, club, state, index }, … ] }
 *
 * UNOFFICIAL: this uses the same private endpoints the GHIN website/app use.
 * They aren't documented and can change. If lookups stop working, the most
 * likely fix is the login payload below — see README.md.
 *
 * SETUP (see README.md for the click-by-click):
 *   secret GHIN_USER      your GHIN email (or GHIN number)
 *   secret GHIN_PASSWORD  your GHIN password
 *   optional secret GHIN_LOGIN_TOKEN  site token, only if login needs a real one
 *   variable ALLOW_ORIGIN = "https://zpolaha13.github.io"   # lock to your site
 * ========================================================================= */

const GHIN_BASE = 'https://api2.ghin.com/api/v1';
// The exact golfer query ghin.com's own site sends; add golfer_id=… for a GHIN
// number, or last_name/first_name/state for a name search.
const GOLFERS = `${GHIN_BASE}/golfers.json?status=Active&from_ghin=true&per_page=25&sorting_criteria=full_name&order=asc&page=1&source=GHINcom`;

// cache the bearer token across requests in this isolate (cheap, avoids
// logging in on every lookup). Tokens are good for a while; we refresh on 401.
let cachedToken = null;

function cors(origin) {
  return {
    'Access-Control-Allow-Origin': origin || '*',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, x-ghin-token',
    'Cache-Control': 'no-store',
  };
}
function json(body, status, headers) {
  return new Response(JSON.stringify(body), { status: status || 200, headers: { ...headers, 'Content-Type': 'application/json' } });
}

async function login(env) {
  if (!env.GHIN_USER || !env.GHIN_PASSWORD) throw new Error('the helper has no GHIN login yet: add the GHIN_USER and GHIN_PASSWORD secrets');
  const body = {
    user: {
      email_or_ghin: env.GHIN_USER,
      password: env.GHIN_PASSWORD,
      remember_me: true,
    },
    // GHIN rejects a login whose "token" field is blank; any non-blank value is
    // accepted. If your deployment needs a real site token, set
    // GHIN_LOGIN_TOKEN (grab it from the login request in devtools, see README).
    token: env.GHIN_LOGIN_TOKEN || 'nonblank',
    source: 'GHINcom',
  };
  const r = await fetch(`${GHIN_BASE}/golfer_login.json`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!r.ok) throw new Error('GHIN login failed (HTTP ' + r.status + '); check GHIN_USER and GHIN_PASSWORD');
  const data = await r.json();
  const token = (data && (data.golfer_user?.golfer_user_token || data.token || data.access_token));
  if (!token) throw new Error('GHIN login returned no token');
  cachedToken = token;
  return token;
}

// GET a GHIN url with a bearer token: the caller's relayed token if given,
// else ours (logging in when needed, and once more if it expired).
async function ghinGet(env, url, relayToken) {
  const get = (t) => fetch(url, { headers: { Authorization: 'Bearer ' + t, accept: 'application/json' } });
  let token = relayToken || cachedToken || (await login(env));
  let r = await get(token);
  if (r.status === 401 && !relayToken) { token = await login(env); r = await get(token); }
  if (r.status === 401 && relayToken) throw new Error('token expired — copy a fresh one from ghin.com');
  if (!r.ok) throw new Error('GHIN lookup failed (HTTP ' + r.status + ')');
  return r.json();
}

// handicap_index may be a string like "8.4", "+1.2" (plus = below scratch) or "NH"
function parseIndex(raw) {
  if (raw == null || raw === '') return null;
  const n = typeof raw === 'string' ? Number(raw.replace('+', '-')) : Number(raw);
  return isNaN(n) ? null : n;
}
function golfersOf(data) {
  return (data && Array.isArray(data.golfers)) ? data.golfers : (Array.isArray(data) ? data : []);
}
function golferOut(g) {
  return {
    ghin: String(g.ghin ?? g.ghin_number ?? g.golfer_id ?? g.id ?? ''),
    name: [g.first_name, g.last_name].filter(Boolean).join(' ') || g.player_name || '',
    club: g.club_name || g.club || '',
    state: g.state || g.primary_state || '',
    index: parseIndex(g.handicap_index ?? g.hi_value ?? g.handicap),
  };
}

const NAME_RE = /^[\p{L}' .-]{1,40}$/u;

export default {
  async fetch(request, env) {
    const headers = cors(env.ALLOW_ORIGIN || '*');
    if (request.method === 'OPTIONS') return new Response(null, { headers });

    const q = new URL(request.url).searchParams;
    // Relay mode: a caller may pass a token copied from a logged-in ghin.com tab
    // (valid ~12h) instead of the helper using stored credentials.
    const relayToken = q.get('token') || request.headers.get('x-ghin-token') || '';
    const ghin = (q.get('ghin') || '').trim();
    const last = (q.get('last') || '').trim();
    const first = (q.get('first') || '').trim();
    const state = (q.get('state') || '').trim().toUpperCase();

    try {
      if (ghin) {
        if (!/^\d{1,12}$/.test(ghin)) return json({ error: 'ghin must be digits' }, 400, headers);
        const g = golfersOf(await ghinGet(env, GOLFERS + '&golfer_id=' + encodeURIComponent(ghin), relayToken))[0];
        if (!g) return json({ error: 'golfer not found' }, 404, headers);
        const out = golferOut(g);
        return json({ index: out.index, name: out.name || undefined, ghin, club: out.club || undefined }, 200, headers);
      }
      if (last) {
        if (!NAME_RE.test(last) || (first && !NAME_RE.test(first))) return json({ error: 'names may use letters, spaces, apostrophes and hyphens' }, 400, headers);
        if (state && !/^[A-Z]{2}$/.test(state)) return json({ error: 'state must be two letters, e.g. NC' }, 400, headers);
        let url = GOLFERS + '&last_name=' + encodeURIComponent(last);
        if (first) url += '&first_name=' + encodeURIComponent(first);
        if (state) url += '&state=' + encodeURIComponent(state);
        const golfers = golfersOf(await ghinGet(env, url, relayToken)).map(golferOut).filter((g) => g.ghin);
        return json({ golfers }, 200, headers);
      }
      return json({ error: 'pass ?ghin=<number> or ?last=<last name>&first=<first>&state=<XX>' }, 400, headers);
    } catch (e) {
      return json({ error: String(e.message || e) }, 502, headers);
    }
  },
};
