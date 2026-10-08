/* ───────────────────────────────────────────────────────────
   tv-tree.js node tests  (run with: node app/js/tv-tree-nesting.test.js)
   ISS-005 — sidebar nested-folder tree + close-folder control.
   Covers:
     (a) nested folder build with correct per-depth indentation depth
     (b) collapse / expand state via keys (root + nested subfolder)
     (c) close-folder removal + cleanup of nested collapse keys
     (d) collapse state survives a (mock) render cycle
   ─────────────────────────────────────────────────────────── */
'use strict';

var TVTree = require('./tv-tree.js');

var pass = 0;
var fail = 0;

function assert(label, condition, detail) {
  if (condition) {
    console.log('  PASS  ' + label);
    pass++;
  } else {
    console.error('  FAIL  ' + label + (detail ? ' — ' + detail : ''));
    fail++;
  }
}

// UXF-02: a DirNode as read_dir_tree returns it (src-tauri/src/lib.rs).
function dir(path, fileNames, folders) {
  var files = (fileNames || []).map(function (n) { return { name: n, path: path + '/' + n }; });
  folders = folders || [];
  var count = files.length;
  folders.forEach(function (f) { count += f.mdCount; });
  return { name: path.split('/').pop(), path: path, files: files, filesHidden: 0,
           folders: folders, mdCount: count, scanned: true };
}
function tree(path, root) { return { path: path, root: root, truncated: false, unreadable: 0 }; }

// A DirTree shaped like read_dir_tree's output:
//   /root
//     a.md, b.md            (direct files)
//     sub/  c.md            (subfolder + its file)
//     sub/deeper/ d.md      (depth-2 file)
//     lone/deeper2/ e.md    (folder with no direct files of its own)
function makeTree() {
  return tree('/root', dir('/root', ['a.md', 'b.md'], [
    dir('/root/lone', [], [dir('/root/lone/deeper2', ['e.md'])]),
    dir('/root/sub', ['c.md'], [dir('/root/sub/deeper', ['d.md'])])
  ]));
}

function find(nodes, pred) {
  for (var i = 0; i < nodes.length; i++) { if (pred(nodes[i])) return nodes[i]; }
  return null;
}
function indexOfNode(nodes, pred) {
  for (var i = 0; i < nodes.length; i++) { if (pred(nodes[i])) return i; }
  return -1;
}

/* ── (a) nested structure + per-depth indentation ─────────────────────────── */
console.log('\n(a) buildTreeNodes — nested structure + depth\n');

(function () {
  var nodes = TVTree.buildTreeNodes(makeTree(), {});

  var head = nodes[0];
  // A3: the root head's collapse key is NAMESPACED ('root:' + path) to avoid
  // colliding with a same-path subfolder under another root; `path` is unchanged.
  assert('first node is the root head', head.kind === 'head' && head.key === 'root:/root');
  assert('head keeps its bare folder path for rendering', head.path === '/root', 'got ' + head.path);
  assert('head is at depth 0', head.depth === 0, 'got ' + head.depth);
  assert('head name is the basename', head.name === 'root', 'got ' + head.name);

  var fileA = find(nodes, function (n) { return n.kind === 'file' && n.name === 'a.md'; });
  assert('top-level file a.md is at depth 1', fileA && fileA.depth === 1, fileA && ('got ' + fileA.depth));
  assert('top-level file a.md carries its path', fileA && fileA.path === '/root/a.md');

  var sub = find(nodes, function (n) { return n.kind === 'folder' && n.name === 'sub'; });
  assert('subfolder "sub" exists at depth 1', sub && sub.depth === 1, sub && ('got ' + sub.depth));
  assert('subfolder key is "root/sub"', sub && sub.key === '/root/sub', sub && sub.key);

  var fileC = find(nodes, function (n) { return n.kind === 'file' && n.name === 'c.md'; });
  assert('sub file c.md is at depth 2', fileC && fileC.depth === 2, fileC && ('got ' + fileC.depth));

  // deep entry "sub/deeper/d.md" reconstructs a nested "deeper" folder under "sub"
  var deeper = find(nodes, function (n) { return n.kind === 'folder' && n.name === 'deeper'; });
  assert('nested "deeper" folder reconstructed at depth 2', deeper && deeper.depth === 2, deeper && ('got ' + deeper.depth));
  assert('nested "deeper" key is "root/sub/deeper"', deeper && deeper.key === '/root/sub/deeper', deeper && deeper.key);

  var fileD = find(nodes, function (n) { return n.kind === 'file' && n.name === 'd.md'; });
  assert('deep file d.md is at depth 3', fileD && fileD.depth === 3, fileD && ('got ' + fileD.depth));

  // deep-only subfolder (no direct files) still materialises from `from`
  var lone = find(nodes, function (n) { return n.kind === 'folder' && n.name === 'lone'; });
  var deeper2 = find(nodes, function (n) { return n.kind === 'folder' && n.name === 'deeper2'; });
  var fileE = find(nodes, function (n) { return n.kind === 'file' && n.name === 'e.md'; });
  assert('deep-only "lone" folder exists at depth 1', lone && lone.depth === 1);
  assert('deep-only "deeper2" folder exists at depth 2', deeper2 && deeper2.depth === 2);
  assert('deep-only file e.md is at depth 3', fileE && fileE.depth === 3, fileE && ('got ' + fileE.depth));

  // UXF-03: folders render before files at a level
  var iFileA = indexOfNode(nodes, function (n) { return n.kind === 'file' && n.name === 'a.md'; });
  var iSub = indexOfNode(nodes, function (n) { return n.kind === 'folder' && n.name === 'sub'; });
  assert('folders render before files at a level', iSub < iFileA, 'a.md@' + iFileA + ' sub@' + iSub);

  // the renderer multiplies depth → px (file: depth*16+10, folder: depth*16+6).
  // Verify the depth values that drive that mapping are monotonic per level.
  assert('depth → file indentation: d1=26px, d3=58px',
    (fileA.depth * 16 + 10) === 26 && (fileD.depth * 16 + 10) === 58);
  assert('depth → folder indentation: d1=22px, d2=38px',
    (sub.depth * 16 + 6) === 22 && (deeper.depth * 16 + 6) === 38);
}());

/* ── (b) collapse / expand via keys ───────────────────────────────────────── */
console.log('\n(b) collapse / expand via keys\n');

(function () {
  // root collapsed → only the head, marked collapsed.
  // A3: the head collapse key is namespaced 'root:'+path (NOT the bare path).
  var rootFolded = TVTree.buildTreeNodes(makeTree(), { 'root:/root': true });
  assert('collapsed root yields exactly one node (the head)', rootFolded.length === 1, 'got ' + rootFolded.length);
  assert('collapsed head reports collapsed:true', rootFolded[0].collapsed === true);

  // A3 collision guard: a BARE-path key equal to the root path must NOT collapse
  // the head (only the namespaced 'root:' key does). This is the regression the
  // namespacing prevents.
  var rootBareKey = TVTree.buildTreeNodes(makeTree(), { '/root': true });
  assert('a bare "/root" key does NOT collapse the root head', rootBareKey.length > 1, 'got ' + rootBareKey.length);
  assert('head with only a bare-path key reports collapsed:false', rootBareKey[0].collapsed === false);

  // expanded → many nodes
  var expanded = TVTree.buildTreeNodes(makeTree(), {});
  assert('expanded root yields more than one node', expanded.length > 1, 'got ' + expanded.length);
  assert('expanded head reports collapsed:false', expanded[0].collapsed === false);

  // collapse the nested subfolder "sub" → the subfolder row stays, its children vanish
  var subFolded = TVTree.buildTreeNodes(makeTree(), { '/root/sub': true });
  var subNode = find(subFolded, function (n) { return n.kind === 'folder' && n.name === 'sub'; });
  assert('collapsed subfolder row still present', !!subNode && subNode.collapsed === true);
  assert('collapsed subfolder hides its direct file c.md',
    !find(subFolded, function (n) { return n.name === 'c.md'; }));
  assert('collapsed subfolder hides its nested "deeper" folder',
    !find(subFolded, function (n) { return n.kind === 'folder' && n.name === 'deeper'; }));
  // the unrelated "lone" branch is unaffected by collapsing "sub"
  assert('collapsing "sub" leaves the unrelated "lone" branch visible',
    !!find(subFolded, function (n) { return n.kind === 'folder' && n.name === 'lone'; }));
}());

/* ── (c) close-folder removal + nested collapse-key cleanup ───────────────── */
console.log('\n(c) pruneCollapsed — close-folder key cleanup\n');

(function () {
  // A3: closeFolder('/root') passes the BARE root path. pruneCollapsed must drop
  // the namespaced head key ('root:/root'), the bare root path, and every nested
  // subfolder key ('/root/sub', '/root/sub/deeper'), but keep unrelated roots.
  var collapsed = {
    'root:/root': true,
    '/root': true,
    '/root/sub': true,
    '/root/sub/deeper': true,
    '/other': true,
    '/other/x': true
  };
  var pruned = TVTree.pruneCollapsed(collapsed, '/root');

  assert('namespaced head key "root:/root" removed', !('root:/root' in pruned));
  assert('bare root key removed', !('/root' in pruned));
  assert('nested "root/sub" key removed', !('/root/sub' in pruned));
  assert('deep nested "root/sub/deeper" key removed', !('/root/sub/deeper' in pruned));
  assert('unrelated "/other" key preserved', pruned['/other'] === true);
  assert('unrelated "/other/x" key preserved', pruned['/other/x'] === true);
  assert('exactly two keys survive', Object.keys(pruned).length === 2, 'got ' + Object.keys(pruned).length);
  assert('input map is not mutated', Object.keys(collapsed).length === 6);

  // a path that is a string-prefix but NOT a real ancestor must survive
  var pruned2 = TVTree.pruneCollapsed({ '/root': true, '/rootster': true }, '/root');
  assert('sibling "/rootster" not treated as a descendant of "/root"', pruned2['/rootster'] === true);

  // A3 collision case: closing root "/vault" must drop its head ('root:/vault')
  // and its subfolder ('/vault/archive'), but must NOT touch a DIFFERENT open
  // root whose own head key is 'root:/vault/archive' (same bare path, different
  // namespace). This is the exact regression the namespacing prevents.
  var collidey = {
    'root:/vault': true,         // head of the root we are closing
    '/vault/archive': true,      // a subfolder under /vault (bare path)
    'root:/vault/archive': true  // the HEAD of a separately-opened "/vault/archive" root
  };
  var pruned3 = TVTree.pruneCollapsed(collidey, '/vault');
  assert('closing /vault drops its head "root:/vault"', !('root:/vault' in pruned3));
  assert('closing /vault drops its subfolder "/vault/archive"', !('/vault/archive' in pruned3));
  assert('closing /vault KEEPS the other root head "root:/vault/archive"',
    pruned3['root:/vault/archive'] === true);
  assert('exactly one key survives the collision prune', Object.keys(pruned3).length === 1,
    'got ' + Object.keys(pruned3).length);
}());

/* ── (c2) collapse-key collision: bare subfolder vs namespaced root ───────── */
console.log('\n(c2) collapse-key collision — bare subfolder vs namespaced root\n');

(function () {
  // Build a tree rooted at "/vault" containing a subfolder "archive" (bare key
  // "/vault/archive"). Collapsing the namespaced head of a *different* root
  // "/vault/archive" (key "root:/vault/archive") must NOT collapse this
  // subfolder, and collapsing the subfolder must NOT collapse the head.
  function vaultTree() {
    return tree('/vault', dir('/vault', ['r.md'], [dir('/vault/archive', ['old.md'])]));
  }

  // (1) A namespaced "root:/vault/archive" key must leave the bare-keyed
  // "/vault/archive" subfolder fully expanded (no collision).
  var a = TVTree.buildTreeNodes(vaultTree(), { 'root:/vault/archive': true });
  var archA = find(a, function (n) { return n.kind === 'folder' && n.name === 'archive'; });
  assert('subfolder "archive" present despite a "root:/vault/archive" key', !!archA);
  assert('subfolder "archive" NOT collapsed by the namespaced root key', archA && archA.collapsed === false);
  assert('subfolder child "old.md" still visible', !!find(a, function (n) { return n.name === 'old.md'; }));

  // (2) Collapsing the subfolder via its BARE key "/vault/archive" must NOT
  // collapse the "/vault" root head (which is keyed "root:/vault").
  var b = TVTree.buildTreeNodes(vaultTree(), { '/vault/archive': true });
  assert('collapsing bare "/vault/archive" leaves the head expanded', b.length > 1, 'got ' + b.length);
  assert('the /vault head reports collapsed:false', b[0].collapsed === false);
  var archB = find(b, function (n) { return n.kind === 'folder' && n.name === 'archive'; });
  assert('the "archive" subfolder IS collapsed by its bare key', archB && archB.collapsed === true);
  assert('collapsed "archive" hides its child old.md',
    !find(b, function (n) { return n.name === 'old.md'; }));
}());

/* ── (d) collapse state survives a mock render cycle ──────────────────────── */
console.log('\n(d) state survives a render cycle\n');

(function () {
  // A render cycle re-derives the node list from the same persistent collapse
  // map (e.g. on tab switch / theme change). Same input → identical output.
  var collapsed = { '/root/sub': true };
  var first = TVTree.buildTreeNodes(makeTree(), collapsed);
  var second = TVTree.buildTreeNodes(makeTree(), collapsed);
  assert('two render passes produce identical node lists',
    JSON.stringify(first) === JSON.stringify(second));

  var subNode = find(second, function (n) { return n.kind === 'folder' && n.name === 'sub'; });
  assert('subfolder "sub" is still collapsed after the second render', subNode && subNode.collapsed === true);

  // expanding it (flip the key) re-reveals its child on the next render
  collapsed['/root/sub'] = false;
  var third = TVTree.buildTreeNodes(makeTree(), collapsed);
  assert('flipping the key re-reveals c.md on the next render',
    !!find(third, function (n) { return n.name === 'c.md'; }));
}());

/* ── (d2) empty tree → head only (drives A4 empty-folder placeholder) ──────── */
console.log('\n(d2) empty tree yields just the head\n');

(function () {
  // A folder whose scan found nothing (no files / subfolders / deep) must still
  // produce its head node — and ONLY the head. buildFolderSection slices off the
  // head and, seeing zero body nodes, renders the "No markdown files" row (A4).
  var emptyExpanded = TVTree.buildTreeNodes(tree('/empty', dir('/empty', [], [])), {});
  assert('empty tree yields exactly one node', emptyExpanded.length === 1, 'got ' + emptyExpanded.length);
  assert('the single node is the head', emptyExpanded[0].kind === 'head');
  assert('empty-tree head carries its path', emptyExpanded[0].path === '/empty');
  assert('empty-tree head is expanded (not collapsed)', emptyExpanded[0].collapsed === false);
  // slicing the head off (as buildFolderSection does) → zero body nodes → A4 row
  assert('body nodes (head sliced off) is empty → A4 placeholder fires',
    emptyExpanded.slice(1).length === 0);

  // a tree missing the arrays entirely (only a path) behaves identically
  var bare = TVTree.buildTreeNodes({ path: '/bare' }, {});
  assert('path-only tree still yields just the head', bare.length === 1 && bare[0].kind === 'head');

  // a missing path → no nodes at all (guard at top of buildTreeNodes)
  var noPath = TVTree.buildTreeNodes({ files: [] }, {});
  assert('a tree with no path yields zero nodes', noPath.length === 0, 'got ' + noPath.length);
}());

/* ── (e) collectTreeFilePaths — all file paths across all tiers ───────────── */
console.log('\n(e) collectTreeFilePaths — flat union of every tree file path\n');

(function () {
  var paths = TVTree.collectTreeFilePaths(makeTree());
  assert('returns an array', Array.isArray(paths));

  function has(p) { return paths.indexOf(p) !== -1; }
  // direct files
  assert('includes top-level a.md', has('/root/a.md'));
  assert('includes top-level b.md', has('/root/b.md'));
  // subfolder file
  assert('includes subfolder file sub/c.md', has('/root/sub/c.md'));
  // deep files
  assert('includes deep file sub/deeper/d.md', has('/root/sub/deeper/d.md'));
  assert('includes deep-only file lone/deeper2/e.md', has('/root/lone/deeper2/e.md'));
  // exactly the 5 known files, no extras, no dupes
  assert('returns exactly 5 paths (no extras/dupes)', paths.length === 5, 'got ' + paths.length);

  // null / empty / missing-field tolerance (pure, never throws)
  assert('null tree → empty array', TVTree.collectTreeFilePaths(null).length === 0);
  assert('undefined tree → empty array', TVTree.collectTreeFilePaths(undefined).length === 0);
  assert('non-object tree → empty array', TVTree.collectTreeFilePaths('nope').length === 0);
  assert('empty object → empty array', TVTree.collectTreeFilePaths({}).length === 0);

  // missing/!-typed fields are skipped, present ones still collected
  var partial = tree('/p', {
    name: 'p', path: '/p',
    files: [{ name: 'x.md', path: '/p/x.md' }, { name: 'noPath' }, null],
    folders: [{ name: 's', path: '/p/s' /* no files */ },
              { name: 's2', path: '/p/s2', files: [{ path: '/p/s2/y.md' }] },
              { name: 'deep', path: '/p/deep', files: [{ path: '/p/deep/z.md' }, { name: 'noPath2' }] }]
  });
  var pp = TVTree.collectTreeFilePaths(partial);
  assert('partial: collects x.md', pp.indexOf('/p/x.md') !== -1);
  assert('partial: collects subfolder s2/y.md', pp.indexOf('/p/s2/y.md') !== -1);
  assert('partial: collects deep z.md', pp.indexOf('/p/deep/z.md') !== -1);
  assert('partial: skips entries lacking a string .path', pp.length === 3, 'got ' + pp.length);

  // tree.files not an array (string) → tolerated, no throw
  assert('files:non-array tolerated', TVTree.collectTreeFilePaths({ root: { files: 'bad' } }).length === 0);
}());

// ── Report ─────────────────────────────────────────────────────────────────────
console.log('\n' + (fail === 0 ? 'ALL PASSED' : 'FAILURES: ' + fail) +
  ' (' + pass + ' passed, ' + fail + ' failed)\n');

if (fail > 0) process.exit(1);
