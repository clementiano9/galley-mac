# UXF-02 — The navigator shows every folder that has markdown

*Status: specified 2026-10-06 · Priority: Must (sev 4) · Build first · Owner files: `tauri-app/src-tauri/src/lib.rs`, `app/js/tv-tree.js`, `app/js/tv-app.js`, `app/js/tv-native.js`, `app/js/tv-palette.js`, `tauri-app/NATIVE-CONTRACT.md`*

## Why

Owner: "All folders are still not showing in the file navigator." Two separate causes exist. This spec fixes the scan (the first). UXF-03 fixes the presentation (the second: the capped inner scroller hides 8 of 12 folders of a complete tree).

Scan causes, all verified in `read_dir_tree` (`lib.rs:711-1005`):

| # | Cause | Effect |
|---|---|---|
| S1 | A budget of 200 visited entries counts every entry (any extension, any hidden dir) and is spent depth-first | One folder's subtree starves its siblings. Port on `~/ai-projects`: **1 of 26** top-level markdown folders shown. On this repo the root `README.md` and `CLAUDE.md` never appear |
| S2 | `.git`, `node_modules`, `target` and other generated trees are walked | They burn the budget |
| S3 | At most 10 subfolders (counted after they are accepted); later folders are skipped unopened | Folder 11 onward silently missing |
| S4 | Entries come in filesystem order and files are never sorted | Which folders survive, and the file order, are arbitrary |
| S5 | `deep` is capped at 50 files; depth capped at 6 | Deep files drop; "Show N more files" is the only recovery and does not mention folders |
| S6 | The command is synchronous, so it runs on the main thread | A bigger budget would freeze the UI and menu bar |
| S7 | The tree is a snapshot. `Refresh` calls `registerFolder()`, which toasts "already open" and re-scrolls | A folder an agent created after opening never shows; Refresh feels broken |

## Decision (what the navigator shows)

- **Shown:** every folder that contains at least one `.md`, `.markdown` or `.txt` file at any depth. Hidden (dot) folders are included: `.claude/`, `.github/` and `.cursor/` hold the markdown AI users care about. **Amended by UXF-07 (iteration 2):** dot-folders are no longer all shown; only agent folders (a 20-name list), folders that hold an open file, and your own entries are. The viewable set also gains `.mdc` and six extensionless rule files.
- **Not scanned at all:** the deny-list below. Never shown, never counted.
- **Hidden by default, one click to show:** folders with no viewable file below them, and dot-folders that are not on the agent list (UXF-07). One footer row, `Show N more folders` / `Hide N extra folders` (wording and tooltip: UXF-07), toggles them.
- **Never silently missing:** if the budget runs out before a folder is opened, that folder appears with `…` instead of a count and loads when the user expands it.
- **Order:** folders before files; both in natural, case-insensitive order (`a2` < `a10` < `B`). Rust sorts too so budget cut-offs are deterministic.
- **Read-only (DR-06, URD-07):** names and paths only; no file content is read; symlinked folders are not followed.

## Rust (`lib.rs`)

`read_dir_tree(path: String, uncapped: Option<bool>) -> Result<DirTree, String>` keeps its name and arguments. It becomes **async**: `async fn` wrapping `tauri::async_runtime::spawn_blocking(move || scan_dir_tree(&path, wide))`. The pure `scan_dir_tree` is what the unit tests call.

**Wire shape (replaces the 3-tier shape; camelCase through `#[serde(rename_all = "camelCase")]` on both structs):**

```
DirTree = { path, root: DirNode, truncated: bool, unreadable: u32 }
DirNode = { name, path,
            files: [{name, path}],      // direct markdown files, sorted, at most FILE_CAP
            filesHidden: u32,           // direct markdown files beyond FILE_CAP
            folders: [DirNode],         // direct subfolders, sorted; includes mdCount == 0
            mdCount: u32,               // markdown files in this subtree the scan saw (counts filesHidden too)
            scanned: bool }             // false = budget ran out first: files/folders empty, mdCount 0
```

`truncated` is true when any node has `scanned: false` or `filesHidden > 0`. `skipped` and `skippedExact` are removed.

**Algorithm.** Breadth-first with a FIFO queue.
1. Pop a directory. If `visited >= budget`, mark it `scanned: false` and continue.
2. Read it. Add the entry count to `visited`. Use `DirEntry::file_type()` (no extra stat); call `metadata()` only for symlinks.
3. Directories: skip deny-listed names, skip symlinked directories, skip names that are packages (`.app`, `.framework`, `.xcodeproj`, `.xcworkspace`, `.photoslibrary`). Queue the rest. Files: keep when the extension (case-insensitive) is `md`, `markdown` or `txt`; symlinked files are followed. Unreadable directory: count in `unreadable`, `eprintln!`, keep going.
4. Sort folders and files with `natural_cmp`. Apply `FILE_CAP`.
5. After the walk, fill `mdCount` bottom-up.

| Constant | Default | `uncapped: true` |
|---|---|---|
| `BUDGET` (entries read, whole walk) | 20,000 | 200,000 |
| `FILE_CAP` (listed per folder) | 500 | 5,000 |
| `MAX_DEPTH` (safety only) | 40, deeper folders are `scanned: false` | 40 |

`uncapped` is now used for two things: the per-folder `Show N more files` row, and loading one unscanned folder (call it with that folder's path; the returned `root` replaces the node).

**Deny-list** (names, any depth; never applied to the root the user picked, so opening `node_modules/foo` directly still works): `.git`, `node_modules`, `.venv`, `venv`, `__pycache__`, `.next`, `.nuxt`, `Pods`, `.cache`, `.tox`, `.gradle`, `.terraform`. Conditional: `target` only when the parent has `Cargo.toml`; `dist` and `build` only when the parent has `package.json` or `pyproject.toml`. Keep the list as one `const` so it is easy to change.

## JS

`tv-tree.js` (pure, DOM-free, node-testable):
- `assembleTree(tree)` returns `tree.root`.
- `buildTreeNodes(tree, collapsed, { showEmpty })` emits head, then per level **folders first, then files**. Folder nodes carry `path`, `count` (= `mdCount`) and `unscanned`. Folders with `mdCount === 0 && scanned` are skipped unless `showEmpty`. An expanded unscanned folder emits one `{ kind: 'loading' }` child.
- `hiddenEmptyCount(tree)`, `graftNode(tree, folderPath, node)`, `collectTreeFilePaths(tree)` (walks `root`).

`tv-app.js`:
- `registerFolder` stores the tree and stamps `tree._scannedAt = Date.now()`.
- Expanding an unscanned folder calls `loadFolderNode(rootPath, folderPath)` → `TVNative.readDirTree(folderPath)` → `graftNode` → render. Failure: toast `Could not read <name>`, node becomes an empty scanned folder.
- `refreshFolder(rootPath, { silent })` re-scans with the default budget, replaces the tree in its slot, keeps `state.folderCollapsed`, and renders only if the result differs. Folder ▸ Refresh uses it (fixes S7). It never toasts "already open" and never moves the scroll.
- **Focus re-scan:** on window `focus` and on `visibilitychange` to visible, re-scan every open root whose `_scannedAt` is older than 30 s, one at a time, silently.
- Footer rows at the end of each root body, using the existing `.tv-tree-more` style and the DR-108 cursor attributes: `Show N more folders` / `Hide N extra folders` (`data-tree-toggle-empty`; wording per UXF-07); `Show N more files` after a folder whose `filesHidden > 0` (the old C-29 row, now per folder); a muted non-interactive `N folder(s) could not be read` when `unreadable > 0`. State: `localStorage['tv-tree-show-empty']`, global.
- A root with no markdown anywhere keeps the `No markdown files` placeholder (C-28).

`tv-palette.js:396-400` reads `tree.files / subfolders / deep`. Replace with `TVTree.collectTreeFilePaths`.

## Touch points

| File | Where | Change |
|---|---|---|
| `tauri-app/src-tauri/src/lib.rs` | structs ~108-154; command ~695-1005; handler list ~1352 | new structs; `scan_dir_tree`, `natural_cmp`, async wrapper; `#[cfg(test)]` unit tests |
| `tauri-app/NATIVE-CONTRACT.md` | `read_dir_tree` row; "C-29" section | new wire shape; delete the 5000-entry text |
| `app/js/tv-tree.js` | whole file | as above |
| `app/js/tv-app.js` | `registerFolder` ~992; `loadMoreFolder` ~1071; `buildFolderSection` ~1449; folder ctx "refresh" ~1826; `init()` | as above |
| `app/js/tv-native.js` | `readDirTree` ~476; header comment ~464 | doc comment for new shape |
| `app/js/tv-palette.js` | ~396-400 | use `collectTreeFilePaths` |
| tests | `tv-tree-nesting.test.js`, `tv-sidebar-hierarchy.test.js`, `tv-sidebar-jank.test.js`, `tv-palette.test.js`, `tv-native.runtime.test.js` | update to the new shape; add a drift test that reads `DirNode` field names from `lib.rs` (same idea as the `save_md_file_as` check) |

## Acceptance criteria

Fixtures are built in a temp directory by a script in the test run. "Visible" means a row exists in the DOM.

1. **PASS/FAIL** 60 top-level folders × 3 markdown files each: all 60 rows exist, each with count 3, in natural order.
2. **PASS/FAIL** root with `node_modules/` (10,000 markdown files below it) plus 5 real folders: the 5 folders are present, `node_modules` is absent, scan returns in under 500 ms.
3. **PASS/FAIL** `.claude/docs/a.md` and a `.git/` folder: `.claude` is present, `.git` is absent.
4. **PASS/FAIL** markdown only at depth 8: every ancestor folder is present with count 1.
5. **PASS/FAIL** files `a10.md a2.md B.md c.md`: order is `a2, a10, B, c`. Folders `Zeta`, `alpha`: `alpha` first.
6. **PASS/FAIL** at every level folders come before files.
7. **PASS/FAIL** one folder with 800 markdown files: first 500 listed, row `Show 300 more files`; click: 800 listed, expanded folders keep their state.
8. **PASS/FAIL** a tree larger than the budget (fixture with 30,000 entries in early folders): later folders appear with `…`; expanding one loads it and the count replaces `…`; no folder is missing.
9. **PASS/FAIL** folders without a viewable file are absent; footer reads `Show N more folders` with the right N (wording per UXF-07); click shows them (rows present, count 0); the footer flips to `Hide …`; the choice survives a reload.
10. **PASS/FAIL** a symlink loop (`a/b -> ..`) does not hang and is not followed. A symlinked `.md` file is listed.
11. **PASS/FAIL** UI stays responsive during a 20,000-entry scan: a 16 ms timer on the page never gaps by more than 100 ms.
12. **PASS/FAIL** real data: opening `~/ai-projects` shows all top-level folders that contain markdown (26 on the owner's machine), none missing.
13. **PASS/FAIL** this repo as root, default view: `README.md`, `CLAUDE.md`, `.claude`, `app`, `tauri-app` present; `target/` absent; **`.github` absent** (it holds only images, no markdown, so the "folders without markdown" rule hides it). With the footer toggle on, `.github` and the other markdown-free folders (for example `app/css`, `app/js`) appear with count 0, and the footer N equals the number of top-most hidden folders under visible folders, which is the number of new rows that appear at once (6 on this repo); its tooltip gives the total hidden at any depth (13 on this repo), and expanding everything after the toggle shows 13 extra rows (rule: UXF-07).
14. **PASS/FAIL** create a `.md` in a subfolder from the shell, switch to another app and back within 60 s: the file appears within 1 s of regaining focus, with no toast and no scroll jump.
15. **PASS/FAIL** Folder ▸ Refresh: no "already open" toast; sidebar scroll offset and every expansion are unchanged.
16. **PASS/FAIL** an unreadable folder (mode 000): one footer line `1 folder could not be read`; the rest of the tree is intact.
17. **PASS/FAIL** `cargo build` passes and `cargo test` runs the new scan tests (items 1–6 and 10 as Rust unit tests).
18. **PASS/FAIL** the wire names match: the drift test fails if a Rust field is renamed without the JS.

## Edge cases

- First scan of `~/Desktop`, `~/Documents` or `~/Downloads` can raise a macOS privacy prompt. The scan waits; the sidebar shows the root head with `…`.
- A folder is deleted after the scan, then expanded: read fails, toast `Could not read <name>`, row stays as an empty folder until the next refresh.
- Case-insensitive volumes with two names that differ only by case: both listed.
- A huge flat folder (200,000 entries) reads fully (it must, to sort) in one step; the budget check happens between folders.
- Package bundles (`.app` and similar) are skipped to avoid scanning into application internals.

## Out of scope

Continuous FSEvents watching of folders (the focus re-scan is the stopgap; see the open question in step 8), `.gitignore` support (many people gitignore `.claude/`), `.mdx` and other extensions, file operations (DR-40).
