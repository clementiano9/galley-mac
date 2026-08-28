/* ───────────────────────────────────────────────────────────
   Galley · app spine
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

  /* ── C-05: middle-truncating file labels ─────────────────────
     macOS truncates filenames in the middle (Finder, the Dock, Xcode) so the
     extension and the distinguishing tail survive: twelve files called
     `2026-08-report-<n>.md` are told apart by their END, not their start.
     We render the label as two spans — a shrinking head and a fixed tail —
     and let CSS decide whether an ellipsis is needed, so a name that FITS
     shows no ellipsis at all. textContent is unchanged by the split, which is
     what the sidebar suites read. Never mutates tab.name. */
  var LBL_TAIL_MAX = 10;   // characters kept on the right, extension included
  var LBL_TAIL_MIN = 8;
  var LBL_MIN_SPLIT = 12;  // shorter than this and there is nothing to protect

  function splitLabel(name) {
    var s = String(name == null ? '' : name);
    if (s.length <= LBL_MIN_SPLIT) return { head: s, tail: '' };
    var tailLen = LBL_TAIL_MAX;
    var half = Math.floor(s.length / 2);
    if (tailLen > half) tailLen = Math.max(LBL_TAIL_MIN, half);
    if (tailLen >= s.length) tailLen = s.length - 1;
    return { head: s.slice(0, s.length - tailLen), tail: s.slice(s.length - tailLen) };
  }

  // Escaped inner HTML for one file label. Returns a plain escaped string when
  // the name is short enough that no middle truncation could ever apply.
  function labelHtml(name) {
    var parts = splitLabel(name);
    if (!parts.tail) return esc(parts.head);
    return '<span class="tv-lbl">' +
      '<span class="tv-lbl-head">' + esc(parts.head) + '</span>' +
      '<span class="tv-lbl-tail">' + esc(parts.tail) + '</span>' +
    '</span>';
  }

  // C-05: the hover tooltip that end-truncation used to make impossible.
  // Name on line one, full path underneath (native tooltips honour \n).
  function labelTitle(name, path) {
    var n = String(name == null ? '' : name);
    return path ? n + '\n' + String(path) : n;
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
    // F-19 / ISS-005: per-folder collapse state. Keys:
    //   <folderPath>                    → true = folder head collapsed
    //   <folderPath>/<sub>[/<deeper>…]  → true = nested subfolder collapsed
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
  // JANK-01: the row renderSidebarCursor() last scrolled to, so it only scrolls
  // when the cursor MOVES rather than on every render. Cleared whenever the
  // cursor is dismissed so re-entering keyboard nav scrolls to the cursor again.
  var _lastCursorScrollId = null;

  /* ── Tab constructor ──────────────────────────────────────── */
  function makeTab(opts) {
    return {
      id: opts.id || uid(),
      name: opts.name || 'untitled.md',
      path: opts.path || null,
      source: opts.source || '',
      // C-33: the last content known to be on disk — set on open, on a
      // successful save, on a reload, and (via _syncSavedSource) on any
      // live-watch update. Esc restores the buffer to this.
      savedSource: opts.source || '',
      // C-33: one level of undo for a discard: { source, at }. Cleared as soon
      // as it is restored or the tab is saved.
      discarded: null,
      scrollTop: 0,
      dirty: false,
      live: !!opts.live,
      // liveActive: drives the live "bolt" icon (tab strip + sidebar). Distinct
      // from `live` (= file is watched): the bolt only shows while the file is
      // recently active, mirroring the bottom status bar's recency rules — so a
      // static file opens with NO bolt. tv-live.js owns this flag.
      liveActive: false,
      // Browser-style new-tab page (⌘T) — no document, renders the NTP.
      untitled: !!opts.untitled,
      // SBH-03: transient = the single "preview" tab. A single click on a
      // sidebar tree file opens here and the next single click REPLACES it, so
      // browsing a folder never grows the strip past one tab. Double-clicking
      // the file or its tab pins it; so does editing. Pinned tabs persist.
      transient: !!opts.transient,
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
     RECENT — localStorage persistence (E-02)
     Stores absolute native paths (FILES and FOLDERS) with open
     timestamps; capped per-type so files/folders never evict each
     other. Canonical on-disk shape:
       [{ path:<abs>, ts:<epoch-ms>, type:'file'|'folder', scrollTop?:<num> }]
     ISS-FOLDER: type distinguishes recent files from recent folders;
     dedup keys on (path, type). Back-compat: legacy entries were bare
     path strings (string[]) OR typeless objects; loadRecentEntries()
     migrates them to {path, ts, type:'file'} in memory (no on-disk
     migration write). loadRecentPaths() returns a plain string[] of
     FILE paths only (folders excluded — those consumers read_md_file).
   ──────────────────────────────────────────────────────────── */
  var RECENT_KEY = 'tv-recent-files';
  var RECENT_MAX = 20; // DR-52: MRU capped at 20

  // Returns [{ path, ts, scrollTop?, type }] with legacy string entries migrated.
  // F-17: entries optionally carry scrollTop (number) for scroll persistence.
  // ISS-FOLDER: entries now carry type 'file'|'folder'. Legacy/missing type
  // defaults to 'file' (no migration write) so old stores keep working; the
  // type MUST be preserved on the object branch or recent folders silently
  // become files on the next load.
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
          // legacy string[] format — no timestamp/scroll/type recorded
          if (e) out.push({ path: e, ts: 0, scrollTop: 0, type: 'file' });
        } else if (e && typeof e === 'object' && e.path) {
          out.push({
            path: e.path,
            ts: (typeof e.ts === 'number' ? e.ts : 0),
            // F-17: pass through scrollTop if present; default to 0
            scrollTop: (typeof e.scrollTop === 'number' ? e.scrollTop : 0),
            // ISS-FOLDER: preserve type; back-compat default to 'file'
            type: (e.type === 'folder' ? 'folder' : 'file'),
          });
        }
      }
      return out;
    } catch (e) {
      return [];
    }
  }

  // Legacy/string accessor — derives plain FILE paths from the entries so
  // older call sites (tv-native bridge, the exported TV.loadRecentPaths) keep
  // functioning. ISS-FOLDER: folder entries are excluded — these consumers
  // open paths as files via read_md_file, which would fail on a directory.
  function loadRecentPaths() {
    return loadRecentEntries()
      .filter(function (e) { return e.type !== 'folder'; })
      .map(function (e) { return e.path; });
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
    // Dedupe by (path, type): drop any existing FILE entry for this path
    // (keeps move-to-front). A folder entry at the same path is independent
    // and must survive — folders and files never evict each other.
    list = list.filter(function (e) {
      return !(e.path === absolutePath && e.type !== 'folder');
    });
    // Prepend with a fresh timestamp, scroll offset, type, and cap
    list.unshift({ path: absolutePath, ts: Date.now(), scrollTop: savedScrollTop, type: 'file' });
    list = capRecent(list);
    try {
      localStorage.setItem(RECENT_KEY, JSON.stringify(list));
    } catch (e) { /* storage full or private mode — ignore */ }
  }

  // ISS-FOLDER: record an opened/closed FOLDER in Recent. Folders carry no
  // scrollTop. Deduped by (path, type) so a folder never evicts the file entry
  // at the same path (and vice-versa). Caps each type independently so a burst
  // of one kind can't crowd the other out of the on-disk store.
  function saveRecentFolder(absolutePath) {
    if (!absolutePath) return;
    var list = loadRecentEntries();
    list = list.filter(function (e) {
      return !(e.path === absolutePath && e.type === 'folder');
    });
    list.unshift({ path: absolutePath, ts: Date.now(), type: 'folder' });
    list = capRecent(list);
    try {
      localStorage.setItem(RECENT_KEY, JSON.stringify(list));
    } catch (e) { /* storage full or private mode — ignore */ }
  }

  // Cap the recent store per type so files and folders never evict one another.
  // Preserves MRU order within each type. Returns a fresh, re-interleaved list
  // (original relative order is irrelevant on disk — render() re-sorts/caps).
  function capRecent(list) {
    var files = [], folders = [];
    for (var i = 0; i < list.length; i++) {
      var e = list[i];
      if (e.type === 'folder') { if (folders.length < RECENT_MAX) folders.push(e); }
      else { if (files.length < RECENT_MAX) files.push(e); }
    }
    return files.concat(folders);
  }

  // ISS-FOLDER: drop a single Recent entry by (path, type). Used when a recent
  // folder is reopened (success → remove) or found dead (read failed → remove).
  // type defaults to 'folder' since that is the only current caller.
  function removeRecentEntry(absolutePath, type) {
    if (!absolutePath) return;
    type = type || 'folder';
    var list = loadRecentEntries().filter(function (e) {
      return !(e.path === absolutePath && (e.type || 'file') === type);
    });
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

  /* ── C-32: one persistent polite live region ────────────────── */
  // WCAG 4.1.3: a live region has to EXIST before text lands in it — a node
  // created at message time is unreliably announced, so this one is created
  // at boot instead, and is the ONLY polite live region in the app (P2-6:
  // tv-native.js's showToast() calls TV.announce() rather than owning a
  // second one inside #tv-toasts — two independent aria-live regions could
  // both fire on the same turn, which is confusing for a screen reader
  // even though in practice they rarely disagreed).
  var _liveRegion = null;

  function ensureLiveRegion() {
    if (_liveRegion && _liveRegion.parentNode) return _liveRegion;
    _liveRegion = document.getElementById('tv-live-region');
    if (!_liveRegion) {
      _liveRegion = document.createElement('div');
      _liveRegion.id = 'tv-live-region';
      _liveRegion.className = 'tv-visually-hidden';
      _liveRegion.setAttribute('aria-live', 'polite');
      _liveRegion.setAttribute('aria-atomic', 'true');
      document.body.appendChild(_liveRegion);
    }
    return _liveRegion;
  }

  function announce(msg) {
    if (!msg) return;
    var host = ensureLiveRegion();
    // Re-announce identical text: clear first, or assistive tech treats the
    // unchanged node as nothing new.
    if (host.textContent === msg) host.textContent = '';
    host.textContent = msg;
  }

  /* ── C-19: the "⌘E to edit" hint is onboarding, not chrome ──── */
  // DR-07 wants chrome invisible at rest, and a permanent label parked in the
  // viewer's dead left gutter is the opposite. It teaches something you learn
  // once, so it is shown for the first few sessions and then never again.
  var HINT_EDIT_SESSIONS = 5;
  var _editHintSession = 1;

  function _bumpEditHintSession() {
    try {
      var n = parseInt(localStorage.getItem('tv-hint-edit-seen') || '0', 10);
      if (!(n >= 0)) n = 0;
      n += 1;
      localStorage.setItem('tv-hint-edit-seen', String(n));
      _editHintSession = n;
    } catch (e) {
      _editHintSession = 1; // private mode / storage disabled: show it
    }
  }

  function _showEditHint() {
    return _editHintSession <= HINT_EDIT_SESSIONS;
  }

  /* ── C-38: window + in-app title ───────────────────────────── */
  // The in-app .tv-wintitle label. Editing supersedes Edited — you are looking
  // at the unsaved buffer either way, and stacking both reads as a stutter.
  // Middle dot, never a dash.
  function _winTitleLabel() {
    var t = getActiveTab();
    if (!state.tabs.length || !t) return 'Galley';
    var name = t.name || 'Untitled';
    if (state.mode === 'edit') return name + ' · Editing';
    if (t.dirty) return name + ' · Edited';
    return name;
  }

  // Keeps document.title (Window menu, ⌘-Tab switcher, Mission Control) and
  // the in-app title in step. Called from render() AND from markDirty(), which
  // deliberately skips render() and would otherwise leave both stale.
  function _syncTitles() {
    var t = getActiveTab();
    document.title = (state.tabs.length && t)
      ? (t.name || 'Untitled') + (t.dirty ? ' · Edited' : '') + ' · Galley'
      : 'Galley';
    var winEl = document.querySelector('.tv-wintitle');
    if (!winEl) return;
    // .tv-wintitle is <span class="tv-doc-ic">…</span> followed by a text node.
    var last = winEl.lastChild;
    if (last && last.nodeType === 3) last.nodeValue = _winTitleLabel();
  }

  // C-33: keep the edit toolbar's exit button truthful without a full render.
  // markDirty() is deliberately render-free (S-01), so the label has to be
  // patched in place or it stays at whatever the last repaint left.
  function _syncEditEscLabel() {
    if (state.mode !== 'edit') return;
    var btn = document.querySelector('[data-edit-esc]');
    if (!btn) return;
    var t = getActiveTab();
    var dirty = !!(t && t.dirty);
    btn.classList.toggle('danger', dirty);
    var last = btn.lastChild; // '<span class="kbd">esc</span>' + ' Discard'
    if (last && last.nodeType === 3) last.nodeValue = ' ' + (dirty ? 'Discard' : 'Done');
  }

  function buildTitlebar() {
    var tab = getActiveTab();
    var title = _winTitleLabel();
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
      // C-39: ONE place decides what the tab's lead slot shows, with an
      // explicit precedence — error beats live beats dirty. An error tab has
      // no content to watch and nothing savable, so the ⚠ is never ambiguous.
      // tv-live.js still owns t.liveActive (setBoltActive); this only reads it.
      var lead = '';
      if (t.error) {
        lead = '<span class="tv-tab-warn" aria-hidden="true">&#9888;</span>';
      } else if (t.liveActive && t.dirty) {
        // F-13: show both indicators when live+dirty (bolt gated on liveActive)
        lead = '<span class="tv-bolt">' + (icons.bolt || '') + '</span>' +
               '<span class="tv-dot"></span>';
      } else if (t.liveActive) {
        lead = '<span class="tv-bolt">' + (icons.bolt || '') + '</span>';
      } else if (t.dirty) {
        lead = '<span class="tv-dot"></span>';
      }
      var isActive = t.id === state.activeId;
      // SBH-03: the transient (preview) tab renders italic — the standing cue
      // that it is not kept and the next single click will replace it.
      var cls = 'tv-tab' + (isActive ? ' active' : '') + (t.transient ? ' transient' : '');
      return (
        '<div class="' + cls + '"' +
          ' role="tab"' +
          ' aria-selected="' + (isActive ? 'true' : 'false') + '"' +
          ' aria-controls="tv-viewer-panel"' +
          // P2-11: .tv-lbl-head/.tv-lbl-tail (inside .name below) are
          // inline-flex, which blockifies them — the accname algorithm then
          // inserts a space between block-level parts, so the tab's computed
          // accessible name could gain a stray space mid-filename. An
          // explicit aria-label wins over content-derived naming, so this
          // stays correct regardless of how .tv-lbl's layout evolves.
          ' aria-label="' + esc(t.name) + '"' +
          ' tabindex="' + (isActive ? '0' : '-1') + '"' +
          // C-05: name over full path, so same-prefix files are tellable apart.
          ' title="' + esc(labelTitle(t.name, t.nativePath || t.path)) + '"' +
          ' data-tab-id="' + esc(t.id) + '">' +
          lead +
          '<span class="name">' + labelHtml(t.name) + '</span>' +
          // C-32: a real <button>, not a span with role="button" — natively
          // focusable, so Enter/Space work without a hand-rolled handler.
          // tabindex="-1" keeps it OUT of the global Tab order (one stop per
          // open tab would drown the sequence); it is reached from its own tab
          // with Delete/Backspace, and ⌘W still closes the active one.
          '<button type="button" class="tv-close"' +
            ' aria-label="Close ' + esc(t.name) + '"' +
            ' data-close-tab="' + esc(t.id) + '"' +
            ' tabindex="-1"' +
            ' title="Close">' +
            (icons.close || '') +
          '</button>' +
        '</div>'
      );
    }).join('');

    // UX-SBR (edge-sidebar): the reveal toggle lives in the tab strip ONLY while
    // the sidebar is collapsed — a neutral re-entry affordance so a hidden sidebar
    // is never a dead-end. When the sidebar is OPEN the collapse control recedes
    // into the sidebar FILES header (the « button), keeping the chrome minimal.
    // Reuses the global [data-sidebar-toggle] handler (same path as ⌘B).
    var sideToggle = '';
    if (!state.sidebarOpen) {
      var sideTitle = 'Show sidebar (⌘B)';
      sideToggle =
        '<button class="tv-side-toggle" data-sidebar-toggle' +
          ' title="' + sideTitle + '" aria-label="' + sideTitle + '"' +
          ' aria-pressed="false" type="button">' +
          (icons.sidebar || '') +
        '</button>';
    }

    // L-03: tabs live in a scrolling .tv-tab-strip; .tv-newtab is a SIBLING
    // (outside the strip) so the "+" stays opaque + clickable when tabs overflow.
    // C-06: overflow list. Rendered ALWAYS but `hidden` until the strip
    // actually overflows (updateTabStripScroll owns the toggle), so a strip
    // that fits spends zero pixels. Sibling of the strip, like .tv-newtab.
    var overflowBtn = (
      '<button class="tv-tab-overflow" data-tab-overflow hidden type="button"' +
        ' title="All open tabs" aria-label="All open tabs" aria-haspopup="menu">' +
        '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor"' +
          ' stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
          '<polyline points="6 9 12 15 18 9"/></svg>' +
      '</button>'
    );

    return (
      '<div class="tv-tabbar" role="tablist">' +
        sideToggle +
        '<div class="tv-tab-strip">' + tabs + '</div>' +
        overflowBtn +
        '<button class="tv-newtab" data-newtab title="New tab (⌘T)" aria-label="New tab (⌘T)" type="button">' +
          (icons.plus || '') +
        '</button>' +
      '</div>'
    );
  }

  /* ── C-06: all-open-tabs overflow list ─────────────────────── */
  // A scrolling tab strip hides tabs with no pointer-reachable way back to
  // them. Reuses the context-menu shell so it inherits its surface, dismissal
  // and clamping behaviour rather than inventing a second popover.
  var _tabOverflowEl = null;
  var _tabOverflowAnchor = null;   // C-06: kept so a per-row close can re-open the list

  function _tabOverflowEsc(e) {
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); closeTabOverflow(); }
  }

  function closeTabOverflow() {
    document.removeEventListener('keydown', _tabOverflowEsc, true);
    if (_tabOverflowEl && _tabOverflowEl.parentNode) {
      _tabOverflowEl.parentNode.removeChild(_tabOverflowEl);
    }
    _tabOverflowEl = null;
  }

  function openTabOverflow(anchorEl) {
    closeTabOverflow();
    _tabOverflowAnchor = anchorEl || null;
    closeTabCtx();
    closeFolderCtx();
    var tvRoot = document.querySelector('.tv');
    if (!tvRoot || !state.tabs.length) return;
    var icons = window.TV_ICONS || {};

    var rows = state.tabs.map(function (t) {
      var isActive = t.id === state.activeId;
      var lead = t.liveActive
        ? '<span class="ic tv-tof-live">' + (icons.bolt || '') + '</span>'
        : (t.dirty ? '<span class="ic tv-tof-dot">&#9679;</span>' : '<span class="ic"></span>');
      // C-06 (round 2): each row carries its own close control, so the list is
      // a way to CLOSE files as well as jump to them.
      return (
        '<div class="tv-ctx-item tv-tof-row' + (isActive ? ' tv-tof-active' : '') + '"' +
          ' data-overflow-tab="' + esc(t.id) + '"' +
          ' title="' + esc(labelTitle(t.name, t.nativePath || t.path)) + '">' +
          lead +
          '<span class="tv-tof-name">' + esc(t.name) + '</span>' +
          '<button type="button" class="tv-tof-close" data-overflow-close="' + esc(t.id) + '"' +
            ' aria-label="Close ' + esc(t.name) + '" tabindex="-1">&#10005;</button>' +
        '</div>'
      );
    }).join('');

    var wrapper = document.createElement('div');
    wrapper.innerHTML =
      '<div class="tv-ctx-scrim" data-ctx-scrim>' +
        '<div class="tv-ctx tv-tab-overflow-menu" data-ctx-menu role="menu"' +
          ' aria-label="All open tabs">' + rows + '</div>' +
      '</div>';
    _tabOverflowEl = wrapper.firstChild;
    tvRoot.appendChild(_tabOverflowEl);

    // Anchor under the ⌄ button, right-aligned, clamped to the window.
    // CSP: position via CSSOM, never a style="" attribute (WKWebView drops it).
    var menuEl = _tabOverflowEl.querySelector('[data-ctx-menu]');
    if (menuEl && anchorEl && anchorEl.getBoundingClientRect) {
      var r = anchorEl.getBoundingClientRect();
      var mw = menuEl.offsetWidth || 220;
      var mh = menuEl.offsetHeight || 240;
      var cx = Math.max(4, Math.min(r.right - mw, window.innerWidth - mw - 4));
      var cy = Math.min(r.bottom + 4, Math.max(4, window.innerHeight - mh - 4));
      menuEl.style.left = cx + 'px';
      menuEl.style.top = cy + 'px';
    }

    _tabOverflowEl.addEventListener('mousedown', function (e) {
      if (!e.target.closest('[data-ctx-menu]')) closeTabOverflow();
    });
    _tabOverflowEl.addEventListener('click', function (e) {
      // C-06 (round 2): the per-row ✕ closes that file. Checked BEFORE the row
      // handler so closing never also activates the tab it just removed.
      var closeBtn = e.target.closest('[data-overflow-close]');
      if (closeBtn) {
        e.stopPropagation();
        var closeId = closeBtn.getAttribute('data-overflow-close');
        closeTabOverflow();
        closeTab(closeId);
        // Re-open so several files can be closed in a row. The anchor node we
        // opened with is gone — closeTab re-renders the whole tab bar — so
        // re-query the live control, which only exists while the strip still
        // overflows. When it does not, staying closed is the right answer.
        var freshAnchor = document.querySelector('.tv-tab-overflow');
        if (freshAnchor && state.tabs.length > 1) openTabOverflow(freshAnchor);
        return;
      }
      var row = e.target.closest('[data-overflow-tab]');
      if (!row) return;
      var id = row.getAttribute('data-overflow-tab');
      closeTabOverflow();
      activateTab(id);
    });
    document.addEventListener('keydown', _tabOverflowEsc, true);
  }

  /* ── C-04/C-06: tab-strip scroll state ─────────────────────── */
  // Publishes the strip's scroll position as data attributes so tv-app.css can
  // fade whichever edge still hides a tab, and so the overflow control (C-06)
  // knows whether it has anything to show. Cheap: two reads, no layout write.
  //   data-scrolled   → something is clipped on the LEFT
  //   data-scroll-end → nothing is clipped on the RIGHT (also true when the
  //                     strip does not overflow at all, which is what we want:
  //                     no fade on a strip that fits)
  //   data-overflow   → the strip is wider than its box (drives the ⌄ button)
  // C-04 (round 4): the ⌄ button's visibility, split out so render() can settle
  // it BEFORE it restores the strip's scrollLeft. The button is ~24px wide, so
  // flipping it changes .tv-tab-strip's clientWidth — and both the scroll
  // restore's clamp and the active-pill flush measure against that width. Left
  // inside updateTabStripScroll it ran AFTER both, which meant they did their
  // arithmetic against a strip 24px wider than the one the user ends up
  // looking at. The verdict itself reads scrollWidth/clientWidth only, never
  // scrollLeft, and shrinking the box can only keep an overflowing strip
  // overflowing — so deciding it early is stable and cannot oscillate.
  // Returns the verdict so updateTabStripScroll does not recompute it.
  function syncTabOverflowBtn(strip) {
    if (!strip) return false;
    var over = strip.scrollWidth > strip.clientWidth + 1;
    // The ⌄ overflow button is zero chrome when nothing overflows.
    var tabbar = strip.parentNode;
    var moreBtn = tabbar && tabbar.querySelector && tabbar.querySelector('[data-tab-overflow]');
    if (moreBtn) moreBtn.hidden = !over;
    return over;
  }

  function updateTabStripScroll(rootEl) {
    var strip = (rootEl || document).querySelector('.tv-tab-strip');
    if (!strip) return;
    // Settle the button first, then publish the attributes from the geometry
    // that results — otherwise data-scroll-end is decided against a clientWidth
    // the strip is about to lose.
    var over = syncTabOverflowBtn(strip);
    if (strip.scrollLeft > 0) strip.setAttribute('data-scrolled', '1');
    else strip.removeAttribute('data-scrolled');
    if (strip.scrollLeft + strip.clientWidth >= strip.scrollWidth - 1) {
      strip.setAttribute('data-scroll-end', '1');
    } else {
      strip.removeAttribute('data-scroll-end');
    }
    if (over) strip.setAttribute('data-overflow', '1');
    else strip.removeAttribute('data-overflow');
  }

  /* ── F-19 helpers ──────────────────────────────────────────── */
  // Basename of an absolute path: "/a/b/c" → "c"
  function pathBasename(p) {
    return String(p).replace(/\/+$/, '').split('/').pop() || p;
  }

  /* ── SBH-02: one root per tree (Sidebar hierarchy · Fix 2) ────
     The containment DECISION is pure and lives in window.TVTree
     (planFolderOpen / chainKeysTo, unit-tested in tv-sidebar-hierarchy.test.js);
     this file only executes the plan against state + the DOM. */

  // Clear the collapse flags along the chain from an open root down to one of
  // its descendant folders, so revealing that folder actually shows its row.
  // `chain` comes from TVTree.chainKeysTo — keys identical to the ones
  // buildTreeNodes emits. The root head is separately namespaced
  // ('root:' + the tree's raw path); the bare path is cleared too, for safety.
  function expandAncestorsTo(rootTreePath, chain) {
    delete state.folderCollapsed['root:' + rootTreePath];
    delete state.folderCollapsed[rootTreePath];
    (chain || []).forEach(function (key) { delete state.folderCollapsed[key]; });
  }

  // Render, then scroll the named sidebar row into view and flash it once so
  // the eye lands on the folder that was revealed rather than mounted. The
  // message is also spoken via a toast — the flash alone never carries the
  // information (URD-10 / DR-10). `itemKey` is a data-sidebar-item value.
  function revealSidebarRow(itemKey, message) {
    render();
    if (message && window.TVNative && typeof TVNative.showToast === 'function') {
      TVNative.showToast(message);
    }
    var raf = window.requestAnimationFrame || function (fn) { return setTimeout(fn, 16); };
    raf(function () {
      var rows = document.querySelectorAll('.tv-sidebar [data-sidebar-item]');
      var el = null;
      for (var i = 0; i < rows.length; i++) {
        if (rows[i].getAttribute('data-sidebar-item') === itemKey) { el = rows[i]; break; }
      }
      if (!el) return;
      if (typeof el.scrollIntoView === 'function') el.scrollIntoView({ block: 'nearest' });
      el.classList.add('tv-flash');
      setTimeout(function () { el.classList.remove('tv-flash'); }, 1500);
    });
  }

  // Register (add or replace) a folder tree object in state.openFolders.
  // [YOU expose] as TV.registerFolder — called by Native's openFolder flow
  // after Native.readDirTree resolves.
  //
  // SBH-02: a folder is mounted ONCE. Opening one that already lives inside an
  // open tree reveals it there instead of adding a second root, so the same
  // path can never appear twice:
  //   1. Descendant of an open root — do not mount. Expand the ancestors down
  //      to it, scroll it into view, flash it, and report where it lives.
  //   2. Ancestor of open roots — mount it and fold those roots into it, where
  //      they now appear as children.
  //   3. Unrelated — mount as a new root section. Appended last; buildSidebar
  //      renders the list reversed, so the most recent shows first.
  function registerFolder(tree) {
    if (!tree || !tree.path) return;
    var TVTree = window.TVTree;

    // Without TVTree there is no containment logic to apply — fall back to the
    // plain de-dup-and-append so a missing module degrades rather than throws.
    if (!TVTree || typeof TVTree.planFolderOpen !== 'function') {
      state.openFolders = state.openFolders.filter(function (f) { return f.path !== tree.path; });
      state.openFolders.push(tree);
      render();
      return;
    }

    var openPaths = state.openFolders.map(function (f) { return f.path; });
    var plan = TVTree.planFolderOpen(openPaths, tree.path);
    var name = pathBasename(TVTree.normFolderPath(tree.path));

    // Already mounted as a root: refresh the tree object IN PLACE (disk
    // contents may have changed) so it keeps its slot in the MRU order, then
    // reveal it rather than stacking a duplicate section.
    if (plan.action === 'refresh') {
      for (var i = 0; i < state.openFolders.length; i++) {
        if (state.openFolders[i].path === plan.rootPath) { state.openFolders[i] = tree; break; }
      }
      delete state.folderCollapsed['root:' + plan.rootPath];
      revealSidebarRow('folder:' + tree.path, name + ' is already open');
      return;
    }

    // Case 1 — descendant of an open root: reveal in place, never a 2nd root.
    if (plan.action === 'reveal') {
      expandAncestorsTo(plan.rootPath, plan.chain);
      revealSidebarRow(
        'subfolder:' + plan.chain[plan.chain.length - 1],
        name + ' is already in ' + pathBasename(TVTree.normFolderPath(plan.rootPath))
      );
      return;
    }

    // Case 2 — ancestor of open roots: fold those roots in as children.
    // Their SUBFOLDER collapse keys stay valid (full paths, unchanged under the
    // new root), so each one's expand/collapse state survives the fold-in. Only
    // the namespaced head keys are now meaningless — drop those so a folder
    // never reappears pre-collapsed if it is later opened as a root again.
    var absorbed = plan.absorbed || [];
    if (absorbed.length) {
      state.openFolders = state.openFolders.filter(function (f) {
        return absorbed.indexOf(f.path) === -1;
      });
      absorbed.forEach(function (p) { delete state.folderCollapsed['root:' + p]; });
    }

    // Case 3 (and the tail of case 2) — mount as a root section.
    state.openFolders.push(tree);
    render();
    if (absorbed.length && window.TVNative && typeof TVNative.showToast === 'function') {
      TVNative.showToast(
        name + ' opened — ' +
        absorbed.map(function (p) { return pathBasename(TVTree.normFolderPath(p)); }).join(', ') +
        ' folded in'
      );
    }
  }

  // Close a folder by path. ISS-FOLDER (chosen behavior): closing a folder
  // closes ALL of that folder's open files too (so they never re-group as a
  // muted phantom section), records the folder in Recent, and removes the tree.
  //
  // CRITICAL ORDERING: the dirty confirm is async and runs FIRST; ALL mutation
  // (tab close, folder removal, prune, unwatch, recent, render) happens ONLY
  // after it resolves — never synchronously before, or state desyncs from the
  // dialog outcome. Exactly ONE batched dialog is shown, never one per tab.
  /* ── C-29: re-scan a truncated folder without the cap ───────── */
  // Deliberately NOT registerFolder(): its refresh branch fires
  // revealSidebarRow('… is already open'), which is a misleading toast here and
  // yanks the keyboard cursor. Swapping the tree object in its existing slot
  // gives exactly what the item asks for — same root, same MRU position,
  // state.folderCollapsed untouched (so every expansion survives) and sbKbd.id
  // untouched (so the cursor stays where the user left it).
  function loadMoreFolder(path) {
    if (!path) return;
    state.folderMoreLoading = state.folderMoreLoading || {};
    if (state.folderMoreLoading[path]) return; // already in flight
    if (!(window.TVNative && typeof TVNative.readDirTree === 'function')) return;

    state.folderMoreLoading[path] = true;
    render();

    function done() {
      delete state.folderMoreLoading[path];
    }

    TVNative.readDirTree(path, { uncapped: true }).then(function (tree) {
      done();
      if (tree && tree.path) {
        var replaced = false;
        for (var i = 0; i < state.openFolders.length; i++) {
          if (state.openFolders[i].path === tree.path) {
            state.openFolders[i] = tree;
            replaced = true;
            break;
          }
        }
        // The folder was closed while the scan was running — do not re-mount it.
        if (!replaced) { render(); return; }
      }
      render();
      // C-32: the row the user activated has just vanished from the list; say
      // what happened, since nothing else does.
      announce(pathBasename(path) + ' fully loaded');
    }).catch(function (err) {
      done();
      render();
      console.warn('[Galley] C-29 uncapped folder scan failed', path, err);
      if (window.TVNative && typeof TVNative.showToast === 'function') {
        TVNative.showToast('Could not load the rest of this folder', { kind: 'error' });
      }
    });
  }

  function closeFolder(path) {
    if (!path) return;

    // 1) Collect the folder's tabs to close: EXACT tree-file membership UNION
    //    open files under the root (covers files beyond the native scan cap that
    //    the tree never lists). Deduped by tab id.
    var folderTree = null;
    for (var fi = 0; fi < state.openFolders.length; fi++) {
      if (state.openFolders[fi].path === path) { folderTree = state.openFolders[fi]; break; }
    }
    var treeFiles = {};
    if (folderTree && window.TVTree && typeof TVTree.collectTreeFilePaths === 'function') {
      TVTree.collectTreeFilePaths(folderTree).forEach(function (p) { treeFiles[p] = true; });
    }
    var prefix = path.replace(/\/+$/, '') + '/';
    var collected = [];
    var seenIds = {};
    state.tabs.forEach(function (t) {
      var np = t.nativePath;
      if (!np) return;
      var inTree = !!treeFiles[np];
      var underRoot = (np === path) || (np.indexOf(prefix) === 0);
      if ((inTree || underRoot) && !seenIds[t.id]) {
        seenIds[t.id] = true;
        collected.push(t);
      }
    });

    var anyDirty = collected.some(function (t) { return t.dirty; });

    // 2) Dirty check → ONE batched confirm. Cancel aborts the ENTIRE close.
    function proceed() {
      // 3) Close every collected tab via the SILENT inner close (skips the
      //    per-tab dirty dialog). Recompute idx per id (splice shifts indices).
      collected.forEach(function (t) {
        var nativePath = t.nativePath;
        var idx = state.tabs.findIndex(function (x) { return x.id === t.id; });
        if (idx === -1) return; // already gone
        // Explicitly release the native per-file watch. _doCloseTab → TVLive.stop
        // only unwatches when a live watchState exists; if the watch was started
        // but never tracked (or already stopped) that early-returns, so call
        // stopWatch directly to avoid a Rust FSEvents watcher leak.
        if (nativePath && window.TVNative && typeof TVNative.stopWatch === 'function') {
          TVNative.stopWatch({ nativePath: nativePath });
        }
        _doCloseTab(t.id, idx);
      });

      // 4) Remove the folder + collapse keys, stop the root watch, record it in
      //    Recent, clear any open folder context menu, and render ONCE.
      state.openFolders = state.openFolders.filter(function (f) { return f.path !== path; });
      state.folderCollapsed = window.TVTree
        ? window.TVTree.pruneCollapsed(state.folderCollapsed, path)
        : state.folderCollapsed;
      if (window.TVNative && typeof TVNative.unwatchFolder === 'function') {
        TVNative.unwatchFolder(path);
      }
      saveRecentFolder(path);
      state.folderCtx = null;
      render();
    }

    if (anyDirty) {
      var n = collected.filter(function (t) { return t.dirty; }).length;
      var msg = 'You have unsaved changes in ' + n + ' file' + (n === 1 ? '' : 's') +
        '. Close them anyway?';
      if (window.__TAURI__ && window.__TAURI__.dialog && typeof window.__TAURI__.dialog.ask === 'function') {
        window.__TAURI__.dialog.ask(msg, { title: 'Unsaved Changes', kind: 'warning' })
          .then(function (confirmed) { if (confirmed) proceed(); })
          .catch(function () { if (window.confirm(msg)) proceed(); });
      } else if (typeof window.confirm === 'function') {
        if (window.confirm(msg)) proceed();
      } else {
        proceed();
      }
      return; // mutation deferred until the dialog resolves
    }

    proceed();
  }

  // Toggle the collapse state for a key (folder root path or a nested subfolder key)
  function toggleFolderCollapse(key) {
    state.folderCollapsed[key] = !state.folderCollapsed[key];
    render();
  }

  // DR-108: stable DOM id from a sidebar-item key string (no crypto needed).
  // Replaces non-word chars with '_', prepends 'sbitem-', truncates to 48 chars.
  function sbItemId(key) {
    // ids must be unique (aria-activedescendant resolves to the first DOM match),
    // so append a djb2 hash of the full key — truncating the slug alone collides
    // for files whose sanitized path prefix matches in the first N chars.
    var s = String(key);
    var h = 5381;
    for (var i = 0; i < s.length; i++) { h = ((h << 5) + h + s.charCodeAt(i)) | 0; }
    return 'sbitem-' + s.replace(/[^\w-]/g, '_').slice(0, 40) + '-' + (h >>> 0).toString(36);
  }

  /* ── SBH-01: tree indent geometry (Sidebar hierarchy · Fix 1) ──
     Depth is a NUMBER, not a boolean. The geometry itself lives in
     TVTree.treeIndent (pure + unit-tested); this thin wrapper keeps the
     renderer working if tv-tree.js ever fails to load. The matching guide
     rails are drawn in CSS off the --tv-depth custom property each row
     carries — see the SBH-01 block in css/tv-app.css. */
  function treeIndent(depth, isFolder) {
    if (window.TVTree && typeof TVTree.treeIndent === 'function') {
      return TVTree.treeIndent(depth, isFolder);
    }
    return 8 + (depth || 0) * 14 + (isFolder ? 0 : 16);
  }

  // SBH-01 (QA D1): apply per-row tree geometry through the CSSOM.
  //
  // The renderer builds the sidebar as an innerHTML string, and a style=""
  // attribute inside that string does NOT take effect in WKWebView — the native
  // build silently fell back to the stylesheet defaults, so EVERY file row sat
  // at 26px and every subfolder at 22px (a flat tree), and the depth rail
  // resolved against the `var(--tv-depth, 1)` fallback so only one rail drew.
  // Setting the same properties on the live element works natively — the
  // sidebar-width line above relies on exactly that.
  //
  // Runs synchronously after innerHTML and before paint, so there is no flash
  // of un-indented rows. Rows carry data-tv-depth / data-tv-kind.
  function applyTreeDepths(root) {
    if (!root || typeof root.querySelectorAll !== 'function') return;
    var rows = root.querySelectorAll('[data-tv-depth]');
    for (var i = 0; i < rows.length; i++) {
      var el = rows[i];
      var depth = parseInt(el.getAttribute('data-tv-depth'), 10);
      if (isNaN(depth)) continue;
      var isFolder = el.getAttribute('data-tv-kind') === 'folder';
      el.style.setProperty('--tv-depth', String(depth));
      el.style.paddingLeft = treeIndent(depth, isFolder) + 'px';
    }
  }

  /* ── JANK-01/02: render coalescing + sidebar scroll preservation ──
     Selecting a file used to run render() up to THREE times for one click:
     dropTransientTab → _doCloseTab → render, then openDoc → activateTab →
     render, then TVNative.openInto → render. Each one replaces #tv-root's
     entire innerHTML (chrome + tab strip + sidebar + the whole rendered
     markdown), so a single click cost three full teardowns and three layout
     passes — the visible stutter, and three chances for the sidebar to flash
     an intermediate state (see the QA D4 note in tv-native.js).

     batchRender(fn) makes that ONE render. It is deliberately SYNCHRONOUS —
     by the time it returns the DOM is already up to date — because callers
     all over this file read the DOM straight after render(). Nothing is
     deferred to a microtask or rAF, so no existing ordering assumption moves.

     The one exception is code that reads the DOM *between* two batched
     renders: inside a batch that DOM is still the pre-render one. There is
     exactly one such caller (_doActivateTab scrolling the active tab pill
     into view); it now latches _pendingTabScrollId and render() flushes it. */
  var _renderSuspend = 0;
  var _renderQueued = false;
  var _pendingTabScrollId = null;

  function batchRender(fn) {
    _renderSuspend++;
    try {
      return fn();
    } finally {
      _renderSuspend--;
      // Never let a throw inside fn strand the shell in a suspended state:
      // the decrement and the flush both live in finally.
      if (_renderSuspend <= 0) {
        _renderSuspend = 0;
        if (_renderQueued) {
          _renderQueued = false;
          render();
        }
      }
    }
  }

  // JANK-02: true while the live DOM still matches state — i.e. no render() has
  // been deferred since the batch opened.
  //
  // Two places read a scroll offset back OUT of the DOM (_doActivateTab saving
  // the outgoing tab, saveSession capturing a mid-scroll position) and both
  // assume the DOM shows the tab that state says is active. Inside a batch that
  // stops being true the moment something defers a render: _doCloseTab moves
  // state.activeId to a neighbour while .tv-scroll still holds the closed tab's
  // content, so an unguarded read stamps the wrong document's offset onto the
  // wrong tab and breaks per-tab scroll (DR-03).
  //
  // Note this is _renderQueued, NOT _renderSuspend. Merely being inside a batch
  // is harmless — the DOM is still current until the first deferred render, and
  // that first window is exactly where the legitimate "save the outgoing tab's
  // live scroll" read happens.
  function domMatchesState() {
    return !_renderQueued;
  }

  // JANK-01: the sidebar's own scroll offset. render() replaces the whole DOM,
  // so .tv-side-scroll was recreated at scrollTop 0 every time — scroll the file
  // list down, click a file, and the list snapped back to the top. The content
  // pane has been preserved since DR-03; the sidebar never was. Captured from
  // the live node immediately before the innerHTML swap and reapplied
  // immediately after, so the restore lands before paint.
  var _sidebarScrollTop = 0;

  // JANK-01 (QA round 2): the sidebar has MORE THAN ONE scroller. DR-41 caps a
  // tree over 50 rows with .tv-folder-body.capped { max-height:60vh; overflow-y:auto },
  // so for any folder of real size the element the user scrolls is that body,
  // not .tv-side-scroll — which then never overflows and sits at 0 forever.
  // Preserving only .tv-side-scroll therefore fixed nothing for exactly the
  // folders where it matters most. Keyed by folder path (stable across renders,
  // unlike DOM order) so several open trees each keep their own offset.
  var _folderBodyScroll = {};

  // An element inside a display:none ancestor (⌘B collapses the sidebar via
  // .tv-sidebar.collapsed) reports scrollTop 0, and a collapsed folder body is
  // simply absent. Reading either unconditionally would wipe the saved offset
  // and drop the user at the top when the panel comes back. clientHeight is 0
  // in exactly those cases and non-zero whenever the element is really on screen.
  function hasLayout(el) {
    return !!el && !!el.clientHeight;
  }

  function captureSidebarScroll(root) {
    if (!root || typeof root.querySelectorAll !== 'function') return;
    var el = root.querySelector('.tv-side-scroll');
    if (hasLayout(el)) _sidebarScrollTop = el.scrollTop || 0;

    var bodies = root.querySelectorAll('[data-folder-body]');
    for (var i = 0; i < bodies.length; i++) {
      var b = bodies[i];
      if (!hasLayout(b)) continue;
      // An UNCAPPED body has no overflow and always reads 0 — harmless to store,
      // and it keeps the map correct if the same tree later crosses the 50-row
      // cap and becomes a scroller.
      _folderBodyScroll[b.getAttribute('data-folder-body')] = b.scrollTop || 0;
    }
  }

  function restoreSidebarScroll(root) {
    if (!root || typeof root.querySelectorAll !== 'function') return;
    // The browser clamps to scrollHeight on its own when a list got shorter
    // (folder collapsed, tree closed), so no manual clamp is needed anywhere here.
    var el = root.querySelector('.tv-side-scroll');
    if (el && _sidebarScrollTop) el.scrollTop = _sidebarScrollTop;

    var bodies = root.querySelectorAll('[data-folder-body]');
    for (var i = 0; i < bodies.length; i++) {
      var b = bodies[i];
      var saved = _folderBodyScroll[b.getAttribute('data-folder-body')];
      if (saved) b.scrollTop = saved;
    }
  }

  /* ── C-04 (round 4): the tab strip is the THIRD scroller ──────
     render() rebuilds #tv-root wholesale, so .tv-tab-strip is destroyed and
     recreated at scrollLeft 0 on EVERY repaint — theme change, ⌘B, a
     live-watch update, a dirty-dot flip, closing a tab, a font-size step. The
     content pane (DR-03) and the sidebar list (JANK-01) have both been
     preserved across that swap for a long time; the strip never was. With the
     tabs scrolled right, any repaint therefore threw the whole strip back to
     the beginning and every tab landed somewhere else.

     Selecting a tab is where users see it, but the click is not the cause: the
     active-pill flush below then measured the pill against that reset 0 and
     wrote a THIRD position, so one click produced a completely different set
     of visible tabs. Round 2's conditional scrollLeft write and round 3's
     font-weight fix both addressed what happens after the rebuild; this
     addresses the rebuild.

     Not persisted to session or disk (JANK-01 precedent — DR-06 untouched):
     the offset only has to survive a repaint. */
  var _tabStripScrollLeft = 0;

  function captureTabStripScroll(root) {
    if (!root || typeof root.querySelector !== 'function') return;
    var strip = root.querySelector('.tv-tab-strip');
    // clientWidth, not hasLayout's clientHeight: this scroller is horizontal,
    // and it is absent altogether in the empty state. A zero width means it is
    // not laid out — reading it would overwrite the saved offset with a 0 and
    // drop the user back at the first tab when the strip returns.
    if (strip && strip.clientWidth) _tabStripScrollLeft = strip.scrollLeft || 0;
  }

  function restoreTabStripScroll(root) {
    if (!root || typeof root.querySelector !== 'function') return;
    var strip = root.querySelector('.tv-tab-strip');
    if (!strip) return;
    // Settle the C-06 ⌄ control BEFORE writing scrollLeft. buildTabbar always
    // renders it `hidden`; unhiding it later takes ~24px off the strip's
    // clientWidth, which would silently re-clamp the position just restored
    // and skew the pill flush that measures against the same width.
    syncTabOverflowBtn(strip);
    // No manual clamp: the browser clamps scrollLeft to the new scrollWidth on
    // its own when the strip got narrower (⌘B revealing the sidebar) or shorter
    // (a tab closed) — same reasoning as restoreSidebarScroll.
    if (_tabStripScrollLeft) strip.scrollLeft = _tabStripScrollLeft;
  }

  /* ── F-19 / ISS-005: build one folder's nested tree section ── */
  // Delegates the tree build + collapse logic to the pure window.TVTree module
  // (js/tv-tree.js) so it stays unit-testable; this function only renders the
  // depth-annotated nodes it returns. Indentation is per-depth via
  // treeIndent() above. DR-108 a11y attributes (role=option, aria-selected,
  // data-sidebar-item, id) go on every row so the sidebar keyboard cursor can
  // target tree items.
  /* ── C-30: folder-header disambiguation ────────────────────── */
  // Two projects each containing a `docs` folder rendered two identical
  // headers, which defeats the point of the SBH hierarchy work. Prefix the
  // parent segment ONLY on an actual collision — SBH-02 rule 4 retired the
  // blanket breadcrumb affix, so this must stay the exception, not the rule.
  function headerDupeSet(paths) {
    var seen = {}, dup = {};
    (paths || []).forEach(function (p) {
      var b = pathBasename(p);
      if (seen[b]) dup[b] = true; else seen[b] = true;
    });
    return dup;
  }

  // Escaped header label, with the muted parent segment appended on collision.
  function headerLabelHtml(path, dupes) {
    var base = pathBasename(path);
    if (!dupes || !dupes[base]) return esc(base);
    var parent = parentFolderName(path);
    if (!parent) return esc(base);
    return esc(base) + '<span class="tv-hdr-parent"> · ' + esc(parent) + '</span>';
  }

  // C-28: the "no markdown files" placeholder, indented to the depth its
  // missing children would have had. data-tv-depth lets applyTreeDepths give
  // it a real indent (css-polish's static 24 px fallback assumed depth 0, so a
  // nested placeholder sat under the wrong folder).
  function treeEmptyRow(depth) {
    return '<div class="tv-tree-empty" data-tv-depth="' + depth +
      '" data-tv-kind="file">No markdown files</div>';
  }

  function buildFolderSection(tree, dupes) {
    var icons = window.TV_ICONS || {};
    var TVTree = window.TVTree;
    if (!TVTree || !tree || !tree.path) return '';

    var nodes = TVTree.buildTreeNodes(tree, state.folderCollapsed);
    if (!nodes.length) return '';

    var head = nodes[0];
    var bodyNodes = nodes.slice(1);
    // DR-41: cap section height when the expanded tree is large.
    var capped = bodyNodes.length > 50;

    // Root folder head — chevron, folder icon, name, close button; DR-108 a11y.
    var fhKey = 'folder:' + head.path;
    var html = (
      '<div class="tv-folder-head"' +
        ' id="' + sbItemId(fhKey) + '"' +
        ' role="option"' +
        ' aria-selected="false"' +
        ' data-sidebar-item="' + esc(fhKey) + '"' +
        // A3: toggle the NAMESPACED head collapse key ('root:' + path) so it can
        // never collide with a subfolder keyed by a bare path. The click / Arrow /
        // Enter handlers read this attribute opaquely → they flip the right key.
        // data-sidebar-item (folder:) and the id stay unchanged for the DR-108 cursor.
        ' data-folder-toggle="' + esc('root:' + head.path) + '"' +
        ' data-folder-ctx-target="' + esc(head.path) + '">' +
        '<span class="tv-chev' + (head.collapsed ? '' : ' open') + '">' + (icons.chevron || '') + '</span>' +
        '<span class="ic">' + (icons.folder || '') + '</span>' +
        '<span class="fname" title="' + esc(head.path) + '">' + headerLabelHtml(head.path, dupes) + '</span>' +
        '<button class="folder-x" data-folder-close="' + esc(head.path) + '" title="Close folder" type="button">' +
          (icons.close || '') +
        '</button>' +
      '</div>'
    );

    if (!head.collapsed) {
      // JANK-01: data-folder-body keys this element for scroll preservation.
      // DR-41's .capped gives it its OWN overflow-y, so past 50 rows THIS is the
      // element the user actually scrolls — not .tv-side-scroll. Keyed by folder
      // path so several open trees each keep their own offset across renders.
      html += '<div class="tv-folder-body' + (capped ? ' capped' : '') + '"' +
        ' data-folder-body="' + esc(head.path) + '">';
      bodyNodes.forEach(function (n, i) {
        if (n.kind === 'folder') {
          html += buildTreeFolderRow(n);
          // C-28: an EXPANDED subfolder with nothing under it used to render
          // zero rows and no message — the A4 placeholder only ever fired for
          // an empty root, so expanding an empty subfolder looked broken.
          // buildTreeNodes emits a flat depth-annotated list, so "has no
          // children" is "the next node is not deeper than me".
          if (!n.collapsed) {
            var next = bodyNodes[i + 1];
            if (!next || next.depth <= n.depth) {
              html += treeEmptyRow(n.depth + 1);
            }
          }
        } else {
          html += buildTreeFileRow(n);
        }
      });
      // A4: empty-folder placeholder. A muted, NON-interactive row (no
      // role=option / data-sidebar-item / id) so the DR-108 keyboard cursor
      // skips it. Shown only when the expanded tree has no files/subfolders.
      if (bodyNodes.length === 0) {
        html += treeEmptyRow(1);
      }
      // C-29: the native scanner caps how many entries it visits. "Some items
      // not shown" told the user neither how many were hidden nor how to see
      // them. Now it names the count (tree.skipped, added to DirTree by the
      // native side) and re-scans uncapped on click. Unlike the two rows above
      // this one IS interactive, so it takes part in the DR-108 keyboard
      // cursor — a mouse-only control would repeat the C-32 defect this pass
      // is fixing.
      if (tree.truncated) {
        var moreKey = 'more:' + head.path;
        var loading = !!(state.folderMoreLoading && state.folderMoreLoading[head.path]);
        // P1-1: tree.skippedExact === false means the scan stopped blind
        // (e.g. the max_subfolders cap) — the count is a lower bound, so the
        // label must say "N+" rather than a number the walk never verified.
        var moreLabel = loading
          ? 'Loading…'
          : (typeof tree.skipped === 'number' && tree.skipped > 0
              ? 'Show ' + tree.skipped + (tree.skippedExact === false ? '+' : '') +
                ' more ' + (tree.skipped === 1 && tree.skippedExact !== false ? 'file' : 'files')
              : 'Show all files');
        html += (
          '<div class="tv-tree-more' + (loading ? ' loading' : '') + '"' +
            ' id="' + sbItemId(moreKey) + '"' +
            ' role="option"' +
            ' aria-selected="false"' +
            ' data-sidebar-item="' + esc(moreKey) + '"' +
            ' data-tree-more="' + esc(head.path) + '"' +
            (loading ? ' aria-busy="true"' : '') +
            ' data-tv-depth="1" data-tv-kind="file">' +
            esc(moreLabel) +
          '</div>'
        );
      }
      html += '</div>';
    }

    return html;
  }

  // A nested subfolder row (any depth). Disclosure caret toggles the same
  // collapse map keyed by the node's unique "root/sub/deeper" key.
  function buildTreeFolderRow(n) {
    var icons = window.TV_ICONS || {};
    // DR-108: subfolder rows participate in the sidebar keyboard cursor.
    var sfKey = 'subfolder:' + n.key;
    return (
      '<div class="tv-tree-row subfolder"' +
        ' id="' + sbItemId(sfKey) + '"' +
        ' role="option"' +
        ' aria-selected="false"' +
        ' data-sidebar-item="' + esc(sfKey) + '"' +
        ' data-folder-toggle="' + esc(n.key) + '"' +
        // SBH-01: depth travels as a DATA attribute; the geometry is applied via
        // CSSOM in applyTreeDepths() after innerHTML. A style="" attribute set
        // inside an innerHTML string does NOT take effect in WKWebView, which
        // silently flattened the whole tree in the native build (QA D1).
        ' data-tv-depth="' + n.depth + '" data-tv-kind="folder">' +
        '<span class="tv-chev' + (n.collapsed ? '' : ' open') + '">' + (icons.chevron || '') + '</span>' +
        '<span class="ic">' + (icons.folder || '') + '</span>' +
        // QA D6: .tname, like file rows and the folder head's .fname — without a
        // class the name span had no ellipsis rule, so a long subfolder name
        // overflowed instead of truncating the way every sibling row does.
        '<span class="tname" title="' + esc(n.name) + '">' + esc(n.name) + '</span>' +
      '</div>'
    );
  }

  // A single file row in the folder tree.
  // n = { name, path, depth } (a render node from TVTree.buildTreeNodes)
  function buildTreeFileRow(n) {
    var icons = window.TV_ICONS || {};
    var filePath = n.path || '';
    var fileName = n.name || (filePath ? filePath.split('/').pop() : '');

    // DR-34: open-as-tab distinction
    var openTab = null;
    for (var i = 0; i < state.tabs.length; i++) {
      if (state.tabs[i].nativePath === filePath) { openTab = state.tabs[i]; break; }
    }
    var isActive = openTab && openTab.id === state.activeId;
    var isOpen = !!openTab && !isActive;
    var isLive = openTab && openTab.liveActive;

    var cls = 'tv-tree-row file';
    if (isActive) cls += ' active';
    else if (isOpen) cls += ' is-open';

    // C-05: every tree file row carries name (+ the DR-34 "open" cue) over its
    // full path. Previously only already-open rows had a title at all.
    var titleAttr = 'title="' +
      esc(labelTitle(fileName + (isOpen ? ' · open' : ''), filePath)) + '"';

    // DR-108: tree file rows get role="option" + data-sidebar-item for cursor participation
    var tfrKey = filePath ? 'file:' + filePath : '';
    return (
      '<div class="' + cls + '"' +
        (tfrKey ? ' id="' + sbItemId(tfrKey) + '"' : '') +
        ' role="option"' +
        ' aria-selected="' + (isActive ? 'true' : 'false') + '"' +
        (tfrKey ? ' data-sidebar-item="' + esc(tfrKey) + '"' : '') +
        // SBH-01: see buildTreeFolderRow — depth is applied via CSSOM, not here.
        ' data-tv-depth="' + n.depth + '" data-tv-kind="file"' +
        (filePath ? ' data-tree-file-path="' + esc(filePath) + '"' : '') +
        (openTab ? ' data-tree-tab-id="' + esc(openTab.id) + '"' : '') +
        (titleAttr ? ' ' + titleAttr : '') + '>' +
        '<span class="ic">' + (icons.doc || '') + '</span>' +
        '<span class="tname">' + labelHtml(fileName) + '</span>' +
        (isLive ? '<span class="mini-bolt">' + (icons.bolt || '') + '</span>' : '') +
      '</div>'
    );
  }

  /* ── F-22 / U-06: shortcut overlay ─────────────────────────── */
  // Canonical list from the design's SHORTCUTS array (DR-23), plus the two
  // shortcuts C-18 found missing: ⌘P (bound in the router and in the palette
  // but listed nowhere) and ⌘G / ⇧⌘G. DR-17's row cap was raised from 18 to 20
  // by the user on 2026-08-21 to make room — see the DR-17 amendment note in
  // app/feature-gaps/waad-grounded-requirements.md. 19 rows → a 10/9 split.
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
    { keys: ['⌘G', '⇧⌘G'], action: 'Find next / previous' },
    { keys: ['⌘⌥O'], action: 'Outline' },
    { keys: ['⌘E'], action: 'Toggle edit' },
    { keys: ['⌘S'], action: 'Save' },
    { keys: ['⌘P'], action: 'Print / Export PDF' },
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

  var _SC_BARE_MODIFIERS = {
    Shift: 1, Meta: 1, Alt: 1, Control: 1, CapsLock: 1, Fn: 1, FnLock: 1,
    AltGraph: 1, OS: 1, Hyper: 1, Super: 1, NumLock: 1, ScrollLock: 1
  };

  function _scKeyHandler(e) {
    // C-18: DR-18 closes the sheet on any keypress — but holding ⌘ or ⇧ while
    // READING the sheet that teaches ⌘ and ⇧ dismissed it instantly. A bare
    // modifier is not a keypress in the sense DR-18 means.
    if (_SC_BARE_MODIFIERS[e.key]) return;
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
  // SBH-03: `transient` opens the file in the single preview tab (a plain
  // single click in the tree). Omitted/false pins it — every pre-existing
  // caller (context menu "Open", keyboard Enter) keeps its current behavior.
  function _openTreeFilePath(tfPath, transient) {
    if (!tfPath || !window.TVNative || !TVNative.available) return;

    // SBH-03 (QA D3): a double-click fires TWO clicks, so this ran twice for
    // one gesture and opened the file twice. openDoc's own dedup could not
    // catch it: once the bridge assigns tab.nativePath the existing tab keys as
    // 'native:<path>' while the incoming opts still key as '<dir>/<name>', so
    // the keys never matched. Two guards, in order:
    //   1. already open  → just activate (and honour a pending pin),
    //   2. read in flight → drop the duplicate read entirely.
    // JANK-02: activateTab and pinTab each render; batched they cost one.
    var already = _tabIdByNativePath(tfPath);
    if (already) {
      batchRender(function () {
        activateTab(already);
        if (_pendingPinPath === tfPath) { _pendingPinPath = null; pinTab(already); }
      });
      return;
    }
    if (_openingPaths[tfPath]) return;
    _openingPaths[tfPath] = true;

    window.__TAURI__.core.invoke('read_md_file', { path: tfPath })
      .then(function (doc) {
        delete _openingPaths[tfPath];
        // JANK-02: openInto → openDoc (close preview + activate) and openInto's
        // own trailing re-render, plus a possible pinTab below, all collapse
        // into the single repaint emitted when this batch unwinds.
        batchRender(function () {
          if (window.TVNative && typeof TVNative.openInto === 'function') {
            TVNative.openInto(doc, { transient: !!transient });
          } else if (doc && doc.name) {
            var pdir = tfPath.replace(/\/[^/]+$/, '') || '/';
            var tid = openDoc({ name: doc.name, source: doc.content, path: pdir, transient: !!transient });
            if (tid) {
              var t = state.tabs.find(function (x) { return x.id === tid; });
              if (t) t.nativePath = doc.path || tfPath;
            }
          }
          // SBH-03: a double-click that beat this read to the finish latched its
          // intent — apply it now that the tab exists, and clear the latch.
          if (_pendingPinPath && (_pendingPinPath === tfPath || _pendingPinPath === doc.path)) {
            var pinId = _tabIdByNativePath(_pendingPinPath) || _tabIdByNativePath(tfPath);
            _pendingPinPath = null;
            if (pinId) pinTab(pinId);
          }
        });
      })
      .catch(function (err) {
        // Always clear the in-flight guard, or a file that failed once could
        // never be retried.
        delete _openingPaths[tfPath];
        if (_pendingPinPath === tfPath) _pendingPinPath = null;
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

    // ── Legacy open-tab list (tabs NOT associated with any open folder) ──
    // These are tabs opened via ⌘O without a folder context.
    var folderPaths = {};
    state.openFolders.forEach(function (f) { folderPaths[f.path] = true; });

    // C-30: collision set across BOTH header kinds — open folder roots and the
    // grouped-by-path headers below them. Computed once, before either is
    // rendered, so a `docs` root and a `docs` group also disambiguate.
    var headerPaths = state.openFolders.map(function (f) { return f.path; });
    state.tabs.forEach(function (t) {
      if (t.path && !folderPaths[t.path] && headerPaths.indexOf(t.path) === -1) {
        headerPaths.push(t.path);
      }
    });
    var headerDupes = headerDupeSet(headerPaths);

    // ── F-19: Folder tree sections (most-recently-opened first = reversed) ──
    var folderSections = '';
    var reversedFolders = state.openFolders.slice().reverse();
    reversedFolders.forEach(function (tree) {
      folderSections += buildFolderSection(tree, headerDupes);
    });

    // Exact set of every file path that some open folder tree renders. A tab
    // already shown inside a tree (e.g. a SUBFOLDER file opened by clicking it,
    // whose tab.path is the subfolder — NOT an open-folder root) must NOT also
    // re-group below as a phantom muted "folder" section. We test the tab's
    // exact nativePath against tree-file membership — NOT a path-prefix match,
    // which would wrongly hide files under the root but beyond the native scan
    // cap (lib.rs read_dir_tree capping), i.e. open files the tree never lists.
    var treeFilePaths = {};
    if (window.TVTree && typeof TVTree.collectTreeFilePaths === 'function') {
      state.openFolders.forEach(function (f) {
        TVTree.collectTreeFilePaths(f).forEach(function (p) { treeFilePaths[p] = true; });
      });
    }

    // Group tabs that have a .path (folder association) vs ungrouped
    var groups = {};
    var ungrouped = [];
    state.tabs.forEach(function (t) {
      // Skip tabs already shown inside a folder tree — matched by EXACT file
      // path (covers subfolder files whose tab.path is the subfolder, not the
      // open-folder root) — they render in the tree with the DR-34 is-open
      // highlight; grouping them too would double-render the phantom section.
      if (t.nativePath && treeFilePaths[t.nativePath]) return;
      if (t.path && !folderPaths[t.path]) {
        (groups[t.path] = groups[t.path] || []).push(t);
      } else if (!t.path) {
        ungrouped.push(t);
      }
    });

    // F-02 + ISS-FOLDER: Recent section — recent FILES not currently open as a
    // tab, plus recent FOLDERS not currently open in the tree. Independent caps
    // (8 files, 8 folders) so neither kind crowds the other out of the list.
    var openNativePaths = {};
    state.tabs.forEach(function (t) {
      if (t.nativePath) openNativePaths[t.nativePath] = true;
    });
    var openFolderPaths = {};
    state.openFolders.forEach(function (f) { if (f.path) openFolderPaths[f.path] = true; });
    var recentAll = loadRecentEntries();
    var closedRecent = recentAll.filter(function (entry) {
      return entry.type !== 'folder' && !openNativePaths[entry.path];
    }).slice(0, 8); // DR-82: cap at 8
    var closedRecentFolders = recentAll.filter(function (entry) {
      return entry.type === 'folder' && !openFolderPaths[entry.path];
    }).slice(0, 8);

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
          // C-32: the glyph is decoration; the button's aria-label is its name.
          '<span aria-hidden="true">&#x2715;</span>' +
        '</button>'
      );
    }

    Object.keys(groups).forEach(function (path) {
      // SBH-02 (Fix 2, rule 4): NO breadcrumb affix on rows. The muted parent-
      // path suffix existed only to disambiguate the flat "More files" bucket;
      // that bucket is gone and nesting carries the location now. The full path
      // still resolves on hover via title=, so nothing is lost.
      // C-30 narrows that to headers, and only on an actual name collision.
      rows += (
        '<div class="tv-tree-row folder" role="group" aria-label="' + esc(path) + '" title="' + esc(path) + '">' +
          ic('folder') +
          '<span class="folder-name">' + headerLabelHtml(path, headerDupes) + '</span>' +
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
            // C-32: name the option explicitly. Without this the row's
            // accessible name was computed from its contents and came out as
            // "schema.md✕" — the close glyph read as part of the filename.
            ' aria-label="' + esc(t.name) + '"' +
            // C-05: name over full path (the row label truncates in the middle).
            ' title="' + esc(labelTitle(t.name, t.nativePath || t.path)) + '"' +
            ' tabindex="-1"' +
            ' data-sidebar-tab="' + esc(t.id) + '">' +
            ic('doc') +
            '<span>' + labelHtml(t.name) + '</span>' +
            (t.liveActive ? '<span class="mini-bolt">' + (icons.bolt || '') + '</span>' : '') +
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
            // C-32: name the option explicitly. Without this the row's
            // accessible name was computed from its contents and came out as
            // "schema.md✕" — the close glyph read as part of the filename.
            ' aria-label="' + esc(t.name) + '"' +
            // C-05: name over full path (the row label truncates in the middle).
            ' title="' + esc(labelTitle(t.name, t.nativePath || t.path)) + '"' +
            ' tabindex="-1"' +
            ' data-sidebar-tab="' + esc(t.id) + '">' +
            ic('doc') +
            '<span>' + labelHtml(t.name) + '</span>' +
            (t.liveActive ? '<span class="mini-bolt">' + (icons.bolt || '') + '</span>' : '') +
            sbCloseBtn(t.id, t.name) +
          '</div>'
        );
      });
    }

    if (closedRecent.length || closedRecentFolders.length) {
      rows += '<div class="tv-side-divider"></div>';
      rows += '<div class="tv-side-label tv-side-recent-label">Recent</div>';
      // ISS-FOLDER: recent FOLDERS first (folder icon + distinct
      // data-recent-folder attr + recent-folder: sidebar-item key so the
      // shared [data-recent-path] click handler never catches them, and the
      // keyboard-cursor Enter branch reopens the folder instead of opening it
      // as a file). DR-108 a11y attrs on every row for cursor participation.
      closedRecentFolders.forEach(function (entry) {
        var fname = entry.path.split('/').filter(Boolean).pop() || entry.path;
        var ftsLabel = (entry.ts > 0) ? relativeTime(entry.ts) : '';
        var rfKey = 'recent-folder:' + entry.path;
        rows += (
          '<div class="tv-tree-row file recent recent-folder"' +
            ' id="' + sbItemId(rfKey) + '"' +
            ' role="option"' +
            ' aria-selected="false"' +
            ' data-sidebar-item="' + esc(rfKey) + '"' +
            ' data-recent-folder="' + esc(entry.path) + '"' +
            ' title="' + esc(entry.path) + '">' +
            ic('folder') +
            '<span class="tv-recent-name">' + esc(fname) + '</span>' +
            (ftsLabel ? '<span class="tv-recent-ts">' + esc(ftsLabel) + '</span>' : '') +
          '</div>'
        );
      });
      closedRecent.forEach(function (entry) {
        var name = entry.path.split('/').pop() || entry.path;
        var tsLabel = (entry.ts > 0) ? relativeTime(entry.ts) : '';
        // DR-109: recent rows need id + aria-selected for cursor participation
        var rKey = 'recent:' + entry.path;
        rows += (
          '<div class="tv-tree-row file recent"' +
            ' id="' + sbItemId(rKey) + '"' +
            ' role="option"' +
            ' aria-selected="false"' +
            ' data-sidebar-item="' + esc(rKey) + '"' +
            ' data-recent-path="' + esc(entry.path) + '"' +
            ' title="' + esc(entry.path) + '">' +
            ic('clock') +
            '<span class="tv-recent-name">' + esc(name) + '</span>' +
            (tsLabel ? '<span class="tv-recent-ts">' + esc(tsLabel) + '</span>' : '') +
          '</div>'
        );
      });
    }

    // C-16: on a genuinely first run the sidebar is ~950 px of empty grey under
    // FILES. Say what it is for and give it its one action, rather than leaving
    // the panel to read as broken.
    var sidePlaceholder = '';
    if (!folderSections && !rows) {
      sidePlaceholder = (
        '<div class="tv-side-empty">' +
          '<span class="tv-side-empty-ic">' + (icons.folder || '') + '</span>' +
          '<span class="tv-side-empty-title">No folder open</span>' +
          '<button class="tv-side-empty-btn" data-open-folder type="button">' +
            'Open folder… <span class="kbd">⌘⇧O</span>' +
          '</button>' +
        '</div>'
      );
    }

    // C-16: "Find in document" cannot act without a document. Hiding it beats
    // disabling it — a dead control in a 950 px empty panel is the loudest
    // thing on the first screen.
    var findBox = !state.tabs.length ? '' : (
      '<div class="tv-search">' +
        '<div class="tv-search-box" data-open-find' +
          ' title="Find in document (⌘F)" aria-label="Find in document (⌘F)" role="button" tabindex="0">' +
          ic('search') +
          '<span>Find in document</span>' +
          '<span class="kbd">⌘F</span>' +
        '</div>' +
      '</div>'
    );

    var sidebarCls = 'tv-sidebar' + (collapsed ? ' collapsed' : '');
    return (
      '<aside class="' + sidebarCls + '">' +
        // UX-SB3: sidebar header
        '<div class="tv-side-header">' +
          '<span class="tv-side-header-label">Files</span>' +
          '<button class="tv-side-collapse" data-sidebar-toggle' +
            ' title="Hide sidebar (⌘B)" aria-label="Hide sidebar (⌘B)" type="button">' +
            (icons.collapseLeft || '«') +
          '</button>' +
        '</div>' +
        '<div class="tv-side-scroll"' +
          ' id="tv-sidebar-listbox"' +
          ' role="listbox"' +
          ' aria-label="Open files"' +
          ' aria-orientation="vertical"' +
          ' tabindex="0">' +
          // F-19: folder trees at the top
          folderSections +
          // Legacy open-tabs / recent rows below
          rows +
          // C-16: shown only when the two above produced nothing at all.
          sidePlaceholder +
        '</div>' +
        findBox +
        // BUG-4: drag handle on the sidebar's right edge.
      '</aside>'
    );
  }

  function buildViewer() {
    var tab = getActiveTab();
    if (!tab) {
      // Build recent list for empty state (U-09).
      // ISS-FOLDER: render recent FOLDERS (folder icon + distinct
      // data-recent-folder attr so the shared [data-recent-path] click handler
      // never catches them) first, then recent FILES (data-recent-path).
      var recentEntriesES = loadRecentEntries();
      var recentFoldersES = recentEntriesES.filter(function (e) { return e.type === 'folder'; }).slice(0, 8);
      var recentFilesES = recentEntriesES.filter(function (e) { return e.type !== 'folder'; }).slice(0, 8);
      var recentHtml = '';
      if (recentFoldersES.length || recentFilesES.length) {
        recentHtml = '<div class="tv-empty-recent">';
        recentFoldersES.forEach(function (e) {
          var p = e.path;
          var name = p.split('/').filter(Boolean).pop() || p;
          // No inline icon here: .tv-recent-row is a COLUMN flex (index.html
          // inline CSS), so an SVG would stack on its own line. The distinct
          // recent-folder class + full path make it read as a folder; the
          // name carries a trailing "/" cue to disambiguate from a file row.
          recentHtml += (
            '<div class="tv-recent-row recent-folder" data-recent-folder="' + esc(p) + '"' +
              ' role="button" tabindex="0">' +
              '<span class="tv-recent-name">' + esc(name) + '/</span>' +
              '<span class="tv-recent-path">' + esc(p) + '</span>' +
            '</div>'
          );
        });
        recentFilesES.forEach(function (e) {
          var p = e.path;
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
      // C-16: the first screen taught exactly one way in (⌘O) and orphaned the
      // trust line 250 px below the card. The stack wrapper puts the card, the
      // recent list and the trust line in one column — before this the recent
      // list rendered BESIDE the card, because .tv-empty is a row flex and
      // .tv-empty-recent's margin-top assumed it was not.
      return (
        '<div class="tv-viewer" id="tv-viewer-panel" role="tabpanel">' +
          '<div class="tv-empty">' +
            '<div class="tv-empty-stack">' +
              '<div class="tv-dropzone">' +
                '<span class="dz-ic">' + ((window.TV_ICONS || {}).tray || '') + '</span>' +
                '<span class="dz-title">Drop .md files here</span>' +
                '<span class="dz-or">or</span>' +
                '<span class="dz-cmd"><span class="kbd">⌘O</span> to open files</span>' +
                // The quiet second line: the sidebar's whole reason to exist
                // (⌘⇧O) was never mentioned anywhere on this screen.
                '<span class="dz-more">' +
                  '<span class="dz-more-item"><span class="kbd">⌘⇧O</span> open folder</span>' +
                  '<span class="dz-more-item"><span class="kbd">⌘K</span> commands</span>' +
                  '<span class="dz-more-item"><span class="kbd">?</span> shortcuts</span>' +
                '</span>' +
              '</div>' +
              recentHtml +
              '<div class="tv-empty-hint">No file open · nothing is imported, nothing is synced</div>' +
            '</div>' +
          '</div>' +
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
      // C-33: Esc now DISCARDS, so the label must say so. On a clean document
      // there is nothing to discard and Esc is simply the way out, so it reads
      // "Done" — a button that threatens to throw away work you have not done
      // is its own kind of lie.
      var escLabel = tab.dirty ? 'Discard' : 'Done';
      var toolbar = (
        '<div class="tv-edit-toolbar">' +
          '<button class="tv-edit-btn' + (tab.dirty ? ' danger' : '') + '" type="button" data-edit-esc>' +
            '<span class="kbd">esc</span> ' + escLabel +
          '</button>' +
          '<button class="tv-edit-btn primary" type="button" data-edit-save><span class="kbd">⌘S</span> Save</button>' +
          '<span class="tv-edit-meta">' + wordCount + ' words</span>' +
        '</div>'
      );
      return (
        '<div class="tv-viewer" id="tv-viewer-panel" role="tabpanel">' +
          toolbar +
          '<div class="tv-scroll" data-scroll tabindex="0">' +
            '<div class="tv-content">' +
              editContent +
            '</div>' +
          '</div>' +
        '</div>'
      );
    }

    // Reading mode

    // F-21: empty .md file → explicit "This file is empty." message, no spinner.
    // C-27: this branch used to return BEFORE the pencil and the ⌘E hint were
    // attached, so the one state where you most want to start typing was the
    // one state offering no way in. Keep both, and say so in the message.
    // F-21's specified string survives as the prefix.
    if (!tab.source || !tab.source.trim()) {
      var emptyPencilIc = (window.TV_ICONS && window.TV_ICONS.pencil) ? window.TV_ICONS.pencil : '';
      return (
        '<div class="tv-viewer" id="tv-viewer-panel" role="tabpanel">' +
          '<div class="tv-scroll" data-scroll tabindex="0">' +
            '<div class="tv-content tv-content--readable">' +
              '<button class="tv-edit-pencil" data-edit-pencil' +
                ' title="Edit (⌘E)" aria-label="Edit document (⌘E)" type="button">' +
                emptyPencilIc +
              '</button>' +
              '<div class="tv-empty-doc">This file is empty. ⌘E to start writing.</div>' +
            '</div>' +
          '</div>' +
          (_showEditHint() ? '<div class="tv-edit-hint">⌘E to edit</div>' : '') +
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
    // UX-21: status bar hint — "⌘E to edit" shown in reading mode.
    // C-19: only for the first few sessions; after that the pencil carries it.
    var editHint = _showEditHint() ? '<div class="tv-edit-hint">⌘E to edit</div>' : '';
    return (
      '<div class="tv-viewer" id="tv-viewer-panel" role="tabpanel">' +
        '<div class="tv-scroll" data-scroll tabindex="0">' +
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
        '<div class="tv-scroll" data-scroll tabindex="0">' +
          '<div class="tv-content tv-content--readable">' +
            '<div class="tv-error-state">' +
              '<span class="tv-error-badge" aria-hidden="true">&#9888;</span>' +
              '<div class="tv-error-title">' + title + '</div>' +
              '<div class="tv-error-name">' + name + '</div>' +
              // C-39: "Locate file…" asked the user to find something without
              // saying where it had been. Muted monospace, user-selectable so
              // the path can be copied. Screen-only: tv-print.css keeps full
              // paths out of shared PDFs (U-15's privacy rationale).
              (path ? '<div class="tv-error-path">' + esc(path) + '</div>' : '') +
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
        '<div class="tv-scroll" data-scroll tabindex="0">' +
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

    // ── RECENT section: timestamped recents not currently open ──
    // ISS-FOLDER: recent FOLDERS render first with the folder icon and a
    // distinct data-ntp-folder-path attr so the click handler reopens them as a
    // folder (not as a file via data-ntp-path → read_md_file, which would fail
    // on a directory). data-ntp-folder-path is distinct from data-ntp-folder
    // (the parent-folder scoring source used by the fuzzy matcher).
    var openNativePaths = {};
    state.tabs.forEach(function (t) {
      if (t.nativePath) openNativePaths[t.nativePath] = true;
    });
    var openFolderPathsNtp = {};
    state.openFolders.forEach(function (f) { if (f.path) openFolderPathsNtp[f.path] = true; });
    var recentAllNtp = loadRecentEntries();
    var recentFolderEntries = recentAllNtp.filter(function (e) {
      return e.type === 'folder' && !openFolderPathsNtp[e.path];
    }).slice(0, 8);
    var recentEntries = recentAllNtp.filter(function (e) {
      return e.type !== 'folder' && !openNativePaths[e.path];
    }).slice(0, 8);
    var recentFolderRows = recentFolderEntries.map(function (e) {
      var p = e.path;
      var name = p.split('/').filter(Boolean).pop() || p;
      var folder = parentFolderName(p);
      var when = relativeTime(e.ts);
      return (
        '<div class="tv-ntp-row" role="option" aria-selected="false"' +
          ' data-ntp-folder-path="' + esc(p) + '"' +
          ' data-ntp-name="' + esc(name) + '"' +
          ' data-ntp-folder="' + esc(folder) + '"' +
          ' title="' + esc(p) + '">' +
          '<span class="ic tv-ntp-ic">' + folderIc + '</span>' +
          '<span class="tv-ntp-name">' + esc(name) + '</span>' +
          (when ? '<span class="tv-ntp-meta">' + esc(when) + '</span>' : '') +
        '</div>'
      );
    }).join('');
    var recentRows = recentFolderRows + recentEntries.map(function (e) {
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
    return (
      // C-16: the empty state hand-rolled its own titlebar, which is why the
      // theme toggle vanished on first launch and reappeared once a document
      // was open. buildTitlebar() already renders 'Galley' when there is no
      // active tab, so share it and the chrome inventory stops depending on
      // whether you happen to have a file open.
      buildTitlebar() +
      // Reuse the standard tabbar so the sidebar toggle is present in the empty
      // state too, and render the sidebar in the body so it can reveal the Recent
      // list (otherwise the empty state had no path to it but the ⌘O launcher).
      buildTabbar() +
      '<div class="tv-body">' +
        buildSidebar() +
        (state.sidebarOpen ? '<div class="tv-sidebar-resizer" data-sidebar-resize></div>' : '') +
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

    // JANK-02: inside batchRender() — record that a repaint is owed and let the
    // batch emit exactly one at the end. Must be the first thing render() does,
    // before any of the overlay teardown below runs.
    if (_renderSuspend > 0) {
      _renderQueued = true;
      return;
    }

    // C-33: keep tab.savedSource honest. Any path that changes tab.source
    // WITHOUT marking the tab dirty is by definition writing DISK content —
    // the live-watch update (tv-live.js / tv-native.js), a reload, a session
    // restore. Reconciling here means those files do not each have to remember
    // a second field, and the invariant is stated in exactly one place:
    //   not dirty  ⇒  source IS what is on disk.
    for (var _si = 0; _si < state.tabs.length; _si++) {
      var _st = state.tabs[_si];
      if (!_st.dirty && _st.savedSource !== _st.source) _st.savedSource = _st.source;
    }

    // JANK-01: read the sidebar's live scroll offset before the DOM that owns
    // it is thrown away.
    captureSidebarScroll(root);
    // C-04: same for the tab strip's horizontal offset.
    captureTabStripScroll(root);

    // S-02/S-08: reset overlay state before replacing DOM
    // (overlay elements are about to be detached; reset their _open flags
    //  so subsequent ⌘K / ⌘⇧F still work correctly)
    if (window.TVPalette && typeof TVPalette.close === 'function') {
      TVPalette.close();
    }
    if (window.TVSearch && typeof TVSearch.close === 'function') {
      TVSearch.close();
    }
    // C-06: the overflow list is appended to .tv, which this render replaces —
    // detach it (and its document-level Esc listener) instead of orphaning it.
    if (_tabOverflowEl) closeTabOverflow();
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

    // C-20: --tv-edit-font rides along with --tv-md-font, otherwise setFontSize's
    // CSSOM write is thrown away by the next repaint and the editor snaps back.
    root.innerHTML = '<div class="' + rootCls + '" style="--tv-md-font:' + state.fontSize +
      'px;--tv-edit-font:' + editFontFor(state.fontSize) + 'px">' + html + '</div>';

    // BUG-4: Apply sidebar width CSS var to the .tv root so the sidebar can read it.
    // dev2's CSS: .tv-sidebar { width: var(--tv-sidebar-w, 224px) }
    var tvRootEl = root.querySelector('.tv');
    if (tvRootEl) {
      tvRootEl.style.setProperty('--tv-sidebar-w', state.sidebarWidth + 'px');
    }

    // SBH-01: apply the tree indent + rail depth via CSSOM. MUST happen here,
    // right after innerHTML and before paint — see applyTreeDepths().
    applyTreeDepths(root);

    // JANK-01: put the file list back where the user left it. Runs after
    // applyTreeDepths so row padding (and therefore any wrap-driven height) is
    // already final and scrollTop is measured against the final scrollHeight.
    restoreSidebarScroll(root);

    // C-04: put the tab strip back where the user left it, for the same reason
    // and at the same moment. Runs after the --tv-sidebar-w write above, so the
    // strip's clientWidth is already final. Everything downstream — the
    // active-pill flush, updateTabStripScroll's edge fades — then measures the
    // position the user actually has, not a fresh 0.
    restoreTabStripScroll(root);

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

    // U-15 / DR-106 (Should): set data-print-title on .tv-content so
    // tv-print.css can emit a filename header above the first heading.
    // tab.name is already the basename (e.g. "architecture.md") — no
    // path is written here (privacy: full paths not exposed in shared PDFs).
    if (activeTab && !activeTab.untitled) {
      var printTitleEl = root.querySelector('.tv-content');
      if (printTitleEl) {
        printTitleEl.setAttribute('data-print-title', activeTab.name || '');
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

    // JANK-02 (Bug B): bring the newly-active tab pill into view. _doActivateTab
    // used to do this inline right after its own render() call, which no longer
    // works once that render can be deferred to the end of a batch — the query
    // would hit the pre-render DOM. Latching the id and flushing it here keeps
    // the behaviour identical (it still only fires on an activate) and correct
    // under batching. block:'nearest' cannot scroll the sidebar or the document:
    // the pill lives in the horizontally-scrolling tab strip.
    if (_pendingTabScrollId) {
      var pillEl = root.querySelector('[data-tab-id="' + _pendingTabScrollId + '"]');
      _pendingTabScrollId = null;
      // C-04 (round 2): scrollIntoView nudges ancestors and can shift the strip
      // even when the pill is ALREADY fully visible. Move scrollLeft ourselves,
      // and only when the pill is actually out of view, so selecting a visible
      // tab is a pure repaint with no layout movement.
      var stripEl = pillEl && pillEl.closest ? pillEl.closest('.tv-tab-strip') : null;
      if (pillEl && stripEl) {
        var PAD = 8;
        var pillL = pillEl.offsetLeft;
        var pillR = pillL + pillEl.offsetWidth;
        var viewL = stripEl.scrollLeft;
        var viewR = viewL + stripEl.clientWidth;
        if (pillL < viewL) {
          stripEl.scrollLeft = Math.max(0, pillL - PAD);
        } else if (pillR > viewR) {
          stripEl.scrollLeft = pillR - stripEl.clientWidth + PAD;
        }
      }
    }

    // C-04/C-06: publish the strip's overflow/scroll state. Last, because the
    // restore and the pill flush above both move scrollLeft. Its own
    // syncTabOverflowBtn call is by now an idempotent re-check — the button was
    // already settled in restoreTabStripScroll, deliberately, before anything
    // measured the strip.
    updateTabStripScroll(root);

    // C-38: the Window menu, ⌘-Tab switcher and Mission Control read
    // document.title. Follow the NSDocument convention (name, then Edited).
    _syncTitles();
  }

  // UX-10 / DR-108: Renders the sidebar keyboard cursor highlight using .kbd-cursor class
  // and aria-activedescendant on the listbox. Uses sbKbd.id (item key or tab id) NOT index,
  // so it survives re-renders correctly. No DOM focus() call — WebKit-safe.
  // DR-108: widened selector covers both data-sidebar-tab rows (open-file rows) and
  // data-sidebar-item rows (folder-head, subfolder, recent) in all three query sites.
  function renderSidebarCursor() {
    var listbox = document.getElementById('tv-sidebar-listbox');
    if (!listbox) return;

    // DR-108 site (a): clear-pass — widen to include all option row types
    var opts = Array.prototype.slice.call(
      listbox.querySelectorAll('[role="option"][data-sidebar-tab],[role="option"][data-sidebar-item]')
    );
    opts.forEach(function (el) { el.classList.remove('kbd-cursor'); });
    listbox.removeAttribute('aria-activedescendant');

    if (!sbKbd.active || !sbKbd.id) {
      // JANK-01: cursor dismissed (Escape, wheel, ⌘B, overlay, edit mode, click
      // in the content pane). Forget where we last scrolled so re-entering
      // keyboard navigation scrolls to the cursor again. Every site that clears
      // sbKbd.active calls straight back into here, so this is the one place
      // that needs it.
      _lastCursorScrollId = null;
      return;
    }

    // DR-108 site (b): find-target loop — match against both data attrs
    var target = null;
    for (var i = 0; i < opts.length; i++) {
      var elKey = opts[i].getAttribute('data-sidebar-item') || opts[i].getAttribute('data-sidebar-tab');
      if (elKey === sbKbd.id) {
        target = opts[i]; break;
      }
    }

    // DR-108 site (c): clamp block — fall back to first option; read id via
    // data-sidebar-item (preferred) or data-sidebar-tab (legacy open-file rows)
    if (!target && opts.length) {
      target = opts[0];
      sbKbd.id = target.getAttribute('data-sidebar-item') || target.getAttribute('data-sidebar-tab');
    }

    if (target) {
      target.classList.add('kbd-cursor');
      listbox.setAttribute('aria-activedescendant', target.id);
      // JANK-01 (QA round 2): scroll ONLY when the cursor actually moved.
      // renderSidebarCursor() runs at the end of every render, after
      // restoreSidebarScroll(), so an unconditional scrollIntoView here meant
      // the armed cursor re-asserted its own position on every repaint and
      // dragged the file list away from where the user left it — including on
      // renders that had nothing to do with keyboard navigation. Worse, the
      // list then moved BETWEEN the two clicks of a double-click, so click #2
      // landed on a different row and pinned the wrong file.
      // Arrow/Home/End all change sbKbd.id, so keyboard nav still scrolls.
      if (sbKbd.id !== _lastCursorScrollId) {
        _lastCursorScrollId = sbKbd.id;
        target.scrollIntoView({ block: 'nearest' });
      }
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
        // C-14: coalesce keystrokes. _runFind itself stays synchronous — the
        // render() restore path calls it directly and reads _findMatches right
        // after, so the debounce lives here and nowhere else.
        if (_findDebounce) clearTimeout(_findDebounce);
        _findDebounce = setTimeout(function () {
          _findDebounce = null;
          if (_findOpen) _runFind(_findQuery);
        }, _FIND_DEBOUNCE_MS);
      });
      inputEl.addEventListener('keydown', function (e) {
        if (e.key === 'Enter') {
          e.preventDefault();
          // C-14: Enter must act on what the user just typed, not on the
          // previous debounce window.
          if (_findDebounce) {
            clearTimeout(_findDebounce);
            _findDebounce = null;
            _runFind(_findQuery);
            return;
          }
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
    // C-14: a pending debounce must not fire against a closed bar.
    if (_findDebounce) { clearTimeout(_findDebounce); _findDebounce = null; }
    // Remove marks from DOM
    _clearFindMarks();
    if (_findBarEl && _findBarEl.parentNode) {
      _findBarEl.parentNode.removeChild(_findBarEl);
    }
    _findBarEl = null;
    _findMatches = [];
    _findNodes = [];
    _findNodeIdxs = [];
    _findIndex = 0;
  }

  /* ── C-14: find without freezing the app ─────────────────────
     The old implementation wrapped EVERY hit in a <mark> on every keystroke —
     60 000 element insertions for one character on a 20 000-block document,
     then unwrapped them all on the next keystroke. The expensive part is the
     DOM mutation and relayout, not the text walk (a TreeWalker over 94 000
     text nodes measures ~12 ms), so the cap belongs on MARKS, not on matching.

     _findMatches therefore stops being a list of DOM nodes and becomes the
     authoritative list of match POSITIONS — { n: index into _findNodes, s:
     offset within that node }. The count and _findStep's modulo arithmetic run
     over that full list, so neither can ever diverge from what the user is
     told, which is the trap the skeptics flagged. Only the matches inside a
     window around the current index are actually wrapped, and stepping
     re-marks as it goes. */
  var _FIND_MARK_WINDOW = 150; // matches marked either side of the current one
  // P1-5: was 2 — a single character (CJK, a lone symbol, `]`/`}` in code)
  // is a legitimate ⌘F query, and it made the find bar look dead with no
  // feedback while tv-search's cross-tab panel searched from 2 chars anyway.
  // _FIND_MARK_WINDOW above already bounds the marking cost regardless of
  // how many matches a short query produces (C-14's own argument for 150).
  var _FIND_MIN_QUERY = 1;     // below this we do not search at all
  var _FIND_DEBOUNCE_MS = 120;
  var _FIND_NODE_MARK_CAP = 1000; // per-node guard against one giant text node
  var _findNodes = [];         // original text nodes, DOM order; index = match.n
  var _findNodeIdxs = [];      // n → [matchIdx,…] every match living in that node
  var _findMarked = {};        // n → { orig:String, nodes:[Node], idxs:[…] }
  var _findMarkEls = [];       // matchIdx → <mark>, sparse (only marked ones)
  var _findLen = 0;            // query length, for slicing
  var _findDebounce = null;

  function _sameIdxs(a, b) {
    if (!a || !b || a.length !== b.length) return false;
    for (var i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
    return true;
  }

  // Put node `n` back the way we found it and re-seed _findNodes[n] with the
  // fresh text node, so the index → live-node mapping survives mark/unmark
  // cycles (a normalize()-based unwrap would leave the mapping dangling).
  function _unmarkNode(n) {
    var rec = _findMarked[n];
    if (!rec) return;
    delete _findMarked[n];
    // Drop the element refs too — leaving them behind would let
    // _highlightFindMatch toggle .current on a detached <mark>.
    for (var j = 0; j < rec.idxs.length; j++) _findMarkEls[rec.idxs[j]] = null;
    var first = rec.nodes[0];
    var parent = first && first.parentNode;
    if (!parent) { _findNodes[n] = null; return; }
    var fresh = document.createTextNode(rec.orig);
    parent.replaceChild(fresh, first);
    for (var i = 1; i < rec.nodes.length; i++) {
      if (rec.nodes[i].parentNode) rec.nodes[i].parentNode.removeChild(rec.nodes[i]);
    }
    _findNodes[n] = fresh;
  }

  // Wrap the matches listed in `idxs` (all belonging to node `n`) in <mark>.
  function _markNode(n, idxs) {
    if (_findMarked[n] || !idxs.length) return;
    var node = _findNodes[n];
    if (!node || !node.parentNode) return;
    var text = node.textContent;
    var frag = document.createDocumentFragment();
    var inserted = [];
    var cur = 0;
    for (var i = 0; i < idxs.length; i++) {
      var m = _findMatches[idxs[i]];
      if (m.s > cur) inserted.push(frag.appendChild(document.createTextNode(text.slice(cur, m.s))));
      var mk = document.createElement('mark');
      mk.setAttribute('data-find', '');
      mk.textContent = text.slice(m.s, m.s + _findLen);
      inserted.push(frag.appendChild(mk));
      _findMarkEls[idxs[i]] = mk;
      cur = m.s + _findLen;
    }
    if (cur < text.length) inserted.push(frag.appendChild(document.createTextNode(text.slice(cur))));
    node.parentNode.replaceChild(frag, node);
    _findMarked[n] = { orig: text, nodes: inserted, idxs: idxs };
  }

  // Make sure every match within ±_FIND_MARK_WINDOW of `center` is wrapped and
  // nothing outside it is. The window is SNAPPED TO NODE BOUNDARIES: a text
  // node touched by the window gets ALL of its matches wrapped. Marking a node
  // only partially was the first version of this and it was wrong — as the
  // window slid, a node entered with just the one match the boundary happened
  // to cut, so the CURRENT match frequently had no <mark> at all and neither
  // .current nor scrollIntoView could find it.
  function _markWindow(center) {
    if (!_findMatches.length) return;
    var lo = Math.max(0, center - _FIND_MARK_WINDOW);
    var hi = Math.min(_findMatches.length - 1, center + _FIND_MARK_WINDOW);
    var want = {};
    for (var i = lo; i <= hi; i++) {
      var n = _findMatches[i].n;
      if (want[n]) continue;
      var all = _findNodeIdxs[n];
      // Guard: one pathological text node holding thousands of hits would
      // undo the whole point of the cap. Fall back to the in-window slice —
      // `center` is inside [lo,hi], so the current match is still covered.
      want[n] = (all.length <= _FIND_NODE_MARK_CAP)
        ? all
        : all.filter(function (ix) { return ix >= lo && ix <= hi; });
    }
    // Drop anything that fell out of the window (or whose marked set changed)
    // first, so the DOM never holds more than one window's worth of marks.
    Object.keys(_findMarked).forEach(function (k) {
      if (!want[k] || !_sameIdxs(_findMarked[k].idxs, want[k])) _unmarkNode(k);
    });
    Object.keys(want).forEach(function (k) {
      _markNode(k, want[k]);
    });
  }

  function _clearFindMarks() {
    Object.keys(_findMarked).forEach(_unmarkNode);
    _findMarked = {};
    _findMarkEls = [];
  }

  function _runFind(query) {
    _clearFindMarks();
    _findMatches = [];
    _findNodes = [];
    _findNodeIdxs = [];
    _findIndex = 0;

    var countEl = _findBarEl && _findBarEl.querySelector('.tv-find-count');

    // C-14: a single character matches so much of any document that marking it
    // is pure cost with no signal. Say nothing rather than "No results" — we
    // have not searched, so claiming zero hits would be a lie.
    if (!query || query.length < _FIND_MIN_QUERY) {
      if (countEl) countEl.textContent = '';
      return;
    }

    var mdEl = document.querySelector('.md');
    if (!mdEl) return;

    _findLen = query.length;
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

    // One pass: record every match POSITION in DOM order. No DOM writes here,
    // so the cost is the walk (cheap) and nothing else.
    var node;
    while ((node = walker.nextNode())) {
      var text = node.textContent;
      if (!text) continue;
      var lText = text.toLowerCase();
      var pos = lText.indexOf(lq);
      if (pos === -1) continue;
      var n = _findNodes.length;
      _findNodes.push(node);
      var own = [];
      while (pos !== -1) {
        own.push(_findMatches.length);
        _findMatches.push({ n: n, s: pos });
        pos = lText.indexOf(lq, pos + lq.length);
      }
      _findNodeIdxs.push(own);
    }

    if (_findMatches.length) {
      _findIndex = 0;
      _highlightFindMatch();
    }

    if (countEl) {
      countEl.textContent = _findMatches.length
        ? (_findIndex + 1) + ' / ' + _findMatches.length
        : 'No results';
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
    // Lazy marking: bring the current match (and its neighbourhood) into the
    // DOM before trying to highlight it.
    _markWindow(_findIndex);
    for (var i = 0; i < _findMarkEls.length; i++) {
      var el = _findMarkEls[i];
      if (el && el.classList) el.classList.toggle('current', i === _findIndex);
    }
    var cur = _findMarkEls[_findIndex];
    if (cur && cur.scrollIntoView) {
      var reduce = window.matchMedia &&
        window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      cur.scrollIntoView({ behavior: reduce ? 'auto' : 'smooth', block: 'center' });
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
      // ISS-FOLDER: recent-folder row → reopen the folder (top-level docs +
      // tree), not as a file. Drop the entry from Recent on success.
      var nfPath = row.getAttribute('data-ntp-folder-path');
      if (nfPath) {
        reopenRecentFolder(nfPath);
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

  /* ────────────────────────────────────────────────────────────
     U-14 / F-20: Tab drag-to-reorder (DR-91–DR-98) — POINTER EVENTS.
     HTML5 drag-and-drop CANNOT be used: Tauri's native drag-drop
     system (`dragDropEnabled`, default true) is required for Finder
     file-drop-to-open and is mutually EXCLUSIVE with DOM drag-and-drop —
     it swallows the `drop` event before the webview ever sees it
     (tauri-apps/tauri#14373; confirmed on macOS WKWebView). Pointer
     events are not intercepted, so reorder uses pointerdown/move/up.
   ──────────────────────────────────────────────────────────── */
  var _ptrDrag = null;            // { id, startX, srcEl, dragging } while reordering
  var _dragIndicatorEl = null;    // current .tv-drop-indicator element
  var _suppressTabClick = false;  // set after a reorder so the trailing click doesn't activate

  // Hit-test the tab under the cursor. Pointer capture makes e.target the source
  // tab, so the real target is resolved via elementFromPoint.
  function _ptrHitTest(clientX, clientY) {
    var el = document.elementFromPoint(clientX, clientY);
    var tabEl = (el && el.closest) ? el.closest('[data-tab-id]') : null;
    if (!tabEl) return null;
    var rect = tabEl.getBoundingClientRect();
    return { tabEl: tabEl, insertBefore: clientX < rect.left + rect.width / 2 };
  }

  // Place (or move) the drop-indicator inside the strip. offsetLeft is strip-local.
  function _placeIndicator(strip, tabEl, insertBefore) {
    var left = insertBefore ? tabEl.offsetLeft : tabEl.offsetLeft + tabEl.offsetWidth;
    if (!_dragIndicatorEl || _dragIndicatorEl.parentNode !== strip) {
      _dragIndicatorEl = document.createElement('div');
      _dragIndicatorEl.className = 'tv-drop-indicator';
      strip.appendChild(_dragIndicatorEl);
    }
    _dragIndicatorEl.style.left = left + 'px';
  }

  function _removeIndicator() {
    if (_dragIndicatorEl && _dragIndicatorEl.parentNode) {
      _dragIndicatorEl.parentNode.removeChild(_dragIndicatorEl);
    }
    _dragIndicatorEl = null;
  }

  function _cleanupDrag() {
    var strip = document.querySelector('.tv-tab-strip');
    if (strip) {
      var draggingEls = strip.querySelectorAll('.tv-tab--dragging');
      for (var di = 0; di < draggingEls.length; di++) draggingEls[di].classList.remove('tv-tab--dragging');
    }
    _removeIndicator();
    _ptrDrag = null;
  }

  function _onTabPointerDown(e) {
    if (e.button !== 0) return;                          // primary button only (middle-click = U-11)
    var tabEl = e.target.closest('[data-tab-id]');
    if (!tabEl) return;
    if (e.target.closest('[data-close-tab]')) return;    // close button → let the click handler run
    _ptrDrag = { id: tabEl.dataset.tabId, startX: e.clientX, srcEl: tabEl, dragging: false };
    try { tabEl.setPointerCapture(e.pointerId); } catch (ex) {}
  }

  function _onTabPointerMove(e) {
    if (!_ptrDrag) return;
    if (!_ptrDrag.dragging) {
      if (Math.abs(e.clientX - _ptrDrag.startX) < 5) return; // movement past threshold = drag, not a click
      _ptrDrag.dragging = true;
      if (_ptrDrag.srcEl) _ptrDrag.srcEl.classList.add('tv-tab--dragging');
    }
    e.preventDefault(); // suppress text selection while dragging
    var strip = e.currentTarget.querySelector('.tv-tab-strip');
    if (!strip) return;
    var hit = _ptrHitTest(e.clientX, e.clientY);
    if (!hit || hit.tabEl.dataset.tabId === _ptrDrag.id) { _removeIndicator(); return; }
    _placeIndicator(strip, hit.tabEl, hit.insertBefore);
  }

  function _onTabPointerUp(e) {
    if (!_ptrDrag) return;
    var pd = _ptrDrag;
    try { if (pd.srcEl && pd.srcEl.releasePointerCapture) pd.srcEl.releasePointerCapture(e.pointerId); } catch (ex) {}

    var didReorder = false;
    if (pd.dragging) {
      // A real drag happened — block the trailing click so it doesn't activate a tab.
      _suppressTabClick = true;
      setTimeout(function () { _suppressTabClick = false; }, 0);

      var hit = _ptrHitTest(e.clientX, e.clientY);
      if (hit && hit.tabEl.dataset.tabId !== pd.id) {
        var srcIdx = -1, destIdx = -1, i;
        for (i = 0; i < state.tabs.length; i++) { if (state.tabs[i].id === pd.id) { srcIdx = i; break; } }
        for (i = 0; i < state.tabs.length; i++) { if (state.tabs[i].id === hit.tabEl.dataset.tabId) { destIdx = i; break; } }
        if (srcIdx !== -1 && destIdx !== -1) {
          if (!hit.insertBefore) destIdx = destIdx + 1;          // "after" slot
          if (destIdx !== srcIdx && destIdx !== srcIdx + 1) {    // not a no-op move
            // Splice with index correction (DR-95): after removing src, shift dest left.
            var tab = state.tabs.splice(srcIdx, 1)[0];
            var insertIdx = (destIdx > srcIdx) ? destIdx - 1 : destIdx;
            state.tabs.splice(insertIdx, 0, tab);
            didReorder = true;
          }
        }
      }
    }
    _cleanupDrag();
    if (didReorder) { render(); saveSession(); }
  }

  function _onTabPointerCancel(e) {
    _cleanupDrag();
  }

  function wireEvents(tvEl) {
    if (!tvEl) return;

    // BUG-4: wire the sidebar drag-resize handle
    wireSidebarResize(tvEl);

    // New-tab page: focus filter input + wire filter/cursor keyboard model
    wireNewTabPage(tvEl);

    // U-14 / F-20: Tab drag-to-reorder (DR-91–DR-98) via POINTER EVENTS.
    // HTML5 DnD can't be used — Tauri's native drag-drop (needed for Finder
    // file-drop) swallows the drop (#14373). Pointer events sidestep it.
    var tabbarEl = tvEl.querySelector('.tv-tabbar');
    if (tabbarEl) {
      tabbarEl.addEventListener('pointerdown',   _onTabPointerDown);
      tabbarEl.addEventListener('pointermove',   _onTabPointerMove);
      tabbarEl.addEventListener('pointerup',     _onTabPointerUp);
      tabbarEl.addEventListener('pointercancel', _onTabPointerCancel);
    }

    // C-32: the tab bar declared role="tablist" but arrow keys did nothing, so
    // the ARIA contract it advertised was not implemented (WCAG 2.1.1 / ARIA
    // APG). Arrows and Home/End move the roving tabindex AND activate, which is
    // the APG's "automatic activation" pattern and matches what ⌘[ / ⌘] do.
    // Delete closes the focused tab — the reason .tv-close can stay out of
    // the Tab order. P2-3: Backspace was dropped — the ARIA APG lists Delete
    // as the optional close key but does not include Backspace, and clicking
    // a tab pill focuses it in WebKit, so a stray Backspace (e.g. typed while
    // aiming for a text field) used to close the focused tab with no
    // confirmation for a clean one.
    if (tabbarEl) {
      tabbarEl.addEventListener('keydown', function (e) {
        var tabEl = e.target && e.target.closest && e.target.closest('[role="tab"][data-tab-id]');
        if (!tabEl) return;
        var ids = state.tabs.map(function (t) { return t.id; });
        if (!ids.length) return;
        var cur = ids.indexOf(tabEl.getAttribute('data-tab-id'));
        if (cur === -1) return;
        var k = e.key;
        var next = -1;

        if (k === 'ArrowRight') next = (cur + 1) % ids.length;
        else if (k === 'ArrowLeft') next = (cur - 1 + ids.length) % ids.length;
        else if (k === 'Home') next = 0;
        else if (k === 'End') next = ids.length - 1;
        else if (k === 'Enter' || k === ' ') {
          e.preventDefault();
          activateTab(ids[cur]);
          return;
        } else if (k === 'Delete') {
          e.preventDefault();
          closeTab(ids[cur]);
          return;
        } else {
          return;
        }

        e.preventDefault();
        activateTab(ids[next]);
        announce(state.tabs[next] ? state.tabs[next].name : '');
        // render() rebuilt the strip, so re-find the pill and move DOM focus
        // with it. Under WKWebView with Full Keyboard Access off this focus()
        // is a no-op — activation and aria-selected still carry the state,
        // which is why activation is not deferred until focus lands.
        requestAnimationFrame(function () {
          var el = document.querySelector('[data-tab-id="' + ids[next] + '"]');
          // C-04: preventScroll — focusing a pill lets the browser scroll the
          // strip to it on its own terms, a frame AFTER render() restored the
          // position and the flush decided whether the pill needed bringing
          // into view. The flush owns positioning; focus only moves the ring.
          if (el && el.focus) el.focus({ preventScroll: true });
        });
      });
    }

    // C-04: keep the strip's edge-fade state honest while the user scrolls it.
    var stripEl = tvEl.querySelector('.tv-tab-strip');
    if (stripEl) {
      stripEl.addEventListener('scroll', function () {
        updateTabStripScroll(tvEl);
      }, { passive: true });
    }

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

    // DR-107: Tab-key focus on #tv-sidebar-listbox seeds the cursor so the user
    // can navigate immediately via arrow keys. Guard: only when sidebar is open.
    var listboxEl = tvEl.querySelector('#tv-sidebar-listbox');
    if (listboxEl) {
      // JANK-01 (QA round 2): DR-107 is about the TAB KEY seeding the cursor —
      // but #tv-sidebar-listbox is .tv-side-scroll, which carries tabindex="0",
      // so a plain mouse click inside the file list also focuses it and used to
      // arm the cursor at whatever stale row it last held. The next render then
      // yanked the list to that row. Swallow focus that came from a pointer;
      // the flag is cleared on the next macrotask, and focus fires synchronously
      // inside pointerdown's default action, so a real Tab focus never sees it.
      var _sbPointerFocus = false;
      listboxEl.addEventListener('pointerdown', function () {
        _sbPointerFocus = true;
        setTimeout(function () { _sbPointerFocus = false; }, 0);
      });
      listboxEl.addEventListener('focus', function () {
        if (!state.sidebarOpen) return;
        if (_sbPointerFocus) { _sbPointerFocus = false; return; }
        var firstOpt = listboxEl.querySelector('[data-sidebar-item],[data-sidebar-tab]');
        if (!firstOpt) return;
        // Restore last-used position if it is still in the DOM; otherwise seed to first
        if (sbKbd.id) {
          var existing = listboxEl.querySelector(
            '[data-sidebar-item="' + CSS.escape(sbKbd.id) + '"],[data-sidebar-tab="' + CSS.escape(sbKbd.id) + '"]'
          );
          if (!existing) sbKbd.id = null;
        }
        if (!sbKbd.id) {
          sbKbd.id = firstOpt.getAttribute('data-sidebar-item') || firstOpt.getAttribute('data-sidebar-tab');
        }
        sbKbd.active = true;
        renderSidebarCursor();
      });
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
        // U-14: a pointer drag-reorder just ended — swallow the trailing click
        // so the dragged tab isn't also activated.
        if (_suppressTabClick) { _suppressTabClick = false; return; }
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

      // ISS-FOLDER: recent FOLDER row click (sidebar + empty-state) → reopen the
      // folder (top-level docs + tree). Distinct attr from data-recent-path so
      // this branch must come first; the file branch below never sees it.
      var recentFolderRow = e.target.closest('[data-recent-folder]');
      if (recentFolderRow) {
        var rfPath = recentFolderRow.getAttribute('data-recent-folder');
        if (rfPath) reopenRecentFolder(rfPath);
        return;
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
              // DR-84: restore stored scrollTop for the created tab.
              // No tv:rendered event exists; openInto/openDoc have no nativeScrollTop
              // param — mutate the tab directly so the next render() applies it.
              var recentEntries = loadRecentEntries();
              var recentEntry = null;
              for (var ri = 0; ri < recentEntries.length; ri++) {
                if (recentEntries[ri].path === rpath) { recentEntry = recentEntries[ri]; break; }
              }
              if (recentEntry && recentEntry.scrollTop) {
                var created = state.tabs.find(function (t) { return t.nativePath === rpath; });
                if (created) created.scrollTop = recentEntry.scrollTop;
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
        // ISS-FOLDER: recent-folder NTP row → reopen the folder (not as a file).
        var ntpFolderPath = ntpRow.getAttribute('data-ntp-folder-path');
        if (ntpFolderPath) {
          reopenRecentFolder(ntpFolderPath);
          return;
        }
        var ntpPath = ntpRow.getAttribute('data-ntp-path');
        if (ntpPath) {
          openRecentIntoUntitled(ntpPath);
          return;
        }
        return;
      }

      // C-29: "Show N more files" — re-scan this folder uncapped.
      var moreRow = e.target.closest('[data-tree-more]');
      if (moreRow) {
        loadMoreFolder(moreRow.getAttribute('data-tree-more'));
        return;
      }

      // C-16: the empty sidebar's "Open folder…" button (same path as ⌘⇧O).
      if (e.target.closest('[data-open-folder]')) {
        openFolder();
        return;
      }

      // C-06: ⌄ — list every open tab when the strip has scrolled some away.
      var tofBtn = e.target.closest('[data-tab-overflow]');
      if (tofBtn) {
        if (_tabOverflowEl) closeTabOverflow();
        else openTabOverflow(tofBtn);
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

      // Edit toolbar: exit edit — C-33: same path as Esc, so the button and
      // the key can never mean different things.
      if (e.target.closest('[data-edit-esc]')) {
        discardEdits();
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

      // F-19 TASK 2: folder tree file row click — open or activate.
      // SBH-03 (Fix 3): a SINGLE click is a preview — it opens into the one
      // transient tab, which the next single click replaces. Double-click pins
      // (see the dblclick handler below). A file that is already open just
      // activates, keeping whatever pinned/transient state it already had.
      var treeFileRow = e.target.closest('[data-tree-file-path]');
      if (treeFileRow) {
        var tfPath = treeFileRow.getAttribute('data-tree-file-path');
        // If already a tab, just activate it (DR-34)
        var existingTabId = treeFileRow.getAttribute('data-tree-tab-id');
        if (existingTabId) {
          activateTab(existingTabId);
        } else {
          _openTreeFilePath(tfPath, true);
        }
        return;
      }
    });

    // SBH-03 (Fix 3): double-click a tree file row, or a tab, to PIN it —
    // the tab goes upright and persists until closed. The preceding single
    // click has already opened/activated the file, so this only flips the flag.
    tvEl.addEventListener('dblclick', function (e) {
      var dblTab = e.target.closest('[data-tab-id]');
      if (dblTab) {
        pinTab(dblTab.getAttribute('data-tab-id'));
        return;
      }
      var dblFileRow = e.target.closest('[data-tree-file-path]');
      if (dblFileRow) {
        var dblPath = dblFileRow.getAttribute('data-tree-file-path');
        // Prefer the row's own tab id, then a live lookup by path. On a FIRST
        // open neither exists yet: the preceding single click kicked off an
        // async read_md_file that has not resolved, so the tab is still being
        // created. Latch the intent instead of dropping it — _openTreeFilePath
        // applies it the moment the tab lands.
        var dblTabId = dblFileRow.getAttribute('data-tree-tab-id') || _tabIdByNativePath(dblPath);
        if (dblTabId) pinTab(dblTabId);
        else _pendingPinPath = dblPath;
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
      // ISS-FOLDER: recent FOLDER row right-click. The file context menu
      // (openFileCtx) assumes a single file (Reveal/Copy-Path/Open-as-file), so
      // it must NOT fire for a folder. Reveal the folder in Finder (the one
      // action that cleanly applies to a closed recent folder); suppress the
      // native WebKit menu. Must precede the data-recent-path branch.
      var recentFolderRowCtx = e.target.closest('[data-recent-folder]');
      if (recentFolderRowCtx) {
        e.preventDefault();
        var rfCtxPath = recentFolderRowCtx.getAttribute('data-recent-folder');
        if (rfCtxPath) revealInFinder(rfCtxPath);
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

  // C-02: the native shell asks JS whether quitting would drop unsaved work.
  // Kept as a pair (count + names) so Rust can build a confirm sheet that
  // actually names the files rather than saying "some documents".
  function hasDirtyTabs() {
    var n = 0;
    for (var i = 0; i < state.tabs.length; i++) {
      if (state.tabs[i].dirty) n++;
    }
    return n;
  }

  function dirtyTabNames() {
    var out = [];
    for (var i = 0; i < state.tabs.length; i++) {
      if (state.tabs[i].dirty) out.push(state.tabs[i].name || 'Untitled');
    }
    return out;
  }

  function openDoc(opts) {
    if (!opts || !opts.name) return null;

    // JANK-02: a transient open runs dropTransientTab (→ _doCloseTab → render)
    // and then activateTab (→ render). Batched, the caller sees one repaint
    // instead of watching the outgoing preview tab's layout land on screen
    // before the incoming one replaces it. Still fully synchronous: openDoc
    // returns with the DOM already painted, as every caller assumes.
    return batchRender(function () {
      // Deduplicate: if a tab with same key already exists, just activate it
      var key = tabKey(opts);
      for (var i = 0; i < state.tabs.length; i++) {
        if (tabKey(state.tabs[i]) === key) {
          var open = state.tabs[i];
          // C-42: re-opening a path whose content has changed used to activate
          // the tab and silently drop the incoming bytes, so the app claimed to
          // show a file while displaying superseded content. Refresh a CLEAN
          // tab; never overwrite unsaved work.
          // activateTab → _doActivateTab saves this tab's live scrollTop and
          // render() restores it, so the refresh keeps the reading position
          // (DR-03) and does not scrolljack (DR-10).
          // P2-8: refreshing the tab that is BOTH active AND in edit mode
          // fights _doActivateTab's own edit-mode commit safety net —
          // writing the fresh disk bytes into open.source here, then
          // activating the (same) tab below, makes _doActivateTab see
          // editTextarea.value !== outgoing.source and "helpfully" write
          // the stale textarea value straight back over the refresh,
          // marking the tab dirty in the process. Treat that case like a
          // dirty tab: skip the refresh and say why, rather than silently
          // losing it a few lines later.
          var editingThisTab = (state.mode === 'edit' && state.activeId === open.id);
          if (opts.source != null && opts.source !== open.source) {
            if (open.dirty || editingThisTab) {
              if (window.TVNative && typeof TVNative.showToast === 'function') {
                TVNative.showToast(editingThisTab
                  ? 'Not refreshed. You are editing this file.'
                  : 'Already open with unsaved changes');
              }
            } else {
              open.source = opts.source;
              open.savedSource = opts.source;
              open.error = null;
            }
          }
          activateTab(open.id);
          return open.id;
        }
      }

      // SBH-03: a transient (preview) open REPLACES the current preview tab
      // rather than stacking beside it. Dropped BEFORE the new tab is pushed so
      // the strip never momentarily shows two previews.
      if (opts.transient) dropTransientTab();

      var tab = makeTab(opts);
      state.tabs.push(tab);
      activateTab(tab.id);
      return tab.id;
    });
  }

  /* ── SBH-03: transient (preview) tab helpers ────────────────── */

  // Close the current transient tab, if any. Silent by design: a transient tab
  // can never be dirty, because the first edit pins it (see setMode) — so there
  // is nothing to prompt about. The native per-file watch is released
  // explicitly, mirroring closeFolder: _doCloseTab → TVLive.stop only unwatches
  // when a live watchState exists, which would otherwise leak an FSEvents watcher.
  function dropTransientTab(exceptId) {
    for (var i = 0; i < state.tabs.length; i++) {
      var t = state.tabs[i];
      if (t.transient && t.id !== exceptId) {
        if (t.nativePath && window.TVNative && typeof TVNative.stopWatch === 'function') {
          TVNative.stopWatch({ nativePath: t.nativePath });
        }
        _doCloseTab(t.id, i);
        return t.id;
      }
    }
    return null;
  }

  // Native path → tab id, or null. Used by the pin paths, which are handed a
  // file path by the DOM but must act on a tab.
  function _tabIdByNativePath(p) {
    if (!p) return null;
    for (var i = 0; i < state.tabs.length; i++) {
      if (state.tabs[i].nativePath === p) return state.tabs[i].id;
    }
    return null;
  }

  // Set when a double-click landed before the file's async read resolved, so
  // the tab did not exist yet to pin. _openTreeFilePath consumes it once the
  // tab lands. Holds at most one path — a newer double-click supersedes it.
  var _pendingPinPath = null;

  // SBH-03 (QA D3): paths with a read_md_file call in flight. A double-click
  // fires two clicks; without this the second read lands after the first tab
  // exists and opens the same file a second time.
  var _openingPaths = {};

  // Pin a tab: it stops being the replaceable preview and persists until
  // closed. Triggered by double-clicking the file row or its tab, and
  // automatically on entering edit mode. No-op (and no render) when the tab is
  // already pinned, so repeat double-clicks stay cheap.
  function pinTab(tabId) {
    if (!tabId) return false;
    for (var i = 0; i < state.tabs.length; i++) {
      if (state.tabs[i].id === tabId) {
        if (!state.tabs[i].transient) return false;
        state.tabs[i].transient = false;
        render();
        return true;
      }
    }
    return false;
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

  // ISS-FOLDER: reopen a folder recorded in Recent. Mirrors a REAL folder open
  // (top-level docs as tabs AND the registered tree — tree-only reopen is lossy)
  // WITHOUT the native picker, since the path is already known. On success the
  // entry is removed from Recent (it's now open). If the folder can't be read
  // (moved/deleted) the native helper shows a VISIBLE toast and rejects; we then
  // drop the dead entry and re-render so it disappears from the launcher/sidebar.
  function reopenRecentFolder(path) {
    if (!path) return;
    if (window.TVNative && typeof TVNative.reopenFolder === 'function') {
      TVNative.reopenFolder(path)
        .then(function () {
          removeRecentEntry(path, 'folder'); // now open → no longer "recent"
          render();
        })
        .catch(function () {
          // Toast already surfaced by TVNative.reopenFolder. Drop the dead entry.
          removeRecentEntry(path, 'folder');
          render();
        });
      return;
    }
    // No native bridge (plain browser) — nothing we can do but surface a notice.
    if (window.TVNative && typeof TVNative.showToast === 'function') {
      TVNative.showToast('Reopening folders requires the desktop app');
    }
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
    // JANK-02: skip when a batched render is already owed — .tv-scroll then holds
    // some other tab's content and would overwrite `outgoing` with its offset.
    var scrollEl = domMatchesState() ? document.querySelector('[data-scroll]') : null;
    if (scrollEl && outgoing) {
      outgoing.scrollTop = scrollEl.scrollTop;
    }

    state.activeId = id;
    state.mode = 'reading';

    // Bug B: scroll the newly-active tab pill into view so it is never hidden
    // behind the strip's overflow. JANK-02: latched rather than done inline
    // after render(), because under batchRender() this render() may be deferred
    // to the end of the batch — the pill does not exist yet at this point.
    // render() consumes the latch once it has actually painted.
    _pendingTabScrollId = id;

    render();
    // F6: scroll restore is handled inside render() via the [data-scroll] restore block
    // (covers all render paths); duplicate restore here has been removed.

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

  /* ── C-35: keyboard entry into edit mode lands where you were ── */
  // The same block tags tv-edit.js's dblclick capture walks up to, so both
  // paths feed _findAnchorOffset the same kind of text.
  var _EDIT_ANCHOR_BLOCKS = 'p,h1,h2,h3,h4,h5,h6,li,pre,blockquote,td,th,figure';

  // Set when the reading view was at the very top as we entered edit mode.
  var _editEnteredAtTop = false;

  function _seedEditAnchorFromViewport() {
    _editEnteredAtTop = false;
    if (typeof window === 'undefined') return;
    // A double-click already set a precise anchor — never overwrite it.
    if (window._tvEditAnchor || window._tvEditAnchorText) return;
    var scroll = document.querySelector('.tv-scroll');
    var md = document.querySelector('.md');
    if (!scroll || !md) return;
    _editEnteredAtTop = scroll.scrollTop <= 1;
    var top = scroll.getBoundingClientRect().top;
    var blocks = md.querySelectorAll(_EDIT_ANCHOR_BLOCKS);
    for (var i = 0; i < blocks.length; i++) {
      var r = blocks[i].getBoundingClientRect();
      if (r.bottom <= top + 1) continue;   // fully scrolled past
      var txt = (blocks[i].textContent || '').trim().slice(0, 120);
      if (!txt) continue;
      // No window24: this is a BLOCK anchor, so tv-edit uses the block-text
      // path (_findAnchorOffset), not the sub-word caretRangeFromPoint path.
      window._tvEditAnchor = { blockText: txt, window24: null };
      window._tvEditAnchorText = txt;
      return;
    }
  }

  // C-35: the anchor above lands the CARET correctly, but the viewport does not
  // follow it — tv-edit's wire() calls textarea.focus() before applying the
  // anchor, and the browser scrolls to the caret's default (end-of-text)
  // position. tv-edit has scroll-correction code for exactly this, but it looks
  // the container up with rootEl.closest('.tv-scroll') while rootEl is the .tv
  // ROOT, an ancestor of .tv-scroll — so it resolves to null and never runs.
  // That one-word fix lives in tv-edit.js (modules owns it; filed in
  // plan/requests-shell.md). Until it lands, guarantee the case this item
  // actually names: entering edit mode from the TOP of a document opens the
  // source at the top. No heuristic, no proportional mapping — exact or
  // nothing, which is the narrow subset the reviewers endorsed.
  function _restoreEditEntryScroll() {
    if (!_editEnteredAtTop) return;
    _editEnteredAtTop = false;
    // Two frames: tv-edit schedules its caret work in a rAF from inside
    // render(), so one frame guarantees we run after it and the second absorbs
    // any layout the auto-resize triggers.
    requestAnimationFrame(function () {
      requestAnimationFrame(function () {
        if (state.mode !== 'edit') return;
        var ta = document.querySelector('[data-edit-area]');
        var sc = document.querySelector('.tv-scroll');
        if (!sc || !ta || ta.selectionStart > 0) return; // caret is not at line 1
        sc.scrollTop = 0;
      });
    });
  }

  function setMode(m) {
    if (m !== 'reading' && m !== 'edit') return;
    // Untitled new-tab pages have no document to edit — central guard that
    // makes ⌘E, dblclick, and any future setMode('edit') caller a no-op.
    if (m === 'edit') {
      var t = getActiveTab();
      if (t && t.untitled) return;
      // C-03: an error tab has no usable source (buildViewer renders the
      // recovery card instead), so entering edit mode gave a titlebar that
      // said "editing" over a screen with no editor. Guarded on the edit
      // DIRECTION only, so the edit→reading reset on tab switch still runs.
      if (t && t.error) return;
      // SBH-03: editing a file pins it. A preview you have started changing is
      // no longer disposable — without this the next single click in the tree
      // would silently replace a tab holding unsaved edits.
      if (t && t.transient) t.transient = false;
      // C-35: ⌘E (or the pencil, or the palette) has no click anchor, so
      // tv-edit fell through to "place the caret at EOF" and the source opened
      // scrolled to the bottom — pressing ⌘E at the TOP of a document put line
      // 1 off screen. Seed the same anchor a double-click would have set, from
      // the topmost block currently visible, and let the existing
      // block→source-line mapping do the rest. Only when nothing else set one,
      // so the ISS-001 double-click path (tv-edit.js:589) is untouched.
      if (state.mode !== 'edit') _seedEditAnchorFromViewport();
    }
    var enteringEdit = (m === 'edit' && state.mode !== 'edit');
    state.mode = m;
    render();
    // C-35: after the editor exists and tv-edit has placed the caret.
    if (enteringEdit) _restoreEditEntryScroll();
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
    // C-36: one appearance truth. `t` is the CHOICE the user made
    // ('light'|'dark'|'system'); state.theme is the resolved paint. Rust
    // re-checks the right Appearance item from the choice, so send both.
    tvEmit('themechange', { theme: state.theme, choice: t });
    if (window.TVNative && typeof TVNative.notifyTheme === 'function') {
      TVNative.notifyTheme(t, state.theme);
    }
  }

  function setAccent(a) {
    if (a !== 'blue' && a !== 'graphite' && a !== 'warm') return;
    state.accent = a;
    localStorage.setItem('tv-accent', a);
    render();
  }

  function toggleSidebar() {
    var wasOpen = state.sidebarOpen;
    state.sidebarOpen = !state.sidebarOpen;
    // F-09: an explicit user toggle pins the choice — the responsive
    // ResizeObserver stops auto-adjusting the sidebar default after this.
    state.sidebarUserToggled = true;
    // Closing: clear the keyboard cursor BEFORE render() so the stale .kbd-cursor
    // class isn't painted onto the (now hidden) listbox.
    if (wasOpen && !state.sidebarOpen) sbKbd.active = false;
    render();
    // DR-113: when ⌘B opens the sidebar, seed the keyboard cursor to the first
    // option so the user can navigate immediately via arrow keys — new work.
    if (!wasOpen && state.sidebarOpen) {
      requestAnimationFrame(function () {
        var listbox = document.getElementById('tv-sidebar-listbox');
        if (!listbox) return;
        var firstOpt = listbox.querySelector('[data-sidebar-item],[data-sidebar-tab]');
        if (firstOpt) {
          sbKbd.active = true;
          sbKbd.id = firstOpt.getAttribute('data-sidebar-item') || firstOpt.getAttribute('data-sidebar-tab');
          renderSidebarCursor();
        }
      });
    }
  }

  // C-20: the editor's type scales with the reading view. 13 px at the 16 px
  // default, proportional either side, floored at 11 and capped at 18 — the
  // editor is a monospaced source view, so it neither shrinks past legibility
  // nor grows to the point that a wrapped line stops looking like source.
  function editFontFor(bodyPx) {
    return Math.max(11, Math.min(18, Math.round(13 * (bodyPx / 16))));
  }

  // F-05/U-07: Font size control — DR-27: floor 13px, cap 22px (DR-29: persisted)
  function setFontSize(px) {
    // DR-28: the clamp is SILENT by design — ⌘= at 22 and ⌘− at 13 do nothing
    // and say nothing. Unchanged.
    var clamped = Math.max(13, Math.min(22, px));
    state.fontSize = clamped;
    localStorage.setItem('tv-font-size', String(clamped));
    // Apply without full render — just update the CSS variables on the .tv root
    var tvRoot = document.querySelector('.tv');
    if (tvRoot) {
      tvRoot.style.setProperty('--tv-md-font', clamped + 'px');
      // C-20: the editor textarea used to stay locked at 13 px however far you
      // zoomed the reading view — an accessibility control that half worked.
      tvRoot.style.setProperty('--tv-edit-font', editFontFor(clamped) + 'px');
    }
    // C-20: so the palette's Increase / Decrease rows can show the current size
    // instead of a new on-screen chip (DR-31: zero-pixel chrome budget).
    tvEmit('fontsize', clamped);
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
        // C-38: the dot is not the only dirty indicator any more — the window
        // title and the in-app title carry it too, and this path skips render().
        _syncTitles();
        // C-33: nor is it the only thing the dirty flag drives — the edit
        // toolbar's exit button says "Discard" only once there is something to
        // discard, and onInput reaches us through this render-free path.
        _syncEditEscLabel();
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

    // C-39: same precedence as buildTabbar — error beats live beats dirty. The
    // ⚠ is rendered by buildTabbar and must survive this partial update, so
    // bail before re-inserting anything else.
    if (tab.error) return;

    if (tab.liveActive && isDirty) {
      var boltSpan = document.createElement('span');
      boltSpan.className = 'tv-bolt';
      boltSpan.innerHTML = icons.bolt || '';
      var dotSpan = document.createElement('span');
      dotSpan.className = 'tv-dot';
      tabEl.insertBefore(dotSpan, nameEl);
      tabEl.insertBefore(boltSpan, dotSpan);
    } else if (tab.liveActive) {
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

  // Public: refresh a single tab's lead indicators (bolt/dot) in the tab strip
  // without a full render. tv-live.js calls this when tab.liveActive flips so the
  // live bolt appears/disappears in lockstep with the bottom status bar.
  function updateTabIndicator(id) {
    var tab = null;
    for (var i = 0; i < state.tabs.length; i++) {
      if (state.tabs[i].id === id) { tab = state.tabs[i]; break; }
    }
    _updateTabDot(id, !!(tab && tab.dirty));
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
  /* ── C-33: Esc discards (user decision, 2026-08-21) ─────────── */
  // Esc previously exited edit mode and silently KEPT the edits, which inverts
  // the near-universal meaning of Esc as cancel. It now reverts the buffer to
  // the last on-disk content — with one level of undo, because a destructive
  // action with no way back is worse than the ambiguity it replaces.
  //   Esc  discard (this)      ⌘E  keep the edits, just switch to reading
  //   ⌘S   save                ⌘Z  (reading mode) restore what Esc discarded
  function discardEdits() {
    var tab = getActiveTab();
    if (!tab) return;

    // Nothing typed → Esc is just "leave edit mode". No toast, nothing lost.
    if (!tab.dirty || tab.savedSource == null || tab.source === tab.savedSource) {
      setMode('reading');
      return;
    }

    // The textarea is the live truth; onInput keeps tab.source in step, but a
    // composition still in flight would not have fired yet.
    var ta = document.querySelector('[data-edit-area]');
    if (ta && ta.value !== tab.source) tab.source = ta.value;

    tab.discarded = { source: tab.source, at: Date.now() };
    tab.source = tab.savedSource;
    tab.dirty = false;
    tab._editCursorPos = null;

    setMode('reading'); // renders
    if (window.TVNative && typeof TVNative.showToast === 'function') {
      TVNative.showToast('Edits discarded. ⌘Z restores them.');
    }
  }

  // Put back the edits the last Esc threw away and return to edit mode.
  // Exposed on window.TV so tv-palette.js can offer it as a command; also
  // bound to ⌘Z in reading mode.
  function restoreDiscardedEdits(tabId) {
    var tab = null;
    if (tabId) {
      for (var i = 0; i < state.tabs.length; i++) {
        if (state.tabs[i].id === tabId) { tab = state.tabs[i]; break; }
      }
    } else {
      tab = getActiveTab();
    }
    if (!tab || !tab.discarded) return false;

    var restored = tab.discarded.source;
    tab.discarded = null;
    batchRender(function () {
      if (tab.id !== state.activeId) activateTab(tab.id);
      tab.source = restored;
      markDirty(tab.id, true);
      setMode('edit');
    });
    return true;
  }

  function hasDiscardedEdits(tabId) {
    var tab = null;
    if (tabId) {
      for (var i = 0; i < state.tabs.length; i++) {
        if (state.tabs[i].id === tabId) { tab = state.tabs[i]; break; }
      }
    } else {
      tab = getActiveTab();
    }
    return !!(tab && tab.discarded);
  }

  // C-03: one place that reports a browser save which did not write. Stays in
  // edit mode in every branch — the buffer is the only copy of the user's work.
  // `err` may be null (writeFile resolved but the tab is still dirty).
  function _saveDidNotLand(tab, err) {
    var aborted = !!(err && (err.name === 'AbortError' || err === 'AbortError'));
    var msg = aborted
      ? 'Save cancelled'
      : 'Save failed. Your edits are still here.';
    console.warn('[Galley] browser save did not write:', err || '(resolved, still dirty)');
    if (window.TVNative && typeof TVNative.showToast === 'function') {
      // A cancel is the user's own doing — quiet. A failure is an error.
      TVNative.showToast(msg, aborted ? {} : { kind: 'error' });
    }
    // Deliberately NOT setMode('reading'): the app must not signal "saved".
  }

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
        // P0-2: save_md_file_as resolves (does not reject) when the user
        // cancels the native panel — saveTab leaves tab.dirty untouched in
        // that case (see TVNative.saveTab's C-02 comment). Mirror the browser
        // branch below: only claim "saved" when the dirty flag was actually
        // cleared, otherwise treat it as a cancel and stay in edit mode.
        if (!tab.dirty) { _markSaved(tab); setMode('reading'); return; }
        _saveDidNotLand(tab, null);
      }).catch(function (err) {
        // N-06: surface save failure as toast, keep user in edit mode
        console.warn('[Galley] native save failed:', err);
        if (window.TVNative && typeof TVNative.showToast === 'function') {
          // C-03: same channel and same severity as the browser branch.
          TVNative.showToast('Save failed: ' + (err || 'unknown error'), { kind: 'error' });
        }
        // Do NOT call setMode('reading') — keep user in edit mode to retry
      });
      return;
    }

    // Browser: delegate to TVFiles.writeFile (handles fileHandle, showSaveFilePicker,
    // or download fallback). TVFiles.writeFile(tab) calls markDirty internally.
    if (window.TVFiles && typeof TVFiles.writeFile === 'function') {
      TVFiles.writeFile(tab).then(function () {
        // C-03: leaving edit mode is this app's "saved" signal, so it must be
        // earned. A resolved promise is NOT proof: writeFile currently swallows
        // its own errors and resolves anyway. tab.dirty is the honest witness —
        // markDirty(id, false) fires only on a real write (or a download).
        if (!tab.dirty) { _markSaved(tab); setMode('reading'); return; }
        _saveDidNotLand(tab, null);
      }).catch(function (err) {
        _saveDidNotLand(tab, err);
      });
      return;
    }

    // Last resort: no save mechanism available — just clear dirty and exit
    tab.dirty = false;
    _markSaved(tab);
    setMode('reading');
  }

  // C-33: the buffer just became the on-disk content. The one-shot discard undo
  // is dropped here — once the edits are on disk, "restore discarded edits"
  // would put back a state that predates what the user chose to keep.
  function _markSaved(tab) {
    if (!tab) return;
    tab.savedSource = tab.source;
    tab.discarded = null;
  }

  /* ── F-03: Open Folder ────────────────────────────────────── */
  function openFolder() {
    if (!window.__TAURI__) return;
    // F-19 / ISS-005: delegate to TVNative.openFolder, which opens the docs AND
    // registers the folder tree on state.openFolders so the sidebar renders the
    // nested tree + close-folder button (buildFolderSection). Without this the
    // files only ever show as a flat grouped-by-path list (no folder head, no ×).
    if (window.TVNative && typeof TVNative.openFolder === 'function') {
      TVNative.openFolder();
      return;
    }
    // B1: pick_folder now returns { path, files } (FolderPick). Branch cancel
    // vs real pick on res.path being NON-EMPTY (NOT files.length) so a folder
    // whose md files live only in subfolders still opens. Iterate res.files.
    window.__TAURI__.core.invoke('pick_folder')
      .then(function (res) {
        var folderPath = res && res.path;
        if (!folderPath) return; // empty path → cancelled
        var docs = (res && res.files) || [];
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
        // Register the sidebar tree from the CHOSEN path so a subfolders-only
        // folder still gets a section (parity with TVNative.openFolder).
        if (window.TVNative && typeof TVNative.readDirTree === 'function') {
          TVNative.readDirTree(folderPath).then(function (tree) {
            if (tree) registerFolder(tree);
          }).catch(function (err) {
            console.warn('[TV] readDirTree failed after pick_folder', folderPath, err);
          });
        }
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
                  e.key === 'ArrowLeft' || e.key === 'ArrowRight' ||
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
        // DR-112: return keyboard attention to content pane. The only permitted
        // element.focus() in this feature — requires .tv-scroll tabindex="0" (buildViewer).
        var scrollEl = document.querySelector('.tv-scroll');
        if (scrollEl) scrollEl.focus();
      }
      return; // return so arrows/Enter/etc below don't run on Escape
    }

    // All remaining nav keys (arrows, Enter, Space, Home, End) only act when
    // the sidebar keyboard cursor is active. Otherwise let the browser handle
    // them (e.g. arrow keys scroll content normally).
    if (!sbKbd.active) return;

    var listbox = document.getElementById('tv-sidebar-listbox');
    if (!listbox) return;
    // DR-108: widen query to cover all option row types (folder-head, subfolder, recent, file)
    var opts = Array.prototype.slice.call(
      listbox.querySelectorAll('[role="option"][data-sidebar-tab],[role="option"][data-sidebar-item]')
    );
    if (!opts.length) return;

    // DR-108: read key from data-sidebar-item (preferred) or data-sidebar-tab (open-file legacy)
    function _optKey(el) {
      return el.getAttribute('data-sidebar-item') || el.getAttribute('data-sidebar-tab');
    }

    // Find current cursor index (fallback to 0)
    var curIdx = 0;
    for (var i = 0; i < opts.length; i++) {
      if (_optKey(opts[i]) === sbKbd.id) {
        curIdx = i; break;
      }
    }

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      var nextIdx = Math.min(curIdx + 1, opts.length - 1);
      sbKbd.id = _optKey(opts[nextIdx]);
      renderSidebarCursor();
      return;
    }

    if (e.key === 'ArrowUp') {
      e.preventDefault();
      var prevIdx = Math.max(curIdx - 1, 0);
      sbKbd.id = _optKey(opts[prevIdx]);
      renderSidebarCursor();
      return;
    }

    if (e.key === 'Home') {
      e.preventDefault();
      sbKbd.id = _optKey(opts[0]);
      renderSidebarCursor();
      return;
    }

    if (e.key === 'End') {
      e.preventDefault();
      sbKbd.id = _optKey(opts[opts.length - 1]);
      renderSidebarCursor();
      return;
    }

    // DR-110: ArrowLeft / ArrowRight — collapse/expand folder sections
    if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
      e.preventDefault();
      var curEl = null;
      for (var j = 0; j < opts.length; j++) {
        if (_optKey(opts[j]) === sbKbd.id) { curEl = opts[j]; break; }
      }
      if (!curEl) return;
      var itemKey = curEl.getAttribute('data-sidebar-item') || '';
      var toggleKey = curEl.getAttribute('data-folder-toggle');
      var isFolderRow = (itemKey.indexOf('folder:') === 0 ||
                         itemKey.indexOf('subfolder:') === 0);
      if (isFolderRow && toggleKey) {
        var isCollapsed = !!state.folderCollapsed[toggleKey];
        if (e.key === 'ArrowLeft') {
          if (!isCollapsed) {
            // Collapse the section
            toggleFolderCollapse(toggleKey);
            requestAnimationFrame(function () { renderSidebarCursor(); });
          }
          // If already collapsed: no-op (no parent navigation — one level only)
        } else {
          // ArrowRight
          if (isCollapsed) {
            // Expand the section
            toggleFolderCollapse(toggleKey);
            requestAnimationFrame(function () {
              // Move cursor to first child file row after expansion
              var lb = document.getElementById('tv-sidebar-listbox');
              if (!lb) return;
              var newOpts = Array.prototype.slice.call(
                lb.querySelectorAll('[role="option"][data-sidebar-tab],[role="option"][data-sidebar-item]')
              );
              // Find the folder row and pick the next row after it
              var fIdx = 0;
              for (var k = 0; k < newOpts.length; k++) {
                var nk = newOpts[k].getAttribute('data-sidebar-item') || newOpts[k].getAttribute('data-sidebar-tab');
                if (nk === sbKbd.id) { fIdx = k; break; }
              }
              if (fIdx + 1 < newOpts.length) {
                var nextEl = newOpts[fIdx + 1];
                var nextKey = nextEl.getAttribute('data-sidebar-item') || nextEl.getAttribute('data-sidebar-tab');
                sbKbd.id = nextKey;
              }
              renderSidebarCursor();
            });
          }
          // If already expanded: no-op (cursor stays on folder row)
        }
      }
      // ArrowLeft/Right on file rows: no-op per spec
      return;
    }

    // DR-111: Enter/Space — dispatch-first: inspect data-sidebar-item prefix before
    // falling through to activateTab. This fixes the silent misroute of path-keyed rows.
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      if (!sbKbd.id) return;

      // Find the current cursor element to inspect its attributes
      var cursorEl = null;
      for (var m = 0; m < opts.length; m++) {
        if (_optKey(opts[m]) === sbKbd.id) { cursorEl = opts[m]; break; }
      }
      if (!cursorEl) return;

      var sidebarItem = cursorEl.getAttribute('data-sidebar-item') || '';

      // (0) C-29: "Show N more files" — checked before the folder prefixes so
      // the interactive footer row is reachable by keyboard, not mouse only.
      if (sidebarItem.indexOf('more:') === 0) {
        loadMoreFolder(cursorEl.getAttribute('data-tree-more'));
        requestAnimationFrame(function () { renderSidebarCursor(); });
        return;
      }

      // (1) Folder / subfolder toggle
      if (sidebarItem.indexOf('folder:') === 0 ||
          sidebarItem.indexOf('subfolder:') === 0) {
        var ftoggleKey = cursorEl.getAttribute('data-folder-toggle');
        if (ftoggleKey) {
          toggleFolderCollapse(ftoggleKey);
          requestAnimationFrame(function () { renderSidebarCursor(); });
        }
        return;
      }

      // (2) Folder-tree file row (file:<nativePath>)
      if (sidebarItem.indexOf('file:') === 0) {
        var tfPath = cursorEl.getAttribute('data-tree-file-path');
        var existingTabId = cursorEl.getAttribute('data-tree-tab-id');
        if (existingTabId) {
          activateTab(existingTabId);
        } else if (tfPath) {
          _openTreeFilePath(tfPath);
        }
        requestAnimationFrame(function () { renderSidebarCursor(); });
        return;
      }

      // (3a) Recent FOLDER row (recent-folder:<path>) — reopen the folder, not
      // open-as-file. Checked before the recent: file branch (distinct prefix).
      if (sidebarItem.indexOf('recent-folder:') === 0) {
        var rfKbdPath = cursorEl.getAttribute('data-recent-folder');
        if (rfKbdPath) reopenRecentFolder(rfKbdPath);
        return;
      }

      // (3) Recent row (recent:<path>)
      if (sidebarItem.indexOf('recent:') === 0) {
        var rpath = cursorEl.getAttribute('data-recent-path');
        if (rpath && window.TVNative && TVNative.available) {
          window.__TAURI__.core.invoke('read_md_file', { path: rpath })
            .then(function (doc) {
              if (window.TVNative && typeof TVNative.openInto === 'function') {
                TVNative.openInto(doc);
              }
              // DR-84: restore stored scrollTop for the created tab (parity with the
              // click path) — mutate the tab directly so the next render() applies it.
              var kEntries = loadRecentEntries();
              var kEntry = null;
              for (var ki = 0; ki < kEntries.length; ki++) {
                if (kEntries[ki].path === rpath) { kEntry = kEntries[ki]; break; }
              }
              if (kEntry && kEntry.scrollTop) {
                var kCreated = state.tabs.find(function (t) { return t.nativePath === rpath; });
                if (kCreated) kCreated.scrollTop = kEntry.scrollTop;
              }
            })
            .catch(function (err) {
              console.warn('[TV] recent file keyboard open failed', rpath, err);
              var kind = (window.TVNative && typeof TVNative.classifyReadError === 'function')
                ? TVNative.classifyReadError(err) : 'not-found';
              openErrorTab(rpath.split('/').pop() || rpath, rpath, kind);
            });
        }
        return;
      }

      // (4) Open-file row with data-sidebar-tab only — fall through to activateTab
      if (cursorEl.getAttribute('data-sidebar-tab') && !sidebarItem) {
        activateTab(sbKbd.id);
        // activateTab → render → renderSidebarCursor (called inside render).
        // sbKbd.active stays true so arrows keep working post-Enter.
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
        // C-33 (user decision): Esc DISCARDS the edits rather than silently
        // keeping them. ⌘E is the "keep them, just read" exit; ⌘Z undoes this.
        discardEdits(); e.preventDefault(); return;
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

    // C-18 / C-36: ⌘G / ⇧⌘G — find next / previous. Only while the find bar is
    // open, so ⌘G never swallows the keystroke in a document with no search
    // running. _findStep stays the single stepping path (see C-14).
    if (k === 'g' || k === 'G') {
      if (_findOpen) {
        e.preventDefault();
        _findStep(e.shiftKey ? -1 : 1);
      }
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

    // C-33: ⌘Z in READING mode puts back what Esc just discarded. In edit mode
    // ⌘Z is the textarea's own undo and must not be intercepted, and neither
    // must it be while any text field has focus.
    if (k === 'z' || k === 'Z') {
      if (state.mode === 'reading' && !e.shiftKey) {
        var zFocused = document.activeElement;
        var zInInput = zFocused && (
          zFocused.tagName === 'INPUT' || zFocused.tagName === 'TEXTAREA' ||
          zFocused.isContentEditable
        );
        if (!zInInput && hasDiscardedEdits()) {
          e.preventDefault();
          restoreDiscardedEdits();
          return;
        }
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

    // U-15 / DR-99: ⌘P — Print / Export to PDF
    // The if(!meta) guard above ensures this block is meta-only.
    // The activeElement check is required in addition: a focused <textarea>
    // or <input> must not trigger window.print() — let the browser handle it.
    if (k === 'p' || k === 'P') {
      var printFocused = document.activeElement;
      if (printFocused && (printFocused.tagName === 'TEXTAREA' || printFocused.tagName === 'INPUT')) return;
      e.preventDefault();
      // window.print() is a no-op in WKWebView — prefer the native print command
      // (wry WebView.print() via Rust); fall back to window.print() in a browser.
      if (window.__TAURI__ && window.__TAURI__.core && typeof window.__TAURI__.core.invoke === 'function') {
        window.__TAURI__.core.invoke('print_page').catch(function (err) {
          console.warn('U-15: native print failed; falling back to window.print()', err);
          if (typeof window.print === 'function') window.print();
        });
      } else if (typeof window.print === 'function') {
        window.print();
      }
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
    // JANK-02: only while the DOM still matches state. Mid-batch (_doCloseTab or
    // openDoc has already moved state.activeId but the repaint is still owed)
    // .tv-scroll belongs to a different tab, and reading it would persist a
    // freshly opened file at the previous file's scroll offset. The tab's own
    // scrollTop is already authoritative in that window.
    var scrollEl = domMatchesState() ? document.querySelector('[data-scroll]') : null;
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

    // C-36: the "menu:theme-toggle" listener is gone with the menu item that
    // emitted it. View ▸ Toggle Dark Mode was removed because it competed with
    // View ▸ Appearance ▸ Light/Dark/System, and the two could disagree — Rust
    // no longer emits this event, so the listener was dead weight. Appearance
    // now round-trips through setTheme() → TVNative.notifyTheme(choice).

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

    // F-22: Help menu → Keyboard Shortcuts overlay is handled in tv-native.js,
    // which listens for the real "menu:keyboard-shortcuts" event Rust emits. The
    // former "menu:shortcuts" listener here was dead (no such event is emitted) and
    // is removed to avoid a double-invocation of openShortcuts() if names ever align.
  }

  /* ────────────────────────────────────────────────────────────
     INIT — production boot sequence (E-02)
     S-05 fix: track first-opened (MRU index 0) tab and activate it last.
   ──────────────────────────────────────────────────────────── */
  function init() {
    // C-19: one increment per app launch, read by _showEditHint().
    _bumpEditHintSession();
    // C-32: the region must outlive every render, so it lives in <body>, not
    // inside the #tv-root subtree that render() replaces.
    ensureLiveRegion();

    // F-09: responsive sidebar default by window width (step-6 breakpoints).
    //   ≥1440px → sidebar visible by default
    //   <1440px → hidden by default
    // A ResizeObserver/resize listener keeps the default in sync until the user
    // makes an explicit toggle (sidebarUserToggled), after which their choice
    // wins and width changes no longer move the sidebar.
    state.sidebarOpen = window.innerWidth >= 1440;
    (function () {
      var resizeRaf = null;
      var overlayWait = null;
      function _overlayOpen() {
        return !!((window.TVPalette && TVPalette.isOpen && TVPalette.isOpen()) ||
                  (window.TVSearch && TVSearch.isOpen && TVSearch.isOpen()));
      }
      function applyResponsive() {
        if (state.sidebarUserToggled) return; // user choice wins
        var shouldOpen;
        if (window.innerWidth >= 1440) shouldOpen = true;
        else if (window.innerWidth < 1024) shouldOpen = false;
        else return; // 1024–1439: leave current state, don't fight the user
        if (shouldOpen === state.sidebarOpen) return;
        // C-17: render() unconditionally closes ⌘K and ⌘⇧F, so repainting on a
        // resize would yank an open overlay away mid-query. Defer BOTH the
        // state flip and the repaint until it closes — that way state and DOM
        // are never allowed to disagree, which is the actual bug here.
        if (_overlayOpen()) {
          if (!overlayWait) {
            overlayWait = setInterval(function () {
              if (_overlayOpen()) return;
              clearInterval(overlayWait);
              overlayWait = null;
              applyResponsive();
            }, 250);
          }
          return;
        }
        state.sidebarOpen = shouldOpen;
        // C-17: the old `if (state.tabs.length)` guard skipped this repaint in
        // the empty state, leaving a 224 px sidebar on screen while state said
        // it was closed — the next ⌘B flipped state back and appeared to do
        // nothing, so it took two presses to close.
        render();
      }
      window.addEventListener('resize', function () {
        if (resizeRaf) return;
        resizeRaf = requestAnimationFrame(function () {
          resizeRaf = null;
          applyResponsive();
          // P2-2: updateTabStripScroll only ran from render() and the
          // strip's own scroll listener, so narrowing the window until tabs
          // overflow left the ⌄ control hidden and both edge fades stale
          // until something else happened to repaint.
          updateTabStripScroll();
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

          // DR-117: arm the file watcher for every restored live tab. (There is no
          // implicit "post-render TVLive.start loop" — it must be invoked here, or
          // session-restored tabs stay silently unwatched despite live=true.)
          if (window.TVLive && typeof TVLive.start === 'function') {
            state.tabs.forEach(function (t) {
              if (t.live) TVLive.start(t.id);
            });
          }

          // DR-50: single consolidated toast for missing files.
          // C-01 (native request): this is a failure, so it takes the error
          // treatment — red tint, a ✕, and ~6 s rather than 3, because it names
          // files the user may want to go and look for.
          if (sessionMissed > 0 && window.TVNative && typeof TVNative.showToast === 'function') {
            // The verb has to agree with the noun; "1 file … were not found" was
            // the shipped string.
            var missingPhrase = (sessionMissed === 1)
              ? '1 file from last session was not found'
              : sessionMissed + ' files from last session were not found';
            TVNative.showToast(missingPhrase, { kind: 'error' });
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
            // DR-116: seed recency clock from real mtime so a static file opens
            // settled (no bar). Per DR-120, missing modified → leave undefined so
            // TVLive.start() falls back to Date.now() without error.
            if (typeof doc.modified === 'number') { newTab.lastModTime = doc.modified; }
            // DR-117: mark as live so the post-render TVLive.start() loop arms
            // the file watcher — session-restored tabs must not be silently unwatched.
            newTab.live = true;
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
          // C-33: the buffer is now the disk content by definition.
          _markSaved(tab);
          // DR-118: refresh tab.lastModTime from the reloaded mtime so the
          // recency bar reflects the reload's mtime, not a stale pre-reload value.
          // Note: tab.lastModTime is seed-only for TVLive.start(); after a watch
          // is already running, watchState.lastModTime is authoritative. TVLive.refresh()
          // (called below via render()) will stamp watchState from the change event,
          // so this assignment primarily covers the first-render-after-reload case.
          if (typeof doc.modified === 'number') { tab.lastModTime = doc.modified; }
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
    // JANK-02: run fn with render() coalesced — any number of render() calls
    // inside fn produce exactly ONE repaint, emitted synchronously before batch
    // returns. Callers may still read the DOM after batch() returns, but not
    // between two render() calls inside fn. Returns fn's return value.
    batch: batchRender,
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
    updateTabIndicator: updateTabIndicator, // tv-live.js: live-bolt refresh on liveActive flip
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
    // U-14 / DR-98: exposed so tv-palette.js Move Tab Left/Right commands can
    // call TV.saveSession() without relying on IIFE-internal access.
    saveSession: saveSession,
    // C-02: the native shell reads these from the CloseRequested handler so a
    // ⌘Q with unsaved work can name the files it is about to drop.
    hasDirtyTabs: hasDirtyTabs,
    dirtyTabNames: dirtyTabNames,
    // C-18/C-36: ⌘G / ⇧⌘G — the ONE stepping path for the find bar, so the
    // native Edit ▸ Find ▸ Next/Previous items and the keyboard agree.
    findStep: _findStep,
    // C-08: the ⌘T launcher's subsequence scorer, exposed so tv-palette.js
    // stops running a second, substring-only matcher. fuzzyMatchFile scores a
    // whole {name, folder, path} record; highlightIndices returns ESCAPED HTML.
    fuzzyScore: fuzzyScore,
    fuzzyMatchFile: fuzzyMatchFile,
    highlightIndices: highlightIndices,
    // C-09: the ⌘K "Save" and "Find in Document" rows must run the SAME entry
    // points as ⌘S / ⌘F, or the palette drifts from the accelerator it shows.
    handleSave: handleSave,
    openFindBar: _openFindBar,
    // C-33: Esc discards; these are the undo. tv-palette.js lists
    // "Restore discarded edits" and should gate the row on hasDiscardedEdits().
    restoreDiscardedEdits: restoreDiscardedEdits,
    hasDiscardedEdits: hasDiscardedEdits,
    discardEdits: discardEdits,
    // P2-6: the ONE polite live region (#tv-live-region, created at boot).
    // tv-native.js's showToast() calls this instead of owning a second
    // aria-live region inside #tv-toasts, so a screen reader never has two
    // independent regions that could both announce at once.
    announce: announce,
  };

  /* ── Boot when DOM is ready ───────────────────────────────── */
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

})();
