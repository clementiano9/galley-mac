/* ───────────────────────────────────────────────────────────
   tiny-viewer · sidebar folder-tree logic  (ISS-005)
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

    var rootCollapsed = !!collapsed[rootPath];
    nodes.push({
      kind: 'head', key: rootPath, name: basename(rootPath),
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

  // Drop every collapse key belonging to a closed root (the root itself and any
  // nested "root/sub/deeper" descendant). Returns a fresh map; never mutates.
  function pruneCollapsed(collapsed, rootPath) {
    var out = {};
    Object.keys(collapsed || {}).forEach(function (k) {
      if (k !== rootPath && k.indexOf(rootPath + '/') !== 0) out[k] = collapsed[k];
    });
    return out;
  }

  return {
    assembleTree: assembleTree,
    buildTreeNodes: buildTreeNodes,
    pruneCollapsed: pruneCollapsed
  };
}));
