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
