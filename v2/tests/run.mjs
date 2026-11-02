/* Node test runner for the v2 engine + standings. Run: node tests/run.mjs */
import * as G from '../js/engine/golf.js';
import { computeStandings, resolveRound, chFor, matchHandicaps, effectiveCH, teamScrambleRound } from '../js/engine/standings.js';
import { diffPaths } from '../js/store.js';
import { toCSV, fromCSV } from '../js/engine/csv.js';
import { sampleTournament } from '../js/seed.js';

let pass = 0, fail = 0;
function eq(a, b, msg) {
  if (JSON.stringify(a) === JSON.stringify(b)) pass++;
  else { fail++; console.log('FAIL', msg, '\n  got ', JSON.stringify(a), '\n  want', JSON.stringify(b)); }
}

/* ---------------- engine ---------------- */
eq(G.courseHandicap(10, 124, 70.4, 72), 9, 'courseHandicap');
eq(G.courseHandicap(18, 113, null, null), 18, 'courseHandicap slope-only');
eq(G.strokesOnHole(9, 1, 18), 1, 'stroke si1');
eq(G.strokesOnHole(9, 10, 18), 0, 'stroke si10 none');
eq(G.strokesOnHole(20, 2, 18), 2, 'stroke si2 two');
eq(G.strokesOnHole(-2, 18, 18), -1, 'plus give-back si18');
eq(G.strokesOnHole(-2, 16, 18), 0, 'plus give-back si16 none');
eq(G.scrambleHandicap([8, 12]), Math.round(0.35 * 8 + 0.15 * 12), 'scramble hc (2-player 35/15)');
eq(G.scrambleHandicap([12, 8]), Math.round(0.35 * 8 + 0.15 * 12), 'scramble hc order-independent (low gets 35%)');
eq(G.scrambleHandicap([10]), 10, 'scramble hc 1-player = own CH');
eq(G.scrambleHandicap([8, 12], 50), Math.round((0.35 * 8 + 0.15 * 12) * 0.5), 'scramble hc allowance scales the blend');
eq(G.scrambleHandicap([20, 16, 12, 8]), Math.round(0.25 * 8 + 0.20 * 12 + 0.15 * 16 + 0.10 * 20), 'scramble hc 4-player 25/20/15/10');

const holes = Array.from({ length: 18 }, (_, i) => ({ par: 4, si: i + 1 }));
// best ball: A best 4 vs B best 5 every hole -> A wins
const sc = { a1: {}, a2: {}, b1: {}, b2: {} };
for (let h = 0; h < 18; h++) { sc.a1[h] = 4; sc.a2[h] = 6; sc.b1[h] = 5; sc.b2[h] = 7; }
const gs = (pid, h) => (sc[pid] && sc[pid][h] != null ? sc[pid][h] : null);
const nA = G.bestBallNets([{ id: 'a1', courseHandicap: 0 }, { id: 'a2', courseHandicap: 0 }], holes, gs);
const nB = G.bestBallNets([{ id: 'b1', courseHandicap: 0 }, { id: 'b2', courseHandicap: 0 }], holes, gs);
eq(nA[0], 4, 'bestball A net hole0');
eq(G.matchFromNets(nA, nB, 18).result, 'A', 'fourball A wins');

// closeout text 3 & 2
const cg = { A: {}, B: {} };
for (let h = 0; h < 16; h++) { if (h < 3) { cg.A[h] = 3; cg.B[h] = 4; } else { cg.A[h] = 4; cg.B[h] = 4; } }
const ca = G.scrambleNets(0, holes, (h) => (cg.A[h] != null ? cg.A[h] : null));
const cb = G.scrambleNets(0, holes, (h) => (cg.B[h] != null ? cg.B[h] : null));
const mc = G.matchFromNets(ca, cb, 18);
eq(mc.result, 'A', 'closeout A');
eq(G.matchText(mc, 'Red', 'Blue'), 'Red won 3 & 2', 'closeout text');

/* ---------------- standings (tournament model) ---------------- */
function mkState(weightMode) {
  const H = holes.map((h) => ({ par: 4, si: h.si }));
  const st = {
    schemaVersion: 2,
    tournament: { id: 't', name: 'T', winPoints: 1, tiePoints: 0.5, weightMode: weightMode || 'true', normalizeTarget: 4, roundOrder: ['r1', 'r2', 'r3'] },
    squads: { red: { name: 'Red', color: '#f00' }, blue: { name: 'Blue', color: '#00f' } },
    players: {
      p1: { name: 'A1', index: 0, squadId: 'red', defaultTeeId: 't1' },
      p2: { name: 'A2', index: 0, squadId: 'red', defaultTeeId: 't1' },
      p3: { name: 'A3', index: 0, squadId: 'red', defaultTeeId: 't1' },
      p4: { name: 'A4', index: 0, squadId: 'red', defaultTeeId: 't1' },
      q1: { name: 'B1', index: 0, squadId: 'blue', defaultTeeId: 't1' },
      q2: { name: 'B2', index: 0, squadId: 'blue', defaultTeeId: 't1' },
      q3: { name: 'B3', index: 0, squadId: 'blue', defaultTeeId: 't1' },
      q4: { name: 'B4', index: 0, squadId: 'blue', defaultTeeId: 't1' },
    },
    courses: { c1: { name: 'C', tees: { t1: { name: 'W', rating: 72, slope: 113 } }, holes: H } },
    rounds: {
      r1: { id: 'r1', name: 'R1', courseId: 'c1', format: 'singles', status: 'auto',
        pairings: [
          { id: 'm1', teamA: ['p1'], teamB: ['q1'] }, { id: 'm2', teamA: ['p2'], teamB: ['q2'] },
          { id: 'm3', teamA: ['p3'], teamB: ['q3'] }, { id: 'm4', teamA: ['p4'], teamB: ['q4'] },
        ], scores: {}, teamScores: {} },
      r2: { id: 'r2', name: 'R2', courseId: 'c1', format: 'fourball', status: 'auto',
        pairings: [{ id: 'm5', teamA: ['p1', 'p2'], teamB: ['q1', 'q2'] }, { id: 'm6', teamA: ['p3', 'p4'], teamB: ['q3', 'q4'] }],
        scores: {}, teamScores: {} },
      r3: { id: 'r3', name: 'R3', courseId: 'c1', format: 'scramble', status: 'auto',
        pairings: [{ id: 'm7', teamA: ['p1', 'p2'], teamB: ['q1', 'q2'] }, { id: 'm8', teamA: ['p3', 'p4'], teamB: ['q3', 'q4'] }],
        scores: {}, teamScores: {} },
    },
  };
  Object.keys(st.players).forEach((k) => { st.players[k].id = k; });
  return st;
}

// R1: red wins all 4 singles (red shoots 4, blue 5 everywhere)
const st = mkState('true');
['p1', 'p2', 'p3', 'p4'].forEach((pid) => { st.rounds.r1.scores[pid] = {}; for (let h = 0; h < 18; h++) st.rounds.r1.scores[pid][h] = 4; });
['q1', 'q2', 'q3', 'q4'].forEach((pid) => { st.rounds.r1.scores[pid] = {}; for (let h = 0; h < 18; h++) st.rounds.r1.scores[pid][h] = 5; });

const r1 = resolveRound(st, st.rounds.r1);
eq(r1.pointsAvailable, 4, 'R1 points available = 4');
eq(r1.raw.red, 4, 'R1 red wins 4');
eq(r1.raw.blue, 0, 'R1 blue 0');
eq(r1.status, 'final', 'R1 final');

const stand = computeStandings(st);
eq(stand.totalAvailable, 8, 'total available = 8 (4+2+2)');
eq(stand.target, 4.5, 'target 4.5');
eq(stand.cup.red, 4, 'cup red 4 after R1');

// normalized mode: R1 red 4/4 * 4 = 4 ; same here since full sweep
const stN = mkState('normalized');
['p1', 'p2', 'p3', 'p4'].forEach((pid) => { stN.rounds.r1.scores[pid] = {}; for (let h = 0; h < 18; h++) stN.rounds.r1.scores[pid][h] = 4; });
['q1', 'q2', 'q3', 'q4'].forEach((pid) => { stN.rounds.r1.scores[pid] = {}; for (let h = 0; h < 18; h++) stN.rounds.r1.scores[pid][h] = 5; });
// red wins 3 of 4 singles, one halved -> raw 3.5; normalized = 3.5/4*4 = 3.5
stN.rounds.r1.scores.q4 = {}; for (let h = 0; h < 18; h++) stN.rounds.r1.scores.q4[h] = 4; // p4 vs q4 tie
const r1n = resolveRound(stN, stN.rounds.r1);
eq(r1n.raw.red, 3.5, 'normalized raw red 3.5 (3 wins + 1 halve)');
eq(r1n.contribution.red, 3.5, 'normalized contribution red 3.5');

// equal-weight: total available + target must track normalizeTarget, not raw match count
{
  const w = mkState('normalized'); // 3 rounds, all with pairings
  w.tournament.normalizeTarget = 4;
  eq(computeStandings(w).totalAvailable, 12, 'normalized total = 3 rounds * 4');
  eq(computeStandings(w).target, 6.5, 'normalized target 6.5 at worth 4');
  w.tournament.normalizeTarget = 8;
  eq(computeStandings(w).totalAvailable, 24, 'normalized total = 3 rounds * 8');
  eq(computeStandings(w).target, 12.5, 'normalized target moves with worth -> 12.5');
  w.tournament.normalizeTarget = 2;
  eq(computeStandings(w).target, 3.5, 'normalized target 3.5 at worth 2 (reachable)');
  // per-round weighted value is exposed for the breakdown chip
  w.tournament.normalizeTarget = 4;
  eq(computeStandings(w).rounds.every((r) => r.availableWeighted === 4), true, 'normalized: each round shows weighted 4');
  eq(computeStandings(mkState('true')).rounds.map((r) => r.availableWeighted).join(','), '4,2,2', 'true: weighted = raw match counts');
  // true points on the same field stays match-count based
  const tp = mkState('true');
  eq(computeStandings(tp).totalAvailable, 8, 'true total = 4+2+2 matches');
}

// chFor sanity
eq(chFor(st, st.players.p1, st.rounds.r1), 0, 'chFor scratch on par72/113');

/* ---------------- skins: rollover vs split ---------------- */
const sh = [{ par: 4, si: 1 }, { par: 4, si: 2 }, { par: 4, si: 3 }];
const pl = [{ id: 'a', courseHandicap: 0 }, { id: 'b', courseHandicap: 0 }, { id: 'c', courseHandicap: 0 }];
const sc2 = { a: { 0: 3, 1: 4, 2: 3 }, b: { 0: 4, 1: 4, 2: 5 }, c: { 0: 5, 1: 5, 2: 5 } };
const gs2 = (pid, h) => (sc2[pid] && sc2[pid][h] != null ? sc2[pid][h] : null);
// rollover: h0 a wins(1); h1 a&b tie(4) carry; h2 a wins 1+1=2 -> a=3
const ro = G.computeSkins(pl, sh, gs2, { mode: 'gross', tie: 'rollover' });
eq(ro.skinsByPlayer.a, 3, 'rollover a=3');
eq(ro.totalSkins, 3, 'rollover total 3');
// split: h0 a=1; h1 a&b 0.5 each; h2 a=1 -> a=2.5 b=0.5
const sp = G.computeSkins(pl, sh, gs2, { mode: 'gross', tie: 'split' });
eq(sp.skinsByPlayer.a, 2.5, 'split a=2.5');
eq(sp.skinsByPlayer.b, 0.5, 'split b=0.5');
eq(sp.totalSkins, 3, 'split total 3');
// payouts: buy-in 10 x 3 players = $30 pot; split perSkin = 30/3 = 10
const pay = G.skinsPayouts(10, pl, sp.skinsByPlayer, sp.totalSkins);
eq(pay.pot, 30, 'skins pot 30');
eq(pay.payouts.a, 25, 'split a $25');
eq(pay.payouts.b, 5, 'split b $5');

/* ---------------- custom points per match ---------------- */
const stPts = mkState('true');
['p1', 'p2', 'p3', 'p4'].forEach((pid) => { stPts.rounds.r1.scores[pid] = {}; for (let h = 0; h < 18; h++) stPts.rounds.r1.scores[pid][h] = 4; });
['q1', 'q2', 'q3', 'q4'].forEach((pid) => { stPts.rounds.r1.scores[pid] = {}; for (let h = 0; h < 18; h++) stPts.rounds.r1.scores[pid][h] = 5; });
stPts.rounds.r1.scoringRule = { pointsPerMatch: 2 };           // each singles match worth 2
const r1p = resolveRound(stPts, stPts.rounds.r1);
eq(r1p.pointsAvailable, 8, 'ppm=2 over 4 matches -> 8 available');
eq(r1p.raw.red, 8, 'red sweeps 4 matches x2 = 8');

/* ---------------- handicap allowance + basis ---------------- */
const stH = mkState('true');
stH.players.p1.index = 10;   // CH 10 on par72/113
stH.players.q1.index = 4;    // CH 4
// absolute 80%: p1 -> round(10*.8)=8, q1 -> round(4*.8)=3
stH.rounds.r1.scoringRule = { handicapAllowance: 80, handicapMode: 'absolute' };
eq(effectiveCH(stH, stH.players.p1, stH.rounds.r1), 8, '80% of 10 = 8');
eq(effectiveCH(stH, stH.players.q1, stH.rounds.r1), 3, '80% of 4 = 3');
const hAbs = matchHandicaps(stH, stH.rounds.r1, stH.rounds.r1.pairings[0]);
eq(hAbs.byPlayer.p1, 8, 'absolute p1 ch 8');
eq(hAbs.byPlayer.q1, 3, 'absolute q1 ch 3');
// relative (off the low): subtract min(8,3)=3 -> p1 5, q1 0
stH.rounds.r1.scoringRule = { handicapAllowance: 80, handicapMode: 'relative' };
const hRel = matchHandicaps(stH, stH.rounds.r1, stH.rounds.r1.pairings[0]);
eq(hRel.byPlayer.p1, 5, 'relative p1 gets 5 (8-3)');
eq(hRel.byPlayer.q1, 0, 'relative low man plays scratch');

/* ---------------- tee selection drives course handicap ---------------- */
const stT = mkState('true');
// give the course two tees with different slope/rating
stT.courses.c1.tees = { white: { name: 'White', rating: 70, slope: 113 }, blue: { name: 'Blue', rating: 74, slope: 140 } };
stT.players.p1.index = 12;
// round default tee = white -> CH = 12*113/113 + (70-72) = 12 - 2 = 10
stT.rounds.r1.defaultTeeId = 'white';
eq(chFor(stT, stT.players.p1, stT.rounds.r1), 10, 'white tee CH 10');
// per-player override to blue -> 12*140/113 + (74-72) = 14.87 + 2 = 16.87 -> 17
stT.rounds.r1.teeOverrides = { p1: 'blue' };
eq(chFor(stT, stT.players.p1, stT.rounds.r1), 17, 'blue tee override CH 17');
// clearing override falls back to round default tee
delete stT.rounds.r1.teeOverrides.p1;
eq(chFor(stT, stT.players.p1, stT.rounds.r1), 10, 'fallback to round tee');

/* ---------------- sync diff (conflict-free per-path writes) ---------------- */
// a single score change yields exactly one leaf path
const before = { rounds: { r1: { scores: { p1: { 0: 4 }, p2: { 0: 5 } } } } };
const after = { rounds: { r1: { scores: { p1: { 0: 4, 1: 3 }, p2: { 0: 5 } } } } };
eq(diffPaths(before, after, '', {}), { 'rounds/r1/scores/p1/1': 3 }, 'diff: one new score = one path');
// adding a new player writes only that new subtree (p1 untouched -> no clobber)
const d2 = diffPaths({ s: { p1: { 0: 4 } } }, { s: { p1: { 0: 4 }, p2: { 0: 6 } } }, '', {});
eq(d2, { 's/p2': { 0: 6 } }, 'diff: new player is an isolated subtree');
// editing an existing player on a new hole is a single leaf path
const d3 = diffPaths({ s: { p1: { 0: 4 }, p2: { 0: 5 } } }, { s: { p1: { 0: 4 }, p2: { 0: 5, 7: 3 } } }, '', {});
eq(d3, { 's/p2/7': 3 }, 'diff: existing player new hole = one leaf');
// deletion -> null
eq(diffPaths({ a: { x: 1, y: 2 } }, { a: { x: 1 } }, '', {}), { 'a/y': null }, 'diff: removal -> null');
// arrays are atomic
eq(diffPaths({ p: [1, 2] }, { p: [1, 2, 3] }, '', {}), { p: [1, 2, 3] }, 'diff: array atomic');
// no change -> empty
eq(diffPaths({ a: { b: 1 } }, { a: { b: 1 } }, '', {}), {}, 'diff: no change = empty');

/* ---------------- team scramble (3+ teams, low net leaderboard) ---------------- */
{
  const H = Array.from({ length: 18 }, (_, i) => ({ par: 4, si: i + 1 }));
  const mk = (id, idx, sq) => [id, { id, name: id, index: idx, squadId: sq, defaultTeeId: 't' }];
  const ts = {
    tournament: { weightMode: 'true', roundOrder: ['r1'] },
    squads: { t1: { name: 'T1' }, t2: { name: 'T2' }, t3: { name: 'T3' } },
    players: Object.fromEntries([
      mk('a1', 5, 't1'), mk('a2', 10, 't1'), mk('a3', 15, 't1'), mk('a4', 20, 't1'),
      mk('b1', 6, 't2'), mk('b2', 11, 't2'), mk('b3', 16, 't2'), mk('b4', 21, 't2'),
      mk('c1', 8, 't3'), mk('c2', 12, 't3'), mk('c3', 18, 't3'), mk('c4', 24, 't3'),
    ]),
    courses: { co: { id: 'co', tees: { t: { name: 'T', rating: 72, slope: 113 } }, holes: H } },
    rounds: { r1: { id: 'r1', name: 'Scr', courseId: 'co', format: 'teamscramble', defaultTeeId: 't', scoringRule: { handicapAllowance: 100, handicapMode: 'absolute' }, teamScores: {}, scores: {} } },
  };
  const set = (sid, v) => { ts.rounds.r1.teamScores[sid] = {}; for (let h = 0; h < 18; h++) ts.rounds.r1.teamScores[sid][h] = v; };
  set('t1', 4); set('t2', 5); set('t3', 4); // t1 CH 8 net 64, t2 CH 8 net 82, t3 CH 10 net 62
  const tr = teamScrambleRound(ts, ts.rounds.r1);
  const t3 = tr.teams.find((t) => t.squadId === 't3');
  const t1 = tr.teams.find((t) => t.squadId === 't1');
  eq(t3.rawCh, 10, 'team scramble: raw 25/20/15/10 handicap (8,12,18,24)');
  eq(t1.ch, 0, 'team scramble: low team plays scratch (off the low team)');
  eq(t3.ch, 2, 'team scramble: others get the difference (10 - low 8)');
  eq(t3.net, 70, 'team scramble: net = gross - off-low team strokes');
  eq(tr.teams[0].squadId, 't3', 'team scramble: low net ranks first');
  eq(tr.teams[0].place, 1, 'team scramble: leader is place 1');
  const sd = computeStandings(ts);
  eq(sd.strokePlay, true, 'team scramble: pure-scramble tournament is stroke play');
  eq(sd.teamLeaderboard[0].squadId, 't3', 'team scramble: overall leaderboard ranks low net first');
}

/* ---------------- hole + match point system ---------------- */
{
  const h = mkState('true');
  // Red wins every hole and the match in R1 (4 vs 5 net everywhere, scratch course)
  ['p1', 'p2', 'p3', 'p4'].forEach((pid) => { h.rounds.r1.scores[pid] = {}; for (let k = 0; k < 18; k++) h.rounds.r1.scores[pid][k] = 4; });
  ['q1', 'q2', 'q3', 'q4'].forEach((pid) => { h.rounds.r1.scores[pid] = {}; for (let k = 0; k < 18; k++) h.rounds.r1.scores[pid][k] = 5; });
  h.rounds.r1.scoringRule = { pointSystem: 'holes', holePoints: 0.5, matchPoints: 1, handicapAllowance: 100, handicapMode: 'absolute' };
  const rr = resolveRound(h, h.rounds.r1);
  eq(rr.raw.red, 4 * (0.5 * 18 + 1), 'holes: red sweep = 4 matches * (9+1) = 40');
  eq(rr.raw.blue, 0, 'holes: blue 0');
  eq(rr.pointsAvailable, 4 * 10, 'holes: available = matches * (holes*hp + mp)');
  eq(rr.matches[0].pts.a, 10, 'holes: one swept match = 0.5*18 + 1');
  // unplayed round still reports full projected available (stable target)
  const empty = mkState('true');
  empty.rounds.r1.scoringRule = { pointSystem: 'holes', holePoints: 0.5, matchPoints: 1 };
  eq(resolveRound(empty, empty.rounds.r1).pointsAvailable, 40, 'holes: projected available even with no scores');
  eq(resolveRound(empty, empty.rounds.r1).raw.red, 0, 'holes: nothing earned yet');
}

/* ---------------- CSV import/export round-trip ---------------- */
{
  const orig = sampleTournament();
  const back = fromCSV(toCSV(orig));
  const n = (o, k) => Object.keys(o[k] || {}).length;
  eq(n(back, 'players'), n(orig, 'players'), 'csv: player count round-trips');
  eq(n(back, 'courses'), n(orig, 'courses'), 'csv: course count round-trips');
  eq(n(back, 'rounds'), n(orig, 'rounds'), 'csv: round count round-trips');
  eq(n(back, 'squads'), n(orig, 'squads'), 'csv: squad count round-trips');
  eq(back.tournament.name, orig.tournament.name, 'csv: tournament name');
  eq(back.rounds.r1.format, 'singles', 'csv: round format');
  eq(back.rounds.r1.defaultTeeId, 'legacy-blue', 'csv: round tee resolves by name');
  eq(back.courses.legacy.holes.length, 18, 'csv: 18 holes');
  eq(back.skins.r1.value, 20, 'csv: skins value');
  eq(back.rounds.r1.pairings[0].teamA, ['parker'], 'csv: pairing names map to ids');
  eq(back.rounds.r2.pairings.length, 3, 'csv: fourball pairing count');
  eq(back.rounds.r1.teeTimes.length, 3, 'csv: tee-time groups round-trip');
  eq(back.rounds.r1.teeTimes[0].time, '12:00 PM', 'csv: tee-time time preserved');
  eq(back.rounds.r1.teeTimes[0].players.length, 4, 'csv: tee-time players matched by name');
}

/* tee-time parsing (paste from the email) */
{
  const st2 = sampleTournament();
  st2.rounds.r1.teeTimes = [];
  // mimic what parseTeeTimes does: match names to ids for a pasted line
  const nameToId = {}; Object.values(st2.players).forEach((p) => { nameToId[p.name.toLowerCase()] = p.id; });
  const line = '12:09pm Bernie, Polo, Ty, Townsley';
  const m = line.match(/^(\d{1,2}:\d{2})\s*([ap])\.?\s*m\.?\b\s*(.*)$/i);
  eq(m[1] + ' ' + m[2].toUpperCase() + 'M', '12:09 PM', 'teetimes: parse "12:09pm" -> "12:09 PM"');
  const ids = m[3].split(/[,;/]+/).map((s) => s.trim()).map((n) => nameToId[n.toLowerCase()]).filter(Boolean);
  eq(ids.join(','), 'bernie,polo,ty,townsley', 'teetimes: names matched to player ids');
}

// CSV preserves the fields that used to reset to defaults
{
  const o = sampleTournament();
  o.tournament.weightMode = 'normalized'; o.tournament.normalizeTarget = 6;
  o.skins.r2.mode = 'gross'; o.skins.r2.tie = 'split';
  const w = [];
  const b = fromCSV(toCSV(o), w);
  eq(b.tournament.weightMode, 'normalized', 'csv: weightMode preserved');
  eq(b.tournament.normalizeTarget, 6, 'csv: pointsPerRound preserved');
  eq(b.skins.r2.mode, 'gross', 'csv: skins mode preserved');
  eq(b.skins.r2.tie, 'split', 'csv: skins tie preserved');
  eq(b.payouts.potPerPlayer, 20, 'csv: payouts pot preserved');
  // hole+match scoring survives a round-trip
  o.rounds.r1.scoringRule = Object.assign({}, o.rounds.r1.scoringRule, { pointSystem: 'holes', holePoints: 0.5, matchPoints: 2 });
  const b2 = fromCSV(toCSV(o));
  eq(b2.rounds.r1.scoringRule.pointSystem, 'holes', 'csv: pointSystem preserved');
  eq(b2.rounds.r1.scoringRule.holePoints, 0.5, 'csv: holePoints preserved');
  eq(b2.rounds.r1.scoringRule.matchPoints, 2, 'csv: matchPoints preserved');
  eq(w.length, 0, 'csv: clean round-trip has no warnings');
  // BOM (Excel) must not eat the first section
  eq(fromCSV('﻿' + toCSV(o)).tournament.name, o.tournament.name, 'csv: BOM stripped');
  // non-hex color sanitized; unknown pairing name warns
  const w2 = [];
  const bad = fromCSV('#SQUADS\nid,name,color\nred,Red,"#fff;<img>"\n#PLAYERS\nname,index,squad\nAl,5,red\n#PAIRINGS\nroundId,teamA,teamB\nr1,Al,Bob', w2);
  eq(bad.squads.red.color, '#888', 'csv: unsafe color rejected');
  eq(w2.length, 1, 'csv: unknown pairing name produces a warning');

  // survives a round-trip through a spreadsheet: every row padded with trailing
  // commas and blank separators saved as ",,,," (what Excel/Sheets actually do)
  const WID = 14;
  const mangled = toCSV(sampleTournament()).split('\n')
    .map((l) => l + ','.repeat(Math.max(0, WID - (l.match(/,/g) || []).length))).join('\n');
  const xl = fromCSV(mangled);
  eq(xl.tournament.name, 'Lama Palooza 2026', 'csv: section headers survive trailing commas');
  eq(Object.keys(xl.players).length, 12, 'csv: all players survive spreadsheet padding');
  eq(Object.keys(xl.rounds).length, 3, 'csv: all rounds survive spreadsheet padding');
  eq(xl.rounds.r1.pairings.length, 6, 'csv: pairings survive spreadsheet padding');
}

/* ---------------- foursomes (alternate shot) ---------------- */
eq(G.foursomesHandicap([10, 20]), 15, 'foursomes hc = 50% of combined');
eq(G.foursomesHandicap([9, 4]), 7, 'foursomes hc rounds 6.5 up');
eq(G.foursomesHandicap([10, 20], 50), 8, 'foursomes allowance scales the 50% (7.5 -> 8)');
eq(G.foursomesHandicap([]), 0, 'foursomes hc empty');

// minimal match-play world: flat par-4 course, SI 1..18, slope 113 / rating 72
function world(format, teamA, teamB, idx) {
  const players = {};
  Object.entries(idx).forEach(([id, index], i) => { players[id] = { id, name: id, index, squadId: teamA.includes(id) ? 'red' : 'blue', defaultTeeId: '' }; });
  return {
    tournament: { winPoints: 1, tiePoints: 0.5, weightMode: 'true', normalizeTarget: 4, roundOrder: ['r'] },
    squads: { red: { name: 'Red' }, blue: { name: 'Blue' } },
    players,
    courses: { c: { name: 'C', tees: { t: { name: 'T', rating: 72, slope: 113 } }, holes: Array.from({ length: 18 }, (_, i) => ({ par: 4, si: i + 1 })) } },
    rounds: { r: { id: 'r', courseId: 'c', format, defaultTeeId: 't', status: 'auto', scoringRule: { handicapAllowance: 100, handicapMode: 'absolute' }, pairings: [{ id: 'm1', teamA, teamB }], scores: {}, teamScores: {} } },
    skins: {},
  };
}
{
  const st = world('foursomes', ['a1', 'a2'], ['b1', 'b2'], { a1: 10, a2: 20, b1: 0, b2: 0 });
  const r = st.rounds.r;
  const hc = matchHandicaps(st, r, r.pairings[0]);
  eq([hc.teamBall, hc.teamA, hc.teamB], [true, 15, 0], 'foursomes: one team handicap per side (50% combined)');
  // both sides make 4 on every hole: Red gets a stroke on SI 1-15 -> wins 15 holes
  r.teamScores = { m1: { A: {}, B: {} } };
  for (let h = 0; h < 18; h++) { r.teamScores.m1.A[h] = 4; r.teamScores.m1.B[h] = 4; }
  const res = resolveRound(st, r);
  eq(res.matches[0].m.result, 'A', 'foursomes: team strokes decide the match');
  eq(res.matches[0].chA, 15, 'foursomes: chA on the result');
  eq(res.raw.red, 1, 'foursomes: winner gets the match point');
}

/* ---------------- last hole (sunset) ---------------- */
{
  const st = world('singles', ['a'], ['b'], { a: 0, b: 0 });
  const r = st.rounds.r;
  r.scores = { a: {}, b: {} };
  for (let h = 0; h < 15; h++) { r.scores.a[h] = h < 2 ? 3 : 4; r.scores.b[h] = 4; } // A wins 1-2, halves to 15
  eq(resolveRound(st, r).matches[0].m.result, 'IP', 'no last hole: 2 UP thru 15 is still in play');
  r.lastHole = 15;
  let m = resolveRound(st, r).matches[0];
  eq([m.m.result, m.m.status, m.m.remaining, m.lastHole, m.shortened], ['A', 2, 1, 15, true], 'round last hole 15: 2 UP with 1 to play wins 2 & 1');
  eq(resolveRound(st, r).status, 'final', 'round is final once every match reaches its last hole');
  r.lastHoles = { m1: 18 };
  eq(resolveRound(st, r).matches[0].m.result, 'IP', 'a match setting beats the round setting');
  r.lastHoles = { m1: 13 };
  m = resolveRound(st, r).matches[0];
  eq([m.m.result, m.m.played], ['A', 12], 'last hole 13: decided 2 & 1 after 12, holes 14-15 do not count');
  r.lastHoles = { m1: 1 };
  eq(resolveRound(st, r).matches[0].m.result, 'A', 'last hole 1: 1 UP after 1 wins');
  delete r.lastHole; r.lastHoles = {};
  for (let h = 0; h < 2; h++) r.scores.a[h] = 4; // now all square thru 15
  r.lastHoles = { m1: 15 };
  m = resolveRound(st, r);
  eq([m.matches[0].m.result, m.raw.red, m.raw.blue], ['AS', 0.5, 0.5], 'tie after the last hole is a halve');
  // decided early inside a short match: 3 UP with 2 to play of 15 -> 3 & 2
  r.scores = { a: {}, b: {} };
  for (let h = 0; h < 13; h++) { r.scores.a[h] = h < 3 ? 3 : 4; r.scores.b[h] = 4; }
  m = resolveRound(st, r).matches[0];
  eq([m.m.result, m.m.remaining, G.matchTag(m.m, 'Red', 'Blue')], ['A', 2, 'Red 3 & 2'], 'closed out inside a 15-hole match');
}
{
  // match across two groups (4-man scramble): A finished 15, B finished 14
  const st = world('scramble', ['a1', 'a2', 'a3', 'a4'], ['b1', 'b2', 'b3', 'b4'], { a1: 0, a2: 0, a3: 0, a4: 0, b1: 0, b2: 0, b3: 0, b4: 0 });
  const r = st.rounds.r;
  r.teamScores = { m1: { A: {}, B: {} } };
  for (let h = 0; h < 15; h++) r.teamScores.m1.A[h] = h === 14 ? 3 : 4; // A birdies 15, which B has not played
  for (let h = 0; h < 14; h++) r.teamScores.m1.B[h] = h === 0 ? 3 : 4;  // B wins hole 1
  let m = resolveRound(st, r).matches[0];
  eq([m.bothFinished, m.m.result], [14, 'IP'], 'cross-group: fewest holes both finished = 14');
  r.lastHoles = { m1: m.bothFinished };
  m = resolveRound(st, r).matches[0];
  eq([m.m.result, m.m.played], ['B', 14], 'cross-group: decided over 14, A\'s 15th hole ignored');
  eq(hcTeam4(st), [0, 0], 'scramble 4-man scratch team handicap');
  function hcTeam4(s) { const h = matchHandicaps(s, s.rounds.r, s.rounds.r.pairings[0]); return [h.teamA, h.teamB]; }
}

/* ---------------- points per match + 15.5 target (Bogey-Man layout) ---------------- */
{
  const st = world('fourball', ['a1', 'a2'], ['b1', 'b2'], { a1: 0, a2: 0, b1: 0, b2: 0, a3: 0, a4: 0, b3: 0, b4: 0, a5: 0, a6: 0, b5: 0, b6: 0, a7: 0, a8: 0, b7: 0, b8: 0 });
  ['a3', 'a4', 'a5', 'a6', 'a7', 'a8'].forEach((id) => { st.players[id].squadId = 'red'; });
  ['b3', 'b4', 'b5', 'b6', 'b7', 'b8'].forEach((id) => { st.players[id].squadId = 'blue'; });
  const A = ['a1', 'a2', 'a3', 'a4', 'a5', 'a6', 'a7', 'a8'], B = ['b1', 'b2', 'b3', 'b4', 'b5', 'b6', 'b7', 'b8'];
  const pairs = (n) => Array.from({ length: 8 / n }, (_, i) => ({ id: 'p' + n + i, teamA: A.slice(i * n, i * n + n), teamB: B.slice(i * n, i * n + n) }));
  const mk = (id, format, per, ppm) => ({ id, courseId: 'c', format, defaultTeeId: 't', status: 'auto', scoringRule: { handicapAllowance: 100, handicapMode: 'absolute', pointsPerMatch: ppm }, pairings: pairs(per), scores: {}, teamScores: {} });
  st.rounds = { fb: mk('fb', 'fourball', 2, 2), fs: mk('fs', 'foursomes', 2, 2), sg: mk('sg', 'singles', 1, 1), sc: mk('sc', 'scramble', 4, 3) };
  st.tournament.roundOrder = ['fb', 'fs', 'sg', 'sc'];
  const s0 = computeStandings(st);
  eq([s0.rounds.map((x) => x.pointsAvailable), s0.totalAvailable, s0.target], [[8, 8, 8, 6], 30, 15.5], 'Bogey-Man: 8+8+8+6 = 30 points, first to 15.5');
  // a halved 3-point scramble match splits 1.5 / 1.5
  const sc = st.rounds.sc; sc.teamScores = { p40: { A: {}, B: {} } };
  for (let h = 0; h < 18; h++) { sc.teamScores.p40.A[h] = 4; sc.teamScores.p40.B[h] = 4; }
  const s1 = computeStandings(st);
  eq([s1.rounds[3].raw.red, s1.rounds[3].raw.blue], [1.5, 1.5], 'halved 3-point match = 1½ each');
}

/* ---------------- bye holes, sunset vs finished matches, expected points ---------------- */
{
  // A wins 1-4, halves 5-15 -> 4 & 3 after 15; then B wins the 3 bye holes
  const na = [], nb = [];
  for (let h = 0; h < 18; h++) { na.push(h < 4 ? 3 : (h >= 15 ? 5 : 4)); nb.push(4); }
  const m = G.matchFromNets(na, nb, 18);
  eq([m.result, m.status, m.remaining, m.decidedAt, G.matchTag(m, 'Red', 'Blue')], ['A', 4, 3, 15, 'Red 4 & 3'], 'bye holes after a closeout do not change 4 & 3');
  const st = world('singles', ['a'], ['b'], { a: 0, b: 0 });
  const r = st.rounds.r;
  r.scores = { a: {}, b: {} };
  for (let h = 0; h < 18; h++) { r.scores.a[h] = h === 17 ? 3 : 4; r.scores.b[h] = 4; } // A wins on 18: 1 UP
  r.lastHole = 16; // commissioner calls the round at 16 after this match finished
  const res = resolveRound(st, r).matches[0];
  eq([res.m.result, res.m.status, res.lastHole, res.shortened], ['A', 1, 18, false], 'round-wide sunset leaves a finished match alone');
  r.lastHoles = { m1: 16 };
  eq(resolveRound(st, r).matches[0].m.result, 'AS', 'a match\'s own last hole still applies');
}
{
  // Bogey-Man after the draft: 8 v 8, no matchups built yet
  const st = world('fourball', ['a1'], ['b1'], {});
  st.players = {};
  for (let i = 0; i < 16; i++) st.players['p' + i] = { id: 'p' + i, name: 'p' + i, index: 0, squadId: i % 2 ? 'blue' : 'red' };
  const mk = (id, format, per, ppm) => ({ id, courseId: 'c', format, perSide: per, defaultTeeId: 't', status: 'auto', scoringRule: { pointsPerMatch: ppm }, pairings: [], scores: {}, teamScores: {} });
  st.rounds = { fb: mk('fb', 'fourball', 2, 2), fs: mk('fs', 'foursomes', 2, 2), sg: mk('sg', 'singles', 1, 1), sc: mk('sc', 'scramble', 4, 3) };
  st.tournament.roundOrder = ['fb', 'fs', 'sg', 'sc'];
  let s = computeStandings(st);
  eq([s.rounds.map((x) => x.pointsAvailable), s.totalAvailable, s.target, s.rounds[0].expected], [[8, 8, 8, 6], 30, 15.5, true], 'no matchups yet: expected 8/8/8/6, first to 15.5');
  // Friday paired and finished 10-6 (red wins 3 fourballs, 2 foursomes), Saturday not paired yet
  const R = Object.keys(st.players).filter((k) => st.players[k].squadId === 'red'), B = Object.keys(st.players).filter((k) => st.players[k].squadId === 'blue');
  ['fb', 'fs'].forEach((rid, k) => {
    const rd = st.rounds[rid];
    rd.pairings = [0, 1, 2, 3].map((i) => ({ id: rid + i, teamA: R.slice(i * 2, i * 2 + 2), teamB: B.slice(i * 2, i * 2 + 2) }));
    const redWins = k === 0 ? 3 : 2;
    rd.pairings.forEach((p, i) => {
      const aWin = i < redWins;
      if (rd.format === 'foursomes') { rd.teamScores[p.id] = { A: {}, B: {} }; for (let h = 0; h < 18; h++) { rd.teamScores[p.id].A[h] = aWin ? 3 : 5; rd.teamScores[p.id].B[h] = 4; } }
      else [...p.teamA, ...p.teamB].forEach((pid) => { rd.scores[pid] = {}; for (let h = 0; h < 18; h++) rd.scores[pid][h] = p.teamA.includes(pid) ? (aWin ? 3 : 5) : 4; });
    });
  });
  s = computeStandings(st);
  eq([s.cup.red, s.cup.blue, s.totalAvailable, s.target, s.clinched], [10, 6, 30, 15.5, null], 'Friday night 10-6 with Saturday unpaired: still first to 15.5, nobody clinched');
}

/* ---------------- CSV keeps the new format ---------------- */
{
  const csv = '#TOURNAMENT\nname\nT\n#SQUADS\nid,name,color\nred,Red,#D0021B\nblue,Blue,#1B6FB3\n#PLAYERS\nname,index,squad\nA1,0,red\nA2,0,red\nB1,0,blue\nB2,0,blue\n#COURSES\ncourseId,courseName,teeName,rating,slope\nc,C,Blue,72,113\n#ROUNDS\nroundId,name,courseId,format,tee,handicapAllowance,handicapMode,pointSystem,ptsPerMatch\nfs,Foursomes,c,foursomes,Blue,100,relative,match,2\n#PAIRINGS\nroundId,teamA,teamB\nfs,A1|A2,B1|B2\n';
  const st = fromCSV(csv);
  eq([st.rounds.fs.format, st.rounds.fs.scoringRule.pointsPerMatch, st.rounds.fs.pairings[0].teamA.length], ['foursomes', 2, 2], 'CSV imports a foursomes round at 2 pts/match');
}

console.log(`\nPASS ${pass}  FAIL ${fail}`);
process.exit(fail ? 1 : 0);
