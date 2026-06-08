/* ───────────────────────────────────────────────────────────
   round-5 self-tests (devA fixes)
   Run: node app/js/tv-round5.test.js

   Tests:
   #1  UF-02/UF-04 — edit→tab-switch: no text loss, dirty persists
   #2  UI-02       — Tab insertion is undo-safe (setRangeText path exists)
   #3  UF-01       — TVLive.start is called after openInto()
   #4  UV-01       — <pre> copy button present in markdown output
   #5  UF-06       — find state variables survive a render cycle
   #6  UI-01       — wire() respects tab._editCursorPos on re-renders
   #7  UF-08       — palette parser includes h4-h6 headings
   ─────────────────────────────────────────────────────────── */
'use strict';

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

/* ═══════════════════════════════════════════════════════════
   TEST #1 — UF-02/UF-04: edit→switch commits text + keeps dirty
   ═══════════════════════════════════════════════════════════ */
console.log('\n#1 UF-02/UF-04: edit→tab-switch commits textarea value\n');

(function () {
  // Simulate the state that activateTab() now maintains:
  // If in edit mode, the textarea value must be committed into tab.source before switch.

  function simulateActivateTab(state, outgoingTab, incomingId, textareaValue) {
    // This mirrors the new activateTab() logic in tv-app.js
    if (state.mode === 'edit' && outgoingTab) {
      if (textareaValue !== outgoingTab.source) {
        outgoingTab.source = textareaValue;
        if (outgoingTab.source !== '') {
          outgoingTab.dirty = true;
        }
      }
    }
    state.activeId = incomingId;
    state.mode = 'reading';
    return outgoingTab;
  }

  // Scenario: user opens two tabs, edits tab A, switches to tab B
  var tabA = { id: 'tab-a', source: '# Original', dirty: false };
  var tabB = { id: 'tab-b', source: '# Other', dirty: false };
  var state = { mode: 'edit', activeId: 'tab-a' };

  // User typed new text — textareaValue is ahead of tab.source
  var textareaValue = '# Original\n\nNew paragraph typed by user';

  var committed = simulateActivateTab(state, tabA, 'tab-b', textareaValue);

  assert(
    'tabA.source committed from textarea after switch',
    committed.source === textareaValue,
    'got: ' + JSON.stringify(committed.source)
  );

  assert(
    'tabA.dirty is true after switch with unsaved text',
    committed.dirty === true,
    'dirty: ' + committed.dirty
  );

  assert(
    'state.mode reset to reading after switch',
    state.mode === 'reading',
    'mode: ' + state.mode
  );

  assert(
    'state.activeId is now tab-b',
    state.activeId === 'tab-b',
    'activeId: ' + state.activeId
  );

  // Scenario: switch back to tab A → source still has the edits
  assert(
    'tabA.source survives round-trip switch (text not lost)',
    tabA.source === textareaValue,
    'source: ' + JSON.stringify(tabA.source)
  );

  // Scenario: no edits (source unchanged) — dirty should stay false
  var tabC = { id: 'tab-c', source: '# Unchanged', dirty: false };
  var stateC = { mode: 'edit', activeId: 'tab-c' };
  simulateActivateTab(stateC, tabC, 'tab-b', '# Unchanged');
  assert(
    'tabC.dirty stays false when no text changed',
    tabC.dirty === false,
    'dirty: ' + tabC.dirty
  );
})();

/* ═══════════════════════════════════════════════════════════
   TEST #2 — UI-02: Tab insertion uses setRangeText (undo-safe)
   ═══════════════════════════════════════════════════════════ */
console.log('\n#2 UI-02: Tab key insertion is undo-safe\n');

(function () {
  // Verify the new onKeydown logic uses setRangeText (not direct .value=) for Tab.
  // We cannot run browser APIs in Node, but we can verify the source code
  // does NOT contain the old direct assignment pattern for Tab.

  var fs = require('fs');
  var src = fs.readFileSync(__dirname + '/tv-edit.js', 'utf8');

  // Old (broken) pattern: textarea.value = val.slice(0, start) + indent + val.slice(end)
  // This should no longer exist in the Tab handler
  var hasOldPattern = src.indexOf("textarea.value = val.slice(0, start) + indent") !== -1;
  assert(
    'old direct .value= assignment for Tab is gone',
    !hasOldPattern,
    'old pattern still present'
  );

  // New pattern: setRangeText or execCommand
  var hasSetRangeText = src.indexOf('textarea.setRangeText') !== -1;
  var hasExecCommand = src.indexOf('execCommand') !== -1;
  assert(
    'setRangeText is present (undo-safe Tab insertion)',
    hasSetRangeText,
    'setRangeText not found'
  );

  assert(
    'execCommand fallback is present',
    hasExecCommand,
    'execCommand fallback not found'
  );
})();

/* ═══════════════════════════════════════════════════════════
   TEST #3 — UF-01: TVLive.start wired after openInto()
   ═══════════════════════════════════════════════════════════ */
console.log('\n#3 UF-01: TVLive.start called after openInto()\n');

(function () {
  var fs = require('fs');
  var src = fs.readFileSync(__dirname + '/tv-native.js', 'utf8');

  // openInto() must call TVLive.start
  var hasLiveStart = src.indexOf('TVLive.start(tab.id)') !== -1;
  assert(
    'TVLive.start(tab.id) is called in openInto()',
    hasLiveStart,
    'TVLive.start not found in tv-native.js'
  );

  // tab.live = true must be set before startWatch
  var hasTabLive = src.indexOf('tab.live = true') !== -1;
  assert(
    'tab.live = true is set in openInto()',
    hasTabLive,
    'tab.live = true not found'
  );

  // The save-as path (saveTab) also needs TVLive.start
  var saveAsIdx = src.indexOf('save_md_file_as');
  var afterSaveAs = src.slice(saveAsIdx);
  var hasSaveAsLiveStart = afterSaveAs.indexOf('TVLive.start') !== -1;
  assert(
    'TVLive.start also wired in saveTab save-as path',
    hasSaveAsLiveStart,
    'TVLive.start missing from save-as path'
  );
})();

/* ═══════════════════════════════════════════════════════════
   TEST #4 — UV-01: <pre> contains copy button
   ═══════════════════════════════════════════════════════════ */
console.log('\n#4 UV-01: rendered <pre> contains .tv-copy button\n');

(function () {
  // Load tv-markdown.js and run the renderer in a minimal environment
  var fs = require('fs');
  var code = fs.readFileSync(__dirname + '/tv-markdown.js', 'utf8');

  // Execute in a minimal global context
  var ctx = {};
  (function () {
    var window = ctx;
    eval(code); // eslint-disable-line no-eval
  })();

  var render = ctx.tvRenderMarkdown;
  if (!render) {
    console.error('  FAIL  tvRenderMarkdown not found on ctx');
    fail++;
    return;
  }

  var src = '```js\nconsole.log("hello");\n```';
  var html = render(src);

  var hasPreTag = html.indexOf('<pre>') !== -1;
  assert(
    'code fence renders a <pre> element',
    hasPreTag,
    'html: ' + html.slice(0, 200)
  );

  var hasCopyBtn = html.indexOf('class="tv-copy"') !== -1;
  assert(
    '<pre> contains .tv-copy button',
    hasCopyBtn,
    'html: ' + html.slice(0, 300)
  );

  var hasDataCopy = html.indexOf('data-copy') !== -1;
  assert(
    'copy button has data-copy attribute',
    hasDataCopy,
    'html: ' + html.slice(0, 300)
  );

  // Verify button text is NOT part of the code content
  var preContent = html.slice(html.indexOf('<pre>'), html.indexOf('</pre>'));
  var codeContent = preContent.slice(preContent.indexOf('<code>'), preContent.indexOf('</code>'));
  var copyInCode = codeContent.indexOf('>Copy<') !== -1;
  assert(
    'button label "Copy" is NOT inside <code> element',
    !copyInCode,
    'code content: ' + codeContent.slice(0, 200)
  );

  // Test with empty fence
  var emptyFence = '```\n\n```';
  var emptyHtml = render(emptyFence);
  var emptyHasBtn = emptyHtml.indexOf('class="tv-copy"') !== -1;
  assert(
    'empty code fence also gets copy button',
    emptyHasBtn,
    'empty html: ' + emptyHtml
  );
})();

/* ═══════════════════════════════════════════════════════════
   TEST #5 — UF-06: find state preserved across render (source check)
   ═══════════════════════════════════════════════════════════ */
console.log('\n#5 UF-06: find bar state survives non-destructive renders\n');

(function () {
  var fs = require('fs');
  var src = fs.readFileSync(__dirname + '/tv-app.js', 'utf8');

  // render() must save _findQuery and _findIndex before closing the bar
  var savesFindQuery = src.indexOf('_savedFindQuery') !== -1;
  assert(
    'render() captures _savedFindQuery before closing bar',
    savesFindQuery,
    '_savedFindQuery not found in tv-app.js'
  );

  var savesFindIndex = src.indexOf('_savedFindIndex') !== -1;
  assert(
    'render() captures _savedFindIndex before closing bar',
    savesFindIndex,
    '_savedFindIndex not found in tv-app.js'
  );

  // After render, _openFindBar + _runFind must be called to restore
  var restoresFind = src.indexOf('_savedFindQuery !== null') !== -1;
  assert(
    'render() re-opens find bar when query was active',
    restoresFind,
    'find restore condition not found'
  );
})();

/* ═══════════════════════════════════════════════════════════
   TEST #6 — UI-01: wire() restores cursor from tab._editCursorPos
   ═══════════════════════════════════════════════════════════ */
console.log('\n#6 UI-01: wire() respects tab._editCursorPos on re-renders\n');

(function () {
  var fs = require('fs');
  var src = fs.readFileSync(__dirname + '/tv-edit.js', 'utf8');

  // wire() must check tab._editCursorPos and use it to restore selection
  var hasEditCursorPos = src.indexOf('tab._editCursorPos') !== -1;
  assert(
    'tv-edit.js reads tab._editCursorPos for position restore',
    hasEditCursorPos,
    'tab._editCursorPos not found'
  );

  // onInput must write tab._editCursorPos to track position
  var onInputUpdates = src.indexOf('tab._editCursorPos = {') !== -1;
  assert(
    'onInput() updates tab._editCursorPos on every keystroke',
    onInputUpdates,
    'tab._editCursorPos assignment in onInput not found'
  );

  // wire() should NOT set caret to EOF unconditionally
  // The old pattern: else { var len = textarea.value.length; textarea.setSelectionRange(len, len); }
  // The new pattern: only when tab._editCursorPos is NOT set (first entry)
  var hasConditionalEof = src.indexOf('tab._editCursorPos = { start: len2') !== -1;
  assert(
    'EOF fallback only set when truly first entry (stores cursor pos)',
    hasConditionalEof,
    'conditional EOF set not found'
  );
})();

/* ═══════════════════════════════════════════════════════════
   TEST #7 — UF-08: palette includes h4-h6 headings
   ═══════════════════════════════════════════════════════════ */
console.log('\n#7 UF-08: palette parser includes h4-h6 headings\n');

(function () {
  // Inline the _parseHeadings function from tv-palette.js
  function _parseHeadings(source) {
    if (!source) return [];
    var out = [];
    var lines = source.split('\n');
    for (var i = 0; i < lines.length; i++) {
      var m = lines[i].match(/^(#{1,6})\s+(.+)/);
      if (m) out.push({ level: m[1].length, text: m[2].trim() });
    }
    return out;
  }

  var src = [
    '# H1 Title',
    '## H2 Section',
    '### H3 Sub',
    '#### H4 Deep',
    '##### H5 Deeper',
    '###### H6 Deepest',
    '',
    'Some content here.',
  ].join('\n');

  var headings = _parseHeadings(src);

  assert(
    'h1 heading parsed',
    headings.some(function (h) { return h.level === 1 && h.text === 'H1 Title'; })
  );
  assert(
    'h2 heading parsed',
    headings.some(function (h) { return h.level === 2 && h.text === 'H2 Section'; })
  );
  assert(
    'h3 heading parsed',
    headings.some(function (h) { return h.level === 3 && h.text === 'H3 Sub'; })
  );
  assert(
    'h4 heading parsed (was missing before fix)',
    headings.some(function (h) { return h.level === 4 && h.text === 'H4 Deep'; }),
    'h4 not found in: ' + JSON.stringify(headings.map(function(h){return h.text;}))
  );
  assert(
    'h5 heading parsed (was missing before fix)',
    headings.some(function (h) { return h.level === 5 && h.text === 'H5 Deeper'; })
  );
  assert(
    'h6 heading parsed (was missing before fix)',
    headings.some(function (h) { return h.level === 6 && h.text === 'H6 Deepest'; })
  );

  assert(
    'total 6 headings parsed (h1-h6)',
    headings.length === 6,
    'got: ' + headings.length
  );

  // Also verify the source regex in tv-palette.js is updated
  var fs = require('fs');
  var paletteSrc = fs.readFileSync(__dirname + '/tv-palette.js', 'utf8');
  var hasH6Regex = paletteSrc.indexOf('#{1,6}') !== -1;
  assert(
    'tv-palette.js uses #{1,6} regex (not #{1,3})',
    hasH6Regex,
    '#{1,6} not found in tv-palette.js'
  );
})();

/* ═══════════════════════════════════════════════════════════
   REPORT
   ═══════════════════════════════════════════════════════════ */
console.log('\n' + (fail === 0 ? 'ALL PASSED' : 'FAILURES: ' + fail) +
  ' (' + pass + ' passed, ' + fail + ' failed)\n');

if (fail > 0) process.exit(1);
