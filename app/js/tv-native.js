/* ───────────────────────────────────────────────────────────
   Galley · native Tauri bridge
   window.TVNative = {
     available, init(), openPicker(), openFolder(),
     saveTab(tab), startWatch(tab), stopWatch(tab),
     openInto(doc), showToast(msg),
     readDirTree(path, opts), listDir(path), notifyTheme(choice),
     syncAppearanceMenu(), syncRecentMenu()
   }

   Uses window.__TAURI__ (withGlobalTauri: true in tauri.conf.json).
   Falls back to a no-op when running in a plain browser.

   E-13 invariant: native tabs opened via this module NEVER have
   tab.fileHandle set. They use tab.nativePath exclusively.
   The two open paths (native vs browser FileSystem API) are
   mutually exclusive — TVNative.available is true inside Tauri,
   and tv-files.js delegates to TVNative when available.
   ─────────────────────────────────────────────────────────── */
(function () {
  'use strict';

  /* ── Tauri v2 accessor helpers ───────────────────────────── */
  function invoke(cmd, args) {
    return window.__TAURI__.core.invoke(cmd, args);
  }

  function listen(event, handler) {
    return window.__TAURI__.event.listen(event, handler);
  }

  /* ── availability ────────────────────────────────────────── */
  var available = !!(window.__TAURI__);

  /* ── guard: init must only run once ─────────────────────── */
  var _initialized = false;

  /* ── accepted path extensions ────────────────────────────── */
  var MD_EXTS = ['.md', '.markdown', '.mdc', '.txt']; // UXF-07: .mdc (Cursor rules)

  // UXF-07: the extensionless agent rule files the sidebar lists (lib.rs
  // AGENT_FILE_NAMES) open by drop too — the same viewable set everywhere.
  var AGENT_RULE_FILES = ['.cursorrules', '.windsurfrules', '.clinerules', '.roorules', '.goosehints', '.rules'];

  function hasMdExt(path) {
    var lower = (path || '').toLowerCase();
    var base = lower.split('/').pop();
    return AGENT_RULE_FILES.indexOf(base) !== -1 ||
      MD_EXTS.some(function (ext) { return lower.endsWith(ext); });
  }

  /* ── classify a read_md_file error string (F-06/F-16) ─────── */
  // The Rust side returns "read error for <path>: <os message>". Map the OS
  // message to a tab error kind: missing file → 'not-found', UTF-8 decode
  // failure → 'binary', anything else → 'not-found' (safe generic recovery).
  function classifyReadError(err) {
    var s = (typeof err === 'string' ? err : (err && err.message) || '').toLowerCase();
    if (s.indexOf('utf-8') !== -1 || s.indexOf('utf8') !== -1 ||
        s.indexOf('stream did not contain') !== -1) {
      return 'binary';
    }
    if (s.indexOf('no such file') !== -1 || s.indexOf('os error 2') !== -1 ||
        s.indexOf('cannot find') !== -1 || s.indexOf('not found') !== -1) {
      return 'not-found';
    }
    return 'not-found';
  }

  /* ── reveal a file in Finder (F-10/F-16) ─────────────────── */
  function revealInFinder(path) {
    if (!available || !path) return;
    invoke('reveal_in_finder', { path: path }).catch(function (err) {
      console.warn('[TVNative] reveal_in_finder failed', path, err);
      showToast('Could not reveal file in Finder', { kind: 'error' });
    });
  }

  /* ── helpers to access TV safely ────────────────────────── */
  function getTV() {
    return window.TV || null;
  }

  function getActiveTab() {
    var tv = getTV();
    return tv ? tv.getActiveTab() : null;
  }

  /* ── extract parent directory from an absolute path ─────── */
  // E-12: use the real parent dir for sidebar grouping instead of 'opened'.
  function parentDir(path) {
    if (!path) return null;
    var idx = path.lastIndexOf('/');
    if (idx <= 0) return '/';
    return path.slice(0, idx);
  }

  /* ── toast: transient bottom-center notice (C-01) ─────────────
        Toasts used to be appended straight to <body>. Every design token is
        declared on `.tv` (tv-tokens.css), never on :root, so a body-mounted
        toast resolved none of them: black Times New Roman on a transparent
        background, i.e. invisible over the dark theme. Mounting inside
        TV.el() does NOT fix it either — render() replaces that whole subtree
        (tv-app.js:2457), so the toast would vanish on the very renders that
        follow a save-failure or a file-changed event.
        So: ONE persistent host in <body> that carries the same
        `tv tv--<theme> tv--accent-<accent>` classes as the app root, kept in
        sync on every render. Column layout, newest at the bottom.
        P2-6: the WCAG 4.1.3 announcement itself goes through TV.announce()
        (tv-app.js's #tv-live-region) rather than a second aria-live region
        owned here — see showToast() below. */
  var TOAST_MS_INFO = 3000;
  var TOAST_MS_ERROR = 6000;   // long enough to read and act on
  var TOAST_MAX = 4;           // hard cap so a burst cannot fill the screen
  var _toastHost = null;
  var _toastSyncWired = false;

  // Mirror the app root's theme/accent classes onto the host so the design
  // tokens resolve. state.theme is already the RESOLVED value ('light'|'dark').
  function syncToastHost() {
    if (!_toastHost) return;
    var tv = getTV();
    var theme = (tv && tv.state && tv.state.theme) || 'light';
    var accent = (tv && tv.state && tv.state.accent) || 'blue';
    var cls = 'tv tv--' + theme + ' tv--accent-' + accent;
    if (_toastHost.className !== cls) _toastHost.className = cls;
  }

  // TV may not exist yet when the first toast fires, so keep trying until the
  // subscription actually lands. 'render' covers setTheme/setAccent (both call
  // render); 'themechange' is picked up too if the shell emits one.
  function wireToastSync() {
    if (_toastSyncWired) return;
    var tv = getTV();
    if (!tv || typeof tv.on !== 'function') return;
    _toastSyncWired = true;
    tv.on('render', syncToastHost);
    tv.on('themechange', syncToastHost);
  }

  function toastHost() {
    if (!_toastHost || !_toastHost.parentNode) {
      _toastHost = document.createElement('div');
      _toastHost.id = 'tv-toasts';
      document.body.appendChild(_toastHost);
    }
    wireToastSync();
    syncToastHost();
    return _toastHost;
  }

  // showToast(msg)                    → info,  ~3 s, auto-dismiss
  // showToast(msg, { kind:'error' })  → error, ~6 s, dismissible with ✕
  // The second argument also accepts the bare string 'error'.
  function showToast(msg, opts) {
    var kind = (typeof opts === 'string') ? opts : (opts && opts.kind) || 'info';
    var isError = (kind === 'error');
    var host = toastHost();

    var t = document.createElement('div');
    t.className = 'tv-toast' + (isError ? ' tv-toast--error' : '');
    t.setAttribute('role', 'status');

    var label = document.createElement('span');
    label.className = 'tv-toast-text';
    label.textContent = msg;
    t.appendChild(label);

    var timer = null;
    var removed = false;
    function removeSelf() {
      if (removed) return;
      removed = true;
      if (t.parentNode) t.parentNode.removeChild(t);
    }
    function dismiss() {
      if (timer) { clearTimeout(timer); timer = null; }
      t.classList.add('out');
      // UX-17: animationend never fires when prefers-reduced-motion disables
      // the animation, so keep the timeout fallback.
      t.addEventListener('animationend', removeSelf);
      setTimeout(removeSelf, 400);
    }

    if (isError) {
      var x = document.createElement('button');
      x.type = 'button';
      x.className = 'tv-toast-x';
      x.setAttribute('aria-label', 'Dismiss notice');
      x.textContent = '✕';
      x.addEventListener('click', dismiss);
      t.appendChild(x);
    }

    // Column order = arrival order, newest at the bottom.
    host.appendChild(t);
    // P2-6: WCAG 4.1.3 announcement goes through the shell's ONE persistent
    // polite live region (#tv-live-region) instead of a second one that used
    // to live inside #tv-toasts — two independent aria-live regions could
    // both fire on the same turn.
    var tv = getTV();
    if (tv && typeof tv.announce === 'function') tv.announce(msg);

    // Cap the stack: drop the oldest visible toast immediately.
    var live = host.querySelectorAll('.tv-toast');
    for (var i = 0; i < live.length - TOAST_MAX; i++) {
      if (live[i].parentNode) live[i].parentNode.removeChild(live[i]);
    }

    timer = setTimeout(dismiss, isError ? TOAST_MS_ERROR : TOAST_MS_INFO);
    return t;
  }

  /* ── openInto: register a FileDoc returned by Rust ──────── */
  //   doc = { name: string, path: string, content: string }
  //   E-12: set path to the real parent directory.
  //   E-13: intentionally do NOT set fileHandle — native tabs use nativePath only.
  // SBH-03: `opts.transient` marks a PREVIEW open (single-click in the sidebar
  // tree) — openDoc replaces the existing preview tab instead of stacking a new
  // one. Optional and defaulting to false, so every existing caller keeps its
  // current pinned behavior and openDoc's one-opts-object signature is intact.
  function openInto(doc, opts) {
    if (!doc || !doc.name) return;
    var tv = getTV();
    if (!tv) return;
    // JANK-02: openDoc renders (twice, when it has to drop a preview tab) and
    // the QA D4 fix below renders again — three full DOM teardowns per opened
    // file, which is the sidebar stutter. TV.batch collapses them into one
    // repaint, emitted synchronously before batch() returns, and as a bonus the
    // D4 window closes entirely: nativePath is assigned before anything paints.
    // Nesting is counted, so wrapping here is safe even when the caller
    // (_openTreeFilePath) has already opened a batch. Older shells without
    // TV.batch fall through to the previous multi-render behaviour.
    if (typeof tv.batch === 'function') {
      tv.batch(function () { _openInto(tv, doc, opts); });
    } else {
      _openInto(tv, doc, opts);
    }
  }

  function _openInto(tv, doc, opts) {
    // Already open? Activate it instead of stacking a duplicate tab.
    //
    // openDoc's own dedup cannot catch this: tabKey() returns 'native:<path>'
    // for an existing tab (the bridge assigns nativePath after openDoc returns)
    // but '<dir>/<name>' for the incoming opts, so the keys never match. Every
    // Finder double-click / "Open With" on a file that was already open added
    // another tab for the same document — very visible now that the app is a
    // default .md handler. Same root cause as the sidebar tree's D3 fix.
    //
    // Activate-only is deliberate: the file is live-watched (TVLive.start
    // below), so an on-disk change is already reflected, and re-reading here
    // would risk clobbering unsaved edits in a dirty tab (DR-06).
    if (doc.path && tv.state && Array.isArray(tv.state.tabs)) {
      for (var e = 0; e < tv.state.tabs.length; e++) {
        if (tv.state.tabs[e].nativePath === doc.path) {
          if (typeof tv.activateTab === 'function') tv.activateTab(tv.state.tabs[e].id);
          return;
        }
      }
    }

    // E-12: use the real parent dir so sidebar groups by directory, not 'opened'
    var dirPath = parentDir(doc.path);

    var id = tv.openDoc({
      name: doc.name,
      source: doc.content,
      path: dirPath,
      transient: !!(opts && opts.transient),
      // fileHandle intentionally omitted — E-13: native path used instead.
      // Native tabs NEVER have fileHandle set; nativePath is assigned below.
    });

    if (!id) return;

    var tab = tv.state.tabs.find(function (t) { return t.id === id; });
    if (tab) {
      tab.nativePath = doc.path;
      // UF-01/UF-14: mark as live so bolt icon renders in tab strip + sidebar
      tab.live = true;
      // Seed the live-watch recency clock from the file's real mtime so a static
      // file (old mtime) does NOT show the live indicator on open — only a recently
      // written / streaming file does (tv-live.js gates the open display on isRecent).
      if (typeof doc.modified === 'number') { tab.lastModTime = doc.modified; }
    }

    // Persist this path in recent files (E-02)
    if (doc.path && typeof tv.saveRecentPath === 'function') {
      tv.saveRecentPath(doc.path);
      syncRecentMenu(); // C-36: keep File > Open Recent current
    }

    // R7-FIX: do NOT call startWatch(tab) directly here. TVLive.start() (below) calls
    // TVNative.startWatch(tab) internally (tv-live.js line ~290). Calling startWatch
    // here AND via TVLive.start results in watch_file being invoked twice per open,
    // causing duplicate FSEvent subscriptions. TVLive.start is the single entry point.
    if (tab && tab.id && window.TVLive && typeof TVLive.start === 'function') {
      TVLive.start(tab.id);
    }

    // QA D4: openDoc() renders BEFORE the bridge can assign nativePath (the
    // contract requires assigning it after openDoc returns), so that first
    // paint saw a tab with no nativePath. buildSidebar suppresses a tab from
    // the grouped "open files" list only when its nativePath is a known
    // tree file — so for one frame the file rendered TWICE: once in the folder
    // tree and once as a duplicate grouped section, with the active highlight
    // on the wrong row. It only healed on the next unrelated re-render.
    // Re-render once the tab is fully populated.
    if (tab && typeof tv.render === 'function') tv.render();
  }

  /* ── drag-drop handler ───────────────────────────────────── */
  function handleDragDrop(e) {
    var paths = e.payload && e.payload.paths;
    if (!paths || !paths.length) return;

    paths.forEach(function (path) {
      if (!hasMdExt(path)) return;
      invoke('read_md_file', { path: path })
        .then(function (doc) { openInto(doc); })
        .catch(function (err) {
          // F-06/F-16: surface a per-tab error state instead of only a toast.
          var fileName = path.split('/').pop() || path;
          var tv = getTV();
          if (tv && typeof tv.openErrorTab === 'function') {
            tv.openErrorTab(fileName, path, classifyReadError(err));
          } else {
            showToast('Cannot open "' + fileName + '": ' + (err || 'read failed'), { kind: 'error' });
          }
          console.error('[TVNative] drag-drop read_md_file failed', path, err);
        });
    });
  }

  /* ── file-changed handler ────────────────────────────────── */
  // N-01: guard dirty tabs — do NOT overwrite tab.source when user has unsaved edits
  function handleFileChanged(e) {
    var payload = e.payload;
    if (!payload || !payload.path || payload.content === undefined) return;

    var tv = getTV();
    if (!tv || !tv.state || !tv.state.tabs) return;

    var tab = tv.state.tabs.find(function (t) {
      return t.nativePath === payload.path;
    });

    if (!tab) return;

    // N-01 / S-06: Do NOT overwrite tab.source when the tab is dirty
    // (user has unsaved edits that must not be clobbered by disk content)
    if (tab.dirty) {
      // DR-65/DR-70: the file changed on disk, so the recency clock must reset
      // even though we keep the dirty buffer. notifyChange does the full visual
      // reset for the active tab (label → "updating…", blip re-pulse) and a
      // timestamp-only stamp for background tabs — never a re-render, so the
      // dirty edits are preserved. Without this the indicator counts from the
      // prior change while the toast says the file just changed.
      if (window.TVLive && typeof TVLive.notifyChange === 'function') {
        TVLive.notifyChange(tab.id, payload.modified);
      }
      // C-01 copy: no dashes in user-facing strings.
      showToast((tab.name || 'File') + ' changed on disk. Save or discard your edits first.', { kind: 'error' });
      return;
    }

    tab.source = payload.content;

    // Only re-render if this is the active tab in reading mode
    var activeTab = getActiveTab();
    if (
      activeTab &&
      activeTab.id === tab.id &&
      tv.state.mode === 'reading'
    ) {
      // DR-10: capture scroll, render, restore — no scrolljack
      var scrollEl = document.querySelector('.tv-scroll');
      var savedScroll = scrollEl ? scrollEl.scrollTop : 0;

      tv.render();

      // After render, restore scroll position
      var newScrollEl = document.querySelector('.tv-scroll');
      if (newScrollEl) {
        newScrollEl.scrollTop = savedScroll;
      }

      // L-04: Re-inject live status bar after render (tv.render() replaces DOM)
      // TVLive.refresh() handles finding the correct watchState for the active tab.
      // DR-119: pass disk mtime so watchState.lastModTime uses the real value.
      if (window.TVLive && typeof TVLive.refresh === 'function') {
        TVLive.refresh(payload.modified);
      }
    } else {
      // DR-70: background (non-active) or non-reading native tab changed on disk.
      // refresh() above only stamps lastModTime for the ACTIVE tab, so without
      // this a background tab's recency would show stale "Xm ago" on next switch
      // even though content just changed. Stamp the change time now (mirrors poll
      // mode, which calls onFileChange unconditionally) — the visible label is
      // derived from lastModTime by paintRecency() when the tab is next shown.
      // DR-119: thread disk mtime through so the background stamp is also exact.
      if (window.TVLive && typeof TVLive.notifyChange === 'function') {
        TVLive.notifyChange(tab.id, payload.modified);
      }
    }
  }

  /* ── file-removed handler (E-08) ─────────────────────────────
        Rust emits this when a watched file is deleted on disk.
        Surface it: stop the live indicator, stop watching, mark the
        tab so the user can re-save (which recreates the file), and
        show a toast. Keep the tab + its last content open.
        S-10 fix: use direct tab.dirty = true instead of markDirty
        (which internally called render), then call render ONCE. */
  function handleFileRemoved(e) {
    var payload = e.payload;
    if (!payload || !payload.path) return;

    var tv = getTV();
    if (!tv || !tv.state || !tv.state.tabs) return;

    var tab = tv.state.tabs.find(function (t) {
      return t.nativePath === payload.path;
    });
    if (!tab) return;

    tab.live = false;            // file is gone — drop the ⚡ live state
    // DR-71: tear the watch down through TVLive.stop so the status bar + recency
    // label are removed (never a stale time on a dead watch) and the elapsed
    // timer + _watching entry are cleared. TVLive.stop calls TVNative.stopWatch
    // internally for native mode, so we don't call stopWatch(tab) again here.
    if (window.TVLive && typeof TVLive.stop === 'function') {
      TVLive.stop(tab.id);
    } else {
      stopWatch(tab);            // fallback (older build): at least stop the Rust watcher
    }
    // S-10 fix: set dirty directly (no render), then call render once below
    tab.dirty = true;

    showToast((tab.name || 'File') + ' was deleted on disk. Save to restore it.', { kind: 'error' });

    // S-10: single render (previously was markDirty→render + explicit render = 2 renders)
    if (typeof tv.render === 'function') tv.render();
  }

  /* ── public: openPicker ──────────────────────────────────── */
  function openPicker() {
    if (!available) return Promise.resolve();
    return invoke('pick_md_files')
      .then(function (docs) {
        // JANK-02: ⌘O with a multi-file selection otherwise repaints once per
        // file — N documents parsed and thrown away before the last one lands.
        // One outer batch makes it a single repaint; openInto's own nested
        // batch is counted, not re-entrant.
        var tv = getTV();
        var openAll = function () {
          (docs || []).forEach(function (doc) { openInto(doc); });
        };
        if (tv && typeof tv.batch === 'function') tv.batch(openAll);
        else openAll();
      })
      .catch(function (err) {
        // User cancel returns null/error — treat silently
        if (err) console.warn('[TVNative] openPicker cancelled or failed', err);
      });
  }

  /* ── public: readDirTree (F-19) ─────────────────────────── */
  // Wraps the read_dir_tree Rust command (async on the Rust side, UXF-02).
  // Returns Promise<DirTree> where
  //   DirTree = { path, root: DirNode, truncated: bool, unreadable: number }
  //   DirNode = { name, path, files: [{name, path}], filesHidden: number,
  //               folders: [DirNode], mdCount: number, scanned: bool }
  // scanned:false = the scan budget ran out before that folder; load it by
  // calling readDirTree with that folder's path and grafting the result.
  // readDirTree(path, { uncapped: true }) uses the wide budget and file cap —
  // the per-folder "Show N more files" row (C-29).
  function readDirTree(absFolderPath, opts) {
    if (!available) return Promise.resolve(null);
    var args = { path: absFolderPath };
    if (opts && opts.uncapped) args.uncapped = true;
    return invoke('read_dir_tree', args);
  }

  // UXF-10: one folder's folders and viewable files, for the Open Path
  // completer. Promise<{ path, entries: [{ name, dir }], truncated }>; a
  // leading "~" is expanded by Rust. Rejects when the folder cannot be read.
  function listDir(path) {
    if (!available) return Promise.reject(new Error('Needs the desktop app'));
    return invoke('list_dir', { path: path });
  }

  /* ── public: openFolder (F-03) ──────────────────────────── */
  // Invokes pick_folder → { path, files }, then reads the dir tree from
  // res.path and registers it so the sidebar nested section appears — even when
  // every .md lives in subfolders (res.files empty but res.path set). B1 fix:
  // cancel-vs-empty is decided by res.path being NON-EMPTY (a real pick), never
  // by files.length.
  //
  // SBH-03 (Sidebar hierarchy · Fix 3): opening a folder opens NO tabs. Mounting
  // a folder is a NAVIGATION act; opening a document is a READING act. Fanning
  // res.files out into tabs made a 40-document folder a 40-tab strip — a second,
  // worse copy of the sidebar, with every tab costing a render and a ⌘1–9 slot.
  // res.files is still returned by Rust and still used to seed the tree.
  function openFolder() {
    if (!available) return Promise.resolve();
    return invoke('pick_folder')
      .then(function (res) {
        var folderPath = res && res.path;
        if (!folderPath) return; // empty path → user cancelled

        // F-19: register the tree from the CHOSEN dir path (not a doc's parent),
        // so a folder whose md files are only in subfolders still gets a sidebar
        // section instead of silently no-op'ing.
        readDirTree(folderPath).then(function (tree) {
          if (tree && window.TV && typeof window.TV.registerFolder === 'function') {
            window.TV.registerFolder(tree);
          }
        }).catch(function (err) {
          console.warn('[TVNative] readDirTree failed after openFolder', folderPath, err);
        });
      })
      .catch(function (err) {
        if (err) console.warn('[TVNative] openFolder cancelled or failed', err);
      });
  }

  /* ── public: reopenFolder (ISS-FOLDER) ───────────────────── */
  // Reopen a KNOWN folder path WITHOUT the native picker (we already have the
  // path, e.g. from a Recent entry). Mirrors the real openFolder() flow: read
  // the DirTree and register it so the sidebar nested section appears. Returns
  // a Promise that REJECTS if the tree can't be read (folder moved/deleted) so
  // the caller can surface a notice and drop the dead Recent entry. A visible
  // toast is shown on read failure too.
  //
  // SBH-03 (Fix 3): like openFolder(), this opens NO tabs — it keeps parity
  // with the picker path, which no longer fans top-level files out either.
  function reopenFolder(absFolderPath) {
    if (!available) return Promise.reject(new Error('native bridge unavailable'));
    if (!absFolderPath) return Promise.reject(new Error('no folder path'));
    return readDirTree(absFolderPath).then(function (tree) {
      if (!tree) {
        showToast('Could not open folder. It may have moved or been deleted.', { kind: 'error' });
        return Promise.reject(new Error('read_dir_tree returned null'));
      }
      // Register the tree so the sidebar folder section renders.
      if (window.TV && typeof window.TV.registerFolder === 'function') {
        window.TV.registerFolder(tree);
      }
      return tree;
    }, function (err) {
      showToast('Could not open folder. It may have moved or been deleted.', { kind: 'error' });
      console.warn('[TVNative] reopenFolder read_dir_tree failed', absFolderPath, err);
      return Promise.reject(err);
    });
  }

  /* ── public: saveTab ─────────────────────────────────────── */
  function saveTab(tab) {
    if (!available || !tab) return Promise.resolve();

    var tv = getTV();

    if (tab.nativePath) {
      // Save in-place (existing file)
      return invoke('save_md_file', { path: tab.nativePath, content: tab.source || '' })
        .then(function () {
          if (tv) tv.markDirty(tab.id, false);
        })
        .catch(function (err) {
          // N-06: surface save failure as toast; do NOT silently swallow
          if (err) {
            showToast('Save failed: ' + (typeof err === 'string' ? err : 'disk error'), { kind: 'error' });
            console.warn('[TVNative] saveTab (save_md_file) failed', err);
          }
          // Re-throw so handleSave() knows to keep edit mode open
          return Promise.reject(err);
        });
    } else {
      // Save-as dialog. Tauri 2 camelCases command arguments, so the key MUST be
      // `suggestedName` — the snake_case spelling this used to send was rejected
      // by the command, which silently broke saving any tab with no path.
      var saveArgs = {
        content: tab.source || '',
        suggestedName: tab.name || 'document.md',
      };
      // F-23: open the panel where the New File was started, when known.
      if (tab.suggestedDir) saveArgs.directory = tab.suggestedDir;
      return invoke('save_md_file_as', saveArgs)
        .then(function (d) {
          // d is Option<FileDoc> — null when user cancelled.
          // C-02 fix: markDirty(false) used to run UNCONDITIONALLY here, so
          // cancelling the save dialog still cleared the dirty flag — nothing
          // was written, but the tab looked clean. That is exactly the silent
          // discard C-02's quit guard exists to prevent: "Save All" calls this
          // same path per dirty tab, and NATIVE-CONTRACT.md's quit contract
          // requires the close to proceed "only if nothing is still dirty" —
          // which only means something if a cancelled Save As stays dirty.
          if (d) {
            tab.nativePath = d.path;
            tab.name = d.name;
            // F-23: the document now exists on disk — group it by its real
            // directory (sidebar) and stop treating it as a never-saved file.
            tab.path = parentDir(d.path);
            tab.isNew = false;
            tab.suggestedDir = null;
            tab.savedSource = tab.source;
            // Persist the new path in recents
            if (d.path && typeof tv.saveRecentPath === 'function') {
              tv.saveRecentPath(d.path);
              syncRecentMenu(); // C-36: keep File > Open Recent current
            }
            // S-04: start watching the newly saved file (it now has a nativePath).
            // R7-FIX: TVLive.start() calls TVNative.startWatch() internally — do NOT
            // call startWatch() directly here to avoid double watch_file invocation.
            tab.live = true;
            if (window.TVLive && typeof TVLive.start === 'function') {
              TVLive.start(tab.id);
            }
            // Re-render to update tab name + live indicator
            if (tv && typeof tv.render === 'function') tv.render();
            if (tv) tv.markDirty(tab.id, false);
            // F-23: a file created inside an open folder is not in that folder's
            // scanned tree yet.
            if (tv && typeof tv.refreshFolderFor === 'function') tv.refreshFolderFor(d.path);
            return;
          }
          // Cancelling is not a failure: tell the caller so it can stay quiet.
          return 'cancelled';
        })
        .catch(function (err) {
          if (err) {
            showToast('Save failed: ' + (typeof err === 'string' ? err : 'disk error'), { kind: 'error' });
            console.warn('[TVNative] saveTab (save_md_file_as) failed', err);
          }
          return Promise.reject(err);
        });
    }
  }

  /* ── public: startWatch ──────────────────────────────────── */
  function startWatch(tab) {
    if (!available || !tab || !tab.nativePath) return;
    invoke('watch_file', { path: tab.nativePath })
      .catch(function (err) {
        console.warn('[TVNative] startWatch failed', tab.nativePath, err);
      });
  }

  /* ── public: stopWatch ───────────────────────────────────── */
  function stopWatch(tab) {
    if (!available || !tab || !tab.nativePath) return;
    invoke('unwatch_file', { path: tab.nativePath })
      .catch(function (err) {
        console.warn('[TVNative] stopWatch failed', tab.nativePath, err);
      });
  }

  /* ── public: unwatchFolder (ISS-005) ─────────────────────── */
  // Stop any native watch keyed to a folder root when its sidebar section is
  // closed. Per-file tab watches are keyed by file path, so they are untouched
  // and open tabs stay live. A no-op today if nothing is watched under `path`.
  function unwatchFolder(path) {
    if (!available || !path) return;
    invoke('unwatch_file', { path: path })
      .catch(function () { /* nothing watched under this path — ignore */ });
  }

  /* ── C-02: quit / close window with unsaved edits ─────────
        Rust intercepts WindowEvent::CloseRequested (and routes ⌘Q and ⇧⌘W
        through the same place) and emits `tv-close-requested`. Only the
        frontend knows which tabs are dirty, so the decision lives here.
        Every branch ends in either confirm_close or a deliberate stay. */
  function dirtyTabs() {
    var tv = getTV();
    if (!tv || !tv.state || !Array.isArray(tv.state.tabs)) return [];
    return tv.state.tabs.filter(function (t) { return t && t.dirty; });
  }

  // P1-7: every quit route emits tv-close-requested, and Rust's
  // prevent_close() does not stop a second one arriving while the first is
  // still being answered (e.g. a second ⌘Q, or ⌘Q then the red button) — an
  // in-flight guard keeps two confirm_quit_dialog sheets from stacking on
  // the same window with contradictory outcomes. Cleared on every branch
  // that does NOT end the process (closeNow's own failure path clears it
  // too, so a failed confirm_close does not leave the app stuck forever).
  var _quitInFlight = false;
  // P1-8: consecutive confirm_quit_dialog failures — see handleCloseRequested.
  var _quitDialogFailures = 0;

  function closeNow() {
    return invoke('confirm_close').catch(function (err) {
      console.error('[TVNative] confirm_close failed', err);
      // The window did NOT close — re-arm so the next quit attempt is not
      // silently swallowed by the in-flight guard.
      _quitInFlight = false;
    });
  }

  // Sequential on purpose: an untitled tab hits save_md_file_as, which opens a
  // native panel — two of those at once would fight over the main thread.
  function saveAllDirty() {
    return dirtyTabs().reduce(function (chain, tab) {
      return chain.then(function () { return saveTab(tab); });
    }, Promise.resolve());
  }

  function handleCloseRequested() {
    if (_quitInFlight) return; // P1-7: a sheet is already up — ignore the re-entrant call
    _quitInFlight = true;

    var count = 0;
    try {
      var tv = getTV();
      count = (tv && typeof tv.hasDirtyTabs === 'function')
        ? tv.hasDirtyTabs()
        : dirtyTabs().length;
    } catch (e) {
      // A broken shell must not make the app unquittable.
      count = 0;
    }

    if (!count) { closeNow(); return; }

    invoke('confirm_quit_dialog', { count: count })
      .then(function (choice) {
        _quitDialogFailures = 0; // a successful round-trip resets the failure streak
        if (choice === 'discard') return closeNow();
        if (choice !== 'save') { _quitInFlight = false; return; } // Cancel: stay exactly as we are
        return saveAllDirty().then(function () {
          // A cancelled Save As leaves the tab dirty. Quitting now would throw
          // away the very edits the user just declined to discard.
          if (dirtyTabs().length) {
            showToast('Quit cancelled. Some documents are still unsaved.', { kind: 'error' });
            _quitInFlight = false;
            return;
          }
          return closeNow();
        }, function () {
          showToast('Quit cancelled. Save failed, so your edits are still here.', { kind: 'error' });
          _quitInFlight = false;
        });
      })
      .catch(function (err) {
        console.error('[TVNative] confirm_quit_dialog failed', err);
        _quitDialogFailures++;
        // P1-8: NATIVE-CONTRACT.md says any failure here falls through to
        // confirm_close. The first failure instead asks the user to retry —
        // a transient dialog glitch should not quit out from under them
        // without asking. But a window that keeps failing to even ASK about
        // unsaved changes must not become permanently unquittable (⌘Q,
        // ⇧⌘W, and the red button would all be dead), which is worse than
        // the data-loss case the dialog exists to prevent — so the SECOND
        // consecutive failure falls through to closeNow() per the contract.
        if (_quitDialogFailures >= 2) {
          _quitDialogFailures = 0;
          showToast('Could not ask about unsaved changes. Quitting anyway.', { kind: 'error' });
          closeNow();
          return;
        }
        showToast('Could not ask about unsaved changes. Save your work, then quit again.', { kind: 'error' });
        _quitInFlight = false;
      });
  }

  /* ── C-36: keep View ▸ Appearance truthful ────────────────
        DR-14 wants the active choice checked at all times, not only when the
        choice came from the menu. Push the USER'S choice (not the resolved
        colour) so "System" stays checked while the OS flips underneath it:
        tv-app.js removes the tv-theme key for System and writes it otherwise. */
  var _lastAppearance = null;

  // The user's CHOICE, derived from storage: tv-app.js removes the tv-theme key
  // for "System" and writes 'light'/'dark' otherwise.
  function currentAppearanceChoice() {
    var choice;
    try { choice = localStorage.getItem('tv-theme') || 'system'; } catch (e) { choice = 'system'; }
    return (choice === 'light' || choice === 'dark') ? choice : 'system';
  }

  // The single push point. Memoised, so the render-driven caller costs nothing
  // when nothing changed — and that also breaks the native-menu round trip
  // (menu click → TV.setTheme → notifyTheme → here) after one hop. Rust only
  // sets the checkmark and never echoes back, so there is no loop to close.
  function pushAppearance(choice) {
    if (!available) return;
    if (choice !== 'light' && choice !== 'dark' && choice !== 'system') return;
    if (choice === _lastAppearance) return;
    _lastAppearance = choice;
    invoke('set_appearance_check', { choice: choice }).catch(function (err) {
      // The menu may not be built yet on the very first render. Clear the memo
      // so the next render retries instead of leaving a stale checkmark.
      _lastAppearance = null;
      console.warn('[TVNative] set_appearance_check failed', err);
    });
  }

  // Accepts the shell's `themechange` payload ({ theme, choice }) when there is
  // one, and falls back to reading storage for the render-driven path.
  function syncAppearanceMenu(payload) {
    pushAppearance((payload && payload.choice) || currentAppearanceChoice());
  }

  // Direct hook: tv-app.js setTheme() calls notifyTheme(choice, resolvedTheme).
  // The resolved paint is deliberately ignored — sending it would uncheck
  // "System" the moment the OS flipped underneath it.
  function notifyTheme(choice) {
    pushAppearance(choice);
  }

  /* ── C-36: File ▸ Open Recent ───────────────────────────── */
  // The 20-entry MRU lives in localStorage, so Rust cannot read it. Push the
  // first 10 file paths whenever they change; Rust rebuilds the submenu.
  var _lastRecentKey = null;
  function syncRecentMenu() {
    if (!available) return;
    var tv = getTV();
    if (!tv || typeof tv.loadRecentPaths !== 'function') return;
    var paths;
    try { paths = (tv.loadRecentPaths() || []).slice(0, 10); } catch (e) { return; }
    var key = paths.join('\n');
    if (key === _lastRecentKey) return;      // render() fires a lot; this is cheap
    _lastRecentKey = key;
    invoke('set_recent_files', { paths: paths }).catch(function (err) {
      _lastRecentKey = null;                 // retry on the next render
      console.warn('[TVNative] set_recent_files failed', err);
    });
  }

  // Both syncs are render-driven: setTheme() and every open/close call render().
  function wireMenuSync() {
    var tv = getTV();
    if (!tv || typeof tv.on !== 'function') return;
    tv.on('render', function () { syncAppearanceMenu(); syncRecentMenu(); });
    tv.on('themechange', syncAppearanceMenu);
    syncAppearanceMenu();
    syncRecentMenu();
  }

  /* ── titlebar drag-region: set data-tauri-drag-region
        on .tv-titlebar after every render ─────────────────── */
  function wireTitlebarDragRegion() {
    var tv = getTV();
    if (!tv || typeof tv.on !== 'function') return;

    tv.on('render', function () {
      var titlebar = document.querySelector('.tv-titlebar');
      if (titlebar && !titlebar.hasAttribute('data-tauri-drag-region')) {
        titlebar.setAttribute('data-tauri-drag-region', '');
      }
    });

    // Also set it on the first render that may have already fired
    var titlebar = document.querySelector('.tv-titlebar');
    if (titlebar) {
      titlebar.setAttribute('data-tauri-drag-region', '');
    }
  }

  /* ── public: init ────────────────────────────────────────── */
  function init() {
    if (_initialized) return;
    if (!available) return;

    _initialized = true;

    // Mark the document as running inside Tauri
    document.documentElement.classList.add('tauri');

    // Register native event listeners (fire-and-forget; we keep the unlisten
    // handles only for potential future teardown)
    listen('file-changed', handleFileChanged)
      .catch(function (err) {
        console.error('[TVNative] failed to register file-changed listener', err);
      });

    listen('file-removed', handleFileRemoved)
      .catch(function (err) {
        console.error('[TVNative] failed to register file-removed listener', err);
      });

    // UF-03: Tauri drag-enter / drag-leave — toggle .tv-drag-over for visual feedback.
    // Browser dragenter/dragleave never fire for Finder drags in Tauri WebView.
    // Tauri v2 emits tauri://drag-enter and tauri://drag-leave (or drag-over / drag-cancel).
    function setDragHint(on) {
      var tvEl = document.querySelector('.tv');
      if (tvEl) tvEl.classList.toggle('tv-drag-over', on);
      // Also toggle on body for the empty-state dropzone path
      document.body.classList.toggle('tv-drag-over', on);
      // C-41 (modules request #1): the labelled drop card is built in
      // tv-files.js and was only wired into the browser dragenter/dragleave
      // path — Tauri's own tauri://drag-* events (this function's only
      // callers) never touch it, so the native build showed just the old
      // unlabelled tint. No item count is available from tauri://drag-enter,
      // so call showDragCard() with none; it falls back to the invariant
      // "Drop to open .md, .markdown or .txt files" message.
      if (on && window.TVFiles && typeof TVFiles.showDragCard === 'function') {
        TVFiles.showDragCard();
      } else if (!on && window.TVFiles && typeof TVFiles.hideDragCard === 'function') {
        TVFiles.hideDragCard();
      }
    }

    listen('tauri://drag-enter', function () { setDragHint(true); })
      .catch(function () { /* Tauri version may not support drag-enter — ignore */ });

    listen('tauri://drag-over', function () { setDragHint(true); })
      .catch(function () { /* optional event — ignore */ });

    listen('tauri://drag-leave', function () { setDragHint(false); })
      .catch(function () { /* optional event — ignore */ });

    // Drop: clear hint then handle the actual drop
    listen('tauri://drag-drop', function (e) {
      setDragHint(false);
      handleDragDrop(e);
    }).catch(function (err) {
      console.error('[TVNative] failed to register drag-drop listener', err);
    });

    // U-18 / DR-56: handle files opened via Finder "Open With" / double-click.
    // Rust emits "open-files" with a string[] of absolute filesystem paths from
    // RunEvent::Opened { urls }. DR-56: call enqueueExternalOpen() so App-core
    // buffers paths during session restore and drains after; fall back to the
    // previous direct-open behavior if enqueueExternalOpen is absent (older build).
    function handleOpenPaths(paths) {
      if (!Array.isArray(paths) || !paths.length) return;

      // DR-56: filter to markdown extensions first (same guard as before).
      var mdPaths = paths.filter(function (path) { return hasMdExt(path); });
      if (!mdPaths.length) return;

      var tv = getTV();

      // DR-56 primary path: delegate to App-core session-restore queue.
      if (tv && typeof tv.enqueueExternalOpen === 'function') {
        tv.enqueueExternalOpen(mdPaths);
        return;
      }

      // DR-56 fallback: enqueueExternalOpen absent (older build) — open directly.
      mdPaths.forEach(function (path) {
        invoke('read_md_file', { path: path })
          .then(function (doc) { openInto(doc); })
          .catch(function (err) {
            var fileName = path.split('/').pop() || path;
            var tvFb = getTV();
            if (tvFb && typeof tvFb.openErrorTab === 'function') {
              tvFb.openErrorTab(fileName, path, classifyReadError(err));
            } else {
              showToast('Cannot open "' + fileName + '": ' + (err || 'read failed'), { kind: 'error' });
            }
            console.error('[TVNative] open-files read_md_file failed', path, err);
          });
      });
    }

    listen('open-files', function (e) {
      handleOpenPaths(e.payload);
    }).catch(function (err) {
      console.error('[TVNative] failed to register open-files listener', err);
    });

    // C-02: register this BEFORE take_pending_opens below. That call is what
    // arms the Rust close guard, so registering first guarantees there is never
    // a window where a close is prevented with nothing listening to release it.
    listen('tv-close-requested', handleCloseRequested)
      .catch(function (err) {
        console.error('[TVNative] failed to register tv-close-requested listener', err);
      });

    // U-18 (cold-start fix): a double-click / "Open With" on a COLD app delivers
    // RunEvent::Opened long before the listener above exists, and Tauri's emit
    // does not buffer — so the file was silently dropped and the app came up
    // showing only its restored session. Rust now buffers those paths; drain
    // them here, through the same handler, so the cold path behaves exactly like
    // the warm one. This call also flips Rust's "frontend ready" flag, after
    // which opens emit live — so a file is never both drained and emitted.
    // Ordering matters: register the listener FIRST, then drain, or an open
    // landing between the two would be lost by both.
    invoke('take_pending_opens')
      .then(function (paths) { handleOpenPaths(paths); })
      .catch(function (err) {
        // Older shell without the command — the warm path still works.
        console.warn('[TVNative] take_pending_opens unavailable', err);
      });

    // U-02: wire View > Appearance submenu events (DR-11–DR-14).
    // Rust emits event names matching the menu item ids:
    //   "menu:appearance-light" | "menu:appearance-dark" | "menu:appearance-system"
    // We call window.TV.setTheme() with the matching string ('light'|'dark'|'system').
    // Guard: only act if window.TV && window.TV.setTheme is a function.
    var appearanceMap = {
      'menu:appearance-light':  'light',
      'menu:appearance-dark':   'dark',
      'menu:appearance-system': 'system'
    };
    Object.keys(appearanceMap).forEach(function (eventName) {
      var theme = appearanceMap[eventName];
      listen(eventName, function () {
        var tvAp = getTV();
        if (tvAp && typeof tvAp.setTheme === 'function') {
          tvAp.setTheme(theme);
        }
      }).catch(function (err) {
        console.error('[TVNative] failed to register ' + eventName + ' listener', err);
      });
    });

    // F-22 / DR-20: Help > Keyboard Shortcuts → window.TV.openShortcuts().
    // Rust emits "menu:keyboard-shortcuts" from on_menu_event.
    listen('menu:keyboard-shortcuts', function () {
      var tvKs = getTV();
      if (tvKs && typeof tvKs.openShortcuts === 'function') {
        tvKs.openShortcuts();
      }
    }).catch(function (err) {
      console.error('[TVNative] failed to register menu:keyboard-shortcuts listener', err);
    });

    // C-36: File ▸ Print… ⌘P. The menu accelerator means macOS eats the key
    // before the WebView sees it, so tv-app.js's own ⌘P handler cannot also
    // fire — both routes end at the same print_page command.
    listen('menu:print', function () {
      invoke('print_page').catch(function (err) {
        console.warn('[TVNative] print_page failed', err);
        showToast('Could not open the print dialog', { kind: 'error' });
      });
    }).catch(function (err) {
      console.error('[TVNative] failed to register menu:print listener', err);
    });

    // C-36: File ▸ Reveal in Finder — acts on the active tab's file.
    listen('menu:reveal-in-finder', function () {
      var tab = getActiveTab();
      if (tab && tab.nativePath) revealInFinder(tab.nativePath);
      else showToast('Save this document first, then reveal it in Finder', { kind: 'error' });
    }).catch(function (err) {
      console.error('[TVNative] failed to register menu:reveal-in-finder listener', err);
    });

    // DOC-MENU: a Galley item picked in the document's native context menu
    // (lib.rs willOpenMenu). Payload: the item id, e.g. 'copy-markdown'.
    listen('doc-menu', function (e) {
      if (window.TV && typeof window.TV.runDocMenu === 'function') window.TV.runDocMenu(e && e.payload);
    }).catch(function (err) {
      console.error('[TVNative] failed to register doc-menu listener', err);
    });

    // UXF-09: trackpad finger phases from lib.rs's NSEvent monitor. One touch
    // is one swipe gesture (exact onset, momentum never sent); TVSwipe owns
    // the rules. Payload: { phase, t, dx, dy, precise, inverted, x, y, mods }.
    listen('swipe-touch', function (e) {
      if (window.TVSwipe && typeof window.TVSwipe.touch === 'function') window.TVSwipe.touch(e && e.payload);
    }).catch(function (err) {
      console.error('[TVNative] failed to register swipe-touch listener', err);
    });

    // UXF-10: File ▸ Open Path… (⌘L) — the palette in path mode.
    listen('menu:open-path', function () {
      if (window.TVPalette && typeof window.TVPalette.openPath === 'function') window.TVPalette.openPath();
    }).catch(function (err) {
      console.error('[TVNative] failed to register menu:open-path listener', err);
    });

    // UXF-06: View ▸ Reveal in Sidebar (⇧⌘J) — same path as the palette row,
    // the tab menu item and the browser-build key route.
    listen('menu:reveal-in-sidebar', function () {
      var tv = getTV();
      if (tv && typeof tv.revealInSidebar === 'function') tv.revealInSidebar();
    }).catch(function (err) {
      console.error('[TVNative] failed to register menu:reveal-in-sidebar listener', err);
    });

    // C-36: Edit ▸ Find ▸ Find Next ⌘G / Find Previous ⇧⌘G. TV.findStep is
    // added by the shell; until it lands these are quiet no-ops rather than
    // errors, so the menu items never throw.
    function findStep(dir) {
      var tv = getTV();
      if (tv && typeof tv.findStep === 'function') tv.findStep(dir);
    }
    listen('menu:find-next', function () { findStep(1); })
      .catch(function (err) { console.error('[TVNative] failed to register menu:find-next listener', err); });
    listen('menu:find-prev', function () { findStep(-1); })
      .catch(function (err) { console.error('[TVNative] failed to register menu:find-prev listener', err); });

    // C-36: keep Appearance checkmarks and Open Recent in step with the app.
    wireMenuSync();

    // Wire titlebar drag region (waits for TV to be ready)
    wireTitlebarDragRegion();
  }

  /* ── boot: wait for TV to be available then run init ─────── */
  function boot() {
    if (!available) return; // plain browser — nothing to do

    // If TV is already up (loaded before us), init immediately
    if (window.TV && typeof window.TV.on === 'function') {
      init();
    } else {
      // Poll briefly until TV is ready (handles async load order edge cases)
      var attempts = 0;
      var maxAttempts = 50; // 50 × 50ms = 2.5s
      var interval = setInterval(function () {
        attempts++;
        if (window.TV && typeof window.TV.on === 'function') {
          clearInterval(interval);
          init();
        } else if (attempts >= maxAttempts) {
          clearInterval(interval);
          // Init anyway — wireTitlebarDragRegion will be no-op without TV.on
          init();
        }
      }, 50);
    }
  }

  /* ── public API ──────────────────────────────────────────── */
  window.TVNative = {
    available: available,
    init: init,
    openPicker: openPicker,
    openFolder: openFolder,
    openInto: openInto,        // exposed for tv-app.js recent-file reopen
    saveTab: saveTab,
    startWatch: startWatch,
    stopWatch: stopWatch,
    unwatchFolder: unwatchFolder,      // ISS-005: stop a folder-root watch on close
    reopenFolder: reopenFolder,        // ISS-FOLDER: reopen a known folder (no dialog)
    revealInFinder: revealInFinder,    // F-10/F-16
    classifyReadError: classifyReadError,
    showToast: showToast,      // exposed so tv-app.js handleSave can surface errors
    readDirTree: readDirTree,  // F-19: directory tree for sidebar folder section
    listDir: listDir,          // UXF-10: Open Path completer
    // C-36: pushed to Rust on every render; exposed so the shell can force a
    // refresh right after it mutates the MRU, without waiting for a repaint.
    syncRecentMenu: syncRecentMenu,
    syncAppearanceMenu: syncAppearanceMenu,
    // C-36: tv-app.js's setTheme() calls TVNative.notifyTheme(choice, resolved)
    // directly, so the checkmark updates on the same tick instead of waiting
    // for the render-driven sync above to catch it. Takes the explicit choice
    // rather than re-deriving it from storage.
    notifyTheme: notifyTheme,
  };

  /* ── wire boot on DOM ready ──────────────────────────────── */
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }

})();
