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
  eq(t3.ch, 10, 'team scramble: 25/20/15/10 handicap (8,12,18,24)');
  eq(t3.net, 62, 'team scramble: net = gross - team strokes');
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

console.log(`\nPASS ${pass}  FAIL ${fail}`);
process.exit(fail ? 1 : 0);
