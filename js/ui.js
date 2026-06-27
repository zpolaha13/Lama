/* =========================================================================
 * ui.js — Rendering + interaction for the Golf Trip app.
 *
 * Architecture:
 *   - One render() entry point dispatches to a per-tab renderer.
 *   - Event delegation on #view: data-action attributes drive handlers.
 *   - Store.update() mutates state, persists, and triggers re-render.
 *   - Score inputs commit on "change" (blur/enter) to avoid focus loss.
 * ========================================================================= */

(function () {
  'use strict';

  const view = document.getElementById('view');
  const FORMATS = [
    { id: 'match_singles', name: '1v1 Match Play' },
    { id: 'fourball', name: '2v2 Best Ball Match' },
    { id: 'scramble', name: '2v2 Texas Scramble Match' },
    { id: 'stroke_net', name: 'Stroke Play — Net' },
    { id: 'stroke_gross', name: 'Stroke Play — Gross' },
    { id: 'stableford', name: 'Stableford (Net)' },
  ];
  const MATCH_FORMATS = ['match_singles', 'fourball', 'scramble'];
  function isMatch(f) { return MATCH_FORMATS.indexOf(f) >= 0; }

  const ui = {
    tab: 'leaderboard',
    roundId: null, // selected round for score/cards
    groupId: null, // selected group for score
  };

  /* ---------------- tiny helpers ---------------- */
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"]/g, (c) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])
    );
  }
  function S() { return Store.get(); }
  function byId(arr, id) { return (arr || []).find((x) => x.id === id); }
  function course(id) { return byId(S().courses, id); }
  function team(id) { return byId(S().teams, id); }
  function player(id) { return byId(S().players, id); }
  function round(id) { return byId(S().rounds, id); }
  function coursePar(c) { return (c && c.holes ? c.holes.reduce((s, h) => s + (Number(h.par) || 0), 0) : 0); }
  function teeOf(c, teeId) {
    if (!c) return null;
    return byId(c.tees, teeId) || (c.tees && c.tees[0]) || null;
  }
  function fmtName(id) { const f = FORMATS.find((x) => x.id === id); return f ? f.name : id || '—'; }
  function fmtToPar(n) {
    if (n === 0) return 'E';
    return n > 0 ? '+' + n : String(n);
  }

  /* Course handicap for a player in a given round (resolves tee + overrides). */
  function chFor(p, r, grp) {
    if (!p || !r) return 0;
    const c = course(r.courseId);
    if (!c) return 0;
    let teeId = p.defaultTeeId;
    if (grp && grp.teeOverrides && grp.teeOverrides[p.id]) teeId = grp.teeOverrides[p.id];
    const tee = teeOf(c, teeId);
    const slope = tee ? tee.slope : 113;
    const rating = tee ? tee.rating : null;
    return Golf.courseHandicap(Number(p.index) || 0, slope, rating, coursePar(c));
  }

  /* all players assigned to a round (across its groups), de-duplicated */
  function roundPlayers(r) {
    const ids = [];
    (r.groups || []).forEach((g) => (g.playerIds || []).forEach((pid) => { if (ids.indexOf(pid) < 0) ids.push(pid); }));
    return ids.map(player).filter(Boolean);
  }

  function getScore(r, pid, h) {
    return r && r.scores && r.scores[pid] ? r.scores[pid][h] : null;
  }
  function getTeamScore(r, gid, tid, h) {
    return r && r.teamScores && r.teamScores[gid] && r.teamScores[gid][tid] ? r.teamScores[gid][tid][h] : null;
  }

  /* Split a group's players into the two teams present, in team order. */
  function sidesForGroup(g) {
    const map = {};
    (g.playerIds || []).forEach((pid) => {
      const p = player(pid);
      if (!p || !p.teamId) return;
      (map[p.teamId] = map[p.teamId] || []).push(p);
    });
    // order by S().teams order for stable display
    return S().teams.filter((t) => map[t.id]).map((t) => ({ team: t, players: map[t.id] }));
  }

  /* Scramble team handicap for a side (uses 35%/15% for a pair). */
  function scrambleHC(side, r, g) {
    const chs = side.players.map((p) => chFor(p, r, g));
    if (chs.length === 0) return 0;
    if (chs.length === 1) return chs[0];
    return Golf.scrambleHandicap(chs[0], chs[1]);
  }

  /* Resolve the match in a group for its round's format. Returns null if the
   * group isn't a valid 2-side match. { sides:[{team,ch}], m } */
  function matchForGroup(r, g, c) {
    const sides = sidesForGroup(g);
    if (sides.length !== 2) return null;
    const [A, B] = sides;
    let netsA, netsB, chA, chB;
    if (r.format === 'scramble') {
      chA = scrambleHC(A, r, g);
      chB = scrambleHC(B, r, g);
      netsA = Golf.scrambleNets(chA, c.holes, (h) => getTeamScore(r, g.id, A.team.id, h));
      netsB = Golf.scrambleNets(chB, c.holes, (h) => getTeamScore(r, g.id, B.team.id, h));
    } else {
      const pa = A.players.map((p) => ({ id: p.id, courseHandicap: chFor(p, r, g) }));
      const pb = B.players.map((p) => ({ id: p.id, courseHandicap: chFor(p, r, g) }));
      netsA = Golf.bestBallNets(pa, c.holes, (pid, h) => getScore(r, pid, h));
      netsB = Golf.bestBallNets(pb, c.holes, (pid, h) => getScore(r, pid, h));
    }
    const m = Golf.matchFromNets(netsA, netsB, c.holes.length);
    return { sides: [{ team: A.team, ch: chA }, { team: B.team, ch: chB }], A, B, m };
  }

  /* =======================================================================
   * RENDER DISPATCH
   * ===================================================================== */
  function render() {
    const st = S();
    document.getElementById('tripName').textContent = st.meta.name || 'Golf Trip';
    const sync = document.getElementById('syncStatus');
    if (Store.online) { sync.textContent = '● Live sync'; sync.className = 'sync sync-live'; }
    else { sync.textContent = '● Local (no sync)'; sync.className = 'sync sync-local'; }
    document.querySelectorAll('#tabs button').forEach((b) =>
      b.classList.toggle('active', b.dataset.tab === ui.tab));
    document.getElementById('footerInfo').textContent =
      st.players.length + ' players · ' + st.rounds.length + ' rounds · ' +
      st.courses.length + ' courses';

    let html = '';
    switch (ui.tab) {
      case 'leaderboard': html = renderLeaderboard(); break;
      case 'score': html = renderScore(); break;
      case 'skins': html = renderSkins(); break;
      case 'payouts': html = renderPayouts(); break;
      case 'rounds': html = renderRounds(); break;
      case 'cards': html = renderCards(); break;
      case 'setup': html = renderSetup(); break;
    }
    view.innerHTML = html;
  }

  function needSetupMsg(what) {
    return '<div class="card"><div class="empty">No ' + what +
      ' yet. Head to <b>Setup</b> to add courses, teams &amp; players, then create a <b>Round</b>.' +
      '<div class="btn-row" style="justify-content:center"><button class="btn" data-action="goto" data-tab="setup">Go to Setup</button>' +
      '<button class="btn secondary" data-action="seed">Load sample data</button></div></div></div>';
  }

  /* =======================================================================
   * LEADERBOARD
   * ===================================================================== */
  function renderLeaderboard() {
    const st = S();
    if (!st.rounds.length) return needSetupMsg('rounds');

    let html = '';

    // ---- Team scoreboard (Ryder cup style) ----
    if (st.teams.length === 2) {
      const tp = teamPoints();
      const a = st.teams[0], b = st.teams[1];
      html += '<div class="team-score-banner">' +
        '<div class="side" style="background:' + (a.color || '#0b6b3a') + '">' +
        '<div class="pts">' + fmtPts(tp[a.id]) + '</div><div class="nm">' + esc(a.name) + '</div></div>' +
        '<div class="vs">vs</div>' +
        '<div class="side" style="background:' + (b.color || '#2563eb') + '">' +
        '<div class="pts">' + fmtPts(tp[b.id]) + '</div><div class="nm">' + esc(b.name) + '</div></div></div>';
      html += '<div class="muted center" style="margin:-6px 0 14px;font-size:12px">Team points from singles matches across all rounds</div>';
    } else if (st.teams.length > 2) {
      const tp = teamPoints();
      html += '<div class="card"><h2>Team Standings</h2><table><thead><tr><th>Team</th><th class="num">Points</th></tr></thead><tbody>';
      st.teams.slice().sort((x, y) => (tp[y.id] || 0) - (tp[x.id] || 0)).forEach((t) => {
        html += '<tr><td><span class="team-dot" style="background:' + (t.color || '#888') + '"></span> ' +
          esc(t.name) + '</td><td class="num">' + fmtPts(tp[t.id]) + '</td></tr>';
      });
      html += '</tbody></table></div>';
    }

    // ---- Per-round leaderboards ----
    st.rounds.forEach((r) => {
      const c = course(r.courseId);
      const players = roundPlayers(r);
      html += '<div class="card"><h2>' + esc(r.name) + ' <span class="muted" style="font-weight:400;font-size:13px">— ' +
        (c ? esc(c.name) : 'no course') + ' · ' + fmtName(r.format) + '</span></h2>';
      if (!players.length) {
        html += '<div class="empty">No players assigned. Add groups in <b>Rounds</b>.</div></div>';
        return;
      }

      // ---- match-play rounds: show match results ----
      if (isMatch(r.format)) {
        html += (c ? renderMatchList(r, c) : '<div class="empty">Set a course for this round.</div>') + '</div>';
        return;
      }

      const gross = (r.format === 'stroke_gross');
      const rows = players.map((p) => {
        const ch = chFor(p, r);
        const t = Golf.playerRoundTotals(r.scores ? r.scores[p.id] : null, ch, c ? c.holes : []);
        return { p, ch, t };
      }).filter((x) => x.t.played > 0);

      rows.sort((x, y) => {
        const xv = gross ? x.t.gross : x.t.net;
        const yv = gross ? y.t.gross : y.t.net;
        return xv - yv;
      });

      if (!rows.length) {
        html += '<div class="empty">No scores entered yet.</div></div>';
        return;
      }

      html += '<table class="lead-table"><thead><tr><th class="pos">#</th><th>Player</th>' +
        '<th class="num">Thru</th><th class="num">CH</th><th class="num">Gross</th><th class="num">Net</th><th class="num">To Par</th></tr></thead><tbody>';
      rows.forEach((x, i) => {
        const t = team(x.p.teamId);
        const toPar = x.t.toPar;
        const cls = toPar < 0 ? 'under' : toPar === 0 ? 'even' : 'over';
        html += '<tr><td class="pos">' + (i + 1) + '</td><td>' +
          (t ? '<span class="team-dot" style="background:' + (t.color || '#888') + '"></span> ' : '') +
          esc(x.p.name) + '</td>' +
          '<td class="num">' + (x.t.played === (c ? c.holes.length : 18) ? 'F' : x.t.played) + '</td>' +
          '<td class="num">' + x.ch + '</td>' +
          '<td class="num">' + x.t.gross + '</td>' +
          '<td class="num"><b>' + x.t.net + '</b></td>' +
          '<td class="num ' + cls + '">' + fmtToPar(toPar) + '</td></tr>';
      });
      html += '</tbody></table></div>';
    });

    return html;
  }

  function fmtPts(n) { n = n || 0; return (Math.round(n * 2) / 2).toString(); }

  /* Team points: each match-format group is a 2-side match. Winner +1, halve
   * +0.5 each, only once decided. Summed across all match rounds. */
  function teamPoints() {
    const pts = {};
    S().teams.forEach((t) => (pts[t.id] = 0));
    S().rounds.forEach((r) => {
      if (!isMatch(r.format)) return;
      const c = course(r.courseId);
      if (!c) return;
      (r.groups || []).forEach((g) => {
        const mg = matchForGroup(r, g, c);
        if (!mg || mg.m.played === 0) return;
        const [sa, sb] = mg.sides;
        if (mg.m.result === 'A') pts[sa.team.id] += 1;
        else if (mg.m.result === 'B') pts[sb.team.id] += 1;
        else if (mg.m.result === 'AS') { pts[sa.team.id] += 0.5; pts[sb.team.id] += 0.5; }
        // in-progress matches don't award until decided
      });
    });
    return pts;
  }

  /* Match results table for a match-play round. */
  function renderMatchList(r, c) {
    const groups = r.groups || [];
    if (!groups.length) return '<div class="empty">No matches set up. Add groups in <b>Rounds</b>.</div>';
    let html = '<table><thead><tr><th>Match</th><th>Sides</th><th class="num">Status</th><th class="num">Pt</th></tr></thead><tbody>';
    groups.forEach((g) => {
      const mg = matchForGroup(r, g, c);
      if (!mg) {
        html += '<tr><td>' + esc(g.name) + '</td><td colspan="3" class="muted">needs 2 teams</td></tr>';
        return;
      }
      const [sa, sb] = mg.sides;
      const ta = team(sa.team.id), tb = team(sb.team.id);
      const dot = (t) => t ? '<span class="team-dot" style="background:' + (t.color || '#888') + '"></span>' : '';
      const sideName = (side, t) => dot(t) + ' ' + side.players.map((p) => esc(p.name)).join(' / ');
      const statusText = Golf.matchText(mg.m, ta ? ta.name : 'A', tb ? tb.name : 'B');
      let pt = '';
      if (mg.m.result === 'A') pt = '1–0';
      else if (mg.m.result === 'B') pt = '0–1';
      else if (mg.m.result === 'AS') pt = '½–½';
      const lead = mg.m.status > 0 ? 'under' : mg.m.status < 0 ? '' : 'even';
      html += '<tr><td><b>' + esc(g.name) + '</b></td>' +
        '<td style="font-size:13px">' + sideName(mg.A, ta) + ' <span class="muted">vs</span> ' + sideName(mg.B, tb) + '</td>' +
        '<td class="num">' + esc(statusText) + '</td><td class="num">' + pt + '</td></tr>';
    });
    html += '</tbody></table>';
    return html;
  }

  /* =======================================================================
   * SCORE ENTRY
   * ===================================================================== */
  function renderScore() {
    const st = S();
    if (!st.rounds.length) return needSetupMsg('rounds');
    if (!ui.roundId || !round(ui.roundId)) ui.roundId = st.rounds[0].id;
    const r = round(ui.roundId);
    const c = course(r.courseId);

    let html = '<div class="card"><div class="row">' +
      '<div><label>Round</label>' + selectRounds(ui.roundId) + '</div>' +
      '<div><label>Group / Matchup</label>' + selectGroups(r, ui.groupId) + '</div>' +
      '</div></div>';

    if (!c) return html + '<div class="card"><div class="empty">This round has no course set.</div></div>';

    const grp = (r.groups || []).find((g) => g.id === ui.groupId) || (r.groups || [])[0];
    if (!grp) return html + '<div class="card"><div class="empty">No groups yet. Add one in <b>Rounds</b>.</div></div>';
    ui.groupId = grp.id;
    const players = (grp.playerIds || []).map(player).filter(Boolean);
    if (!players.length) return html + '<div class="card"><div class="empty">No players in this group.</div></div>';

    html += '<div class="card score-grid"><h2>' + esc(grp.name) + '</h2><table><thead>';
    // hole numbers
    html += '<tr class="hole-head"><th>Hole</th>';
    c.holes.forEach((_, i) => (html += '<th>' + (i + 1) + '</th>'));
    html += '<th>Tot</th></tr>';
    // par
    html += '<tr class="hole-head"><td class="par-cell">Par</td>';
    c.holes.forEach((h) => (html += '<td class="par-cell">' + h.par + '</td>'));
    html += '<td class="par-cell">' + coursePar(c) + '</td></tr>';
    // SI
    html += '<tr class="hole-head"><td class="par-cell">SI</td>';
    c.holes.forEach((h) => (html += '<td class="par-cell">' + h.si + '</td>'));
    html += '<td></td></tr></thead><tbody>';

    if (r.format === 'scramble') {
      // one team score per hole (Texas scramble)
      const sides = sidesForGroup(grp);
      sides.forEach((side) => {
        const ch = scrambleHC(side, r, grp);
        const t = side.team;
        let tot = 0, any = false;
        html += '<tr><td><b>' + (t ? '<span class="team-dot" style="background:' + (t.color || '#888') + '"></span> ' : '') +
          esc(t ? t.name : 'Team') + '</b><div class="par-cell">' + side.players.map((p) => esc(p.name)).join(' / ') + ' · CH ' + ch + '</div></td>';
        c.holes.forEach((h, i) => {
          const g = getTeamScore(r, grp.id, t.id, i);
          const strokes = Golf.strokesOnHole(ch, h.si, c.holes.length);
          if (g != null && g !== '' && !isNaN(g)) { tot += Number(g); any = true; }
          html += '<td><input class="score-input" type="number" inputmode="numeric" min="1" max="20" ' +
            'value="' + (g == null ? '' : g) + '" data-action="team-score" data-rid="' + r.id +
            '" data-gid="' + grp.id + '" data-tid="' + t.id + '" data-h="' + i + '">' +
            (strokes > 0 ? '<div class="par-cell stroke-dot">' + '•'.repeat(strokes) + '</div>' : '') +
            '</td>';
        });
        html += '<td class="num"><b>' + (any ? tot : '') + '</b></td></tr>';
      });
    } else {
      players.forEach((p) => {
        const ch = chFor(p, r, grp);
        let tot = 0, any = false;
        html += '<tr><td><b>' + esc(p.name) + '</b><div class="par-cell">CH ' + ch + '</div></td>';
        c.holes.forEach((h, i) => {
          const g = getScore(r, p.id, i);
          const strokes = Golf.strokesOnHole(ch, h.si, c.holes.length);
          if (g != null && g !== '' && !isNaN(g)) { tot += Number(g); any = true; }
          html += '<td><input class="score-input" type="number" inputmode="numeric" min="1" max="20" ' +
            'value="' + (g == null ? '' : g) + '" data-action="score" data-rid="' + r.id +
            '" data-pid="' + p.id + '" data-h="' + i + '">' +
            (strokes > 0 ? '<div class="par-cell stroke-dot">' + '•'.repeat(strokes) + '</div>' : '') +
            '</td>';
        });
        html += '<td class="num"><b>' + (any ? tot : '') + '</b></td></tr>';
      });
    }
    html += '</tbody></table>';
    // live match status under the grid for match formats
    if (isMatch(r.format)) {
      const mg = matchForGroup(r, grp, c);
      if (mg) {
        const ta = team(mg.sides[0].team.id), tb = team(mg.sides[1].team.id);
        html += '<div class="banner-tip" style="background:#eef7f1;border-color:#bfe3cd;color:#0b6b3a;margin-top:12px">' +
          '<b>' + esc(Golf.matchText(mg.m, ta ? ta.name : 'A', tb ? tb.name : 'B')) + '</b></div>';
      }
    }
    html += '<div class="muted" style="margin-top:10px;font-size:12px">Red dots = handicap strokes received on that hole. ' +
      (r.format === 'fourball' ? 'Best (lowest) net per team counts each hole. ' : r.format === 'scramble' ? 'Enter one team score per hole. ' : '') +
      'Scores save automatically &amp; sync live.</div></div>';
    return html;
  }

  function selectRounds(sel) {
    return '<select data-action="pick-round" class="compact">' +
      S().rounds.map((r) => '<option value="' + r.id + '"' + (r.id === sel ? ' selected' : '') + '>' + esc(r.name) + '</option>').join('') +
      '</select>';
  }
  function selectGroups(r, sel) {
    const gs = r.groups || [];
    if (!gs.length) return '<select class="compact" disabled><option>No groups</option></select>';
    return '<select data-action="pick-group" class="compact">' +
      gs.map((g) => '<option value="' + g.id + '"' + (g.id === sel ? ' selected' : '') + '>' + esc(g.name) + '</option>').join('') +
      '</select>';
  }

  /* =======================================================================
   * SKINS
   * ===================================================================== */
  function renderSkins() {
    const st = S();
    if (!st.rounds.length) return needSetupMsg('rounds');
    let html = '';
    st.rounds.forEach((r) => {
      const skins = r.skins || {};
      const c = course(r.courseId);
      html += '<div class="card"><h2>' + esc(r.name) + ' — Skins</h2>';
      if (r.format === 'scramble') {
        html += '<div class="muted">Skins don\'t apply to a scramble (one team ball per hole).</div></div>';
        return;
      }
      html += '<div class="row">' +
        '<div><label>Skins on?</label><select data-action="skin-cfg" data-rid="' + r.id + '" data-f="enabled" class="compact">' +
        '<option value="1"' + (skins.enabled ? ' selected' : '') + '>Yes</option>' +
        '<option value="0"' + (!skins.enabled ? ' selected' : '') + '>No</option></select></div>' +
        '<div><label>Scoring</label><select data-action="skin-cfg" data-rid="' + r.id + '" data-f="mode" class="compact">' +
        '<option value="net"' + (skins.mode !== 'gross' ? ' selected' : '') + '>Net</option>' +
        '<option value="gross"' + (skins.mode === 'gross' ? ' selected' : '') + '>Gross</option></select></div>' +
        '<div><label>Carryover ties</label><select data-action="skin-cfg" data-rid="' + r.id + '" data-f="carryover" class="compact">' +
        '<option value="1"' + (skins.carryover ? ' selected' : '') + '>Carry over</option>' +
        '<option value="0"' + (!skins.carryover ? ' selected' : '') + '>No carry</option></select></div>' +
        '<div><label>Buy-in / player ($)</label><input type="number" class="compact" data-action="skin-cfg" data-rid="' + r.id + '" data-f="buyIn" value="' + (skins.buyIn || 0) + '"></div>' +
        '</div>';

      if (skins.enabled && c) {
        const players = roundPlayers(r).map((p) => ({ id: p.id, name: p.name, courseHandicap: chFor(p, r) }));
        const res = Golf.computeSkins(players, c.holes, (pid, h) => getScore(r, pid, h), { mode: skins.mode || 'net', carryover: !!skins.carryover });
        const pay = Golf.skinsPayouts(skins.buyIn || 0, players, res.skinsByPlayer, res.totalSkins);

        html += '<h3>Hole results</h3><div class="score-grid"><table><thead><tr><th>Hole</th><th>Winner</th><th class="num">Best ' + (skins.mode === 'gross' ? 'Gross' : 'Net') + '</th><th class="num">Skins</th></tr></thead><tbody>';
        res.results.forEach((row) => {
          if (!row.played) return;
          const w = row.winnerId ? player(row.winnerId) : null;
          html += '<tr><td>' + (row.holeIndex + 1) + '</td><td>' +
            (w ? esc(w.name) : '<span class="muted">' + (row.tie ? (row.carried ? 'Tied — carried' : 'Tied — push') : '—') + '</span>') +
            '</td><td class="num">' + (row.best == null ? '' : row.best) + '</td>' +
            '<td class="num">' + (row.value || '') + '</td></tr>';
        });
        html += '</tbody></table></div>';

        const winners = players.filter((p) => res.skinsByPlayer[p.id]);
        html += '<h3>Skins won &amp; payouts</h3>';
        if (!winners.length) {
          html += '<div class="muted">No skins won yet' + (res.leftoverCarry ? ' (' + res.leftoverCarry + ' carrying)' : '') + '.</div>';
        } else {
          html += '<table><thead><tr><th>Player</th><th class="num">Skins</th><th class="num">Payout</th></tr></thead><tbody>';
          winners.sort((a, b) => res.skinsByPlayer[b.id] - res.skinsByPlayer[a.id]).forEach((p) => {
            html += '<tr><td>' + esc(p.name) + '</td><td class="num">' + res.skinsByPlayer[p.id] + '</td><td class="num">' + Golf.money(pay.payouts[p.id]) + '</td></tr>';
          });
          html += '</tbody></table>';
          html += '<div class="muted" style="margin-top:8px">Pot ' + Golf.money(pay.pot) + ' · ' + res.totalSkins + ' skins · ' + Golf.money(pay.perSkin) + ' each' +
            (res.leftoverCarry ? ' · ' + res.leftoverCarry + ' carrying (unclaimed)' : '') + '</div>';
        }
      }
      html += '</div>';
    });
    return html;
  }

  /* =======================================================================
   * PAYOUTS
   * ===================================================================== */
  function renderPayouts() {
    const st = S();
    let html = '<div class="card"><h2>Payouts</h2>' +
      '<div class="muted" style="margin-bottom:10px">Skins payouts are computed automatically on the <b>Skins</b> tab. Add other pots here (overall net, longest drive, team match, etc.).</div>' +
      '<div class="btn-row"><button class="btn small" data-action="add-payout">+ Add pot</button></div></div>';

    (st.payouts || []).forEach((po) => {
      html += '<div class="card"><div class="row">' +
        '<div><label>Pot name</label><input data-action="payout-field" data-id="' + po.id + '" data-f="name" value="' + esc(po.name || '') + '"></div>' +
        '<div><label>Type</label><select data-action="payout-field" data-id="' + po.id + '" data-f="type" class="compact">' +
        '<option value="overall_net"' + (po.type === 'overall_net' ? ' selected' : '') + '>Overall Net (places)</option>' +
        '<option value="overall_gross"' + (po.type === 'overall_gross' ? ' selected' : '') + '>Overall Gross (places)</option>' +
        '<option value="manual"' + (po.type === 'manual' ? ' selected' : '') + '>Manual</option></select></div>' +
        '<div><label>Buy-in / player ($)</label><input type="number" class="compact" data-action="payout-field" data-id="' + po.id + '" data-f="buyIn" value="' + (po.buyIn || 0) + '"></div>' +
        '<div><label>Round (or all)</label>' + payoutRoundSelect(po) + '</div>' +
        '<div class="inline-actions" style="flex:0 0 auto"><button class="btn small danger" data-action="del-payout" data-id="' + po.id + '">Delete</button></div>' +
        '</div>';

      if (po.type === 'overall_net' || po.type === 'overall_gross') {
        html += '<div class="row" style="margin-top:8px"><div><label>Places paid (% comma-separated, e.g. 60,30,10)</label>' +
          '<input data-action="payout-field" data-id="' + po.id + '" data-f="places" value="' + esc(po.places || '60,30,10') + '"></div></div>';
        html += renderPayoutResult(po);
      } else if (po.type === 'manual') {
        html += '<div class="muted" style="margin-top:8px">Manual pot — record the total and split it however you like.</div>';
      }
      html += '</div>';
    });
    return html;
  }

  function payoutRoundSelect(po) {
    return '<select data-action="payout-field" data-id="' + po.id + '" data-f="roundId" class="compact">' +
      '<option value="">All rounds (total)</option>' +
      S().rounds.map((r) => '<option value="' + r.id + '"' + (po.roundId === r.id ? ' selected' : '') + '>' + esc(r.name) + '</option>').join('') +
      '</select>';
  }

  function renderPayoutResult(po) {
    const st = S();
    const gross = po.type === 'overall_gross';
    const rounds = po.roundId ? [round(po.roundId)].filter(Boolean) : st.rounds;
    if (!rounds.length) return '';
    // aggregate each player's total net/gross across the chosen rounds (only fully meaningful when complete)
    const totals = {};
    st.players.forEach((p) => (totals[p.id] = { id: p.id, name: p.name, val: 0, played: 0 }));
    rounds.forEach((r) => {
      const c = course(r.courseId);
      if (!c) return;
      roundPlayers(r).forEach((p) => {
        const ch = chFor(p, r);
        const t = Golf.playerRoundTotals(r.scores ? r.scores[p.id] : null, ch, c.holes);
        if (t.played > 0) {
          totals[p.id].val += gross ? t.gross : t.net;
          totals[p.id].played += t.played;
        }
      });
    });
    const ranked = Object.values(totals).filter((x) => x.played > 0).sort((a, b) => a.val - b.val);
    if (!ranked.length) return '<div class="muted" style="margin-top:8px">No scores yet.</div>';

    const places = (po.places || '60,30,10').split(',').map((s) => parseFloat(s.trim()) / 100).filter((n) => !isNaN(n));
    const playerCount = new Set();
    rounds.forEach((r) => roundPlayers(r).forEach((p) => playerCount.add(p.id)));
    const pot = (Number(po.buyIn) || 0) * playerCount.size;
    const payouts = Golf.placePayouts(pot, ranked, places, (x) => x.val);

    let html = '<h3>Standings &amp; payouts <span class="muted" style="font-weight:400">(pot ' + Golf.money(pot) + ')</span></h3>' +
      '<table><thead><tr><th class="pos">#</th><th>Player</th><th class="num">' + (gross ? 'Gross' : 'Net') + '</th><th class="num">Payout</th></tr></thead><tbody>';
    ranked.forEach((x, i) => {
      html += '<tr><td class="pos">' + (i + 1) + '</td><td>' + esc(x.name) + '</td><td class="num">' + x.val + '</td><td class="num">' +
        (payouts[x.id] ? Golf.money(payouts[x.id]) : '') + '</td></tr>';
    });
    html += '</tbody></table>';
    return html;
  }

  /* =======================================================================
   * ROUNDS
   * ===================================================================== */
  function renderRounds() {
    const st = S();
    let html = '<div class="card"><h2>Rounds</h2>';
    if (!st.courses.length) html += '<div class="banner-tip">Add a course in <b>Setup</b> first so rounds can use its tees &amp; holes.</div>';
    html += '<div class="btn-row"><button class="btn small" data-action="add-round">+ New round</button></div></div>';

    st.rounds.forEach((r) => {
      const c = course(r.courseId);
      html += '<div class="card"><div class="row">' +
        '<div><label>Round name</label><input data-action="round-field" data-id="' + r.id + '" data-f="name" value="' + esc(r.name) + '"></div>' +
        '<div><label>Course</label>' + courseSelect(r) + '</div>' +
        '<div><label>Format</label>' + formatSelect(r) + '</div>' +
        '<div><label>Date</label><input type="date" data-action="round-field" data-id="' + r.id + '" data-f="date" value="' + esc(r.date || '') + '"></div>' +
        '<div class="inline-actions" style="flex:0 0 auto"><button class="btn small danger" data-action="del-round" data-id="' + r.id + '">Delete</button></div>' +
        '</div>';

      // groups
      html += '<h3>Groups / Matchups</h3>';
      (r.groups || []).forEach((g) => {
        html += '<div class="list-item" style="flex-direction:column;align-items:stretch">' +
          '<div class="row" style="align-items:center">' +
          '<div style="flex:1 1 160px"><input data-action="group-field" data-rid="' + r.id + '" data-id="' + g.id + '" data-f="name" value="' + esc(g.name) + '"></div>' +
          '<div class="inline-actions" style="flex:0 0 auto"><button class="btn small danger" data-action="del-group" data-rid="' + r.id + '" data-id="' + g.id + '">Remove</button></div>' +
          '</div>';
        // players in group as chips
        html += '<div style="margin-top:6px">';
        (g.playerIds || []).forEach((pid) => {
          const p = player(pid);
          if (!p) return;
          const t = team(p.teamId);
          html += '<span class="chip">' + (t ? '<span class="team-dot" style="background:' + (t.color || '#888') + '"></span>' : '') +
            esc(p.name) + ' <span class="muted">(' + (p.index || 0) + ')</span> ' +
            '<span class="x" data-action="group-remove-player" data-rid="' + r.id + '" data-id="' + g.id + '" data-pid="' + pid + '">×</span></span>';
        });
        html += '</div>';
        // add player to group
        const avail = st.players.filter((p) => (g.playerIds || []).indexOf(p.id) < 0);
        if (avail.length) {
          html += '<div style="margin-top:6px"><select class="compact" data-action="group-add-player" data-rid="' + r.id + '" data-id="' + g.id + '">' +
            '<option value="">+ add player…</option>' +
            avail.map((p) => '<option value="' + p.id + '">' + esc(p.name) + '</option>').join('') + '</select></div>';
        }
        html += '</div>';
      });
      html += '<div class="btn-row"><button class="btn small secondary" data-action="add-group" data-rid="' + r.id + '">+ Add group</button>' +
        '<button class="btn small secondary" data-action="auto-pair" data-rid="' + r.id + '">Auto-pair teams</button></div>';
      html += '</div>';
    });
    return html;
  }

  function courseSelect(r) {
    return '<select data-action="round-field" data-id="' + r.id + '" data-f="courseId" class="compact">' +
      '<option value="">—</option>' +
      S().courses.map((c) => '<option value="' + c.id + '"' + (r.courseId === c.id ? ' selected' : '') + '>' + esc(c.name) + '</option>').join('') +
      '</select>';
  }
  function formatSelect(r) {
    return '<select data-action="round-field" data-id="' + r.id + '" data-f="format" class="compact">' +
      FORMATS.map((f) => '<option value="' + f.id + '"' + (r.format === f.id ? ' selected' : '') + '>' + esc(f.name) + '</option>').join('') +
      '</select>';
  }

  /* =======================================================================
   * SCORECARDS (print)
   * ===================================================================== */
  function renderCards() {
    const st = S();
    if (!st.rounds.length) return needSetupMsg('rounds');
    if (!ui.roundId || !round(ui.roundId)) ui.roundId = st.rounds[0].id;
    const r = round(ui.roundId);
    const c = course(r.courseId);

    let html = '<div class="card no-print"><div class="row">' +
      '<div><label>Round</label>' + selectRounds(ui.roundId) + '</div>' +
      '<div class="inline-actions" style="flex:0 0 auto;align-items:flex-end"><button class="btn" data-action="print">🖨 Print all cards</button></div>' +
      '</div><div class="muted" style="margin-top:8px">One card per matchup, with each player\'s handicap strokes shown as dots per hole.</div></div>';

    if (!c) return html + '<div class="card"><div class="empty">This round has no course.</div></div>';
    if (!(r.groups || []).length) return html + '<div class="card"><div class="empty">No groups to print.</div></div>';

    r.groups.forEach((g) => {
      let rows;
      if (r.format === 'scramble') {
        rows = sidesForGroup(g).map((side) => ({
          name: (side.team ? side.team.name : 'Team') + ' (' + side.players.map((p) => p.name).join('/') + ')',
          courseHandicap: scrambleHC(side, r, g),
          getScore: (h) => getTeamScore(r, g.id, side.team.id, h),
        }));
      } else {
        rows = (g.playerIds || []).map((pid) => {
          const p = player(pid);
          if (!p) return null;
          return { name: p.name, courseHandicap: chFor(p, r, g), getScore: (h) => getScore(r, pid, h) };
        }).filter(Boolean);
      }
      if (!rows.length) return;
      html += Print.scorecardHTML({
        title: g.name + ' — ' + r.name,
        subtitle: (c.name || '') + (r.date ? ' · ' + r.date : '') + ' · ' + fmtName(r.format),
        holes: c.holes,
        players: rows,
      });
    });
    return html;
  }

  /* =======================================================================
   * SETUP (trip, courses, teams, players, data)
   * ===================================================================== */
  function renderSetup() {
    const st = S();
    let html = '';

    // trip
    html += '<div class="card"><h2>Trip</h2><div class="row">' +
      '<div><label>Trip name</label><input data-action="trip-name" value="' + esc(st.meta.name || '') + '"></div>' +
      '</div></div>';

    // teams
    html += '<div class="card"><h2>Teams</h2>';
    st.teams.forEach((t) => {
      html += '<div class="list-item"><div class="row" style="flex:1;align-items:center">' +
        '<div style="flex:1 1 160px"><input data-action="team-field" data-id="' + t.id + '" data-f="name" value="' + esc(t.name) + '"></div>' +
        '<div style="flex:0 0 70px"><input type="color" data-action="team-field" data-id="' + t.id + '" data-f="color" value="' + (t.color || '#0b6b3a') + '"></div>' +
        '</div><button class="btn small danger" data-action="del-team" data-id="' + t.id + '">×</button></div>';
    });
    html += '<div class="btn-row"><button class="btn small" data-action="add-team">+ Add team</button></div></div>';

    // players
    html += '<div class="card"><h2>Players</h2>';
    if (!st.courses.length) html += '<div class="banner-tip">Tip: add a course below first so you can assign each player a set of tees.</div>';
    html += '<div class="score-grid"><table><thead><tr><th>Name</th><th>Index</th><th>Team</th><th>Tee</th><th></th></tr></thead><tbody>';
    st.players.forEach((p) => {
      html += '<tr>' +
        '<td><input data-action="player-field" data-id="' + p.id + '" data-f="name" value="' + esc(p.name) + '"></td>' +
        '<td style="width:80px"><input type="number" step="0.1" data-action="player-field" data-id="' + p.id + '" data-f="index" value="' + (p.index == null ? '' : p.index) + '"></td>' +
        '<td>' + teamSelect(p) + '</td>' +
        '<td>' + teeSelect(p) + '</td>' +
        '<td><button class="btn small danger" data-action="del-player" data-id="' + p.id + '">×</button></td></tr>';
    });
    html += '</tbody></table></div><div class="btn-row"><button class="btn small" data-action="add-player">+ Add player</button></div></div>';

    // courses
    html += '<div class="card"><h2>Courses</h2><div class="btn-row"><button class="btn small" data-action="add-course">+ Add course</button></div></div>';
    st.courses.forEach((c) => (html += renderCourseCard(c)));

    // data
    html += '<div class="card"><h2>Data &amp; Sync</h2>' +
      '<div class="muted" style="margin-bottom:10px">' +
      (Store.online ? 'Live sync is <b>ON</b> — scores share across devices using trip id <b>' + esc(APP_CONFIG.TRIP_ID) + '</b>.' :
        'Live sync is <b>OFF</b> — data is saved on this device only. See <b>js/config.js</b> to enable Firebase sync.') +
      '</div>' +
      '<div class="btn-row">' +
      '<button class="btn small secondary" data-action="seed">Load sample data</button>' +
      '<button class="btn small secondary" data-action="export">Export JSON</button>' +
      '<button class="btn small secondary" data-action="import">Import JSON</button>' +
      '<button class="btn small danger" data-action="clear-all">Clear everything</button>' +
      '</div></div>';

    return html;
  }

  function teamSelect(p) {
    return '<select data-action="player-field" data-id="' + p.id + '" data-f="teamId" class="compact">' +
      '<option value="">—</option>' +
      S().teams.map((t) => '<option value="' + t.id + '"' + (p.teamId === t.id ? ' selected' : '') + '>' + esc(t.name) + '</option>').join('') +
      '</select>';
  }
  function teeSelect(p) {
    // tees aggregated across courses by name would be complex; assign default tee from first course that has tees
    const tees = [];
    S().courses.forEach((c) => (c.tees || []).forEach((t) => tees.push({ id: t.id, label: c.name + ' · ' + t.name })));
    if (!tees.length) return '<span class="muted">add a course</span>';
    return '<select data-action="player-field" data-id="' + p.id + '" data-f="defaultTeeId" class="compact">' +
      '<option value="">—</option>' +
      tees.map((t) => '<option value="' + t.id + '"' + (p.defaultTeeId === t.id ? ' selected' : '') + '>' + esc(t.label) + '</option>').join('') +
      '</select>';
  }

  function renderCourseCard(c) {
    let html = '<div class="card"><div class="row">' +
      '<div><label>Course name</label><input data-action="course-field" data-id="' + c.id + '" data-f="name" value="' + esc(c.name) + '"></div>' +
      '<div class="inline-actions" style="flex:0 0 auto"><button class="btn small danger" data-action="del-course" data-id="' + c.id + '">Delete course</button></div>' +
      '</div>';

    // tees
    html += '<h3>Tees (slope &amp; rating)</h3><div class="score-grid"><table><thead><tr><th>Tee</th><th>Rating</th><th>Slope</th><th></th></tr></thead><tbody>';
    (c.tees || []).forEach((t) => {
      html += '<tr>' +
        '<td><input data-action="tee-field" data-cid="' + c.id + '" data-id="' + t.id + '" data-f="name" value="' + esc(t.name) + '"></td>' +
        '<td style="width:90px"><input type="number" step="0.1" data-action="tee-field" data-cid="' + c.id + '" data-id="' + t.id + '" data-f="rating" value="' + (t.rating == null ? '' : t.rating) + '"></td>' +
        '<td style="width:80px"><input type="number" data-action="tee-field" data-cid="' + c.id + '" data-id="' + t.id + '" data-f="slope" value="' + (t.slope == null ? '' : t.slope) + '"></td>' +
        '<td><button class="btn small danger" data-action="del-tee" data-cid="' + c.id + '" data-id="' + t.id + '">×</button></td></tr>';
    });
    html += '</tbody></table></div><div class="btn-row"><button class="btn small secondary" data-action="add-tee" data-cid="' + c.id + '">+ Add tee</button></div>';

    // holes
    html += '<h3>Holes (par &amp; stroke index)</h3><div class="score-grid"><table><thead><tr><th>Hole</th>';
    c.holes.forEach((_, i) => (html += '<th>' + (i + 1) + '</th>'));
    html += '<th>Par</th></tr></thead><tbody>';
    html += '<tr><td>Par</td>';
    c.holes.forEach((h, i) => (html += '<td><input class="score-input" type="number" data-action="hole-field" data-cid="' + c.id + '" data-h="' + i + '" data-f="par" value="' + h.par + '"></td>'));
    html += '<td class="num">' + coursePar(c) + '</td></tr>';
    html += '<tr><td>SI</td>';
    c.holes.forEach((h, i) => (html += '<td><input class="score-input" type="number" data-action="hole-field" data-cid="' + c.id + '" data-h="' + i + '" data-f="si" value="' + h.si + '"></td>'));
    html += '<td></td></tr>';
    html += '</tbody></table></div>';
    html += '<div class="btn-row"><button class="btn small secondary" data-action="holes-9" data-cid="' + c.id + '">9 holes</button>' +
      '<button class="btn small secondary" data-action="holes-18" data-cid="' + c.id + '">18 holes</button></div>';
    html += '</div>';
    return html;
  }

  /* =======================================================================
   * EVENT HANDLING (delegation)
   * ===================================================================== */
  function blankHoles(n) {
    const holes = [];
    for (let i = 0; i < n; i++) holes.push({ par: 4, si: i + 1 });
    return holes;
  }

  view.addEventListener('click', function (e) {
    const t = e.target.closest('[data-action]');
    if (!t) return;
    const a = t.dataset.action;
    const handlers = {
      goto: () => { ui.tab = t.dataset.tab; render(); },
      seed: () => seedSample(),
      print: () => window.print(),

      'add-team': () => Store.update((s) => s.teams.push({ id: Store.uid('team'), name: 'Team ' + (s.teams.length + 1), color: pickColor(s.teams.length) })),
      'del-team': () => Store.update((s) => { s.teams = s.teams.filter((x) => x.id !== t.dataset.id); s.players.forEach((p) => { if (p.teamId === t.dataset.id) p.teamId = ''; }); }),

      'add-player': () => Store.update((s) => s.players.push({ id: Store.uid('p'), name: 'Player ' + (s.players.length + 1), index: 0, teamId: s.teams[0] ? s.teams[0].id : '', defaultTeeId: firstTeeId(s) })),
      'del-player': () => Store.update((s) => { s.players = s.players.filter((x) => x.id !== t.dataset.id); s.rounds.forEach((r) => (r.groups || []).forEach((g) => g.playerIds = (g.playerIds || []).filter((id) => id !== t.dataset.id))); }),

      'add-course': () => Store.update((s) => s.courses.push({ id: Store.uid('c'), name: 'New Course', tees: [{ id: Store.uid('tee'), name: 'White', rating: 71.0, slope: 113 }], holes: blankHoles(18) })),
      'del-course': () => Store.update((s) => { s.courses = s.courses.filter((x) => x.id !== t.dataset.id); }),
      'add-tee': () => Store.update((s) => { const c = byId(s.courses, t.dataset.cid); if (c) (c.tees = c.tees || []).push({ id: Store.uid('tee'), name: 'Tee', rating: 71.0, slope: 113 }); }),
      'del-tee': () => Store.update((s) => { const c = byId(s.courses, t.dataset.cid); if (c) c.tees = c.tees.filter((x) => x.id !== t.dataset.id); }),
      'holes-9': () => Store.update((s) => { const c = byId(s.courses, t.dataset.cid); if (c) c.holes = blankHoles(9); }),
      'holes-18': () => Store.update((s) => { const c = byId(s.courses, t.dataset.cid); if (c) c.holes = blankHoles(18); }),

      'add-round': () => Store.update((s) => s.rounds.push({ id: Store.uid('r'), name: 'Round ' + (s.rounds.length + 1), courseId: s.courses[0] ? s.courses[0].id : '', format: 'stroke_net', date: '', skins: { enabled: false, mode: 'net', carryover: true, buyIn: 0 }, groups: [], scores: {} })),
      'del-round': () => Store.update((s) => { s.rounds = s.rounds.filter((x) => x.id !== t.dataset.id); }),
      'add-group': () => Store.update((s) => { const r = byId(s.rounds, t.dataset.rid); if (r) (r.groups = r.groups || []).push({ id: Store.uid('g'), name: 'Match ' + ((r.groups || []).length + 1), playerIds: [], teeOverrides: {} }); }),
      'del-group': () => Store.update((s) => { const r = byId(s.rounds, t.dataset.rid); if (r) r.groups = r.groups.filter((x) => x.id !== t.dataset.id); }),
      'group-remove-player': () => Store.update((s) => { const r = byId(s.rounds, t.dataset.rid); const g = r && byId(r.groups, t.dataset.id); if (g) g.playerIds = g.playerIds.filter((id) => id !== t.dataset.pid); }),
      'auto-pair': () => autoPair(t.dataset.rid),

      'add-payout': () => Store.update((s) => (s.payouts = s.payouts || []).push({ id: Store.uid('po'), name: 'Overall Net', type: 'overall_net', buyIn: 0, places: '60,30,10', roundId: '' })),
      'del-payout': () => Store.update((s) => { s.payouts = (s.payouts || []).filter((x) => x.id !== t.dataset.id); }),

      export: () => doExport(),
      import: () => doImport(),
      'clear-all': () => { if (confirm('Clear ALL trip data on this device (and live sync)? This cannot be undone.')) { Store.importJSON(JSON.stringify({ meta: { name: 'Guys Golf Trip' }, courses: [], teams: [], players: [], rounds: [], payouts: [] })); } },
    };
    if (handlers[a]) { e.preventDefault(); handlers[a](); }
  });

  // change / input handling
  view.addEventListener('change', function (e) {
    const t = e.target.closest('[data-action]');
    if (!t) return;
    const a = t.dataset.action;
    const val = e.target.value;

    if (a === 'score') {
      Store.update((s) => {
        const r = byId(s.rounds, t.dataset.rid);
        if (!r) return;
        r.scores = r.scores || {};
        r.scores[t.dataset.pid] = r.scores[t.dataset.pid] || {};
        if (val === '' || val == null) delete r.scores[t.dataset.pid][t.dataset.h];
        else r.scores[t.dataset.pid][t.dataset.h] = parseInt(val, 10);
      });
      return;
    }
    if (a === 'team-score') {
      Store.update((s) => {
        const r = byId(s.rounds, t.dataset.rid);
        if (!r) return;
        r.teamScores = r.teamScores || {};
        r.teamScores[t.dataset.gid] = r.teamScores[t.dataset.gid] || {};
        r.teamScores[t.dataset.gid][t.dataset.tid] = r.teamScores[t.dataset.gid][t.dataset.tid] || {};
        if (val === '' || val == null) delete r.teamScores[t.dataset.gid][t.dataset.tid][t.dataset.h];
        else r.teamScores[t.dataset.gid][t.dataset.tid][t.dataset.h] = parseInt(val, 10);
      });
      return;
    }
    if (a === 'pick-round') { ui.roundId = val; ui.groupId = null; render(); return; }
    if (a === 'pick-group') { ui.groupId = val; render(); return; }
    if (a === 'trip-name') { Store.update((s) => (s.meta.name = val)); return; }

    if (a === 'team-field') { setField(S().teams, t.dataset.id, t.dataset.f, val); return; }
    if (a === 'player-field') { setPlayerField(t.dataset.id, t.dataset.f, val); return; }
    if (a === 'course-field') { setField(S().courses, t.dataset.id, t.dataset.f, val); return; }
    if (a === 'round-field') { setField(S().rounds, t.dataset.id, t.dataset.f, val); return; }
    if (a === 'payout-field') { setNumberAware(S().payouts, t.dataset.id, t.dataset.f, val, ['buyIn']); return; }

    if (a === 'tee-field') {
      Store.update((s) => { const c = byId(s.courses, t.dataset.cid); const tee = c && byId(c.tees, t.dataset.id); if (tee) tee[t.dataset.f] = (t.dataset.f === 'name') ? val : numOrNull(val); });
      return;
    }
    if (a === 'hole-field') {
      Store.update((s) => { const c = byId(s.courses, t.dataset.cid); if (c && c.holes[t.dataset.h]) c.holes[t.dataset.h][t.dataset.f] = parseInt(val, 10) || 0; });
      return;
    }
    if (a === 'group-field') {
      Store.update((s) => { const r = byId(s.rounds, t.dataset.rid); const g = r && byId(r.groups, t.dataset.id); if (g) g[t.dataset.f] = val; });
      return;
    }
    if (a === 'group-add-player') {
      if (!val) return;
      Store.update((s) => { const r = byId(s.rounds, t.dataset.rid); const g = r && byId(r.groups, t.dataset.id); if (g && g.playerIds.indexOf(val) < 0) g.playerIds.push(val); });
      return;
    }
    if (a === 'skin-cfg') {
      Store.update((s) => {
        const r = byId(s.rounds, t.dataset.rid); if (!r) return;
        r.skins = r.skins || {};
        const f = t.dataset.f;
        if (f === 'enabled' || f === 'carryover') r.skins[f] = val === '1';
        else if (f === 'buyIn') r.skins[f] = Number(val) || 0;
        else r.skins[f] = val;
      });
      return;
    }
  });

  function setField(arr, id, f, val) { Store.update(() => { const o = byId(arr, id); if (o) o[f] = val; }); }
  function setNumberAware(arr, id, f, val, numFields) { Store.update(() => { const o = byId(arr, id); if (o) o[f] = numFields.indexOf(f) >= 0 ? (Number(val) || 0) : val; }); }
  function setPlayerField(id, f, val) {
    Store.update(() => {
      const p = byId(S().players, id); if (!p) return;
      if (f === 'index') p.index = val === '' ? 0 : parseFloat(val);
      else p[f] = val;
    });
  }
  function numOrNull(v) { return v === '' || v == null ? null : Number(v); }
  function firstTeeId(s) { for (const c of s.courses) if (c.tees && c.tees[0]) return c.tees[0].id; return ''; }
  function pickColor(i) { return ['#0b6b3a', '#2563eb', '#c0392b', '#d4a017', '#7c3aed', '#0891b2'][i % 6]; }

  function autoPair(rid) {
    Store.update((s) => {
      const r = byId(s.rounds, rid); if (!r) return;
      const teams = s.teams;
      if (teams.length < 2) { alert('Need at least 2 teams to auto-pair.'); return; }
      const a = s.players.filter((p) => p.teamId === teams[0].id);
      const b = s.players.filter((p) => p.teamId === teams[1].id);
      const perSide = (r.format === 'fourball' || r.format === 'scramble') ? 2 : 1; // 2v2 vs 1v1
      r.groups = [];
      const n = Math.max(Math.ceil(a.length / perSide), Math.ceil(b.length / perSide));
      for (let i = 0; i < n; i++) {
        const ids = [];
        for (let k = 0; k < perSide; k++) {
          if (a[i * perSide + k]) ids.push(a[i * perSide + k].id);
          if (b[i * perSide + k]) ids.push(b[i * perSide + k].id);
        }
        r.groups.push({ id: Store.uid('g'), name: 'Match ' + (i + 1), playerIds: ids, teeOverrides: {} });
      }
    });
  }

  function doExport() {
    const json = Store.exportJSON();
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = (S().meta.name || 'golf-trip').replace(/\s+/g, '-').toLowerCase() + '.json';
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  function doImport() {
    const input = document.createElement('input');
    input.type = 'file'; input.accept = 'application/json,.json';
    input.onchange = () => {
      const file = input.files[0]; if (!file) return;
      const reader = new FileReader();
      reader.onload = () => { try { Store.importJSON(reader.result); render(); } catch (e) { alert('Could not read that file: ' + e.message); } };
      reader.readAsText(file);
    };
    input.click();
  }

  /* =======================================================================
   * SAMPLE DATA
   * ===================================================================== */
  function seedSample() {
    if (S().players.length && !confirm('Replace current data with the trip template?')) return;
    // Standard par-72 hole template — UPDATE par/stroke-index per course on the Setup tab.
    const holePar = [4, 4, 3, 5, 4, 4, 3, 5, 4, 4, 4, 3, 5, 4, 4, 3, 4, 5];
    const holeSI = [7, 3, 17, 1, 11, 5, 15, 9, 13, 8, 2, 16, 4, 10, 6, 18, 12, 14];
    const holes = () => holePar.map((par, i) => ({ par, si: holeSI[i] }));

    // three courses, one White tee each (placeholder slope/rating — edit in Setup)
    function mkCourse(name, rating, slope) {
      const teeId = Store.uid('tee');
      return { course: { id: Store.uid('c'), name, tees: [{ id: teeId, name: 'White', rating, slope }], holes: holes() }, teeId };
    }
    const legacy = mkCourse('Legacy Golf Links', 71.5, 130);
    const midsouth = mkCourse('Mid South Club', 72.0, 133);
    const talamore = mkCourse('Talamore Golf Resort', 71.0, 132);

    const teamA = Store.uid('team'), teamB = Store.uid('team');
    const mk = (name, index, teamId) => ({ id: Store.uid('p'), name, index, teamId, defaultTeeId: legacy.teeId });
    const red = [mk('Player 1', 8, teamA), mk('Player 2', 12, teamA), mk('Player 3', 5, teamA), mk('Player 4', 16, teamA)];
    const blue = [mk('Player 5', 9, teamB), mk('Player 6', 14, teamB), mk('Player 7', 7, teamB), mk('Player 8', 20, teamB)];
    const players = red.concat(blue);

    // Round 1: 1v1 singles — 4 matches
    const singlesGroups = red.map((p, i) => ({ id: Store.uid('g'), name: 'Match ' + (i + 1), playerIds: [p.id, blue[i].id], teeOverrides: {} }));
    // Rounds 2 & 3: 2v2 — 2 matches each (pairs of teammates)
    const pairGroups = () => [
      { id: Store.uid('g'), name: 'Match 1', playerIds: [red[0].id, red[1].id, blue[0].id, blue[1].id], teeOverrides: {} },
      { id: Store.uid('g'), name: 'Match 2', playerIds: [red[2].id, red[3].id, blue[2].id, blue[3].id], teeOverrides: {} },
    ];
    const skins = (buyIn) => ({ enabled: true, mode: 'net', carryover: true, buyIn });

    Store.importJSON(JSON.stringify({
      meta: { name: 'Guys Golf Trip 2026' },
      teams: [{ id: teamA, name: 'Red', color: '#c0392b' }, { id: teamB, name: 'Blue', color: '#2563eb' }],
      players,
      courses: [legacy.course, midsouth.course, talamore.course],
      rounds: [
        { id: Store.uid('r'), name: 'Round 1 — Legacy (Singles)', courseId: legacy.course.id, format: 'match_singles', date: '', skins: skins(20), groups: singlesGroups, scores: {} },
        { id: Store.uid('r'), name: 'Round 2 — Mid South (Best Ball)', courseId: midsouth.course.id, format: 'fourball', date: '', skins: skins(20), groups: pairGroups(), scores: {} },
        { id: Store.uid('r'), name: 'Round 3 — Talamore (Scramble)', courseId: talamore.course.id, format: 'scramble', date: '', skins: { enabled: false, mode: 'net', carryover: true, buyIn: 0 }, groups: pairGroups(), scores: {}, teamScores: {} },
      ],
      payouts: [{ id: Store.uid('po'), name: 'Overall Net', type: 'overall_net', buyIn: 20, places: '50,30,20', roundId: '' }],
    }));
    ui.tab = 'leaderboard';
    render();
  }

  /* =======================================================================
   * BOOT
   * ===================================================================== */
  document.getElementById('tabs').addEventListener('click', function (e) {
    const b = e.target.closest('button[data-tab]');
    if (!b) return;
    ui.tab = b.dataset.tab;
    render();
  });

  // Re-render on store changes, but don't yank focus while typing a score.
  Store.subscribe(function () {
    const ae = document.activeElement;
    const typing = ae && (ae.tagName === 'INPUT' || ae.tagName === 'SELECT') && view.contains(ae);
    if (typing && ui.tab === 'score') return; // skip; change handler will refresh on blur
    render();
  });

  // pick up ?trip= override before init
  try {
    const params = new URLSearchParams(location.search);
    if (params.get('trip')) window.APP_CONFIG.TRIP_ID = params.get('trip');
  } catch (e) {}

  Store.init();
  render();
})();
