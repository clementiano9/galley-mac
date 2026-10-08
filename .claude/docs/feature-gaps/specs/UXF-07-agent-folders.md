# UXF-07 — Show agent folders, hide the other dot-folders

*Status: specified 2026-10-06 (iteration 2) · Priority: Must (sev 3) · Amends UXF-02 (dot-folder rule, footer wording, viewable extensions) · Owner files: `app/js/tv-tree.js`, `app/js/tv-app.js`, `app/js/tv-files.js`, `app/js/tv-native.js`, `tauri-app/src-tauri/src/lib.rs`, `tauri-app/tauri.conf.json`*

## Why

Owner: "We don't want to just automatically show all hidden folders that begin with a dot. However, since this application is designed to be used agentically with an agent, we definitely want to display dot files, .codex, or any folder associated with an agent. Illustrate this within the UX pipeline and determine the right balance."

Today (UXF-02): every dot-folder that holds markdown is shown, except a deny-list of generated trees (`SCAN_DENY`, `lib.rs:689`). So `.husky/`, `.changeset/`, `.idea/` and other tool folders appear next to `.claude/`, and `.cursor/` never appears at all, because Cursor's rule format is `.mdc`, which the scanner does not list (`is_md_name`, `lib.rs:702`).

## Tie-back

New work role **WR4 Agent Operator** and new requirement **URD-11 Agent instruction files** (definitions and WANs 075 to 096 in `ux/research/stream-6-iteration-2.md`). Extends URD-06 (AI-output review) and URD-10 (live files): agent configuration is markdown that the same person writes and reviews. Keeps URD-07 (read-only, names only) and URD-08 (quiet chrome). Amends DR-39 (no non-markdown files): the viewable set grows by one markdown dialect and a short list of extensionless rule files.

## Research result (summary; sources in stream 6)

1. Every major coding agent keeps its markdown in a dot-folder at the project root: `.claude/` (rules, skills, commands, agents), `.cursor/rules/*.mdc`, `.github/` (copilot-instructions.md, instructions/, prompts/, agents/), `.kiro/` (steering, specs), `.junie/`, `.opencode/agents/`, `.augment/rules/`, `.trae/rules/`, `.roo/rules/`, `.windsurf/rules/` (moving to `.devin/rules/`), `.continue/rules/`, `.amazonq/rules/`, `.agents/skills/` (the Agent Skills layout), `.gemini/`, `.codex/` (config layers), and `.specstory/history/*.md` (saved chats).
2. The cross-tool file is `AGENTS.md`, plus `CLAUDE.md`, `GEMINI.md`: already visible (not hidden, `.md`).
3. Some tools use hidden **files** with no extension: `.cursorrules`, `.windsurfrules`, `.clinerules`, `.roorules`, `.goosehints`, `.rules` (Zed reads the first of `.rules`, `.cursorrules`, `.windsurfrules`, `.clinerules`, `AGENT.md`, `AGENTS.md`, `CLAUDE.md`, `GEMINI.md`).
4. Many other dot-folders hold markdown that is not about an agent (`.husky/`, `.changeset/`, `.storybook/`) or nothing readable at all (`.vscode/`, `.idea/`).

## Decision

One rule decides a folder: **is it on the agent list, or does an open file live in it?** Everything else dotted is an *extra*.

| Class | Test | Default view | Footer toggle on |
|---|---|---|---|
| Never scanned | in `SCAN_DENY` (`.git`, `node_modules`, `.venv`, …) | not present, not counted | still not present |
| Agent folder | name is on the agent list (built-in or yours), any depth, case-insensitive | **shown** when it holds a viewable file | shown |
| Open-file ancestor | an open tab's file is inside it | **shown** (a file you have open must never be unreachable) | shown |
| Normal folder | no leading dot | shown when it holds a viewable file (UXF-02) | shown |
| Extra dot-folder | leading dot, not on the list | hidden, counted in the footer | shown, dimmed |
| Folder with no viewable file | any name | hidden, counted in the footer | shown, dimmed |

**Viewable file** = extension `md`, `markdown`, **`mdc`** (new), `txt`, or one of the extensionless rule files `.cursorrules .windsurfrules .clinerules .roorules .goosehints .rules` (new, any depth). Dot-files that are viewable (for example `.aider.chat.history.md`) are listed. Nothing else is: `.env`, `.npmrc`, `settings.json`, `config.toml` never appear (privacy and DR-39).

### The agent list (built-in, 20 names)

`.agents  .amazonq  .augment  .claude  .clinerules  .codex  .continue  .cursor  .devin  .gemini  .github  .junie  .kilo  .kilocode  .kiro  .opencode  .roo  .specstory  .trae  .windsurf`

Kept as one `const AGENT_FOLDERS` in `tv-tree.js` (the display policy is JS; Rust only lists what it finds). Not included on purpose: `.vscode`, `.idea`, `.zed` (editor settings, no markdown rules), `.husky`, `.changeset`, `.storybook`, `.obsidian`.

### Footer toggle (replaces the UXF-02 wording)

One row at the end of each root, the same `.tv-tree-action` style as today, one toggle for both reasons (hidden dot-folder, no viewable file):

| State | Text | Tooltip (`title`) |
|---|---|---|
| Off, N > 0 | `Show N more folders` | `N more folders. T hidden in all, counting folders inside them. Dot-folders: .husky, .vscode. No markdown: src, .codex.` (names, up to 6, then "and M more") |
| On | `Hide N extra folders` | same list |
| N = 0 | no row | |

**What N counts (ruling 2026-10-07).** `N` is the number of **top-most hidden folders under visible folders**: exactly the new rows that appear when you press the toggle, collapsed. It does not change when you expand or collapse folders. `T` (in the tooltip only) is the total of hidden folders at any depth, including those inside hidden folders; expanding everything after the toggle shows `T` extra rows. The label says `more folders` because N is what you will see now; the tooltip says what else exists, so the number is never a surprise. On: `Hide N extra folders`, the same N.

"More" and "extra" are deliberate: the folders are not wrong, they are secondary. State persists in the existing `localStorage['tv-tree-show-empty']` (no migration). Counts on folder rows and on the root head cover **visible** folders only, so the number you see equals the files you can reach.

### Marking (kept quiet)

- Agent folders look like any folder. No badge, no icon, no accent (house rule: no accent bars). Their name is the cue. Dot names sort first, so `.claude .codex .cursor .github` sit together at the top of a root, above `docs`, `src`: that is the useful grouping and it needs no decoration.
- Tooltip names the tool: `Claude Code · .claude`, `Cursor · .cursor`, `GitHub Copilot · .github`, `OpenAI Codex · .codex`, and so on (a name-to-tool map beside the list).
- Folders revealed by the toggle are dimmed (text and icon at 62% opacity) so the extras read as extras. Dimming is the only marking in the app.

### Your own entries

- Context menu on any folder row: `Always Show "<name>"` (adds the lowercase name to `localStorage['tv-agent-folders']`, a JSON array, at most 64 entries) and, for names you added, `Stop Always Showing "<name>"`. Works on dimmed rows, which is how you promote a revealed folder. The list is by name, not path, so it applies in every project.
- Built-in names cannot be removed; the footer toggle already handles the case where one is unwanted.
- No settings panel (DR-31).

### Reveal and open files

A folder that contains an open tab's file is always visible, so `Reveal in Sidebar` (UXF-06) works for files inside extras. UXF-06 step 4 adds: if the file's folder is hidden by this policy, show it for the session (path-keyed, not persisted) and say `Showing .husky` in the live region.

## Touch points

| File | Where | Change |
|---|---|---|
| `tauri-app/src-tauri/src/lib.rs` | `is_md_name` ~702, list-dir code ~846 | add `mdc`; add `AGENT_FILE_NAMES` (the six extensionless names) as viewable at any depth; extend the `add_filter` lists ~184 and ~494 and the open-with filter ~1489 to `mdc` |
| `tauri-app/tauri.conf.json` | `fileAssociations` | add `mdc` to the Markdown Document entry |
| `app/js/tv-files.js` | `MD_EXTS` ~14, `input.accept` ~263 | add `.mdc` |
| `app/js/tv-native.js` | `MD_EXTS` ~39 | add `.mdc` |
| `app/js/tv-tree.js` | `folderVisible` ~163, `hiddenEmptyCount` ~231, `buildTreeNodes` ~186, default-expansion ~309 | replace the single `showEmpty` test with `folderClass(node, ctx)` returning `agent / open / normal / extra`; add `AGENT_FOLDERS`, `AGENT_TOOLS`, `hiddenFolders(tree, ctx)` (returns the names for the tooltip); visible counts |
| `app/js/tv-app.js` | footer rows ~1935; folder context menu; `state` | new wording; `Always Show` items; `state.agentFolders` from `localStorage`; pass `{ agentNames, openPaths, sessionVisible }` to the tree builder |
| `app/css/tv-app.css` | near `.tv-tree-row.subfolder` | `.tv-tree-row.is-extra { opacity: .62 }` (folder rows only) |
| `tauri-app/NATIVE-CONTRACT.md` | scan section | document `mdc` and the extensionless names |
| tests | `tv-tree-nesting.test.js`, `tv-sidebar-hierarchy.test.js`, new `tv-agent-folders.test.js` | classification unit tests (one case per table row), list integrity (20 names, all lowercase, all start with `.`) |

## Acceptance criteria

Fixture (built in a temp directory):

```
root/ AGENTS.md  CLAUDE.md  .cursorrules  .env  .aider.chat.history.md  notes.txt
  .claude/rules/a.md   .claude/skills/x/SKILL.md      .cursor/rules/style.mdc
  .github/copilot-instructions.md  .github/prompts/p.prompt.md
  .kiro/steering/product.md  .kiro/specs/x/requirements.md
  .agents/skills/s/SKILL.md  .windsurf/rules/r.md  .opencode/agents/reviewer.md
  .roo/rules/r.md  .specstory/history/2026-01-01.md
  .codex/config.toml  .gemini/commands/a.toml           (agent names, nothing viewable)
  .husky/README.md  .changeset/c.md  .vscode/settings.json  src/main.rs
  .git/…  node_modules/…                                 (never scanned)
  docs/guide.md
```

1. **PASS/FAIL** default view, root files: `AGENTS.md`, `CLAUDE.md`, `.aider.chat.history.md`, `.cursorrules`, `notes.txt` are listed; `.env` is not.
2. **PASS/FAIL** default view, folders: `.agents .claude .cursor .github .kiro .opencode .roo .specstory .windsurf docs` are present; `.husky .changeset .vscode .codex .gemini src .git node_modules` are not.
3. **PASS/FAIL** `.cursor` is present and contains `style.mdc` (the `mdc` extension is scanned and opens: click the row, a tab opens with the rule text).
4. **PASS/FAIL** `.cursorrules` opens as text from its row.
5. **PASS/FAIL** footer reads `Show 6 more folders` (`.husky .changeset .vscode .codex .gemini src`: the top-most hidden folders); its `title` says `6 more folders. 7 hidden in all` (the seventh is `.gemini/commands`, inside a hidden folder) and names the six with the two reasons. Expanding every row after pressing the toggle shows exactly 7 extra rows. `N` is unchanged by expanding or collapsing any folder.
6. **PASS/FAIL** click the footer: the six appear, text and icon at about 62% opacity (computed opacity between 0.55 and 0.7), the footer reads `Hide 6 extra folders`; reload: the choice persists; agent folders are never dimmed.
7. **PASS/FAIL** the root head count and every folder count equal the number of viewable files that are visible under them at that moment (change the toggle, recount).
8. **PASS/FAIL** natural order puts `.agents` before `.claude` before `docs`; no agent folder carries a badge, an icon other than the folder icon, or a left border.
9. **PASS/FAIL** hover `.claude`: the tooltip contains `Claude Code`; `.github`: `GitHub Copilot`.
10. **PASS/FAIL** nested: `packages/web/.claude/rules/x.md` shows `.claude` under `web` (the list applies at any depth); `packages/web/.husky/README.md` is an extra.
11. **PASS/FAIL** case: a folder named `.Claude` on a case-sensitive volume or `.CLAUDE` is treated as `.claude`.
12. **PASS/FAIL** context menu on dimmed `.husky`: `Always Show ".husky"`; choose it: `.husky` becomes undimmed and visible with the toggle off; the footer count drops to 5; `localStorage['tv-agent-folders']` is `[".husky"]`; open another root: `.husky` shows there too. Context menu now offers `Stop Always Showing ".husky"` and it reverses all of this.
13. **PASS/FAIL** built-in names are not offered `Stop Always Showing`.
14. **PASS/FAIL** open `.husky/README.md` from Recent while `.husky` is an extra: the folder is visible and expanded and the file row is active, with the toggle off. After the tab closes it returns to the footer count at the next render.
15. **PASS/FAIL** `⇧⌘J` on that tab (UXF-06) works and the live region says `Showing .husky`.
16. **PASS/FAIL** `.codex` containing a `prompts/review.md` is shown by default (agent name plus a viewable file); with only `config.toml` it is an extra. (Answers the owner's `.codex` case honestly: only when there is something readable.)
17. **PASS/FAIL** privacy: no scan result, tooltip or toast contains a file name that is not viewable (assert with `.env`, `id_rsa`, `credentials.json` placed in `.claude/`).
18. **PASS/FAIL** `cargo build` passes; `cargo test`: the scan lists `.mdc` and the six names, and still skips `SCAN_DENY`; the JS list has exactly 20 names.
19. **PASS/FAIL** Finder "Open With Galley" accepts an `.mdc` file; dropping one on the window opens it.
20. **PASS/FAIL** no new settings UI exists (DR-31): no panel, no `⌘,`.

## Edge cases

- Opening `~` as a root: `.claude`, `.codex`, `.gemini`, `.cursor`, `.kiro`, `.junie` are the global agent homes and show; `.Trash`, `.config`, `.ssh` are extras (and `.ssh` holds no viewable file). The 20,000-entry budget (UXF-02) still applies.
- `.claude/projects/**` can hold thousands of transcript files (`.jsonl`, not viewable) and per-project memory markdown; counts reflect only viewable files.
- A repo that uses `.github` only for workflows and images: no viewable file, so it is an extra (consistent with UXF-02 criterion 13).
- Windsurf is moving from `.windsurf/rules/` to `.devin/rules/` (third-party report, Sept 2026); both are listed.
- An agent folder that disappears and returns between scans keeps its collapse state (keyed by path).
- The list will age. It is one constant plus a name-to-tool map; review it when adding support for a new agent.

## Out of scope

A read-only code view for `.json`, `.toml`, `.yaml` (so `.codex/config.toml`, `.claude/settings.json` could be read: see the open question in step 8), editing the list in a panel, per-project lists, hiding built-in names, scanning inside `.git`.
