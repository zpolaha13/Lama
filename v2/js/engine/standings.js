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
  courseHandicap, bestBallNets, scrambleNets, scrambleHandicap, strokesOnHole,
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

/* Did anyone enter any score in this round? Handles per-player scores, 2-sided
 * scramble teamScores (pairing -> A/B -> hole) AND team-scramble (squad -> hole). */
function roundHasScores(round) {
  if (round.scores) for (const pid in round.scores) for (const h in round.scores[pid]) if (round.scores[pid][h] != null) return true;
  if (round.teamScores) for (const k in round.teamScores) {
    const v = round.teamScores[k];
    for (const k2 in v) {
      const v2 = v[k2];
      if (v2 != null && typeof v2 === 'object') { for (const h in v2) if (v2[h] != null) return true; }
      else if (v2 != null) return true; // team-scramble: squad -> hole -> score
    }
  }
  return false;
}

/* Team-scramble (low net, N teams): each squad plays one ball; rank by net.
 * teamScores[squadId][holeIdx] = team gross. Returns ranked team rows. */
export function teamScrambleRound(state, round) {
  const course = state.courses[round.courseId];
  const holes = (course && course.holes) || [];
  const N = holes.length;
  const { allowance } = ruleHandicap(round);
  const teams = Object.keys(state.squads).map((sid) => {
    const members = Object.keys(state.players).filter((pid) => state.players[pid].squadId === sid).map((pid) => state.players[pid]);
    const ch = scrambleHandicap(members.map((p) => chFor(state, p, round)), allowance);
    let gross = 0, net = 0, thru = 0, toPar = 0;
    const ts = (round.teamScores && round.teamScores[sid]) || {};
    holes.forEach((hole, i) => {
      const g = ts[i];
      if (g == null || g === '' || isNaN(g)) return;
      thru++; gross += Number(g); toPar += Number(g) - hole.par;
      net += Number(g) - strokesOnHole(ch, hole.si, N);
    });
    const sq = state.squads[sid] || {};
    return { squadId: sid, name: sq.name || sid, color: sq.color || '#888', ch, members: members.length, gross, net, thru, toPar };
  });
  return { teams: rankTeams(teams), holes: N };
}

/* Rank teams by net (low wins); not-started teams sink to the bottom; ties share
 * a place. Adds .place and .behind (strokes behind the leader). */
function rankTeams(teams) {
  const out = teams.slice().sort((a, b) => (a.thru === 0) - (b.thru === 0) || a.net - b.net || a.gross - b.gross);
  const leader = out.find((t) => t.thru > 0);
  let place = 0, prevNet = null;
  out.forEach((t, i) => {
    if (t.thru === 0) { t.place = null; t.behind = null; return; }
    if (t.net !== prevNet) { place = i + 1; prevNet = t.net; }
    t.place = place;
    t.behind = leader ? t.net - leader.net : 0;
  });
  return out;
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
  return { pairing, squadA, squadB, chA, chB, hc, m, netsA, netsB };
}

/* Points a match awards to each side under a given scoring system.
 * system 'match'  : winner gets `win`, tie splits (classic Ryder-Cup).
 * system 'holes'  : each won hole = `holePoints` (halved hole splits it), plus
 *                   `matchPoints` for winning the overall match (tie splits).
 * `available` is the FULL points the match can yield (so the Tournament target
 * stays stable as holes fill in): holes mode = holePoints*holes + matchPoints. */
export function matchPoints(res, opts) {
  const o = opts || {};
  let a = 0, b = 0, available;
  if (o.system === 'holes') {
    const hp = o.holePoints != null ? Number(o.holePoints) : 0.5;
    const mp = o.matchPoints != null ? Number(o.matchPoints) : 1;
    const na = res.netsA || [], nb = res.netsB || [];
    const n = o.holeCount || Math.max(na.length, nb.length);
    for (let i = 0; i < n; i++) {
      const x = na[i], y = nb[i];
      if (x == null || y == null) continue;
      if (x < y) a += hp; else if (y < x) b += hp; else { a += hp / 2; b += hp / 2; }
    }
    if (res.m.result === 'A') a += mp; else if (res.m.result === 'B') b += mp;
    else if (res.m.result === 'AS') { a += mp / 2; b += mp / 2; }
    available = hp * n + mp;
  } else {
    const win = o.win != null ? Number(o.win) : 1;
    if (res.m.result === 'A') a = win; else if (res.m.result === 'B') b = win;
    else if (res.m.result === 'AS') { a = win / 2; b = win / 2; }
    available = win;
  }
  return { a, b, available };
}

/* ---- resolve a whole round ---- */
export function resolveRound(state, round) {
  if (round.format === 'teamscramble') {
    const tr = teamScrambleRound(state, round);
    let status = round.status;
    if (!status || status === 'auto') {
      status = !roundHasScores(round) ? 'upcoming'
        : (tr.holes > 0 && tr.teams.every((t) => t.thru === tr.holes)) ? 'final' : 'live';
    }
    return {
      roundId: round.id, format: 'teamscramble', teamScramble: tr, status,
      matches: [], raw: {}, contribution: {}, pointsAvailable: 0, availableWeighted: 0,
      mode: state.tournament.weightMode || 'true', pointSystem: 'leaderboard',
    };
  }
  const matches = [];
  const raw = {};
  Object.keys(state.squads).forEach((sid) => (raw[sid] = 0));
  let pointsAvailable = 0;
  // Scoring system for this round. 'match' = classic win/tie per match.
  // 'holes' = points per hole won + a bonus for the overall match (variable
  // total, scales with holes). Per-round override, else tournament default.
  const rule = round.scoringRule || {};
  const course = state.courses[round.courseId];
  const holeCount = course && course.holes ? course.holes.length : 18;
  const system = rule.pointSystem || 'match';
  const opts = {
    system,
    win: rule.pointsPerMatch != null ? Number(rule.pointsPerMatch)
      : (state.tournament.winPoints != null ? state.tournament.winPoints : 1),
    holePoints: rule.holePoints != null ? Number(rule.holePoints) : 0.5,
    matchPoints: rule.matchPoints != null ? Number(rule.matchPoints) : 1,
    holeCount,
  };

  (round.pairings || []).forEach((pairing) => {
    const res = resolvePairingMatch(state, round, pairing);
    if (!res) return;
    // A pairing whose sides don't resolve to two distinct real squads can't
    // award points to anyone — skip it so it doesn't leak into a phantom
    // "null" squad and deflate everyone's normalized share / the target.
    if (!res.squadA || !res.squadB || res.squadA === res.squadB) return;
    const pts = matchPoints(res, opts);
    pointsAvailable += pts.available;
    raw[res.squadA] = (raw[res.squadA] || 0) + pts.a;
    raw[res.squadB] = (raw[res.squadB] || 0) + pts.b;
    res.pts = pts; // { a, b, available } for the round leaderboard
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

  return { roundId: round.id, format: round.format, matches, raw, contribution, pointsAvailable, status, mode, normalizeTarget: target, pointSystem: system, holePoints: opts.holePoints, matchPoints: opts.matchPoints };
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

  // Team-scramble (stroke play): build an overall team leaderboard across all
  // team-scramble rounds. If every round is team-scramble, the tournament IS a
  // leaderboard, so the hero/standings show it instead of the 2-side cup.
  const tsRounds = rounds.filter((r) => r.format === 'teamscramble');
  let teamLeaderboard = null;
  const strokePlay = rounds.length > 0 && rounds.every((r) => r.format === 'teamscramble');
  if (tsRounds.length) {
    const agg = {};
    Object.keys(state.squads).forEach((sid) => {
      const sq = state.squads[sid] || {};
      agg[sid] = { squadId: sid, name: sq.name || sid, color: sq.color || '#888', gross: 0, net: 0, thru: 0, toPar: 0 };
    });
    tsRounds.forEach((r) => r.teamScramble.teams.forEach((t) => {
      const a = agg[t.squadId]; if (!a) return;
      a.gross += t.gross; a.net += t.net; a.thru += t.thru; a.toPar += t.toPar;
    }));
    teamLeaderboard = rankTeams(Object.values(agg));
  }

  return { cup, rounds, target, totalAvailable, clinched, leader, weightMode: state.tournament.weightMode || 'true', teamLeaderboard, strokePlay };
}

/* Per-player totals for a round (for stroke detail / My Card). */
export function playerRoundLine(state, round, playerId) {
  const course = state.courses[round.courseId];
  if (!course) return null;
  const p = state.players[playerId];
  const ch = chFor(state, p, round);
  return { ...playerRoundTotals(round.scores ? round.scores[playerId] : null, ch, course.holes), ch };
}
