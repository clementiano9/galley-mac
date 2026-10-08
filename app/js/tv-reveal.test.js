/* ───────────────────────────────────────────────────────────
   UXF-06 · Reveal in Sidebar  (run: node app/js/tv-reveal.test.js)

   Lifts the REAL revealInSidebar and the UXF-02 helpers it drives
   (rootTreeFor, loadIntoTree, refreshFolder, expandAncestorsTo, …) out of
   tv-app.js and runs them in a vm sandbox against the real tv-tree.js and a
   fake TVNative backed by an in-memory file list — so the lookup → load →
   retry → reveal paths are exercised end to end without a DOM. The row
   scroll/ring itself (revealSidebarRow) is stubbed and its arguments checked;
   the four entry points are covered by source guards.
   ─────────────────────────────────────────────────────────── */
'use strict';

var fs = require('fs');
var path = require('path');
var vm = require('vm');
var TVTree = require('./tv-tree.js');

var pass = 0, fail = 0;
function assert(label, cond, detail) {
  if (cond) { console.log('  PASS  ' + label); pass++; }
  else { console.error('  FAIL  ' + label + (detail !== undefined ? ' — ' + JSON.stringify(detail) : '')); fail++; }
}

var APP = fs.readFileSync(path.join(__dirname, 'tv-app.js'), 'utf8');
var PAL = fs.readFileSync(path.join(__dirname, 'tv-palette.js'), 'utf8');
var NAT = fs.readFileSync(path.join(__dirname, 'tv-native.js'), 'utf8');
var CSS = fs.readFileSync(path.join(__dirname, '..', 'css', 'tv-app.css'), 'utf8');
var LIB = fs.readFileSync(path.join(__dirname, '..', '..', 'tauri-app', 'src-tauri', 'src', 'lib.rs'), 'utf8');

function extractFn(src, name) {
  var start = src.indexOf('function ' + name + '(');
  if (start === -1) throw new Error('extractFn: ' + name + ' not found');
  var depth = 0;
  for (var j = src.indexOf('{', start); j < src.length; j++) {
    if (src[j] === '{') depth++;
    else if (src[j] === '}' && --depth === 0) return src.slice(start, j + 1);
  }
  throw new Error('extractFn: unbalanced ' + name);
}

/* ── a fake disk: a list of markdown file paths ───────────────
   scan(dir, {uncapped}) mimics read_dir_tree: recursive DirNodes, a per-folder
   file cap, and folders listed in `unscanned` come back scanned:false. */
function makeDisk(filePaths, opts) {
  opts = opts || {};
  var disk = { files: filePaths.slice(), unscanned: opts.unscanned || [], cap: opts.cap || 500, calls: [] };
  function build(dirPath, isRoot, cap) {
    var node = { name: dirPath.split('/').pop(), path: dirPath, files: [], filesHidden: 0, folders: [], mdCount: 0, scanned: true };
    if (!isRoot && disk.unscanned.indexOf(dirPath) !== -1) { node.scanned = false; return node; }
    var subs = {};
    disk.files.forEach(function (f) {
      if (f.indexOf(dirPath + '/') !== 0) return;
      var rest = f.slice(dirPath.length + 1).split('/');
      if (rest.length === 1) node.files.push({ name: rest[0], path: f });
      else subs[rest[0]] = true;
    });
    node.files.sort(function (a, b) { return TVTree.naturalCompare(a.name, b.name); });
    node.filesHidden = Math.max(0, node.files.length - cap);
    node.files = node.files.slice(0, cap);
    node.folders = Object.keys(subs).sort(TVTree.naturalCompare).map(function (s) { return build(dirPath + '/' + s, false, cap); });
    node.mdCount = node.files.length + node.filesHidden + node.folders.reduce(function (a, c) { return a + c.mdCount; }, 0);
    if (!node.scanned) node.mdCount = 0;
    return node;
  }
  disk.scan = function (dirPath, o) {
    disk.calls.push({ path: dirPath, uncapped: !!(o && o.uncapped) });
    var root = build(dirPath, true, o && o.uncapped ? 5000 : disk.cap);
    return { path: dirPath, root: root, truncated: false, unreadable: 0 };
  };
  return disk;
}

/* ── the sandbox: real functions, stubbed shell around them ── */
function boot(disk, setup) {
  var log = { toasts: [], announced: [], revealed: [], renders: 0 };
  var state = {
    tabs: [], activeId: null, sidebarOpen: true, sidebarUserToggled: false,
    openFolders: [], folderCollapsed: {}, treeShowEmpty: false, folderMoreLoading: {},
    agentFolders: [], sessionVisibleFolders: {}
  };
  var TVNative = {
    available: true,
    readDirTree: function (p, o) { return Promise.resolve(disk.scan(p, o)); },
    reopenFolder: function (p) {
      return this.readDirTree(p).then(function (t) { t._scannedAt = Date.now(); state.openFolders.push(t); return t; });
    },
    showToast: function (msg) { log.toasts.push(msg); }
  };
  var sandbox = {
    console: console, setTimeout: setTimeout, Promise: Promise, Date: Date, JSON: JSON,
    state: state, TVTree: TVTree, TVNative: TVNative, log: log,
    window: { TVTree: TVTree, TVNative: TVNative, innerHeight: 900 },
    document: { querySelector: function () { return null; } },
    render: function () { log.renders++; },
    sidebarMotionStart: function () { log.motion = (log.motion || 0) + 1; },
    batchRender: function (fn) { return fn(); },
    announce: function (m) { log.announced.push(m); },
    revealSidebarRow: function (itemKey, message, opts) {
      log.revealed.push({ itemKey: itemKey, message: message, opts: opts, collapsed: JSON.parse(JSON.stringify(state.folderCollapsed)) });
      return Promise.resolve({ row: itemKey });
    }
  };
  var src = 'var _folderLoadFailed = {};\nvar REVEAL_MS = ' + (APP.match(/var REVEAL_MS = (\d+);/) || [0, 'NaN'])[1] + ';\n' +
    ['pathBasename', 'rootTreeFor', 'treeRowBudget', 'treeOpts', 'applyDefaultExpansion', 'expandAncestorsTo', 'loadIntoTree',
     'treeSignature', 'refreshFolder', 'revealInSidebar'].map(function (n) { return extractFn(APP, n); }).join('\n');
  vm.runInContext(src, vm.createContext(sandbox), { filename: 'tv-app.reveal-harness.js' });
  if (setup) setup(state, sandbox);
  return { state: state, log: log, reveal: sandbox.revealInSidebar };
}

function tab(id, nativePath, extra) {
  var t = { id: id, name: nativePath ? nativePath.split('/').pop() : 'Untitled.md', nativePath: nativePath || null };
  Object.keys(extra || {}).forEach(function (k) { t[k] = extra[k]; });
  return t;
}
function mount(state, disk, rootPath, collapsed) {
  var t = disk.scan(rootPath);
  t._scannedAt = Date.now();
  state.openFolders.push(t);
  Object.keys(collapsed || {}).forEach(function (k) { state.folderCollapsed[k] = collapsed[k]; });
  disk.calls.length = 0;
  return t;
}

var R_FILES = [
  '/R/top.md', '/R/a/one.md', '/R/a/b/two.md', '/R/a/b/c/F4.md', '/R/z/zz.md'
];

(async function () {
  console.log('\n1-2 · a file in a collapsed branch\n');
  var disk = makeDisk(R_FILES);
  var h = boot(disk, function (st) {
    mount(st, disk, '/R', { '/R/a': true, '/R/a/b': true, '/R/a/b/c': true, '/R/z': true });
    st.tabs = [tab('t1', '/R/a/b/c/F4.md')]; st.activeId = 't1';
  });
  var ok = await h.reveal();
  var rv = h.log.revealed[0] || {};
  assert('resolves true', ok === true);
  assert('every ancestor folder is expanded (explicit false, not deleted)',
    h.state.folderCollapsed['/R/a'] === false && h.state.folderCollapsed['/R/a/b'] === false && h.state.folderCollapsed['/R/a/b/c'] === false,
    h.state.folderCollapsed);
  assert('an unrelated collapsed branch stays collapsed', h.state.folderCollapsed['/R/z'] === true);
  assert('the file row is revealed, centred, with the 1.2 s ring',
    rv.itemKey === 'file:/R/a/b/c/F4.md' && rv.opts.block === 'center' && rv.opts.cls === 'tv-reveal' && rv.opts.ms === 1200, rv);
  assert('ancestors were open BEFORE the row was looked up', rv.collapsed && rv.collapsed['/R/a/b/c'] === false);
  assert('the live region says "Revealed F4.md in R"', h.log.announced.indexOf('Revealed F4.md in R') !== -1, h.log.announced);
  assert('no extra scan was needed', disk.calls.length === 0, disk.calls);

  console.log('\n3-4 · sidebar closed, root head collapsed\n');
  disk = makeDisk(R_FILES);
  h = boot(disk, function (st) {
    mount(st, disk, '/R', { 'root:/R': true });
    st.sidebarOpen = false;
    st.tabs = [tab('t1', '/R/a/one.md')]; st.activeId = 't1';
  });
  await h.reveal();
  assert('the sidebar opens and counts as a user toggle', h.state.sidebarOpen === true && h.state.sidebarUserToggled === true);
  assert('the root head is opened', !h.state.folderCollapsed['root:/R'], h.state.folderCollapsed);
  assert('reveal never seeds the keyboard cursor', extractFn(APP, 'revealInSidebar').indexOf('sbKbd') === -1);

  console.log('\n5 · a file inside an unscanned ("…") folder\n');
  disk = makeDisk(R_FILES, { unscanned: ['/R/a/b'] });
  h = boot(disk, function (st) {
    mount(st, disk, '/R', {});
    st.tabs = [tab('t1', '/R/a/b/c/F4.md')]; st.activeId = 't1';
    disk.unscanned = []; // reading the folder directly works
  });
  ok = await h.reveal();
  assert('that folder is loaded on its own', disk.calls.length === 1 && disk.calls[0].path === '/R/a/b' && !disk.calls[0].uncapped, disk.calls);
  assert('…grafted into the tree, and the file revealed',
    ok === true && h.log.revealed[0].itemKey === 'file:/R/a/b/c/F4.md' && TVTree.findFolderNode(h.state.openFolders[0], '/R/a/b').scanned === true);

  console.log('\n6 · a file beyond its folder\'s file cap\n');
  var many = []; for (var i = 0; i < 12; i++) many.push('/R/big/f' + i + '.md');
  disk = makeDisk(R_FILES.concat(many), { cap: 5 });
  h = boot(disk, function (st) {
    mount(st, disk, '/R', {});
    st.tabs = [tab('t1', '/R/big/f11.md')]; st.activeId = 't1';
  });
  ok = await h.reveal();
  assert('the capped folder is re-read uncapped', disk.calls.length === 1 && disk.calls[0].path === '/R/big' && disk.calls[0].uncapped, disk.calls);
  assert('…and the file revealed', ok === true && h.log.revealed[0].itemKey === 'file:/R/big/f11.md');

  console.log('\n7 · a file created after the scan\n');
  disk = makeDisk(R_FILES);
  h = boot(disk, function (st) {
    mount(st, disk, '/R', {});
    disk.files.push('/R/a/fresh.md');
    st.tabs = [tab('t1', '/R/a/fresh.md')]; st.activeId = 't1';
  });
  ok = await h.reveal();
  assert('one re-scan of the root', disk.calls.length === 1 && disk.calls[0].path === '/R', disk.calls);
  assert('…then revealed', ok === true && h.log.revealed[0].itemKey === 'file:/R/a/fresh.md');
  assert('no error toast', h.log.toasts.length === 0, h.log.toasts);

  console.log('\n8 · a file outside every open folder\n');
  disk = makeDisk(R_FILES.concat(['/Users/me/Downloads/x.md']));
  h = boot(disk, function (st) {
    mount(st, disk, '/R', {});
    st.tabs = [tab('t1', '/Users/me/Downloads/x.md')]; st.activeId = 't1';
  });
  ok = await h.reveal();
  assert('its parent folder mounts as a new root', h.state.openFolders.length === 2 && h.state.openFolders[1].path === '/Users/me/Downloads');
  assert('toast: "Opened Downloads in the sidebar"', h.log.toasts.indexOf('Opened Downloads in the sidebar') !== -1, h.log.toasts);
  assert('…and the file is revealed', ok === true && h.log.revealed[0].itemKey === 'file:/Users/me/Downloads/x.md');

  console.log('\n9 · a tab with no file on disk\n');
  disk = makeDisk(R_FILES);
  h = boot(disk, function (st) {
    mount(st, disk, '/R', {});
    st.sidebarOpen = false;
    st.tabs = [tab('n1', null, { isNew: true })]; st.activeId = 'n1';
  });
  ok = await h.reveal();
  assert('toast "Save the file first to reveal it"', ok === false && h.log.toasts.join() === 'Save the file first to reveal it', h.log.toasts);
  assert('nothing else changes (sidebar stays closed, no render, no scan)',
    h.state.sidebarOpen === false && h.log.renders === 0 && disk.calls.length === 0);

  console.log('\nNot found anywhere\n');
  disk = makeDisk(R_FILES);
  h = boot(disk, function (st) {
    mount(st, disk, '/R', {});
    st.tabs = [tab('t1', '/R/ghost.md')]; st.activeId = 't1';
  });
  ok = await h.reveal();
  assert('one re-scan, then "<name> is not in the folder tree"',
    ok === false && disk.calls.length === 1 && h.log.toasts.indexOf('ghost.md is not in the folder tree') !== -1, h.log.toasts);

  console.log('\n15 · repeating the reveal\n');
  disk = makeDisk(R_FILES.concat(['/Users/me/Downloads/x.md']));
  h = boot(disk, function (st) {
    mount(st, disk, '/R', {});
    st.tabs = [tab('t1', '/Users/me/Downloads/x.md')]; st.activeId = 't1';
  });
  for (var k = 0; k < 10; k++) await h.reveal();
  assert('ten reveals never mount a second root for the same folder', h.state.openFolders.length === 2, h.state.openFolders.map(function (t) { return t.path; }));
  assert('every call reveals the same row', h.log.revealed.length === 10 && h.log.revealed.every(function (r) { return r.itemKey === 'file:/Users/me/Downloads/x.md'; }));

  console.log('\nEntry points and cue (source guards)\n');
  assert('TV.revealInSidebar is exported', /revealInSidebar: revealInSidebar/.test(APP));
  assert('⇧⌘J is matched on e.code with ⌘+⇧ and no ⌥', /e\.code === 'KeyJ' && e\.metaKey && e\.shiftKey && !e\.altKey/.test(APP));
  var jRoute = APP.slice(APP.indexOf("e.code === 'KeyJ'"), APP.indexOf("e.code === 'KeyJ'") + 400);
  assert('⇧⌘J always runs: no focus guard (palette, find field, edit textarea)',
    !/activeElement|closest\(|INPUT|TEXTAREA/.test(jRoute) && /e\.preventDefault\(\);/.test(jRoute));
  var renderSrc = extractFn(APP, 'render');
  var restore = renderSrc.slice(renderSrc.indexOf('if (_savedFindQuery !== null'));
  assert('UXF-06 #14: a repaint keeps the find bar\'s query for the NEXT repaint too (reveal renders more than once)',
    /_openFindBar\(\{ restoring: true \}\);[\s\S]{0,300}?_findQuery = _savedFindQuery;/.test(restore));
  assert('…and its match index', /_findIndex = Math\.min\(_savedFindIndex, _findMatches\.length - 1\)/.test(restore));
  assert('reveal never closes the find bar itself', extractFn(APP, 'revealInSidebar').indexOf('_closeFindBar') === -1);
  assert('reveal never touches the tab\'s mode, dirty flag or text',
    !/setMode|\.mode\s*=|\.dirty\s*=|\.source\s*=|markDirty/.test(extractFn(APP, 'revealInSidebar')));
  assert('⇧⌘J is a quiet no-op in the browser build', /if \(window\.TVNative && TVNative\.available\) revealInSidebar\(\);/.test(APP));
  var ctx = extractFn(APP, 'openTabCtx');
  assert('the tab menu lists Reveal in Sidebar first, above Reveal in Finder',
    ctx.indexOf('data-ctx-action="reveal-sidebar"') !== -1 && ctx.indexOf('reveal-sidebar') < ctx.indexOf('Reveal in Finder'));
  assert('…disabled with its neighbours when the tab has no path',
    /disCls \+ '"' \+ disAttr \+ ' data-ctx-action="reveal-sidebar"/.test(ctx));
  assert('the shortcut overlay lists ⇧⌘J', /\{ keys: \['⇧⌘J'\], action: 'Reveal in sidebar' \}/.test(APP));
  assert('the palette row: kbd ⇧⌘J, need file, native only',
    /id: 'reveal-sidebar', label: 'Reveal in Sidebar'[^}]*kbd: '⇧⌘J'[^}]*need: 'file', native: true/.test(PAL));
  assert('the native menu event routes to TV.revealInSidebar', /listen\('menu:reveal-in-sidebar'[\s\S]{0,160}revealInSidebar\(\)/.test(NAT));
  var view = LIB.slice(LIB.indexOf('"menu:toggle-sidebar"'), LIB.indexOf('"menu:toggle-sidebar"') + 800);
  assert('View ▸ Reveal in Sidebar sits under Toggle Sidebar with ⇧⌘J',
    /"menu:reveal-in-sidebar",\s*"Reveal in Sidebar",\s*true,\s*Some\("CmdOrCtrl\+Shift\+J"\)/.test(view));
  assert('…and its id is in the emit arm', /\| "menu:reveal-in-sidebar"/.test(LIB));
  assert('the cue is an inset ring via box-shadow (not a border), 1.2 s',
    /\.tv-tree-row\.tv-reveal \{ animation: tv-sbreveal var\(--tv-dur-highlight\)/.test(CSS) && /inset 0 0 0 2px var\(--tv-accent\)/.test(CSS));
  assert('reduced motion: the ring shows static, no animation',
    /prefers-reduced-motion: reduce\) \{\s*\.tv-tree-row\.tv-reveal \{ animation: none; box-shadow: inset 0 0 0 2px var\(--tv-accent\); \}/.test(CSS));

  console.log('\n' + (fail === 0 ? 'ALL PASSED' : 'FAILURES: ' + fail) + ' (' + pass + ' passed, ' + fail + ' failed)\n');
  process.exit(fail > 0 ? 1 : 0);
})().catch(function (e) { console.error(e); process.exit(1); });
