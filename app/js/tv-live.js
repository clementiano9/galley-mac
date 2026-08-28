/* ───────────────────────────────────────────────────────────
   Galley · live-watch + status bar
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
    // C-32: the status bar is the app's only live-watch announcement channel —
    // give it a persistent live region so a screen reader hears elapsed/change
    // updates instead of only sighted users. DR-10 (no scroll-jack) is
    // unaffected: this is an attribute, not a render/scroll path change.
    bar.setAttribute('role', 'status');
    bar.setAttribute('aria-live', 'polite');

    bar.innerHTML =
      // DR-66: neutral initial text; injectStatusBarOnly() immediately repaints
      // the real recency from lastModTime via paintRecency(). Never the legacy
      // unbounded tenths-of-a-second literal, which the bounded format can't produce.
      '<span class="live-pill"><span class="blip is-updating"></span> Live</span>' +
      '<span class="sep">—</span>' +
      '<span data-elapsed>updating…</span>' +
      '<span class="spacer"></span>' +
      // C-32: a real <button> (was a <span>) so it is Tab-reachable and
      // announces as a toggle; aria-pressed mirrors the .on class.
      '<button type="button" class="tv-pin" data-tv-pin aria-pressed="false"' +
        ' title="Follow new content as the file grows">' +
        '<span class="ic">' + pinSvg + '</span> Pin scroll' +
      '</button>';

    // Wire Pin toggle
    var pin = bar.querySelector('[data-tv-pin]');
    if (pin) {
      pin.addEventListener('click', function () {
        var on = pin.classList.toggle('on');
        pin.setAttribute('aria-pressed', on ? 'true' : 'false');
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

  /* ── DR-68: settle threshold — after this much quiet the bar auto-hides ── */
  var IDLE_THRESHOLD_MS = 90000; // 90 s

  /* ── DR-67/DR-68: single authority for blip pulse + idle state ──
     The pulse animation lives ONLY on `.blip.is-updating` (see tv-app.css).
     `.is-updating` is present whenever the watch is active (not idle) so the
     dot pulses continuously to confirm streaming (DR-65); removing it on idle
     yields a steady, dimmed dot (DR-68). Centralising the add/remove here means
     no inject path can leave the blip dark or out of sync. */
  function setIdleState(watchState, idle) {
    if (!watchState.statusBarEl) return;
    var pill = watchState.statusBarEl.querySelector('.live-pill');
    if (!pill) return;
    var blip = pill.querySelector('.blip');
    if (idle) {
      pill.classList.add('idle');
      if (blip) blip.classList.remove('is-updating'); // DR-68: stop pulsing
    } else {
      pill.classList.remove('idle');
      if (blip) blip.classList.add('is-updating');     // DR-65: active pulse
    }
  }

  /* ── DR-66/DR-70: paint recency text + blip state from lastModTime ──
     The displayed text is ALWAYS derived from lastModTime — never a hardcoded
     literal — so every (possibly redundant) re-inject path converges to the
     correct value instead of clobbering a just-set "updating…" back to a stale
     string. This is what fixes the change-flash race and the tab-switch flash. */
  function paintRecency(watchState) {
    if (!watchState.statusBarEl || !watchState.lastModTime) return;
    var elapsed = watchState.statusBarEl.querySelector('[data-elapsed]');
    if (!elapsed) return;
    var delta = Date.now() - watchState.lastModTime;
    elapsed.textContent = formatRecency(delta);
    setIdleState(watchState, delta >= IDLE_THRESHOLD_MS);
  }

  /* ── DR-67: shared on-change hook (poll + native) ─────────── */
  // Called whenever a disk change is detected. Stamps lastModTime, resets
  // the label to "updating…", clears idle state, and re-pulses the blip.
  function onFileChange(watchState, ts) {
    watchState.lastModTime = (typeof ts === 'number' && ts > 0) ? ts : Date.now();
    // Clear idle and force-restart blip pulse (DR-67 / DR-68)
    setIdleState(watchState, false);
    if (watchState.statusBarEl) {
      var elapsed = watchState.statusBarEl.querySelector('[data-elapsed]');
      if (elapsed) elapsed.textContent = 'updating…';
      // Re-trigger CSS pulse animation by toggling the blip class
      var blip = watchState.statusBarEl.querySelector('.blip');
      if (blip) {
        blip.classList.remove('is-updating');
        // Force reflow so the animation restarts cleanly. Works now because the
        // pulse lives ONLY on .is-updating (base .blip has no animation).
        void blip.offsetWidth; // eslint-disable-line no-void
        blip.classList.add('is-updating');
      }
    }
    // DR-67/DR-69: if the adaptive tick had stopped (>=1h idle, elapsedInterval
    // null), restart it so the counter resumes after this change. The null guard
    // prevents double-scheduling — JS run-to-completion means a tick callback
    // cannot interleave with this call, so a non-null handle is always live.
    if (!watchState.elapsedInterval) {
      scheduleElapsedTick(watchState);
    }
    // Light the live bolt — the file is actively changing (mirrors the bar).
    setBoltActive(watchState.tabId, true);
  }

  /* ── auto-hide threshold helper ──────────────────────────────
     "Recent" = a change happened within the last IDLE_THRESHOLD_MS. Inject
     paths consult this so a settled tab is never (re)shown — only a recent one. */
  function isRecent(watchState) {
    return !!watchState.lastModTime &&
      (Date.now() - watchState.lastModTime) < IDLE_THRESHOLD_MS;
  }

  /* ── live "bolt" icon (tab strip + sidebar) — mirror the bottom bar ──
     tab.liveActive drives the bolt icon. We set it with the SAME recency rules
     as the status bar: shown only while the file is recently active — so a static
     file opens with NO bolt, a change re-shows it, and a settle (auto-hide) hides
     it. updateTabIndicator does a lightweight tab-strip refresh; the sidebar/header
     bolts pick the flag up on their next render. */
  function setBoltActive(tabId, active) {
    var tab = getTab(tabId);
    if (!tab) return;
    active = !!active;
    if (tab.liveActive === active) return;
    tab.liveActive = active;
    var tv = getTV();
    if (tv && typeof tv.updateTabIndicator === 'function') tv.updateTabIndicator(tabId);
  }

  /* ── auto-hide: remove the settled bar but keep the watch armed ──
     User-chosen behaviour — SUPERSEDES the original DR-68 "dim to a steady dot".
     IDLE_THRESHOLD_MS (90 s) after the last detected change, the status bar is
     removed from the DOM entirely. The _watching entry, lastModTime, native/poll
     watcher, and tab.live flag all stay live, so the next disk change re-reveals
     the bar (pulsing) via onFileChange → inject. This is distinct from
     stop()/DR-71, which tears the watch down for good on file close/removal. */
  function autoHideStatusBar(watchState) {
    if (watchState.elapsedInterval) {
      clearTimeout(watchState.elapsedInterval);
      watchState.elapsedInterval = null;
    }
    var bar = watchState.statusBarEl;
    watchState.statusBarEl = null;
    watchState.pinEl = null;
    // Settled → hide the live bolt too (same rule as the bottom bar).
    setBoltActive(watchState.tabId, false);
    if (!bar || !bar.parentNode) return;
    if (prefersReducedMotion()) {
      bar.parentNode.removeChild(bar);
      return;
    }
    // Fade/slide out, then remove. The timeout is scoped to THIS bar element, so
    // a re-reveal that rebuilds the bar meanwhile is unaffected (orphan no-ops).
    bar.classList.add('is-hiding');
    setTimeout(function () {
      if (bar.parentNode) bar.parentNode.removeChild(bar);
    }, 240);
  }

  /* ── DR-66 + auto-hide: 1 s tick until settle, then remove the bar ───
     Cadence: tick every 1 s while the file is recent (< IDLE_THRESHOLD_MS),
     repainting the bounded label (DR-66). At the 90 s threshold the bar is
     auto-hidden and ticking stops — there is no visible counter past 90 s, so
     the old minutes/hours cadence is gone. A later change re-reveals the bar and
     restarts the tick via onFileChange's null guard. 1 s cadence through the
     whole visible window keeps the label exact and makes the hide fire within
     1 s of 90 s (the "settles within 90 s" success metric). */
  function runElapsedTick(watchState) {
    watchState.elapsedInterval = null; // cleared before any early return
    if (!watchState.statusBarEl) return;
    if (Date.now() - watchState.lastModTime >= IDLE_THRESHOLD_MS) {
      autoHideStatusBar(watchState); // settled → remove bar, keep watch armed
      return;
    }
    paintRecency(watchState); // bounded text (DR-66) from lastModTime
    watchState.elapsedInterval = setTimeout(function () {
      runElapsedTick(watchState);
    }, 1000);
  }

  function scheduleElapsedTick(watchState) {
    // Single live handle: never double-schedule. onFileChange and
    // startElapsedTimer both call this; the guard makes redundant calls a no-op.
    if (watchState.elapsedInterval) return;
    // Already settled when (re)started → hide rather than show a stale bar.
    if (watchState.statusBarEl &&
        Date.now() - watchState.lastModTime >= IDLE_THRESHOLD_MS) {
      autoHideStatusBar(watchState);
      return;
    }
    watchState.elapsedInterval = setTimeout(function () {
      runElapsedTick(watchState);
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

    // DR-66/DR-68/DR-70: paint the correct recency text + blip/idle state on the
    // fresh DOM immediately from lastModTime. This removes the tab-switch "0.0s"
    // flash and makes every redundant re-inject converge to the right value
    // instead of clobbering a just-set "updating…".
    paintRecency(watchState);
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
            // DR-65/DR-66/DR-70: the file DID change on disk, so the recency
            // clock must reset even though we keep the dirty buffer. onFileChange
            // stamps lastModTime + resets the label/blip without re-rendering, so
            // the indicator stays honest instead of counting from the prior change
            // while the toast says the file just changed.
            onFileChange(watchState);
            var tv = getTV();
            if (tv && window.TVNative && typeof TVNative.showToast === 'function') {
              // requests-native.md #1: no em dash, error kind (was silently
              // unreadable/invisible per C-01 before showToast({kind}) existed).
              TVNative.showToast((tab.name || 'File') + ' changed on disk. Save or discard your edits first.', { kind: 'error' });
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

    // Open-time display: read the file's REAL mtime up front and only show the
    // bar if the file is recent. Doing this asynchronously (rather than the old
    // synchronous inject) prevents a static file from flashing the indicator
    // before any getFile() resolves — open-time should not show the indicator
    // unless the file was written within the 90 s recency window.
    var tab0 = getTab(tabId);
    if (tab0 && tab0.fileHandle) {
      tab0.fileHandle.getFile().then(function (file) {
        // Seed both the recency clock and the poll-loop baseline from the real
        // mtime so the first real change is detected against the true value.
        watchState.lastModTime = file.lastModified;
        if (lastModified === null) lastModified = file.lastModified;
        if (isActiveTab(tabId) && isRecent(watchState)) {
          injectStatusBarOnly(watchState);
          startElapsedTimer(watchState);
        }
        setBoltActive(tabId, isRecent(watchState)); // bolt mirrors recency on open
      }).catch(function () {
        // getFile() rejected — leave lastModTime as seeded by start() and do not
        // crash. A later detected change still reveals the bar via onFileChange.
      });
    }
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
        // Re-inject for both poll and native modes (L-04: native mode was missing
        // this). Auto-hide: only (re)show while the file is recent — a settled tab
        // (≥90 s since last change) must stay hidden, not be resurrected by a
        // theme/mode/tab render. A real change re-reveals it via onFileChange.
        if (watchState.mode === 'poll' || watchState.mode === 'native') {
          if (isRecent(watchState)) injectStatusBarOnly(watchState);
        }
      }, 0);
    });

    // E-06: use prevId to remove the previous live tab's UI when switching tabs,
    // preventing ghost status bars and writing-lines on the next tab.
    tv.on('tabchange', function (payload) {
      // Remove live UI when switching AWAY from a live tab.
      var prevId = payload && payload.prevId;
      if (prevId && _watching[prevId]) {
        var prev = _watching[prevId];
        // Stop the previous tab's tick and drop its bar ref BEFORE removing the
        // bar: otherwise its 1 s tick could fire autoHideStatusBar/removeLiveUI
        // into the now-active tab's viewer and yank the wrong bar.
        if (prev.elapsedInterval) {
          clearTimeout(prev.elapsedInterval);
          prev.elapsedInterval = null;
        }
        prev.statusBarEl = null;
        prev.pinEl = null;
        removeLiveUI();
      }
      // Show live UI when switching TO a live tab.
      var newId = payload && payload.id;
      if (newId && _watching[newId]) {
        var watchState = _watching[newId];
        setTimeout(function () {
          if (!_watching[newId]) return;
          if (watchState.mode === 'poll' || watchState.mode === 'native') {
            // Auto-hide: only show the bar if the tab is still recent. A tab that
            // settled (≥90 s) while backgrounded stays hidden until its next
            // change re-reveals it. startElapsedTimer guards double-start.
            if (isRecent(watchState)) {
              injectStatusBarOnly(watchState);
              startElapsedTimer(watchState);
            }
            // Sync the bolt to this tab's recency (handles a tab that settled
            // while backgrounded — its bolt clears on switch-back).
            setBoltActive(newId, isRecent(watchState));
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
        // Seed from the file's real mtime when present (threaded onto the tab at
        // open) so a static file (old mtime) does NOT show the indicator on open;
        // genuinely-fresh files (Save-As/demo) have no tab.lastModTime and fall
        // back to now, keeping the bar visible.
        lastModTime: (typeof tab.lastModTime === 'number' ? tab.lastModTime : Date.now()),
        statusBarEl: null,
        pinEl: null,
      };

      // Show status bar for native mode only if this is the active tab AND the
      // file is recent (written within the 90 s window). The watch is already
      // armed above via TVNative.startWatch, so a static file stays watched but
      // hidden; a later disk change re-reveals it via onFileChange → inject.
      if (isActiveTab(tabId) && isRecent(_watching[tabId])) {
        injectStatusBarOnly(_watching[tabId]);
        startElapsedTimer(_watching[tabId]);
      }
      // Bolt mirrors recency for ANY tab (active or not): static file → no bolt.
      setBoltActive(tabId, isRecent(_watching[tabId]));
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
      // Seed from the tab's real mtime when present so opening a static file does
      // not show the indicator; startPollingMode refines this from the live
      // fileHandle mtime before deciding whether to show the bar.
      lastModTime: (typeof tab.lastModTime === 'number' ? tab.lastModTime : Date.now()),
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
    watchState.elapsedInterval = null;
    // Hygiene: null the bar ref so any in-flight tick closure that still holds
    // this watchState early-returns instead of touching a detached node.
    watchState.statusBarEl = null;
    // Watch stopped (file removed/closed) → clear the live bolt (DR-71).
    setBoltActive(tabId, false);

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
  function refresh(ts) {
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
      onFileChange(watchState, ts);
    }
  }

  /* ── public: notifyChange(tabId) — stamp a disk change for ANY tab ─
     DR-70: called from tv-native.js handleFileChanged when a watched file
     changes but its tab is NOT the active/reading tab (so refresh() didn't run
     for it). For the active+live tab we do the full visual reset; otherwise we
     just record lastModTime so the elapsed display is correct on the next
     tab-switch (paintRecency derives the label from it). Mirrors poll mode,
     which stamps lastModTime unconditionally. */
  function notifyChange(tabId, ts) {
    var watchState = _watching[tabId];
    if (!watchState) return;
    var tv = getTV();
    if (isActiveTab(tabId) && tv && tv.state && tv.state.mode === 'reading') {
      // Active + reading: re-reveal the bar (injectStatusBarOnly rebuilds it even
      // if auto-hidden) then full reset to "updating…" + pulse. Without the inject
      // an auto-hidden active tab would stamp the time but show nothing.
      injectStatusBarOnly(watchState);
      onFileChange(watchState, ts);
    } else {
      // DR-119: use real disk mtime when available; fall back to Date.now().
      watchState.lastModTime = (typeof ts === 'number' && ts > 0) ? ts : Date.now();
      setBoltActive(tabId, true);          // the file changed → light the bolt
    }
  }

  /* ── public API ──────────────────────────────────────────── */
  window.TVLive = {
    start: start,
    stop: stop,
    stopAll: stopAll,
    refresh: refresh,
    notifyChange: notifyChange,
  };
})();
