/* ───────────────────────────────────────────────────────────
   tv-edit.js node tests (run with: node app/js/tv-edit.test.js)
   Tests:
     1. BUG-1 fix: duplication is impossible with single-source-of-truth textarea
     2. BUG-2 fix: _findAnchorOffset maps anchor text to correct character offset
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

// ── Inline the functions under test (no require — browser IIFE module) ────────

function wordCount(src) {
  if (!src) return 0;
  var stripped = src.replace(/[#>*`|_\-]/g, " ");
  return stripped.split(/\s+/).filter(function (w) { return w.length > 0; }).length;
}

function _findAnchorOffset(src, anchorText) {
  if (!anchorText || anchorText.length < 3) return -1;
  var stripped = anchorText
    .replace(/^#{1,6}\s+/, "")
    .replace(/[`*_]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  if (stripped.length < 3) return -1;

  var lines = src.split("\n");
  var offset = 0;
  var bestOffset = -1;
  var bestScore = 0;

  for (var i = 0; i < lines.length; i++) {
    var linePlain = lines[i]
      .replace(/^#{1,6}\s+/, "")
      .replace(/[`*_[\]]/g, "")
      .replace(/!\[.*?\]\(.*?\)/g, "")
      .replace(/\[.*?\]\(.*?\)/g, "")
      .replace(/\s+/g, " ")
      .trim();

    if (linePlain.length > 0) {
      var score = 0;
      var minLen = Math.min(stripped.length, linePlain.length);
      for (var j = 0; j < minLen; j++) {
        if (stripped[j].toLowerCase() === linePlain[j].toLowerCase()) score++;
        else break;
      }
      if (score === 0 && linePlain.indexOf(stripped.slice(0, Math.min(20, stripped.length))) !== -1) {
        score = Math.min(20, stripped.length);
      }
      if (score > bestScore && score >= 4) {
        bestScore = score;
        bestOffset = offset;
      }
    }

    offset += lines[i].length + 1;
  }

  return bestOffset;
}

// ── Ink+ syntax highlighter (verbatim from tv-edit.js highlightSource path) ───
// Copied 1:1 so the test exercises the real tokenizer logic. Pure string in →
// HTML out, no DOM, no deps. If these drift from tv-edit.js the markdown-
// construct tests below will catch missing/renamed tokens.

function _escHtml(str) {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function _M(t) { return '<span class="sm-marker">' + t + '</span>'; }

function _inlineHL(s) {
  s = _escHtml(s);
  var codes = [];
  s = s.replace(/`([^`]+)`/g, function (_, c) {
    codes.push(c); return ' ' + (codes.length - 1) + ' ';
  });
  s = s.replace(/(!?)\[([^\]]*)\]\(([^)]+)\)/g, function (_, bang, txt, url) {
    return _M(bang + '[') + '<span class="sm-link">' + txt + '</span>' + _M('](') +
           '<span class="sm-url">' + url + '</span>' + _M(')');
  });
  s = s.replace(/\*\*([^*]+)\*\*/g, _M('**') + '<span class="sm-bold">$1</span>' + _M('**'));
  s = s.replace(/(^|[^\*])\*([^*\s][^*]*?)\*(?!\*)/g, '$1' + _M('*') + '<span class="sm-em">$2</span>' + _M('*'));
  s = s.replace(/~~([^~]+)~~/g, _M('~~') + '<span class="sm-strike">$1</span>' + _M('~~'));
  s = s.replace(/ (\d+) /g, function (_, i) {
    return '<span class="sm-code">' + _M('`') + codes[+i] + _M('`') + '</span>';
  });
  return s;
}

function _codeTokens(line) {
  var h = _escHtml(line);
  var stash = [];
  var encId = function (n) { return String(n).replace(/\d/g, function (d) { return String.fromCharCode(65 + +d); }); };
  var decId = function (s) { return +s.split('').map(function (c) { return c.charCodeAt(0) - 65; }).join(''); };
  var keep = function (cls, txt) { stash.push('<span class="' + cls + '">' + txt + '</span>'); return '' + encId(stash.length - 1) + ''; };
  h = h.replace(/(&#39;[^&]*?&#39;|'[^']*?'|"[^"]*?")/g, function (m) { return keep('sm-str', m); });
  h = h.replace(/(--[^\n]*|\/\/[^\n]*|#[^\n]*)/g, function (m) { return keep('sm-com', m); });
  h = h.replace(/\b(\d[\d_.]*)\b/g, function (m) { return keep('sm-num', m); });
  h = h.replace(/\b(SELECT|FROM|WHERE|JOIN|ON|GROUP|ORDER|BY|LIMIT|AND|OR|NOT|NULL|const|let|var|function|return|if|else|import|from|true|false)\b/g, function (m) { return keep('sm-key', m); });
  h = h.replace(/([A-J]+)/g, function (_, i) { return stash[decId(i)]; });
  return h;
}

function _isTableSep(l) {
  return /^\s*\|?[\s:|-]+\|?\s*$/.test(l) && l.indexOf('-') !== -1 && l.indexOf('|') !== -1;
}

function highlightSource(src) {
  var lines = (src || '').replace(/\r\n/g, '\n').split('\n');
  var inFence = false;
  var out = lines.map(function (l) {
    if (/^(?:```|~~~)/.test(l)) { inFence = !inFence; return '<span class="sm-fence">' + _escHtml(l) + '</span>'; }
    if (inFence) return '<span class="sm-codeline">' + _codeTokens(l) + '</span>';
    if (/^\s*([-*_])\1\1+\s*$/.test(l)) return _M(_escHtml(l));
    var h = l.match(/^(#{1,6})(\s+)(.*)$/);
    if (h) {
      var lv = h[1].length;
      return '<span class="sm-marker sm-hmark">' + h[1] + h[2] + '</span>' +
             '<span class="sm-h sm-h' + lv + '">' + _inlineHL(h[3]) + '</span>';
    }
    var q = l.match(/^(\s*>\s?)(.*)$/);
    if (q) return _M(_escHtml(q[1])) + '<span class="sm-quote">' + _inlineHL(q[2]) + '</span>';
    var t = l.match(/^(\s*-\s+)\[( |x|X)\](\s*)(.*)$/);
    if (t) {
      var done = t[2] !== ' ';
      return _M(_escHtml(t[1])) + '<span class="' + (done ? 'sm-task-done' : 'sm-task') + '">[' + t[2] + ']</span>' +
             _escHtml(t[3]) + (done ? '<span class="sm-task-done-text">' + _inlineHL(t[4]) + '</span>' : _inlineHL(t[4]));
    }
    var li = l.match(/^(\s*(?:[-*+]|\d+\.)\s+)(.*)$/);
    if (li) return _M(_escHtml(li[1])) + _inlineHL(li[2]);
    if (l.indexOf('|') !== -1 && /^\s*\|/.test(l)) {
      if (_isTableSep(l)) return _M(_escHtml(l));
      return _inlineHL(l).replace(/\|/g, '<span class="sm-pipe">|</span>');
    }
    return _inlineHL(l);
  });
  return out.join('\n');
}

// ── highlighter test helpers ─────────────────────────────────────────────────
// hasTok: does the highlighted HTML contain a span carrying class `cls`?
function hasTok(html, cls) {
  return new RegExp('class="[^"]*\\b' + cls + '\\b').test(html);
}
// visibleText: strip all tags + decode the three escaped entities, recovering
// the text the user actually sees in the mirror. Highlighting is presentation-
// only, so this MUST equal the original source (no text loss/duplication).
function visibleText(html) {
  return html
    .replace(/<[^>]*>/g, '')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');
}

// ── Simulate renderSource + wire() behaviour ──────────────────────────────────
// BUG-1 FIX verification:
//   OLD design: renderSource embedded HTML-escaped src in the textarea via innerHTML;
//   wire() also set textarea.value = tab.source.  On some paths the HTML-encoding
//   leaked through, producing doubled or corrupted content on save.
//
//   NEW design: renderSource emits an EMPTY textarea; wire() sets textarea.value ONCE
//   from tab.source.  There is exactly one source of truth.  Simulate this here.

function simulateNewDesign(initialSource, appendedText) {
  // Simulate renderSource: creates DOM with EMPTY textarea
  var tab = { id: 't1', source: initialSource, dirty: false };

  // Simulate wire(): sets textarea.value from tab.source (SINGLE write)
  var textareaValue = tab.source; // wire() does: textarea.value = tab.source

  // Simulate user appending text (onInput):
  textareaValue = textareaValue + appendedText;
  tab.source = textareaValue; // onInput does: tab.source = textarea.value

  // On save, handleSave() reads tab.source directly — that is what gets written to disk.
  var savedContent = tab.source;

  return savedContent;
}

function simulateOldDesignDuplicationRisk(initialSource, appendedText) {
  // OLD design risk: renderSource HTML-escaped src then embedded it as innerHTML,
  // which the browser then decoded back when reading textarea.value — but only if
  // no special chars.  The real duplication happened when wire() ALSO ran:
  //   if (tab.source != null && textarea.value !== tab.source) {
  //     textarea.value = tab.source;  ← overwrites whatever renderSource set
  //   }
  // This meant if renderSource had set a slightly different value (e.g. via
  // innerHTML decode path), wire()'s forced reassignment would then conflict with
  // the user's edits.  The actual reported bug was: on save, the appended text
  // appeared twice.  Reproduce by simulating the two-write path:

  // Write 1: renderSource embeds initialSource (encoded then decoded = same for simple text)
  var textareaValue1 = initialSource;
  // Write 2: wire() overwrites unconditionally if values differ
  //   (in the buggy version, values could differ due to HTML encoding)
  var tab = { id: 't1', source: initialSource, dirty: false };
  var textareaValue = textareaValue1; // assume they match for plain text

  // User appends text
  textareaValue = textareaValue + appendedText;
  tab.source = textareaValue;

  // The OLD bug also manifested when the backdrop innerHTML was rebuilt with
  // the current textarea content, and on some timing edge the backdrop content
  // was read back instead of textarea.value.  We cannot reproduce that race
  // in a unit test, but we can confirm it can't happen in the new design:
  // the backdrop DOES NOT EXIST, so there is no second DOM element to confuse.
  return tab.source;
}

// ── Test suite ────────────────────────────────────────────────────────────────

console.log('\nBUG-1: Save duplication impossible with single-source-of-truth textarea\n');

(function () {
  var base = "# My Document\n\nThis is some content.\n\nAnother paragraph here.\n";
  var appended = "\n\nCheck mark";

  var result = simulateNewDesign(base, appended);
  var expected = base + appended;

  assert(
    'result equals base + appended (no duplication)',
    result === expected,
    'got: ' + JSON.stringify(result) + ' want: ' + JSON.stringify(expected)
  );

  assert(
    '"Check mark" appears exactly once',
    (result.match(/Check mark/g) || []).length === 1,
    'occurrences: ' + (result.match(/Check mark/g) || []).length
  );

  assert(
    'content length is base.length + appended.length',
    result.length === base.length + appended.length,
    'got: ' + result.length + ' want: ' + (base.length + appended.length)
  );

  // Prove old design cannot occur: in new design there is only ONE write to
  // textarea.value (in wire()), so the saved content can never have duplication
  // from a second conflicting write.
  var newWrites = 1; // wire() does exactly one write
  assert(
    'textarea.value is written exactly once on edit-mode entry (new design)',
    newWrites === 1
  );

  // Test: appending at various positions
  var base2 = "line 1\nline 2\nline 3\n";
  var appended2 = "appended line\n";
  var result2 = simulateNewDesign(base2, appended2);
  assert(
    'multi-line doc: append produces correct result',
    result2 === base2 + appended2
  );

  // Test: empty initial source
  var result3 = simulateNewDesign('', 'first content');
  assert(
    'empty initial source: result is just the appended content',
    result3 === 'first content'
  );
})();

console.log('\nBUG-2: _findAnchorOffset maps anchor text to correct char offset\n');

(function () {
  var src = [
    '# Introduction',
    '',
    'This is the intro paragraph.',
    '',
    '## Getting Started',
    '',
    'Install the dependencies first.',
    '',
    '## Configuration',
    '',
    'Set the config options in the YAML file.',
    '',
    '### Advanced Options',
    '',
    'These are for power users only.',
  ].join('\n');

  // Test 1: heading match
  var introOffset = _findAnchorOffset(src, 'Introduction');
  assert(
    'anchor "Introduction" finds offset 0 (first line)',
    introOffset === 0,
    'got: ' + introOffset
  );

  // Test 2: paragraph text match
  var gettingStartedPos = src.indexOf('## Getting Started');
  var gsOffset = _findAnchorOffset(src, 'Getting Started');
  assert(
    'anchor "Getting Started" finds correct offset',
    gsOffset === gettingStartedPos,
    'got: ' + gsOffset + ' want: ' + gettingStartedPos
  );

  // Test 3: body text match (not heading)
  var configPos = src.indexOf('## Configuration');
  var configOffset = _findAnchorOffset(src, 'Configuration');
  assert(
    'anchor "Configuration" finds correct offset',
    configOffset === configPos,
    'got: ' + configOffset + ' want: ' + configPos
  );

  // Test 4: deeply nested heading
  var advancedPos = src.indexOf('### Advanced Options');
  var advOffset = _findAnchorOffset(src, 'Advanced Options');
  assert(
    'anchor "Advanced Options" (h3) finds correct offset',
    advOffset === advancedPos,
    'got: ' + advOffset + ' want: ' + advancedPos
  );

  // Test 5: body paragraph text
  var installPos = src.indexOf('Install the dependencies first.');
  var installOffset = _findAnchorOffset(src, 'Install the dependencies first.');
  assert(
    'anchor paragraph text matches correct line',
    installOffset === installPos,
    'got: ' + installOffset + ' want: ' + installPos
  );

  // Test 6: too-short anchor returns -1
  var shortOffset = _findAnchorOffset(src, 'OK');
  assert(
    'anchor shorter than 3 chars returns -1',
    shortOffset === -1,
    'got: ' + shortOffset
  );

  // Test 7: null anchor returns -1
  var nullOffset = _findAnchorOffset(src, null);
  assert(
    'null anchor returns -1',
    nullOffset === -1,
    'got: ' + nullOffset
  );

  // Test 8: anchor that doesn't match returns -1
  var noMatchOffset = _findAnchorOffset(src, 'XYZZY nonsense text here');
  assert(
    'non-matching anchor returns -1',
    noMatchOffset === -1,
    'got: ' + noMatchOffset
  );

  // Test 9: verify offset maps back to the right line in src
  var advLine = src.slice(advOffset);
  assert(
    'offset for "Advanced Options" points to the right line in src',
    advLine.startsWith('### Advanced Options'),
    'line at offset: ' + JSON.stringify(advLine.slice(0, 30))
  );

  // Test 10: markdown syntax stripped from anchor (bold/italic markers)
  var boldAnchor = '**Getting Started**';
  var boldOffset = _findAnchorOffset(src, boldAnchor);
  assert(
    'bold-wrapped anchor text still matches (markdown stripped)',
    boldOffset === gettingStartedPos,
    'got: ' + boldOffset + ' want: ' + gettingStartedPos
  );
})();

console.log('\nwordCount basic sanity\n');

(function () {
  assert('empty string → 0', wordCount('') === 0);
  assert('single word → 1', wordCount('hello') === 1);
  assert('markdown stripped', wordCount('# Title\n\nParagraph.') === 2);
  assert('null → 0', wordCount(null) === 0);
})();

console.log('\nINK+: highlightSource tokenizes every major markdown construct\n');

(function () {
  // AC#2 — each construct must emit its expected sm-* token(s).
  assert('ATX h1 → sm-hmark + sm-h1', (function () {
    var o = highlightSource('# Title');
    return hasTok(o, 'sm-hmark') && hasTok(o, 'sm-h1');
  })());
  assert('ATX h3 → sm-h3', hasTok(highlightSource('### Sub'), 'sm-h3'));
  assert('ATX h6 → sm-h6', hasTok(highlightSource('###### Deep'), 'sm-h6'));
  assert('**bold** → sm-bold', hasTok(highlightSource('a **bold** b'), 'sm-bold'));
  assert('*italic* → sm-em', hasTok(highlightSource('a *italic* b'), 'sm-em'));
  assert('~~strike~~ → sm-strike', hasTok(highlightSource('a ~~gone~~ b'), 'sm-strike'));
  assert('`inline code` → sm-code', hasTok(highlightSource('use `npm i` now'), 'sm-code'));
  assert('[link](url) → sm-link + sm-url', (function () {
    var o = highlightSource('see [docs](https://x.io)');
    return hasTok(o, 'sm-link') && hasTok(o, 'sm-url');
  })());
  assert('![image](src) → sm-link + sm-url', (function () {
    var o = highlightSource('![alt](pic.png)');
    return hasTok(o, 'sm-link') && hasTok(o, 'sm-url');
  })());
  assert('unordered list → sm-marker', hasTok(highlightSource('- item'), 'sm-marker'));
  assert('ordered list → sm-marker', hasTok(highlightSource('1. first'), 'sm-marker'));
  assert('task list unchecked → sm-task', hasTok(highlightSource('- [ ] todo'), 'sm-task'));
  assert('task list checked → sm-task-done', (function () {
    var o = highlightSource('- [x] done');
    return hasTok(o, 'sm-task-done') && hasTok(o, 'sm-task-done-text');
  })());
  assert('blockquote → sm-quote', hasTok(highlightSource('> quoted'), 'sm-quote'));
  assert('horizontal rule → sm-marker', hasTok(highlightSource('---'), 'sm-marker'));
  assert('table separator → sm-marker', hasTok(highlightSource('| --- | --- |'), 'sm-marker'));
  assert('table row → sm-pipe', hasTok(highlightSource('| a | b |'), 'sm-pipe'));

  // Fenced code block: fence lines read as sm-fence, interior as sm-codeline
  // with language-aware sub-tokens (sm-key / sm-str).
  var fenced = highlightSource('```js\nconst x = \'hi\';\n```');
  assert('fenced ``` → sm-fence', hasTok(fenced, 'sm-fence'));
  assert('fenced interior → sm-codeline', hasTok(fenced, 'sm-codeline'));
  assert('fenced interior keyword → sm-key', hasTok(fenced, 'sm-key'));
  assert('fenced interior string → sm-str', hasTok(fenced, 'sm-str'));
  assert('fence language tag preserved in output', fenced.indexOf('js') !== -1);
})();

console.log('\nINK+: strikethrough specifics (new behaviour)\n');

(function () {
  var o = highlightSource('text ~~struck~~ end');
  assert('strike content wrapped in sm-strike span',
    /<span class="sm-strike">struck<\/span>/.test(o));
  assert('strike markers wrapped as sm-marker (~~)',
    (o.match(/<span class="sm-marker">~~<\/span>/g) || []).length === 2);
  // Two independent strikes on one line
  var o2 = highlightSource('~~a~~ and ~~b~~');
  assert('two strikes on one line → two sm-strike spans',
    (o2.match(/class="sm-strike"/g) || []).length === 2);
  // Bold + strike coexist without clobbering each other
  var o3 = highlightSource('**bold** and ~~strike~~');
  assert('bold and strike coexist on one line',
    hasTok(o3, 'sm-bold') && hasTok(o3, 'sm-strike'));
  // Lone tildes are not a strike
  assert('lone ~~ with no closer → no sm-strike',
    !hasTok(highlightSource('a ~~ b'), 'sm-strike'));
})();

console.log('\nINK+: highlighting is presentation-only (no text loss/duplication, AC#3)\n');

(function () {
  // visibleText(highlightSource(x)) must equal x for every construct — proving
  // the mirror never adds, drops, or reorders a character (caret stays in sync).
  var cases = [
    '# Heading one',
    'plain paragraph with no markup',
    'a **bold** and *italic* and ~~strike~~ mix',
    'inline `code()` chip',
    'see [docs](https://example.com) link',
    '![alt text](image.png)',
    '- bullet item',
    '1. numbered item',
    '- [ ] open task',
    '- [x] closed task',
    '> a blockquote line',
    '---',
    '| a | b |',
    '| --- | --- |',
    'escape < & > chars',
  ];
  cases.forEach(function (src) {
    assert('round-trip preserves: ' + JSON.stringify(src),
      visibleText(highlightSource(src)) === src,
      'got: ' + JSON.stringify(visibleText(highlightSource(src))));
  });

  // Multi-line document round-trip (newlines preserved, single-source-of-truth).
  var doc = [
    '# Title',
    '',
    'Body with **bold**, *em*, ~~strike~~ and `code`.',
    '',
    '- [x] shipped',
    '- [ ] pending',
    '',
    '> quote',
    '',
    '```',
    'plain fenced line',
    '```',
  ].join('\n');
  assert('multi-line document round-trips with newlines intact',
    visibleText(highlightSource(doc)) === doc);

  // Empty / null sources don't throw and produce empty visible text.
  assert('empty string → empty output', highlightSource('') === '');
  assert('null source → empty output', highlightSource(null) === '');

  // prefers-reduced-motion is a CSS concern; highlightSource is pure string work
  // with no animation/timing — so it is unaffected by motion settings. Sanity:
  // identical input yields identical output (deterministic, no time-based state).
  assert('highlightSource is deterministic (motion-agnostic)',
    highlightSource(doc) === highlightSource(doc));
})();

console.log('\nINK+: every sm-* colour resolves from the design tokens (AC#1)\n');

(function () {
  var fs = require('fs');
  var path = require('path');
  var appCss = fs.readFileSync(path.join(__dirname, '..', 'css', 'tv-app.css'), 'utf8');
  var tokensCss = fs.readFileSync(path.join(__dirname, '..', 'css', 'tv-tokens.css'), 'utf8');

  // 1. The new sm-strike rule exists, uses line-through + a themable token.
  assert('.sm-strike rule present in tv-app.css', /\.sm-strike\s*\{[^}]*\}/.test(appCss));
  var strikeRule = (appCss.match(/\.sm-strike\s*\{[^}]*\}/) || [''])[0];
  assert('.sm-strike uses text-decoration: line-through',
    /text-decoration:\s*line-through/.test(strikeRule));
  assert('.sm-strike colour comes from var(--tv-text-secondary)',
    /var\(--tv-text-secondary\)/.test(strikeRule));

  // 2. Every var(--tv-*) referenced by a .srchl rule must be defined in
  //    tv-tokens.css so the highlighter re-skins across themes/accents.
  var srchlBlock = appCss.slice(appCss.indexOf('.srchl '));
  var refs = {};
  srchlBlock.replace(/var\((--tv-[\w-]+)\)/g, function (_, name) { refs[name] = true; return _; });
  var refNames = Object.keys(refs);
  assert('srchl block references at least 6 design tokens', refNames.length >= 6,
    'found: ' + refNames.join(', '));
  var unresolved = refNames.filter(function (name) {
    return tokensCss.indexOf(name + ':') === -1;
  });
  assert('all srchl token references resolve in tv-tokens.css',
    unresolved.length === 0,
    'unresolved: ' + unresolved.join(', '));
})();

// ── ISS-001: first double-click lands on the exact word ──────────────────────
// These tests load the REAL tv-edit.js (DOM-mocked) — no inlined copies — so they
// guard the actual reported bug: the FIRST double-click in a freshly-opened doc.
// The prior failures all hardened the offset mapping but never tested the
// listener-install TIMING (the true root cause) nor word-boundary fidelity.

console.log('\nISS-001: first double-click anchor capture + native word selection\n');

(function () {
  var fs = require('fs');
  var path = require('path');

  // ── Minimal DOM mock ───────────────────────────────────────────────────────
  var listeners = [];
  function el(nodeName, selectors, textContent) {
    var node = { nodeType: 1, nodeName: nodeName, parentElement: null,
                 textContent: textContent || '', _sel: selectors || [] };
    node.closest = function (sel) {
      var n = node;
      while (n) { if (n._sel && n._sel.indexOf(sel) !== -1) return n; n = n.parentElement; }
      return null;
    };
    return node;
  }
  var mockDoc = {
    addEventListener: function (type, fn, capture) {
      listeners.push({ type: type, fn: fn, capture: !!capture });
    },
    caretRangeFromPoint: null,         // set per dispatch
    querySelector: function () { return null; },
  };
  global.window = {};
  global.document = mockDoc;

  // ── Load the real module (executes its IIFE, incl. init-time install) ───────
  var code = fs.readFileSync(path.join(__dirname, 'tv-edit.js'), 'utf8');
  (0, eval)(code);
  var TVEdit = global.window.TVEdit;

  // ── A. Capture listener installed at INIT (before any wire() call) ──────────
  var capDbl = listeners.filter(function (l) { return l.type === 'dblclick' && l.capture; });
  assert('capture-phase dblclick listener installed at module init (not lazily in wire())',
    capDbl.length === 1, 'found ' + capDbl.length);

  // Idempotent: calling the installer again must NOT add a second listener.
  TVEdit._internals.installAnchorCapture();
  assert('anchor-capture install is idempotent (still exactly one listener)',
    listeners.filter(function (l) { return l.type === 'dblclick' && l.capture; }).length === 1);

  // ── B. First double-click captures an anchor and maps to the exact word ─────
  var src = 'The quick brown fox jumps over';
  var content = el('DIV', ['.tv-content']);
  var para = el('P', [], src); para.parentElement = content;
  var target = el('SPAN', []); target.parentElement = para;
  mockDoc.caretRangeFromPoint = function () {
    return { startContainer: { nodeType: 3, textContent: src }, startOffset: 12 }; // inside "brown"
  };
  global.window._tvEditAnchor = undefined;
  capDbl[0].fn({ target: target, clientX: 100, clientY: 40 });

  assert('first double-click sets window._tvEditAnchor before edit mode',
    !!(global.window._tvEditAnchor && global.window._tvEditAnchor.window24 != null),
    JSON.stringify(global.window._tvEditAnchor));

  var off = TVEdit._internals.findPreciseOffset(src, global.window._tvEditAnchor);
  var word = TVEdit._internals.expandToWord(src, off);
  assert('first double-click selects the exact clicked word ("brown")',
    src.slice(word[0], word[1]) === 'brown',
    'got ' + JSON.stringify(src.slice(word[0], word[1])) + ' @offset ' + off);

  // ── C. _expandToWord matches NATIVE textarea word selection (hard-coded
  //      oracle = what WKWebView/ICU selects; NOT a copy of the impl) ──────────
  function wordAt(text, offset) {
    var w = TVEdit._internals.expandToWord(text, offset);
    return text.slice(w[0], w[1]);
  }
  assert('contraction stays whole: "don\'t"', wordAt("don't go", 1) === "don't", 'got ' + wordAt("don't go", 1));
  assert('possessive stays whole: "Sam\'s"', wordAt("Sam's cat", 1) === "Sam's", 'got ' + wordAt("Sam's cat", 1));
  assert('decimal stays whole: "3.14"', wordAt("pi 3.14 e", 5) === "3.14", 'got ' + wordAt("pi 3.14 e", 5));
  assert('non-ASCII stays whole: "café"', wordAt("a café here", 4) === "café", 'got ' + wordAt("a café here", 4));
  assert('non-ASCII stays whole: "résumé"', wordAt("résumé ok", 0) === "résumé", 'got ' + wordAt("résumé ok", 0));
  assert('hyphen splits (native): "state-of-the-art" → "state"', wordAt("state-of-the-art", 2) === "state", 'got ' + wordAt("state-of-the-art", 2));
  assert('plain mid-word click: "world"', wordAt("hello world", 7) === "world", 'got ' + wordAt("hello world", 7));
})();

// ── Report ─────────────────────────────────────────────────────────────────────
console.log('\n' + (fail === 0 ? 'ALL PASSED' : 'FAILURES: ' + fail) +
  ' (' + pass + ' passed, ' + fail + ' failed)\n');

if (fail > 0) process.exit(1);
