/* ───────────────────────────────────────────────────────────
   Sidebar selection-jank tests  (run: node app/js/tv-sidebar-jank.test.js)

   Selecting a file in the sidebar tree visibly janked the file list. Three
   independent mechanisms, three independent fixes:

     JANK-01 — .tv-side-scroll was recreated at scrollTop 0 by every render(),
               so the list snapped back to the top on every click. The content
               pane has been preserved since DR-03; the sidebar never was.
     JANK-02 — one click ran render() up to THREE times (dropTransientTab →
               _doCloseTab, openDoc → activateTab, TVNative.openInto's D4
               re-render). Each replaces #tv-root's whole innerHTML.
     JANK-03 — .tv-side-scroll grew its scrollbar 0 → 4px on :hover. Styling
               ::-webkit-scrollbar opts WebKit out of overlay scrollbars, so
               that 4px comes out of the CONTENT box: every row reflowed the
               moment the pointer entered the sidebar, on the way to a click.

   The batching primitive and the scroll capture/restore helpers are lifted
   VERBATIM out of tv-app.js and executed here, so these are behavioural tests
   of the shipped code, not of a copy. The wiring that invokes them lives deep
   inside the tv-app.js IIFE and is covered by source guards over the exact
   call sites — the approach tv-search.test.js and tv-sidebar-hierarchy.test.js
   already take.
   ─────────────────────────────────────────────────────────── */
'use strict';

var fs = require('fs');
var path = require('path');
var vm = require('vm');

var pass = 0;
var fail = 0;

function assert(label, condition, detail) {
  if (condition) {
    console.log('  PASS  ' + label);
    pass++;
  } else {
    console.error('  FAIL  ' + label + (detail ? ' — ' + detail : ''));
    fail++;
  }
}
function eq(label, actual, expected) {
  assert(label, actual === expected, 'expected ' + JSON.stringify(expected) + ', got ' + JSON.stringify(actual));
}

var APP_SRC = fs.readFileSync(path.join(__dirname, 'tv-app.js'), 'utf8');
var NATIVE_SRC = fs.readFileSync(path.join(__dirname, 'tv-native.js'), 'utf8');
var CSS_SRC = fs.readFileSync(path.join(__dirname, '..', 'css', 'tv-app.css'), 'utf8');

// Pull `function <name>(...) { ... }` out of a source string by matching braces.
// Used so the tests below run the REAL implementation: if someone rewrites
// batchRender in tv-app.js, these tests re-run the rewrite, not a stale clone.
function extractFn(src, name) {
  var start = src.indexOf('function ' + name + '(');
  if (start === -1) throw new Error('extractFn: ' + name + ' not found in source');
  var i = src.indexOf('{', start);
  var depth = 0;
  for (var j = i; j < src.length; j++) {
    if (src[j] === '{') depth++;
    else if (src[j] === '}') {
      depth--;
      if (depth === 0) return src.slice(start, j + 1);
    }
  }
  throw new Error('extractFn: unbalanced braces in ' + name);
}

/* ══ JANK-02 · render coalescing ═════════════════════════════════════════ */
console.log('\nJANK-02 — one click, one repaint\n');

// Real batchRender + a counting render(), wired to the same module-scope vars
// tv-app.js declares. renderLog records the order of real repaints.
function makeBatchSandbox() {
  var sandbox = {
    renders: 0,
    renderLog: [],
    domGeneration: 0,   // stands in for "the DOM #tv-root currently holds"
    console: console,
  };
  var src =
    'var _renderSuspend = 0;\n' +
    'var _renderQueued = false;\n' +
    'var _pendingTabScrollId = null;\n' +
    extractFn(APP_SRC, 'batchRender') + '\n' +
    // Minimal stand-in for render(): keeps the real suspend/queue guard that
    // tv-app.js's render() opens with, so the contract under test is identical.
    'function render() {\n' +
    '  if (_renderSuspend > 0) { _renderQueued = true; return; }\n' +
    '  renders++; domGeneration++; renderLog.push("paint");\n' +
    '}\n' +
    'function suspendDepth() { return _renderSuspend; }\n' +
    'function queued() { return _renderQueued; }\n';
  vm.runInContext(src, vm.createContext(sandbox), { filename: 'batch-harness.js' });
  return sandbox;
}

var s = makeBatchSandbox();

// Baseline: unbatched renders each paint. The bug was three of these per click.
s.render(); s.render(); s.render();
eq('unbatched: 3 render() calls paint 3 times', s.renders, 3);

// The core fix: the three renders a single file-selection fires collapse to one.
s = makeBatchSandbox();
s.batchRender(function () {
  s.render();   // dropTransientTab → _doCloseTab
  s.render();   // openDoc → activateTab
  s.render();   // TVNative.openInto (QA D4 re-render)
});
eq('batched: 3 render() calls paint ONCE', s.renders, 1);

// Synchronous by contract — callers all over tv-app.js read the DOM straight
// after render()/openDoc() returns. A microtask- or rAF-deferred batch would
// leave them reading the pre-render DOM.
s = makeBatchSandbox();
var genInside = null;
s.batchRender(function () { s.render(); genInside = s.domGeneration; });
eq('no repaint lands mid-batch', genInside, 0);
eq('repaint has landed by the time batch returns', s.domGeneration, 1);

// Nesting must be counted, not boolean: TVNative.openInto opens a batch, and
// _openTreeFilePath has usually already opened one around it.
s = makeBatchSandbox();
s.batchRender(function () {
  s.render();
  s.batchRender(function () { s.render(); s.render(); });
  eq('inner batch does NOT flush while outer is open', s.renders, 0);
  s.render();
});
eq('nested batches still paint exactly once', s.renders, 1);
eq('suspend depth unwinds to zero', s.suspendDepth(), 0);

// A batch that renders nothing must not manufacture a repaint.
s = makeBatchSandbox();
s.batchRender(function () { /* no state change */ });
eq('batch with no render() paints not at all', s.renders, 0);

// batchRender returns fn's value — openDoc returns the new tab id through it.
s = makeBatchSandbox();
eq('batchRender passes the return value through',
  s.batchRender(function () { s.render(); return 'tab-42'; }), 'tab-42');

// A throw inside fn must not strand the shell suspended: every later render()
// would be silently swallowed and the UI would freeze.
s = makeBatchSandbox();
var threw = false;
try {
  s.batchRender(function () { s.render(); throw new Error('read failed'); });
} catch (e) { threw = true; }
assert('a throwing batch still propagates the error', threw);
eq('a throwing batch leaves suspend depth at zero', s.suspendDepth(), 0);
eq('a throwing batch still flushes the owed repaint', s.renders, 1);
s.render();
eq('renders work normally after a throwing batch', s.renders, 2);

// Sequential (not nested) batches each paint once — browsing file to file.
s = makeBatchSandbox();
s.batchRender(function () { s.render(); s.render(); });
s.batchRender(function () { s.render(); s.render(); });
eq('two clicks paint twice, not four times', s.renders, 2);

/* ══ JANK-02 · batching must not corrupt per-tab scroll (DR-03) ══════════ */
console.log('\nJANK-02 — batching keeps DR-03 per-tab scroll honest\n');

// Deferring a render decouples the DOM from state. The two places that read a
// scroll offset back out of the DOM have to know when that has happened, or a
// freshly opened file inherits the previous file's scroll offset.
function makeStalenessSandbox() {
  var sandbox = { renders: 0, console: console };
  var src =
    'var _renderSuspend = 0;\n' +
    'var _renderQueued = false;\n' +
    'var _pendingTabScrollId = null;\n' +
    extractFn(APP_SRC, 'batchRender') + '\n' +
    extractFn(APP_SRC, 'domMatchesState') + '\n' +
    'function render() {\n' +
    '  if (_renderSuspend > 0) { _renderQueued = true; return; }\n' +
    '  renders++;\n' +
    '}\n';
  vm.runInContext(src, vm.createContext(sandbox), { filename: 'staleness-harness.js' });
  return sandbox;
}

var st = makeStalenessSandbox();
assert('outside a batch the DOM always matches state', st.domMatchesState());

st = makeStalenessSandbox();
st.batchRender(function () {
  // Entering a batch changes nothing yet: this is the window in which
  // _doActivateTab legitimately saves the OUTGOING tab's live scroll (DR-03).
  assert('inside a fresh batch the DOM still matches state', st.domMatchesState());
  st.render();  // e.g. dropTransientTab → _doCloseTab moved state.activeId
  assert('after a deferred render the DOM is known stale', !st.domMatchesState());
});
assert('once the batch flushes the DOM matches state again', st.domMatchesState());

// The guard is deliberately keyed to "a render is owed", not "a batch is open" —
// keying it to the batch would skip the legitimate outgoing-tab save above and
// silently break DR-03 in the opposite direction.
var appSrcHasQueuedGuard = /function domMatchesState\(\) \{\s*return !_renderQueued;/.test(APP_SRC);
assert('staleness is keyed to _renderQueued, not _renderSuspend', appSrcHasQueuedGuard);

var doActivateSrc = extractFn(APP_SRC, '_doActivateTab');
assert('_doActivateTab guards its outgoing-scroll read',
  /domMatchesState\(\) \? document\.querySelector\('\[data-scroll\]'\) : null/.test(doActivateSrc));
var saveSessionSrc = extractFn(APP_SRC, 'saveSession');
assert('saveSession guards its live-scroll read',
  /domMatchesState\(\) \? document\.querySelector\('\[data-scroll\]'\) : null/.test(saveSessionSrc));
assert('no unguarded [data-scroll] read survives in saveSession',
  saveSessionSrc.indexOf("var scrollEl = document.querySelector('[data-scroll]')") === -1);

/* ══ JANK-01 · sidebar scroll survives a render ══════════════════════════ */
console.log('\nJANK-01 — the file list stays where the user left it\n');

function makeScrollSandbox() {
  var sandbox = { console: console };
  var src =
    'var _sidebarScrollTop = 0;\n' +
    extractFn(APP_SRC, 'hasLayout') + '\n' +
    extractFn(APP_SRC, 'captureSidebarScroll') + '\n' +
    extractFn(APP_SRC, 'restoreSidebarScroll') + '\n' +
    'function saved() { return _sidebarScrollTop; }\n' +
    '';
  vm.runInContext(src, vm.createContext(sandbox), { filename: 'scroll-harness.js' });
  return sandbox;
}

// A scrollable element stand-in. clientHeight defaults to a laid-out panel;
// pass 0 for the collapsed case, which is what an element inside display:none
// reports — and what a hidden sidebar's .tv-side-scroll reports.
function sideEl(scrollTop, clientHeight) {
  return {
    scrollTop: scrollTop,
    clientHeight: clientHeight === undefined ? 600 : clientHeight,
  };
}
// A #tv-root stand-in, mirroring how render() reaches the sidebar after the
// innerHTML swap: querySelector for .tv-side-scroll, querySelectorAll for the
// capped folder bodies.
function fakeRoot(sideScrollEl, folderBodies) {
  return {
    querySelector: function (sel) {
      return sel === '.tv-side-scroll' ? sideScrollEl : null;
    },
    querySelectorAll: function (sel) {
      return sel === '[data-folder-body]' ? (folderBodies || []) : [];
    },
  };
}

var sc = makeScrollSandbox();
var oldSide = sideEl(340);
sc.captureSidebarScroll(fakeRoot(oldSide));
eq('offset is read off the live node before teardown', sc.saved(), 340);

// The bug: the rebuilt node starts at 0 and nothing ever put it back.
var newSide = sideEl(0);
sc.restoreSidebarScroll(fakeRoot(newSide));
eq('offset is reapplied to the rebuilt node', newSide.scrollTop, 340);

// Round trip across a simulated render: capture → DOM swap → restore.
sc = makeScrollSandbox();
sc.captureSidebarScroll(fakeRoot(sideEl(512)));   // user scrolled the list
var rebuilt = sideEl(0);                          // render() replaced innerHTML
sc.restoreSidebarScroll(fakeRoot(rebuilt));
eq('list does not snap to the top on selection', rebuilt.scrollTop, 512);

// Sidebar collapsed (⌘B): buildSidebar STILL emits .tv-side-scroll — it only
// adds .collapsed to the <aside>, and .tv-sidebar.collapsed is display:none.
// An unlaid-out element reports scrollTop 0, so an unconditional read would
// wipe the saved offset and drop the user at the top when they reopen.
sc = makeScrollSandbox();
sc.captureSidebarScroll(fakeRoot(sideEl(200)));
sc.captureSidebarScroll(fakeRoot(sideEl(0, 0)));  // render while collapsed
eq('a collapsed sidebar does not discard the offset', sc.saved(), 200);
var reopened = sideEl(0);
sc.restoreSidebarScroll(fakeRoot(reopened));
eq('reopening the sidebar restores the offset', reopened.scrollTop, 200);

// Same guard, but for a sidebar that never existed in this render at all.
sc = makeScrollSandbox();
sc.captureSidebarScroll(fakeRoot(sideEl(180)));
sc.captureSidebarScroll(fakeRoot(null));
eq('a missing sidebar node does not discard the offset', sc.saved(), 180);

// Never write scrollTop when the list was already at the top: an unconditional
// write forces a scroll event and can fight a concurrent scrollIntoView.
sc = makeScrollSandbox();
var untouched = sideEl(77);                  // e.g. mid scrollIntoView
sc.captureSidebarScroll(fakeRoot(sideEl(0)));
sc.restoreSidebarScroll(fakeRoot(untouched));
eq('a zero offset is not written back', untouched.scrollTop, 77);

/* ── UXF-03: DR-41's capped body (a second scroller) is gone ── */
// .tv-side-scroll is now the only sidebar scroller, so it is the only offset
// render() has to carry across the innerHTML swap.
assert('no folder body is capped into its own scroller any more',
  APP_SRC.indexOf("' capped'") === -1 && !/\.tv-folder-body\.capped/.test(CSS_SRC));
assert('capture/restore touch only .tv-side-scroll',
  extractFn(APP_SRC, 'captureSidebarScroll').indexOf('[data-folder-body]') === -1 &&
  extractFn(APP_SRC, 'restoreSidebarScroll').indexOf('[data-folder-body]') === -1);

/* ── the keyboard cursor must not drag the list on every render ── */
// renderSidebarCursor() runs at the END of render(), after restoreSidebarScroll().
// An unconditional scrollIntoView there re-asserted the cursor's position on
// every repaint — and because the list then moved BETWEEN the two clicks of a
// double-click, click #2 landed on a different row and pinned the wrong file.
var cursorFn = extractFn(APP_SRC, 'renderSidebarCursor');
assert('the cursor scrolls only when it actually moved',
  /if \(sbKbd\.id !== _lastCursorScrollId\) \{[\s\S]*?scrollIntoView/.test(cursorFn));
assert('dismissing the cursor forgets the last scrolled row',
  /_lastCursorScrollId = null;\s*return;/.test(cursorFn));
// Exactly one scroll call, and the guard precedes it — a second, unguarded call
// would reintroduce the drag.
eq('renderSidebarCursor scrolls in exactly one place',
  (cursorFn.match(/scrollIntoView\(/g) || []).length, 1);
assert('the move guard precedes the scroll call',
  cursorFn.indexOf('_lastCursorScrollId') < cursorFn.indexOf('scrollIntoView'));

// DR-107 is about the TAB KEY. #tv-sidebar-listbox is .tv-side-scroll, which
// carries tabindex="0", so a mouse click in the list focused it too and armed
// the cursor at a STALE row — which the next render then scrolled to.
assert('pointer-driven focus does not arm the keyboard cursor',
  /_sbPointerFocus\b/.test(APP_SRC) &&
  /if \(_sbPointerFocus\) \{ _sbPointerFocus = false; return; \}/.test(APP_SRC));
assert('the pointer flag self-clears so a real Tab focus still seeds the cursor',
  /pointerdown[\s\S]{0,200}setTimeout\(function \(\) \{ _sbPointerFocus = false; \}, 0\)/.test(APP_SRC));

// Must survive a missing root / missing querySelector without throwing —
// render() bails on a null root, but these are also called from tests + init.
sc = makeScrollSandbox();
sc.captureSidebarScroll(null);
sc.captureSidebarScroll({});
sc.restoreSidebarScroll(null);
sc.restoreSidebarScroll({});
assert('capture/restore tolerate a missing root', true);

/* ══ JANK-01/02 · wiring inside the tv-app.js IIFE ═══════════════════════ */
console.log('\nJANK-01/02 — call sites are actually wired\n');

// render() must consult the suspend flag BEFORE it tears anything down —
// checking it later would still close the palette / find bar on a no-op render.
var renderFn = extractFn(APP_SRC, 'render');
var suspendCheck = renderFn.indexOf('_renderSuspend > 0');
var firstTeardown = renderFn.indexOf('TVPalette.close');
assert('render() short-circuits before any teardown',
  suspendCheck !== -1 && firstTeardown !== -1 && suspendCheck < firstTeardown);

// Capture must precede the innerHTML swap, restore must follow it — otherwise
// we read the offset off an already-replaced node, or write it to a dead one.
var swapAt = renderFn.indexOf('root.innerHTML =');
var captureAt = renderFn.indexOf('captureSidebarScroll(root)');
var restoreAt = renderFn.indexOf('restoreSidebarScroll(root)');
assert('sidebar scroll is captured before the innerHTML swap',
  captureAt !== -1 && swapAt !== -1 && captureAt < swapAt);
assert('sidebar scroll is restored after the innerHTML swap',
  restoreAt !== -1 && restoreAt > swapAt);

// Restore after applyTreeDepths: row padding must be final before scrollTop is
// measured against scrollHeight.
var depthsAt = renderFn.indexOf('applyTreeDepths(root)');
assert('sidebar scroll is restored after applyTreeDepths', depthsAt !== -1 && restoreAt > depthsAt);

// The three renders a selection fires must all sit inside a batch.
var openDocFn = extractFn(APP_SRC, 'openDoc');
assert('openDoc batches its drop-preview + activate renders',
  /return\s+batchRender\(function/.test(openDocFn));
assert('openDoc still drops the transient tab inside the batch',
  openDocFn.indexOf('dropTransientTab()') !== -1);

var openTreeFn = extractFn(APP_SRC, '_openTreeFilePath');
assert('_openTreeFilePath batches the already-open activate + pin path',
  /batchRender\(function \(\) \{\s*activateTab\(already\)/.test(openTreeFn));
assert('_openTreeFilePath batches the async open + pin path',
  (openTreeFn.match(/batchRender\(/g) || []).length >= 2);

assert('TVNative.openInto batches through the TV controller API',
  /tv\.batch\(function \(\) \{\s*_openInto\(tv, doc, opts\)/.test(NATIVE_SRC));
assert('openInto keeps a fallback for a shell without TV.batch',
  /typeof tv\.batch === 'function'/.test(NATIVE_SRC));
assert('TV.batch is exported on the controller API', /\bbatch:\s*batchRender\b/.test(APP_SRC));

// The active-pill scrollIntoView must be latched, not read inline: inside a
// batch the pill does not exist in the DOM yet.
var doActivateFn = extractFn(APP_SRC, '_doActivateTab');
assert('_doActivateTab latches the pill scroll instead of querying inline',
  doActivateFn.indexOf('_pendingTabScrollId = id') !== -1);
assert('_doActivateTab no longer queries [data-tab-id] itself',
  doActivateFn.indexOf('data-tab-id') === -1);
// C-04 (round 2): the flush no longer calls scrollIntoView. That API nudges
// ancestors and shifted the strip even when the pill was ALREADY fully visible,
// which the user reported on the verification pass. The latch invariant this
// test exists to protect is unchanged — render() still consumes
// _pendingTabScrollId — only the mechanism moved to a direct scrollLeft write.
assert('render() flushes the latched pill scroll',
  renderFn.indexOf('_pendingTabScrollId') !== -1 &&
  renderFn.indexOf('scrollLeft') !== -1);
assert('the flush only scrolls when the pill is actually out of view',
  /pillL < viewL/.test(renderFn) && /pillR > viewR/.test(renderFn));
assert('the flush no longer calls scrollIntoView on the pill',
  renderFn.indexOf('pillEl.scrollIntoView') === -1);

/* ══ JANK-03 · no reflow when the pointer enters the sidebar ═════════════ */
console.log('\nJANK-03 — hovering the list must not reflow it\n');

// Isolate the .tv-side-scroll scrollbar rules.
var sideRules = CSS_SRC.split('\n').filter(function (l) {
  return l.indexOf('.tv-side-scroll') !== -1 && l.indexOf('scrollbar') !== -1;
}).join('\n');

assert('the sidebar scrollbar gutter has a fixed width',
  /\.tv-side-scroll::-webkit-scrollbar \{[^}]*width: 4px/.test(CSS_SRC));
assert('no :hover rule changes the scrollbar width',
  !/\.tv-side-scroll:(hover|focus-within)::-webkit-scrollbar \{[^}]*width:/.test(CSS_SRC));
assert('the scrollbar is not toggled via display',
  sideRules.indexOf('display: none') === -1 && sideRules.indexOf('display: block') === -1);
assert('scrollbar-width is not toggled between none and thin',
  !/\.tv-side-scroll \{[^}]*scrollbar-width: none/.test(CSS_SRC));

// The reveal itself is unchanged design intent — hidden at rest, shown on hover
// — and is expressed as a COLOUR change only. Whether it is reachable at runtime
// is a macOS setting, not a CSS question: under the default AppleShowScrollBars
// ("Automatically based on mouse or trackpad") the thumb is an OVERLAY scrollbar
// that WebKit auto-hides when scrolling stops, so it paints only mid-scroll
// regardless of these rules. Under AppleShowScrollBars = Always it is
// non-overlay and these rules do apply. What the test guards is the part that is
// ours: the reveal must never be expressed as a width or display change.
assert('the thumb is transparent at rest',
  /\.tv-side-scroll::-webkit-scrollbar-thumb \{[^}]*background: transparent/.test(CSS_SRC));
assert('the thumb is revealed on hover by colour',
  /\.tv-side-scroll:hover::-webkit-scrollbar-thumb[^{]*\{[^}]*var\(--tv-scrollthumb\)/.test(CSS_SRC));
assert('keyboard focus reveals the thumb too',
  /\.tv-side-scroll:focus-within::-webkit-scrollbar-thumb/.test(CSS_SRC));
assert('the standard scrollbar-color follows the same at-rest/hover split',
  /\.tv-side-scroll \{[^}]*scrollbar-color: transparent transparent/.test(CSS_SRC) &&
  /\.tv-side-scroll:hover,\s*\n\.tv-side-scroll:focus-within \{[^}]*scrollbar-color: var\(--tv-scrollthumb\) transparent/.test(CSS_SRC));

/* ══ regression guards on the SBH work this sits on top of ══════════════ */
console.log('\nRegression — SBH-01/03 invariants still hold\n');

assert('SBH-01 rails still clip on --tv-depth',
  /background-size: calc\(var\(--tv-depth, 0\) \* 14px\)/.test(CSS_SRC));
assert('SBH-01 row hover still sets background-color, never the shorthand',
  /\.tv-tree-row:hover:not\(\.active\) \{ background-color:/.test(CSS_SRC));
assert('SBH-01 CSSOM depth pass survives',
  /el\.style\.setProperty\('--tv-depth'/.test(APP_SRC));
assert('SBH-03 duplicate-open guards survive the batching change',
  openTreeFn.indexOf('_openingPaths[tfPath]') !== -1 &&
  openTreeFn.indexOf('_tabIdByNativePath(tfPath)') !== -1);

/* ── summary ─────────────────────────────────────────────── */
console.log('\n' + (fail === 0 ? 'ALL PASS' : 'FAILURES') + ': ' + pass + ' passed, ' + fail + ' failed\n');
process.exit(fail === 0 ? 0 : 1);
