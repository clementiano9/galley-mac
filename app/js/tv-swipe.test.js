/* ───────────────────────────────────────────────────────────
   UXF-05 · two-finger swipe state machine  (run: node app/js/tv-swipe.test.js)

   Loads the REAL tv-swipe.js through vm and drives TVSwipe.create() with a
   fake clock and synthetic wheel events — acceptance items 6-10 of
   UXF-05-sidebar-toggle-swipe.md, plus the scroller-ownership walk (11) and
   the wiring in tv-app.js / index.html as source guards.
   ─────────────────────────────────────────────────────────── */
'use strict';

var fs = require('fs');
var path = require('path');
var vm = require('vm');

var pass = 0, fail = 0;
function assert(label, cond, detail) {
  if (cond) { console.log('  PASS  ' + label); pass++; }
  else { console.error('  FAIL  ' + label + (detail !== undefined ? ' — ' + JSON.stringify(detail) : '')); fail++; }
}

var SRC = fs.readFileSync(path.join(__dirname, 'tv-swipe.js'), 'utf8');
var APP = fs.readFileSync(path.join(__dirname, 'tv-app.js'), 'utf8');
var HTML = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');

var sandbox = { window: {}, console: console };
vm.runInContext(SRC, vm.createContext(sandbox), { filename: 'tv-swipe.js' });
var S = sandbox.window.TVSwipe;

// A machine on a fake clock. ev() feeds one wheel event at the current time.
function rig(opts) {
  var clock = { t: 1000 };
  opts = opts || {};
  var m = S.create({
    now: function () { return clock.t; },
    isOwned: opts.isOwned,
    isBlocked: opts.isBlocked
  });
  var out = [];
  function ev(dx, dy, extra) {
    var e = { dx: dx, dy: dy || 0, deltaMode: 0 };
    Object.keys(extra || {}).forEach(function (k) { e[k] = extra[k]; });
    var r = m.feed(e);
    if (r) out.push(r);
    return r;
  }
  return { clock: clock, ev: ev, out: out };
}
// n events, `gap` ms apart, each with deltaX dx (natural scrolling: a finger
// moving right gives a negative deltaX).
function swipe(r, n, dx, gap, extra) {
  for (var i = 0; i < n; i++) { r.ev(dx, 0, extra); r.clock.t += gap; }
}

console.log('\nModule shape\n');
assert('exports create / install / ownsHorizontalScroll', ['create', 'install', 'ownsHorizontalScroll'].every(function (k) { return typeof S[k] === 'function'; }));
var C = S.constants;
assert('the gesture numbers are the spec\'s constants',
  C.QUIET_MS === 160 && C.WINDOW_MS === 250 && C.AXIS_MS === 100 && C.AXIS_RATIO === 1.3 && C.TRIGGER_PX === 48 && C.COOLDOWN_MS === 200 &&
  C.REV_MS === 80 && C.REV_PX === 10 && C.SWIPE_RIGHT_SHOWS === true, C);

console.log('\n6 · direction (natural scrolling assumed when the flag is absent)\n');
(function () {
  var r = rig();
  assert('wheel(-120, 0) — finger right — asks to show', r.ev(-120, 0) === 'show');
  r.clock.t += 1000;
  assert('wheel(120, 0) — finger left — asks to hide', r.ev(120, 0) === 'hide');
})();

console.log('\n7 · webkitDirectionInvertedFromDevice = false flips the sign\n');
(function () {
  var r = rig();
  assert('the same physical swipe right arrives as +deltaX and still shows', r.ev(120, 0, { inverted: false }) === 'show');
  r.clock.t += 1000;
  assert('…and a swipe left arrives as -deltaX and hides', r.ev(-120, 0, { inverted: false }) === 'hide');
  r.clock.t += 1000;
  assert('inverted = true behaves like natural scrolling', r.ev(-120, 0, { inverted: true }) === 'show');
})();

console.log('\n8 · ineligible gestures never toggle\n');
(function () {
  var r = rig();
  swipe(r, 4, -10, 16);
  assert('total |dx| of 40 px', r.out.length === 0, r.out);
  r.clock.t += 1000;
  r.ev(-100, 80);
  assert('dx 100, dy 80 is vertical-dominant', r.out.length === 0, r.out);
  r.clock.t += 1000;
  r.ev(-120, 0, { shiftKey: true });
  assert('a wheel with shiftKey', r.out.length === 0, r.out);
  r.clock.t += 1000;
  r.ev(-120, 0, { ctrlKey: true });
  assert('a wheel with ctrlKey (pinch)', r.out.length === 0, r.out);
  r.clock.t += 1000;
  r.ev(-120, 0, { deltaMode: 1 });
  assert('deltaMode 1 (lines)', r.out.length === 0, r.out);
  r.clock.t += 1000;
  r.ev(-120, 0, { altKey: true });
  r.clock.t += 1000;
  r.ev(-120, 0, { metaKey: true });
  assert('⌥ and ⌘ wheels', r.out.length === 0, r.out);
  r.clock.t += 1000;
  for (var i = 0; i < 40; i++) { r.ev(i % 2 ? 4 : -4, 25); r.clock.t += 16; }
  assert('a vertical reading scroll with sideways drift never toggles', r.out.length === 0, r.out);
  r.clock.t += 1000;
  r.ev(-30, 0); r.clock.t += 16; r.ev(30, 0); r.clock.t += 16; r.ev(-30, 0); r.clock.t += 16; r.ev(30, 0);
  assert('a small left-right wiggle does not toggle', r.out.length === 0, r.out);
})();

console.log('\n8b · forgiving recognition (owner: "it needs to be precise")\n');
(function () {
  var r = rig();
  r.ev(-1, 6); r.clock.t += 16; r.ev(-2, 5); r.clock.t += 16;
  swipe(r, 6, -14, 16);
  assert('vertical wobble at the start does not cancel the swipe', r.out.length === 1 && r.out[0] === 'show', r.out);

  r = rig();
  for (var i = 0; i < 8; i++) { r.ev(-12, 6); r.clock.t += 16; }
  assert('a diagonal swipe (2:1) still toggles', r.out.length === 1, r.out);

  r = rig();
  swipe(r, 20, -6, 16);
  assert('a slow swipe (6 px per event) toggles', r.out.length === 1, r.out);

  r = rig();
  var dy = 40;
  for (var j = 0; j < 12; j++) { r.ev(0, dy); r.clock.t += 16; dy *= 0.85; }
  swipe(r, 6, -16, 16);
  assert('a swipe begun while a vertical scroll is still coasting toggles', r.out.length === 1, r.out);

  r = rig();
  r.ev(20, 0); r.clock.t += 16; r.ev(20, 0); r.clock.t += 120;
  swipe(r, 6, -20, 16);
  assert('a change of mind mid-gesture follows the latest direction', r.out.length === 1 && r.out[0] === 'show', r.out);
})();

console.log('\n9 · a momentum swipe toggles exactly once\n');
(function () {
  var r = rig();
  var dx = -40;
  for (var i = 0; i < 30; i++) { r.ev(dx, 0); r.clock.t += 16; dx *= 0.88; }
  assert('30 decaying events over ~480 ms → one toggle', r.out.length === 1 && r.out[0] === 'show', r.out);
})();

console.log('\n10 · UXF-09: a reversed swipe right after a toggle toggles back\n');
(function () {
  // Swipe right (show), then its momentum keeps arriving every 16 ms with no
  // quiet gap; the fingers come down again and move LEFT (hide).
  var r = rig();
  swipe(r, 4, -40, 16);                       // finger right: show
  assert('the first swipe toggles', r.out.join() === 'show', r.out);
  var c = -30;
  for (var i = 0; i < 12; i++) { r.ev(c, 0); r.clock.t += 16; c *= 0.93; }   // momentum, same direction
  assert('its momentum tail never toggles again', r.out.join() === 'show', r.out);
  swipe(r, 6, 30, 16);                        // finger left, 0 ms after the tail
  assert('a reversal inside the tail is a new gesture: it toggles back', r.out.join() === 'show,hide', r.out);

  var s = rig();
  swipe(s, 4, -40, 16);
  for (var j = 0; j < 8; j++) { s.ev(-12, 0); s.clock.t += 16; }
  swipe(s, 6, -40, 16);                       // the same direction again, inside the tail
  assert('a same-direction re-swipe inside the tail does nothing (already shown)', s.out.join() === 'show', s.out);

  var q = rig();
  swipe(q, 4, -40, 16);                       // fires at about t+48
  swipe(q, 2, 20, 16);                        // reversal 32 ms later: under the 200 ms cool-down
  assert('the 200 ms cool-down holds a flip-flop…', q.out.join() === 'show', q.out);
  swipe(q, 12, 20, 16);
  assert('…and the reversal toggles once the cool-down ends', q.out.join() === 'show,hide', q.out);

  var w = rig();
  swipe(w, 4, -40, 16);
  for (var k = 0; k < 6; k++) { w.ev(k % 2 ? 4 : -4, 0); w.clock.t += 16; }   // ±4 px lift jitter
  assert('lift jitter smaller than REV_PX starts nothing', w.out.join() === 'show', w.out);

  var o = rig({ isOwned: function (tg) { return tg === 'table'; } });
  swipe(o, 4, -40, 16);
  o.ev(-20, 0); o.clock.t += 16;
  swipe(o, 6, 30, 16, { target: 'table' });  // the reversal starts over a wide table
  assert('ownership is read again at the reversal onset (a scroller still wins)', o.out.join() === 'show', o.out);

  var u = rig();
  swipe(u, 3, -40, 16);
  u.clock.t += 600;
  swipe(u, 5, 40, 16);
  assert('after a quiet gap a swipe toggles as before', u.out.join() === 'show,hide', u.out);
})();

console.log('\n11-12 · scrollers own the gesture; open overlays block it\n');
(function () {
  var owned = rig({ isOwned: function () { return true; } });
  swipe(owned, 6, -40, 16);
  assert('a gesture that starts over a scroller never toggles', owned.out.length === 0, owned.out);

  var calls = 0;
  var once = rig({ isOwned: function () { calls++; return false; } });
  swipe(once, 6, -40, 16);
  assert('ownership is decided once, at the first event of a gesture', calls === 1, calls);

  var blocked = rig({ isBlocked: function () { return true; } });
  swipe(blocked, 6, -40, 16);
  assert('an open overlay blocks the toggle', blocked.out.length === 0, blocked.out);

  // The DOM walk itself, with a fake computed style.
  function el(ox, sw, cw, parent) { return { nodeType: 1, ox: ox, scrollWidth: sw, clientWidth: cw, parentNode: parent || null }; }
  var style = function (n) { return { overflowX: n.ox }; };
  var tv = el('hidden', 1000, 1000);
  var scroll = el('hidden', 900, 900, tv);           // .tv-scroll: overflow-x hidden
  var wide = el('auto', 1800, 900, scroll);          // .tbl-wide
  var cell = el('visible', 100, 100, wide);
  var para = el('visible', 600, 600, scroll);
  var fits = el('auto', 400, 400, scroll);           // a pre that does not overflow
  assert('a cell inside a wide table is owned', S.ownsHorizontalScroll(cell, tv, style) === true);
  assert('plain text is not owned', S.ownsHorizontalScroll(para, tv, style) === false);
  assert('an overflow:auto box that fits is not owned', S.ownsHorizontalScroll(fits, tv, style) === false);
  assert('overflow-x:hidden never owns, even when content is wider',
    S.ownsHorizontalScroll(el('hidden', 2000, 100, tv), tv, style) === false);
})();

console.log('\nWiring (source guards)\n');
assert('index.html loads tv-swipe.js after tv-tree.js and before tv-app.js',
  HTML.indexOf('js/tv-tree.js') < HTML.indexOf('js/tv-swipe.js') && HTML.indexOf('js/tv-swipe.js') < HTML.indexOf('js/tv-app.js'));
assert('install() adds ONE passive wheel listener on document',
  (SRC.match(/addEventListener\('wheel'/g) || []).length === 1 && /\{ passive: true \}/.test(SRC));
assert('install() guards against a second install', /if \(_installed/.test(SRC));
assert('init() installs it with the spec\'s four hooks',
  /TVSwipe\.install\(\{[\s\S]{0,200}onShow[\s\S]{0,200}onHide[\s\S]{0,200}isEnabled: isSwipeEnabled[\s\S]{0,80}isBlocked/.test(APP));
assert('the swipe opens/closes through toggleSidebar without seeding the cursor, and announces',
  /toggleSidebar\(\{ seedCursor: false, announce: true \}\)/.test(APP));
assert('the swipe only acts when the state differs (wrong direction does nothing)',
  /onShow: function \(\) \{ if \(!state\.sidebarOpen\)/.test(APP) && /onHide: function \(\) \{ if \(state\.sidebarOpen\)/.test(APP));
assert('the escape hatch is localStorage tv-swipe-sidebar = "0"',
  /localStorage\.getItem\('tv-swipe-sidebar'\) !== '0'/.test(APP));
assert('no transition or animation is added for this feature',
  !/transition|animation/.test(SRC));

/* ═══ UXF-09: back-to-back swipes, replayed from recorded native streams ═══
   .claude/docs/feature-gaps/fixtures/uxf09-swipe-streams.json (outside app/,
   which the binary embeds) holds what the off-screen harness recorded: the
   DOM wheel stream the page saw, and the NSEvent stream an NSEvent local
   monitor saw, for hide → show at Δ 100…1200 ms, hide/hide/show and five
   alternations. Shipped code (quiet gap only) hit 104/190. */
var FIX = JSON.parse(fs.readFileSync(path.join(__dirname, '..', '..', '.claude', 'docs', 'feature-gaps', 'fixtures', 'uxf09-swipe-streams.json'), 'utf8'));
var LIB = fs.readFileSync(path.join(__dirname, '..', '..', 'tauri-app', 'src-tauri', 'src', 'lib.rs'), 'utf8');
var NATIVE_JS = fs.readFileSync(path.join(__dirname, 'tv-native.js'), 'utf8');

function score(got, exp) { var k = 0; got.forEach(function (g) { if (k < exp.length && g === exp[k]) k++; }); return [k, got.length - k]; }
function applyTo(state, r, tg) {
  if (r === 'show' && !state.open) { state.open = true; tg.push(true); }
  else if (r === 'hide' && state.open) { state.open = false; tg.push(false); }
}
// The wheel path alone (the browser build, or any wheel without native phases).
function replayWheel(ev, open) {
  var clock = { t: 0 }, st = { open: open }, tg = [];
  var m = S.create({ now: function () { return clock.t; }, isOwned: function (o) { return !!o; } });
  ev.forEach(function (e) {
    clock.t = e[0];
    applyTo(st, m.feed({ t: e[0], dx: e[1], dy: e[2], target: e[3], shiftKey: !!e[4], deltaMode: e[5], inverted: true }), tg);
  });
  return tg;
}
// JS mirror of lib.rs swipe_phase + SwipeForwarder (checked against the Rust
// source below), so the recorded NSEvent streams drive the touch path exactly
// as the desktop app would.
function nativeMessages(ev) {
  var out = [], t0 = null, last = -Infinity, pdx = 0, pdy = 0;
  ev.forEach(function (e) {
    var ph = e[2] ? null : ({ 1: 'began', 32: 'began', 4: 'changed', 8: 'ended', 16: 'cancelled' })[e[1]] || null;
    if (!ph) return;
    var m = { phase: ph, t: e[0], dx: e[3], dy: e[4], inverted: !!e[5], precise: true, x: 0, y: 0, mods: false };
    if (ph === 'began') { t0 = m.t; pdx = pdy = 0; last = -Infinity; out.push(m); return; }
    if (ph === 'changed') {
      if (t0 === null) t0 = m.t;
      if (m.t - t0 > 1000) return;
      pdx += m.dx; pdy += m.dy;
      if (m.t - last >= 16) { last = m.t; out.push(Object.assign({}, m, { dx: pdx, dy: pdy })); pdx = pdy = 0; }
      return;
    }
    if (pdx || pdy) out.push(Object.assign({}, m, { phase: 'changed', dx: pdx, dy: pdy }));
    pdx = pdy = 0; t0 = null; out.push(m);
  });
  return out;
}
function replayTouch(msgs, open) {
  var clock = { t: 0 }, st = { open: open }, tg = [];
  var m = S.create({ now: function () { return clock.t; } });
  msgs.forEach(function (x) { clock.t = x.t; applyTo(st, m.touch(x), tg); });
  return tg;
}

console.log('\nUXF-09 · recorded streams, back-to-back (fixture)\n');
(function () {
  var allW = [0, 0, 0], allT = [0, 0, 0];
  Object.keys(FIX.b2b).forEach(function (name) {
    var sc = FIX.b2b[name], w = [0, 0, 0], tc = [0, 0, 0];
    sc.wheel.forEach(function (tr) { var s = score(replayWheel(tr.ev, true), tr.exp); w[0] += s[0]; w[1] += s[1]; w[2] += tr.exp.length; });
    sc.native.forEach(function (tr) { var s = score(replayTouch(nativeMessages(tr.ev), true), tr.exp); tc[0] += s[0]; tc[1] += s[1]; tc[2] += tr.exp.length; });
    assert(name + ': wheel path (stage 1) toggles every time, no extra — ' + w[0] + '/' + w[2], w[0] === w[2] && w[1] === 0, w);
    assert(name + ': touch path (stage 2, recorded NSEvents) toggles every time, no extra — ' + tc[0] + '/' + tc[2], tc[0] === tc[2] && tc[1] === 0, tc);
    [0, 1, 2].forEach(function (i) { allW[i] += w[i]; allT[i] += tc[i]; });
  });
  console.log('    all back-to-back: wheel ' + allW[0] + '/' + allW[2] + ' (+' + allW[1] + '), touch ' + allT[0] + '/' + allT[2] + ' (+' + allT[1] + ')');
})();

console.log('\nUXF-09 · recorded single swipes are unchanged (fixture)\n');
(function () {
  Object.keys(FIX.single).forEach(function (name) {
    var ok = 0, n = 0;
    FIX.single[name].forEach(function (tr) {
      var tg = replayWheel(tr.ev, tr.open);
      n++;
      if (tr.must ? (tg.length === 1 && tg[0] === !tr.open) : tg.length === 0) ok++;
    });
    var must = FIX.single[name][0].must;
    assert(name + (must ? ': toggles exactly once' : ': stays quiet') + ' (' + ok + '/' + n + ')', ok === n, ok);
  });
})();

console.log('\nUXF-09 · seeded trackpad model (qa9), Δ 100…1200 ms × 50 seeds\n');
(function () {
  var seed = 7;
  function rnd() { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; }
  function U(a, b) { return a + (b - a) * rnd(); }
  // One model, two views: the DOM wheel events (integer deltas; zero-delta and
  // cut momentum never reach the page) and the native touch phases.
  function model(dirs, gaps, o) {
    o = o || {};
    var iv = 16, wheel = [], nat = [], t = 0, lift = 0, pend = [];
    function dom(tt, fdx, dy) { var d = Math.trunc(-fdx); if (d || Math.trunc(dy || 0)) wheel.push([tt, d, Math.trunc(dy || 0), 0, 0, 0]); }
    dirs.forEach(function (s, k) {
      if (k > 0) {
        var td = lift + gaps[k - 1];
        pend.forEach(function (p) { if (o.uncut || p[0] < td) dom(p[0], p[1]); });
        pend = [];
        nat.push([td, 32, 0, 0, 0, 1]);
        t = td + U(25, 60);
      }
      var n = Math.max(3, Math.round(U(110, 170) / iv)), dist = U(150, 210), wv = [], sw = 0, last = 0;
      for (var i = 0; i < n; i++) { wv.push(Math.sin(Math.PI * (i + 0.5) / (n * 1.35)) * (1 + U(-0.12, 0.12))); sw += wv[i]; }
      for (i = 0; i < n; i++) {
        last = s * dist * wv[i] / sw;
        var dy = U(-1, 1);
        dom(t, last, dy);
        nat.push([t, i === 0 ? 1 : 4, 0, last, dy, 1]);    // natural scrolling: scrollingDeltaX has the finger's sign (recorded)
        t += iv + U(-1.5, 1.5);
      }
      lift = t;
      nat.push([lift, 8, 0, 0, 0, 1]);
      if (o.jitter) for (var j = 0; j < 2; j++) { lift += iv; dom(lift, -s * U(1, o.jitter)); }
      var c = last * 0.95, d = U(0.92, 0.955), tt = lift + iv;
      while (Math.abs(c) >= 0.5) { pend.push([tt, c]); c *= d; tt += iv + U(-1, 1); }
    });
    pend.forEach(function (p) { dom(p[0], p[1]); });
    wheel.sort(function (a, b) { return a[0] - b[0]; });
    return { wheel: wheel, nat: nat };
  }
  function expected(dirs) { var st = true, out = []; dirs.forEach(function (d) { if ((d > 0) !== st) { st = d > 0; out.push(st); } }); return out; }
  var rows = [];
  [100, 200, 300, 500, 800, 1200].forEach(function (gap) { rows.push(['b2b ' + gap, function () { return [[-1, 1], [gap]]; }, {}]); });
  rows.push(['alt5 150-700', function () { return [[-1, 1, -1, 1, -1], [U(150, 700), U(150, 700), U(150, 700), U(150, 700)]]; }, {}]);
  rows.push(['b2b, momentum not cut', function () { return [[-1, 1], [U(100, 500)]]; }, { uncut: true }]);
  rows.push(['b2b, 1-6 px lift jitter', function () { return [[-1, 1], [U(100, 500)]]; }, { jitter: 6 }]);
  rows.push(['rep: hide, hide, show', function () { return [[-1, -1, 1], [U(200, 600), U(200, 600)]]; }, {}]);
  rows.forEach(function (row) {
    var w = [0, 0, 0], tc = [0, 0, 0];
    for (var i = 0; i < 50; i++) {
      var sc = row[1](), m = model(sc[0], sc[1], row[2]), exp = expected(sc[0]);
      var a = score(replayWheel(m.wheel, true), exp), b = score(replayTouch(nativeMessages(m.nat), true), exp);
      w[0] += a[0]; w[1] += a[1]; w[2] += exp.length; tc[0] += b[0]; tc[1] += b[1]; tc[2] += exp.length;
    }
    assert(row[0] + ': wheel ' + w[0] + '/' + w[2] + ' (+' + w[1] + '), touch ' + tc[0] + '/' + tc[2] + ' (+' + tc[1] + ')',
      w[0] === w[2] && w[1] === 0 && tc[0] === tc[2] && tc[1] === 0, [w, tc]);
  }
  );
  var single = [0, 0];
  for (var s2 = 0; s2 < 50; s2++) {
    var m1 = model([-1], [], { jitter: 6 });
    var a1 = replayWheel(m1.wheel, true);
    single[0] += a1.length === 1 && a1[0] === false ? 1 : 0; single[1]++;
  }
  assert('a single swipe with lift jitter still toggles exactly once (' + single[0] + '/' + single[1] + ')', single[0] === single[1]);
})();

console.log('\nUXF-09 · the touch path (fake swipe-touch stream)\n');
(function () {
  var clock = { t: 0 }, blocked = false;
  var m = S.create({ now: function () { return clock.t; }, isOwnedAt: function (x) { return x === 999; }, isBlocked: function () { return blocked; } });
  function msg(phase, t, dx, extra) { clock.t = t; return m.touch(Object.assign({ phase: phase, t: t, dx: dx || 0, dy: 0, inverted: true, precise: true, x: 10, y: 10, mods: false }, extra || {})); }
  var outs = [];
  function run(seq) { seq.forEach(function (a) { var r = msg.apply(null, a); if (r) outs.push(r); }); }
  run([['began', 0], ['began', 5], ['changed', 10, 20], ['changed', 26, 20], ['changed', 42, 20], ['ended', 60]]);
  assert('may-begin then began is ONE touch; finger right shows', outs.join() === 'show', outs);
  run([['began', 70], ['changed', 80, -25], ['changed', 96, -25], ['ended', 110]]);
  assert('the next touch, 10 ms later, is a new gesture: it toggles back at once', outs.join() === 'show,hide', outs);
  run([['began', 120], ['changed', 130, 30], ['changed', 146, 30], ['changed', 162, 30], ['changed', 178, 30], ['ended', 190]]);
  assert('one touch toggles at most once', outs.join() === 'show,hide,show', outs);
  run([['began', 200, 0, { x: 999 }], ['changed', 210, 40, { x: 999 }], ['changed', 226, 40, { x: 999 }], ['ended', 240]]);
  assert('a touch that starts over a scroller is owned by it', outs.length === 3, outs);
  run([['began', 250], ['changed', 260, 40, { mods: true }], ['changed', 276, 40], ['ended', 290]]);
  assert('a modifier vetoes the touch', outs.length === 3, outs);
  blocked = true;
  run([['began', 300], ['changed', 310, 40], ['changed', 326, 40], ['ended', 340]]);
  blocked = false;
  assert('an open overlay blocks it', outs.length === 3, outs);
  run([['began', 350], ['changed', 360, 40, { inverted: false }], ['changed', 376, 40, { inverted: false }], ['ended', 390]]);
  assert('inverted = false flips the sign', outs.join() === 'show,hide,show,hide', outs);
  run([['began', 400, 6], ['changed', 416, 20], ['changed', 432, 22], ['ended', 440]]);
  assert('the began event\'s own movement counts (6 + 20 + 22 = 48 px toggles; found by the native harness)', outs.join() === 'show,hide,show,hide,show', outs);

  // While native touches arrive, the wheel path stands down (no double toggle).
  var c2 = { t: 0 }, both = S.create({ now: function () { return c2.t; } }), got = [];
  function w(t, dx) { c2.t = t; var r = both.feed({ t: t, dx: dx, dy: 0, deltaMode: 0, inverted: true }); if (r) got.push('wheel:' + r); }
  function n(phase, t, dx) { c2.t = t; var r = both.touch({ phase: phase, t: t, dx: dx || 0, dy: 0, inverted: true, x: 0, y: 0, mods: false }); if (r) got.push('touch:' + r); }
  n('began', 0); w(2, -20); n('changed', 3, 20); w(18, -20); n('changed', 19, 20); w(34, -20); n('changed', 35, 20); w(50, -30); n('ended', 60);
  for (var k = 0; k < 20; k++) w(70 + k * 16, -10);   // momentum (never sent natively)
  assert('with the native stream live, only the touch path toggles — once', got.join() === 'touch:show', got);
  c2.t = 2000;
  for (var q = 0; q < 5; q++) w(2000 + q * 16, 30);
  assert('a wheel without native phases (no message for 300 ms) still works: fallback', got.join() === 'touch:show,wheel:hide', got);
})();

console.log('\nUXF-09 · drift guard: lib.rs ⇄ tv-native.js ⇄ tv-swipe.js\n');
(function () {
  var st = LIB.match(/pub struct SwipeTouch \{([\s\S]*?)\n\}/);
  var keys = st ? (st[1].match(/pub (\w+):/g) || []).map(function (k) { return k.replace(/pub |:/g, ''); }) : [];
  assert('SwipeTouch serializes camelCase with exactly the keys tv-swipe.js reads',
    /#\[serde\(rename_all = "camelCase"\)\]\s*pub struct SwipeTouch/.test(LIB) && keys.sort().join() === 'dx,dy,inverted,mods,phase,precise,t,x,y', keys);
  assert('tv-swipe.js touch() reads phase, t, dx, dy, inverted, x, y and mods',
    ['m.phase', 'm.t', 'm.dx', 'm.dy', 'm.inverted', 'm.x', 'm.y', 'm.mods'].every(function (k) { return SRC.indexOf(k) !== -1; }));
  assert('Rust emits "swipe-touch" and tv-native.js listens for it, forwarding to TVSwipe.touch',
    /app\.emit\("swipe-touch", m\)/.test(LIB) && /listen\('swipe-touch', function \(e\) \{\s*if \(window\.TVSwipe && typeof window\.TVSwipe\.touch === 'function'\) window\.TVSwipe\.touch\(e && e\.payload\);/.test(NATIVE_JS));
  assert('the phase table the replay mirrors is the one in lib.rs',
    /1 \| 32 => Some\("began"\)/.test(LIB) && /4 => Some\("changed"\)/.test(LIB) && /8 => Some\("ended"\)/.test(LIB) && /16 => Some\("cancelled"\)/.test(LIB) &&
    /if momentum != 0 \{\s*return None;/.test(LIB));
  assert('…and so are the coalescing numbers (16 ms, first 1000 ms of a touch)',
    /pub const SWIPE_COALESCE_MS: f64 = 16\.0;/.test(LIB) && /pub const SWIPE_FORWARD_MS: f64 = 1000\.0;/.test(LIB));
  assert('the monitor returns every event unchanged (never consumes it: WKWebView still scrolls)', /ev\.as_ptr\(\)\s*\n\s*\}\);/.test(LIB));
  assert('installed on the main thread from setup()', /run_on_main_thread\(move \|\| install_swipe_monitor\(h2\)\)/.test(LIB));
})();

console.log('\n' + (fail === 0 ? 'ALL PASSED' : 'FAILURES: ' + fail) + ' (' + pass + ' passed, ' + fail + ' failed)\n');
if (fail > 0) process.exit(1);
