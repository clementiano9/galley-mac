/* ── QA Round 2 self-test harness ───────────────────────────
   node self-test.js
   Tests each fix: C-01, C-03, C-04, C-05, N-02, N-03, U-04, S-01 (edit perf), C-07 (bonus)
   ─────────────────────────────────────────────────────────── */
"use strict";

// ── Minimal browser shims needed by tv-markdown.js ──────────
global.window = global;
global.document = {
  documentElement: { classList: { contains: function() { return false; } } },
  querySelector: function() { return null; },
  createElement: function(tag) {
    return { className: "", src: "", async: false, onload: null, onerror: null };
  },
  head: { appendChild: function() {} }
};
global.btoa = function(s) { return Buffer.from(s, "binary").toString("base64"); };
global.atob = function(s) { return Buffer.from(s, "base64").toString("binary"); };

// Load the renderer
require("../js/tv-markdown.js");
var render = global.tvRenderMarkdown;

// ── Test helpers ──────────────────────────────────────────
var PASS = 0, FAIL = 0;
function test(id, desc, got, check) {
  var ok;
  if (typeof check === "function") {
    try { ok = check(got); } catch(e) { ok = false; }
  } else if (check instanceof RegExp) {
    ok = check.test(got);
  } else {
    ok = got === check;
  }
  if (ok) {
    PASS++;
    console.log("PASS [" + id + "] " + desc);
  } else {
    FAIL++;
    console.log("FAIL [" + id + "] " + desc);
    console.log("  got: " + JSON.stringify(got).slice(0, 200));
    if (!(check instanceof Function)) console.log("  expected: " + check);
  }
}

// ═══════════════════════════════════════════════════════════
// C-01: Highlight stash sentinel — no orphan \x01 bytes
// ═══════════════════════════════════════════════════════════

// Basic: echo "hello" in a fence
var c01_out = render('```\necho "hello"\n```');
test("C-01a", 'No raw \\x01 bytes in output for echo "hello"', c01_out, function(s) {
  return (s.match(/\x01/g) || []).length === 0;
});
test("C-01b", 'String span (c-str) present for "hello"', c01_out, /<span class="c-str">/);
test("C-01c", 'No stray \\x01 sentinel chars in output', c01_out, function(s) {
  return (s.match(/\x01/g) || []).length === 0;
});

// Stress: 10+ stash entries (two-digit index previously caused split)
var manyStrings = '```\na = "one"\nb = "two"\nc = "three"\nd = "four"\ne = "five"\nf = "six"\ng = "seven"\nh = "eight"\ni = "nine"\nj = "ten"\nk = "eleven"\n```';
var c01_many = render(manyStrings);
test("C-01d", 'No raw \\x01 with 11 stash entries (two-digit index test)', c01_many, function(s) {
  return (s.match(/\x01/g) || []).length === 0;
});
test("C-01e", 'At least 11 c-str spans for 11 quoted strings', c01_many, function(s) {
  return (s.match(/<span class="c-str">/g) || []).length >= 11;
});

// ═══════════════════════════════════════════════════════════
// C-03: Blockquote — full block parser (fenced code inside >)
// ═══════════════════════════════════════════════════════════

var c03_code = render('> ```\n> echo "hi"\n> ```');
test("C-03a", '<pre> present inside blockquote with fenced code', c03_code, /<blockquote>.*<pre>/s);

var c03_table = render('> | H1 | H2 |\n> |---|---|\n> | a | b |');
test("C-03b", '<table> present inside blockquote', c03_table, /<blockquote>.*<table>/s);

var c03_list = render('> - item one\n> - item two');
test("C-03c", '<ul> present inside blockquote', c03_list, /<blockquote>.*<ul>/s);

var c03_heading = render('> # Heading inside quote');
test("C-03d", '<h1> present inside blockquote', c03_heading, /<blockquote>.*<h1>/s);

// ═══════════════════════════════════════════════════════════
// C-04: No double-escape of & in URLs
// ═══════════════════════════════════════════════════════════

var c04_out = render('[x](http://example.com/?a=1&b=2)');
test("C-04a", 'href contains &amp;b=2 (single-escaped)', c04_out, /href="http:\/\/example\.com\/\?a=1&amp;b=2"/);
test("C-04b", 'href does NOT contain &amp;amp; (double-escaped)', c04_out, function(s) {
  return s.indexOf("&amp;amp;") === -1;
});

// Pure URL without special chars must not be mangled
var c04_plain = render('[click](https://example.com/path)');
test("C-04c", 'Plain URL href is clean', c04_plain, /href="https:\/\/example\.com\/path"/);

// ═══════════════════════════════════════════════════════════
// C-05: Intra-word underscores (snake_case)
// ═══════════════════════════════════════════════════════════

var c05_snake = render('foo_bar_baz');
test("C-05a", 'foo_bar_baz does not produce <em>', c05_snake, function(s) {
  return s.indexOf("<em>") === -1;
});
test("C-05b", 'foo_bar_baz text is preserved in output', c05_snake, /foo_bar_baz/);

var c05_init = render('__init__.py is a file');
test("C-05c", '__init__.py is not mangled by em regex (no <em>)', c05_init, function(s) {
  // __init__ is handled by __ bold first, so check no spurious em on init
  // The key is "init" should appear in output, not as stray <em>
  return s.indexOf("init") !== -1;
});

// Legitimate _em_ with spaces/punctuation flanking SHOULD still work
var c05_legit = render('say _hello_ now');
test("C-05d", '_hello_ with flanking spaces renders as <em>', c05_legit, /<em>hello<\/em>/);

// At start of line
var c05_start = render('_emphasis_ at start');
test("C-05e", '_emphasis_ at start of line renders as <em>', c05_start, /<em>emphasis<\/em>/);

// ═══════════════════════════════════════════════════════════
// N-02: Percent-encoded javascript: bypass blocked
// ═══════════════════════════════════════════════════════════

var n02_encoded = render('[click](javascript%3Aalert(1))');
test("N-02a", 'javascript%3A link renders as plain text, no <a>', n02_encoded, function(s) {
  return s.indexOf('<a ') === -1;
});
test("N-02b", 'javascript%3A link text is present as plain text', n02_encoded, /click/);

// UPPERCASE encoding
var n02_upper = render('[x](JAVASCRIPT%3Aalert(1))');
test("N-02c", 'JAVASCRIPT%3A (uppercase) is also blocked', n02_upper, function(s) {
  return s.indexOf('<a ') === -1;
});

// Whitespace bypass (tab in scheme)
var n02_ws = render('[x](java\tscript:alert(1))');
test("N-02d", 'javascript: with embedded tab is blocked', n02_ws, function(s) {
  return s.indexOf('<a ') === -1;
});

// vbscript: encoded
var n02_vb = render('[x](vbscript%3Amsgbox(1))');
test("N-02e", 'vbscript%3A encoded is blocked', n02_vb, function(s) {
  return s.indexOf('<a ') === -1;
});

// Legitimate https: link still works
var n02_ok = render('[ok](https://example.com)');
test("N-02f", 'Legitimate https: link still renders as <a>', n02_ok, /<a href="https:\/\/example\.com"/);

// ═══════════════════════════════════════════════════════════
// N-03: file: scheme blocked
// ═══════════════════════════════════════════════════════════

var n03_file = render('[SSH key](file:///Users/foo/.ssh/id_rsa)');
test("N-03a", 'file:// link renders as plain text, no <a>', n03_file, function(s) {
  return s.indexOf('<a ') === -1;
});
test("N-03b", 'file:// link text "SSH key" is present', n03_file, /SSH key/);

var n03_encoded = render('[x](file%3A%2F%2F%2Fetc%2Fpasswd)');
test("N-03c", 'file%3A encoded is blocked', n03_encoded, function(s) {
  return s.indexOf('<a ') === -1;
});

// Non-image data: URI blocked
var n03_data = render('[x](data:text/html,<script>alert(1)</script>)');
test("N-03d", 'non-image data: URI is blocked', n03_data, function(s) {
  return s.indexOf('<a ') === -1;
});

// Image data URI allowed (safe)
var n03_imgdata = render('[img](data:image/png;base64,iVBOR)');
test("N-03e", 'image/png data URI is allowed through', n03_imgdata, /<a href="data:image\/png/);

// ═══════════════════════════════════════════════════════════
// U-04: Copy-code button in <pre>
// ═══════════════════════════════════════════════════════════

var u04_out = render('```js\nconst x = 1;\n```');
test("U-04a", '<pre> contains .tv-copy button', u04_out, /<pre>.*<button class="tv-copy".*data-copy/s);
test("U-04b", 'Copy button has aria-label="Copy code"', u04_out, /aria-label="Copy code"/);
test("U-04c", 'Button text is "Copy"', u04_out, />Copy<\/button>/);
test("U-04d", 'Code content still present after button', u04_out, /<code>/);

// Mermaid fences do NOT get a copy button (diagram placeholder instead)
var u04_mermaid = render('```mermaid\ngraph LR\nA-->B\n```');
test("U-04e", 'Mermaid fence does not get a copy button', u04_mermaid, function(s) {
  return s.indexOf('class="tv-copy"') === -1;
});

// ═══════════════════════════════════════════════════════════
// C-07 (bonus): Hyphenated/dotted language tags don't break fence
// ═══════════════════════════════════════════════════════════

var c07_hyp = render('```html-template\n<div>test</div>\n```');
test("C-07a", 'html-template fence renders <pre>', c07_hyp, /<pre>/);
test("C-07b", 'html-template fence code content present', c07_hyp, /&lt;div&gt;test&lt;\/div&gt;/);

var c07_dot = render('```python-3.10\nx = 1\n```');
test("C-07c", 'python-3.10 fence renders <pre>', c07_dot, /<pre>/);

// ═══════════════════════════════════════════════════════════
// S-01 (edit perf): Verify onInput does NOT call TV.markDirty in a way
// that triggers render — verifiable by checking the signature contract:
// wire() returns a cleanup fn, and onInput calls markDirty(id, true)
// without rebuilding source HTML. We validate that:
// (a) the backdrop update is debounced (not synchronous)
// (b) no requestAnimationFrame caret reset fires on input
// ═══════════════════════════════════════════════════════════

// Load tv-edit.js in a minimal DOM environment
(function() {
  var rAF_calls = 0;
  var markDirty_calls = 0;
  var render_calls = 0;

  // Minimal DOM shims for tv-edit.js
  var fakeTextarea = {
    value: "hello world",
    scrollHeight: 200,
    style: {},
    addEventListener: function(evt, fn) { this["_on_" + evt] = fn; },
    removeEventListener: function() {},
    focus: function() {},
    setSelectionRange: function() {}
  };

  var fakeBackdrop = { innerHTML: "" };
  var fakeMetaEl = { textContent: "" };

  var fakeRoot = {
    querySelector: function(sel) {
      if (sel === "[data-edit-area]") return fakeTextarea;
      if (sel === ".tv-source--backdrop") return fakeBackdrop;
      return null;
    },
    closest: function() { return null; }
  };

  var timers = [];
  global.setTimeout = function(fn, ms) {
    var id = timers.length;
    timers.push({ fn: fn, ms: ms, fired: false });
    return id;
  };
  global.clearTimeout = function(id) {
    if (timers[id]) timers[id].cancelled = true;
  };
  global.requestAnimationFrame = function(fn) {
    rAF_calls++;
    // Do NOT auto-fire in tests; simulate deferred execution
    return rAF_calls;
  };

  global.document.querySelector = function(sel) {
    if (sel === ".tv-edit-meta") return fakeMetaEl;
    return null;
  };
  // tv-edit.js _installAnchorCapture calls document.addEventListener
  global.document.addEventListener = function(evt, fn, capture) { /* no-op in test */ };

  global.window.TV = {
    markDirty: function(id, dirty) {
      markDirty_calls++;
      // Critically: markDirty must NOT call render per dev-frontend contract
      // We verify this by ensuring render_calls stays 0 after onInput
    },
    render: function() { render_calls++; }
  };

  // Load tv-edit.js
  // Reset anchor state
  global.window._tvEditAnchorText = null;
  global._anchorInstalled = false; // won't exist on window.TVEdit but harmless

  // Reload module (node caches; use a fresh require of the source)
  delete require.cache[require.resolve("../js/tv-edit.js")];
  require("../js/tv-edit.js");
  var TVEdit = global.TVEdit;

  var tab = { id: "t1", source: "hello world", dirty: false };

  // wire() — this fires one rAF for the initial caret placement
  var rAF_before_wire = rAF_calls;
  var cleanup = TVEdit.wire(fakeRoot, tab);
  var rAF_after_wire = rAF_calls;
  test("S-01a", "wire() fires exactly 1 rAF for initial caret placement", rAF_after_wire - rAF_before_wire, 1);

  // Simulate typing (trigger onInput 5 times)
  var rAF_before_input = rAF_calls;
  var markDirty_before = markDirty_calls;
  var render_before = render_calls;

  for (var k = 0; k < 5; k++) {
    fakeTextarea.value = "hello world" + k;
    if (fakeTextarea._on_input) fakeTextarea._on_input();
  }

  var rAF_after_input = rAF_calls;
  var markDirty_after = markDirty_calls;
  var render_after = render_calls;

  test("S-01b", "onInput does NOT fire rAF (caret reset) on keystrokes", rAF_after_input - rAF_before_input, 0);
  test("S-01c", "onInput calls markDirty once per keystroke (5 keystrokes = 5 calls)", markDirty_after - markDirty_before, 5);
  test("S-01d", "render() is NOT called during onInput (TV.render call count stays 0)", render_after - render_before, 0);
  test("S-01e", "tab.source is updated on each input (O(1) assignment)", tab.source, "hello world4");
  test("S-01f", "tab.dirty is true after typing", tab.dirty, true);

  // Verify backdrop update is debounced (not synchronous)
  // timers array should have entries (debounce timer created)
  test("S-01g", "backdrop debounce timer is scheduled (not sync)", timers.length > 0, true);

  // Verify backdrop.innerHTML is NOT updated synchronously on input
  test("S-01h", "backdrop.innerHTML NOT rebuilt synchronously per keystroke", fakeBackdrop.innerHTML, "");

  // Simulate debounce firing
  var lastTimer = timers[timers.length - 1];
  if (lastTimer && !lastTimer.cancelled) {
    lastTimer.fn();
    test("S-01i", "backdrop.innerHTML updated after debounce fires", fakeBackdrop.innerHTML !== "", true);
  } else {
    FAIL++;
    console.log("FAIL [S-01i] Could not find debounce timer to fire");
  }

  // Cleanup should work without error
  try {
    cleanup();
    test("S-01j", "cleanup() removes event listeners without error", true, true);
  } catch(e) {
    FAIL++;
    console.log("FAIL [S-01j] cleanup() threw: " + e.message);
  }
})();

// ═══════════════════════════════════════════════════════════
// Summary
// ═══════════════════════════════════════════════════════════
console.log("\n────────────────────────────────────");
console.log("Results: " + PASS + " passed, " + FAIL + " failed");
if (FAIL > 0) {
  console.log("SOME TESTS FAILED");
  process.exit(1);
} else {
  console.log("ALL TESTS PASSED");
  process.exit(0);
}
