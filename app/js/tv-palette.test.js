/* ───────────────────────────────────────────────────────────
   Galley · command palette test harness (C-08 fuzzy matching,
   C-09 command coverage/caps, C-10 overflow flag)
   Run: node app/js/tv-palette.test.js

   Loads the real tv-palette.js IIFE via `vm` (mirrors
   tv-live.runtime.test.js) and drives its private matcher/builder
   functions through the TVPalette._internals test seam the module
   already exposes. No DOM is needed for these assertions — the
   internals under test (scoreText, buildList, buildCommandRows,
   parseHeadings, headingsFor, rankRows) only touch window.TV.* at
   call time.
   ─────────────────────────────────────────────────────────── */
'use strict';

var fs = require('fs');
var path = require('path');
var vm = require('vm');

var pass = 0, fail = 0;
function assert(label, condition, detail) {
  if (condition) {
    console.log('  PASS  ' + label);
    pass++;
  } else {
    console.error('  FAIL  ' + label + (detail ? ' — ' + detail : ''));
    fail++;
  }
}

var PALETTE_SRC = fs.readFileSync(path.join(__dirname, 'tv-palette.js'), 'utf8');

// Minimal window — no document needed since we never call open()/close()
// (those build real DOM overlays); we only exercise the pure builder fns.
function loadPalette(tvOverrides) {
  var sandbox = {
    window: Object.assign({ TV_ICONS: {} }, tvOverrides ? { TV: tvOverrides } : {}),
    console: console,
  };
  sandbox.global = sandbox;
  var context = vm.createContext(sandbox);
  vm.runInContext(PALETTE_SRC, context, { filename: 'tv-palette.js' });
  return sandbox.window.TVPalette;
}

/* ═══════════════════════════════════════════════════════════
   SANITY
   ═══════════════════════════════════════════════════════════ */
(function sanity() {
  var TVPalette = loadPalette();
  assert('tv-palette.js loads and exports window.TVPalette',
    !!TVPalette, !!TVPalette);
  assert('exports open/close/isOpen/openOutline',
    ['open', 'close', 'isOpen', 'openOutline'].every(function (k) { return typeof TVPalette[k] === 'function'; }));
  assert('_internals test seam is present',
    !!TVPalette._internals && typeof TVPalette._internals.scoreText === 'function');
})();

/* ═══════════════════════════════════════════════════════════
   C-08 — fuzzy matching: the cluster's own acceptance examples.
   "shma", "shcema" (transposed) and "ao" must find schema.md / ai-output.md
   — a plain indexOf() substring matcher fails all three.
   ═══════════════════════════════════════════════════════════ */
(function testFuzzyAcceptance() {
  var TVPalette = loadPalette();
  var scoreText = TVPalette._internals.scoreText;

  var r1 = scoreText('shma', 'schema.md');
  assert('C-08: "shma" subsequence-matches "schema.md"', !!r1, r1);

  var r2 = scoreText('shcema', 'schema.md');
  assert('C-08: "shcema" (transposed) still matches "schema.md" (typo tolerance)', !!r2, r2);

  var r3 = scoreText('ao', 'ai-output.md');
  assert('C-08: "ao" subsequence-matches "ai-output.md"', !!r3, r3);

  // A substring-only matcher (the old behaviour) would reject all three —
  // guard that we did not regress back to indexOf().
  var noMatch = scoreText('xyz-nonexistent', 'schema.md');
  assert('C-08: a query with no valid subsequence still correctly fails', noMatch === null, noMatch);
})();

/* ═══════════════════════════════════════════════════════════
   C-08 — ranking: a tighter/earlier match outranks a looser one, and
   buildList surfaces the right file while excluding an unrelated one.
   ═══════════════════════════════════════════════════════════ */
(function testRankingAndBuildList() {
  var TVPalette = loadPalette({
    state: { tabs: [], activeId: null, mode: 'reading', fontSize: 16 },
    getActiveTab: function () { return null; },
  });
  var buildList = TVPalette._internals.buildList;

  var tabs = [
    { id: 't1', name: 'schema.md', path: '/proj/schema.md', source: '' },
    { id: 't2', name: 'unrelated-notes.md', path: '/proj/unrelated-notes.md', source: '' },
  ];
  var html = buildList('shma', tabs, 't1');
  assert('C-08: buildList finds schema.md for a fuzzy query',
    html.indexOf('data-tab-id="t1"') !== -1, html);
  assert('C-08: buildList does NOT match an unrelated file for the same query',
    html.indexOf('data-tab-id="t2"') === -1, html);
  assert('C-08: matched characters are wrapped for highlighting (<span class="hl">)',
    html.indexOf('class="hl"') !== -1, html);
})();

/* ═══════════════════════════════════════════════════════════
   C-09 — command coverage: rows exist for the app's own commands with
   right-aligned accelerator chips, sourced from the SAME entry points the
   keyboard router uses (handleSave / openFindBar via window.TV).
   ═══════════════════════════════════════════════════════════ */
(function testCommandCoverage() {
  var TVPalette = loadPalette({
    state: { tabs: [], activeId: null, mode: 'reading', fontSize: 18 },
    isMermaidEnabled: function () { return true; },
  });
  var buildCommandRows = TVPalette._internals.buildCommandRows;
  var rows = buildCommandRows('');

  function findRow(main) {
    return rows.filter(function (r) { return r.main === main; })[0];
  }

  var expectations = [
    ['Toggle Sidebar', '⌘B'],
    ['New Tab', '⌘T'],
    ['Close Tab', '⌘W'],
    ['Save', '⌘S'],
    ['Find in Document', '⌘F'],
    ['Search All Tabs', '⌘⇧F'],
  ];
  expectations.forEach(function (pair) {
    var row = findRow(pair[0]);
    assert('C-09: command row "' + pair[0] + '" exists with kbd "' + pair[1] + '"',
      !!row && row.kbd === pair[1], row);
  });

  // Native-only rows (Reveal in Finder / Copy Path) are absent without
  // window.__TAURI__ — verified separately below.
  assert('C-09: "Reveal in Finder" is hidden outside the native shell',
    !findRow('Reveal in Finder'));

  // DR-31 zero-pixel chrome budget: the size readout lives in the row text,
  // not a new on-screen indicator.
  var incRow = findRow('Increase text size · 18 px');
  assert('C-09: font-size rows show the CURRENT size (TV.state.fontSize)', !!incRow, rows.map(function(r){return r.main;}));
})();

/* ═══════════════════════════════════════════════════════════
   C-09 — heading regex must stay #{1,6} (h4–h6 included), the exact
   regression tv-round5.test.js also guards from the source-string side.
   ═══════════════════════════════════════════════════════════ */
(function testHeadingDepth() {
  var TVPalette = loadPalette();
  var parseHeadings = TVPalette._internals.parseHeadings;
  var out = parseHeadings('# H1\n## H2\n###### H6\n##### H5\n');
  assert('C-09: parseHeadings captures h1..h6 (not capped at h3)',
    out.length === 4 && out[2].level === 6 && out[3].level === 5,
    JSON.stringify(out));
})();

/* ═══════════════════════════════════════════════════════════
   C-09 — caps: 50 files / 100 headings-per-tab, and memoised heading
   parsing (same tab.source identity → same cached array).
   ═══════════════════════════════════════════════════════════ */
(function testCapsAndMemoisation() {
  var TVPalette = loadPalette();
  assert('C-09: file cap is 50', TVPalette._internals.caps.files === 50, TVPalette._internals.caps.files);
  assert('C-09: heading-per-tab cap is 100', TVPalette._internals.caps.headings === 100, TVPalette._internals.caps.headings);

  // headingsFor caches per-tab keyed on tab.source IDENTITY.
  var src = '# One\n## Two\n';
  var tab = { id: 'tX', source: src };
  var first = TVPalette._internals.headingsFor(tab);
  var second = TVPalette._internals.headingsFor(tab); // same object, same source
  assert('C-09: headingsFor returns the SAME cached array when tab.source is unchanged',
    first === second, [first, second]);

  tab.source = src + '### Three\n'; // new string identity → cache must invalidate
  var third = TVPalette._internals.headingsFor(tab);
  assert('C-09: headingsFor re-parses when tab.source identity changes',
    third !== first && third.length === 3, third);

  // Per-tab heading cap: a tab with > 100 headings is truncated to 100.
  var manyLines = [];
  for (var i = 0; i < 150; i++) manyLines.push('# H' + i);
  var bigTab = { id: 'tBig', source: manyLines.join('\n') };
  var capped = TVPalette._internals.headingsFor(bigTab);
  assert('C-09: a tab with 150 headings is capped to 100', capped.length === 100, capped.length);
})();

/* ═══════════════════════════════════════════════════════════
   P1-4 — render caps: an empty query (which matches everything) must not
   flood the visible list. The 100/50 caps above bound the PARSE-time
   candidate pool; these are the separate, smaller caps that actually gate
   what gets rendered, so Commands stays reachable near the top of the list.
   ═══════════════════════════════════════════════════════════ */
(function testRenderCaps() {
  var TVPalette = loadPalette({
    state: { tabs: [], activeId: null, mode: 'reading', fontSize: 16 },
    getActiveTab: function () { return null; },
  });
  var buildList = TVPalette._internals.buildList;
  assert('P1-4: heading render cap is 8', TVPalette._internals.caps.headingsRender === 8,
    TVPalette._internals.caps.headingsRender);
  assert('P1-4: file render cap is 6', TVPalette._internals.caps.filesRender === 6,
    TVPalette._internals.caps.filesRender);

  // 10 tabs x 40 headings each = 400 candidate headings and 10 candidate
  // files; an empty query matches everything (by design), so both groups
  // need their own render cap independent of how many tabs are open.
  var headingSrc = [];
  for (var i = 0; i < 40; i++) headingSrc.push('# Heading ' + i);
  headingSrc = headingSrc.join('\n');
  var manyTabs = [];
  for (var t = 0; t < 10; t++) {
    manyTabs.push({ id: 'tab' + t, name: 'doc' + t + '.md', path: '/proj/doc' + t + '.md', source: headingSrc });
  }
  var html = buildList('', manyTabs, 'tab0');
  var headingRowCount = (html.match(/action="heading"/g) || []).length;
  // Isolate the "Open File" group specifically — "Recent" also uses
  // action="activate" and would otherwise inflate the count.
  var openFileSection = html.split('>Open File<')[1] || '';
  openFileSection = openFileSection.split('tv-pal-group')[0];
  var fileRowCount = (openFileSection.match(/action="activate"/g) || []).length;
  assert('P1-4: an empty query renders at most 8 heading rows, not the full 400-candidate pool',
    headingRowCount <= 8, headingRowCount);
  assert('P1-4: an empty query renders at most 6 rows in Open File, not all 10 open tabs',
    fileRowCount <= 6 && fileRowCount > 0, fileRowCount);
})();

/* ═══════════════════════════════════════════════════════════
   P2-4 — _headCache must not retain a closed tab's source text forever.
   closeTab() does not always emit 'tabchange' (a background-tab close, or
   even the active one — closeTab sets state.activeId directly), so pruning
   is driven off the current state.tabs list instead of that one event.
   ═══════════════════════════════════════════════════════════ */
(function testHeadCachePruning() {
  var tabA = { id: 'tA', source: '# A\n' };
  var tabB = { id: 'tB', source: '# B\n' };
  var tv = { state: { tabs: [tabA, tabB], activeId: 'tA', mode: 'reading', fontSize: 16 },
             getActiveTab: function () { return tabA; } };
  var TVPalette = loadPalette(tv);
  var headingsFor = TVPalette._internals.headingsFor;
  var headCache = TVPalette._internals.headCache;
  var pruneHeadCache = TVPalette._internals.pruneHeadCache;

  headingsFor(tabA);
  headingsFor(tabB);
  assert('P2-4: both open tabs are cached', headCache.tA && headCache.tB,
    Object.keys(headCache));

  // Tab B closes — removed from state.tabs, exactly like closeTab()/_doCloseTab().
  tv.state.tabs = [tabA];
  pruneHeadCache();
  assert('P2-4: the closed tab\'s cache entry is pruned', !headCache.tB, Object.keys(headCache));
  assert('P2-4: the still-open tab\'s cache entry survives', !!headCache.tA, Object.keys(headCache));
})();

/* ═══════════════════════════════════════════════════════════
   C-08/C-09 — ties keep the group's original order (stable sort).
   ═══════════════════════════════════════════════════════════ */
(function testStableRanking() {
  var TVPalette = loadPalette();
  var rankRows = TVPalette._internals.rankRows;
  var rows = [
    { id: 'a', score: 10 },
    { id: 'b', score: 10 },
    { id: 'c', score: 20 },
    { id: 'd', score: 10 },
  ];
  var ranked = rankRows(rows.slice());
  assert('C-08: highest score sorts first', ranked[0].id === 'c', JSON.stringify(ranked));
  assert('C-08: equal scores keep their original relative order (stable sort)',
    ranked[1].id === 'a' && ranked[2].id === 'b' && ranked[3].id === 'd',
    JSON.stringify(ranked));
})();

console.log('\n' + (fail === 0 ? 'ALL PASSED' : 'FAILURES: ' + fail) + ' (' + pass + ' passed, ' + fail + ' failed)\n');
if (fail > 0) process.exit(1);
