/* ───────────────────────────────────────────────────────────
   Galley · UXF-11 reading-progress rail — runtime harness
   Run: node app/js/tv-progress.runtime.test.js
   Loads and EXECUTES tv-progress.js against a minimal fake DOM: a viewer, a
   scroller with settable geometry, a TV emitter that fires 'render'.
   ─────────────────────────────────────────────────────────── */
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

let pass = 0, fail = 0;
function check(label, cond, detail) {
  if (cond) { pass++; console.log('PASS  ' + label); }
  else { fail++; console.log('FAIL  ' + label + (detail !== undefined ? ' — ' + JSON.stringify(detail) : '')); }
}

function el(cls) {
  const listeners = {}, classes = new Set(cls ? cls.split(' ') : []), attrs = {};
  const e = {
    style: {}, children: [], parentNode: null, isConnected: true, listeners,
    classList: {
      add: (...c) => c.forEach((x) => classes.add(x)), remove: (...c) => c.forEach((x) => classes.delete(x)),
      toggle: (c, on) => { if (on === undefined) on = !classes.has(c); on ? classes.add(c) : classes.delete(c); return on; },
      contains: (c) => classes.has(c)
    },
    get className() { return [...classes].join(' '); },
    set className(v) { classes.clear(); v.split(' ').forEach((x) => x && classes.add(x)); },
    setAttribute: (k, v) => { attrs[k] = v; }, getAttribute: (k) => attrs[k],
    addEventListener: (t, fn) => { (listeners[t] = listeners[t] || []).push(fn); },
    removeEventListener: (t, fn) => { listeners[t] = (listeners[t] || []).filter((f) => f !== fn); },
    fire: (t, ev) => (listeners[t] || []).forEach((fn) => fn(ev || {})),
    appendChild: (c) => { c.parentNode = e; e.children.push(c); return c; },
    removeChild: (c) => { e.children = e.children.filter((x) => x !== c); c.parentNode = null; return c; },
    querySelector: () => null,
    getBoundingClientRect: () => ({ top: 0, left: 0 }),
    setPointerCapture() {}, releasePointerCapture() {},
    set innerHTML(h) { e.children = []; (h.match(/class="([^"]+)"/g) || []).forEach((m) => e.appendChild(el(m.slice(7, -1)))); },
    get firstChild() { return e.children[0]; }, get lastChild() { return e.children[e.children.length - 1]; },
  };
  return e;
}

// 2,300 words in the document; window 800 px tall, document 8,000 px.
const md = el('md'); md.textContent = 'word '.repeat(2300);
const content = el('tv-content');
function makeScroller() {
  const s = el('tv-scroll');
  Object.assign(s, { scrollHeight: 8000, clientHeight: 800, scrollTop: 0, offsetTop: 0 });
  s.querySelector = (q) => q === '.md' ? md : q === '.tv-content' ? content : null;
  s.contains = (t) => t === s || t === md || t === content;
  return s;
}
let scroller = makeScroller();
const viewer = el('tv-viewer');
viewer.querySelector = (s) => s === '.tv-scroll' ? scroller : null;
const root = el('tv'); root.querySelector = (s) => s === '.tv-viewer' ? viewer : null;

const handlers = {}, winL = {}, docL = {};
const winFire = (t, ev) => (winL[t] || []).slice().forEach((fn) => fn(ev));
// Fake timers and clock: clearTimeout really cancels, flush() runs what is due.
let clock = 1e6, tid = 0;
const timers = new Map();
const flush = () => { const due = [...timers.values()]; timers.clear(); due.forEach((fn) => fn()); };
const sb = {
  console, Math, JSON, String, Number, Array, Object, RegExp,
  Date: { now: () => clock },
  setTimeout: (fn) => { timers.set(++tid, fn); return tid; }, clearTimeout: (id) => { timers.delete(id); },
  requestAnimationFrame: (fn) => { fn(); return 1; },
  ResizeObserver: function (cb) { this.observe = () => {}; this.disconnect = () => {}; sb._ro = cb; },
  matchMedia: () => ({ matches: false }),
  addEventListener: (t, fn) => { (winL[t] = winL[t] || []).push(fn); },
  removeEventListener: (t, fn) => { winL[t] = (winL[t] || []).filter((f) => f !== fn); },
  document: { readyState: 'complete', createElement: () => el(''), addEventListener: (t, fn) => { (docL[t] = docL[t] || []).push(fn); } },
  TV: { el: () => root, on: (ev, fn) => { handlers[ev] = fn; } }
};
sb.window = sb;
vm.createContext(sb);
vm.runInContext(fs.readFileSync(path.join(__dirname, 'tv-progress.js'), 'utf8'), sb, { filename: 'tv-progress.js' });
const P = sb.TVProgress;
const rail = viewer.children[0];
const thumb = rail && rail.children[0];
const tip = rail && rail.children[1];
const flushRaf = () => {};

check('a rail is appended to the viewer, aria-hidden', rail && rail.className.includes('tv-progress') && rail.getAttribute('aria-hidden') === 'true');
check('it listens for render events', typeof handlers.render === 'function');
check('long document → rail on', rail.classList.contains('is-on') && P.state().visible);
check('thumb length = share on screen (800/8000 of a 788 px track ≈ 79 px)', thumb.style.height === '79px', thumb.style.height);
check('top of the document: 0%, thumb at the top', P.state().pct === 0 && thumb.style.transform === 'translateY(0px)');
check('minutes left at the top ≈ 9 (2,070 words below the fold / 230)', P.state().minutesLeft === 9, P.state());

check('hidden at rest: no is-active before any scrolling', !rail.classList.contains('is-active'));

// A scroll nobody asked for (a render restoring scrollTop, an image loading) moves the thumb but keeps it hidden.
scroller.scrollTop = 3600; scroller.fire('scroll'); flushRaf();
check('half way: 50%', P.state().pct === 50, P.state());
check('thumb moves half the free track ((788-79)/2 ≈ 355 px)', thumb.style.transform === 'translateY(355px)', thumb.style.transform);
check('a scroll with no wheel, key or click stays hidden', !rail.classList.contains('is-active'));

// The reader scrolls: wheel, then scroll events.
winFire('wheel', {}); scroller.scrollTop = 3700; scroller.fire('scroll');
check('wheel + scroll shows it (is-active)…', rail.classList.contains('is-active'));
clock += 600; scroller.scrollTop = 3800; scroller.fire('scroll');
check('…momentum scrolls with no new wheel keep it shown', rail.classList.contains('is-active') && timers.size === 1);
clock += 900; flush();
check('…and it hides once scrolling stops (idle timer)', !rail.classList.contains('is-active'));

docL.keydown.forEach((fn) => fn({ key: 'a' })); scroller.fire('scroll');
check('typing a letter is not scrolling', !rail.classList.contains('is-active'));
docL.keydown.forEach((fn) => fn({ key: ' ' })); scroller.fire('scroll');
check('Space (a scroll key) then scroll shows it', rail.classList.contains('is-active'));
flush();
docL.keydown.forEach((fn) => fn({ key: 'PageDown' })); clock += 401; scroller.fire('scroll');
check('a scroll 400 ms after the key is not the reader\'s', !rail.classList.contains('is-active'));

scroller.scrollTop = 7200; scroller.fire('scroll');
check('bottom: 100%, 0 min left', P.state().pct === 100 && P.state().minutesLeft === 0, P.state());

// Hover shows the tip.
rail.fire('pointerenter');
check('hover widens (is-hover) and the tip reads "End" at the bottom', rail.classList.contains('is-hover') && tip.textContent === 'End', tip.textContent);
scroller.scrollTop = 1800; scroller.fire('scroll');
check('tip text "25% · 7 min left"', tip.textContent === '25% · 7 min left', tip.textContent);
rail.fire('pointerleave');
check('leaving the rail keeps it shown, then it fades', rail.classList.contains('is-active') && !rail.classList.contains('is-hover'));
flush();
check('…gone after the idle delay', !rail.classList.contains('is-active'));

// Drag: 100 px of pointer movement scrolls 100 × 7200/709 px.
const ev = (y) => ({ button: 0, clientY: y, pointerId: 1, preventDefault() {}, stopPropagation() {} });
scroller.scrollTop = 0; scroller.fire('scroll');
rail.fire('pointerdown', ev(20));
winFire('pointermove', ev(120));
check('dragging the thumb scrolls proportionally', Math.abs(scroller.scrollTop - 100 * 7200 / 709) < 1, scroller.scrollTop);
handlers.render();   // a live update mid-drag
winFire('pointermove', ev(220));
check('a render mid-drag does not end the drag (QA defect 5)', Math.abs(scroller.scrollTop - 200 * 7200 / 709) < 1, scroller.scrollTop);
winFire('pointerup', ev(220));
check('drag ends cleanly and stops listening', !rail.classList.contains('is-drag') && !(winL.pointermove || []).length);

// Click on the track below the thumb jumps there.
rail.fire('pointerdown', ev(600)); winFire('pointerup', ev(600));
check('clicking the track centres the thumb on the click', Math.abs(scroller.scrollTop - ((600 - 39.5) / 709) * 7200) < 2, scroller.scrollTop);

// Wheel over the rail scrolls the document (QA defect 4).
scroller.scrollTop = 1000;
rail.fire('wheel', { deltaY: 300, deltaMode: 0, preventDefault() {} });
check('wheel over the rail scrolls the document', scroller.scrollTop === 1300, scroller.scrollTop);
rail.fire('wheel', { deltaY: 3, deltaMode: 1, preventDefault() {} });
check('line-mode wheel deltas are converted (3 lines = 48 px)', scroller.scrollTop === 1348, scroller.scrollTop);

// A selection drag that starts in the text passes over the rail (QA defect 6).
rail.contains = (t) => t === rail || rail.children.includes(t);
docL.pointerdown.forEach((fn) => fn({ target: md }));
check('pointerdown in the text makes the rail pass-through', rail.classList.contains('is-passive'));
docL.pointerup.forEach((fn) => fn({}));
check('…until the button is released', !rail.classList.contains('is-passive'));
docL.pointerdown.forEach((fn) => fn({ target: rail }));
check('pointerdown on the rail keeps it interactive', !rail.classList.contains('is-passive'));
docL.pointerup.forEach((fn) => fn({}));

// A render that swaps the scroller (tab click, ⌘1, live update) is not scrolling, even right after input.
flush();
docL.pointerdown.forEach((fn) => fn({ target: md })); docL.pointerup.forEach((fn) => fn({}));
const oldScroller = scroller;
scroller = makeScroller(); handlers.render();
scroller.scrollTop = 2400; scroller.fire('scroll');
check('render + restored scrollTop right after a click does not flash the rail', !rail.classList.contains('is-active'));
check('the old scroller is released', !(oldScroller.listeners.scroll || []).length);
winFire('wheel', {}); scroller.scrollTop = 2500; scroller.fire('scroll');
check('the new scroller shows it when the reader scrolls', rail.classList.contains('is-active'));
flush();

// Short document: no rail.
scroller.scrollHeight = 700; scroller.scrollTop = 0; sb._ro(); flushRaf();
check('a document that fits the window hides the rail', !rail.classList.contains('is-on') && !P.state().visible);

// Edit mode: toolbar above the scroller → the track starts below it.
scroller.scrollHeight = 5000; scroller.offsetTop = 44; handlers.render();
check('the track starts under an edit toolbar (top = offsetTop + 6)', viewer.children[0].style.top === '50px', viewer.children[0].style.top);
check('re-render keeps one rail, the same element', viewer.children.filter((c) => c.className.includes('tv-progress')).length === 1 && viewer.children[0] === rail);

// Source guards
const CSS = fs.readFileSync(path.join(__dirname, '..', 'css', 'tv-app.css'), 'utf8');
const PRINT = fs.readFileSync(path.join(__dirname, '..', 'css', 'tv-print.css'), 'utf8');
const HTML = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
check('the native document scrollbar never takes width on hover', !/\.tv-scroll:hover::-webkit-scrollbar/.test(CSS));
check('rail is an overlay (position: absolute) and hidden in print',
  /\.tv-progress \{\s*position: absolute;/.test(CSS) && /\.tv-progress \{ display: none !important; \}/.test(PRINT));
check('reduced motion: no transitions and no slide', /prefers-reduced-motion: reduce\) \{\s*\.tv-progress-thumb, \.tv-progress-tip \{ transition: none; \}\s*\.tv-progress\.is-on \{ transform: none; \}/.test(CSS));
check('hidden at rest: opacity 0, nudged 3 px right, fades out with the exit tokens',
  /\.tv-progress \{[^}]*opacity: 0; transform: translateX\(3px\);\s*transition: opacity var\(--tv-dur-slow\) var\(--tv-ease-exit\)/.test(CSS));
check('shown while scrolling, hovered or dragged: fades in with the enter tokens',
  /\.tv-progress\.is-active, \.tv-progress\.is-hover, \.tv-progress\.is-drag \{\s*opacity: 1; transform: none;\s*transition: opacity var\(--tv-dur-base\) var\(--tv-ease-enter\)/.test(CSS));
check('index.html loads tv-progress.js after tv-app.js', /tv-app\.js"><\/script>\s*<script src="js\/tv-progress\.js"/.test(HTML));

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
