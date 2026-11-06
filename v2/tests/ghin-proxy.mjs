/* Offline test for ghin-proxy/worker.js: GHIN is faked, so this checks the
 * helper's own logic (login payload, token reuse/refresh, lookups, errors),
 * not GHIN itself. Run: node tests/ghin-proxy.mjs */
import worker from '../ghin-proxy/worker.js';

let pass = 0, fail = 0;
function eq(a, b, msg) {
  if (JSON.stringify(a) === JSON.stringify(b)) pass++;
  else { fail++; console.log('FAIL', msg, '\n  got ', JSON.stringify(a), '\n  want', JSON.stringify(b)); }
}

const calls = [];
let expireNext = false;
const golfers = [
  { ghin: 1234567, first_name: 'David', last_name: 'Haley', club_name: 'Cutter Creek GC', state: 'NC', handicap_index: '8.4' },
  { ghin: 7654321, first_name: 'Dan', last_name: 'Haley', club_name: 'Raleigh CC', state: 'NC', handicap_index: '+1.2' },
];
globalThis.fetch = async (url, opts = {}) => {
  calls.push({ url: String(url), opts });
  const res = (status, body) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
  if (String(url).endsWith('/golfer_login.json')) {
    const b = JSON.parse(opts.body);
    if (!b.token) return res(422, { errors: 'token blank' });
    if (b.user.password !== 'pw') return res(401, { errors: 'bad login' });
    return res(200, { golfer_user: { golfer_user_token: 'TOKEN-' + calls.length } });
  }
  const auth = (opts.headers || {}).Authorization || '';
  if (!auth.startsWith('Bearer ')) return res(401, {});
  if (expireNext) { expireNext = false; return res(401, {}); }
  const u = new URL(url);
  if (u.searchParams.get('golfer_id')) return res(200, { golfers: golfers.filter((g) => String(g.ghin) === u.searchParams.get('golfer_id')) });
  const last = (u.searchParams.get('last_name') || '').toLowerCase();
  const first = (u.searchParams.get('first_name') || '').toLowerCase();
  return res(200, { golfers: golfers.filter((g) => g.last_name.toLowerCase() === last && (!first || g.first_name.toLowerCase().startsWith(first))) });
};

const env = { GHIN_USER: 'me@example.com', GHIN_PASSWORD: 'pw', ALLOW_ORIGIN: 'https://zpolaha13.github.io' };
const get = async (qs, e = env) => { const r = await worker.fetch(new Request('https://helper.example/?' + qs), e); return { status: r.status, body: await r.json(), cors: r.headers.get('Access-Control-Allow-Origin') }; };

let r = await get('ghin=1234567');
eq([r.status, r.body.index, r.body.name, r.body.club, r.cors], [200, 8.4, 'David Haley', 'Cutter Creek GC', 'https://zpolaha13.github.io'], 'lookup by GHIN number');
const loginCall = calls.find((c) => c.url.endsWith('/golfer_login.json'));
eq(JSON.parse(loginCall.opts.body).token, 'nonblank', 'login sends a non-blank token field');
eq((await get('ghin=7654321')).body.index, -1.2, 'plus handicap +1.2 becomes -1.2');
eq(calls.filter((c) => c.url.endsWith('/golfer_login.json')).length, 1, 'token is reused between lookups');
expireNext = true;
eq((await get('ghin=1234567')).status, 200, 'expired token: logs in again and retries');
eq((await get('ghin=999')).status, 404, 'unknown GHIN number -> 404');
eq((await get('ghin=12ab')).status, 400, 'non-digit GHIN rejected');

r = await get('last=Haley&state=nc');
eq([r.status, r.body.golfers.map((g) => [g.ghin, g.name, g.index])], [200, [['1234567', 'David Haley', 8.4], ['7654321', 'Dan Haley', -1.2]]], 'name search returns everyone named Haley');
const searchUrl = new URL(calls[calls.length - 1].url);
eq([searchUrl.searchParams.get('last_name'), searchUrl.searchParams.get('state'), searchUrl.searchParams.get('status')], ['Haley', 'NC', 'Active'], 'name search sends last_name, upper-cased state, active only');
eq((await get('last=Haley&first=Dav')).body.golfers.length, 1, 'first name narrows the search');
eq((await get("last=O'Brien-Smith")).status, 200, "apostrophes and hyphens allowed");
eq((await get('last=<script>')).status, 400, 'odd characters rejected');
eq((await get('last=Haley&state=North')).status, 400, 'state must be two letters');
eq((await get('')).status, 400, 'no query -> 400 with usage');

r = await get('ghin=1234567', { ALLOW_ORIGIN: '*' });
// cached token from earlier still works; force the no-credentials path with a fresh isolate-like call
expireNext = true;
r = await get('ghin=1234567', { ALLOW_ORIGIN: '*' });
eq([r.status, /GHIN_USER/.test(r.body.error)], [502, true], 'no stored login -> clear error naming the secrets');
r = await get('ghin=1234567', { GHIN_USER: 'me', GHIN_PASSWORD: 'wrong' });
expireNext = true;
r = await get('ghin=1234567', { GHIN_USER: 'me', GHIN_PASSWORD: 'wrong' });
eq([r.status, /login failed/.test(r.body.error)], [502, true], 'wrong password -> login failed error');
r = await get('ghin=1234567&token=RELAYED', { ALLOW_ORIGIN: '*' });
eq([r.status, calls[calls.length - 1].opts.headers.Authorization], [200, 'Bearer RELAYED'], 'relayed token is used as-is');
const opt = await worker.fetch(new Request('https://helper.example/', { method: 'OPTIONS' }), env);
eq([opt.status, opt.headers.get('Access-Control-Allow-Methods')], [200, 'GET, OPTIONS'], 'CORS preflight');

console.log(`\nGHIN PROXY ${fail ? 'FAILED' : 'OK'}  PASS ${pass}  FAIL ${fail}`);
process.exit(fail ? 1 : 0);
