# GHIN auto-fill proxy (optional)

GHIN has no public API, and a browser can't call GHIN directly (it needs an
authenticated token and CORS blocks it). This tiny **Cloudflare Worker** logs in
to GHIN with *your* credentials, looks up a golfer by GHIN number, and returns
just the handicap index — with the CORS header the app needs.

Your GHIN email/password live only as Worker **secrets**; they never reach the
browser or the repo.

> ⚠️ **Unofficial.** This uses the same private endpoints the GHIN website/app
> use. They aren't documented and can change without notice. If it stops
> working, see *Troubleshooting* below.

## Deploy (one time, ~10 min, free)

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

The app calls `GET <GHIN_PROXY_URL>?ghin=NUMBER` and reads `index` from the JSON.
The index is then filled into that player's **Hcp** field — and stays editable,
so you can always override it by hand.

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
