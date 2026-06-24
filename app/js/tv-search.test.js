/* ───────────────────────────────────────────────────────────
   ISS-002 self-tests — compact Cmd+F find bar
   Run: node app/js/tv-search.test.js

   Tests:
   #1  Height guard — .tv-searchbar vertical padding ≤8px and the inner
       .field height ≤28px (regression guard against the old ~59px bar)
   #2  Single-row chrome — .tv-searchbar is a flex row holding exactly one
       .field + one .scope; results never re-inject the bar
   #3  Narrow-width safety — .scope truncates (ellipsis) while the input
       keeps min-width:0 so it shrinks first (no overflow/clipping)
   #4  Render states — zero-result and with-result both render correctly
       (real _renderResults / _runSearch executed), bar stays single-row
   ─────────────────────────────────────────────────────────── */
'use strict';

var fs = require('fs');

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

var css = fs.readFileSync(__dirname + '/../css/tv-app.css', 'utf8');

/* Grab the body of a single CSS rule by its exact selector. */
function ruleBlock(selector) {
  var esc = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  var m = css.match(new RegExp(esc + '\\s*\\{([^}]*)\\}'));
  return m ? m[1] : null;
}

/* First px magnitude declared for a property within a rule body. */
function pxOf(block, prop) {
  if (!block) return null;
  var m = block.match(new RegExp(prop + ':\\s*([0-9.]+)px'));
  return m ? parseFloat(m[1]) : null;
}

/* ═══════════════════════════════════════════════════════════
   TEST #1 — compact height guard
   ═══════════════════════════════════════════════════════════ */
console.log('\n#1 ISS-002: compact bar — padding ≤8px, .field height ≤28px\n');

(function () {
  var bar = ruleBlock('.tv-searchbar');
  assert('.tv-searchbar rule found', !!bar);

  // padding shorthand: first value is the vertical (top/bottom) padding.
  var vpad = pxOf(bar, 'padding');
  assert(
    '.tv-searchbar vertical padding ≤ 8px',
    vpad !== null && vpad <= 8,
    'got: ' + vpad + 'px'
  );

  var field = ruleBlock('.tv-searchbar .field');
  assert('.tv-searchbar .field rule found', !!field);

  var h = pxOf(field, 'height');
  assert(
    '.tv-searchbar .field height ≤ 28px (was 34px)',
    h !== null && h <= 28,
    'got: ' + h + 'px'
  );

  // Combined chrome height stays well under the old ~59px control.
  var chrome = (vpad || 0) * 2 + (h || 0) + 1 /* border-bottom */;
  assert(
    'total bar chrome significantly reduced (< 45px, was ~59px)',
    chrome < 45,
    'computed chrome: ' + chrome + 'px'
  );
})();

/* ═══════════════════════════════════════════════════════════
   TEST #2 — single-row chrome
   ═══════════════════════════════════════════════════════════ */
console.log('\n#2 ISS-002: bar is a single flex row (field + scope)\n');

(function () {
  var bar = ruleBlock('.tv-searchbar');
  assert(
    '.tv-searchbar lays out as a flex row',
    /display:\s*flex/.test(bar) && /align-items:\s*center/.test(bar),
    'block: ' + bar
  );

  var searchSrc = fs.readFileSync(__dirname + '/tv-search.js', 'utf8');

  // The open() bar template must be one .tv-searchbar holding one .field + one
  // .scope — a single conventional row, not a stacked/nested pill.
  var nBar   = (searchSrc.match(/class="tv-searchbar"/g)   || []).length;
  var nField = (searchSrc.match(/class="field"/g)          || []).length;
  var nScope = (searchSrc.match(/class="scope"/g)          || []).length;
  assert('exactly one .tv-searchbar in markup', nBar === 1, 'count: ' + nBar);
  assert('exactly one .field in the bar',       nField === 1, 'count: ' + nField);
  assert('exactly one .scope in the bar',       nScope === 1, 'count: ' + nScope);
})();

/* ═══════════════════════════════════════════════════════════
   TEST #3 — narrow-width safety
   ═══════════════════════════════════════════════════════════ */
console.log('\n#3 ISS-002: narrow-width guard — scope ellipsises, input shrinks first\n');

(function () {
  var scope = ruleBlock('.tv-searchbar .scope');
  assert('.tv-searchbar .scope rule found', !!scope);
  assert(
    '.scope truncates with ellipsis at narrow widths',
    /white-space:\s*nowrap/.test(scope) && /text-overflow:\s*ellipsis/.test(scope),
    'block: ' + scope
  );
  assert(
    '.scope can shrink (flex: 0 1 auto + min-width: 0)',
    /flex:\s*0\s+1\s+auto/.test(scope) && /min-width:\s*0/.test(scope),
    'block: ' + scope
  );

  var field = ruleBlock('.tv-searchbar .field');
  assert(
    '.field has min-width: 0 so the input shrinks before overflowing',
    /min-width:\s*0/.test(field),
    'block: ' + field
  );

  // The real input keeps min-width:0 too (combined selector rule).
  assert(
    '.tv-search-field input keeps min-width: 0',
    /\.tv-search-field[\s\S]*?\{[^}]*min-width:\s*0/.test(css) ||
      /\.tv-searchbar \.field input[\s\S]*?\{[^}]*min-width:\s*0/.test(css),
    'min-width:0 not found on the search input'
  );
})();

/* ═══════════════════════════════════════════════════════════
   TEST #4 — zero-result and with-result render states
   ═══════════════════════════════════════════════════════════ */
console.log('\n#4 ISS-002: zero-result + with-result render correctly (real fns)\n');

(function () {
  // Load the real tv-search.js IIFE and expose its private render/search fns.
  var searchSrc = fs.readFileSync(__dirname + '/tv-search.js', 'utf8');
  var marker = 'window.TVSearch = TVSearch;';
  assert('tv-search.js export marker present', searchSrc.indexOf(marker) !== -1);

  var instrumented = searchSrc.replace(
    marker,
    marker +
      '\n  globalThis.__TVSEARCH_TEST__ = { renderResults: _renderResults, runSearch: _runSearch };'
  );

  // Minimal environment — _renderResults/_runSearch only touch window.* at call
  // time (no DOM needed; open()/close() are not exercised here).
  var window = { TV_ICONS: {} }; // eslint-disable-line no-unused-vars
  eval(instrumented); // eslint-disable-line no-eval
  var api = globalThis.__TVSEARCH_TEST__;
  assert('private render/search fns exposed', api && typeof api.renderResults === 'function');

  window.TV = {
    state: {
      tabs: [
        { id: 't1', name: 'alpha.md', source: 'hello alpha world\nsecond line' },
        { id: 't2', name: 'beta.md',  source: 'nothing to see here' },
      ],
    },
  };

  // — empty query → "type to search" hint (single hint line, no rows)
  var hEmpty = api.renderResults('', { totalMatches: 0, fileCount: 0, files: [] });
  assert(
    'empty query renders the type-to-search hint',
    /tv-sr-count--hint/.test(hEmpty) && hEmpty.indexOf('tv-sr-row') === -1,
    hEmpty
  );

  // — zero-result: real search finds nothing → "No results" hint, no rows
  var r0 = api.runSearch('zzzzz-no-match');
  assert('zero-result search reports 0 matches', r0.totalMatches === 0, JSON.stringify(r0));
  var h0 = api.renderResults('zzzzz-no-match', r0);
  assert(
    'zero-result renders the "No results" hint as a single line',
    /tv-sr-count--hint/.test(h0) && /No results/.test(h0) && h0.indexOf('tv-sr-row') === -1,
    h0
  );

  // — with-result: real search finds the hit → count + at least one row + mark
  var r1 = api.runSearch('alpha');
  assert('with-result search reports matches', r1.totalMatches >= 1 && r1.fileCount >= 1, JSON.stringify(r1.totalMatches));
  var h1 = api.renderResults('alpha', r1);
  assert(
    'with-result renders a count, a row, and a highlight',
    /tv-sr-count(?!--hint)/.test(h1) &&
      h1.indexOf('tv-sr-row') !== -1 &&
      /<mark>alpha<\/mark>/.test(h1),
    h1.slice(0, 240)
  );

  // — the bar is built once in open(); neither result state re-injects it, so
  //   the single-row .tv-searchbar holds in both zero- and with-result states.
  assert(
    'results rendering never re-injects the search bar (bar stays single-row)',
    h0.indexOf('tv-searchbar') === -1 && h1.indexOf('tv-searchbar') === -1,
    'render output unexpectedly contains .tv-searchbar'
  );
})();

/* ═══════════════════════════════════════════════════════════
   REPORT
   ═══════════════════════════════════════════════════════════ */
console.log('\n' + (fail === 0 ? 'ALL PASSED' : 'FAILURES: ' + fail) +
  ' (' + pass + ' passed, ' + fail + ' failed)\n');

if (fail > 0) process.exit(1);
