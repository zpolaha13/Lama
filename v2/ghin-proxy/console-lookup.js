/* =========================================================================
 * GHIN console lookup — get everyone's Handicap Index in one shot, with no
 * server, no proxy, no CORS headaches.
 *
 * WHY THIS WORKS: GHIN's API only answers requests that come FROM ghin.com
 * (same-site) with your logged-in token. So instead of fighting that from our
 * app, you run this in a browser tab that's already on ghin.com — same origin,
 * your own session, your own token. It's the lowest-effort way to pull indexes.
 *
 * HOW TO USE:
 *   1. Sign in at https://www.ghin.com  (GHIN # + last name is fine).
 *   2. Open DevTools (F12 or right-click → Inspect) → Console tab.
 *   3. Paste your players' GHIN numbers into GHINS below.
 *   4. Paste this whole snippet into the console and press Enter.
 *   5. It prints a table and copies a "Name<TAB>Index" list to your clipboard.
 *      Read the indexes into the app's Hcp fields (or paste the list anywhere).
 *
 * The token is read automatically from the page; if that fails it falls back to
 * the cookie session. Nothing here is stored or sent anywhere but GHIN.
 * ========================================================================= */
(async () => {
  // ---- put your players' GHIN numbers here (any order) ----
  const GHINS = [
    '3140328',
    // '11290466',
    // ...add the rest
  ];

  // find the bearer token GHIN stashed in the page (JWT: eyJ....eyJ....sig)
  function findToken() {
    const re = /eyJ[\w-]+\.eyJ[\w-]+\.[\w-]+/;
    for (const store of [window.localStorage, window.sessionStorage]) {
      for (let i = 0; i < store.length; i++) {
        const v = store.getItem(store.key(i));
        const m = v && v.match(re);
        if (m) return m[0];
      }
    }
    return null;
  }
  const token = findToken();

  const headers = { accept: 'application/json' };
  if (token) headers.authorization = 'Bearer ' + token;

  const rows = [];
  for (const ghin of GHINS) {
    const id = String(ghin).replace(/\D/g, '');
    const url = `https://api2.ghin.com/api/v1/golfers.json?golfer_id=${id}&status=Active&per_page=1&page=1&source=GHINcom`;
    try {
      const r = await fetch(url, { headers, credentials: 'include' });
      if (!r.ok) { rows.push({ ghin: id, name: 'HTTP ' + r.status, index: '' }); continue; }
      const data = await r.json();
      const g = (data.golfers && data.golfers[0]) || (Array.isArray(data) && data[0]) || null;
      if (!g) { rows.push({ ghin: id, name: 'not found', index: '' }); continue; }
      const name = [g.first_name, g.last_name].filter(Boolean).join(' ') || g.player_name || '?';
      const index = g.handicap_index ?? g.hi_value ?? '?';
      rows.push({ ghin: id, name, index });
    } catch (e) {
      rows.push({ ghin: id, name: 'error: ' + e.message, index: '' });
    }
  }

  console.table(rows);
  const tsv = rows.map((r) => `${r.name}\t${r.index}`).join('\n');
  try { copy(tsv); console.log('%c✓ Copied "Name<TAB>Index" to clipboard', 'color:green;font-weight:bold'); } catch (e) {}
  return rows;
})();
