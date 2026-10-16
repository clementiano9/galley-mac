/* ───────────────────────────────────────────────────────────
   Galley · reading-progress rail (UXF-11)
   window.TVProgress = { sync(), state() -> { visible, pct, minutesLeft } }
   A thin thumb on the viewer's right edge, for documents longer than the
   window: its length is the share on screen, its position how far you have
   read. It fades in when you scroll and out once scrolling stops, shows
   under the pointer, drags like a scrollbar, and the tip beside it says
   "42% · 6 min left". It is an overlay (no layout width) and aria-hidden:
   .tv-scroll stays the real, keyboard-scrollable element.
   ─────────────────────────────────────────────────────────── */
(function () {
  'use strict';

  var INSET = 6;          // px kept free at the top and bottom of the track
  var MIN_THUMB = 28;
  var WPM = 230;
  var IDLE_MS = 900;      // shown this long after the last scroll
  var INTENT_MS = 400;    // a scroll this soon after wheel/key/click is the reader's
  var SCROLL_KEYS = { ' ': 1, PageUp: 1, PageDown: 1, Home: 1, End: 1, ArrowUp: 1, ArrowDown: 1 };

  var _scroller = null, _rail = null, _thumb = null, _tip = null;
  var _ro = null, _idle = 0, _raf = 0, _drag = null, _hover = false, _intentAt = 0;
  var _words = 0, _wordsFor = null;
  var _st = { visible: false, pct: 0, minutesLeft: 0 };

  function _reduced() {
    return !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  }

  function _countWords(scroller) {
    var md = scroller.querySelector('.md') || scroller.querySelector('.tv-content');
    if (!md) return 0;
    if (_wordsFor === md && _words) return _words;
    var t = md.textContent || '';
    var m = t.match(/\S+/g);
    _wordsFor = md;
    _words = m ? m.length : 0;
    return _words;
  }

  function _geom() {
    var sc = _scroller;
    var sh = sc.scrollHeight, ch = sc.clientHeight, max = sh - ch;
    var trackH = Math.max(0, ch - INSET * 2);
    var thumbH = Math.min(trackH, Math.max(MIN_THUMB, Math.round(trackH * ch / Math.max(1, sh))));
    var frac = max > 0 ? Math.min(1, Math.max(0, sc.scrollTop / max)) : 0;
    return { sh: sh, ch: ch, max: max, trackH: trackH, thumbH: thumbH, frac: frac };
  }

  function _tipText() {
    if (_st.pct >= 100) return 'End';
    var left = _st.minutesLeft < 1 ? 'under a minute left' : _st.minutesLeft + ' min left';
    return _st.pct + '% · ' + left;
  }

  function sync() {
    _raf = 0;
    if (!_scroller || !_rail || !_scroller.isConnected) return;
    var g = _geom();
    var visible = g.max > 1 && g.ch > 0;
    _st.visible = visible;
    _rail.classList.toggle('is-on', visible);
    if (!visible) { _st.pct = 0; _st.minutesLeft = 0; return; }
    _st.pct = Math.round(g.frac * 100);
    // Words below the fold, from the share of the document not yet passed.
    var bottom = (_scroller.scrollTop + g.ch) / g.sh;
    _st.minutesLeft = Math.ceil(_countWords(_scroller) * Math.max(0, 1 - bottom) / WPM);
    var top = _scroller.offsetTop + INSET;
    var y = Math.round((g.trackH - g.thumbH) * g.frac);
    // CSSOM, not style="" attributes: the Tauri CSP drops those.
    _rail.style.top = top + 'px';
    _rail.style.height = g.trackH + 'px';
    _thumb.style.height = g.thumbH + 'px';
    _thumb.style.transform = 'translateY(' + y + 'px)';
    if (_hover || _drag) {
      _tip.textContent = _tipText();
      var tipY = Math.min(Math.max(0, y + g.thumbH / 2 - 11), Math.max(0, g.trackH - 22));
      _tip.style.transform = 'translateY(' + Math.round(tipY) + 'px)';
    }
  }

  function _schedule() {
    if (_raf) return;
    _raf = 1;   // sync() clears it
    (window.requestAnimationFrame || setTimeout)(sync);
  }

  // Show the rail and hide it IDLE_MS after the last call (CSS fades both ways).
  function _reveal() {
    if (!_rail) return;
    _rail.classList.add('is-active');
    clearTimeout(_idle);
    _idle = setTimeout(function () { if (_rail && !_drag) _rail.classList.remove('is-active'); }, IDLE_MS);
  }

  // Only the reader's scrolling shows the rail. Renders restore scrollTop
  // (tab switch, live update, pin-to-tail) and images shift it as they load;
  // none of those should flash it.
  function _onScroll() {
    var shown = _rail && (_drag || _hover || _rail.classList.contains('is-active'));
    if (shown || Date.now() - _intentAt < INTENT_MS) _reveal();
    _schedule();
  }
  function _intent() { _intentAt = Date.now(); }
  function _onKey(e) { if (SCROLL_KEYS[e.key]) _intent(); }

  /* ── pointer: drag the thumb, click the track to jump there ── */
  function _onDown(e) {
    if (!_scroller || e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    var g = _geom(), rect = _rail.getBoundingClientRect();
    var y = e.clientY - rect.top, thumbY = (g.trackH - g.thumbH) * g.frac;
    if (y < thumbY || y > thumbY + g.thumbH) {
      // Jump so the thumb centres on the click, then keep dragging from there.
      var f = (y - g.thumbH / 2) / Math.max(1, g.trackH - g.thumbH);
      _scroller.scrollTop = Math.min(1, Math.max(0, f)) * g.max;
      g = _geom();
    }
    _drag = { y0: e.clientY, top0: _scroller.scrollTop, ratio: g.max / Math.max(1, g.trackH - g.thumbH) };
    _rail.classList.add('is-drag', 'is-active');
    // Window listeners, not pointer capture: a render (live update) moves the
    // rail to the new viewer mid-drag, which would drop a capture.
    window.addEventListener('pointermove', _onMove);
    window.addEventListener('pointerup', _onUp);
    window.addEventListener('pointercancel', _onUp);
    _schedule();
  }
  function _onMove(e) {
    if (!_drag || !_scroller) return;
    _scroller.scrollTop = _drag.top0 + (e.clientY - _drag.y0) * _drag.ratio;
  }
  function _onUp() {
    window.removeEventListener('pointermove', _onMove);
    window.removeEventListener('pointerup', _onUp);
    window.removeEventListener('pointercancel', _onUp);
    if (!_drag) return;
    _drag = null;
    if (_rail) _rail.classList.remove('is-drag');
    _reveal();
    _schedule();
  }

  // The rail sits over the scroller, not inside it: hand wheel and trackpad
  // scrolling through to the document.
  function _onWheel(e) {
    if (!_scroller) return;
    e.preventDefault();
    var unit = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? _scroller.clientHeight : 1;
    _scroller.scrollTop += e.deltaY * unit;
  }

  // A text selection dragged from the document must pass over the rail
  // (in DOM order it follows the content and would select the rest).
  function _onDocDown(e) {
    if (_rail && !_rail.contains(e.target)) _rail.classList.add('is-passive');
    // A click in the document (an anchor link, a selection that autoscrolls).
    if (_scroller && _scroller.contains && _scroller.contains(e.target)) _intent();
  }
  function _onDocUp() { if (_rail) _rail.classList.remove('is-passive'); }

  function _build(viewer) {
    var rail = document.createElement('div');
    rail.className = 'tv-progress';
    rail.setAttribute('aria-hidden', 'true');
    rail.innerHTML = '<div class="tv-progress-thumb"></div><div class="tv-progress-tip"></div>';
    viewer.appendChild(rail);
    rail.addEventListener('pointerdown', _onDown);
    rail.addEventListener('wheel', _onWheel, { passive: false });
    rail.addEventListener('pointerenter', function () { _hover = true; rail.classList.add('is-hover'); _schedule(); });
    // Leaving keeps it for IDLE_MS, then it fades like after a scroll.
    rail.addEventListener('pointerleave', function () { _hover = false; rail.classList.remove('is-hover'); _reveal(); });
    return rail;
  }

  // After every render: find the viewer's scroller and (re)attach to it.
  function attach() {
    var root = (window.TV && typeof window.TV.el === 'function') ? window.TV.el() : document;
    var viewer = root && root.querySelector('.tv-viewer');
    var sc = viewer && viewer.querySelector('.tv-scroll');
    if (sc !== _scroller) {
      if (_scroller) _scroller.removeEventListener('scroll', _onScroll);
      if (_ro) _ro.disconnect();
      _scroller = sc || null;
      _intentAt = 0;   // the input that caused this render (a tab click, ⌘1) is not scrolling
      if (_scroller) {
        _scroller.addEventListener('scroll', _onScroll, { passive: true });
        if (typeof ResizeObserver === 'function') {
          _ro = new ResizeObserver(function () { _wordsFor = null; _schedule(); });
          _ro.observe(_scroller);
          var content = _scroller.querySelector('.tv-content');
          if (content) _ro.observe(content);
        }
      }
    }
    // One rail for the app's life: a render moves it into the new viewer, so
    // hover and a drag in progress survive live updates.
    if (viewer && !_rail) {
      _rail = _build(viewer);
      _thumb = _rail.firstChild;
      _tip = _rail.lastChild;
    } else if (viewer && _rail.parentNode !== viewer) {
      viewer.appendChild(_rail);
    } else if (!viewer && _rail && _rail.parentNode) {
      _rail.parentNode.removeChild(_rail);
    }
    _rail && _rail.classList.toggle('no-motion', _reduced());
    _wordsFor = null;
    sync();
  }

  function init() {
    if (!window.TV || typeof window.TV.on !== 'function') return;
    window.TV.on('render', attach);
    window.addEventListener('resize', _schedule);
    window.addEventListener('wheel', _intent, { capture: true, passive: true });
    document.addEventListener('keydown', _onKey, true);
    document.addEventListener('pointerdown', _onDocDown, true);
    document.addEventListener('pointerup', _onDocUp, true);
    attach();
  }

  window.TVProgress = {
    sync: function () { attach(); },
    state: function () { return { visible: _st.visible, pct: _st.pct, minutesLeft: _st.minutesLeft }; }
  };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
