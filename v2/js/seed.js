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

  const teeId = 'tee-white';
  const course = (id, name, rating, slope) => ({
    id, name, tees: { [teeId]: { name: 'White', rating, slope } }, holes: holes(),
  });
  const legacy = course('legacy', 'Legacy Golf Links', 71.5, 130);
  const midsouth = course('midsouth', 'Mid South Club', 72.0, 133);
  const talamore = course('talamore', 'Talamore Golf Resort', 71.0, 132);

  const mk = (id, name, index, squadId) => [id, { name, index, squadId, defaultTeeId: teeId }];
  const players = Object.fromEntries([
    mk('p1', 'Player 1', 8, 'red'), mk('p2', 'Player 2', 12, 'red'),
    mk('p3', 'Player 3', 5, 'red'), mk('p4', 'Player 4', 16, 'red'),
    mk('p5', 'Player 5', 9, 'blue'), mk('p6', 'Player 6', 14, 'blue'),
    mk('p7', 'Player 7', 7, 'blue'), mk('p8', 'Player 8', 20, 'blue'),
  ]);

  const singles = [
    { id: uid('m'), teamA: ['p1'], teamB: ['p5'] },
    { id: uid('m'), teamA: ['p2'], teamB: ['p6'] },
    { id: uid('m'), teamA: ['p3'], teamB: ['p7'] },
    { id: uid('m'), teamA: ['p4'], teamB: ['p8'] },
  ];
  const pairs = () => [
    { id: uid('m'), teamA: ['p1', 'p2'], teamB: ['p5', 'p6'] },
    { id: uid('m'), teamA: ['p3', 'p4'], teamB: ['p7', 'p8'] },
  ];

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
        id: 'r1', name: 'Round 1 — Legacy', courseId: 'legacy', format: 'singles',
        date: '', status: 'auto', pairings: singles, scores: {}, teamScores: {}, teeOverrides: {},
      },
      r2: {
        id: 'r2', name: 'Round 2 — Mid South', courseId: 'midsouth', format: 'fourball',
        date: '', status: 'auto', pairings: pairs(), scores: {}, teamScores: {}, teeOverrides: {},
      },
      r3: {
        id: 'r3', name: 'Round 3 — Talamore', courseId: 'talamore', format: 'scramble',
        date: '', status: 'auto', pairings: pairs(), scores: {}, teamScores: {}, teeOverrides: {},
      },
    },
    skins: {
      r1: { enabled: true, value: 5, carryover: true },
      r2: { enabled: true, value: 5, carryover: true },
    },
    payouts: { potPerPlayer: 20, places: [0.6, 0.3, 0.1] },
    ui: { meId: null },
  };
}

export const FORMAT_INFO = {
  singles: { label: 'Singles Match', short: '1v1', perSide: 1,
    explainer: 'You vs one opponent. Low net wins each hole. Win the match = 1 point for your team.' },
  fourball: { label: 'Fourball (Best Ball)', short: '2v2', perSide: 2,
    explainer: 'You and a partner each play your own ball; your better net counts each hole. Win the match = 1 point for your team.' },
  scramble: { label: 'Texas Scramble', short: '2v2', perSide: 2,
    explainer: 'You and a partner play one ball from the best shot each time, against the other team\'s scramble. Win the match = 1 point for your team.' },
};
