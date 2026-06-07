/* ───────────────────────────────────────────────────────────
   tiny-viewer · live-watch + status bar
   window.TVLive = { start(tabId), stop(tabId), stopAll() }

   DR-05/DR-10: watch files live without scrolljacking.
   Two modes:
     A) fileHandle tab — poll getFile().lastModified every ~1s
     B) demo / seed tab (live:true, no handle) — stream TV_STREAM
        word-by-word with a status bar injected into .tv-viewer
   ─────────────────────────────────────────────────────────── */
(function () {
  'use strict';

  /* ── motion preference ───────────────────────────────────── */
  function prefersReducedMotion() {
    return (
      window.matchMedia &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches
    );
  }

  /* ── TV accessor helpers ─────────────────────────────────── */
  function getTV() {
    return window.TV || null;
  }

  function getTab(tabId) {
    const tv = getTV();
    if (!tv || !tv.state || !tv.state.tabs) return null;
    return tv.state.tabs.find(function (t) { return t.id === tabId; }) || null;
  }

  function isActiveTab(tabId) {
    const tv = getTV();
    return tv && tv.state && tv.state.activeId === tabId;
  }

  /* ── per-tab live state ──────────────────────────────────── */
  // Map<tabId, { pollInterval, streamInterval, elapsedInterval, mode }>
  const _watching = {};

  /* ── DOM helpers ─────────────────────────────────────────── */

  // Build a status bar element matching CONTRACT.md spec:
  // .tv-status > .live-pill .blip + "Live" + .sep + [data-elapsed] + .spacer + .tv-pin
  function buildStatusBar() {
    const pinSvg =
      '<svg width="13" height="13" viewBox="0 0 16 16" fill="none" ' +
      'stroke="currentColor" stroke-width="1.3">' +
      '<path d="M8 1.8v5M8 9.2v5M3.4 6.5h9.2l-1.6 2.7H5L3.4 6.5Z"/></svg>';

    const bar = document.createElement('div');
    bar.className = 'tv-status tv-live-status';

    bar.innerHTML =
      '<span class="live-pill"><span class="blip"></span> Live</span>' +
      '<span class="sep">—</span>' +
      '<span data-elapsed>updated 0.0s ago</span>' +
      '<span class="spacer"></span>' +
      '<span class="tv-pin" data-tv-pin>' +
        '<span class="ic">' + pinSvg + '</span> Pin scroll' +
      '</span>';

    // Wire Pin toggle
    const pin = bar.querySelector('[data-tv-pin]');
    if (pin) {
      pin.addEventListener('click', function () {
        pin.classList.toggle('on');
      });
    }

    return bar;
  }

  // Build a .tv-writing-line for streaming content
  function buildWritingLine() {
    const p = document.createElement('p');
    p.className = 'tv-writing-line';
    p.setAttribute('data-stream', '');
    p.innerHTML = '<span class="streamed"></span><span class="tv-caret"></span>';
    return p;
  }

  // Find the .tv-viewer for the active view
  function getViewer() {
    const tv = getTV();
    const root = tv && typeof tv.el === 'function' ? tv.el() : document.querySelector('.tv');
    if (!root) return null;
    return root.querySelector('.tv-viewer');
  }

  // Find the .tv-scroll container for scroll preservation (DR-10)
  function getScrollEl() {
    const viewer = getViewer();
    return viewer ? viewer.querySelector('.tv-scroll') : null;
  }

  // Find (or create) the .md content container to append writing-line into
  function getMdEl() {
    const viewer = getViewer();
    return viewer ? viewer.querySelector('.tv-content .md') : null;
  }

  /* ── remove live UI from the viewer ─────────────────────── */
  function removeLiveUI() {
    const viewer = getViewer();
    if (!viewer) return;
    // Remove injected status bar
    const bars = viewer.querySelectorAll('.tv-live-status');
    bars.forEach(function (el) { el.parentNode.removeChild(el); });
    // Remove injected writing line
    const lines = viewer.querySelectorAll('.tv-writing-line[data-stream]');
    lines.forEach(function (el) { el.parentNode.removeChild(el); });
  }

  /* ── inject live UI for the active tab (demo mode) ─────── */
  function injectLiveUI(state) {
    // state = { tabId, streamWords, wordIndex, pinRef }
    removeLiveUI(); // idempotent: clear before re-injecting

    const viewer = getViewer();
    if (!viewer) return;

    const mdEl = getMdEl();
    if (mdEl) {
      const writingLine = buildWritingLine();
      // Restore previous stream progress
      const streamed = writingLine.querySelector('.streamed');
      if (streamed && state.wordIndex > 0) {
        const words = state.streamWords;
        streamed.textContent = words.slice(0, state.wordIndex).join(' ');
      }
      // If reduced motion, skip JS caret animation — CSS handles it
      if (prefersReducedMotion()) {
        const caret = writingLine.querySelector('.tv-caret');
        if (caret) caret.style.animation = 'none';
      }
      mdEl.appendChild(writingLine);
      state.writingLineEl = writingLine;
      state.streamedEl = streamed;
    }

    // Append status bar at bottom of .tv-viewer (flex-column so it sits below scroll)
    const bar = buildStatusBar();
    if (prefersReducedMotion()) {
      const blip = bar.querySelector('.blip');
      if (blip) blip.style.animation = 'none';
    }
    viewer.appendChild(bar);
    state.statusBarEl = bar;
    state.pinEl = bar.querySelector('[data-tv-pin]');

    return bar;
  }

  /* ── elapsed timer (shared by both modes) ─────────────────── */
  function startElapsedTimer(state) {
    state.lastModTime = Date.now();
    state.elapsedInterval = setInterval(function () {
      if (!state.statusBarEl) return;
      const elapsed = state.statusBarEl.querySelector('[data-elapsed]');
      if (!elapsed) return;
      const secs = ((Date.now() - state.lastModTime) / 1000).toFixed(1);
      elapsed.textContent = 'updated ' + secs + 's ago';
    }, 900);
  }

  /* ── demo streaming mode (seed tabs with live:true, no handle) */
  function startDemoMode(tabId) {
    const state = _watching[tabId];
    if (!state) return;

    const words = (window.TV_STREAM || '').split(' ');
    state.streamWords = words;
    state.wordIndex = 0;

    // Inject initial live UI
    if (isActiveTab(tabId)) {
      injectLiveUI(state);
    }

    // Start elapsed clock
    startElapsedTimer(state);

    // Start streaming words
    state.streamInterval = setInterval(function () {
      // Only animate if this tab is active
      if (!isActiveTab(tabId)) return;

      // Ensure UI is injected (may have been removed after a render)
      if (!state.streamedEl || !document.contains(state.streamedEl)) {
        injectLiveUI(state);
      }
      if (!state.streamedEl) return;

      if (state.wordIndex < words.length) {
        const prefix = state.wordIndex > 0 ? ' ' : '';
        state.streamedEl.textContent += prefix + words[state.wordIndex];
        state.wordIndex++;
      } else {
        // Loop: reset
        state.wordIndex = 0;
        state.streamedEl.textContent = '';
        state.lastModTime = Date.now(); // treat loop as a "new update"
      }

      // Pin scroll: if pin is on, scroll writing line into view
      if (state.pinEl && state.pinEl.classList.contains('on')) {
        const scrollEl = getScrollEl();
        if (scrollEl) {
          scrollEl.scrollTop = scrollEl.scrollHeight;
        }
      }
      // If pin is off: leave scroll alone (DR-10)
    }, 240);
  }

  /* ── file handle polling mode (DR-05: real file watch) ───── */
  function startPollingMode(tabId) {
    const state = _watching[tabId];
    if (!state) return;

    let lastModified = null;

    state.pollInterval = setInterval(async function () {
      const tab = getTab(tabId);
      if (!tab || !tab.fileHandle) {
        stop(tabId);
        return;
      }

      let file;
      try {
        file = await tab.fileHandle.getFile();
      } catch (err) {
        // Handle was revoked / permission lost — stop silently
        console.warn('[TVLive] getFile error, stopping', err);
        stop(tabId);
        return;
      }

      if (lastModified === null) {
        lastModified = file.lastModified;
        return; // first poll establishes baseline
      }

      if (file.lastModified !== lastModified) {
        lastModified = file.lastModified;

        // Re-read file text
        let newText;
        try {
          newText = await file.text();
        } catch (err) {
          console.error('[TVLive] failed to re-read file', err);
          return;
        }

        tab.source = newText;

        // Update status bar timestamp
        if (state.statusBarEl) {
          state.lastModTime = Date.now();
        }

        // Only re-render if this is the active tab in reading mode
        const tv = getTV();
        if (
          tv &&
          isActiveTab(tabId) &&
          tv.state.mode === 'reading'
        ) {
          // DR-10: capture scroll before render, restore after
          const scrollEl = getScrollEl();
          const savedScroll = scrollEl ? scrollEl.scrollTop : 0;
          const pinOn = state.pinEl && state.pinEl.classList.contains('on');

          tv.render();

          // After render, re-inject the status bar since the DOM was rebuilt
          if (isActiveTab(tabId)) {
            injectStatusBarOnly(state);
          }

          // Restore scroll (unless pin is on)
          const newScrollEl = getScrollEl();
          if (newScrollEl) {
            if (pinOn) {
              newScrollEl.scrollTop = newScrollEl.scrollHeight; // snap to tail
            } else {
              newScrollEl.scrollTop = savedScroll; // preserve (DR-10)
            }
          }
        }
      }
    }, 1000);

    // Also add status bar in poll mode (shows "Live" pill for real-file watch)
    if (isActiveTab(tabId)) {
      injectStatusBarOnly(state);
    }
    startElapsedTimer(state);
  }

  // For poll mode we inject just the status bar (no writing-line)
  function injectStatusBarOnly(state) {
    const viewer = getViewer();
    if (!viewer) return;

    // Remove any stale bar
    const existing = viewer.querySelectorAll('.tv-live-status');
    existing.forEach(function (el) { el.parentNode.removeChild(el); });

    const bar = buildStatusBar();
    if (prefersReducedMotion()) {
      const blip = bar.querySelector('.blip');
      if (blip) blip.style.animation = 'none';
    }
    viewer.appendChild(bar);
    state.statusBarEl = bar;
    state.pinEl = bar.querySelector('[data-tv-pin]');
  }

  /* ── render event listener to re-attach live UI ─────────── */
  let _renderListenerRegistered = false;

  function ensureRenderListener() {
    if (_renderListenerRegistered) return;
    const tv = getTV();
    if (!tv || typeof tv.on !== 'function') return;
    _renderListenerRegistered = true;

    tv.on('render', function () {
      // After any render, re-inject live UI for the currently active live tab
      const activeId = tv.state && tv.state.activeId;
      if (!activeId || !_watching[activeId]) return;

      const tab = getTab(activeId);
      if (!tab || !tab.live) return;

      const state = _watching[activeId];
      // Small defer so the new DOM is fully painted
      setTimeout(function () {
        if (!_watching[activeId]) return; // stopped in the meantime
        if (state.mode === 'demo') {
          injectLiveUI(state);
        } else if (state.mode === 'poll') {
          injectStatusBarOnly(state);
        }
      }, 0);
    });

    tv.on('tabchange', function (payload) {
      // Hide live UI when switching away from a live tab
      if (payload && payload.prevId && _watching[payload.prevId]) {
        removeLiveUI();
      }
      // Show live UI when switching TO a live tab
      const newId = payload && payload.id;
      if (newId && _watching[newId]) {
        const state = _watching[newId];
        setTimeout(function () {
          if (!_watching[newId]) return;
          if (state.mode === 'demo') {
            injectLiveUI(state);
          } else if (state.mode === 'poll') {
            injectStatusBarOnly(state);
          }
        }, 0);
      }
    });
  }

  /* ── public: start(tabId) ────────────────────────────────── */
  function start(tabId) {
    if (_watching[tabId]) return; // already watching

    const tab = getTab(tabId);
    if (!tab) return;

    // ── native FSEvents mode (Tauri) ─────────────────────────
    // If the tab has a nativePath and TVNative is available,
    // hand off to TVNative.startWatch(). The Rust watcher emits
    // 'file-changed' events which tv-native.js handles — no JS
    // polling needed. We still record a minimal state entry so
    // stopAll() / stop() can call TVNative.stopWatch on cleanup.
    if (
      tab.nativePath &&
      window.TVNative &&
      TVNative.available
    ) {
      TVNative.startWatch(tab);

      // Register a minimal watcher entry (mode: 'native') so
      // stop(tabId) can clean up and not re-start polling.
      _watching[tabId] = {
        tabId: tabId,
        mode: 'native',
        pollInterval: null,
        streamInterval: null,
        elapsedInterval: null,
        lastModTime: Date.now(),
        streamWords: [],
        wordIndex: 0,
        streamedEl: null,
        writingLineEl: null,
        statusBarEl: null,
        pinEl: null,
      };
      return;
    }

    ensureRenderListener();

    const state = {
      tabId: tabId,
      mode: tab.fileHandle ? 'poll' : 'demo',
      pollInterval: null,
      streamInterval: null,
      elapsedInterval: null,
      lastModTime: Date.now(),
      streamWords: [],
      wordIndex: 0,
      streamedEl: null,
      writingLineEl: null,
      statusBarEl: null,
      pinEl: null,
    };

    _watching[tabId] = state;

    if (state.mode === 'poll') {
      startPollingMode(tabId);
    } else {
      startDemoMode(tabId);
    }
  }

  /* ── public: stop(tabId) ─────────────────────────────────── */
  function stop(tabId) {
    const state = _watching[tabId];
    if (!state) return;

    clearInterval(state.pollInterval);
    clearInterval(state.streamInterval);
    clearInterval(state.elapsedInterval);
    clearTimeout(state._reinjectTimeout);

    // For native FSEvents mode: tell the Rust watcher to stop
    if (state.mode === 'native') {
      const tab = getTab(tabId);
      if (tab && window.TVNative && TVNative.available) {
        TVNative.stopWatch(tab);
      }
    }

    delete _watching[tabId];

    // Only remove live UI from DOM if this tab is the active one
    if (isActiveTab(tabId)) {
      removeLiveUI();
    }
  }

  /* ── public: stopAll() ───────────────────────────────────── */
  function stopAll() {
    Object.keys(_watching).forEach(function (id) {
      stop(id);
    });
  }

  /* ── public: refresh() — for shells that can't use TV.on ─── */
  // Call after TV.render() if you can't register a 'render' listener
  function refresh() {
    const tv = getTV();
    const activeId = tv && tv.state && tv.state.activeId;
    if (!activeId || !_watching[activeId]) return;

    const state = _watching[activeId];
    const tab = getTab(activeId);
    if (!tab || !tab.live) return;

    if (state.mode === 'demo') {
      injectLiveUI(state);
    } else if (state.mode === 'poll') {
      injectStatusBarOnly(state);
    }
  }

  /* ── public API ──────────────────────────────────────────── */
  window.TVLive = {
    start: start,
    stop: stop,
    stopAll: stopAll,
    refresh: refresh,
  };
})();
