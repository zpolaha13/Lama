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

  // All three courses from the official Talamore Golf Resort website scorecards
  // (men's tees, par, and men's handicap row). Each HCP row validated as a clean
  // 1-18 permutation (even front / odd back). Default tee per round is Blue.
  // Note: the printed cards have swapped course logos and a couple of obvious
  // par/yardage typos on Legacy holes 16/18 — par there follows the yardage
  // (hole 18 is the long par 5). Stroke index is taken exactly as printed.
  const mkHoles = (arr) => arr.map(([par, si]) => ({ par, si }));

  // Legacy Golf Links — par 72 (F36/B36).
  const legacy = {
    id: 'legacy', name: 'Legacy Golf Links',
    tees: {
      'legacy-gold': { name: 'Gold', rating: 74.4, slope: 139 },
      'legacy-blue': { name: 'Blue', rating: 72.2, slope: 134 },
      'legacy-white': { name: 'White', rating: 69.6, slope: 130 },
      'legacy-green': { name: 'Green', rating: 66.5, slope: 117 },
      'legacy-red': { name: 'Red', rating: 63.9, slope: 113 },
    },
    holes: mkHoles([[4, 5], [5, 13], [4, 9], [4, 1], [3, 15], [5, 11], [4, 3], [4, 7], [3, 17],
      [4, 4], [3, 10], [4, 12], [5, 14], [4, 6], [4, 16], [4, 2], [3, 18], [5, 8]]),
  };

  // Mid South Club — par 71 (F36/B35).
  const midsouth = {
    id: 'midsouth', name: 'Mid South Club',
    tees: {
      'mid-gold': { name: 'Gold', rating: 73.8, slope: 146 },
      'mid-blue': { name: 'Blue', rating: 72.1, slope: 139 },
      'mid-white': { name: 'White', rating: 70.0, slope: 132 },
      'mid-green': { name: 'Green', rating: 67.8, slope: 122 },
      'mid-red': { name: 'Red', rating: 63.9, slope: 113 },
    },
    holes: mkHoles([[4, 12], [4, 4], [3, 18], [5, 10], [4, 2], [3, 16], [4, 14], [4, 8], [5, 6],
      [4, 11], [3, 17], [4, 1], [4, 9], [4, 3], [5, 13], [4, 7], [3, 15], [4, 5]]),
  };

  // Talamore (Resort course) — par 71 (F36/B35).
  const talamore = {
    id: 'talamore', name: 'Talamore Golf Resort',
    tees: {
      'tal-gold': { name: 'Gold', rating: 72.4, slope: 132 },
      'tal-blue': { name: 'Blue', rating: 70.4, slope: 129 },
      'tal-white': { name: 'White', rating: 68.4, slope: 121 },
      'tal-green': { name: 'Green', rating: 65.2, slope: 112 },
      'tal-red': { name: 'Red', rating: 63.1, slope: 106 },
    },
    holes: mkHoles([[5, 4], [3, 16], [4, 6], [5, 14], [3, 18], [4, 12], [4, 2], [4, 8], [4, 10],
      [4, 7], [5, 15], [4, 5], [3, 17], [4, 9], [3, 13], [4, 1], [4, 11], [4, 3]]),
  };

  const mk = (id, name, index, squadId) => [id, { id, name, index, squadId, defaultTeeId: '' }];
  // Real roster (handicap index in parens). Team Red vs Team Blue, 6 v 6.
  const players = Object.fromEntries([
    mk('parker', 'Parker', 5, 'red'), mk('bernie', 'Bernie', 7, 'red'), mk('jordan', 'Jordan', 11, 'red'),
    mk('polo', 'Polo', 18, 'red'), mk('danny', 'Danny', 18, 'red'), mk('lilbernie', 'Lil Bernie', 20, 'red'),
    mk('zach', 'Zach', 5, 'blue'), mk('andrew', 'Andrew', 6, 'blue'), mk('ty', 'Ty', 11, 'blue'),
    mk('townsley', 'Townsley', 12, 'blue'), mk('mitchy', 'Mitchy', 20, 'blue'), mk('blake', 'Blake', 22, 'blue'),
  ]);

  const m = (a, b) => ({ id: uid('m'), teamA: a, teamB: b });
  // R1 — Legacy — 1v1 singles
  const r1pairings = [
    m(['parker'], ['zach']), m(['jordan'], ['andrew']), m(['bernie'], ['ty']),
    m(['polo'], ['townsley']), m(['danny'], ['mitchy']), m(['lilbernie'], ['blake']),
  ];
  // R2 — Mid South — 2v2 best ball
  const r2pairings = [
    m(['parker', 'polo'], ['andrew', 'blake']),
    m(['bernie', 'danny'], ['zach', 'townsley']),
    m(['jordan', 'lilbernie'], ['ty', 'mitchy']),
  ];
  // R3 — Talamore — 2v2 Texas scramble
  const r3pairings = [
    m(['parker', 'lilbernie'], ['zach', 'blake']),
    m(['jordan', 'danny'], ['andrew', 'mitchy']),
    m(['polo', 'bernie'], ['ty', 'townsley']),
  ];

  return {
    schemaVersion: 2,
    tournament: {
      id: 'trip-2026', name: 'Guys Golf Trip 2026', joinCode: 'REDBL',
      winPoints: 1, tiePoints: 0.5, weightMode: 'true', normalizeTarget: 4,
      countBestNofM: null, roundOrder: ['r1', 'r2', 'r3'],
    },
    squads: {
      red: { name: 'Red', color: '#D0021B' },
      blue: { name: 'Blue', color: '#1B6FB3' },
    },
    players,
    courses: { legacy, midsouth, talamore },
    rounds: {
      r1: {
        id: 'r1', name: 'Round 1 — Legacy', courseId: 'legacy', format: 'singles', defaultTeeId: 'legacy-blue',
        date: '', status: 'auto', scoringRule: { handicapAllowance: 75 }, pairings: r1pairings, scores: {}, teamScores: {}, teeOverrides: {},
      },
      r2: {
        id: 'r2', name: 'Round 2 — Mid South', courseId: 'midsouth', format: 'fourball', defaultTeeId: 'mid-blue',
        date: '', status: 'auto', scoringRule: { handicapAllowance: 75 }, pairings: r2pairings, scores: {}, teamScores: {}, teeOverrides: {},
      },
      r3: {
        id: 'r3', name: 'Round 3 — Talamore', courseId: 'talamore', format: 'shamble', defaultTeeId: 'tal-blue',
        date: '', status: 'auto', scoringRule: { handicapAllowance: 75 }, pairings: r3pairings, scores: {}, teamScores: {}, teeOverrides: {},
      },
    },
    skins: {
      r1: { enabled: true, mode: 'net', tie: 'rollover', value: 20, allow: 100 },
      r2: { enabled: true, mode: 'net', tie: 'rollover', value: 20, allow: 100 },
      r3: { enabled: true, mode: 'net', tie: 'rollover', value: 20, allow: 100 },
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
  shamble: { label: 'Shamble (Best Ball)', short: '2v2', perSide: 2,
    explainer: 'Both partners tee off, play the best drive, then each plays their own ball in — your better net counts each hole. Win the match to score for your team.' },
  scramble: { label: 'Texas Scramble', short: '2v2', perSide: 2,
    explainer: 'You and a partner play one ball from the best shot each time, against the other team\'s scramble. Win the match to score for your team.' },
};
