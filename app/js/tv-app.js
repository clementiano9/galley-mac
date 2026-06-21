/* ───────────────────────────────────────────────────────────
   tiny-viewer · app spine
   window.TV — state, render loop, chrome, tabs, sidebar,
               keyboard router, theme/accent.
   Owns: index.html + js/tv-app.js  (contract §file-ownership)
   ─────────────────────────────────────────────────────────── */
(function () {
  'use strict';

  /* ── augment icon set with F-19 / F-22 icons ─────────────── */
  // tv-icons.js loads first; we add the keys that were not in the original set.
  // Using Object.assign-style guard so existing keys are never clobbered.
  (function () {
    var I = window.TV_ICONS = window.TV_ICONS || {};
    if (!I.chevron) I.chevron = '<svg width="10" height="10" viewBox="0 0 10 10" fill="currentColor"><path d="M3.4 2 6.6 5 3.4 8z"/></svg>';
    if (!I.reveal)  I.reveal  = '<svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"><path d="M6.5 3H3.5v9.5h9.5V9.5"/><path d="M9.5 3H13v3.5M13 3 7.5 8.5"/></svg>';
    if (!I.refresh) I.refresh = '<svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"><path d="M12.8 3.6v3.2H9.6"/><path d="M12.4 6.4A5 5 0 1 0 13 9.4"/></svg>';
    if (!I.ellipsis)I.ellipsis= '<svg width="15" height="15" viewBox="0 0 16 16" fill="currentColor"><circle cx="4" cy="8" r="1.25"/><circle cx="8" cy="8" r="1.25"/><circle cx="12" cy="8" r="1.25"/></svg>';
    if (!I.kbd)     I.kbd     = '<svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3"><rect x="1.5" y="4" width="13" height="8" rx="1.6"/><path d="M4 6.6h.01M6.5 6.6h.01M9 6.6h.01M11.5 6.6h.01M4.6 9.5h6.8" stroke-linecap="round"/></svg>';
  }());

  /* ── tiny id generator ────────────────────────────────────── */
  var _idSeq = 0;
  function uid() { return 'tv-' + (++_idSeq) + '-' + Date.now(); }

  /* ── icon helper (shorthand) ──────────────────────────────── */
  function ic(name) {
    var icons = window.TV_ICONS || {};
    return '<span class="ic">' + (icons[name] || '') + '</span>';
  }

  /* ── HTML escape ──────────────────────────────────────────── */
  function esc(s) {
    return String(s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  /* ── fuzzy search (launcher) ──────────────────────────────────
     Self-contained subsequence scorer. fuzzyScore() matches every
     query char against `text` in order (case-insensitive) and returns
     { score, indices } where indices are positions in `text` that
     matched, or null when no subsequence match exists. fuzzyMatchFile()
     scores a file across three fields (basename > folder > full path),
     returns the best field's score plus the matched indices IN THE
     DISPLAYED STRING (name or path) so the UI can highlight safely. */

  // Characters that begin a "segment" — matches landing right after one
  // (or at index 0) earn a boundary bonus, mirroring CamelCase/path-part
  // intuition used by editor fuzzy finders.
  function _isBoundaryChar(ch) {
    return ch === '/' || ch === '.' || ch === '-' || ch === '_' || ch === ' ' || ch === '\\';
  }

  // Greedy left-to-right subsequence match with positional bonuses.
  // Scoring (higher = better):
  //   +base per matched char, +consecutive-run bonus when the previous
  //   query char matched the immediately preceding text char, +boundary
  //   bonus when a match lands at a segment start, and a gap penalty for
  //   skipped text characters between matches. Returns null on no match.
  function fuzzyScore(query, text) {
    if (!query) return { score: 0, indices: [] };
    var q = String(query).toLowerCase();
    var t = String(text);
    var tl = t.toLowerCase();
    var indices = [];
    var score = 0;
    var ti = 0;
    var prevMatch = -2; // index of previous matched char (for run/gap calc)
    for (var qi = 0; qi < q.length; qi++) {
      var qc = q.charAt(qi);
      var found = -1;
      for (; ti < tl.length; ti++) {
        if (tl.charAt(ti) === qc) { found = ti; break; }
      }
      if (found === -1) return null; // query char not found in order → no match
      indices.push(found);
      score += 10; // base per-char credit
      // Consecutive run: this match directly follows the previous match.
      if (found === prevMatch + 1) {
        score += 15;
      } else if (prevMatch >= 0) {
        // Gap between matches: penalize proportional to how far we jumped,
        // capped so long paths don't drown out a real hit.
        var gap = found - prevMatch - 1;
        score -= Math.min(gap, 8) * 2;
      }
      // Boundary: match at start of string or right after a separator.
      if (found === 0 || _isBoundaryChar(t.charAt(found - 1))) {
        score += 12;
      }
      prevMatch = found;
      ti = found + 1;
    }
    // Reward matches that cover a larger share of the text (tighter match).
    score += Math.round((q.length / Math.max(t.length, 1)) * 8);
    return { score: score, indices: indices };
  }

  // Score one file across basename / folder / full path. Fields carry
  // descending weight so a basename hit outranks a path-only hit. Returns
  // the best result with indices mapped into the string the UI shows:
  //   field 'name'  → indices into `name`
  //   field 'folder'/'path' → indices into `path`
  // Returns null when the query matches none of the fields.
  function fuzzyMatchFile(query, f) {
    var q = String(query == null ? '' : query).replace(/\s+/g, '');
    if (!q) return { score: 0, field: 'name', nameIndices: [], pathIndices: [] };
    var name = f.name || '';
    var folder = f.folder || '';
    var path = f.path || '';

    var sName = fuzzyScore(q, name);
    var sFolder = folder ? fuzzyScore(q, folder) : null;
    var sPath = path ? fuzzyScore(q, path) : null;

    // Field weighting: basename strongest, folder next, full path weakest.
    var best = null;
    if (sName) best = { score: sName.score + 120, field: 'name', sName: sName, sPath: null };
    if (sFolder) {
      var fScore = sFolder.score + 60;
      if (!best || fScore > best.score) {
        // Map folder match onto the displayed path for highlighting.
        best = { score: fScore, field: 'folder', sName: null, sPath: _mapFolderToPath(sFolder, folder, path) };
      }
    }
    if (sPath) {
      var pScore = sPath.score + 0;
      if (!best || pScore > best.score) {
        best = { score: pScore, field: 'path', sName: null, sPath: sPath };
      }
    }
    if (!best) return null;
    return {
      score: best.score,
      field: best.field,
      nameIndices: best.sName ? best.sName.indices : [],
      pathIndices: best.sPath ? best.sPath.indices : []
    };
  }

  // Translate indices found within the folder substring into indices
  // within the full displayed path, so a folder-field match still
  // highlights the right characters in the path text.
  function _mapFolderToPath(folderResult, folder, path) {
    if (!path) return { indices: [] };
    var at = path.toLowerCase().indexOf(folder.toLowerCase());
    if (at === -1) return { indices: folderResult.indices.slice() };
    return {
      indices: folderResult.indices.map(function (i) { return i + at; })
    };
  }

  // Build highlighted, ESCAPED HTML: wrap matched indices in <span class="hl">.
  // `text` is untrusted (user file names/paths) so every slice is escaped;
  // we never inject raw strings into innerHTML.
  function highlightIndices(text, indices) {
    var s = String(text);
    if (!indices || !indices.length) return esc(s);
    var mark = {};
    indices.forEach(function (i) { mark[i] = true; });
    var out = '';
    var run = '';
    var inHl = false;
    for (var i = 0; i < s.length; i++) {
      var hit = !!mark[i];
      if (hit !== inHl) {
        if (run) out += inHl ? '<span class="hl">' + esc(run) + '</span>' : esc(run);
        run = '';
        inHl = hit;
      }
      run += s.charAt(i);
    }
    if (run) out += inHl ? '<span class="hl">' + esc(run) + '</span>' : esc(run);
    return out;
  }

  /* ── tiny event emitter ───────────────────────────────────── */
  var _listeners = {};
  function tvOn(event, fn) {
    (_listeners[event] = _listeners[event] || []).push(fn);
  }
  function tvEmit(event, payload) {
    (_listeners[event] || []).forEach(function (fn) {
      try { fn(payload); } catch (e) { /* isolate listener errors */ }
    });
  }

  /* ── state ────────────────────────────────────────────────── */
  var state = {
    tabs: [],
    activeId: null,
    // F-09: default is set responsively in init() from window width
    // (≥1440 → open). sidebarUserToggled flips true on the first ⌘B/toggle so
    // the resize handler stops overriding the user's explicit choice.
    sidebarOpen: true,
    sidebarUserToggled: false,
    mode: 'reading',       // 'reading' | 'edit'
    theme: localStorage.getItem('tv-theme') || 'light',
    accent: localStorage.getItem('tv-accent') || 'blue',
    fontSize: parseInt(localStorage.getItem('tv-font-size'), 10) || 16,
    // BUG-4: sidebar drag-resize width (clamp 160–480px). Persisted to localStorage.
    // dev2 reads --tv-sidebar-w on .tv-sidebar { width: var(--tv-sidebar-w, 224px) }.
    sidebarWidth: (function () {
      var stored = parseInt(localStorage.getItem('tv-sidebar-w'), 10);
      return (stored >= 160 && stored <= 480) ? stored : 224;
    }()),
    // DR-56: true while session restore is in progress; external file-open events
    // are buffered via enqueueExternalOpen() and drained once restore completes.
    sessionRestoring: false,
    // F-19 / DR-33: open folder tree objects, ordered most-recently-opened last.
    // Each entry is the tree object returned by TVNative.readDirTree():
    //   { path, files:[{name,path}], subfolders:[{name,files}], deep:[{name,path,from}] }
    // keyed by `path` (unique per folder).
    openFolders: [],
    // F-19: per-folder collapse state. Keys:
    //   <folderPath>           → true = folder head collapsed
    //   <folderPath>/<subName> → true = subfolder collapsed
    //   <folderPath>/__deep    → true = deep-bucket collapsed
    folderCollapsed: {},
    // F-22 / U-06: shortcut overlay open flag
    shortcutsOpen: false,
    // F-19 TASK 3: context menu state { x, y, path } or null
    folderCtx: null,
  };

  // DR-56: external file-open queue (Finder "Open With" / double-click during restore)
  var _externalOpenQueue = [];

  // DR-56: Native's open-files handler calls this instead of opening directly.
  // If sessionRestoring is true, buffer the paths; else open immediately.
  function enqueueExternalOpen(paths) {
    if (!paths || !paths.length) return;
    if (state.sessionRestoring) {
      for (var qi = 0; qi < paths.length; qi++) {
        _externalOpenQueue.push(paths[qi]);
      }
    } else {
      // Open immediately through the normal native path
      for (var oi = 0; oi < paths.length; oi++) {
        var p = paths[oi];
        if (window.__TAURI__) {
          window.__TAURI__.core.invoke('read_md_file', { path: p })
            .then(function (doc) {
              if (!doc || !doc.name) return;
              if (window.TVNative && typeof TVNative.openInto === 'function') {
                TVNative.openInto(doc);
              } else {
                openDoc({ name: doc.name, source: doc.content, path: p.replace(/\/[^/]+$/, '') || '/' });
              }
            })
            .catch(function () {});
        }
      }
    }
  }

  // Drain the external open queue after session restore completes (DR-56)
  function _drainExternalOpenQueue() {
    if (!_externalOpenQueue.length) return;
    var queued = _externalOpenQueue.slice();
    _externalOpenQueue.length = 0;
    enqueueExternalOpen(queued);
  }

  // F-05 / DR-24–DR-26: Mermaid on/off toggle.
  // Persisted via localStorage key 'tv-mermaid'; value '0' = disabled.
  // isMermaidEnabled() is called by the Renderer engineer's diagram pass.
  // toggleMermaid() flips, persists, re-renders all open tabs.
  function isMermaidEnabled() {
    return localStorage.getItem('tv-mermaid') !== '0';
  }
  function toggleMermaid() {
    var next = !isMermaidEnabled();
    if (next) {
      localStorage.removeItem('tv-mermaid');
    } else {
      localStorage.setItem('tv-mermaid', '0');
    }
    // Re-render all open tabs by doing a full render (rebuilds .md and
    // re-invokes tvResolveDiagrams which will respect isMermaidEnabled())
    render();
  }

  // UX-10: JS keyboard cursor for sidebar navigation.
  // Tracks which sidebar option is highlighted via keyboard.
  // Uses ID (data-sidebar-tab value), NOT index, so it survives re-renders.
  // active=false means arrow keys scroll content normally; they never hijack.
  var sbKbd = { active: false, id: null };

  /* ── Tab constructor ──────────────────────────────────────── */
  function makeTab(opts) {
    return {
      id: opts.id || uid(),
      name: opts.name || 'untitled.md',
      path: opts.path || null,
      source: opts.source || '',
      scrollTop: 0,
      dirty: false,
      live: !!opts.live,
      // Browser-style new-tab page (⌘T) — no document, renders the NTP.
      untitled: !!opts.untitled,
      // F-06/F-16: error tab state. null = normal; 'not-found' = file moved/
      // deleted (renders "Locate file…" recovery); 'binary' = non-UTF-8 file
      // (renders "cannot be rendered" + "Show in Finder"). buildViewer() routes
      // any truthy error to buildErrorViewer() before the normal render paths.
      error: opts.error || null,
      fileHandle: opts.fileHandle || null,
      // nativePath: set by tv-native.js after openDoc() returns the tab id.
      // E-13: native tabs opened via Tauri NEVER have tab.fileHandle set;
      // they use tab.nativePath exclusively. These two fields are mutually
      // exclusive by design — the open paths (native vs browser) are disjoint.
    };
  }

  /* ── deduplication key ────────────────────────────────────── */
  // E-12: include nativePath in the key so two files with the same name
  // in different directories don't collide. For browser tabs without a real
  // path, use just the name so they can still be deduplicated by name.
  function tabKey(opts) {
    // Untitled new-tab pages key on their own id so they can never collide
    // with name/path keys (e.g. a real file named "Untitled") in openDoc dedup.
    if (opts.untitled) return 'untitled:' + (opts.id || '');
    // If opts is a Tab object already in state, prefer nativePath
    if (opts.nativePath) return 'native:' + opts.nativePath;
    if (opts.path) return opts.path + '/' + opts.name;
    return opts.name;
  }

  /* ────────────────────────────────────────────────────────────
     RECENT FILES — localStorage persistence (E-02)
     Stores absolute native paths with open timestamps; capped at 10.
     Canonical on-disk shape: [{ path: <abs>, ts: <epoch-ms> }].
     Back-compat: legacy entries were bare path strings (string[]);
     loadRecentEntries() silently migrates them to {path, ts:0}
     (ts:0 → no/blank relative-time label in the launcher panel).
     loadRecentPaths() still returns a plain string[] so every
     existing consumer (sidebar Recent, empty-state, native bridge)
     keeps working unchanged.
   ──────────────────────────────────────────────────────────── */
  var RECENT_KEY = 'tv-recent-files';
  var RECENT_MAX = 20; // DR-52: MRU capped at 20

  // Returns [{ path, ts, scrollTop? }] with legacy string entries migrated in place.
  // F-17: entries now optionally carry scrollTop (number) for scroll persistence.
  function loadRecentEntries() {
    try {
      var raw = localStorage.getItem(RECENT_KEY);
      if (!raw) return [];
      var parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) return [];
      var out = [];
      for (var i = 0; i < parsed.length; i++) {
        var e = parsed[i];
        if (typeof e === 'string') {
          // legacy string[] format — no timestamp or scroll recorded
          if (e) out.push({ path: e, ts: 0, scrollTop: 0 });
        } else if (e && typeof e === 'object' && e.path) {
          out.push({
            path: e.path,
            ts: (typeof e.ts === 'number' ? e.ts : 0),
            // F-17: pass through scrollTop if present; default to 0
            scrollTop: (typeof e.scrollTop === 'number' ? e.scrollTop : 0),
          });
        }
      }
      return out;
    } catch (e) {
      return [];
    }
  }

  // Legacy/string accessor — derives plain paths from the entries so
  // older call sites (sidebar Recent rows, empty-state recents,
  // tv-native bridge) keep functioning without change.
  function loadRecentPaths() {
    return loadRecentEntries().map(function (e) { return e.path; });
  }

  function saveRecentPath(absolutePath) {
    if (!absolutePath) return;
    var list = loadRecentEntries();
    // F-17: capture the live scrollTop for the tab being saved (if open)
    var savedScrollTop = 0;
    for (var i = 0; i < state.tabs.length; i++) {
      if (state.tabs[i].nativePath === absolutePath) {
        savedScrollTop = state.tabs[i].scrollTop || 0;
        break;
      }
    }
    // Dedupe: drop any existing entry for this path (keeps move-to-front)
    list = list.filter(function (e) { return e.path !== absolutePath; });
    // Prepend with a fresh timestamp, scroll offset, and cap
    list.unshift({ path: absolutePath, ts: Date.now(), scrollTop: savedScrollTop });
    if (list.length > RECENT_MAX) list.length = RECENT_MAX;
    try {
      localStorage.setItem(RECENT_KEY, JSON.stringify(list));
    } catch (e) { /* storage full or private mode — ignore */ }
  }

  // Compact "time ago" label for the launcher Recent section.
  // ts === 0 (migrated legacy / unknown) → '' so the row shows no label.
  function relativeTime(ts) {
    if (!ts) return '';
    var diff = Date.now() - ts;
    if (diff < 0) diff = 0;
    var sec = Math.floor(diff / 1000);
    if (sec < 60) return 'just now';
    var min = Math.floor(sec / 60);
    if (min < 60) return min + 'm ago';
    var hr = Math.floor(min / 60);
    if (hr < 24) return hr + 'h ago';
    var day = Math.floor(hr / 24);
    if (day < 7) return day + 'd ago';
    var wk = Math.floor(day / 7);
    if (wk < 5) return wk + 'w ago';
    var mo = Math.floor(day / 30);
    if (mo < 12) return mo + 'mo ago';
    return Math.floor(day / 365) + 'y ago';
  }

  // Immediate parent folder name of a path, e.g. "/a/b/c.md" → "b".
  // Empty string when the path has no parent segment.
  function parentFolderName(p) {
    if (!p) return '';
    var parts = String(p).split('/').filter(function (s) { return s.length; });
    return parts.length >= 2 ? parts[parts.length - 2] : '';
  }

  /* ────────────────────────────────────────────────────────────
     BUILD HELPERS — produce HTML strings
   ──────────────────────────────────────────────────────────── */

  function buildTitlebar() {
    var tab = getActiveTab();
    var title = tab ? tab.name : 'tiny-viewer';
    if (state.mode === 'edit' && tab) title = tab.name + ' — editing';
    var icons = window.TV_ICONS || {};

    // U-02: quiet theme toggle button (sun/moon) in titlebar right
    var moonSvg = '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>';
    var sunSvg  = '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/><line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/></svg>';
    var themeSvg = state.theme === 'dark' ? sunSvg : moonSvg;
    var themeLabel = state.theme === 'dark' ? 'Switch to light' : 'Switch to dark';

    // Bug A: data-tauri-drag-region on both .tv-titlebar and .tv-wintitle so
    // dragging anywhere on the bar (except traffic lights + theme button) moves
    // the window. .tv-traffic and .tv-titlebtn intentionally OMIT the attribute
    // so their clicks remain interactive. .tv-doc-ic gets pointer-events:none
    // via CSS (it's a decorative icon inside .tv-wintitle which already drags).
    return (
      '<div class="tv-titlebar" data-tauri-drag-region>' +
        '<div class="tv-traffic">' +
          '<span class="tv-light c"></span>' +
          '<span class="tv-light m"></span>' +
          '<span class="tv-light x"></span>' +
        '</div>' +
        '<div class="tv-wintitle" data-tauri-drag-region>' +
          '<span class="tv-doc-ic">' + (icons.doc || '') + '</span>' +
          esc(title) +
        '</div>' +
        '<button class="tv-titlebtn tv-theme-toggle" data-theme-toggle title="' + themeLabel + '" aria-label="' + themeLabel + '">' +
          themeSvg +
        '</button>' +
      '</div>'
    );
  }

  // D-07: tabbar/tab ARIA roles
  function buildTabbar() {
    var icons = window.TV_ICONS || {};
    var tabs = state.tabs.map(function (t) {
      var lead = '';
      if (t.live && t.dirty) {
        // F-13: show both indicators when live+dirty
        lead = '<span class="tv-bolt">' + (icons.bolt || '') + '</span>' +
               '<span class="tv-dot"></span>';
      } else if (t.live) {
        lead = '<span class="tv-bolt">' + (icons.bolt || '') + '</span>';
      } else if (t.dirty) {
        lead = '<span class="tv-dot"></span>';
      }
      var isActive = t.id === state.activeId;
      var cls = 'tv-tab' + (isActive ? ' active' : '');
      return (
        '<div class="' + cls + '"' +
          ' role="tab"' +
          ' aria-selected="' + (isActive ? 'true' : 'false') + '"' +
          ' aria-controls="tv-viewer-panel"' +
          ' tabindex="' + (isActive ? '0' : '-1') + '"' +
          ' data-tab-id="' + esc(t.id) + '">' +
          lead +
          '<span class="name">' + esc(t.name) + '</span>' +
          '<span class="tv-close"' +
            ' role="button"' +
            ' aria-label="Close ' + esc(t.name) + '"' +
            ' data-close-tab="' + esc(t.id) + '"' +
            ' title="Close">' +
            (icons.close || '') +
          '</span>' +
        '</div>'
      );
    }).join('');

    // L-03: tabs live in a scrolling .tv-tab-strip; .tv-newtab is a SIBLING
    // (outside the strip) so the "+" stays opaque + clickable when tabs overflow.
    return (
      '<div class="tv-tabbar" role="tablist">' +
        '<div class="tv-tab-strip">' + tabs + '</div>' +
        '<button class="tv-newtab" data-newtab title="New tab (⌘T)" aria-label="New tab (⌘T)" type="button">' +
          (icons.plus || '') +
        '</button>' +
      '</div>'
    );
  }

  /* ── F-19 helpers ──────────────────────────────────────────── */
  // Basename of an absolute path: "/a/b/c" → "c"
  function pathBasename(p) {
    return String(p).replace(/\/+$/, '').split('/').pop() || p;
  }

  // Register (add or replace) a folder tree object in state.openFolders.
  // [YOU expose] as TV.registerFolder — called by Native's openFolder flow
  // after Native.readDirTree resolves.
  function registerFolder(tree) {
    if (!tree || !tree.path) return;
    // Remove any existing entry for this path (de-dup), then append (MRU last).
    state.openFolders = state.openFolders.filter(function (f) { return f.path !== tree.path; });
    state.openFolders.push(tree);
    render();
  }

  // Close a folder by path.
  function closeFolder(path) {
    state.openFolders = state.openFolders.filter(function (f) { return f.path !== path; });
    // Clean up collapse keys for this folder
    var newCollapsed = {};
    Object.keys(state.folderCollapsed).forEach(function (k) {
      if (k !== path && k.indexOf(path + '/') !== 0) {
        newCollapsed[k] = state.folderCollapsed[k];
      }
    });
    state.folderCollapsed = newCollapsed;
    state.folderCtx = null;
    render();
  }

  // Toggle the collapse state for a key (folder path, subfolder key, or deep-bucket key)
  function toggleFolderCollapse(key) {
    state.folderCollapsed[key] = !state.folderCollapsed[key];
    render();
  }

  /* ── F-19: build one folder's tree section ─────────────────── */
  function buildFolderSection(tree) {
    var icons = window.TV_ICONS || {};
    var path = tree.path;
    var folded = !!state.folderCollapsed[path];
    var news = []; // new files on disk (not yet implemented in this pass — placeholder)

    // DR-41: count rows to decide if capped
    var rowCount = (tree.files ? tree.files.length : 0)
      + (tree.subfolders ? tree.subfolders.reduce(function (a, s) { return a + 1 + (s.files ? s.files.length : 0); }, 0) : 0)
      + (tree.deep && tree.deep.length ? 1 + tree.deep.length : 0);
    var capped = rowCount > 50;

    var html = '';

    // Folder head
    html += (
      '<div class="tv-folder-head"' +
        ' data-folder-toggle="' + esc(path) + '"' +
        ' data-folder-ctx-target="' + esc(path) + '">' +
        '<span class="tv-chev' + (folded ? '' : ' open') + '">' + (icons.chevron || '') + '</span>' +
        '<span class="ic">' + (icons.folder || '') + '</span>' +
        '<span class="fname" title="' + esc(path) + '">' + esc(pathBasename(path)) + '</span>' +
        '<span class="fh-spacer"></span>' +
        (news.length > 0 ? '<span class="folder-badge" title="' + news.length + ' new files">' + news.length + '</span>' : '') +
        '<button class="folder-x" data-folder-close="' + esc(path) + '" title="Close folder" type="button">' +
          (icons.close || '') +
        '</button>' +
      '</div>'
    );

    if (!folded) {
      html += '<div class="tv-folder-body' + (capped ? ' capped' : '') + '">';

      // Top-level files
      if (tree.files) {
        tree.files.forEach(function (f) {
          html += buildTreeFileRow(f, { isNew: false });
        });
      }

      // Subfolders (one level)
      if (tree.subfolders) {
        tree.subfolders.forEach(function (s) {
          var skey = path + '/' + s.name;
          var sfolded = !!state.folderCollapsed[skey];
          html += (
            '<div class="tv-tree-row subfolder" data-folder-toggle="' + esc(skey) + '">' +
              '<span class="tv-chev' + (sfolded ? '' : ' open') + '">' + (icons.chevron || '') + '</span>' +
              '<span class="ic">' + (icons.folder || '') + '</span>' +
              '<span>' + esc(s.name) + '</span>' +
            '</div>'
          );
          if (!sfolded && s.files) {
            s.files.forEach(function (f) {
              html += buildTreeFileRow(f, { nested: true });
            });
          }
        });
      }

      // Deep-files bucket
      if (tree.deep && tree.deep.length > 0) {
        var dkey = path + '/__deep';
        var dfolded = !!state.folderCollapsed[dkey];
        html += (
          '<div class="tv-tree-row subfolder deep-bucket" data-folder-toggle="' + esc(dkey) + '"' +
            ' title="Files nested more than one level deep, grouped here">' +
            '<span class="tv-chev' + (dfolded ? '' : ' open') + '">' + (icons.chevron || '') + '</span>' +
            '<span class="ic ic-ell">' + (icons.ellipsis || '') + '</span>' +
            '<span class="db-label">More files</span>' +
            '<span class="db-count">' + tree.deep.length + '</span>' +
          '</div>'
        );
        if (!dfolded) {
          tree.deep.forEach(function (d) {
            html += buildTreeFileRow(d, { nested: true, trail: d.from });
          });
        }
      }

      html += '</div>';
    }

    return html;
  }

  // Build a single file row for the folder tree.
  // f = { name, path } (or just { name } for deep files)
  // opts = { isNew, nested, trail }
  function buildTreeFileRow(f, opts) {
    var icons = window.TV_ICONS || {};
    opts = opts || {};
    var filePath = f.path || '';
    var fileName = f.name || (filePath ? filePath.split('/').pop() : '');

    // DR-34: open-as-tab distinction
    var openTab = null;
    for (var i = 0; i < state.tabs.length; i++) {
      if (state.tabs[i].nativePath === filePath) { openTab = state.tabs[i]; break; }
    }
    var isActive = openTab && openTab.id === state.activeId;
    var isOpen = !!openTab && !isActive;
    var isLive = openTab && openTab.live;

    var cls = 'tv-tree-row file';
    if (opts.nested) cls += ' nested';
    if (opts.trail) cls += ' deep-file';
    if (isActive) cls += ' active';
    else if (isOpen) cls += ' is-open';

    var titleAttr = opts.trail
      ? ('title="' + esc('…/' + opts.trail + fileName) + '"')
      : (isOpen ? 'title="' + esc(fileName + ' · open') + '"' : '');

    return (
      '<div class="' + cls + '"' +
        (filePath ? ' data-tree-file-path="' + esc(filePath) + '"' : '') +
        (openTab ? ' data-tree-tab-id="' + esc(openTab.id) + '"' : '') +
        (titleAttr ? ' ' + titleAttr : '') + '>' +
        '<span class="ic">' + (icons.doc || '') + '</span>' +
        '<span class="tname">' + esc(fileName) + '</span>' +
        (isLive ? '<span class="mini-bolt">' + (icons.bolt || '') + '</span>' : '') +
        (opts.isNew ? '<span class="tree-new" title="New on disk"></span>' : '') +
      '</div>'
    );
  }

  /* ── F-22 / U-06: shortcut overlay ─────────────────────────── */
  // Canonical 17-entry list from the design's SHORTCUTS array (DR-23).
  var SHORTCUTS = [
    { keys: ['⌘K'], action: 'Command palette' },
    { keys: ['⌘O'], action: 'Open file' },
    { keys: ['⌘⇧O'], action: 'Open folder' },
    { keys: ['⌘T'], action: 'New tab' },
    { keys: ['⌘W'], action: 'Close tab' },
    { keys: ['⌘1–9'], action: 'Jump to tab' },
    { keys: ['⌘[', '⌘]'], action: 'Previous / next tab' },
    { keys: ['⌘⇧F'], action: 'Search all tabs' },
    { keys: ['⌘F'], action: 'Find in file' },
    { keys: ['⌘⌥O'], action: 'Outline' },
    { keys: ['⌘E'], action: 'Toggle edit' },
    { keys: ['⌘S'], action: 'Save' },
    { keys: ['⌘=', '⌘−'], action: 'Larger / smaller text' },
    { keys: ['⌘0'], action: 'Reset text size' },
    { keys: ['⌘B'], action: 'Toggle sidebar' },
    { keys: ['Esc'], action: 'Exit / close' },
    { keys: ['?'], action: 'This shortcuts overlay' },
  ];

  function buildShortcutOverlay() {
    var icons = window.TV_ICONS || {};
    var mid = Math.ceil(SHORTCUTS.length / 2);
    var cols = [SHORTCUTS.slice(0, mid), SHORTCUTS.slice(mid)];

    var colsHtml = cols.map(function (col) {
      var rows = col.map(function (s) {
        var keysHtml = s.keys.map(function (k, j) {
          return (j > 0 ? '<span class="tv-sc-or">/</span>' : '') +
            '<kbd class="tv-sc-key">' + esc(k) + '</kbd>';
        }).join('');
        return (
          '<div class="tv-sc-row">' +
            '<span class="tv-sc-keys">' + keysHtml + '</span>' +
            '<span class="tv-sc-action">' + esc(s.action) + '</span>' +
          '</div>'
        );
      }).join('');
      return '<div class="tv-sc-col">' + rows + '</div>';
    }).join('');

    return (
      '<div class="tv-sc-scrim" data-sc-scrim>' +
        '<div class="tv-sc" role="dialog" aria-label="Keyboard shortcuts" aria-modal="true">' +
          '<div class="tv-sc-head">' +
            '<span class="tv-sc-ic">' + (icons.kbd || '') + '</span>' +
            '<span class="tv-sc-title">Keyboard Shortcuts</span>' +
            '<span class="tv-sc-dismiss">press any key to close</span>' +
          '</div>' +
          '<div class="tv-sc-cols">' + colsHtml + '</div>' +
        '</div>' +
      '</div>'
    );
  }

  var _scEl = null; // the .tv-sc-scrim DOM element

  function openShortcuts() {
    if (state.shortcutsOpen) return;
    var tvEl = document.querySelector('.tv');
    if (!tvEl) return;
    state.shortcutsOpen = true;
    var wrapper = document.createElement('div');
    wrapper.innerHTML = buildShortcutOverlay();
    _scEl = wrapper.firstChild;
    tvEl.appendChild(_scEl);

    // Click on scrim (outside .tv-sc) closes it
    _scEl.addEventListener('mousedown', function (e) {
      if (!e.target.closest('.tv-sc')) {
        closeShortcuts();
      }
    });

    // Any keydown closes it (DR-18)
    document.addEventListener('keydown', _scKeyHandler, true);
  }

  function closeShortcuts() {
    if (!state.shortcutsOpen) return;
    state.shortcutsOpen = false;
    document.removeEventListener('keydown', _scKeyHandler, true);
    if (_scEl && _scEl.parentNode) {
      _scEl.parentNode.removeChild(_scEl);
    }
    _scEl = null;
  }

  function _scKeyHandler(e) {
    e.preventDefault();
    closeShortcuts();
  }

  /* ── F-19 TASK 3: folder context menu ──────────────────────── */
  var _ctxEl = null;
  // WKWebView reports clientX/clientY = 0 on `contextmenu`; track the live
  // pointer (with a timestamp) so menus can anchor to the real cursor — but
  // only when the tracked position is fresh enough to belong to this click.
  var _ctxPtr = { x: 0, y: 0, t: 0 };
  var _CTX_PTR_FRESH_MS = 1200;

  // Esc closes the context menus. The menu element isn't focused, so a keydown
  // listener on it never fires — listen on the document (capture) instead, and
  // detach on close. Mirrors the shortcut-overlay pattern.
  function _folderCtxEsc(e) {
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); closeFolderCtx(); }
  }
  function _tabCtxEsc(e) {
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); closeTabCtx(); }
  }

  function openFolderCtx(x, y, path) {
    closeFolderCtx();
    closeTabCtx();
    var icons = window.TV_ICONS || {};
    var tvRoot = document.querySelector('.tv');
    if (!tvRoot) return;
    state.folderCtx = { x: x, y: y, path: path };

    var html = (
      '<div class="tv-ctx-scrim" data-ctx-scrim>' +
        '<div class="tv-ctx" style="left:' + x + 'px;top:' + y + 'px" data-ctx-menu>' +
          '<div class="tv-ctx-item" data-ctx-action="reveal">' +
            '<span class="ic">' + (icons.reveal || '') + '</span> Reveal in Finder' +
          '</div>' +
          '<div class="tv-ctx-item" data-ctx-action="refresh">' +
            '<span class="ic">' + (icons.refresh || '') + '</span> Refresh' +
          '</div>' +
          '<div class="tv-ctx-sep"></div>' +
          '<div class="tv-ctx-item danger" data-ctx-action="close">' +
            '<span class="ic">' + (icons.close || '') + '</span> Close Folder' +
          '</div>' +
        '</div>' +
      '</div>'
    );

    var wrapper = document.createElement('div');
    wrapper.innerHTML = html;
    _ctxEl = wrapper.firstChild;
    tvRoot.appendChild(_ctxEl);

    // WKWebView ignores the style="" left/top (CSP); position via CSSOM + clamp.
    var fMenu = _ctxEl.querySelector('[data-ctx-menu]');
    if (fMenu) {
      var fmw = fMenu.offsetWidth || 200;
      var fmh = fMenu.offsetHeight || 200;
      var fcx = x, fcy = y;
      if (fcx + fmw > window.innerWidth)  { fcx = Math.max(0, window.innerWidth - fmw - 4); }
      if (fcy + fmh > window.innerHeight) { fcy = Math.max(0, window.innerHeight - fmh - 4); }
      fMenu.style.left = fcx + 'px';
      fMenu.style.top  = fcy + 'px';
    }

    // Scrim mousedown dismisses
    _ctxEl.addEventListener('mousedown', function (e) {
      if (!e.target.closest('[data-ctx-menu]')) {
        closeFolderCtx();
      }
    });

    // Context menu on scrim closes (prevent native context menu over our menu)
    _ctxEl.addEventListener('contextmenu', function (e) {
      e.preventDefault();
      closeFolderCtx();
    });

    // Escape closes (document-level — the menu div isn't focused)
    document.addEventListener('keydown', _folderCtxEsc, true);

    // Action clicks
    _ctxEl.addEventListener('click', function (e) {
      var item = e.target.closest('[data-ctx-action]');
      if (!item) return;
      var action = item.getAttribute('data-ctx-action');
      var ctxPath = state.folderCtx && state.folderCtx.path;
      closeFolderCtx();
      if (!ctxPath) return;
      if (action === 'reveal') {
        if (window.TVNative && typeof TVNative.revealInFinder === 'function') {
          TVNative.revealInFinder(ctxPath);
        }
      } else if (action === 'refresh') {
        if (window.TVNative && typeof TVNative.readDirTree === 'function') {
          TVNative.readDirTree(ctxPath).then(function (tree) {
            if (tree) registerFolder(tree);
          }).catch(function () {});
        }
      } else if (action === 'close') {
        closeFolder(ctxPath);
      }
    });
  }

  function closeFolderCtx() {
    document.removeEventListener('keydown', _folderCtxEsc, true);
    if (_ctxEl && _ctxEl.parentNode) {
      _ctxEl.parentNode.removeChild(_ctxEl);
    }
    _ctxEl = null;
    state.folderCtx = null;
  }

  /* ── U-10 / U-12: tab right-click context menu ─────────────── */
  var _tabCtxEl = null;

  function openTabCtx(x, y, tabId) {
    closeTabCtx();
    closeFolderCtx();
    var icons = window.TV_ICONS || {};
    var tvRoot = document.querySelector('.tv');
    if (!tvRoot) return;
    var tab = null;
    for (var i = 0; i < state.tabs.length; i++) {
      if (state.tabs[i].id === tabId) { tab = state.tabs[i]; break; }
    }
    if (!tab) return;
    state.tabCtx = { tabId: tabId };

    var hasPath = !!(tab.nativePath && !tab.untitled);
    var disAttr = hasPath ? '' : ' data-ctx-disabled="1"';
    var disCls  = hasPath ? '' : ' disabled';

    var html = (
      '<div class="tv-ctx-scrim" data-ctx-scrim>' +
        '<div class="tv-ctx" style="left:' + x + 'px;top:' + y + 'px" data-ctx-menu>' +
          '<div class="tv-ctx-item' + disCls + '"' + disAttr + ' data-ctx-action="reveal">' +
            '<span class="ic">' + (icons.reveal || '') + '</span> Reveal in Finder' +
          '</div>' +
          '<div class="tv-ctx-item' + disCls + '"' + disAttr + ' data-ctx-action="copy-path">' +
            '<span class="ic">' + (icons.copy || '') + '</span> Copy Path' +
          '</div>' +
          '<div class="tv-ctx-sep"></div>' +
          '<div class="tv-ctx-item' + disCls + '"' + disAttr + ' data-ctx-action="reload">' +
            '<span class="ic">' + (icons.refresh || '') + '</span> Reload from Disk' +
          '</div>' +
          '<div class="tv-ctx-sep"></div>' +
          '<div class="tv-ctx-item" data-ctx-action="close">' +
            '<span class="ic">' + (icons.close || '') + '</span> Close Tab' +
            '<span class="tv-ctx-hint">⌘W</span>' +
          '</div>' +
          '<div class="tv-ctx-item" data-ctx-action="close-others">' +
            '<span class="ic"></span> Close Others' +
          '</div>' +
          '<div class="tv-ctx-item danger" data-ctx-action="close-all">' +
            '<span class="ic"></span> Close All' +
          '</div>' +
        '</div>' +
      '</div>'
    );

    var wrapper = document.createElement('div');
    wrapper.innerHTML = html;
    _tabCtxEl = wrapper.firstChild;
    tvRoot.appendChild(_tabCtxEl);

    // Clamp position so the menu doesn't overflow viewport
    var menuEl = _tabCtxEl.querySelector('[data-ctx-menu]');
    if (menuEl) {
      var mw = menuEl.offsetWidth || 200;
      var mh = menuEl.offsetHeight || 220;
      var cx = x;
      var cy = y;
      if (cx + mw > window.innerWidth)  { cx = Math.max(0, window.innerWidth - mw - 4); }
      if (cy + mh > window.innerHeight) { cy = Math.max(0, window.innerHeight - mh - 4); }
      // WKWebView ignores the style="" attribute's left/top here (CSP honors
      // 'unsafe-inline' for <style> but not for the style attribute), so the
      // inline coords compute to 0,0. Set position via CSSOM, which is honored.
      menuEl.style.left = cx + 'px';
      menuEl.style.top  = cy + 'px';
    }

    // Scrim mousedown dismisses
    _tabCtxEl.addEventListener('mousedown', function (e) {
      if (!e.target.closest('[data-ctx-menu]')) {
        closeTabCtx();
      }
    });

    // Context menu on scrim closes (prevent native context menu over our menu)
    _tabCtxEl.addEventListener('contextmenu', function (e) {
      e.preventDefault();
      closeTabCtx();
    });

    // Escape closes
    document.addEventListener('keydown', _tabCtxEsc, true);

    // Action clicks
    _tabCtxEl.addEventListener('click', function (e) {
      var item = e.target.closest('[data-ctx-action]');
      if (!item) return;
      // Disabled items are non-actionable
      if (item.getAttribute('data-ctx-disabled')) return;
      var action = item.getAttribute('data-ctx-action');
      var ctx = state.tabCtx;
      closeTabCtx();
      if (!ctx) return;
      var ctxTab = null;
      for (var i = 0; i < state.tabs.length; i++) {
        if (state.tabs[i].id === ctx.tabId) { ctxTab = state.tabs[i]; break; }
      }
      if (action === 'reveal') {
        if (ctxTab && ctxTab.nativePath && window.TVNative && typeof TVNative.revealInFinder === 'function') {
          TVNative.revealInFinder(ctxTab.nativePath);
        }
      } else if (action === 'copy-path') {
        if (ctxTab && ctxTab.nativePath) {
          if (navigator.clipboard && navigator.clipboard.writeText) {
            navigator.clipboard.writeText(ctxTab.nativePath).catch(function (err) {
              console.warn('[TV] clipboard write failed', err);
            });
          }
        }
      } else if (action === 'reload') {
        if (ctxTab && ctxTab.nativePath && window.__TAURI__) {
          var reloadPath = ctxTab.nativePath;
          var reloadId   = ctxTab.id;
          window.__TAURI__.core.invoke('read_md_file', { path: reloadPath })
            .then(function (doc) {
              var t = null;
              for (var i = 0; i < state.tabs.length; i++) {
                if (state.tabs[i].id === reloadId) { t = state.tabs[i]; break; }
              }
              if (t && doc) {
                t.source = doc.content || doc.source || '';
                t.dirty  = false;
                if (t.id === state.activeId) { render(); }
              }
            })
            .catch(function (err) {
              console.warn('[TV] reload from disk failed', reloadPath, err);
            });
        }
      } else if (action === 'close') {
        closeTab(ctx.tabId);
      } else if (action === 'close-others') {
        // Snapshot ids before mutation
        var otherIds = state.tabs
          .filter(function (t) { return t.id !== ctx.tabId; })
          .map(function (t) { return t.id; });
        otherIds.forEach(function (id) { closeTab(id); });
      } else if (action === 'close-all') {
        var allIds = state.tabs.map(function (t) { return t.id; });
        allIds.forEach(function (id) { closeTab(id); });
      }
    });
  }

  function closeTabCtx() {
    document.removeEventListener('keydown', _tabCtxEsc, true);
    if (_tabCtxEl && _tabCtxEl.parentNode) {
      _tabCtxEl.parentNode.removeChild(_tabCtxEl);
    }
    _tabCtxEl = null;
    state.tabCtx = null;
  }

  // Open a file path from the sidebar tree / recents (read → openInto → tab).
  function _openTreeFilePath(tfPath) {
    if (!tfPath || !window.TVNative || !TVNative.available) return;
    window.__TAURI__.core.invoke('read_md_file', { path: tfPath })
      .then(function (doc) {
        if (window.TVNative && typeof TVNative.openInto === 'function') {
          TVNative.openInto(doc);
        } else if (doc && doc.name) {
          var pdir = tfPath.replace(/\/[^/]+$/, '') || '/';
          var tid = openDoc({ name: doc.name, source: doc.content, path: pdir });
          if (tid) {
            var t = state.tabs.find(function (x) { return x.id === tid; });
            if (t) t.nativePath = doc.path || tfPath;
          }
        }
      })
      .catch(function (err) {
        console.warn('[TV] tree file open failed', tfPath, err);
        var kind = (window.TVNative && typeof TVNative.classifyReadError === 'function')
          ? TVNative.classifyReadError(err) : 'not-found';
        openErrorTab(tfPath.split('/').pop() || tfPath, tfPath, kind);
      });
  }

  // Reload an open tab's content from disk by id (shared by tab + file menus).
  function _reloadTabFromDisk(tabId) {
    var t0 = null;
    for (var i = 0; i < state.tabs.length; i++) {
      if (state.tabs[i].id === tabId) { t0 = state.tabs[i]; break; }
    }
    if (!t0 || !t0.nativePath || !window.__TAURI__) return;
    var reloadPath = t0.nativePath;
    window.__TAURI__.core.invoke('read_md_file', { path: reloadPath })
      .then(function (doc) {
        var t = null;
        for (var j = 0; j < state.tabs.length; j++) {
          if (state.tabs[j].id === tabId) { t = state.tabs[j]; break; }
        }
        if (t && doc) {
          t.source = doc.content || doc.source || '';
          t.dirty  = false;
          if (t.id === state.activeId) { render(); }
        }
      })
      .catch(function (err) {
        console.warn('[TV] reload from disk failed', reloadPath, err);
      });
  }

  /* ── U-08/U-10: sidebar file-row context menu ──────────────── */
  function openFileCtx(x, y, filePath, tabId) {
    closeTabCtx();
    closeFolderCtx();
    if (!filePath) return;
    var icons = window.TV_ICONS || {};
    var tvRoot = document.querySelector('.tv');
    if (!tvRoot) return;
    var isOpen = !!tabId;
    state.tabCtx = { path: filePath, tabId: tabId || null, file: true };

    var items =
      '<div class="tv-ctx-item" data-ctx-action="reveal">' +
        '<span class="ic">' + (icons.reveal || '') + '</span> Reveal in Finder' +
      '</div>' +
      '<div class="tv-ctx-item" data-ctx-action="copy-path">' +
        '<span class="ic">' + (icons.copy || '') + '</span> Copy Path' +
      '</div>' +
      '<div class="tv-ctx-sep"></div>';
    if (isOpen) {
      items +=
        '<div class="tv-ctx-item" data-ctx-action="activate">' +
          '<span class="ic">' + (icons.doc || '') + '</span> Switch to Tab' +
        '</div>' +
        '<div class="tv-ctx-item" data-ctx-action="reload">' +
          '<span class="ic">' + (icons.refresh || '') + '</span> Reload from Disk' +
        '</div>' +
        '<div class="tv-ctx-sep"></div>' +
        '<div class="tv-ctx-item danger" data-ctx-action="close">' +
          '<span class="ic">' + (icons.close || '') + '</span> Close Tab' +
        '</div>';
    } else {
      items +=
        '<div class="tv-ctx-item" data-ctx-action="open">' +
          '<span class="ic">' + (icons.doc || '') + '</span> Open' +
        '</div>';
    }

    var html =
      '<div class="tv-ctx-scrim" data-ctx-scrim>' +
        '<div class="tv-ctx" style="left:' + x + 'px;top:' + y + 'px" data-ctx-menu>' +
          items +
        '</div>' +
      '</div>';

    var wrapper = document.createElement('div');
    wrapper.innerHTML = html;
    _tabCtxEl = wrapper.firstChild;
    tvRoot.appendChild(_tabCtxEl);

    // Clamp position so the menu doesn't overflow viewport
    var menuEl = _tabCtxEl.querySelector('[data-ctx-menu]');
    if (menuEl) {
      var mw = menuEl.offsetWidth || 200;
      var mh = menuEl.offsetHeight || 180;
      var cx = x, cy = y;
      if (cx + mw > window.innerWidth)  { cx = Math.max(0, window.innerWidth - mw - 4); }
      if (cy + mh > window.innerHeight) { cy = Math.max(0, window.innerHeight - mh - 4); }
      // WKWebView ignores the style="" attribute's left/top here (CSP honors
      // 'unsafe-inline' for <style> but not for the style attribute), so the
      // inline coords compute to 0,0. Set position via CSSOM, which is honored.
      menuEl.style.left = cx + 'px';
      menuEl.style.top  = cy + 'px';
    }

    _tabCtxEl.addEventListener('mousedown', function (e) {
      if (!e.target.closest('[data-ctx-menu]')) { closeTabCtx(); }
    });
    _tabCtxEl.addEventListener('contextmenu', function (e) {
      e.preventDefault(); closeTabCtx();
    });
    document.addEventListener('keydown', _tabCtxEsc, true);
    _tabCtxEl.addEventListener('click', function (e) {
      var item = e.target.closest('[data-ctx-action]');
      if (!item) return;
      var action = item.getAttribute('data-ctx-action');
      var ctx = state.tabCtx;
      closeTabCtx();
      if (!ctx) return;
      if (action === 'reveal') {
        if (ctx.path && window.TVNative && typeof TVNative.revealInFinder === 'function') {
          TVNative.revealInFinder(ctx.path);
        }
      } else if (action === 'copy-path') {
        if (ctx.path && navigator.clipboard && navigator.clipboard.writeText) {
          navigator.clipboard.writeText(ctx.path).catch(function (err) {
            console.warn('[TV] clipboard write failed', err);
          });
        }
      } else if (action === 'activate') {
        if (ctx.tabId) activateTab(ctx.tabId);
      } else if (action === 'reload') {
        if (ctx.tabId) _reloadTabFromDisk(ctx.tabId);
      } else if (action === 'close') {
        if (ctx.tabId) closeTab(ctx.tabId);
      } else if (action === 'open') {
        _openTreeFilePath(ctx.path);
      }
    });
  }

  // D-05 + E-12: Group sidebar by real path; null-path files under "Open"
  // F-02: Also show a "Recent" section with closed files from localStorage
  function buildSidebar() {
    var icons = window.TV_ICONS || {};
    var collapsed = !state.sidebarOpen;

    // ── F-19: Folder tree sections (most-recently-opened first = reversed) ──
    var folderSections = '';
    var reversedFolders = state.openFolders.slice().reverse();
    reversedFolders.forEach(function (tree) {
      folderSections += buildFolderSection(tree);
    });

    // ── Legacy open-tab list (tabs NOT associated with any open folder) ──
    // These are tabs opened via ⌘O without a folder context.
    var folderPaths = {};
    state.openFolders.forEach(function (f) { folderPaths[f.path] = true; });

    // Group tabs that have a .path (folder association) vs ungrouped
    var groups = {};
    var ungrouped = [];
    state.tabs.forEach(function (t) {
      // Skip tabs whose nativePath is covered by an open folder tree — they
      // show up inside the folder section already (DR-34 is-open highlight).
      if (t.path && !folderPaths[t.path]) {
        (groups[t.path] = groups[t.path] || []).push(t);
      } else if (!t.path) {
        ungrouped.push(t);
      }
    });

    // F-02: Recent section — closed files from localStorage not currently open
    var recentPaths = loadRecentPaths();
    var openNativePaths = {};
    state.tabs.forEach(function (t) {
      if (t.nativePath) openNativePaths[t.nativePath] = true;
    });
    var closedRecent = recentPaths.filter(function (p) {
      return !openNativePaths[p];
    }).slice(0, 10);

    // UX-10: Build rows with ARIA listbox/option roles.
    var rows = '';

    function sbOptId(tabId) {
      return 'sbopt-' + String(tabId).replace(/[^\w-]/g, '_');
    }

    function sbCloseBtn(tabId, tabName) {
      return (
        '<button class="tv-sb-close"' +
          ' data-sb-close-tab="' + esc(tabId) + '"' +
          ' title="Close file"' +
          ' aria-label="Close ' + esc(tabName) + '"' +
          ' type="button"' +
          ' tabindex="-1">' +
          '&#x2715;' +
        '</button>'
      );
    }

    Object.keys(groups).forEach(function (path) {
      var folderBasename = path.split('/').filter(Boolean).pop() || path;
      var folderParent = (function () {
        var segs = path.split('/').filter(Boolean);
        if (segs.length <= 1) return '';
        segs.pop();
        var parent = '/' + segs.join('/');
        parent = parent.replace(/^\/(Users|home)\/[^/]+/, '~');
        var MAX = 30;
        if (parent.length > MAX) parent = '…' + parent.slice(parent.length - (MAX - 1));
        return parent;
      }());
      rows += (
        '<div class="tv-tree-row folder" role="group" aria-label="' + esc(path) + '" title="' + esc(path) + '">' +
          ic('folder') +
          '<span class="folder-name">' + esc(folderBasename) + '</span>' +
          (folderParent ? '<span class="folder-path">' + esc(folderParent) + '</span>' : '') +
        '</div>'
      );
      groups[path].forEach(function (t) {
        var isActive = t.id === state.activeId;
        var cls = 'tv-tree-row file' + (isActive ? ' active' : '');
        rows += (
          '<div class="' + cls + '"' +
            ' id="' + sbOptId(t.id) + '"' +
            ' role="option"' +
            ' aria-selected="' + (isActive ? 'true' : 'false') + '"' +
            ' tabindex="-1"' +
            ' data-sidebar-tab="' + esc(t.id) + '">' +
            ic('doc') +
            '<span>' + esc(t.name) + '</span>' +
            (t.live ? '<span class="mini-bolt">' + (icons.bolt || '') + '</span>' : '') +
            sbCloseBtn(t.id, t.name) +
          '</div>'
        );
      });
    });

    if (ungrouped.length) {
      if (Object.keys(groups).length || folderSections) {
        rows += '<div class="tv-side-divider"></div>';
      }
      rows += '<div class="tv-side-label">Open</div>';
      ungrouped.forEach(function (t) {
        var isActive = t.id === state.activeId;
        var cls = 'tv-tree-row file' + (isActive ? ' active' : '');
        rows += (
          '<div class="' + cls + '"' +
            ' id="' + sbOptId(t.id) + '"' +
            ' role="option"' +
            ' aria-selected="' + (isActive ? 'true' : 'false') + '"' +
            ' tabindex="-1"' +
            ' data-sidebar-tab="' + esc(t.id) + '">' +
            ic('doc') +
            '<span>' + esc(t.name) + '</span>' +
            (t.live ? '<span class="mini-bolt">' + (icons.bolt || '') + '</span>' : '') +
            sbCloseBtn(t.id, t.name) +
          '</div>'
        );
      });
    }

    if (closedRecent.length) {
      rows += '<div class="tv-side-divider"></div>';
      rows += '<div class="tv-side-label tv-side-recent-label">Recent</div>';
      closedRecent.forEach(function (p) {
        var name = p.split('/').pop() || p;
        rows += (
          '<div class="tv-tree-row file recent" data-recent-path="' + esc(p) + '">' +
            ic('clock') +
            '<span>' + esc(name) + '</span>' +
          '</div>'
        );
      });
    }

    var sidebarCls = 'tv-sidebar' + (collapsed ? ' collapsed' : '');
    return (
      '<aside class="' + sidebarCls + '">' +
        // UX-SB3: sidebar header
        '<div class="tv-side-header">' +
          '<span class="tv-side-header-label">Files</span>' +
          '<button class="tv-side-collapse" data-sidebar-toggle' +
            ' title="Hide sidebar (⌘B)" aria-label="Hide sidebar (⌘B)" type="button">' +
            '<span class="kbd">⌘B</span>' +
          '</button>' +
        '</div>' +
        '<div class="tv-side-scroll"' +
          ' id="tv-sidebar-listbox"' +
          ' role="listbox"' +
          ' aria-label="Open files"' +
          ' aria-orientation="vertical"' +
          ' tabindex="-1">' +
          // F-19: folder trees at the top
          folderSections +
          // Legacy open-tabs / recent rows below
          rows +
        '</div>' +
        '<div class="tv-search">' +
          '<div class="tv-search-box" data-open-find' +
            ' title="Find in document (⌘F)" aria-label="Find in document (⌘F)" role="button" tabindex="0">' +
            ic('search') +
            '<span>Find in document</span>' +
            '<span class="kbd">⌘F</span>' +
          '</div>' +
        '</div>' +
        // BUG-4: drag handle on the sidebar's right edge.
      '</aside>'
    );
  }

  function buildViewer() {
    var tab = getActiveTab();
    if (!tab) {
      // Build recent list for empty state (U-09)
      var recentPaths = loadRecentPaths();
      var recentHtml = '';
      if (recentPaths.length) {
        recentHtml = '<div class="tv-empty-recent">';
        recentPaths.slice(0, 8).forEach(function (p) {
          var name = p.split('/').pop() || p;
          recentHtml += (
            '<div class="tv-recent-row" data-recent-path="' + esc(p) + '"' +
              ' role="button" tabindex="0">' +
              '<span class="tv-recent-name">' + esc(name) + '</span>' +
              '<span class="tv-recent-path">' + esc(p) + '</span>' +
            '</div>'
          );
        });
        recentHtml += '</div>';
      }
      return (
        '<div class="tv-viewer" id="tv-viewer-panel" role="tabpanel">' +
          '<div class="tv-empty">' +
            '<div class="tv-dropzone">' +
              '<span class="dz-ic">' + ((window.TV_ICONS || {}).tray || '') + '</span>' +
              '<span class="dz-title">Drop .md files here</span>' +
              '<span class="dz-or">— or —</span>' +
              '<span class="dz-cmd"><span class="kbd">⌘O</span> to open files</span>' +
            '</div>' +
            recentHtml +
          '</div>' +
          '<div class="tv-empty-hint">No file open · nothing is imported, nothing is synced</div>' +
        '</div>'
      );
    }

    // Untitled tab → new-tab page (regardless of mode; edit is blocked anyway)
    if (tab.untitled) {
      return buildNewTabPage();
    }

    // F-06/F-16: error tab states — render before any normal mode path.
    // A tab with .error has no usable source, so edit/reading are skipped.
    if (tab.error) {
      return buildErrorViewer(tab);
    }

    // Edit mode
    if (state.mode === 'edit') {
      var wordCount = 0;
      if (window.TVEdit && typeof TVEdit.wordCount === 'function') {
        wordCount = TVEdit.wordCount(tab.source);
      }
      var editContent = '';
      if (window.TVEdit && typeof TVEdit.renderSource === 'function') {
        editContent = TVEdit.renderSource(tab);
      } else {
        // Fallback: plain source view
        editContent = '<div class="tv-source">' +
          tab.source.split('\n').map(function (ln, k) {
            return (
              '<div class="tv-srcline">' +
                '<span class="tv-gutter">' + (k + 1) + '</span>' +
                '<span class="tv-srctext">' + esc(ln || ' ') + '</span>' +
              '</div>'
            );
          }).join('') +
        '</div>';
      }
      var toolbar = (
        '<div class="tv-edit-toolbar">' +
          '<button class="tv-edit-btn" type="button" data-edit-esc><span class="kbd">esc</span> Reading</button>' +
          '<button class="tv-edit-btn primary" type="button" data-edit-save><span class="kbd">⌘S</span> Save</button>' +
          '<span class="tv-edit-meta">' + wordCount + ' words</span>' +
        '</div>'
      );
      return (
        '<div class="tv-viewer" id="tv-viewer-panel" role="tabpanel">' +
          toolbar +
          '<div class="tv-scroll" data-scroll>' +
            '<div class="tv-content">' +
              editContent +
            '</div>' +
          '</div>' +
        '</div>'
      );
    }

    // Reading mode

    // F-21: empty .md file → explicit "This file is empty." message, no spinner.
    if (!tab.source || !tab.source.trim()) {
      return (
        '<div class="tv-viewer" id="tv-viewer-panel" role="tabpanel">' +
          '<div class="tv-scroll" data-scroll>' +
            '<div class="tv-content tv-content--readable">' +
              '<div class="tv-empty-doc">This file is empty.</div>' +
            '</div>' +
          '</div>' +
        '</div>'
      );
    }

    // F-15: large file (>5 MB) → non-blocking banner (renders anyway, auto-dismisses).
    // Dismissed-per-tab so it doesn't reappear on every theme/sidebar re-render.
    var largeBanner = '';
    if (tab.source.length > 5 * 1024 * 1024 && !tab._largeDismissed) {
      largeBanner = (
        '<div class="tv-large-banner" data-large-banner role="status">' +
          '<span class="tv-large-banner-text">Large file — rendering may be slower</span>' +
          '<button class="tv-large-banner-x" data-large-dismiss type="button"' +
            ' aria-label="Dismiss">&#10005;</button>' +
        '</div>'
      );
    }

    var mdHtml = '';
    if (window.tvRenderMarkdown) {
      mdHtml = window.tvRenderMarkdown(tab.source);
    }
    // UX-21: pencil hover button (top-right of .tv-content on hover)
    var pencilIc = (window.TV_ICONS && window.TV_ICONS.pencil) ? window.TV_ICONS.pencil : '';
    var pencilBtn = (
      '<button class="tv-edit-pencil" data-edit-pencil' +
        ' title="Edit (⌘E)" aria-label="Edit document (⌘E)" type="button">' +
        pencilIc +
      '</button>'
    );
    // UX-21: status bar hint — "⌘E to edit" shown in reading mode
    var editHint = '<div class="tv-edit-hint">⌘E to edit</div>';
    return (
      '<div class="tv-viewer" id="tv-viewer-panel" role="tabpanel">' +
        '<div class="tv-scroll" data-scroll>' +
          largeBanner +
          '<div class="tv-content tv-content--readable">' +
            pencilBtn +
            '<div class="md" data-md>' + mdHtml + '</div>' +
          '</div>' +
          '<div class="tv-overlay-fade"></div>' +
        '</div>' +
        editHint +
      '</div>'
    );
  }

  // F-06/F-16: error tab body. Renders a centered recovery card instead of
  // document content. 'not-found' → ⚠ moved/deleted + "Locate file…" (re-opens
  // the picker). 'binary' → cannot-render + "Show in Finder" (reveals the path).
  // The filename and path are always run through esc() because they are
  // untrusted disk strings.
  function buildErrorViewer(tab) {
    var icons = window.TV_ICONS || {};
    var name = esc(tab.name || 'File');
    var path = tab.nativePath || tab.path || '';
    var title, detail, actionBtn;

    if (tab.error === 'binary') {
      title = 'This file cannot be rendered as markdown';
      detail = 'It appears to be a binary or non-text file.';
      actionBtn = path
        ? '<button class="tv-error-btn" data-reveal-finder="' + esc(path) + '"' +
            ' type="button">Show in Finder</button>'
        : '';
    } else {
      // 'not-found' (default for any unknown error kind)
      title = 'File moved or deleted';
      detail = 'The file is no longer at its original location on disk.';
      actionBtn = '<button class="tv-error-btn" data-find-locate' +
        ' type="button">Locate file…</button>';
    }

    return (
      '<div class="tv-viewer" id="tv-viewer-panel" role="tabpanel">' +
        '<div class="tv-scroll" data-scroll>' +
          '<div class="tv-content tv-content--readable">' +
            '<div class="tv-error-state">' +
              '<span class="tv-error-badge" aria-hidden="true">&#9888;</span>' +
              '<div class="tv-error-title">' + title + '</div>' +
              '<div class="tv-error-name">' + name + '</div>' +
              '<div class="tv-error-detail">' + detail + '</div>' +
              actionBtn +
            '</div>' +
          '</div>' +
        '</div>' +
      '</div>'
    );
  }

  // Untitled new-tab viewer body. The launcher PANEL itself is rendered
  // separately as an app-level overlay (buildNewTabOverlay) so it centers on
  // the full window. This viewer keeps an (empty) .tv-scroll[data-scroll]
  // element so the load-bearing contracts still hold: TVSearch.open()
  // hides/restores .tv-scroll to overlay ⌘⇧F results, and activateTab's
  // E-04 scroll save queries [data-scroll].
  function buildNewTabPage() {
    return (
      '<div class="tv-viewer" id="tv-viewer-panel" role="tabpanel">' +
        '<div class="tv-scroll" data-scroll>' +
          '<div class="tv-ntp-canvas" aria-hidden="true"></div>' +
        '</div>' +
      '</div>'
    );
  }

  // Launcher PANEL + theme pill, rendered as an app-level overlay centered on
  // the full window (mock: .scratch/ntp-design-target.png). Returns markup for
  // a .tv-ntp container holding the elevated .tv-ntp-box panel and the floating
  // .tv-theme-pill. Inserted as a sibling of .tv-body under .tv so window
  // centering is exact. All actionable items are .tv-ntp-row carrying data
  // attrs describing their action (QA hooks). Palette/search overlays sit
  // ABOVE this via their own higher z-index.
  function buildNewTabOverlay() {
    var icons = window.TV_ICONS || {};
    var clockIc = icons.clock || '';
    var docIc = icons.doc || '';
    var folderIc = icons.folder || '';

    // ── OPEN section: fixed actions (always visible, never filtered) ──
    var openRows = (
      '<div class="tv-ntp-row tv-ntp-open" role="option" aria-selected="false"' +
        ' data-ntp-act="open-file" title="Open a file (⌘O)">' +
        '<span class="ic tv-ntp-ic">' + docIc + '</span>' +
        '<span class="tv-ntp-name">Open File…</span>' +
        '<span class="tv-ntp-meta"><span class="kbd">⌘O</span></span>' +
      '</div>' +
      '<div class="tv-ntp-row" role="option" aria-selected="false"' +
        ' data-ntp-act="open-folder" title="Open a folder (⌘⇧O)">' +
        '<span class="ic tv-ntp-ic">' + folderIc + '</span>' +
        '<span class="tv-ntp-name">Open Folder…</span>' +
        '<span class="tv-ntp-meta"><span class="kbd">⌘⇧O</span></span>' +
      '</div>'
    );

    // ── RECENT section: timestamped recents not currently open as a tab ──
    var openNativePaths = {};
    state.tabs.forEach(function (t) {
      if (t.nativePath) openNativePaths[t.nativePath] = true;
    });
    var recentEntries = loadRecentEntries().filter(function (e) {
      return !openNativePaths[e.path];
    }).slice(0, 8);
    var recentRows = recentEntries.map(function (e) {
      var p = e.path;
      var name = p.split('/').pop() || p;
      var folder = parentFolderName(p);
      var when = relativeTime(e.ts);
      // data-ntp-name / data-ntp-folder carry the raw scoring sources so the
      // launcher's fuzzy matcher and highlighter work off original strings,
      // independent of how the row is rendered.
      return (
        '<div class="tv-ntp-row" role="option" aria-selected="false"' +
          ' data-ntp-path="' + esc(p) + '"' +
          ' data-ntp-name="' + esc(name) + '"' +
          ' data-ntp-folder="' + esc(folder) + '"' +
          ' title="' + esc(p) + '">' +
          '<span class="ic tv-ntp-ic">' + clockIc + '</span>' +
          '<span class="tv-ntp-name">' + esc(name) + '</span>' +
          (when ? '<span class="tv-ntp-meta">' + esc(when) + '</span>' : '') +
        '</div>'
      );
    }).join('');

    // ── FILES section: union of sidebar folder-tree files + open tabs ──
    // Each known file shows "already open" when it is open as a tab; clicking
    // an open file activates that tab (and closes the untitled one), an
    // unopened known file fills the untitled tab in place.
    // Map of nativePath → open tab id (real docs only; skip untitled).
    var openByPath = {};
    state.tabs.forEach(function (t) {
      if (!t.untitled && t.nativePath) openByPath[t.nativePath] = t.id;
    });
    // Build the known-file union, de-duped by path. Currently the app only
    // tracks files via open tabs (no persisted folder tree separate from
    // tabs), so the union is the set of open real-document tabs; recents
    // already have their own section. Keep dedupe so future folder-tree
    // sources can be merged here without double rows.
    var filesSeen = {};
    var fileItems = [];
    state.tabs.forEach(function (t) {
      if (t.untitled) return;
      var key = t.nativePath || t.path ? (t.nativePath || (t.path + '/' + t.name)) : t.name;
      if (filesSeen[key]) return;
      filesSeen[key] = true;
      fileItems.push({
        name: t.name,
        path: t.nativePath || null,
        openId: t.id, // these are all open tabs
      });
    });
    var fileRows = fileItems.map(function (f) {
      var openId = f.path ? openByPath[f.path] : f.openId;
      var dataAttr = openId
        ? ' data-ntp-open-id="' + esc(openId) + '"'
        : (f.path ? ' data-ntp-path="' + esc(f.path) + '"' : '');
      var folder = f.path ? parentFolderName(f.path) : '';
      // Raw scoring sources for the fuzzy matcher (see recentRows note).
      var scoreAttrs =
        ' data-ntp-name="' + esc(f.name) + '"' +
        (folder ? ' data-ntp-folder="' + esc(folder) + '"' : '') +
        (f.path ? ' data-ntp-fullpath="' + esc(f.path) + '"' : '');
      return (
        '<div class="tv-ntp-row" role="option" aria-selected="false"' +
          dataAttr + scoreAttrs + ' title="' + esc(f.path || f.name) + '">' +
          '<span class="ic tv-ntp-ic">' + docIc + '</span>' +
          '<span class="tv-ntp-name">' + esc(f.name) + '</span>' +
          (openId ? '<span class="tv-ntp-meta tv-ntp-status">already open</span>' : '') +
        '</div>'
      );
    }).join('');

    var sections = '';
    sections += (
      '<div class="tv-ntp-group" data-ntp-group="open">' +
        '<div class="tv-ntp-section">Open</div>' +
        openRows +
      '</div>'
    );
    if (recentRows) {
      sections += (
        '<div class="tv-ntp-group" data-ntp-group="recent">' +
          '<div class="tv-ntp-section">Recent</div>' +
          recentRows +
        '</div>'
      );
    }
    if (fileRows) {
      sections += (
        '<div class="tv-ntp-group" data-ntp-group="files">' +
          '<div class="tv-ntp-section">Files</div>' +
          fileRows +
        '</div>'
      );
    }

    // .tv-ntp is the full-window positioning layer (pointer-events:none so it
    // never blocks clicks on the tab bar / sidebar behind it); only the panel
    // inside it is interactive.
    return (
      '<div class="tv-ntp" data-ntp-overlay>' +
        '<div class="tv-ntp-box">' +
          '<div class="tv-ntp-inputrow">' +
            '<span class="ic tv-ntp-ic tv-ntp-input-ic">' + docIc + '</span>' +
            '<input class="tv-ntp-input" type="text"' +
              ' placeholder="Open a file…"' +
              ' autocomplete="off" spellcheck="false"' +
              ' aria-label="Open a file">' +
          '</div>' +
          '<div class="tv-ntp-sections">' +
            // Direct path-entry row, pinned at the top and hidden until the
            // typed query looks like a filesystem path. Its label + status are
            // filled by wireNewTabPage(); the label always goes through esc()
            // because paths are untrusted. data-ntp-pathrow is the JS hook.
            '<div class="tv-ntp-row tv-ntp-pathrow" role="option"' +
              ' aria-selected="false" data-ntp-pathrow style="display:none">' +
              '<span class="ic tv-ntp-ic">' + docIc + '</span>' +
              '<span class="tv-ntp-name tv-ntp-pathlabel"></span>' +
              '<span class="tv-ntp-meta tv-ntp-pathstatus"></span>' +
            '</div>' +
            sections +
          '</div>' +
          '<div class="tv-ntp-empty" style="display:none">No matching files</div>' +
          '<div class="tv-ntp-footer">' +
            '<span class="tv-ntp-hint"><span class="kbd">↕</span> navigate</span>' +
            '<span class="tv-ntp-hint"><span class="kbd">↵</span> open</span>' +
            '<span class="tv-ntp-hint"><span class="kbd">esc</span> close</span>' +
          '</div>' +
        '</div>' +
      '</div>'
    );
  }

  function buildEmpty() {
    var icons = window.TV_ICONS || {};
    // Bug A: same drag-region treatment as buildTitlebar()
    return (
      '<div class="tv-titlebar" data-tauri-drag-region>' +
        '<div class="tv-traffic">' +
          '<span class="tv-light c"></span>' +
          '<span class="tv-light m"></span>' +
          '<span class="tv-light x"></span>' +
        '</div>' +
        '<div class="tv-wintitle" data-tauri-drag-region>' +
          '<span class="tv-doc-ic">' + (icons.doc || '') + '</span>' +
          'tiny-viewer' +
        '</div>' +
      '</div>' +
      '<div class="tv-tabbar" role="tablist">' +
        '<button class="tv-newtab" data-newtab title="New tab (⌘T)" aria-label="New tab (⌘T)" type="button">' +
          (icons.plus || '') +
        '</button>' +
      '</div>' +
      '<div class="tv-body">' +
        buildViewer() +
      '</div>'
    );
  }

  /* ────────────────────────────────────────────────────────────
     RENDER — full repaint with scroll preservation (DR-03)
     E-04: scroll is saved in activateTab (before activeId changes)
     and via the live scroll listener. render() does NOT save scroll
     to avoid overwriting the incoming tab's saved scrollTop.
     S-02/S-08: close overlays before replacing DOM so they reset
     their _open flag and remain functional after render.
   ──────────────────────────────────────────────────────────── */
  function render() {
    var root = document.getElementById('tv-root');
    if (!root) return;

    // S-02/S-08: reset overlay state before replacing DOM
    // (overlay elements are about to be detached; reset their _open flags
    //  so subsequent ⌘K / ⌘⇧F still work correctly)
    if (window.TVPalette && typeof TVPalette.close === 'function') {
      TVPalette.close();
    }
    if (window.TVSearch && typeof TVSearch.close === 'function') {
      TVSearch.close();
    }
    // UF-06: Preserve find state across non-destructive renders (theme, sidebar, etc.).
    // Capture the query and index so we can re-run the find after DOM replacement.
    // Tab switches still close the bar (content changes), handled via activateTab.
    var _savedFindQuery = _findOpen ? _findQuery : null;
    var _savedFindIndex = _findOpen ? _findIndex : 0;
    // F-07: close find bar to detach from old DOM (will re-open below if it was active)
    if (_findOpen) {
      _closeFindBar();
    }

    // E-04: Do NOT save scrollTop here — activateTab() does it before
    // state.activeId changes, and the scroll listener keeps it live.

    var activeTab = getActiveTab();

    // Build root class
    var rootCls = 'tv tv--' + state.theme + ' tv--accent-' + state.accent;

    var html = '';
    if (!state.tabs.length) {
      html = buildEmpty();
    } else {
      // UX-20: resizer is a sibling of the sidebar in .tv-body (not a child of .tv-sidebar)
      // so .tv-sidebar overflow:hidden does not clip its grab zone.
      var resizerHtml = state.sidebarOpen
        ? '<div class="tv-sidebar-resizer" data-sidebar-resize></div>'
        : '';
      // The launcher panel + theme pill render as an APP-LEVEL overlay
      // (sibling of .tv-body, child of .tv) so they center on the FULL
      // window like Spotlight/⌘K — not on the content area. The overlay
      // exists only while the untitled new-tab page is the active view.
      var activeForOverlay = getActiveTab();
      var ntpOverlay = (activeForOverlay && activeForOverlay.untitled)
        ? buildNewTabOverlay()
        : '';
      html = buildTitlebar() + buildTabbar() +
        '<div class="tv-body">' + buildSidebar() + resizerHtml + buildViewer() + '</div>' +
        ntpOverlay;
    }

    root.innerHTML = '<div class="' + rootCls + '" style="--tv-md-font:' + state.fontSize + 'px">' + html + '</div>';

    // BUG-4: Apply sidebar width CSS var to the .tv root so the sidebar can read it.
    // dev2's CSS: .tv-sidebar { width: var(--tv-sidebar-w, 224px) }
    var tvRootEl = root.querySelector('.tv');
    if (tvRootEl) {
      tvRootEl.style.setProperty('--tv-sidebar-w', state.sidebarWidth + 'px');
    }

    // Restore scroll position (DR-03)
    var newScroll = root.querySelector('[data-scroll]');
    if (newScroll && activeTab) {
      newScroll.scrollTop = activeTab.scrollTop || 0;
    }

    // Wire live scroll listener for continuous preservation + debounced session save
    if (newScroll && activeTab) {
      (function (scrollEl, tab) {
        scrollEl.addEventListener('scroll', function () {
          tab.scrollTop = scrollEl.scrollTop;
          _saveSessionDebounced();
        }, { passive: true });
      })(newScroll, activeTab);
    }

    // UX-25: Set document language from YAML front-matter (lang:/language: key)
    // Minimal implementation: check front-matter at top of active doc source only.
    // Resets to "en" if no lang found or no active tab.
    (function () {
      var langTab = getActiveTab();
      var docLang = 'en';
      if (langTab && langTab.source) {
        var src = langTab.source;
        // Check for YAML front-matter block at start: ---\n...\n---
        var fmMatch = src.match(/^---\r?\n([\s\S]*?)\r?\n---/);
        if (fmMatch) {
          var fm = fmMatch[1];
          // Look for lang: or language: key (case-insensitive)
          var langMatch = fm.match(/^(?:lang|language)\s*:\s*["']?([a-zA-Z]{2,8}(?:-[a-zA-Z0-9]{1,8})*)["']?\s*$/im);
          if (langMatch && langMatch[1]) {
            docLang = langMatch[1].trim();
          }
        }
      }
      document.documentElement.lang = docLang;
    }());

    // Resolve diagrams after paint (DR-02)
    if (state.mode === 'reading' && window.tvResolveDiagrams) {
      var mdEl = root.querySelector('.md');
      if (mdEl) {
        window.tvResolveDiagrams(root.querySelector('.tv'), 600);
      }
    }

    // Resolve image paths so relative srcs load correctly (browser: base URL;
    // Tauri: convertFileSrc → asset:// URL). Pass the active tab's nativePath
    // (Tauri native mode) or openDoc path (browser mode) as the document base.
    if (state.mode === 'reading' && window.tvResolveImages && activeTab) {
      var imgRoot = root.querySelector('.tv-content');
      if (imgRoot) {
        // nativePath is the absolute fs path (Tauri); path is the sidebar group dir (browser).
        // For browser mode we need the doc's actual directory, not a parent group.
        // Use nativePath if available, else fall back to path (which is the parent dir
        // as set by openDoc callers — good enough for relative-to-docdir resolution).
        var docBase = activeTab.nativePath || activeTab.path || null;
        window.tvResolveImages(imgRoot, docBase);
      }
    }

    // Wire TVEdit if in edit mode
    if (state.mode === 'edit' && window.TVEdit && typeof TVEdit.wire === 'function' && activeTab) {
      var tvRoot = root.querySelector('.tv');
      if (tvRoot) {
        TVEdit.wire(tvRoot, activeTab);
      }
    }

    // Wire event delegation
    wireEvents(root.querySelector('.tv'));

    // UF-06: Re-inject find bar after render if it was active before.
    // Only restore in reading mode (find bar searches rendered markdown DOM).
    if (_savedFindQuery !== null && state.mode === 'reading') {
      _openFindBar();
      if (_savedFindQuery) {
        _runFind(_savedFindQuery);
        // Restore match index (clamp to new match count)
        if (_findMatches.length > 0) {
          _findIndex = Math.min(_savedFindIndex, _findMatches.length - 1);
          _highlightFindMatch();
          var countEl = _findBarEl && _findBarEl.querySelector('.tv-find-count');
          if (countEl) {
            countEl.textContent = (_findIndex + 1) + ' / ' + _findMatches.length;
          }
        }
      }
      // Restore query text in input
      if (_findBarEl) {
        var inp = _findBarEl.querySelector('.tv-find-input');
        if (inp) inp.value = _savedFindQuery;
      }
    }

    tvEmit('render', { state: state });

    // UX-10: Reapply keyboard cursor highlight after every render (innerHTML rebuild
    // wipes class state). Only runs when sbKbd.active is true.
    renderSidebarCursor();
  }

  // UX-10: Renders the sidebar keyboard cursor highlight using .kbd-cursor class
  // and aria-activedescendant on the listbox. Uses sbKbd.id (tab id) NOT index,
  // so it survives re-renders correctly. No DOM focus() call — WebKit-safe.
  function renderSidebarCursor() {
    var listbox = document.getElementById('tv-sidebar-listbox');
    if (!listbox) return;

    // Clear all cursor highlights and aria-activedescendant
    var opts = Array.prototype.slice.call(
      listbox.querySelectorAll('[role="option"][data-sidebar-tab]')
    );
    opts.forEach(function (el) { el.classList.remove('kbd-cursor'); });
    listbox.removeAttribute('aria-activedescendant');

    if (!sbKbd.active || !sbKbd.id) return;

    // Find the option matching sbKbd.id
    var target = null;
    for (var i = 0; i < opts.length; i++) {
      if (opts[i].getAttribute('data-sidebar-tab') === sbKbd.id) {
        target = opts[i]; break;
      }
    }

    // If the cursor id no longer exists (tab was closed), clamp to first option
    if (!target && opts.length) {
      target = opts[0];
      sbKbd.id = target.getAttribute('data-sidebar-tab');
    }

    if (target) {
      target.classList.add('kbd-cursor');
      listbox.setAttribute('aria-activedescendant', target.id);
      target.scrollIntoView({ block: 'nearest' });
    }
  }

  /* ────────────────────────────────────────────────────────────
     IN-DOCUMENT FIND BAR (F-07 / U-03)
     A lightweight find bar that highlights + navigates matches
     in the rendered .md element. Distinct from ⌘⇧F cross-tab search.
   ──────────────────────────────────────────────────────────── */
  var _findOpen = false;
  var _findMatches = [];
  var _findIndex = 0;
  var _findBarEl = null;
  var _findQuery = '';

  function _openFindBar() {
    if (_findOpen) {
      // Re-focus if already open
      if (_findBarEl) {
        var inp = _findBarEl.querySelector('.tv-find-input');
        if (inp) { inp.focus(); inp.select(); }
      }
      return;
    }

    var tvEl = document.querySelector('.tv');
    if (!tvEl) return;

    _findOpen = true;
    _findQuery = '';
    _findMatches = [];
    _findIndex = 0;

    // Build find bar
    _findBarEl = document.createElement('div');
    _findBarEl.className = 'tv-find';
    _findBarEl.setAttribute('role', 'search');
    _findBarEl.innerHTML =
      '<input class="tv-find-input" type="text" placeholder="Find in document…" autocomplete="off" spellcheck="false" aria-label="Find in document">' +
      '<span class="tv-find-count" aria-live="polite"></span>' +
      '<button class="tv-find-nav" data-find-prev aria-label="Previous match">&#8593;</button>' +
      '<button class="tv-find-nav" data-find-next aria-label="Next match">&#8595;</button>' +
      '<button class="tv-find-nav tv-find-close" data-find-close aria-label="Close find bar">&#10005;</button>';

    tvEl.appendChild(_findBarEl);

    var inputEl = _findBarEl.querySelector('.tv-find-input');
    if (inputEl) {
      inputEl.focus();
      inputEl.addEventListener('input', function () {
        _findQuery = inputEl.value;
        _runFind(_findQuery);
      });
      inputEl.addEventListener('keydown', function (e) {
        if (e.key === 'Enter') {
          e.preventDefault();
          if (e.shiftKey) {
            _findStep(-1);
          } else {
            _findStep(1);
          }
        } else if (e.key === 'Escape') {
          e.preventDefault();
          e.stopPropagation();
          _closeFindBar();
        }
      });
    }

    _findBarEl.addEventListener('click', function (e) {
      if (e.target.closest('[data-find-prev]')) { _findStep(-1); return; }
      if (e.target.closest('[data-find-next]')) { _findStep(1); return; }
      if (e.target.closest('[data-find-close]')) { _closeFindBar(); return; }
    });
  }

  function _closeFindBar() {
    if (!_findOpen) return;
    _findOpen = false;
    _findQuery = '';
    // Remove marks from DOM
    _clearFindMarks();
    if (_findBarEl && _findBarEl.parentNode) {
      _findBarEl.parentNode.removeChild(_findBarEl);
    }
    _findBarEl = null;
    _findMatches = [];
    _findIndex = 0;
  }

  function _clearFindMarks() {
    var mdEl = document.querySelector('.md');
    if (!mdEl) return;
    // Unwrap all <mark data-find> spans
    var marks = mdEl.querySelectorAll('mark[data-find]');
    for (var i = marks.length - 1; i >= 0; i--) {
      var mark = marks[i];
      var parent = mark.parentNode;
      if (parent) {
        var text = document.createTextNode(mark.textContent);
        parent.replaceChild(text, mark);
        parent.normalize();
      }
    }
  }

  function _runFind(query) {
    _clearFindMarks();
    _findMatches = [];
    _findIndex = 0;

    var countEl = _findBarEl && _findBarEl.querySelector('.tv-find-count');

    if (!query) {
      if (countEl) countEl.textContent = '';
      return;
    }

    var mdEl = document.querySelector('.md');
    if (!mdEl) return;

    // Walk text nodes and insert <mark> elements
    var lq = query.toLowerCase();
    var walker = document.createTreeWalker(mdEl, NodeFilter.SHOW_TEXT, {
      acceptNode: function (node) {
        // Skip script/style/mark nodes
        var pn = node.parentNode && node.parentNode.nodeName;
        if (pn === 'SCRIPT' || pn === 'STYLE' || pn === 'MARK') {
          return NodeFilter.FILTER_REJECT;
        }
        return NodeFilter.FILTER_ACCEPT;
      }
    }, false);

    var textNodes = [];
    var node;
    while ((node = walker.nextNode())) {
      textNodes.push(node);
    }

    // Process in reverse to avoid invalidating ranges
    for (var i = textNodes.length - 1; i >= 0; i--) {
      var tn = textNodes[i];
      var text = tn.textContent;
      var lText = text.toLowerCase();
      var lastIdx = 0;
      var positions = [];
      var pos;
      while ((pos = lText.indexOf(lq, lastIdx)) !== -1) {
        positions.push(pos);
        lastIdx = pos + lq.length;
      }
      if (!positions.length) continue;

      // Build a fragment replacing matches with <mark>
      var frag = document.createDocumentFragment();
      var cur = 0;
      for (var pi = 0; pi < positions.length; pi++) {
        var p = positions[pi];
        if (p > cur) {
          frag.appendChild(document.createTextNode(text.slice(cur, p)));
        }
        var mark = document.createElement('mark');
        mark.setAttribute('data-find', '');
        mark.textContent = text.slice(p, p + query.length);
        frag.appendChild(mark);
        cur = p + query.length;
      }
      if (cur < text.length) {
        frag.appendChild(document.createTextNode(text.slice(cur)));
      }
      tn.parentNode.replaceChild(frag, tn);
    }

    // Collect all marks in DOM order
    _findMatches = Array.prototype.slice.call(
      document.querySelectorAll('.md mark[data-find]')
    );

    if (_findMatches.length) {
      _findIndex = 0;
      _highlightFindMatch();
    }

    if (countEl) {
      if (_findMatches.length) {
        countEl.textContent = (_findIndex + 1) + ' / ' + _findMatches.length;
      } else {
        countEl.textContent = 'No results';
      }
    }
  }

  function _findStep(dir) {
    if (!_findMatches.length) return;
    _findIndex = (_findIndex + dir + _findMatches.length) % _findMatches.length;
    _highlightFindMatch();
    var countEl = _findBarEl && _findBarEl.querySelector('.tv-find-count');
    if (countEl) countEl.textContent = (_findIndex + 1) + ' / ' + _findMatches.length;
  }

  function _highlightFindMatch() {
    _findMatches.forEach(function (m, i) {
      m.classList.toggle('current', i === _findIndex);
    });
    var cur = _findMatches[_findIndex];
    if (cur) {
      cur.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  }

  /* ────────────────────────────────────────────────────────────
     EVENT DELEGATION
   ──────────────────────────────────────────────────────────── */
  /* ────────────────────────────────────────────────────────────
     BUG-4: SIDEBAR DRAG-RESIZE
     Pointer drag on .tv-sidebar-resizer adjusts --tv-sidebar-w on the .tv root.
     Clamped 160–480 px. Persisted to localStorage 'tv-sidebar-w'.
     Does NOT break ⌘B collapse (sidebarOpen is a separate boolean; the resizer
     only changes the width when the sidebar is open).
   ──────────────────────────────────────────────────────────── */
  function wireSidebarResize(tvEl) {
    if (!tvEl) return;
    var resizer = tvEl.querySelector('[data-sidebar-resize]');
    if (!resizer) return;

    var _dragging = false;
    var _startX = 0;
    var _startWidth = 0;

    resizer.addEventListener('pointerdown', function (e) {
      if (!state.sidebarOpen) return; // don't resize when sidebar is collapsed
      _dragging = true;
      _startX = e.clientX;
      _startWidth = state.sidebarWidth;
      resizer.setPointerCapture(e.pointerId);
      resizer.classList.add('dragging'); // UI-05: visual feedback during drag
      e.preventDefault();
    });

    resizer.addEventListener('pointermove', function (e) {
      if (!_dragging) return;
      var delta = e.clientX - _startX;
      var newWidth = Math.max(160, Math.min(480, _startWidth + delta));
      state.sidebarWidth = newWidth;
      // Apply directly to the .tv root without a full re-render
      tvEl.style.setProperty('--tv-sidebar-w', newWidth + 'px');
    });

    resizer.addEventListener('pointerup', function (e) {
      if (!_dragging) return;
      _dragging = false;
      resizer.classList.remove('dragging'); // UI-05: remove drag feedback
      resizer.releasePointerCapture(e.pointerId);
      // Persist to localStorage
      localStorage.setItem('tv-sidebar-w', String(state.sidebarWidth));
    });

    resizer.addEventListener('pointercancel', function (e) {
      if (!_dragging) return;
      _dragging = false;
      resizer.classList.remove('dragging'); // UI-05: remove drag feedback
      resizer.releasePointerCapture(e.pointerId);
    });
  }

  // New-tab page wiring: focus the launcher input and drive a JS keyboard
  // cursor over ALL actionable rows (OPEN + RECENT + FILES). The input is a
  // real <input>, so .focus() is reliable in WKWebView even when Full Keyboard
  // Access is off; rows carry NO tabindex and are never focused — the cursor
  // is a CSS class, same pattern as the sidebar sbKbd cursor (WebKit-safe).
  // Typing filters RECENT + FILES rows live; OPEN rows always stay visible.
  function wireNewTabPage(tvEl) {
    var input = tvEl.querySelector('.tv-ntp-input');
    if (!input) return;

    input.focus();

    // -1 means "no explicit cursor yet"; we seed it to the first row below so
    // the panel opens with "Open File…" highlighted (matches the mock) and
    // Enter has a sensible default target even before any arrow press.
    var cursor = -1;

    // All actionable rows in DOM order, regardless of section.
    function allRows() {
      return Array.prototype.slice.call(tvEl.querySelectorAll('.tv-ntp-row'));
    }

    function visibleRows() {
      return allRows().filter(function (r) { return r.style.display !== 'none'; });
    }

    function setCursor(idx) {
      var rows = visibleRows();
      // Default cursor lands on the first row (mock: "Open File…" selected).
      if (!rows.length) { cursor = -1; clearCursor(); return; }
      cursor = Math.max(0, Math.min(rows.length - 1, idx));
      clearCursor();
      var cur = rows[cursor];
      cur.classList.add('cursor');
      cur.setAttribute('aria-selected', 'true');
      if (cur.scrollIntoView) cur.scrollIntoView({ block: 'nearest' });
    }

    function clearCursor() {
      allRows().forEach(function (r) {
        r.classList.remove('cursor');
        r.setAttribute('aria-selected', 'false');
      });
    }

    // ── fuzzy-filter support ──────────────────────────────────────
    // Snapshot the original DOM order of each filterable group so an
    // empty query restores it exactly (RECENT by recency, FILES stable)
    // after fuzzy matching has reordered rows by score.
    var groupOrder = {}; // group name → [row, row, …] in original order
    Array.prototype.forEach.call(tvEl.querySelectorAll('.tv-ntp-group'), function (g) {
      var key = g.getAttribute('data-ntp-group');
      if (key === 'open') return; // OPEN never reorders
      groupOrder[key] = Array.prototype.slice.call(g.querySelectorAll('.tv-ntp-row'));
    });

    /* ── direct path entry ────────────────────────────────────────
       When the typed query looks like a filesystem path (/, ~/, ./, or
       a file:// URL), the launcher switches to PATH MODE: a dedicated
       .tv-ntp-pathrow appears pinned at the top, the path is validated
       once (debounced) via read_md_file through the Tauri bridge, and
       Enter / click opens it in place from the cached doc. The normal
       RECENT/FILES fuzzy filter still runs underneath against the raw
       query (it just won't usually match a path). */
    var pathRow = tvEl.querySelector('[data-ntp-pathrow]');
    var pathLabel = pathRow ? pathRow.querySelector('.tv-ntp-pathlabel') : null;
    var pathStatus = pathRow ? pathRow.querySelector('.tv-ntp-pathstatus') : null;

    // Session cache for the lifetime of THIS open launcher:
    //   expanded path → { ok:true, doc } | { ok:false, err }
    // Identical re-queries hit the cache instantly (no second disk read).
    var pathCache = {};
    // In-flight read_md_file promises keyed by expanded path. Lets a debounce
    // read and an Enter-during-checking open SHARE one read instead of each
    // issuing its own — exactly one disk read per path per launcher session.
    var pathPending = {};
    var pathDebounce = null;     // setTimeout handle for the validation delay
    var pathSeq = 0;             // monotonic token guarding against stale async
    var homeDirCache = null;     // resolved ~/ expansion target (string), once
    var homeDirPending = false;  // a homeDir() lookup is in flight

    // pathState mirrors what the path row currently shows so keydown/Enter and
    // the cursor logic can act without re-reading the DOM. status is one of:
    //   'hidden'      — not in path mode (row not shown)
    //   'checking'    — validation in flight (or queued)
    //   'found'       — validated OK; doc cached, openable
    //   'notfound'    — validated, read failed
    //   'unavailable' — plain-browser mode (no TVNative bridge)
    var pathState = { active: false, raw: '', expanded: '', status: 'hidden' };

    var nativeAvailable = !!(window.TVNative && TVNative.available);

    // PATH MODE detection: after trim, the query begins with / , ~/ , ./ ,
    // or a file:// URL. Paths may contain spaces, so we do NOT strip
    // whitespace here (the fuzzy path does, separately, for non-path queries).
    function isPathQuery(raw) {
      return /^(file:\/\/)?(\/|~\/|\.\/)/.test(raw);
    }

    // Turn a raw path query into the absolute path we'll hand to read_md_file.
    // Strips a leading file:// and expands a leading ~/ via the cached home
    // dir. './' is resolved against the active folder if one is tracked; the
    // app keeps no persistent folder root, so it stays literal and the read
    // fails gracefully (→ not found). Returns the best-effort expanded string.
    function expandPath(raw) {
      var p = raw.replace(/^file:\/\//, '');
      if (p.charAt(0) === '~' && p.charAt(1) === '/') {
        if (homeDirCache != null) {
          var home = homeDirCache.replace(/\/+$/, '');
          p = home + p.slice(1); // p.slice(1) keeps the leading '/'
        }
        // else leave the literal ~ — read_md_file will fail → not found.
      }
      return p;
    }

    // Kick off a one-time homeDir() lookup so ~/ expansion works. Async; on
    // resolution we re-run path mode for the current input so a query typed
    // before the lookup landed gets re-expanded. No-op without the bridge.
    function ensureHomeDir() {
      if (homeDirCache != null || homeDirPending) return;
      if (!(window.__TAURI__ && window.__TAURI__.path &&
            typeof window.__TAURI__.path.homeDir === 'function')) return;
      homeDirPending = true;
      window.__TAURI__.path.homeDir()
        .then(function (dir) {
          homeDirCache = dir || '';
          homeDirPending = false;
          // Re-run path mode ONLY for a ~/ query whose expansion actually
          // depends on the home dir. Re-running indiscriminately would bump
          // pathSeq and invalidate an in-flight Enter read for a non-~ path.
          if (pathState.active &&
              /^(file:\/\/)?~\//.test(pathState.raw) &&
              pathState.expanded !== expandPath(pathState.raw)) {
            updatePathMode(pathState.raw);
          }
        })
        .catch(function () {
          homeDirCache = ''; // give up; ~ stays literal → not found
          homeDirPending = false;
        });
    }

    // Paint the path row's label + status from pathState, then reflect the
    // openable state into the cursor (cursor auto-lands on a found row).
    function renderPathRow() {
      if (!pathRow) return;
      // Hide on empty raw too — an active-but-empty state must never paint a
      // blank row (seen in WKWebView; trigger unreproducible in Chrome).
      // Clearing the label empties .tv-ntp-pathlabel so the CSS :empty guard
      // (.tv-ntp-pathrow:has(.tv-ntp-pathlabel:empty){display:none!important})
      // also forces it hidden — belt and suspenders against repaint ghosts.
      if (!pathState.active || !pathState.raw) {
        pathRow.style.display = 'none';
        pathRow.classList.remove('cursor');
        pathRow.setAttribute('aria-selected', 'false');
        if (pathLabel) pathLabel.textContent = '';
        if (pathStatus) pathStatus.textContent = '';
        return;
      }
      pathRow.style.display = '';
      if (pathLabel) pathLabel.textContent = pathState.raw; // textContent = safe
      var msg = '';
      if (pathState.status === 'unavailable') msg = 'unavailable in browser';
      else if (pathState.status === 'checking') msg = 'checking…';
      else if (pathState.status === 'found') msg = '↵ open';
      else if (pathState.status === 'notfound') msg = 'not found';
      if (pathStatus) pathStatus.textContent = msg;
    }

    // True when the path row is currently a valid, openable target.
    function pathRowOpenable() {
      return pathState.active && pathState.status === 'found';
    }

    // Apply a validation result for `expanded` IF the input still holds the
    // same expanded path (token + value guard against out-of-order async).
    function applyValidation(token, expanded, result) {
      if (token !== pathSeq) return;            // a newer query superseded us
      if (!pathState.active) return;            // left path mode meanwhile
      if (pathState.expanded !== expanded) return; // input changed underneath
      pathState.status = result.ok ? 'found' : 'notfound';
      renderPathRow();
      // On a fresh found-valid result, land the cursor on the path row.
      if (result.ok) focusPathRow();
    }

    // Resolve the validation result for `expanded`, issuing AT MOST ONE
    // read_md_file per path per session. Returns a promise of the cached
    // { ok, doc|err } record:
    //   • cache hit            → resolved immediately from pathCache
    //   • read already in flight → the shared pending promise (no new read)
    //   • otherwise            → a fresh read, recorded in pathPending so any
    //                            concurrent caller (debounce + Enter) shares it
    // The promise NEVER rejects — failures resolve to { ok:false, err }.
    function getValidation(expanded) {
      if (Object.prototype.hasOwnProperty.call(pathCache, expanded)) {
        return Promise.resolve(pathCache[expanded]);
      }
      if (pathPending[expanded]) return pathPending[expanded];
      var p = window.__TAURI__.core.invoke('read_md_file', { path: expanded })
        .then(function (doc) { return { ok: true, doc: doc }; })
        .catch(function (err) { return { ok: false, err: err }; })
        .then(function (res) {
          pathCache[expanded] = res;   // record outcome for instant re-queries
          delete pathPending[expanded];
          return res;
        });
      pathPending[expanded] = p;
      return p;
    }

    // Validate `expanded` and reflect the outcome into the path row UI, guarded
    // by the token + current-value check so a stale read never repaints.
    function validatePath(expanded, token) {
      getValidation(expanded).then(function (res) {
        applyValidation(token, expanded, res);
      });
    }

    // Enter PATH MODE for `raw` (already known to be a path query) or refresh
    // it when the input changes. Updates pathState, paints the row, and (in
    // native mode) schedules a debounced validation. Every call bumps pathSeq
    // so any in-flight read for a previous value is ignored when it returns.
    function updatePathMode(raw) {
      if (!raw) { exitPathMode(); return; }
      pathState.active = true;
      pathState.raw = raw;
      pathSeq++;
      var token = pathSeq;

      if (!nativeAvailable) {
        pathState.expanded = '';
        pathState.status = 'unavailable';
        renderPathRow();
        return;
      }

      ensureHomeDir();
      var expanded = expandPath(raw);
      pathState.expanded = expanded;

      // Already validated this exact expanded path? Reflect it immediately.
      if (Object.prototype.hasOwnProperty.call(pathCache, expanded)) {
        var cached = pathCache[expanded];
        pathState.status = cached.ok ? 'found' : 'notfound';
        renderPathRow();
        if (cached.ok) focusPathRow();
        return;
      }

      pathState.status = 'checking';
      renderPathRow();

      if (pathDebounce) clearTimeout(pathDebounce);
      pathDebounce = setTimeout(function () {
        // Guard: only fire if this is still the current query.
        if (token !== pathSeq || !pathState.active ||
            pathState.expanded !== expanded) return;
        validatePath(expanded, token);
      }, 200);
    }

    // Leave PATH MODE entirely (input cleared or no longer path-like).
    function exitPathMode() {
      if (pathDebounce) { clearTimeout(pathDebounce); pathDebounce = null; }
      pathSeq++; // invalidate any in-flight validation
      pathState.active = false;
      pathState.raw = '';
      pathState.expanded = '';
      pathState.status = 'hidden';
      renderPathRow();
    }

    // Move the JS cursor onto the path row (kept in sync with visibleRows()).
    function focusPathRow() {
      if (!pathRow || pathRow.style.display === 'none') return;
      var rows = visibleRows();
      for (var i = 0; i < rows.length; i++) {
        if (rows[i] === pathRow) { setCursor(i); return; }
      }
    }

    // Open the validated path in place from the cached doc. When validation
    // hasn't landed yet, CHAIN onto the in-flight validation read (via
    // getValidation) rather than issuing a second read — so Enter-during-
    // checking shares the debounce's read; exactly one disk read per path.
    // No-op when the row isn't a valid target.
    function openPathRow() {
      if (!pathState.active || !nativeAvailable) return;
      var expanded = pathState.expanded;
      var cached = pathCache[expanded];
      if (cached) {
        // Already validated: open from cache (found) or no-op (not found).
        if (cached.ok) fillUntitledWithDoc(cached.doc, expanded);
        return;
      }
      // Not yet validated: await the shared validation (in-flight or fresh),
      // then open only if the input STILL points at this path (token + value
      // guard — same out-of-order semantics as applyValidation).
      var token = pathSeq;
      getValidation(expanded).then(function (res) {
        if (token !== pathSeq || pathState.expanded !== expanded) return;
        pathState.status = res.ok ? 'found' : 'notfound';
        renderPathRow();
        if (res.ok) fillUntitledWithDoc(res.doc, expanded);
      });
    }

    // The scoring sources + displayed strings for one filterable row.
    function rowFields(r) {
      var name = r.getAttribute('data-ntp-name') || '';
      var folder = r.getAttribute('data-ntp-folder') || '';
      // RECENT carries the path on data-ntp-path; FILES (already-open rows)
      // carry it on data-ntp-fullpath since data-ntp-path drives activation.
      var path = r.getAttribute('data-ntp-path') || r.getAttribute('data-ntp-fullpath') || '';
      return { name: name, folder: folder, path: path };
    }

    // Repaint a row's name/meta text, highlighting matched chars from a
    // fuzzyMatchFile() result (or plain when result is null/empty query).
    // All HTML is built from ESCAPED text via highlightIndices().
    function paintRow(r, match) {
      var f = rowFields(r);
      var nameEl = r.querySelector('.tv-ntp-name');
      if (nameEl) {
        nameEl.innerHTML = match
          ? highlightIndices(f.name, match.nameIndices)
          : esc(f.name);
      }
      // RECENT rows show a timestamp in .tv-ntp-meta (not the path), and
      // FILES rows show "already open" — neither is the path text, so we
      // only highlight the name. Path matches still rank the row; we leave
      // the meta untouched to avoid clobbering timestamps/status.
    }

    // Restore every filterable row to its original order, full visibility,
    // and un-highlighted text (empty-query / cleared state).
    function resetRows() {
      Array.prototype.forEach.call(tvEl.querySelectorAll('.tv-ntp-group'), function (g) {
        var key = g.getAttribute('data-ntp-group');
        g.style.display = '';
        if (key === 'open') return;
        var ordered = groupOrder[key] || [];
        ordered.forEach(function (r) {
          r.style.display = '';
          paintRow(r, null);
          g.appendChild(r); // re-append in original order
        });
      });
    }

    // Activate a row by its data attributes (shared by click + Enter).
    function activateRow(row) {
      if (!row) return;
      // Direct path-entry row: open the validated path (or read-then-open if
      // validation hasn't landed). A not-found path row is a harmless no-op.
      if (row.hasAttribute('data-ntp-pathrow')) {
        openPathRow();
        return;
      }
      var act = row.getAttribute('data-ntp-act');
      if (act === 'open-file') {
        if (window.TVFiles && typeof TVFiles.openPicker === 'function') {
          TVFiles.openPicker();
        }
        return;
      }
      if (act === 'open-folder') {
        openFolder();
        return;
      }
      var openId = row.getAttribute('data-ntp-open-id');
      if (openId) {
        // Already-open file → activate that tab, then close the untitled one.
        var untitled = findUntitledTab();
        activateTab(openId);
        if (untitled && untitled.id !== openId) closeTab(untitled.id);
        return;
      }
      var path = row.getAttribute('data-ntp-path');
      if (path) {
        openRecentIntoUntitled(path);
        return;
      }
    }

    // Live fuzzy filter: OPEN rows always visible and excluded from
    // scoring. RECENT + FILES rows are fuzzy-matched over basename, parent
    // folder, and full path; non-matches hide, matches reorder by
    // descending score WITHIN their section, matched chars highlight, and
    // the cursor jumps to the highest-scoring row overall. An empty query
    // restores the original order and parks the cursor on "Open File…".
    input.addEventListener('input', function () {
      var raw = input.value.trim();

      // ── PATH MODE gate ──────────────────────────────────────────
      // Path-like input drives the dedicated path row (no whitespace strip:
      // paths may contain spaces). Non-path input keeps the fuzzy behavior
      // below untouched. Detection is on the trimmed raw value.
      var inPathMode = !!raw && isPathQuery(raw);
      if (inPathMode) {
        updatePathMode(raw);
      } else if (pathState.active) {
        exitPathMode();
      }

      var q = inPathMode
        ? '' // path mode: don't fuzzy-filter on the raw path string
        : input.value.replace(/\s+/g, ''); // "ar md" behaves like "armd"

      if (!q) {
        resetRows();
        cursor = -1;
        var emptyEl = tvEl.querySelector('.tv-ntp-empty');
        if (emptyEl) emptyEl.style.display = 'none';
        if (inPathMode) {
          // The path row is the user's intent, so the cursor sits on it the
          // whole time it's shown — making Enter target the path: open when
          // found, validate-then-open while still 'checking…', no-op when
          // 'not found'. Arrows still let the user step down to OPEN rows.
          focusPathRow();
        } else {
          setCursor(0); // back on "Open File…"
        }
        return;
      }

      var filterableTotal = 0;
      var best = null;      // highest-scoring visible row (for cursor)
      var bestScore = -Infinity;

      Array.prototype.forEach.call(tvEl.querySelectorAll('.tv-ntp-group'), function (g) {
        var key = g.getAttribute('data-ntp-group');
        if (key === 'open') { g.style.display = ''; return; }
        var ordered = groupOrder[key] || [];
        var scored = [];
        ordered.forEach(function (r) {
          filterableTotal++;
          var match = fuzzyMatchFile(q, rowFields(r));
          if (!match) {
            r.style.display = 'none';
            paintRow(r, null);
            return;
          }
          r.style.display = '';
          paintRow(r, match);
          scored.push({ row: r, score: match.score });
          if (match.score > bestScore) { bestScore = match.score; best = r; }
        });
        // Stable sort by descending score: tag original index then compare.
        scored.forEach(function (s, i) { s._i = i; });
        scored.sort(function (a, b) {
          return b.score - a.score || a._i - b._i;
        });
        // Re-append matched rows in scored order; hidden rows can stay put.
        scored.forEach(function (s) { g.appendChild(s.row); });
        g.style.display = scored.length ? '' : 'none';
      });

      // Cursor jumps to the single highest-scoring row across all sections.
      clearCursor();
      if (best) {
        var vis = visibleRows();
        for (var i = 0; i < vis.length; i++) {
          if (vis[i] === best) { cursor = i; break; }
        }
        best.classList.add('cursor');
        best.setAttribute('aria-selected', 'true');
        if (best.scrollIntoView) best.scrollIntoView({ block: 'nearest' });
      } else {
        cursor = -1;
      }

      var empty = tvEl.querySelector('.tv-ntp-empty');
      if (empty) {
        // "No matching files" only when there ARE filterable rows but none matched.
        empty.style.display = (filterableTotal && !best) ? '' : 'none';
      }
    });

    input.addEventListener('keydown', function (e) {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setCursor(cursor + 1); // from -1 lands on the first visible row
        return;
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        setCursor(cursor - 1); // clamped at 0
        return;
      }
      if (e.key === 'Enter') {
        e.preventDefault();
        var rows = visibleRows();
        // Default: first row ("Open File…") when no explicit cursor.
        var row = (cursor >= 0 && rows[cursor]) ? rows[cursor] : rows[0];
        activateRow(row);
        return;
      }
      // Escape / ⌘-shortcuts fall through to the global keyboard router.
    });

    // Click on the path row opens it (the global delegated NTP click handler
    // skips it since it carries none of the data-ntp-* action attrs). Stop
    // propagation so only this local handler runs.
    if (pathRow) {
      pathRow.addEventListener('click', function (e) {
        e.stopPropagation();
        openPathRow();
      });
    }

    // Seed the cursor on the first row ("Open File…") so the panel opens
    // pre-selected like the mock. Typing resets it (cursor = -1) so the
    // highlight follows the filtered result set instead.
    setCursor(0);
  }

  function wireEvents(tvEl) {
    if (!tvEl) return;

    // BUG-4: wire the sidebar drag-resize handle
    wireSidebarResize(tvEl);

    // New-tab page: focus filter input + wire filter/cursor keyboard model
    wireNewTabPage(tvEl);

    // UX-11: keyboard activation for .tv-recent-row (role="button")
    tvEl.addEventListener('keydown', function (e) {
      if (e.key !== 'Enter' && e.key !== ' ') return;
      // UX-SB3/SB4: keyboard activation for sidebar collapse button + find box
      if (e.target.closest('[data-sidebar-toggle]') || e.target.closest('[data-open-find]')) {
        e.preventDefault();
        e.target.closest('[data-sidebar-toggle], [data-open-find]').click();
        return;
      }
      var recentRow = e.target.closest('[data-recent-path]');
      if (!recentRow) return;
      e.preventDefault();
      recentRow.click();
    });

    // UX-10: Deactivate sidebar keyboard cursor when user scrolls content.
    // Wheel on the content/viewer area means the user's attention is there.
    var scrollArea = tvEl.querySelector('.tv-scroll');
    if (scrollArea) {
      scrollArea.addEventListener('wheel', function () {
        if (sbKbd.active) {
          sbKbd.active = false;
          renderSidebarCursor();
        }
      }, { passive: true });
    }

    tvEl.addEventListener('click', function (e) {
      // Tab close button (tabbar)
      var closeBtn = e.target.closest('[data-close-tab]');
      if (closeBtn) {
        e.stopPropagation();
        closeTab(closeBtn.getAttribute('data-close-tab'));
        return;
      }

      // UX-SB5: Sidebar per-row close button — close WITHOUT activating.
      // Must be checked before the sidebar-row handler so stopPropagation
      // prevents the enclosing [data-sidebar-tab] row from activating the tab.
      var sbCloseBtn = e.target.closest('[data-sb-close-tab]');
      if (sbCloseBtn) {
        e.stopPropagation();
        closeTab(sbCloseBtn.getAttribute('data-sb-close-tab'));
        return;
      }

      // Tab activation
      var tabEl = e.target.closest('[data-tab-id]');
      if (tabEl && !e.target.closest('[data-close-tab]')) {
        activateTab(tabEl.getAttribute('data-tab-id'));
        return;
      }

      // Sidebar row click: activate tab and engage keyboard cursor mode.
      // Guard: ignore clicks that landed on the close button (already handled above).
      var sidebarRow = e.target.closest('[data-sidebar-tab]');
      if (sidebarRow && !e.target.closest('[data-sb-close-tab]')) {
        var sidebarTabId = sidebarRow.getAttribute('data-sidebar-tab');
        activateTab(sidebarTabId);
        // UX-10: engage keyboard cursor on the clicked row so ArrowDown/Up work
        // immediately without any dependence on DOM focus (WebKit-safe).
        sbKbd.active = true;
        sbKbd.id = sidebarTabId;
        // renderSidebarCursor is already called inside render() via activateTab,
        // but sbKbd may have been set after that render; apply it now via rAF
        // so the new DOM is available.
        requestAnimationFrame(function () { renderSidebarCursor(); });
        return;
      }

      // UX-10: Clicking the content/viewer area deactivates sidebar keyboard mode
      // so arrow keys revert to scrolling content (normal browser behaviour).
      if (e.target.closest('.tv-scroll') || e.target.closest('.tv-content') ||
          e.target.closest('#tv-viewer-panel')) {
        if (sbKbd.active) {
          sbKbd.active = false;
          renderSidebarCursor();
        }
      }

      // F-02: sidebar recent row click → reopen closed file
      var recentRow = e.target.closest('[data-recent-path]');
      if (recentRow) {
        var rpath = recentRow.getAttribute('data-recent-path');
        if (rpath && window.TVNative && TVNative.available) {
          window.__TAURI__.core.invoke('read_md_file', { path: rpath })
            .then(function (doc) {
              if (window.TVNative && typeof TVNative.openInto === 'function') {
                TVNative.openInto(doc);
              } else if (doc && doc.name) {
                var pdir = rpath.replace(/\/[^/]+$/, '') || '/';
                var id = openDoc({ name: doc.name, source: doc.content, path: pdir });
                if (id) {
                  var tab = state.tabs.find(function (t) { return t.id === id; });
                  if (tab) tab.nativePath = doc.path || rpath;
                }
              }
            })
            .catch(function (err) {
              console.warn('[TV] recent file open failed', rpath, err);
              // F-06/F-16: surface a recovery tab for the missing/binary file.
              var kind = (window.TVNative && typeof TVNative.classifyReadError === 'function')
                ? TVNative.classifyReadError(err) : 'not-found';
              openErrorTab(rpath.split('/').pop() || rpath, rpath, kind);
            });
        }
        return;
      }

      // Launcher-panel rows. A single delegated handler covers every
      // actionable row across OPEN / RECENT / FILES sections:
      //   data-ntp-act="open-file"   → system file picker (same as ⌘O)
      //   data-ntp-act="open-folder" → folder picker (same as ⌘⇧O)
      //   data-ntp-open-id           → already-open file: activate + close untitled
      //   data-ntp-path              → recent/known file: fill untitled in place
      // (NTP rows use data-ntp-path, distinct from the sidebar's
      // data-recent-path, so the two flows never cross.)
      var ntpRow = e.target.closest('.tv-ntp-row');
      if (ntpRow) {
        var ntpAct = ntpRow.getAttribute('data-ntp-act');
        if (ntpAct === 'open-file') {
          if (window.TVFiles && typeof TVFiles.openPicker === 'function') {
            TVFiles.openPicker();
          }
          return;
        }
        if (ntpAct === 'open-folder') {
          openFolder();
          return;
        }
        var ntpOpenId = ntpRow.getAttribute('data-ntp-open-id');
        if (ntpOpenId) {
          var ntpUntitled = findUntitledTab();
          activateTab(ntpOpenId);
          if (ntpUntitled && ntpUntitled.id !== ntpOpenId) closeTab(ntpUntitled.id);
          return;
        }
        var ntpPath = ntpRow.getAttribute('data-ntp-path');
        if (ntpPath) {
          openRecentIntoUntitled(ntpPath);
          return;
        }
        return;
      }

      // New tab button — creates/activates the Untitled tab (browser-style ⌘T)
      if (e.target.closest('[data-newtab]')) {
        openUntitledTab();
        return;
      }

      // UX-SB3: sidebar collapse button → toggleSidebar (same as ⌘B)
      if (e.target.closest('[data-sidebar-toggle]')) {
        toggleSidebar();
        return;
      }

      // Sidebar find → open in-doc find bar (F-07/F-14)
      if (e.target.closest('[data-open-find]')) {
        _openFindBar();
        return;
      }

      // UX-21: pencil hover button → enter edit mode
      if (e.target.closest('[data-edit-pencil]')) {
        if (state.tabs.length && state.mode === 'reading') {
          setMode('edit');
        }
        return;
      }

      // F-06: "Locate file…" on a not-found error tab → open the file picker
      // so the user can re-open the moved/renamed file.
      if (e.target.closest('[data-find-locate]')) {
        if (window.TVFiles && typeof TVFiles.openPicker === 'function') {
          TVFiles.openPicker();
        } else if (window.TVNative && typeof TVNative.openPicker === 'function') {
          TVNative.openPicker();
        }
        return;
      }

      // F-16/F-10: "Show in Finder" on a binary error tab → reveal the path.
      var revealBtn = e.target.closest('[data-reveal-finder]');
      if (revealBtn) {
        revealInFinder(revealBtn.getAttribute('data-reveal-finder'));
        return;
      }

      // F-15: dismiss the large-file banner (persist per-tab so it stays gone
      // across re-renders) and remove it from the DOM without a full re-render.
      var largeDismiss = e.target.closest('[data-large-dismiss]');
      if (largeDismiss) {
        var at = getActiveTab();
        if (at) at._largeDismissed = true;
        var banner = largeDismiss.closest('[data-large-banner]');
        if (banner && banner.parentNode) banner.parentNode.removeChild(banner);
        return;
      }

      // Edit toolbar: exit edit
      if (e.target.closest('[data-edit-esc]')) {
        setMode('reading');
        return;
      }

      // Edit toolbar: save
      if (e.target.closest('[data-edit-save]')) {
        handleSave();
        return;
      }

      // U-02: theme toggle button
      if (e.target.closest('[data-theme-toggle]')) {
        setTheme(state.theme === 'dark' ? 'light' : 'dark');
        return;
      }

      // U-04: copy code block button — DR-60: .tv-copy--copied class + aria-label
      var copyBtn = e.target.closest('[data-copy]');
      if (copyBtn) {
        var pre = copyBtn.closest('pre');
        if (pre) {
          var code = pre.querySelector('code');
          var text = code ? code.textContent : pre.textContent;
          if (navigator.clipboard && navigator.clipboard.writeText) {
            navigator.clipboard.writeText(text).then(function () {
              copyBtn.classList.add('tv-copy--copied');
              copyBtn.setAttribute('aria-label', 'Copied');
              setTimeout(function () {
                copyBtn.classList.remove('tv-copy--copied');
                copyBtn.setAttribute('aria-label', 'Copy code');
              }, 1500);
            }).catch(function (err) {
              // DR-64: silent failure — console.warn only, no UI change
              console.warn('[TV] clipboard write failed', err);
            });
          }
        }
        return;
      }

      // N-04: external link click handler
      var anchor = e.target.closest('.md a[href]');
      if (anchor) {
        var href = anchor.getAttribute('href');
        if (href && (href.indexOf('http://') === 0 || href.indexOf('https://') === 0)) {
          e.preventDefault();
          if (window.__TAURI__) {
            // Try opener plugin first, fall back to core invoke
            var opener = window.__TAURI__.opener;
            if (opener && typeof opener.openUrl === 'function') {
              opener.openUrl(href).catch(function () {});
            } else {
              window.__TAURI__.core.invoke('plugin:opener|open_url', { url: href }).catch(function () {});
            }
          } else {
            window.open(href, '_blank', 'noopener,noreferrer');
          }
          return;
        }
        // Internal #anchor links — scroll to heading
        if (href && href.charAt(0) === '#') {
          e.preventDefault();
          var headingText = href.slice(1).replace(/-/g, ' ');
          var activeTab = getActiveTab();
          if (activeTab) {
            scrollToHeading(activeTab.id, headingText);
          }
          return;
        }
        return;
      }

      // F-19 TASK 2: folder head toggle (collapse/expand) — DR-36
      var folderToggle = e.target.closest('[data-folder-toggle]');
      if (folderToggle && !e.target.closest('[data-folder-close]')) {
        var ftKey = folderToggle.getAttribute('data-folder-toggle');
        if (ftKey) {
          toggleFolderCollapse(ftKey);
        }
        return;
      }

      // F-19 TASK 3: folder close (×) button
      var folderCloseBtn = e.target.closest('[data-folder-close]');
      if (folderCloseBtn) {
        e.stopPropagation();
        var fcPath = folderCloseBtn.getAttribute('data-folder-close');
        if (fcPath) closeFolder(fcPath);
        return;
      }

      // F-19 TASK 2: folder tree file row click — open or activate
      var treeFileRow = e.target.closest('[data-tree-file-path]');
      if (treeFileRow) {
        var tfPath = treeFileRow.getAttribute('data-tree-file-path');
        // If already a tab, just activate it (DR-34)
        var existingTabId = treeFileRow.getAttribute('data-tree-tab-id');
        if (existingTabId) {
          activateTab(existingTabId);
        } else {
          _openTreeFilePath(tfPath);
        }
        return;
      }
    });

    // F-19 TASK 3: right-click folder head → context menu
    // U-10: right-click tab → tab context menu
    // U-08/U-10: right-click sidebar file/recent row → file context menu
    // Track the live pointer. WKWebView reports clientX/clientY = 0 on the
    // `contextmenu` event (and sometimes on mousemove), so capture coords from
    // every pointer/mouse event we can — pointerdown/mousedown fire right
    // before contextmenu and usually still carry the real cursor position.
    function _trackPtr(e) {
      if (e.clientX || e.clientY) { _ctxPtr.x = e.clientX; _ctxPtr.y = e.clientY; _ctxPtr.t = Date.now(); }
    }
    tvEl.addEventListener('pointermove', _trackPtr, true);
    tvEl.addEventListener('pointerdown', _trackPtr, true);
    tvEl.addEventListener('mousemove', _trackPtr, true);
    tvEl.addEventListener('mousedown', _trackPtr, true);

    // Resolve where to pop a context menu. Priority:
    //   1) the event's own cursor coords (normal browsers),
    //   2) the last tracked pointer IF it is fresh — i.e. from the real
    //      pointerdown/mousedown that immediately preceded this right-click
    //      (covers WKWebView, which zeroes the contextmenu event's coords),
    //   3) the bounding box of the clicked element — layout-based and always
    //      accurate in WKWebView, so the menu lands on what was clicked even
    //      when every pointer coordinate is unavailable. Never the corner.
    function _ctxAnchor(e, anchor) {
      if (e.clientX || e.clientY) { return { x: e.clientX, y: e.clientY }; }
      if ((_ctxPtr.x || _ctxPtr.y) && (Date.now() - _ctxPtr.t) < _CTX_PTR_FRESH_MS) {
        return { x: _ctxPtr.x, y: _ctxPtr.y };
      }
      var el = anchor || e.target;
      while (el && el.getBoundingClientRect) {
        var r = el.getBoundingClientRect();
        if (r.width || r.height) { return { x: Math.round(r.left + 6), y: Math.round(r.bottom) }; }
        el = el.parentElement;
      }
      return { x: 8, y: 8 };
    }

    tvEl.addEventListener('contextmenu', function (e) {
      // Allow the native menu inside editable text (paste/copy in the editor)
      if (e.target.closest('textarea, input, [contenteditable="true"]')) return;

      var pt;
      // U-10: tab right-click takes priority
      var tabEl = e.target.closest('[data-tab-id]');
      if (tabEl) {
        e.preventDefault();
        pt = _ctxAnchor(e, tabEl);
        openTabCtx(pt.x, pt.y, tabEl.getAttribute('data-tab-id'));
        return;
      }
      // Sidebar open-tab row (grouped / "Open" list) → full tab menu
      var sbTab = e.target.closest('[data-sidebar-tab]');
      if (sbTab) {
        e.preventDefault();
        pt = _ctxAnchor(e, sbTab);
        openTabCtx(pt.x, pt.y, sbTab.getAttribute('data-sidebar-tab'));
        return;
      }
      var fileRow = e.target.closest('[data-tree-file-path]');
      if (fileRow) {
        e.preventDefault();
        pt = _ctxAnchor(e, fileRow);
        openFileCtx(pt.x, pt.y,
          fileRow.getAttribute('data-tree-file-path'),
          fileRow.getAttribute('data-tree-tab-id') || null);
        return;
      }
      var recentRow = e.target.closest('[data-recent-path]');
      if (recentRow) {
        e.preventDefault();
        pt = _ctxAnchor(e, recentRow);
        openFileCtx(pt.x, pt.y, recentRow.getAttribute('data-recent-path'), null);
        return;
      }
      var fh = e.target.closest('[data-folder-ctx-target]');
      if (fh) {
        e.preventDefault();
        pt = _ctxAnchor(e, fh);
        var ctxPath = fh.getAttribute('data-folder-ctx-target');
        if (ctxPath) openFolderCtx(pt.x, pt.y, ctxPath);
        return;
      }
      // Suppress the leaky native WebKit context menu everywhere else in the
      // app chrome (the "Reload" default menu). Editable fields handled above.
      e.preventDefault();
    });

    // U-11: middle-click on tab → close tab
    tvEl.addEventListener('mousedown', function (e) {
      if (e.button !== 1) return;
      var tabEl = e.target.closest('[data-tab-id]');
      if (tabEl) {
        e.preventDefault();
        closeTab(tabEl.getAttribute('data-tab-id'));
      }
    });

    // Double-click rendered content → enter edit mode (DR-08)
    tvEl.addEventListener('dblclick', function (e) {
      if (state.mode !== 'reading') return;
      if (!e.target.closest('.tv-content')) return;
      setMode('edit');
    });
  }

  /* ────────────────────────────────────────────────────────────
     CONTROLLER API
   ──────────────────────────────────────────────────────────── */

  function getActiveTab() {
    if (!state.activeId) return null;
    for (var i = 0; i < state.tabs.length; i++) {
      if (state.tabs[i].id === state.activeId) return state.tabs[i];
    }
    return null;
  }

  function openDoc(opts) {
    if (!opts || !opts.name) return null;

    // Deduplicate: if a tab with same key already exists, just activate it
    var key = tabKey(opts);
    for (var i = 0; i < state.tabs.length; i++) {
      if (tabKey(state.tabs[i]) === key) {
        activateTab(state.tabs[i].id);
        return state.tabs[i].id;
      }
    }

    var tab = makeTab(opts);
    state.tabs.push(tab);
    activateTab(tab.id);
    return tab.id;
  }

  // F-06/F-16: open (or reuse) a tab in an error state for a path that could
  // not be read. errorKind ∈ {'not-found','binary'}. If a tab for this native
  // path already exists, flip it into the error state in place; otherwise push
  // a new error tab. Always activates so the user sees the recovery card.
  function openErrorTab(name, nativePath, errorKind) {
    // Reuse an existing tab for the same path (e.g. it vanished mid-session).
    if (nativePath) {
      for (var i = 0; i < state.tabs.length; i++) {
        if (state.tabs[i].nativePath === nativePath) {
          var existing = state.tabs[i];
          existing.error = errorKind || 'not-found';
          existing.live = false;
          existing.dirty = false;
          if (window.TVLive && typeof TVLive.stop === 'function') {
            TVLive.stop(existing.id);
          }
          activateTab(existing.id); // _doActivateTab renders
          return existing.id;
        }
      }
    }
    var tab = makeTab({
      name: name || (nativePath ? nativePath.split('/').pop() : 'File'),
      path: nativePath ? (nativePath.replace(/\/[^/]+$/, '') || '/') : '/',
      error: errorKind || 'not-found',
    });
    if (nativePath) tab.nativePath = nativePath;
    state.tabs.push(tab);
    activateTab(tab.id); // _doActivateTab renders
    return tab.id;
  }

  // F-10/F-16: reveal a file in Finder via the native bridge. No-op in browser.
  function revealInFinder(path) {
    if (!path) return;
    if (window.TVNative && typeof TVNative.revealInFinder === 'function') {
      TVNative.revealInFinder(path);
    }
  }

  // Browser-style new tab (⌘T / + button). Untitled tabs are a singleton:
  // if one already exists, activate it instead of creating a second.
  function findUntitledTab() {
    for (var i = 0; i < state.tabs.length; i++) {
      if (state.tabs[i].untitled) return state.tabs[i];
    }
    return null;
  }

  // Creation deliberately bypasses openDoc so its dedup never sees
  // untitled tabs — they are pushed directly and activated.
  function openUntitledTab() {
    var existing = findUntitledTab();
    if (existing) {
      activateTab(existing.id);
      return existing.id;
    }
    var tab = makeTab({ name: 'Untitled', untitled: true });
    state.tabs.push(tab);
    activateTab(tab.id);
    return tab.id;
  }

  // Fill the untitled tab IN PLACE from an already-read document. `doc` is the
  // read_md_file payload ({ name, content, path }); `requestedPath` is the path
  // the caller used to read it (fallback for nativePath). Mirrors tv-native.js
  // openInto() but mutates the existing untitled tab instead of pushing a new
  // one. If the file is already open in another tab, activate that tab and
  // close the untitled one. Returns true when it filled/activated a tab.
  // Shared by recents AND direct path entry so the fill-in-place invariants
  // (name/source/path/nativePath, live, scroll reset, saveRecentPath, TVLive)
  // live in exactly one place.
  function fillUntitledWithDoc(doc, requestedPath) {
    if (!doc) return false;
    var nativePath = doc.path || requestedPath || '';

    var untitled = findUntitledTab();
    if (!untitled) return false;

    // Already open elsewhere? Activate it FIRST, then close the untitled
    // tab — activate-first so _doCloseTab's neighbor-pick never fires.
    if (nativePath) {
      for (var i = 0; i < state.tabs.length; i++) {
        if (state.tabs[i].nativePath === nativePath && state.tabs[i].id !== untitled.id) {
          activateTab(state.tabs[i].id);
          closeTab(untitled.id);
          return true;
        }
      }
    }

    // Transform the untitled tab in place — do NOT push a new tab.
    untitled.name = doc.name;
    untitled.source = doc.content;
    untitled.path = nativePath ? (nativePath.replace(/\/[^/]+$/, '') || '/') : '/';
    untitled.nativePath = nativePath;
    untitled.untitled = false;
    untitled.live = true;
    untitled.dirty = false;
    if (untitled.nativePath) saveRecentPath(untitled.nativePath);
    // Same-tab re-activation = canonical render + tabchange emit
    activateTab(untitled.id);
    // activateTab's E-04 save captured the NTP's scroll offset; the freshly
    // opened document must start at the top, not the picker's position.
    untitled.scrollTop = 0;
    var scrollEl = document.querySelector('[data-scroll]');
    if (scrollEl) scrollEl.scrollTop = 0;
    // Seed the live-watch recency clock from the file's real mtime so opening a
    // static file (old mtime) does NOT show the live indicator — only a recently
    // written / streaming file does (tv-live.js gates the open display on isRecent).
    if (typeof doc.modified === 'number') { untitled.lastModTime = doc.modified; }
    if (window.TVLive && typeof TVLive.start === 'function') {
      TVLive.start(untitled.id);
    }
    return true;
  }

  // Fill the untitled tab IN PLACE with a recent file (new-tab page row).
  // Reads the file via the bridge, then hands the doc to fillUntitledWithDoc.
  // Plain-browser mode: graceful no-op.
  function openRecentIntoUntitled(path) {
    if (!path || !(window.TVNative && TVNative.available)) return;
    if (!findUntitledTab()) return;

    window.__TAURI__.core.invoke('read_md_file', { path: path })
      .then(function (doc) {
        fillUntitledWithDoc(doc, path);
      })
      .catch(function (err) {
        console.warn('[TV] new-tab recent open failed', path, err);
        // F-06/F-16: surface a recovery tab instead of a transient toast.
        var kind = (window.TVNative && typeof TVNative.classifyReadError === 'function')
          ? TVNative.classifyReadError(err) : 'not-found';
        openErrorTab(path.split('/').pop() || path, path, kind);
      });
  }

  // E-04: Save outgoing tab's scroll BEFORE changing state.activeId,
  // then update activeId, render, and restore the incoming scroll.
  // E-06: Capture outgoing tab id before switch, include prevId in tabchange event.
  // UF-02/UF-04: Commit textarea value to tab.source before switching so no text is lost.
  function activateTab(id) {
    if (!id) return;

    // Capture outgoing tab id BEFORE changing state.activeId (E-06)
    var prevId = state.activeId;
    var outgoing = getActiveTab();
    var isCrossTabSwitch = (id !== state.activeId);

    // UF-03/F3: If switching to a DIFFERENT tab while in edit mode, ask the user
    // before proceeding. Content is committed regardless (UF-02/UF-04 below), but
    // the UF-02 contract requires explicit confirmation.
    // Guard: only prompt on user-initiated cross-tab switches; same-tab re-activations
    // (openDoc dedup, programmatic same-id calls) pass silently.
    if (isCrossTabSwitch && state.mode === 'edit' && outgoing) {
      var confirmMsg = 'Leave edit mode? Your changes are kept in the tab.';
      if (window.__TAURI__ && window.__TAURI__.dialog) {
        // Tauri native dialog (async) — commit textarea first so content is safe
        var editTextareaPre = document.querySelector('[data-edit-area]');
        if (editTextareaPre && editTextareaPre.value !== outgoing.source) {
          outgoing.source = editTextareaPre.value;
          if (outgoing.source !== '') outgoing.dirty = true;
        }
        window.__TAURI__.dialog.ask(confirmMsg, { title: 'Leave Edit Mode?', kind: 'warning' })
          .then(function (confirmed) {
            if (!confirmed) {
              // User declined: stay on current tab, refocus textarea
              var ta = document.querySelector('[data-edit-area]');
              if (ta) ta.focus();
              return;
            }
            _doActivateTab(id, prevId, outgoing);
          })
          .catch(function () {
            // Dialog plugin unavailable — fall back to sync confirm
            if (!window.confirm(confirmMsg)) {
              var ta = document.querySelector('[data-edit-area]');
              if (ta) ta.focus();
              return;
            }
            _doActivateTab(id, prevId, outgoing);
          });
        return;
      } else {
        // Browser sync confirm
        if (!window.confirm(confirmMsg)) {
          var editTextareaRefocus = document.querySelector('[data-edit-area]');
          if (editTextareaRefocus) editTextareaRefocus.focus();
          return;
        }
      }
    }

    _doActivateTab(id, prevId, outgoing, isCrossTabSwitch);
  }

  // Internal: performs the actual tab switch after any edit-mode confirmation.
  function _doActivateTab(id, prevId, outgoing, isCrossTabSwitch) {
    // Default isCrossTabSwitch when called from the non-edit path
    if (isCrossTabSwitch === undefined) isCrossTabSwitch = (id !== prevId);

    // F1: clear find state when actually switching to a different tab so render()
    // does not restore a stale find bar from the outgoing tab's content.
    // Sidebar toggles and same-tab re-renders keep _findOpen as-is (UF-06).
    if (isCrossTabSwitch) {
      _findOpen = false;
      _findQuery = '';
      _findMatches = [];
      _findIndex = 0;
    }

    // UF-02/UF-04: If switching away while in edit mode, commit the live textarea
    // value into tab.source so no typed text is lost, and keep dirty flag intact.
    // (onInput already keeps tab.source current on every keystroke, but an in-flight
    // composition event or a programmatic activateTab call before the first keystroke
    // could leave a gap — this is the canonical safety commit.)
    if (state.mode === 'edit' && outgoing) {
      var editTextarea = document.querySelector('[data-edit-area]');
      if (editTextarea && editTextarea.value !== outgoing.source) {
        outgoing.source = editTextarea.value;
        // Ensure dirty is set if the content has changed
        if (outgoing.source !== '') {
          outgoing.dirty = true;
        }
      }
    }

    // Save outgoing tab's current scroll (E-04: must happen before activeId changes)
    var scrollEl = document.querySelector('[data-scroll]');
    if (scrollEl && outgoing) {
      outgoing.scrollTop = scrollEl.scrollTop;
    }

    state.activeId = id;
    state.mode = 'reading';
    render();
    // F6: scroll restore is handled inside render() via the [data-scroll] restore block
    // (covers all render paths); duplicate restore here has been removed.

    // Bug B: after render(), scroll the newly-active tab pill into view so it is
    // never hidden behind the strip's overflow. block:'nearest' prevents vertical
    // scroll of the document; inline:'nearest' handles horizontal strip scroll.
    var activeTabEl = document.querySelector('[data-tab-id="' + id + '"]');
    if (activeTabEl) {
      activeTabEl.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    }

    // E-06: include prevId so tv-live.js can remove the outgoing tab's live UI
    tvEmit('tabchange', { id: id, prevId: prevId || null, tab: getActiveTab() });

    // DR-47: persist session after every tab switch (covers ⌘Q paths on WKWebView)
    saveSession();
  }

  // S-03: closeTab guard — confirm before closing dirty tabs
  function closeTab(id) {
    var idx = state.tabs.findIndex(function (t) { return t.id === id; });
    if (idx === -1) return;

    var tab = state.tabs[idx];

    // S-03: Guard against silent data loss.
    // Untitled new-tab pages never have anything to lose — close instantly.
    if (tab.dirty && !tab.untitled) {
      var msg = 'Discard unsaved changes to "' + tab.name + '"?';
      // In Tauri, try native dialog; otherwise use window.confirm
      if (window.__TAURI__ && window.__TAURI__.dialog) {
        window.__TAURI__.dialog.ask(msg, { title: 'Unsaved Changes', kind: 'warning' })
          .then(function (confirmed) {
            if (confirmed) _doCloseTab(id, idx);
          })
          .catch(function () {
            // Fallback to confirm if dialog plugin not available
            if (window.confirm(msg)) _doCloseTab(id, idx);
          });
      } else {
        if (!window.confirm(msg)) return;
        _doCloseTab(id, idx);
      }
      return;
    }

    _doCloseTab(id, idx);
  }

  function _doCloseTab(id, idx) {
    // Stop live watch if running
    if (window.TVLive && typeof TVLive.stop === 'function') {
      TVLive.stop(id);
    }

    state.tabs.splice(idx, 1);

    // If we closed the active tab, pick a neighbor
    if (state.activeId === id) {
      if (state.tabs.length) {
        var next = state.tabs[Math.min(idx, state.tabs.length - 1)];
        state.activeId = next.id;
      } else {
        state.activeId = null;
      }
    }

    state.mode = 'reading';
    render();
    // DR-47: persist session after close so quit-after-close captures the right state
    saveSession();
  }

  function setMode(m) {
    if (m !== 'reading' && m !== 'edit') return;
    // Untitled new-tab pages have no document to edit — central guard that
    // makes ⌘E, dblclick, and any future setMode('edit') caller a no-op.
    if (m === 'edit') {
      var t = getActiveTab();
      if (t && t.untitled) return;
    }
    state.mode = m;
    render();
    tvEmit('modechange', { mode: m });
  }

  function setTheme(t) {
    if (t !== 'light' && t !== 'dark' && t !== 'system') return;
    if (t === 'system') {
      // DR-13: delete the override key and re-attach the matchMedia listener so
      // OS changes auto-apply. localStorage.removeItem is idempotent — safe even
      // if the key was never set (first launch) or already absent.
      localStorage.removeItem('tv-theme');
      var prefersDark = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
      state.theme = prefersDark ? 'dark' : 'light';
      // Re-attach the listener so future OS changes trigger a re-render.
      // Only add if not already listening (we rely on init() having set one;
      // but on a mid-session "System" select the old listener may have an
      // stale guard — adding a second one is harmless: both check the key
      // which is now absent, so both will fire correctly).
      if (window.matchMedia) {
        window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', function (ev) {
          if (!localStorage.getItem('tv-theme')) {
            state.theme = ev.matches ? 'dark' : 'light';
            render();
          }
        });
      }
    } else {
      state.theme = t;
      localStorage.setItem('tv-theme', t);
    }
    render();
  }

  function setAccent(a) {
    if (a !== 'blue' && a !== 'graphite' && a !== 'warm') return;
    state.accent = a;
    localStorage.setItem('tv-accent', a);
    render();
  }

  function toggleSidebar() {
    state.sidebarOpen = !state.sidebarOpen;
    // F-09: an explicit user toggle pins the choice — the responsive
    // ResizeObserver stops auto-adjusting the sidebar default after this.
    state.sidebarUserToggled = true;
    render();
  }

  // F-05/U-07: Font size control — DR-27: floor 13px, cap 22px (DR-29: persisted)
  function setFontSize(px) {
    var clamped = Math.max(13, Math.min(22, px));
    state.fontSize = clamped;
    localStorage.setItem('tv-font-size', String(clamped));
    // Apply without full render — just update the CSS variable on the .tv root
    var tvRoot = document.querySelector('.tv');
    if (tvRoot) {
      tvRoot.style.setProperty('--tv-md-font', clamped + 'px');
    }
  }

  // S-11 fix: capture tab id before rAF to avoid scrolling wrong tab
  // F2: same-tab jump from edit mode stays in edit mode (scroll textarea to heading line).
  function scrollToHeading(tabId, headingText) {
    if (!tabId || !headingText) return;
    var targetTabId = tabId; // capture before rAF

    // F2: if already on the target tab while in edit mode, do NOT call activateTab
    // (which forces mode='reading'). Instead, scroll the textarea to the heading's line.
    if (tabId === state.activeId && state.mode === 'edit') {
      var tab = getActiveTab();
      if (tab && tab.source) {
        var lines = tab.source.split('\n');
        var needle = headingText.toLowerCase().trim();
        var lineIdx = -1;
        for (var li = 0; li < lines.length; li++) {
          if (lines[li].toLowerCase().replace(/^#{1,6}\s+/, '').trim().indexOf(needle) !== -1) {
            lineIdx = li;
            break;
          }
        }
        if (lineIdx !== -1) {
          var ta = document.querySelector('[data-edit-area]');
          if (ta) {
            // Approximate scroll: proportion of heading line within total lines
            var ratio = lineIdx / Math.max(lines.length - 1, 1);
            ta.scrollTop = Math.round(ratio * (ta.scrollHeight - ta.clientHeight));
            ta.focus();
          }
        }
      }
      return;
    }

    activateTab(tabId);

    // After render, find heading by text and scroll it into view
    requestAnimationFrame(function () {
      // S-11: verify the active tab hasn't changed since we queued the rAF
      if (window.TV && window.TV.state && window.TV.state.activeId !== targetTabId) return;

      var tvRoot = document.querySelector('.tv');
      if (!tvRoot) return;
      // UF-08: include h4-h6 so deep headings in technical docs are reachable
      var headings = tvRoot.querySelectorAll('.md h1,.md h2,.md h3,.md h4,.md h5,.md h6');
      var target = null;
      var needle = headingText.toLowerCase().trim();
      for (var i = 0; i < headings.length; i++) {
        if (headings[i].textContent.toLowerCase().trim().indexOf(needle) !== -1) {
          target = headings[i];
          break;
        }
      }
      if (target) {
        target.scrollIntoView({ behavior: 'smooth', block: 'start' });
        // Also update scrollTop on the tab
        var scrollEl = document.querySelector('[data-scroll]');
        var tab = getActiveTab();
        if (scrollEl && tab) {
          tab.scrollTop = scrollEl.scrollTop;
        }
      }
    });
  }

  // S-01: markDirty is render-FREE — only updates tab flag + dot in DOM
  function markDirty(id, isDirty) {
    for (var i = 0; i < state.tabs.length; i++) {
      if (state.tabs[i].id === id) {
        state.tabs[i].dirty = !!isDirty;
        // S-01: update ONLY the dot in the tab element, no full render
        _updateTabDot(id, !!isDirty);
        return;
      }
    }
  }

  // S-01 helper: find the tab element and toggle the dot without a full render
  function _updateTabDot(id, isDirty) {
    var tabEl = document.querySelector('[data-tab-id="' + id + '"]');
    if (!tabEl) return;

    var icons = window.TV_ICONS || {};
    var tab = null;
    for (var i = 0; i < state.tabs.length; i++) {
      if (state.tabs[i].id === id) { tab = state.tabs[i]; break; }
    }
    if (!tab) return;

    // Remove existing lead indicators
    var existingBolt = tabEl.querySelector('.tv-bolt');
    var existingDot  = tabEl.querySelector('.tv-dot');
    if (existingBolt) existingBolt.parentNode.removeChild(existingBolt);
    if (existingDot)  existingDot.parentNode.removeChild(existingDot);

    // Re-insert lead indicators based on current state
    var nameEl = tabEl.querySelector('.name');
    if (!nameEl) return;

    if (tab.live && isDirty) {
      var boltSpan = document.createElement('span');
      boltSpan.className = 'tv-bolt';
      boltSpan.innerHTML = icons.bolt || '';
      var dotSpan = document.createElement('span');
      dotSpan.className = 'tv-dot';
      tabEl.insertBefore(dotSpan, nameEl);
      tabEl.insertBefore(boltSpan, dotSpan);
    } else if (tab.live) {
      var boltSpan2 = document.createElement('span');
      boltSpan2.className = 'tv-bolt';
      boltSpan2.innerHTML = icons.bolt || '';
      tabEl.insertBefore(boltSpan2, nameEl);
    } else if (isDirty) {
      var dotSpan2 = document.createElement('span');
      dotSpan2.className = 'tv-dot';
      tabEl.insertBefore(dotSpan2, nameEl);
    }
  }

  function tvEl() {
    return document.querySelector('.tv');
  }

  /* ── Save action (E-03 + E-05) ───────────────────────────── */
  // Single canonical save pathway:
  //   1. If not dirty → just exit edit mode (nothing to write).
  //   2. Else delegate to TVNative.saveTab (Tauri) or TVFiles.writeFile (browser).
  //      tab.source is current at save time — TVEdit writes edits directly into
  //      tab.source live (renderer contract), so no getSource() call is needed.
  function handleSave() {
    var tab = getActiveTab();
    if (!tab) return;

    // Untitled new-tab pages have nothing to save (⌘S / menu:save no-op)
    if (tab.untitled) return;

    // Not dirty: just exit edit mode without writing anything (DR-06)
    if (!tab.dirty) {
      setMode('reading');
      return;
    }

    // E-03: Tauri native save — delegate to TVNative.saveTab which uses
    // save_md_file (existing nativePath) or save_md_file_as (new file).
    // tab.nativePath is set by tv-native.js after openDoc(); fileHandle
    // is NOT set for native tabs (E-13 invariant: these paths are exclusive).
    if (window.TVNative && TVNative.available) {
      TVNative.saveTab(tab).then(function () {
        setMode('reading');
      }).catch(function (err) {
        // N-06: surface save failure as toast, keep user in edit mode
        console.warn('[tiny-viewer] native save failed:', err);
        if (window.TVNative && typeof TVNative.showToast === 'function') {
          TVNative.showToast('Save failed: ' + (err || 'unknown error'));
        }
        // Do NOT call setMode('reading') — keep user in edit mode to retry
      });
      return;
    }

    // Browser: delegate to TVFiles.writeFile (handles fileHandle, showSaveFilePicker,
    // or download fallback). TVFiles.writeFile(tab) calls markDirty internally.
    if (window.TVFiles && typeof TVFiles.writeFile === 'function') {
      TVFiles.writeFile(tab).then(function () {
        setMode('reading');
      }).catch(function (err) {
        console.warn('[tiny-viewer] browser save failed:', err);
        setMode('reading');
      });
      return;
    }

    // Last resort: no save mechanism available — just clear dirty and exit
    tab.dirty = false;
    setMode('reading');
  }

  /* ── F-03: Open Folder ────────────────────────────────────── */
  function openFolder() {
    if (!window.__TAURI__) return;
    window.__TAURI__.core.invoke('pick_folder')
      .then(function (docs) {
        if (!docs || !docs.length) return;
        docs.forEach(function (doc) {
          if (window.TVNative && typeof TVNative.openInto === 'function') {
            TVNative.openInto(doc);
          } else if (doc && doc.name) {
            var pdir = doc.path ? doc.path.replace(/\/[^/]+$/, '') || '/' : null;
            var id = openDoc({ name: doc.name, source: doc.content, path: pdir });
            if (id) {
              var tab = state.tabs.find(function (t) { return t.id === id; });
              if (tab) tab.nativePath = doc.path;
            }
          }
        });
      })
      .catch(function (err) {
        // User cancelled or error
        if (err) console.warn('[TV] pick_folder failed', err);
      });
  }

  /* ────────────────────────────────────────────────────────────
     UX-10: SIDEBAR KEYBOARD CURSOR HANDLER (document-level)
     Replaces the old roving-tabindex approach which relied on
     el.focus() on non-form elements — a silent no-op on macOS
     when AppleKeyboardUIMode=0 (Full Keyboard Access is OFF).
     This handler is entirely focus-independent (WebKit-safe).
   ──────────────────────────────────────────────────────────── */
  document.addEventListener('keydown', function (e) {
    // Never hijack typing inside form controls or any overlay/editor.
    // Check for: inputs, textareas, contenteditable, find bar, palette, search, edit area.
    if (e.target.closest('input, textarea, [contenteditable]')) return;
    if (e.target.closest('.tv-find, .tv-palette-scrim, .tv-search-container, .tv-edit-area')) return;

    // Only handle navigation keys here; other keys fall through to the keyboard router below.
    var navKey = (e.key === 'ArrowDown' || e.key === 'ArrowUp' ||
                  e.key === 'Enter' || e.key === ' ' ||
                  e.key === 'Home' || e.key === 'End' ||
                  e.key === 'Escape');
    if (!navKey) return;

    // Escape: deactivate cursor if active. Both this handler and the main keyboard
    // router are separate document listeners so both always fire. The main router
    // handles Escape priority (find bar → palette → edit mode → sbKbd). This handler
    // just ensures sbKbd is cleared; the main router will also call renderSidebarCursor
    // via its own guard. No preventDefault here — the main router owns that.
    if (e.key === 'Escape') {
      if (sbKbd.active) {
        sbKbd.active = false;
        renderSidebarCursor();
      }
      return; // return so arrows/Enter/etc below don't run on Escape
    }

    // All remaining nav keys (arrows, Enter, Space, Home, End) only act when
    // the sidebar keyboard cursor is active. Otherwise let the browser handle
    // them (e.g. arrow keys scroll content normally).
    if (!sbKbd.active) return;

    var listbox = document.getElementById('tv-sidebar-listbox');
    if (!listbox) return;
    var opts = Array.prototype.slice.call(
      listbox.querySelectorAll('[role="option"][data-sidebar-tab]')
    );
    if (!opts.length) return;

    // Find current cursor index (fallback to 0)
    var curIdx = 0;
    for (var i = 0; i < opts.length; i++) {
      if (opts[i].getAttribute('data-sidebar-tab') === sbKbd.id) {
        curIdx = i; break;
      }
    }

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      var nextIdx = Math.min(curIdx + 1, opts.length - 1);
      sbKbd.id = opts[nextIdx].getAttribute('data-sidebar-tab');
      renderSidebarCursor();
      return;
    }

    if (e.key === 'ArrowUp') {
      e.preventDefault();
      var prevIdx = Math.max(curIdx - 1, 0);
      sbKbd.id = opts[prevIdx].getAttribute('data-sidebar-tab');
      renderSidebarCursor();
      return;
    }

    if (e.key === 'Home') {
      e.preventDefault();
      sbKbd.id = opts[0].getAttribute('data-sidebar-tab');
      renderSidebarCursor();
      return;
    }

    if (e.key === 'End') {
      e.preventDefault();
      sbKbd.id = opts[opts.length - 1].getAttribute('data-sidebar-tab');
      renderSidebarCursor();
      return;
    }

    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      if (sbKbd.id) {
        activateTab(sbKbd.id);
        // activateTab → render → renderSidebarCursor (called inside render).
        // sbKbd.active stays true so arrows keep working post-Enter.
        // The cursor id stays on the just-opened row; reapply after rAF
        // to ensure the new DOM has the class.
        requestAnimationFrame(function () { renderSidebarCursor(); });
      }
      return;
    }
  });

  /* ────────────────────────────────────────────────────────────
     KEYBOARD ROUTER
   ──────────────────────────────────────────────────────────── */
  document.addEventListener('keydown', function (e) {
    var meta = e.metaKey || e.ctrlKey;
    var k = e.key;

    // Esc — close find bar first, then overlays, then exit edit, then sidebar cursor
    if (k === 'Escape') {
      if (_findOpen) {
        _closeFindBar(); e.preventDefault(); return;
      }
      if (window.TVPalette && TVPalette.isOpen && TVPalette.isOpen()) {
        TVPalette.close(); e.preventDefault(); return;
      }
      if (window.TVSearch && TVSearch.isOpen && TVSearch.isOpen()) {
        TVSearch.close(); e.preventDefault(); return;
      }
      if (state.shortcutsOpen) {
        closeShortcuts(); e.preventDefault(); return;
      }
      if (state.mode === 'edit') {
        setMode('reading'); e.preventDefault(); return;
      }
      // Launcher panel: Escape closes the untitled tab once everything
      // higher in the ladder (find bar, palette, search, edit) has passed.
      // Only when typing isn't focused elsewhere — the NTP input lives in
      // this document, and its own keydown handler lets Escape bubble here.
      var escTab = getActiveTab();
      if (escTab && escTab.untitled) {
        closeTab(escTab.id); e.preventDefault(); return;
      }
      return;
    }

    // F-22/U-06: '?' — open shortcuts overlay (reading mode only, no overlay/input focused).
    // Note: '?' is Shift+/ on US layouts, so e.shiftKey is expected true — do NOT guard on it.
    if (k === '?' && !meta) {
      // Guard: skip if focus is in a text input/textarea/contenteditable
      var focused = document.activeElement;
      var inInput = focused && (
        focused.tagName === 'INPUT' || focused.tagName === 'TEXTAREA' ||
        focused.isContentEditable
      );
      if (!inInput && state.mode === 'reading' && !state.shortcutsOpen) {
        e.preventDefault();
        openShortcuts();
        return;
      }
    }

    if (!meta) return;

    // ⌘K — command palette toggle
    if (k === 'k' || k === 'K') {
      e.preventDefault();
      // UX-10: opening an overlay deactivates sidebar keyboard cursor
      sbKbd.active = false;
      renderSidebarCursor();
      if (window.TVPalette) {
        TVPalette.isOpen && TVPalette.isOpen() ? TVPalette.close() : TVPalette.open();
      }
      return;
    }

    // ⌘T — browser-style new tab (creates/activates the Untitled tab)
    if (k === 't' || k === 'T') {
      e.preventDefault();
      // UX-10: focus moves to the NTP input; deactivate sidebar keyboard cursor
      sbKbd.active = false;
      renderSidebarCursor();
      openUntitledTab();
      return;
    }

    // ⌘⇧F — cross-tab search toggle
    if ((k === 'f' || k === 'F') && e.shiftKey) {
      e.preventDefault();
      if (window.TVSearch) {
        TVSearch.isOpen && TVSearch.isOpen() ? TVSearch.close() : TVSearch.open();
      }
      return;
    }

    // F-07/U-03: ⌘F — in-document find (no shiftKey)
    // UI-04/UF-05: Only intercept in reading mode. In edit mode do NOT preventDefault
    // so the browser / OS can handle it (no silent key-swallow).
    if ((k === 'f' || k === 'F') && !e.shiftKey) {
      if (state.mode === 'reading') {
        e.preventDefault();
        // UI-06: don't open find bar when cross-tab search is already open
        if (state.tabs.length && !(window.TVSearch && TVSearch.isOpen && TVSearch.isOpen())) {
          _openFindBar();
        }
      }
      // edit mode: do NOT preventDefault — fall through to browser default
      return;
    }

    // ⌘B — toggle sidebar
    if (k === 'b' || k === 'B') {
      e.preventDefault();
      toggleSidebar();
      return;
    }

    // U-16 / DR-42: ⌘⌥O — open palette pre-filtered to outline/headings.
    // On macOS with Option held, e.key is a composed glyph (e.g. 'ø'); match
    // on e.code instead. Must check altKey BEFORE the bare ⌘O / ⌘⇧O guards.
    if (e.code === 'KeyO' && e.metaKey && e.altKey && !e.shiftKey) {
      e.preventDefault();
      if (typeof window.TVPalette !== 'undefined' &&
          typeof window.TVPalette.openOutline === 'function') {
        window.TVPalette.openOutline();
      }
      return;
    }

    // ⌘⇧O — open folder (F-03)
    if ((k === 'o' || k === 'O') && e.shiftKey) {
      e.preventDefault();
      openFolder();
      return;
    }

    // ⌘O — open file picker
    if (k === 'o' || k === 'O') {
      e.preventDefault();
      if (window.TVFiles && typeof TVFiles.openPicker === 'function') {
        TVFiles.openPicker();
      }
      return;
    }

    // ⌘E — toggle edit mode
    if (k === 'e' || k === 'E') {
      e.preventDefault();
      if (state.tabs.length) {
        // UX-10: entering edit mode deactivates sidebar keyboard cursor
        if (state.mode !== 'edit') {
          sbKbd.active = false;
          renderSidebarCursor();
        }
        setMode(state.mode === 'edit' ? 'reading' : 'edit');
      }
      return;
    }

    // ⌘S — save (only meaningful in edit mode)
    // UI-07: always preventDefault to prevent browser Save As dialog in non-Tauri
    if (k === 's' || k === 'S') {
      e.preventDefault();
      if (state.mode === 'edit') {
        handleSave();
      }
      return;
    }

    // ⌘W — close active tab
    if (k === 'w' || k === 'W') {
      e.preventDefault();
      if (state.activeId) closeTab(state.activeId);
      return;
    }

    // F-01: ⌘[ — previous tab
    if (k === '[') {
      e.preventDefault();
      if (state.tabs.length > 1) {
        var curIdx = state.tabs.findIndex(function (t) { return t.id === state.activeId; });
        var prevIdx = (curIdx - 1 + state.tabs.length) % state.tabs.length;
        activateTab(state.tabs[prevIdx].id);
      }
      return;
    }

    // F-01: ⌘] — next tab
    if (k === ']') {
      e.preventDefault();
      if (state.tabs.length > 1) {
        var curIdx2 = state.tabs.findIndex(function (t) { return t.id === state.activeId; });
        var nextIdx = (curIdx2 + 1) % state.tabs.length;
        activateTab(state.tabs[nextIdx].id);
      }
      return;
    }

    // F-05/U-07: ⌘= / ⌘+ — increase font size
    if (k === '=' || k === '+') {
      e.preventDefault();
      setFontSize(state.fontSize + 2);
      return;
    }

    // F-05/U-07: ⌘- — decrease font size
    if (k === '-' || k === '_') {
      e.preventDefault();
      setFontSize(state.fontSize - 2);
      return;
    }

    // F-05/U-07: ⌘0 — reset font size
    if (k === '0') {
      e.preventDefault();
      setFontSize(16);
      return;
    }

    // ⌘1–9 — activate nth tab
    if (k >= '1' && k <= '9') {
      var n = parseInt(k, 10) - 1;
      if (n < state.tabs.length) {
        e.preventDefault();
        activateTab(state.tabs[n].id);
      }
      return;
    }
  });

  /* ────────────────────────────────────────────────────────────
     DR-47: saveSession() — incremental tv-session persistence.
     Called after every tab open, close, switch, and (debounced)
     on scroll, so Tauri ⌘Q / Dock-Quit never silently drops the
     session (WKWebView does not fire beforeunload on those paths).
     GUARD: no-op while sessionRestoring to avoid clobbering the
     persisted state we are currently reading from.
   ──────────────────────────────────────────────────────────── */
  function saveSession() {
    if (state.sessionRestoring) return;

    // Capture live scrollTop for the active tab from the DOM (may be mid-scroll)
    var scrollEl = document.querySelector('[data-scroll]');
    var activeTab = getActiveTab();
    if (scrollEl && activeTab) {
      activeTab.scrollTop = scrollEl.scrollTop;
    }

    var sessionTabs = [];
    for (var si = 0; si < state.tabs.length; si++) {
      var st = state.tabs[si];
      if (st.untitled || st.error || !st.nativePath) continue;
      sessionTabs.push({ nativePath: st.nativePath, scrollTop: st.scrollTop || 0 });
    }

    try {
      if (sessionTabs.length) {
        localStorage.setItem('tv-session', JSON.stringify({
          tabs: sessionTabs,
          activeNativePath: activeTab ? (activeTab.nativePath || null) : null,
        }));
      } else {
        // DR-49: no real-doc tabs → empty state on next launch
        localStorage.removeItem('tv-session');
      }
    } catch (ex) { /* storage full — ignore */ }
  }

  // Debounced scroll wrapper: fires saveSession() ~500ms after the last scroll
  // event so we don't thrash localStorage on every pixel of scroll.
  var _saveSessionTimer = null;
  function _saveSessionDebounced() {
    if (_saveSessionTimer) clearTimeout(_saveSessionTimer);
    _saveSessionTimer = setTimeout(saveSession, 500);
  }

  /* ────────────────────────────────────────────────────────────
     beforeunload — warn if dirty + belt-and-suspenders session save
   ──────────────────────────────────────────────────────────── */
  window.addEventListener('beforeunload', function (e) {
    if (state.tabs.some(function (t) { return t.dirty; })) {
      e.preventDefault();
      e.returnValue = '';
    }
    // Belt-and-suspenders: saveSession() is also called incrementally so
    // WKWebView ⌘Q / Dock-Quit paths (which skip beforeunload) are covered.
    saveSession();
  });

  /* ────────────────────────────────────────────────────────────
     NATIVE MENU EVENT LISTENERS
     dev-rust emits these events; we route them to existing actions.
   ──────────────────────────────────────────────────────────── */
  function wireNativeMenuEvents() {
    if (!window.__TAURI__ || !window.__TAURI__.event) return;
    // Bind to preserve `this` — a bare `var listen = ...event.listen` loses the
    // method receiver and the listeners silently never fire (broke the menu bar).
    var listen = window.__TAURI__.event.listen.bind(window.__TAURI__.event);

    listen('menu:open-file', function () {
      if (window.TVFiles && typeof TVFiles.openPicker === 'function') TVFiles.openPicker();
    }).catch(function () {});

    listen('menu:open-folder', function () {
      openFolder();
    }).catch(function () {});

    listen('menu:save', function () {
      if (state.mode === 'edit') handleSave();
    }).catch(function () {});

    listen('menu:close-tab', function () {
      if (state.activeId) closeTab(state.activeId);
    }).catch(function () {});

    listen('menu:find', function () {
      // UF-05: only open find in reading mode; silently ignore in edit mode
      if (state.mode === 'reading' && state.tabs.length) _openFindBar();
    }).catch(function () {});

    listen('menu:find-in-files', function () {
      if (window.TVSearch) {
        TVSearch.isOpen && TVSearch.isOpen() ? TVSearch.close() : TVSearch.open();
      }
    }).catch(function () {});

    listen('menu:command-palette', function () {
      if (window.TVPalette) {
        TVPalette.isOpen && TVPalette.isOpen() ? TVPalette.close() : TVPalette.open();
      }
    }).catch(function () {});

    listen('menu:toggle-sidebar', function () {
      toggleSidebar();
    }).catch(function () {});

    // BUG-3 FIX: single toggle replaces the two separate Light/Dark items.
    // Flips between light and dark; matches the "menu:theme-toggle" event emitted
    // by lib.rs on_menu_event.
    listen('menu:theme-toggle', function () {
      setTheme(state.theme === 'dark' ? 'light' : 'dark');
    }).catch(function () {});

    listen('menu:next-tab', function () {
      if (state.tabs.length > 1) {
        var ci = state.tabs.findIndex(function (t) { return t.id === state.activeId; });
        activateTab(state.tabs[(ci + 1) % state.tabs.length].id);
      }
    }).catch(function () {});

    listen('menu:prev-tab', function () {
      if (state.tabs.length > 1) {
        var ci2 = state.tabs.findIndex(function (t) { return t.id === state.activeId; });
        activateTab(state.tabs[(ci2 - 1 + state.tabs.length) % state.tabs.length].id);
      }
    }).catch(function () {});

    // INT-02: View menu zoom items
    listen('menu:zoom-in', function () { setFontSize(state.fontSize + 2); }).catch(function () {});
    listen('menu:zoom-out', function () { setFontSize(state.fontSize - 2); }).catch(function () {});
    listen('menu:zoom-reset', function () { setFontSize(16); }).catch(function () {});

    // F-22: Help menu → Keyboard Shortcuts overlay
    listen('menu:shortcuts', function () {
      openShortcuts();
    }).catch(function () {});
  }

  /* ────────────────────────────────────────────────────────────
     INIT — production boot sequence (E-02)
     S-05 fix: track first-opened (MRU index 0) tab and activate it last.
   ──────────────────────────────────────────────────────────── */
  function init() {
    // F-09: responsive sidebar default by window width (step-6 breakpoints).
    //   ≥1440px → sidebar visible by default
    //   <1440px → hidden by default
    // A ResizeObserver/resize listener keeps the default in sync until the user
    // makes an explicit toggle (sidebarUserToggled), after which their choice
    // wins and width changes no longer move the sidebar.
    state.sidebarOpen = window.innerWidth >= 1440;
    (function () {
      var resizeRaf = null;
      function applyResponsive() {
        if (state.sidebarUserToggled) return; // user choice wins
        var shouldOpen;
        if (window.innerWidth >= 1440) shouldOpen = true;
        else if (window.innerWidth < 1024) shouldOpen = false;
        else return; // 1024–1439: leave current state, don't fight the user
        if (shouldOpen !== state.sidebarOpen) {
          state.sidebarOpen = shouldOpen;
          if (state.tabs.length) render();
        }
      }
      window.addEventListener('resize', function () {
        if (resizeRaf) return;
        resizeRaf = requestAnimationFrame(function () {
          resizeRaf = null;
          applyResponsive();
        });
      }, { passive: true });
    }());

    // U-05: System theme auto-detection
    var savedTheme = localStorage.getItem('tv-theme');
    if (!savedTheme || savedTheme === 'system') {
      var prefersDark = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
      state.theme = prefersDark ? 'dark' : 'light';
      // Listen for OS theme changes
      if (window.matchMedia) {
        window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', function (e) {
          if (localStorage.getItem('tv-theme') === 'system' || !localStorage.getItem('tv-theme')) {
            state.theme = e.matches ? 'dark' : 'light';
            render();
          }
        });
      }
    }

    // Init file feature (drag-drop) first so drop works during async boot
    if (window.TVFiles && typeof TVFiles.init === 'function') {
      TVFiles.init();
    }

    // Wire native menu events (only effective under Tauri).
    // Run now if the DOM is already parsed (readyState 'interactive' or 'complete');
    // only defer when still 'loading'. The previous '=== complete' check could miss
    // the DOMContentLoaded that had already fired → menu bar never wired.
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', wireNativeMenuEvents);
    } else {
      wireNativeMenuEvents();
    }

    // Demo mode: open seed docs if ?demo=1 (tv-docs.js already gates the data)
    var seeds = window.TV_SEED || [];
    var liveDoc = window.TV_LIVE_DOC || null;

    if (seeds.length || liveDoc) {
      // ?demo=1 path — open seed docs, start live watch
      var firstId = null;
      seeds.forEach(function (doc, i) {
        var id = openDoc({
          name: doc.name,
          source: doc.source,
          path: doc.path || null,
          live: !!doc.live,
        });
        if (i === 0) firstId = id;
      });

      if (liveDoc) {
        openDoc({
          name: liveDoc.name,
          source: liveDoc.source,
          path: liveDoc.path || null,
          live: true,
        });
      }

      if (firstId) {
        state.activeId = firstId;
      } else if (state.tabs.length) {
        state.activeId = state.tabs[0].id;
      }

      render();

      if (window.TVLive && typeof TVLive.start === 'function') {
        state.tabs.forEach(function (t) {
          if (t.live) TVLive.start(t.id);
        });
      }
      return;
    }

    // U-13 / DR-47–DR-56: Two-key model.
    //   tv-session  — last session (tabs + scrollTop + activeNativePath); restore on launch.
    //   tv-recent-files — MRU display only; NEVER auto-opened on launch.
    // DR-49: empty/absent tv-session → show empty state (do NOT open from tv-recent-files).
    var sessionRaw = null;
    try { sessionRaw = localStorage.getItem('tv-session'); } catch (ex) {}
    var session = null;
    if (sessionRaw) {
      try { session = JSON.parse(sessionRaw); } catch (ex) {}
    }

    if (session && session.tabs && session.tabs.length && window.TVNative && TVNative.available) {
      // DR-48 / DR-54: restore session tabs sequentially; no "Restoring…" chrome.
      // DR-56: set sessionRestoring flag so Finder open-events queue until done.
      state.sessionRestoring = true;

      var sessionPending = session.tabs.slice(); // ordered array of {nativePath, scrollTop}
      var sessionActiveNativePath = session.activeNativePath || null;
      var sessionActiveId = null;  // resolved tab id for the formerly-active tab
      var sessionMissed = 0;       // DR-50: count files that couldn't be restored

      function readSessionNext() {
        if (!sessionPending.length) {
          // All session tabs processed — activate the formerly-active tab (DR-51)
          if (sessionActiveId) {
            state.activeId = sessionActiveId;
          } else if (state.tabs.length) {
            state.activeId = state.tabs[0].id;
          }
          render();

          // DR-50: single consolidated toast for missing files
          if (sessionMissed > 0 && window.TVNative && typeof TVNative.showToast === 'function') {
            var noun = sessionMissed === 1 ? 'file' : 'files';
            TVNative.showToast(sessionMissed + ' ' + noun + ' from last session were not found');
          }

          // DR-56: restore complete — clear flag and drain queued external opens
          state.sessionRestoring = false;
          _drainExternalOpenQueue();
          return;
        }

        var entry = sessionPending.shift();
        var ePath = entry.nativePath;
        var eScroll = entry.scrollTop || 0;

        window.__TAURI__.core.invoke('read_md_file', { path: ePath })
          .then(function (doc) {
            if (!doc || !doc.name) { sessionMissed++; readSessionNext(); return; }
            var parentDir = ePath.replace(/\/[^/]+$/, '') || '/';

            // Add tab to state WITHOUT calling activateTab (to avoid intermediate renders)
            var newTab = makeTab({
              name: doc.name,
              source: doc.content,
              path: parentDir,
            });
            newTab.nativePath = doc.path || ePath;
            // DR-48 / DR-53: apply saved scroll; render() will pick it up via [data-scroll]
            newTab.scrollTop = eScroll;
            state.tabs.push(newTab);

            // DR-55: update tv-recent-files entry with the saved scrollTop
            // saveRecentPath reads the tab's live scrollTop — pre-set it now so
            // the MRU entry carries the correct position even before the tab is rendered.
            saveRecentPath(newTab.nativePath);
            // Patch the just-saved entry's scrollTop to the session value
            (function (np, st) {
              try {
                var entries = loadRecentEntries();
                for (var ri = 0; ri < entries.length; ri++) {
                  if (entries[ri].path === np) { entries[ri].scrollTop = st; break; }
                }
                localStorage.setItem(RECENT_KEY, JSON.stringify(entries));
              } catch (ex2) {}
            }(newTab.nativePath, eScroll));

            // DR-51: track which restored tab should become active
            if (sessionActiveNativePath && newTab.nativePath === sessionActiveNativePath) {
              sessionActiveId = newTab.id;
            }

            readSessionNext();
          })
          .catch(function () {
            // DR-50: file missing or unreadable — skip silently, count it
            sessionMissed++;
            readSessionNext();
          });
      }

      readSessionNext();

    } else {
      // DR-49: no session (first launch, all tabs closed last session, or browser mode)
      // → show empty state. Do NOT auto-open from tv-recent-files.
      render();
    }
  }

  /* ────────────────────────────────────────────────────────────
     U-12: Reload active tab from disk
     Re-reads the file via the Tauri bridge and overwrites the in-memory
     content. No-op in plain-browser mode (no nativePath). Mirrors the
     existing recent-row reopen pattern (wireEvents click handler).
   ──────────────────────────────────────────────────────────── */
  function reloadActiveTab() {
    var tab = getActiveTab();
    if (!tab) return;

    // No native path → nothing to reload (browser mode or untitled tab)
    if (!tab.nativePath) {
      // Optionally surface a toast — but keep it silent since no native dialog
      // available in browser context for the "no path" case.
      return;
    }

    var path = tab.nativePath;
    var name = tab.name;

    function _doReload() {
      // U-12: invoke the same Tauri command used by the recent-row reopen handler
      window.__TAURI__.core.invoke('read_md_file', { path: path })
        .then(function (doc) {
          if (!doc) return;
          // Overwrite in-memory content; mark clean
          tab.source = doc.content || '';
          tab.dirty = false;
          render();
        })
        .catch(function (err) {
          console.warn('[TV] reloadActiveTab failed', path, err);
          var kind = (window.TVNative && typeof TVNative.classifyReadError === 'function')
            ? TVNative.classifyReadError(err) : 'not-found';
          openErrorTab(name, path, kind);
        });
    }

    // U-12: dirty-guard — follow the exact S-03 closeTab() pattern
    if (tab.dirty) {
      var msg = 'Reload "' + name + '" from disk and discard unsaved changes?';
      if (window.__TAURI__ && window.__TAURI__.dialog) {
        window.__TAURI__.dialog.ask(msg, { title: 'Reload from Disk', kind: 'warning' })
          .then(function (confirmed) { if (confirmed) _doReload(); })
          .catch(function () { if (window.confirm(msg)) _doReload(); });
      } else {
        if (window.confirm(msg)) _doReload();
      }
      return;
    }

    _doReload();
  }

  /* ────────────────────────────────────────────────────────────
     PUBLIC API
   ──────────────────────────────────────────────────────────── */
  window.TV = {
    state: state,
    render: render,
    openDoc: openDoc,
    openErrorTab: openErrorTab,
    openUntitledTab: openUntitledTab,
    activateTab: activateTab,
    closeTab: closeTab,
    getActiveTab: getActiveTab,
    setMode: setMode,
    setTheme: setTheme,
    setAccent: setAccent,
    setFontSize: setFontSize,
    toggleSidebar: toggleSidebar,
    scrollToHeading: scrollToHeading,
    markDirty: markDirty,
    reloadActiveTab: reloadActiveTab, // U-12: reload active tab from disk
    saveRecentPath: saveRecentPath,  // exposed so tv-native.js can call it on open
    loadRecentPaths: loadRecentPaths,
    openFolder: openFolder,
    on: tvOn,
    emit: tvEmit,
    el: tvEl,
    // F-05 / DR-24–DR-26: Mermaid toggle contract (Renderer engineer reads isMermaidEnabled)
    isMermaidEnabled: isMermaidEnabled,
    toggleMermaid: toggleMermaid,
    // DR-56: session restore queue (Native engineer's open-files handler calls this)
    enqueueExternalOpen: enqueueExternalOpen,
    // F-19: folder tree management — called by Native after readDirTree resolves
    registerFolder: registerFolder,
    closeFolder: closeFolder,
    // F-22/U-06: shortcut overlay — called by Native Help menu + palette
    openShortcuts: openShortcuts,
    closeShortcuts: closeShortcuts,
  };

  /* ── Boot when DOM is ready ───────────────────────────────── */
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

})();
