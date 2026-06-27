/* =========================================================================
 * golf.js — Pure golf math. No DOM, no state. Fully unit-testable.
 *
 * Handles:
 *   - Course Handicap from Handicap Index + tee Slope/Rating (WHS formula)
 *   - Per-hole stroke allocation (full handicap, by stroke index)
 *   - Net scoring
 *   - Skins (gross/net, with carryover)
 *   - Match play points (singles & team)
 *   - Stableford points
 *   - Payout distribution
 * ========================================================================= */

(function (global) {
  'use strict';

  const Golf = {};

  /* ----------------------------------------------------------------------
   * Course Handicap
   * WHS: CH = Index × (Slope / 113) + (Course Rating − Par)
   * Falls back gracefully if rating/par missing.
   * --------------------------------------------------------------------- */
  Golf.courseHandicap = function (index, slope, rating, par) {
    if (index == null || isNaN(index)) return 0;
    const s = Number(slope) || 113;
    let ch = index * (s / 113);
    if (rating != null && !isNaN(rating) && par != null && !isNaN(par)) {
      ch += Number(rating) - Number(par);
    }
    return Math.round(ch);
  };

  /* ----------------------------------------------------------------------
   * Playing Handicap = Course Handicap × allowance%  (default 100%)
   * Used for formats that apply an allowance (e.g. 85% fourball).
   * --------------------------------------------------------------------- */
  Golf.playingHandicap = function (courseHandicap, allowancePct) {
    const a = allowancePct == null ? 100 : Number(allowancePct);
    return Math.round(courseHandicap * (a / 100));
  };

  /* ----------------------------------------------------------------------
   * Strokes received on a single hole given a course handicap, the hole's
   * stroke index (1 = hardest), and the number of holes in the allocation.
   *
   * Full-handicap allocation: every player gets ALL their strokes spread
   * across the holes by difficulty.
   *   - Positive handicap: strokes fall on lowest stroke-index holes first;
   *     handicaps > #holes loop around (a second stroke on the hardest).
   *   - Plus handicap (negative): strokes are GIVEN BACK starting on the
   *     easiest holes (highest stroke index).
   * --------------------------------------------------------------------- */
  Golf.strokesOnHole = function (courseHandicap, strokeIndex, holes) {
    const H = holes || 18;
    const ch = Math.round(courseHandicap);
    if (!strokeIndex || strokeIndex < 1) return 0;

    if (ch >= 0) {
      const base = Math.floor(ch / H);
      const rem = ch % H;
      return base + (strokeIndex <= rem ? 1 : 0);
    } else {
      const a = -ch;
      const base = Math.floor(a / H);
      const rem = a % H;
      // give back on easiest holes first (SI H, H-1, ...)
      const giveBack = base + ((H - strokeIndex + 1) <= rem ? 1 : 0);
      return -giveBack;
    }
  };

  /* Total strokes a player receives over a set of holes. */
  Golf.totalStrokes = function (courseHandicap, holeList) {
    return holeList.reduce(
      (sum, h) => sum + Golf.strokesOnHole(courseHandicap, h.si, holeList.length),
      0
    );
  };

  /* Net score on a hole. gross may be null (not entered yet). */
  Golf.netOnHole = function (gross, courseHandicap, strokeIndex, holes) {
    if (gross == null || gross === '' || isNaN(gross)) return null;
    return Number(gross) - Golf.strokesOnHole(courseHandicap, strokeIndex, holes);
  };

  /* ----------------------------------------------------------------------
   * Round totals for a player.
   * scores: { holeIndex(0-based): grossStrokes }
   * holes:  [{ par, si }]
   * Returns gross/net totals plus per-hole net array.
   * --------------------------------------------------------------------- */
  Golf.playerRoundTotals = function (scores, courseHandicap, holes) {
    let gross = 0,
      net = 0,
      played = 0,
      toPar = 0;
    const perHoleNet = [];
    holes.forEach((hole, i) => {
      const g = scores ? scores[i] : null;
      if (g == null || g === '' || isNaN(g)) {
        perHoleNet.push(null);
        return;
      }
      played++;
      gross += Number(g);
      const strokes = Golf.strokesOnHole(courseHandicap, hole.si, holes.length);
      const n = Number(g) - strokes;
      net += n;
      toPar += Number(g) - hole.par;
      perHoleNet.push(n);
    });
    return { gross, net, played, toPar, perHoleNet, courseHandicap };
  };

  /* ----------------------------------------------------------------------
   * Stableford points for a hole.
   * Net double bogey = 0, net bogey = 1, par = 2, birdie = 3, etc.
   * --------------------------------------------------------------------- */
  Golf.stablefordHole = function (net, par) {
    if (net == null) return 0;
    const diff = par - net; // positive = better than par
    return Math.max(0, 2 + diff);
  };

  /* ----------------------------------------------------------------------
   * Skins.
   * players: [{ id, name, courseHandicap }]
   * getScore(playerId, holeIndex) -> gross or null
   * opts: { mode: 'net'|'gross', carryover: bool }
   * Returns:
   *   { results: [{ holeIndex, winnerId|null, value, carried, best, tie }],
   *     skinsByPlayer: { playerId: countOfSkins },
   *     totalSkins }
   * "value" is in skin-units (1 per hole, accumulates on carryover).
   * --------------------------------------------------------------------- */
  Golf.computeSkins = function (players, holes, getScore, opts) {
    const mode = (opts && opts.mode) || 'net';
    const carryover = opts && opts.carryover;
    const results = [];
    const skinsByPlayer = {};
    let carry = 0;

    holes.forEach((hole, i) => {
      const vals = [];
      players.forEach((p) => {
        const g = getScore(p.id, i);
        if (g == null || g === '' || isNaN(g)) return;
        const score =
          mode === 'gross'
            ? Number(g)
            : Number(g) - Golf.strokesOnHole(p.courseHandicap, hole.si, holes.length);
        vals.push({ id: p.id, score });
      });

      if (vals.length === 0) {
        results.push({ holeIndex: i, winnerId: null, value: 0, carried: false, best: null, tie: false, played: false });
        return;
      }

      const best = Math.min(...vals.map((v) => v.score));
      const winners = vals.filter((v) => v.score === best);
      const potThisHole = 1 + carry;

      if (winners.length === 1) {
        const wid = winners[0].id;
        skinsByPlayer[wid] = (skinsByPlayer[wid] || 0) + potThisHole;
        results.push({ holeIndex: i, winnerId: wid, value: potThisHole, carried: false, best, tie: false, played: true });
        carry = 0;
      } else {
        // tie -> carry over if enabled, else no skin awarded
        results.push({ holeIndex: i, winnerId: null, value: 0, carried: carryover, best, tie: true, played: true });
        carry = carryover ? potThisHole : 0;
      }
    });

    let totalSkins = 0;
    Object.values(skinsByPlayer).forEach((n) => (totalSkins += n));
    return { results, skinsByPlayer, totalSkins, leftoverCarry: carry };
  };

  /* ----------------------------------------------------------------------
   * Singles match play (net) between two players.
   * Returns hole-by-hole status and the match result.
   * status: + = playerA up, - = playerB up, in holes.
   * --------------------------------------------------------------------- */
  Golf.singlesMatch = function (a, b, holes, getScore) {
    let status = 0; // A relative to B
    let holesPlayed = 0;
    const line = [];
    holes.forEach((hole, i) => {
      const ga = getScore(a.id, i);
      const gb = getScore(b.id, i);
      if (ga == null || gb == null || isNaN(ga) || isNaN(gb)) {
        line.push(0);
        return;
      }
      holesPlayed++;
      const na = Number(ga) - Golf.strokesOnHole(a.courseHandicap, hole.si, holes.length);
      const nb = Number(gb) - Golf.strokesOnHole(b.courseHandicap, hole.si, holes.length);
      if (na < nb) status++;
      else if (nb < na) status--;
      line.push(status);
    });
    const remaining = holes.length - holesPlayed;
    let result;
    if (Math.abs(status) > remaining && holesPlayed === holes.length) {
      result = status > 0 ? 'A' : status < 0 ? 'B' : 'AS';
    } else if (holesPlayed === holes.length) {
      result = status > 0 ? 'A' : status < 0 ? 'B' : 'AS';
    } else {
      result = 'IP'; // in progress
    }
    return { status, holesPlayed, remaining, line, result };
  };

  /* ----------------------------------------------------------------------
   * Team match play (fourball / best ball / scramble).
   *
   * These build a "net per hole" array for each side, then resolve the match.
   * A side's hole value is null until it has a usable score that hole.
   * --------------------------------------------------------------------- */

  /* Best-ball (fourball): a side's hole score is the LOWEST net among its
   * players. players: [{ id, courseHandicap }]. Singles is just a 1-player side. */
  Golf.bestBallNets = function (players, holes, getScore) {
    return holes.map((hole, i) => {
      let best = null;
      players.forEach((p) => {
        const g = getScore(p.id, i);
        if (g == null || g === '' || isNaN(g)) return;
        const net = Number(g) - Golf.strokesOnHole(p.courseHandicap, hole.si, holes.length);
        if (best == null || net < best) best = net;
      });
      return best;
    });
  };

  /* Scramble: one team gross per hole, minus the team's strokes. */
  Golf.scrambleNets = function (teamHandicap, holes, getTeamScore) {
    return holes.map((hole, i) => {
      const g = getTeamScore(i);
      if (g == null || g === '' || isNaN(g)) return null;
      return Number(g) - Golf.strokesOnHole(teamHandicap, hole.si, holes.length);
    });
  };

  /* 2-person scramble handicap: 35% of low + 15% of high (USGA recommendation). */
  Golf.scrambleHandicap = function (chLowFirst, chOther) {
    const low = Math.min(chLowFirst, chOther);
    const high = Math.max(chLowFirst, chOther);
    return Math.round(0.35 * low + 0.15 * high);
  };

  /* Resolve a match from two net-per-hole arrays.
   * Returns { status (A minus B), played, remaining, line, result }.
   * result: 'A' | 'B' | 'AS' | 'IP' (in progress). */
  Golf.matchFromNets = function (netsA, netsB, holesCount) {
    let status = 0,
      played = 0;
    const line = [];
    for (let i = 0; i < netsA.length; i++) {
      if (netsA[i] == null || netsB[i] == null) {
        line.push(status);
        continue;
      }
      played++;
      if (netsA[i] < netsB[i]) status++;
      else if (netsB[i] < netsA[i]) status--;
      line.push(status);
    }
    const H = holesCount || netsA.length;
    const remaining = H - played;
    let result;
    if (played === 0) result = 'IP';
    else if (Math.abs(status) > remaining) result = status > 0 ? 'A' : 'B'; // closed out
    else if (played >= H) result = status > 0 ? 'A' : status < 0 ? 'B' : 'AS';
    else result = 'IP';
    return { status, played, remaining, line, result };
  };

  /* Human-readable match state, e.g. "3 & 2", "1 UP", "AS thru 12". */
  Golf.matchText = function (m, nameA, nameB) {
    if (m.played === 0) return 'Not started';
    const leader = m.status > 0 ? nameA : nameB;
    if (m.result === 'A' || m.result === 'B') {
      if (m.remaining > 0) return leader + ' won ' + Math.abs(m.status) + ' & ' + m.remaining;
      return leader + ' won ' + Math.abs(m.status) + ' UP';
    }
    if (m.result === 'AS') return 'Halved (AS)';
    // in progress
    if (m.status === 0) return 'All square thru ' + m.played;
    return leader + ' ' + Math.abs(m.status) + ' UP thru ' + m.played;
  };

  /* ----------------------------------------------------------------------
   * Payout distribution helpers.
   * --------------------------------------------------------------------- */

  /* Skins pot: pot split evenly per skin won. */
  Golf.skinsPayouts = function (buyIn, players, skinsByPlayer, totalSkins) {
    const pot = (Number(buyIn) || 0) * players.length;
    const perSkin = totalSkins > 0 ? pot / totalSkins : 0;
    const payouts = {};
    players.forEach((p) => {
      const n = skinsByPlayer[p.id] || 0;
      payouts[p.id] = n * perSkin;
    });
    return { pot, perSkin, payouts };
  };

  /* Place-based pot: distribute by percentage list to ranked players.
   * ranked: [{ id }] best first. places: [0.6, 0.3, 0.1] etc.
   * Ties split the combined share of the places they occupy. */
  Golf.placePayouts = function (pot, ranked, places, scoreKey) {
    const payouts = {};
    ranked.forEach((r) => (payouts[r.id] = 0));
    if (!ranked.length) return payouts;

    let i = 0;
    while (i < ranked.length && i < places.length) {
      // group ties on scoreKey
      let j = i;
      while (
        j + 1 < ranked.length &&
        scoreKey(ranked[j + 1]) === scoreKey(ranked[i])
      ) {
        j++;
      }
      // sum the place percentages spanned by this tie group
      let shareSum = 0;
      for (let k = i; k <= j && k < places.length; k++) shareSum += places[k];
      const each = (shareSum * pot) / (j - i + 1);
      for (let k = i; k <= j; k++) payouts[ranked[k].id] = each;
      i = j + 1;
    }
    return payouts;
  };

  /* Round helper. */
  Golf.money = function (n) {
    return '$' + (Math.round((Number(n) || 0) * 100) / 100).toFixed(2);
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = Golf;
  else global.Golf = Golf;
})(typeof window !== 'undefined' ? window : this);
