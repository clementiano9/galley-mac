/* ───────────────────────────────────────────────────────────
   Galley · sidebar folder-tree logic  (ISS-005)
   window.TVTree — pure, DOM-free helpers that turn a native
   DirTree into an ordered, depth-annotated list of render nodes
   and manage per-folder collapse state.

   Kept free of `window`/`document` so it can be unit-tested under
   node/bun (see js/tv-tree-nesting.test.js). UMD-style export:
   attaches to window in the browser, module.exports under node.

   DirTree shape (from read_dir_tree, src-tauri/src/lib.rs):
     { path, files:[{name,path}],
       subfolders:[{name, files:[{name,path}]}],
       deep:[{name, path, from}] }   // from = "sub/deeper/"
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

  // Reconstruct a genuinely nested folder structure from the flat DirTree.
  // The native scanner returns three depth tiers (direct files, one level of
  // subfolders, and a flattened `deep` list keyed by a "sub/deeper/" prefix);
  // we re-assemble them into a recursive { files, folders } graph so the tree
  // can render at arbitrary depth.
  function assembleTree(tree) {
    var rootNode = { files: [], folders: {} };
    if (!tree) return rootNode;

    function ensure(parent, name) {
      if (!parent.folders[name]) parent.folders[name] = { files: [], folders: {} };
      return parent.folders[name];
    }
    function pushFile(node, f) {
      node.files.push({ name: f.name || basename(f.path), path: f.path || '' });
    }

    (tree.files || []).forEach(function (f) { pushFile(rootNode, f); });

    (tree.subfolders || []).forEach(function (s) {
      var node = ensure(rootNode, s.name);
      (s.files || []).forEach(function (f) { pushFile(node, f); });
    });

    (tree.deep || []).forEach(function (d) {
      var node = rootNode;
      String(d.from || '').split('/').filter(Boolean).forEach(function (seg) {
        node = ensure(node, seg);
      });
      pushFile(node, d);
    });

    return rootNode;
  }

  // Build the ordered list of render nodes for one folder tree, honouring the
  // collapse map. Each node carries its `depth` (root head = 0) so the renderer
  // can apply per-depth indentation. Folders sort before being walked so order
  // is stable across re-renders (state survives a render cycle).
  //   node = { kind:'head'|'folder'|'file', key, name, path?, depth, collapsed? }
  function buildTreeNodes(tree, collapsed) {
    collapsed = collapsed || {};
    var nodes = [];
    var rootPath = tree && tree.path;
    if (!rootPath) return nodes;

    // A3: the root head's collapse key is NAMESPACED ('root:' + path) so it can
    // never collide with a subfolder whose bare path happens to equal another
    // root's path (e.g. a root "/vault/archive" vs a subfolder keyed
    // "/vault/archive" living under a different open root). Subfolder keys stay
    // bare paths (keyPrefix + '/' + name) below. `path` is kept unchanged for
    // rendering (the head still shows + toggles via its real folder path).
    var rootKey = 'root:' + rootPath;
    var rootCollapsed = !!collapsed[rootKey];
    nodes.push({
      kind: 'head', key: rootKey, name: basename(rootPath),
      path: rootPath, depth: 0, collapsed: rootCollapsed
    });
    if (rootCollapsed) return nodes;

    walk(assembleTree(tree), rootPath, 1);
    return nodes;

    function walk(node, keyPrefix, depth) {
      node.files.forEach(function (f) {
        nodes.push({ kind: 'file', key: keyPrefix + '/' + f.name, name: f.name, path: f.path, depth: depth });
      });
      Object.keys(node.folders).sort().forEach(function (name) {
        var key = keyPrefix + '/' + name;
        var col = !!collapsed[key];
        nodes.push({ kind: 'folder', key: key, name: name, depth: depth, collapsed: col });
        if (!col) walk(node.folders[name], key, depth + 1);
      });
    }
  }

  // Collect every absolute FILE path represented in one DirTree, across all three
  // depth tiers the native scanner emits: direct `files`, one level of
  // `subfolders[].files`, and the flattened `deep` list. Returns a plain array
  // (order: files → subfolder files → deep). Pure, DOM-free; tolerates a
  // null/empty tree and missing/!-typed fields (skips entries without a string
  // `.path`). Used by the sidebar to tell whether an open tab is already shown
  // inside a folder tree (exact file-path membership, never a path-prefix test).
  function collectTreeFilePaths(tree) {
    var out = [];
    if (!tree || typeof tree !== 'object') return out;

    function pushPath(f) {
      if (f && typeof f.path === 'string' && f.path) out.push(f.path);
    }

    (Array.isArray(tree.files) ? tree.files : []).forEach(pushPath);

    (Array.isArray(tree.subfolders) ? tree.subfolders : []).forEach(function (s) {
      if (s && Array.isArray(s.files)) s.files.forEach(pushPath);
    });

    (Array.isArray(tree.deep) ? tree.deep : []).forEach(pushPath);

    return out;
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
    // SBH-01 / SBH-02 (Sidebar hierarchy)
    treeIndent: treeIndent,
    normFolderPath: normFolderPath,
    isDescendantPath: isDescendantPath,
    chainKeysTo: chainKeysTo,
    planFolderOpen: planFolderOpen
  };
}));
