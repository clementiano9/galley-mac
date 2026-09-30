/* ───────────────────────────────────────────────────────────
   Galley · native bridge RUNTIME test harness
   Run: node app/js/tv-native.runtime.test.js

   Loads and EXECUTES app/js/tv-native.js inside a hand-rolled minimal
   DOM + fake clock + a fake window.__TAURI__, then drives the real
   scenarios and asserts on what the module invoked / rendered. Mirrors
   tv-live.runtime.test.js: no external deps, plain Node, PASS/FAIL,
   non-zero exit on failure.

   Covers:
     C-01  toast host  — mounted in <body> carrying the app's theme/accent
                         classes, column stack, error toasts dismissible and
                         longer-lived, persistent aria-live region, burst cap.
     C-02  quit guard  — tv-close-requested → confirm_close when clean, native
                         sheet when dirty, Save All / Discard / Cancel branches,
                         and NO quit when a save fails.
     C-29  folder scan — readDirTree(path, {uncapped:true}) passes the flag.
     C-36  menu        — Appearance checkmark sync, Open Recent push, Print,
                         Reveal in Finder, Find Next / Previous.
   ─────────────────────────────────────────────────────────── */
'use strict';

var fs = require('fs');
var path = require('path');
var vm = require('vm');

var passed = 0, failed = 0;
function check(label, cond, observed) {
  if (cond) { passed++; console.log('  PASS  ' + label); }
  else {
    failed++;
    console.log('  FAIL  ' + label +
      (observed !== undefined ? '  [observed: ' + JSON.stringify(observed) + ']' : ''));
  }
}
function flush() {
  return new Promise(function (r) { setImmediate(r); })
    .then(function () { return new Promise(function (r) { setImmediate(r); }); })
    .then(function () { return new Promise(function (r) { setImmediate(r); }); });
}

/* ── fake clock (setTimeout / clearTimeout only) ──────────── */
function makeClock() {
  var now = 1000000, seq = 1, timers = [];
  return {
    setTimeout: function (cb, delay) {
      var id = seq++;
      timers.push({ id: id, fireAt: now + (delay || 0), cb: cb });
      return id;
    },
    clearTimeout: function (id) { timers = timers.filter(function (t) { return t.id !== id; }); },
    setInterval: function () { return seq++; },
    clearInterval: function () {},
    advance: function (ms) {
      var target = now + ms, guard = 0;
      for (;;) {
        if (guard++ > 10000) throw new Error('runaway timers');
        var due = timers.filter(function (t) { return t.fireAt <= target; })
                        .sort(function (a, b) { return a.fireAt - b.fireAt; });
        if (!due.length) break;
        var t = due[0];
        now = t.fireAt;
        timers = timers.filter(function (x) { return x.id !== t.id; });
        t.cb();
      }
      now = target;
    },
  };
}

/* ── minimal DOM ──────────────────────────────────────────── */
function Element(tag) {
  this.tagName = (tag || 'div').toUpperCase();
  this.children = [];
  this.parentNode = null;
  this.id = '';
  this._classes = [];
  this._attrs = {};
  this._text = '';
  this._listeners = {};
  var self = this;
  this.classList = {
    add: function () {
      for (var i = 0; i < arguments.length; i++) {
        if (self._classes.indexOf(arguments[i]) === -1) self._classes.push(arguments[i]);
      }
    },
    remove: function () {
      for (var i = 0; i < arguments.length; i++) {
        self._classes = self._classes.filter(function (c) { return c !== arguments[i]; }.bind(null));
      }
    },
    toggle: function (c, on) {
      var has = self._classes.indexOf(c) !== -1;
      if (on === undefined) on = !has;
      if (on && !has) self._classes.push(c);
      if (!on && has) self._classes = self._classes.filter(function (x) { return x !== c; });
      return on;
    },
    contains: function (c) { return self._classes.indexOf(c) !== -1; },
  };
}
Object.defineProperty(Element.prototype, 'className', {
  get: function () { return this._classes.join(' '); },
  set: function (v) { this._classes = String(v).split(/\s+/).filter(Boolean); },
});
Object.defineProperty(Element.prototype, 'textContent', {
  get: function () {
    if (this.children.length) {
      return this.children.map(function (c) { return c.textContent; }).join('');
    }
    return this._text;
  },
  set: function (v) { this._text = String(v); this.children = []; },
});
Element.prototype.setAttribute = function (k, v) { this._attrs[k] = String(v); };
Element.prototype.getAttribute = function (k) {
  return Object.prototype.hasOwnProperty.call(this._attrs, k) ? this._attrs[k] : null;
};
Element.prototype.hasAttribute = function (k) { return Object.prototype.hasOwnProperty.call(this._attrs, k); };
Element.prototype.appendChild = function (c) {
  if (c.parentNode) c.parentNode.removeChild(c);
  c.parentNode = this; this.children.push(c); return c;
};
Element.prototype.removeChild = function (c) {
  this.children = this.children.filter(function (x) { return x !== c; });
  c.parentNode = null; return c;
};
Element.prototype.addEventListener = function (ev, fn) {
  (this._listeners[ev] = this._listeners[ev] || []).push(fn);
};
Element.prototype.dispatch = function (ev) {
  (this._listeners[ev] || []).forEach(function (fn) { fn({ type: ev }); });
};
Element.prototype._matches = function (sel) {
  if (sel.charAt(0) === '.') return this.classList.contains(sel.slice(1));
  if (sel.charAt(0) === '#') return this.id === sel.slice(1);
  return this.tagName === sel.toUpperCase();
};
Element.prototype._walk = function (out) {
  for (var i = 0; i < this.children.length; i++) { out.push(this.children[i]); this.children[i]._walk(out); }
  return out;
};
Element.prototype.querySelectorAll = function (sel) {
  var self = this;
  return this._walk([]).filter(function (el) { return el._matches(sel); });
};
Element.prototype.querySelector = function (sel) { return this.querySelectorAll(sel)[0] || null; };

function makeDocument() {
  var body = new Element('body');
  var docEl = new Element('html');
  var doc = {
    body: body,
    documentElement: docEl,
    readyState: 'complete',
    createElement: function (t) { return new Element(t); },
    addEventListener: function () {},
    querySelector: function (sel) { return body.querySelector(sel); },
    querySelectorAll: function (sel) { return body.querySelectorAll(sel); },
    getElementById: function (id) { return body.querySelectorAll('#' + id)[0] || null; },
  };
  return doc;
}

/* ── harness: load tv-native.js against fresh mocks ────────── */
var SRC = fs.readFileSync(path.join(__dirname, 'tv-native.js'), 'utf8');

function boot(opts) {
  opts = opts || {};
  var clock = makeClock();
  var doc = makeDocument();

  var invokes = [];           // { cmd, args } in call order
  var listeners = {};         // event name -> handler
  var order = [];             // interleaved trace of listen/invoke, for ordering asserts

  var store = opts.localStorage || {};

  var tv = {
    state: { tabs: opts.tabs || [], activeId: opts.activeId || null, mode: 'reading',
             theme: opts.theme || 'light', accent: opts.accent || 'blue' },
    _handlers: {},
    on: function (ev, fn) { (this._handlers[ev] = this._handlers[ev] || []).push(fn); },
    emit: function (ev, p) { (this._handlers[ev] || []).forEach(function (f) { f(p); }); },
    getActiveTab: function () {
      var id = this.state.activeId;
      return this.state.tabs.filter(function (t) { return t.id === id; })[0] || null;
    },
    render: function () { this.emit('render'); },
    markDirty: function (id, on) {
      this.state.tabs.forEach(function (t) { if (t.id === id) t.dirty = !!on; });
    },
    loadRecentPaths: function () { return opts.recent || []; },
    saveRecentPath: function () {},
    openDoc: function () { return null; },
    findStep: opts.findStep,
    hasDirtyTabs: opts.hasDirtyTabs,
    // P2-6: showToast() calls TV.announce() instead of owning its own
    // aria-live region — record calls so the test can assert on them.
    _announced: [],
    announce: function (msg) { this._announced.push(msg); },
  };

  var sandbox = {
    console: { log: function () {}, warn: function () {}, error: function () {} },
    setTimeout: clock.setTimeout, clearTimeout: clock.clearTimeout,
    setInterval: clock.setInterval, clearInterval: clock.clearInterval,
    Promise: Promise, Date: Date, Array: Array, Object: Object, JSON: JSON, Error: Error,
    document: doc,
  };
  sandbox.window = sandbox;
  sandbox.document = doc;
  sandbox.localStorage = {
    getItem: function (k) { return Object.prototype.hasOwnProperty.call(store, k) ? store[k] : null; },
    setItem: function (k, v) { store[k] = String(v); },
    removeItem: function (k) { delete store[k]; },
  };
  sandbox.TV = tv;
  sandbox.__TAURI__ = {
    core: {
      invoke: function (cmd, args) {
        invokes.push({ cmd: cmd, args: args });
        order.push('invoke:' + cmd);
        var r = opts.responses && opts.responses[cmd];
        if (typeof r === 'function') return Promise.resolve().then(function () { return r(args); });
        if (r && r.__reject) return Promise.reject(r.__reject);
        return Promise.resolve(r === undefined ? null : r);
      },
    },
    event: {
      listen: function (name, fn) {
        listeners[name] = fn;
        order.push('listen:' + name);
        return Promise.resolve(function () {});
      },
    },
  };

  vm.createContext(sandbox);
  vm.runInContext(SRC, sandbox, { filename: 'tv-native.js' });

  return {
    sandbox: sandbox, doc: doc, clock: clock, tv: tv,
    invokes: invokes, listeners: listeners, order: order, store: store,
    TVNative: sandbox.TVNative,
    fire: function (ev, payload) {
      if (!listeners[ev]) throw new Error('no listener for ' + ev);
      return listeners[ev]({ payload: payload });
    },
    cmds: function () { return invokes.map(function (i) { return i.cmd; }); },
    lastArgs: function (cmd) {
      for (var i = invokes.length - 1; i >= 0; i--) if (invokes[i].cmd === cmd) return invokes[i].args;
      return null;
    },
    toastHost: function () { return doc.getElementById('tv-toasts'); },
    toasts: function () {
      var h = doc.getElementById('tv-toasts');
      return h ? h.querySelectorAll('.tv-toast') : [];
    },
  };
}

/* ═══════════════════════════════════════════════════════════
   C-01 · toasts
   ═══════════════════════════════════════════════════════════ */
console.log('\nC-01: toast host, stacking, dismissal, live region\n');
(function () {
  var h = boot({ theme: 'dark', accent: 'warm' });
  var N = h.TVNative;

  N.showToast('first');
  var host = h.toastHost();
  check('toast host is mounted in <body>, not inside .tv',
    !!host && host.parentNode === h.doc.body, host && host.parentNode && host.parentNode.tagName);
  check('host carries the app theme + accent classes so tokens resolve',
    !!host && host.className === 'tv tv--dark tv--accent-warm', host && host.className);

  // P2-6: showToast() no longer owns a second aria-live region inside
  // #tv-toasts — it announces through the shell's ONE shared live region
  // via TV.announce(), so #tv-toasts itself carries no .tv-toast-live node.
  check('P2-6: #tv-toasts owns no separate live region of its own',
    !host.querySelector('.tv-toast-live'));
  check('P2-6: the toast text was announced through TV.announce() instead',
    h.tv._announced.indexOf('first') !== -1, h.tv._announced);

  N.showToast('second', { kind: 'error' });
  N.showToast('third');
  check('three toasts stack in the one host', h.toasts().length === 3, h.toasts().length);
  check('every toast has role=status', h.toasts().every(function (t) { return t.getAttribute('role') === 'status'; }));
  check('newest toast is last in the column (arrival order)',
    h.toasts()[2].textContent === 'third', h.toasts()[2].textContent);

  var errs = h.toasts().filter(function (t) { return t.classList.contains('tv-toast--error'); });
  check('exactly the error toast is flagged tv-toast--error', errs.length === 1, errs.length);
  check('error toast carries a dismiss button',
    !!errs[0].querySelector('.tv-toast-x'), errs[0].children.length);
  check('info toasts carry no dismiss button',
    h.toasts().filter(function (t) { return !t.classList.contains('tv-toast--error'); })
     .every(function (t) { return !t.querySelector('.tv-toast-x'); }));

  // theme change must not orphan the host (it lives outside the render target)
  h.tv.state.theme = 'light';
  h.tv.render();
  check('host survives render() and re-syncs its theme class',
    h.toastHost() === host && host.className === 'tv tv--light tv--accent-warm', host.className);

  // ✕ dismisses
  var x = errs[0].querySelector('.tv-toast-x');
  x.dispatch('click');
  h.clock.advance(500);
  check('clicking ✕ removes the error toast', h.toasts().length === 2, h.toasts().length);

  // durations: info ~3s, error ~6s
  var h2 = boot({});
  h2.TVNative.showToast('info');
  h2.TVNative.showToast('err', { kind: 'error' });
  h2.clock.advance(3500);
  h2.clock.advance(500);
  check('info toast is gone by ~3.5s',
    h2.toasts().map(function (t) { return t.textContent; }).indexOf('info') === -1,
    h2.toasts().map(function (t) { return t.textContent; }));
  check('error toast is still up at ~4s',
    h2.toasts().some(function (t) { return t.textContent.indexOf('err') === 0; }),
    h2.toasts().map(function (t) { return t.textContent; }));
  h2.clock.advance(3000);
  check('error toast is gone by ~7s', h2.toasts().length === 0, h2.toasts().length);

  // burst cap
  var h3 = boot({});
  for (var i = 0; i < 9; i++) h3.TVNative.showToast('burst ' + i);
  check('a burst is capped at 4 visible toasts', h3.toasts().length === 4, h3.toasts().length);

  // copy rule: no dashes in the strings this module owns
  var strings = SRC.match(/showToast\(([^;]*?)\)\s*;/g) || [];
  check('no em/en dashes in any toast string this module emits',
    !strings.some(function (s) { return /[–—]/.test(s); }),
    strings.filter(function (s) { return /[–—]/.test(s); }));
})();

/* ═══════════════════════════════════════════════════════════
   C-02 · quit with unsaved edits
   ═══════════════════════════════════════════════════════════ */
console.log('\nC-02: quit / close window with unsaved edits\n');

function dirtyBoot(extra) {
  var opts = {
    tabs: [
      { id: 't1', name: 'a.md', nativePath: '/tmp/a.md', source: 'A', dirty: true },
      { id: 't2', name: 'b.md', nativePath: '/tmp/b.md', source: 'B', dirty: false },
      { id: 't3', name: 'c.md', nativePath: '/tmp/c.md', source: 'C', dirty: true },
    ],
    activeId: 't1',
  };
  Object.keys(extra || {}).forEach(function (k) { opts[k] = extra[k]; });
  return boot(opts);
}

(function () {
  var h = boot({ tabs: [{ id: 't1', name: 'a.md', nativePath: '/tmp/a.md', dirty: false }] });
  check('close listener is registered BEFORE the Rust guard arms (take_pending_opens)',
    h.order.indexOf('listen:tv-close-requested') < h.order.indexOf('invoke:take_pending_opens'),
    h.order.filter(function (o) { return /tv-close-requested|take_pending_opens/.test(o); }));
})();

(async function () {
  // clean → quit straight through, no dialog
  var h = boot({ tabs: [{ id: 't1', name: 'a.md', dirty: false }] });
  h.fire('tv-close-requested');
  await flush();
  check('no dirty tabs → confirm_close, no sheet',
    h.cmds().indexOf('confirm_close') !== -1 && h.cmds().indexOf('confirm_quit_dialog') === -1,
    h.cmds());

  // dirty → sheet, with the right count
  h = dirtyBoot({ responses: { confirm_quit_dialog: 'cancel' } });
  h.fire('tv-close-requested');
  await flush();
  check('dirty tabs → the native sheet is shown', h.cmds().indexOf('confirm_quit_dialog') !== -1, h.cmds());
  check('sheet is told how many documents are unsaved',
    h.lastArgs('confirm_quit_dialog') && h.lastArgs('confirm_quit_dialog').count === 2,
    h.lastArgs('confirm_quit_dialog'));
  check('Cancel keeps the app open', h.cmds().indexOf('confirm_close') === -1, h.cmds());

  // Discard → quit without saving
  h = dirtyBoot({ responses: { confirm_quit_dialog: 'discard' } });
  h.fire('tv-close-requested');
  await flush();
  check('Discard quits without writing anything',
    h.cmds().indexOf('confirm_close') !== -1 && h.cmds().indexOf('save_md_file') === -1, h.cmds());

  // Save All → save every dirty tab, then quit
  h = dirtyBoot({ responses: { confirm_quit_dialog: 'save', save_md_file: null } });
  h.fire('tv-close-requested');
  await flush(); await flush(); await flush();
  var saved = h.invokes.filter(function (i) { return i.cmd === 'save_md_file'; });
  check('Save All saves every dirty tab (and only those)', saved.length === 2, saved.map(function (s) { return s.args.path; }));
  check('Save All saves the dirty paths',
    saved.map(function (s) { return s.args.path; }).join(',') === '/tmp/a.md,/tmp/c.md',
    saved.map(function (s) { return s.args.path; }));
  check('Save All then quits', h.cmds().indexOf('confirm_close') !== -1, h.cmds());

  // a failing save must NOT quit — that is the whole point of the guard
  h = dirtyBoot({ responses: { confirm_quit_dialog: 'save', save_md_file: { __reject: 'disk full' } } });
  h.fire('tv-close-requested');
  await flush(); await flush(); await flush();
  check('a failed save cancels the quit (edits survive)', h.cmds().indexOf('confirm_close') === -1, h.cmds());
  check('a failed save says so in an error toast',
    h.toasts().some(function (t) { return /Quit cancelled/.test(t.textContent); }),
    h.toasts().map(function (t) { return t.textContent; }));

  // shell-provided counter is preferred when present
  h = dirtyBoot({ hasDirtyTabs: function () { return 7; }, responses: { confirm_quit_dialog: 'cancel' } });
  h.fire('tv-close-requested');
  await flush();
  check('TV.hasDirtyTabs() is used when the shell exports it',
    h.lastArgs('confirm_quit_dialog').count === 7, h.lastArgs('confirm_quit_dialog'));

  // a broken shell must never make the app unquittable
  h = boot({ responses: {} });
  h.sandbox.TV = null;
  h.fire('tv-close-requested');
  await flush();
  check('a broken shell still quits rather than trapping the user',
    h.cmds().indexOf('confirm_close') !== -1, h.cmds());

  /* ═════════════════════════════════════════════════════════
     P1-7 · a second tv-close-requested while a sheet is up must not
     stack a second confirm_quit_dialog on the same window.
     ═════════════════════════════════════════════════════════ */
  h = dirtyBoot({ responses: { confirm_quit_dialog: 'cancel' } });
  h.fire('tv-close-requested');
  h.fire('tv-close-requested'); // re-entrant, before the first invoke resolves
  await flush();
  check('P1-7: a re-entrant close request does not open a second sheet',
    h.cmds().filter(function (c) { return c === 'confirm_quit_dialog'; }).length === 1,
    h.cmds());

  // Cancel re-arms the guard: a LATER, separate close request must still work.
  h.fire('tv-close-requested');
  await flush();
  check('P1-7: the guard is released after Cancel, so a later quit attempt works',
    h.cmds().filter(function (c) { return c === 'confirm_quit_dialog'; }).length === 2,
    h.cmds());

  /* ═════════════════════════════════════════════════════════
     P1-8 · confirm_quit_dialog failing asks the user to retry once, then
     falls through to confirm_close on the SECOND consecutive failure —
     NATIVE-CONTRACT.md's "any failure falls through" rule, but only once
     the dialog has proven it cannot even ask, so a transient glitch does
     not quit out from under the user without asking.
     ═════════════════════════════════════════════════════════ */
  h = dirtyBoot({ responses: { confirm_quit_dialog: { __reject: 'dialog broken' } } });
  h.fire('tv-close-requested');
  await flush();
  check('P1-8: the first confirm_quit_dialog failure does NOT quit',
    h.cmds().indexOf('confirm_close') === -1, h.cmds());
  check('P1-8: the first failure asks the user to retry',
    h.toasts().some(function (t) { return /quit again/.test(t.textContent); }),
    h.toasts().map(function (t) { return t.textContent; }));

  // The guard must have been released so the user's next ⌘Q is not swallowed.
  h.fire('tv-close-requested');
  await flush();
  check('P1-8: the second consecutive failure falls through to confirm_close',
    h.cmds().indexOf('confirm_close') !== -1, h.cmds());
  check('P1-8: the second failure says it is quitting anyway',
    h.toasts().some(function (t) { return /[Qq]uitting anyway/.test(t.textContent); }),
    h.toasts().map(function (t) { return t.textContent; }));

  /* ═════════════════════════════════════════════════════════
     C-29 · folder scan
     ═════════════════════════════════════════════════════════ */
  console.log('\nC-29: uncapped folder rescan\n');
  h = boot({ responses: { read_dir_tree: { path: '/x', files: [], subfolders: [], deep: [], truncated: false, skipped: 0 } } });
  h.TVNative.readDirTree('/x');
  check('default scan sends no uncapped flag',
    h.lastArgs('read_dir_tree').uncapped === undefined, h.lastArgs('read_dir_tree'));
  h.TVNative.readDirTree('/x', { uncapped: true });
  check('readDirTree(path, {uncapped:true}) forwards the flag',
    h.lastArgs('read_dir_tree').uncapped === true, h.lastArgs('read_dir_tree'));

  /* ═════════════════════════════════════════════════════════
     C-36 · menu bar
     ═════════════════════════════════════════════════════════ */
  console.log('\nC-36: menu wiring\n');

  h = boot({ recent: ['/n/one.md', '/n/two.md'] });
  check('Appearance is synced at boot', h.cmds().indexOf('set_appearance_check') !== -1, h.cmds());
  check('no tv-theme override → "System" is the checked row',
    h.lastArgs('set_appearance_check').choice === 'system', h.lastArgs('set_appearance_check'));
  check('Open Recent is pushed to the menu at boot',
    h.lastArgs('set_recent_files').paths.join(',') === '/n/one.md,/n/two.md',
    h.lastArgs('set_recent_files'));

  // a theme change by ANY route re-checks the right row (DR-14)
  h.store['tv-theme'] = 'dark';
  h.tv.render();
  check('an explicit dark choice checks "Dark"',
    h.lastArgs('set_appearance_check').choice === 'dark', h.lastArgs('set_appearance_check'));
  var before = h.invokes.filter(function (i) { return i.cmd === 'set_appearance_check'; }).length;
  h.tv.render(); h.tv.render();
  check('unchanged appearance does not re-push on every render',
    h.invokes.filter(function (i) { return i.cmd === 'set_appearance_check'; }).length === before,
    h.invokes.filter(function (i) { return i.cmd === 'set_appearance_check'; }).length);

  // the shell's direct hook wins over storage, and keeps "System" checked
  h = boot({ localStorage: { 'tv-theme': 'dark' } });
  check('an explicit dark choice is pushed at boot',
    h.lastArgs('set_appearance_check').choice === 'dark', h.lastArgs('set_appearance_check'));
  h.TVNative.notifyTheme('system', 'dark');
  check('notifyTheme("system", "dark") checks System, not the resolved paint',
    h.lastArgs('set_appearance_check').choice === 'system', h.lastArgs('set_appearance_check'));
  var n = h.invokes.filter(function (i) { return i.cmd === 'set_appearance_check'; }).length;
  h.TVNative.notifyTheme('system', 'light');
  check('notifyTheme is idempotent, so the menu round trip cannot loop',
    h.invokes.filter(function (i) { return i.cmd === 'set_appearance_check'; }).length === n, n);
  h.TVNative.notifyTheme('nonsense');
  check('notifyTheme ignores an unknown choice',
    h.lastArgs('set_appearance_check').choice === 'system', h.lastArgs('set_appearance_check'));

  // the themechange payload is preferred over re-deriving from storage
  h = boot({ localStorage: { 'tv-theme': 'dark' } });
  h.tv.emit('themechange', { theme: 'dark', choice: 'system' });
  check('themechange {choice} drives the checkmark',
    h.lastArgs('set_appearance_check').choice === 'system', h.lastArgs('set_appearance_check'));

  // Print
  h = boot({});
  h.fire('menu:print');
  await flush();
  check('File ▸ Print… invokes the native print command', h.cmds().indexOf('print_page') !== -1, h.cmds());

  // Reveal in Finder
  h = boot({ tabs: [{ id: 't1', name: 'a.md', nativePath: '/tmp/a.md' }], activeId: 't1' });
  h.fire('menu:reveal-in-finder');
  await flush();
  check('File ▸ Reveal in Finder reveals the active tab',
    h.lastArgs('reveal_in_finder') && h.lastArgs('reveal_in_finder').path === '/tmp/a.md',
    h.lastArgs('reveal_in_finder'));

  h = boot({ tabs: [{ id: 't1', name: 'Untitled' }], activeId: 't1' });
  h.fire('menu:reveal-in-finder');
  await flush();
  check('Reveal on an unsaved document explains itself instead of failing',
    h.cmds().indexOf('reveal_in_finder') === -1 &&
    h.toasts().some(function (t) { return /Save this document first/.test(t.textContent); }),
    h.toasts().map(function (t) { return t.textContent; }));

  // Find Next / Previous
  var steps = [];
  h = boot({ findStep: function (d) { steps.push(d); } });
  h.fire('menu:find-next');
  h.fire('menu:find-prev');
  check('⌘G / ⇧⌘G drive TV.findStep(+1 / -1)', steps.join(',') === '1,-1', steps);

  h = boot({});               // shell without findStep yet
  var threw = false;
  try { h.fire('menu:find-next'); } catch (e) { threw = true; }
  check('Find Next is a quiet no-op until the shell exports findStep', !threw);

  // the removed menu item must not be listened for any more
  check('the retired "Toggle Dark Mode" event is not wired in the bridge',
    SRC.indexOf('menu:theme-toggle') === -1);

  /* ═════════════════════════════════════════════════════════
     F-23 · New File → Save-As
     ═════════════════════════════════════════════════════════ */
  console.log('\nF-23: saving a never-saved New File\n');
  function newFileTab() {
    return { id: 'n1', name: 'Untitled.md', source: 'hello', dirty: true, isNew: true,
             suggestedDir: '/Users/x/proj', savedSource: '' };
  }
  var chosen = { name: 'plan.md', path: '/Users/x/proj/plan.md', content: 'hello', modified: 1 };

  h = boot({ tabs: [newFileTab()], activeId: 'n1', responses: { save_md_file_as: chosen } });
  var nf = h.tv.state.tabs[0];
  var refreshed = [];
  h.tv.refreshFolderFor = function (p) { refreshed.push(p); };
  var outcome = await h.TVNative.saveTab(nf);
  var sentArgs = h.lastArgs('save_md_file_as');
  check('Save-As opens the panel through save_md_file_as', !!sentArgs, h.cmds());
  check('the name key is camelCase (Tauri 2 rejects suggested_name)',
    sentArgs && sentArgs.suggestedName === 'Untitled.md' && !('suggested_name' in sentArgs), sentArgs);
  check('the panel is told where to open', sentArgs && sentArgs.directory === '/Users/x/proj', sentArgs);
  check('the buffer is what gets written', sentArgs && sentArgs.content === 'hello', sentArgs);
  check('a completed save resolves without the "cancelled" marker', outcome !== 'cancelled', outcome);
  check('the tab becomes the file on disk (name, nativePath, directory)',
    nf.name === 'plan.md' && nf.nativePath === '/Users/x/proj/plan.md' && nf.path === '/Users/x/proj', nf);
  check('it is no longer new, has no suggested directory, and is clean',
    nf.isNew === false && nf.suggestedDir === null && nf.dirty === false && nf.savedSource === 'hello', nf);
  check('the folder tree that contains it is asked to refresh',
    refreshed.join() === '/Users/x/proj/plan.md', refreshed);

  // no known directory → the key is simply absent (Rust treats it as None)
  var bare = newFileTab(); bare.suggestedDir = null;
  var h2 = boot({ tabs: [bare], activeId: 'n1', responses: { save_md_file_as: chosen } });
  await h2.TVNative.saveTab(h2.tv.state.tabs[0]);
  check('no directory is sent when none is known',
    h2.lastArgs('save_md_file_as') && !('directory' in h2.lastArgs('save_md_file_as')), h2.lastArgs('save_md_file_as'));

  // cancelling the panel: a distinct, non-error outcome that changes nothing
  h = boot({ tabs: [newFileTab()], activeId: 'n1', responses: { save_md_file_as: null } });
  var cancelTab = h.tv.state.tabs[0];
  var cancelOutcome = await h.TVNative.saveTab(cancelTab);
  check('cancelling resolves with the "cancelled" marker', cancelOutcome === 'cancelled', cancelOutcome);
  check('cancelling leaves the tab dirty, new and path-less',
    cancelTab.dirty === true && cancelTab.isNew === true && !cancelTab.nativePath && cancelTab.name === 'Untitled.md', cancelTab);
  check('cancelling shows no error toast', h.toasts().length === 0,
    h.toasts().map(function (t) { return t.textContent; }));

  // a failed write rejects and says so
  h = boot({ tabs: [newFileTab()], activeId: 'n1', responses: { save_md_file_as: { __reject: 'disk full' } } });
  var failTab = h.tv.state.tabs[0];
  var rejected = false;
  try { await h.TVNative.saveTab(failTab); } catch (e) { rejected = true; }
  check('a failed write rejects so the shell keeps the user in edit mode', rejected);
  check('a failed write leaves the tab new and dirty', failTab.isNew === true && failTab.dirty === true, failTab);
  check('a failed write shows an error toast',
    h.toasts().some(function (t) { return /Save failed/.test(t.textContent); }),
    h.toasts().map(function (t) { return t.textContent; }));

  // The bug this feature had to fix: JS keys must match Rust's parameter names,
  // camelCased. Read the real signature so a rename on either side fails here.
  var LIB = fs.readFileSync(path.join(__dirname, '..', '..', 'tauri-app', 'src-tauri', 'src', 'lib.rs'), 'utf8');
  var sig = LIB.match(/async fn save_md_file_as\(([\s\S]*?)\)\s*->/);
  var params = sig ? sig[1].split(/,\s*(?=\w+\s*:)/).map(function (p) {
    var m = p.trim().match(/^(\w+)\s*:\s*([\s\S]+?),?$/);
    return m ? { name: m[1], type: m[2].trim() } : null;
  }).filter(Boolean) : [];
  var injected = /^(tauri::)?(AppHandle|State|WebviewWindow|Window)/;
  var userParams = params.filter(function (p) { return !injected.test(p.type); });
  var camel = function (s) { return s.replace(/_([a-z])/g, function (_, c) { return c.toUpperCase(); }); };
  var jsKeys = Object.keys(sentArgs || {}).sort().join();
  check('the keys JS sends are exactly the Rust parameters, camelCased',
    userParams.length > 0 && jsKeys === userParams.map(function (p) { return camel(p.name); }).sort().join(),
    { js: jsKeys, rust: userParams.map(function (p) { return camel(p.name); }) });
  var required = userParams.filter(function (p) { return !/^Option</.test(p.type); }).map(function (p) { return camel(p.name); }).sort().join();
  check('the keys JS sends without a directory are exactly the required Rust parameters',
    Object.keys(h2.lastArgs('save_md_file_as') || {}).sort().join() === required,
    { js: Object.keys(h2.lastArgs('save_md_file_as') || {}), required: required });

  console.log('\n' + (failed === 0
    ? 'ALL PASSED (' + passed + ' passed, 0 failed)'
    : 'FAILURES: ' + failed + ' (' + passed + ' passed)'));
  process.exit(failed === 0 ? 0 : 1);
})();
