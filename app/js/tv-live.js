/* ───────────────────────────────────────────────────────────
   tiny-viewer · live-watch + status bar
   window.TVLive = { start(tabId), stop(tabId), stopAll(), refresh() }

   DR-05/DR-10: watch files live without scrolljacking.
   Two modes:
     A) native (Tauri) — FSEvents via tv-native.js; no JS polling.
        tv-live.js manages the status bar only.
     B) poll — fileHandle tab; poll getFile().lastModified every ~1s.

   Demo streaming mode (startDemoMode) has been removed (E-02).
   The 'demo' mode branch for seed tabs without a path no longer
   exists. Live watch only activates on real disk-opened files.
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
    var tv = getTV();
    if (!tv || !tv.state || !tv.state.tabs) return null;
    return tv.state.tabs.find(function (t) { return t.id === tabId; }) || null;
  }

  function isActiveTab(tabId) {
    var tv = getTV();
    return tv && tv.state && tv.state.activeId === tabId;
  }

  /* ── per-tab live state ──────────────────────────────────── */
  // Map<tabId, { pollInterval, elapsedInterval, mode, statusBarEl, pinEl }>
  var _watching = {};

  /* ── DOM helpers ─────────────────────────────────────────── */

  // Build a status bar element matching CONTRACT.md spec:
  // .tv-status > .live-pill .blip + "Live" + .sep + [data-elapsed] + .spacer + .tv-pin
  function buildStatusBar() {
    var pinSvg =
      '<svg width="13" height="13" viewBox="0 0 16 16" fill="none" ' +
      'stroke="currentColor" stroke-width="1.3">' +
      '<path d="M8 1.8v5M8 9.2v5M3.4 6.5h9.2l-1.6 2.7H5L3.4 6.5Z"/></svg>';

    var bar = document.createElement('div');
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
    var pin = bar.querySelector('[data-tv-pin]');
    if (pin) {
      pin.addEventListener('click', function () {
        pin.classList.toggle('on');
      });
    }

    return bar;
  }

  // Find the .tv-viewer for the active view
  function getViewer() {
    var tv = getTV();
    var root = tv && typeof tv.el === 'function' ? tv.el() : document.querySelector('.tv');
    if (!root) return null;
    return root.querySelector('.tv-viewer');
  }

  // Find the .tv-scroll container for scroll preservation (DR-10)
  function getScrollEl() {
    var viewer = getViewer();
    return viewer ? viewer.querySelector('.tv-scroll') : null;
  }

  /* ── remove live UI from the viewer ─────────────────────── */
  function removeLiveUI() {
    var viewer = getViewer();
    if (!viewer) return;
    // Remove injected status bar
    var bars = viewer.querySelectorAll('.tv-live-status');
    bars.forEach(function (el) { el.parentNode.removeChild(el); });
    // Remove any injected writing lines (safety cleanup from old demo sessions)
    var lines = viewer.querySelectorAll('.tv-writing-line[data-stream]');
    lines.forEach(function (el) { el.parentNode.removeChild(el); });
  }

  /* ── DR-66: humanized, bounded recency formatter ──────────── */
  function formatRecency(deltaMs) {
    if (deltaMs < 3000)    return 'updating…';
    if (deltaMs < 60000)   return 'updated ' + Math.floor(deltaMs / 1000) + 's ago';
    if (deltaMs < 3600000) return 'updated ' + Math.floor(deltaMs / 60000) + 'm ago';
    return 'updated ' + Math.floor(deltaMs / 3600000) + 'h ago';
  }

  /* ── DR-68: idle threshold ─────────────────────────────────── */
  var IDLE_THRESHOLD_MS = 90000; // 90 s

  /* ── DR-68: apply / clear idle visual state ──────────────── */
  function setIdleState(watchState, idle) {
    if (!watchState.statusBarEl) return;
    var pill = watchState.statusBarEl.querySelector('.live-pill');
    if (!pill) return;
    if (idle) {
      pill.classList.add('idle');
    } else {
      pill.classList.remove('idle');
    }
  }

  /* ── DR-67: shared on-change hook (poll + native) ─────────── */
  // Called whenever a disk change is detected. Stamps lastModTime, resets
  // the label to "updating…", clears idle state, and re-pulses the blip.
  function onFileChange(watchState) {
    watchState.lastModTime = Date.now();
    // Clear idle and force-restart blip pulse (DR-67 / DR-68)
    setIdleState(watchState, false);
    if (watchState.statusBarEl) {
      var elapsed = watchState.statusBarEl.querySelector('[data-elapsed]');
      if (elapsed) elapsed.textContent = 'updating…';
      // Re-trigger CSS pulse animation by toggling the blip class
      var blip = watchState.statusBarEl.querySelector('.blip');
      if (blip) {
        blip.classList.remove('is-updating');
        // Force reflow so the animation restarts cleanly
        void blip.offsetWidth; // eslint-disable-line no-void
        blip.classList.add('is-updating');
      }
    }
  }

  /* ── DR-69: adaptive tick — self-rescheduling setTimeout ─── */
  // Replaces fixed 900ms setInterval. Cadence:
  //   delta < 60s  → reschedule in 1 s
  //   delta < 1h   → reschedule in 60 s
  //   delta >= 1h  → render once, stop ticking (clear elapsedInterval)
  function scheduleElapsedTick(watchState) {
    watchState.elapsedInterval = setTimeout(function () {
      watchState.elapsedInterval = null; // cleared before any early return
      if (!watchState.statusBarEl) return;
      var elapsed = watchState.statusBarEl.querySelector('[data-elapsed]');
      if (!elapsed) return;

      var delta = Date.now() - watchState.lastModTime;
      elapsed.textContent = formatRecency(delta);

      // DR-68: toggle idle visual after 90 s
      setIdleState(watchState, delta >= IDLE_THRESHOLD_MS);

      // DR-69: schedule next tick based on current delta
      if (delta < 60000) {
        // Still in sub-minute range — tick every 1 s
        scheduleElapsedTick(watchState);
      } else if (delta < 3600000) {
        // In minutes range — tick every 60 s
        watchState.elapsedInterval = setTimeout(function () {
          watchState.elapsedInterval = null;
          scheduleElapsedTick(watchState);
        }, 60000);
      }
      // else: >= 1h — render once, stop ticking (elapsedInterval stays null)
    }, 1000);
  }

  /* ── elapsed timer ─────────────────────────────────────────── */
  function startElapsedTimer(watchState) {
    // Only reset lastModTime on the very first start (when it has not been
    // set by a real file-change event yet). On tab-switch re-starts, preserve
    // the existing value so the display shows correct elapsed since last change.
    if (!watchState.lastModTime) {
      watchState.lastModTime = Date.now();
    }
    // Guard against double-start (tabchange + render racing each other).
    if (watchState.elapsedInterval) {
      clearTimeout(watchState.elapsedInterval);
      watchState.elapsedInterval = null;
    }
    // DR-69: kick off adaptive tick
    scheduleElapsedTick(watchState);
  }

  /* ── inject status bar only (poll mode + native mode) ──── */
  function injectStatusBarOnly(watchState) {
    var viewer = getViewer();
    if (!viewer) return;

    // Remove any stale bar
    var existing = viewer.querySelectorAll('.tv-live-status');
    existing.forEach(function (el) { el.parentNode.removeChild(el); });

    var bar = buildStatusBar();
    // Reduced-motion: animation suppression is handled via CSS @media block;
    // no inline style override needed here (DR-68 idle opacity also CSS-driven).
    viewer.appendChild(bar);
    watchState.statusBarEl = bar;
    watchState.pinEl = bar.querySelector('[data-tv-pin]');

    // DR-68: restore idle visual state on the fresh DOM if already past threshold
    if (watchState.lastModTime &&
        (Date.now() - watchState.lastModTime) >= IDLE_THRESHOLD_MS) {
      setIdleState(watchState, true);
    }
  }

  /* ── file handle polling mode (DR-05: real file watch) ───── */
  function startPollingMode(tabId) {
    var watchState = _watching[tabId];
    if (!watchState) return;

    var lastModified = null;

    watchState.pollInterval = setInterval(function () {
      var tab = getTab(tabId);
      if (!tab || !tab.fileHandle) {
        stop(tabId);
        return;
      }

      tab.fileHandle.getFile().then(function (file) {
        if (lastModified === null) {
          lastModified = file.lastModified;
          return; // first poll establishes baseline
        }

        if (file.lastModified === lastModified) return;
        lastModified = file.lastModified;

        // Re-read file text
        return file.text().then(function (newText) {
          // N-01: Do NOT overwrite tab.source when the tab is dirty
          if (tab.dirty) {
            var tv = getTV();
            if (tv && window.TVNative && typeof TVNative.showToast === 'function') {
              TVNative.showToast((tab.name || 'File') + ' changed on disk — save or discard your edits first');
            }
            return;
          }

          tab.source = newText;

          // DR-67: stamp change time and reset label/pulse unconditionally —
          // even when tab is not active (no statusBarEl yet), lastModTime is
          // preserved so the elapsed display is correct on next tab-switch.
          onFileChange(watchState);

          // Only re-render if this is the active tab in reading mode
          var tv = getTV();
          if (tv && isActiveTab(tabId) && tv.state.mode === 'reading') {
            // DR-10: capture scroll before render, restore after
            var scrollEl = getScrollEl();
            var savedScroll = scrollEl ? scrollEl.scrollTop : 0;
            var pinOn = watchState.pinEl && watchState.pinEl.classList.contains('on');

            tv.render();

            // L-04: After render, re-inject the status bar since the DOM was rebuilt
            if (isActiveTab(tabId)) {
              injectStatusBarOnly(watchState);
            }

            // Restore scroll (unless pin is on)
            var newScrollEl = getScrollEl();
            if (newScrollEl) {
              if (pinOn) {
                newScrollEl.scrollTop = newScrollEl.scrollHeight; // snap to tail
              } else {
                newScrollEl.scrollTop = savedScroll; // preserve (DR-10)
              }
            }
          }
        });
      }).catch(function (err) {
        // Handle was revoked / permission lost — stop silently
        console.warn('[TVLive] getFile error, stopping', err);
        stop(tabId);
      });
    }, 1000);

    // Add status bar in poll mode (shows "Live" pill for real-file watch)
    if (isActiveTab(tabId)) {
      injectStatusBarOnly(watchState);
    }
    startElapsedTimer(watchState);
  }

  /* ── render event listener to re-attach live UI ─────────── */
  // L-04: listen to render event and re-inject status bar for the active live tab
  var _renderListenerRegistered = false;

  function ensureRenderListener() {
    if (_renderListenerRegistered) return;
    var tv = getTV();
    if (!tv || typeof tv.on !== 'function') return;
    _renderListenerRegistered = true;

    // L-04: After any render, re-inject live UI for the currently active live tab.
    // This covers: tab-switch renders, mode-change renders, theme-change renders,
    // and the native file-changed path (handleFileChanged calls tv.render).
    tv.on('render', function () {
      var activeId = tv.state && tv.state.activeId;
      if (!activeId || !_watching[activeId]) return;

      var tab = getTab(activeId);
      if (!tab || !tab.live) return;

      var watchState = _watching[activeId];
      // Small defer so the new DOM is fully painted
      setTimeout(function () {
        if (!_watching[activeId]) return; // stopped in the meantime
        // Re-inject for both poll and native modes (L-04: native mode was missing this)
        if (watchState.mode === 'poll' || watchState.mode === 'native') {
          injectStatusBarOnly(watchState);
        }
      }, 0);
    });

    // E-06: use prevId to remove the previous live tab's UI when switching tabs,
    // preventing ghost status bars and writing-lines on the next tab.
    tv.on('tabchange', function (payload) {
      // Remove live UI when switching AWAY from a live tab
      var prevId = payload && payload.prevId;
      if (prevId && _watching[prevId]) {
        removeLiveUI();
      }
      // Show live UI when switching TO a live tab
      var newId = payload && payload.id;
      if (newId && _watching[newId]) {
        var watchState = _watching[newId];
        setTimeout(function () {
          if (!_watching[newId]) return;
          if (watchState.mode === 'poll' || watchState.mode === 'native') {
            injectStatusBarOnly(watchState);
            // Start the elapsed timer if it was never started (e.g. native-mode tab
            // was not the active tab when start() was called, so startElapsedTimer
            // was skipped). startElapsedTimer guards against double-start internally.
            startElapsedTimer(watchState);
          }
        }, 0);
      }
    });
  }

  /* ── public: start(tabId) ────────────────────────────────── */
  function start(tabId) {
    if (_watching[tabId]) return; // already watching

    var tab = getTab(tabId);
    if (!tab) return;

    ensureRenderListener();

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

      _watching[tabId] = {
        tabId: tabId,
        mode: 'native',
        pollInterval: null,
        elapsedInterval: null,
        lastModTime: Date.now(),
        statusBarEl: null,
        pinEl: null,
      };

      // Show status bar for native mode if this is the active tab
      if (isActiveTab(tabId)) {
        injectStatusBarOnly(_watching[tabId]);
        startElapsedTimer(_watching[tabId]);
      }
      return;
    }

    // ── poll mode: real fileHandle, no Tauri ─────────────────
    // Only start polling if the tab has a fileHandle (browser FS API).
    // E-02: do NOT start demo mode — that has been removed.
    if (!tab.fileHandle) {
      // No handle and no native path — cannot watch this tab
      return;
    }

    var watchState = {
      tabId: tabId,
      mode: 'poll',
      pollInterval: null,
      elapsedInterval: null,
      lastModTime: Date.now(),
      statusBarEl: null,
      pinEl: null,
    };

    _watching[tabId] = watchState;
    startPollingMode(tabId);
  }

  /* ── public: stop(tabId) ─────────────────────────────────── */
  function stop(tabId) {
    var watchState = _watching[tabId];
    if (!watchState) return;

    clearInterval(watchState.pollInterval);
    // elapsedInterval is now a setTimeout handle (DR-69 adaptive cadence)
    clearTimeout(watchState.elapsedInterval);

    // For native FSEvents mode: tell the Rust watcher to stop
    if (watchState.mode === 'native') {
      var tab = getTab(tabId);
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

  /* ── public: refresh() — re-inject live UI for active live tab ─
     Called from tv-native.js handleFileChanged after tv.render()
     so the status bar is restored after a file-changed render (L-04).
     Also records the file-change timestamp so the elapsed display
     counts from the actual change (native mode has no other place to
     update lastModTime — poll mode updates it inline). */
  function refresh() {
    var tv = getTV();
    var activeId = tv && tv.state && tv.state.activeId;
    if (!activeId || !_watching[activeId]) return;

    var watchState = _watching[activeId];
    var tab = getTab(activeId);
    if (!tab || !tab.live) return;

    if (watchState.mode === 'poll' || watchState.mode === 'native') {
      // DR-67: stamp change, reset label + blip pulse, clear idle (native mode).
      // injectStatusBarOnly runs after so statusBarEl is fresh and onFileChange
      // can find [data-elapsed] and .blip in the new DOM.
      injectStatusBarOnly(watchState);
      onFileChange(watchState);
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
