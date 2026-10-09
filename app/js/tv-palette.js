/* ───────────────────────────────────────────────────────────
   Galley · command palette (F-24: one smart list)
   window.TVPalette = { open(opts), close(), isOpen(), openOutline() }

   One input, one ranked list. Design: .claude/docs/feature-gaps/specs/F-24-palette-smart-list.md
     · zero-query shows what you can do right now (≤ 8 rows, nothing scrolls)
     · typing ranks open tabs, current-document headings, files and actions with
       a tiered matcher; commands that cannot run are dimmed with a reason
     · nothing matches → a Create "<query>.md" row (⇧↵ forces it); DR-06: unsaved
     · "#" scopes the list to the current document's headings (⌘⌥O opens it so)
     · Theme, Accent and Text size are ONE "Appearance" row that opens preview
       pages: ↑↓ previews live, ↵ applies, esc reverts and goes back

   Builds .tv-palette-scrim > .tv-palette into TV.el().
   D-07 / C-32: combobox + listbox, aria-activedescendant, modal dialog with a
   Tab trap and focus restore.
   ─────────────────────────────────────────────────────────── */
(function () {
  'use strict';

  /* ── MRU list ─────────────────────────────────────────────
     Tracks tab IDs in most-recently-activated order.
     tv-app.js fires TV.on('tabchange') which we listen to.  */
  var _mru = [];          // [tabId, ...] newest first
  var _overlayEl = null;  // the .tv-palette-scrim element
  var _open = false;

  // We defer wiring the 'tabchange' listener until first open,
  // in case tv-app.js loads after us.
  var _listenerWired = false;

  // Wire at load so the very first ⌘K already knows which tab you used last.
  function _wireMruAtLoad() {
    if (typeof document === 'undefined') return;
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', _wireMruListener);
    else _wireMruListener();
  }

  function _wireMruListener() {
    if (_listenerWired) return;
    if (!window.TV || typeof window.TV.on !== 'function') return;
    window.TV.on('tabchange', function (payload) {
      var id = (payload && payload.id) ? payload.id : (window.TV.state && window.TV.state.activeId);
      if (!id) return;
      _mru = _mru.filter(function (x) { return x !== id; });
      _mru.unshift(id);
      // keep bounded
      if (_mru.length > 50) _mru.length = 50;
    });
    // P2-4: closeTab() does not go through activateTab (no 'tabchange' when
    // a background tab closes, or even the active one — it sets
    // state.activeId directly), but it always calls render(). Prune there.
    window.TV.on('render', _pruneHeadCache);
    _listenerWired = true;
  }

  /* ── small helpers ────────────────────────────────────────*/
  function _esc(s) {
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function _isNative() {
    return !!window.__TAURI__;
  }

  /* ── icons ────────────────────────────────────────────────
     One stroke set, so every row has an icon and the left edge never goes
     ragged. (The shared TV_ICONS lacks half of what the palette needs.) */
  var IC = {
    doc: '<path d="M4 1.8h5l3 3v9.4c0 .3-.2.5-.5.5H4c-.3 0-.5-.2-.5-.5V2.3c0-.3.2-.5.5-.5Z"/><path d="M9 1.8v3.2h3"/>',
    folder: '<path d="M1.8 4.2c0-.6.4-1 1-1h3l1.4 1.4h6c.6 0 1 .4 1 1v6c0 .6-.4 1-1 1H2.8c-.6 0-1-.4-1-1V4.2Z"/>',
    hash: '<path d="M6 2.5 4.5 13.5M11.5 2.5 10 13.5M3 5.5h11M2.5 10.5h11"/>',
    clock: '<circle cx="8" cy="8" r="6"/><path d="M8 4.6V8l2.4 1.6"/>',
    search: '<circle cx="7" cy="7" r="4.4"/><path d="m10.4 10.4 3 3"/>',
    mag2: '<circle cx="7" cy="7" r="4.4"/><path d="m10.4 10.4 3 3M5.4 7h3.2"/>',
    plus: '<path d="M8 3.5v9M3.5 8h9"/>',
    close: '<path d="M4 4l8 8M12 4l-8 8"/>',
    sun: '<circle cx="8" cy="8" r="3.2"/><path d="M8 1v1.6M8 13.4V15M1 8h1.6M13.4 8H15M3 3l1.1 1.1M11.9 11.9 13 13M13 3l-1.1 1.1M4.1 11.9 3 13"/>',
    moon: '<path d="M13.5 9.2A5.5 5.5 0 1 1 6.8 2.5a4.3 4.3 0 0 0 6.7 6.7Z"/>',
    half: '<circle cx="8" cy="8" r="5.6"/><path d="M8 2.4v11.2a5.6 5.6 0 0 0 0-11.2Z" fill="currentColor"/>',
    sidebar: '<rect x="2" y="3" width="12" height="10" rx="1.5"/><path d="M6 3v10"/>',
    pencil: '<path d="M11.4 2.6a1.5 1.5 0 0 1 2 2L5 13H2.5v-2.5L11.4 2.6Z"/>',
    save: '<path d="M3 2.5h8.2l2.3 2.3V13a.5.5 0 0 1-.5.5H3a.5.5 0 0 1-.5-.5V3a.5.5 0 0 1 .5-.5Z"/><path d="M5 2.5v3h5v-3M5 13.5v-4h6v4"/>',
    refresh: '<path d="M13 8a5 5 0 1 1-1.5-3.5M13 2.5v3h-3"/>',
    kbd: '<rect x="1.8" y="4" width="12.4" height="8" rx="1.5"/><path d="M4.5 7h.01M7 7h.01M9.5 7h.01M12 7h.01M5 9.5h6"/>',
    print: '<path d="M4.5 6V2.5h7V6M4.5 11.5h-2V6h11v5.5h-2"/><path d="M4.5 9.5h7v4h-7z"/>',
    diagram: '<rect x="2" y="2.5" width="4.5" height="3.5" rx=".8"/><rect x="9.5" y="10" width="4.5" height="3.5" rx=".8"/><path d="M4.2 6v2.8c0 .5.4.8.8.8h4.5"/>',
    aa: '<path d="M2 12.5 5.2 3.5l3.2 9M3.3 9.6h3.8M10 12.5l2-5.5 2 5.5M10.6 11h2.8"/>',
    reveal: '<path d="M1.8 4.2c0-.6.4-1 1-1h3l1.4 1.4h6c.6 0 1 .4 1 1v6c0 .6-.4 1-1 1H2.8c-.6 0-1-.4-1-1V4.2Z"/><path d="M6.6 9h3.8M9.2 7.7 10.5 9 9.2 10.3"/>',
    copy: '<rect x="5.5" y="5.5" width="8" height="8" rx="1.5"/><path d="M10.5 5.5v-2a1 1 0 0 0-1-1h-6a1 1 0 0 0-1 1v6a1 1 0 0 0 1 1h2"/>',
    win: '<rect x="2" y="3" width="12" height="10" rx="1.5"/><path d="M2 6h12"/>',
    moveL: '<path d="M13 8H3M6.5 4.5 3 8l3.5 3.5"/>',
    moveR: '<path d="M3 8h10M9.5 4.5 13 8l-3.5 3.5"/>',
    check: '<path d="M3.2 8.6 6.5 11.8 12.8 4.6"/>',
    chev: '<path d="M6 3.5 10.5 8 6 12.5"/>',
    search2: '<circle cx="7" cy="7" r="4.4"/><path d="m10.4 10.4 3 3"/>'
  };
  function _ico(name, size) {
    var p = IC[name];
    if (!p) return '';
    size = size || 15;
    return '<svg width="' + size + '" height="' + size + '" viewBox="0 0 16 16" fill="none"' +
      ' stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + p + '</svg>';
  }

  /* ── matcher ───────────────────────────────────────────────
     Tiers, best first:  1 prefix · 2 every query word starts a word ·
     3 initials ("ao" → ai-output) · 4 substring (3+ letters) ·
     5 constrained subsequence (first letter on a word start, small gaps) ·
     6 one adjacent transposition ("shcema"), always ranked a bucket lower.
     A loose subsequence is NOT enough, so "new" no longer finds "Accent: Warm".
     Aliases rank below labels. The score's hundreds digit is its bucket. */
  function _words(s) {
    var out = [], re = /[A-Za-z0-9]+/g, m;
    while ((m = re.exec(s))) out.push({ w: m[0].toLowerCase(), i: m.index });
    return out;
  }
  function _range(a, n, out) { for (var i = 0; i < n; i++) out.push(a + i); }

  function _tier(q, label, noSubseq) {
    var L = String(label).toLowerCase(), idx = [], i, t;
    if (L.indexOf(q) === 0) {
      _range(0, q.length, idx);
      return { score: 1000 - (L.length - q.length) * 0.5, idx: idx, tier: 1 };
    }
    var W = _words(label), qt = q.split(/\s+/).filter(Boolean), used = {}, ok = qt.length > 0;
    for (t = 0; t < qt.length && ok; t++) {
      var hit = -1;
      for (i = 0; i < W.length; i++) {
        if (!used[i] && W[i].w.indexOf(qt[t]) === 0) { hit = i; break; }
      }
      if (hit < 0) ok = false; else { used[hit] = 1; _range(W[hit].i, qt[t].length, idx); }
    }
    if (ok) return { score: 800 - W.length * 0.5, idx: idx.sort(function (a, b) { return a - b; }), tier: 2 };

    var qn = q.replace(/\s+/g, '');
    if (qn.length >= 2 && qn.length <= 5 && W.length >= qn.length) {
      idx = [];
      var wi = 0, good = true;
      for (i = 0; i < qn.length && good; i++) {
        while (wi < W.length && W[wi].w.charAt(0) !== qn.charAt(i)) wi++;
        if (wi >= W.length) good = false; else { idx.push(W[wi].i); wi++; }
      }
      if (good) return { score: 600, idx: idx, tier: 3 };
    }
    var p = L.indexOf(q);
    if (q.length >= 3 && p > 0) {
      idx = [];
      _range(p, q.length, idx);
      return { score: 400 - p * 0.5, idx: idx, tier: 4 };
    }
    if (!noSubseq && qn.length >= 3) {
      for (var s = 0; s < W.length; s++) {
        if (L.charAt(W[s].i) !== qn.charAt(0)) continue;
        var pos = W[s].i, ix = [pos], gaps = 0, fail = false;
        for (var j = 1; j < qn.length; j++) {
          var f = L.indexOf(qn.charAt(j), pos + 1);
          if (f < 0 || f - pos - 1 > 3) { fail = true; break; }
          gaps += f - pos - 1;
          ix.push(f);
          pos = f;
        }
        if (!fail && gaps <= qn.length) return { score: 200 - gaps, idx: ix, tier: 5 };
      }
    }
    return null;
  }

  function _tierWithTypo(q, label) {
    var r = _tier(q, label);
    if (r) return r;
    var qn = q.replace(/\s+/g, '');
    if (qn.length < 4) return null;
    for (var i = 0; i + 1 < qn.length; i++) {
      var swapped = qn.slice(0, i) + qn.charAt(i + 1) + qn.charAt(i) + qn.slice(i + 2);
      var t = _tier(swapped, label, true);
      if (t) return { score: t.score - 150, idx: t.idx, tier: 6 };
    }
    return null;
  }

  // match(query, label, aliases) → { score, idx, tier, alias?, aliasIdx? } | null
  function _match(query, label, aliases) {
    var q = String(query == null ? '' : query).trim().toLowerCase();
    if (!q) return { score: 0, idx: [], tier: 0 };
    var best = _tierWithTypo(q, label);
    if (!best && aliases) {
      for (var i = 0; i < aliases.length; i++) {
        var k = _tierWithTypo(q, aliases[i]);
        if (k && (!best || k.score - 150 > best.score)) {
          best = { score: k.score - 150, idx: [], tier: k.tier, alias: aliases[i], aliasIdx: k.idx };
        }
      }
    }
    return best;
  }

  // Back-compat shape the tests and older callers use: { score, indices } | null.
  function _scoreText(query, text) {
    var m = _match(query, text);
    return m ? { score: m.score, indices: m.idx } : null;
  }

  // Build ESCAPED HTML with matched characters wrapped in <span class="hl">.
  function _localHighlight(text, indices) {
    var s = String(text);
    if (!indices || !indices.length) return _esc(s);
    var mark = {};
    indices.forEach(function (i) { mark[i] = true; });
    var out = '';
    var run = '';
    var inHl = false;
    for (var i = 0; i < s.length; i++) {
      var hit = !!mark[i];
      if (hit !== inHl) {
        if (run) out += inHl ? '<span class="hl">' + _esc(run) + '</span>' : _esc(run);
        run = '';
        inHl = hit;
      }
      run += s.charAt(i);
    }
    if (run) out += inHl ? '<span class="hl">' + _esc(run) + '</span>' : _esc(run);
    return out;
  }
  var _hl = _localHighlight;

  // Dim rows last, then by score bucket, then in the order produced (stable).
  function _sortRows(rows) {
    return rows.map(function (r, i) { r._i = i; return r; }).sort(function (a, b) {
      return ((a.dim ? 1 : 0) - (b.dim ? 1 : 0)) ||
        (Math.floor((b.score || 0) / 100) - Math.floor((a.score || 0) / 100)) ||
        (a._i - b._i);
    });
  }
  // Kept for callers that rank by raw score (stable on ties).
  function _rankRows(rows) {
    return rows.sort(function (a, b) { return (b.score || 0) - (a.score || 0); });
  }

  /* ── headings ─────────────────────────────────────────────*/
  // Extract headings from a markdown source string.
  // Returns [{level, text}, …]
  // UF-08: include h4-h6 (was #{1,3} — missed deeper headings in technical docs)
  function _parseHeadings(source) {
    if (!source) return [];
    var out = [];
    var lines = source.split('\n');
    for (var i = 0; i < lines.length; i++) {
      var m = lines[i].match(/^(#{1,6})\s+(.+)/);
      if (m) out.push({ level: m[1].length, text: m[2].trim() });
    }
    return out;
  }

  /* ── C-09: per-tab heading memoisation ────────────────────
     _parseHeadings splits the whole source. Running it for every open tab on
     every keystroke makes ⌘K latency scale with total open bytes, so cache the
     result per tab keyed on `tab.source` IDENTITY (=== on the string), which
     changes whenever an edit or a live-watch update replaces the source. */
  var _headCache = {};   // tabId -> { src, headings }
  var HEADINGS_PER_TAB_CAP = 100;   // parse-time: bounds the per-tab candidate pool
  var FILE_ROW_CAP = 50;            // parse-time: bounds the candidate pool before ranking
  // Render caps, applied AFTER ranking so the best matches survive the cut.
  var BUDGET = 8;                   // total rows on screen for a typed query / zero-query
  var HEADING_RENDER_CAP = 4;       // typed query: headings of the current document
  var FILE_RENDER_CAP = 4;          // typed query: files that are not open yet

  // P2-4: nothing ever cleared a closed tab's entry, so a long session held
  // the full source text of every document ever opened, not just the ones
  // still open. Pruned reactively on every render.
  function _pruneHeadCache() {
    if (!window.TV || !window.TV.state || !Array.isArray(window.TV.state.tabs)) return;
    var live = {};
    window.TV.state.tabs.forEach(function (t) { if (t) live[t.id] = true; });
    Object.keys(_headCache).forEach(function (id) {
      if (!live[id]) delete _headCache[id];
    });
  }

  function _headingsFor(tab) {
    if (!tab) return [];
    var hit = _headCache[tab.id];
    if (hit && hit.src === tab.source) return hit.headings;
    var parsed = _parseHeadings(tab.source);
    if (parsed.length > HEADINGS_PER_TAB_CAP) parsed = parsed.slice(0, HEADINGS_PER_TAB_CAP);
    _headCache[tab.id] = { src: tab.source, headings: parsed };
    return parsed;
  }

  /* ── recently used commands (adaptive zero-query) ─────────
     A command you just ran floats into the zero-query Actions. Two at most. */
  var USED_KEY = 'tv-pal-used';
  function _loadUsed() {
    try {
      var raw = localStorage.getItem(USED_KEY);
      var arr = raw ? JSON.parse(raw) : [];
      return Array.isArray(arr) ? arr.filter(function (x) { return typeof x === 'string'; }).slice(0, 6) : [];
    } catch (e) { return []; }
  }
  var _used = _loadUsed();
  function _markUsed(id) {
    if (!id) return;
    _used = [id].concat(_used.filter(function (x) { return x !== id; })).slice(0, 6);
    try { localStorage.setItem(USED_KEY, JSON.stringify(_used)); } catch (e) { /* private mode */ }
  }

  /* ── context: everything the builders read, in one object ─── */
  function _ctx() {
    var TV = window.TV || {};
    var st = TV.state || {};
    var recents = [];
    try { recents = (typeof TV.loadRecentEntries === 'function') ? TV.loadRecentEntries() : []; } catch (e) { recents = []; }
    return {
      tabs: st.tabs || [],
      activeId: st.activeId || null,
      mode: st.mode || 'reading',
      openFolders: st.openFolders || [],
      recents: recents,
      mru: _mru,
      used: _used,
      native: _isNative(),
      mermaid: (typeof TV.isMermaidEnabled === 'function') ? TV.isMermaidEnabled() : true,
      swipe: (typeof TV.isSwipeEnabled === 'function') ? TV.isSwipeEnabled() : true,
      hasDiscarded: (typeof TV.hasDiscardedEdits === 'function') ? !!TV.hasDiscardedEdits() : false,
      appearance: (typeof TV.appearanceState === 'function')
        ? TV.appearanceState()
        : { themeChoice: 'system', theme: 'light', accent: 'blue', fontSize: 16 }
    };
  }

  /* ── tabs, paths ──────────────────────────────────────────*/
  // The ⌘T launcher page is a tab with `untitled`; it is never a document.
  function _docTabs(ctx) { return ctx.tabs.filter(function (t) { return t && !t.untitled; }); }
  function _activeDoc(ctx) {
    for (var i = 0; i < ctx.tabs.length; i++) {
      var t = ctx.tabs[i];
      if (t.id === ctx.activeId) return t.untitled ? null : t;
    }
    return null;
  }
  function _parent(path) {
    if (!path) return '';
    var i = path.lastIndexOf('/');
    return i <= 0 ? '/' : path.slice(0, i);
  }
  function _dirShort(dir) {
    if (!dir) return '';
    return String(dir).split('/').filter(Boolean).slice(-2).join('/');
  }
  function _baseName(p) { return String(p || '').split('/').filter(Boolean).pop() || String(p || ''); }
  function _tabDir(t) { return t.nativePath ? _parent(t.nativePath) : (t.path || ''); }

  // Other open documents, most recently used first.
  function _otherTabs(ctx) {
    var docs = _docTabs(ctx), byId = {}, out = [], seen = {};
    docs.forEach(function (t) { byId[t.id] = t; });
    ctx.mru.forEach(function (id) {
      if (id !== ctx.activeId && byId[id] && !seen[id]) { out.push(byId[id]); seen[id] = 1; }
    });
    docs.forEach(function (t) {
      if (t.id !== ctx.activeId && !seen[t.id]) { out.push(t); seen[t.id] = 1; }
    });
    return out;
  }

  function _openPaths(ctx) {
    var o = {};
    ctx.tabs.forEach(function (t) { if (t.nativePath) o[t.nativePath] = 1; });
    return o;
  }

  // Recent files not open as tabs, and recent folders not mounted in the sidebar.
  function _closedRecents(ctx, max) {
    var openP = _openPaths(ctx), folders = {}, out = [];
    ctx.openFolders.forEach(function (f) { if (f && f.path) folders[f.path] = 1; });
    for (var i = 0; i < ctx.recents.length && out.length < max; i++) {
      var e = ctx.recents[i];
      if (!e || !e.path) continue;
      if (e.type === 'folder') { if (!folders[e.path]) out.push(e); }
      else if (!openP[e.path]) out.push(e);
    }
    return out;
  }

  // Every markdown file in the open folders' scanned trees that is not open.
  function _folderFiles(ctx) {
    var openP = _openPaths(ctx), out = [], seen = {};
    function add(f) {
      if (!f || !f.path || openP[f.path] || seen[f.path]) return;
      seen[f.path] = 1;
      out.push({ path: f.path, name: f.name || _baseName(f.path), type: 'file' });
    }
    // UXF-02: one walk of the recursive tree, shared with the sidebar.
    var collect = window.TVTree && window.TVTree.collectTreeFilePaths;
    if (typeof collect !== 'function') return out;
    ctx.openFolders.forEach(function (tree) {
      collect(tree).forEach(function (p) { add({ path: p }); });
    });
    return out;
  }

  /* ── commands ─────────────────────────────────────────────
     `need` says what a command requires; _avail turns an unmet need into the
     reason shown on a dimmed row. Aliases (kw) rank below the label. */
  var CMDS = [
    { id: 'open-file',   label: 'Open File…',   ic: 'doc',     kbd: '⌘O',  action: 'openFile',   kw: ['browse', 'picker'] },
    { id: 'open-folder', label: 'Open Folder…', ic: 'folder',  kbd: '⌘⇧O', action: 'openFolder', kw: ['browse', 'directory'] },
    { id: 'new-file',    label: 'New File',     ic: 'plus',    kbd: '⌘N',  action: 'newFile',    verb: 'Create', kw: ['create', 'untitled', 'blank'] },
    { id: 'appearance',  label: 'Appearance',   ic: 'half',    kind: 'drill', page: 'appearance', chev: true,
      kw: ['theme', 'dark mode', 'light mode', 'accent', 'colour', 'color', 'text size', 'font', 'zoom', 'bigger', 'smaller', 'look'] },
    { id: 'toggle-sidebar', label: 'Toggle Sidebar', ic: 'sidebar', kbd: '⌘B', action: 'toggleSidebar', kw: ['files', 'tree', 'folders'] },
    // UXF-06 / UXF-03 / UXF-05
    { id: 'reveal-sidebar', label: 'Reveal in Sidebar', ic: 'sidebar', kbd: '⇧⌘J', action: 'revealSidebar', need: 'file', native: true,
      kw: ['locate', 'show', 'tree', 'navigator', 'find file'] },
    { id: 'collapse-folders', label: 'Collapse All Folders', ic: 'folder', action: 'collapseAllFolders', need: 'folder', kw: ['tree', 'fold', 'close folders'] },
    { id: 'swipe', label: 'Disable swipe to toggle sidebar', ic: 'sidebar', action: 'toggleSwipe', verb: 'Toggle', kw: ['gesture', 'trackpad', 'two finger', 'swipe'] },
    { id: 'start-page',  label: 'Start Page',   ic: 'win',     kbd: '⌘T',  action: 'newTab',     kw: ['new tab', 'launcher', 'blank tab'] },
    { id: 'close-tab',   label: 'Close Tab',    ic: 'close',   kbd: '⌘W',  action: 'closeTab',   need: 'doc', kw: ['close file'] },
    { id: 'edit',        label: 'Edit document', ic: 'pencil', kbd: '⌘E',  action: 'toggleEdit', need: 'doc', kw: ['edit', 'stop editing'] },
    { id: 'save',        label: 'Save',         ic: 'save',    kbd: '⌘S',  action: 'saveDoc',    need: 'save', kw: ['write'] },
    { id: 'find',        label: 'Find in Document', ic: 'search', kbd: '⌘F', action: 'findDoc',   need: 'doc', kw: ['search'] },
    { id: 'search-all',  label: 'Search All Tabs', ic: 'search', kbd: '⌘⇧F', action: 'searchAll', need: 'doc', kw: ['find everywhere'] },
    { id: 'reload',      label: 'Reload from Disk', ic: 'refresh', action: 'reloadFile',  need: 'file', kw: ['refresh', 'revert'] },
    { id: 'mermaid',     label: 'Disable Mermaid diagrams', ic: 'diagram', action: 'toggleMermaid', verb: 'Toggle', kw: ['diagram', 'mermaid'] },
    { id: 'prefs',       label: 'Preferences & Shortcuts…', ic: 'kbd', kbd: '?', action: 'shortcuts', kw: ['settings', 'keyboard', 'shortcuts'] },
    { id: 'move-left',   label: 'Move Tab Left',  ic: 'moveL', action: 'moveTabLeft',  need: 'left',  kw: ['reorder'] },
    { id: 'move-right',  label: 'Move Tab Right', ic: 'moveR', action: 'moveTabRight', need: 'right', kw: ['reorder'] },
    { id: 'print',       label: 'Print / Export PDF…', ic: 'print', kbd: '⌘P', action: 'printDoc', need: 'doc', kw: ['pdf', 'export'] },
    { id: 'restore',     label: 'Restore discarded edits', ic: 'refresh', kbd: '⌘Z', action: 'restoreDiscardedEdits', need: 'discarded', kw: ['undo discard'] },
    { id: 'reveal',      label: 'Reveal in Finder', ic: 'reveal', action: 'revealFinder', need: 'file', native: true, kw: ['finder', 'show in folder'] },
    { id: 'copy-path',   label: 'Copy Path',      ic: 'copy',   action: 'copyPath',     need: 'file', native: true, kw: ['path'] }
  ];
  function _cmd(id) {
    for (var i = 0; i < CMDS.length; i++) if (CMDS[i].id === id) return CMDS[i];
    return null;
  }

  // null when the command can run now, else the reason it cannot.
  function _avail(c, ctx) {
    if (c.native && !ctx.native) return 'Needs the desktop app';
    var cur = _activeDoc(ctx);
    switch (c.need) {
      case 'doc':
        return cur ? null : 'Open a file first';
      case 'save':
        if (!cur) return 'Open a file first';
        return (cur.dirty || cur.isNew) ? null : 'Nothing to save';
      case 'file':
        if (!cur) return 'Open a file first';
        return cur.nativePath ? null : 'Save the file first';
      case 'discarded':
        return ctx.hasDiscarded ? null : 'Nothing to restore';
      case 'folder':
        return ctx.openFolders.length ? null : 'Open a folder first';
      case 'left':
      case 'right': {
        if (!cur) return 'Open a file first';
        var i = ctx.tabs.indexOf(cur);
        if (c.need === 'left') return i <= 0 ? 'Already the first tab' : null;
        return i >= ctx.tabs.length - 1 ? 'Already the last tab' : null;
      }
    }
    return null;
  }

  // The label a command shows right now (edit and mermaid flip with state).
  function _cmdLabel(c, ctx) {
    if (c.id === 'edit') return ctx.mode === 'edit' ? 'Stop editing' : 'Edit document';
    if (c.id === 'mermaid') return ctx.mermaid ? 'Disable Mermaid diagrams' : 'Enable Mermaid diagrams';
    if (c.id === 'swipe') return ctx.swipe === false ? 'Enable swipe to toggle sidebar' : 'Disable swipe to toggle sidebar';
    return c.label;
  }

  /* ── appearance: values, pages ────────────────────────────*/
  var THEMES = [
    { v: 'light',  label: 'Light',  ic: 'sun',  kw: ['light mode', 'day'] },
    { v: 'dark',   label: 'Dark',   ic: 'moon', kw: ['dark mode', 'night'] },
    { v: 'system', label: 'System', ic: 'half', kw: ['auto', 'follow system'] }
  ];
  var ACCENTS = [
    { v: 'blue',     label: 'Blue',     kw: [] },
    { v: 'graphite', label: 'Graphite', kw: ['grey', 'gray'] },
    { v: 'warm',     label: 'Warm',     kw: ['orange'] }
  ];
  var SIZES = [13, 14, 16, 18, 20, 22];

  function _themeLabel(choice) {
    for (var i = 0; i < THEMES.length; i++) if (THEMES[i].v === choice) return THEMES[i].label;
    return 'System';
  }
  function _cap(s) { return s ? s.charAt(0).toUpperCase() + s.slice(1) : ''; }

  function _appearanceSummary(ctx) {
    var a = ctx.appearance;
    return _themeLabel(a.themeChoice) + ' · ' + _cap(a.accent) + ' · ' + a.fontSize + ' px';
  }

  // Drill rows: one level into Appearance.
  function _drillRows(ctx) {
    var a = ctx.appearance;
    return [
      { kind: 'drill', page: 'theme',  id: 'drill-theme',  ic: 'half', label: 'Theme',     sub: _themeLabel(a.themeChoice), chev: true,
        kw: ['appearance', 'mode', 'dark', 'light'] },
      { kind: 'drill', page: 'accent', id: 'drill-accent', swatch: a.accent, label: 'Accent', sub: _cap(a.accent), chev: true,
        kw: ['appearance', 'colour', 'color'] },
      { kind: 'drill', page: 'size',   id: 'drill-size',   ic: 'aa', label: 'Text size', sub: a.fontSize + ' px', chev: true,
        kw: ['appearance', 'font', 'zoom', 'bigger', 'smaller', 'larger'] }
    ];
  }

  // Value rows of a page. `preview` is what ↑↓ paints, `apply` what ↵ commits.
  function _valueRows(page, ctx) {
    var a = ctx.appearance, out = [], i;
    if (page === 'theme') {
      for (i = 0; i < THEMES.length; i++) {
        out.push({ kind: 'value', page: 'theme', id: 'theme-' + THEMES[i].v, ic: THEMES[i].ic, label: THEMES[i].label,
          kw: THEMES[i].kw, value: THEMES[i].v, check: a.themeChoice === THEMES[i].v, preview: { theme: THEMES[i].v } });
      }
    } else if (page === 'accent') {
      for (i = 0; i < ACCENTS.length; i++) {
        out.push({ kind: 'value', page: 'accent', id: 'accent-' + ACCENTS[i].v, swatch: ACCENTS[i].v, label: ACCENTS[i].label,
          kw: ACCENTS[i].kw, value: ACCENTS[i].v, check: a.accent === ACCENTS[i].v, preview: { accent: ACCENTS[i].v } });
      }
    } else if (page === 'size') {
      for (i = 0; i < SIZES.length; i++) {
        out.push({ kind: 'value', page: 'size', id: 'size-' + SIZES[i], ic: 'aa', label: SIZES[i] + ' px',
          sub: SIZES[i] === 16 ? 'Default' : '', value: SIZES[i], check: a.fontSize === SIZES[i], preview: { fontSize: SIZES[i] } });
      }
    }
    return out;
  }

  function _pageTitle(page) {
    return { appearance: 'Appearance', theme: 'Theme', accent: 'Accent', size: 'Text size' }[page] || 'Appearance';
  }

  /* ── row factories ────────────────────────────────────────
     Rows are plain data (no closures): the DOM layer renders them and
     _runRow dispatches on kind. */
  function _tabRow(t, m, ctx) {
    var cur = t.id === ctx.activeId;
    return {
      kind: 'tab', ic: 'doc', label: t.name, hl: m ? m.idx : [],
      sub: cur ? 'current tab' : (t.isNew ? 'unsaved' : _dirShort(_tabDir(t))),
      tabId: t.id, revealPath: t.nativePath || '', score: m ? m.score : 0
    };
  }
  function _fileRow(f, m) {
    return {
      kind: 'file', ic: 'doc', label: f.name || _baseName(f.path), hl: m ? m.idx : [],
      sub: _dirShort(_parent(f.path)), path: f.path, revealPath: f.path, score: m ? m.score : 0
    };
  }
  function _folderRow(f, m) {
    return {
      kind: 'folder', ic: 'folder', label: _baseName(f.path) + '/', hl: [],
      sub: _dirShort(_parent(f.path)), path: f.path, revealPath: f.path, score: m ? m.score : 0
    };
  }
  function _headingRow(tab, h, m) {
    return {
      kind: 'heading', ic: 'hash', label: h.text, hl: m ? m.idx : [], tag: 'H' + h.level,
      lvl: h.level, tabId: tab.id, heading: h.text, score: m ? m.score : 0
    };
  }
  function _cmdRow(c, m, ctx) {
    var reason = _avail(c, ctx);
    var label = _cmdLabel(c, ctx);
    var row = {
      kind: c.kind || 'cmd', id: c.id, ic: c.ic, label: label,
      hl: (m && !m.alias && label === c.label) ? m.idx : [],
      alias: (m && m.alias) ? m.alias : '', aliasHl: (m && m.alias) ? m.aliasIdx : [],
      kbd: c.kbd || '', action: c.action, verb: c.verb || '',
      dim: !!reason, reason: reason || '', score: m ? m.score : 0
    };
    if (c.kind === 'drill') {
      row.page = c.page; row.chev = true; row.sub = _appearanceSummary(ctx);
    }
    return row;
  }
  function _createRow(query) {
    var name = _mdName(query);
    return { kind: 'create', ic: 'plus', label: 'Create “' + name + '”', sub: 'Unsaved until you press ⌘S',
      name: name, hl: [], score: 0 };
  }

  // "notes" → "notes.md"; slashes and colons become dashes; keeps .md/.markdown/.txt.
  function _mdName(q) {
    var s = String(q || '').trim().replace(/[\/\\:]+/g, '-');
    return /\.(md|markdown|txt)$/i.test(s) ? s : s + '.md';
  }

  /* ── budget: share N rows between groups ──────────────────
     One row per non-empty group first (in group order), then the best of
     what is left, with unavailable rows heavily discounted. */
  function _allocate(groups, budget) {
    var take = groups.map(function () { return 0; }), left = budget;
    groups.forEach(function (g, i) { if (g.rows.length && left > 0) { take[i] = 1; left--; } });
    while (left > 0) {
      var bi = -1, bs = -1e9;
      groups.forEach(function (g, i) {
        if (take[i] < g.rows.length) {
          var r = g.rows[take[i]], s = (r.score || 0) - (r.dim ? 5000 : 0);
          if (s > bs) { bs = s; bi = i; }
        }
      });
      if (bi < 0) break;
      take[bi]++;
      left--;
    }
    return groups
      .map(function (g, i) { return { title: g.title, rows: g.rows.slice(0, take[i]) }; })
      .filter(function (g) { return g.rows.length; });
  }

  /* ── the model: what the list shows for (query, page, context) ─ */
  var PLACEHOLDER = 'Go to a file, heading or command';

  function _finish(model) {
    var flat = [];
    model.sections.forEach(function (s) {
      s.rows.forEach(function (r) { if (!r.dim) flat.push(r); });
    });
    model.flat = flat;
    return model;
  }

  function _zeroQuery(ctx) {
    var docs = _docTabs(ctx), has = docs.length > 0, cur = _activeDoc(ctx), i;
    var sw = _otherTabs(ctx).slice(0, 3).map(function (t) { return _tabRow(t, null, ctx); });
    var recMax = has ? 2 : 4;
    var rec = _closedRecents(ctx, recMax).map(function (e) {
      return e.type === 'folder' ? _folderRow(e, null) : _fileRow({ path: e.path }, null);
    });

    var defs;
    if (!has) defs = ['new-file', 'open-file', 'open-folder'];
    else if (cur && (cur.dirty || cur.isNew)) defs = ['save', 'edit', 'new-file', 'open-file'];
    else defs = ['new-file', 'open-file', 'edit', 'appearance'];
    var cap = has ? 4 : 3, order = [], usedN = 0;
    // Unsaved work always comes first; then the two commands you ran most recently.
    if (defs[0] === 'save') order.push('save');
    for (i = 0; i < ctx.used.length && usedN < 2; i++) {
      var uc = _cmd(ctx.used[i]);
      if (uc && !_avail(uc, ctx) && order.indexOf(uc.id) < 0) { order.push(uc.id); usedN++; }
    }
    defs.forEach(function (id) {
      var c = _cmd(id);
      if (c && order.indexOf(id) < 0 && !_avail(c, ctx)) order.push(id);
    });
    var acts = order.slice(0, cap).map(function (id) { return _cmdRow(_cmd(id), null, ctx); });

    // Trim to the budget: Recent gives way first, then Switch to.
    var over = sw.length + rec.length + acts.length - BUDGET;
    while (over > 0 && rec.length > 1) { rec.pop(); over--; }
    while (over > 0 && sw.length > 1) { sw.pop(); over--; }
    while (over > 0 && rec.length) { rec.pop(); over--; }

    var sections = [];
    if (sw.length) sections.push({ title: 'Switch to', rows: sw });
    if (rec.length) sections.push({ title: 'Recent', rows: rec });
    sections.push({ title: 'Actions', rows: acts });
    var n = sw.length + rec.length + acts.length;
    return _finish({
      kind: 'zero', sections: sections, placeholder: PLACEHOLDER,
      status: n + ' suggestions.' + (sw.length ? ' Previous tab selected.' : '')
    });
  }

  // "#": the headings of the current document, nothing else.
  function _outline(query, ctx) {
    var cur = _activeDoc(ctx), hq = query.slice(1).trim(), rows = [];
    if (cur) {
      _headingsFor(cur).forEach(function (h) {
        var m = _match(hq, h.text);
        if (m) rows.push(_headingRow(cur, h, m));
      });
    }
    // Document order when nothing is typed after "#"; best match first otherwise.
    if (hq) rows = _sortRows(rows);
    var hint = '';
    if (!cur) hint = 'Open a file to see its headings.';
    else if (!rows.length) hint = hq ? 'No heading matches “' + hq + '”.' : 'No headings in this document.';
    return _finish({
      kind: 'outline', sections: [{ title: 'Headings in ' + (cur ? cur.name : 'this document'), rows: rows }],
      placeholder: PLACEHOLDER, hint: hint,
      status: rows.length ? rows.length + (rows.length === 1 ? ' heading' : ' headings') : 'No headings'
    });
  }

  // An Appearance page: Appearance › Theme / Accent / Text size › values.
  function _pageModel(page, query, ctx) {
    var rows = page === 'appearance' ? _drillRows(ctx) : _valueRows(page, ctx);
    if (query) {
      rows = rows.map(function (r) {
        var m = _match(query, r.label, r.kw);
        if (!m) return null;
        r.hl = m.alias ? [] : m.idx; r.score = m.score;
        return r;
      }).filter(Boolean);
      rows = _sortRows(rows);
    }
    return _finish({
      kind: 'page', page: page, sections: [{ title: _pageTitle(page), rows: rows }], placeholder: 'Filter',
      hint: rows.length ? '' : 'Nothing matches “' + query + '”.',
      status: _pageTitle(page) + '. ' + rows.length + ' options. Arrow keys preview, Enter applies, Escape goes back.'
    });
  }

  function _typed(query, ctx) {
    var q = query.trim(), i;
    var tabs = [], files = [], acts = [];
    _docTabs(ctx).forEach(function (t) {
      var m = _match(q, t.name);
      if (!m && t.path) {
        var pm = _match(q, t.path);
        if (pm) m = { score: pm.score - 150, idx: [], tier: pm.tier };
      }
      if (m) tabs.push(_tabRow(t, m, ctx));
    });

    // Headings: the current document only. Other tabs' matches fold into one row.
    var cur = _activeDoc(ctx), hd = [], xn = 0;
    if (cur) {
      _headingsFor(cur).forEach(function (h) {
        var m = _match(q, h.text);
        if (m) hd.push(_headingRow(cur, h, m));
      });
    }
    hd = _sortRows(hd).slice(0, HEADING_RENDER_CAP);
    _docTabs(ctx).forEach(function (t) {
      if (cur && t.id === cur.id) return;
      _headingsFor(t).forEach(function (h) { if (_match(q, h.text)) xn++; });
    });
    if (xn) {
      hd.push({ kind: 'xtab', ic: 'mag2', label: xn + ' more in other tabs', sub: 'Search all open tabs', kbd: '⌘⇧F',
        query: q, hl: [], score: -1 });
    }

    // Files that are not open: recents and the open folders' trees.
    var seen = {}, pool = [];
    _closedRecents(ctx, 50).forEach(function (e) { if (!seen[e.path]) { seen[e.path] = 1; pool.push(e); } });
    _folderFiles(ctx).forEach(function (f) { if (!seen[f.path]) { seen[f.path] = 1; pool.push(f); } });
    pool.slice(0, FILE_ROW_CAP * 4).forEach(function (e) {
      if (e.type === 'folder') {
        var fm = _match(q, _baseName(e.path));
        if (fm) files.push(_folderRow(e, fm));
        return;
      }
      var name = e.name || _baseName(e.path);
      var m = _match(q, name);
      if (!m) {
        var dm = _match(q, _dirShort(_parent(e.path)) + '/' + name);
        if (dm) m = { score: dm.score - 150, idx: [], tier: dm.tier };
      }
      if (m) files.push(_fileRow({ path: e.path, name: name }, m));
    });
    files = _sortRows(files).slice(0, FILE_RENDER_CAP);

    // Actions: commands, then the appearance shortcuts ("dark", "text size").
    CMDS.forEach(function (c) {
      var m = _match(q, _cmdLabel(c, ctx), c.kw);
      if (m) acts.push(_cmdRow(c, m, ctx));
    });
    _drillRows(ctx).forEach(function (r) {
      var m = _match(q, r.label, r.kw);
      if (m && m.tier <= 3) { r.hl = m.alias ? [] : m.idx; r.score = m.score - 20; acts.push(r); }
    });
    var leaves = [];
    _valueRows('theme', ctx).concat(_valueRows('accent', ctx)).forEach(function (v) {
      var m = _match(q, v.label, v.kw);
      if (!m || m.tier > 3) return;
      v.kind = 'leaf';
      v.sub = v.page === 'theme' ? 'Theme' : 'Accent';
      v.hl = m.alias ? [] : m.idx; v.score = m.score;
      leaves.push(v);
    });
    acts = _sortRows(acts.concat(leaves));

    var groups = _allocate([
      { title: 'Switch to', rows: _sortRows(tabs) },
      { title: 'Headings', rows: hd },
      { title: 'Files', rows: files },
      { title: 'Actions', rows: acts }
    ], BUDGET);

    var selectable = 0, anyDim = false;
    groups.forEach(function (g) {
      g.rows.forEach(function (r) { if (r.dim) anyDim = true; else selectable++; });
    });
    var lead = '';
    if (!selectable) {
      groups.push({ title: '', rows: [_createRow(q)] });
      lead = (anyDim ? 'Nothing you can run matches “' : 'Nothing matches “') + q + '”.';
    }
    return _finish({
      kind: 'typed', sections: groups, placeholder: PLACEHOLDER, lead: lead,
      status: selectable ? selectable + (selectable === 1 ? ' result' : ' results')
        : 'No matches. Create “' + _mdName(q) + '” is selected.'
    });
  }

  function _buildModel(query, ctx, page) {
    ctx = ctx || _ctx();
    query = query == null ? '' : String(query);
    if (page) return _pageModel(page, query.trim(), ctx);
    if (query.charAt(0) === '#') return _outline(query, ctx);
    if (!query.trim()) return _zeroQuery(ctx);
    return _typed(query, ctx);
  }

  /* ── verbs and footer ─────────────────────────────────────*/
  function _verb(r) {
    if (!r) return '';
    if (r.verb) return r.verb;
    switch (r.kind) {
      case 'tab': return 'Switch to';
      case 'heading': return 'Jump to';
      case 'file': case 'folder': case 'drill': return 'Open';
      case 'create': return 'Create';
      case 'xtab': return 'Search';
      case 'leaf': case 'value': return 'Apply';
    }
    return 'Run';
  }

  function _footerKeys(model, row, query, page) {
    var f = [];
    if (page) f.push(['↑↓', 'Preview']);
    if (row) f.push(['↵', _verb(row)]);
    if (row && row.revealPath) f.push(['⌘↵', 'Reveal']);
    var q = (query || '').trim();
    if (!page && q && q.charAt(0) !== '#' && (!row || row.kind !== 'create')) f.push(['⇧↵', 'Create “' + _mdName(q) + '”']);
    f.push(['esc', page ? 'Back' : (query ? 'Clear' : 'Close')]);
    return f;
  }

  /* ── DOM: rows, list, footer ──────────────────────────────*/
  function _rowHtml(r, flatIdx, isSel, uid) {
    var swatch = r.swatch ? '<span class="sw sw-' + _esc(r.swatch) + '" aria-hidden="true"></span>' : '';
    var ic = swatch || (r.ic ? _ico(r.ic) : '');
    var label = (r.hl && r.hl.length) ? _hl(r.label, r.hl) : _esc(r.label);
    var sub = '';
    if (r.dim) sub = _esc(r.reason);
    else if (r.alias) sub = '· ' + _hl(r.alias, r.aliasHl || []);
    else if (r.sub) sub = _esc(r.sub);
    var trail = '';
    if (r.tag) trail += '<span class="tag">' + _esc(r.tag) + '</span>';
    if (r.check) trail += '<span class="ck" aria-label="current">' + _ico('check', 14) + '</span>';
    if (r.kbd) trail += '<span class="kbd">' + _esc(r.kbd) + '</span>';
    if (r.chev) trail += '<span class="cv" aria-hidden="true">' + _ico('chev', 13) + '</span>';
    var cls = 'tv-pal-row' + (isSel ? ' sel' : '') + (r.dim ? ' dim' : '') + (r.lvl ? ' lv' + r.lvl : '');
    return '<div class="' + cls + '" role="option" id="tv-pal-o' + uid + '" data-i="' + (r.dim ? -1 : flatIdx) + '"' +
      ' aria-selected="' + (isSel ? 'true' : 'false') + '"' + (r.dim ? ' aria-disabled="true"' : '') + '>' +
      '<span class="ic">' + ic + '</span>' +
      '<span class="lbl"><span class="main">' + label + '</span>' + (sub ? '<span class="sub">' + sub + '</span>' : '') + '</span>' +
      '<span class="trail">' + trail + (isSel ? _armedHtml(r) : '') + '</span>' +
      '</div>';
  }
  function _armedHtml(r) {
    return '<span class="verb">' + _esc(_verb(r)) + '</span><span class="enter" aria-hidden="true">↵</span>';
  }

  function _listHtml(model, sel) {
    var html = '', uid = 0, fi = 0, gi = 0;
    model.sections.forEach(function (s) {
      if (!s.rows.length) return;
      var gid = 'tv-pal-g' + (gi++);
      html += '<div class="tv-pal-sec" role="group"' + (s.title ? ' aria-labelledby="' + gid + '"' : '') + '>';
      if (s.title) html += '<div class="tv-pal-group" id="' + gid + '">' + _esc(s.title) + '</div>';
      s.rows.forEach(function (r) {
        var idx = r.dim ? -1 : fi++;
        html += _rowHtml(r, idx, !r.dim && idx === sel, uid++);
      });
      html += '</div>';
    });
    if (model.lead) html = '<div class="tv-pal-lead">' + _esc(model.lead) + '</div>' + html;
    if (model.hint && !model.flat.length && !model.sections.some(function (s) { return s.rows.length; })) {
      html += '<div class="tv-pal-empty">' + _esc(model.hint) + '</div>';
    } else if (model.hint) {
      html += '<div class="tv-pal-empty">' + _esc(model.hint) + '</div>';
    }
    return html;
  }

  function _footHtml(keys) {
    return keys.map(function (k) {
      return '<span class="k"><span class="kbd">' + _esc(k[0]) + '</span> ' + _esc(k[1]) + '</span>';
    }).join('');
  }

  function _buildOverlayHtml(query, page) {
    var model = _buildModel(query, _ctx(), page);
    var sel = _initialSel(model);
    return '<div class="tv-palette-scrim" id="tv-pal-scrim">' +
      '<div class="tv-palette" id="tv-pal-box" role="dialog" aria-modal="true" aria-label="Command palette">' +
        '<div class="tv-pal-input">' +
          '<span class="ic">' + _ico('search', 16) + '</span>' +
          '<input class="tv-pal-input-field" id="tv-pal-input-field" type="text" autocomplete="off" spellcheck="false"' +
            ' autocorrect="off" autocapitalize="off" role="combobox" aria-expanded="true" aria-haspopup="listbox" aria-label="Command palette"' +
            ' aria-autocomplete="list" aria-controls="tv-pal-list"' +
            ' placeholder="' + _esc(model.placeholder) + '" value="' + _esc(query) + '">' +
        '</div>' +
        '<div class="tv-pal-list" id="tv-pal-list" role="listbox" aria-label="Results">' + _listHtml(model, sel) + '</div>' +
        '<div class="tv-pal-foot" id="tv-pal-foot">' + _footHtml(_footerKeys(model, model.flat[sel], query, page)) + '</div>' +
        '<div class="tv-visually-hidden" id="tv-pal-status" role="status" aria-live="polite"></div>' +
      '</div>' +
    '</div>';
  }

  /* ── state while open ─────────────────────────────────────*/
  var _model = null;       // last model rendered
  var _sel = 0;            // index into _model.flat
  var _query = '';
  var _pageId = null;      // null | 'appearance' | 'theme' | 'accent' | 'size'
  var _pageStack = [];     // pages above the current one (for Back)
  var _prevFocusEl = null;

  // On a value page the current value is armed, so opening a page changes nothing.
  function _initialSel(model) {
    if (model.kind === 'page') {
      for (var i = 0; i < model.flat.length; i++) if (model.flat[i].check) return i;
    }
    return 0;
  }

  function _inputEl() { return _overlayEl && _overlayEl.querySelector('.tv-pal-input-field'); }
  function _listEl() { return _overlayEl && _overlayEl.querySelector('#tv-pal-list'); }

  // C-10: mark the list when MORE of it is below the fold (css paints a bottom
  // fade on it). Re-run on scroll, so the fade is gone once you reach the end.
  function _syncOverflowFlag() {
    var listEl = _listEl();
    if (!listEl || typeof listEl.scrollHeight !== 'number') return;
    var moreBelow = listEl.scrollHeight - listEl.scrollTop > listEl.clientHeight + 1;
    listEl.classList.toggle('is-overflowing', moreBelow);
  }

  function _paintFooter() {
    var foot = _overlayEl && _overlayEl.querySelector('#tv-pal-foot');
    if (foot) foot.innerHTML = _footHtml(_footerKeys(_model, _model.flat[_sel], _query, _pageId));
  }

  function _paintStatus() {
    var st = _overlayEl && _overlayEl.querySelector('#tv-pal-status');
    if (st && _model) st.textContent = _model.status || '';
  }

  // Full recompute: query or page changed.
  function _refresh(keepSel) {
    if (!_overlayEl) return;
    _model = _buildModel(_query, _ctx(), _pageId);
    _sel = keepSel ? Math.min(_sel, Math.max(0, _model.flat.length - 1)) : _initialSel(_model);
    var listEl = _listEl();
    if (listEl) listEl.innerHTML = _listHtml(_model, _sel);
    var inp = _inputEl();
    if (inp) {
      inp.placeholder = _model.placeholder;
      if (_model.flat[_sel]) inp.setAttribute('aria-activedescendant', _rowEls()[_sel] ? _rowEls()[_sel].id : '');
      else inp.removeAttribute('aria-activedescendant');
    }
    _paintFooter();
    _paintStatus();
    _syncOverflowFlag();
    _previewSelected();
  }

  function _rowEls() {
    var listEl = _listEl();
    if (!listEl) return [];
    return Array.prototype.slice.call(listEl.querySelectorAll('.tv-pal-row')).filter(function (el) {
      return el.getAttribute('data-i') !== '-1';
    });
  }

  // Move the armed row in place (no list rebuild, so a long outline keeps its scroll).
  function _setSel(idx) {
    if (!_model || !_model.flat.length) return;
    var rows = _rowEls();
    var next = Math.max(0, Math.min(idx, _model.flat.length - 1));
    if (rows[_sel]) {
      rows[_sel].classList.remove('sel');
      rows[_sel].setAttribute('aria-selected', 'false');
      var old = rows[_sel].querySelector('.verb'); if (old) old.parentNode.removeChild(old);
      var olde = rows[_sel].querySelector('.enter'); if (olde) olde.parentNode.removeChild(olde);
    }
    _sel = next;
    var el = rows[_sel];
    if (el) {
      el.classList.add('sel');
      el.setAttribute('aria-selected', 'true');
      var trail = el.querySelector('.trail');
      if (trail) trail.insertAdjacentHTML('beforeend', _armedHtml(_model.flat[_sel]));
      if (el.scrollIntoView) el.scrollIntoView({ block: 'nearest' });
      var inp = _inputEl();
      if (inp) inp.setAttribute('aria-activedescendant', el.id);
    }
    _paintFooter();
    _previewSelected();
  }

  // ↑↓ on a value page paints that value live. Nothing persists until ↵.
  function _previewSelected() {
    if (!_model || _model.kind !== 'page') return;
    var r = _model.flat[_sel];
    if (r && r.preview && window.TV && typeof window.TV.previewAppearance === 'function') {
      window.TV.previewAppearance(r.preview);
    }
  }
  function _endPreview() {
    if (window.TV && typeof window.TV.endAppearancePreview === 'function') window.TV.endAppearancePreview();
  }

  function _enterPage(id) {
    if (_pageId) _pageStack.push(_pageId);
    _pageId = id;
    _query = '';
    var inp = _inputEl();
    if (inp) { inp.value = ''; inp.focus(); }
    _refresh(false);
  }
  // esc / ⌫ on an empty field: revert the preview and go up one level.
  function _pageBack() {
    _endPreview();
    _pageId = _pageStack.length ? _pageStack.pop() : null;
    _query = '';
    var inp = _inputEl();
    if (inp) { inp.value = ''; inp.focus(); }
    _refresh(false);
  }

  /* ── actions ──────────────────────────────────────────────*/
  function _toast(msg, kind) {
    if (window.TVNative && typeof TVNative.showToast === 'function') TVNative.showToast(msg, kind ? { kind: kind } : undefined);
  }
  function _activeTab() {
    if (window.TV && typeof window.TV.getActiveTab === 'function') return window.TV.getActiveTab();
    var st = window.TV && window.TV.state;
    if (!st || !st.tabs) return null;
    for (var i = 0; i < st.tabs.length; i++) if (st.tabs[i].id === st.activeId) return st.tabs[i];
    return null;
  }

  // Each action delegates to the entry point its keyboard accelerator uses, so
  // the palette can never drift from the shortcut it advertises.
  function _runAction(action) {
    var TV = window.TV;
    if (!TV) return;
    switch (action) {
      case 'openFile':
        if (window.TVFiles && typeof TVFiles.openPicker === 'function') TVFiles.openPicker();
        return;
      case 'openFolder':
        if (window.TVNative && typeof TVNative.openFolder === 'function') TVNative.openFolder();
        else if (typeof TV.openFolder === 'function') TV.openFolder();
        return;
      case 'newFile':
        if (typeof TV.newFile === 'function') TV.newFile();
        return;
      case 'newTab':
        if (typeof TV.openUntitledTab === 'function') TV.openUntitledTab();
        return;
      case 'toggleSidebar':
        if (typeof TV.toggleSidebar === 'function') TV.toggleSidebar();
        return;
      case 'revealSidebar':
        if (typeof TV.revealInSidebar === 'function') TV.revealInSidebar();
        return;
      case 'collapseAllFolders':
        if (typeof TV.collapseAllFolders === 'function') TV.collapseAllFolders();
        return;
      case 'toggleSwipe':
        if (typeof TV.toggleSwipe === 'function') TV.toggleSwipe();
        return;
      case 'closeTab':
        if (TV.state && TV.state.activeId && typeof TV.closeTab === 'function') TV.closeTab(TV.state.activeId);
        return;
      case 'toggleEdit':
        if (typeof TV.setMode === 'function') TV.setMode((TV.state && TV.state.mode === 'edit') ? 'reading' : 'edit');
        return;
      case 'saveDoc':
        if (typeof TV.handleSave === 'function') TV.handleSave();
        return;
      case 'findDoc':
        if (typeof TV.openFindBar === 'function') TV.openFindBar();
        return;
      case 'searchAll':
        if (window.TVSearch && typeof TVSearch.open === 'function') TVSearch.open();
        return;
      case 'reloadFile':
        if (typeof TV.reloadActiveTab === 'function') TV.reloadActiveTab();
        return;
      case 'toggleMermaid':
        if (typeof TV.toggleMermaid === 'function') TV.toggleMermaid();
        return;
      case 'shortcuts':
        if (typeof TV.openShortcuts === 'function') TV.openShortcuts();
        return;
      case 'restoreDiscardedEdits':
        if (typeof TV.restoreDiscardedEdits === 'function') TV.restoreDiscardedEdits();
        return;
      case 'printDoc':
        // window.print() is a no-op in WKWebView — prefer the native print command.
        if (window.__TAURI__ && window.__TAURI__.core && typeof window.__TAURI__.core.invoke === 'function') {
          window.__TAURI__.core.invoke('print_page').catch(function (err) {
            console.warn('U-15: native print failed; falling back to window.print()', err);
            if (typeof window.print === 'function') window.print();
          });
        } else if (typeof window.print === 'function') {
          window.print();
        }
        return;
      case 'revealFinder': {
        // P2-10: every failure path toasts; nothing closes silently.
        var rTab = _activeTab();
        var rPath = rTab && (rTab.nativePath || rTab.path);
        if (rPath && window.TVNative && typeof TVNative.revealInFinder === 'function') TVNative.revealInFinder(rPath);
        else _toast('Save this document first, then reveal it in Finder', 'error');
        return;
      }
      case 'copyPath': {
        var cTab = _activeTab();
        var cPath = cTab && (cTab.nativePath || cTab.path);
        if (!cPath) { _toast('Save this document first, then copy its path', 'error'); return; }
        if (!navigator.clipboard || typeof navigator.clipboard.writeText !== 'function') { _toast('Could not copy path', 'error'); return; }
        navigator.clipboard.writeText(cPath).then(function () { _toast('Path copied'); })
          .catch(function () { _toast('Could not copy path', 'error'); });
        return;
      }
      case 'moveTabLeft':
      case 'moveTabRight': {
        // U-14 / DR-98: splice the active tab one slot, then render + save the session.
        if (!TV.state) return;
        var tabs = TV.state.tabs, activeId = TV.state.activeId, activeIdx = -1;
        for (var mti = 0; mti < tabs.length; mti++) if (tabs[mti].id === activeId) { activeIdx = mti; break; }
        if (activeIdx === -1) return;
        var targetIdx = action === 'moveTabLeft' ? activeIdx - 1 : activeIdx + 1;
        if (targetIdx < 0 || targetIdx >= tabs.length) return;
        var movedTab = tabs.splice(activeIdx, 1)[0];
        tabs.splice((targetIdx > activeIdx) ? targetIdx - 1 : targetIdx, 0, movedTab);
        if (typeof TV.render === 'function') TV.render();
        if (typeof TV.saveSession === 'function') TV.saveSession();
        return;
      }
    }
  }

  function _openSearchWith(query) {
    if (!(window.TVSearch && typeof TVSearch.open === 'function')) return;
    TVSearch.open();
    var input = document.querySelector('.tv-search-input, .tv-search-field');
    if (input) {
      input.value = query;
      input.dispatchEvent(new Event('input', { bubbles: true }));
    }
  }

  // Activate one row. `mods` = { meta, shift } from the key that ran it.
  function _runRow(row, mods) {
    mods = mods || {};
    var TV = window.TV;
    if (!TV) { TVPalette.close(); return; }
    if (!row || row.dim) return;

    // ⌘↵ reveals in Finder (file-like rows only).
    if (mods.meta) {
      if (!row.revealPath) return;
      TVPalette.close();
      if (window.TVNative && typeof TVNative.revealInFinder === 'function') TVNative.revealInFinder(row.revealPath);
      return;
    }

    // Moving down a level keeps the palette open.
    if (row.kind === 'drill') { _enterPage(row.page); return; }

    // Everything else closes the palette first. close() also ends an appearance
    // preview, so the commit below starts from the real state.
    TVPalette.close();

    switch (row.kind) {
      case 'tab':
        TV.activateTab(row.tabId);
        return;
      case 'heading':
        TV.scrollToHeading(row.tabId, row.heading);
        return;
      case 'file':
        if (typeof TV.openPath === 'function' && _isNative()) TV.openPath(row.path);
        else _toast('Opening a file by path needs the desktop app', 'error');
        return;
      case 'folder':
        if (window.TVNative && typeof TVNative.reopenFolder === 'function') {
          TVNative.reopenFolder(row.path).catch(function () { /* the helper already toasted */ });
        }
        return;
      case 'create':
        if (typeof TV.newFile === 'function') TV.newFile(row.name);
        return;
      case 'xtab':
        _openSearchWith(row.query);
        return;
      case 'value':
      case 'leaf':
        if (row.page === 'theme' && typeof TV.setTheme === 'function') TV.setTheme(row.value);
        else if (row.page === 'accent' && typeof TV.setAccent === 'function') TV.setAccent(row.value);
        else if (row.page === 'size' && typeof TV.setFontSize === 'function') TV.setFontSize(row.value);
        return;
      case 'cmd':
        _markUsed(row.id);
        _runAction(row.action);
        return;
    }
  }

  function _runSelected(mods) {
    if (!_model) return;
    // ⇧↵ creates from the query even when a row is armed (that is the point of it).
    if (mods && mods.shift && _createFromQuery()) return;
    var row = _model.flat[_sel];
    if (row) _runRow(row, mods);
  }

  // ⇧↵: create a file named after the query, whatever else matches.
  // Returns true when it created (false inside a page, in "#" mode, or on an empty query).
  function _createFromQuery() {
    var q = (_query || '').trim();
    if (!q || q.charAt(0) === '#' || _pageId) return false;
    var name = _mdName(q);
    TVPalette.close();
    if (window.TV && typeof window.TV.newFile === 'function') window.TV.newFile(name);
    return true;
  }

  /* ── C-32: Tab trap ───────────────────────────────────────
     WKWebView gotcha: programmatic .focus() on a div[tabindex] is a no-op
     when macOS Full Keyboard Access is off, so we never move focus onto a
     div. The palette's only real focusable is the input, so the trap is a
     preventDefault that keeps focus where it already is; when a future
     revision adds more real controls the cycle below handles them. */
  function _focusables() {
    if (!_overlayEl) return [];
    var box = _overlayEl.querySelector('#tv-pal-box');
    if (!box) return [];
    var sel = 'input:not([disabled]), button:not([disabled]), select, textarea, a[href]';
    return Array.prototype.slice.call(box.querySelectorAll(sel)).filter(function (el) {
      return el.offsetParent !== null || el === document.activeElement;
    });
  }

  function _trapTab(e) {
    var list = _focusables();
    e.preventDefault();
    if (list.length < 2) {
      // Single control: keep focus on it rather than letting Tab escape.
      if (list.length === 1 && list[0] !== document.activeElement) list[0].focus();
      return;
    }
    var idx = list.indexOf(document.activeElement);
    var next = e.shiftKey
      ? (idx <= 0 ? list.length - 1 : idx - 1)
      : (idx === -1 || idx === list.length - 1 ? 0 : idx + 1);
    list[next].focus();
  }

  /* ── keyboard handler (attached while open) ───────────────*/
  function _onKeyDown(e) {
    if (!_open) return;
    if (e.isComposing) return; // IME composition owns the keys
    var k = e.key;
    if (k === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      // Back out one step at a time: page, then the query, then the palette.
      if (_pageId) { _pageBack(); return; }
      var inp = _inputEl();
      if (inp && inp.value) { inp.value = ''; _query = ''; _refresh(false); return; }
      TVPalette.close();
      return;
    }
    if (k === 'Tab') {
      // C-32: modal dialog — focus must not leak to the page behind.
      e.stopPropagation();
      _trapTab(e);
      return;
    }
    // stopPropagation on every key the palette owns: the shell's router treats
    // Ctrl as ⌘, so an unstopped ⌃N would create a file and ⌃P would print.
    if (k === 'ArrowDown' || (e.ctrlKey && (k === 'n' || k === 'N'))) {
      e.preventDefault();
      e.stopPropagation();
      _setSel(_sel + 1);
      return;
    }
    if (k === 'ArrowUp' || (e.ctrlKey && (k === 'p' || k === 'P'))) {
      e.preventDefault();
      e.stopPropagation();
      _setSel(_sel - 1);
      return;
    }
    if (k === 'Enter') {
      e.preventDefault();
      e.stopPropagation();
      _runSelected({ meta: e.metaKey, shift: e.shiftKey });
      return;
    }
    if (k === 'Backspace' && _pageId) {
      var inp2 = _inputEl();
      if (inp2 && !inp2.value) { e.preventDefault(); e.stopPropagation(); _pageBack(); }
    }
  }

  /* ── public API ───────────────────────────────────────────*/
  var TVPalette = {
    // opts.query pre-fills the field ("#" opens straight into the headings).
    open: function (opts) {
      var pre = (opts && typeof opts.query === 'string') ? opts.query : '';
      if (_open) {
        // Already open: re-focus, and honour a pre-filled query (⌘⌥O while open).
        var inp = _inputEl();
        if (inp) {
          if (pre && inp.value !== pre) {
            if (_pageId) { _endPreview(); _pageId = null; _pageStack = []; }
            inp.value = pre; _query = pre; _refresh(false);
          }
          inp.focus();
        }
        return;
      }

      if (!window.TV) return;
      var root = window.TV.el();
      if (!root) return;

      // UI-03: capture focus before opening so close() can restore it
      _prevFocusEl = document.activeElement;

      _wireMruListener();

      // Prime MRU with current active tab if not yet tracked
      var state = window.TV.state;
      if (state && state.activeId && _mru.indexOf(state.activeId) === -1) {
        _mru.unshift(state.activeId);
      }

      _query = pre;
      _pageId = null;
      _pageStack = [];
      var wrapper = document.createElement('div');
      wrapper.innerHTML = _buildOverlayHtml(_query, null);
      _overlayEl = wrapper.firstChild;
      root.appendChild(_overlayEl);
      // UXF-08 (amended 2026-10-09, "I can hardly see any animation"): the
      // scrim fades in and the panel drops in from just above with a slight
      // scale, Spotlight-style. Reduce Motion: an 80ms scrim fade only.
      // Closing stays instant.
      if (window.TVMotion) {
        window.TVMotion.enter(_overlayEl, { dur: 'base', reducedFade: true });
        var panelEl = _overlayEl.querySelector('.tv-palette');
        if (panelEl) {
          window.TVMotion.play(panelEl, [
            { opacity: 0, transform: 'translateY(-8px) scale(.96)' },
            { opacity: 1, transform: 'none' }
          ], { dur: 'base', ease: 'enter' });
        }
      }
      _open = true;
      _model = _buildModel(_query, _ctx(), null);
      _sel = _initialSel(_model);
      var firstRow = _rowEls()[_sel];
      var listForScroll = _listEl();
      if (listForScroll) listForScroll.addEventListener('scroll', _syncOverflowFlag);
      var inputEl = _inputEl();
      if (inputEl && firstRow) inputEl.setAttribute('aria-activedescendant', firstRow.id);
      _paintStatus();
      _syncOverflowFlag();

      if (inputEl) {
        inputEl.focus();
        // Caret after the pre-filled "#", not before it.
        try { inputEl.setSelectionRange(inputEl.value.length, inputEl.value.length); } catch (e) { /* not selectable */ }
        inputEl.addEventListener('input', function () {
          _query = inputEl.value;
          _refresh(false);
        });
      }

      // Click on scrim (outside palette) → close
      _overlayEl.addEventListener('click', function (e) {
        var box = document.getElementById('tv-pal-box');
        if (box && box.contains(e.target)) return;
        TVPalette.close();
      });

      // Click on row → run it. Stop propagation: the dispatch path was
      // computed before close() removed the overlay, so without this the
      // click reaches tvEl's [data-tab-id] handler and re-activates the tab.
      // Hover only tints (CSS); it never moves the armed row.
      _overlayEl.addEventListener('click', function (e) {
        var rowEl = e.target.closest('.tv-pal-row');
        if (!rowEl) return;
        e.stopPropagation();
        var i = parseInt(rowEl.getAttribute('data-i'), 10);
        if (isNaN(i) || i < 0 || !_model || !_model.flat[i]) return;
        _sel = i;
        _runRow(_model.flat[i], { meta: e.metaKey, shift: e.shiftKey });
      });

      document.addEventListener('keydown', _onKeyDown, true);
    },

    close: function () {
      if (!_open) return;
      _open = false;
      if (_pageId) _endPreview();   // an unfinished preview never outlives the palette
      _pageId = null;
      _pageStack = [];
      document.removeEventListener('keydown', _onKeyDown, true);
      if (_overlayEl && _overlayEl.parentNode) {
        _overlayEl.parentNode.removeChild(_overlayEl);
      }
      _overlayEl = null;
      _model = null;
      _sel = 0;
      _query = '';
      // UI-03 / C-32: restore focus to the element that was active before the
      // dialog opened (ARIA APG requirement, not just a nicety).
      if (_prevFocusEl && typeof _prevFocusEl.focus === 'function') {
        try { _prevFocusEl.focus(); } catch (e) { /* ignore stale reference */ }
      }
      _prevFocusEl = null;
    },

    isOpen: function () {
      return _open;
    },

    // U-16 / DR-42: ⌘⌥O opens the palette with "#" typed, i.e. the headings of
    // the current document. Same list, one character of scope.
    openOutline: function () {
      TVPalette.open({ query: '#' });
    }
  };

  window.TVPalette = TVPalette;
  _wireMruAtLoad();

  /* ── test seam ────────────────────────────────────────────
     tv-palette.test.js loads this file via `vm` and drives the pure
     matcher/model builders directly. */
  TVPalette._internals = {
    scoreText: _scoreText,
    match: _match,
    highlight: _hl,
    parseHeadings: _parseHeadings,
    headingsFor: _headingsFor,
    buildModel: _buildModel,
    mdName: _mdName,
    verb: _verb,
    footerKeys: _footerKeys,
    avail: _avail,
    allocate: _allocate,
    sortRows: _sortRows,
    rankRows: _rankRows,
    cmds: CMDS,
    caps: { files: FILE_ROW_CAP, headings: HEADINGS_PER_TAB_CAP,
            filesRender: FILE_RENDER_CAP, headingsRender: HEADING_RENDER_CAP, budget: BUDGET },
    headCache: _headCache
  };
})();
