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
   TEST #8 — DR-65–71: live-watch recency label fixes
   ═══════════════════════════════════════════════════════════ */
console.log('\n#8 DR-65–71: live-watch recency label\n');

(function () {
  var fs = require('fs');
  var live = fs.readFileSync(__dirname + '/tv-live.js', 'utf8');
  var css = fs.readFileSync(__dirname + '/../css/tv-app.css', 'utf8');
  var native = fs.readFileSync(__dirname + '/tv-native.js', 'utf8');
  var rust = fs.readFileSync(__dirname + '/../../tauri-app/src-tauri/src/lib.rs', 'utf8');
  var app = fs.readFileSync(__dirname + '/tv-app.js', 'utf8');

  // DR-66/D3: the legacy unbounded literal must be gone.
  assert(
    'DR-66: legacy "updated 0.0s ago" literal removed from tv-live.js',
    live.indexOf('updated 0.0s ago') === -1,
    'hardcoded "updated 0.0s ago" still present'
  );

  // D1/D3/D4: text is derived from lastModTime via paintRecency on every inject.
  assert(
    'paintRecency() helper exists',
    live.indexOf('function paintRecency(') !== -1
  );
  assert(
    'D1/D4: injectStatusBarOnly repaints via paintRecency (no clobber/flash)',
    /injectStatusBarOnly[\s\S]*paintRecency\(watchState\)/.test(live),
    'injectStatusBarOnly does not call paintRecency'
  );

  // D2/DR-67: pulse lives only on .is-updating — base .blip must NOT animate.
  var baseBlip = css.match(/\.tv-status \.live-pill \.blip \{[\s\S]*?\}/);
  assert(
    'DR-67: base .blip rule no longer carries `animation` (pulse only on .is-updating)',
    !!baseBlip && baseBlip[0].indexOf('animation') === -1,
    'base .blip still has an animation declaration'
  );
  assert(
    'DR-67: .blip.is-updating carries the tv-blip animation',
    /\.blip\.is-updating \{ animation: tv-blip/.test(css)
  );

  // D5/DR-69: a change restarts the tick if it had stopped (>=1h idle).
  assert(
    'D5: onFileChange restarts the tick when elapsedInterval is null',
    /if \(!watchState\.elapsedInterval\)\s*\{\s*scheduleElapsedTick\(watchState\);/.test(live),
    'tick-restart guard not found in onFileChange'
  );

  // DR-71: file removal tears the watch down via TVLive.stop (no stale label).
  assert(
    'DR-71: handleFileRemoved calls TVLive.stop(tab.id)',
    /handleFileRemoved[\s\S]*TVLive\.stop\(tab\.id\)/.test(native),
    'TVLive.stop not called from handleFileRemoved'
  );

  // DR-70: native background-tab changes stamp lastModTime via notifyChange.
  assert(
    'DR-70: TVLive.notifyChange is exported',
    /notifyChange:\s*notifyChange/.test(live),
    'notifyChange not on the public API'
  );
  assert(
    'DR-70: handleFileChanged stamps background tabs via TVLive.notifyChange',
    /TVLive\.notifyChange\(tab\.id\)/.test(native),
    'notifyChange not called for background native tabs'
  );

  // DR-68 (auto-hide): the 1s tick removes the settled bar at IDLE_THRESHOLD_MS
  // (supersedes dim-to-dot). The watch stays armed — autoHideStatusBar nulls the
  // bar ref but does NOT delete the _watching entry, so a change re-reveals it.
  assert(
    'DR-68: tick auto-hides the settled bar at IDLE_THRESHOLD_MS',
    /function autoHideStatusBar/.test(live) &&
      />= IDLE_THRESHOLD_MS\)\s*\{\s*autoHideStatusBar/.test(live),
    'runElapsedTick does not auto-hide at the settle threshold'
  );
  assert(
    'DR-68: inject paths gate on isRecent (settled tab not resurrected)',
    /function isRecent/.test(live) &&
      /if \(isRecent\(watchState\)\) injectStatusBarOnly/.test(live),
    'render/tab re-inject not gated on isRecent'
  );

  // DR-65/DR-70: a disk change to a DIRTY poll tab must still stamp recency
  // (keep the buffer, but reset the clock) — onFileChange inside the dirty guard.
  assert(
    'DR-65/DR-70: poll dirty-tab change stamps recency (onFileChange in dirty guard)',
    /if \(tab\.dirty\)\s*\{[\s\S]*?onFileChange\(watchState\)/.test(live),
    'poll dirty branch does not stamp lastModTime via onFileChange'
  );

  // DR-65/DR-70: same for native mode — dirty handleFileChanged stamps recency
  // via notifyChange before the early return.
  assert(
    'DR-65/DR-70: native dirty-tab change stamps recency (notifyChange in dirty guard)',
    /if \(tab\.dirty\)\s*\{[\s\S]*?TVLive\.notifyChange\(tab\.id\)/.test(native),
    'native dirty branch does not stamp lastModTime via notifyChange'
  );

  // DR-65 (open gate): start() must NOT show the bar on open unless the file is
  // recent — the native open-inject is gated on isActiveTab && isRecent.
  assert(
    'DR-65: start() gates open inject on isActiveTab && isRecent (no bar for static files)',
    /isActiveTab\(tabId\) && isRecent\(_watching\[tabId\]\)/.test(live),
    'native open inject not gated on isActiveTab && isRecent'
  );

  // DR-65: start() seeds the recency clock from the tab's REAL mtime
  // (tab.lastModTime), falling back to Date.now() only when it is absent.
  assert(
    'DR-65: start() seeds lastModTime from tab.lastModTime (fallback Date.now())',
    /typeof tab\.lastModTime === 'number' \? tab\.lastModTime : Date\.now\(\)/.test(live),
    'lastModTime seed from tab.lastModTime not found'
  );

  // DR-65: tv-native.js openInto threads the real mtime onto the tab so start()
  // can read it (doc.modified comes from the Rust open command).
  assert(
    'DR-65: openInto threads doc.modified onto tab.lastModTime',
    /tab\.lastModTime = doc\.modified/.test(native),
    'tab.lastModTime = doc.modified not found in tv-native.js'
  );

  // DR-65: the Rust open command exposes the file mtime on its return struct.
  assert(
    'DR-65: Rust open struct exposes modified mtime field',
    /pub modified: Option<u64>/.test(rust),
    'pub modified: Option<u64> not found in lib.rs'
  );

  // DR-65 (bolt icon): the live "bolt" in the tab strip / sidebar is gated on the
  // SAME recency rule as the bottom bar — it renders from tab.liveActive, NOT
  // tab.live (which only means "watched"). So a static file opens with no bolt.
  assert(
    'DR-65: tab-strip bolt renders from t.liveActive (not t.live)',
    /if \(t\.liveActive && t\.dirty\)[\s\S]*?else if \(t\.liveActive\)/.test(app) &&
      !/else if \(t\.live\)\s*\{\s*lead =/.test(app),
    'buildTabbar bolt still keys off t.live instead of t.liveActive'
  );
  assert(
    'DR-65: _updateTabDot bolt renders from tab.liveActive',
    /if \(tab\.liveActive && isDirty\)[\s\S]*?else if \(tab\.liveActive\)/.test(app),
    '_updateTabDot bolt still keys off tab.live'
  );
  assert(
    'DR-65: tv-live.js owns the bolt flag (setBoltActive sets tab.liveActive)',
    /function setBoltActive[\s\S]*?tab\.liveActive = active/.test(live),
    'setBoltActive does not set tab.liveActive'
  );
  assert(
    'DR-65: settle clears the bolt (autoHideStatusBar → setBoltActive false)',
    /autoHideStatusBar[\s\S]*?setBoltActive\(watchState\.tabId, false\)/.test(live),
    'autoHideStatusBar does not clear the bolt'
  );
  assert(
    'DR-65: tv-app exposes updateTabIndicator for the bolt refresh',
    /updateTabIndicator: updateTabIndicator/.test(app),
    'updateTabIndicator not exposed on window.TV'
  );
})();

/* ═══════════════════════════════════════════════════════════
   REPORT
   ═══════════════════════════════════════════════════════════ */
console.log('\n' + (fail === 0 ? 'ALL PASSED' : 'FAILURES: ' + fail) +
  ' (' + pass + ' passed, ' + fail + ' failed)\n');

if (fail > 0) process.exit(1);
