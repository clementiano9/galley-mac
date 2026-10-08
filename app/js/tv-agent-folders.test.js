/* ───────────────────────────────────────────────────────────
   UXF-07 · agent folders  (run: node app/js/tv-agent-folders.test.js)

   The display policy in tv-tree.js on the spec's fixture tree (as
   read_dir_tree returns it): agent dot-folders show, other dot-folders and
   folders with no viewable file sit behind "Show N more folders", a folder
   that holds an open file always shows, counts cover visible folders only.
   The shell wiring (footer, tooltip, Always Show, dimming) is checked by
   running hiddenFoldersTitle out of tv-app.js and by source guards.
   ─────────────────────────────────────────────────────────── */
'use strict';

var fs = require('fs');
var path = require('path');
var vm = require('vm');
var T = require('./tv-tree.js');

var pass = 0, fail = 0;
function assert(label, cond, detail) {
  if (cond) { console.log('  PASS  ' + label); pass++; }
  else { console.error('  FAIL  ' + label + (detail !== undefined ? ' — ' + JSON.stringify(detail) : '')); fail++; }
}
var APP = fs.readFileSync(path.join(__dirname, 'tv-app.js'), 'utf8');
var CSS = fs.readFileSync(path.join(__dirname, '..', 'css', 'tv-app.css'), 'utf8');
var FILES = fs.readFileSync(path.join(__dirname, 'tv-files.js'), 'utf8');
var NATIVE = fs.readFileSync(path.join(__dirname, 'tv-native.js'), 'utf8');
var CONF = fs.readFileSync(path.join(__dirname, '..', '..', 'tauri-app', 'src-tauri', 'tauri.conf.json'), 'utf8');
function extractFn(src, name) {
  var start = src.indexOf('function ' + name + '(');
  var depth = 0;
  for (var j = src.indexOf('{', start); j < src.length; j++) {
    if (src[j] === '{') depth++;
    else if (src[j] === '}' && --depth === 0) return src.slice(start, j + 1);
  }
}

// The spec fixture, as the Rust scan returns it (viewable files only;
// .git / node_modules never scanned; .env, config.toml, settings.json unlisted).
function dir(p, names, folders) {
  var files = (names || []).map(function (n) { return { name: n, path: p + '/' + n }; });
  folders = folders || [];
  var c = files.length;
  folders.forEach(function (f) { c += f.mdCount; });
  return { name: p.split('/').pop(), path: p, files: files, filesHidden: 0, folders: folders, mdCount: c, scanned: true };
}
function fixture() {
  return { path: '/r', truncated: false, unreadable: 0, root: dir('/r', ['AGENTS.md', 'CLAUDE.md', '.cursorrules', '.aider.chat.history.md', 'notes.txt'], [
    dir('/r/.claude', [], [dir('/r/.claude/rules', ['a.md']), dir('/r/.claude/skills', [], [dir('/r/.claude/skills/x', ['SKILL.md'])])]),
    dir('/r/.cursor', [], [dir('/r/.cursor/rules', ['style.mdc'])]),
    dir('/r/.github', ['copilot-instructions.md'], [dir('/r/.github/prompts', ['p.prompt.md'])]),
    dir('/r/.kiro', [], [dir('/r/.kiro/steering', ['product.md']), dir('/r/.kiro/specs', [], [dir('/r/.kiro/specs/x', ['requirements.md'])])]),
    dir('/r/.agents', [], [dir('/r/.agents/skills', [], [dir('/r/.agents/skills/s', ['SKILL.md'])])]),
    dir('/r/.windsurf', [], [dir('/r/.windsurf/rules', ['r.md'])]),
    dir('/r/.opencode', [], [dir('/r/.opencode/agents', ['reviewer.md'])]),
    dir('/r/.roo', [], [dir('/r/.roo/rules', ['r.md'])]),
    dir('/r/.specstory', [], [dir('/r/.specstory/history', ['2026-01-01.md'])]),
    dir('/r/.codex', []), dir('/r/.gemini', [], [dir('/r/.gemini/commands', [])]),
    dir('/r/.husky', ['README.md']), dir('/r/.changeset', ['c.md']), dir('/r/.vscode', []), dir('/r/src', []),
    dir('/r/docs', ['guide.md'])
  ]) };
}
function rows(tree, opts) { return T.buildTreeNodes(tree, {}, opts); }
function folderNames(nodes) { return nodes.filter(function (n) { return n.kind === 'folder' && n.depth === 1; }).map(function (n) { return n.name; }); }

console.log('\nThe list\n');
assert('exactly 20 built-in names, all lowercase, all starting with "."',
  T.AGENT_FOLDERS.length === 20 && T.AGENT_FOLDERS.every(function (n) { return n === n.toLowerCase() && n.charAt(0) === '.'; }), T.AGENT_FOLDERS);
assert('every built-in name maps to a tool name', T.AGENT_FOLDERS.every(function (n) { return !!T.AGENT_TOOLS[n]; }));
assert('editor and tool folders are not on it', ['.vscode', '.idea', '.zed', '.husky', '.changeset', '.storybook', '.obsidian']
  .every(function (n) { return T.AGENT_FOLDERS.indexOf(n) === -1; }));

console.log('\nClassification (one case per row of the decision table)\n');
(function () {
  var f = fixture();
  function node(name) { return f.root.folders.filter(function (n) { return n.name === name; })[0]; }
  assert('agent folder with a viewable file → agent', T.folderClass(node('.claude'), {}) === 'agent');
  assert('normal folder with a viewable file → normal', T.folderClass(node('docs'), {}) === 'normal');
  assert('dot-folder not on the list → extra', T.folderClass(node('.husky'), {}) === 'extra');
  assert('agent name with nothing viewable → empty (hidden)', T.folderClass(node('.codex'), {}) === 'empty');
  assert('no viewable file → empty', T.folderClass(node('src'), {}) === 'empty');
  assert('a folder holding an open file → open, even when extra', T.folderClass(node('.husky'), { openPaths: ['/r/.husky/README.md'] }) === 'open');
  assert('names compare case-insensitively (.CLAUDE is .claude)', T.folderClass(dir('/x/.CLAUDE', ['a.md']), {}) === 'agent');
  assert('a user-added name counts as an agent folder', T.folderClass(node('.husky'), { agentNames: ['.husky'] }) === 'agent');
})();

console.log('\nAC 1-2 · default view\n');
(function () {
  var nodes = rows(fixture(), {});
  var files = nodes.filter(function (n) { return n.kind === 'file' && n.depth === 1; }).map(function (n) { return n.name; });
  assert('root files: AGENTS.md, CLAUDE.md, .aider.chat.history.md, .cursorrules, notes.txt',
    ['AGENTS.md', 'CLAUDE.md', '.aider.chat.history.md', '.cursorrules', 'notes.txt'].every(function (n) { return files.indexOf(n) !== -1; }) && files.length === 5, files);
  var shown = folderNames(nodes);
  assert('agent folders and docs are present, in natural order (.agents before .claude before docs)',
    shown.join() === '.agents,.claude,.cursor,.github,.kiro,.opencode,.roo,.specstory,.windsurf,docs', shown);
  assert('.husky .changeset .vscode .codex .gemini src are not', ['.husky', '.changeset', '.vscode', '.codex', '.gemini', 'src']
    .every(function (n) { return shown.indexOf(n) === -1; }));
  var cursor = nodes.filter(function (n) { return n.name === '.cursor'; })[0];
  assert('AC 9: .claude carries its tool name; agent rows are not marked extra',
    nodes.filter(function (n) { return n.name === '.claude'; })[0].tool === 'Claude Code' &&
    nodes.filter(function (n) { return n.name === '.github'; })[0].tool === 'GitHub Copilot' && cursor.extra === false);
  assert('AC 3: .cursor contains style.mdc', nodes.some(function (n) { return n.name === 'style.mdc'; }));
})();

console.log('\nAC 5-7 · the footer toggle and the counts\n');
(function () {
  var f = fixture();
  var hidden = T.hiddenFolders(f, {});
  assert('six hidden folders', hidden.map(function (h) { return h.name; }).sort().join() === '.changeset,.codex,.gemini,.husky,.vscode,src', hidden);
  assert('reasons: dot-folders vs no markdown',
    hidden.filter(function (h) { return h.reason === 'dot'; }).map(function (h) { return h.name; }).sort().join() === '.changeset,.husky,.vscode' &&
    hidden.filter(function (h) { return h.reason === 'empty'; }).map(function (h) { return h.name; }).sort().join() === '.codex,.gemini,src', hidden);
  var sb = {};
  vm.runInContext(extractFn(APP, 'hiddenFoldersTitle'), vm.createContext(sb));
  var total = T.hiddenFolderTotal(f, {});
  assert('addendum b: the total hidden at any depth counts folders inside hidden ones (.gemini/commands)', total === 7, total);
  var title = sb.hiddenFoldersTitle(hidden, total);
  assert('the title states the total and names all six with both reasons', /^6 folders are hidden \(7 at any depth\)\. Dot-folders: [^]*\.changeset[^]*No markdown: /.test(title) &&
    ['.husky', '.changeset', '.vscode', '.codex', '.gemini', 'src'].every(function (n) { return title.indexOf(n) !== -1; }), title);
  var seven = hidden.concat([{ name: '.idea', reason: 'dot' }]);
  assert('more than six names: "And N more."', /And 1 more\.$/.test(sb.hiddenFoldersTitle(seven)), sb.hiddenFoldersTitle(seven));
  assert('footer wording: "Show N more folders" / "Hide N extra folders"',
    /'Hide ' \+ nh \+ ' extra folder' \+ \(nh === 1 \? '' : 's'\)/.test(APP) && /'Show ' \+ nh \+ ' more folder' \+ \(nh === 1 \? '' : 's'\)/.test(APP));

  var off = rows(f, {});
  var on = rows(f, { showAll: true });
  assert('toggle on: the six appear, marked extra (dimmed); agent folders never are',
    ['.husky', '.changeset', '.vscode', '.codex', '.gemini', 'src'].every(function (n) {
      var r = on.filter(function (x) { return x.name === n && x.kind === 'folder'; })[0];
      return r && r.extra === true;
    }) && on.filter(function (x) { return x.kind === 'folder' && T.AGENT_FOLDERS.indexOf(x.name) !== -1 && x.name !== '.codex' && x.name !== '.gemini'; })
      .every(function (x) { return !x.extra; }));
  // Root: 5 files + .claude 2 + .cursor 1 + .github 2 + .kiro 2 + .agents 1 + .windsurf 1 + .opencode 1 + .roo 1 + .specstory 1 + docs 1
  assert('AC 7: the root count covers visible folders only (toggle off)', off[0].count === 18, off[0].count);
  assert('…and grows by the revealed folders\' files (toggle on: + .husky + .changeset)', on[0].count === 20, on[0].count);
  assert('dimming is CSS opacity .62 on folder rows only', /\.tv-tree-row\.is-extra \{ opacity: \.62; \}/.test(CSS) &&
    /'<div class="tv-tree-row subfolder' \+ \(n\.extra \? ' is-extra' : ''\)/.test(APP));
})();

console.log('\nAC 10 · nested\n');
(function () {
  var t = { path: '/p', root: dir('/p', [], [dir('/p/packages', [], [dir('/p/packages/web', [], [
    dir('/p/packages/web/.claude', [], [dir('/p/packages/web/.claude/rules', ['x.md'])]),
    dir('/p/packages/web/.husky', ['README.md'])])])]) };
  var nodes = rows(t, {});
  assert('.claude under web is shown; .husky under web is an extra',
    nodes.some(function (n) { return n.path === '/p/packages/web/.claude'; }) && !nodes.some(function (n) { return n.path === '/p/packages/web/.husky'; }));
  assert('…and counted in the footer', T.hiddenFolders(t, {}).map(function (h) { return h.path; }).join() === '/p/packages/web/.husky');
})();

console.log('\nAC 12-15 · Always Show, open files, Reveal\n');
(function () {
  var f = fixture();
  var withHusky = rows(f, { agentNames: ['.husky'] });
  assert('"Always Show .husky": visible with the toggle off, not dimmed', withHusky.some(function (n) { return n.name === '.husky' && !n.extra; }));
  assert('…and the footer drops to 5', T.hiddenFolders(f, { agentNames: ['.husky'] }).length === 5);
  var ctx = extractFn(APP, 'openFolderCtx');
  assert('the folder menu offers Always Show / Stop Always Showing for dot-folders that are not built in',
    /TVTree\.AGENT_FOLDERS\.indexOf\(fLower\) !== -1/.test(ctx) && /'Stop Always Showing' : 'Always Show'/.test(ctx) && /!isRoot && fName\.charAt\(0\) === '\.'/.test(ctx));
  assert('the list is localStorage tv-agent-folders, lowercase, at most 64',
    /localStorage\.setItem\('tv-agent-folders', JSON\.stringify\(state\.agentFolders\)\)/.test(APP) &&
    /var n = String\(name \|\| ''\)\.toLowerCase\(\);/.test(extractFn(APP, 'setAgentFolder')) && /slice\(0, 64\)/.test(extractFn(APP, 'setAgentFolder')));
  var open = rows(f, { openPaths: ['/r/.husky/README.md'] });
  assert('AC 14: an open file\'s folder shows with the toggle off', open.some(function (n) { return n.name === '.husky' && !n.extra; }));
  assert('…and returns to the footer when the tab closes', !rows(f, {}).some(function (n) { return n.name === '.husky'; }));
  var chain = T.policyHiddenChain(f, '/r/.husky/README.md', { openPaths: ['/r/.husky/README.md'] });
  assert('AC 15: Reveal finds the folder the policy would hide', chain.length === 1 && chain[0].name === '.husky', chain);
  assert('…shows it for the session and says "Showing .husky"',
    /state\.sessionVisibleFolders\[n\.path\] = true/.test(APP) && /'Showing ' \+ showing\.join\(', '\)/.test(APP));
  assert('a session-visible folder shows', rows(f, { sessionVisible: { '/r/.husky': true } }).some(function (n) { return n.name === '.husky'; }));
})();

console.log('\nViewable files (JS side)\n');
assert('.mdc opens from the picker and drops (tv-files, tv-native)',
  /MD_EXTS = \['\.md', '\.markdown', '\.mdc', '\.txt'\]/.test(FILES) && /MD_EXTS = \['\.md', '\.markdown', '\.mdc', '\.txt'\]/.test(NATIVE) && /input\.accept = '\.md,\.markdown,\.mdc,\.txt'/.test(FILES));
assert('AC 19: "Open With Galley" accepts .mdc (fileAssociations)', /"ext": \["md", "markdown", "mdc"\]/.test(CONF));
assert('fix round 5 #3: dropping an extensionless agent rule file opens it (browser and native drop)',
  ["'.cursorrules', '.windsurfrules', '.clinerules', '.roorules', '.goosehints', '.rules'"].every(function (l) { return FILES.indexOf(l) !== -1 && NATIVE.indexOf(l) !== -1; }) &&
  /AGENT_RULE_FILES\.indexOf\(base\) !== -1/.test(NATIVE) && /AGENT_RULE_FILES\.indexOf\(name\) !== -1/.test(FILES));
assert('AC 20: no settings UI (no ⌘, binding)', !/k === ','/.test(APP));

console.log('\n' + (fail === 0 ? 'ALL PASSED' : 'FAILURES: ' + fail) + ' (' + pass + ' passed, ' + fail + ' failed)\n');
if (fail > 0) process.exit(1);
