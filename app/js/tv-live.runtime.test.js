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
    { at: 300000,  expect: 'updated 5m ago',   why: '5min' },
    { at: 3540000, expect: 'updated 59m ago',  why: '59m upper' },
    { at: 3599999, expect: 'updated 59m ago',  why: 'just under 1h' },
    { at: 3600000, expect: 'updated 1h ago',   why: 'hour boundary' },
    { at: 7200000, expect: 'updated 2h ago',   why: '2h' },
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

  var sampleTimes = [4000, 30000, 59000, 65000, 300000, 3540000, 3700000];
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

  // And a second change after going idle should also re-pulse (the harder case).
  // Advance >90s, then FORCE a fresh paint (render re-inject) so idle is actually
  // applied — the passive tick is too coarse to apply idle exactly at 95s (that
  // latency is characterised under DR-68). With idle truly engaged, is-updating
  // must be cleared; the subsequent change must restore it.
  h.clock.advance(95000); // > 90s
  h.TV.fire('render'); h.clock.advance(0); // fresh paint → idle now applied
  var blipIdle = h.getBlip();
  check('DR-67', 'precondition: idle clears is-updating before 2nd change',
    !!(blipIdle && !blipIdle.classList.contains('is-updating')),
    blipIdle ? blipIdle.className : null);
  h.TVLive.refresh();
  var blip2 = h.getBlip();
  check('DR-67', '2nd change after idle: blip re-pulses (is-updating restored)',
    !!(blip2 && blip2.classList.contains('is-updating')),
    blip2 ? blip2.className : null, 'is-updating present');
  check('DR-67', '2nd change after idle: label back to "updating…"',
    h.getElapsedText() === 'updating…', h.getElapsedText(), 'updating…');

  h.TVLive.stop(tab.id);
})();

/* ═══════════════════════════════════════════════════════════
   DR-68 — after 90s idle: .live-pill gets .idle, blip loses
   is-updating (steady dot), pill text still "Live", counter advancing.

   We test the IDLE MECHANISM with a fresh paint at the relevant deltas
   (correctness of setIdleState given the delta). The PASSIVE timing —
   *when* the idle visual actually engages without a forced repaint — is
   measured separately under DR-68-LATENCY and surfaced in the report,
   because the adaptive tick applies idle lazily (see findings).
   ═══════════════════════════════════════════════════════════ */
var DR68_LATENCY = { firstIdleAtMs: null };
(function testDR68Mechanism() {
  var h = loadLive();
  var tab = makeLiveTab();
  h.TV.state.tabs = [tab];
  h.TV.state.activeId = tab.id;
  h.TVLive.start(tab.id);
  function freshPaint() { h.TV.fire('render'); h.clock.advance(0); }

  // Just below threshold (89s): NOT idle, blip still pulsing.
  h.clock.advance(89000); freshPaint();
  var pillBefore = h.getPill();
  check('DR-68', 'mechanism: at 89s (<90s) pill is NOT idle',
    !!(pillBefore && !pillBefore.classList.contains('idle')),
    pillBefore ? pillBefore.className : null);
  var blipBefore = h.getBlip();
  check('DR-68', 'mechanism: at 89s blip still pulsing (is-updating present)',
    !!(blipBefore && blipBefore.classList.contains('is-updating')),
    blipBefore ? blipBefore.className : null);

  // At/after threshold (95s) with a fresh paint: idle engaged.
  h.clock.advance(6000); freshPaint(); // → 95s
  var pill = h.getPill();
  check('DR-68', 'mechanism: at 95s (>90s) .live-pill gets class idle',
    !!(pill && pill.classList.contains('idle')),
    pill ? pill.className : null, 'idle present');
  var blip = h.getBlip();
  check('DR-68', 'mechanism: at 95s blip loses is-updating (steady dot)',
    !!(blip && !blip.classList.contains('is-updating')),
    blip ? blip.className : null, 'is-updating absent');
  var pillText = pill ? pill.textContent : null;
  check('DR-68', 'mechanism: at 95s pill text still contains "Live"',
    !!(pillText && /Live/.test(pillText)), pillText, 'contains "Live"');

  // Counter still advancing while idle (passive tick keeps repainting the label).
  check('DR-68', 'at 95s: counter advancing (label shows 1m)',
    h.getElapsedText() === 'updated 1m ago', h.getElapsedText(), 'updated 1m ago');
  h.clock.advance(125000); freshPaint(); // → 220s ≈ 3m
  check('DR-68', 'at 220s: counter still advancing (label shows 3m)',
    h.getElapsedText() === 'updated 3m ago', h.getElapsedText(), 'updated 3m ago');
  // And idle persists.
  var pill2 = h.getPill();
  check('DR-68', 'at 220s: still idle (persists past threshold)',
    !!(pill2 && pill2.classList.contains('idle')), pill2 ? pill2.className : null, 'idle');

  h.TVLive.stop(tab.id);
})();

/* ── DR-68 PASSIVE latency characterisation (reported, not gating) ──
   Walk virtual time WITHOUT forcing repaints and record the first
   moment the passive tick actually applies `.idle`. The spec target is
   90s; we measure the real engage time produced by the adaptive tick. */
(function testDR68Latency() {
  var h = loadLive();
  var tab = makeLiveTab();
  h.TV.state.tabs = [tab];
  h.TV.state.activeId = tab.id;
  h.TVLive.start(tab.id);
  var step = 1000, t = 0, max = 200000;
  while (t < max) {
    h.clock.advance(step); t += step;
    var pill = h.getPill();
    if (pill && pill.classList.contains('idle')) { DR68_LATENCY.firstIdleAtMs = t; break; }
  }
  // HARD regression guard for the cadence fix: with NO forced repaint, the
  // passive adaptive tick must apply `.idle` within 1s of the 90s threshold
  // (i.e. by 91s). The pre-fix impl dropped to a 60s cadence at 60s and only
  // re-checked the threshold at ~121s — this assertion fails at 121s and passes
  // at ≤91s, locking in DR-68 + the "settles within 90s" success metric.
  check('DR-68', 'passive: idle engages by 91s (no forced repaint)',
    DR68_LATENCY.firstIdleAtMs !== null && DR68_LATENCY.firstIdleAtMs <= 91000,
    DR68_LATENCY.firstIdleAtMs === null ? 'never' : (DR68_LATENCY.firstIdleAtMs / 1000) + 's',
    '<= 91s');
  h.TVLive.stop(tab.id);
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
   REPORT
   ═══════════════════════════════════════════════════════════ */
console.log('\n══════════════════════════════════════════════════════');
console.log(' tiny-viewer live-watch RUNTIME test harness (DR-65–71)');
console.log('══════════════════════════════════════════════════════\n');

var order = ['LOAD', 'DR-66', 'DR-67', 'DR-68', 'DR-70', 'DR-71', 'L-04'];
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
console.log('   • DR-68 idle latency: spec target = 90s; the passive adaptive');
console.log('     tick first applied .idle at ' +
  (DR68_LATENCY.firstIdleAtMs !== null ? (DR68_LATENCY.firstIdleAtMs / 1000) + 's' : 'never') +
  ' (≈' + (DR68_LATENCY.firstIdleAtMs !== null
    ? Math.round((DR68_LATENCY.firstIdleAtMs - 90000) / 1000)
    : '?') + 's late).');
console.log('     Cadence ticks every 1s through the 90s idle threshold, then');
console.log('     drops to 60s, then stops past 1h (nextTickDelay) — so idle');
console.log('     engages within 1s of 90s instead of at the ~121s minute tick.');
console.log('   • DR-66 passive label staleness (no forced repaint):');
DR66_CADENCE.samples.forEach(function (s) {
  console.log('       t=' + (s.t / 1000) + 's → displayed "' + s.label + '"');
});
console.log('     In the minutes range the displayed Nm can lag true elapsed by up');
console.log('     to ~60s (label repainted only ~once/min). Format stays bounded.');
console.log('──────────────────────────────────────────────────────\n');

if (totalFail > 0) process.exit(1);
