/* =========================================================================
 * csv.js — Spreadsheet import/export for a whole tournament.
 *
 * One CSV file holds the entire trip, split into #SECTIONS:
 *   #TOURNAMENT  name,winPoints,tiePoints,joinCode
 *   #SQUADS      id,name,color
 *   #PLAYERS     name,index,squad,defaultTee
 *   #COURSES     courseId,courseName,teeName,rating,slope   (one row per tee)
 *   #HOLES       courseId,hole,par,si                       (one row per hole)
 *   #ROUNDS      roundId,name,courseId,format,tee,handicapAllowance,handicapMode,skinsValue
 *   #PAIRINGS    roundId,teamA,teamB                        (players by name, joined with |)
 *
 * toCSV(state)  → string  (also serves as the fill-in template)
 * fromCSV(text) → state   (ready for Store.importJSON)
 * ========================================================================= */
import { emptyState, uid } from '../store.js';

function slug(s) {
  return String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'x';
}

/* ---------------- parse ---------------- */
function parseLine(line) {
  const out = []; let cur = ''; let q = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (q) {
      if (ch === '"') { if (line[i + 1] === '"') { cur += '"'; i++; } else q = false; }
      else cur += ch;
    } else if (ch === '"') q = true;
    else if (ch === ',') { out.push(cur); cur = ''; }
    else cur += ch;
  }
  out.push(cur);
  return out.map((s) => s.trim());
}

function safeColor(c) {
  // colors land in style="" attributes, so only allow hex; reject anything else
  return /^#[0-9a-fA-F]{3,8}$/.test(String(c || '').trim()) ? c.trim() : '#888';
}

function splitSections(text) {
  text = String(text).replace(/^﻿/, ''); // strip UTF-8 BOM (Excel adds one)
  const sections = {}; let cur = null; let header = null;
  text.split(/\r?\n/).forEach((raw) => {
    const line = raw.trim();
    if (!line) return;
    // Section header. Spreadsheets pad rows with trailing commas, so "#PLAYERS"
    // is saved as "#PLAYERS,,,,," — take only the name before the first comma.
    if (line.startsWith('#')) { cur = line.slice(1).split(',')[0].trim().toUpperCase(); sections[cur] = []; header = null; return; }
    if (line.startsWith('//')) return;          // comment lines
    if (!cur) return;
    const cells = parseLine(raw);
    // Skip all-empty rows — spreadsheets write blank separator lines as ",,,,".
    if (cells.every((c) => c == null || String(c).trim() === '')) return;
    if (!header) { header = cells; return; }
    const obj = {}; header.forEach((h, i) => { const k = (h || '').trim(); if (k) obj[k] = (cells[i] != null ? cells[i] : '').trim(); });
    sections[cur].push(obj);
  });
  return sections;
}

export function fromCSV(text, warnings) {
  warnings = warnings || [];
  const S = splitSections(text);
  const st = emptyState();
  st.tournament.roundOrder = [];

  const T = (S.TOURNAMENT || [])[0];
  if (T) {
    if (T.name) st.tournament.name = T.name;
    if (T.winPoints !== '' && T.winPoints != null) st.tournament.winPoints = Number(T.winPoints) || 1;
    if (T.tiePoints !== '' && T.tiePoints != null) st.tournament.tiePoints = Number(T.tiePoints);
    if (T.joinCode) st.tournament.joinCode = T.joinCode;
    if (T.weightMode) st.tournament.weightMode = (T.weightMode.toLowerCase() === 'normalized' || T.weightMode.toLowerCase() === 'equal') ? 'normalized' : 'true';
    if (T.pointsPerRound !== '' && T.pointsPerRound != null) st.tournament.normalizeTarget = Number(T.pointsPerRound) || 4;
  }
  st.tournament.id = slug(st.tournament.name);

  (S.SQUADS || []).forEach((r) => {
    const id = slug(r.id || r.name);
    st.squads[id] = { name: r.name || id, color: safeColor(r.color) };
  });

  (S.PLAYERS || []).forEach((r) => {
    if (!r.name && !r.id) return;
    const id = slug(r.id || r.name);
    if (st.players[id]) warnings.push('Two players map to the same id "' + id + '" (' + (r.name || r.id) + ') — the later one wins. Use distinct names or an id column.');
    st.players[id] = { id, name: r.name || id, index: Number(r.index) || 0, squadId: r.squad ? slug(r.squad) : (Object.keys(st.squads)[0] || ''), defaultTeeId: r.defaultTee || '', ghin: String(r.ghin || '').replace(/[^0-9]/g, '') };
  });

  // payouts
  const P = (S.PAYOUTS || [])[0];
  if (P) {
    const places = [P.place1, P.place2, P.place3].map(Number).filter((x) => !isNaN(x));
    st.payouts = { potPerPlayer: Number(P.potPerPlayer) || 0, places: places.length ? places : [0.6, 0.3, 0.1] };
  }

  // courses + tees; remember name→id so rounds can reference a tee by name
  const teeByName = {}; // `${cid}|${teeNameLower}` → teeId
  (S.COURSES || []).forEach((r) => {
    const cid = slug(r.courseId || r.courseName);
    if (!cid) return;
    if (!st.courses[cid]) st.courses[cid] = { id: cid, name: r.courseName || cid, tees: {}, holes: [] };
    if (r.courseName) st.courses[cid].name = r.courseName;
    if (r.teeName) {
      const tid = cid + '-' + slug(r.teeName);
      st.courses[cid].tees[tid] = { name: r.teeName, rating: Number(r.rating) || 72, slope: Number(r.slope) || 113 };
      teeByName[cid + '|' + r.teeName.toLowerCase()] = tid;
    }
  });

  // holes
  const holeMap = {}; // cid → { num: {par,si} }
  (S.HOLES || []).forEach((r) => {
    const cid = slug(r.courseId); const n = Number(r.hole);
    if (!cid || !n) return;
    (holeMap[cid] = holeMap[cid] || {})[n] = { par: Number(r.par) || 4, si: Number(r.si) || n };
  });
  Object.keys(st.courses).forEach((cid) => {
    const m = holeMap[cid] || {};
    const nums = Object.keys(m).map(Number);
    const count = nums.length ? Math.max.apply(null, nums) : 18;
    const holes = [];
    for (let i = 1; i <= count; i++) holes.push(m[i] || { par: 4, si: i });
    st.courses[cid].holes = holes;
  });

  // rounds + skins
  (S.ROUNDS || []).forEach((r, idx) => {
    const rid = slug(r.roundId || ('r' + (idx + 1)));
    const cid = slug(r.courseId);
    let teeId = '';
    if (r.tee) teeId = teeByName[cid + '|' + String(r.tee).toLowerCase()] || (cid + '-' + slug(r.tee));
    st.rounds[rid] = {
      id: rid, name: r.name || rid, courseId: cid, format: (r.format || 'singles').toLowerCase(),
      defaultTeeId: teeId, date: r.date || '', status: 'auto',
      scoringRule: {
        handicapAllowance: Number(r.handicapAllowance) || 100,
        handicapMode: (r.handicapMode || 'absolute').toLowerCase(),
        pointSystem: String(r.pointSystem || 'match').toLowerCase() === 'holes' ? 'holes' : 'match',
        pointsPerMatch: (r.ptsPerMatch !== '' && r.ptsPerMatch != null) ? Number(r.ptsPerMatch) : 1,
        holePoints: (r.ptsPerHole !== '' && r.ptsPerHole != null) ? Number(r.ptsPerHole) : 0.5,
        matchPoints: (r.ptsMatchBonus !== '' && r.ptsMatchBonus != null) ? Number(r.ptsMatchBonus) : 1,
      },
      pairings: [], scores: {}, teamScores: {}, teeOverrides: {}, teeTimes: [],
    };
    st.tournament.roundOrder.push(rid);
    const val = Number(r.skinsValue || r.skins || 0);
    const mode = String(r.skinsMode || 'net').toLowerCase() === 'gross' ? 'gross' : 'net';
    const tie = String(r.skinsTie || 'rollover').toLowerCase() === 'split' ? 'split' : 'rollover';
    st.skins[rid] = { enabled: val > 0, mode, tie, value: val || 0, allow: 100 };
  });

  // pairings — accept player names or ids, separated by | ; / or ,
  const nameToId = {};
  Object.values(st.players).forEach((p) => { nameToId[p.name.toLowerCase()] = p.id; nameToId[p.id.toLowerCase()] = p.id; });
  const toIds = (cell) => String(cell || '').split(/[|;/]+/).map((x) => x.trim()).filter(Boolean).map((x) => {
    const hit = nameToId[x.toLowerCase()];
    if (!hit) warnings.push('Pairing references "' + x + '", which is not a player in the file.');
    return hit || slug(x);
  });
  (S.PAIRINGS || []).forEach((r) => {
    const rid = slug(r.roundId); const rd = st.rounds[rid];
    if (!rd) { if (r.roundId) warnings.push('Pairing for unknown round "' + r.roundId + '" was skipped.'); return; }
    rd.pairings.push({ id: uid('m'), teamA: toIds(r.teamA), teamB: toIds(r.teamB) });
  });

  // tee times — one group per row: roundId, time, players (by name)
  (S.TEETIMES || []).forEach((g) => {
    const rid = slug(g.roundId); const rd = st.rounds[rid];
    if (!rd) return;
    rd.teeTimes = rd.teeTimes || [];
    rd.teeTimes.push({ time: g.time || '', players: toIds(g.players) });
  });

  return st;
}

/* ---------------- serialise (template + export) ---------------- */
function q(v) {
  v = String(v == null ? '' : v);
  return /[",\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v;
}
function teeName(st, cid, teeId) {
  const c = st.courses[cid];
  if (!c || !teeId || !c.tees[teeId]) return '';
  return c.tees[teeId].name;
}
function playerNames(st, ids) {
  return (ids || []).map((id) => (st.players[id] && st.players[id].name) || id).join('|');
}

export function toCSV(st) {
  const L = [];
  const row = (cells) => L.push(cells.map(q).join(','));
  const order = (st.tournament.roundOrder && st.tournament.roundOrder.length) ? st.tournament.roundOrder : Object.keys(st.rounds);

  L.push('#TOURNAMENT'); L.push('name,winPoints,tiePoints,joinCode,weightMode,pointsPerRound');
  row([st.tournament.name, st.tournament.winPoints, st.tournament.tiePoints, st.tournament.joinCode, st.tournament.weightMode || 'true', st.tournament.normalizeTarget != null ? st.tournament.normalizeTarget : 4]);
  L.push('');

  L.push('#SQUADS'); L.push('id,name,color');
  Object.entries(st.squads).forEach(([id, s]) => row([id, s.name, s.color]));
  L.push('');

  L.push('#PLAYERS'); L.push('name,index,squad,defaultTee,ghin');
  Object.values(st.players).forEach((p) => row([p.name, p.index, p.squadId, p.defaultTeeId || '', p.ghin || '']));
  L.push('');

  const pay = st.payouts || {};
  L.push('#PAYOUTS'); L.push('potPerPlayer,place1,place2,place3');
  row([pay.potPerPlayer || 0, (pay.places || [])[0] || '', (pay.places || [])[1] || '', (pay.places || [])[2] || '']);
  L.push('');

  L.push('#COURSES'); L.push('courseId,courseName,teeName,rating,slope');
  Object.values(st.courses).forEach((c) => Object.values(c.tees).forEach((t) => row([c.id, c.name, t.name, t.rating, t.slope])));
  L.push('');

  L.push('#HOLES'); L.push('courseId,hole,par,si');
  Object.values(st.courses).forEach((c) => (c.holes || []).forEach((h, i) => row([c.id, i + 1, h.par, h.si])));
  L.push('');

  L.push('#ROUNDS'); L.push('roundId,name,courseId,format,tee,handicapAllowance,handicapMode,pointSystem,ptsPerMatch,ptsPerHole,ptsMatchBonus,skinsValue,skinsMode,skinsTie,date');
  order.forEach((rid) => {
    const r = st.rounds[rid]; if (!r) return;
    const sk = st.skins[rid] || {}; const sr = r.scoringRule || {};
    row([rid, r.name, r.courseId, r.format, teeName(st, r.courseId, r.defaultTeeId), sr.handicapAllowance, sr.handicapMode,
      sr.pointSystem || 'match', sr.pointsPerMatch != null ? sr.pointsPerMatch : 1, sr.holePoints != null ? sr.holePoints : 0.5, sr.matchPoints != null ? sr.matchPoints : 1,
      sk.enabled ? sk.value : 0, sk.mode || 'net', sk.tie || 'rollover', r.date || '']);
  });
  L.push('');

  L.push('#PAIRINGS'); L.push('roundId,teamA,teamB');
  order.forEach((rid) => {
    const r = st.rounds[rid]; if (!r) return;
    (r.pairings || []).forEach((p) => row([rid, playerNames(st, p.teamA), playerNames(st, p.teamB)]));
  });
  L.push('');

  L.push('#TEETIMES'); L.push('roundId,time,players');
  order.forEach((rid) => {
    const r = st.rounds[rid]; if (!r) return;
    (r.teeTimes || []).forEach((g) => row([rid, g.time || '', playerNames(st, g.players)]));
  });
  L.push('');

  return L.join('\n');
}
