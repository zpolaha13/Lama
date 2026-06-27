/* =========================================================================
 * seed.js — Sample "trip template" matching the real trip:
 * 3 rounds (Legacy singles, Mid South fourball, Talamore scramble),
 * 2 squads of 4, all handicapped, one running Cup score.
 * Course slope/rating/SI are placeholders — edit in Setup.
 * ========================================================================= */
import { uid } from './store.js';

export function sampleTournament() {
  const holePar = [4, 4, 3, 5, 4, 4, 3, 5, 4, 4, 4, 3, 5, 4, 4, 3, 4, 5];
  const holeSI = [7, 3, 17, 1, 11, 5, 15, 9, 13, 8, 2, 16, 4, 10, 6, 18, 12, 14];
  const holes = () => holePar.map((par, i) => ({ par, si: holeSI[i] }));

  // Researched from public databases (18Birdies / GolfLink / BlueGolf summaries).
  // Tee ratings/slopes: medium-high confidence. Verify against each course's
  // printed scorecard before the trip — especially Legacy's per-hole par/SI,
  // which could not be sourced and is still the par-4/SI-1..18 placeholder.
  const mkHoles = (arr) => arr.map(([par, si]) => ({ par, si }));

  // Legacy Golf Links — Aberdeen, NC — par 72. Tees solid; HOLE par/SI NOT sourced (placeholder).
  const legacy = {
    id: 'legacy', name: 'Legacy Golf Links',
    tees: {
      'legacy-gold': { name: 'Gold', rating: 74.4, slope: 139 },
      'legacy-blue': { name: 'Blue', rating: 72.2, slope: 134 },
      'legacy-white': { name: 'White', rating: 69.6, slope: 130 },
      'legacy-green': { name: 'Green', rating: 66.5, slope: 117 },
      'legacy-red': { name: 'Red', rating: 63.9, slope: 113 },
    },
    holes: holes(), // PLACEHOLDER — enter real par + stroke index from the scorecard
  };

  // Mid South Club — Southern Pines, NC — par 71 (front 36 / back 35).
  const midsouth = {
    id: 'midsouth', name: 'Mid South Club',
    tees: {
      'mid-gold': { name: 'Gold', rating: 73.8, slope: 146 },
      'mid-blue': { name: 'Blue', rating: 72.1, slope: 139 },
      'mid-white': { name: 'White', rating: 70.0, slope: 132 },
      'mid-green': { name: 'Green', rating: 67.8, slope: 122 },
      'mid-red': { name: 'Red', rating: 63.9, slope: 113 },
    },
    holes: mkHoles([[4, 11], [4, 3], [3, 17], [5, 9], [4, 1], [3, 15], [4, 13], [4, 7], [5, 5],
      [4, 12], [3, 18], [4, 2], [4, 10], [4, 4], [5, 14], [4, 8], [3, 16], [4, 6]]),
  };

  // Talamore (Resort course) — Southern Pines, NC — par 71 (front 36 / back 35).
  const talamore = {
    id: 'talamore', name: 'Talamore Golf Resort',
    tees: {
      'tal-gold': { name: 'Gold', rating: 71.4, slope: 140 },
      'tal-blue': { name: 'Blue', rating: 68.7, slope: 136 },
      'tal-white': { name: 'White', rating: 66.0, slope: 132 },
      'tal-green': { name: 'Green', rating: 63.1, slope: 125 },
      'tal-red': { name: 'Red', rating: 63.1, slope: 106 },
    },
    holes: mkHoles([[5, 4], [3, 16], [4, 6], [5, 14], [3, 18], [4, 12], [4, 2], [4, 8], [4, 10],
      [4, 7], [5, 15], [4, 5], [3, 17], [4, 9], [3, 13], [4, 1], [4, 11], [4, 3]]),
  };

  const mk = (id, name, index, squadId) => [id, { id, name, index, squadId, defaultTeeId: '' }];
  const red = [['p1', 8], ['p2', 12], ['p3', 5], ['p4', 16], ['p5', 10], ['p6', 3]];
  const blue = [['p7', 9], ['p8', 14], ['p9', 7], ['p10', 20], ['p11', 11], ['p12', 6]];
  const players = Object.fromEntries(
    red.map(([id, ix], i) => mk(id, 'Player ' + (i + 1), ix, 'red'))
      .concat(blue.map(([id, ix], i) => mk(id, 'Player ' + (i + 7), ix, 'blue')))
  );

  // R1 singles: 6 matches (1v1). R2/R3: 3 matches (2v2 pairs).
  const singles = red.map(([rid], i) => ({ id: uid('m'), teamA: [rid], teamB: [blue[i][0]] }));
  const pairs = () => [0, 1, 2].map((k) => ({
    id: uid('m'), teamA: [red[k * 2][0], red[k * 2 + 1][0]], teamB: [blue[k * 2][0], blue[k * 2 + 1][0]],
  }));

  return {
    schemaVersion: 2,
    tournament: {
      id: 'trip-2026', name: 'Guys Golf Trip 2026', joinCode: 'REDBL',
      winPoints: 1, tiePoints: 0.5, weightMode: 'true', normalizeTarget: 4,
      countBestNofM: null, roundOrder: ['r1', 'r2', 'r3'],
    },
    squads: {
      red: { name: 'Team Red', color: '#D0021B' },
      blue: { name: 'Team Blue', color: '#1B6FB3' },
    },
    players,
    courses: { legacy, midsouth, talamore },
    rounds: {
      r1: {
        id: 'r1', name: 'Round 1 — Legacy', courseId: 'legacy', format: 'singles', defaultTeeId: 'legacy-blue',
        date: '', status: 'auto', pairings: singles, scores: {}, teamScores: {}, teeOverrides: {},
      },
      r2: {
        id: 'r2', name: 'Round 2 — Mid South', courseId: 'midsouth', format: 'fourball', defaultTeeId: 'mid-blue',
        date: '', status: 'auto', pairings: pairs(), scores: {}, teamScores: {}, teeOverrides: {},
      },
      r3: {
        id: 'r3', name: 'Round 3 — Talamore', courseId: 'talamore', format: 'scramble', defaultTeeId: 'tal-blue',
        date: '', status: 'auto', pairings: pairs(), scores: {}, teamScores: {}, teeOverrides: {},
      },
    },
    skins: {
      r1: { enabled: true, mode: 'net', tie: 'rollover', value: 10 },
      r2: { enabled: true, mode: 'net', tie: 'split', value: 10 },
    },
    payouts: { potPerPlayer: 20, places: [0.6, 0.3, 0.1] },
    ui: { meId: null },
  };
}

export const FORMAT_INFO = {
  singles: { label: 'Singles Match', short: '1v1', perSide: 1,
    explainer: 'You vs one opponent. Low net wins each hole. Win the match to score for your team.' },
  fourball: { label: 'Fourball (Best Ball)', short: '2v2', perSide: 2,
    explainer: 'You and a partner each play your own ball; your better net counts each hole. Win the match to score for your team.' },
  scramble: { label: 'Texas Scramble', short: '2v2', perSide: 2,
    explainer: 'You and a partner play one ball from the best shot each time, against the other team\'s scramble. Win the match to score for your team.' },
};
