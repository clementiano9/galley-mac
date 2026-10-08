/* ───────────────────────────────────────────────────────────
   Galley · DOC-MENU suite
   · Copy as Markdown: the real renderer's HTML (tv-markdown.js) is parsed
     into a small DOM and serialised back by TVDocMenu.toMarkdown — the
     markdown that comes back must be what the author wrote.
   · resolveLink: what a document link points at.
   ─────────────────────────────────────────────────────────── */
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const TVDocMenu = require('./tv-docmenu.js');

let pass = 0, fail = 0;
function check(label, cond, detail) {
  if (cond) { pass++; console.log('PASS  ' + label); }
  else { fail++; console.log('FAIL  ' + label + (detail ? '\n      ' + String(detail).replace(/\n/g, '\n      ') : '')); }
}

// ── the renderer ─────────────────────────────────────────
const sb = { console, Date, Math, JSON, RegExp, String, Number, Array, Object, setTimeout, clearTimeout };
sb.window = sb;
sb.marked = require('./vendor/marked.umd.js');
sb.btoa = (s) => Buffer.from(s, 'binary').toString('base64');
sb.document = { querySelector: () => null, querySelectorAll: () => [], addEventListener() {}, createElement: () => ({ style: {} }) };
vm.createContext(sb);
vm.runInContext(fs.readFileSync(path.join(__dirname, 'tv-markdown.js'), 'utf8'), sb);
global.atob = (s) => Buffer.from(s, 'base64').toString('binary');

// ── a minimal DOM for well-formed renderer output ─────────
const VOID = /^(img|br|hr|input|meta|link|source)$/i;
function decode(s) {
  return s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&');
}
function el(tag, attrs) {
  const n = {
    nodeType: 1, nodeName: tag.toUpperCase(), attrs, childNodes: [], parentNode: null,
    getAttribute: (k) => (k in attrs ? attrs[k] : null),
    hasAttribute: (k) => k in attrs,
    classList: { contains: (c) => (attrs.class || '').split(/\s+/).indexOf(c) !== -1 },
    style: { textAlign: ((attrs.style || '').match(/text-align:\s*(\w+)/) || [])[1] || '' },
    get textContent() { return this.childNodes.map((c) => (c.nodeType === 3 ? c.nodeValue : c.textContent)).join(''); },
    querySelectorAll(sel) { const out = []; walk(this, (d) => { if (matches(d, sel)) out.push(d); }); return out; },
    querySelector(sel) { return this.querySelectorAll(sel)[0] || null; },
  };
  return n;
}
function walk(n, fn) { n.childNodes.forEach((c) => { if (c.nodeType === 1) { fn(c); walk(c, fn); } }); }
function matches(n, sel) {
  if (sel[0] === '.') return n.classList.contains(sel.slice(1));
  if (sel[0] === '[') return n.hasAttribute(sel.slice(1, -1));
  return n.nodeName === sel.toUpperCase();
}
function parse(html) {
  const root = el('div', {}); root.nodeType = 11;
  const stack = [root];
  const re = /<\/([a-zA-Z0-9]+)\s*>|<([a-zA-Z0-9]+)((?:\s+[a-zA-Z_:][-a-zA-Z0-9_:.]*(?:="[^"]*")?)*)\s*\/?>|([^<]+)/g;
  let m;
  while ((m = re.exec(html))) {
    const top = stack[stack.length - 1];
    if (m[1]) { stack.pop(); continue; }
    if (m[2]) {
      const attrs = {};
      (m[3] || '').replace(/([a-zA-Z_:][-a-zA-Z0-9_:.]*)(?:="([^"]*)")?/g, (_, k, v) => { attrs[k] = v === undefined ? '' : decode(v); });
      const n = el(m[2], attrs); n.parentNode = top; top.childNodes.push(n);
      if (!VOID.test(m[2]) && !/\/>$/.test(m[0])) stack.push(n);
      continue;
    }
    top.childNodes.push({ nodeType: 3, nodeValue: decode(m[4]), parentNode: top });
  }
  return root;
}
const roundTrip = (md) => TVDocMenu.toMarkdown(parse(sb.tvRenderMarkdown(md)));

// ── Copy as Markdown round trips ─────────────────────────
[
  ['heading + paragraph with inline marks', '## Title\n\nSome **bold**, *em*, ~~gone~~ and `code`.'],
  ['link and autolink', 'See [docs](https://ex.com) and <https://a.dev>'],
  ['nested list', '- one\n- two\n  - deep\n- three'],
  ['ordered list keeps its start', '3. three\n4. four'],
  ['code block inside an ordered item', '1. Backend\n\n   ```bash\n   cd backend\n   ```\n\n2. Frontend'],
  ['task list', '- [ ] todo\n- [x] done'],
  ['blockquote', '> quoted line\n>\n> second para'],
  ['table with alignment', '| a | b |\n| :---: | ---: |\n| x | 12 |'],
  ['fenced code with language', '```js\nconst a = 1;\n```'],
  ['image', '![Alt text](img/a.png)'],
  ['mermaid diagram', '```mermaid\ngraph TD\n  A-->B\n```'],
  ['hard line break', 'line one\\\nline two'],
  ['nested list under a task', '- [ ] task\n  - nested plain'],
].forEach(([label, md]) => {
  const back = roundTrip(md);
  check('copy as markdown: ' + label, back === md, 'got:\n' + back);
});
check('copy as markdown: footnotes come back as [^n]',
  /Text\[\^1\]\.[\s\S]*\[\^1\]: The note\./.test(roundTrip('Text[^1].\n\n[^1]: The note.')), roundTrip('Text[^1].\n\n[^1]: The note.'));
const fnMulti = roundTrip('Text[^a].\n\n[^a]: First para.\n\n    Second para.');
check('copy as markdown: a multi-paragraph footnote keeps its indent', /\[\^1\]: First para\.\n\n {4}Second para\./.test(fnMulti), fnMulti);
check('copy as markdown: the copy button text is not copied',
  roundTrip('```\nx\n```').indexOf('Copy') === -1, roundTrip('```\nx\n```'));

// ── resolveLink ──────────────────────────────────────────
const doc = '/Users/me/notes/plan.md';
const r = (h) => JSON.stringify(TVDocMenu.resolveLink(h, doc));
check('web link', r('https://ex.com/a') === JSON.stringify({ kind: 'web', url: 'https://ex.com/a' }), r('https://ex.com/a'));
check('mail link', TVDocMenu.resolveLink('mailto:a@b.c', doc).kind === 'mail');
check('anchor link', r('#setup') === JSON.stringify({ kind: 'anchor', hash: 'setup' }), r('#setup'));
check('relative markdown file opens as a doc', r('../specs/a%20b.md#part') === JSON.stringify({ kind: 'doc', path: '/Users/me/specs/a b.md', hash: 'part' }), r('../specs/a%20b.md#part'));
check('relative other file is a file', r('./run.sh') === JSON.stringify({ kind: 'file', path: '/Users/me/notes/run.sh', hash: '' }), r('./run.sh'));
check('absolute path', TVDocMenu.resolveLink('/etc/hosts', doc).path === '/etc/hosts');
check('unknown scheme does nothing', TVDocMenu.resolveLink('javascript:alert(1)', doc).kind === 'none');
check('relative link without a saved file does nothing', TVDocMenu.resolveLink('a.md', null).kind === 'none');

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
