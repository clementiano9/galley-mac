/* ───────────────────────────────────────────────────────────
   Galley · UXF-10 Open Path: fuzzy path completion
   Run: node app/js/tv-pathfind.test.js
   Drives the real tv-pathfind.js against a fake folder tree, then the
   palette's path-mode model through TVPalette._internals.buildModel.
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

const read = (f) => fs.readFileSync(path.join(__dirname, f), 'utf8');
const sandbox = { window: { TV_ICONS: {}, TVTree: require('./tv-tree.js') }, console,
  localStorage: { getItem: () => null, setItem() {} } };
vm.createContext(sandbox);
vm.runInContext(read('tv-pathfind.js'), sandbox, { filename: 'tv-pathfind.js' });
vm.runInContext(read('tv-palette.js'), sandbox, { filename: 'tv-palette.js' });
const PF = sandbox.window.TVPathFind;
const I = sandbox.window.TVPalette._internals;

const HOME = '/Users/me';
const FS = {
  '/': ['Users/', 'tmp/'],
  '/Users': ['me/'],
  '/Users/me': ['ai-projects/', 'Documents/', 'Downloads/', '.claude/', 'notes.md'],
  '/Users/me/ai-projects': ['tiny-viewer/', 'tiny-old/', 'dundun-ai/', 'videos/'],
  '/Users/me/ai-projects/tiny-viewer': ['README.md', 'CLAUDE.md', 'app/', 'tauri-app/', '.github/'],
  '/Users/me/ai-projects/tiny-old': ['READ.md'],
  '/Users/me/ai-projects/dundun-ai': ['plan.md'],
  '/Users/me/.claude': ['CLAUDE.md', 'skills/'],
};
const lookup = (d) => FS[d] ? { entries: FS[d].map((n) => ({ name: n.replace(/\/$/, ''), dir: n.endsWith('/') })) } : null;
const env = { home: HOME, cwd: HOME + '/ai-projects/tiny-viewer' };
const top = (q) => { const r = PF.resolve(PF.parse(q, env), lookup).rows; return r.length ? r[0].path : null; };
const paths = (q) => PF.resolve(PF.parse(q, env), lookup).rows.map((r) => r.path);

// Path detection
check('"~/", "/", "./", "../" start path mode', ['~/x', '/x', './x', '../x', '~'].every(PF.isPathQuery));
check('plain words, "#" and "docs/x" do not', !['readme', '#h', 'docs/readme', ''].some(PF.isPathQuery));

// Exact and nearly-right paths
check('exact path', top('~/ai-projects/tiny-viewer/README.md') === HOME + '/ai-projects/tiny-viewer/README.md');
check('abbreviated folders: ~/ai-proj/tiny-v/READ', top('~/ai-proj/tiny-v/READ') === HOME + '/ai-projects/tiny-viewer/README.md');
check('ambiguous folder keeps both candidates: ~/ai-proj/tiny/READ',
  paths('~/ai-proj/tiny/READ').includes(HOME + '/ai-projects/tiny-viewer/README.md') &&
  paths('~/ai-proj/tiny/READ').includes(HOME + '/ai-projects/tiny-old/READ.md'));
check('typo in a folder: tiny-veiwer', top('~/ai-projects/tiny-veiwer/README.md') === HOME + '/ai-projects/tiny-viewer/README.md');
check('typo in the file: REDAME', top('~/ai-projects/tiny-viewer/REDAME') === HOME + '/ai-projects/tiny-viewer/README.md');
check('initials and missing dash: ~/aiprojects/tv/cla', top('~/aiprojects/tv/cla') === HOME + '/ai-projects/tiny-viewer/CLAUDE.md');
check('case-insensitive: ~/AI-PROJECTS/DUNDUN-AI/PLAN', top('~/AI-PROJECTS/DUNDUN-AI/PLAN') === HOME + '/ai-projects/dundun-ai/plan.md');
check('absolute: /Users/me/ai-projects/', paths('/Users/me/ai-projects/').length === 4);
check('relative to the current file: ./CLA', top('./CLA') === HOME + '/ai-projects/tiny-viewer/CLAUDE.md');
check('parent folder: ../tiny-o/', top('../tiny-o/') === HOME + '/ai-projects/tiny-old/READ.md');
check('an exact folder drops weaker guesses at that level', paths('../tiny-o/').length === 1, paths('../tiny-o/'));
check('trailing "/" lists the folder in its own order', paths('~/').join() ===
  [HOME + '/ai-projects', HOME + '/Documents', HOME + '/Downloads', HOME + '/notes.md'].join());
check('hidden entries only when the segment starts with "."',
  !paths('~/').some((p) => p.endsWith('/.claude')) && top('~/.cl') === HOME + '/.claude');
const FS2 = { '/Users/me': ['ai-projects/'], '/Users/me/ai-projects': ['tiny-viewer-old/', 'tiny-viewer/'], '/Users/me/ai-projects/tiny-viewer': ['README.md'], '/Users/me/ai-projects/tiny-viewer-old': ['README.md'] };
const look2 = (d) => FS2[d] ? { entries: FS2[d].map((n) => ({ name: n.replace(/\/$/, ''), dir: n.endsWith('/') })) } : null;
check('a typo of the whole name beats a longer sibling (QA defect 2)',
  PF.resolve(PF.parse('~/ai-projects/tiny-veiwer/READ', env), look2).rows[0].path === HOME + '/ai-projects/tiny-viewer/README.md');
check('"~/." lists hidden entries (QA defect 3)', paths('~/.').includes(HOME + '/.claude'));
check('nothing matches → no rows', paths('~/zzzz/qqq').length === 0);
check('an unread folder is reported as pending', PF.resolve(PF.parse('~/Documents/', env), lookup).pending[0] === HOME + '/Documents');

// One segment
const S = PF.segScore;
check('segment tiers: exact > case > prefix > words > initials > substring > letters > typo',
  S('README.md', 'README.md').score > S('readme.md', 'README.md').score &&
  S('readme.md', 'README.md').score > S('READ', 'README.md').score &&
  S('READ', 'README.md').score > S('proj', 'ai-projects').score &&
  S('proj', 'ai-projects').score > S('ap', 'ai-projects').score &&
  S('ap', 'ai-projects').score > S('roje', 'ai-projects').score &&
  S('roje', 'ai-projects').score > S('aprj', 'ai-projects').score &&
  S('aprj', 'ai-projects').score > S('ai-porjects', 'ai-projects').score);
check('two letters typed do not typo-match', S('zx', 'ai-projects') === null);

// Known-file fallback lets the user skip a folder level
const kn = PF.matchKnown(PF.parse('~/tiny/READ', env), [HOME + '/ai-projects/tiny-viewer/README.md', HOME + '/x/y.md']);
check('known files: ~/tiny/READ skips ai-projects', kn.length === 1 && kn[0].path === HOME + '/ai-projects/tiny-viewer/README.md');

// Display
check('abbreviate under home', PF.abbreviate(HOME + '/a/b', HOME) === '~/a/b' && PF.abbreviate('/tmp/x', HOME) === '/tmp/x');
check('completion keeps the user\'s style', PF.typed(HOME + '/a', HOME, 'abs') === HOME + '/a' && PF.typed(HOME + '/a', HOME, 'home') === '~/a');

// Palette path-mode model
function ctx(over) {
  return Object.assign({ tabs: [], activeId: null, mode: 'reading', openFolders: [], recents: [], mru: [], used: [],
    native: true, mermaid: true, hasDiscarded: false, home: HOME, lookup,
    appearance: { themeChoice: 'light', theme: 'light', accent: 'blue', fontSize: 16 } }, over || {});
}
const m = I.buildModel('~/ai-proj/tiny-v/', ctx());
check('palette: a path query builds the path model', m.kind === 'path' && m.flat.length === 4, m.flat.map((r) => r.label));
check('palette: one folder → section titled "In ~/…"', m.sections[0].title === 'In ~/ai-projects/tiny-viewer');
check('palette: folders end in "/" and have the folder icon', m.flat.some((r) => r.label === 'app/' && r.ic === 'folder' && r.isDir));
check('palette: verbs are "Go into" for folders, "Open" for files',
  I.verb(m.flat.find((r) => r.isDir)) === 'Go into' && I.verb(m.flat.find((r) => !r.isDir)) === 'Open');
const keys = I.footerKeys(m, m.flat.find((r) => r.isDir), '~/x', null).map((k) => k[0]).join(' ');
check('palette: folder footer = ⇥ ↵ ⇧↵ ⌘↵ esc, no Create', keys === '⇥ ↵ ⇧↵ ⌘↵ esc', keys);
check('palette: browser build says it needs the desktop app',
  I.buildModel('~/x', ctx({ native: false })).hint === 'Opening a file by its path needs the desktop app.');
check('palette: home not known yet → "Reading ~…"', I.buildModel('~/', ctx({ home: '', lookup: () => null })).hint === 'Reading ~…');
check('palette: no match → says so', /No folder or markdown file matches/.test(I.buildModel('~/zzzz/qqq', ctx()).hint));
const withKnown = I.buildModel('~/tiny/READ', ctx({ tabs: [{ id: 't', name: 'README.md', nativePath: HOME + '/ai-projects/tiny-viewer/README.md', source: '' }] }));
check('palette: "Known files" section when live matches run short',
  withKnown.sections.some((s) => s.title === 'Known files' && s.rows[0].path === HOME + '/ai-projects/tiny-viewer/README.md'),
  withKnown.sections.map((s) => s.title));
check('palette: "#" and plain queries are unchanged', I.buildModel('#', ctx()).kind === 'outline' && I.buildModel('read', ctx()).kind === 'typed');
check('palette: Open Path… command with ⌘L', I.cmds.some((c) => c.id === 'open-path' && c.kbd === '⌘L' && c.native));

// Wiring guards
const PAL = read('tv-palette.js'), APP = read('tv-app.js'), NAT = read('tv-native.js');
const RS = fs.readFileSync(path.join(__dirname, '..', '..', 'tauri-app', 'src-tauri', 'src', 'lib.rs'), 'utf8');
check('the first ⌘L becomes ~/… once home is known (QA defect 1)',
  /_prefillAbs = \(!_home && pre\.charAt\(0\) === '\/'\) \? pre : '';/.test(PAL) && /_home = res\.path; _tildePrefill\(\);/.test(PAL));
check('⇥ completes in path mode', /_model\.kind === 'path' && _model\.flat\[_sel\]\)[\s\S]{0,80}_completePath/.test(PAL));
check('⇧↵ never creates a file from a path', /isPathQuery\(q\)\) return false;/.test(PAL));
check('⌘L routes to TVPalette.openPath', /e\.code === 'KeyL'[\s\S]{0,200}TVPalette\.openPath\(\)/.test(APP));
check('native: menu:open-path listener and listDir bridge',
  /listen\('menu:open-path'/.test(NAT) && /invoke\('list_dir', \{ path: path \}\)/.test(NAT));
check('Rust: list_dir registered, File ▸ Open Path… ⌘L emitted',
  /\blist_dir,/.test(RS) && /"menu:open-path",\s*"Open Path\\u\{2026\}",\s*true,\s*Some\("CmdOrCtrl\+L"\)/.test(RS) &&
  /\| "menu:open-path"/.test(RS));
check('index.html loads tv-pathfind.js before tv-palette.js',
  /tv-pathfind\.js"><\/script>\s*<script src="js\/tv-palette\.js"/.test(fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8')));

// Speed: 5,000 entries per folder, five levels.
const big = {};
let dir = HOME;
for (let d = 0; d < 5; d++) {
  big[dir] = Array.from({ length: 5000 }, (_, i) => ({ name: 'folder-' + i + '-name', dir: true }));
  big[dir].push({ name: 'target-' + d, dir: true });
  dir += '/target-' + d;
}
big[dir] = [{ name: 'goal.md', dir: false }];
const t0 = Date.now();
const r = PF.resolve(PF.parse('~/targt-0/tar-1/target-2/target-3/target-4/goal', env), (d) => big[d] ? { entries: big[d] } : null);
const ms = Date.now() - t0;
check('5 levels × 5,000 entries resolve under 150 ms (' + ms + ' ms)', ms < 150 && r.rows[0] && r.rows[0].name === 'goal.md');

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
