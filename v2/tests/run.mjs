/* Node test runner for the v2 engine + standings. Run: node tests/run.mjs */
import * as G from '../js/engine/golf.js';
import { computeStandings, resolveRound, chFor } from '../js/engine/standings.js';

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
eq(G.scrambleHandicap(8, 12), Math.round(0.35 * 8 + 0.15 * 12), 'scramble hc');

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
  return {
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

console.log(`\nPASS ${pass}  FAIL ${fail}`);
process.exit(fail ? 1 : 0);
