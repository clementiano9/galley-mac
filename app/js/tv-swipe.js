/* ───────────────────────────────────────────────────────────
   Galley · two-finger swipe shows / hides the sidebar  (UXF-05)
   window.TVSwipe = { create(opts), install(opts), ownsHorizontalScroll(...) }

   create() is a pure state machine (no DOM, injectable clock) so the gesture
   rules are unit-tested in node (js/tv-swipe.test.js). install() is the thin
   DOM adapter: ONE passive `wheel` listener on document, installed once from
   tv-app.js init() — never per render, because render() replaces the DOM.

   WKWebView delivers a trackpad swipe as fine-grained wheel events with
   deltaX, followed by a momentum tail at ~16 ms intervals. One gesture = a
   run of events with no gap longer than QUIET_MS; it can toggle at most once.

   Forgiving by design (owner feedback: "it needs to be precise"): the axis is
   judged on a sliding WINDOW_MS of recent movement, not locked on the first
   few pixels, so start-up wobble, diagonal drift, a swipe begun while a
   vertical scroll is still coasting, or a change of mind all still work.

   UXF-09 (back-to-back swipes): macOS momentum runs 0.7-1.3 s and a new touch
   cuts it with only a 32-81 ms gap, so a quiet gap alone merged swipe #2 into
   the already-fired swipe #1. Two boundaries now:
     · wheel path (browser, and any wheel without native phases): after a
       gesture has toggled, >= REV_PX of finger movement AGAINST it within
       REV_MS starts a new gesture — momentum never reverses.
     · touch path: in the desktop app Rust forwards the trackpad's finger
       phases (`swipe-touch`, lib.rs). One touch is one gesture, exactly;
       momentum is never sent. While that stream is live the wheel path
       stands down (WHEEL_DEFER_MS).
   ─────────────────────────────────────────────────────────── */
(function (root, factory) {
  var api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) root.TVSwipe = api;
}(typeof window !== 'undefined' ? window : this, function () {
  'use strict';

  var QUIET_MS = 160;          // a gap this long starts a new gesture
  var WINDOW_MS = 250;         // movement summed over this much recent time
  var AXIS_MS = 100;           // dominance is judged on the most recent slice
  var AXIS_RATIO = 1.3;        // horizontal if |Σdx| ≥ 1.3 × |Σdy| over AXIS_MS
  var TRIGGER_PX = 48;         // |Σdx| in the window needed to toggle
  var COOLDOWN_MS = 200;       // after a toggle, no new toggle for this long
  var REV_MS = 80;             // UXF-09: a reversal is judged on this much time…
  var REV_PX = 10;             // …and needs this much finger movement
  var WHEEL_DEFER_MS = 300;    // a native touch message this recent owns the gesture
  // Spatial mapping, like pulling a drawer: finger right shows the sidebar.
  var SWIPE_RIGHT_SHOWS = true;

  // Finger direction from a wheel delta. WebKit reports natural scrolling as
  // webkitDirectionInvertedFromDevice = true, where a finger moving right
  // produces a NEGATIVE deltaX. Unknown (other engines, tests) = natural.
  function fingerDx(dx, inverted) {
    return inverted === false ? dx : -dx;
  }

  function create(opts) {
    opts = opts || {};
    var now = typeof opts.now === 'function' ? opts.now : function () { return Date.now(); };
    var isOwned = typeof opts.isOwned === 'function' ? opts.isOwned : function () { return false; };
    var isBlocked = typeof opts.isBlocked === 'function' ? opts.isBlocked : function () { return false; };

    var isOwnedAt = typeof opts.isOwnedAt === 'function' ? opts.isOwnedAt : function () { return false; };
    var onTrack = typeof opts.onTrack === 'function' ? opts.onTrack : null;

    var lastT = -Infinity;
    var cooldownUntil = -Infinity;
    var g = null;            // current wheel gesture
    var nativeAt = -Infinity; // local clock of the last native touch message

    // Wheel path. ev = { dx, dy, deltaMode, shiftKey, ctrlKey, altKey, metaKey,
    // inverted, target, t? }. Returns 'show' | 'hide' | null.
    function feed(ev) {
      var t = typeof ev.t === 'number' ? ev.t : now();
      var fdx = fingerDx(ev.dx || 0, ev.inverted), dy = ev.dy || 0;
      var onset = !g || t - lastT > QUIET_MS, seed = [];
      if (!onset && g.firedSign) {
        // UXF-09: the gesture already toggled; finger movement against it is a
        // new touch (momentum only ever decays in the fired direction).
        g.rev.push({ t: t, dx: fdx, dy: dy });
        while (g.rev.length && t - g.rev[0].t > REV_MS) g.rev.shift();
        var r = 0;
        for (var k = 0; k < g.rev.length; k++) r += g.rev[k].dx;
        if (r * g.firedSign < 0 && Math.abs(r) >= REV_PX) {
          onset = true;
          var fired = g.firedSign;
          seed = g.rev.slice(0, -1).filter(function (e) { return e.dx * fired < 0; });
        }
      }
      // Ownership and the blocked state are read again at every onset.
      if (onset) g = { recent: seed, rev: [], done: false, firedSign: 0, owned: !!isOwned(ev.target) };
      lastT = t;
      // The desktop app's native touch stream owns trackpad gestures.
      if (now() - nativeAt < WHEEL_DEFER_MS) { g.done = true; return null; }
      if (g.done || g.owned) return null;

      // A pinch (ctrlKey), a ⇧/⌥/⌘ wheel or a line/page-mode wheel is not a
      // swipe, and nothing later in the same gesture may become one.
      if ((ev.deltaMode || 0) !== 0 || ev.shiftKey || ev.ctrlKey || ev.altKey || ev.metaKey || isBlocked()) {
        g.done = true;
        return null;
      }

      g.recent.push({ t: t, dx: fdx, dy: dy });
      while (g.recent.length && t - g.recent[0].t > WINDOW_MS) g.recent.shift();
      // Distance over the whole window; direction over its latest slice, so a
      // vertical coast that the fingers just stopped does not veto the swipe.
      var sx = 0, hx = 0, hy = 0;
      for (var i = 0; i < g.recent.length; i++) {
        var e = g.recent[i];
        sx += e.dx;
        if (t - e.t <= AXIS_MS) { hx += e.dx; hy += e.dy; }
      }
      if (Math.abs(sx) < TRIGGER_PX || Math.abs(hx) < AXIS_RATIO * Math.abs(hy) || (hx > 0) !== (sx > 0)) return null;
      if (t < cooldownUntil) return null;

      g.done = true; // once per gesture; the momentum tail stays inside it
      g.firedSign = sx > 0 ? 1 : -1;
      cooldownUntil = t + COOLDOWN_MS;
      return ((sx > 0) === SWIPE_RIGHT_SHOWS) ? 'show' : 'hide';
    }

    // Touch path (desktop app). m = the `swipe-touch` payload from lib.rs:
    //   { phase: 'began'|'changed'|'ended'|'cancelled', t (ms, native clock),
    //     dx, dy (scrollingDelta), inverted, precise, x, y (CSS px), mods }
    // One finger touch is one gesture: begin is exact and momentum is never
    // sent, so no quiet gap, reversal rule or cool-down is needed.
    var tg = null;
    function touch(m) {
      nativeAt = now();
      if (g) g.done = true; // whatever the wheel path was building is this touch
      var ph = m && m.phase;
      if (ph === 'began') {
        // AppKit sends may-begin then began for one touch: only a touch that
        // has not moved yet is the same one.
        if (!tg || tg.closed || tg.recent.length) {
          tg = { recent: [], done: false, closed: false, owned: !!isOwnedAt(m.x, m.y) };
        }
        // The began event already carries the first movement: count it.
        if (!m.dx && !m.dy) return null;
      } else if (ph === 'ended' || ph === 'cancelled') {
        if (tg) tg.closed = true;
        if (onTrack) onTrack({ phase: ph, sx: 0 });
        return null;
      } else if (ph !== 'changed') {
        return null;
      }
      if (!tg || tg.closed || tg.done || tg.owned) return null;
      if (m.mods || isBlocked()) { tg.done = true; return null; }
      var t = m.t;
      tg.recent.push({ t: t, dx: m.inverted ? (m.dx || 0) : -(m.dx || 0), dy: m.dy || 0 });
      while (tg.recent.length && t - tg.recent[0].t > WINDOW_MS) tg.recent.shift();
      var sx = 0, hx = 0, hy = 0;
      for (var i = 0; i < tg.recent.length; i++) {
        var e = tg.recent[i];
        sx += e.dx;
        if (t - e.t <= AXIS_MS) { hx += e.dx; hy += e.dy; }
      }
      // Seam for a finger-following drag (not built): the running distance.
      if (onTrack) onTrack({ phase: ph, sx: sx });
      if (Math.abs(sx) < TRIGGER_PX || Math.abs(hx) < AXIS_RATIO * Math.abs(hy) || (hx > 0) !== (sx > 0)) return null;
      tg.done = true;
      return ((sx > 0) === SWIPE_RIGHT_SHOWS) ? 'show' : 'hide';
    }

    return { feed: feed, touch: touch };
  }

  // True when `el` or an ancestor up to `stopEl` scrolls horizontally right
  // now. Such a scroller owns the whole gesture, even at its edge, so a swipe
  // never hijacks a wide table, code block, diagram or the tab strip.
  function ownsHorizontalScroll(el, stopEl, getStyle) {
    for (var n = el; n && n.nodeType === 1; n = n.parentNode) {
      var ox = getStyle ? getStyle(n).overflowX : '';
      if ((ox === 'auto' || ox === 'scroll') && n.scrollWidth > n.clientWidth + 1) return true;
      if (n === stopEl) break;
    }
    return false;
  }

  var _installed = false;
  var _machine = null, _opts = null;

  function _act(r) {
    if (r === 'show' && _opts.onShow) _opts.onShow();
    else if (r === 'hide' && _opts.onHide) _opts.onHide();
  }

  // opts = { onShow(), onHide(), isEnabled(), isBlocked() }
  function install(opts) {
    if (_installed || typeof document === 'undefined') return;
    _installed = true;
    _opts = opts = opts || {};
    var getStyle = function (n) { return window.getComputedStyle(n); };
    var owns = function (target) {
      var stop = target && target.closest ? target.closest('.tv') : null;
      return ownsHorizontalScroll(target, stop, getStyle);
    };
    _machine = create({
      now: function () { return (window.performance && performance.now) ? performance.now() : Date.now(); },
      isOwned: owns,
      isOwnedAt: function (x, y) {
        return typeof x === 'number' && typeof y === 'number' ? owns(document.elementFromPoint(x, y)) : false;
      },
      isBlocked: function () { return !!(opts.isBlocked && opts.isBlocked()); }
    });
    document.addEventListener('wheel', function (e) {
      if (opts.isEnabled && !opts.isEnabled()) return;
      _act(_machine.feed({
        dx: e.deltaX, dy: e.deltaY, deltaMode: e.deltaMode,
        shiftKey: e.shiftKey, ctrlKey: e.ctrlKey, altKey: e.altKey, metaKey: e.metaKey,
        inverted: e.webkitDirectionInvertedFromDevice, target: e.target
      }));
    }, { passive: true });
  }

  // UXF-09: the native `swipe-touch` stream (tv-native.js forwards it here).
  function touch(m) {
    if (!_machine || (_opts.isEnabled && !_opts.isEnabled())) return;
    _act(_machine.touch(m || {}));
  }

  return {
    create: create,
    install: install,
    touch: touch,
    ownsHorizontalScroll: ownsHorizontalScroll,
    fingerDx: fingerDx,
    constants: {
      QUIET_MS: QUIET_MS, WINDOW_MS: WINDOW_MS, AXIS_MS: AXIS_MS, AXIS_RATIO: AXIS_RATIO,
      TRIGGER_PX: TRIGGER_PX, COOLDOWN_MS: COOLDOWN_MS, SWIPE_RIGHT_SHOWS: SWIPE_RIGHT_SHOWS,
      REV_MS: REV_MS, REV_PX: REV_PX, WHEEL_DEFER_MS: WHEEL_DEFER_MS
    }
  };
}));
