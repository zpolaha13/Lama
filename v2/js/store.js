/* =========================================================================
 * store.js — Single source of truth + persistence (ESM).
 * Phase 1: localStorage only (offline-first). Firebase per-path sync lands
 * in Phase 2 behind the same interface.
 * ========================================================================= */

const LS_KEY = 'golftrip-v2';
let state = emptyState();
let listeners = [];

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

export function subscribe(fn) {
  listeners.push(fn);
  return () => { listeners = listeners.filter((l) => l !== fn); };
}
function notify() { listeners.forEach((fn) => { try { fn(state); } catch (e) { console.error(e); } }); }

export function update(mutator) {
  mutator(state);
  persist();
  notify();
}

/* Ensure every player object knows its own id (overrides/lookups depend on it). */
function normalize(s) {
  if (s && s.players) Object.keys(s.players).forEach((k) => { if (s.players[k]) s.players[k].id = k; });
  return s;
}

export function replaceAll(next) {
  state = normalize(Object.assign(emptyState(), next));
  persist();
  notify();
}

function persist() {
  try { localStorage.setItem(LS_KEY, JSON.stringify(state)); } catch (e) { /* ignore */ }
}

export function exportJSON() { return JSON.stringify(state, null, 2); }
export function importJSON(json) { replaceAll(typeof json === 'string' ? JSON.parse(json) : json); }

export function init() {
  try {
    const cached = localStorage.getItem(LS_KEY);
    if (cached) state = normalize(Object.assign(emptyState(), JSON.parse(cached)));
  } catch (e) { /* ignore */ }
  notify();
}

/* convenience: set the "who am I" player (no auth) */
export function setMe(playerId) { update((s) => { s.ui = s.ui || {}; s.ui.meId = playerId; }); }
