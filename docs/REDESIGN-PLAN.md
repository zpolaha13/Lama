# Golf Trip Tournament App — Redesign Plan

*Researched against Golf Genius, 18Birdies, TheGrint/GHIN/Golf Pad, GolfStatus/BlueGolf, golf-trip/Ryder-Cup apps, mobile score-entry UX, tournament information architecture, and sports/golf visual design systems. Audited against the current codebase, then adversarially reviewed.*

---

## 1. Executive Summary & Recommendation

**Rebuild the shell, harvest the core.** Rewrite the UI and the data/IA layer as a new "Tournament" app, but **port `golf.js` (the scoring engine) almost verbatim** and carry forward `store.js`'s local-first architecture with a smarter sync strategy. Hybrid — neither greenfield nor in-place patching.

**Why not iterate in place.** The four owner goals — polished UX, plain-language "how it works," a tournament-of-rounds that rolls into **one** team score, and two-level (tournament + round) linked leaderboards — are all blocked by the same root: there is **no tournament information architecture** and the rollup that exists is too narrow. The current app is seven flat sibling tabs (Leaderboard, Score, Skins, Payouts, Rounds, Scorecards, Setup) built from `innerHTML` string concatenation with inline styles and whole-view re-renders. The new IA must be **Tournament → Round → Scores**, which is new navigation, a new state shape, and a component structure that doesn't exist today. That's a UI rewrite by definition.

**Honest scope of the rollup gap (correcting an overstatement):** the current `teamPoints()` *does* aggregate across rounds into one per-team total. Its real limits are (a) it counts **only decided match-play results** — stroke/Stableford/scramble-as-stroke contribute zero — and (b) round weighting is **implicit** (singles puts 4 points in play, fourball 2, etc., and the user never sees this). So the engine work is an **extension** — make every format yield comparable squad points with **explicit, visible** weighting — not the invention of an aggregation layer from nothing.

**Why low-risk.** The genuinely hard, correct part — the WHS golf math in `golf.js` (course handicap from slope/rating, per-hole stroke allocation with >18 looping and plus-handicap give-back, net scoring, singles/best-ball/**scramble** match resolution, skins with carryover, payout splitting) — is already isolated as pure, DOM-free, unit-tested functions and ports as-is. The rewrite concentrates effort on the layer that is both the **weakest** and **most central** to the goals (UI + tournament modeling).

**Constraints honored:** no build step, free GitHub Pages hosting, Firebase Realtime DB optional with localStorage fallback, real-time multi-phone scoring.

---

## 2. Key Insights From Competitors (worth stealing)

- **Golf Genius — the "linked tournament."** Each round is a format-specific single-round event; a parent aggregator rolls them into one cumulative standing, with optional "best X of Y rounds." → Model the trip as rounds-each-with-a-format **plus** one Overall standing as a first-class entity.
- **Golf Genius — team-total hero + GGID join code.** A persistent team total pinned to the top of every screen (no participant does arithmetic), and a short 5-character code that unlocks scoring/leaderboards with no account. → Persistent Cup hero header; short shareable join code/link, no sign-up.
- **Golf Genius — one scorer per group; Save advances the hole.** Prevents four phones racing on the same scores. → Default to a single designated group scorer with a hole stepper.
- **"Squad vs Team" split (the key schema insight).** A **Squad** is the persistent side you earn points for all trip (Team Red vs Team Blue); a **pairing/Team** is the *ephemeral within-round* partnership (who you're paired with for fourball today). Players belong to one squad for the whole trip but get re-paired each round. → Trip-long team identity is modeled separately from per-round pairings. This is what cleanly lets "partnerships change every round but the running total doesn't."
- **GHIN / TheGrint / Golf Pad — handicap UX.** Strokes-received shown as **dots in each hole cell**; **net is computed, never typed**; slope/rating shown inline on the tee picker; one shared live card per group. → `golf.js` already has the math; this is presentation.
- **PGA Tour / Masters / BlueGolf — leaderboard grammar.** Fixed columns (POS / PLAYER-or-TEAM / TODAY / THRU / TO PAR / R1–Rn / TOT); **red = under par, charcoal = even/over**; **THRU is a status** (number, "F," or tee time) so "not played" ≠ a real 0; T-prefix ties; overall↔round scope toggle; optional **TV/clubhouse mode**. → Don't reinvent the grid; golfers pattern-match it instantly.
- **PGA Tour / ESPN — tabular figures.** A numeric face with **`font-feature-settings:"tnum"`** so columns don't jitter as live scores tick.
- **start.gg / ESPN Fantasy — "what do I do right now."** A phase-aware status banner + a single priority action card beat dumping the bracket; hard split between an organizer setup wizard and a stripped player view; just-in-time format explainers (consequences, not theory).
- **NN/g + scorecard apps — entry ergonomics.** Par-centered tap row / large stepper beats a keypad (scores cluster 2–8); bottom thumb zone; ≥44pt targets oversized for sun/gloves; swipe between holes; optimistic commit; skeleton screens; teach-by-doing (live match status on the card).
- **Pitfalls to avoid:** over-formatting (curate ~5–6 formats); deep setup hierarchy (hide behind a wizard); desktop tables shrunk to mobile; live-scoring lag/battery drain; color-only meaning; making players do net math; one leaderboard for multi-game events; integer-only points (**half-points for ties are mandatory**).

---

## 3. Core Concept & Mental Model

### The sentence every golf buddy must understand
> **"Our trip is one Tournament. Each day is a Round with its own game. Win your matches to earn points for your team. First team to the target wins the Cup."**

This appears verbatim on the empty state, the "How it works" card, and the standings header.

### The hierarchy
```
TOURNAMENT  (the Cup — the whole trip, one running team score)
  ├─ SQUADS  (2 persistent teams: Team Red vs Team Blue — you're on one all trip)
  ├─ ROUND 1 — Legacy   — Singles Match Play (1v1)      → awards points
  ├─ ROUND 2 — Mid South — Fourball / Best Ball (2v2)    → awards points
  └─ ROUND 3 — Talamore  — Texas Scramble (2v2)          → awards points
        each round contains PAIRINGS (ephemeral within-round teams)
        each pairing is a MATCH → a RESULT → POINTS → the one running total
```

- **Squad** = trip-long identity. `player.squadId` never changes. The Cup total is the sum of points by squad.
- **Pairing** = per-round grouping referencing squad members, regenerated each round. Pairings never touch the squad total directly — they produce match results that *award* squad points.

### The unified points model across mixed formats (the new core engine)

Every round resolves to **points awarded to a squad** using **Ryder-Cup math: 1.0 win, 0.5 tie, 0 loss.** What varies per format is only *how many points the round puts in play and how each is derived.* Each round carries an explicit `scoringRule` of one canonical type:

**Type A — Match play (singles, fourball, foursomes, AND scramble).** Each pairing is one head-to-head match worth **1 point** (0.5 each on a halve). `golf.js` already resolves all of these hole-by-hole.
- **R1 Legacy singles, 4 v 4 → 4 matches → 4 points in play.** `pts[squad] = wins×1 + halves×0.5`.
- **R2 Mid South fourball, 4 v 4 → 2 matches → 2 points in play.** Best net of the pair counts each hole (`bestBallNets`).
- **R3 Talamore Texas scramble, 4 v 4 → 2 scramble matches → 2 points in play.** Each squad fields a 2-man scramble team; the two opposing scramble balls play a hole-by-hole net match (`scrambleNets` + `scrambleHandicap` + `matchFromNets`). **This preserves the working hole-by-hole scramble logic already in the code** — we do *not* collapse it to a single round-winner point.

> **Correction from review:** the scramble is a *match*, not a one-point round bonus. All three of this trip's formats are therefore Type A, which is simpler and keeps existing, tested code. **True points available this trip: R1 = 4, R2 = 2, R3 = 2 → 8 total → target = 4.5.**

**Type B — Team aggregate (only when there's no opposing pairing to match against).** E.g. a single all-play scramble, or team-total stroke. Resolve as a head-to-head net contest worth a configurable round value. **Not used by this trip** (all three rounds are A); included for future flexibility.

**Type C — Individual aggregate (stroke / Stableford, if kept).** Sum each squad's counting nets / Stableford; better squad wins the round value. Optional; only if the owner keeps stroke/Stableford formats.

The Cup total is `Σ pointsThisRound` per squad. Because every format funnels into the same "points to a squad" currency, mixed formats compose into one number.

### Explicit, fair round weighting (concrete math — fixing the hand-wave)

The current app silently weights rounds by match count. We make weighting **explicit and visible**, with two well-defined modes the commissioner chooses:

- **Mode 1 — True points (default).** `cupRaw[squad] = Σ rawPoints[squad][round]`. Each round card and the standings show **"Points available: N."** Honest, simple, but a 4-point singles day outweighs a 2-point fourball day.
- **Mode 2 — Normalized (equal weight).** Each round is worth a common target `T` (default `T = 4`, or commissioner-set). For each round: `scaled[squad] = roundHalf( rawPoints[squad] / pointsAvailable × T )` where `roundHalf(x) = Math.round(x*2)/2` (keeps half-point granularity). `cupNorm[squad] = Σ scaled[squad]`. Every round now contributes the same maximum, so no single day dominates. Displayed points are always multiples of 0.5.

A one-tap toggle switches modes; the standings header labels which is active ("Equal-weight rounds" vs "True points").

### "Best score counts" + missed-round tolerance
- "Best score counts" maps to **fourball = best ball of the pair** (`bestBallNets`) and **scramble = best shot each time** — already supported.
- Optional Golf-Genius-style **"count best N of M rounds"** for the Cup total (tolerance for a skipped round), **off by default**.

### Target line & clinch
Show **"First to `floor(totalPointsAvailable/2) + 0.5` wins"** (8 points → 4.5) and a **"Clinched"** badge when `leader ≥ target` or `remainingPoints < leadGap`.

---

## 4. Information Architecture & Navigation

### Two products, one codebase
- **Player view** — stripped; answers "how am I doing / what do I do now." Default for everyone via the join link.
- **Commissioner view** — guided setup wizard + edit controls, gated by a PIN/toggle, invisible to players.

### Player view — fixed bottom tab bar (4 shallow, stable tabs)
```
┌───────────────────────────────────────────────┐
│  Cup hero header:  RED 2.5 — 1.5 BLUE          │  ← persistent on every tab
├───────────────────────────────────────────────┤
│              (active tab content)              │
├──────────┬───────────┬──────────┬──────────────┤
│   Home   │ Standings │  Rounds  │   My Card     │
└──────────┴───────────┴──────────┴──────────────┘
```
1. **Home** — phase-aware "what do I do right now" action card + Cup total + live mini-board.
2. **Standings** — the two-level leaderboard (Cup total + per-round breakdown); scope toggle Overall ↔ Round N.
3. **Rounds** — schedule timeline; tap a round → Round Detail (round leaderboard + score entry).
4. **My Card** — this player's pairings, scores per round, squad, skins/money.

A persistent **Cup hero header** (squad-vs-squad running total) sits above all tabs.

### Commissioner view — linear setup wizard
```
Tournament name → Squads & colors → Players (name / index / squad / default tee)
→ Courses & tees (rating / slope / par / SI) → Rounds (per-round: course + format + points/weight)
→ Pairings (auto-generate w/ anti-repeat + drag-to-fix) → Review & publish (join code)
```
Plus an always-available **Commissioner panel** for mid-event edits (override scores, swap pairings, change a round's format, lock a card), behind a gear icon. Guard rails warn on un-scoreable rounds (no course, wrong players-per-pairing, non-unique SI, par sum off).

### "How it works" explainer (just-in-time, three layers)
- **Layer 1** — the one-sentence model on empty state + standings header.
- **Layer 2** — a dismissible **"How the Cup works"** sheet (from a `?` icon): squads, each round's format in one line ("Singles match play: you vs one opponent, low net per hole wins the hole; win the match = 1 point for your team"), handicap allowance, points available, skins/money.
- **Layer 3** — teach-by-doing tooltips where they matter (Round Detail: "Fourball: the better net of you and your partner counts each hole"; live row: "2 UP thru 7"). First-encounter only, then quiet. No upfront coachmark tour.

---

## 5. Screen-by-Screen Workflow

**5.1 Home (player landing).** Cup hero header (Red X — Y Blue, target line, clinch badge); one **phase-aware action card** (pre-round: "Round 2 tees off — you're with Sam vs Pat/Jordan"; live: "Score your group — you're the scorer, Hole 5"; between: "Round 2 final: Red won 1.5–0.5"); compact live mini-leaderboard; "How the Cup works" link. Primary action = the card CTA.

**5.2 Standings (two-level).** Segmented scope control `Overall | R1 Legacy | R2 Mid South | R3 Talamore`. *Overall:* big squad total + a **per-round breakdown table** (format, points available, points each squad, status chip). Tap a round row → switch scope to that round. *Round N:* that round's live leaderboard (§6), derived from its scores. Secondary tab strip for side games (Net / Skins / Money). This is the requested Tournament → Round → Scores drill-down.

**5.3 Rounds (timeline).** Vertical round cards (course, date, one-line format explainer, points available, status chip, your pairing). Tap → Round Detail.

**5.4 Round Detail (live board + entry hub).** Round header (course, format explainer, points available, "win this round" framing); the **round leaderboard** (§6); the **match grid** (each pairing's live status: "2 UP thru 7," AS, dormie, "3&2"); a prominent **Enter scores** button for your group; commissioner edit/lock controls.

**5.5 Score Entry (most-used).** Hole-centric **stepper**, one hole per screen; large par-centered tap row / `+`/`–` in the bottom thumb zone (≥44pt); current gross big and bold; **strokes-received dots** in each player's cell; **net auto-computed**; circle/square shape grammar (under/over par); swipe or prev/next with "Hole 7 of 18"; running To-Par at top; live match status under the hole for match formats; **Save advances to next hole**; optimistic local commit + background sync; numeric keypad fallback for blow-ups; a full-grid view for review/edit.

**5.6 My Card (player-centric).** Your squad + color; per-round rows (pairing, partner, opponent, your gross/net, match result and points your team earned); skins won; **settle-up line** (skins + place pots netted: "you're +$14"); tap-through to each round's scorecard.

**5.7 Setup / Commissioner.** The linear wizard; pairings board with an unassigned bench + drag-to-fix + auto-generate (anti-repeat); per-round format picker that pre-fills points-available; guard-rail validation; **publish → short join code + link**; mid-event override panel; **TV mode** launcher; export/import JSON.

---

## 6. Live Leaderboard Design

Two scopes via the Standings segmented control; both read the same hole-by-hole data; both auto-update.

**6.1 Tournament-level (Overall).** Pinned **hero band**: squad-vs-squad running total, broadcast style — large opposing tabular numbers, center divider, team colors, **target line ("First to 4.5")**, **clinch badge**. Beneath, a **per-round breakdown**:

| Round | Format | Pts Avail | Red | Blue | Status |
|---|---|:--:|:--:|:--:|---|
| R1 Legacy | Singles | 4 | **2.5** | 1.5 | Final |
| R2 Mid South | Fourball | 2 | 0 | **2** | Live · thru 12 |
| R3 Talamore | Scramble | 2 | — | — | Not started |

Each row taps through to that round's scope. "Best N of M" / weighting mode noted when active.

**6.2 Round-level (linked to scores).** Standard golf column grid, parameterized by format:
- **Match formats (R1/R2/R3):** one row per match — `Match | squad colors | Status (2 UP / AS / 3&2 / thru N) | Points earned`. Rows expand to member scores and which ball counted (fourball).
- Where stroke detail applies: `POS (T-ties) | PLAYER/TEAM | TODAY | THRU | TO PAR | TOT`, sorted on TO PAR, numerics right-aligned & **tabular**.
- **Color:** TO PAR red = under, charcoal = even/over; "E" for even, always signed; to-par token is the boldest cell. Reinforced by circle/square shapes (not color alone).
- **THRU as status:** number mid-round, "F" done, tee time pre-start; "not played" rendered distinctly from a real 0.
- **Pin self:** the user's row/match highlighted and kept in view.

**6.3 Real-time behavior.** Optimistic local commit; background sync; roll back only on rejection; updates throttled ~500ms with a brief changed-row highlight and up/down movement; **skeleton screens** (not spinners) on first load; "last updated" stamp; offline-first (scores save in dead zones, auto-sync on reconnect).

**6.4 TV / Clubhouse mode (optional, first-class).** Full-screen route (`?tv=1`): large high-contrast rows, dark "tournament navy" background for glare, auto-rotate between Cup total, live round board, and pairings; runs fullscreen over HDMI/Chromecast from the shared link.

---

## 7. Data Model

Single state object, persisted whole locally, synced **per-path** remotely (§9). New entities in **bold**.

```jsonc
{
  "schemaVersion": 2,
  "tournament": {                      // NEW: the Cup
    "id": "trip-2026", "name": "Pinehurst 2026",
    "joinCode": "REDBL",
    "winPoints": 1.0, "tiePoints": 0.5,
    "weightMode": "true",              // "true" | "normalized"
    "normalizeTarget": 4,              // used when weightMode = normalized
    "countBestNofM": null,             // null = count all rounds
    "roundOrder": ["r1","r2","r3"]
  },
  "squads": {                          // NEW: persistent trip-long teams
    "red":  { "name": "Team Red",  "color": "#D0021B" },
    "blue": { "name": "Team Blue", "color": "#1B6FB3" }
  },
  "players": {
    "p1": { "name": "Zach", "index": 8.4, "squadId": "red", "defaultTeeId": "blue" }
  },
  "courses": {
    "legacy": {
      "name": "Legacy",
      "tees": { "blue": { "name": "Blue", "rating": 71.2, "slope": 131 } },
      "holes": [ { "par": 4, "si": 7 } /* …18 */ ]
    }
  },
  "rounds": {
    "r1": {
      "name": "Legacy", "courseId": "legacy", "date": "2026-09-18",
      "format": "singles",             // singles | fourball | foursomes | scramble | shamble | stroke | stableford
      "scoringRule": {                 // NEW: how this round yields squad points
        "type": "match",               // match | teamAgg | individualAgg
        "handicapAllowance": 1.0,
        "pointsAvailable": 4,          // explicit, shown to users (derived from pairings for match type)
        "weight": 1.0
      },
      "status": "live",                // upcoming | live | final
      "pairings": [                    // NEW: ephemeral within-round teams
        { "id": "m1", "teamA": ["p1"], "teamB": ["p5"] },
        { "id": "m2", "teamA": ["p2"], "teamB": ["p6"] }
      ],
      "scores":     { "p1": { "0": 4, "1": 5 } },   // playerId → holeIdx → gross
      "teamScores": { },                            // scramble: pairingId+squad → holeIdx → gross
      "teeOverrides": { "p1": "white" },            // now wired to the UI
      "locked": false
    }
  },
  "skins":   { "r1": { "enabled": true, "value": 5, "carryover": true } },
  "payouts": { "potPerPlayer": 20, "places": [0.6, 0.3, 0.1] },
  "ui":      { "scope": "overall", "scorerByGroup": { "g1": "p1" } }
}
```

### Overall standings — pure function (`standings.js`)
```
for each round in tournament.roundOrder:
  rule = round.scoringRule
  switch rule.type:
    case "match":          // per pairing: golf.js singlesMatch / bestBallNets / scrambleNets → matchFromNets
        for each pairing: if decided → winner squad += winPoints, or both += tiePoints on AS
    case "teamAgg":        // squad team net head-to-head → better squad += round value
    case "individualAgg":  // sum counting nets / Stableford → better squad += round value
  raw[round][squad] = points this round
  if weightMode == "normalized":
      contribution[round][squad] = roundHalf(raw / pointsAvailable * normalizeTarget)
  else:
      contribution[round][squad] = raw
cupTotal[squad] = Σ contribution[round][squad]   (or best-N-of-M if set)
target = floor(Σ pointsAvailable / 2) + 0.5
clinched = leader >= target || remainingPoints < leadGap
```
`standings.js` is the **only new pure module**; everything flows through existing `golf.js`. Unit-tested independently.

---

## 8. Visual Design System

**Palette (semantic tokens, light + dark).**
- Brand primary **Fairway Green `#1B7A3D`** (actions/active), Pine `#0F5130` (pressed/headers); accent **Birdie Gold `#F5A623`** (sparing).
- Squad colors **Red `#D0021B`**, **Blue `#1B6FB3`**, carried through hero band, match grid, scorecards, dots, TV mode — **always paired with a name/label**, never color alone.
- **To-par tokens (Augusta convention):** under = `#D0021B` (red), even/over = `#1A1A1A` (light) / `#F2F2F2` (dark); always signed (`-2`, `E`, `+3`) plus circle/square shapes.
- Settle-up diverging: gain `#2E9E54`, loss `#D0021B`.
- Light: bg `#FFFFFF`, surface `#F6F7F8`, hairline `#E3E6E8`, text `#14181B` / secondary `#5B6770`.
- Dark "Tournament Navy" (doubles as TV/outdoor): bg `#0C1620`, surface `#16242F`, hairline `#243441`, text `#F2F5F7`.

**Typography (two roles).** Numeric/utility face (SF Pro / Inter / Roboto) with **`font-feature-settings:"tnum" 1`** always on for scores/points/stats; one display face for titles/names/hero numbers. Scale (pt): Hero Cup 48–64 bold tabular · Title 28 · Section 22 · Card title 17 · Body 15–17 · Stat label 13 uppercase · floor 12 (outdoor).

**Components.** Leaderboard table · per-round breakdown · Cup hero band · match-status row · scorecard grid (dots + circle/square) · hole stepper / score pad · StatBar (settle-up) · status chip (Upcoming/Live/Final/Locked) · expandable squad row · segmented scope control · bottom tab bar · action card · "How it works" sheet · pairings board (bench + drag) · wizard stepper · skeleton rows · TV layout.

**Spacing / density / motion.** 8pt base grid (4pt fine); card padding 16; rows 48–56pt; section gaps 24; leaderboards dense, dashboards airy. Dark mode + **"Sunlight Boost"** (raises saturation/brightness/numeral size); target **7:1 (AAA)** on primary content. Motion: 250ms feedback (score saved → light haptic), 600–800ms context transitions, subtle row-change highlight, **no looping animation during a round** (battery).

---

## 9. Technical Architecture

**Stay vanilla, add a micro-render layer — no build step.** The pain isn't vanilla JS, it's `innerHTML` string concatenation + inline styles + full re-renders. Fix with a lightweight component pattern:
- **`lit-html`** (or a ~50-line tagged-template `html` renderer) via native **ESM `import`** from a vendored file/CDN — no bundler. Per-component templates with keyed updates; only changed nodes update, which makes the two-level leaderboards and polish tractable.
- All styling moves to **CSS files + design-token CSS variables**; zero inline `style=`.
- *Rejected:* React/Svelte/Vue + bundler (breaks no-build + GH Pages); raw innerHTML (the status quo we're fixing).

**State management.** Carry forward `store.js`: single state object, `subscribe`/`notify`, mutate-via-`update`, debounced persist, cache-then-hydrate boot, export/import, `?trip=` override. Keep **commit-on-change (not keystroke)** and **skip-render-while-a-score-field-is-focused**. Add `standings.js` (pure) + selectors that derive Cup total, per-round breakdown, and round boards from raw scores, so the UI is a pure function of state.

**Sync / conflict (fix the whole-document last-write-wins clobber).** Move to **per-path Firebase writes**: write `rounds/{roundId}/scores/{playerId}/{holeIdx}` (and `teamScores/...`) directly, and listen at `rounds/{roundId}/scores` for the active round — two phones scoring different groups never overwrite each other. **One designated scorer per group** + per-path writes makes concurrent multi-phone scoring safe; optional opt-in "lock card" (off by default) freezes a group after confirmation. Optimistic commit, background reconcile, offline queue auto-syncs on reconnect. Firebase stays optional; localStorage fallback unchanged; the join code maps to a Firebase trip node when sync is on, else local-only.

**Migration (what to keep).**
- **`golf.js` verbatim** as a library + an in-browser `tests.html` (no build) locking handicap/match/skins correctness before the UI rewrite. Wire the already-defined-but-unused `stablefordHole` only if Stableford is kept; drop the phantom "team net" format from docs.
- **`print.js` + print CSS** nearly as-is (dotted handicap scorecard).
- **`store.js` architecture**, swapping the sync layer to per-path writes; bump `schemaVersion` with a one-time migration mapping current `teams` → `squads` and existing per-round match results into the new rule engine.
- **Wire `teeOverrides` to real UI** (currently a dead read path) for mixed-tee groups.

**Hosting.** GitHub Pages (static, free). ESM + vendored `lit-html` + optional Firebase config = no server. Join link `…/?trip=CODE`; TV mode `…/?trip=CODE&tv=1`.

---

## 10. Phased Roadmap (each phase shippable)

- **Phase 0 — Harvest & harden the engine.** Port `golf.js` as a tested library; in-browser unit tests for course handicap, stroke allocation (>18 loop, plus give-back), singles/best-ball/scramble resolution, skins; add `standings.js` + its tests; define design tokens + the `lit-html` render shell. *Ships: tested engine + style foundation.*
- **Phase 1 — MVP redesign: the Cup, this trip baked in.** New IA (4-tab player view + Cup hero header); Tournament/Squad/Round/Pairing model + `standings.js` computing **one** running team total across singles/fourball/scramble; two-level Standings (Overall ↔ round); Round Detail with round board; hole-stepper Score Entry. localStorage only. *Ships: a usable redesigned app for the actual trip, single-device.* **This is the headline MVP.**
- **Phase 2 — Real-time multi-phone scoring.** Per-path Firebase writes, one-scorer-per-group flow, optimistic commit + offline queue, throttled live boards with change highlights + skeletons, join code + link. *Ships: everyone scores on their phone, live on course.*
- **Phase 3 — Polish & clarity.** Full visual system (type, dark mode + Sunlight Boost, motion/haptics, circle/square + dots), the "How the Cup works" explainer + just-in-time tooltips, action-card Home, My Card, empty states. *Ships: the polished, crystal-clear bar.*
- **Phase 4 — Commissioner & money.** Setup wizard with guard rails, pairings board (bench + drag + anti-repeat auto-generate), mid-event override panel, opt-in lock card, settle-up money view (skins + place pots netted to who-owes-whom), TV/clubhouse mode. *Ships: organizer can build/run any future trip.*
- **Phase 5 — Optional depth.** "Best N of M rounds," round weighting / power-play, captain draft, parallel skins mini-board, multi-round auto-scheduler optimizing partner/opponent variety.

---

## 11. Open Decisions for the Owner (highest-impact)

1. **Round weighting / fairness.** True points (R1=4, R2=2, R3=2 — honest but unequal) **or** normalized so every round is worth the same toward the Cup? (Default in plan: true points, shown loudly, with a one-tap normalize toggle.)
2. **Scramble drama.** Confirmed as a **hole-by-hole 2v2 match** (2 points in play, keeps existing logic) — or do you want the scramble to instead be a single round-winner point? (Plan recommends the match.)
3. **Formats beyond this trip.** Ship only the 3 needed (singles/fourball/scramble) for a tight MVP, or also wire Stableford + stroke now for future reuse?
4. **Sync default.** Firebase on by default (needs a free project + config) or local-first with opt-in per trip?
5. **Missed-round tolerance.** Enable "count best N of M rounds" so a guy who skips a round still competes, or count all rounds always?

---

### Changes from the draft (addressing review)
- **Scramble corrected to a hole-by-hole match (Type A), not a single round-winner point** — preserves the existing, tested `scrambleNets`/`matchFromNets` logic and revises this trip's points-available to **R1=4, R2=2, R3=2 (8 total, target 4.5)**.
- **Honest framing of the rollup gap** — acknowledged `teamPoints()` already aggregates across rounds; the real gaps are non-match formats scoring zero and implicit weighting, so the engine work is an *extension*, not a from-scratch aggregation layer.
- **Concrete normalization math** — specified `roundHalf(raw / pointsAvailable × target)` with half-point rounding and an explicit `weightMode` in the data model, replacing the vague "scale to common max."
