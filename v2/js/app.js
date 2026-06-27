/* =========================================================================
 * app.js — Shell + views + interaction for the Golf Trip tournament app.
 * Views are pure functions returning HTML strings; #app is re-rendered on
 * state change. Events handled via delegation. Score entry uses tap steppers
 * (no text-focus to preserve), so full re-render is safe and simple.
 * ========================================================================= */
import * as Store from './store.js';
import * as Eng from './engine/golf.js';
import { computeStandings, resolveRound, resolvePairingMatch, chFor, playerRoundLine, matchHandicaps, ruleHandicap, resolveTeeId } from './engine/standings.js';
import { sampleTournament, FORMAT_INFO } from './seed.js';

const app = document.getElementById('app');
const ui = { view: 'home', scope: 'overall', scoreRoundId: null, scorePairingId: null, holeIdx: 0, sheet: null };

/* ---------------- helpers ---------------- */
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const S = () => Store.get();
const squad = (id) => S().squads[id];
const player = (id) => S().players[id];
const round = (id) => S().rounds[id];
const course = (id) => S().courses[id];
const roundIds = () => (S().tournament.roundOrder || []).filter((id) => S().rounds[id]);
const squadIds = () => Object.keys(S().squads);
const fmtInfo = (f) => FORMAT_INFO[f] || { label: f, short: '', explainer: '' };
function fmtToPar(n) { return n === 0 ? 'E' : n > 0 ? '+' + n : String(n); }
function toParClass(n) { return n < 0 ? 'under' : n === 0 ? 'even' : 'over'; }
function meId() { return S().ui && S().ui.meId; }
function hasData() { return roundIds().length > 0 && squadIds().length > 0; }

/* squad-colored dot */
const sdot = (sid) => { const s = squad(sid); return s ? `<span class="dot" style="background:${s.color || '#888'}"></span>` : ''; };
const cPar = (c) => (c && c.holes ? c.holes.reduce((s, h) => s + (Number(h.par) || 0), 0) : 0);
function teeNameFor(p, r) { const c = course(r.courseId); const tid = resolveTeeId(S(), p, r); const t = c && c.tees ? c.tees[tid] : null; return t ? t.name : ''; }

/* ======================================================================= */
function render() {
  document.getElementById('tripName') && (document.getElementById('tripName').textContent = S().tournament.name);
  let body;
  if (!hasData()) body = viewEmpty();
  else {
    switch (ui.view) {
      case 'home': body = viewHome(); break;
      case 'standings': body = viewStandings(); break;
      case 'rounds': body = viewRounds(); break;
      case 'round': body = viewRoundDetail(); break;
      case 'score': body = viewScore(); break;
      case 'mycard': body = viewMyCard(); break;
      case 'setup': body = viewSetup(); break;
      default: body = viewHome();
    }
  }
  app.innerHTML = hero() + `<div class="screen">${body}</div>` + tabbar() + (ui.sheet ? sheet() : '');
}

/* ---------------- Cup hero header ---------------- */
function hero() {
  const st = S();
  if (!hasData()) {
    return `<div class="hero"><div class="hero-top"><span class="hero-title">${esc(st.tournament.name || 'Golf Trip')}</span>
      <div class="hero-actions"><button class="icon-btn" data-action="theme" title="Theme">◐</button></div></div></div>`;
  }
  const stand = computeStandings(st);
  const ids = squadIds();
  const a = ids[0], b = ids[1];
  const sa = squad(a), sb = squad(b);
  const clinchBadge = stand.clinched ? `<div class="center"><span class="clinch">🏆 ${esc(squad(stand.clinched).name)} clinched</span></div>` : '';
  const two = b
    ? `<div class="cup">
        <div class="cup-side"><div class="pts num">${stand.cup[a] ?? 0}</div><div class="nm">${sdot(a)}${esc(sa.name)}</div></div>
        <div class="cup-mid"><div class="vs">CUP</div><div class="target num">to ${stand.target}</div></div>
        <div class="cup-side"><div class="pts num">${stand.cup[b] ?? 0}</div><div class="nm">${esc(sb.name)}${sdot(b)}</div></div>
       </div>`
    : `<div class="cup"><div class="cup-side"><div class="pts num">${stand.cup[a] ?? 0}</div><div class="nm">${esc(sa.name)}</div></div></div>`;
  return `<div class="hero">
    <div class="hero-top">
      <span class="hero-title">${esc(st.tournament.name)}</span>
      <div class="hero-actions">
        <button class="icon-btn" data-action="sheet" data-sheet="how" title="How it works">?</button>
        <button class="icon-btn" data-action="boost" title="Sunlight boost">☀</button>
        <button class="icon-btn" data-action="theme" title="Theme">◐</button>
      </div>
    </div>
    ${two}${clinchBadge}
  </div>`;
}

/* ---------------- bottom tab bar ---------------- */
function tabbar() {
  if (!hasData()) return '';
  const root = ({ round: 'rounds', score: 'rounds' }[ui.view]) || ui.view;
  const tab = (id, ic, label) => `<button data-action="tab" data-tab="${id}" class="${root === id ? 'active' : ''}"><span class="ic">${ic}</span>${label}</button>`;
  return `<nav class="tabbar">
    ${tab('home', '🏠', 'Home')}
    ${tab('standings', '🏆', 'Standings')}
    ${tab('rounds', '⛳', 'Rounds')}
    ${tab('mycard', '👤', 'My Card')}
    ${tab('setup', '⚙️', 'Setup')}
  </nav>`;
}

/* ---------------- empty state ---------------- */
function viewEmpty() {
  return `<div class="card"><div class="empty">
    <div class="big">⛳</div>
    <h2>Welcome to your Golf Trip</h2>
    <p class="muted">Your trip is one <b>Tournament</b>. Each day is a <b>Round</b> with its own game. Win your matches to earn points for your <b>team</b>. First team to the target wins the Cup.</p>
    <div class="btn-row" style="margin-top:16px">
      <button class="btn" data-action="load-sample">Load the sample trip</button>
    </div>
    <p class="muted" style="margin-top:12px;font-size:13px">Loads the 3-round trip (Legacy · Mid South · Talamore, 2 teams of 4) so you can explore, then edit everything in Setup.</p>
  </div></div>`;
}

/* ---------------- HOME ---------------- */
function viewHome() {
  const st = S();
  const stand = computeStandings(st);
  let action = actionCard(stand);
  // mini live board: current live round matches
  const liveRound = stand.rounds.find((r) => r.status === 'live') || stand.rounds.find((r) => r.status !== 'final');
  let mini = '';
  if (liveRound) {
    const r = round(liveRound.roundId);
    mini = `<div class="card"><div style="display:flex;justify-content:space-between;align-items:center">
        <h2 style="margin:0">${esc(r.name)}</h2><span class="status ${liveRound.status}">${liveRound.status === 'live' ? '<span class="live-pulse"></span>Live' : liveRound.status}</span></div>
      <div class="muted" style="font-size:13px;margin:4px 0 6px">${fmtInfo(r.format).label} · ${liveRound.pointsAvailable} pts in play</div>
      ${matchList(liveRound)}
      <button class="btn secondary small" data-action="open-round" data-id="${r.id}" style="margin-top:10px">Open round →</button>
    </div>`;
  }
  return action + mini + breakdownCard(stand, false);
}

function actionCard(stand) {
  const me = meId() ? player(meId()) : null;
  // find my next/active match
  let lbl = 'The Cup', msg = '', cta = '';
  const liveR = stand.rounds.find((r) => r.status === 'live');
  const nextR = stand.rounds.find((r) => r.status === 'upcoming');
  if (me) {
    const target = liveR || nextR || stand.rounds[stand.rounds.length - 1];
    if (target) {
      const r = round(target.roundId);
      const myPairing = (r.pairings || []).find((p) => (p.teamA || []).includes(me.id) || (p.teamB || []).includes(me.id));
      if (myPairing) {
        const oppIds = (myPairing.teamA.includes(me.id) ? myPairing.teamB : myPairing.teamA);
        const partnerIds = (myPairing.teamA.includes(me.id) ? myPairing.teamA : myPairing.teamB).filter((x) => x !== me.id);
        const names = (ids) => ids.map((x) => esc(player(x) ? player(x).name : '?')).join(' & ');
        lbl = target.status === 'live' ? 'Live now' : 'Up next';
        msg = `${esc(r.name)} — ${fmtInfo(r.format).short}` + (partnerIds.length ? `<br>You + ${names(partnerIds)} vs ${names(oppIds)}` : `<br>You vs ${names(oppIds)}`);
        cta = `<button class="btn" data-action="enter-scores" data-rid="${r.id}" data-pid="${myPairing.id}">Enter scores</button>`;
      }
    }
  } else {
    msg = 'Tap below to pick which player you are — then your matchups and "what to do now" show up here.';
    cta = `<button class="btn" data-action="tab" data-tab="mycard">Pick my player</button>`;
  }
  if (!msg) { msg = 'Follow the live standings and round leaderboards.'; cta = `<button class="btn" data-action="tab" data-tab="standings">View standings</button>`; }
  return `<div class="action"><div class="lbl">${lbl}</div><div class="msg">${msg}</div>${cta}</div>`;
}

/* ---------------- STANDINGS ---------------- */
function viewStandings() {
  const st = S();
  const stand = computeStandings(st);
  const segs = [`<button data-action="scope" data-scope="overall" class="${ui.scope === 'overall' ? 'active' : ''}">Overall</button>`]
    .concat(stand.rounds.map((r) => `<button data-action="scope" data-scope="${r.roundId}" class="${ui.scope === r.roundId ? 'active' : ''}">${esc(round(r.roundId).name.replace(/^Round \d+ — /, ''))}</button>`));
  let body;
  if (ui.scope === 'overall') {
    body = weightToggle() + breakdownCard(stand, true);
  } else {
    const r = stand.rounds.find((x) => x.roundId === ui.scope) || stand.rounds[0];
    body = roundBoard(r);
  }
  return `<div class="seg">${segs.join('')}</div>${body}`;
}

function weightToggle() {
  const mode = S().tournament.weightMode || 'true';
  return `<div class="card" style="padding:12px 16px;display:flex;align-items:center;justify-content:space-between;gap:10px">
    <div><div style="font-weight:700;font-size:14px">Scoring: ${mode === 'normalized' ? 'Equal-weight rounds' : 'True points'}</div>
    <div class="muted" style="font-size:12px">${mode === 'normalized' ? `Each round worth ${S().tournament.normalizeTarget} toward the Cup` : 'Singles 4 · Fourball 2 · Scramble 2'}</div></div>
    <button class="btn secondary small" data-action="weight-mode">${mode === 'normalized' ? 'Use true points' : 'Equal-weight'}</button>
  </div>`;
}

function breakdownCard(stand, full) {
  const ids = squadIds();
  let rows = stand.rounds.map((r) => {
    const ro = round(r.roundId);
    const cells = ids.map((sid) => {
      const v = r.contribution[sid] || 0;
      const lead = ids.every((o) => (r.contribution[sid] || 0) >= (r.contribution[o] || 0)) && v > 0;
      return `<td class="c"><span class="pts num ${lead ? 'win' : ''}">${r.status === 'upcoming' ? '—' : v}</span></td>`;
    }).join('');
    return `<tr data-action="open-round" data-id="${r.roundId}">
      <td><b>${esc(ro.name.replace(/^Round \d+ — /, 'R' + (roundIds().indexOf(r.roundId) + 1) + ' '))}</b><div class="muted" style="font-size:12px">${fmtInfo(ro.format).short} · ${fmtInfo(ro.format).label}</div></td>
      <td class="c"><span class="chip">${r.pointsAvailable}</span></td>
      ${cells}
      <td class="r"><span class="status ${r.status}">${r.status === 'live' ? 'Live' : r.status}</span></td>
    </tr>`;
  }).join('');
  const head = ids.map((sid) => `<th class="c">${sdot(sid)}${esc(squad(sid).name.replace('Team ', ''))}</th>`).join('');
  return `<div class="card breakdown">
    ${full ? '' : '<h2>Cup breakdown</h2>'}
    <table><thead><tr><th>Round</th><th class="c">Pts</th>${head}<th class="r">Status</th></tr></thead>
    <tbody>${rows}</tbody></table>
    <div class="muted" style="font-size:12px;margin-top:8px">Tap a round to see its live leaderboard. First to ${stand.target} wins the Cup.</div>
  </div>`;
}

/* ---------------- ROUNDS (timeline) ---------------- */
function viewRounds() {
  const stand = computeStandings(S());
  const cards = roundIds().map((id, i) => {
    const r = round(id); const rr = stand.rounds.find((x) => x.roundId === id);
    const c = course(r.courseId);
    return `<button class="round-card" data-action="open-round" data-id="${id}">
      <div class="head"><div><div class="rn">${esc(r.name)}</div><div class="meta">${c ? esc(c.name) : 'No course'} · ${fmtInfo(r.format).label}</div></div>
        <span class="status ${rr.status}">${rr.status === 'live' ? '<span class="live-pulse"></span>Live' : rr.status}</span></div>
      <div class="expl">${esc(fmtInfo(r.format).explainer)}</div>
      <div class="ptsavail">${rr.pointsAvailable} points in play</div>
    </button>`;
  }).join('');
  return `<h2 style="margin:0 0 12px">Schedule</h2>${cards}`;
}

/* ---------------- ROUND DETAIL ---------------- */
function viewRoundDetail() {
  const r = round(ui.scope) || round(roundIds()[0]);
  if (!r) return viewRounds();
  const rr = resolveRound(S(), r);
  const c = course(r.courseId);
  return `<button class="btn secondary small" data-action="back" style="margin-bottom:12px">← Rounds</button>
    <div class="card">
      <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:8px">
        <div><h2 style="margin:0">${esc(r.name)}</h2><div class="muted" style="font-size:13px">${c ? esc(c.name) : ''} · ${fmtInfo(r.format).label}</div></div>
        <span class="status ${rr.status}">${rr.status === 'live' ? '<span class="live-pulse"></span>Live' : rr.status}</span>
      </div>
      <div class="tip" style="margin-top:12px">${esc(fmtInfo(r.format).explainer)} <b>${rr.pointsAvailable} points in play</b> · ${esc(hcpLabel(r))}.</div>
      <button class="btn" data-action="enter-scores" data-rid="${r.id}">Enter scores</button>
    </div>
    ${roundBoard(rr)}
    ${skinsCard(r)}`;
}

/* round leaderboard (match list) */
function roundBoard(rr) {
  const r = round(rr.roundId);
  return `<div class="card"><h2>Matches</h2>${matchList(rr)}</div>`;
}

/* ---------------- SKINS ---------------- */
function skinsCfg(rid) {
  const s = (S().skins || {})[rid] || {};
  return { enabled: !!s.enabled, mode: s.mode || 'net', tie: s.tie || 'rollover', value: s.value || 0 };
}
function roundPlayersCH(r) {
  const ids = [];
  (r.pairings || []).forEach((p) => [...(p.teamA || []), ...(p.teamB || [])].forEach((id) => { if (!ids.includes(id)) ids.push(id); }));
  const list = ids.filter((id) => player(id));
  // honor the round's allowance + basis for skins too (relative = off the field's low)
  const { mode, allowance } = ruleHandicap(r);
  const eff = list.map((id) => Math.round(chFor(S(), player(id), r) * (allowance / 100)));
  const shift = (mode === 'relative' && eff.length) ? Math.min(...eff) : 0;
  return list.map((id, i) => ({ id, name: player(id).name, courseHandicap: eff[i] - shift }));
}

/* label for a round's handicap setting, e.g. "Full handicap", "80% off the low" */
function hcpLabel(r) {
  const { allowance, mode } = ruleHandicap(r);
  const pct = allowance === 100 ? 'Full' : allowance + '%';
  return pct + (mode === 'relative' ? ' off the low' : ' handicap');
}
function computeRoundSkins(r) {
  const cfg = skinsCfg(r.id);
  const c = course(r.courseId);
  const players = roundPlayersCH(r);
  const res = Eng.computeSkins(players, c.holes, (pid, h) => getScore(r, pid, h), { mode: cfg.mode, tie: cfg.tie });
  const pay = Eng.skinsPayouts(cfg.value, players, res.skinsByPlayer, res.totalSkins);
  return { cfg, players, res, pay };
}

function skinsCard(r) {
  if (r.format === 'scramble') {
    return `<div class="card"><h2>Skins</h2><div class="muted">Skins don't apply to a scramble (one team ball per hole).</div></div>`;
  }
  const cfg = skinsCfg(r.id);
  const sel = (cur, val, label) => `<option value="${val}" ${cur === val ? 'selected' : ''}>${label}</option>`;
  let cfgRow = `<div class="grid2">
    <div class="field"><label>Skins</label><select data-action="skin-enabled" data-rid="${r.id}">${sel(cfg.enabled ? 'on' : 'off', 'on', 'On')}${sel(cfg.enabled ? 'on' : 'off', 'off', 'Off')}</select></div>
    <div class="field"><label>Buy-in / player ($)</label><input type="number" inputmode="numeric" data-action="skin-buyin" data-rid="${r.id}" value="${cfg.value}"></div>
    <div class="field"><label>Scoring</label><select data-action="skin-mode" data-rid="${r.id}">${sel(cfg.mode, 'net', 'Net')}${sel(cfg.mode, 'gross', 'Gross')}</select></div>
    <div class="field"><label>On a tie…</label><select data-action="skin-tie" data-rid="${r.id}">${sel(cfg.tie, 'rollover', 'Roll over (carry)')}${sel(cfg.tie, 'split', 'Split the skin')}</select></div>
  </div>`;

  let body = '';
  if (cfg.enabled) {
    const { res, pay, players } = computeRoundSkins(r);
    const winners = players.filter((p) => res.skinsByPlayer[p.id]).sort((a, b) => res.skinsByPlayer[b.id] - res.skinsByPlayer[a.id]);
    const fmtSkins = (n) => (Math.round(n * 100) / 100).toString();
    const won = winners.length
      ? `<table><thead><tr><th>Player</th><th class="c">Skins</th><th class="r">$</th></tr></thead><tbody>
          ${winners.map((p) => `<tr><td>${esc(p.name)}</td><td class="c num">${fmtSkins(res.skinsByPlayer[p.id])}</td><td class="r num win">${Eng.money(pay.payouts[p.id])}</td></tr>`).join('')}
         </tbody></table>`
      : `<div class="muted">No skins won yet${res.leftoverCarry ? ` · ${res.leftoverCarry} carrying` : ''}.</div>`;
    const holeRows = res.results.filter((x) => x.played).map((x) => {
      const w = x.winnerIds.length ? x.winnerIds.map((id) => esc(player(id) ? player(id).name : '?')).join(' + ') : (x.carried ? 'carried' : x.split ? 'split' : '—');
      return `<tr><td class="c">${x.holeIndex + 1}</td><td>${w}</td><td class="c num">${x.value || ''}</td></tr>`;
    }).join('');
    body = `<div class="tip" style="margin-top:8px">Pot ${Eng.money(pay.pot)} · ${cfg.mode} · ${cfg.tie === 'split' ? 'split ties' : 'rollover'} · ${fmtSkins(res.totalSkins)} skins @ ${Eng.money(pay.perSkin)}${res.leftoverCarry ? ` · ${res.leftoverCarry} carrying` : ''}</div>
      <h3>Winnings</h3>${won}
      <details style="margin-top:10px"><summary class="muted" style="cursor:pointer">Hole-by-hole</summary>
        <table style="margin-top:6px"><thead><tr><th class="c">Hole</th><th>Winner</th><th class="c">Skins</th></tr></thead><tbody>${holeRows}</tbody></table>
      </details>`;
  }
  return `<div class="card"><h2>Skins &amp; money</h2>${cfgRow}${body}</div>`;
}

/* trip-wide skins money per player (across all non-scramble rounds) */
function tripMoney() {
  const money = {};
  roundIds().forEach((id) => {
    const r = round(id);
    if (r.format === 'scramble' || !skinsCfg(id).enabled) return;
    const { pay } = computeRoundSkins(r);
    Object.keys(pay.payouts).forEach((pid) => { money[pid] = (money[pid] || 0) + pay.payouts[pid]; });
  });
  return money;
}

function matchList(rr) {
  const r = round(rr.roundId);
  if (!rr.matches.length) return '<div class="empty">No matches set up yet.</div>';
  return rr.matches.map((res) => {
    const sa = squad(res.squadA), sb = squad(res.squadB);
    const names = (ids) => ids.map((x) => esc(player(x) ? player(x).name : '?')).join(' / ');
    const tag = Eng.matchTag(res.m, sa ? sa.name.replace('Team ', '') : 'A', sb ? sb.name.replace('Team ', '') : 'B');
    const aUp = res.m.status > 0, bUp = res.m.status < 0;
    let pt = '';
    if (res.m.result === 'A') pt = '1 – 0';
    else if (res.m.result === 'B') pt = '0 – 1';
    else if (res.m.result === 'AS') pt = '½ – ½';
    else pt = res.m.played ? 'in play' : '';
    return `<div class="match">
      <div class="sides">
        <div class="side ${bUp ? 'dim' : ''}">${sdot(res.squadA)} ${names(res.pairing.teamA)}</div>
        <div class="side ${aUp ? 'dim' : ''}">${sdot(res.squadB)} ${names(res.pairing.teamB)}</div>
      </div>
      <div><div class="tag">${esc(tag)}</div><div class="pt num">${pt}</div></div>
    </div>`;
  }).join('');
}

/* ---------------- SCORE ENTRY (hole stepper) ---------------- */
function viewScore() {
  const r = round(ui.scoreRoundId);
  if (!r) { ui.view = 'rounds'; return viewRounds(); }
  const c = course(r.courseId);
  if (!c) return '<div class="card"><div class="empty">This round has no course.</div></div>';
  const pairings = r.pairings || [];
  if (!pairings.length) return '<div class="card"><div class="empty">No matchups in this round.</div></div>';
  if (!ui.scorePairingId || !pairings.find((p) => p.id === ui.scorePairingId)) ui.scorePairingId = defaultPairing(r).id;
  const pairing = pairings.find((p) => p.id === ui.scorePairingId);
  const h = Math.max(0, Math.min(ui.holeIdx, c.holes.length - 1));
  ui.holeIdx = h;
  const hole = c.holes[h];

  const pairingOpts = pairings.map((p, i) => `<option value="${p.id}" ${p.id === ui.scorePairingId ? 'selected' : ''}>${matchupLabel(p, i)}</option>`).join('');

  // live match status
  const res = resolvePairingMatch(S(), r, pairing);
  const sa = squad(res.squadA), sb = squad(res.squadB);
  const statusTxt = Eng.matchText(res.m, sa ? sa.name : 'A', sb ? sb.name : 'B');

  let units;
  if (r.format === 'scramble') {
    units = ['A', 'B'].map((side) => {
      const ids = side === 'A' ? pairing.teamA : pairing.teamB;
      const sid = side === 'A' ? res.squadA : res.squadB;
      const ch = side === 'A' ? res.chA : res.chB;
      const val = getTeam(r, pairing.id, side, h);
      return unitRow({ rid: r.id, target: `team:${pairing.id}:${side}`, name: (squad(sid) ? squad(sid).name : side) + ' — ' + ids.map((x) => player(x) ? player(x).name : '?').join(' / '), sdotId: sid, ch, val, hole, holes: c.holes.length });
    }).join('');
  } else {
    const ids = [...pairing.teamA, ...pairing.teamB];
    const hc = matchHandicaps(S(), r, pairing);
    units = ids.map((pid) => {
      const p = player(pid);
      const ch = hc.byPlayer[pid] || 0;
      const val = getScore(r, pid, h);
      return unitRow({ rid: r.id, target: `player:${pid}`, name: p ? p.name : '?', sdotId: p ? p.squadId : null, ch, val, hole, holes: c.holes.length, tee: p ? teeNameFor(p, r) : '' });
    }).join('');
  }

  return `<button class="btn secondary small" data-action="back" style="margin-bottom:12px">← ${esc(r.name)}</button>
    <div class="card stepper-wrap">
      <div class="field"><label>Matchup</label><select data-action="pick-pairing">${pairingOpts}</select></div>
      <div class="hole-nav">
        <button data-action="hole" data-dir="-1" ${h === 0 ? 'disabled' : ''}>‹</button>
        <div class="holeinfo"><div class="h num">HOLE ${h + 1} of ${c.holes.length} · PAR ${hole.par} · SI ${hole.si}</div><div class="pn num">${h + 1}</div></div>
        <button data-action="hole" data-dir="1" ${h === c.holes.length - 1 ? 'disabled' : ''}>›</button>
      </div>
      ${units}
      <div class="tip" style="margin-top:8px"><b>${esc(statusTxt)}</b></div>
      <div class="muted" style="font-size:12px;text-align:center;margin-top:8px">Tap the number to set par · −/+ to adjust · red dots are strokes received</div>
    </div>`;
}

function unitRow({ rid, target, name, sdotId, ch, val, hole, holes, tee }) {
  const strokes = Eng.strokesOnHole(ch, hole.si, holes);
  const dots = strokes > 0 ? `<span class="dots">${'•'.repeat(strokes)}</span>` : '';
  const net = val != null ? (Number(val) - strokes) : null;
  const display = val == null ? hole.par : val;
  const under = val != null && Number(val) < hole.par;
  return `<div class="player-score">
    <div class="top">
      <div class="who">${sdot(sdotId)} ${esc(name)} ${dots}</div>
      <div class="net num">${tee ? esc(tee) + ' · ' : ''}CH ${ch}${net != null ? ` · net ${net}` : ''}</div>
    </div>
    <div class="stepper">
      <button class="minus" data-action="step" data-rid="${rid}" data-target="${target}" data-h="${hole._i ?? ''}" data-dir="-1">−</button>
      <div class="val num ${under ? 'under' : ''} ${val == null ? 'muted' : ''}" data-action="setpar" data-rid="${rid}" data-target="${target}">${display}</div>
      <button class="plus" data-action="step" data-rid="${rid}" data-target="${target}" data-dir="1">+</button>
    </div>
  </div>`;
}

/* ---------------- MY CARD ---------------- */
function viewMyCard() {
  const st = S();
  const me = meId() ? player(meId()) : null;
  const picker = `<div class="card"><label>I am…</label>
    <select data-action="pick-me">
      <option value="">— pick your name —</option>
      ${Object.entries(st.players).map(([id, p]) => `<option value="${id}" ${id === meId() ? 'selected' : ''}>${esc(p.name)} (${squad(p.squadId) ? squad(p.squadId).name : '?'})</option>`).join('')}
    </select></div>`;
  if (!me) return picker + `<div class="empty">Pick your name to see your matchups, scores, and money.</div>`;

  const rows = roundIds().map((id) => {
    const r = round(id);
    const rr = resolveRound(st, r);
    const mine = rr.matches.find((m) => (m.pairing.teamA || []).includes(me.id) || (m.pairing.teamB || []).includes(me.id));
    if (!mine) return '';
    const onA = mine.pairing.teamA.includes(me.id);
    const oppIds = onA ? mine.pairing.teamB : mine.pairing.teamA;
    const sa = squad(mine.squadA), sb = squad(mine.squadB);
    const tag = Eng.matchTag(mine.m, sa ? sa.name.replace('Team ', '') : 'A', sb ? sb.name.replace('Team ', '') : 'B');
    const line = playerRoundLine(st, r, me.id);
    return `<div class="list-row" style="justify-content:space-between">
      <div><b>${esc(r.name.replace(/^Round \d+ — /, ''))}</b> <span class="muted">${fmtInfo(r.format).short}</span>
        <div class="muted" style="font-size:12px">vs ${oppIds.map((x) => esc(player(x) ? player(x).name : '?')).join(' / ')}${line.played ? ` · ${line.gross} (${fmtToPar(line.toPar)})` : ''}</div></div>
      <div style="text-align:right"><div style="font-weight:800;font-size:13px">${esc(tag)}</div><button class="btn ghost small" data-action="enter-scores" data-rid="${r.id}" data-pid="${mine.pairing.id}" style="margin-top:4px">Score</button></div>
    </div>`;
  }).join('');

  const money = tripMoney();
  const myMoney = money[me.id] || 0;
  const allVals = Object.values(money);
  const moneyCard = allVals.some((v) => v)
    ? `<div class="card"><h2>Skins money</h2>
        <div style="display:flex;align-items:center;justify-content:space-between">
          <div class="muted">Your skins winnings so far</div>
          <div class="num" style="font-size:24px;font-weight:800;color:var(--gain)">${Eng.money(myMoney)}</div>
        </div>
        <div class="muted" style="font-size:12px;margin-top:6px">Across all rounds with skins on. Buy-ins &amp; tie rules are set per round on each round's page.</div>
      </div>`
    : '';

  return picker + `<div class="card"><h2>${sdot(me.squadId)} ${esc(me.name)} <span class="muted" style="font-weight:400;font-size:14px">· ${squad(me.squadId) ? esc(squad(me.squadId).name) : ''} · index ${me.index}</span></h2>${rows || '<div class="muted">No matchups yet.</div>'}</div>${moneyCard}`;
}

/* manual matchup editor for one round */
function pairEditor(r) {
  const used = new Set();
  (r.pairings || []).forEach((p) => [...(p.teamA || []), ...(p.teamB || [])].forEach((id) => used.add(id)));
  const avail = Object.keys(S().players).filter((id) => !used.has(id));
  const chips = (mid, side, ids) => (ids || []).map((pid) => {
    const p = player(pid);
    return `<span class="chip">${sdot(p ? p.squadId : null)} ${esc(p ? p.name : '?')} <span style="cursor:pointer;color:var(--loss);font-weight:800" data-action="mremove" data-rid="${r.id}" data-mid="${mid}" data-side="${side}" data-pid="${pid}">×</span></span>`;
  }).join(' ');
  const addSel = (mid, side) => avail.length
    ? `<select style="margin-top:4px" data-action="madd" data-rid="${r.id}" data-mid="${mid}" data-side="${side}"><option value="">+ add player…</option>${avail.map((id) => `<option value="${id}">${esc(player(id).name)} (${squad(player(id).squadId) ? squad(player(id).squadId).name.replace('Team ', '') : '?'})</option>`).join('')}</select>`
    : '';
  const matches = (r.pairings || []).map((p, i) => `<div class="list-row" style="flex-direction:column;align-items:stretch;gap:8px">
      <div style="display:flex;justify-content:space-between;align-items:center"><b>Match ${i + 1}</b><button class="btn danger small" data-action="del-match" data-rid="${r.id}" data-mid="${p.id}">Remove</button></div>
      <div><div class="muted" style="font-size:11px;font-weight:700">SIDE A</div><div>${chips(p.id, 'A', p.teamA) || '<span class="muted" style="font-size:12px">empty</span>'}</div>${addSel(p.id, 'A')}</div>
      <div><div class="muted" style="font-size:11px;font-weight:700">SIDE B</div><div>${chips(p.id, 'B', p.teamB) || '<span class="muted" style="font-size:12px">empty</span>'}</div>${addSel(p.id, 'B')}</div>
    </div>`).join('');
  return `<div style="margin-top:6px">${matches || '<div class="muted" style="font-size:13px;margin-bottom:8px">No matchups yet.</div>'}
    <div class="btn-row"><button class="btn secondary small" data-action="add-match" data-rid="${r.id}">+ Add matchup</button><button class="btn secondary small" data-action="auto-pair" data-id="${r.id}">Auto-pair from teams</button></div>
    ${avail.length ? `<div class="muted" style="font-size:12px;margin-top:6px">${avail.length} player${avail.length === 1 ? '' : 's'} not yet in a matchup.</div>` : ''}</div>`;
}

/* tee picker options for a course */
function teeOptions(courseId, selected) {
  const c = course(courseId);
  if (!c || !c.tees || !Object.keys(c.tees).length) return '<option value="">—</option>';
  return Object.entries(c.tees).map(([tid, t]) => `<option value="${tid}" ${tid === selected ? 'selected' : ''}>${esc(t.name)} (${t.slope || '?'}/${t.rating || '?'})</option>`).join('');
}

/* per-player tee overrides for a round (collapsible) */
function teeOverrideEditor(r) {
  const c = course(r.courseId);
  if (!c) return '';
  const ids = [];
  (r.pairings || []).forEach((p) => [...(p.teamA || []), ...(p.teamB || [])].forEach((id) => { if (!ids.includes(id)) ids.push(id); }));
  if (!ids.length) return '<div class="muted" style="font-size:12px">Add matchups to set per-player tees.</div>';
  return ids.filter((id) => player(id)).map((id) => {
    const ov = (r.teeOverrides || {})[id] || '';
    return `<div class="list-row" style="gap:8px"><span style="flex:1">${sdot(player(id).squadId)} ${esc(player(id).name)}</span>
      <select data-action="round-tee-override" data-rid="${r.id}" data-pid="${id}" style="flex:1.2">
        <option value="">Default (round tee)</option>
        ${Object.entries(c.tees || {}).map(([tid, t]) => `<option value="${tid}" ${ov === tid ? 'selected' : ''}>${esc(t.name)}</option>`).join('')}
      </select></div>`;
  }).join('');
}

/* full course editor: name, tees (rating/slope), holes (par + stroke index) */
function courseEditor() {
  const st = S();
  let html = '<div class="card"><h2>Courses</h2>';
  Object.entries(st.courses).forEach(([cid, c]) => {
    const tees = Object.entries(c.tees || {});
    const teeRows = tees.map(([tid, t]) => `<div class="list-row" style="gap:6px">
      <input style="flex:1" data-action="tee-name" data-cid="${cid}" data-id="${tid}" value="${esc(t.name || '')}">
      <input type="number" step="0.1" style="width:78px" placeholder="rating" data-action="tee-rating" data-cid="${cid}" data-id="${tid}" value="${t.rating == null ? '' : t.rating}">
      <input type="number" style="width:68px" placeholder="slope" data-action="tee-slope" data-cid="${cid}" data-id="${tid}" value="${t.slope == null ? '' : t.slope}">
      ${tees.length > 1 ? `<button class="btn danger small" data-action="del-tee" data-cid="${cid}" data-id="${tid}">×</button>` : ''}
    </div>`).join('');
    const holes = c.holes || [];
    const nums = holes.map((_, i) => `<th class="c">${i + 1}</th>`).join('');
    const pars = holes.map((h, i) => `<td><input class="hcell" type="number" inputmode="numeric" data-action="hole-par" data-cid="${cid}" data-h="${i}" value="${h.par}"></td>`).join('');
    const sis = holes.map((h, i) => `<td><input class="hcell" type="number" inputmode="numeric" data-action="hole-si" data-cid="${cid}" data-h="${i}" value="${h.si}"></td>`).join('');
    html += `<div style="border:1px solid var(--hairline);border-radius:var(--r-md);padding:12px;margin-bottom:12px">
      <div class="list-row" style="gap:8px"><input style="flex:1" data-action="course-name" data-id="${cid}" value="${esc(c.name)}"><button class="btn danger small" data-action="del-course" data-id="${cid}">Delete</button></div>
      <label style="margin-top:10px">Tees — name · rating · slope</label>
      ${teeRows}
      <div class="btn-row"><button class="btn secondary small" data-action="add-tee" data-cid="${cid}">+ Add tee</button></div>
      <label style="margin-top:12px">Holes — par &amp; stroke index <span class="muted" style="font-weight:400">(par ${cPar(c)})</span></label>
      <div style="overflow-x:auto"><table style="min-width:600px"><thead><tr><th>Hole</th>${nums}<th class="c">Tot</th></tr></thead>
        <tbody>
          <tr><td class="muted">Par</td>${pars}<td class="c num">${cPar(c)}</td></tr>
          <tr><td class="muted">SI</td>${sis}<td></td></tr>
        </tbody></table></div>
      <div class="btn-row" style="margin-top:6px"><button class="btn secondary small" data-action="holes-9" data-cid="${cid}">9 holes</button><button class="btn secondary small" data-action="holes-18" data-cid="${cid}">18 holes</button></div>
    </div>`;
  });
  html += '<div class="btn-row"><button class="btn secondary small" data-action="add-course">+ Add course</button></div>';
  html += '<div class="muted" style="font-size:12px;margin-top:6px">Stroke index 1 = hardest hole. Slope &amp; rating come from the scorecard for each tee — they drive every player\'s strokes.</div></div>';
  return html;
}

/* ---------------- SETUP (commissioner, lite) ---------------- */
function viewSetup() {
  const st = S();
  let html = `<div class="card"><h2>Tournament</h2>
    <div class="field"><label>Name</label><input data-action="trip-name" value="${esc(st.tournament.name)}"></div>
    <div class="grid2">
      <div class="field"><label>Weighting</label><select data-action="set-weight"><option value="true" ${st.tournament.weightMode !== 'normalized' ? 'selected' : ''}>True points</option><option value="normalized" ${st.tournament.weightMode === 'normalized' ? 'selected' : ''}>Equal-weight rounds</option></select></div>
      <div class="field"><label>Equal-weight target</label><input type="number" data-action="set-normtarget" value="${st.tournament.normalizeTarget}"></div>
    </div>
  </div>`;

  // squads (add / remove — any number of teams)
  html += `<div class="card"><h2>Teams</h2>
    ${squadIds().map((sid) => { const s = squad(sid); const n = Object.values(st.players).filter((p) => p.squadId === sid).length; return `<div class="list-row">
      <span class="dot" style="background:${s.color || '#1B7A3D'}"></span>
      <input style="flex:1" data-action="squad-name" data-id="${sid}" value="${esc(s.name)}">
      <span class="muted" style="font-size:12px;white-space:nowrap">${n} player${n === 1 ? '' : 's'}</span>
      <input type="color" style="width:46px;padding:2px" data-action="squad-color" data-id="${sid}" value="${s.color || '#1B7A3D'}">
      ${squadIds().length > 1 ? `<button class="btn danger small" data-action="del-squad" data-id="${sid}">×</button>` : ''}
    </div>`; }).join('')}
    <div class="btn-row" style="margin-top:6px"><button class="btn secondary small" data-action="add-squad">+ Add team</button></div>
    <div class="muted" style="font-size:12px;margin-top:6px">Teams can be any size — assign players below. 6v6, 4v4, anything.</div>
  </div>`;

  // players (add / remove)
  html += `<div class="card"><h2>Players (${Object.keys(st.players).length})</h2>
    <table><thead><tr><th>Name</th><th style="width:58px">Index</th><th>Team</th><th></th></tr></thead><tbody>
    ${Object.entries(st.players).map(([id, p]) => `<tr>
      <td><input data-action="player-name" data-id="${id}" value="${esc(p.name)}"></td>
      <td><input type="number" step="0.1" data-action="player-index" data-id="${id}" value="${p.index}"></td>
      <td><select data-action="player-squad" data-id="${id}">${squadIds().map((sid) => `<option value="${sid}" ${p.squadId === sid ? 'selected' : ''}>${esc(squad(sid).name)}</option>`).join('')}</select></td>
      <td><button class="btn danger small" data-action="del-player" data-id="${id}">×</button></td>
    </tr>`).join('')}
    </tbody></table>
    <div class="btn-row" style="margin-top:8px"><button class="btn secondary small" data-action="add-player">+ Add player</button></div>
  </div>`;

  // courses (full editor)
  html += courseEditor();

  // rounds + manual matchup editor
  html += `<div class="card"><h2>Rounds &amp; matchups</h2>${roundIds().map((id, i) => { const r = round(id); return `<div style="border:1px solid var(--hairline);border-radius:var(--r-md);padding:12px;margin-bottom:12px">
      <div class="field"><input data-action="round-name" data-id="${id}" value="${esc(r.name)}"></div>
      <div class="grid2">
        <div class="field"><label>Format</label><select data-action="round-format" data-id="${id}">${Object.keys(FORMAT_INFO).map((f) => `<option value="${f}" ${r.format === f ? 'selected' : ''}>${FORMAT_INFO[f].label}</option>`).join('')}</select></div>
        <div class="field"><label>Course</label><select data-action="round-course" data-id="${id}">${Object.entries(st.courses).map(([cid, c]) => `<option value="${cid}" ${r.courseId === cid ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}</select></div>
      </div>
      <div class="field"><label>Tee (everyone plays this unless overridden)</label><select data-action="round-tee" data-id="${id}">${teeOptions(r.courseId, r.defaultTeeId)}</select></div>
      <details style="margin-bottom:10px"><summary class="muted" style="cursor:pointer;font-size:13px">Per-player tee overrides</summary><div style="margin-top:8px">${teeOverrideEditor(r)}</div></details>
      <div class="grid3">
        <div class="field"><label>Points / match</label><input type="number" step="0.5" min="0" data-action="round-ppm" data-id="${id}" value="${(r.scoringRule && r.scoringRule.pointsPerMatch != null) ? r.scoringRule.pointsPerMatch : 1}"></div>
        <div class="field"><label>Handicap %</label><input type="number" step="5" min="0" max="100" data-action="round-hcpallow" data-id="${id}" value="${ruleHandicap(r).allowance}"></div>
        <div class="field"><label>Basis</label><select data-action="round-hcpmode" data-id="${id}">
          <option value="absolute" ${ruleHandicap(r).mode !== 'relative' ? 'selected' : ''}>Each off own</option>
          <option value="relative" ${ruleHandicap(r).mode === 'relative' ? 'selected' : ''}>Off the low</option>
        </select></div>
      </div>
      <label>Matchups</label>${pairEditor(r)}
    </div>`; }).join('')}</div>`;

  html += `<div class="card"><h2>Data</h2><div class="btn-row">
    <button class="btn secondary small" data-action="load-sample">Reload sample</button>
    <button class="btn secondary small" data-action="export">Export</button>
    <button class="btn danger small" data-action="clear">Clear all</button>
  </div></div>`;
  return html;
}

/* ---------------- "How it works" sheet ---------------- */
function sheet() {
  if (ui.sheet !== 'how') return '';
  const st = S();
  const stand = computeStandings(st);
  const rules = stand.rounds.map((rr, i) => { const r = round(rr.roundId); const f = fmtInfo(r.format); return `<div class="rule"><b>R${i + 1}: ${esc(r.name.replace(/^Round \d+ — /, ''))} — ${f.label}</b><div class="ex">${esc(f.explainer)} <b>${rr.pointsAvailable} pts</b> · ${esc(hcpLabel(r))}.</div></div>`; }).join('');
  return `<div class="sheet-backdrop" data-action="close-sheet"><div class="sheet" data-stop="1">
    <h2>How the Cup works</h2>
    <p>Your trip is <b>one Tournament</b>. Each day is a <b>Round</b> with its own game. Win your matches to earn points for your team. <b>First to ${stand.target} wins the Cup.</b></p>
    <div style="margin:12px 0">${rules}</div>
    <p class="muted" style="font-size:13px">Every player gets handicap strokes based on the tee's slope &amp; rating (red dots on the card). Scoring mode: <b>${st.tournament.weightMode === 'normalized' ? 'equal-weight rounds' : 'true points'}</b>.</p>
    <button class="btn" data-action="close-sheet">Got it</button>
  </div></div>`;
}

/* =======================================================================
 * SCORE accessors
 * ===================================================================== */
function getScore(r, pid, h) { return r.scores && r.scores[pid] ? r.scores[pid][h] : null; }
function getTeam(r, pairingId, side, h) { const t = r.teamScores && r.teamScores[pairingId]; return t && t[side] ? t[side][h] : null; }
function defaultPairing(r) {
  const me = meId();
  if (me) { const mine = (r.pairings || []).find((p) => (p.teamA || []).includes(me) || (p.teamB || []).includes(me)); if (mine) return mine; }
  return r.pairings[0];
}
function matchupLabel(p, i) {
  const nm = (ids) => ids.map((x) => player(x) ? player(x).name : '?').join('/');
  return `Match ${i + 1}: ${nm(p.teamA)} vs ${nm(p.teamB)}`;
}

/* =======================================================================
 * EVENTS
 * ===================================================================== */
app.addEventListener('click', (e) => {
  const t = e.target.closest('[data-action]');
  if (!t) return;
  const a = t.dataset.action;
  const handlers = {
    tab: () => { ui.view = t.dataset.tab; ui.scope = ui.view === 'standings' ? 'overall' : ui.scope; render(); },
    'open-round': () => { ui.scope = t.dataset.id; ui.view = 'round'; render(); },
    back: () => { ui.view = ui.view === 'score' ? 'round' : 'rounds'; render(); },
    'enter-scores': () => { ui.scoreRoundId = t.dataset.rid; ui.scorePairingId = t.dataset.pid || null; ui.holeIdx = 0; ui.view = 'score'; render(); },
    scope: () => { ui.scope = t.dataset.scope; render(); },
    hole: () => { ui.holeIdx += Number(t.dataset.dir); render(); },
    step: () => stepScore(t.dataset.rid, t.dataset.target, Number(t.dataset.dir)),
    setpar: () => setPar(t.dataset.rid, t.dataset.target),
    'load-sample': () => { Store.importJSON(JSON.stringify(sampleTournament())); ui.view = 'home'; render(); },
    'weight-mode': () => Store.update((s) => { s.tournament.weightMode = s.tournament.weightMode === 'normalized' ? 'true' : 'normalized'; }),
    'set-weight': () => Store.update((s) => { s.tournament.weightMode = t.value; }),
    sheet: () => { ui.sheet = t.dataset.sheet; render(); },
    'close-sheet': () => { if (e.target.closest('[data-stop]')) return; ui.sheet = null; render(); },
    theme: () => toggleTheme(),
    boost: () => toggleBoost(),
    export: () => doExport(),
    clear: () => { if (confirm('Clear all data on this device?')) { Store.importJSON(JSON.stringify(Store.emptyState())); ui.view = 'home'; render(); } },
    'auto-pair': () => autoPair(t.dataset.id),
    'add-match': () => Store.update((s) => { const r = s.rounds[t.dataset.rid]; r.pairings = r.pairings || []; r.pairings.push({ id: Store.uid('m'), teamA: [], teamB: [] }); }),
    'del-match': () => Store.update((s) => { const r = s.rounds[t.dataset.rid]; r.pairings = (r.pairings || []).filter((p) => p.id !== t.dataset.mid); }),
    mremove: () => Store.update((s) => { const r = s.rounds[t.dataset.rid]; const p = (r.pairings || []).find((x) => x.id === t.dataset.mid); if (!p) return; const k = t.dataset.side === 'A' ? 'teamA' : 'teamB'; p[k] = (p[k] || []).filter((id) => id !== t.dataset.pid); }),
    'add-squad': () => Store.update((s) => { const id = Store.uid('sq'); const cols = ['#1B7A3D', '#D0021B', '#1B6FB3', '#F5A623', '#7c3aed', '#0891b2']; s.squads[id] = { name: 'Team ' + (Object.keys(s.squads).length + 1), color: cols[Object.keys(s.squads).length % cols.length] }; }),
    'del-squad': () => Store.update((s) => { const ids = Object.keys(s.squads); if (ids.length <= 1) return; const del = t.dataset.id; const fb = ids.find((x) => x !== del); delete s.squads[del]; Object.values(s.players).forEach((p) => { if (p.squadId === del) p.squadId = fb; }); }),
    'add-player': () => Store.update((s) => { const id = Store.uid('p'); s.players[id] = { id, name: 'New Player', index: 0, squadId: Object.keys(s.squads)[0] || '', defaultTeeId: '' }; }),
    'del-player': () => Store.update((s) => { const del = t.dataset.id; delete s.players[del]; Object.values(s.rounds).forEach((r) => (r.pairings || []).forEach((p) => { p.teamA = (p.teamA || []).filter((x) => x !== del); p.teamB = (p.teamB || []).filter((x) => x !== del); })); if (s.ui && s.ui.meId === del) s.ui.meId = null; }),
    'add-course': () => Store.update((s) => { const id = Store.uid('c'); s.courses[id] = { id, name: 'New Course', tees: { [Store.uid('tee')]: { name: 'White', rating: 71.0, slope: 113 } }, holes: blankHoles(18) }; }),
    'del-course': () => Store.update((s) => { const del = t.dataset.id; delete s.courses[del]; Object.values(s.rounds).forEach((r) => { if (r.courseId === del) { r.courseId = ''; r.defaultTeeId = ''; } }); }),
    'add-tee': () => Store.update((s) => { const c = s.courses[t.dataset.cid]; if (c) { c.tees = c.tees || {}; c.tees[Store.uid('tee')] = { name: 'Tee', rating: 71.0, slope: 113 }; } }),
    'del-tee': () => Store.update((s) => { const c = s.courses[t.dataset.cid]; if (c && Object.keys(c.tees).length > 1) delete c.tees[t.dataset.id]; }),
    'holes-9': () => Store.update((s) => { const c = s.courses[t.dataset.cid]; if (c) c.holes = setHoleCount(c.holes, 9); }),
    'holes-18': () => Store.update((s) => { const c = s.courses[t.dataset.cid]; if (c) c.holes = setHoleCount(c.holes, 18); }),
  };
  if (handlers[a]) { e.preventDefault(); handlers[a](); }
});

app.addEventListener('change', (e) => {
  const t = e.target.closest('[data-action]');
  if (!t) return;
  const a = t.dataset.action, v = e.target.value;
  const set = {
    'pick-pairing': () => { ui.scorePairingId = v; ui.holeIdx = 0; render(); },
    'pick-me': () => Store.setMe(v || null),
    'trip-name': () => Store.update((s) => { s.tournament.name = v; }),
    'set-normtarget': () => Store.update((s) => { s.tournament.normalizeTarget = Number(v) || 4; }),
    'squad-name': () => Store.update((s) => { s.squads[t.dataset.id].name = v; }),
    'squad-color': () => Store.update((s) => { s.squads[t.dataset.id].color = v; }),
    'player-name': () => Store.update((s) => { s.players[t.dataset.id].name = v; }),
    'player-index': () => Store.update((s) => { s.players[t.dataset.id].index = v === '' ? 0 : parseFloat(v); }),
    'player-squad': () => Store.update((s) => { s.players[t.dataset.id].squadId = v; }),
    'round-name': () => Store.update((s) => { s.rounds[t.dataset.id].name = v; }),
    'round-format': () => Store.update((s) => { s.rounds[t.dataset.id].format = v; }),
    'round-course': () => Store.update((s) => { s.rounds[t.dataset.id].courseId = v; }),
    'round-ppm': () => ruleSet(t.dataset.id, { pointsPerMatch: v === '' ? 1 : Number(v) }),
    'round-hcpallow': () => ruleSet(t.dataset.id, { handicapAllowance: v === '' ? 100 : Math.max(0, Math.min(100, Number(v))) }),
    'round-hcpmode': () => ruleSet(t.dataset.id, { handicapMode: v }),
    'round-tee': () => Store.update((s) => { s.rounds[t.dataset.id].defaultTeeId = v; }),
    'round-tee-override': () => Store.update((s) => { const r = s.rounds[t.dataset.rid]; r.teeOverrides = r.teeOverrides || {}; if (v) r.teeOverrides[t.dataset.pid] = v; else delete r.teeOverrides[t.dataset.pid]; }),
    'course-name': () => Store.update((s) => { s.courses[t.dataset.id].name = v; }),
    'tee-name': () => Store.update((s) => { s.courses[t.dataset.cid].tees[t.dataset.id].name = v; }),
    'tee-rating': () => Store.update((s) => { s.courses[t.dataset.cid].tees[t.dataset.id].rating = v === '' ? null : Number(v); }),
    'tee-slope': () => Store.update((s) => { s.courses[t.dataset.cid].tees[t.dataset.id].slope = v === '' ? null : Number(v); }),
    'hole-par': () => Store.update((s) => { const c = s.courses[t.dataset.cid]; if (c.holes[t.dataset.h]) c.holes[t.dataset.h].par = parseInt(v, 10) || 0; }),
    'hole-si': () => Store.update((s) => { const c = s.courses[t.dataset.cid]; if (c.holes[t.dataset.h]) c.holes[t.dataset.h].si = parseInt(v, 10) || 0; }),
    madd: () => { if (!v) return; Store.update((s) => { const r = s.rounds[t.dataset.rid]; const p = (r.pairings || []).find((x) => x.id === t.dataset.mid); if (!p) return; const k = t.dataset.side === 'A' ? 'teamA' : 'teamB'; p[k] = p[k] || []; if (!p[k].includes(v)) p[k].push(v); }); },
    'skin-enabled': () => skinSet(t.dataset.rid, { enabled: v === 'on' }),
    'skin-mode': () => skinSet(t.dataset.rid, { mode: v }),
    'skin-tie': () => skinSet(t.dataset.rid, { tie: v }),
    'skin-buyin': () => skinSet(t.dataset.rid, { value: Number(v) || 0 }),
  };
  if (set[a]) set[a]();
});

function skinSet(rid, patch) {
  Store.update((s) => {
    s.skins = s.skins || {};
    s.skins[rid] = Object.assign({ enabled: false, mode: 'net', tie: 'rollover', value: 0 }, s.skins[rid], patch);
  });
}
function firstTee(s) { for (const cid in s.courses) { const tt = s.courses[cid].tees; const k = tt && Object.keys(tt)[0]; if (k) return k; } return ''; }
function blankHoles(n) { const a = []; for (let i = 0; i < n; i++) a.push({ par: 4, si: i + 1 }); return a; }
function setHoleCount(holes, n) {
  const cur = holes || [];
  if (cur.length === n) return cur.map((h) => ({ par: h.par, si: h.si }));
  const a = [];
  for (let i = 0; i < n; i++) { const ex = cur[i]; a.push({ par: ex ? ex.par : 4, si: ex && ex.si <= n ? ex.si : i + 1 }); }
  return a;
}
function ruleSet(rid, patch) {
  Store.update((s) => {
    const r = s.rounds[rid];
    r.scoringRule = Object.assign({ pointsPerMatch: 1, handicapAllowance: 100, handicapMode: 'absolute' }, r.scoringRule, patch);
  });
}

/* score mutations */
function stepScore(rid, target, dir) {
  Store.update((s) => {
    const r = s.rounds[rid]; const h = ui.holeIdx;
    const c = s.courses[r.courseId]; const par = c.holes[h].par;
    const cur = readTarget(r, target, h);
    let next = cur == null ? par + dir : cur + dir;
    next = Math.max(1, Math.min(15, next));
    writeTarget(r, target, h, next);
  });
}
function setPar(rid, target) {
  Store.update((s) => {
    const r = s.rounds[rid]; const h = ui.holeIdx;
    const c = s.courses[r.courseId]; const par = c.holes[h].par;
    writeTarget(r, target, h, par);
  });
}
function readTarget(r, target, h) {
  const [kind, id, side] = target.split(':');
  if (kind === 'player') return r.scores && r.scores[id] ? r.scores[id][h] : null;
  const tt = r.teamScores && r.teamScores[id]; return tt && tt[side] ? tt[side][h] : null;
}
function writeTarget(r, target, h, val) {
  const [kind, id, side] = target.split(':');
  if (kind === 'player') { r.scores = r.scores || {}; r.scores[id] = r.scores[id] || {}; r.scores[id][h] = val; }
  else { r.teamScores = r.teamScores || {}; r.teamScores[id] = r.teamScores[id] || {}; r.teamScores[id][side] = r.teamScores[id][side] || {}; r.teamScores[id][side][h] = val; }
}

function autoPair(rid) {
  Store.update((s) => {
    const r = s.rounds[rid];
    const ids = squadIds();
    if (ids.length < 2) return;
    const a = Object.keys(s.players).filter((pid) => s.players[pid].squadId === ids[0]);
    const b = Object.keys(s.players).filter((pid) => s.players[pid].squadId === ids[1]);
    const per = (FORMAT_INFO[r.format] || {}).perSide || 1;
    r.pairings = [];
    const n = Math.max(Math.ceil(a.length / per), Math.ceil(b.length / per));
    for (let i = 0; i < n; i++) {
      const teamA = [], teamB = [];
      for (let k = 0; k < per; k++) { if (a[i * per + k]) teamA.push(a[i * per + k]); if (b[i * per + k]) teamB.push(b[i * per + k]); }
      r.pairings.push({ id: Store.uid('m'), teamA, teamB });
    }
  });
}

function doExport() {
  const blob = new Blob([Store.exportJSON()], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url; link.download = (S().tournament.name || 'golf-trip').replace(/\s+/g, '-').toLowerCase() + '.json';
  link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function toggleTheme() {
  const root = document.documentElement;
  const next = root.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
  root.setAttribute('data-theme', next);
  try { localStorage.setItem('golftrip-theme', next); } catch (e) {}
}
function toggleBoost() {
  const root = document.documentElement;
  const next = root.getAttribute('data-boost') === '1' ? '0' : '1';
  root.setAttribute('data-boost', next);
  try { localStorage.setItem('golftrip-boost', next); } catch (e) {}
}

/* ---------------- boot ---------------- */
try {
  const th = localStorage.getItem('golftrip-theme'); if (th) document.documentElement.setAttribute('data-theme', th);
  const bo = localStorage.getItem('golftrip-boost'); if (bo) document.documentElement.setAttribute('data-boost', bo);
} catch (e) {}

Store.subscribe(render);
Store.init();
render();
