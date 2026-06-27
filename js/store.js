/* =========================================================================
 * store.js — Single source of truth for trip data + persistence.
 *
 * - Holds the whole trip in one `state` object.
 * - Persists to Firebase Realtime Database when configured (live multi-device
 *   sync), otherwise to localStorage (single device / offline).
 * - Notifies subscribers on every change so the UI can re-render.
 *
 * Concurrency note: with Firebase, remote updates overwrite local state and
 * trigger a re-render. Writes are debounced and last-write-wins at the
 * top-level keys, which is fine for a casual golf-trip scale.
 * ========================================================================= */

(function (global) {
  'use strict';

  const Store = {};
  const LS_KEY = 'golftrip:' + (global.APP_CONFIG ? global.APP_CONFIG.TRIP_ID : 'default');

  let state = emptyState();
  let listeners = [];
  let fbRef = null;
  let saveTimer = null;
  let applyingRemote = false;

  function emptyState() {
    return {
      meta: { name: 'Guys Golf Trip', updatedAt: 0 },
      courses: [],
      teams: [],
      players: [],
      rounds: [],
      payouts: [],
    };
  }

  function uid(prefix) {
    return (prefix || 'id') + '-' + Math.random().toString(36).slice(2, 9) + '-' + (state.meta.updatedAt % 100000);
  }
  Store.uid = uid;

  /* ---------------- subscription ---------------- */
  Store.subscribe = function (fn) {
    listeners.push(fn);
    return function () {
      listeners = listeners.filter((l) => l !== fn);
    };
  };
  function notify() {
    listeners.forEach((fn) => {
      try {
        fn(state);
      } catch (e) {
        console.error('listener error', e);
      }
    });
  }

  /* ---------------- access ---------------- */
  Store.get = function () {
    return state;
  };

  /* Mutate via a function, then persist + notify. */
  Store.update = function (mutator) {
    mutator(state);
    state.meta.updatedAt = stamp();
    persist();
    notify();
  };

  // Avoids Date.now in case it's restricted in some sandboxes; falls back.
  function stamp() {
    try {
      return Date.now();
    } catch (e) {
      return (state.meta.updatedAt || 0) + 1;
    }
  }

  Store.replaceAll = function (newState) {
    state = Object.assign(emptyState(), newState);
    notify();
  };

  /* ---------------- persistence ---------------- */
  function persist() {
    if (applyingRemote) return;
    // localStorage (always, as a cache/fallback)
    try {
      localStorage.setItem(LS_KEY, JSON.stringify(state));
    } catch (e) {
      /* quota or private mode — ignore */
    }
    // Firebase (debounced)
    if (fbRef) {
      clearTimeout(saveTimer);
      saveTimer = setTimeout(function () {
        fbRef.set(state).catch((e) => console.warn('firebase save failed', e));
      }, 300);
    }
  }

  Store.exportJSON = function () {
    return JSON.stringify(state, null, 2);
  };
  Store.importJSON = function (json) {
    const parsed = typeof json === 'string' ? JSON.parse(json) : json;
    Store.replaceAll(parsed);
    persist();
  };

  /* ---------------- init ---------------- */
  Store.init = function () {
    // load local cache first for instant paint
    try {
      const cached = localStorage.getItem(LS_KEY);
      if (cached) state = Object.assign(emptyState(), JSON.parse(cached));
    } catch (e) {
      /* ignore */
    }

    const cfg = global.APP_CONFIG;
    if (cfg && cfg.firebaseEnabled && global.firebase) {
      try {
        if (!firebase.apps || !firebase.apps.length) firebase.initializeApp(cfg.firebase);
        const path = 'trips/' + cfg.TRIP_ID;
        fbRef = firebase.database().ref(path);

        fbRef.on('value', function (snap) {
          const remote = snap.val();
          if (remote) {
            applyingRemote = true;
            state = Object.assign(emptyState(), remote);
            applyingRemote = false;
            try {
              localStorage.setItem(LS_KEY, JSON.stringify(state));
            } catch (e) {}
            notify();
          } else {
            // first time — seed remote with whatever we have locally
            fbRef.set(state).catch(() => {});
          }
        });
        Store.online = true;
      } catch (e) {
        console.warn('Firebase init failed, using local storage only.', e);
        Store.online = false;
      }
    } else {
      Store.online = false;
    }

    notify();
  };

  Store.online = false;

  global.Store = Store;
})(typeof window !== 'undefined' ? window : this);
