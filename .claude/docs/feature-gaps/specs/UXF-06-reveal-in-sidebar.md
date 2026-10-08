# UXF-06 — Reveal the open file in the sidebar

*Status: specified 2026-10-06 · Priority: Should (sev 2) · **Depends on UXF-02** (node lookup, lazy folders) **and UXF-03** (one scroller, sticky heads) · Owner files: `app/js/tv-app.js`, `app/js/tv-tree.js`, `app/js/tv-native.js`, `app/js/tv-palette.js`, `app/css/tv-app.css`, `tauri-app/src-tauri/src/lib.rs`, `tauri-app/NATIVE-CONTRACT.md`*

## Why

Owner: an option to "Reveal file in sidebar": expand the ancestors, scroll the file into view, highlight it. Today the reader finds the open file by eye in a tree that can hold hundreds of rows (heuristic H7, H-10). Fits URD-04: "return to where I left off" includes knowing where the file lives.

## Tie-back

URD-04, URD-05. DR-34 (open-file cue), SBH-02 (one root per tree), U-17 (cursor). Name follows macOS convention (Xcode: "Reveal in Project Navigator", `⇧⌘J`).

## Decision

One action, four doors, one cue.

| Door | Detail |
|---|---|
| Shortcut | **`⇧⌘J`**. Free in this app (checked against the keyboard router, palette and Rust menu). Native accelerator, so macOS consumes it before the web view. **Rule: it is an explicit command and always runs**, wherever focus is (palette, find field, edit textarea). The JS handler exists only for the browser build, where reveal is a no-op, so it needs no focus guard |
| Command palette | `Reveal in Sidebar`, kbd `⇧⌘J`, keywords `locate show tree navigator find file`; `need: 'file'` (dimmed `Save the file first` for a tab with no path) and `native: true` (dimmed `Needs the desktop app`) |
| Tab context menu | `Reveal in Sidebar`, first item, above `Reveal in Finder`; disabled like its neighbours when the tab has no `nativePath` (DR-75 pattern) |
| Menu bar | **View ▸ Reveal in Sidebar**, directly under `Toggle Sidebar`. View is where the sidebar lives; File ▸ Reveal in Finder keeps its own meaning |

Rejected: auto-reveal on every tab switch (moves the tree under the reader on each switch, fights JANK-01); click on the window title (hidden affordance).

## Behaviour

`TV.revealInSidebar(tabId?)` → `Promise<boolean>`. Default tab = the active one.

1. **No path** (new file, launcher tab, error tab, browser build): do nothing but say why with a toast, `Save the file first to reveal it`. Palette and tab menu never get here (they are disabled).
2. **Open the sidebar** if it is closed. Counts as a user toggle (`sidebarUserToggled = true`). Does not seed the keyboard cursor.
3. **Find the root.** Use the open root that contains the file (`TVTree.isDescendantPath`).
   - **File outside every open folder:** mount its parent folder as a new root through `TVNative.reopenFolder(parentDir)`. SBH-02 rules apply (if the new folder contains open roots, they fold in as children). Toast `Opened <folder> in the sidebar`. Then continue with step 4. Reason: the user asked to see where the file lives, and "show its siblings" is the point.
4. **Find the file node** with `TVTree.findFileNode(tree, path)`.
   - Found: expand the root head and every ancestor folder (`expandAncestorsTo` with `TVTree.chainKeysTo`), render once (inside `TV.batch`).
   - Not found, an ancestor folder is `scanned: false`: load that folder (UXF-02), retry.
   - Not found, the file's folder has `filesHidden > 0`: load that folder with `uncapped: true`, retry.
   - Not found otherwise (file created after the snapshot): `refreshFolder(root)` once, retry.
   - The file's folder is hidden by the dot-folder policy (UXF-07, an extra such as `.husky`): show it for the session (path-keyed, not persisted), retry, and announce `Showing <name>`.
   - Still not found: toast `<name> is not in the folder tree`, return `false`.
5. **Show it.** `row.scrollIntoView({ block: 'center' })` in `.tv-side-scroll` (centre, so a sticky head never covers it). Add `.tv-reveal` for 1.2 s. Announce `Revealed <name> in <folder>` through `TV.announce`.
6. Return `true`.

## The cue (not the old flash)

`.tv-flash` (SBH-02) cannot show on this row: `.tv-tree-row.active` sets `background-color … !important`, and an `!important` declaration beats an animation. The revealed row is always the active row. Use an inset ring that fades, set through `box-shadow` (not guarded by `!important`):

```css
.tv-tree-row.tv-reveal { animation: tv-sbreveal 1.2s ease-out; }
@keyframes tv-sbreveal {
  0%, 40% { box-shadow: inset 0 0 0 2px var(--tv-accent); }
  100%    { box-shadow: inset 0 0 0 2px transparent; }
}
@media (prefers-reduced-motion: reduce) {
  .tv-tree-row.tv-reveal { animation: none; box-shadow: inset 0 0 0 2px var(--tv-accent); }
}
```

It is a ring, not a left border or under-rule (house rule). It carries no information alone: the row is also scrolled into view, the live region speaks, and the active tint remains. JS removes the class after 1.2 s in both motion modes.

## Touch points

| File | Where | Change |
|---|---|---|
| `app/js/tv-tree.js` | new | `findFileNode(tree, path)` (returns the folder chain and file), pure |
| `app/js/tv-app.js` | next to `revealSidebarRow` ~960; `TV` API ~7103 | `revealInSidebar`; export `TV.revealInSidebar`; generalise `revealSidebarRow(itemKey, message, { block, cls })` |
| `app/js/tv-app.js` | keyboard router ~6467 | `⇧⌘J` (`e.code === 'KeyJ'`, meta + shift, no alt), no focus guard; calls `TV.revealInSidebar()` (which no-ops without the native bridge) |
| `app/js/tv-app.js` | `openTabCtx` ~1867-1884; click handler ~1946 | new first item `data-ctx-action="reveal-sidebar"` |
| `app/js/tv-app.js` | `SHORTCUTS` ~1633 | add `{ keys: ['⇧⌘J'], action: 'Reveal in sidebar' }` |
| `app/js/tv-palette.js` | `CMDS` ~407 and the action switch ~1057 | new command; action calls `TV.revealInSidebar()` |
| `app/js/tv-native.js` | next to `menu:reveal-in-finder` ~1024 | `listen('menu:reveal-in-sidebar', …)` → `TV.revealInSidebar()` |
| `tauri-app/src-tauri/src/lib.rs` | View menu ~1189-1195; event match ~1430 | `MenuItem::with_id(app, "menu:reveal-in-sidebar", "Reveal in Sidebar", true, Some("CmdOrCtrl+Shift+J"))` after Toggle Sidebar; add the id to the emit arm |
| `tauri-app/NATIVE-CONTRACT.md` | events list | document `menu:reveal-in-sidebar` |
| `app/CONTRACT.md` | `TV` API | document `TV.revealInSidebar` |
| `app/css/tv-app.css` | near 448-464 | `.tv-reveal` rule |
| `waad-grounded-requirements.md` | DR-17 amendment note | raise the shortcut-overlay row cap from 20 to **22** (the list is at exactly 20; this adds a 21st) and record it, as C-18 did |
| tests | `tv-palette.test.js`, `tv-shell-polish.test.js:274` (pins "20 rows, exactly at the cap"), new `tv-reveal.test.js` | updated and new |

## Acceptance criteria

Fixture: root R with 3 levels, 80 files, default expansion from UXF-03 (deep branches collapsed). A second root S. A file F4 at depth 4 inside a collapsed branch of R.

1. **PASS/FAIL** Open F4 from the palette (tree stays collapsed in that branch), then press `⇧⌘J`: ancestors of F4 are expanded, F4's row is inside the sidebar's visible area, and its centre is within 25% of the vertical centre of the scroller.
2. **PASS/FAIL** The row gets `.tv-reveal` for 1.0-1.5 s and then loses it. The live region reads `Revealed F4.md in R`.
3. **PASS/FAIL** Sidebar closed, then reveal: the sidebar opens, the row is revealed, no `.kbd-cursor` is painted.
4. **PASS/FAIL** Root head collapsed, then reveal: head and ancestors open.
5. **PASS/FAIL** A file in a folder the scan marked `…` (unscanned): the folder loads and the file is revealed.
6. **PASS/FAIL** A file beyond the 500-file cap of its folder: the folder is re-read uncapped and the file is revealed.
7. **PASS/FAIL** A file created on disk after the scan: one re-scan, then revealed.
8. **PASS/FAIL** A file outside every open folder (`~/Downloads/x.md`): its parent folder mounts as a new root, the toast reads `Opened Downloads in the sidebar`, the file is revealed. Open roots inside that parent fold in (SBH-02).
9. **PASS/FAIL** A new unsaved tab: `⇧⌘J` shows the toast `Save the file first to reveal it`; nothing else changes. Palette row is dimmed with `Save the file first`; tab-menu item is disabled.
10. **PASS/FAIL** Entry points: palette row, tab context menu item, View ▸ Reveal in Sidebar (native menu), `⇧⌘J` all run the same path and give the same result.
11. **PASS/FAIL** Revealed row sits below any sticky root head (the head does not cover it) for roots R and S.
12. **PASS/FAIL** With `prefers-reduced-motion: reduce`: the ring shows static for the same 1.2 s with no animation, then clears.
13. **PASS/FAIL** The ring is visible on the active row in light and dark (screenshot), and is not a left border or under-rule.
14. **PASS/FAIL** `⇧⌘J` always runs the reveal, including with the palette open, with the find field focused and in edit mode. The palette and the cross-tab search overlay close (a `render()` side effect, as for every sidebar action). The in-document find bar (⌘F) **stays open with its query and match index intact** (UF-06: a render that changes no document content must preserve find state); an emptied field is a defect. The letter `J` is not inserted into any field; the tab keeps its mode, its `dirty` flag and its unsaved text (compare `tab.source` before and after).
15. **PASS/FAIL** Repeating `⇧⌘J` ten times does not change the sidebar scroll position after the first call and never opens a second root for the same folder.
16. **PASS/FAIL** The shortcut overlay lists `⇧⌘J Reveal in sidebar` (21 rows) and still fits its layout.
17. **PASS/FAIL** The browser build: palette row dimmed `Needs the desktop app`; `⇧⌘J` is a no-op; no console error.
18. **PASS/FAIL** `cargo build` passes; the menu item appears under Toggle Sidebar with `⇧⌘J`.

## Edge cases

- Several open tabs from the same folder: reveal only moves the sidebar; it never changes the active tab.
- The transient preview tab (italic) reveals like any other.
- A parent such as `~` or `/` mounts as a root. The scan is bounded (UXF-02), so it is safe but large; the deny-list keeps `.git` and `node_modules` out.
- A file name that appears in two roots: the lookup uses the full path, never the name.
- The mount in step 3 is the one case where reveal changes the sidebar structure. It is announced by a toast so it is never silent.

## Out of scope

Auto-follow of the active tab, reveal for Recent rows, a button in the title bar, reveal in a Finder window (that is `Reveal in Finder`).
