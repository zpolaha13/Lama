/* =========================================================================
 * engine/standings.js — Pure tournament model. Turns raw scores into:
 *   - per-round match results + points (Ryder-Cup: 1 win / 0.5 tie)
 *   - per-round squad points (raw + weighted contribution)
 *   - the overall Cup total, target, and clinch state
 *
 * Every format funnels into the same currency: points awarded to a SQUAD.
 * Depends only on engine/golf.js. No DOM, no state mutation.
 * ========================================================================= */

import {
  courseHandicap, bestBallNets, scrambleNets, scrambleHandicap,
  matchFromNets, playerRoundTotals, roundHalf,
} from './golf.js';

/* ---- small resolvers over the state shape ---- */

function coursePar(course) {
  return course && course.holes ? course.holes.reduce((s, h) => s + (Number(h.par) || 0), 0) : 0;
}

function teeFor(course, teeId) {
  if (!course || !course.tees) return null;
  return course.tees[teeId] || course.tees[Object.keys(course.tees)[0]] || null;
}

/* Course handicap for a player in a round (resolves tee + per-round override). */
export function chFor(state, player, round) {
  const course = state.courses[round.courseId];
  if (!course || !player) return 0;
  let teeId = player.defaultTeeId;
  if (round.teeOverrides && round.teeOverrides[player.id]) teeId = round.teeOverrides[player.id];
  const tee = teeFor(course, teeId);
  return courseHandicap(Number(player.index) || 0, tee ? tee.slope : 113, tee ? tee.rating : null, coursePar(course));
}

function squadOfTeam(state, ids) {
  for (const pid of ids || []) {
    const p = state.players[pid];
    if (p && p.squadId) return p.squadId;
  }
  return null;
}

function getScore(round, pid, h) {
  return round.scores && round.scores[pid] ? round.scores[pid][h] : null;
}
function getTeamScore(round, pairingId, side, h) {
  const t = round.teamScores && round.teamScores[pairingId];
  return t && t[side] ? t[side][h] : null;
}

/* Did anyone enter any score in this round? */
function roundHasScores(round) {
  if (round.scores) for (const pid in round.scores) for (const h in round.scores[pid]) if (round.scores[pid][h] != null) return true;
  if (round.teamScores) for (const g in round.teamScores) for (const s in round.teamScores[g]) for (const h in round.teamScores[g][s]) if (round.teamScores[g][s][h] != null) return true;
  return false;
}

/* ---- resolve one pairing into a match ---- */
export function resolvePairingMatch(state, round, pairing) {
  const course = state.courses[round.courseId];
  if (!course) return null;
  const holes = course.holes;
  const squadA = squadOfTeam(state, pairing.teamA);
  const squadB = squadOfTeam(state, pairing.teamB);
  let netsA, netsB, chA, chB;

  if (round.format === 'scramble') {
    const aPlayers = (pairing.teamA || []).map((pid) => chFor(state, state.players[pid], round));
    const bPlayers = (pairing.teamB || []).map((pid) => chFor(state, state.players[pid], round));
    chA = aPlayers.length >= 2 ? scrambleHandicap(aPlayers[0], aPlayers[1]) : (aPlayers[0] || 0);
    chB = bPlayers.length >= 2 ? scrambleHandicap(bPlayers[0], bPlayers[1]) : (bPlayers[0] || 0);
    netsA = scrambleNets(chA, holes, (h) => getTeamScore(round, pairing.id, 'A', h));
    netsB = scrambleNets(chB, holes, (h) => getTeamScore(round, pairing.id, 'B', h));
  } else {
    // singles & fourball (best-ball of the side; singles = best of 1)
    const pa = (pairing.teamA || []).map((pid) => ({ id: pid, courseHandicap: chFor(state, state.players[pid], round) }));
    const pb = (pairing.teamB || []).map((pid) => ({ id: pid, courseHandicap: chFor(state, state.players[pid], round) }));
    netsA = bestBallNets(pa, holes, (pid, h) => getScore(round, pid, h));
    netsB = bestBallNets(pb, holes, (pid, h) => getScore(round, pid, h));
  }
  const m = matchFromNets(netsA, netsB, holes.length);
  return { pairing, squadA, squadB, chA, chB, m };
}

/* ---- resolve a whole round ---- */
export function resolveRound(state, round) {
  const matches = [];
  const raw = {};
  Object.keys(state.squads).forEach((sid) => (raw[sid] = 0));
  let pointsAvailable = 0;
  const win = state.tournament.winPoints != null ? state.tournament.winPoints : 1;
  const tie = state.tournament.tiePoints != null ? state.tournament.tiePoints : 0.5;

  (round.pairings || []).forEach((pairing) => {
    const res = resolvePairingMatch(state, round, pairing);
    if (!res) return;
    pointsAvailable += 1;
    if (res.m.result === 'A') raw[res.squadA] = (raw[res.squadA] || 0) + win;
    else if (res.m.result === 'B') raw[res.squadB] = (raw[res.squadB] || 0) + win;
    else if (res.m.result === 'AS') {
      raw[res.squadA] = (raw[res.squadA] || 0) + tie;
      raw[res.squadB] = (raw[res.squadB] || 0) + tie;
    }
    matches.push(res);
  });

  // explicit weighting
  const mode = state.tournament.weightMode || 'true';
  const target = state.tournament.normalizeTarget || 4;
  const contribution = {};
  Object.keys(raw).forEach((sid) => {
    contribution[sid] = (mode === 'normalized' && pointsAvailable > 0)
      ? roundHalf((raw[sid] / pointsAvailable) * target)
      : raw[sid];
  });

  // status
  let status = round.status;
  if (!status || status === 'auto') {
    if (!roundHasScores(round)) status = 'upcoming';
    else status = matches.every((x) => x.m.result !== 'IP') && matches.length > 0 ? 'final' : 'live';
  }

  return { roundId: round.id, format: round.format, matches, raw, contribution, pointsAvailable, status, mode, normalizeTarget: target };
}

/* ---- full tournament standings ---- */
export function computeStandings(state) {
  const order = (state.tournament.roundOrder || []).filter((id) => state.rounds[id]);
  const rounds = order.map((id) => resolveRound(state, state.rounds[id]));

  const cup = {};
  Object.keys(state.squads).forEach((sid) => (cup[sid] = 0));

  const best = state.tournament.countBestNofM;
  if (best && best > 0 && best < rounds.length) {
    // sum each squad's best N round contributions
    Object.keys(cup).forEach((sid) => {
      const vals = rounds.map((r) => r.contribution[sid] || 0).sort((a, b) => b - a).slice(0, best);
      cup[sid] = vals.reduce((s, v) => s + v, 0);
    });
  } else {
    rounds.forEach((r) => Object.keys(cup).forEach((sid) => (cup[sid] += r.contribution[sid] || 0)));
  }

  const totalAvailable = rounds.reduce((s, r) => s + r.pointsAvailable, 0);
  const target = Math.floor(totalAvailable / 2) + 0.5;

  // clinch: leader has >= target, or lead exceeds points still unplayed
  const ids = Object.keys(cup).sort((a, b) => cup[b] - cup[a]);
  const leader = ids[0];
  const runnerUp = ids[1];
  const playedAvail = rounds.filter((r) => r.status === 'final').reduce((s, r) => s + r.pointsAvailable, 0);
  const remaining = totalAvailable - playedAvail;
  let clinched = null;
  if (leader != null && runnerUp != null) {
    const gap = cup[leader] - cup[runnerUp];
    if (cup[leader] >= target || gap > remaining) clinched = leader;
  } else if (leader != null && ids.length === 1) {
    if (cup[leader] >= target) clinched = leader;
  }

  return { cup, rounds, target, totalAvailable, clinched, leader, weightMode: state.tournament.weightMode || 'true' };
}

/* Per-player totals for a round (for stroke detail / My Card). */
export function playerRoundLine(state, round, playerId) {
  const course = state.courses[round.courseId];
  if (!course) return null;
  const p = state.players[playerId];
  const ch = chFor(state, p, round);
  return { ...playerRoundTotals(round.scores ? round.scores[playerId] : null, ch, course.holes), ch };
}
