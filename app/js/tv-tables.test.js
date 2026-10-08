/* ───────────────────────────────────────────────────────────
   UXF-01 / UXF-04 · wide tables + sticky headers  (run: node app/js/tv-tables.test.js)

   Static CSS guards for the three width tiers and the sticky header (the
   geometry itself is pure CSS, verified in a browser), plus the REAL
   markWideTables / setupWideTables / captureTableScroll lifted out of
   tv-app.js and run against a fake DOM: tier-3 marking, data-edge, a resize
   that clears it, and the DR-10 scroll round trip across a repaint.
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

var APP = fs.readFileSync(path.join(__dirname, 'tv-app.js'), 'utf8');
var CSS = fs.readFileSync(path.join(__dirname, '..', 'css', 'tv-app.css'), 'utf8');
var PRINT = fs.readFileSync(path.join(__dirname, '..', 'css', 'tv-print.css'), 'utf8');
var TOKENS = fs.readFileSync(path.join(__dirname, '..', 'css', 'tv-tokens.css'), 'utf8');
var HTML = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
var MD = fs.readFileSync(path.join(__dirname, 'tv-markdown.js'), 'latin1');

function extractFn(src, name) {
  var start = src.indexOf('function ' + name + '(');
  if (start === -1) throw new Error('extractFn: ' + name + ' not found');
  var depth = 0;
  for (var j = src.indexOf('{', start); j < src.length; j++) {
    if (src[j] === '{') depth++;
    else if (src[j] === '}' && --depth === 0) return src.slice(start, j + 1);
  }
  throw new Error('extractFn: unbalanced ' + name);
}
function rule(sel) {
  var i = CSS.indexOf(sel + ' {');
  return i === -1 ? '' : CSS.slice(i, CSS.indexOf('}', i) + 1);
}

console.log('\nUXF-01 · CSS: width tiers (policy v2 writes the width)\n');
assert('.tv-scroll is an inline-size container (cqw units)', /\.tv-scroll \{[^}]*container-type: inline-size/.test(CSS));
var wrap = rule('.md > .tbl-wrap');
assert('top-level wrapper spans the pane minus a 24px gutter',
  /--tv-tbl-gutter: 24px/.test(wrap) && /margin-inline: calc\(50% - 50cqw \+ var\(--tv-tbl-gutter\)\)/.test(wrap));
assert('…and centres a shrink-to-fit grid item, no box of its own',
  /display: grid; justify-content: center/.test(wrap) && /overflow: visible; border: 0; border-radius: 0/.test(wrap));
assert('tier 1: the table is at least the text column wide',
  /--tv-tbl-col: min\(calc\(var\(--tv-content-max\) - 2 \* var\(--tv-s7\)\),\s*calc\(100cqw - 2 \* var\(--tv-s7\)\)\)/.test(wrap) &&
  /width: var\(--tv-tbl-w, auto\); min-width: var\(--tv-tbl-col\)/.test(rule('.md > .tbl-wrap > table')));
var tbl = rule('.md > .tbl-wrap > table');
assert('border and radius move onto the table, which needs border-collapse: separate',
  /border: 1px solid var\(--tv-border\); border-radius: var\(--tv-radius-md\)/.test(tbl) &&
  /border-collapse: separate; border-spacing: 0/.test(tbl));
assert('the four corner cells carry the inner radius',
  ['thead tr:first-child th:first-child { border-top-left-radius', 'thead tr:first-child th:last-child  { border-top-right-radius',
   'tbody tr:last-child td:first-child  { border-bottom-left-radius', 'tbody tr:last-child td:last-child   { border-bottom-right-radius']
    .every(function (s) { return CSS.indexOf('.md > .tbl-wrap ' + s) !== -1; }));
assert('tier 3 (.tbl-wide) scrolls in its own box, left-aligned', /\.md > \.tbl-wrap\.tbl-wide \{\s*justify-content: start; overflow: auto;/.test(CSS));
assert('data-edge start / end / mid each have a 32px mask fade',
  ['start', 'end', 'mid'].every(function (e) {
    return new RegExp('\\.md > \\.tbl-wrap\\[data-edge="' + e + '"\\] \\{[^}]*mask-image: linear-gradient[^}]*32px').test(CSS);
  }));
assert('old WebKit without container units falls back to the contained box',
  /@supports not \(width: 1cqw\) \{[^\n]*\n\s*\.md > \.tbl-wrap \{ margin-inline: 0; display: block; overflow-x: auto; \}/.test(CSS));
assert('nested tables keep the legacy .tbl-wrap box', /\.md \.tbl-wrap \{ margin: 0 0 var\(--tv-s4\); border: 1px solid/.test(CSS));
assert('the legacy right-edge fade applies to nested tables only',
  /\.md :not\(\.md\) > \.tbl-wrap\[data-overflow="1"\]/.test(CSS) && !/^\.md \.tbl-wrap\[data-overflow="1"\]/m.test(CSS));
assert('the th / td colour rules keep their !important', /\.md th \{[^}]*background: var\(--tv-table-head\) !important/.test(CSS));
assert('no table animation (nothing for reduced motion to disable)', !/tbl-wrap[^{]*\{[^}]*(transition|animation)/.test(CSS));
assert('index.html has no inline table rule overriding this (ISS-002)', !/tbl-wrap|\btable\b|\bth\b/.test(HTML.slice(HTML.indexOf('<style>'), HTML.indexOf('</style>'))));
assert('the markdown markup contract is unchanged (div.tbl-wrap > table)', MD.indexOf('tbl-wrap') !== -1);

console.log('\nUXF-04 · CSS: sticky header\n');
assert('th is sticky at the top, above body cells', /\.md \.tbl-wrap th \{ position: sticky; top: 0; z-index: 1; \}/.test(CSS));
assert('nested (blockquote) tables have no sticky header', /\.md :not\(\.md\) > \.tbl-wrap th \{ position: static; \}/.test(CSS));
assert('the tier-3 box is height-capped so its header sticks inside it',
  /\.tbl-wide \{[^}]*max-height: max\(320px, calc\(100vh - var\(--tv-chrome-h, 160px\)\)\)/.test(CSS));
assert('--tv-chrome-h is a token (160px)', /--tv-chrome-h: 160px/.test(TOKENS));
assert('tiers 1-2: the wrapper is not a scroll container (overflow: visible)', /overflow: visible/.test(wrap));
assert('the pinned header fill is the opaque --tv-table-head (no shadow)',
  /\.md th \{[^}]*background: var\(--tv-table-head\) !important/.test(CSS) &&
  !/box-shadow/.test(rule('.md th')) && !/box-shadow/.test(rule('.md .tbl-wrap th')));

console.log('\nPrint\n');
assert('print: wrapper back in the column, no cap, no scroll, no fade',
  /\.md > \.tbl-wrap \{\s*margin-inline: 0 !important;\s*display: block !important;\s*max-height: none !important;\s*overflow: visible !important;[\s\S]{0,80}mask-image: none !important;/.test(PRINT));
assert('print: every table is page width and never clipped',
  /\.md > \.tbl-wrap > table \{ width: 100% !important; min-width: 0 !important; table-layout: auto; \}/.test(PRINT));
assert('print: long strings wrap, header is not sticky',
  /\.md th, \.md td \{ position: static !important; overflow-wrap: anywhere; word-break: normal; \}/.test(PRINT));
assert('print: tables flagged wide on screen print at .72em', /\.md > \.tbl-wrap\.tbl-wide > table \{ font-size: \.72em; \}/.test(PRINT));

console.log('\nAfter QA round 1\n');
assert('tier 3 keeps find / keyboard scrolling clear of the fade and the pinned header',
  /\.tbl-wide \{[^}]*scroll-padding-inline: 40px; scroll-padding-top: 44px;/.test(CSS));
assert('AC 16: a tier-3 table is its min-content width (WebKit otherwise paints its right border across the cells)',
  /\.md > \.tbl-wrap\.tbl-wide > table \{ width: min-content; \}/.test(CSS));

/* ── fake DOM ──────────────────────────────────────────────── */
function classList() {
  var set = {};
  return {
    contains: function (c) { return !!set[c]; },
    toggle: function (c, on) { if (on === undefined) on = !set[c]; if (on) set[c] = 1; else delete set[c]; return on; },
    add: function (c) { set[c] = 1; }, remove: function (c) { delete set[c]; }
  };
}
// A top-level wrapper in a pane `boxW + 48` wide whose table needs `M` (its
// min-content width) and wants `W` (max-content), with header cells `cols`
// wide in the max-content layout. getBoundingClientRect answers according to
// the inline width sizeTables() is measuring with, like a layout engine would.
function wrapEl(M, boxW, W, cols) {
  if (W === undefined) W = M;
  var attrs = {}, props = {};
  var table = {
    style: {}, sets: 0, marks: false, measured: 0,
    querySelector: function (s) { return s === 'mark[data-find]' && this.marks ? {} : null; },
    get offsetWidth() { return Math.round(this.getBoundingClientRect().width); },
    get offsetHeight() { return 100; },
    rows: [{ cells: (cols || [W]).map(function (c) { return { getBoundingClientRect: function () { return { width: c }; } }; }) }],
    getBoundingClientRect: function () {
      var mode = this.style.width;
      if (mode === 'min-content') { this.measured++; if (w.onMeasure) w.onMeasure(); return { width: M }; }
      if (mode === 'max-content') return { width: W };
      return { width: w.classList.contains('tbl-wide') ? M : Math.max(M, parseFloat(props['--tv-tbl-w']) || W) };
    }
  };
  var w = {
    classList: classList(), clientWidth: boxW, scrollLeft: 0, scrollTop: 0, listeners: 0,
    table: table, sc: { clientWidth: boxW + 48 },
    style: { setProperty: function (k, v) { props[k] = v; table.sets++; } },
    props: props,
    get scrollWidth() { return Math.max(this.clientWidth, this.classList.contains('tbl-wide') ? M : 0); },
    querySelector: function (s) { return s === 'table' ? this.table : null; },
    closest: function (s) { return s === '.tv-scroll' ? this.sc : null; },
    getAttribute: function (k) { return k in attrs ? attrs[k] : null; },
    setAttribute: function (k, v) { attrs[k] = String(v); },
    hasAttribute: function (k) { return k in attrs; },
    removeAttribute: function (k) { delete attrs[k]; },
    addEventListener: function () { this.listeners++; }
  };
  return w;
}
function rootOf(wraps) {
  return {
    querySelectorAll: function (s) { return s === '.md > .tbl-wrap' ? wraps : []; },
    querySelector: function (s) { return s === '.tv-scroll' ? { id: 'scroll' } : null; }
  };
}

function harness() {
  var observed = [];
  var sandbox = {
    console: console, state: { activeId: 't1', tabs: [{ id: 't1' }, { id: 't2' }] },
    window: {
      ResizeObserver: function (cb) { this.cb = cb; this.observe = function (el) { observed.push(el); }; this.disconnect = function () { observed.length = 0; }; },
      getComputedStyle: function () { return { minWidth: sandbox.C + 'px', fontSize: '14px' }; }
    },
    C: 640,
    observed: observed
  };
  sandbox.window.requestAnimationFrame = function (fn) { fn(); return 1; };
  sandbox.ResizeObserver = sandbox.window.ResizeObserver;
  var src = 'var _tableObserver = null, _tableRaf = null, _tableScroll = {}, _renderedTabId = null, _printing = false, _tableSizePasses = 0;\n' +
    'var TABLE_BLEED = 80, TABLE_PROSE_EM = 22, TABLE_SLACK = 2;\n' +
    'var document = { querySelectorAll: function () { return []; } };\n' +
    ['isPrinting', 'topTableWraps', 'tableEdge', 'syncTableEdge', 'tableWidth', 'sizeTables', 'scheduleWideTables', 'setupWideTables', 'rememberTableScroll', 'captureTableScroll']
      .map(function (n) { return extractFn(APP, n); }).join('\n') +
    '\nfunction setPrinting(v) { _printing = v; }\nfunction passes() { return _tableSizePasses; }' +
    '\nfunction setRendered(id) { _renderedTabId = id; }\nfunction tableScrollKeys() { return Object.keys(_tableScroll); }';
  vm.runInContext(src, vm.createContext(sandbox), { filename: 'tv-app.tables-harness.js' });
  return sandbox;
}

console.log('\nUXF-01 v2 · the width policy, tableWidth() (3c: the six rows of the spec table)\n');
(function () {
  var h = harness();
  var P = 22 * 14, C = 640, A = 1176 - 48;
  function tw(M, W, cols) { return h.tableWidth({ C: C, A: A, M: M, W: W, cols: cols, P: P }); }
  var short = tw(300, 575, [90, 100, 80, 120, 90, 95]);
  assert('short, few columns (W ≤ C): T = C', short.width === 640 && !short.wide && !short.prose, short);
  var prose = tw(320, 1690, [160, 760, 770]);
  assert('prose (the owner\'s screenshot): T = B = 800, not 1,122', prose.width === 800 && prose.prose && !prose.wide, prose);
  var mixed = tw(300, 1200, [80, 70, 1050]);
  assert('mixed (one sentence column): T = 800', mixed.width === 800 && mixed.prose, mixed);
  var numeric = tw(700, 1017, [90, 103, 103, 103, 103, 103, 103, 103, 103, 103]);
  assert('short cells, many columns: T = W (1,017) + 2px slack, may exceed 800', numeric.width === 1019 && !numeric.prose && !numeric.wide, numeric);
  var many = tw(2900, 3382, [240, 240]);
  assert('short cells, too many columns: wide (M > A)', many.wide === true, many);
  var url = tw(950, 1900, [160, 900, 700]);
  assert('prose with an unbreakable string: T = min(M, A) = 950 + 2px slack', url.width === 952 && url.prose && !url.wide, url);
  var frac = tw(300, 1061.6, [212, 212, 212, 212, 213.6]);
  assert('a fractional natural width is rounded UP and given 2px (never squeezed below W)', frac.width === 1064, frac);
  var tight = h.tableWidth({ C: 640, A: 1128, M: 300, W: 639.6, cols: [300, 339.6], P: P });
  assert('a short table that only just fits the column still gets its slack', tight.width === 642, tight);
  var capped = h.tableWidth({ C: 640, A: 1128, M: 300, W: 1127.5, cols: [225, 225, 225, 225, 227.5], P: P });
  assert('slack never pushes a table past A', capped.width === 1128, capped);
  var narrow = h.tableWidth({ C: 620, A: 652, M: 320, W: 1690, cols: [160, 760, 770], P: P });
  assert('3d: a 700px pane gives the prose table A = 652, never wider', narrow.width === 652, narrow);
  assert('the prose threshold is 22em of the table font', /var TABLE_PROSE_EM = 22;/.test(APP) && /var TABLE_BLEED = 80;/.test(APP));
})();

console.log('\nUXF-01 · sizeTables on a fake DOM\n');
(function () {
  var h = harness();
  var pr = wrapEl(320, 1128, 1690, [160, 760, 770]);
  h.sizeTables(rootOf([pr]));
  assert('a prose table is written --tv-tbl-w: 800px', pr.props['--tv-tbl-w'] === '800px', pr.props);
  assert('measuring styles are cleared afterwards', pr.table.style.width === '' && pr.table.style.minWidth === '');
  var sets = pr.table.sets, before = h.passes();
  h.sizeTables(rootOf([pr]));
  assert('an unchanged width is not written again (the observer settles)', pr.table.sets === sets && h.passes() === before + 1);
})();

console.log('\nUXF-01 · wide tables (M > A) on a fake DOM\n');
(function () {
  var h = harness();
  var fits = wrapEl(640, 1162), grows = wrapEl(900, 1162), wide = wrapEl(3000, 1162);
  h.sizeTables(rootOf([fits, grows, wide]));
  assert('tier 1 table is not marked', !fits.classList.contains('tbl-wide') && fits.getAttribute('data-edge') === null);
  assert('tier 2 table is not marked', !grows.classList.contains('tbl-wide'));
  assert('tier 3 table gets .tbl-wide', wide.classList.contains('tbl-wide'));
  assert('…and data-edge="start" at rest', wide.getAttribute('data-edge') === 'start');
  wide.scrollLeft = 400; h.syncTableEdge(wide);
  assert('data-edge="mid" after scrolling a little', wide.getAttribute('data-edge') === 'mid');
  wide.scrollLeft = 3000 - 1162; h.syncTableEdge(wide);
  assert('data-edge="end" at the far edge', wide.getAttribute('data-edge') === 'end');
  wide.clientWidth = 3200; wide.sc.clientWidth = 3248; wide.scrollLeft = 0;
  h.sizeTables(rootOf([wide]));
  assert('a wider pane clears .tbl-wide and data-edge', !wide.classList.contains('tbl-wide') && wide.getAttribute('data-edge') === null);
  var edge = wrapEl(1163, 1162);
  h.sizeTables(rootOf([edge]));
  assert('a 1px overflow is tolerated (> clientWidth + 1)', !edge.classList.contains('tbl-wide'));
})();

console.log('\nUXF-01 print · the screen classification survives print layout\n');
(function () {
  var h = harness();
  var wide = wrapEl(3000, 1162);
  h.sizeTables(rootOf([wide]));
  // Print layout: the page is narrow and the table now "fits" its print box.
  var printMedia = false;
  h.window.matchMedia = function (q) { return { matches: q === 'print' && printMedia }; };
  printMedia = true;
  wide.clientWidth = 3200; wide.sc.clientWidth = 3248;
  h.sizeTables(rootOf([wide]));
  assert('under print media a re-measure does not strip .tbl-wide (keeps the .72em print rule)', wide.classList.contains('tbl-wide'));
  printMedia = false;
  h.setPrinting(true);
  h.sizeTables(rootOf([wide]));
  assert('between beforeprint and afterprint it does not strip it either', wide.classList.contains('tbl-wide'));
  h.setPrinting(false);
  h.sizeTables(rootOf([wide]));
  assert('back on screen the table is re-measured normally', !wide.classList.contains('tbl-wide'));
  assert('beforeprint / afterprint are wired, and afterprint re-measures',
    /addEventListener\('beforeprint', function \(\) \{ _printing = true; \}\)/.test(APP) &&
    /addEventListener\('afterprint', function \(\) \{ _printing = false; scheduleWideTables\(\); \}\)/.test(APP));
})();

console.log('\nUXF-01 · setupWideTables observes the new DOM\n');
(function () {
  var h = harness();
  var a = wrapEl(3000, 900), b = wrapEl(500, 900);
  h.setupWideTables(rootOf([a, b]));
  assert('one ResizeObserver watches .tv-scroll and each top-level table',
    h.observed.length === 3 && h.observed[0].id === 'scroll' && h.observed.indexOf(a.table) !== -1 && h.observed.indexOf(b.table) !== -1, h.observed.length);
  assert('each wrapper gets a scroll listener for data-edge', a.listeners === 1 && b.listeners === 1);
  h.setupWideTables(rootOf([wrapEl(3000, 900)]));
  assert('a repaint drops the old observations (render replaced those elements)', h.observed.length === 2, h.observed.length);
  assert('the observer callback is coalesced through requestAnimationFrame',
    /_tableRaf = raf\(function \(\) \{\s*_tableRaf = null;\s*sizeTables\(document\);/.test(extractFn(APP, 'scheduleWideTables')));
  assert('⌘= (setFontSize) and the Appearance preview schedule a sizing pass',
    /scheduleWideTables\(\); \/\/ UXF-01/.test(extractFn(APP, 'setFontSize')) && /scheduleWideTables\(\);/.test(extractFn(APP, 'previewAppearance')));
})();

console.log('\nUXF-01 rule 8 · DR-10 live re-render keeps a wide table\'s offsets\n');
(function () {
  var h = harness();
  var before = [wrapEl(500, 900), wrapEl(3000, 900)];
  h.setupWideTables(rootOf(before)); h.setRendered('t1');
  before[1].scrollLeft = 640; before[1].scrollTop = 120;
  h.captureTableScroll(rootOf(before));
  var after = [wrapEl(500, 900), wrapEl(3000, 900)];
  h.setupWideTables(rootOf(after));
  assert('scrollLeft and scrollTop are restored by table index', after[1].scrollLeft === 640 && after[1].scrollTop === 120, after[1]);
  assert('…and data-edge follows the restored offset', after[1].getAttribute('data-edge') === 'mid');
  assert('a table that was not scrolled is left alone', after[0].scrollLeft === 0);

  h.setRendered('t1');
  after[1].scrollLeft = 300;
  h.captureTableScroll(rootOf(after));
  h.state.activeId = 't2';
  var other = [wrapEl(500, 900), wrapEl(3000, 900)];
  h.setupWideTables(rootOf(other));
  assert('offsets never leak onto another tab\'s tables', other[1].scrollLeft === 0);

  // Switching back to t1 (render again with t1 active) restores t1's offset.
  h.setRendered('t2');
  h.captureTableScroll(rootOf(other));
  h.state.activeId = 't1';
  var back = [wrapEl(500, 900), wrapEl(3000, 900)];
  h.setupWideTables(rootOf(back));
  assert('switching tabs away and back restores the wide table offset', back[1].scrollLeft === 300, back[1].scrollLeft);

  // Scrolling back to 0 is remembered too (no stale offset comes back).
  h.setRendered('t1');
  back[1].scrollLeft = 0;
  h.captureTableScroll(rootOf(back));
  var again = [wrapEl(500, 900), wrapEl(3000, 900)];
  h.setupWideTables(rootOf(again));
  assert('a table scrolled back to its start stays at its start', again[1].scrollLeft === 0);

  // A closed tab's offsets are dropped.
  h.state.tabs = [{ id: 't1' }];
  h.setupWideTables(rootOf([wrapEl(3000, 900)]));
  assert('offsets of closed tabs are pruned', h.tableScrollKeys().join() === 't1', h.tableScrollKeys());
})();

console.log('\nFix round 3 · DR-03: no scroll drift from table sizing\n');
(function () {
  // A WebKit-like engine: a measuring layout (tables at min-content) moves the
  // reader's offset. sizeTables must put it back.
  var h = harness();
  var pr = wrapEl(320, 1128, 1690, [160, 760, 770]);
  pr.sc.scrollTop = 4558;
  pr.onMeasure = function () { pr.sc.scrollTop = 14759; };
  h.sizeTables(rootOf([pr]));
  assert('sizeTables holds the reader\'s offset across its measuring layouts', pr.sc.scrollTop === 4558, pr.sc.scrollTop);

  // render(): sizing changes the document height. If the offset were restored
  // BEFORE sizing, scroll anchoring would carry it +1,204px on every repaint.
  var sb = { state: { activeId: 't1' }, log: [], _renderedTabId: null };
  sb.setupWideTables = function () { sb.log.push('size'); if (sb.scroller.scrollTop > 0) sb.scroller.scrollTop += 1204; };
  sb.scroller = { scrollTop: 0 };
  sb.root = { querySelector: function (s) { return s === '[data-scroll]' ? sb.scroller : null; } };
  vm.runInContext('var _renderedTabId = null;\n' + extractFn(APP, 'settleDocumentLayout'), vm.createContext(sb));
  var tab = { id: 't1', scrollTop: 5381 };
  for (var i = 0; i < 5; i++) { sb.scroller.scrollTop = 0; sb.settleDocumentLayout(sb.root, tab); tab.scrollTop = sb.scroller.scrollTop; }
  assert('five repaints (tab back, theme, ⌘B, live update) leave the offset where it was', tab.scrollTop === 5381, tab.scrollTop);
  var renderFn = extractFn(APP, 'render');
  assert('render() restores the content offset only through settleDocumentLayout (tables first)',
    /var newScroll = settleDocumentLayout\(root, activeTab\);/.test(renderFn) && !/newScroll\.scrollTop = activeTab\.scrollTop/.test(renderFn));
})();

console.log('\nFix round 3 · find highlights do not re-size a table\n');
(function () {
  var h = harness();
  var t = wrapEl(700, 1128, 1062, [100, 100, 100, 100, 100, 100, 100, 100, 100, 162]);
  h.sizeTables(rootOf([t]));
  var n = t.table.measured;
  t.table.marks = true;
  h.sizeTables(rootOf([t]));
  assert('a table holding find marks keeps its width (not re-measured)', t.table.measured === n && t.props['--tv-tbl-w'] === '1064px', t.table.measured);
  t.sc.clientWidth = 900;
  h.sizeTables(rootOf([t]));
  assert('…unless the pane changed', t.table.measured === n + 1);
  t.table.marks = false;
  var m = t.table.measured;
  h.sizeTables(rootOf([t]));
  assert('the observer\'s echo (same pane, font and box) is not re-measured', t.table.measured === m);
})();

console.log('\nWiring in render()\n');
var renderFn = extractFn(APP, 'render');
assert('render captures table offsets before the innerHTML swap',
  renderFn.indexOf('captureTableScroll(root)') !== -1 && renderFn.indexOf('captureTableScroll(root)') < renderFn.indexOf('root.innerHTML ='));
assert('render sizes tables after the swap, before paint (via settleDocumentLayout)',
  renderFn.indexOf('settleDocumentLayout(root, activeTab)') > renderFn.indexOf('root.innerHTML =') &&
  /setupWideTables\(root\);/.test(extractFn(APP, 'settleDocumentLayout')));
assert('render records which tab the DOM now shows', /_renderedTabId = activeTab \? activeTab\.id : null;/.test(extractFn(APP, 'settleDocumentLayout')));

console.log('\n' + (fail === 0 ? 'ALL PASSED' : 'FAILURES: ' + fail) + ' (' + pass + ' passed, ' + fail + ' failed)\n');
if (fail > 0) process.exit(1);
