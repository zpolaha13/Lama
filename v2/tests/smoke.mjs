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

// skins config + money on a round
fireClick({ action: 'open-round', id: 'r2' });
fireChange({ action: 'skin-enabled', rid: 'r2' }, 'on');
fireChange({ action: 'skin-tie', rid: 'r2' }, 'split');
fireChange({ action: 'skin-mode', rid: 'r2' }, 'gross');
fireChange({ action: 'skin-buyin', rid: 'r2' }, '15');
check('skins-config');
fireClick({ action: 'tab', tab: 'mycard' }); fireChange({ action: 'pick-me' }, 'p1'); check('mycard-money');

// setup: flexible teams + manual matchup editor
fireClick({ action: 'tab', tab: 'setup' }); check('setup');
fireClick({ action: 'add-squad' }); check('add-squad');
fireClick({ action: 'add-player' }); check('add-player');
fireClick({ action: 'add-match', rid: 'r1' }); check('add-match');
// add a player to the new match side A: find an available player id from rendered options
const opt = [...appEl.innerHTML.matchAll(/data-action="madd"[^>]*data-rid="r1"[^>]*data-mid="([^"]+)"[^>]*data-side="A"/g)][0];
if (opt) { /* the select exists; simulate choosing first available */ }
fireClick({ action: 'auto-pair', id: 'r1' }); check('auto-pair-12');
fireChange({ action: 'round-ppm', id: 'r1' }, '2');
fireChange({ action: 'round-hcpallow', id: 'r1' }, '80');
fireChange({ action: 'round-hcpmode', id: 'r1' }, 'relative'); check('round-config');
// course editor + tee selection
fireClick({ action: 'add-course' }); check('add-course');
fireChange({ action: 'tee-rating', cid: 'legacy', id: 'legacy-blue' }, '72.3');
fireChange({ action: 'tee-slope', cid: 'legacy', id: 'legacy-blue' }, '135');
fireChange({ action: 'hole-par', cid: 'legacy', h: '0' }, '5');
fireChange({ action: 'hole-si', cid: 'legacy', h: '0' }, '3');
fireClick({ action: 'add-tee', cid: 'legacy' }); check('course-edit');
fireClick({ action: 'holes-9', cid: 'legacy' }); fireClick({ action: 'holes-18', cid: 'legacy' }); check('holes-toggle');
fireChange({ action: 'round-tee', id: 'r1' }, 'legacy-white'); check('round-tee');
fireChange({ action: 'round-tee-override', rid: 'r1', pid: 'p1' }, 'legacy-blue'); check('tee-override');
fireClick({ action: 'del-player', id: 'p12' }); check('del-player');

// how-it-works sheet
fireClick({ action: 'tab', tab: 'home' });
fireClick({ action: 'sheet', sheet: 'how' }); check('sheet');
fireClick({ action: 'close-sheet' });

console.log(errors ? `\nSMOKE FAILED: ${errors} errors` : '\nSMOKE OK');
process.exit(errors ? 1 : 0);
