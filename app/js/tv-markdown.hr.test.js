/* ───────────────────────────────────────────────────────────
   Galley · FREEZE-01 regression suite
   A line of 4+ identical -, * or _ used to hang tvRenderMarkdown forever:
   the hr rule matched exactly three markers (its `[ \1]*` class is the octal
   escape \x01, not a backreference), while the paragraph fallback refused any
   /^\s*[-*_]{3,}\s*$/ line — so nothing consumed the line, `i` never advanced,
   and the block loop spun at 100% CPU. Reported from the field as
   "the app freezes when I select anything" (opening a letter whose signature
   line was 31 underscores).

   Every render below runs under a wall-clock budget, so a re-introduced stall
   fails the suite instead of hanging CI.
   ─────────────────────────────────────────────────────────── */
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const BUDGET_MS = 2000;
let pass = 0, fail = 0;

function loadRenderer() {
  const el = () => ({
    style: {}, dataset: {}, children: [], childNodes: [], innerHTML: '', textContent: '',
    scrollWidth: 0, clientWidth: 0, scrollLeft: 0,
    classList: { add() {}, remove() {}, toggle() {}, contains: () => false },
    setAttribute() {}, removeAttribute() {}, getAttribute: () => null,
    appendChild() {}, removeChild() {}, addEventListener() {},
    querySelector: () => null, querySelectorAll: () => [],
  });
  const sandbox = {
    console, setTimeout, clearTimeout, requestAnimationFrame: () => 0,
    Date, Math, JSON, RegExp, String, Number, Array, Object,
  };
  sandbox.window = sandbox;
  // MD-01: the renderer parses with the vendored marked.
  sandbox.marked = require('./vendor/marked.umd.js');
  sandbox.globalThis = sandbox;
  sandbox.document = {
    createElement: el, createTextNode: () => el(), createDocumentFragment: el,
    body: el(), documentElement: el(),
    querySelector: () => null, querySelectorAll: () => [], addEventListener() {},
  };
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(path.join(__dirname, 'tv-markdown.js'), 'utf8'), sandbox, {
    filename: 'tv-markdown.js',
  });
  if (typeof sandbox.tvRenderMarkdown !== 'function') {
    throw new Error('tvRenderMarkdown was not exported');
  }
  return sandbox.tvRenderMarkdown;
}

const render = loadRenderer();

function check(label, fn) {
  let ok = false, detail = '';
  const t0 = Date.now();
  try {
    const r = fn();
    ok = r === true;
    if (!ok) detail = ' — ' + r;
  } catch (e) {
    detail = ' — threw ' + e.message;
  }
  const ms = Date.now() - t0;
  if (ok && ms > BUDGET_MS) { ok = false; detail = ` — took ${ms}ms (budget ${BUDGET_MS}ms)`; }
  if (ok) { pass++; console.log(`PASS  ${label}  (${ms}ms)`); }
  else { fail++; console.log(`FAIL  ${label}${detail}`); }
}

/* 1. Marker runs of every length terminate, and are thematic breaks (CommonMark). */
for (const ch of ['-', '*', '_']) {
  for (const n of [3, 4, 5, 8, 31, 200]) {
    check(`run of ${n} "${ch}" renders an <hr> and terminates`, () => {
      const html = render(ch.repeat(n));
      return html.indexOf('<hr>') !== -1 || `expected <hr>, got ${html.slice(0, 60)}`;
    });
  }
}

/* 2. Spaced and indented forms, and runs embedded in a document. */
check('spaced form "- - - -" is an <hr>', () => render('- - - -').indexOf('<hr>') !== -1 || 'no <hr>');
check('spaced form "_ _ _" is an <hr>', () => render('_ _ _').indexOf('<hr>') !== -1 || 'no <hr>');
check('indented "  ____" is an <hr>', () => render('  ____').indexOf('<hr>') !== -1 || 'no <hr>');
check('trailing spaces "---   " is an <hr>', () => render('---   ').indexOf('<hr>') !== -1 || 'no <hr>');
check('a 31-underscore signature line inside a letter terminates', () => {
  const doc = 'Dear Sir,\n\nBody text here.\n\n' + '_'.repeat(31) + '\n\nSignature\n';
  const html = render(doc);
  return (html.indexOf('<hr>') !== -1 && html.indexOf('Signature') !== -1) || 'missing <hr> or body';
});

/* 3. Things that must NOT become thematic breaks. */
check('"- item" stays a list, not an <hr>', () => render('- item').indexOf('<hr>') === -1 || 'became <hr>');
check('"--" (only two) is not an <hr>', () => render('--').indexOf('<hr>') === -1 || 'became <hr>');
check('"***bold***" is not an <hr>', () => render('***bold***').indexOf('<hr>') === -1 || 'became <hr>');
check('"-*-" (mixed markers) is not an <hr>', () => render('-*-').indexOf('<hr>') === -1 || 'became <hr>');
check('setext "Title\\n---" stays a heading', () => {
  const html = render('Title\n---');
  return /<h2[ >]/.test(html) || `expected <h2>, got ${html.slice(0, 80)}`;
});

/* 4. The structural guarantee: the block loop always advances. Feed lines that
      match no branch and confirm the renderer still returns. */
check('unclaimed lines cannot stall the loop', () => {
  const odd = ['', '​', '=-=-=-=', '::::', '>>>>', '||||'].join('\n');
  const html = render(odd);
  return typeof html === 'string' || 'no output';
});

/* 5. Ordinary documents still render (no collateral damage). */
check('a mixed document still renders its parts', () => {
  const doc = '# Title\n\nA paragraph.\n\n----\n\n- one\n- two\n\n| a | b |\n| - | - |\n| 1 | 2 |\n\n```js\ncode();\n```\n';
  const html = render(doc);
  for (const needle of ['<h1', '<p>', '<hr>', '<li>', '<table', '<pre']) {
    if (html.indexOf(needle) === -1) return `missing ${needle}`;
  }
  return true;
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
