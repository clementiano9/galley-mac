/* ───────────────────────────────────────────────────────────
   UXF-08 · motion system  (run: node app/js/tv-motion.test.js)

   Static: every transition / animation in tv-app.css uses a motion token
   (allow-list: the looping live and loading indicators and the large-file
   banner), no `transition: all`, tokens defined once, Reduce Motion zeroes
   them. Runtime: the REAL tv-motion.js under a fake matchMedia / computed
   style. Wiring of the sidebar slide and the enter effects: source guards
   (the slide itself is checked in headless Chrome, see the QA brief).
   ─────────────────────────────────────────────────────────── */
'use strict';

var fs = require('fs');
var path = require('path');
var vm = require('vm');

var pass = 0, fail = 0;
function assert(label, cond, detail) {
  if (cond) { console.log('  PASS  ' + label); pass++; }
  else { console.error('  FAIL  ' + label + (detail !== undefined ? ' — ' + JSON.stringify(detail) : '')); fail++; }
}
var CSS = fs.readFileSync(path.join(__dirname, '..', 'css', 'tv-app.css'), 'utf8');
var TOK = fs.readFileSync(path.join(__dirname, '..', 'css', 'tv-tokens.css'), 'utf8');
var HTML = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
var SRC = fs.readFileSync(path.join(__dirname, 'tv-motion.js'), 'utf8');
var APP = fs.readFileSync(path.join(__dirname, 'tv-app.js'), 'utf8');
var PAL = fs.readFileSync(path.join(__dirname, 'tv-palette.js'), 'utf8');
var SEARCH = fs.readFileSync(path.join(__dirname, 'tv-search.js'), 'utf8');
function extractFn(src, name) {
  var start = src.indexOf('function ' + name + '(');
  var depth = 0;
  for (var j = src.indexOf('{', start); j < src.length; j++) {
    if (src[j] === '{') depth++;
    else if (src[j] === '}' && --depth === 0) return src.slice(start, j + 1);
  }
}

console.log('\nTokens (AC 10)\n');
var NAMES = ['--tv-dur-fast: 100ms', '--tv-dur-base: 160ms', '--tv-dur-slow: 220ms', '--tv-dur-exit: 120ms', '--tv-dur-highlight: 1200ms',
  '--tv-ease-enter: cubic-bezier(.2, .7, .2, 1)', '--tv-ease-exit:  cubic-bezier(.4, 0, 1, 1)', '--tv-ease-move:  cubic-bezier(.32, .72, 0, 1)', '--tv-fade-reduced: 80ms'];
assert('every motion token is defined once, with the spec value', NAMES.every(function (n) { return TOK.split(n).length === 2; }), NAMES.filter(function (n) { return TOK.split(n).length !== 2; }));
assert('Reduce Motion zeroes the five durations',
  /@media \(prefers-reduced-motion: reduce\) \{\s*:root \{ --tv-dur-fast: 0ms; --tv-dur-base: 0ms; --tv-dur-slow: 0ms; --tv-dur-exit: 0ms; --tv-dur-highlight: 0ms; \}/.test(TOK));

var ALLOW = /tv-pulse|tv-shim|tv-blink|tv-blip|tv-drag-pulse|tvLargeBannerDismiss/;
var decls = [];
CSS.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(?:^|[;{\s])(transition|animation)\s*:\s*([^;}]+)/g, function (_, prop, val) {
  decls.push({ prop: prop, val: val.trim() });
  return _;
});
var literal = decls.filter(function (d) {
  if (/^none\b/.test(d.val)) return false;
  if (d.prop === 'animation' && ALLOW.test(d.val)) return false;
  return /(^|[\s,])\.?\d+(\.\d+)?m?s\b/.test(d.val);
});
assert('no literal duration in any transition / animation (outside the allow-list)', literal.length === 0, literal);
assert('no `transition: all`', !decls.some(function (d) { return d.prop === 'transition' && /^all\b|,\s*all\b/.test(d.val); }));
assert('hover and press use --tv-dur-fast with --tv-ease-enter',
  /\.tv-side-toggle \{[^}]*transition: background-color var\(--tv-dur-fast\) var\(--tv-ease-enter\)/.test(CSS));
assert('the chevron rotates in --tv-dur-fast; reveal ring and flash use --tv-dur-highlight',
  /\.tv-chev \{[^}]*transition: transform var\(--tv-dur-fast\)/.test(CSS) &&
  /tv-sbreveal var\(--tv-dur-highlight\)/.test(CSS) && /tv-sbflash var\(--tv-dur-highlight\)/.test(CSS));
assert('toast: 160ms in, 120ms out', /tv-toast-rise var\(--tv-dur-base\) var\(--tv-ease-enter\)/.test(CSS) && /tv-toast-sink var\(--tv-dur-exit\) var\(--tv-ease-exit\)/.test(CSS));
assert('context menu: a 100ms opacity-only fade in', /animation: tv-fade-in var\(--tv-dur-fast\)/.test(CSS) && /@keyframes tv-fade-in \{ from \{ opacity: 0; \} to \{ opacity: 1; \} \}/.test(CSS));
assert('the theme crossfade is 160ms and only without Reduce Motion',
  /@media \(prefers-reduced-motion: no-preference\) \{\s*::view-transition-old\(root\),\s*::view-transition-new\(root\) \{\s*animation-duration: var\(--tv-dur-base\);/.test(CSS));
assert('DR-03 / DR-10: .tv-scroll never smooth-scrolls a restore', /\.tv-scroll \{ scroll-behavior: auto; \}/.test(CSS));
assert('slide support: .tv-body.tv-animating hides overflow; the ghost is absolute and inert to the pointer',
  /\.tv-body\.tv-animating \{ overflow: hidden; position: relative; \}/.test(CSS) && /\.tv-sidebar-ghost \{[^}]*position: absolute;[^}]*pointer-events: none;/.test(CSS));
assert('index.html loads tv-motion.js before tv-app.js', HTML.indexOf('js/tv-motion.js') !== -1 && HTML.indexOf('js/tv-motion.js') < HTML.indexOf('js/tv-app.js'));

console.log('\nTVMotion runtime (fake matchMedia + computed style)\n');
function load(reduce) {
  var calls = [];
  var tokens = { '--tv-dur-fast': ' 100ms', '--tv-dur-base': '160ms', '--tv-dur-slow': '220ms', '--tv-dur-exit': '120ms', '--tv-fade-reduced': '80ms',
    '--tv-ease-move': ' cubic-bezier(.32, .72, 0, 1)', '--tv-ease-enter': 'cubic-bezier(.2, .7, .2, 1)' };
  var win = {
    matchMedia: function (q) { return { matches: reduce && /reduce/.test(q) }; },
    getComputedStyle: function () { return { getPropertyValue: function (k) { return tokens[k] || ''; } }; },
    document: { documentElement: {} }
  };
  var sb = { window: win, console: console };
  vm.runInContext(SRC, vm.createContext(sb), { filename: 'tv-motion.js' });
  var el = { animate: function (k, o) { var a = { keyframes: k, opts: o, l: {}, addEventListener: function (n, f) { this.l[n] = f; }, cancel: function () { this.cancelled = true; (this.l.cancel || function () {})(); }, finish: function () {} }; calls.push(a); return a; } };
  return { M: win.TVMotion, el: el, calls: calls };
}
(function () {
  var h = load(false);
  assert('dur() reads the tokens', h.M.dur('slow') === 220 && h.M.dur('fast') === 100 && h.M.dur('base') === 160 && h.M.dur('exit') === 120);
  assert('ease() reads the tokens', h.M.ease('move') === 'cubic-bezier(.32, .72, 0, 1)');
  var a = h.M.play(h.el, [{ transform: 'translateX(-264px)' }, { transform: 'none' }], { dur: 'slow', ease: 'move' });
  assert('play() animates with the token duration and easing', a && a.opts.duration === 220 && a.opts.easing === 'cubic-bezier(.32, .72, 0, 1)', a && a.opts);
  var e = h.M.enter(h.el, { y: 4 });
  assert('enter() fades in from 0 with a rise, 100ms', e.opts.duration === 100 && e.keyframes[0].opacity === 0 && e.keyframes[0].transform === 'translateY(4px)');
  h.M.play(h.el, [{ opacity: 0 }, { opacity: 1 }], { group: 'g' });
  h.M.cancelAll('g');
  assert('cancelAll(group) cancels that group', h.calls[h.calls.length - 1].cancelled === true);
  var r = load(true);
  assert('Reduce Motion: play() returns null (nothing moves)', r.M.reduced() === true && r.M.play(r.el, [{ transform: 'none' }], {}) === null);
  var f = r.M.enter(r.el, { y: 4, reducedFade: true });
  assert('Reduce Motion: an overlay gets an opacity-only fade of at most 80ms', f && f.opts.duration <= 80 && !('transform' in f.keyframes[0]));
  assert('Reduce Motion: other enters do nothing', r.M.enter(r.el, { from: 0.5 }) === null);
})();

console.log('\nWiring (source guards)\n');
var toggle = extractFn(APP, 'toggleSidebar');
assert('toggleSidebar slides unless opts.animate === false', /if \(!\(opts && opts\.animate === false\)\) sidebarMotionStart\(!wasOpen\);/.test(toggle));
assert('the responsive auto-open/close never slides (it does not call toggleSidebar)', !/toggleSidebar\(/.test(extractFn(APP, 'init').slice(0, 2200)));
var start = extractFn(APP, 'sidebarMotionStart'), playFn = extractFn(APP, 'playSidebarMotion');
assert('no motion under Reduce Motion', /TVMotion\.reduced\(\)\) return;/.test(start));
assert('a second toggle finishes the running slide first', /if \(_sbRunning\) finishSidebarMotion\(\);/.test(start));
assert('delta is measured from the viewer centre (FLIP), not S / 2', /p\.center - \(vr\.left \+ vr\.width \/ 2\)/.test(playFn));
assert('show: the sidebar slides from -S and the viewer glides, 220ms --tv-ease-move',
  /translateX\(' \+ \(-p\.S\) \+ 'px\)' \}, \{ transform: 'none' \}\], move\)/.test(playFn) && /var move = \{ dur: 'slow', ease: 'move' \};/.test(playFn));
assert('hide: an aria-hidden, inert, id-free clone slides away', /setAttribute\('aria-hidden', 'true'\)/.test(playFn) && /setAttribute\('inert', ''\)/.test(playFn) && /removeAttribute\('id'\)/.test(playFn));
assert('cleanup removes the ghost, .tv-animating and will-change', /removeChild\(run\.ghost\)/.test(extractFn(APP, 'sidebarMotionCleanup')) &&
  /classList\.remove\('tv-animating'\)/.test(extractFn(APP, 'sidebarMotionCleanup')) && /style\.willChange = ''/.test(extractFn(APP, 'sidebarMotionCleanup')));
assert('a render for another reason mid-slide ends it silently', /if \(_sbRunning && !_sbPending\) \{[\s\S]{0,300}sidebarMotionCleanup\(\);/.test(extractFn(APP, 'render')));
assert('open-folder and reveal slide the sidebar in', /sidebarMotionStart\(true\); \/\/ UXF-08: open-folder/.test(APP) && /sidebarMotionStart\(true\); \/\/ UXF-08\n/.test(APP));
assert('new tab pill: 160ms fade, not during session restore', /if \(!state\.sessionRestoring\) _enterTabId = tab\.id;/.test(APP) &&
  /TVMotion\.play\(pills\[i\], \[\{ opacity: 0 \}, \{ opacity: 1 \}\], \{ dur: 'base', ease: 'enter' \}\)/.test(APP));
assert('a tab switch writes state.mode directly, so it never crossfades (DR-09)', /if \(state\.mode !== m\) _modeEnter = true;/.test(extractFn(APP, 'setMode')) &&
  extractFn(APP, '_doActivateTab').indexOf('_modeEnter') === -1);
assert('edit crossfade starts at .5 opacity', /TVMotion\.enter\(view, \{ from: 0\.5, dur: 'fast' \}\)/.test(APP));
assert('theme commit uses startViewTransition (not under Reduce Motion, not for previews)',
  /themeTransition\(render\);/.test(extractFn(APP, 'setTheme')) && extractFn(APP, 'previewAppearance').indexOf('themeTransition') === -1 &&
  /if \(reduce \|\| typeof document\.startViewTransition !== 'function'\) \{ fn\(\); return; \}/.test(extractFn(APP, 'themeTransition')));
assert('heading jump: smooth, or auto under Reduce Motion', /behavior: \(window\.TVMotion && TVMotion\.reduced\(\)\) \? 'auto' : 'smooth'/.test(APP));
assert('palette, search and find bar enter (100ms, 80ms fade under Reduce Motion); close stays instant',
  /TVMotion\.enter\(_overlayEl, \{ y: 4, reducedFade: true \}\)/.test(PAL) && /TVMotion\.enter\(_containerEl, \{ y: 4, reducedFade: true \}\)/.test(SEARCH) &&
  /TVMotion\.enter\(_findBarEl, \{ y: -6, reducedFade: true \}\)/.test(APP));
assert('a repaint that re-creates the find bar does not animate it', /_openFindBar\(\{ restoring: true \}\)/.test(APP));

console.log('\nFix round 3\n');
var inPlace = extractFn(APP, 'applySidebarInPlace');
assert('#6: ⌘B / button / swipe update the persistent nodes instead of render()',
  /if \(!applySidebarInPlace\(\)\) render\(\);/.test(extractFn(APP, 'toggleSidebar')) &&
  /side\.classList\.toggle\('collapsed', !open\)/.test(inPlace) && /btn\.setAttribute\('aria-expanded', String\(open\)\)/.test(inPlace) &&
  /wireSidebarResize\(tvEl\)/.test(inPlace) && /if \(!open\) captureSidebarScroll\(host\);/.test(inPlace) && /if \(open\) restoreSidebarScroll\(host\);/.test(inPlace));
assert('#6: …falls back to render() inside a batch or without the shell', /if \(!side \|\| !btn \|\| _renderSuspend > 0\) return false;/.test(inPlace));
assert('#6: table re-measure waits for the slide to end (no forced layout in its first frame)',
  /_tableSizeAfterMotion = true;\s*playSidebarMotion\(host\);/.test(inPlace) &&
  /if \(_sbRunning\) \{ _tableSizeAfterMotion = true; return; \}/.test(extractFn(APP, 'scheduleWideTables')) &&
  /if \(_tableSizeAfterMotion\) \{\s*_tableSizeAfterMotion = false;\s*sizeTables\(document\);/.test(extractFn(APP, 'sidebarMotionCleanup')));
assert('#3: the theme transition runs only the 160ms crossfade (no 250ms root group animation)',
  /::view-transition-group\(root\) \{ animation: none; \}/.test(CSS));
var prm = extractFn(APP, 'playRenderMotion');
assert('#4 (audit row 9): the toggled folder\'s chevron rotates from its old angle, 100ms',
  /_chevMotion = \{ key: key, opening: !!state\.folderCollapsed\[key\] \};/.test(extractFn(APP, 'toggleFolderCollapse')) &&
  /rotate\(0deg\)' \}, \{ transform: 'rotate\(90deg\)' \}\]/.test(prm) && /\{ dur: 'fast', ease: 'enter' \}/.test(prm));
var IMG = fs.readFileSync(path.join(__dirname, 'tv-imgfix.js'), 'utf8');
var MDJS = fs.readFileSync(path.join(__dirname, 'tv-markdown.js'), 'latin1');
assert('#5 (audit row 26): an image fades in 160ms the first time its source loads, never on a re-render',
  /if \(_shownSrc\[src\]\) return;/.test(IMG) && /window\.TVMotion\.enter\(img, \{ dur: 'base' \}\)/.test(IMG) && /wireLoadFade\(img\);/.test(IMG));
assert('#5: a freshly drawn Mermaid diagram fades in; cache hits do not',
  /_injectSvg\(dg, loadEl2, result\.svg\);[\s\S]{0,700}window\.TVMotion\.enter\(drawn, \{ dur: "base" \}\)/.test(MDJS) &&
  !/_injectSvg\(dg, cachedLoad, cachedSvg\);\s*\n[^\n]*TVMotion/.test(MDJS));

console.log('\nFix round 4\n');
function cssRule(sel) { var i = CSS.indexOf(sel + ' {'); return i === -1 ? '' : CSS.slice(i, CSS.indexOf('}', i) + 1); }
assert('#1: find / highlight marks are layout-neutral (no padding; the spread is a shadow)',
  /padding: 0;/.test(cssRule('.md mark')) && /box-shadow: -2px 0 0 0 var\(--tv-accent-weak\), 2px 0 0 0 var\(--tv-accent-weak\)/.test(cssRule('.md mark')) &&
  !/padding:/.test(cssRule('.md mark[data-find].current')) && /box-shadow: 0 0 0 1px var\(--tv-accent\)/.test(cssRule('.md mark[data-find].current')));
assert('#2: a diagram fades only on its first draw (a theme redraw misses the cache but does not fade)',
  /var firstDraw = !_drawnOnce\[_hashStr\(code\)\];/.test(MDJS) && /if \(firstDraw && drawn && window\.TVMotion\)/.test(MDJS));
assert('#3: ⌘B seeds the first VISIBLE row and does not scroll the list',
  /var firstOpt = firstVisibleSidebarOption\(listbox\);/.test(extractFn(APP, 'toggleSidebar')) && /_lastCursorScrollId = sbKbd\.id;\s*renderSidebarCursor\(\);/.test(extractFn(APP, 'toggleSidebar')));
(function () {
  function el(top, h, attrs) { return { attrs: attrs || {}, getBoundingClientRect: function () { return { top: top, bottom: top + h, height: h }; }, getAttribute: function (k) { return this.attrs[k] || null; } }; }
  var head = el(100, 30, { 'data-sidebar-item': 'folder:/k' });
  var rows = [head, el(-200, 30, { 'data-sidebar-item': 'file:a' }), el(118, 30, { 'data-sidebar-item': 'file:b' }), el(131, 30, { 'data-sidebar-item': 'file:c' })];
  var listbox = { scrollTop: 600, getBoundingClientRect: function () { return { top: 100, bottom: 800 }; },
    querySelectorAll: function (s) { return /tv-folder-head/.test(s) ? [head] : rows; } };
  var sb = { Math: Math };
  vm.runInContext(extractFn(APP, 'firstVisibleSidebarOption'), vm.createContext(sb));
  var pick = sb.firstVisibleSidebarOption(listbox);
  assert('…the pick skips rows scrolled away and rows under the pinned root head', pick === rows[3], pick && pick.attrs);
  listbox.scrollTop = 0;
  assert('…and at the top of the list it is the first row', sb.firstVisibleSidebarOption(listbox) === head);
})();
var warm = extractFn(APP, 'warmSidebarToggle');
assert('#4: the toggle path is warmed once during idle after launch',
  /setTimeout\(scheduleSidebarWarmup, 3000\);/.test(APP) && /requestIdleCallback\(run, \{ timeout: 2000 \}\)/.test(extractFn(APP, 'scheduleSidebarWarmup')));
var sched = extractFn(APP, 'scheduleSidebarWarmup');
assert('addendum a: at most once per launch, never while input is pending or just happened',
  /if \(_warmedThisLaunch \|\| tries > 20\) return;/.test(sched) && /isInputPending\(\)/.test(sched) &&
  /Date\.now\(\) - _lastInputAt < 500/.test(sched) && /_warmedThisLaunch = true;/.test(sched));
assert('addendum a: the warm-up node is marked data-tv-warmup', /ghost\.setAttribute\('data-tv-warmup', ''\);/.test(warm));
assert('fix round 5 #2: the DR-113 seed waits for the slide to end (it stalled the native ⌘B first toggle)',
  /afterSidebarMotion\(function \(\) \{ requestAnimationFrame\(function \(\) \{/.test(extractFn(APP, 'toggleSidebar')) &&
  /var queued = _afterMotion;[\s\S]{0,80}queued\.forEach\(function \(fn\) \{ fn\(\); \}\);/.test(extractFn(APP, 'sidebarMotionCleanup')) &&
  /if \(_sbRunning\) _afterMotion\.push\(fn\);\s*else fn\(\);/.test(extractFn(APP, 'afterSidebarMotion')));
assert('#4: …by painting one inert, aria-hidden clone at opacity .001 and running one real animation on it',
  /ghost\.style\.opacity = '0\.001';/.test(warm) && /setAttribute\('inert', ''\)/.test(warm) && /setAttribute\('aria-hidden', 'true'\)/.test(warm) &&
  /TVMotion\.play\(ghost,/.test(warm) && /if \(_warm \|\| _sbRunning \|\| _sbPending \|\| !window\.TVMotion \|\| TVMotion\.reduced\(\)\) return;/.test(warm));
assert('#4: …which a real toggle or any render ends at once (DR-04: the clone never outlives its animation)',
  /endSidebarWarmup\(\);\s*\n\s*if \(!window\.TVMotion \|\| TVMotion\.reduced\(\)\) return;/.test(extractFn(APP, 'sidebarMotionStart')) &&
  /endSidebarWarmup\(\);/.test(extractFn(APP, 'render')) && /removeChild\(w\.ghost\)/.test(extractFn(APP, 'endSidebarWarmup')));

console.log('\n' + (fail === 0 ? 'ALL PASSED' : 'FAILURES: ' + fail) + ' (' + pass + ' passed, ' + fail + ' failed)\n');
if (fail > 0) process.exit(1);
