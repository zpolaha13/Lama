/* =========================================================================
 * store.js — Single source of truth + persistence + live sync (ESM).
 *
 * - localStorage always (offline-first, instant).
 * - Firebase Realtime DB when configured: every mutation writes ONLY the leaf
 *   paths that changed (a computed diff via ref.update), so two phones scoring
 *   different players/holes never clobber each other. Remote changes hydrate
 *   the whole state and re-render.
 * ========================================================================= */
import { firebaseConfig, DEFAULT_TRIP_ID, isFirebaseConfigured } from './config.js';

let LS_KEY = 'golftrip-v2';
let state = emptyState();
let listeners = [];
let fbRef = null;
let online = false;
let activeId = DEFAULT_TRIP_ID;
let fbDb = null;       // firebase database handle (for creating refs)
let indexRef = null;   // shared registry of tournaments
let index = {};        // { tripId: { name, created } }
let creating = false;  // true while we're intentionally seeding a new trip node

export function emptyState() {
  return {
    schemaVersion: 2,
    tournament: {
      id: 'trip', name: 'Golf Trip', joinCode: '',
      winPoints: 1, tiePoints: 0.5,
      weightMode: 'true', normalizeTarget: 4, countBestNofM: null,
      roundOrder: [],
    },
    squads: {},
    players: {},
    courses: {},
    rounds: {},
    skins: {},
    payouts: { potPerPlayer: 0, places: [0.6, 0.3, 0.1] },
    ui: { meId: null },
  };
}

let counter = 0;
export function uid(prefix) {
  counter += 1;
  return (prefix || 'id') + '-' + counter.toString(36) + '-' + Math.random().toString(36).slice(2, 6);
}

export function get() { return state; }
export function isOnline() { return online; }
export function getTripId() { return activeId; }
export function getActiveId() { return activeId; }

export function subscribe(fn) {
  listeners.push(fn);
  return () => { listeners = listeners.filter((l) => l !== fn); };
}
function notify(meta) { listeners.forEach((fn) => { try { fn(state, meta || {}); } catch (e) { console.error(e); } }); }

/* ---- helpers ---- */
function snapshot() { return JSON.parse(JSON.stringify(state)); }

/* Flat map of changed leaf paths between two plain objects.
 * Objects recurse; arrays & primitives are atomic; removed keys -> null.
 * Exported for testing. */
export function diffPaths(oldO, newO, prefix, out) {
  out = out || {};
  const keys = new Set([...Object.keys(oldO || {}), ...Object.keys(newO || {})]);
  for (const k of keys) {
    const a = oldO ? oldO[k] : undefined;
    const b = newO ? newO[k] : undefined;
    const path = prefix ? prefix + '/' + k : k;
    if (b === undefined) { out[path] = null; continue; }
    if (a === undefined) { out[path] = b; continue; }
    const aObj = a && typeof a === 'object' && !Array.isArray(a);
    const bObj = b && typeof b === 'object' && !Array.isArray(b);
    if (aObj && bObj) diffPaths(a, b, path, out);
    else if (JSON.stringify(a) !== JSON.stringify(b)) out[path] = b;
  }
  return out;
}

/* Ensure every player knows its own id (overrides/lookups depend on it). */
function normalize(s) {
  if (s && s.players) Object.keys(s.players).forEach((k) => { if (s.players[k]) s.players[k].id = k; });
  return s;
}

function persistLocal() {
  try { localStorage.setItem(LS_KEY, JSON.stringify(state)); } catch (e) { /* ignore */ }
}

/* ---- mutations ---- */
export function update(mutator) {
  const prevName = state.tournament && state.tournament.name;
  const prev = fbRef ? snapshot() : null;
  mutator(state);
  persistLocal();
  if (fbRef && prev) {
    const diff = diffPaths(prev, state, '', {});
    const keys = Object.keys(diff);
    if (keys.length) fbRef.update(diff).catch((e) => console.warn('sync write failed', e));
  }
  // keep the tournament registry name in sync
  const newName = state.tournament && state.tournament.name;
  if (newName && newName !== prevName) registerInIndex(activeId, newName);
  notify();
}

export function replaceAll(next) {
  state = normalize(Object.assign(emptyState(), next));
  persistLocal();
  if (fbRef) fbRef.set(state).catch((e) => console.warn('sync replace failed', e)); // deliberate full overwrite
  registerInIndex(activeId, state.tournament && state.tournament.name);
  notify();
}

export function exportJSON() { return JSON.stringify(state, null, 2); }
export function importJSON(json) { replaceAll(typeof json === 'string' ? JSON.parse(json) : json); }

/* "Which player am I" is per-DEVICE, not shared. It used to live in the synced
 * state (s.ui.meId), so picking yourself on one phone changed it for everyone.
 * Keep it in localStorage, keyed by tournament id, and never write it to
 * Firebase — each device remembers its own player. */
const ME_KEY = 'golftrip-v2-me';
let meMap = (() => { try { return JSON.parse(localStorage.getItem(ME_KEY) || '{}') || {}; } catch (e) { return {}; } })();
function saveMeMap() { try { localStorage.setItem(ME_KEY, JSON.stringify(meMap)); } catch (e) {} }
export function getMe() { return meMap[activeId] || null; }
export function setMe(playerId) { if (playerId) meMap[activeId] = playerId; else delete meMap[activeId]; saveMeMap(); notify(); }

/* ---- tournaments registry ---- */
function nowStamp() { try { return Date.now(); } catch (e) { return 0; } }
function slug(s) { return String(s || 'trip').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 24) || 'trip'; }
function loadLocalIndex() { try { index = JSON.parse(localStorage.getItem('golftrip-v2-index') || '{}') || {}; } catch (e) { index = {}; } }
function saveLocalIndex() { try { localStorage.setItem('golftrip-v2-index', JSON.stringify(index)); } catch (e) {} }
function registerInIndex(id, name) {
  const prev = index[id];
  const prevName = prev && prev.name;
  const entry = prev || { created: nowStamp() };
  if (name) entry.name = name;
  index[id] = entry;
  saveLocalIndex();
  // only push to the shared registry when it's genuinely new or renamed —
  // otherwise every score sync would rewrite the index and ripple to all devices
  const changed = !prev || (name && name !== prevName);
  if (changed && indexRef) { const patch = {}; patch[id] = entry; indexRef.update(patch).catch(() => {}); }
}

export function listTournaments() {
  return Object.keys(index)
    .map((id) => ({ id, name: (index[id] && index[id].name) || id, created: (index[id] && index[id].created) || 0 }))
    .sort((a, b) => b.created - a.created);
}

function onRemote(snap) {
  const remote = snap.val();
  if (!remote) {
    // The trip node is empty. Two cases:
    //  - we're mid-create and our own set() hasn't landed yet -> wait for it.
    //  - it was DELETED (here or on another device) -> do NOT re-seed it
    //    (that's what resurrected "Golf Trip"). Forget it locally and move to
    //    another tournament so a later local write can't recreate it.
    if (creating) return;
    if (index[activeId]) { delete index[activeId]; saveLocalIndex(); if (indexRef) indexRef.child(activeId).remove().catch(() => {}); }
    try { localStorage.removeItem('golftrip-v2:' + activeId); } catch (e) {}
    const other = listTournaments().find((t) => t.id !== activeId);
    if (other) { openTournament(other.id); return; }
    state = emptyState(); persistLocal(); notify(); // nothing left: clean empty, don't rewrite remote
    return;
  }
  creating = false; // real data exists now
  const next = normalize(Object.assign(emptyState(), remote));
  // this trip is real and current — keep the registry in step (also adds trips
  // opened via a shared link to your list)
  registerInIndex(activeId, next.tournament && next.tournament.name);
  if (JSON.stringify(next) === JSON.stringify(state)) return; // our own echo
  state = next;
  persistLocal();
  notify({ remote: true });
}

/* Open a tournament by id: detach old listener, load its data, attach new.
 * opts.fresh marks an intentional brand-new trip so onRemote's empty-node
 * handler waits for our seed instead of treating it as deleted. */
function openTournament(id, opts) {
  if (fbRef) { try { fbRef.off(); } catch (e) {} fbRef = null; }
  creating = !!(opts && opts.fresh);
  activeId = id;
  LS_KEY = 'golftrip-v2:' + id;
  state = emptyState();
  try { const c = localStorage.getItem(LS_KEY); if (c) state = normalize(Object.assign(emptyState(), JSON.parse(c))); } catch (e) {}
  try { localStorage.setItem('golftrip-v2-active', id); } catch (e) {}
  if (fbDb) {
    fbRef = fbDb.ref('trips/' + id);
    fbRef.on('value', onRemote);
    // online: registration is confirmed by onRemote once real data exists, so a
    // deleted/empty node never re-adds itself to the shared registry on open.
  } else {
    registerInIndex(id, state.tournament && state.tournament.name); // local-only list
  }
  notify();
}

export function switchTournament(id) { if (id && id !== activeId) openTournament(id); }

export function createTournament(opts) {
  const name = (opts && opts.name) || 'New Tournament';
  const mode = (opts && opts.mode) || 'blank';
  const id = slug(name) + '-' + Math.random().toString(36).slice(2, 6);
  let init;
  if (mode === 'import' && opts && opts.data) {
    init = JSON.parse(JSON.stringify(opts.data));
    init.tournament = init.tournament || {};
    init.tournament.name = name;
    init.tournament.id = id;
    openTournament(id, { fresh: true });
    replaceAll(init);
    registerInIndex(id, name);
    return id;
  }
  if (mode === 'copy') {
    init = JSON.parse(JSON.stringify(state)); // duplicate current setup, clear scores
    Object.values(init.rounds || {}).forEach((r) => { r.scores = {}; r.teamScores = {}; r.status = 'auto'; });
    init.ui = { meId: null };
  } else {
    init = emptyState();
    init.squads = { red: { name: 'Red', color: '#D0021B' }, blue: { name: 'Blue', color: '#1B6FB3' } };
  }
  init.tournament.name = name;
  init.tournament.id = id;
  init.tournament.joinCode = '';
  openTournament(id, { fresh: true });   // switch to the (empty) new node
  replaceAll(init);     // write the initial state (local + firebase set)
  registerInIndex(id, name);
  return id;
}

export function deleteTournament(id) {
  delete index[id];
  saveLocalIndex();
  if (indexRef) indexRef.child(id).remove().catch(() => {});
  if (fbDb) fbDb.ref('trips/' + id).remove().catch(() => {});
  try { localStorage.removeItem('golftrip-v2:' + id); } catch (e) {}
  if (id === activeId) {
    const remaining = listTournaments()[0];
    openTournament(remaining ? remaining.id : DEFAULT_TRIP_ID);
  } else {
    notify();
  }
}

/* ---- init ---- */
export function init() {
  loadLocalIndex();

  // firebase (once) — provides fbDb + the shared tournaments index
  const fb = (typeof window !== 'undefined') ? window.firebase : undefined;
  if (isFirebaseConfigured() && fb) {
    try {
      if (!fb.apps || !fb.apps.length) fb.initializeApp(firebaseConfig);
      fbDb = fb.database();
      online = true;
      indexRef = fbDb.ref('tripsIndex');
      indexRef.on('value', (snap) => {
        // Remote registry is authoritative: REPLACE (don't merge) so a delete on
        // any device removes the entry everywhere. Keep only the trip you're
        // actively viewing, which you know exists.
        const v = snap.val() || {};
        const keepActive = index[activeId];
        index = Object.assign({}, v);
        if (keepActive && !index[activeId]) index[activeId] = keepActive;
        saveLocalIndex();
        notify();
      });
    } catch (e) {
      console.warn('Firebase init failed; staying local-only.', e);
      online = false;
    }
  }

  // resolve which tournament to open: ?trip= (explicit link) > last active > default
  let startId = DEFAULT_TRIP_ID;
  try { const last = localStorage.getItem('golftrip-v2-active'); if (last) startId = last; } catch (e) {}
  try { const p = new URLSearchParams(location.search); if (p.get('trip')) startId = p.get('trip'); } catch (e) {}

  openTournament(startId);
}
