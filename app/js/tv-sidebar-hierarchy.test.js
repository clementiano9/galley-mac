/* ───────────────────────────────────────────────────────────
   Sidebar hierarchy tests  (run with: node app/js/tv-sidebar-hierarchy.test.js)
   Design source: "tiny-viewer Sidebar Hierarchy.html" (claude.ai design project).

   Three independent defects, three independent fixes:
     SBH-01 · Fix 1 — depth is a NUMBER (recursive indent + guide rails)
     SBH-02 · Fix 2 — one root per tree (containment: refresh/reveal/absorb)
     SBH-03 · Fix 3 — opening a folder opens NO tabs (transient preview tab)

   Fixes 1 and 2 are exercised against the real pure logic in tv-tree.js.
   Fix 3 is stateful DOM/tab behavior inside the tv-app.js IIFE, so it is
   covered by source guards over the exact call sites that used to fan a
   folder out into tabs — the same approach tv-search.test.js takes.
   ─────────────────────────────────────────────────────────── */
'use strict';

var fs = require('fs');
var path = require('path');
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
function eq(label, actual, expected) {
  assert(label, actual === expected, 'expected ' + JSON.stringify(expected) + ', got ' + JSON.stringify(actual));
}
function deepEq(label, actual, expected) {
  assert(label, JSON.stringify(actual) === JSON.stringify(expected),
    'expected ' + JSON.stringify(expected) + ', got ' + JSON.stringify(actual));
}

var APP_SRC = fs.readFileSync(path.join(__dirname, 'tv-app.js'), 'utf8');
var NATIVE_SRC = fs.readFileSync(path.join(__dirname, 'tv-native.js'), 'utf8');
var CSS_SRC = fs.readFileSync(path.join(__dirname, '..', 'css', 'tv-app.css'), 'utf8');

/* ══ SBH-01 · Fix 1 — depth is a number ═══════════════════════════════════ */
console.log('\nSBH-01 (Fix 1) — depth is a number\n');

// PAD 8 + depth*STEP 14, and file rows clear the 16px chevron GUTTER so a
// file's doc icon lands under the folder icon at the same depth.
eq('folder depth 0 indents to PAD', TVTree.treeIndent(0, true), 8);
eq('folder depth 1 indents one STEP', TVTree.treeIndent(1, true), 22);
eq('folder depth 3 indents three STEPs', TVTree.treeIndent(3, true), 50);
eq('file depth 0 clears the gutter', TVTree.treeIndent(0, false), 24);
eq('file depth 1 clears the gutter', TVTree.treeIndent(1, false), 38);
eq('file depth 3 clears the gutter', TVTree.treeIndent(3, false), 66);

// The defect was a BOOLEAN indent (isFolder ? 22 : nested ? 42 : 26): every
// folder header sat at one x whatever its depth. Depth must now scale linearly
// and a deeper folder must always out-indent a shallower one.
assert('indent is linear in depth, not a boolean',
  TVTree.treeIndent(2, true) - TVTree.treeIndent(1, true) ===
  TVTree.treeIndent(5, true) - TVTree.treeIndent(4, true));
assert('a depth-2 folder out-indents a depth-1 folder',
  TVTree.treeIndent(2, true) > TVTree.treeIndent(1, true));
// A file at depth d must sit further right than its own folder at depth d, but
// no further right than that folder's child folder rows at depth d+1 — that is
// what makes a subfolder read as a child rather than a sibling of the files.
assert('a file aligns inside its folder, level-consistently',
  TVTree.treeIndent(1, false) > TVTree.treeIndent(1, true) &&
  TVTree.treeIndent(1, false) === TVTree.treeIndent(2, true) + 2);

// Depth must survive recursion with no floor and no first-level special case.
var deepTree = {
  path: '/ux-steps',
  files: [{ name: 'charter.md', path: '/ux-steps/charter.md' }],
  subfolders: [{ name: 'research', files: [{ name: 's1.md', path: '/ux-steps/research/s1.md' }] }],
  deep: [
    { name: 'derived-wans.md', path: '/ux-steps/research/sources/derived-wans.md', from: 'research/sources/' },
    { name: 'url.md', path: '/ux-steps/research/sources/refs/url.md', from: 'research/sources/refs/' }
  ]
};
var nodes = TVTree.buildTreeNodes(deepTree, {});
function nodeNamed(n) {
  for (var i = 0; i < nodes.length; i++) { if (nodes[i].name === n) return nodes[i]; }
  return null;
}
eq('root head is depth 0', nodes[0].depth, 0);
eq('direct file is depth 1', nodeNamed('charter.md').depth, 1);
eq('subfolder is depth 1', nodeNamed('research').depth, 1);
eq('subfolder file is depth 2', nodeNamed('s1.md').depth, 2);
eq('sub-subfolder is depth 2', nodeNamed('sources').depth, 2);
eq('third-level folder is depth 3', nodeNamed('refs').depth, 3);
eq('fourth-level file is depth 4', nodeNamed('url.md').depth, 4);

// The CSS rails are generated from the same three numbers: rail i sits at
// PAD + i*STEP + 5 = 13, 27, 41 … drawn as a 14px-period repeating gradient
// clipped to depth*14px. If the geometry above moves, these must move too.
assert('CSS rails use the 14px step / 13px offset', /transparent 0 13px/.test(CSS_SRC) &&
  /var\(--tv-border\) 13px 14px/.test(CSS_SRC));
assert('CSS rails are clipped to the row depth',
  /background-size:\s*calc\(var\(--tv-depth, 0\) \* 14px\)/.test(CSS_SRC));
// The `background` SHORTHAND would reset background-image and erase the rails,
// so the hover/active row states must set background-COLOR only.
assert('active tree row uses background-color, not the shorthand',
  /\.tv-tree-row\.active \{\s*\n\s*background-color:/.test(CSS_SRC));
assert('hovered tree row uses background-color, not the shorthand',
  /\.tv-tree-row:hover:not\(\.active\) \{ background-color:/.test(CSS_SRC));
// QA D1 — the geometry must be applied through the CSSOM, NOT a style=""
// attribute baked into an innerHTML string: WKWebView drops the latter, which
// flattened the entire native tree while the browser build looked correct.
assert('rows carry depth as a data attribute',
  /data-tv-depth="' \+ n\.depth \+ '" data-tv-kind="folder"/.test(APP_SRC) &&
  /data-tv-depth="' \+ n\.depth \+ '" data-tv-kind="file"/.test(APP_SRC));
assert('geometry is applied via CSSOM in applyTreeDepths',
  /el\.style\.setProperty\('--tv-depth', String\(depth\)\)/.test(APP_SRC) &&
  /el\.style\.paddingLeft = treeIndent\(depth, isFolder\) \+ 'px'/.test(APP_SRC));
assert('applyTreeDepths runs on every render, right after innerHTML',
  /root\.innerHTML =[\s\S]{0,900}?applyTreeDepths\(root\);/.test(APP_SRC));
assert('NO style="" attribute carries tree depth or indent any more',
  !/style="--tv-depth/.test(APP_SRC));

// QA D2 — exactly ONE rail system. The old ::before rail (16px step) drew a
// second, misaligned, row-broken line beside every real rail.
assert('the legacy ::before rail rule is gone',
  !/tv-tree-row\.(subfolder|file)::before/.test(CSS_SRC));
assert('no 16px-step rail geometry survives anywhere',
  !/var\(--tv-depth, ?1\) ?\* ?16px/.test(CSS_SRC));
// …and the boolean-indent leftovers it paired with.
assert('the .nested 42px one-level indent is gone',
  !/\.tv-tree-row\.file\.nested \{ padding-left/.test(CSS_SRC));
assert('subfolder rows no longer hardcode a 22px left pad',
  !/\.tv-tree-row\.subfolder \{\s*\n\s*padding: 4px 8px 4px 22px/.test(CSS_SRC));

/* ══ SBH-02 · Fix 2 — one root per tree ═══════════════════════════════════ */
console.log('\nSBH-02 (Fix 2) — one root per tree\n');

// Path containment must compare whole segments: '/a/bc' is NOT inside '/a/b'.
assert('descendant is detected', TVTree.isDescendantPath('/a/b/c', '/a/b'));
assert('deep descendant is detected', TVTree.isDescendantPath('/a/b/c/d/e', '/a/b'));
assert('a path is not its own descendant', !TVTree.isDescendantPath('/a/b', '/a/b'));
assert('a parent is not a descendant of its child', !TVTree.isDescendantPath('/a', '/a/b'));
assert('a name-prefix sibling is NOT a descendant', !TVTree.isDescendantPath('/a/bc', '/a/b'));
assert('an unrelated path is not a descendant', !TVTree.isDescendantPath('/x/y', '/a/b'));
assert('trailing slashes do not defeat containment', TVTree.isDescendantPath('/a/b/c/', '/a/b/'));
eq('normFolderPath strips trailing slashes', TVTree.normFolderPath('/a/b/'), '/a/b');
eq('normFolderPath keeps a bare root', TVTree.normFolderPath('/'), '/');

// Rule 1 — descendant of an open root: reveal in place, never a second root.
var p1 = TVTree.planFolderOpen(['/ux-steps'], '/ux-steps/research');
eq('descendant → reveal, not mount', p1.action, 'reveal');
eq('reveal names the owning root', p1.rootPath, '/ux-steps');
deepEq('reveal returns the expand chain', p1.chain, ['/ux-steps/research']);

var p2 = TVTree.planFolderOpen(['/ux-steps'], '/ux-steps/research/sources');
eq('deep descendant → reveal', p2.action, 'reveal');
deepEq('chain expands EVERY ancestor down to the target', p2.chain,
  ['/ux-steps/research', '/ux-steps/research/sources']);

// The chain keys must be byte-identical to the ones buildTreeNodes emits, or
// the reveal clears the wrong collapse flags and the row never appears.
var chainNodes = TVTree.buildTreeNodes(deepTree, {});
var sourcesNode = null;
for (var ci = 0; ci < chainNodes.length; ci++) {
  if (chainNodes[ci].name === 'sources') { sourcesNode = chainNodes[ci]; break; }
}
deepEq('chain keys match buildTreeNodes keys exactly',
  TVTree.chainKeysTo('/ux-steps', '/ux-steps/research/sources'),
  ['/ux-steps/research', sourcesNode.key]);
// …including when the mounted root path carries a trailing slash.
deepEq('chain keys follow a raw root path verbatim',
  TVTree.chainKeysTo('/ux-steps/', '/ux-steps/research'), ['/ux-steps//research']);
deepEq('chainKeysTo on a non-descendant is empty',
  TVTree.chainKeysTo('/ux-steps', '/elsewhere/research'), []);

// Rule 2 — ancestor of open roots: mount it and fold those roots into it.
var p3 = TVTree.planFolderOpen(['/ux-steps/research', '/ux-steps/research/sources'], '/ux-steps');
eq('ancestor → mount', p3.action, 'mount');
deepEq('mounting an ancestor absorbs every root beneath it', p3.absorbed,
  ['/ux-steps/research', '/ux-steps/research/sources']);

// Rule 3 — unrelated: mount as a new root, absorbing nothing.
var p4 = TVTree.planFolderOpen(['/ux-steps'], '/LongGame');
eq('unrelated → mount', p4.action, 'mount');
deepEq('an unrelated mount absorbs nothing', p4.absorbed, []);
deepEq('the first folder mounts cleanly', TVTree.planFolderOpen([], '/ux-steps').absorbed, []);

// Re-opening the same root refreshes it in place rather than duplicating it.
var p5 = TVTree.planFolderOpen(['/ux-steps', '/LongGame'], '/ux-steps');
eq('same path → refresh', p5.action, 'refresh');
eq('refresh targets the existing root', p5.rootPath, '/ux-steps');
eq('trailing-slash re-open still refreshes',
  TVTree.planFolderOpen(['/ux-steps'], '/ux-steps/').action, 'refresh');

// The invariant the whole fix exists to protect: whatever the order of opens,
// a path is mounted at most once. Replay every ordering of a nested set.
function applyPlan(roots, next) {
  var plan = TVTree.planFolderOpen(roots, next);
  if (plan.action !== 'mount') return roots.slice();          // reveal/refresh mount nothing
  return roots.filter(function (r) { return plan.absorbed.indexOf(r) === -1; }).concat([next]);
}
var NESTED = ['/ux-steps', '/ux-steps/research', '/ux-steps/research/sources'];
function permutations(arr) {
  if (arr.length <= 1) return [arr];
  var out = [];
  arr.forEach(function (v, i) {
    permutations(arr.slice(0, i).concat(arr.slice(i + 1))).forEach(function (rest) {
      out.push([v].concat(rest));
    });
  });
  return out;
}
var worstRoots = 0;
var dupSeen = false;
permutations(NESTED).forEach(function (order) {
  var roots = [];
  order.forEach(function (p) { roots = applyPlan(roots, p); });
  worstRoots = Math.max(worstRoots, roots.length);
  var norm = roots.map(TVTree.normFolderPath);
  if (norm.length !== norm.filter(function (v, i) { return norm.indexOf(v) === i; }).length) dupSeen = true;
});
eq('any open order of a nested set leaves exactly ONE root', worstRoots, 1);
assert('no ordering ever mounts a duplicate path', !dupSeen);

// Rule 4 — no breadcrumb affix on rows: the muted parent-path suffix existed
// only to disambiguate the flat "More files" bucket, which no longer exists.
assert('the breadcrumb affix span is gone from the renderer',
  APP_SRC.indexOf('folder-path">') === -1);

/* ══ SBH-03 · Fix 3 — opening a folder opens no tabs ══════════════════════ */
console.log('\nSBH-03 (Fix 3) — opening a folder opens no tabs\n');

// Both folder-mount paths (picker and Recent-reopen) must mount the tree
// WITHOUT fanning its files out into tabs.
var openFolderBody = NATIVE_SRC.slice(
  NATIVE_SRC.indexOf('function openFolder()'),
  NATIVE_SRC.indexOf('function reopenFolder(')
);
var reopenBody = NATIVE_SRC.slice(
  NATIVE_SRC.indexOf('function reopenFolder('),
  NATIVE_SRC.indexOf('function saveTab(')
);
assert('openFolder opens no tabs', openFolderBody.indexOf('openInto(') === -1);
assert('openFolder still registers the tree', openFolderBody.indexOf('registerFolder') !== -1);
assert('reopenFolder opens no tabs', reopenBody.indexOf('openInto(') === -1);
assert('reopenFolder still registers the tree', reopenBody.indexOf('registerFolder') !== -1);
assert('reopenFolder no longer bulk-reads the folder\'s files',
  reopenBody.indexOf('read_md_file') === -1);

// The transient (preview) tab: one flag, replaced on the next single click,
// pinned by a double-click or by editing.
assert('tabs carry a transient flag', /transient: !!opts\.transient/.test(APP_SRC));
assert('a transient open replaces the previous preview',
  /if \(opts\.transient\) dropTransientTab\(\);/.test(APP_SRC));
assert('a single click in the tree opens a PREVIEW',
  /_openTreeFilePath\(tfPath, true\)/.test(APP_SRC));
assert('double-click pins the file', /pinTab\(dblTabId\)/.test(APP_SRC));
assert('double-click pins the tab itself',
  /pinTab\(dblTab\.getAttribute\('data-tab-id'\)\)/.test(APP_SRC));
assert('a double-click that beats the async read is not lost',
  /_pendingPinPath = dblPath/.test(APP_SRC) && /if \(pinId\) pinTab\(pinId\)/.test(APP_SRC));
assert('entering edit mode pins the preview',
  /if \(t && t\.transient\) t\.transient = false;/.test(APP_SRC));
assert('the preview tab renders italic',
  /t\.transient \? ' transient' : ''/.test(APP_SRC) &&
  /\.tv-tab\.transient \.name \{ font-style: italic; \}/.test(CSS_SRC));
// Dropping the preview must release its native watch, or the Rust FSEvents
// watcher leaks for every file browsed (closeFolder takes the same care).
assert('dropping the preview releases its native watch',
  /dropTransientTab\(exceptId\) \{[\s\S]*?TVNative\.stopWatch/.test(APP_SRC));

// QA D3 — a double-click fires TWO clicks, which opened the file twice:
// openDoc's dedup missed because an existing tab re-keys to 'native:<path>'
// once the bridge assigns nativePath, while the incoming opts key as
// '<dir>/<name>'. Guarded on both sides now.
assert('an already-open file is activated, never re-opened',
  /var already = _tabIdByNativePath\(tfPath\);[\s\S]{0,260}?activateTab\(already\)/.test(APP_SRC));
assert('a second read for the same path is dropped while one is in flight',
  /if \(_openingPaths\[tfPath\]\) return;/.test(APP_SRC) &&
  /_openingPaths\[tfPath\] = true;/.test(APP_SRC));
assert('the in-flight guard is released on BOTH success and failure',
  (APP_SRC.match(/delete _openingPaths\[tfPath\];/g) || []).length >= 2);

// QA D4 — openDoc renders before the bridge can assign nativePath, so for one
// frame the file rendered twice (tree + duplicate grouped section).
assert('the bridge re-renders once the tab carries nativePath',
  /tab\.nativePath = doc\.path;[\s\S]*?tv\.render\(\)/.test(NATIVE_SRC));

// QA D6 — the subfolder name span had no class, so no ellipsis rule applied.
assert('subfolder names can truncate like every sibling row',
  /<span class="tname" title="' \+ esc\(n\.name\)/.test(APP_SRC));

console.log('\n' + (fail === 0 ? 'ALL PASSED' : 'FAILURES: ' + fail) +
  '  (' + pass + ' passed, ' + fail + ' failed)\n');
process.exit(fail === 0 ? 0 : 1);
