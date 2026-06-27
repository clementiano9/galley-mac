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

// A DirTree exactly shaped like read_dir_tree's output (src-tauri/src/lib.rs):
//   /root
//     a.md, b.md            (depth-0 direct files)
//     sub/  c.md            (depth-1 subfolder + its file)
//     sub/deeper/ d.md      (depth-2 file → `deep`, from = "sub/deeper/")
//     lone/deeper2/ e.md    (deep-only subfolder, no direct files of its own)
function makeTree() {
  return {
    path: '/root',
    files: [
      { name: 'a.md', path: '/root/a.md' },
      { name: 'b.md', path: '/root/b.md' }
    ],
    subfolders: [
      { name: 'sub', files: [{ name: 'c.md', path: '/root/sub/c.md' }] }
    ],
    deep: [
      { name: 'd.md', path: '/root/sub/deeper/d.md', from: 'sub/deeper/' },
      { name: 'e.md', path: '/root/lone/deeper2/e.md', from: 'lone/deeper2/' }
    ]
  };
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
  assert('first node is the root head', head.kind === 'head' && head.key === '/root');
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

  // files render before folders at the root level
  var iFileA = indexOfNode(nodes, function (n) { return n.kind === 'file' && n.name === 'a.md'; });
  var iSub = indexOfNode(nodes, function (n) { return n.kind === 'folder' && n.name === 'sub'; });
  assert('files render before folders at a level', iFileA < iSub, 'a.md@' + iFileA + ' sub@' + iSub);

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
  // root collapsed → only the head, marked collapsed
  var rootFolded = TVTree.buildTreeNodes(makeTree(), { '/root': true });
  assert('collapsed root yields exactly one node (the head)', rootFolded.length === 1, 'got ' + rootFolded.length);
  assert('collapsed head reports collapsed:true', rootFolded[0].collapsed === true);

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
  var collapsed = {
    '/root': true,
    '/root/sub': true,
    '/root/sub/deeper': true,
    '/other': true,
    '/other/x': true
  };
  var pruned = TVTree.pruneCollapsed(collapsed, '/root');

  assert('root key removed', !('/root' in pruned));
  assert('nested "root/sub" key removed', !('/root/sub' in pruned));
  assert('deep nested "root/sub/deeper" key removed', !('/root/sub/deeper' in pruned));
  assert('unrelated "/other" key preserved', pruned['/other'] === true);
  assert('unrelated "/other/x" key preserved', pruned['/other/x'] === true);
  assert('exactly two keys survive', Object.keys(pruned).length === 2, 'got ' + Object.keys(pruned).length);
  assert('input map is not mutated', Object.keys(collapsed).length === 5);

  // a path that is a string-prefix but NOT a real ancestor must survive
  var pruned2 = TVTree.pruneCollapsed({ '/root': true, '/rootster': true }, '/root');
  assert('sibling "/rootster" not treated as a descendant of "/root"', pruned2['/rootster'] === true);
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

// ── Report ─────────────────────────────────────────────────────────────────────
console.log('\n' + (fail === 0 ? 'ALL PASSED' : 'FAILURES: ' + fail) +
  ' (' + pass + ' passed, ' + fail + ' failed)\n');

if (fail > 0) process.exit(1);
