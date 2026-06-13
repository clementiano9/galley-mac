/* ───────────────────────────────────────────────────────────
   tiny-viewer · native Tauri bridge
   window.TVNative = {
     available, init(), openPicker(), openFolder(),
     saveTab(tab), startWatch(tab), stopWatch(tab),
     openInto(doc), showToast(msg)
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
  var MD_EXTS = ['.md', '.markdown', '.txt'];

  function hasMdExt(path) {
    var lower = (path || '').toLowerCase();
    return MD_EXTS.some(function (ext) { return lower.endsWith(ext); });
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
      showToast('Could not reveal file in Finder');
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

  /* ── toast: transient bottom-center notice (uses .tv-toast css) ── */
  function showToast(msg) {
    var t = document.createElement('div');
    t.className = 'tv-toast';
    t.setAttribute('role', 'status');
    t.textContent = msg;
    document.body.appendChild(t);
    setTimeout(function () {
      t.classList.add('out');
      // UX-17: animationend may never fire when prefers-reduced-motion disables
      // the animation. setTimeout fallback ensures removal regardless.
      var removed = false;
      function removeSelf() {
        if (!removed && t.parentNode) {
          removed = true;
          t.parentNode.removeChild(t);
        }
      }
      t.addEventListener('animationend', removeSelf);
      setTimeout(removeSelf, 400); // fallback: remove after animation duration
    }, 3000);
  }

  /* ── openInto: register a FileDoc returned by Rust ──────── */
  //   doc = { name: string, path: string, content: string }
  //   E-12: set path to the real parent directory.
  //   E-13: intentionally do NOT set fileHandle — native tabs use nativePath only.
  function openInto(doc) {
    if (!doc || !doc.name) return;
    var tv = getTV();
    if (!tv) return;

    // E-12: use the real parent dir so sidebar groups by directory, not 'opened'
    var dirPath = parentDir(doc.path);

    var id = tv.openDoc({
      name: doc.name,
      source: doc.content,
      path: dirPath,
      // fileHandle intentionally omitted — E-13: native path used instead.
      // Native tabs NEVER have fileHandle set; nativePath is assigned below.
    });

    if (!id) return;

    var tab = tv.state.tabs.find(function (t) { return t.id === id; });
    if (tab) {
      tab.nativePath = doc.path;
      // UF-01/UF-14: mark as live so bolt icon renders in tab strip + sidebar
      tab.live = true;
    }

    // Persist this path in recent files (E-02)
    if (doc.path && typeof tv.saveRecentPath === 'function') {
      tv.saveRecentPath(doc.path);
    }

    // R7-FIX: do NOT call startWatch(tab) directly here. TVLive.start() (below) calls
    // TVNative.startWatch(tab) internally (tv-live.js line ~290). Calling startWatch
    // here AND via TVLive.start results in watch_file being invoked twice per open,
    // causing duplicate FSEvent subscriptions. TVLive.start is the single entry point.
    if (tab && tab.id && window.TVLive && typeof TVLive.start === 'function') {
      TVLive.start(tab.id);
    }
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
            showToast('Cannot open "' + fileName + '": ' + (err || 'read failed'));
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
      showToast((tab.name || 'File') + ' changed on disk — save or discard your edits first');
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
      // TVLive.refresh() handles finding the correct watchState for the active tab
      if (window.TVLive && typeof TVLive.refresh === 'function') {
        TVLive.refresh();
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
    stopWatch(tab);              // nothing left to watch
    // S-10 fix: set dirty directly (no render), then call render once below
    tab.dirty = true;

    showToast((tab.name || 'File') + ' was deleted on disk — Save to restore it');

    // S-10: single render (previously was markDirty→render + explicit render = 2 renders)
    if (typeof tv.render === 'function') tv.render();
  }

  /* ── public: openPicker ──────────────────────────────────── */
  function openPicker() {
    if (!available) return Promise.resolve();
    return invoke('pick_md_files')
      .then(function (docs) {
        (docs || []).forEach(function (doc) { openInto(doc); });
      })
      .catch(function (err) {
        // User cancel returns null/error — treat silently
        if (err) console.warn('[TVNative] openPicker cancelled or failed', err);
      });
  }

  /* ── public: openFolder (F-03) ──────────────────────────── */
  // Invokes pick_folder Rust command (dev-rust implements Vec<FileDoc>)
  function openFolder() {
    if (!available) return Promise.resolve();
    return invoke('pick_folder')
      .then(function (docs) {
        (docs || []).forEach(function (doc) { openInto(doc); });
      })
      .catch(function (err) {
        if (err) console.warn('[TVNative] openFolder cancelled or failed', err);
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
            showToast('Save failed: ' + (typeof err === 'string' ? err : 'disk error'));
            console.warn('[TVNative] saveTab (save_md_file) failed', err);
          }
          // Re-throw so handleSave() knows to keep edit mode open
          return Promise.reject(err);
        });
    } else {
      // Save-as dialog
      return invoke('save_md_file_as', {
        content: tab.source || '',
        suggested_name: tab.name || 'document.md',
      })
        .then(function (d) {
          // d is Option<FileDoc> — null when user cancelled
          if (d) {
            tab.nativePath = d.path;
            tab.name = d.name;
            // Persist the new path in recents
            if (d.path && typeof tv.saveRecentPath === 'function') {
              tv.saveRecentPath(d.path);
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
          }
          if (tv) tv.markDirty(tab.id, false);
        })
        .catch(function (err) {
          if (err) {
            showToast('Save failed: ' + (typeof err === 'string' ? err : 'disk error'));
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
    openInto: openInto,    // exposed for tv-app.js recent-file reopen
    saveTab: saveTab,
    startWatch: startWatch,
    stopWatch: stopWatch,
    revealInFinder: revealInFinder,    // F-10/F-16
    classifyReadError: classifyReadError,
    showToast: showToast,  // exposed so tv-app.js handleSave can surface errors
  };

  /* ── wire boot on DOM ready ──────────────────────────────── */
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }

})();
