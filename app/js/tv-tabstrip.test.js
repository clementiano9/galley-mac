/* ───────────────────────────────────────────────────────────
   Galley · C-04 tab-strip scroll-preservation suite
   (run: node app/js/tv-tabstrip.test.js)

   The defect the user reported as "the entire tab strip repositioning":
   scroll the tab strip right, click a tab that is already on screen, and the
   whole strip jumped back towards the beginning — a completely different set
   of tabs on screen after a single click.

   The cause was not the click. render() rebuilds #tv-root wholesale
   (root.innerHTML = ...), which destroys .tv-tab-strip and recreates it at
   scrollLeft 0. The app already preserves its two OTHER scrollers across that
   swap — the content pane (DR-03) and the sidebar list (JANK-01) — but the
   strip was never in that set, so ANY repaint reset it: theme change, ⌘B,
   live-watch update, dirty-dot flip, tab close. Clicking merely made it
   visible, because the active-pill flush then measured the pill against the
   reset 0 and wrote a third position on top.

   Two earlier attempts fixed things downstream of the rebuild (round 2 made
   the flush conditional instead of scrollIntoView; round 3 removed the
   font-weight step that reflowed pills). Both were necessary and both are
   still asserted here, but neither touched the reset itself.

   The helpers below are lifted VERBATIM out of tv-app.js and executed against
   a hand-rolled DOM, so this is a behavioural test of the shipped code rather
   than of a copy — the pattern tv-sidebar-jank.test.js uses. The wiring inside
   render()'s IIFE is covered by ordering guards over the real call sites.
   ─────────────────────────────────────────────────────────── */
'use strict';

var fs = require('fs');
var path = require('path');
var vm = require('vm');

var pass = 0;
var fail = 0;

function assert(label, condition, detail) {
  if (condition) { console.log('  PASS  ' + label); pass++; }
  else { console.error('  FAIL  ' + label + (detail ? ' — ' + detail : '')); fail++; }
}
function eq(label, actual, expected) {
  assert(label, actual === expected,
    'expected ' + JSON.stringify(expected) + ', got ' + JSON.stringify(actual));
}

var APP_SRC = fs.readFileSync(path.join(__dirname, 'tv-app.js'), 'utf8');

// `function <name>(...) { ... }` by brace matching, so the tests run the REAL
// implementation: rewrite the helper in tv-app.js and these tests re-run the
// rewrite, not a stale clone.
function extractFn(src, name) {
  var start = src.indexOf('function ' + name + '(');
  if (start === -1) throw new Error('extractFn: ' + name + ' not found in source');
  var i = src.indexOf('{', start);
  var depth = 0;
  for (var j = i; j < src.length; j++) {
    if (src[j] === '{') depth++;
    else if (src[j] === '}') { depth--; if (depth === 0) return src.slice(start, j + 1); }
  }
  throw new Error('extractFn: unbalanced braces in ' + name);
}

// Same, for a bare `if (...) { ... }` block identified by its opening line.
function extractBlock(src, needle) {
  var start = src.indexOf(needle);
  if (start === -1) throw new Error('extractBlock: ' + needle + ' not found in source');
  var i = src.indexOf('{', start);
  var depth = 0;
  for (var j = i; j < src.length; j++) {
    if (src[j] === '{') depth++;
    else if (src[j] === '}') { depth--; if (depth === 0) return src.slice(start, j + 1); }
  }
  throw new Error('extractBlock: unbalanced braces after ' + needle);
}

var renderFn = extractFn(APP_SRC, 'render');

/* ══ 1 · render() must capture BEFORE the swap and restore AFTER ═════════ */
console.log('\nC-04 — the strip is captured across the innerHTML rebuild\n');

var swapAt = renderFn.indexOf('root.innerHTML =');
var captureAt = renderFn.indexOf('captureTabStripScroll(root)');
var restoreAt = renderFn.indexOf('restoreTabStripScroll(root)');

assert('render() captures the tab strip\'s scrollLeft',
  captureAt !== -1, 'no captureTabStripScroll(root) call in render()');
assert('render() restores the tab strip\'s scrollLeft',
  restoreAt !== -1, 'no restoreTabStripScroll(root) call in render()');
assert('the capture runs BEFORE the innerHTML swap destroys the strip',
  captureAt !== -1 && swapAt !== -1 && captureAt < swapAt);
assert('the restore runs AFTER the innerHTML swap builds the new strip',
  restoreAt !== -1 && restoreAt > swapAt);

// The strip's clientWidth depends on the sidebar, whose width is a CSSOM write
// straight after the swap. Restoring before that would clamp against a width
// the strip is about to lose.
var sidebarVarAt = renderFn.indexOf("setProperty('--tv-sidebar-w'");
assert('the restore runs after the sidebar width is applied',
  sidebarVarAt !== -1 && restoreAt > sidebarVarAt);

// Ordering against the two scrollers that were already preserved — same phase,
// so a future edit that moves one moves all three together.
var sidebarRestoreAt = renderFn.indexOf('restoreSidebarScroll(root)');
assert('the strip is restored in the same phase as the sidebar (JANK-01)',
  sidebarRestoreAt !== -1 && restoreAt > sidebarRestoreAt);

// The whole point of the ordering: the flush and the fade publisher must both
// measure the RESTORED position, never a fresh 0.
var flushAt = renderFn.indexOf('if (_pendingTabScrollId)');
var publishAt = renderFn.lastIndexOf('updateTabStripScroll(root)');
assert('the restore lands before the active-pill flush measures the strip',
  flushAt !== -1 && restoreAt < flushAt);
assert('updateTabStripScroll publishes last, from the settled position',
  publishAt !== -1 && publishAt > flushAt);

// Synchronous inside render(), like every other pre-paint restore (JANK-02):
// nothing may be deferred to a rAF or a microtask between the two.
var betweenSwapAndRestore = renderFn.slice(swapAt, restoreAt);
assert('nothing defers the restore to a later frame',
  betweenSwapAndRestore.indexOf('requestAnimationFrame') === -1 &&
  betweenSwapAndRestore.indexOf('setTimeout') === -1);

/* ══ 2 · the capture/restore helpers, executed ═══════════════════════════ */
console.log('\nC-04 — capture/restore round-trip over a rebuild\n');

function makeStrip(o) {
  o = o || {};
  var btn = { hidden: true, tag: 'more' };
  var strip = {
    scrollLeft: o.scrollLeft || 0,
    scrollWidth: o.scrollWidth === undefined ? 1800 : o.scrollWidth,
    clientWidth: o.clientWidth === undefined ? 800 : o.clientWidth,
    ops: [],
    _btn: btn,
  };
  // Record the ORDER of the two writes restore performs: the ⌄ button must be
  // settled before scrollLeft is written, or the button's ~24px changes
  // clientWidth underneath the value just restored.
  Object.defineProperty(strip, 'scrollLeft', {
    get: function () { return this._sl || 0; },
    set: function (v) { this._sl = v; this.ops.push('scrollLeft=' + v); },
  });
  strip._sl = o.scrollLeft || 0;
  Object.defineProperty(btn, 'hidden', {
    get: function () { return this._h; },
    set: function (v) { this._h = v; strip.ops.push('btnHidden=' + v); },
  });
  btn._h = true;
  strip.parentNode = {
    querySelector: function (sel) { return sel === '[data-tab-overflow]' ? btn : null; },
  };
  return strip;
}
function makeRoot(strip) {
  return {
    querySelector: function (sel) { return sel === '.tv-tab-strip' ? strip : null; },
    querySelectorAll: function () { return []; },
  };
}

function makeSandbox() {
  var sandbox = { console: console };
  vm.runInContext(
    extractFn(APP_SRC, 'syncTabOverflowBtn') + '\n' +
    'var _tabStripScrollLeft = 0;\n' +
    extractFn(APP_SRC, 'captureTabStripScroll') + '\n' +
    extractFn(APP_SRC, 'restoreTabStripScroll') + '\n' +
    'function saved() { return _tabStripScrollLeft; }\n' +
    'function setSaved(v) { _tabStripScrollLeft = v; }\n',
    vm.createContext(sandbox), { filename: 'tabstrip-harness.js' });
  return sandbox;
}

var s = makeSandbox();

// The defect, end to end: a scrolled strip is destroyed and a fresh one built
// at 0. Without the round-trip the user's position is gone.
var live = makeStrip({ scrollLeft: 400 });
s.captureTabStripScroll(makeRoot(live));
eq('capture reads the live strip\'s scrollLeft', s.saved(), 400);

var rebuilt = makeStrip({ scrollLeft: 0 });
s.restoreTabStripScroll(makeRoot(rebuilt));
eq('restore puts the rebuilt strip back where the user left it', rebuilt.scrollLeft, 400);

// The ⌄ overflow control (C-06) is ~24px wide and always renders `hidden`.
// Unhiding it AFTER the scroll write would re-clamp the restored position and
// skew the pill flush, which measures against the same clientWidth.
assert('restore settles the ⌄ button BEFORE writing scrollLeft',
  rebuilt.ops.length >= 2 &&
  rebuilt.ops[0].indexOf('btnHidden') === 0 &&
  rebuilt.ops[rebuilt.ops.length - 1].indexOf('scrollLeft') === 0,
  'op order was ' + JSON.stringify(rebuilt.ops));
eq('an overflowing strip shows the ⌄ button', rebuilt._btn.hidden, false);

// A strip that fits spends zero pixels on the control.
var fits = makeStrip({ scrollWidth: 700, clientWidth: 800 });
s.restoreTabStripScroll(makeRoot(fits));
eq('a strip that fits keeps the ⌄ button hidden', fits._btn.hidden, true);

// The verdict must not depend on scrollLeft, or restoring a position could flip
// the button, which changes clientWidth, which changes the verdict → oscillation.
var syncSrc = extractFn(APP_SRC, 'syncTabOverflowBtn');
assert('the overflow verdict ignores scrollLeft entirely',
  syncSrc.indexOf('scrollLeft') === -1);
assert('updateTabStripScroll delegates the button to the same helper',
  extractFn(APP_SRC, 'updateTabStripScroll').indexOf('syncTabOverflowBtn(strip)') !== -1);

// ⌘B collapses the sidebar via display:none, and the empty state has no strip
// at all. Reading either would overwrite the saved offset with a 0 and drop the
// user at the first tab when the strip comes back.
s = makeSandbox();
s.setSaved(400);
s.captureTabStripScroll(makeRoot(makeStrip({ scrollLeft: 0, clientWidth: 0 })));
eq('capture ignores a strip with no layout', s.saved(), 400);
s.captureTabStripScroll(makeRoot(null));
eq('capture ignores a missing strip (empty state)', s.saved(), 400);
assert('restore is a no-op when there is no strip', (function () {
  try { s.restoreTabStripScroll(makeRoot(null)); return true; } catch (e) { return false; }
}()));
assert('restore tolerates a null root', (function () {
  try { s.restoreTabStripScroll(null); return true; } catch (e) { return false; }
}()));

// No manual clamp: the browser clamps to the new scrollWidth on its own, the
// same assumption restoreSidebarScroll makes. A hand-rolled clamp would have to
// re-measure and would fight the native one.
var restoreSrc = extractFn(APP_SRC, 'restoreTabStripScroll');
assert('restore writes the raw offset and lets the browser clamp',
  /strip\.scrollLeft = _tabStripScrollLeft/.test(restoreSrc));

/* ══ 3 · the flush only moves an OUT-OF-VIEW pill ════════════════════════ */
console.log('\nC-04 — selecting a visible tab must move nothing\n');

var flushBlock = extractBlock(APP_SRC, 'if (_pendingTabScrollId)');

// Run the real flush against a fake pill + strip. PAD is 8px in the source.
function runFlush(pill, stripGeom) {
  var strip = { scrollLeft: stripGeom.scrollLeft, clientWidth: stripGeom.clientWidth };
  var calls = [];
  var pillEl = {
    offsetLeft: pill.left,
    offsetWidth: pill.width,
    closest: function (sel) { return sel === '.tv-tab-strip' ? strip : null; },
    // Stubbed rather than absent so a reintroduced call reports a clean FAIL
    // here instead of exploding inside the harness.
    scrollIntoView: function () { calls.push('scrollIntoView'); },
  };
  var sandbox = {
    console: console,
    _pendingTabScrollId: 'tab-1',
    root: { querySelector: function () { return pillEl; } },
    strip: strip,
  };
  vm.runInContext(flushBlock + '\nvar latchAfter = _pendingTabScrollId;',
    vm.createContext(sandbox), { filename: 'flush-harness.js' });
  return { scrollLeft: strip.scrollLeft, latchAfter: sandbox.latchAfter, calls: calls };
}

// THE regression. Strip scrolled to 400; the pill sits at 500..600, fully
// inside [400, 1200). Before round 2 this ran scrollIntoView and nudged the
// strip anyway; the number must not change at all.
var visibleCase = runFlush({ left: 500, width: 100 }, { scrollLeft: 400, clientWidth: 800 });
eq('a fully visible pill leaves scrollLeft untouched', visibleCase.scrollLeft, 400);

// Flush at the exact edges — an off-by-one here reintroduces a 1px twitch on
// every click of the left-most or right-most visible tab.
eq('a pill flush against the left edge does not scroll',
  runFlush({ left: 400, width: 100 }, { scrollLeft: 400, clientWidth: 800 }).scrollLeft, 400);
eq('a pill flush against the right edge does not scroll',
  runFlush({ left: 1100, width: 100 }, { scrollLeft: 400, clientWidth: 800 }).scrollLeft, 400);

// The one movement that IS allowed, in both directions, with an 8px breathing
// margin so the pill does not sit under the edge fade.
eq('a pill off screen to the RIGHT is scrolled just into view',
  runFlush({ left: 1300, width: 100 }, { scrollLeft: 400, clientWidth: 800 }).scrollLeft,
  1300 + 100 - 800 + 8);
eq('a pill off screen to the LEFT is scrolled just into view',
  runFlush({ left: 100, width: 100 }, { scrollLeft: 400, clientWidth: 800 }).scrollLeft,
  100 - 8);
eq('the left case never scrolls past the start',
  runFlush({ left: 2, width: 100 }, { scrollLeft: 400, clientWidth: 800 }).scrollLeft, 0);

// The latch is one-shot: render() runs on far more than tab activations, and a
// sticky latch would re-assert the pill's position on every unrelated repaint.
eq('the flush consumes the latch', visibleCase.latchAfter, null);

// scrollIntoView nudges every scrollable ancestor, not just the strip — that is
// what round 2 removed and what must not come back.
// (a CALL, not the word — the block's comment explains why the call is gone)
assert('the flush never calls scrollIntoView',
  !/\.scrollIntoView\s*\(/.test(flushBlock) && visibleCase.calls.length === 0,
  'called ' + JSON.stringify(visibleCase.calls));
assert('the flush guards on both out-of-view directions',
  /pillL < viewL/.test(flushBlock) && /pillR > viewR/.test(flushBlock));

/* ══ 4 · nothing else may move the strip ═════════════════════════════════ */
console.log('\nC-04 — no other path repositions the strip\n');

// The Ctrl-Tab / arrow-key switcher focuses the new pill a frame later. Without
// preventScroll the browser scrolls the strip on its own terms, after the flush
// has already decided the pill did not need bringing into view.
var focusCall = APP_SRC.slice(APP_SRC.indexOf('[data-tab-id="\' + ids[next] + \'"]'));
assert('the Ctrl-Tab pill focus passes preventScroll',
  /el\.focus\(\{\s*preventScroll:\s*true\s*\}\)/.test(focusCall.slice(0, 600)),
  'focus() would let the browser re-scroll the strip after the flush');

// The strip's own scroll listener publishes fade state; it must not write back
// a position, or a restore would fight it.
var stripListener = APP_SRC.slice(APP_SRC.indexOf("var stripEl = tvEl.querySelector('.tv-tab-strip')"));
stripListener = stripListener.slice(0, 300);
assert('the strip scroll listener only publishes state, never writes scrollLeft',
  stripListener.indexOf('updateTabStripScroll') !== -1 &&
  !/scrollLeft\s*=/.test(stripListener));

// DR-06 / JANK-01 precedent: this offset only has to survive a repaint. It is
// never written to disk, session storage or localStorage.
assert('the strip offset is not persisted anywhere',
  APP_SRC.indexOf('_tabStripScrollLeft') !== -1 &&
  !/(localStorage|sessionStorage)[^\n]*_tabStripScrollLeft/.test(APP_SRC) &&
  extractFn(APP_SRC, 'saveSession').indexOf('_tabStripScrollLeft') === -1);

console.log('\n' + (fail === 0
  ? 'ALL PASS: ' + pass + ' passed, 0 failed'
  : pass + ' passed, ' + fail + ' FAILED'));
process.exit(fail === 0 ? 0 : 1);
