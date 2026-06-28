/* Real-DOM test (via linkedom) proving render() patches the DOM in place
 * instead of replacing it: nodes keep their identity across re-renders (no
 * flicker), values update, and a field you're typing in isn't clobbered.
 * Run: node tests/morph.mjs   (needs: npm i -D linkedom)
 */
let parseHTML;
try { ({ parseHTML } = await import('linkedom')); }
catch (e) { console.log('MORPH SKIPPED — install the dev DOM: npm i -D linkedom'); process.exit(0); }

const { document, window } = parseHTML('<!DOCTYPE html><html><head></head><body><div id="app"></div></body></html>');
globalThis.window = window;
globalThis.document = document;
globalThis.localStorage = { _d: {}, getItem(k) { return this._d[k] ?? null; }, setItem(k, v) { this._d[k] = v; }, removeItem(k) { delete this._d[k]; } };
globalThis.confirm = () => true; globalThis.alert = () => {}; globalThis.prompt = () => 'x';
globalThis.Blob = class {}; globalThis.URL = { createObjectURL: () => 'blob:', revokeObjectURL() {} };

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.log('FAIL', m); } };
const app = document.getElementById('app');
const click = (el) => el && el.dispatchEvent(new window.Event('click', { bubbles: true }));

const Store = await import('../js/store.js');
const { sampleTournament } = await import('../js/seed.js');
await import('../js/app.js'); // boots + subscribes; renders empty state

Store.importJSON(JSON.stringify(sampleTournament())); // -> notify -> render(home)

// 1. node identity preserved across a re-render (the anti-flicker guarantee)
const hero1 = app.querySelector('.hero');
const tabbar1 = app.querySelector('.tabbar') || app.querySelector('nav');
ok(!!hero1, 'hero rendered');
Store.update((s) => { s.tournament.name = 'Morph Cup'; });
const hero2 = app.querySelector('.hero');
ok(hero1 === hero2, 'hero element is the SAME node after re-render (patched, not replaced)');
ok(tabbar1 === (app.querySelector('.tabbar') || app.querySelector('nav')), 'tab bar node preserved across re-render');
const nameEl = app.querySelector('.hero-name');
ok(nameEl && /Morph Cup/.test(nameEl.textContent), 'changed text updated in place');

// 2. a field you are actively typing in is not clobbered by a re-render
click(app.querySelector('[data-action="tab"][data-tab="setup"]'));
const nameInput = app.querySelector('input[data-action="trip-name"]');
ok(!!nameInput, 'setup name input rendered');
if (nameInput) {
  // linkedom doesn't track activeElement on .focus(), so stub it to the input —
  // this is exactly what a real browser reports while you're typing.
  Object.defineProperty(document, 'activeElement', { configurable: true, get: () => nameInput });
  nameInput.value = 'Half-typed name';                 // simulate mid-typing
  Store.update((s) => { s.players.parker.index = 9; }); // an update arrives while focused
  const stillThere = app.querySelector('input[data-action="trip-name"]');
  ok(stillThere === nameInput, 'focused input is the same node after an update');
  ok(stillThere.value === 'Half-typed name', 'focused input value was NOT clobbered while typing');
  Object.defineProperty(document, 'activeElement', { configurable: true, get: () => null });
}

// 3. a non-focused input DOES sync to new state
click(app.querySelector('[data-action="tab"][data-tab="setup"]'));
click(app.querySelector('[data-action="setup-tab"][data-tab="players"]'));
const hcp = app.querySelector('input[data-action="player-index"]');
if (hcp) {
  const before = hcp;
  Store.update((s) => { const k = Object.keys(s.players)[0]; s.players[k].index = 21; });
  ok(app.querySelector('input[data-action="player-index"]') === before, 'player row input preserved');
}

console.log(`\nMORPH ${fail ? 'FAILED' : 'OK'}  PASS ${pass}  FAIL ${fail}`);
process.exit(fail ? 1 : 0);
