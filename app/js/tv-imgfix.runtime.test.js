/* ───────────────────────────────────────────────────────────
   Galley · image resolver RUNTIME test harness
   Run: node app/js/tv-imgfix.runtime.test.js

   Loads and EXECUTES app/js/tv-imgfix.js inside a hand-rolled minimal DOM
   plus a fake window.__TAURI__.core.convertFileSrc, then asserts on the
   src each <img> actually ends up with. Mirrors tv-native.runtime.test.js:
   no external deps, plain Node, PASS/FAIL, non-zero exit on failure.

   tvResolveImages() decides which filesystem paths the app hands to the
   asset protocol, so the interesting cases are the ones that must NOT
   resolve as much as the ones that must.

   Covers:
     ISS-007  normalization — every relative src is normalized before the
                              containment check, not only one starting with
                              '../'; an in-tree 'a/../b.png' resolves, a
                              mid-path escape 'a/../../x.png' is blocked.
     ISS-007  error wiring  — imgs whose src the RENDERER set get a JS
                              onerror handler (the inline attribute is inert
                              under the Tauri CSP), including the catch-up
                              path for a load that already failed.
     ISS-006  dot dirs      — '.github/media/x.png' resolves; the frontend
                              never blocked it (that bug was the Rust scope).
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

/* ── minimal DOM: only what tv-imgfix.js touches ──────────── */
function makeClassList(store) {
  return {
    add: function () {
      for (var i = 0; i < arguments.length; i++) {
        if (store.indexOf(arguments[i]) === -1) store.push(arguments[i]);
      }
    },
    remove: function () {
      for (var i = 0; i < arguments.length; i++) {
        var at = store.indexOf(arguments[i]);
        if (at !== -1) store.splice(at, 1);
      }
    },
    contains: function (c) { return store.indexOf(c) !== -1; },
  };
}

// A <figure class="md-img"> wrapping one <img>, the shape tv-markdown.js emits.
// `opts.src` models a src the renderer set; `opts.settled` models an image
// whose load already failed before the resolver ran.
function makeFigure(rawSrc, opts) {
  opts = opts || {};
  var figClasses = ['md-img'];
  var imgClasses = [];
  var attrs = {};
  if (rawSrc != null) attrs['data-img-raw-src'] = rawSrc;
  if (opts.src) attrs.src = opts.src;

  var img = {
    onerror: null,
    complete: !!opts.settled,
    naturalWidth: opts.settled ? 0 : 1,
    classList: makeClassList(imgClasses),
    _classes: imgClasses,
    getAttribute: function (n) { return Object.prototype.hasOwnProperty.call(attrs, n) ? attrs[n] : null; },
    setAttribute: function (n, v) { attrs[n] = v; },
  };
  var figure = { classList: makeClassList(figClasses), _classes: figClasses };
  img.parentNode = figure;
  figure.img = img;
  figure.missing = function () { return figClasses.indexOf('tv-img-missing') !== -1; };
  figure.src = function () { return img.getAttribute('src'); };
  return figure;
}

function makeRoot(figures) {
  var imgs = figures.map(function (f) { return f.img; });
  return {
    querySelectorAll: function (sel) {
      if (sel === 'img[data-img-raw-src]') {
        return imgs.filter(function (i) { return i.getAttribute('data-img-raw-src') !== null; });
      }
      return []; // '.md pre, .md .tbl-wrap' — no overflow cues in these fixtures
    },
  };
}

/* ── load the real module ─────────────────────────────────── */
function loadModule(win) {
  var src = fs.readFileSync(path.join(__dirname, 'tv-imgfix.js'), 'utf8');
  var sandbox = { window: win, URL: URL, console: console };
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(src, sandbox, { filename: 'tv-imgfix.js' });
  return win.tvResolveImages;
}

function tauriWindow() {
  var converted = [];
  var win = {
    TVNative: { available: true },
    __TAURI__: {
      core: {
        convertFileSrc: function (p) {
          converted.push(p);
          return 'asset://localhost/' + encodeURIComponent(p);
        },
      },
    },
    location: { origin: 'http://localhost:8777', href: 'http://localhost:8777/index.html' },
  };
  win._converted = converted;
  return win;
}

function browserWindow() {
  return {
    TVNative: { available: false },
    location: { origin: 'http://localhost:8777', href: 'http://localhost:8777/index.html' },
  };
}

/* ── Tauri mode ───────────────────────────────────────────── */
console.log('\ntv-imgfix runtime — Tauri mode');

var DOC = '/Users/c/docs/note.md';
var DIR = '/Users/c/docs/';

function resolveTauri(rawSrc, opts) {
  var win = tauriWindow();
  var resolve = loadModule(win);
  var fig = makeFigure(rawSrc, opts);
  resolve(makeRoot([fig]), DOC);
  return { fig: fig, converted: win._converted };
}

var r;

r = resolveTauri('./x.png');
check('./x.png resolves inside the document directory',
  r.converted[0] === DIR + 'x.png', r.converted);

// ISS-006: the resolver never blocked dot-leading dirs — the broken README
// image was the Rust asset scope. Pinned here so a future "harden the guard"
// change cannot quietly reintroduce it from the JS side.
r = resolveTauri('.github/media/shot.png');
check('.github/media/shot.png resolves (dot-leading dir is not a JS-side block)',
  r.converted[0] === DIR + '.github/media/shot.png', r.converted);

// ISS-007 (a): the escape the old guard missed. Only a src STARTING with
// '../' was normalized, so these '..' segments survived into the prefix
// check, which then trivially passed.
r = resolveTauri('a/../../secret.png');
check('mid-path escape a/../../secret.png is blocked',
  r.converted.length === 0 && r.fig.missing() && r.fig.src() === null,
  { converted: r.converted, missing: r.fig.missing(), src: r.fig.src() });

r = resolveTauri('./a/../../../.ssh/id_rsa');
check('./a/../../../.ssh/id_rsa is blocked',
  r.converted.length === 0 && r.fig.missing(), r.converted);

r = resolveTauri('../images/logo.png');
check('../images/logo.png (escapes the document directory) is blocked',
  r.converted.length === 0 && r.fig.missing(), r.converted);

// ISS-007 (b): the functional half of the same bug — a legitimate in-tree
// '..' used to reach Tauri un-normalized and 403 on SafePathBuf.
r = resolveTauri('assets/../shared/logo.png');
check('in-tree assets/../shared/logo.png normalizes and resolves',
  r.converted[0] === DIR + 'shared/logo.png', r.converted);

// new URL(...).pathname would return '/Users/c/docs/my%20pics/a%20b.png' here,
// and convertFileSrc would encode the '%' again.
r = resolveTauri('my pics/a b.png');
check('a path with spaces is not percent-encoded by normalization',
  r.converted[0] === DIR + 'my pics/a b.png', r.converted);

r = resolveTauri('data:image/png;base64,AAAA');
check('data: src is set through unchanged',
  r.fig.src() === 'data:image/png;base64,AAAA', r.fig.src());

// ISS-007 (c): renderer-set srcs used to be skipped outright, so their only
// handler was the inline attribute the Tauri CSP refuses to run.
r = resolveTauri('https://example.com/x.png', { src: 'https://example.com/x.png' });
check('renderer-set https src gets a JS onerror handler',
  typeof r.fig.img.onerror === 'function', typeof r.fig.img.onerror);
r.fig.img.onerror();
check('that handler produces the designed placeholder', r.fig.missing());

r = resolveTauri('https://example.com/gone.png',
  { src: 'https://example.com/gone.png', settled: true });
check('an https load that already failed is caught up immediately',
  r.fig.missing(), r.fig._classes);

r = resolveTauri('https://example.com/ok.png', { src: 'https://example.com/ok.png' });
check('a loading image is not falsely marked missing', !r.fig.missing());

// No nativePath yet (the bridge assigns it after openDoc returns).
var winNoPath = tauriWindow();
var resolveNoPath = loadModule(winNoPath);
var figNoPath = makeFigure('x.png');
resolveNoPath(makeRoot([figNoPath]), null);
check('no document path — nothing is resolved and nothing is marked missing',
  winNoPath._converted.length === 0 && !figNoPath.missing() && figNoPath.src() === null);

/* ── browser mode ─────────────────────────────────────────── */
console.log('\ntv-imgfix runtime — browser mode');

function resolveBrowser(rawSrc, opts, docPath) {
  var win = browserWindow();
  var resolve = loadModule(win);
  var fig = makeFigure(rawSrc, opts);
  resolve(makeRoot([fig]), docPath === undefined ? '/sample-docs' : docPath);
  return fig;
}

var fig = resolveBrowser('test-red.png');
check('relative src resolves against the document base URL',
  fig.src() === 'http://localhost:8777/sample-docs/test-red.png', fig.src());

fig = resolveBrowser('https://example.com/x.png', { src: 'https://example.com/x.png' });
check('renderer-set src gets an onerror handler in browser mode too',
  typeof fig.img.onerror === 'function', typeof fig.img.onerror);

fig = resolveBrowser('https://example.com/gone.png',
  { src: 'https://example.com/gone.png', settled: true });
check('a browser-mode load that already failed is caught up',
  fig.missing(), fig._classes);

/* ── idempotency ──────────────────────────────────────────── */
console.log('\ntv-imgfix runtime — idempotency');

var winTwice = tauriWindow();
var resolveTwice = loadModule(winTwice);
var figTwice = makeFigure('./x.png');
var rootTwice = makeRoot([figTwice]);
resolveTwice(rootTwice, DOC);
resolveTwice(rootTwice, DOC);
check('a second pass does not re-resolve an already-resolved img',
  winTwice._converted.length === 1, winTwice._converted);

/* ── report ───────────────────────────────────────────────── */
console.log('\n' + (failed === 0 ? 'PASS' : 'FAIL') +
  '  —  ' + passed + ' passed, ' + failed + ' failed\n');
process.exit(failed === 0 ? 0 : 1);
