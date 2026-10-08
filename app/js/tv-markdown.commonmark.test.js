/* ───────────────────────────────────────────────────────────
   Galley · MD-01 regression suite
   The hand-written parser rendered a fenced block inside a list item as an
   inline code span with stray backticks and restarted the numbering after it
   (owner screenshot, 2026-10-08). tv-markdown.js now parses with the vendored
   marked; these checks pin the CommonMark / GFM shapes and
   Galley's own markup that its renderer overrides must keep.
   ─────────────────────────────────────────────────────────── */
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

let pass = 0, fail = 0;
function check(label, cond, detail) {
  if (cond) { pass++; console.log('PASS  ' + label); }
  else { fail++; console.log('FAIL  ' + label + (detail ? ' — ' + detail : '')); }
}

const sandbox = { console, Date, Math, JSON, RegExp, String, Number, Array, Object, setTimeout, clearTimeout };
sandbox.window = sandbox;
sandbox.marked = require('./vendor/marked.umd.js');
sandbox.btoa = (s) => Buffer.from(s, 'binary').toString('base64');
sandbox.document = { querySelector: () => null, querySelectorAll: () => [], addEventListener() {}, createElement: () => ({ style: {} }) };
vm.createContext(sandbox);
vm.runInContext(fs.readFileSync(path.join(__dirname, 'tv-markdown.js'), 'utf8'), sandbox, { filename: 'tv-markdown.js' });
const render = sandbox.tvRenderMarkdown;
const strip = (h) => h.replace(/<button[\s\S]*?<\/button>/g, '').replace(/\n/g, '');

// The owner's screenshot: a fenced block indented under item 1.
const shot = strip(render(
  '1. **Backend.** Production was last deployed.\n\n' +
  '   ```bash\n   cd backend && fly deploy --remote-only\n   curl -s https://x.dev/api | head -c 200\n   ```\n\n' +
  '2. **Frontend.** Ships the privacy policy.'));
check('fence inside a list item is a code block in that item',
  /<li><p><strong>Backend\.<\/strong>[^<]*<\/p><pre data-lang="bash"><code>cd backend/.test(shot), shot);
check('no stray backticks are left in the output', shot.indexOf('``') === -1, shot);
check('the list keeps counting: one <ol>, two items', (shot.match(/<ol/g) || []).length === 1 && (shot.match(/<li>/g) || []).length === 2, shot);

const cases = [
  ['ordered list start number', '3. three\n4. four', /<ol start="3">/],
  ['loose list stays one list', '- a\n\n- b\n\n- c', /^<ul><li><p>a<\/p><\/li><li><p>b<\/p><\/li><li><p>c<\/p><\/li><\/ul>$/],
  ['paragraph continuation in an item', '- one\n  more\n- two', /<li>one more<\/li>|<li>one\s*more<\/li>/],
  ['blockquote inside an item', '- item\n  > quoted\n- two', /<li>item<blockquote><p>quoted<\/p><\/blockquote><\/li>/],
  ['table inside an item keeps .tbl-wrap', '- item\n\n  | a | b |\n  |---|---|\n  | 1 | 2 |', /<li><p>item<\/p><div class="tbl-wrap"><table>/],
  ['indented code block', 'para\n\n    code line\n\nafter', /<pre><code>code line<\/code><\/pre>/],
  ['fence indented two spaces at top level', '  ```\n  code\n  ```', /<pre><code>code<\/code><\/pre>/],
  ['tilde fence', '~~~py\nx = 1\n~~~', /<pre data-lang="py"><code>x = <span class="c-num">1<\/span><\/code><\/pre>/],
  ['autolinks (bare and angle)', 'see https://a.dev and <https://b.dev>', /<a href="https:\/\/a\.dev">https:\/\/a\.dev<\/a>.*<a href="https:\/\/b\.dev">/],
  ['hard line breaks', 'one  \ntwo\\\nthree', /one<br>two<br>three/],
  ['backslash escapes', '\\*not em\\*', /<p>\*not em\*<\/p>/],
  ['reference links (destination shown on hover)', 'see [docs][d]\n\n[d]: https://ex.com', /<a href="https:\/\/ex\.com" title="https:\/\/ex\.com">docs<\/a>/],
  ['footnote ref and section', 'Text[^1].\n\n[^1]: The note.', /href="#fn-1"[\s\S]*<section class="footnotes" data-footnotes>[\s\S]*<li id="fn-1">/],
  ['mixed task list keeps one list', '- [ ] todo\n- plain\n- [x] done',
    /^<ul><li class="task"><span class="box "><\/span><div class="task-body">todo<\/div><\/li><li>plain<\/li><li class="task"><span class="box done"><\/span>/],
  ['all-task list is ul.task', '- [ ] a\n- [x] b', /^<ul class="task"><li><span class="box "><\/span>/],
  ['table markup and numeric cells', '| a | b |\n|:-:|--:|\n| x | 12 |',
    /<div class="tbl-wrap"><table><thead><tr><th style="text-align:center">a<\/th><th style="text-align:right">b<\/th><\/tr><\/thead><tbody><tr><td class="" style="text-align:center">x<\/td><td class="num" style="text-align:right">12<\/td>/],
  ['standalone image is a figure', '![Alt](img/a.png)', /^<figure class="md-img"><img alt="Alt" data-img-raw-src="img\/a\.png" loading="lazy">/],
  ['inline image has no src before resolve', 'x ![b](b.png) y', /<img class="md-inline-img-el" alt="b" data-img-raw-src="b\.png" loading="lazy">/],
  ['mermaid fence is a diagram placeholder', '```mermaid\ngraph TD; A-->B\n```', /<div class="tv-diagram" data-diagram="0"/],
  ['setext heading with GitHub anchor id', 'Title\n=====', /<h1 id="title">Title<\/h1>/],
  ['strikethrough', '~~gone~~', /<del>gone<\/del>/],
  ['heading anchors follow GitHub slugs and number repeats', "## What's new?\n\n## What's new?\n\n## `API` *v2*",
    /<h2 id="whats-new">.*<h2 id="whats-new-1">.*<h2 id="api-v2">/],
  ['intra-word underscores stay literal', 'snake_case_word', /<p>snake_case_word<\/p>/],
];
cases.forEach(([label, src, re]) => {
  const out = strip(render(src));
  check(label, re.test(out), out);
});

// Security: blocked schemes stay blocked; raw HTML without DOMPurify is text.
const bad = strip(render('[x](javascript:alert(1)) [y](JaVaScRiPt&#58;alert(1)) [z](data:text/html;base64,AAAA)'));
check('javascript: / entity-encoded / data:text links render as plain text', bad.indexOf('<a ') === -1, bad);
const img = strip(render('![a](javascript:alert(1))'));
check('javascript: image src is blocked', img.indexOf('javascript') === -1 || img.indexOf('<img') === -1, img);
const raw = strip(render('<img src=x onerror=alert(1)>\n\n<script>alert(1)</script>'));
check('raw HTML is escaped when DOMPurify is unavailable', raw.indexOf('<img') === -1 && raw.indexOf('<script') === -1, raw);

// QA round 1 defects.
const fnBad = strip(render('ref[^a"onmouseover="x=1]\n\n[^a"onmouseover="x=1]: note'));
check('a footnote label never reaches the HTML (no attribute injection)', fnBad.indexOf('onmouseover') === -1 && /href="#fn-1"/.test(fnBad), fnBad);
const fnSpace = strip(render('see[^long label] and[^long label]\n\n[^long label]: Note with **md**.'));
check('footnote label with a space gets numeric ids and two back-refs',
  /id="fnref-1"[\s\S]*id="fnref-1-2"[\s\S]*<li id="fn-1"><p>Note with <strong>md<\/strong>\. <a href="#fnref-1"[\s\S]*href="#fnref-1-2"/.test(fnSpace), fnSpace);
check('an undefined footnote ref stays literal text', /\[\^nope\]/.test(strip(render('x[^nope] y'))));
const fm = strip(render('---\nname: my-skill\ndescription: Does things\n---\n\n# Body'));
check('YAML front matter is a yaml block, not a setext heading',
  /^<pre class="tv-frontmatter" data-lang="yaml">.*name: my-skill.*<\/pre><h1 id="body">Body<\/h1>$/.test(fm) && fm.indexOf('<h2') === -1, fm);
const rules = strip(render('---\n\ntext between\n\n---\n\nend'));
check('a document opening with a --- rule keeps both rules and its text', rules.indexOf('tv-frontmatter') === -1 && (rules.match(/<hr>/g) || []).length === 2 && /text between/.test(rules), rules);
check('a lone --- rule at the top is still a rule', /^<hr>/.test(strip(render('---\n\ntext'))));
check('angle-bracket destination keeps its space', /href="\.\/my notes\.md"/.test(strip(render('[a](<./my notes.md>)'))), strip(render('[a](<./my notes.md>)')));
check('spaced javascript: is still blocked', strip(render('[a](<java script:alert(1)>) [b](<javascript :x>)')).indexOf('<a ') === -1);

// Large documents render in linear time (marked-footnote made this quadratic).
const big = Array.from({ length: 3000 }, (_, i) =>
  '## Section ' + i + '\n\nParagraph ' + i + ' with **bold**, `code` and a [link](https://e.x/' + i + ').\n\n' +
  '- item a\n- item b\n\n| a | b |\n|---|---|\n| ' + i + ' | x |\n').join('\n') + '\n\nEnd[^n].\n\n[^n]: note';
const tb = Date.now();
render(big);
const bigMs = Date.now() - tb;
check('~' + Math.round(big.length / 1024) + ' KB document renders under 1.5 s (' + bigMs + ' ms)', bigMs < 1500);

// FREEZE-01 shape still renders promptly.
const t0 = Date.now();
render('----\n' + '_'.repeat(31) + '\n* * * *');
check('long rule lines render within budget', Date.now() - t0 < 2000);

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
