/* ───────────────────────────────────────────────────────────
   Shell polish-pass self-tests
   Run: node app/js/tv-shell-polish.test.js

   Covers the shell half of the 2026-08-21 production-polish pass.
   Two kinds of test, deliberately:

   (A) BEHAVIOUR — the pure helpers in tv-app.js are extracted from the
       real source by brace-matching and executed. These are real tests:
       they run the shipped code, not a copy of it. If someone changes the
       middle-truncation rule or the editor font ramp, these fail.

   (B) STRUCTURE — for the parts that need a DOM and a live app (the
       keyboard router, render(), the find bar), we assert the load-bearing
       source invariants instead, in the style of tv-round5.test.js. The
       end-to-end behaviour of those is covered by the headless Playwright
       scripts under scratchpad/scripts/impl-shell/.

   Clusters: C-03 C-05 C-06 C-14 C-16 C-17 C-18 C-19 C-20 C-27 C-28 C-29
             C-30 C-32 C-33 C-35 C-38 C-39 C-42
   ─────────────────────────────────────────────────────────── */
'use strict';

var fs = require('fs');
var path = require('path');

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

var APP = fs.readFileSync(path.join(__dirname, 'tv-app.js'), 'utf8');
var CSS = fs.readFileSync(path.join(__dirname, '..', 'css', 'tv-app.css'), 'utf8');

/* ── extract one top-level `function name(...) { ... }` from the source ──
   Brace-matched rather than regex-terminated, so a helper containing an
   object literal or a nested function still comes out whole. */
function extractFn(name) {
  var needle = 'function ' + name + '(';
  var start = APP.indexOf(needle);
  if (start === -1) throw new Error('function ' + name + ' not found in tv-app.js');
  var i = APP.indexOf('{', start);
  var depth = 0;
  for (var j = i; j < APP.length; j++) {
    var c = APP.charAt(j);
    if (c === '{') depth++;
    else if (c === '}') {
      depth--;
      if (depth === 0) return APP.slice(start, j + 1);
    }
  }
  throw new Error('unbalanced braces extracting ' + name);
}

/* ═══════════════════════════════════════════════════════════
   #1 — C-05: middle-truncating file labels
   ═══════════════════════════════════════════════════════════ */
console.log('\n#1 C-05: splitLabel keeps the distinguishing tail\n');

(function () {
  /* eslint-disable no-eval */
  var scope = {};
  eval(
    APP.match(/var LBL_TAIL_MAX[\s\S]*?var LBL_MIN_SPLIT = \d+;/)[0] + '\n' +
    extractFn('splitLabel') + '\n' +
    'scope.splitLabel = splitLabel;'
  );
  var splitLabel = scope.splitLabel;

  var long = splitLabel('document-with-a-fairly-long-name-12.md');
  assert('a long name splits into head + tail',
    long.head.length > 0 && long.tail.length > 0);
  assert('head + tail reconstruct the name exactly',
    long.head + long.tail === 'document-with-a-fairly-long-name-12.md',
    long.head + '|' + long.tail);
  assert('the tail carries the extension (the point of middle truncation)',
    /\.md$/.test(long.tail), long.tail);
  assert('the tail is 8-10 characters',
    long.tail.length >= 8 && long.tail.length <= 10, String(long.tail.length));

  // Twelve same-prefix files must be told apart by their tails alone.
  var tails = [];
  for (var i = 1; i <= 12; i++) {
    tails.push(splitLabel('document-with-a-fairly-long-name-' + i + '.md').tail);
  }
  var uniq = {};
  tails.forEach(function (t) { uniq[t] = true; });
  assert('12 same-prefix names produce 12 distinct tails',
    Object.keys(uniq).length === 12, tails.join(','));

  var short = splitLabel('a.md');
  assert('a short name is NOT split (no ellipsis machinery at all)',
    short.tail === '' && short.head === 'a.md');

  // The tail must never swallow the whole label.
  ['abcdefghijklm', 'readme.md', 'x'].forEach(function (n) {
    var r = splitLabel(n);
    assert('"' + n + '" keeps a non-empty head', r.head.length > 0,
      JSON.stringify(r));
    assert('"' + n + '" round-trips', r.head + r.tail === n);
  });

  assert('splitLabel tolerates null/undefined',
    splitLabel(null).head === '' && splitLabel(undefined).head === '');
})();

/* ═══════════════════════════════════════════════════════════
   #2 — C-20: the editor font scales with the reading font
   ═══════════════════════════════════════════════════════════ */
console.log('\n#2 C-20: editFontFor ramps 11-18 around 13px at body 16px\n');

(function () {
  var scope = {};
  eval(extractFn('editFontFor') + '\nscope.editFontFor = editFontFor;');
  var f = scope.editFontFor;

  assert('body 16px → editor 13px (unchanged default)', f(16) === 13, String(f(16)));
  assert('body 13px (DR-27 floor) → editor 11px (its own floor)', f(13) === 11, String(f(13)));
  assert('body 22px (DR-27 cap) → editor 18px (its own cap)', f(22) === 18, String(f(22)));
  assert('monotonic across the whole DR-27 range', (function () {
    for (var p = 13; p < 22; p++) if (f(p) > f(p + 1)) return false;
    return true;
  })());
  assert('never below 11 or above 18, even out of range',
    f(1) === 11 && f(999) === 18, f(1) + '/' + f(999));
})();

/* ═══════════════════════════════════════════════════════════
   #3 — C-30: folder headers disambiguate ONLY on collision
   ═══════════════════════════════════════════════════════════ */
console.log('\n#3 C-30: headerDupeSet flags only real basename collisions\n');

(function () {
  var scope = {};
  eval(extractFn('pathBasename') + '\n' + extractFn('headerDupeSet') +
       '\nscope.headerDupeSet = headerDupeSet;');
  var dupes = scope.headerDupeSet;

  var d = dupes(['/a/project-a/docs', '/a/project-b/docs', '/a/vault']);
  assert('two "docs" folders are flagged', d.docs === true);
  assert('a uniquely-named folder is NOT flagged', d.vault === undefined);

  assert('a single folder is never flagged',
    Object.keys(dupes(['/a/docs'])).length === 0);
  assert('an empty list is safe', Object.keys(dupes([])).length === 0);
  assert('undefined is safe', Object.keys(dupes(undefined)).length === 0);

  var three = dupes(['/a/docs', '/b/docs', '/c/docs']);
  assert('three collisions still flag the one basename', three.docs === true);
})();

/* ═══════════════════════════════════════════════════════════
   #4 — C-14: find keeps count and navigation in one array
   ═══════════════════════════════════════════════════════════ */
console.log('\n#4 C-14: lazy marking never desyncs the counter\n');

(function () {
  assert('_findMatches holds POSITIONS ({n,s}), not <mark> elements',
    /_findMatches\.push\(\{\s*n:\s*n,\s*s:\s*pos\s*\}\)/.test(APP),
    'the position-record push was not found');
  assert('_findStep still steps over the FULL match list',
    /_findIndex\s*=\s*\(_findIndex \+ dir \+ _findMatches\.length\) % _findMatches\.length/.test(APP));
  assert('the counter is rendered from _findMatches.length',
    APP.indexOf("(_findIndex + 1) + ' / ' + _findMatches.length") !== -1);
  assert('input is debounced', /_FIND_DEBOUNCE_MS\s*=\s*\d+/.test(APP) &&
    APP.indexOf('clearTimeout(_findDebounce)') !== -1);
  // P1-5: lowered from 2 to 1 — a single character (CJK, a lone symbol,
  // `]`/`}` in code) is a legitimate ⌘F query; _FIND_MARK_WINDOW already
  // bounds the marking cost regardless of how many matches it produces.
  assert('a query shorter than the minimum is not searched at all',
    /_FIND_MIN_QUERY\s*=\s*1/.test(APP) &&
    APP.indexOf('query.length < _FIND_MIN_QUERY') !== -1);
  assert('P1-5: an empty query is still rejected (the minimum is not 0)',
    /var _FIND_MIN_QUERY = 1;/.test(APP));
  assert('marking is windowed around the current match',
    /_FIND_MARK_WINDOW\s*=\s*\d+/.test(APP) && APP.indexOf('function _markWindow(') !== -1);
  assert('_markWindow snaps to node boundaries via _findNodeIdxs — a partially '
       + 'marked node is what left the CURRENT match unmarked',
    APP.indexOf('_findNodeIdxs[n]') !== -1);
  assert('_highlightFindMatch marks lazily before highlighting',
    /function _highlightFindMatch\(\)\s*\{\s*[\s\S]{0,400}?_markWindow\(_findIndex\)/.test(APP));
  assert('unmarking restores the ORIGINAL text and re-seeds the node map',
    APP.indexOf('_findNodes[n] = fresh') !== -1);
  assert('scroll-to-match respects prefers-reduced-motion',
    /prefers-reduced-motion: reduce[\s\S]{0,220}?behavior: reduce \? 'auto' : 'smooth'/.test(APP));
})();

/* ═══════════════════════════════════════════════════════════
   #5 — C-33: Esc discards, ⌘Z restores
   ═══════════════════════════════════════════════════════════ */
console.log('\n#5 C-33: Esc discards to savedSource with one undo\n');

(function () {
  assert('Esc in edit mode routes to discardEdits(), not setMode(reading)',
    /if \(state\.mode === 'edit'\) \{[\s\S]{0,260}?discardEdits\(\);/.test(APP));
  assert('the toolbar exit button uses the SAME path as Esc',
    /\[data-edit-esc\]'\)\) \{[\s\S]{0,180}?discardEdits\(\);/.test(APP));
  assert('makeTab seeds savedSource', /savedSource: opts\.source \|\| ''/.test(APP));
  assert('makeTab seeds the discard slot', /discarded: null/.test(APP));
  assert('discardEdits reverts the buffer to savedSource',
    APP.indexOf('tab.source = tab.savedSource;') !== -1);
  assert('discardEdits keeps ONE undo',
    /tab\.discarded = \{ source: tab\.source, at: Date\.now\(\) \}/.test(APP));
  assert('a clean tab is not "discarded" — Esc just leaves edit mode',
    /if \(!tab\.dirty \|\| tab\.savedSource == null \|\| tab\.source === tab\.savedSource\)/.test(APP));
  assert('⌘Z is only intercepted in reading mode with no text field focused',
    /state\.mode === 'reading'[\s\S]{0,400}?hasDiscardedEdits\(\)/.test(APP));
  assert('restoreDiscardedEdits re-enters edit mode dirty',
    /markDirty\(tab\.id, true\);\s*\n\s*setMode\('edit'\)/.test(APP));
  assert('saving drops the stale undo', /function _markSaved[\s\S]{0,200}?tab\.discarded = null/.test(APP));
  assert('savedSource is reconciled for non-edit writers (live watch, reload)',
    APP.indexOf('if (!_st.dirty && _st.savedSource !== _st.source) _st.savedSource = _st.source;') !== -1);
  assert('the exit label is patched on the render-free markDirty path',
    APP.indexOf('_syncEditEscLabel();') !== -1);
  assert('the discard toast has no dash', (function () {
    var m = APP.match(/showToast\('Edits discarded[^']*'\)/);
    return !!m && !/[—–]/.test(m[0]);
  })());
  assert('TV exposes the restore command for the palette',
    /restoreDiscardedEdits: restoreDiscardedEdits/.test(APP) &&
    /hasDiscardedEdits: hasDiscardedEdits/.test(APP));
})();

/* ═══════════════════════════════════════════════════════════
   #6 — C-03: a save that did not write must not signal "saved"
   ═══════════════════════════════════════════════════════════ */
console.log('\n#6 C-03: save failure keeps you in edit mode\n');

(function () {
  assert('the browser branch no longer calls setMode(reading) unconditionally',
    // F-23: a never-saved file has no dirty flag to witness, so it earns "saved"
    // by the write promise resolving (a cancelled picker rejects instead).
    /TVFiles\.writeFile\(tab\)\.then\(function \(\) \{[\s\S]{0,900}?if \(creating \|\| !tab\.dirty\)/.test(APP));
  assert('a resolved-but-still-dirty save is reported as a failure',
    APP.indexOf('_saveDidNotLand(tab, null)') !== -1);
  assert('a rejected save is reported too',
    /\.catch\(function \(err\) \{\s*\n\s*_saveDidNotLand\(tab, err\);/.test(APP));
  assert('a user cancel is quiet, a real failure is an error toast',
    /aborted\s*\n?\s*\?\s*'Save cancelled'/.test(APP) &&
    /aborted \? \{\} : \{ kind: 'error' \}/.test(APP));
  assert('_saveDidNotLand never leaves edit mode',
    // strip line comments first — the function documents the absence in prose
    extractFn('_saveDidNotLand')
      .replace(/\/\/[^\n]*/g, '')
      .indexOf("setMode('reading')") === -1);
  assert('setMode blocks entering edit on an error tab (edit direction only)',
    /if \(m === 'edit'\) \{[\s\S]{0,700}?if \(t && t\.error\) return;/.test(APP));
})();

/* ═══════════════════════════════════════════════════════════
   #7 — C-18: the shortcuts overlay
   ═══════════════════════════════════════════════════════════ */
console.log('\n#7 C-18: overlay lists ⌘P and ⌘G, ignores bare modifiers\n');

(function () {
  var block = APP.slice(APP.indexOf('var SHORTCUTS = ['));
  block = block.slice(0, block.indexOf('];') + 2);
  var rows = block.split('{ keys:').length - 1;

  assert('the overlay lists ⌘P Print / Export PDF',
    block.indexOf("action: 'Print / Export PDF'") !== -1);
  assert('the overlay lists ⌘G / ⇧⌘G Find next / previous',
    block.indexOf("action: 'Find next / previous'") !== -1);
  // F-23 added ⌘N New file (20 rows); UXF-06 added ⇧⌘J Reveal in sidebar (21)
  // and raised the DR-17 cap to 22. Any further row needs another amendment.
  // UXF-10 added ⌘L Open path: 22 rows, exactly at the cap.
  assert('22 rows, within the amended DR-17 cap of 22',
    rows === 22 && rows <= 22, String(rows));
  assert('the two columns stay balanced (11 / 11)',
    Math.ceil(rows / 2) === 11 && rows - Math.ceil(rows / 2) === 11);
  assert('a bare modifier no longer dismisses the sheet',
    /_SC_BARE_MODIFIERS\[e\.key\]\) return;/.test(APP) &&
    /Shift: 1, Meta: 1, Alt: 1, Control: 1/.test(APP));
  assert('a non-modifier key still dismisses it (DR-18 preserved)',
    /_SC_BARE_MODIFIERS\[e\.key\]\) return;\s*\n\s*e\.preventDefault\(\);\s*\n\s*closeShortcuts\(\);/.test(APP));
  // Assert the DECLARATION, not where it lives: this started as an override in
  // the shell's appended block and css-polish has since folded it into the
  // original .tv-sc-keys rule, which is where it belongs.
  assert('the keycap column is right-aligned so caps sit beside their labels',
    /\.tv-sc-keys \{[^}]*justify-content:\s*flex-end/.test(CSS));
  assert('⌘G is bound in the router only while the find bar is open',
    /if \(k === 'g' \|\| k === 'G'\) \{\s*\n\s*if \(_findOpen\)/.test(APP));
})();

/* ═══════════════════════════════════════════════════════════
   #8 — C-38: window title follows the file and its dirty state
   ═══════════════════════════════════════════════════════════ */
console.log('\n#8 C-38: document.title is not a static string\n');

(function () {
  assert('document.title is written from _syncTitles',
    /function _syncTitles\(\)[\s\S]{0,300}?document\.title =/.test(APP));
  assert('the empty state falls back to "Galley"', /: 'Galley';/.test(APP));
  assert('a dirty tab appends " · Edited" (middle dot, no dash)',
    APP.indexOf("(t.dirty ? ' · Edited' : '') + ' · Galley'") !== -1);
  assert('the in-app title says Editing in edit mode, Edited when dirty',
    /return name \+ ' · Editing';/.test(APP) && /return name \+ ' · Edited';/.test(APP));
  assert('render() and markDirty() both refresh it',
    (APP.split('_syncTitles();').length - 1) >= 2);
})();

/* ═══════════════════════════════════════════════════════════
   #9 — C-06 / C-04: tab strip overflow
   ═══════════════════════════════════════════════════════════ */
console.log('\n#9 C-04/C-06: overflow state and the all-tabs list\n');

(function () {
  assert('the ⌄ control ships hidden and JS owns the toggle',
    /data-tab-overflow hidden/.test(APP) &&
    /moreBtn\.hidden = !over/.test(APP));
  assert('CSS never beats [hidden]',
    /\.tv-tab-overflow\[hidden\] \{ display: none !important; \}/.test(CSS));
  assert('data-scrolled marks a strip clipped on the LEFT',
    /scrollLeft > 0\) strip\.setAttribute\('data-scrolled', '1'\)/.test(APP));
  assert('data-scroll-end marks a strip with nothing left to the RIGHT',
    /scrollLeft \+ strip\.clientWidth >= strip\.scrollWidth - 1/.test(APP));
  assert('the state is refreshed on scroll AND after every render',
    (APP.split('updateTabStripScroll(').length - 1) >= 3);
  assert('the overflow list is torn down by render() (it lives inside .tv)',
    /if \(_tabOverflowEl\) closeTabOverflow\(\);/.test(APP));
  assert('the list is positioned via CSSOM, not a style="" attribute (CSP)',
    /menuEl\.style\.left = cx \+ 'px'/.test(APP));
})();

/* ═══════════════════════════════════════════════════════════
   #10 — C-16 / C-17 / C-19 / C-27: first-run and empty states
   ═══════════════════════════════════════════════════════════ */
console.log('\n#10 C-16/C-17/C-19/C-27: empty states\n');

(function () {
  assert('the empty state shares buildTitlebar() (so the theme toggle exists)',
    /function buildEmpty\(\) \{\s*\n\s*return \(\s*\n[\s\S]{0,400}?buildTitlebar\(\) \+/.test(APP));
  assert('the drop card teaches ⌘⇧O, ⌘K and ?',
    APP.indexOf('open a folder') !== -1 && APP.indexOf('shortcuts</span>') !== -1);
  assert('the empty state has no em/en dash', (function () {
    var i = APP.indexOf("'<span class=\"dz-title\">Drop .md files here</span>'");
    return i !== -1 && !/[—–]/.test(APP.slice(i, i + 900));
  })());
  assert('the trust line sits inside the card stack, not pinned to the window',
    /\.tv-empty-stack > \.tv-empty-hint \{[\s\S]{0,160}?position: static;/.test(CSS));
  assert('an empty sidebar explains itself and offers ⌘⇧O',
    APP.indexOf('No folder open') !== -1 && APP.indexOf('data-open-folder') !== -1);
  assert('the find box is hidden when there is no document to find in',
    /var findBox = !state\.tabs\.length \? '' :/.test(APP));
  assert('C-17: the responsive repaint is no longer gated on tabs.length',
    APP.indexOf('if (state.tabs.length) render();') === -1);
  assert('C-17: a resize defers rather than dismissing an open overlay',
    /if \(_overlayOpen\(\)\) \{[\s\S]{0,420}?setInterval/.test(APP));
  assert('C-19: the ⌘E hint is session-limited',
    /HINT_EDIT_SESSIONS = 5/.test(APP) && /_showEditHint\(\)/.test(APP) &&
    /tv-hint-edit-seen/.test(APP));
  assert('C-27: an empty file keeps the pencil and says how to start',
    APP.indexOf('This file is empty. ⌘E to start writing.') !== -1);
  assert('C-27: F-21\'s specified message survives as the prefix',
    APP.indexOf('This file is empty.') !== -1);
})();

/* ═══════════════════════════════════════════════════════════
   #11 — C-28 / C-29: folder tree footers
   ═══════════════════════════════════════════════════════════ */
console.log('\n#11 C-28/C-29: empty subfolders and the truncation footer\n');

(function () {
  assert('an expanded subfolder with no children gets the placeholder',
    /if \(!n\.collapsed\) \{[\s\S]{0,300}?treeEmptyRow\(n\.depth \+ 1\)/.test(APP));
  assert('the placeholder is depth-aware (css-polish\'s 24px was a depth-0 fallback)',
    /function treeEmptyRow\(depth\)[\s\S]{0,220}?data-tv-depth="' \+ depth/.test(APP));
  assert('the placeholder stays OUT of the keyboard cursor (no role=option)',
    extractFn('treeEmptyRow').indexOf('role="option"') === -1);
  assert('the dead "Some items not shown" footer is gone',
    APP.indexOf('Some items not shown') === -1);
  // UXF-02: the footer is now per folder (filesHidden), with an exact count.
  assert('it is replaced by a counted, clickable row',
    /'Show ' \+ n\.count \+ ' more '/.test(APP));
  assert('the row is keyboard-reachable (it IS interactive)',
    /treeActionRow\('more:' \+ n\.path/.test(APP) &&
    /sidebarItem\.indexOf\('more:'\) === 0/.test(APP));
  assert('it re-scans that folder uncapped', /loadIntoTree\(folderPath, \{ uncapped: true/.test(APP));
  assert('it grafts the folder in place rather than re-registering '
       + '(registerFolder would toast "already open" and move the cursor)',
    /TVTree\.graftNode\(tree, folderPath, scan\.root\)/.test(APP));
  assert('a folder closed mid-scan is not re-mounted',
    /if \(!tree \|\| !scan \|\| !scan\.root\) \{ render\(\); return false; \}/.test(APP));
  assert('failure surfaces a toast', /'Could not read ' \+ pathBasename\(folderPath\)/.test(APP));
})();

/* ═══════════════════════════════════════════════════════════
   #12 — C-32 / C-39 / C-42 / C-35
   ═══════════════════════════════════════════════════════════ */
console.log('\n#12 C-32/C-35/C-39/C-42: a11y, edit entry, errors, re-open\n');

(function () {
  assert('C-32: the tablist implements Arrow/Home/End',
    /k === 'ArrowRight'\) next = \(cur \+ 1\) % ids\.length/.test(APP) &&
    /k === 'Home'\) next = 0/.test(APP) && /k === 'End'\) next = ids\.length - 1/.test(APP));
  assert('C-32: Delete closes the focused tab',
    /k === 'Delete'\) \{[\s\S]{0,120}?closeTab\(ids\[cur\]\)/.test(APP));
  // P2-3: the ARIA APG lists Delete as the optional close key but does not
  // include Backspace, and clicking a tab pill focuses it in WebKit — a
  // stray Backspace used to close a clean (unconfirmed) focused tab.
  assert('P2-3: Backspace no longer closes the focused tab',
    !/k === 'Backspace'/.test(APP));
  assert('C-32: the close control is a real <button>',
    /'<button type="button" class="tv-close"'/.test(APP));
  assert('C-32: it stays OUT of the global Tab order',
    /class="tv-close"'[\s\S]{0,300}?tabindex="-1"/.test(APP));
  assert('C-32: its bezel is flattened (a bare <button> paints one)',
    /\.tv-tab button\.tv-close \{[\s\S]{0,200}?appearance: none;/.test(CSS));
  assert('C-32: sidebar option rows are named, so the ✕ is not read as filename',
    /aria-label="' \+ esc\(t\.name\) \+ '"/.test(APP));
  assert('C-32: the ✕ glyph is decorative', /<span aria-hidden="true">&#x2715;<\/span>/.test(APP));
  // P2-11: .tv-lbl-head/.tv-lbl-tail are inline-flex, which blockifies them —
  // the accname algorithm then inserts a space between block-level parts, so
  // the tab pill's content-derived accessible name could gain a stray space
  // mid-filename. An explicit aria-label on the tab wins over that.
  assert('P2-11: the tab pill (role="tab") carries an explicit aria-label',
    /role="tab"'[\s\S]{0,600}?aria-label="' \+ esc\(t\.name\) \+ '"/.test(APP));
  assert('C-32: one persistent live region exists at boot, outside #tv-root',
    /function ensureLiveRegion\(\)/.test(APP) &&
    /document\.body\.appendChild\(_liveRegion\)/.test(APP) &&
    /ensureLiveRegion\(\);/.test(APP));
  // P2-6: two independent aria-live regions (#tv-live-region and
  // #tv-toasts .tv-toast-live) could both fire on the same turn. Collapsed
  // to one — announce() always uses ensureLiveRegion(), and tv-native.js's
  // showToast() calls TV.announce() instead of owning a second region.
  assert('P2-6: announce() always uses the ONE shared live region',
    /function announce\(msg\) \{\s*\n\s*if \(!msg\) return;\s*\n\s*var host = ensureLiveRegion\(\);/.test(APP));
  assert('P2-6: announce is exported on window.TV so tv-native.js can call it',
    /announce: announce,/.test(APP));

  assert('C-35: ⌘E seeds an anchor only when a double-click did not',
    /if \(window\._tvEditAnchor \|\| window\._tvEditAnchorText\) return;/.test(APP));
  assert('C-35: the anchor is the topmost VISIBLE block',
    /if \(r\.bottom <= top \+ 1\) continue;/.test(APP));
  assert('C-35: entering from the top opens the source at the top',
    /function _restoreEditEntryScroll[\s\S]{0,700}?sc\.scrollTop = 0;/.test(APP));
  assert('C-35: no proportional guessing — exact or nothing',
    /ta\.selectionStart > 0\) return;/.test(APP));

  assert('C-39: the error card shows the last-known path',
    /class="tv-error-path"/.test(APP));
  assert('C-39: the path is kept off the printed page (U-15 privacy)',
    /@media print \{ \.tv-error-path \{ display: none !important; \} \}/.test(CSS));
  assert('C-39: the tab lead slot has ONE precedence rule: error > live > dirty',
    /if \(t\.error\) \{\s*\n\s*lead = '<span class="tv-tab-warn"/.test(APP));
  assert('C-39: the render-free dot update respects that precedence too',
    /if \(tab\.error\) return;/.test(APP));

  assert('C-42: a dedupe hit refreshes a CLEAN tab',
    /if \(opts\.source != null && opts\.source !== open\.source\)/.test(APP) &&
    /open\.source = opts\.source;/.test(APP));
  assert('C-42: a DIRTY tab is never overwritten, only reported',
    /Already open with unsaved changes/.test(APP));
  // P2-8: refreshing the tab that is both ACTIVE and in EDIT MODE used to
  // fight _doActivateTab's own edit-mode commit safety net — writing the
  // fresh bytes into open.source here, then activating the same tab,
  // makes _doActivateTab see editTextarea.value !== outgoing.source and
  // write the STALE textarea value straight back over the refresh,
  // incorrectly marking the tab dirty. Skip the refresh in that case,
  // same as an already-dirty tab, and say why.
  assert('P2-8: a dedupe hit on the active tab in edit mode is skipped, not silently reverted',
    /var editingThisTab = \(state\.mode === 'edit' && state\.activeId === open\.id\);/.test(APP) &&
    /if \(open\.dirty \|\| editingThisTab\)/.test(APP));
  assert('P2-8: the skip says why, distinct from the dirty-tab message',
    /Not refreshed\. You are editing this file\./.test(APP));
})();

/* ═══════════════════════════════════════════════════════════
   #13 — pass-wide copy rule: no em/en dashes in user-facing strings
   ═══════════════════════════════════════════════════════════ */
console.log('\n#13 copy: no em or en dashes in strings this pass added\n');

(function () {
  // Every string literal the shell hands to showToast(), plus the labels this
  // pass introduced. Comments are exempt (prose, not UI).
  var offenders = [];
  var re = /showToast\(\s*'([^']*)'/g;
  var m;
  while ((m = re.exec(APP))) {
    if (/[—–]/.test(m[1])) offenders.push(m[1]);
  }
  assert('no shell toast string contains an em or en dash',
    offenders.length === 0, offenders.join(' | '));

  [
    'No folder open', 'Loading…',
    'This file is empty. ⌘E to start writing.',
    'Could not read ',
    'Already open with unsaved changes',
    'Not refreshed. You are editing this file.',
  ].forEach(function (s) {
    assert('copy present and dash-free: "' + s + '"',
      APP.indexOf(s) !== -1 && !/[—–]/.test(s));
  });
})();

/* ── summary ─────────────────────────────────────────────── */
console.log('\n' + (fail === 0
  ? 'ALL PASS (' + pass + ' assertions)'
  : 'FAILURES: ' + fail + ' (' + pass + ' passed, ' + fail + ' failed)') + '\n');
process.exit(fail === 0 ? 0 : 1);
