/* ───────────────────────────────────────────────────────────
   tiny-viewer · live-watch RUNTIME test harness (DR-65–71)
   Run: node app/js/tv-live.runtime.test.js

   Unlike tv-round5.test.js (grep/substring assertions), this harness
   actually LOADS and EXECUTES app/js/tv-live.js inside a hand-rolled
   minimal DOM + a deterministic FAKE CLOCK, then drives real scenarios
   and asserts on the live DOM (textContent / classList) the module
   produces. This catches runtime bugs that string-matching cannot.

   No external deps (the repo has no package.json / node_modules).
   Strategy:
     - Minimal DOM mock: createElement / querySelector(All) / classList /
       textContent / appendChild / addEventListener / matchMedia.
     - Fake clock: Date.now() + setTimeout/clearTimeout/setInterval are
       virtualised so we can jump to t=4s, 65s, 95s, 1h instantly.
     - tv-live.js is evaluated via `vm` with our mocks as the sandbox
       globals, so its IIFE runs against our DOM and clock.
   ─────────────────────────────────────────────────────────── */
'use strict';

var fs = require('fs');
var path = require('path');
var vm = require('vm');

/* ═══════════════════════════════════════════════════════════
   Test bookkeeping
   ═══════════════════════════════════════════════════════════ */
var results = {}; // DR id -> { pass, fails: [] }
function dr(id) {
  if (!results[id]) results[id] = { pass: true, fails: [], checks: 0 };
  return results[id];
}
function check(id, label, condition, observed, expected) {
  var r = dr(id);
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
   ═══════════════════════════════════════════════════════════ */
function makeClock() {
  var now = 1000000; // arbitrary epoch base (ms)
  var seq = 1;
  var timers = []; // { id, fireAt, cb, interval, every }

  function schedule(cb, delay, interval, every) {
    var id = seq++;
    timers.push({ id: id, fireAt: now + (delay || 0), cb: cb, interval: !!interval, every: every || delay || 0 });
    return id;
  }
  var api = {
    nowFn: function () { return now; },
    setTimeout: function (cb, delay) { return schedule(cb, delay, false); },
    clearTimeout: function (id) { timers = timers.filter(function (t) { return t.id !== id; }); },
    setInterval: function (cb, delay) { return schedule(cb, delay, true, delay); },
    clearInterval: function (id) { timers = timers.filter(function (t) { return t.id !== id; }); },
    // advance virtual time by ms, firing any timers due along the way
    advance: function (ms) {
      var target = now + ms;
      // Fire timers in chronological order, re-evaluating after each fire
      // since callbacks may schedule new timers (adaptive tick).
      var guard = 0;
      while (true) {
        if (guard++ > 100000) throw new Error('clock advance guard tripped (runaway timers)');
        var due = timers
          .filter(function (t) { return t.fireAt <= target; })
          .sort(function (a, b) { return a.fireAt - b.fireAt; });
        if (due.length === 0) break;
        var t = due[0];
        now = t.fireAt; // move virtual clock to the fire time
        if (t.interval) {
          t.fireAt = now + t.every; // reschedule before firing
          t.cb();
        } else {
          timers = timers.filter(function (x) { return x.id !== t.id; });
          t.cb();
        }
      }
      now = target;
    },
    get time() { return now; },
    pendingCount: function () { return timers.length; },
  };
  return api;
}

/* ═══════════════════════════════════════════════════════════
   MINIMAL DOM MOCK
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

function Element(tagName) {
  this.tagName = (tagName || 'div').toUpperCase();
  this.children = [];
  this.parentNode = null;
  this._classes = {};
  this._attrs = {};
  this._textOverride = null; // set when textContent assigned directly
  this._listeners = {};
  this.offsetWidth = 0; // referenced by tv-live.js reflow hack (void el.offsetWidth)
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
    // Concatenate descendant text (rough but adequate)
    var out = '';
    this.children.forEach(function (c) {
      out += (c.nodeType === 3) ? c.text : c.textContent;
    });
    return out;
  },
  set: function (v) {
    this._textOverride = String(v);
    this.children = []; // setting textContent clears children (DOM semantics)
  },
});

// innerHTML setter — a tiny parser sufficient for buildStatusBar()'s markup.
Object.defineProperty(Element.prototype, 'innerHTML', {
  get: function () { return this._innerHTML || ''; },
  set: function (html) {
    this._innerHTML = html;
    this.children = [];
    this._textOverride = null;
    parseInto(this, html);
  },
});

function makeTextNode(text) {
  return { nodeType: 3, text: text, textContent: text };
}

// Extremely small HTML fragment parser. Handles the exact shape produced by
// buildStatusBar(): nested <span>, a self-contained <svg>...</svg> blob, class
// and data-* attributes, and bare text between tags. Not a general parser; it
// is tailored to the markup tv-live.js emits.
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
        // closing tag
        if (stack.length > 1) stack.pop();
        i = close + 1;
        continue;
      }
      // svg subtree: swallow it whole as one element so its inner <path/> etc.
      // don't confuse the parser. We only need svg to exist, not be traversable.
      var nameMatch = tagContent.match(/^([a-zA-Z0-9]+)/);
      var tag = nameMatch ? nameMatch[1] : 'span';
      var selfClosing = /\/$/.test(tagContent);
      if (tag === 'svg') {
        var svgEnd = html.indexOf('</svg>', i);
        var svgClose = svgEnd === -1 ? close : svgEnd + '</svg>'.length;
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
      if (text.trim().length || /\s/.test(text)) {
        // preserve meaningful text (incl. the literal "Live", "Pin scroll")
        if (text.replace(/\s+/g, '').length || text.indexOf(' ') !== -1) {
          top().children.push(makeTextNode(text));
        }
      }
      i = next;
    }
  }
}

function applyAttrs(el, tagContent) {
  // class="..."
  var cls = tagContent.match(/class="([^"]*)"/);
  if (cls) el.className = cls[1];
  // data-* boolean / valued attributes (data-elapsed, data-tv-pin, data-stream)
  var re = /(\bdata-[a-zA-Z0-9-]+)(?:="([^"]*)")?/g;
  var m;
  while ((m = re.exec(tagContent)) !== null) {
    el._attrs[m[1]] = m[2] === undefined ? '' : m[2];
  }
}

Element.prototype.setAttribute = function (k, v) { this._attrs[k] = String(v); };
Element.prototype.getAttribute = function (k) { return this._attrs[k] !== undefined ? this._attrs[k] : null; };
Element.prototype.hasAttribute = function (k) { return this._attrs[k] !== undefined; };

Element.prototype.appendChild = function (child) {
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
Element.prototype.addEventListener = function (type, cb) {
  (this._listeners[type] = this._listeners[type] || []).push(cb);
};
Element.prototype.dispatch = function (type, evt) {
  (this._listeners[type] || []).forEach(function (cb) { cb(evt || {}); });
};

// Recursively collect all element descendants (excludes text nodes).
function descendants(el, out) {
  out = out || [];
  el.children.forEach(function (c) {
    if (c.nodeType === 3) return;
    out.push(c);
    descendants(c, out);
  });
  return out;
}

// Match an element against a simple selector: tag, .class, [attr], or a
// space-separated descendant combinator of those. Sufficient for the selectors
// tv-live.js uses: '.tv-viewer', '.tv-scroll', '.tv-live-status',
// '.live-pill', '.blip', '[data-elapsed]', '[data-tv-pin]',
// '.tv-writing-line[data-stream]'.
function matchesSimple(el, sel) {
  sel = sel.trim();
  // attribute + class combo like .tv-writing-line[data-stream]
  var attrMatches = sel.match(/\[([^\]]+)\]/g) || [];
  var withoutAttrs = sel.replace(/\[[^\]]+\]/g, '');
  // class / tag part
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
    var inner = attrMatches[j].slice(1, -1); // strip [ ]
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

function queryAll(root, selector) {
  // Support descendant combinator (single space, no commas in tv-live.js usage)
  var segments = selector.trim().split(/\s+/);
  var matches;
  if (segments.length === 1) {
    matches = descendants(root).filter(function (el) { return matchesSimple(el, segments[0]); });
  } else {
    // descendant: find candidates for last segment whose ancestor chain satisfies the rest
    var all = descendants(root);
    matches = all.filter(function (el) {
      if (!matchesSimple(el, segments[segments.length - 1])) return false;
      // walk ancestors satisfying preceding segments in order (right-to-left)
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

function makeNodeList(arr) {
  // Array-like with forEach (tv-live.js uses .forEach on querySelectorAll results)
  arr.forEach = Array.prototype.forEach.bind(arr);
  return arr;
}

Element.prototype.querySelector = function (sel) {
  var list = queryAll(this, sel);
  return list.length ? list[0] : null;
};
Element.prototype.querySelectorAll = function (sel) {
  return queryAll(this, sel);
};

/* ═══════════════════════════════════════════════════════════
   Document + window
   ═══════════════════════════════════════════════════════════ */
function makeEnvironment(clock, opts) {
  opts = opts || {};
  var documentEl = new Element('html');

  var documentMock = {
    createElement: function (tag) { return new Element(tag); },
    querySelector: function (sel) { return documentEl.querySelector(sel); },
    querySelectorAll: function (sel) { return documentEl.querySelectorAll(sel); },
    body: documentEl,
    _root: documentEl,
  };

  var windowMock = {
    matchMedia: function (q) {
      return { matches: opts.reducedMotion ? /reduce/.test(q) : false, media: q };
    },
    document: documentMock,
  };

  // Fake Date with virtualised now()
  function FakeDate(arg) {
    if (!(this instanceof FakeDate)) return new Date(clock.nowFn()).toString();
    this._t = arg === undefined ? clock.nowFn() : arg;
  }
  FakeDate.now = function () { return clock.nowFn(); };
  FakeDate.prototype.getTime = function () { return this._t; };

  return { window: windowMock, document: documentMock, FakeDate: FakeDate, documentEl: documentEl };
}

/* ═══════════════════════════════════════════════════════════
   Build a fresh TV mock + load tv-live.js into a vm sandbox.
   ═══════════════════════════════════════════════════════════ */
var LIVE_SRC = fs.readFileSync(path.join(__dirname, 'tv-live.js'), 'utf8');

function loadLive(opts) {
  opts = opts || {};
  var clock = makeClock();
  var env = makeEnvironment(clock, opts);

  // ── Build the viewer DOM the module expects: root.tv-viewer > .tv-scroll ──
  var root = new Element('div'); root.className = 'tv';
  var viewer = new Element('div'); viewer.className = 'tv-viewer';
  var scroll = new Element('div'); scroll.className = 'tv-scroll';
  viewer.appendChild(scroll);
  root.appendChild(viewer);
  env.documentEl.appendChild(root);

  // ── TVNative mock (native FSEvents mode) ──
  var nativeCalls = { startWatch: 0, stopWatch: 0 };
  var TVNative = {
    available: true,
    startWatch: function () { nativeCalls.startWatch++; },
    stopWatch: function () { nativeCalls.stopWatch++; },
    showToast: function () {},
  };

  // ── TV state + event bus mock ──
  var listeners = {};
  var TV = {
    state: { tabs: [], activeId: null, mode: 'reading' },
    el: function () { return root; },
    render: function () {
      if (opts.renderRebuilds) {
        // Simulate DOM teardown: rebuild the viewer subtree (status bar lost).
        root.children = [];
        viewer = new Element('div'); viewer.className = 'tv-viewer';
        scroll = new Element('div'); scroll.className = 'tv-scroll';
        viewer.appendChild(scroll);
        root.appendChild(viewer);
        TV._viewer = viewer;
      }
    },
    on: function (event, cb) { (listeners[event] = listeners[event] || []).push(cb); },
    fire: function (event, payload) { (listeners[event] || []).forEach(function (cb) { cb(payload); }); },
  };
  TV._viewer = viewer;

  // ── Sandbox globals ──
  var sandbox = {
    window: env.window,
    document: env.document,
    Date: env.FakeDate,
    setTimeout: clock.setTimeout,
    clearTimeout: clock.clearTimeout,
    setInterval: clock.setInterval,
    clearInterval: clock.clearInterval,
    console: console,
  };
  env.window.TV = TV;
  env.window.TVNative = TVNative;
  // tv-live.js guards with `window.TVNative` but then dereferences the BARE
  // global `TVNative` (lines 411/413/471) — and bare `TV`/`document`/`window`
  // elsewhere. In a browser these resolve off the global object; in the vm
  // sandbox we must expose them as sandbox globals too, or the IIFE throws
  // ReferenceError. (Mirrors real <script> global scope.)
  sandbox.TV = TV;
  sandbox.TVNative = TVNative;
  sandbox.global = sandbox;

  var context = vm.createContext(sandbox);
  vm.runInContext(LIVE_SRC, context, { filename: 'tv-live.js' });

  return {
    clock: clock,
    TV: TV,
    TVNative: TVNative,
    nativeCalls: nativeCalls,
    TVLive: env.window.TVLive,
    root: root,
    getViewer: function () { return root.querySelector('.tv-viewer'); },
    getStatus: function () { return root.querySelector('.tv-live-status'); },
    getElapsedText: function () {
      var s = root.querySelector('.tv-live-status');
      if (!s) return null;
      var e = s.querySelector('[data-elapsed]');
      return e ? e.textContent : null;
    },
    getPill: function () {
      var s = root.querySelector('.tv-live-status');
      return s ? s.querySelector('.live-pill') : null;
    },
    getBlip: function () {
      var s = root.querySelector('.tv-live-status');
      return s ? s.querySelector('.blip') : null;
    },
    getPillText: function () {
      var p = this.getPill ? null : null;
      var pill = root.querySelector('.tv-live-status .live-pill');
      return pill ? pill.textContent : null;
    },
  };
}

// A live native tab, active by default.
function makeLiveTab(id) {
  return { id: id || 'tab1', live: true, nativePath: '/tmp/file.md', name: 'file.md', dirty: false };
}

/* ═══════════════════════════════════════════════════════════
   SANITY: module loaded and exports present
   ═══════════════════════════════════════════════════════════ */
(function sanity() {
  var h = loadLive();
  check('LOAD', 'tv-live.js evaluates and exports window.TVLive',
    h.TVLive && typeof h.TVLive.start === 'function', !!h.TVLive);
  check('LOAD', 'exports start/stop/stopAll/refresh/notifyChange',
    h.TVLive && ['start', 'stop', 'stopAll', 'refresh', 'notifyChange']
      .every(function (k) { return typeof h.TVLive[k] === 'function'; }), true);
})();

/* ═══════════════════════════════════════════════════════════
   DR-66 — bounded recency label across all buckets
   <3s→"updating…"; 3–59s→"updated Ns ago"; 1–59m→"updated Nm ago";
   ≥1h→"updated Nh ago". Never unbounded decimals, never "60s".

   DR-66 is about the FORMATTER's bucketing (a pure function of the
   delta since lastModTime). We therefore force a FRESH paint at each
   target time so the displayed label reflects the formatter evaluated
   at exactly that delta. The fresh paint is produced via the real
   public 'render' re-inject path (injectStatusBarOnly → paintRecency →
   formatRecency), reading the true lastModTime — NOT a separate copy of
   the formula.

   NOTE: a SEPARATE block below (DR-66-CADENCE) measures the *passive*
   tick staleness, which is a real behaviour worth surfacing distinctly:
   in the minutes range the label is only repainted ~once a minute, so
   the passively-displayed value can lag the true elapsed by up to ~60s.
   ═══════════════════════════════════════════════════════════ */
(function testDR66Format() {
  var h = loadLive();
  var tab = makeLiveTab();
  h.TV.state.tabs = [tab];
  h.TV.state.activeId = tab.id;
  h.TVLive.start(tab.id); // native mode injects status bar, stamps lastModTime=now

  // Force a fresh repaint at the *current* virtual time by firing the render
  // event (the real L-04 re-inject path → paintRecency reads Date.now()-lastModTime).
  function freshPaint() { h.TV.fire('render'); h.clock.advance(0); }

  // Auto-hide note: the bar is removed at the 90s settle threshold, so the live
  // label is only ever VISIBLE up to ~90s. Past that the minutes>1m / hours
  // buckets are unreachable in the UI by design — so these cases stop at 89s
  // (the last second the label is shown). formatRecency's higher buckets remain
  // in code for the 60–90s window + defensive use.
  var cases = [
    { at: 1000,    expect: 'updating…',        why: '<3s lower' },
    { at: 2000,    expect: 'updating…',        why: '<3s upper' },
    { at: 2999,    expect: 'updating…',        why: '<3s top edge' },
    { at: 3000,    expect: 'updated 3s ago',   why: '3s lower edge' },
    { at: 4000,    expect: 'updated 4s ago',   why: '3-59s' },
    { at: 30000,   expect: 'updated 30s ago',  why: '3-59s mid' },
    { at: 59000,   expect: 'updated 59s ago',  why: '3-59s upper' },
    { at: 60000,   expect: 'updated 1m ago',   why: 'minute boundary (NOT 60s)' },
    { at: 65000,   expect: 'updated 1m ago',   why: '1m' },
    { at: 89000,   expect: 'updated 1m ago',   why: 'last visible second pre auto-hide' },
  ];

  var prev = 0;
  cases.forEach(function (c) {
    h.clock.advance(c.at - prev);
    prev = c.at;
    freshPaint();
    var got = h.getElapsedText();
    check('DR-66', 'fresh paint at t=' + (c.at / 1000) + 's (' + c.why + ')',
      got === c.expect, got, c.expect);
    // Guardrails: never an unbounded decimal-seconds string, never "60s ago"
    if (got) {
      check('DR-66', 'at t=' + (c.at / 1000) + 's: no decimal-seconds literal',
        !/updated \d+\.\d+s ago/.test(got), got);
      check('DR-66', 'at t=' + (c.at / 1000) + 's: never "updated 60s ago"',
        got !== 'updated 60s ago', got);
    }
  });
  h.TVLive.stop(tab.id);
})();

/* ── DR-66 passive-cadence observation (reported separately) ──
   With NO fresh paint forced, how stale can the passively-displayed
   label get? This is a behavioural characterisation, not a spec pass.
   We assert only the bounded-format guardrails on the passive label;
   the staleness magnitude is printed for the report. */
var DR66_CADENCE = { samples: [] };
(function testDR66Cadence() {
  var h = loadLive();
  var tab = makeLiveTab();
  h.TV.state.tabs = [tab];
  h.TV.state.activeId = tab.id;
  h.TVLive.start(tab.id);

  // Only sample < 90s — the only window the label is visible before auto-hide.
  var sampleTimes = [4000, 30000, 59000, 65000, 89000];
  var prev = 0;
  sampleTimes.forEach(function (at) {
    h.clock.advance(at - prev); prev = at;
    var got = h.getElapsedText();
    DR66_CADENCE.samples.push({ t: at, label: got });
    // The passive label must STILL obey the bounded-format guardrails.
    if (got) {
      check('DR-66', 'passive label well-formed at t=' + (at / 1000) + 's: no decimals',
        !/updated \d+\.\d+s ago/.test(got), got);
      check('DR-66', 'passive label well-formed at t=' + (at / 1000) + 's: not "60s"',
        got !== 'updated 60s ago', got);
      check('DR-66', 'passive label well-formed at t=' + (at / 1000) + 's: matches a known bucket',
        /^(updating…|updated \d+s ago|updated \d+m ago|updated \d+h ago)$/.test(got), got);
    }
  });
  h.TVLive.stop(tab.id);
})();

/* ═══════════════════════════════════════════════════════════
   DR-67 — a detected change → label "updating…" AND blip re-pulses
   (gets is-updating). Drive via the public native path: refresh().
   ═══════════════════════════════════════════════════════════ */
(function testDR67() {
  var h = loadLive();
  var tab = makeLiveTab();
  h.TV.state.tabs = [tab];
  h.TV.state.activeId = tab.id;
  h.TVLive.start(tab.id);

  // Move well past 3s so label is "updated Ns ago" and (if it had gone idle)
  // is-updating could be cleared — then fire a change and assert reset.
  h.clock.advance(40000);
  check('DR-67', 'precondition: label shows elapsed before change',
    h.getElapsedText() === 'updated 40s ago', h.getElapsedText(), 'updated 40s ago');

  // Simulate a detected disk change on the active native tab.
  h.TVLive.refresh();

  check('DR-67', 'after change: label resets to "updating…"',
    h.getElapsedText() === 'updating…', h.getElapsedText(), 'updating…');
  var blip = h.getBlip();
  check('DR-67', 'after change: blip has class is-updating (re-pulse)',
    !!(blip && blip.classList.contains('is-updating')),
    blip ? blip.className : null, 'is-updating present');
  var pill = h.getPill();
  check('DR-67', 'after change: pill NOT idle',
    !!(pill && !pill.classList.contains('idle')),
    pill ? pill.className : null);

  // And a change AFTER the bar auto-hid must re-reveal it pulsing (the harder
  // case). Advance >90s so the passive tick auto-hides the bar, then a new change
  // (refresh) must bring it back with "updating…" + a pulsing blip.
  h.clock.advance(95000); // > 90s → passive tick auto-hides
  h.clock.advance(300);   // let the fade-out removal complete
  check('DR-67', 'precondition: bar auto-hidden after settle',
    h.getStatus() === null, h.getStatus() ? 'present' : 'null', 'null');
  h.TVLive.refresh();
  var blip2 = h.getBlip();
  check('DR-67', '2nd change after auto-hide: bar re-revealed + blip pulses',
    !!(blip2 && blip2.classList.contains('is-updating')),
    blip2 ? blip2.className : null, 'is-updating present');
  check('DR-67', '2nd change after auto-hide: label back to "updating…"',
    h.getElapsedText() === 'updating…', h.getElapsedText(), 'updating…');

  h.TVLive.stop(tab.id);
})();

/* ═══════════════════════════════════════════════════════════
   DR-68 (auto-hide variant) — 90s after the last change the status bar is
   REMOVED from the DOM (supersedes the original "dim to a steady dot"). The
   watch stays armed: a later change re-reveals the bar pulsing. Switching to a
   tab that already settled shows nothing.
   ═══════════════════════════════════════════════════════════ */
var DR68_LATENCY = { firstHideAtMs: null };
(function testDR68AutoHide() {
  var h = loadLive();
  var tab = makeLiveTab();
  h.TV.state.tabs = [tab];
  h.TV.state.activeId = tab.id;
  h.TVLive.start(tab.id);

  // Just below the settle threshold (89s): bar present, blip still pulsing.
  h.clock.advance(89000);
  check('DR-68', 'at 89s (<90s): bar still present',
    h.getStatus() !== null, h.getStatus() ? 'present' : 'null', 'present');
  var blipBefore = h.getBlip();
  check('DR-68', 'at 89s: blip still pulsing (is-updating present)',
    !!(blipBefore && blipBefore.classList.contains('is-updating')),
    blipBefore ? blipBefore.className : null);

  // Cross the threshold passively → auto-hide removes the bar (after the fade).
  h.clock.advance(2000);  // → 91s: tick fires autoHideStatusBar
  h.clock.advance(300);   // fade-out completes; node detached from DOM
  check('DR-68', 'at ~91s: settled bar auto-hidden (removed from DOM)',
    h.getStatus() === null, h.getStatus() ? 'present' : 'null', 'null');

  // The watch is still ARMED (not stopped): a later disk change re-reveals it.
  h.TVLive.refresh();
  check('DR-68', 'after auto-hide: a change re-reveals the bar',
    h.getStatus() !== null, h.getStatus() ? 'present' : 'null', 'present');
  check('DR-68', 'after re-reveal: label resets to "updating…"',
    h.getElapsedText() === 'updating…', h.getElapsedText(), 'updating…');
  var blip2 = h.getBlip();
  check('DR-68', 'after re-reveal: blip pulses again (is-updating)',
    !!(blip2 && blip2.classList.contains('is-updating')),
    blip2 ? blip2.className : null);

  // …and it settles + hides again if nothing else changes.
  h.clock.advance(91000); h.clock.advance(300);
  check('DR-68', 'after re-reveal: auto-hides again on the next settle',
    h.getStatus() === null, h.getStatus() ? 'present' : 'null', 'null');

  h.TVLive.stop(tab.id);
})();

/* ── DR-68 PASSIVE auto-hide latency — HARD regression guard ──
   Walk virtual time WITHOUT forcing repaints and record the first moment the
   passive tick begins removing the bar (adds .is-hiding or detaches it). The
   pre-fix tick dropped to a 60s cadence at 60s, so the 90s settle was only
   re-checked at ~121s — this fails at 121s and passes at ≤91s. */
(function testDR68Latency() {
  var h = loadLive();
  var tab = makeLiveTab();
  h.TV.state.tabs = [tab];
  h.TV.state.activeId = tab.id;
  h.TVLive.start(tab.id);
  var step = 1000, t = 0, max = 200000;
  while (t < max) {
    h.clock.advance(step); t += step;
    var bar = h.getStatus();
    var hiding = bar && bar.classList.contains('is-hiding');
    if (bar === null || hiding) { DR68_LATENCY.firstHideAtMs = t; break; }
  }
  check('DR-68', 'passive: bar auto-hides by 91s (no forced repaint)',
    DR68_LATENCY.firstHideAtMs !== null && DR68_LATENCY.firstHideAtMs <= 91000,
    DR68_LATENCY.firstHideAtMs === null ? 'never' : (DR68_LATENCY.firstHideAtMs / 1000) + 's',
    '<= 91s');
  h.TVLive.stop(tab.id);
})();

/* ── DR-68 auto-hide + tab switch — a tab that SETTLED while backgrounded
   shows no bar on switch-back; a change still re-reveals it. ── */
(function testDR68SettledSwitch() {
  var h = loadLive();
  var tabA = makeLiveTab('A');
  var tabB = { id: 'B', live: false, name: 'plain.md' };
  h.TV.state.tabs = [tabA, tabB];
  h.TV.state.activeId = tabA.id;
  h.TVLive.start(tabA.id);

  // Switch away to B, then let A settle (>90s) in the background.
  h.TV.state.activeId = tabB.id;
  h.TV.fire('tabchange', { prevId: tabA.id, id: tabB.id });
  h.clock.advance(0);
  h.clock.advance(95000); // A is now settled (95s since its last change)

  // Switch back to A: it settled while backgrounded → bar stays hidden.
  h.TV.state.activeId = tabA.id;
  h.TV.fire('tabchange', { prevId: tabB.id, id: tabA.id });
  h.clock.advance(0);
  check('DR-68', 'switch back to a SETTLED tab: no bar shown',
    h.getStatus() === null, h.getStatus() ? 'present' : 'null', 'null');

  // A change on the now-active tab re-reveals it.
  h.TVLive.refresh();
  check('DR-68', 'settled tab: a change still re-reveals the bar',
    h.getStatus() !== null, h.getStatus() ? 'present' : 'null', 'present');

  h.TVLive.stop(tabA.id);
})();

/* ═══════════════════════════════════════════════════════════
   DR-70 — time is since lastModTime, NOT tab-open; a tab switch
   preserves elapsed (no reset to 0 / "updating…").
   ═══════════════════════════════════════════════════════════ */
(function testDR70() {
  var h = loadLive();
  var tabA = makeLiveTab('A');
  var tabB = { id: 'B', live: false, name: 'plain.md' }; // a non-live tab to switch to
  h.TV.state.tabs = [tabA, tabB];
  h.TV.state.activeId = tabA.id;
  h.TVLive.start(tabA.id);

  // Let real elapsed accumulate on tab A.
  h.clock.advance(45000);
  check('DR-70', 'tabA: elapsed accrued before switch',
    h.getElapsedText() === 'updated 45s ago', h.getElapsedText(), 'updated 45s ago');

  // Switch AWAY to tab B (fires tabchange with prevId=A,id=B).
  h.TV.state.activeId = tabB.id;
  h.TV.fire('tabchange', { prevId: tabA.id, id: tabB.id });
  h.clock.advance(0); // flush deferred setTimeout(...,0) inside the listener
  check('DR-70', 'after switch away: live status removed from inactive view',
    h.getStatus() === null, h.getStatus() ? 'present' : 'null');

  // Time keeps passing while tab A is in the background.
  h.clock.advance(20000); // total 65s since lastModTime

  // Switch BACK to tab A. Set activeId first (as the app would), then fire.
  h.TV.state.activeId = tabA.id;
  h.TV.fire('tabchange', { prevId: tabB.id, id: tabA.id });
  h.clock.advance(0); // flush the setTimeout(...,0) re-inject

  // Crucial DR-70 assertion: elapsed reflects ~65s since lastModTime, NOT a
  // reset to "updating…" / 0. lastModTime was stamped at start (t=0 virtual).
  var afterBack = h.getElapsedText();
  check('DR-70', 'on switch back: elapsed preserved (since lastModTime, not reset)',
    afterBack === 'updated 1m ago', afterBack, 'updated 1m ago');
  check('DR-70', 'on switch back: NOT reset to "updating…"',
    afterBack !== 'updating…', afterBack);

  // And it keeps counting from the true origin, not from the switch-back moment.
  h.clock.advance(5000); // → 70s
  check('DR-70', 'after switch back + 5s: continues from true origin (1m)',
    h.getElapsedText() === 'updated 1m ago', h.getElapsedText(), 'updated 1m ago');

  h.TVLive.stop(tabA.id);
})();

/* ═══════════════════════════════════════════════════════════
   DR-71 — when watch stops, .tv-live-status is removed from DOM.
   ═══════════════════════════════════════════════════════════ */
(function testDR71() {
  var h = loadLive();
  var tab = makeLiveTab();
  h.TV.state.tabs = [tab];
  h.TV.state.activeId = tab.id;
  h.TVLive.start(tab.id);

  check('DR-71', 'precondition: status bar present while watching',
    h.getStatus() !== null, h.getStatus() ? 'present' : 'null');

  h.TVLive.stop(tab.id);

  check('DR-71', 'after stop(): .tv-live-status removed from DOM',
    h.getStatus() === null, h.getStatus() ? 'present' : 'null');
  check('DR-71', 'after stop(): native watcher told to stop',
    h.nativeCalls.stopWatch === 1, h.nativeCalls.stopWatch, 1);

  // stopAll() too
  var h2 = loadLive();
  var t2 = makeLiveTab('z');
  h2.TV.state.tabs = [t2];
  h2.TV.state.activeId = t2.id;
  h2.TVLive.start(t2.id);
  h2.TVLive.stopAll();
  check('DR-71', 'after stopAll(): status bar removed',
    h2.getStatus() === null, h2.getStatus() ? 'present' : 'null');
})();

/* ═══════════════════════════════════════════════════════════
   DR-65-OPEN — open-time gate: the live bar must NOT appear on open
   unless the file was written within the IDLE_THRESHOLD_MS (90 s)
   recency window. start() seeds the recency clock from the tab's REAL
   mtime (tab.lastModTime, threaded from doc.modified at open) instead
   of open-time, then gates the open inject on isRecent(watchState).

   Virtual-time base: the FAKE CLOCK starts at h.clock.time (its public
   getter). We set tab.lastModTime in that SAME base so tv-live.js's
   isRecent (Date.now() - lastModTime < 90000) compares correctly.
   getTab() returns the very object we put in state.tabs (mirroring the
   app), so setting tab.lastModTime BEFORE start() is what start() reads.
   ═══════════════════════════════════════════════════════════ */
(function testDR65Open() {
  /* ── (a) STATIC OPEN: old mtime (5 min) → NO bar; a real change reveals it ── */
  (function staticOpen() {
    var h = loadLive();
    var now = h.clock.time; // virtual-now in the same base isRecent() reads
    var tab = makeLiveTab();
    tab.lastModTime = now - 300000; // 5 min ago → well outside the 90s window
    h.TV.state.tabs = [tab];
    h.TV.state.activeId = tab.id;
    h.TVLive.start(tab.id); // native mode: watch armed, but gated on isRecent

    check('DR-65-OPEN', 'static open: NO bar shown (mtime 5 min in the past)',
      h.getStatus() === null, h.getStatus() ? 'present' : 'null', 'null');

    // Watch is still armed — a real disk change must reveal the bar pulsing.
    h.TVLive.refresh();
    check('DR-65-OPEN', 'static open + disk change: bar revealed',
      h.getStatus() !== null, h.getStatus() ? 'present' : 'null', 'present');
    check('DR-65-OPEN', 'static open + disk change: label "updating…"',
      h.getElapsedText() === 'updating…', h.getElapsedText(), 'updating…');
    h.TVLive.stop(tab.id);
  })();

  /* ── (b) RECENT OPEN: 30s-old mtime → bar present, "updated 30s ago" ── */
  (function recentOpen() {
    var h = loadLive();
    var now = h.clock.time;
    var tab = makeLiveTab();
    tab.lastModTime = now - 30000; // 30 s ago → inside the 90 s recency window
    h.TV.state.tabs = [tab];
    h.TV.state.activeId = tab.id;
    h.TVLive.start(tab.id);

    check('DR-65-OPEN', 'recent open (30s): bar present',
      h.getStatus() !== null, h.getStatus() ? 'present' : 'null', 'present');
    check('DR-65-OPEN', 'recent open (30s): label "updated 30s ago"',
      h.getElapsedText() === 'updated 30s ago', h.getElapsedText(), 'updated 30s ago');
    h.TVLive.stop(tab.id);
  })();

  /* ── (c) JUST-WRITTEN OPEN: mtime ≈ now → bar present, "updating…" ── */
  (function justWrittenOpen() {
    var h = loadLive();
    var now = h.clock.time;
    var tab = makeLiveTab();
    tab.lastModTime = now; // written ≈ now → delta < 3s → "updating…"
    h.TV.state.tabs = [tab];
    h.TV.state.activeId = tab.id;
    h.TVLive.start(tab.id);

    check('DR-65-OPEN', 'just-written open (now): bar present',
      h.getStatus() !== null, h.getStatus() ? 'present' : 'null', 'present');
    check('DR-65-OPEN', 'just-written open (now): label "updating…"',
      h.getElapsedText() === 'updating…', h.getElapsedText(), 'updating…');
    h.TVLive.stop(tab.id);
  })();

  /* ── (d) NO-SEED FALLBACK: tab has no lastModTime (Save-As/demo) →
     start() falls back to Date.now() → recent → bar present, "updating…". ── */
  (function noSeedFallback() {
    var h = loadLive();
    var tab = makeLiveTab();
    // Deliberately do NOT set tab.lastModTime.
    check('DR-65-OPEN', 'precondition: tab has no lastModTime seed',
      typeof tab.lastModTime !== 'number', typeof tab.lastModTime, 'not a number');
    h.TV.state.tabs = [tab];
    h.TV.state.activeId = tab.id;
    h.TVLive.start(tab.id);

    check('DR-65-OPEN', 'no-seed open: bar present (falls back to now)',
      h.getStatus() !== null, h.getStatus() ? 'present' : 'null', 'present');
    check('DR-65-OPEN', 'no-seed open: label "updating…" (fresh fallback)',
      h.getElapsedText() === 'updating…', h.getElapsedText(), 'updating…');
    h.TVLive.stop(tab.id);
  })();

  /* ── (e) STATIC then settles further: never shows a phantom bar even as
     virtual time advances well past the threshold. ── */
  (function staticNeverPhantom() {
    var h = loadLive();
    var now = h.clock.time;
    var tab = makeLiveTab();
    tab.lastModTime = now - 300000; // 5 min ago
    h.TV.state.tabs = [tab];
    h.TV.state.activeId = tab.id;
    h.TVLive.start(tab.id);

    check('DR-65-OPEN', 'static settles: no bar on open',
      h.getStatus() === null, h.getStatus() ? 'present' : 'null', 'null');
    // Advance 200s — there is no tick scheduled (open was gated), so nothing can
    // appear, and nothing should phantom-hide either.
    h.clock.advance(200000);
    check('DR-65-OPEN', 'static settles: still no bar after +200s (no phantom)',
      h.getStatus() === null, h.getStatus() ? 'present' : 'null', 'null');
    h.TVLive.stop(tab.id);
  })();
})();

/* ═══════════════════════════════════════════════════════════
   BONUS — render-teardown re-injection (L-04): if render() rebuilds
   the viewer, the status bar should be re-injected via the 'render'
   listener. This exercises the real DOM-teardown path.
   ═══════════════════════════════════════════════════════════ */
(function testRenderReinject() {
  var h = loadLive({ renderRebuilds: true });
  var tab = makeLiveTab();
  h.TV.state.tabs = [tab];
  h.TV.state.activeId = tab.id;
  h.TVLive.start(tab.id);
  check('L-04', 'precondition: status bar present after start',
    h.getStatus() !== null, h.getStatus() ? 'present' : 'null');

  // Simulate a render that tears down the viewer DOM.
  h.TV.render();
  check('L-04', 'render teardown removes the old status bar',
    h.root.querySelector('.tv-live-status') === null, 'expected gone after teardown');

  // Fire the render event (as tv-app would after render()) and flush defer.
  h.TV.fire('render');
  h.clock.advance(0);
  check('L-04', 'after render event: status bar re-injected into rebuilt viewer',
    h.getStatus() !== null, h.getStatus() ? 'present' : 'null');

  h.TVLive.stop(tab.id);
})();

/* ═══════════════════════════════════════════════════════════
   DR-65-BOLT — the live "bolt" icon (tab.liveActive) follows the SAME
   recency rules as the bottom bar: OFF on static open, ON on a change,
   OFF on settle, cleared on stop. (tab.liveActive is the source of truth
   the tab-strip/sidebar bolt renders read.)
   ═══════════════════════════════════════════════════════════ */
(function testBoltFlag() {
  /* (a) static open → bolt OFF; a change lights it; stop clears it */
  (function () {
    var h = loadLive();
    var now = h.clock.time;
    var tab = makeLiveTab();
    tab.lastModTime = now - 300000; // 5 min ago → static
    h.TV.state.tabs = [tab]; h.TV.state.activeId = tab.id;
    h.TVLive.start(tab.id);
    check('DR-65-BOLT', 'static open: tab.liveActive === false (no bolt)',
      tab.liveActive === false, tab.liveActive, false);
    h.TVLive.refresh(); // simulate a disk change
    check('DR-65-BOLT', 'static + change: tab.liveActive === true (bolt on)',
      tab.liveActive === true, tab.liveActive, true);
    h.TVLive.stop(tab.id);
    check('DR-65-BOLT', 'after stop(): tab.liveActive === false (bolt cleared)',
      tab.liveActive === false, tab.liveActive, false);
  })();

  /* (b) recent open → bolt ON; settle (>90s) → bolt OFF (mirrors auto-hide) */
  (function () {
    var h = loadLive();
    var now = h.clock.time;
    var tab = makeLiveTab();
    tab.lastModTime = now - 30000; // 30s ago → recent
    h.TV.state.tabs = [tab]; h.TV.state.activeId = tab.id;
    h.TVLive.start(tab.id);
    check('DR-65-BOLT', 'recent open: tab.liveActive === true (bolt on)',
      tab.liveActive === true, tab.liveActive, true);
    h.clock.advance(70000); h.clock.advance(300); // cross the 90s settle + fade
    check('DR-65-BOLT', 'settle (>90s): tab.liveActive === false (bolt off)',
      tab.liveActive === false, tab.liveActive, false);
    h.TVLive.stop(tab.id);
  })();
})();

/* ═══════════════════════════════════════════════════════════
   REPORT
   ═══════════════════════════════════════════════════════════ */
console.log('\n══════════════════════════════════════════════════════');
console.log(' tiny-viewer live-watch RUNTIME test harness (DR-65–71)');
console.log('══════════════════════════════════════════════════════\n');

var order = ['LOAD', 'DR-65-OPEN', 'DR-65-BOLT', 'DR-66', 'DR-67', 'DR-68', 'DR-70', 'DR-71', 'L-04'];
var totalPass = 0, totalFail = 0;
order.forEach(function (id) {
  var r = results[id];
  if (!r) {
    console.log('  SKIP  ' + id + ' — not exercised');
    return;
  }
  var status = r.pass ? 'PASS' : 'FAIL';
  console.log('  ' + status + '  ' + id + '  (' + r.checks + ' checks)');
  if (!r.pass) {
    r.fails.forEach(function (f) { console.log('         ↳ ' + f); });
  }
  if (r.pass) totalPass++; else totalFail++;
});

console.log('\n──────────────────────────────────────────────────────');
console.log(' DR groups passed: ' + totalPass + '   failed: ' + totalFail);
console.log('──────────────────────────────────────────────────────\n');

/* ── Behavioural findings (runtime characterisation, not pass/fail) ── */
console.log(' BEHAVIOURAL FINDINGS (passive timing, real runtime):');
console.log('   • DR-68 auto-hide latency: settle target = 90s; the passive tick');
console.log('     first began removing the bar at ' +
  (DR68_LATENCY.firstHideAtMs !== null ? (DR68_LATENCY.firstHideAtMs / 1000) + 's' : 'never') +
  ' (≈' + (DR68_LATENCY.firstHideAtMs !== null
    ? Math.round((DR68_LATENCY.firstHideAtMs - 90000) / 1000)
    : '?') + 's off target).');
console.log('     1s cadence runs through the 90s threshold, so the bar auto-hides');
console.log('     within 1s of settling; the watch stays armed + a change re-reveals it.');
console.log('   • DR-66 passive label (no forced repaint) — visible window only');
console.log('     (< 90s; the bar is gone after that):');
DR66_CADENCE.samples.forEach(function (s) {
  console.log('       t=' + (s.t / 1000) + 's → displayed "' + s.label + '"');
});
console.log('     1s cadence keeps the visible label exact (no minutes-range lag).');
console.log('──────────────────────────────────────────────────────\n');

if (totalFail > 0) process.exit(1);
