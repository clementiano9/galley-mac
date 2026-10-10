/* ───────────────────────────────────────────────────────────
   Galley · icon coverage
   Every icon the UI asks for (icons.<name> / ic('<name>')) must exist in
   tv-icons.js or tv-app.js's augment block — a missing key renders an empty
   slot silently (the tab / file "Copy Path" item had no icon until 2026-10-09).
   Context-menu items must not ship a deliberately empty icon slot.
   ─────────────────────────────────────────────────────────── */
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

let pass = 0, fail = 0;
function check(label, cond, detail) {
  if (cond) { pass++; console.log('PASS  ' + label); }
  else { fail++; console.log('FAIL  ' + label + (detail ? ' — ' + detail : '')); }
}

const read = (f) => fs.readFileSync(path.join(__dirname, f), 'utf8');
const sandbox = { window: {} };
vm.createContext(sandbox);
vm.runInContext(read('tv-icons.js'), sandbox);
const defined = new Set(Object.keys(sandbox.window.TV_ICONS));
const APP = read('tv-app.js');
(APP.match(/if \(!I\.([a-zA-Z]+)\)/g) || []).forEach((m) => defined.add(m.slice(7, -1)));

const used = new Map();
['tv-app.js', 'tv-palette.js', 'tv-search.js', 'tv-tree.js', 'tv-live.js', 'tv-native.js'].forEach((f) => {
  const src = read(f);
  const re = /(?<![-\w])icons\.([a-zA-Z]+)\b|\bic\('([a-zA-Z]+)'\)/g;
  let m;
  while ((m = re.exec(src))) {
    const name = m[1] || m[2];
    if (!used.has(name)) used.set(name, f);
  }
});
used.forEach((file, name) => check('icon "' + name + '" (' + file + ') is defined', defined.has(name)));

for (const name of ['copy', 'expandAll', 'collapseAll', 'eye', 'eyeOff', 'closeOthers', 'closeAll']) {
  check('icon "' + name + '" is a currentColor SVG', /^<svg[\s\S]*currentColor[\s\S]*<\/svg>$/.test(sandbox.window.TV_ICONS[name] || ''));
}

const emptySlots = (APP.match(/class="tv-ctx-item[^"]*"[^']*'\s*\+\s*'<span class="ic"><\/span>/g) || []).length +
  (APP.match(/'<span class="ic"><\/span> [A-Z]/g) || []).length;
check('no context-menu item has an empty icon slot', emptySlots === 0, emptySlots + ' found');

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
