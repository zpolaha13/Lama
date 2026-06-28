/* =========================================================================
 * engine/standings.js — Pure tournament model. Turns raw scores into:
 *   - per-round match results + points (Ryder-Cup: 1 win / 0.5 tie)
 *   - per-round squad points (raw + weighted contribution)
 *   - the overall Tournament total, target, and clinch state
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

/* Resolve which tee a player plays in a round:
 * per-player override → round's default tee → player's default → course's first tee. */
export function resolveTeeId(state, player, round) {
  const course = state.courses[round.courseId];
  if (!course || !course.tees) return null;
  let teeId = (round.teeOverrides && round.teeOverrides[player.id]) || round.defaultTeeId || (player && player.defaultTeeId);
  if (!teeId || !course.tees[teeId]) teeId = Object.keys(course.tees)[0] || null;
  return teeId;
}

/* Course handicap for a player in a round (uses the resolved tee's slope/rating). */
export function chFor(state, player, round) {
  const course = state.courses[round.courseId];
  if (!course || !player) return 0;
  const tee = course.tees ? course.tees[resolveTeeId(state, player, round)] : null;
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

/* ---- handicap allowance / basis ----
 * round.scoringRule.handicapAllowance: percent applied to each course handicap (default 100).
 * round.scoringRule.handicapMode: 'absolute' (each off their own) | 'relative' (off the low
 *   player in the match — lowest plays scratch, others get the difference). */
export function ruleHandicap(round) {
  const r = round.scoringRule || {};
  return {
    allowance: r.handicapAllowance == null ? 100 : Number(r.handicapAllowance),
    mode: r.handicapMode || 'absolute',
  };
}
export function effectiveCH(state, player, round) {
  const { allowance } = ruleHandicap(round);
  return Math.round(chFor(state, player, round) * (allowance / 100));
}

/* Effective playing handicaps for everyone in a match, honoring allowance + basis.
 * For 'relative', strokes are shifted so the lowest in the match plays off scratch. */
export function matchHandicaps(state, round, pairing) {
  const { mode, allowance } = ruleHandicap(round);
  if (round.format === 'scramble') {
    // One total team handicap = USGA scramble blend of each side's RAW course
    // handicaps (allowance applied once to the blend, NOT per player — the
    // 35/15 weighting IS the scramble allowance, so don't double-discount).
    const teamCH = (ids) => scrambleHandicap(
      (ids || []).map((pid) => state.players[pid]).filter(Boolean).map((p) => chFor(state, p, round)),
      allowance,
    );
    let chA = teamCH(pairing.teamA);
    let chB = teamCH(pairing.teamB);
    if (mode === 'relative') { const m = Math.min(chA, chB); chA -= m; chB -= m; }
    return { scramble: true, teamA: chA, teamB: chB, byPlayer: {} };
  }
  const all = [...(pairing.teamA || []), ...(pairing.teamB || [])];
  const eff = {};
  all.forEach((pid) => { eff[pid] = effectiveCH(state, state.players[pid], round); });
  const shift = (mode === 'relative' && all.length) ? Math.min(...all.map((pid) => eff[pid])) : 0;
  const byPlayer = {};
  all.forEach((pid) => { byPlayer[pid] = eff[pid] - shift; });
  return { scramble: false, byPlayer };
}

/* ---- resolve one pairing into a match ---- */
export function resolvePairingMatch(state, round, pairing) {
  const course = state.courses[round.courseId];
  if (!course) return null;
  const holes = course.holes;
  const squadA = squadOfTeam(state, pairing.teamA);
  const squadB = squadOfTeam(state, pairing.teamB);
  const hc = matchHandicaps(state, round, pairing);
  let netsA, netsB, chA, chB;

  if (round.format === 'scramble') {
    chA = hc.teamA; chB = hc.teamB;
    netsA = scrambleNets(chA, holes, (h) => getTeamScore(round, pairing.id, 'A', h));
    netsB = scrambleNets(chB, holes, (h) => getTeamScore(round, pairing.id, 'B', h));
  } else {
    const pa = (pairing.teamA || []).map((pid) => ({ id: pid, courseHandicap: hc.byPlayer[pid] || 0 }));
    const pb = (pairing.teamB || []).map((pid) => ({ id: pid, courseHandicap: hc.byPlayer[pid] || 0 }));
    netsA = bestBallNets(pa, holes, (pid, h) => getScore(round, pid, h));
    netsB = bestBallNets(pb, holes, (pid, h) => getScore(round, pid, h));
  }
  const m = matchFromNets(netsA, netsB, holes.length);
  return { pairing, squadA, squadB, chA, chB, hc, m };
}

/* ---- resolve a whole round ---- */
export function resolveRound(state, round) {
  const matches = [];
  const raw = {};
  Object.keys(state.squads).forEach((sid) => (raw[sid] = 0));
  let pointsAvailable = 0;
  // points awarded for winning a match in this round (tie = half). Per-round override,
  // else tournament default, else 1.
  const rule = round.scoringRule || {};
  const win = rule.pointsPerMatch != null ? Number(rule.pointsPerMatch)
    : (state.tournament.winPoints != null ? state.tournament.winPoints : 1);
  const tie = win / 2;

  (round.pairings || []).forEach((pairing) => {
    const res = resolvePairingMatch(state, round, pairing);
    if (!res) return;
    // A pairing whose sides don't resolve to two distinct real squads can't
    // award points to anyone — skip it so it doesn't leak into a phantom
    // "null" squad and deflate everyone's normalized share / the target.
    if (!res.squadA || !res.squadB || res.squadA === res.squadB) return;
    pointsAvailable += win;
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

  // Points actually in play per round must match how they're SCORED. Under
  // equal-weight every round distributes `normalizeTarget` points (not its raw
  // match count), so the target/clinch math has to use the weighted figure too
  // — otherwise "first to N" ignores the number you set.
  const mode = state.tournament.weightMode || 'true';
  const normTarget = state.tournament.normalizeTarget || 4;
  const roundAvail = (r) => (mode === 'normalized' ? (r.pointsAvailable > 0 ? normTarget : 0) : r.pointsAvailable);
  const availList = rounds.map(roundAvail);
  rounds.forEach((r, i) => { r.availableWeighted = availList[i]; }); // what each round is worth toward the Tournament
  const totalAvailable = (best && best > 0 && best < rounds.length)
    ? availList.slice().sort((a, b) => b - a).slice(0, best).reduce((s, v) => s + v, 0)
    : availList.reduce((s, v) => s + v, 0);
  const target = Math.floor(totalAvailable / 2) + 0.5;

  // clinch: leader has >= target, or lead exceeds points still unplayed
  const ids = Object.keys(cup).sort((a, b) => cup[b] - cup[a]);
  const leader = ids[0];
  const runnerUp = ids[1];
  const playedAvail = rounds.reduce((s, r) => s + (r.status === 'final' ? roundAvail(r) : 0), 0);
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
