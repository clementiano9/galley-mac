/* ───────────────────────────────────────────────────────────
   tv-app.js Recent-store node tests
   (run with: node app/js/tv-recent-store.test.js)

   ISS-FOLDER — the Recent store now holds FILES and FOLDERS,
   distinguished by a `type` field, deduped by (path, type), and
   capped per-type so neither kind evicts the other.

   The store functions live inside the tv-app.js IIFE and are not
   exported, so we extract their exact source slice (RECENT_KEY …
   removeRecentEntry) and evaluate it against an injected fake
   `localStorage` + `state`. This exercises the REAL code, not a
   re-implementation — if the source drifts, this test re-slices by
   the same anchors and breaks loudly.
   ─────────────────────────────────────────────────────────── */
'use strict';

var fs = require('fs');
var path = require('path');

var pass = 0;
var fail = 0;
function assert(label, condition, detail) {
  if (condition) { console.log('  PASS  ' + label); pass++; }
  else { console.error('  FAIL  ' + label + (detail ? ' — ' + detail : '')); fail++; }
}

// ── Extract the store slice from tv-app.js source ───────────────────────────
var SRC = fs.readFileSync(path.join(__dirname, 'tv-app.js'), 'utf8');

function sliceBetween(src, startAnchor, endAnchorLineStart) {
  var start = src.indexOf(startAnchor);
  if (start === -1) throw new Error('start anchor not found: ' + startAnchor);
  var end = src.indexOf(endAnchorLineStart, start);
  if (end === -1) throw new Error('end anchor not found: ' + endAnchorLineStart);
  return src.slice(start, end);
}

// From `var RECENT_KEY` up to (but not including) `function relativeTime`.
var storeSrc = sliceBetween(SRC, 'var RECENT_KEY', '  // Compact "time ago" label');

// Build a sandbox: inject fake localStorage + state, evaluate the slice, and
// return the store functions. Each call gets a fresh, isolated store.
function makeStore(initialRaw) {
  var store = Object.create(null);
  if (initialRaw !== undefined) store['tv-recent-files'] = initialRaw;
  var localStorage = {
    getItem: function (k) { return (k in store) ? store[k] : null; },
    setItem: function (k, v) { store[k] = String(v); },
    removeItem: function (k) { delete store[k]; },
  };
  var state = { tabs: [] };

  // eslint-disable-next-line no-new-func
  var factory = new Function('localStorage', 'state',
    storeSrc +
    '\nreturn {' +
    '  loadRecentEntries: loadRecentEntries,' +
    '  loadRecentPaths: loadRecentPaths,' +
    '  saveRecentPath: saveRecentPath,' +
    '  saveRecentFolder: saveRecentFolder,' +
    '  removeRecentEntry: removeRecentEntry,' +
    '  _raw: function () { return localStorage.getItem("tv-recent-files"); },' +
    '  _state: state' +
    '};'
  );
  return factory(localStorage, state);
}

/* ── (a) type round-trip: folder + file both persist with their type ──────── */
console.log('\n(a) type round-trip (save folder + file → load preserves type)\n');

(function () {
  var s = makeStore();
  s.saveRecentFolder('/proj');
  s.saveRecentPath('/proj/readme.md');

  var entries = s.loadRecentEntries();
  var folder = entries.filter(function (e) { return e.type === 'folder'; });
  var file = entries.filter(function (e) { return e.type === 'file'; });

  assert('one folder entry persisted', folder.length === 1, 'got ' + folder.length);
  assert('folder entry has type:folder', folder[0] && folder[0].type === 'folder');
  assert('folder entry path preserved', folder[0] && folder[0].path === '/proj');
  // saveRecentFolder writes no scrollTop; loadRecentEntries normalizes the
  // missing field to 0 (harmless for folders — never read for a folder reopen).
  assert('folder entry scrollTop normalized to 0', folder[0] && folder[0].scrollTop === 0);

  // saveRecentFolder itself writes NO scrollTop key (checked on a clean store,
  // before any loadRecentEntries normalization can bake a 0 in).
  var sClean = makeStore();
  sClean.saveRecentFolder('/only');
  var rawFolder = JSON.parse(sClean._raw())[0];
  assert('saveRecentFolder writes no scrollTop key', rawFolder && !('scrollTop' in rawFolder));
  assert('saveRecentFolder writes type:folder on disk', rawFolder && rawFolder.type === 'folder');

  assert('one file entry persisted', file.length === 1, 'got ' + file.length);
  assert('file entry has type:file', file[0] && file[0].type === 'file');
  assert('file entry path preserved', file[0] && file[0].path === '/proj/readme.md');
}());

/* ── (b) folder & file at the SAME path coexist (dedup by (path,type)) ─────── */
console.log('\n(b) same-path folder + file coexist (dedup keyed on (path,type))\n');

(function () {
  var s = makeStore();
  s.saveRecentPath('/x');      // file at /x
  s.saveRecentFolder('/x');    // folder at /x — must NOT evict the file

  var entries = s.loadRecentEntries();
  var atX = entries.filter(function (e) { return e.path === '/x'; });
  assert('both a file and a folder entry exist at /x', atX.length === 2, 'got ' + atX.length);
  assert('one is type file', atX.some(function (e) { return e.type === 'file'; }));
  assert('one is type folder', atX.some(function (e) { return e.type === 'folder'; }));

  // re-saving the same folder dedups (still 1 folder, file untouched)
  s.saveRecentFolder('/x');
  var entries2 = s.loadRecentEntries();
  var folders2 = entries2.filter(function (e) { return e.path === '/x' && e.type === 'folder'; });
  var files2 = entries2.filter(function (e) { return e.path === '/x' && e.type === 'file'; });
  assert('re-saving folder dedups to one folder entry', folders2.length === 1, 'got ' + folders2.length);
  assert('re-saving folder leaves the file entry intact', files2.length === 1, 'got ' + files2.length);
}());

/* ── (c) legacy entries default to type:'file' (back-compat, no migration) ── */
console.log('\n(c) legacy migration → type defaults to file\n');

(function () {
  // legacy string[] format
  var sStr = makeStore(JSON.stringify(['/old/a.md', '/old/b.md']));
  var strEntries = sStr.loadRecentEntries();
  assert('legacy string[] → 2 entries', strEntries.length === 2, 'got ' + strEntries.length);
  assert('legacy string[] entries default to type:file',
    strEntries.every(function (e) { return e.type === 'file'; }));
  assert('legacy string[] entries get ts:0', strEntries.every(function (e) { return e.ts === 0; }));

  // legacy typeless object format
  var sObj = makeStore(JSON.stringify([{ path: '/o/c.md', ts: 123, scrollTop: 40 }]));
  var objEntries = sObj.loadRecentEntries();
  assert('legacy typeless object → type defaults to file', objEntries[0].type === 'file');
  assert('legacy typeless object keeps ts', objEntries[0].ts === 123);
  assert('legacy typeless object keeps scrollTop', objEntries[0].scrollTop === 40);

  // an object explicitly typed folder is preserved (the regression this guards)
  var sFold = makeStore(JSON.stringify([{ path: '/d', ts: 9, type: 'folder' }]));
  assert('explicit folder type survives a load round-trip',
    sFold.loadRecentEntries()[0].type === 'folder');
}());

/* ── (d) loadRecentPaths returns FILE paths only (folders excluded) ───────── */
console.log('\n(d) loadRecentPaths excludes folders\n');

(function () {
  var s = makeStore();
  s.saveRecentFolder('/proj');
  s.saveRecentPath('/proj/a.md');
  s.saveRecentPath('/proj/b.md');

  var paths = s.loadRecentPaths();
  assert('loadRecentPaths excludes the folder', paths.indexOf('/proj') === -1);
  assert('loadRecentPaths includes both files',
    paths.indexOf('/proj/a.md') !== -1 && paths.indexOf('/proj/b.md') !== -1);
  assert('loadRecentPaths returns exactly the 2 files', paths.length === 2, 'got ' + paths.length);
}());

/* ── (e) removeRecentEntry drops only the matching (path,type) ────────────── */
console.log('\n(e) removeRecentEntry by (path,type)\n');

(function () {
  var s = makeStore();
  s.saveRecentPath('/x');      // file /x
  s.saveRecentFolder('/x');    // folder /x
  s.saveRecentFolder('/y');    // folder /y

  s.removeRecentEntry('/x', 'folder'); // drop only the folder at /x
  var entries = s.loadRecentEntries();
  assert('folder /x removed', !entries.some(function (e) { return e.path === '/x' && e.type === 'folder'; }));
  assert('file /x preserved', entries.some(function (e) { return e.path === '/x' && e.type === 'file'; }));
  assert('folder /y preserved', entries.some(function (e) { return e.path === '/y' && e.type === 'folder'; }));

  // default type is 'folder' when omitted
  s.removeRecentEntry('/y');
  assert('removeRecentEntry defaults to folder type',
    !s.loadRecentEntries().some(function (e) { return e.path === '/y'; }));
}());

/* ── (f) per-type cap: a burst of files never evicts folders ──────────────── */
console.log('\n(f) per-type cap keeps folders alive under a file burst\n');

(function () {
  var s = makeStore();
  s.saveRecentFolder('/folder-keep');
  for (var i = 0; i < 40; i++) { s.saveRecentPath('/burst/f' + i + '.md'); }

  var entries = s.loadRecentEntries();
  var folders = entries.filter(function (e) { return e.type === 'folder'; });
  var files = entries.filter(function (e) { return e.type === 'file'; });
  assert('the folder survived a 40-file burst', folders.length === 1 && folders[0].path === '/folder-keep');
  assert('files are capped at RECENT_MAX (20)', files.length === 20, 'got ' + files.length);
}());

// ── Report ─────────────────────────────────────────────────────────────────
console.log('\n' + (fail === 0 ? 'ALL PASSED' : 'FAILURES: ' + fail) +
  ' (' + pass + ' passed, ' + fail + ' failed)\n');

if (fail > 0) process.exit(1);
