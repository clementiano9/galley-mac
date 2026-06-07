/* ───────────────────────────────────────────────────────────
   tiny-viewer · native Tauri bridge
   window.TVNative = {
     available, init(), openPicker(), saveTab(tab),
     startWatch(tab), stopWatch(tab)
   }

   Uses window.__TAURI__ (withGlobalTauri: true in tauri.conf.json).
   Falls back to a no-op when running in a plain browser.
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

  /* ── helpers to access TV safely ────────────────────────── */
  function getTV() {
    return window.TV || null;
  }

  function getActiveTab() {
    var tv = getTV();
    return tv ? tv.getActiveTab() : null;
  }

  /* ── openInto: register a FileDoc returned by Rust ──────── */
  //   doc = { name: string, path: string, content: string }
  function openInto(doc) {
    if (!doc || !doc.name) return;
    var tv = getTV();
    if (!tv) return;

    var id = tv.openDoc({
      name: doc.name,
      source: doc.content,
      path: 'opened',
      // fileHandle intentionally omitted — native path used instead
    });

    if (!id) return;

    var tab = tv.state.tabs.find(function (t) { return t.id === id; });
    if (tab) {
      tab.nativePath = doc.path;
    }

    startWatch(tab);
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
          console.error('[TVNative] drag-drop read_md_file failed', path, err);
        });
    });
  }

  /* ── file-changed handler ────────────────────────────────── */
  function handleFileChanged(e) {
    var payload = e.payload;
    if (!payload || !payload.path || payload.content === undefined) return;

    var tv = getTV();
    if (!tv || !tv.state || !tv.state.tabs) return;

    var tab = tv.state.tabs.find(function (t) {
      return t.nativePath === payload.path;
    });

    if (!tab) return;

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
    }
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

  /* ── public: saveTab ─────────────────────────────────────── */
  function saveTab(tab) {
    if (!available || !tab) return Promise.resolve();

    var tv = getTV();

    if (tab.nativePath) {
      // Save in-place (existing file)
      return invoke('save_md_file', { path: tab.nativePath, content: tab.source || '' })
        .then(function () {
          if (tv) tv.markDirty(tab.id, false);
          if (tv && typeof tv.render === 'function') tv.render();
        })
        .catch(function (err) {
          // Cancel or error — no-op (user dismissed dialog)
          if (err) console.warn('[TVNative] saveTab (save_md_file) failed', err);
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
          }
          if (tv) tv.markDirty(tab.id, false);
          if (tv && typeof tv.render === 'function') tv.render();
        })
        .catch(function (err) {
          if (err) console.warn('[TVNative] saveTab (save_md_file_as) failed', err);
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

    listen('tauri://drag-drop', handleDragDrop)
      .catch(function (err) {
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
    saveTab: saveTab,
    startWatch: startWatch,
    stopWatch: stopWatch,
  };

  /* ── wire boot on DOM ready ──────────────────────────────── */
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }

})();
