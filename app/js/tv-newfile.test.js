/* ───────────────────────────────────────────────────────────
   Galley · F-23 New File suite
   (run: node app/js/tv-newfile.test.js)

   New File makes an in-memory document. Nothing reaches disk until an explicit
   Save (DR-06), which opens the native Save panel. Two halves:

     · behaviour — the naming and default-directory helpers are lifted VERBATIM
       out of tv-app.js and executed, the pattern tv-tabstrip.test.js uses
     · wiring    — ordering/shape guards over the entry points (⌘N, File menu,
       palette, launcher, empty state, shortcuts overlay) and the save rules

   The save panel, the tree refresh and the full keyboard flow are covered by
   tv-native.runtime.test.js (bridge) and were driven end to end in a browser.
   ─────────────────────────────────────────────────────────── */
'use strict';

var fs = require('fs');
var path = require('path');
var vm = require('vm');

var pass = 0;
var fail = 0;
function assert(label, condition, detail) {
  if (condition) { console.log('  PASS  ' + label); pass++; }
  else { console.error('  FAIL  ' + label + (detail !== undefined ? ' — ' + JSON.stringify(detail) : '')); fail++; }
}

var ROOT = path.join(__dirname, '..', '..');
var APP = fs.readFileSync(path.join(__dirname, 'tv-app.js'), 'utf8');
var PALETTE = fs.readFileSync(path.join(__dirname, 'tv-palette.js'), 'utf8');
var EDIT = fs.readFileSync(path.join(__dirname, 'tv-edit.js'), 'utf8');
var CSS = fs.readFileSync(path.join(__dirname, '..', 'css', 'tv-app.css'), 'utf8');
var RUST = fs.readFileSync(path.join(ROOT, 'tauri-app', 'src-tauri', 'src', 'lib.rs'), 'utf8');

function extractFn(src, name) {
  var start = src.indexOf('function ' + name + '(');
  if (start === -1) throw new Error('extractFn: ' + name + ' not found');
  var i = src.indexOf('{', start);
  var depth = 0;
  for (var j = i; j < src.length; j++) {
    if (src[j] === '{') depth++;
    else if (src[j] === '}') { depth--; if (depth === 0) return src.slice(start, j + 1); }
  }
  throw new Error('extractFn: unbalanced braces in ' + name);
}

/* Run the real helpers against a state we control. */
function helpers(state) {
  var ctx = { state: state };
  vm.createContext(ctx);
  vm.runInContext(
    'function getActiveTab() {' +
    '  for (var i = 0; i < state.tabs.length; i++) if (state.tabs[i].id === state.activeId) return state.tabs[i];' +
    '  return null;' +
    '}\n' + extractFn(APP, 'nextNewFileName') + '\n' + extractFn(APP, 'newFileDir'),
    ctx
  );
  return ctx;
}
function tab(id, name, extra) {
  var t = { id: id, name: name, untitled: false };
  Object.keys(extra || {}).forEach(function (k) { t[k] = extra[k]; });
  return t;
}

/* ═══════════════════════════════════════════════════════════
   naming
   ═══════════════════════════════════════════════════════════ */
console.log('\nNaming: Untitled.md, Untitled 2.md, …\n');
(function () {
  var h = helpers({ tabs: [], activeId: null, openFolders: [] });
  assert('the first file is "Untitled.md"', h.nextNewFileName() === 'Untitled.md', h.nextNewFileName());

  h = helpers({ tabs: [tab('a', 'Untitled.md')], activeId: 'a', openFolders: [] });
  assert('the second is "Untitled 2.md"', h.nextNewFileName() === 'Untitled 2.md', h.nextNewFileName());

  h = helpers({ tabs: [tab('a', 'Untitled.md'), tab('b', 'Untitled 3.md')], activeId: 'a', openFolders: [] });
  assert('it takes the first free number, not the next one after the highest',
    h.nextNewFileName() === 'Untitled 2.md', h.nextNewFileName());

  h = helpers({ tabs: [tab('a', 'untitled.MD')], activeId: 'a', openFolders: [] });
  assert('the comparison ignores case (APFS is case-insensitive)',
    h.nextNewFileName() === 'Untitled 2.md', h.nextNewFileName());

  h = helpers({ tabs: [tab('l', 'Untitled', { untitled: true })], activeId: 'l', openFolders: [] });
  assert('the ⌘T launcher tab (also called "Untitled") does not use up the name',
    h.nextNewFileName() === 'Untitled.md', h.nextNewFileName());

  h = helpers({ tabs: [tab('a', 'Untitled.md', { nativePath: '/x/Untitled.md' })], activeId: 'a', openFolders: [] });
  assert('a real file already called Untitled.md is also avoided',
    h.nextNewFileName() === 'Untitled 2.md', h.nextNewFileName());
})();

/* ═══════════════════════════════════════════════════════════
   where the Save panel opens
   ═══════════════════════════════════════════════════════════ */
console.log('\nDefault directory for the Save panel\n');
(function () {
  var h = helpers({
    tabs: [tab('a', 'a.md', { nativePath: '/Users/x/proj/docs/a.md' })], activeId: 'a',
    openFolders: [{ path: '/Users/x/other' }],
  });
  assert('reading a file: beside that file (wins over an open folder)',
    h.newFileDir() === '/Users/x/proj/docs', h.newFileDir());

  h = helpers({ tabs: [tab('a', 'a.md', { nativePath: '/a.md' })], activeId: 'a', openFolders: [] });
  assert('a file at the volume root gives "/"', h.newFileDir() === '/', h.newFileDir());

  h = helpers({
    tabs: [tab('n', 'Untitled.md', { isNew: true, suggestedDir: '/Users/x/notes' })], activeId: 'n',
    openFolders: [{ path: '/Users/x/other' }],
  });
  assert('on another new file: the same place that file was going',
    h.newFileDir() === '/Users/x/notes', h.newFileDir());

  h = helpers({
    tabs: [tab('l', 'Untitled', { untitled: true })], activeId: 'l',
    openFolders: [{ path: '/Users/x/first' }, { path: '/Users/x/latest' }],
  });
  assert('no file to go by: the most recently opened folder',
    h.newFileDir() === '/Users/x/latest', h.newFileDir());

  h = helpers({ tabs: [], activeId: null, openFolders: [] });
  assert('nothing open: null, so macOS picks its own last location', h.newFileDir() === null, h.newFileDir());

  h = helpers({ tabs: [tab('a', 'dropped.md')], activeId: 'a', openFolders: [] });
  assert('a tab with no path (browser drop) and no folder: null', h.newFileDir() === null, h.newFileDir());
})();

/* ═══════════════════════════════════════════════════════════
   DR-06: creating a file is not writing one
   ═══════════════════════════════════════════════════════════ */
console.log('\nDR-06: New File never touches disk\n');
(function () {
  var nf = extractFn(APP, 'newFile');
  var body = nf.replace(/\/\/[^\n]*/g, '');
  assert('newFile() makes no native call and no save',
    !/invoke|saveTab|writeFile|handleSave|save_md_file/.test(body), body.match(/invoke|saveTab|writeFile|handleSave|save_md_file/));
  assert('the new tab starts clean, so closing an untouched one never prompts',
    /makeTab\(\{ name: name, isNew: true/.test(nf) && /tab\.dirty = false/.test(nf));
  assert('the new tab is never a transient (preview) tab that a later click would replace',
    !/transient:\s*true/.test(nf));
  assert('New File starts in edit mode through the one activation path',
    /_doActivateTab\(tab\.id, state\.activeId, host, tab\.id !== state\.activeId, true\)/.test(nf));
  assert('…and skips activateTab\'s "Leave edit mode?" confirm (New File keeps you editing)',
    !/activateTab\(/.test(nf.replace(/_doActivateTab\(/g, '')));
  assert('from the ⌘T launcher the launcher tab becomes the document (no orphan tab)',
    /host && host\.untitled/.test(nf) && /tab = host;/.test(nf) && /tab\.untitled = false;/.test(nf));

  assert('new files are not written into the restorable session until they exist on disk',
    /if \(st\.untitled \|\| st\.error \|\| !st\.nativePath\) continue;/.test(APP));
  assert('…and join it the moment the first save lands (no tab event follows a save)',
    /function _saveLanded\(tab, wasNew\) \{[\s\S]*?if \(wasNew\) saveSession\(\);/.test(APP));
})();

/* ═══════════════════════════════════════════════════════════
   Save rules for a never-saved file
   ═══════════════════════════════════════════════════════════ */
console.log('\nSave: a new file always means "choose where"\n');
(function () {
  var hs = extractFn(APP, 'handleSave');
  assert('handleSave reads isNew as "creating"', /var creating = !!tab\.isNew;/.test(hs));
  assert('a clean existing file still just leaves edit mode (DR-06 unchanged)',
    /if \(!tab\.dirty && !creating\) \{\s*setMode\('reading'\);\s*return;\s*\}/.test(hs));
  assert('an EMPTY new file is still saved (an empty file is a legitimate thing to create)',
    !/if \(!tab\.dirty\) \{\s*setMode\('reading'\)/.test(hs));
  assert('a cancelled Save panel is reported as a cancel, not a failure',
    /outcome === 'cancelled'\) \{ _saveDidNotLand\(tab, 'AbortError'\); return; \}/.test(hs));
  assert('native: "saved" is proved by a path for a new file, by the dirty flag otherwise',
    /creating \? !!tab\.nativePath : !tab\.dirty/.test(hs));
  assert('_markSaved clears isNew', /function _markSaved\(tab\) \{[\s\S]*?tab\.isNew = false;/.test(APP));

  var sv = extractFn(APP, '_hasSaveable');
  assert('⌘S acts in edit mode, or on a dirty / new document (previewing a new file with ⌘E)',
    /state\.mode === 'edit' \|\| !!\(t && !t\.untitled && \(t\.dirty \|\| t\.isNew\)\)/.test(sv));
  assert('⌘S and File ▸ Save both use it',
    /if \(k === 's' \|\| k === 'S'\) \{[\s\S]{0,200}?if \(_hasSaveable\(\)\) handleSave\(\);/.test(APP) &&
    /listen\('menu:save', function \(\) \{\s*\n\s*if \(_hasSaveable\(\)\) handleSave\(\);/.test(APP));
})();

/* ═══════════════════════════════════════════════════════════
   entry points
   ═══════════════════════════════════════════════════════════ */
console.log('\nEntry points\n');
(function () {
  assert('⌘N (browser build) creates a file and ignores ⇧⌘N / ⌥⌘N',
    /if \(\(k === 'n' \|\| k === 'N'\) && !e\.shiftKey && !e\.altKey\) \{\s*\n\s*e\.preventDefault\(\);\s*\n\s*newFile\(\);/.test(APP));
  assert('the native menu event is routed to newFile()',
    /listen\('menu:new-file', function \(\) \{\s*\n\s*newFile\(\);/.test(APP));
  assert('TV exports newFile and refreshFolderFor',
    /newFile: newFile,/.test(APP) && /refreshFolderFor: refreshFolderFor,/.test(APP));

  assert('File ▸ New File exists with ⌘N',
    /"menu:new-file",\s*\n\s*"New File",\s*\n\s*true,\s*\n\s*Some\("CmdOrCtrl\+N"\)/.test(RUST));
  assert('the menu id is on the emit whitelist (otherwise the click is swallowed)',
    /"menu:new-file"\s*\n\s*\| "menu:open-file"/.test(RUST));

  assert('the palette lists New File ⌘N and routes it to TV.newFile',
    /main: 'New File',\s+action: 'newFile',\s+value: '', kbd: '⌘N'/.test(PALETTE) &&
    /action === 'newFile'\) \{\s*\n\s*TVPalette\.close\(\);\s*\n\s*if \(typeof window\.TV\.newFile === 'function'\) window\.TV\.newFile\(\)/.test(PALETTE));

  assert('the ⌘T launcher has a New File row',
    /data-ntp-act="new-file"/.test(APP) && /New File<\/span>/.test(APP));
  assert('the launcher row works by click AND by Enter/keyboard activation',
    (APP.match(/act === 'new-file'\) \{\s*\n\s*newFile\(\);/g) || []).length === 1 &&
    (APP.match(/ntpAct === 'new-file'\) \{\s*\n\s*newFile\(\);/g) || []).length === 1);
  assert('the empty state advertises ⌘N inside the primary line (a 4th chip overflowed the drop box)',
    /⌘N<\/span> for a new file/.test(APP) && !/dz-more-item"><span class="kbd">⌘N/.test(APP));

  var block = APP.slice(APP.indexOf('var SHORTCUTS = ['));
  block = block.slice(0, block.indexOf('];') + 2);
  assert('the shortcuts overlay lists ⌘N New file', block.indexOf("{ keys: ['⌘N'], action: 'New file' }") !== -1);
})();

/* ═══════════════════════════════════════════════════════════
   the blank editor
   ═══════════════════════════════════════════════════════════ */
console.log('\nBlank editor\n');
(function () {
  assert('a blank new file shows the "nothing is saved" hint, and only then',
    /tab && tab\.isNew && !src\s*\n\s*\? ' placeholder="Start writing\. Nothing is saved until you press ⌘S\."'/.test(EDIT));
  assert('the hint is drawn in a visible theme colour (the textarea text itself is transparent)',
    /\.tv-edit-area--hl::placeholder \{[^}]*color: var\(--tv-text-muted\) !important;/.test(CSS));
  assert('the placeholder contains no dashes (house copy rule)', !/placeholder="[^"]*[—–]/.test(EDIT));
})();

console.log('\n' + (fail === 0 ? 'ALL PASS (' + pass + ' assertions)' : 'FAILURES: ' + fail + ' (' + pass + ' passed)'));
process.exit(fail === 0 ? 0 : 1);
