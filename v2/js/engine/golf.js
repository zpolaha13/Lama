/* =========================================================================
 * engine/golf.js — Pure golf math (ESM). Ported verbatim from the v1 engine,
 * which is covered by tests. No DOM, no state.
 * ========================================================================= */

/* Course Handicap (WHS): Index × (Slope/113) + (Rating − Par). */
export function courseHandicap(index, slope, rating, par) {
  if (index == null || isNaN(index)) return 0;
  const s = Number(slope) || 113;
  let ch = index * (s / 113);
  if (rating != null && !isNaN(rating) && par != null && !isNaN(par)) {
    ch += Number(rating) - Number(par);
  }
  return Math.round(ch);
}

export function playingHandicap(courseHandicap, allowancePct) {
  const a = allowancePct == null ? 100 : Number(allowancePct);
  return Math.round(courseHandicap * (a / 100));
}

/* Strokes received on one hole (full-handicap allocation by stroke index). */
export function strokesOnHole(ch0, strokeIndex, holes) {
  const H = holes || 18;
  const ch = Math.round(ch0);
  if (!strokeIndex || strokeIndex < 1) return 0;
  if (ch >= 0) {
    const base = Math.floor(ch / H);
    const rem = ch % H;
    return base + (strokeIndex <= rem ? 1 : 0);
  }
  const a = -ch;
  const base = Math.floor(a / H);
  const rem = a % H;
  const giveBack = base + ((H - strokeIndex + 1) <= rem ? 1 : 0);
  return -giveBack;
}

export function totalStrokes(ch, holeList) {
  return holeList.reduce((s, h) => s + strokesOnHole(ch, h.si, holeList.length), 0);
}

export function netOnHole(gross, ch, si, holes) {
  if (gross == null || gross === '' || isNaN(gross)) return null;
  return Number(gross) - strokesOnHole(ch, si, holes);
}

/* Round totals for a player. scores: { holeIdx: gross }. */
export function playerRoundTotals(scores, ch, holes) {
  let gross = 0, net = 0, played = 0, toPar = 0;
  const perHoleNet = [];
  holes.forEach((hole, i) => {
    const g = scores ? scores[i] : null;
    if (g == null || g === '' || isNaN(g)) { perHoleNet.push(null); return; }
    played++;
    gross += Number(g);
    const n = Number(g) - strokesOnHole(ch, hole.si, holes.length);
    net += n;
    toPar += Number(g) - hole.par;
    perHoleNet.push(n);
  });
  return { gross, net, played, toPar, perHoleNet, courseHandicap: ch };
}

export function stablefordHole(net, par) {
  if (net == null) return 0;
  return Math.max(0, 2 + (par - net));
}

/* Best-ball nets: side hole value = lowest net among its players (null if none). */
export function bestBallNets(players, holes, getScore) {
  return holes.map((hole, i) => {
    let best = null;
    players.forEach((p) => {
      const g = getScore(p.id, i);
      if (g == null || g === '' || isNaN(g)) return;
      const net = Number(g) - strokesOnHole(p.courseHandicap, hole.si, holes.length);
      if (best == null || net < best) best = net;
    });
    return best;
  });
}

/* Scramble nets: one team gross per hole minus team strokes. */
export function scrambleNets(teamHandicap, holes, getTeamScore) {
  return holes.map((hole, i) => {
    const g = getTeamScore(i);
    if (g == null || g === '' || isNaN(g)) return null;
    return Number(g) - strokesOnHole(teamHandicap, hole.si, holes.length);
  });
}

/* Scramble TEAM handicap from each member's (raw) course handicap.
 * USGA recommended allowances by team size, applied to the sorted handicaps
 * (lowest/best first): 2-player 35/15, 3-player 30/20/10, 4-player 25/20/15/10.
 * `allowancePct` (default 100) scales the whole blend if a group wants fewer
 * strokes. Rounds ONCE so there's a single clean total team handicap.
 * Accepts an array of course handicaps (preferred) or legacy positional args. */
export function scrambleHandicap(chs, allowancePct) {
  const list = (Array.isArray(chs) ? chs : [chs]).filter((x) => x != null && !isNaN(x)).map(Number);
  if (!list.length) return 0;
  const pct = (allowancePct == null ? 100 : Number(allowancePct)) / 100;
  if (list.length === 1) return Math.round(list[0] * pct);
  const sorted = list.slice().sort((a, b) => a - b); // lowest (best) first
  const W = { 2: [0.35, 0.15], 3: [0.30, 0.20, 0.10], 4: [0.25, 0.20, 0.15, 0.10] }[sorted.length] || [0.35, 0.15];
  let sum = 0;
  for (let i = 0; i < sorted.length && i < W.length; i++) sum += W[i] * sorted[i];
  return Math.round(sum * pct);
}

/* Resolve a match from two net-per-hole arrays.
 * result: 'A' | 'B' | 'AS' | 'IP'. status is A-minus-B. */
export function matchFromNets(netsA, netsB, holesCount) {
  let status = 0, played = 0;
  const line = [];
  for (let i = 0; i < netsA.length; i++) {
    if (netsA[i] == null || netsB[i] == null) { line.push(status); continue; }
    played++;
    if (netsA[i] < netsB[i]) status++;
    else if (netsB[i] < netsA[i]) status--;
    line.push(status);
  }
  const H = holesCount || netsA.length;
  const remaining = H - played;
  let result;
  if (played === 0) result = 'IP';
  else if (Math.abs(status) > remaining) result = status > 0 ? 'A' : 'B';
  else if (played >= H) result = status > 0 ? 'A' : status < 0 ? 'B' : 'AS';
  else result = 'IP';
  return { status, played, remaining, line, result };
}

/* Human-readable match state: "3 & 2", "1 UP", "AS thru 12". */
export function matchText(m, nameA, nameB) {
  if (m.played === 0) return 'Not started';
  const leader = m.status > 0 ? nameA : nameB;
  if (m.result === 'A' || m.result === 'B') {
    if (m.remaining > 0) return leader + ' won ' + Math.abs(m.status) + ' & ' + m.remaining;
    return leader + ' won ' + Math.abs(m.status) + ' UP';
  }
  if (m.result === 'AS') return 'Halved (AS)';
  if (m.status === 0) return 'All square thru ' + m.played;
  return leader + ' ' + Math.abs(m.status) + ' UP thru ' + m.played;
}

/* Short status tag for a leaderboard cell, e.g. "Red 3&2", "Blue 2 UP", "AS thru 7". */
export function matchTag(m, labelA, labelB) {
  if (m.played === 0) return '—';
  if (m.result === 'A' || m.result === 'B') {
    const who = m.result === 'A' ? labelA : labelB;
    if (m.remaining > 0) return who + ' ' + Math.abs(m.status) + ' & ' + m.remaining;
    return who + ' ' + Math.abs(m.status) + ' UP';
  }
  if (m.result === 'AS') return m.played >= (m.played + m.remaining) ? 'Halved' : 'AS thru ' + m.played;
  if (m.status === 0) return 'AS thru ' + m.played;
  return (m.status > 0 ? labelA : labelB) + ' ' + Math.abs(m.status) + ' UP thru ' + m.played;
}

/* Skins. players: [{id, name, courseHandicap}].
 * opts.mode: 'net' | 'gross' (how each hole is scored)
 * opts.tie:  'rollover' (tie carries the skin to the next hole)
 *          | 'split'    (tie splits that hole's skin among the tied players)
 * Returns skinsByPlayer (may be fractional in split mode) and per-hole results. */
export function computeSkins(players, holes, getScore, opts) {
  const mode = (opts && opts.mode) || 'net';
  // back-compat: opts.carryover === false meant "no carry"; default to rollover
  const tie = (opts && opts.tie) || (opts && opts.carryover === false ? 'split' : 'rollover');
  const results = [];
  const skinsByPlayer = {};
  let carry = 0;
  holes.forEach((hole, i) => {
    const vals = [];
    players.forEach((p) => {
      const g = getScore(p.id, i);
      if (g == null || g === '' || isNaN(g)) return;
      const score = mode === 'gross' ? Number(g)
        : Number(g) - strokesOnHole(p.courseHandicap, hole.si, holes.length);
      vals.push({ id: p.id, score });
    });
    if (vals.length === 0) { results.push({ holeIndex: i, winnerIds: [], value: 0, played: false }); return; }
    const best = Math.min(...vals.map((v) => v.score));
    const winners = vals.filter((v) => v.score === best);
    const pot = 1 + carry;
    if (winners.length === 1) {
      const wid = winners[0].id;
      skinsByPlayer[wid] = (skinsByPlayer[wid] || 0) + pot;
      results.push({ holeIndex: i, winnerIds: [wid], value: pot, best, tie: false, played: true });
      carry = 0;
    } else if (tie === 'split') {
      const share = pot / winners.length;
      winners.forEach((w) => { skinsByPlayer[w.id] = (skinsByPlayer[w.id] || 0) + share; });
      results.push({ holeIndex: i, winnerIds: winners.map((w) => w.id), value: pot, best, tie: true, split: true, played: true });
      carry = 0;
    } else { // rollover
      results.push({ holeIndex: i, winnerIds: [], value: 0, best, tie: true, carried: true, played: true });
      carry = pot;
    }
  });
  let totalSkins = 0;
  Object.values(skinsByPlayer).forEach((n) => (totalSkins += n));
  return { results, skinsByPlayer, totalSkins, leftoverCarry: carry, mode, tie };
}

export function skinsPayouts(buyIn, players, skinsByPlayer, totalSkins) {
  const pot = (Number(buyIn) || 0) * players.length;
  const perSkin = totalSkins > 0 ? pot / totalSkins : 0;
  const payouts = {};
  players.forEach((p) => { payouts[p.id] = (skinsByPlayer[p.id] || 0) * perSkin; });
  return { pot, perSkin, payouts };
}

export function placePayouts(pot, ranked, places, scoreKey) {
  const payouts = {};
  ranked.forEach((r) => (payouts[r.id] = 0));
  if (!ranked.length) return payouts;
  let i = 0;
  while (i < ranked.length && i < places.length) {
    let j = i;
    while (j + 1 < ranked.length && scoreKey(ranked[j + 1]) === scoreKey(ranked[i])) j++;
    let shareSum = 0;
    for (let k = i; k <= j && k < places.length; k++) shareSum += places[k];
    const each = (shareSum * pot) / (j - i + 1);
    for (let k = i; k <= j; k++) payouts[ranked[k].id] = each;
    i = j + 1;
  }
  return payouts;
}

export function money(n) {
  return '$' + (Math.round((Number(n) || 0) * 100) / 100).toFixed(2);
}

export function roundHalf(x) { return Math.round(x * 2) / 2; }
