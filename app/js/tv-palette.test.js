/* ───────────────────────────────────────────────────────────
   Galley · command palette test harness (F-24 one smart list)
   Run: node app/js/tv-palette.test.js

   Loads the real tv-palette.js IIFE via `vm` and drives its pure matcher and
   model builders through the TVPalette._internals seam. The builders take an
   explicit context object, so every state the palette can be in (first run,
   tabs open, a dirty document, a page of Appearance values, …) is a plain
   object here. DOM wiring (keys, preview, focus) is asserted as source guards
   and was driven end to end in a browser.
   ─────────────────────────────────────────────────────────── */
'use strict';

var fs = require('fs');
var path = require('path');
var vm = require('vm');

var pass = 0, fail = 0;
function assert(label, condition, detail) {
  if (condition) { console.log('  PASS  ' + label); pass++; }
  else { console.error('  FAIL  ' + label + (detail !== undefined ? ' — ' + JSON.stringify(detail) : '')); fail++; }
}

var SRC = fs.readFileSync(path.join(__dirname, 'tv-palette.js'), 'utf8');
var CSS = fs.readFileSync(path.join(__dirname, '..', 'css', 'tv-app.css'), 'utf8');
var APP = fs.readFileSync(path.join(__dirname, 'tv-app.js'), 'utf8');

function loadPalette(tv) {
  // UXF-02: the palette walks open folders through window.TVTree.
  var sandbox = { window: { TV_ICONS: {}, TV: tv || undefined, TVTree: require('./tv-tree.js') }, console: console, localStorage: { getItem: function () { return null; }, setItem: function () {} } };
  sandbox.global = sandbox;
  vm.runInContext(SRC, vm.createContext(sandbox), { filename: 'tv-palette.js' });
  return sandbox.window.TVPalette;
}
var P = loadPalette();
var I = P._internals;

/* ── context builders ────────────────────────────────────── */
function tab(id, name, extra) {
  var t = { id: id, name: name, path: '/Users/me/proj/docs', nativePath: '/Users/me/proj/docs/' + name, source: '# ' + name + '\n', dirty: false };
  Object.keys(extra || {}).forEach(function (k) { t[k] = extra[k]; });
  return t;
}
function ctx(over) {
  var c = {
    tabs: [], activeId: null, mode: 'reading', openFolders: [], recents: [], mru: [], used: [],
    native: true, mermaid: true, hasDiscarded: false,
    appearance: { themeChoice: 'light', theme: 'light', accent: 'blue', fontSize: 16 }
  };
  Object.keys(over || {}).forEach(function (k) { c[k] = over[k]; });
  return c;
}
var PLAN = '# Plan\n\n## Goals\n\n## Architecture\n\n### Data model\n\n#### Database schema\n\n## Rollout\n';
function threeTabs(extra) {
  return ctx(Object.assign({
    tabs: [tab('a', 'architecture.md', { source: '# Architecture\n\n## Overview\n\n## Schema migration\n' }),
           tab('p', 'plan.md', { source: PLAN }),
           tab('r', 'review.md', { source: '# Review\n\n## Findings\n' })],
    activeId: 'p', mru: ['p', 'a', 'r']
  }, extra || {}));
}
function labels(model) { var o = []; model.sections.forEach(function (s) { s.rows.forEach(function (r) { o.push(r.label); }); }); return o; }
function titles(model) { return model.sections.map(function (s) { return s.title; }); }
function rowsOf(model) { var o = []; model.sections.forEach(function (s) { s.rows.forEach(function (r) { o.push(r); }); }); return o; }
function find(model, label) { return rowsOf(model).filter(function (r) { return r.label === label; })[0]; }
function total(model) { return rowsOf(model).length; }

/* ═══════════════════════════════════════════════════════════
   SANITY
   ═══════════════════════════════════════════════════════════ */
console.log('\nSanity\n');
assert('exports open / close / isOpen / openOutline',
  ['open', 'close', 'isOpen', 'openOutline'].every(function (k) { return typeof P[k] === 'function'; }));
assert('the _internals seam is present', !!I && typeof I.match === 'function' && typeof I.buildModel === 'function');

/* ═══════════════════════════════════════════════════════════
   MATCHER: prefix > word start > initials > substring > subsequence
   ═══════════════════════════════════════════════════════════ */
console.log('\nMatcher tiers\n');
(function () {
  var m = I.match;
  assert('prefix is tier 1', m('new', 'New File').tier === 1);
  assert('every query word starting a word is tier 2', m('file new', 'New File').tier === 2, m('file new', 'New File'));
  assert('initials are tier 3: "ao" finds ai-output.md', m('ao', 'ai-output.md').tier === 3, m('ao', 'ai-output.md'));
  assert('a substring of 3+ letters is tier 4', m('bas', 'Database schema').tier === 4, m('bas', 'Database schema'));
  assert('a constrained subsequence is tier 5: "shma" finds schema.md', m('shma', 'schema.md').tier === 5, m('shma', 'schema.md'));
  assert('tiers rank in that order',
    m('new', 'New File').score > m('file new', 'New File').score &&
    m('file new', 'New File').score > m('ao', 'ai-output.md').score &&
    m('ao', 'ai-output.md').score > m('bas', 'Database schema').score &&
    m('bas', 'Database schema').score > m('shma', 'schema.md').score);

  assert('"new" no longer matches "Accent: Warm" (the loose-subsequence bug)', m('new', 'Accent: Warm') === null, m('new', 'Accent: Warm'));
  assert('"new" does not match "Open Folder…" either', m('new', 'Open Folder…') === null);
  assert('a query with no valid match fails', m('zzzz', 'schema.md') === null);

  assert('one adjacent transposition is forgiven: "shcema" finds schema.md', !!m('shcema', 'schema.md'), m('shcema', 'schema.md'));
  assert('…and ranks a bucket below an exact prefix', m('shcema', 'schema.md').score < m('sche', 'schema.md').score);
  assert('whitespace in the query is ignored for subsequences: "newtab" finds New Tab', !!m('newtab', 'New Tab'));

  var viaAlias = m('new tab', 'Start Page', ['new tab', 'launcher']);
  assert('an alias finds the command', !!viaAlias && viaAlias.alias === 'new tab', viaAlias);
  assert('an alias ranks below a label match of the same tier',
    m('start', 'Start Page', ['starter']).score > m('start', 'Zzz', ['start']).score);
  assert('scoreText keeps the { score, indices } shape', (function () { var r = I.scoreText('sch', 'schema.md'); return r && r.score > 0 && r.indices.join() === '0,1,2'; })());
  assert('matched characters are wrapped and everything is escaped',
    I.highlight('a<b', [0]) === '<span class="hl">a</span>&lt;b', I.highlight('a<b', [0]));
})();

/* ═══════════════════════════════════════════════════════════
   HEADINGS: parsing and memoisation (C-09, UF-08, P2-4)
   ═══════════════════════════════════════════════════════════ */
console.log('\nHeadings\n');
(function () {
  var hs = I.parseHeadings('# a\n## b\n### c\n#### d\n##### e\n###### f\n####### g\nnot # a heading');
  assert('parseHeadings captures h1 to h6 and nothing else', hs.length === 6 && hs[5].level === 6, hs);
  var tA = { id: 'tA', name: 'a.md', source: '# One\n## Two\n' };
  var first = I.headingsFor(tA);
  assert('headingsFor returns the SAME cached array while tab.source is the same string', I.headingsFor(tA) === first);
  var tB = { id: 'tB', name: 'b.md', source: '# B\n' };
  I.headingsFor(tB);
  var tA2 = { id: 'tA', name: 'a.md', source: '# One\n## Two\n### Three\n' };
  assert('it re-parses when the source changes', I.headingsFor(tA2).length === 3);
  var many = '';
  for (var i = 0; i < 150; i++) many += '## h' + i + '\n';
  assert('a tab with 150 headings is capped at 100', I.headingsFor({ id: 'big', name: 'big.md', source: many }).length === 100);
})();

/* ═══════════════════════════════════════════════════════════
   ZERO-QUERY: what you can do right now, no scroll
   ═══════════════════════════════════════════════════════════ */
console.log('\nZero-query\n');
(function () {
  // first run: nothing open
  var first = I.buildModel('', ctx({
    recents: [{ path: '/Users/me/notes/a.md', type: 'file' }, { path: '/Users/me/notes/b.md', type: 'file' },
              { path: '/Users/me/notes/c.md', type: 'file' }, { path: '/Users/me/research', type: 'folder' }]
  }));
  assert('first run: Recent, then Actions', titles(first).join() === 'Recent,Actions', titles(first));
  assert('first run: New File, Open File…, Open Folder…',
    first.sections[1].rows.map(function (r) { return r.label; }).join() === 'New File,Open File…,Open Folder…',
    first.sections[1].rows.map(function (r) { return r.label; }));
  assert('first run: 7 rows, inside the 8-row budget', total(first) === 7, total(first));
  assert('first run: nothing that cannot run is offered (no Save, Close Tab, Edit)',
    !labels(first).some(function (l) { return /^(Save|Close Tab|Edit document)$/.test(l); }), labels(first));
  assert('first run: a recent folder is a folder row', rowsOf(first).some(function (r) { return r.kind === 'folder' && r.label === 'research/'; }));

  // tabs open
  var open = I.buildModel('', threeTabs({ recents: [{ path: '/Users/me/x/roadmap.md', type: 'file' }, { path: '/Users/me/x/api.md', type: 'file' }, { path: '/Users/me/x/g.md', type: 'file' }] }));
  assert('tabs open: Switch to, Recent, Actions', titles(open).join() === 'Switch to,Recent,Actions', titles(open));
  assert('tabs open: Switch to lists the OTHER tabs, latest first',
    open.sections[0].rows.map(function (r) { return r.label; }).join() === 'architecture.md,review.md', open.sections[0].rows.map(function (r) { return r.label; }));
  assert('tabs open: the previous tab is armed, so ⌘K ↵ flips back', open.flat[0].label === 'architecture.md' && open.flat[0].kind === 'tab');
  assert('tabs open: Recent keeps to 2 rows', open.sections[1].rows.length === 2);
  assert('tabs open: Actions are New File, Open File…, Edit document, Appearance',
    open.sections[2].rows.map(function (r) { return r.label; }).join() === 'New File,Open File…,Edit document,Appearance', open.sections[2].rows.map(function (r) { return r.label; }));
  assert('tabs open: 8 rows, no scroll', total(open) === 8, total(open));
  assert('zero-query offers only commands that can run', rowsOf(open).every(function (r) { return !r.dim; }));
  assert('the Appearance row summarises the current look', find(open, 'Appearance').sub === 'Light · Blue · 16 px', find(open, 'Appearance').sub);

  // many tabs: still 8
  var tabs = [], mru = [];
  for (var i = 0; i < 12; i++) { tabs.push(tab('t' + i, 'doc' + i + '.md')); mru.push('t' + i); }
  var many = I.buildModel('', ctx({ tabs: tabs, activeId: 't0', mru: mru, recents: [{ path: '/x/r1.md', type: 'file' }, { path: '/x/r2.md', type: 'file' }] }));
  assert('twelve tabs still fit the 8-row budget', total(many) <= 8, total(many));
  assert('…with Actions kept whole', many.sections[many.sections.length - 1].rows.length === 4);

  // a document with something to save puts Save first
  var dirty = threeTabs();
  dirty.tabs[1].dirty = true;
  var dm = I.buildModel('', dirty);
  assert('a dirty document: Actions lead with Save', dm.sections[dm.sections.length - 1].rows[0].label === 'Save', dm.sections[dm.sections.length - 1].rows.map(function (r) { return r.label; }));
  var fresh = threeTabs();
  fresh.tabs[1].isNew = true; fresh.tabs[1].nativePath = '';
  assert('a never-saved New File also leads with Save',
    I.buildModel('', fresh).sections.slice(-1)[0].rows[0].label === 'Save');

  // the commands you ran last come first
  var usedM = I.buildModel('', threeTabs({ used: ['find'] }));
  assert('a recently used command floats to the top of Actions', usedM.sections.slice(-1)[0].rows[0].label === 'Find in Document', usedM.sections.slice(-1)[0].rows.map(function (r) { return r.label; }));

  // the ⌘T launcher page is not a document
  var launcher = ctx({ tabs: [tab('l', 'Untitled', { untitled: true, nativePath: '' })], activeId: 'l' });
  var lm = I.buildModel('', launcher);
  assert('the launcher tab does not count as an open document', titles(lm).join() === 'Actions' && lm.sections[0].rows[0].label === 'New File', titles(lm));
})();

/* ═══════════════════════════════════════════════════════════
   TYPING: tiered ranking, fixed group order, 8-row budget
   ═══════════════════════════════════════════════════════════ */
console.log('\nTyping\n');
(function () {
  var c = threeTabs({
    recents: [{ path: '/Users/me/x/roadmap.md', type: 'file' }, { path: '/Users/me/x/changelog.md', type: 'file' }],
    openFolders: [{ path: '/Users/me/proj', root: { name: 'proj', path: '/Users/me/proj', scanned: true, mdCount: 3, filesHidden: 0,
                    files: [{ name: 'glossary.md', path: '/Users/me/proj/glossary.md' }, { name: 'runbook.md', path: '/Users/me/proj/runbook.md' }],
                    folders: [{ name: 'docs', path: '/Users/me/proj/docs', scanned: true, mdCount: 1, filesHidden: 0, folders: [],
                                files: [{ name: 'plan.md', path: '/Users/me/proj/docs/plan.md' }] }] } }]
  });

  var nw = I.buildModel('new', c);
  assert('"new" finds New File', !!find(nw, 'New File'));
  assert('"new" finds Start Page through its "new tab" alias', (function () { var r = find(nw, 'Start Page'); return r && r.alias === 'new tab'; })());
  assert('"new" finds nothing with a stray subsequence', rowsOf(nw).every(function (r) { return /new/i.test(r.label + (r.alias || '')); }), labels(nw));

  var ord = I.buildModel('a', c);
  var order = titles(ord);
  assert('groups always come in the fixed order: Switch to, Headings, Files, Actions',
    JSON.stringify(order) === JSON.stringify(['Switch to', 'Headings', 'Files', 'Actions'].filter(function (t) { return order.indexOf(t) >= 0; })), order);
  assert('a typed query never exceeds the 8-row budget', total(ord) <= 8, total(ord));
  assert('best matches share the budget (every non-empty group keeps at least a row)', order.length >= 3, order);

  var sch = I.buildModel('schema', c);
  assert('headings come from the CURRENT document only', rowsOf(sch).filter(function (r) { return r.kind === 'heading'; }).every(function (r) { return r.tabId === 'p'; }));
  assert('"schema" finds the heading "Database schema" in plan.md', !!find(sch, 'Database schema'));
  var xt = rowsOf(sch).filter(function (r) { return r.kind === 'xtab'; })[0];
  assert('matches in other tabs fold into one "N more in other tabs" row with ⌘⇧F', xt && /^1 more in other tabs$/.test(xt.label) && xt.kbd === '⌘⇧F', xt);

  var files = I.buildModel('road', c);
  assert('files that are not open are searchable: a recent file', !!find(files, 'roadmap.md'));
  var rb = I.buildModel('runb', c);
  assert('…and a file from an open folder', !!find(rb, 'runbook.md'));
  assert('a file that is already open is a tab row, never a duplicate file row',
    rowsOf(I.buildModel('plan', c)).filter(function (r) { return r.label === 'plan.md'; }).length === 1);
  assert('files cap at 4 rows', (function () {
    var many = [];
    for (var i = 0; i < 10; i++) many.push({ path: '/x/note' + i + '.md', type: 'file' });
    var m = I.buildModel('note', ctx({ recents: many }));
    return rowsOf(m).filter(function (r) { return r.kind === 'file'; }).length === 4;
  })());

  // unavailable commands are dimmed with a reason and cannot be armed
  var none = I.buildModel('save', ctx());
  var save = find(none, 'Save');
  assert('with nothing open, "save" shows Save dimmed with its reason', save && save.dim && save.reason === 'Open a file first', save);
  assert('a dimmed row is not selectable', none.flat.every(function (r) { return !r.dim; }));
  assert('when nothing runnable matches, the Create row appears', rowsOf(none).some(function (r) { return r.kind === 'create'; }));
  assert('…and says why', /Nothing you can run matches “save”\./.test(none.lead), none.lead);

  var cr = I.buildModel('notes', ctx());
  assert('no match at all → Create “notes.md”', rowsOf(cr).slice(-1)[0].label === 'Create “notes.md”' && cr.flat[0].kind === 'create', labels(cr));
  assert('the Create row is armed and says nothing is saved yet', cr.flat[0].sub === 'Unsaved until you press ⌘S');
  assert('the create name keeps a typed extension', I.buildModel('plan.md', ctx()).flat[0].name === 'plan.md');
  assert('a query that matches something does NOT offer Create', !rowsOf(I.buildModel('new', c)).some(function (r) { return r.kind === 'create'; }));
  assert('mdName makes slashes and colons safe', I.mdName(' a/b:c ') === 'a-b-c.md', I.mdName(' a/b:c '));

  // commands tied to a saved file
  assert('Reload from Disk needs a saved file',
    I.avail(I.cmds.filter(function (x) { return x.id === 'reload'; })[0], threeTabs({ tabs: [tab('p', 'plan.md', { nativePath: '' })] })) === 'Save the file first');
  assert('Move Tab Left is unavailable on the first tab',
    I.avail(I.cmds.filter(function (x) { return x.id === 'move-left'; })[0], threeTabs({ activeId: 'a' })) === 'Already the first tab');
  assert('Move Tab Right is unavailable on the last tab',
    I.avail(I.cmds.filter(function (x) { return x.id === 'move-right'; })[0], threeTabs({ activeId: 'r' })) === 'Already the last tab');
  assert('Reveal in Finder needs the desktop app',
    I.avail(I.cmds.filter(function (x) { return x.id === 'reveal'; })[0], threeTabs({ native: false })) === 'Needs the desktop app');
  assert('Save is available on a dirty document and not on a clean one',
    I.avail(I.cmds.filter(function (x) { return x.id === 'save'; })[0], (function () { var d = threeTabs(); d.tabs[1].dirty = true; return d; })()) === null &&
    I.avail(I.cmds.filter(function (x) { return x.id === 'save'; })[0], threeTabs()) === 'Nothing to save');
  assert('the Edit label flips with the mode', find(I.buildModel('edit', threeTabs({ mode: 'edit' })), 'Stop editing') && find(I.buildModel('edit', threeTabs()), 'Edit document'));
  assert('the Mermaid label flips with the setting', !!find(I.buildModel('mermaid', threeTabs({ mermaid: false })), 'Enable Mermaid diagrams'));
  assert('"Restore discarded edits" only exists when there is something to restore',
    I.avail(I.cmds.filter(function (x) { return x.id === 'restore'; })[0], threeTabs()) === 'Nothing to restore');
})();

/* ═══════════════════════════════════════════════════════════
   "#": the headings of the current document (⌘⌥O)
   ═══════════════════════════════════════════════════════════ */
console.log('\nHeadings mode (#)\n');
(function () {
  var c = threeTabs();
  var all = I.buildModel('#', c);
  assert('"#" lists every heading of the current document, in document order',
    labels(all).join() === 'Plan,Goals,Architecture,Data model,Database schema,Rollout', labels(all));
  assert('…under a header that names the document', all.sections[0].title === 'Headings in plan.md', all.sections[0].title);
  assert('…with the heading level, for indentation', rowsOf(all).map(function (r) { return r.lvl; }).join() === '1,2,2,3,4,2');
  var f = I.buildModel('#sch', c);
  assert('"#sch" filters the headings', labels(f).join() === 'Database schema', labels(f));
  assert('"#" never shows files, tabs or commands', rowsOf(all).every(function (r) { return r.kind === 'heading'; }));
  assert('no match says so', /No heading matches “zzz”\./.test(I.buildModel('#zzz', c).hint), I.buildModel('#zzz', c).hint);
  assert('no document open says so', /Open a file/.test(I.buildModel('#', ctx()).hint));
  assert('a heading row jumps (verb "Jump to")', I.verb(all.flat[0]) === 'Jump to');
  assert('⌘⌥O is "#" typed: openOutline opens the palette with query "#"', /openOutline: function \(\) \{\s*\n\s*TVPalette\.open\(\{ query: '#' \}\);/.test(SRC));
  assert('the old special outline mode is gone', SRC.indexOf('_outlineMode') === -1);
})();

/* ═══════════════════════════════════════════════════════════
   APPEARANCE: one row, then preview pages
   ═══════════════════════════════════════════════════════════ */
console.log('\nAppearance\n');
(function () {
  var c = threeTabs();
  assert('there are no flat Theme / Accent / Text size rows any more',
    !I.cmds.some(function (x) { return /^(Theme|Accent|Increase text|Decrease text)/.test(x.label); }));
  var ap = I.cmds.filter(function (x) { return x.id === 'appearance'; })[0];
  assert('one Appearance command opens a page', ap && ap.kind === 'drill' && ap.page === 'appearance');
  assert('typing "theme" offers the Theme page directly', (function () { var r = find(I.buildModel('theme', c), 'Theme'); return r && r.kind === 'drill' && r.page === 'theme' && r.sub === 'Light'; })());
  assert('typing "text size" offers the Text size page, with the current size',
    (function () { var r = find(I.buildModel('text size', c), 'Text size'); return r && r.page === 'size' && r.sub === '16 px'; })());
  var dark = I.buildModel('dark', c);
  var leaf = find(dark, 'Dark');
  assert('typing "dark" offers the value itself, marked as a Theme leaf', leaf && leaf.kind === 'leaf' && leaf.page === 'theme' && leaf.value === 'dark' && leaf.sub === 'Theme', leaf);
  assert('…first among Actions', dark.sections.filter(function (s) { return s.title === 'Actions'; })[0].rows[0] === leaf);
  var warm = find(I.buildModel('warm', c), 'Warm');
  assert('typing "warm" offers the Accent value with a swatch', warm && warm.kind === 'leaf' && warm.swatch === 'warm' && warm.sub === 'Accent', warm);

  // pages
  var th = I.buildModel('', c, 'theme');
  assert('the Theme page lists Light, Dark, System', labels(th).join() === 'Light,Dark,System', labels(th));
  assert('the current theme carries the check', th.flat.filter(function (r) { return r.check; }).map(function (r) { return r.label; }).join() === 'Light');
  assert('every value row carries what ↑↓ should preview', th.flat.every(function (r) { return r.preview && r.preview.theme === r.value; }));
  var dk = threeTabs({ appearance: { themeChoice: 'dark', theme: 'dark', accent: 'warm', fontSize: 18 } });
  assert('the check follows the chosen theme, not the resolved one', I.buildModel('', dk, 'theme').flat.filter(function (r) { return r.check; })[0].label === 'Dark');
  var ac = I.buildModel('', dk, 'accent');
  assert('the Accent page shows a swatch per value and checks the current one',
    labels(ac).join() === 'Blue,Graphite,Warm' && ac.flat.every(function (r) { return !!r.swatch; }) && ac.flat.filter(function (r) { return r.check; })[0].label === 'Warm');
  var sz = I.buildModel('', dk, 'size');
  assert('the Text size page checks the current size and marks 16 as the default',
    sz.flat.filter(function (r) { return r.check; })[0].label === '18 px' && find(sz, '16 px').sub === 'Default', labels(sz));
  assert('opening a page arms the CURRENT value, so opening it changes nothing',
    (function () { var src = SRC; return /function _initialSel\(model\) \{\s*\n\s*if \(model\.kind === 'page'\) \{\s*\n\s*for \(var i = 0; i < model\.flat\.length; i\+\+\) if \(model\.flat\[i\]\.check\) return i;/.test(src); })());
  var root = I.buildModel('', c, 'appearance');
  assert('the Appearance page lists Theme, Accent and Text size', labels(root).join() === 'Theme,Accent,Text size', labels(root));
  assert('a page filters as you type', labels(I.buildModel('dar', c, 'theme')).join() === 'Dark');
  assert('a page has its own placeholder', root.placeholder === 'Filter');

  // preview contract in the shell
  assert('the shell paints a preview without persisting, notifying native or rendering',
    (function () {
      var m = APP.match(/function previewAppearance\(p\) \{[\s\S]*?\n  \}\n  function endAppearancePreview/);
      return !!m && !/localStorage|setItem|notifyTheme|render\(\)/.test(m[0]);
    })());
  assert('the shell exports the preview API to the palette',
    /previewAppearance: previewAppearance,/.test(APP) && /endAppearancePreview: endAppearancePreview,/.test(APP) && /appearanceState: appearanceState,/.test(APP));
})();

/* ═══════════════════════════════════════════════════════════
   VERBS AND FOOTER: the row and the footer agree
   ═══════════════════════════════════════════════════════════ */
console.log('\nVerbs and footer\n');
(function () {
  var c = threeTabs({ recents: [{ path: '/Users/me/x/roadmap.md', type: 'file' }] });
  var zero = I.buildModel('', c);
  assert('a tab row says "Switch to"', I.verb(zero.flat[0]) === 'Switch to');
  assert('a file row says "Open" and offers ⌘↵ Reveal',
    (function () { var r = find(zero, 'roadmap.md'); return I.verb(r) === 'Open' && I.footerKeys(zero, r, '', null).some(function (k) { return k[0] === '⌘↵' && k[1] === 'Reveal'; }); })());
  assert('New File says "Create"', I.verb(find(zero, 'New File')) === 'Create');
  assert('Appearance says "Open" (it opens a page)', I.verb(find(zero, 'Appearance')) === 'Open');
  assert('Esc reads Close, then Clear once something is typed, then Back inside a page',
    I.footerKeys(zero, zero.flat[0], '', null).slice(-1)[0][1] === 'Close' &&
    I.footerKeys(zero, zero.flat[0], 'x', null).slice(-1)[0][1] === 'Clear' &&
    I.footerKeys(zero, zero.flat[0], '', 'theme').slice(-1)[0][1] === 'Back');
  assert('typing offers ⇧↵ Create “name”', I.footerKeys(zero, zero.flat[0], 'notes', null).some(function (k) { return k[0] === '⇧↵' && k[1] === 'Create “notes.md”'; }));
  assert('"#" and pages do not offer ⇧↵', !I.footerKeys(zero, zero.flat[0], '#x', null).some(function (k) { return k[0] === '⇧↵'; }) &&
    !I.footerKeys(zero, zero.flat[0], 'x', 'theme').some(function (k) { return k[0] === '⇧↵'; }));
  assert('a page footer starts with ↑↓ Preview', I.footerKeys(zero, zero.flat[0], '', 'theme')[0].join(' ') === '↑↓ Preview');
})();

/* ═══════════════════════════════════════════════════════════
   WIRING GUARDS (the DOM layer, asserted over the source)
   ═══════════════════════════════════════════════════════════ */
console.log('\nWiring\n');
(function () {
  assert('Esc backs out one step: page, then the query, then the palette',
    /if \(k === 'Escape'\) \{[\s\S]*?if \(_pageId\) \{ _pageBack\(\); return; \}[\s\S]*?if \(inp && inp\.value\) \{[\s\S]*?_refresh\(false\); return; \}[\s\S]*?TVPalette\.close\(\);/.test(SRC));
  assert('⌫ on an empty field leaves a page', /k === 'Backspace' && _pageId/.test(SRC));
  assert('↑↓ and ⌃N / ⌃P move; ↵ runs; ⌘↵ reveals; ⇧↵ creates',
    /k === 'ArrowDown' \|\| \(e\.ctrlKey && \(k === 'n'/.test(SRC) && /k === 'ArrowUp' \|\| \(e\.ctrlKey && \(k === 'p'/.test(SRC) &&
    /_runSelected\(\{ meta: e\.metaKey, shift: e\.shiftKey \}\)/.test(SRC));
  assert('keys the palette owns do not reach the shell (its router treats Ctrl as ⌘: ⌃N would create a file)',
    /if \(k === 'ArrowDown' \|\| \(e\.ctrlKey && \(k === 'n' \|\| k === 'N'\)\)\) \{\s*\n\s*e\.preventDefault\(\);\s*\n\s*e\.stopPropagation\(\);/.test(SRC) &&
    /if \(k === 'ArrowUp' \|\| \(e\.ctrlKey && \(k === 'p' \|\| k === 'P'\)\)\) \{\s*\n\s*e\.preventDefault\(\);\s*\n\s*e\.stopPropagation\(\);/.test(SRC));
  assert('hover never moves the armed row (no mousemove selection)', !/mousemove/.test(SRC));
  assert('↑↓ on a value page previews; closing ends the preview',
    /function _previewSelected\(\)/.test(SRC) && /if \(_pageId\) _endPreview\(\);/.test(SRC) && /previewAppearance\(r\.preview\)/.test(SRC));
  assert('applying a value closes first (ending the preview) and then commits',
    /TVPalette\.close\(\);\s*\n\s*switch \(row\.kind\) \{/.test(SRC) && /TV\.setTheme\(row\.value\)/.test(SRC) && /TV\.setAccent\(row\.value\)/.test(SRC) && /TV\.setFontSize\(row\.value\)/.test(SRC));
  assert('the Create row and ⇧↵ both hand the typed name to TV.newFile', /TV\.newFile\(row\.name\)/.test(SRC) && /window\.TV\.newFile\(name\)/.test(SRC));
  assert('dimmed rows cannot be armed or clicked (data-i is -1)', /data-i="' \+ \(r\.dim \? -1 : flatIdx\)/.test(SRC) && /i < 0/.test(SRC));
  assert('combobox wiring: aria-activedescendant follows the armed row', /aria-activedescendant/.test(SRC) && /role="combobox"/.test(SRC) && /role="listbox"/.test(SRC));
  assert('a polite live region announces the result count', /id="tv-pal-status" role="status" aria-live="polite"/.test(SRC));
  assert('the focus trap and the shared focusable selector are intact',
    /var sel = 'input:not\(\[disabled\]\), button:not\(\[disabled\]\), select, textarea, a\[href\]';/.test(SRC) && /function _trapTab\(e\)/.test(SRC));
  assert('every icon row has an icon (no ragged left edge)', (function () {
    var ids = I.cmds.map(function (x) { return x.ic; });
    var names = (SRC.match(/var IC = \{([\s\S]*?)\n  \};/) || [])[1] || '';
    return ids.every(function (n) { return new RegExp('\\b' + n + ':').test(names); });
  })());
  assert('no group title is also a command label (one word, one meaning)',
    (function () {
      var groups = ['Switch to', 'Headings', 'Files', 'Actions', 'Recent'];
      return !I.cmds.some(function (c) { return groups.indexOf(c.label) >= 0; });
    })());
})();

/* ═══════════════════════════════════════════════════════════
   LOOK: no bar, no border, no ring on the palette (commit 6a209e3)
   ═══════════════════════════════════════════════════════════ */
console.log('\nLook\n');
(function () {
  var block = CSS.slice(CSS.indexOf('/* ── command palette (F-24)'), CSS.indexOf('/* ── cross-tab search results'));
  assert('the palette CSS block was found', block.length > 1500, block.length);
  var rules = block.match(/[^{}]+\{[^}]*\}/g) || [];
  var bad = rules.filter(function (r) {
    return /border-left|border-inline-start|box-shadow:\s*inset\s+[1-9]|outline:\s*[1-9]/.test(r) &&
      !/\.sw\b/.test(r.split('{')[0]);
  });
  assert('no rule gives the palette a left border, an accent bar, an inset shadow bar or an outline', bad.length === 0, bad);
  assert('the armed row is the stronger fill (not the weak tint) with a semibold label',
    /\.tv-pal-row\.sel \{ background: var\(--tv-sel-strong\) !important; font-weight: 600; \}/.test(block));
  assert('hover is a light wash that excludes the armed and dimmed rows', /\.tv-pal-row:hover:not\(\.sel\):not\(\.dim\)/.test(block));
  assert('the armed fill token exists for every theme and accent',
    (function () {
      var tokens = fs.readFileSync(path.join(__dirname, '..', 'css', 'tv-tokens.css'), 'utf8');
      return (tokens.match(/--tv-sel-strong:/g) || []).length >= 8;
    })());
  assert('the palette input draws no focus ring (C-10, the owner\'s direction)', /\.tv-pal-input:focus-within\s*\{\s*\n\s*box-shadow:\s*none/.test(CSS));
})();

/* ═══════════════════════════════════════════════════════════
   QA FIXES (D1-D7): each one pinned so it cannot come back
   ═══════════════════════════════════════════════════════════ */
console.log('\nQA regressions\n');
(function () {
  assert('D1: ⇧↵ creates from the query even when a row is armed',
    /if \(mods && mods\.shift && _createFromQuery\(\)\) return;/.test(SRC) &&
    /function _createFromQuery\(\) \{[\s\S]*?return false;[\s\S]*?return true;\s*\n  \}/.test(SRC));
  assert('D1: …but not inside a page, in "#" mode, or on an empty query',
    /if \(!q \|\| q\.charAt\(0\) === '#' \|\| _pageId\) return false;/.test(SRC));
  assert('D2: tab activity is recorded from load, so the first ⌘K already knows the previous tab',
    /function _wireMruAtLoad\(\)/.test(SRC) && /DOMContentLoaded', _wireMruListener/.test(SRC) && /window\.TVPalette = TVPalette;\s*\n  _wireMruAtLoad\(\);/.test(SRC));
  var dirty = threeTabs({ used: ['find', 'new-file'] });
  dirty.tabs[1].dirty = true;
  var acts = I.buildModel('', dirty).sections.slice(-1)[0].rows.map(function (r) { return r.label; });
  assert('D3: Save leads the Actions even when other commands were used recently', acts[0] === 'Save', acts);
  assert('D3: …followed by the commands you ran last', acts[1] === 'Find in Document' && acts[2] === 'New File', acts);
  assert('D4: a space at the tab-label split survives (white-space: pre, not nowrap)',
    /\.tv-lbl-head \{[^}]*white-space: pre;/.test(CSS) && /\.tv-lbl-tail \{[^}]*white-space: pre;/.test(CSS));
  assert('D5: forced colors: the armed row stops the UA overriding its own colours',
    /@media \(forced-colors: active\) \{[\s\S]*?\.tv-pal-row\.sel \{ forced-color-adjust: none; \}/.test(CSS));
  assert('D6: the palette never outgrows a short window',
    /\.tv-palette \{[^}]*max-height: calc\(100vh - 96px - 20px\);/.test(CSS) && /\.tv-pal-list \{[^}]*flex: 1 1 auto; min-height: 0;/.test(CSS));
  assert('N2: the bottom fade is only on while more of the list is below the fold (re-synced on scroll)',
    /scrollHeight - listEl\.scrollTop > listEl\.clientHeight \+ 1/.test(SRC) && /addEventListener\('scroll', _syncOverflowFlag\)/.test(SRC));
  assert('N1: forced colors keep the chip readable on the armed row and the accent swatches painted',
    /\.tv-pal-row\.sel \.kbd, \.tv-pal-row\.sel \.tag \{ color: HighlightText/.test(CSS) && /\.tv-pal-row \.sw \{ forced-color-adjust: none; \}/.test(CSS));
  assert('D7: the field turns off autocorrect and autocapitalize (and spellcheck)',
    /autocorrect="off" autocapitalize="off"/.test(SRC) && /spellcheck="false"/.test(SRC));
})();

console.log('\n' + (fail === 0 ? 'ALL PASS (' + pass + ' assertions)' : 'FAILURES: ' + fail + ' (' + pass + ' passed)'));
process.exit(fail === 0 ? 0 : 1);
