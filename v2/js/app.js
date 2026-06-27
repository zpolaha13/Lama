/* =========================================================================
 * app.js — Shell + views + interaction for the Golf Trip tournament app.
 * Views are pure functions returning HTML strings; #app is re-rendered on
 * state change. Events handled via delegation. Score entry uses tap steppers
 * (no text-focus to preserve), so full re-render is safe and simple.
 * ========================================================================= */
import * as Store from './store.js';
import * as Eng from './engine/golf.js';
import { computeStandings, resolveRound, resolvePairingMatch, chFor, playerRoundLine } from './engine/standings.js';
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
      <div class="tip" style="margin-top:12px">${esc(fmtInfo(r.format).explainer)} <b>${rr.pointsAvailable} points in play.</b></div>
      <button class="btn" data-action="enter-scores" data-rid="${r.id}">Enter scores</button>
    </div>
    ${roundBoard(rr)}`;
}

/* round leaderboard (match list) */
function roundBoard(rr) {
  const r = round(rr.roundId);
  return `<div class="card"><h2>Matches</h2>${matchList(rr)}</div>`;
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
    units = ids.map((pid) => {
      const p = player(pid);
      const ch = chFor(S(), p, r);
      const val = getScore(r, pid, h);
      return unitRow({ rid: r.id, target: `player:${pid}`, name: p ? p.name : '?', sdotId: p ? p.squadId : null, ch, val, hole, holes: c.holes.length });
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

function unitRow({ rid, target, name, sdotId, ch, val, hole, holes }) {
  const strokes = Eng.strokesOnHole(ch, hole.si, holes);
  const dots = strokes > 0 ? `<span class="dots">${'•'.repeat(strokes)}</span>` : '';
  const net = val != null ? (Number(val) - strokes) : null;
  const display = val == null ? hole.par : val;
  const under = val != null && Number(val) < hole.par;
  return `<div class="player-score">
    <div class="top">
      <div class="who">${sdot(sdotId)} ${esc(name)} ${dots}</div>
      <div class="net num">CH ${ch}${net != null ? ` · net ${net}` : ''}</div>
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

  return picker + `<div class="card"><h2>${sdot(me.squadId)} ${esc(me.name)} <span class="muted" style="font-weight:400;font-size:14px">· ${squad(me.squadId) ? esc(squad(me.squadId).name) : ''} · index ${me.index}</span></h2>${rows || '<div class="muted">No matchups yet.</div>'}</div>`;
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

  // squads
  html += `<div class="card"><h2>Teams (Squads)</h2>${squadIds().map((sid) => { const s = squad(sid); return `<div class="list-row"><input style="flex:1" data-action="squad-name" data-id="${sid}" value="${esc(s.name)}"><input type="color" style="width:54px;padding:2px" data-action="squad-color" data-id="${sid}" value="${s.color || '#1B7A3D'}"></div>`; }).join('')}</div>`;

  // players
  html += `<div class="card"><h2>Players</h2>
    <table><thead><tr><th>Name</th><th style="width:64px">Index</th><th>Team</th></tr></thead><tbody>
    ${Object.entries(st.players).map(([id, p]) => `<tr>
      <td><input data-action="player-name" data-id="${id}" value="${esc(p.name)}"></td>
      <td><input type="number" step="0.1" data-action="player-index" data-id="${id}" value="${p.index}"></td>
      <td><select data-action="player-squad" data-id="${id}">${squadIds().map((sid) => `<option value="${sid}" ${p.squadId === sid ? 'selected' : ''}>${esc(squad(sid).name)}</option>`).join('')}</select></td>
    </tr>`).join('')}
    </tbody></table>
    <div class="muted" style="font-size:12px;margin-top:8px">Course slope/rating &amp; hole stroke-index are placeholders in the sample — full course editor coming in the next build pass.</div>
  </div>`;

  // rounds (format + course + auto-pair)
  html += `<div class="card"><h2>Rounds</h2>${roundIds().map((id, i) => { const r = round(id); return `<div class="list-row" style="flex-wrap:wrap;gap:8px">
      <input style="flex:1 1 100%" data-action="round-name" data-id="${id}" value="${esc(r.name)}">
      <select style="flex:1" data-action="round-format" data-id="${id}">${Object.keys(FORMAT_INFO).map((f) => `<option value="${f}" ${r.format === f ? 'selected' : ''}>${FORMAT_INFO[f].label}</option>`).join('')}</select>
      <select style="flex:1" data-action="round-course" data-id="${id}">${Object.entries(st.courses).map(([cid, c]) => `<option value="${cid}" ${r.courseId === cid ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}</select>
      <button class="btn secondary small" data-action="auto-pair" data-id="${id}">Auto-pair teams</button>
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
  const rules = roundIds().map((id, i) => { const r = round(id); const f = fmtInfo(r.format); return `<div class="rule"><b>R${i + 1}: ${esc(r.name.replace(/^Round \d+ — /, ''))} — ${f.label}</b><div class="ex">${esc(f.explainer)}</div></div>`; }).join('');
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
  };
  if (set[a]) set[a]();
});

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
