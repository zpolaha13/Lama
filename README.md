# ⛳ Golf Trip Live Scoring

A self-contained web app for running a handicapped, Ryder-Cup-style golf trip —
live score entry, team scoreboard, skins, auto payouts, and printable matchup
scorecards. No build step, no server required. Hosts free on GitHub Pages.

## Features

- **Players & handicaps** — add players with their Handicap Index and assign to teams.
- **Courses & tees** — enter each tee's **Course Rating + Slope** and per-hole
  **par + stroke index**. Course Handicaps are computed with the WHS formula
  `Index × (Slope ÷ 113) + (Rating − Par)`.
- **Full-handicap strokes** — every player receives all their strokes, allocated
  across holes by stroke index (extra strokes loop for handicaps over 18).
- **Live scoring** — enter scores hole-by-hole; leaderboards update instantly.
  With Firebase configured, everyone scores on their own phone and sees the same
  live data.
- **Team / Ryder Cup scoreboard** — singles matchups auto-scored, team points
  tallied across all rounds.
- **Skins** — gross or net, with optional carryover on ties, plus auto pot split.
- **Payouts** — skins payouts are automatic; add overall net/gross "places" pots
  (e.g. 60/30/10) and the app distributes the pot, splitting ties.
- **Printable scorecards** — one card per matchup showing each player's handicap
  strokes as dots per hole. Use the browser's print dialog (one card per page).

## Quick start

1. Open `index.html` (double-click, or host it). Everything works offline using
   the browser's local storage.
2. Click **Setup → Load sample data** to see a full example, or build your own:
   add teams, players, and a course (tees + holes), then create a **Round** and
   add **Groups / Matchups** (or use **Auto-pair teams**).
3. Enter scores on the **Score** tab. Watch the **Leaderboard**, **Skins**, and
   **Payouts** tabs update live. Print from the **Scorecards** tab.

## Enabling live multi-device sync (Firebase)

The app runs fine offline, but for everyone to share live scores:

1. Create a free project at <https://console.firebase.google.com>.
2. Add a **Web app** and copy the `firebaseConfig` values.
3. In the console, open **Realtime Database → Create Database** (start in test
   mode for the trip).
4. Paste your config into [`js/config.js`](js/config.js) (replace the
   `REPLACE_ME` placeholders) and set a `TRIP_ID`.
5. Host the folder (GitHub Pages: repo **Settings → Pages → deploy from branch**).
   Everyone who opens the page shares the same live trip. Append `?trip=some-id`
   to the URL to run multiple separate trips from one deployment.

> The Firebase web config is not a secret — it's safe to commit. Lock the
> Realtime Database rules down after the trip if you like.

## File layout

| File | Purpose |
|------|---------|
| `index.html` | App shell + tab navigation |
| `css/styles.css` | Styling (incl. print layout) |
| `js/config.js` | Firebase config + trip id |
| `js/golf.js` | Pure golf math (handicaps, strokes, skins, match play, payouts) |
| `js/store.js` | State + persistence (Firebase / localStorage) |
| `js/print.js` | Printable scorecard builder |
| `js/ui.js` | Rendering + interaction |

## Custom formats

Formats are selectable per round (stroke net/gross, singles match, team net,
stableford). The scoring engine in `js/golf.js` is written as pure functions so
new custom formats can be added without touching the storage or UI plumbing —
tell me the format rules and I'll wire them in.
