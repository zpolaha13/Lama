# Getting Handicap Indexes from GHIN

GHIN has no public API, and a browser on another site can't call it (CORS +
auth). Two ways to pull indexes anyway, easiest first.

## Easiest: console lookup (no deploy, no proxy) — `console-lookup.js`

GHIN answers requests that come **from ghin.com** with your logged-in token. So
run a one-off snippet in a browser tab that's already on ghin.com:

1. Sign in at <https://www.ghin.com> (GHIN # + last name is fine).
2. DevTools → Console.
3. Open `console-lookup.js`, paste your players' GHIN numbers into the `GHINS`
   list at the top, paste the whole snippet into the console, Enter.
4. It prints a table of **Name → Index** and copies it to your clipboard. Read
   those into the app's **Hcp** fields. Done — no server, no credentials stored.

This is the recommended path for a once-a-year setup.

## Automatic in-app: the proxy (optional)

If you'd rather the app's **↻ Get** button fill indexes itself, deploy this tiny
**Cloudflare Worker**. It relays the GHIN lookup server-side (dodging CORS) and
returns just the index with the CORS header the app needs. Two ways to give it a
token:

- **Relay a token (no stored credentials):** copy a Bearer token from a
  logged-in ghin.com tab (valid ~12h) and have the app send it as `?token=...`.
- **Store credentials:** set `GHIN_USER`/`GHIN_PASSWORD` secrets and it logs in
  itself (durable, but the login payload is unofficial — see Troubleshooting).

Your GHIN email/password live only as Worker **secrets**; they never reach the
browser or the repo.

> ⚠️ **Unofficial.** This uses the same private endpoints the GHIN website/app
> use. They aren't documented and can change without notice. If it stops
> working, see *Troubleshooting* below.

## Deploy from the Cloudflare website (no command line, ~10 min, free)

Easiest on a computer.

1. Sign up or log in at <https://dash.cloudflare.com/sign-up> (the free plan is plenty).
2. **Workers & Pages → Create → Create Worker.** Name it `ghin-proxy`, then **Deploy**
   (it starts as "Hello World").
3. **Edit code.** Delete everything, paste in all of `worker.js` (on GitHub, open the
   file and use **Copy raw file**), then **Deploy**.
4. **Settings → Variables and Secrets → Add**, three times:
   - Type **Secret**, name `GHIN_USER`, value: your GHIN email or GHIN number
   - Type **Secret**, name `GHIN_PASSWORD`, value: your GHIN password
   - Type **Text**, name `ALLOW_ORIGIN`, value: `https://zpolaha13.github.io`

   Then **Deploy**. Your GHIN login stays in Cloudflare; it never reaches the app,
   the repo or the chat.
5. Copy the worker's address (`https://ghin-proxy.<your-subdomain>.workers.dev`).
   It isn't secret. Put it in `GHIN_PROXY_URL` in `v2/js/config.js` and redeploy the
   site; the Players tab then shows **⚡ GHIN connected** and no token box.

Quick test in a browser: `<address>/?ghin=<a GHIN number>` should show that
golfer's index, and `<address>/?last=Smith&state=NC` a list of golfers.

## Deploy with Wrangler (command line)

1. **Install Wrangler** (Cloudflare's CLI) and log in:
   ```bash
   npm install -g wrangler
   wrangler login
   ```
2. From this folder, create the worker (a `wrangler.toml` like the one below):
   ```toml
   name = "ghin-proxy"
   main = "worker.js"
   compatibility_date = "2024-11-01"

   [vars]
   ALLOW_ORIGIN = "https://zpolaha13.github.io"   # your GitHub Pages origin
   ```
3. Add your GHIN login as secrets (not committed anywhere):
   ```bash
   wrangler secret put GHIN_USER        # your GHIN email (or GHIN number)
   wrangler secret put GHIN_PASSWORD    # your GHIN password
   ```
4. Deploy:
   ```bash
   wrangler deploy
   ```
   Wrangler prints a URL like `https://ghin-proxy.<you>.workers.dev`.
5. **Test it:**
   ```bash
   curl "https://ghin-proxy.<you>.workers.dev/?ghin=3140328"
   # -> {"index":8.4,"name":"...","ghin":"3140328"}
   ```
6. **Tell the app:** paste that URL into `GHIN_PROXY_URL` in `v2/js/config.js`,
   commit, and redeploy the site. The Players tab's button becomes **↻ Get**.

## How the app uses it

- **↻ Get / ↻ Get all:** `GET <GHIN_PROXY_URL>?ghin=NUMBER` → `{ index, name, ghin, club }`.
  The index fills that player's **Index** field and stays editable.
- **🔎 Find / 🔎 Add from GHIN:** `GET <GHIN_PROXY_URL>?last=Haley&first=Dave&state=NC` →
  `{ golfers: [{ ghin, name, club, state, index }] }` (active golfers, up to 25).
  Pick one to fill a player's GHIN # and Index, or to add them as a new player.
  Nicknames (Jimbo, Dave) often don't match GHIN's first names, so with no hit
  the app searches the last name alone and lists everyone.

## Troubleshooting

If `/?ghin=...` returns a `502` with a login error, the login payload is the
thing to fix (GHIN changes it occasionally):

- **Static login token.** Some GHIN deployments require a site token on login.
  Grab it: open <https://www.ghin.com>, sign in with devtools → Network open,
  find the `golfer_login.json` request, copy the `token` value from its payload,
  then `wrangler secret put GHIN_LOGIN_TOKEN` and paste it. Redeploy.
- **Field names.** If login still fails, check that request's body shape in
  devtools and match `login()` in `worker.js` to it (`email_or_ghin` vs `email`,
  etc.).
- **Token field.** If search returns 401 forever, log the login response and
  confirm where the bearer token lives (`golfer_user.golfer_user_token` is the
  common spot).

Send me (or paste back) the exact error and the `golfer_login.json` payload from
devtools and the fix is usually a one-line change.

## Security notes

- Credentials are Worker secrets — not in the repo, not in the browser.
- Lock `ALLOW_ORIGIN` to your site so only your app can call the worker.
- This reads only public handicap-lookup data. Don't share the worker URL
  publicly if you'd rather not let others run lookups through your GHIN login.
