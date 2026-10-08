/* ───────────────────────────────────────────────────────────
   UXF-02 / UXF-03 / UXF-06 · folder tree logic  (run: node app/js/tv-tree-uxf.test.js)

   Pure tv-tree.js functions on the recursive DirTree shape read_dir_tree now
   returns: ordering (folders first, natural sort), counts and "…" folders,
   hidden empty folders, the 30-row default expansion, subtree keys for
   ⌥-click / Expand All, lazy-load grafting, and the reveal lookup.
   ─────────────────────────────────────────────────────────── */
'use strict';

var T = require('./tv-tree.js');

var pass = 0, fail = 0;
function assert(label, cond, detail) {
  if (cond) { console.log('  PASS  ' + label); pass++; }
  else { console.error('  FAIL  ' + label + (detail !== undefined ? ' — ' + JSON.stringify(detail) : '')); fail++; }
}

// DirNode builder: names → files; children are DirNodes; mdCount is computed.
function dir(path, fileNames, folders, extra) {
  var files = (fileNames || []).map(function (n) { return { name: n, path: path + '/' + n }; });
  folders = folders || [];
  var n = { name: path.split('/').pop(), path: path, files: files, filesHidden: 0, folders: folders, scanned: true };
  Object.keys(extra || {}).forEach(function (k) { n[k] = extra[k]; });
  var count = n.scanned === false ? 0 : files.length + n.filesHidden;
  folders.forEach(function (f) { count += f.mdCount; });
  n.mdCount = n.scanned === false ? 0 : count;
  return n;
}
function tree(path, root) { return { path: path, root: root, truncated: false, unreadable: 0 }; }
function names(nodes, kind) { return nodes.filter(function (n) { return !kind || n.kind === kind; }).map(function (n) { return n.name; }); }
function files(n) { var a = []; for (var i = 0; i < n; i++) a.push('f' + i + '.md'); return a; }

console.log('\nUXF-02/03 · order: folders first, natural, case-insensitive\n');
(function () {
  var t = tree('/r', dir('/r', ['c.md', 'a10.md', 'B.md', 'a2.md'], [
    dir('/r/Zeta', ['z.md']), dir('/r/alpha', ['x.md']), dir('/r/f10', ['y.md']), dir('/r/f2', ['w.md'])
  ]));
  var nodes = T.buildTreeNodes(t, {});
  var level1 = nodes.filter(function (n) { return n.depth === 1; });
  var lastFolder = -1, firstFile = Infinity;
  level1.forEach(function (n, i) { if (n.kind === 'folder') lastFolder = Math.max(lastFolder, i); else firstFile = Math.min(firstFile, i); });
  // Each expanded folder emits its children (depth 2) between level-1 rows, so
  // compare positions among the level-1 rows only.
  assert('no level-1 file precedes a level-1 folder', lastFolder < firstFile, { lastFolder: lastFolder, firstFile: firstFile });
  assert('folders: alpha, f2, f10, Zeta', names(level1, 'folder').join() === 'alpha,f2,f10,Zeta', names(level1, 'folder'));
  assert('files: a2, a10, B, c', names(level1, 'file').join() === 'a2.md,a10.md,B.md,c.md', names(level1, 'file'));
  assert('naturalCompare: a2 < a10 < B', T.naturalCompare('a2', 'a10') < 0 && T.naturalCompare('a10', 'B') < 0);
  assert('naturalCompare is total for case-only twins', T.naturalCompare('Alpha', 'alpha') !== 0);
})();

console.log('\nUXF-03 · counts, "…" folders, the per-folder "more" row\n');
(function () {
  var t = tree('/r', dir('/r', ['top.md'], [
    dir('/r/docs', ['a.md', 'b.md'], [dir('/r/docs/deep', ['c.md'])]),
    dir('/r/later', [], [], { scanned: false }),
    dir('/r/big', files(3), [], { filesHidden: 300 })
  ]));
  var nodes = T.buildTreeNodes(t, { '/r/later': false });
  var head = nodes[0];
  var docs = nodes.filter(function (n) { return n.name === 'docs'; })[0];
  var later = nodes.filter(function (n) { return n.name === 'later'; })[0];
  assert('the root head carries the subtree count', head.count === 1 + 3 + 303, head.count);
  assert('a folder carries its subtree count', docs.count === 3, docs);
  assert('an unscanned folder is flagged', later.unscanned === true && later.count === 0, later);
  var li = nodes.indexOf(later);
  assert('an expanded unscanned folder emits one loading row', nodes[li + 1].kind === 'loading' && nodes[li + 1].path === '/r/later', nodes[li + 1]);
  var more = nodes.filter(function (n) { return n.kind === 'more'; })[0];
  assert('a folder with filesHidden gets a "more" row after its files', more && more.path === '/r/big' && more.count === 300, more);
  var bigIdx = nodes.map(function (n) { return n.name; }).indexOf('big');
  assert('…placed after that folder\'s files', nodes.indexOf(more) === bigIdx + 4, nodes.indexOf(more));
  var collapsedDocs = T.buildTreeNodes(t, { '/r/docs': true });
  var cd = collapsedDocs.filter(function (n) { return n.name === 'docs'; })[0];
  assert('the count stays when a folder is collapsed', cd.collapsed && cd.count === 3);
})();

console.log('\nUXF-02 · folders without markdown are hidden by default\n');
(function () {
  var t = tree('/r', dir('/r', ['a.md'], [
    dir('/r/assets', [], [dir('/r/assets/img', [])]), dir('/r/notes', ['n.md'])
  ]));
  var hidden = T.buildTreeNodes(t, {});
  assert('empty folders are absent by default', names(hidden, 'folder').join() === 'notes', names(hidden, 'folder'));
  // UXF-07: only the top-most hidden folder of a branch counts (the rows the toggle adds).
  assert('hiddenEmptyCount counts the top-most folder without markdown', T.hiddenEmptyCount(t) === 1, T.hiddenEmptyCount(t));
  var shown = T.buildTreeNodes(t, {}, { showEmpty: true });
  assert('showEmpty brings them back with count 0',
    names(shown, 'folder').join() === 'assets,img,notes' && shown.filter(function (n) { return n.name === 'assets'; })[0].count === 0,
    names(shown, 'folder'));
  var later = tree('/r', dir('/r', [], [dir('/r/x', [], [], { scanned: false })]));
  assert('an unscanned folder is never hidden as "empty"', names(T.buildTreeNodes(later, {}), 'folder').join() === 'x');
})();

console.log('\nUXF-03 · smart default expansion (30-row budget)\n');
(function () {
  // 4 top folders × 5 files + 2 root files: rows at the root = 6.
  // Expanding a folder costs its 5 file rows (+1 for its subfolder).
  var root = dir('/r', ['readme.md', 'x.md'], [
    dir('/r/a', files(5), [dir('/r/a/inner', files(20))]),
    dir('/r/b', files(5)),
    dir('/r/c', files(5)),
    dir('/r/d', files(5))
  ]);
  var t = tree('/r', root);
  var dec = T.defaultCollapsed(t, {}, { budget: 30 });
  // level 1: 6 rows; a:+6=12, b:+5=17, c:+5=22, d:+5=27. level 2: inner +20 → 47 > 30.
  assert('top-level folders that fit are expanded (explicit false)',
    dec['/r/a'] === false && dec['/r/b'] === false && dec['/r/c'] === false && dec['/r/d'] === false, dec);
  assert('a deeper folder that does not fit stays collapsed', dec['/r/a/inner'] === true, dec);
  var collapsed = Object.assign({}, dec);
  var rows = T.buildTreeNodes(t, collapsed).length - 1;
  assert('first paint has at most 30 rows below the head', rows <= 30, rows);

  var huge = tree('/h', dir('/h', [], [dir('/h/big', files(40)), dir('/h/small', files(3))]));
  var dh = T.defaultCollapsed(huge, {}, { budget: 30 });
  assert('a folder too big for the budget is collapsed; a later small one still fits',
    dh['/h/big'] === true && dh['/h/small'] === false, dh);
  assert('…and every top-level folder row stays visible', T.buildTreeNodes(huge, dh).filter(function (n) { return n.depth === 1 && n.kind === 'folder'; }).length === 2);

  var withKids = tree('/k', dir('/k', [], [dir('/k/big', files(40), [dir('/k/big/sub', files(2))])]));
  var dk = T.defaultCollapsed(withKids, {}, { budget: 30 });
  assert('a collapsed folder\'s descendants are collapsed too', dk['/k/big'] === true && dk['/k/big/sub'] === true, dk);

  var forced = T.defaultCollapsed(withKids, {}, { budget: 30, openPaths: ['/k/big/sub/f1.md'] });
  assert('ancestors of a file open in a tab are always expanded',
    forced['/k/big'] === false && forced['/k/big/sub'] === false, forced);

  var user = T.defaultCollapsed(t, { '/r/a': true, '/r/b': false }, { budget: 30 });
  assert('keys the user already set are never written', !('/r/a' in user) && !('/r/b' in user), user);
  assert('a user-collapsed folder\'s new descendants follow it (collapsed)', user['/r/a/inner'] === true, user);

  var lazy = tree('/l', dir('/l', [], [dir('/l/u', [], [], { scanned: false })]));
  assert('an unscanned folder starts collapsed (size unknown)', T.defaultCollapsed(lazy, {}, {})['/l/u'] === true);

  // Re-scan: only NEW folders get a decision.
  var again = T.defaultCollapsed(t, collapsed, { budget: 30 });
  assert('a re-scan with nothing new decides nothing', Object.keys(again).length === 0, again);
  root.folders.push(dir('/r/e', files(1)));
  var added = T.defaultCollapsed(t, collapsed, { budget: 30 });
  assert('a re-scan decides only the new folder', Object.keys(added).join() === '/r/e', added);
})();

console.log('\nUXF-03 · subtree keys for ⌥-click and Expand / Collapse All\n');
(function () {
  var t = tree('/r', dir('/r', [], [
    dir('/r/a', ['1.md'], [dir('/r/a/b', ['2.md'], [dir('/r/a/b/c', ['3.md'])])]),
    dir('/r/ab', ['4.md'])
  ]));
  var k = T.subtreeKeys(t, '/r/a');
  assert('a folder\'s subtree: itself and every descendant',
    k.join() === '/r/a,/r/a/b,/r/a/b/c', k);
  assert('a sibling with a common prefix (/r/ab) is not included', k.indexOf('/r/ab') === -1);
  var all = T.subtreeKeys(t, 'root:/r');
  assert('the root head key covers the head and every folder',
    all[0] === 'root:/r' && all.length === 5, all);
  assert('a key that is not in the tree yields nothing', T.subtreeKeys(t, '/r/zzz').length === 0);
})();

console.log('\nUXF-02 · grafting a lazily loaded folder\n');
(function () {
  var t = tree('/r', dir('/r', ['a.md'], [dir('/r/later', [], [], { scanned: false })]));
  t.truncated = true;
  var ok = T.graftNode(t, '/r/later', dir('/r/later', ['x.md', 'y.md'], [dir('/r/later/s', ['z.md'])]));
  assert('graft succeeds for a folder in the tree', ok === true);
  assert('the folder is scanned with its contents', t.root.folders[0].scanned === true && t.root.folders[0].files.length === 2);
  assert('counts are recomputed up to the root', t.root.folders[0].mdCount === 3 && t.root.mdCount === 4, t.root.mdCount);
  assert('truncated clears once nothing is unscanned or hidden', t.truncated === false);
  assert('graft of an unknown folder is refused', T.graftNode(t, '/elsewhere', dir('/elsewhere', [])) === false);
  assert('findFolderNode finds the root too', T.findFolderNode(t, '/r/') === t.root);
})();

console.log('\nUXF-06 · findFileNode — the reveal lookup\n');
(function () {
  var t = tree('/r', dir('/r', ['top.md'], [
    dir('/r/a', [], [dir('/r/a/b', ['f4.md'])]),
    dir('/r/later', [], [], { scanned: false }),
    dir('/r/big', files(2), [], { filesHidden: 10 })
  ]));
  var hit = T.findFileNode(t, '/r/a/b/f4.md');
  assert('found: returns the file and its folder', hit && hit.file && hit.file.path === '/r/a/b/f4.md' && hit.folder.path === '/r/a/b', hit);
  assert('found: returns the ancestor collapse keys', hit.keys.join() === '/r/a,/r/a/b', hit.keys);
  assert('a root-level file has no ancestor keys', T.findFileNode(t, '/r/top.md').keys.length === 0);
  var un = T.findFileNode(t, '/r/later/deep/x.md');
  assert('inside an unscanned folder: points at that folder', un && !un.file && un.unscanned && un.unscanned.path === '/r/later', un);
  var hid = T.findFileNode(t, '/r/big/f99.md');
  assert('past the file cap: points at the capped folder', hid && !hid.file && hid.hiddenIn && hid.hiddenIn.path === '/r/big', hid);
  var miss = T.findFileNode(t, '/r/a/b/new.md');
  assert('created after the snapshot: a plain miss', miss && !miss.file && !miss.unscanned && !miss.hiddenIn, miss);
  assert('outside the tree: null', T.findFileNode(t, '/other/x.md') === null);
  assert('a same-prefix sibling root is outside (/rx is not in /r)', T.findFileNode(t, '/rx/x.md') === null);
  var twin = tree('/s', dir('/s', [], [dir('/s/a', [], [dir('/s/a/b', ['f4.md'])])]));
  assert('lookup is by full path, never by name', T.findFileNode(twin, '/r/a/b/f4.md') === null &&
    T.findFileNode(twin, '/s/a/b/f4.md').file.path === '/s/a/b/f4.md');
})();

console.log('\nUXF-03 · the row budget follows the sidebar height (shell, tv-app.js)\n');
(function () {
  var fs = require('fs'), path = require('path'), vm = require('vm');
  var APP = fs.readFileSync(path.join(__dirname, 'tv-app.js'), 'utf8');
  function extractFn(src, name) {
    var start = src.indexOf('function ' + name + '(');
    var depth = 0;
    for (var j = src.indexOf('{', start); j < src.length; j++) {
      if (src[j] === '{') depth++;
      else if (src[j] === '}' && --depth === 0) return src.slice(start, j + 1);
    }
  }
  function budgetFor(sidebarOpen, clientHeight, innerHeight) {
    var sb = { state: { sidebarOpen: sidebarOpen }, Math: Math,
      window: { innerHeight: innerHeight },
      document: { querySelector: function () { return { clientHeight: clientHeight }; } } };
    vm.runInContext(extractFn(APP, 'treeRowBudget'), vm.createContext(sb));
    return sb.treeRowBudget();
  }
  assert('H 792 (1440 × 900) → 24', budgetFor(true, 792, 900) === 24, budgetFor(true, 792, 900));
  assert('H 592 (1440 × 700) → 17', budgetFor(true, 592, 700) === 17, budgetFor(true, 592, 700));
  assert('a tall sidebar is capped at 30', budgetFor(true, 2000, 2100) === 30);
  assert('a tiny sidebar still expands 8 rows', budgetFor(true, 200, 300) === 8);
  assert('sidebar closed at mount: H = innerHeight − 140', budgetFor(false, 0, 900) === Math.floor((760 - 54) / 30));

  var apply = extractFn(APP, 'applyDefaultExpansion');
  assert('the budget is taken once per tree and stored as tree._budget',
    /if \(typeof tree\._budget !== 'number'\) tree\._budget = treeRowBudget\(\);/.test(apply) && /opts\.budget = tree\._budget/.test(apply));
  assert('a re-scan keeps the mount-time budget', /fresh\._budget = old\._budget/.test(extractFn(APP, 'refreshFolder')));

  // Level-0 children always show: a root whose own rows exceed the budget.
  var big = tree('/b', dir('/b', files(40), [dir('/b/x', files(2))]));
  var d = T.defaultCollapsed(big, {}, { budget: 8 });
  assert('the root\'s own rows show even past the budget; only folder expansion is limited',
    T.buildTreeNodes(big, d).filter(function (n) { return n.depth === 1; }).length === 41 && d['/b/x'] === true, d);

  console.log('\nUXF-03 rule 9 · opening a folder shows the sidebar\n');
  var reg = extractFn(APP, 'registerFolder');
  assert('registerFolder opens the sidebar and pins the choice',
    /state\.sidebarOpen = true;\s*\n\s*state\.sidebarUserToggled = true;/.test(reg));
  assert('…measuring the budget first, while the sidebar is still closed',
    reg.indexOf('tree._budget = treeRowBudget()') < reg.indexOf('state.sidebarOpen = true'));
  assert('the silent paths never register (re-scan, lazy load)',
    extractFn(APP, 'refreshFolder').indexOf('registerFolder') === -1 && extractFn(APP, 'loadIntoTree').indexOf('registerFolder') === -1);
})();

console.log('\n' + (fail === 0 ? 'ALL PASSED' : 'FAILURES: ' + fail) + ' (' + pass + ' passed, ' + fail + ' failed)\n');
if (fail > 0) process.exit(1);
