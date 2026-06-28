/* Multi-device registry sync test. Mocks a shared Firebase Realtime DB and
 * drives the store's reactions to remote create/delete events to prove that:
 *  - a delete on another device propagates (no stale entry, no resurrection)
 *  - an empty/deleted trip node is never re-seeded
 *  - creating a trip writes through and registers
 * Run: node tests/sync.mjs
 */
let pass = 0, fail = 0;
function ok(cond, msg) { if (cond) pass++; else { fail++; console.log('FAIL', msg); } }

/* ---- mock shared DB ---- */
function deepGet(tree, path) {
  if (!path) return tree.root;
  let cur = tree.root;
  for (const k of path.split('/')) { if (cur == null) return null; cur = cur[k]; }
  return cur === undefined ? null : cur;
}
function deepSet(tree, path, val) {
  const parts = path.split('/'); let cur = tree.root;
  for (let i = 0; i < parts.length - 1; i++) { cur[parts[i]] = cur[parts[i]] || {}; cur = cur[parts[i]]; }
  if (val === null) delete cur[parts[parts.length - 1]]; else cur[parts[parts.length - 1]] = val;
}
function makeDB() {
  const tree = { root: {} };
  const listeners = []; // { path, cb }
  const clone = (v) => (v == null ? v : JSON.parse(JSON.stringify(v)));
  const fireFor = (mutatedPath) => {
    listeners.forEach(({ path, cb }) => {
      if (mutatedPath === path || mutatedPath.startsWith(path + '/') || path.startsWith(mutatedPath + '/') || path === '') {
        cb({ val: () => clone(deepGet(tree, path)) });
      }
    });
  };
  function ref(path) {
    return {
      path,
      on(_evt, cb) { listeners.push({ path, cb }); cb({ val: () => clone(deepGet(tree, path)) }); },
      off() { for (let i = listeners.length - 1; i >= 0; i--) if (listeners[i].path === path) listeners.splice(i, 1); },
      set(val) { deepSet(tree, path, clone(val)); fireFor(path); return Promise.resolve(); },
      update(obj) { Object.keys(obj).forEach((k) => deepSet(tree, path + '/' + k, clone(obj[k]))); fireFor(path); return Promise.resolve(); },
      remove() { deepSet(tree, path, null); fireFor(path); return Promise.resolve(); },
      child(id) { return ref(path + '/' + id); },
    };
  }
  return { _tree: tree, ref, raw: (p) => deepGet(tree, p) };
}

/* ---- environment ---- */
const db = makeDB();
globalThis.localStorage = { _d: {}, getItem(k) { return this._d[k] ?? null; }, setItem(k, v) { this._d[k] = v; }, removeItem(k) { delete this._d[k]; } };
const mockFb = { apps: [], initializeApp() { this.apps.push({}); }, database() { return db; } };
globalThis.window = { firebase: mockFb };

// seed the shared DB with two existing tournaments, as if other devices made them
const minimal = (name) => ({ schemaVersion: 2, tournament: { id: 't', name }, squads: { red: { name: 'Red' } }, players: {}, courses: {}, rounds: {}, skins: {}, payouts: {}, ui: {} });
db.ref('tripsIndex').set({ t1: { name: 'Trip One', created: 1 }, t2: { name: 'Trip Two', created: 2 } });
db.ref('trips/t1').set(minimal('Trip One'));
db.ref('trips/t2').set(minimal('Trip Two'));
globalThis.localStorage.setItem('golftrip-v2-active', 't1');

const Store = await import('../js/store.js');
Store.init();

ok(Store.getActiveId() === 't1', 'opens last-active t1');
ok(Store.listTournaments().length === 2, 'sees both tournaments from shared index');

// another device deletes t1 — the one we are actively viewing. We must move to
// the surviving trip and NOT re-seed the deleted node.
db.ref('tripsIndex').child('t1').remove();
db.ref('trips/t1').remove();
ok(db.raw('trips/t1') == null, 'deleted active trip is NOT re-seeded (no resurrection)');
ok(Store.getActiveId() === 't2', 'navigated to the surviving trip t2');
ok(Store.listTournaments().some((t) => t.id === 't1') === false, 'remote delete of t1 propagates to the list');

// another device deletes t2 too — now the active, and the last one
db.ref('tripsIndex').child('t2').remove();
db.ref('trips/t2').remove();
ok(db.raw('trips/t2') == null, 'deleting the last active trip does not re-seed it');

// create a fresh tournament: writes through to the shared DB and registers
const newId = Store.createTournament({ name: 'Fresh Cup', mode: 'blank' });
ok(db.raw('trips/' + newId) != null, 'created trip is written to the shared DB');
ok(db.raw('trips/' + newId).tournament.name === 'Fresh Cup', 'created trip has the right name');
ok(Store.listTournaments().some((t) => t.id === newId), 'created trip appears in the registry');
// the create did not resurrect t1
ok(db.raw('trips/t1') == null, 'creating a new trip did not resurrect the deleted one');

console.log(`\nSYNC ${fail ? 'FAILED' : 'OK'}  PASS ${pass}  FAIL ${fail}`);
process.exit(fail ? 1 : 0);
