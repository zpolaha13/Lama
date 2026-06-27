/* Headless smoke test: stub a minimal DOM, import the app, drive every view. */
const handlers = {};
const appEl = {
  _html: '',
  set innerHTML(v) { this._html = v; },
  get innerHTML() { return this._html; },
  addEventListener(type, fn) { handlers[type] = fn; },
  closest() { return null; },
};
globalThis.window = globalThis;
globalThis.localStorage = { _d: {}, getItem(k) { return this._d[k] ?? null; }, setItem(k, v) { this._d[k] = v; }, removeItem(k) { delete this._d[k]; } };
globalThis.confirm = () => true;
globalThis.alert = (m) => console.log('alert:', m);
globalThis.Blob = class {}; globalThis.URL = { createObjectURL: () => 'blob:', revokeObjectURL() {} };
const docEl = { _a: {}, getAttribute(k) { return this._a[k] ?? null; }, setAttribute(k, v) { this._a[k] = v; } };
globalThis.document = {
  documentElement: docEl,
  getElementById: (id) => (id === 'app' ? appEl : null),
  createElement: () => ({ style: {}, click() {}, set href(v) {}, set download(v) {} }),
};

let errors = 0;
function fireClick(dataset, extra = {}) {
  const target = { closest: (sel) => (sel === '[data-action]' ? { dataset } : (extra.stop ? { } : null)), dataset };
  try { handlers.click({ preventDefault() {}, target }); } catch (e) { errors++; console.log('CLICK', dataset.action, 'ERR', e.message); }
}
function fireChange(dataset, value) {
  const target = { closest: () => ({ dataset }), dataset, value };
  try { handlers.change({ target }); } catch (e) { errors++; console.log('CHANGE', dataset.action, 'ERR', e.message); }
}
function check(label) {
  const len = appEl.innerHTML.length;
  if (len < 50) { errors++; console.log('RENDER', label, 'too short', len); }
  else console.log('ok', label, 'len', len);
}

await import('../js/app.js');           // boots: renders empty state
check('empty');

fireClick({ action: 'load-sample' });    // loads sample, renders home
check('home');

['standings', 'rounds', 'mycard', 'setup', 'home'].forEach((tab) => { fireClick({ action: 'tab', tab }); check('tab:' + tab); });

// open a round, enter scores, step through holes for all 3 formats
['r1', 'r2', 'r3'].forEach((rid) => {
  fireClick({ action: 'open-round', id: rid }); check('round:' + rid);
  fireClick({ action: 'enter-scores', rid }); check('score:' + rid);
  // step a few holes on whatever targets exist by re-reading rendered html for data-target
  const targets = [...appEl.innerHTML.matchAll(/data-target="([^"]+)"/g)].map((m) => m[1]);
  const uniq = [...new Set(targets)];
  uniq.forEach((tg) => { fireClick({ action: 'setpar', rid, target: tg }); fireClick({ action: 'step', rid, target: tg, dir: '-1' }); });
  fireClick({ action: 'hole', dir: '1' }); check('score-after-step:' + rid);
});

// standings now reflects scores
fireClick({ action: 'tab', tab: 'standings' });
fireClick({ action: 'scope', scope: 'r1' }); check('standings-round');
fireClick({ action: 'scope', scope: 'overall' });
fireClick({ action: 'weight-mode' }); check('weight-toggled');

// my card flow
fireClick({ action: 'tab', tab: 'mycard' });
fireChange({ action: 'pick-me' }, 'p1'); check('me-picked');

// how-it-works sheet
fireClick({ action: 'sheet', sheet: 'how' }); check('sheet');
fireClick({ action: 'close-sheet' });

console.log(errors ? `\nSMOKE FAILED: ${errors} errors` : '\nSMOKE OK');
process.exit(errors ? 1 : 0);
