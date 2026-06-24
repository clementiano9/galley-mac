/* ───────────────────────────────────────────────────────────
   tiny-viewer · diagram render-cache RUNTIME test harness (ISS-003)
   Run: node app/js/tv-markdown.diagrams.test.js

   Like tv-live.runtime.test.js, this LOADS and EXECUTES app/js/tv-markdown.js
   inside a hand-rolled minimal DOM + a deterministic FAKE CLOCK, installs a
   counting window.mermaid.render() spy returning a stub SVG, then drives the
   real render → resolve path and asserts on mermaid.render call-count.

   Guards the ISS-003 no-op re-render path:
     • initial load: a mermaid fence renders ONCE (render called, SVG injected)
     • viewer rebuild, SAME source: cache hit → render NOT called again
     • viewer rebuild, CHANGED source: cache miss → render called once more
     • theme/accent change, same source: signature busts cache → re-render

   No external deps (the repo has no package.json / node_modules).
   ─────────────────────────────────────────────────────────── */
'use strict';

var fs = require('fs');
var path = require('path');
var vm = require('vm');

/* ═══════════════════════════════════════════════════════════
   Test bookkeeping
   ═══════════════════════════════════════════════════════════ */
var results = {};
function grp(id) {
  if (!results[id]) results[id] = { pass: true, fails: [], checks: 0 };
  return results[id];
}
function check(id, label, condition, observed, expected) {
  var r = grp(id);
  r.checks++;
  if (!condition) {
    r.pass = false;
    r.fails.push(
      label +
        (expected !== undefined
          ? '  [expected: ' + JSON.stringify(expected) + ', observed: ' + JSON.stringify(observed) + ']'
          : observed !== undefined
          ? '  [observed: ' + JSON.stringify(observed) + ']'
          : '')
    );
  }
}

/* ═══════════════════════════════════════════════════════════
   FAKE CLOCK — virtual time, deterministic, no real waiting.
   tv-markdown.js schedules the diagram render via setTimeout(ms) plus an 8s
   per-diagram timeout; we virtualise both so advance() fires them on demand.
   ═══════════════════════════════════════════════════════════ */
function makeClock() {
  var now = 1000000;
  var seq = 1;
  var timers = [];
  function schedule(cb, delay) {
    var id = seq++;
    timers.push({ id: id, fireAt: now + (delay || 0), cb: cb });
    return id;
  }
  return {
    setTimeout: function (cb, delay) { return schedule(cb, delay); },
    clearTimeout: function (id) { timers = timers.filter(function (t) { return t.id !== id; }); },
    advance: function (ms) {
      var target = now + ms;
      var guard = 0;
      while (true) {
        if (guard++ > 100000) throw new Error('clock advance guard tripped');
        var due = timers
          .filter(function (t) { return t.fireAt <= target; })
          .sort(function (a, b) { return a.fireAt - b.fireAt; });
        if (due.length === 0) break;
        var t = due[0];
        now = t.fireAt;
        timers = timers.filter(function (x) { return x.id !== t.id; });
        t.cb();
      }
      now = target;
    },
    pendingCount: function () { return timers.length; },
  };
}

// Flush real microtasks (mermaid.render() returns a real Promise whose .then
// injection runs on the host microtask queue, independent of the fake clock).
function flush() { return new Promise(function (r) { setTimeout(r, 0); }); }

/* ═══════════════════════════════════════════════════════════
   MINIMAL DOM MOCK (tailored to the diagram resolve path)
   ═══════════════════════════════════════════════════════════ */
function makeClassList(el) {
  var set = el._classes;
  return {
    add: function () { for (var i = 0; i < arguments.length; i++) set[arguments[i]] = true; el._syncClassName(); },
    remove: function () { for (var i = 0; i < arguments.length; i++) delete set[arguments[i]]; el._syncClassName(); },
    toggle: function (c) { if (set[c]) { delete set[c]; } else { set[c] = true; } el._syncClassName(); return !!set[c]; },
    contains: function (c) { return !!set[c]; },
  };
}

function makeStyle() {
  var props = {};
  return {
    setProperty: function (k, v) { props[k] = v; },
    getPropertyValue: function (k) { return props[k] || ''; },
    removeProperty: function (k) { delete props[k]; },
  };
}

function Element(tagName) {
  this.tagName = (tagName || 'div').toUpperCase();
  this.children = [];
  this.parentNode = null;
  this._classes = {};
  this._attrs = {};
  this._textOverride = null;
  this.id = '';
  this.style = makeStyle();
  this.offsetWidth = 0;
  var self = this;
  this._syncClassName = function () { self._className = Object.keys(self._classes).join(' '); };
  this.classList = makeClassList(this);
  this._className = '';
}

Object.defineProperty(Element.prototype, 'className', {
  get: function () { return this._className; },
  set: function (v) {
    this._classes = {};
    String(v).split(/\s+/).forEach(function (c) { if (c) this._classes[c] = true; }, this);
    this._syncClassName();
  },
});

Object.defineProperty(Element.prototype, 'textContent', {
  get: function () {
    if (this._textOverride !== null) return this._textOverride;
    var out = '';
    this.children.forEach(function (c) { out += (c.nodeType === 3) ? c.text : c.textContent; });
    return out;
  },
  set: function (v) { this._textOverride = String(v); this.children = []; },
});

Object.defineProperty(Element.prototype, 'innerHTML', {
  get: function () { return this._innerHTML || ''; },
  set: function (html) {
    this._innerHTML = html;
    this.children = [];
    this._textOverride = null;
    parseInto(this, html);
  },
});

function makeTextNode(text) { return { nodeType: 3, text: text, textContent: text }; }

// Small HTML fragment parser sufficient for the diagram placeholder markup and
// a stub <svg> blob. The whole <svg>...</svg> is swallowed as one element (its
// internals are irrelevant to the cache path) so querySelector('svg') resolves.
function parseInto(parent, html) {
  var i = 0;
  var stack = [parent];
  function top() { return stack[stack.length - 1]; }
  while (i < html.length) {
    if (html[i] === '<') {
      var close = html.indexOf('>', i);
      if (close === -1) break;
      var tagContent = html.slice(i + 1, close);
      if (tagContent[0] === '/') {
        if (stack.length > 1) stack.pop();
        i = close + 1;
        continue;
      }
      var nameMatch = tagContent.match(/^([a-zA-Z0-9]+)/);
      var tag = nameMatch ? nameMatch[1] : 'span';
      var selfClosing = /\/$/.test(tagContent);
      if (tag === 'svg') {
        var svgEnd = html.indexOf('</svg>', i);
        var svgClose = svgEnd === -1 ? close + 1 : svgEnd + '</svg>'.length;
        var svgEl = new Element('svg');
        applyAttrs(svgEl, tagContent);
        top().appendChild(svgEl);
        i = svgClose;
        continue;
      }
      var el = new Element(tag);
      applyAttrs(el, tagContent);
      top().appendChild(el);
      if (!selfClosing) stack.push(el);
      i = close + 1;
    } else {
      var next = html.indexOf('<', i);
      if (next === -1) next = html.length;
      var text = html.slice(i, next);
      if (text.replace(/\s+/g, '').length || text.indexOf(' ') !== -1) {
        top().children.push(makeTextNode(text));
      }
      i = next;
    }
  }
}

function applyAttrs(el, tagContent) {
  var cls = tagContent.match(/class="([^"]*)"/);
  if (cls) el.className = cls[1];
  var idm = tagContent.match(/\sid="([^"]*)"/);
  if (idm) el.id = idm[1];
  var re = /(\bdata-[a-zA-Z0-9-]+)(?:="([^"]*)")?/g;
  var m;
  while ((m = re.exec(tagContent)) !== null) {
    el._attrs[m[1]] = m[2] === undefined ? '' : m[2];
  }
}

Element.prototype.setAttribute = function (k, v) {
  if (k === 'id') { this.id = String(v); return; }
  this._attrs[k] = String(v);
};
Element.prototype.getAttribute = function (k) {
  if (k === 'id') return this.id || null;
  return this._attrs[k] !== undefined ? this._attrs[k] : null;
};
Element.prototype.hasAttribute = function (k) { return this._attrs[k] !== undefined; };

Element.prototype.appendChild = function (child) {
  if (child.parentNode) {
    var old = child.parentNode.children.indexOf(child);
    if (old !== -1) child.parentNode.children.splice(old, 1);
  }
  child.parentNode = this;
  this.children.push(child);
  return child;
};
Element.prototype.removeChild = function (child) {
  var idx = this.children.indexOf(child);
  if (idx !== -1) this.children.splice(idx, 1);
  child.parentNode = null;
  return child;
};
Element.prototype.replaceWith = function (newNode) {
  var parent = this.parentNode;
  if (!parent) return;
  var idx = parent.children.indexOf(this);
  if (idx === -1) return;
  if (newNode.parentNode) {
    var o = newNode.parentNode.children.indexOf(newNode);
    if (o !== -1) newNode.parentNode.children.splice(o, 1);
  }
  newNode.parentNode = parent;
  parent.children.splice(idx, 1, newNode);
  this.parentNode = null;
};
Element.prototype.addEventListener = function (type, cb) {};
Element.prototype.getBoundingClientRect = function () { return { left: 0, top: 0, width: 0, height: 0 }; };

function descendants(el, out) {
  out = out || [];
  el.children.forEach(function (c) {
    if (c.nodeType === 3) return;
    out.push(c);
    descendants(c, out);
  });
  return out;
}

function matchesSimple(el, sel) {
  sel = sel.trim();
  var attrMatches = sel.match(/\[([^\]]+)\]/g) || [];
  var withoutAttrs = sel.replace(/\[[^\]]+\]/g, '');
  if (withoutAttrs) {
    var parts = withoutAttrs.split('.');
    var tagPart = parts[0];
    var classParts = parts.slice(1).filter(Boolean);
    if (tagPart && el.tagName.toLowerCase() !== tagPart.toLowerCase()) return false;
    for (var i = 0; i < classParts.length; i++) {
      if (!el._classes[classParts[i]]) return false;
    }
  }
  for (var j = 0; j < attrMatches.length; j++) {
    var inner = attrMatches[j].slice(1, -1);
    var eq = inner.indexOf('=');
    if (eq === -1) {
      if (!(inner in el._attrs)) return false;
    } else {
      var key = inner.slice(0, eq);
      var val = inner.slice(eq + 1).replace(/^["']|["']$/g, '');
      if (el._attrs[key] !== val) return false;
    }
  }
  return true;
}

function makeNodeList(arr) { arr.forEach = Array.prototype.forEach.bind(arr); return arr; }

function queryAll(root, selector) {
  // Comma groups (e.g. _centerSvgLabels selectors) — union of each part.
  if (selector.indexOf(',') !== -1) {
    var seen = [];
    selector.split(',').forEach(function (part) {
      queryAll(root, part).forEach(function (el) { if (seen.indexOf(el) === -1) seen.push(el); });
    });
    return makeNodeList(seen);
  }
  var segments = selector.trim().split(/\s+/);
  var matches;
  if (segments.length === 1) {
    matches = descendants(root).filter(function (el) { return matchesSimple(el, segments[0]); });
  } else {
    matches = descendants(root).filter(function (el) {
      if (!matchesSimple(el, segments[segments.length - 1])) return false;
      var segIdx = segments.length - 2;
      var anc = el.parentNode;
      while (anc && segIdx >= 0) {
        if (matchesSimple(anc, segments[segIdx])) segIdx--;
        anc = anc.parentNode;
      }
      return segIdx < 0;
    });
  }
  return makeNodeList(matches);
}

Element.prototype.querySelector = function (sel) {
  var list = queryAll(this, sel);
  return list.length ? list[0] : null;
};
Element.prototype.querySelectorAll = function (sel) { return queryAll(this, sel); };

/* ═══════════════════════════════════════════════════════════
   Build env + load tv-markdown.js into a vm sandbox.
   ═══════════════════════════════════════════════════════════ */
var MD_SRC = fs.readFileSync(path.join(__dirname, 'tv-markdown.js'), 'utf8');

function loadMarkdown() {
  var clock = makeClock();
  var documentEl = new Element('html');
  var headEl = new Element('head');
  documentEl.appendChild(headEl);

  // Counting mermaid spy. render() returns a real Promise resolving to a stub
  // SVG so the module's .then() injection path runs faithfully.
  var spy = { renderCalls: 0, renderedCodes: [], initCalls: 0 };
  var mermaid = {
    initialize: function () { spy.initCalls++; },
    render: function (id, code) {
      spy.renderCalls++;
      spy.renderedCodes.push(code);
      return Promise.resolve({ svg: '<svg id="' + id + '"></svg>' });
    },
  };

  var documentMock = {
    createElement: function (tag) { return new Element(tag); },
    querySelector: function (sel) { return documentEl.querySelector(sel); },
    querySelectorAll: function (sel) { return documentEl.querySelectorAll(sel); },
    documentElement: documentEl,
    head: headEl,
    body: documentEl,
  };

  // The script <script onload> is fired when appended to <head>; window.mermaid
  // is already present, mirroring the real loader after the bundle executes.
  headEl.appendChild = function (child) {
    Element.prototype.appendChild.call(headEl, child);
    if (child.tagName === 'SCRIPT' && typeof child.onload === 'function') {
      child.onload();
    }
    return child;
  };

  var windowMock = { document: documentMock, mermaid: mermaid };

  var sandbox = {
    window: windowMock,
    document: documentMock,
    getComputedStyle: function () { return { getPropertyValue: function () { return ''; } }; },
    setTimeout: clock.setTimeout,
    clearTimeout: clock.clearTimeout,
    btoa: function (s) { return Buffer.from(s, 'binary').toString('base64'); },
    atob: function (s) { return Buffer.from(s, 'base64').toString('binary'); },
    console: console,
  };
  sandbox.window = windowMock;
  sandbox.document = documentMock;
  sandbox.global = sandbox;

  var context = vm.createContext(sandbox);
  vm.runInContext(MD_SRC, context, { filename: 'tv-markdown.js' });

  return {
    clock: clock,
    spy: spy,
    documentEl: documentEl,
    renderMarkdown: windowMock.tvRenderMarkdown,
    resolveDiagrams: windowMock.tvResolveDiagrams,
    // Build a fresh viewer root (class .tv) carrying the rendered markdown HTML.
    // Mirrors render() rebuilding root.innerHTML on every tab-switch/theme/etc.
    setViewer: function (rootEl, html) {
      rootEl.innerHTML = html;
    },
  };
}

var MERMAID_A = ['```mermaid', 'graph TD', 'A-->B', '```'].join('\n');
var MERMAID_B = ['```mermaid', 'graph LR', 'X-->Y', 'Y-->Z', '```'].join('\n');

/* ═══════════════════════════════════════════════════════════
   ISS-003 — render once, cache hit on rebuild, miss on change,
   bust on theme/accent change.
   ═══════════════════════════════════════════════════════════ */
async function run() {
  var h = loadMarkdown();

  // A single .tv viewer root attached to the document, reused across rebuilds
  // (re-setting innerHTML simulates render()'s DOM teardown + rebuild).
  var root = new Element('div');
  root.className = 'tv';
  h.documentEl.appendChild(root);

  var htmlA = h.renderMarkdown(MERMAID_A);
  check('SETUP', 'mermaid fence produced a .tv-diagram[data-mermaid] placeholder',
    /tv-diagram[^>]*data-mermaid="/.test(htmlA), htmlA.slice(0, 80));

  // ── 1) Initial load: render ONCE, SVG injected ──────────────────────────
  h.setViewer(root, htmlA);
  h.resolveDiagrams(root, 0);   // delay 0 → schedule the deferred render at t=0
  h.clock.advance(0);           // fire the deferred render + loader
  await flush();                // run mermaid.render().then() injection

  check('ISS-003', 'initial load: mermaid.render called exactly once',
    h.spy.renderCalls === 1, h.spy.renderCalls, 1);
  check('ISS-003', 'initial load: SVG injected (.tv-diagram-viewport present)',
    root.querySelector('.tv-diagram-viewport') !== null,
    root.querySelector('.tv-diagram-viewport') ? 'present' : 'null', 'present');
  check('ISS-003', 'initial load: .dg-load shimmer replaced',
    root.querySelector('.dg-load') === null,
    root.querySelector('.dg-load') ? 'present' : 'null', 'null');

  // ── 2) Viewer rebuild, SAME source: cache HIT → no new render ────────────
  // Rebuild the DOM (fresh placeholder, identical source) as a tab-switch /
  // theme-neutral re-render would. The cache must inject synchronously.
  h.setViewer(root, htmlA);
  check('ISS-003', 'precondition: rebuild restored an unresolved placeholder',
    root.querySelector('.dg-load') !== null && root.querySelector('.tv-diagram-viewport') === null,
    root.querySelector('.dg-load') ? 'dg-load present' : 'missing');

  h.resolveDiagrams(root, 0);
  // No clock.advance / flush needed — a cache hit injects synchronously.
  check('ISS-003', 'rebuild (unchanged source): mermaid.render NOT called again (cache hit)',
    h.spy.renderCalls === 1, h.spy.renderCalls, 1);
  check('ISS-003', 'rebuild (unchanged source): SVG injected synchronously from cache',
    root.querySelector('.tv-diagram-viewport') !== null,
    root.querySelector('.tv-diagram-viewport') ? 'present' : 'null', 'present');
  check('ISS-003', 'rebuild (unchanged source): no pending timers (no shimmer schedule)',
    h.clock.pendingCount() === 0, h.clock.pendingCount(), 0);

  // ── 3) Changed source: cache MISS → render called once more ──────────────
  var htmlB = h.renderMarkdown(MERMAID_B);
  h.setViewer(root, htmlB);
  h.resolveDiagrams(root, 0);
  h.clock.advance(0);
  await flush();

  check('ISS-003', 'changed source: mermaid.render called again (count = 2)',
    h.spy.renderCalls === 2, h.spy.renderCalls, 2);
  check('ISS-003', 'changed source: new diagram source was the one rendered',
    /graph LR/.test(h.spy.renderedCodes[h.spy.renderedCodes.length - 1] || ''),
    h.spy.renderedCodes[h.spy.renderedCodes.length - 1], 'contains "graph LR"');

  // Re-resolving the changed source on a rebuild is itself a cache hit now.
  h.setViewer(root, htmlB);
  h.resolveDiagrams(root, 0);
  check('ISS-003', 'rebuild (changed source now cached): no extra render (count = 2)',
    h.spy.renderCalls === 2, h.spy.renderCalls, 2);

  // ── 4) Theme/accent change, SAME source: signature busts cache → re-render
  // Toggling the theme changes _renderSignature(), so the previously-cached
  // light-theme SVG must NOT be reused — mermaid re-renders for a correct
  // re-theme (acceptance criterion 3).
  root.classList.add('tv--dark');
  h.setViewer(root, htmlA);      // original source A, already cached under light
  h.resolveDiagrams(root, 0);
  h.clock.advance(0);
  await flush();
  check('ISS-003', 'theme change (same source): cache busted → re-render (count = 3)',
    h.spy.renderCalls === 3, h.spy.renderCalls, 3);

  // …and the dark-theme render is now itself cached (a second dark rebuild hits).
  h.setViewer(root, htmlA);
  h.resolveDiagrams(root, 0);
  check('ISS-003', 'theme change: second dark rebuild is a cache hit (count = 3)',
    h.spy.renderCalls === 3, h.spy.renderCalls, 3);
}

/* ═══════════════════════════════════════════════════════════
   REPORT
   ═══════════════════════════════════════════════════════════ */
run().then(function () {
  console.log('\n══════════════════════════════════════════════════════');
  console.log(' tiny-viewer diagram render-cache test harness (ISS-003)');
  console.log('══════════════════════════════════════════════════════\n');

  var order = ['SETUP', 'ISS-003'];
  var totalPass = 0, totalFail = 0;
  order.forEach(function (id) {
    var r = results[id];
    if (!r) { console.log('  SKIP  ' + id + ' — not exercised'); return; }
    var status = r.pass ? 'PASS' : 'FAIL';
    console.log('  ' + status + '  ' + id + '  (' + r.checks + ' checks)');
    if (!r.pass) r.fails.forEach(function (f) { console.log('         ↳ ' + f); });
    if (r.pass) totalPass++; else totalFail++;
  });

  console.log('\n──────────────────────────────────────────────────────');
  console.log(' groups passed: ' + totalPass + '   failed: ' + totalFail);
  console.log('──────────────────────────────────────────────────────\n');

  if (totalFail > 0) process.exit(1);
}).catch(function (e) {
  console.error('test harness threw:', e && e.stack ? e.stack : e);
  process.exit(1);
});
