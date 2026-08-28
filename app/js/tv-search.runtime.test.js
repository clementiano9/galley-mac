/* ───────────────────────────────────────────────────────────
   Galley · cross-tab search RUNTIME test harness (C-11)
   Run: node app/js/tv-search.runtime.test.js

   Unlike tv-search.test.js (grep/substring + light eval), this harness
   LOADS and EXECUTES app/js/tv-search.js inside a hand-rolled minimal DOM
   (real parent/child text-node structure) and drives the actual
   _internals.markOccurrence marking pass, asserting on the resulting DOM
   (a <mark data-find class="current"> exists, wraps the right text, and
   scrollIntoView was invoked). This is the "runtime test with a known
   needle in a long doc" the C-11 work item calls for.

   No external deps (the repo has no package.json / node_modules).
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

/* ═══════════════════════════════════════════════════════════
   MINIMAL DOM — real Text/Element distinction (childNodes vs children)
   ═══════════════════════════════════════════════════════════ */
function TextNode(text) {
  this.nodeType = 3;
  this.nodeName = '#text';
  this._text = text;
  this.parentNode = null;
}
Object.defineProperty(TextNode.prototype, 'textContent', {
  get: function () { return this._text; },
  set: function (v) { this._text = String(v); },
});

function makeClassList(el) {
  var set = el._classes;
  return {
    add: function () { for (var i = 0; i < arguments.length; i++) set[arguments[i]] = true; },
    remove: function () { for (var i = 0; i < arguments.length; i++) delete set[arguments[i]]; },
    toggle: function (c) { if (set[c]) { delete set[c]; } else { set[c] = true; } return !!set[c]; },
    contains: function (c) { return !!set[c]; },
  };
}

function Element(tagName) {
  this.nodeType = 1;
  this.tagName = (tagName || 'div').toUpperCase();
  this.nodeName = this.tagName;
  this.childNodes = [];
  this.parentNode = null;
  this._classes = {};
  this._attrs = {};
  this.classList = makeClassList(this);
  this._scrollIntoViewCalls = [];
  this.scrollIntoView = function (opts) { this._scrollIntoViewCalls.push(opts); };
}
Object.defineProperty(Element.prototype, 'className', {
  get: function () { return Object.keys(this._classes).join(' '); },
  set: function (v) {
    this._classes = {};
    String(v).split(/\s+/).forEach(function (c) { if (c) this._classes[c] = true; }, this);
  },
});
Object.defineProperty(Element.prototype, 'textContent', {
  get: function () {
    var out = '';
    this.childNodes.forEach(function (c) { out += c.textContent; });
    return out;
  },
  set: function (v) {
    this.childNodes = [new TextNode(String(v))];
    this.childNodes[0].parentNode = this;
  },
});
Element.prototype.appendChild = function (child) {
  child.parentNode = this;
  this.childNodes.push(child);
  return child;
};
Element.prototype.replaceChild = function (newNode, oldNode) {
  var idx = this.childNodes.indexOf(oldNode);
  if (idx === -1) throw new Error('replaceChild: oldNode not found');
  // newNode may be a DocumentFragment — splice its children in place.
  if (newNode._isFragment) {
    var frag = newNode.childNodes;
    var args = [idx, 1].concat(frag);
    Array.prototype.splice.apply(this.childNodes, args);
    frag.forEach(function (c) { c.parentNode = this; }, this);
  } else {
    this.childNodes[idx] = newNode;
    newNode.parentNode = this;
  }
  oldNode.parentNode = null;
  return oldNode;
};
Element.prototype.setAttribute = function (k, v) { this._attrs[k] = String(v); };
Element.prototype.getAttribute = function (k) { return this._attrs[k] !== undefined ? this._attrs[k] : null; };
Element.prototype.querySelector = function (sel) {
  // Only ever called with '.md' (class) or 'mark' (tag) in this harness.
  var isClass = sel.charAt(0) === '.';
  var target = isClass ? sel.slice(1) : sel.toUpperCase();
  var found = null;
  (function walk(el) {
    if (found) return;
    el.childNodes.forEach(function (c) {
      if (found || c.nodeType !== 1) return;
      var match = isClass ? (c._classes && c._classes[target]) : (c.tagName === target);
      if (match) { found = c; return; }
      walk(c);
    });
  })(this);
  return found;
};

function DocumentFragment() {
  this.nodeType = 11;
  this._isFragment = true;
  this.childNodes = [];
}
DocumentFragment.prototype.appendChild = function (child) {
  this.childNodes.push(child);
  return child;
};

var documentMock = {
  createElement: function (tag) { return new Element(tag); },
  createTextNode: function (text) { return new TextNode(text); },
  createDocumentFragment: function () { return new DocumentFragment(); },
  activeElement: null,
  addEventListener: function () {},
  removeEventListener: function () {},
};

var windowMock = { TV_ICONS: {}, document: documentMock };

/* ═══════════════════════════════════════════════════════════
   Build a paragraph of real text nodes containing a needle N times,
   spread across separate "line" elements (mirrors rendered <p> blocks).
   ═══════════════════════════════════════════════════════════ */
function buildDoc(paragraphs) {
  var md = new Element('div');
  md.className = 'md';
  paragraphs.forEach(function (text) {
    var p = new Element('p');
    p.appendChild(new TextNode(text));
    md.appendChild(p);
  });
  return md;
}

/* ═══════════════════════════════════════════════════════════
   Load tv-search.js into a vm sandbox and expose its private fns.
   ═══════════════════════════════════════════════════════════ */
var SEARCH_SRC = fs.readFileSync(path.join(__dirname, 'tv-search.js'), 'utf8');
var marker = 'window.TVSearch = TVSearch;';
if (SEARCH_SRC.indexOf(marker) === -1) {
  console.error('FAIL  tv-search.js export marker not found — cannot instrument');
  process.exit(1);
}
var instrumented = SEARCH_SRC.replace(
  marker,
  marker + '\n  globalThis.__TVSEARCH_RUNTIME_TEST__ = { markOccurrence: _markOccurrence, collectTextNodes: _collectTextNodes };'
);

var sandbox = {
  window: windowMock,
  document: documentMock,
  console: console,
  requestAnimationFrame: function (cb) { cb(); },
  setTimeout: setTimeout,
  clearTimeout: clearTimeout,
  globalThis: {},
};
sandbox.global = sandbox;
var context = vm.createContext(sandbox);
vm.runInContext(instrumented, context, { filename: 'tv-search.js' });
var api = sandbox.globalThis.__TVSEARCH_RUNTIME_TEST__;

assert('tv-search.js loads and exposes _markOccurrence for testing', api && typeof api.markOccurrence === 'function');

/* ═══════════════════════════════════════════════════════════
   C-11 — a known needle in a long doc: the mark exists and is centred.
   ═══════════════════════════════════════════════════════════ */
(function testKnownNeedle() {
  var paras = [];
  for (var i = 0; i < 200; i++) paras.push('Filler paragraph number ' + i + ' with nothing special.');
  paras.push('Here is the UNIQUENEEDLE right in the middle of the document.');
  for (var j = 200; j < 400; j++) paras.push('More filler paragraph number ' + j + '.');

  var mdEl = buildDoc(paras);
  var ok = api.markOccurrence(mdEl, 'UNIQUENEEDLE', 0);
  assert('C-11: markOccurrence finds the sole occurrence (returns true)', ok === true, ok);

  var mark = mdEl.querySelector('mark');
  assert('C-11: a <mark data-find class="current"> exists after marking',
    !!mark && mark.getAttribute('data-find') === '' && mark._classes.current === true,
    mark ? mark.className : 'no mark');
  assert('C-11: the mark wraps the exact matched text',
    mark && mark.textContent === 'UNIQUENEEDLE', mark && mark.textContent);
  assert('C-11: scrollIntoView({block:"center"}) was called on the mark',
    mark && mark._scrollIntoViewCalls.length === 1 && mark._scrollIntoViewCalls[0].block === 'center',
    mark && JSON.stringify(mark._scrollIntoViewCalls));
})();

/* ═══════════════════════════════════════════════════════════
   C-11 — multiple occurrences: the Nth (0-based) occurrence is the one
   marked, not always the first.
   ═══════════════════════════════════════════════════════════ */
(function testOccurrenceIndex() {
  // P1-3: a soft-wrapped source paragraph renders as ONE text node, and that
  // node can hold more than one match — each match must get its own
  // occurrence index (one-per-MATCH), not one-per-node. "alpha one alpha"
  // holds two matches (occurrences 0 and 1) before "alpha two" (occurrence 2).
  var mdEl = buildDoc([
    'alpha one alpha',      // occurrences 0 and 1 (both in this one node)
    'nothing here',
    'alpha two',            // occurrence 2
    'alpha three',          // occurrence 3
  ]);
  var ok = api.markOccurrence(mdEl, 'alpha', 2);
  assert('C-11: occurrence index selects the correct paragraph (not the first match)',
    ok === true, ok);
  var mark = mdEl.querySelector('mark');
  var markPara = mark && mark.parentNode;
  assert('C-11: occurrence 2 lands on "alpha two" (not "alpha three" — that would '
       + 'mean occurrences were still counted one-per-node)',
    markPara && markPara.textContent.indexOf('alpha two') !== -1,
    markPara && markPara.textContent);
})();

(function testMultipleMatchesInOneNode() {
  // P1-3 regression: _runSearch now emits one hit per MATCH (tv-app.js's
  // _runFind already worked this way); _markOccurrence must count the same
  // way or the two sides' occurrence indices diverge on ordinary multi-line
  // paragraphs. Prove a single node with 3 matches resolves its 3rd (index 2).
  var mdEl = buildDoc(['alpha one alpha two alpha three']);
  var ok = api.markOccurrence(mdEl, 'alpha', 2);
  assert('C-11: the 3rd match inside one multi-match node is found', ok === true, ok);
  var mark = mdEl.querySelector('mark');
  // Minimal DOM stub has no nextSibling — read the parent's childNodes.
  var kids = mark && mark.parentNode && mark.parentNode.childNodes;
  var after = kids && kids[kids.indexOf(mark) + 1];
  assert('C-11: it is the 3rd "alpha" (immediately followed by " three")',
    !!after && after.textContent.indexOf(' three') === 0,
    after && after.textContent);
})();

/* ═══════════════════════════════════════════════════════════
   C-11 — not found: returns false so the caller can fall back to the
   proportional scroll, rather than throwing or marking the wrong text.
   ═══════════════════════════════════════════════════════════ */
(function testNotFound() {
  var mdEl = buildDoc(['no match anywhere in this paragraph']);
  var ok = api.markOccurrence(mdEl, 'zzz-absent', 0);
  assert('C-11: an absent needle returns false (fallback path)', ok === false, ok);

  var mdEl2 = buildDoc(['alpha only once']);
  var ok2 = api.markOccurrence(mdEl2, 'alpha', 3); // occurrence index beyond what exists
  assert('C-11: an out-of-range occurrence index returns false', ok2 === false, ok2);
})();

/* ═══════════════════════════════════════════════════════════
   C-11 — case-insensitive matching (mirrors _runSearch's lowercase compare).
   ═══════════════════════════════════════════════════════════ */
(function testCaseInsensitive() {
  var mdEl = buildDoc(['The Quick Brown Fox']);
  var ok = api.markOccurrence(mdEl, 'quick brown', 0);
  assert('C-11: matching is case-insensitive', ok === true, ok);
  var mark = mdEl.querySelector('mark');
  assert('C-11: the marked text preserves the SOURCE case ("Quick Brown")',
    mark && mark.textContent === 'Quick Brown', mark && mark.textContent);
})();

console.log('\n' + (fail === 0 ? 'ALL PASSED' : 'FAILURES: ' + fail) + ' (' + pass + ' passed, ' + fail + ' failed)\n');
if (fail > 0) process.exit(1);
