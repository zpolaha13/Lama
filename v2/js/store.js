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
let tripId = DEFAULT_TRIP_ID;

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
export function getTripId() { return tripId; }

export function subscribe(fn) {
  listeners.push(fn);
  return () => { listeners = listeners.filter((l) => l !== fn); };
}
function notify() { listeners.forEach((fn) => { try { fn(state); } catch (e) { console.error(e); } }); }

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
  const prev = fbRef ? snapshot() : null;
  mutator(state);
  persistLocal();
  if (fbRef && prev) {
    const diff = diffPaths(prev, state, '', {});
    const keys = Object.keys(diff);
    if (keys.length) fbRef.update(diff).catch((e) => console.warn('sync write failed', e));
  }
  notify();
}

export function replaceAll(next) {
  state = normalize(Object.assign(emptyState(), next));
  persistLocal();
  if (fbRef) fbRef.set(state).catch((e) => console.warn('sync replace failed', e)); // deliberate full overwrite
  notify();
}

export function exportJSON() { return JSON.stringify(state, null, 2); }
export function importJSON(json) { replaceAll(typeof json === 'string' ? JSON.parse(json) : json); }
export function setMe(playerId) { update((s) => { s.ui = s.ui || {}; s.ui.meId = playerId; }); }

/* ---- init ---- */
export function init() {
  // resolve trip id (URL override) before keying local cache
  try {
    const p = new URLSearchParams(location.search);
    if (p.get('trip')) tripId = p.get('trip');
  } catch (e) { /* no location (tests) */ }
  LS_KEY = 'golftrip-v2:' + tripId;

  try {
    const cached = localStorage.getItem(LS_KEY);
    if (cached) state = normalize(Object.assign(emptyState(), JSON.parse(cached)));
  } catch (e) { /* ignore */ }

  const fb = (typeof window !== 'undefined') ? window.firebase : undefined;
  if (isFirebaseConfigured() && fb) {
    try {
      if (!fb.apps || !fb.apps.length) fb.initializeApp(firebaseConfig);
      fbRef = fb.database().ref('trips/' + tripId);
      fbRef.on('value', (snap) => {
        const remote = snap.val();
        if (!remote) { fbRef.set(state).catch(() => {}); return; } // seed empty trip with local
        const next = normalize(Object.assign(emptyState(), remote));
        if (JSON.stringify(next) === JSON.stringify(state)) return; // our own echo
        state = next;
        persistLocal();
        notify();
      });
      online = true;
    } catch (e) {
      console.warn('Firebase init failed; staying local-only.', e);
      online = false;
    }
  }
  notify();
}
