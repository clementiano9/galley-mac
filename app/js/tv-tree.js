/* ───────────────────────────────────────────────────────────
   Galley · sidebar folder-tree logic  (ISS-005)
   window.TVTree — pure, DOM-free helpers that turn a native
   DirTree into an ordered, depth-annotated list of render nodes
   and manage per-folder collapse state.

   Kept free of `window`/`document` so it can be unit-tested under
   node/bun (see js/tv-tree-nesting.test.js). UMD-style export:
   attaches to window in the browser, module.exports under node.

   DirTree shape (UXF-02, from read_dir_tree, src-tauri/src/lib.rs):
     { path, root: DirNode, truncated, unreadable }
     DirNode = { name, path, files:[{name,path}], filesHidden,
                 folders:[DirNode], mdCount, scanned }
   ─────────────────────────────────────────────────────────── */
(function (root, factory) {
  var api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) root.TVTree = api;
}(typeof window !== 'undefined' ? window : this, function () {
  'use strict';

  // Basename of an absolute path: "/a/b/c" → "c"
  function basename(p) {
    return String(p).replace(/\/+$/, '').split('/').pop() || String(p);
  }

  /* ── SBH-01: indent geometry (Sidebar hierarchy · Fix 1) ──────
     Depth is a NUMBER, not a boolean: a child of a folder at depth d is depth
     d+1, recursively, with no floor and no special case for the first level.
     A row indents PAD + depth*STEP; a FILE row additionally clears the chevron
     GUTTER so its doc icon aligns under the folder icon at the same depth.
     The CSS guide rails (css/tv-app.css, SBH-01) are drawn from the same three
     numbers — rail i sits at PAD + i*STEP + 5 — so they must stay in sync. */
  var TREE_PAD = 8;
  var TREE_STEP = 14;
  var TREE_GUTTER = 16;

  // Left padding, in px, for one depth-annotated render node.
  function treeIndent(depth, isFolder) {
    return TREE_PAD + (depth || 0) * TREE_STEP + (isFolder ? 0 : TREE_GUTTER);
  }

  /* ── SBH-02: containment (Sidebar hierarchy · Fix 2) ──────────
     A folder is mounted ONCE. These helpers decide how a newly-opened folder
     relates to the roots already on screen; tv-app.js only executes the plan. */

  // Normalize an absolute folder path for containment tests: drop trailing
  // slashes ('/a/b/' → '/a/b'), keeping a bare '/' intact.
  function normFolderPath(p) {
    var s = String(p == null ? '' : p);
    if (!s) return '';
    var t = s.replace(/\/+$/, '');
    return t || '/';
  }

  // True when `child` lies STRICTLY inside `parent`. Compares whole path
  // segments (parent + '/'), so '/a/bc' is never treated as inside '/a/b'.
  function isDescendantPath(child, parent) {
    var c = normFolderPath(child);
    var p = normFolderPath(parent);
    if (!c || !p || c === p) return false;
    return c.indexOf(p === '/' ? '/' : p + '/') === 0;
  }

  // The collapse keys along the chain from an open root DOWN TO one of its
  // descendant folders, in order (nearest the root first), ending with the
  // target's own key. Rebuilt exactly the way buildTreeNodes' walk builds them
  // — starting at the tree's RAW path and appending '/' + name per level —
  // rather than sliced out of the target, so the two agree even when the raw
  // root path carries a trailing slash. Returns [] if target is not inside root.
  function chainKeysTo(rootTreePath, targetPath) {
    if (!isDescendantPath(targetPath, rootTreePath)) return [];
    var root = normFolderPath(rootTreePath);
    var target = normFolderPath(targetPath);
    var rest = (root === '/') ? target : target.slice(root.length);
    var key = String(rootTreePath);
    var keys = [];
    rest.split('/').filter(Boolean).forEach(function (seg) {
      key = key + '/' + seg;
      keys.push(key);
    });
    return keys;
  }

  // Decide what opening `newPath` should do, given the paths of the roots
  // already mounted (in state order). Pure — returns a plan, mutates nothing:
  //   { action:'refresh', rootPath }            already mounted as a root
  //   { action:'reveal',  rootPath, chain:[] }  descendant of an open root:
  //                                             expand `chain`, do NOT mount
  //   { action:'mount',   absorbed:[paths] }    mount it; any open roots listed
  //                                             in `absorbed` fold in as children
  // `absorbed` is empty for a plainly unrelated folder.
  function planFolderOpen(openPaths, newPath) {
    var paths = Array.isArray(openPaths) ? openPaths : [];
    var target = normFolderPath(newPath);
    if (!target) return { action: 'mount', absorbed: [] };

    var i;
    for (i = 0; i < paths.length; i++) {
      if (normFolderPath(paths[i]) === target) {
        return { action: 'refresh', rootPath: paths[i] };
      }
    }
    for (i = 0; i < paths.length; i++) {
      if (isDescendantPath(target, paths[i])) {
        return {
          action: 'reveal',
          rootPath: paths[i],
          chain: chainKeysTo(paths[i], newPath)
        };
      }
    }
    var absorbed = paths.filter(function (p) { return isDescendantPath(p, target); });
    return { action: 'mount', absorbed: absorbed };
  }

  /* ── UXF-02: natural, case-insensitive order ─────────────────
     Mirrors natural_cmp in lib.rs: a2 < a10 < B. Digit runs compare by value;
     names equal ignoring case fall back to a code-unit compare. */
  function naturalCompare(a, b) {
    var x = String(a), y = String(b);
    var la = x.toLowerCase(), lb = y.toLowerCase();
    var i = 0, j = 0;
    function isDigit(c) { return c >= '0' && c <= '9'; }
    while (i < la.length && j < lb.length) {
      var ca = la.charAt(i), cb = lb.charAt(j);
      if (isDigit(ca) && isDigit(cb)) {
        var si = i, sj = j;
        while (i < la.length && isDigit(la.charAt(i))) i++;
        while (j < lb.length && isDigit(lb.charAt(j))) j++;
        var da = la.slice(si, i).replace(/^0+/, ''), db = lb.slice(sj, j).replace(/^0+/, '');
        if (da.length !== db.length) return da.length < db.length ? -1 : 1;
        if (da !== db) return da < db ? -1 : 1;
      } else {
        if (ca !== cb) return ca < cb ? -1 : 1;
        i++; j++;
      }
    }
    var ra = la.length - i, rb = lb.length - j;
    if (ra !== rb) return ra < rb ? -1 : 1;
    return x === y ? 0 : (x < y ? -1 : 1);
  }

  function byName(a, b) { return naturalCompare(a.name, b.name); }

  /* ── UXF-02: DirTree = { path, root: DirNode, truncated, unreadable }
     DirNode = { name, path, files:[{name,path}], filesHidden, folders:[DirNode],
                 mdCount, scanned }   (lib.rs, camelCase on the wire) */
  var EMPTY_NODE = { name: '', path: '', files: [], filesHidden: 0, folders: [], mdCount: 0, scanned: true };

  function assembleTree(tree) {
    return (tree && tree.root) ? tree.root : EMPTY_NODE;
  }

  // A scanned folder with no markdown anywhere below it — hidden by default.
  function isEmptyFolder(n) {
    return !!n && n.scanned !== false && !n.mdCount;
  }

  /* ── UXF-07: which folders show by default ───────────────────
     Agent dot-folders show; other dot-folders and folders with no viewable
     file are "extras" behind the footer toggle; a folder that holds a file
     open in a tab always shows. The display policy lives here; Rust only
     lists what it finds. Review the list when supporting a new agent. */
  var AGENT_FOLDERS = [
    '.agents', '.amazonq', '.augment', '.claude', '.clinerules', '.codex', '.continue',
    '.cursor', '.devin', '.gemini', '.github', '.junie', '.kilo', '.kilocode', '.kiro',
    '.opencode', '.roo', '.specstory', '.trae', '.windsurf'
  ];
  var AGENT_TOOLS = {
    '.agents': 'Agent Skills', '.amazonq': 'Amazon Q Developer', '.augment': 'Augment Code',
    '.claude': 'Claude Code', '.clinerules': 'Cline', '.codex': 'OpenAI Codex',
    '.continue': 'Continue', '.cursor': 'Cursor', '.devin': 'Devin', '.gemini': 'Gemini CLI',
    '.github': 'GitHub Copilot', '.junie': 'JetBrains Junie', '.kilo': 'Kilo Code',
    '.kilocode': 'Kilo Code', '.kiro': 'Kiro', '.opencode': 'OpenCode', '.roo': 'Roo Code',
    '.specstory': 'SpecStory', '.trae': 'Trae', '.windsurf': 'Windsurf'
  };

  // Normalise the display options every tree function takes:
  //   showAll / showEmpty  the footer toggle ("Show N more folders") is on
  //   agentNames           names the user added with "Always Show"
  //   openPaths            files open in tabs (their folders always show)
  //   sessionVisible       { folderPath: true } shown by Reveal for this session
  function treeCtx(opts) {
    if (opts && opts._ctx) return opts;
    opts = opts || {};
    return {
      _ctx: true,
      showAll: !!(opts.showAll || opts.showEmpty),
      agentNames: (opts.agentNames || []).map(function (n) { return String(n).toLowerCase(); }),
      openPaths: opts.openPaths || [],
      sessionVisible: opts.sessionVisible || {}
    };
  }

  function isAgentName(name, ctx) {
    var n = String(name).toLowerCase();
    return AGENT_FOLDERS.indexOf(n) !== -1 || (!!ctx && ctx.agentNames.indexOf(n) !== -1);
  }

  function holdsOpenFile(node, ctx) {
    var p = normFolderPath(node.path);
    for (var k in ctx.sessionVisible) {
      if (ctx.sessionVisible[k] && (normFolderPath(k) === p || isDescendantPath(k, p))) return true;
    }
    for (var i = 0; i < ctx.openPaths.length; i++) {
      if (ctx.openPaths[i] && isDescendantPath(ctx.openPaths[i], p)) return true;
    }
    return false;
  }

  // 'open' | 'agent' | 'normal' (shown) or 'extra' | 'empty' (behind the toggle).
  function folderClass(node, opts) {
    var ctx = treeCtx(opts);
    if (holdsOpenFile(node, ctx)) return 'open';
    var dotted = String(node.name).charAt(0) === '.';
    if (dotted && !isAgentName(node.name, ctx)) return 'extra';
    if (isEmptyFolder(node)) return 'empty';
    return dotted ? 'agent' : 'normal';
  }

  function isPolicyHidden(cls) { return cls === 'extra' || cls === 'empty'; }

  function folderVisible(n, opts) {
    var ctx = treeCtx(opts);
    return ctx.showAll || !isPolicyHidden(folderClass(n, ctx));
  }

  // UXF-07: the markdown count a row shows covers VISIBLE folders only, so the
  // number equals the files you can reach. `memo` is per build.
  function visibleCount(node, ctx, memo) {
    if (node.scanned === false) return 0;
    if (memo && memo[node.path] !== undefined) return memo[node.path];
    var n = (node.files || []).length + (node.filesHidden || 0);
    (node.folders || []).forEach(function (f) {
      if (folderVisible(f, ctx)) n += visibleCount(f, ctx, memo);
    });
    if (memo) memo[node.path] = n;
    return n;
  }

  // Visit every folder below `node` (not node itself) with its collapse key,
  // which is built exactly the way chainKeysTo builds it: the tree's raw path
  // plus '/' + name per level.
  function eachFolder(node, keyPrefix, fn, depth) {
    (node.folders || []).forEach(function (f) {
      var key = keyPrefix + '/' + f.name;
      if (fn(f, key, depth || 1) === false) return; // false = do not descend
      eachFolder(f, key, fn, (depth || 1) + 1);
    });
  }

  // Build the ordered list of render nodes for one folder tree, honouring the
  // collapse map. Each node carries its `depth` (root head = 0).
  //   node = { kind:'head'|'folder'|'file'|'loading'|'more', key, name, path,
  //            depth, collapsed?, count?, unscanned? }
  // UXF-03: at every level folders come first, then files, both natural-sorted.
  // A folder that `filesHidden` > 0 gets a 'more' row after its files (UXF-02).
  function buildTreeNodes(tree, collapsed, opts) {
    collapsed = collapsed || {};
    var ctx = treeCtx(opts);
    var memo = {};
    var nodes = [];
    var rootPath = tree && tree.path;
    if (!rootPath) return nodes;
    var root = assembleTree(tree);

    // A3: the root head's collapse key is NAMESPACED ('root:' + path) so it can
    // never collide with a subfolder whose bare path equals another root's
    // path. Subfolder keys stay bare paths (keyPrefix + '/' + name).
    var rootKey = 'root:' + rootPath;
    var rootCollapsed = !!collapsed[rootKey];
    nodes.push({
      kind: 'head', key: rootKey, name: basename(rootPath), path: rootPath, depth: 0,
      collapsed: rootCollapsed, count: visibleCount(root, ctx, memo), unscanned: root.scanned === false
    });
    if (rootCollapsed) return nodes;

    walk(root, rootPath, 1);
    return nodes;

    function walk(node, keyPrefix, depth) {
      (node.folders || []).slice().sort(byName).forEach(function (f) {
        var cls = folderClass(f, ctx);
        if (isPolicyHidden(cls) && !ctx.showAll) return;
        var key = keyPrefix + '/' + f.name;
        var col = !!collapsed[key];
        var unscanned = f.scanned === false;
        nodes.push({
          kind: 'folder', key: key, name: f.name, path: f.path, depth: depth,
          collapsed: col, count: visibleCount(f, ctx, memo), unscanned: unscanned,
          // UXF-07: shown only because the footer toggle is on → dimmed
          extra: isPolicyHidden(cls), tool: AGENT_TOOLS[String(f.name).toLowerCase()] || null
        });
        if (col) return;
        if (unscanned) nodes.push({ kind: 'loading', key: 'loading:' + f.path, path: f.path, depth: depth + 1 });
        else walk(f, key, depth + 1);
      });
      (node.files || []).slice().sort(byName).forEach(function (fl) {
        nodes.push({ kind: 'file', key: keyPrefix + '/' + fl.name, name: fl.name, path: fl.path, depth: depth });
      });
      if (node.filesHidden > 0) {
        nodes.push({ kind: 'more', key: 'more:' + node.path, path: node.path, count: node.filesHidden, depth: depth });
      }
    }
  }

  // UXF-07: the folders the policy hides — the N in "Show N more folders" —
  // as [{ name, path, reason: 'dot' | 'empty' }]. Only the top-most hidden
  // folder of a branch counts: those are the rows the toggle adds.
  function hiddenFolders(tree, opts) {
    var out = [];
    if (!tree || !tree.root) return out;
    var ctx = treeCtx(opts);
    (function visit(node) {
      (node.folders || []).slice().sort(byName).forEach(function (f) {
        var cls = folderClass(f, ctx);
        if (isPolicyHidden(cls)) {
          out.push({ name: f.name, path: f.path, reason: cls === 'extra' ? 'dot' : 'empty' });
        } else {
          visit(f);
        }
      });
    }(tree.root));
    return out;
  }

  // UXF-07 #5: every folder the toggle keeps out of view, at any depth (the
  // top-most hidden folders plus every folder inside them) — for the tooltip.
  function hiddenFolderTotal(tree, opts) {
    var n = 0;
    hiddenFolders(tree, opts).forEach(function (h) {
      var node = findFolderNode(tree, h.path);
      n++;
      if (node) eachFolder(node, h.path, function () { n++; });
    });
    return n;
  }

  function hiddenEmptyCount(tree, opts) {
    return hiddenFolders(tree, opts).length;
  }

  // UXF-07 + UXF-06: the folders on the way to `filePath` that the policy
  // would hide if the file were not open — Reveal shows them for the session.
  function policyHiddenChain(tree, filePath, opts) {
    var out = [];
    if (!tree || !tree.root || !isDescendantPath(filePath, tree.path)) return out;
    var base = treeCtx(opts);
    var ctx = treeCtx({ agentNames: base.agentNames });
    var rel = String(filePath).slice(normFolderPath(tree.path).length).split('/').filter(Boolean);
    rel.pop();
    var node = tree.root;
    for (var i = 0; i < rel.length && node; i++) {
      var next = null;
      for (var j = 0; j < (node.folders || []).length; j++) {
        if (node.folders[j].name === rel[i]) { next = node.folders[j]; break; }
      }
      if (next && isPolicyHidden(folderClass(next, ctx))) out.push(next);
      node = next;
    }
    return out;
  }

  // Find the DirNode for an absolute folder path (the root included).
  function findFolderNode(tree, folderPath) {
    if (!tree || !tree.root) return null;
    var target = normFolderPath(folderPath);
    var found = null;
    (function visit(n) {
      if (found) return;
      if (normFolderPath(n.path) === target) { found = n; return; }
      (n.folders || []).forEach(visit);
    }(tree.root));
    return found;
  }

  // Recompute mdCount bottom-up (direct files + hidden + children) and the
  // tree's truncated flag. Unscanned folders count 0 until they are read.
  function recount(tree) {
    var truncated = false;
    (function visit(n) {
      var sum = 0;
      (n.folders || []).forEach(function (c) { sum += visit(c); });
      if (n.scanned === false) { truncated = true; n.mdCount = 0; return 0; }
      if (n.filesHidden > 0) truncated = true;
      n.mdCount = (n.files || []).length + (n.filesHidden || 0) + sum;
      return n.mdCount;
    }(tree.root));
    tree.truncated = truncated;
  }

  // UXF-02: replace one folder's contents with a fresh scan of that folder
  // (lazy load of an unscanned folder, or an uncapped re-read). Mutates `tree`
  // in place and recounts. Returns false when the folder is not in the tree.
  function graftNode(tree, folderPath, node) {
    var target = findFolderNode(tree, folderPath);
    if (!target || !node) return false;
    target.files = node.files || [];
    target.filesHidden = node.filesHidden || 0;
    target.folders = node.folders || [];
    target.scanned = node.scanned !== false;
    recount(tree);
    return true;
  }

  // Collect every absolute FILE path a DirTree lists. Pure; tolerates a null
  // tree and malformed entries. Used to tell whether an open tab is already
  // shown in a tree (exact membership, never a prefix test) and by the palette.
  function collectTreeFilePaths(tree) {
    var out = [];
    if (!tree || typeof tree !== 'object' || !tree.root) return out;
    (function visit(n) {
      (Array.isArray(n.files) ? n.files : []).forEach(function (f) {
        if (f && typeof f.path === 'string' && f.path) out.push(f.path);
      });
      (Array.isArray(n.folders) ? n.folders : []).forEach(visit);
    }(tree.root));
    return out;
  }

  /* ── UXF-03: smart default expansion ─────────────────────────
     Level by level (every folder of depth k before any of depth k+1), in
     sorted order, expand a folder only if the visible row count stays at or
     below `budget` (root head not counted). A folder that does not fit stays
     collapsed, and so do its descendants. Ancestors of `openPaths` (files open
     in tabs) are always expanded. Keys already in `collapsed` are the user's
     and are followed, never overwritten. Unscanned folders start collapsed
     (their size is unknown). Returns ONLY the new decisions, { key: bool },
     with explicit false for expanded so a later re-scan can tell old folders
     from new ones. */
  function defaultCollapsed(tree, collapsed, opts) {
    collapsed = collapsed || {};
    opts = opts || {};
    var budget = typeof opts.budget === 'number' ? opts.budget : 30;
    var vis = treeCtx(opts);
    var out = {};
    if (!tree || !tree.path || !tree.root) return out;

    var forced = {};
    (opts.openPaths || []).forEach(function (p) {
      if (!p || !isDescendantPath(p, tree.path)) return;
      var dir = String(p).replace(/\/[^/]*$/, '');
      chainKeysTo(tree.path, dir).forEach(function (k) { forced[k] = true; });
    });

    function visibleRows(n) {
      var rows = (n.files || []).length + (n.filesHidden > 0 ? 1 : 0);
      (n.folders || []).forEach(function (f) { if (folderVisible(f, vis)) rows++; });
      return rows;
    }
    function collapseSubtree(n, key) {
      if (collapsed[key] === undefined) out[key] = true;
      eachFolder(n, key, function (f, k) { if (collapsed[k] === undefined) out[k] = true; });
    }

    var rows = visibleRows(tree.root);
    var level = [];
    (tree.root.folders || []).slice().sort(byName).forEach(function (f) {
      if (folderVisible(f, vis)) level.push({ node: f, key: tree.path + '/' + f.name });
    });

    while (level.length) {
      var next = [];
      level.forEach(function (item) {
        var n = item.node, key = item.key, cost = n.scanned === false ? 1 : visibleRows(n);
        var user = collapsed[key];
        var open;
        if (user !== undefined) open = !user;
        else if (forced[key]) open = true;
        else if (n.scanned === false) open = false;
        else open = rows + cost <= budget;

        if (!open) {
          collapseSubtree(n, key); // writes only keys nobody has set yet
          return;
        }
        if (user === undefined) out[key] = false;
        rows += cost;
        (n.folders || []).slice().sort(byName).forEach(function (f) {
          if (folderVisible(f, vis)) next.push({ node: f, key: key + '/' + f.name });
        });
      });
      level = next;
    }
    return out;
  }

  // UXF-03: every collapse key in the subtree of `key` (itself included), for
  // ⌥-click / ⌥→ / Expand All. `key` is a folder key or the 'root:' head key.
  function subtreeKeys(tree, key) {
    var keys = [];
    if (!tree || !tree.path || !tree.root) return keys;
    if (key === 'root:' + tree.path) {
      keys.push(key);
      eachFolder(tree.root, tree.path, function (f, k) { keys.push(k); });
      return keys;
    }
    eachFolder(tree.root, tree.path, function (f, k) {
      if (k !== key) return k.length < key.length && key.indexOf(k + '/') === 0 ? undefined : false;
      keys.push(k);
      eachFolder(f, k, function (g, gk) { keys.push(gk); });
      return false;
    });
    return keys;
  }

  /* ── UXF-06: locate a file for "Reveal in Sidebar" ──────────
     Walks the tree by path segment (never by name alone). Returns
       { file, folder, keys }            found; keys = ancestor collapse keys
       { file:null, unscanned: node }    an ancestor folder is not read yet
       { file:null, hiddenIn: node }     its folder lists only the first FILE_CAP
       { file:null }                     not in the snapshot
     or null when filePath is not inside the tree at all. */
  function findFileNode(tree, filePath) {
    if (!tree || !tree.path || !tree.root || !isDescendantPath(filePath, tree.path)) return null;
    var dir = String(filePath).replace(/\/[^/]*$/, '');
    var keys = chainKeysTo(tree.path, dir);
    var node = tree.root;
    var rest = normFolderPath(dir) === normFolderPath(tree.path)
      ? [] : normFolderPath(dir).slice(normFolderPath(tree.path).length).split('/').filter(Boolean);
    for (var i = 0; i < rest.length; i++) {
      if (node.scanned === false) return { file: null, unscanned: node };
      var next = null;
      for (var j = 0; j < (node.folders || []).length; j++) {
        if (node.folders[j].name === rest[i]) { next = node.folders[j]; break; }
      }
      if (!next) return { file: null };
      node = next;
    }
    if (node.scanned === false) return { file: null, unscanned: node };
    for (var k = 0; k < (node.files || []).length; k++) {
      if (node.files[k].path === filePath) return { file: node.files[k], folder: node, keys: keys };
    }
    if (node.filesHidden > 0) return { file: null, hiddenIn: node };
    return { file: null };
  }

  // Drop every collapse key belonging to a closed root: the NAMESPACED head key
  // ('root:' + rootPath), the bare root path (legacy/safety), and any nested
  // "root/sub/deeper" descendant subfolder key (those stay bare paths). Returns a
  // fresh map; never mutates. A3: without the 'root:' clause the head key would
  // leak after close → the folder re-opens pre-collapsed.
  function pruneCollapsed(collapsed, rootPath) {
    var out = {};
    var headKey = 'root:' + rootPath;
    Object.keys(collapsed || {}).forEach(function (k) {
      if (k !== rootPath && k !== headKey && k.indexOf(rootPath + '/') !== 0) {
        out[k] = collapsed[k];
      }
    });
    return out;
  }

  return {
    assembleTree: assembleTree,
    buildTreeNodes: buildTreeNodes,
    collectTreeFilePaths: collectTreeFilePaths,
    pruneCollapsed: pruneCollapsed,
    // UXF-02 / UXF-03 / UXF-06
    naturalCompare: naturalCompare,
    hiddenEmptyCount: hiddenEmptyCount,
    // UXF-07
    AGENT_FOLDERS: AGENT_FOLDERS,
    AGENT_TOOLS: AGENT_TOOLS,
    folderClass: folderClass,
    hiddenFolders: hiddenFolders,
    hiddenFolderTotal: hiddenFolderTotal,
    policyHiddenChain: policyHiddenChain,
    findFolderNode: findFolderNode,
    graftNode: graftNode,
    defaultCollapsed: defaultCollapsed,
    subtreeKeys: subtreeKeys,
    findFileNode: findFileNode,
    // SBH-01 / SBH-02 (Sidebar hierarchy)
    treeIndent: treeIndent,
    normFolderPath: normFolderPath,
    isDescendantPath: isDescendantPath,
    chainKeysTo: chainKeysTo,
    planFolderOpen: planFolderOpen
  };
}));
