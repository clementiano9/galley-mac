# UXF-03 — Understand everything under a folder at a glance

*Status: specified 2026-10-06 · Priority: Must (sev 4) · Depends on UXF-02 for node shape (the scroller fix in rule 1 can ship alone, today) · Owner files: `app/js/tv-tree.js`, `app/js/tv-app.js`, `app/css/tv-app.css`, `app/css/tv-tokens.css`*

## Why

Owner: "When I open a folder it should not be complicated to understand everything under the folder."

Live evidence (headless build, this repo's markdown tree, 54 rows, 12 folders):

**Today:** everything is expanded; files come before folders; the body is clipped to 18 of 54 rows by an inner scroller; 8 of 12 folders sit below the fold with no cue.

**Target** (counts are illustrative; the rails and indent are the existing SBH-01 geometry):

```
┌ FILES ──────────────────────────┐
│ ▾ tiny-viewer             54 │  ← sticky head, total count
│   ▸ .claude               31 │  ← folders first, natural order, counts
│   ▸ app                    6 │
│   ▾ docs                  14 │  ← expanded: fits the row budget
│     ▸ notes                4 │
│       README.md              │  ← files after folders
│   ▸ tauri-app              3 │
│     CLAUDE.md                │
│     README.md                │
└─────────────────────────────────┘  one scroller; the whole shape is visible
```

Defects found:

| # | Defect | Evidence |
|---|---|---|
| C1 | `.tv-folder-body.capped` (DR-41) is a second scroller with an invisible scrollbar. At 54 rows it shows 540 px of 1,620 px | measured; the likely cause of "folders still not showing" |
| C2 | Everything expands by default, so shape is learned only by scrolling | H-04 |
| C3 | Files are listed before folders and are unsorted | `walk()` in `tv-tree.js:181-191`; Rust order |
| C4 | A collapsed folder says nothing about its size | no count |
| C5 | Several open roots: a long root pushes the next one off screen, which is why DR-41 existed | — |
| C6 | No expand-all / collapse-all | — |
| C7 | At depth 4–5 file names are middle-truncated to a few letters at 224 px (`U..-export.md`) | screenshot |

SBH-01 rails, indent step (14 px), chevron gutter and typography are **kept**. This spec does not touch them.

## Tie-back

URD-05 (view-first simplicity), URD-04 (multi-file navigation), URD-08 (minimal chrome). **Supersedes DR-41** (50-row cap with internal scroll). Amends DR-33/DR-37 intent: the tree stays recursive; its default state changes. Extends U-17 (keyboard navigation) with expand-all.

## Behaviour

1. **One scroller.** Remove `.capped` and the `max-height: 60vh` body. `.tv-side-scroll` is the only vertical scroller in the sidebar. Orientation across several roots comes from sticky heads (rule 6), not from nested scrolling.
2. **Order.** At every level: folders first, then files; each in natural, case-insensitive order (UXF-02 rule). Applies to `walk()` in `buildTreeNodes`.
3. **Smart default expansion**, computed when a folder is mounted (and for new folders after a re-scan; never for a key the user already set):
   - The root is open.
   - Level by level (all folders of level k before any of level k+1), in sorted order, expand a folder only if the visible row count after expanding stays at or below the **budget** (root head not counted).
   - **Budget = `min(30, max(8, floor((H − 24 − 30) / 30)))`**, where `H` = `.tv-side-scroll.clientHeight` (24 = its top and bottom padding, 30 = the root head, 30 = one row). If the sidebar is closed at mount, `H = window.innerHeight − 140`. At 1440 × 900 (`H` ≈ 792) the budget is 24. Reason: a fixed 30 ignores the window and pushed the third top-level folder below the fold; sized to the scroller, the whole default tree is on screen at first paint by construction. Computed **once at mount**, stored on the tree (`tree._budget`), and reused for folders that appear after a re-scan. It is not recomputed on resize, ⌘B or drag, so the tree never rearranges itself while the user reads.
   - The root's own children (level 0) always show, even when they alone exceed the budget; only expansion of folders is limited.
   - A folder that does not fit stays collapsed, and so do its descendants.
   - **Always expanded:** every ancestor folder of a file that is open in a tab (the user must never open a folder and not see their own file).
   Written once as explicit `true` entries in `state.folderCollapsed`; the existing "undefined = expanded" rule is unchanged.
4. **Counts.** Each folder row, and the root head, shows the number of markdown files in its subtree (`mdCount` from UXF-02), right-aligned, muted, tabular numerals (`.tv-tree-count`, 11 px). An unscanned folder shows `…`. The count stays visible when collapsed or expanded. It is text, not a badge.
5. **Expand / collapse all.**
   - ⌥-click on a folder row or its chevron toggles that folder and **all its descendants** (to the opposite of the clicked folder's state).
   - ⌥→ / ⌥← on the keyboard cursor row do the same (extends U-17).
   - Folder context menu (root head and every subfolder row; subfolders did not have one) gets `Expand All` and `Collapse All`. UXF-07 adds `Always Show "<name>"` and `Stop Always Showing "<name>"` to the same menu. The root menu keeps `Reveal in Finder`, `Refresh`, `Close Folder`. Subfolder menu adds `Reveal in Finder`.
   - Palette: `Collapse All Folders` (needs an open folder).
6. **Sticky root heads.** Wrap each root in `<section class="tv-folder-section" role="group" aria-label="<name>">` containing the head and the body. `.tv-folder-head` is `position: sticky` with an opaque `--tv-bg-sidebar` fill, pinned at the scroll box top (see the `top` value in the CSS below). A head sticks while its own section is on screen and is pushed off by the next section's head. No separator line (house rule: no under-rule). Add `scroll-padding-top: 34px` to `.tv-side-scroll` so the keyboard cursor and reveal never park a row under a pinned head.
7. **Width.** Default sidebar width 224 → **264 px** (`--tv-sidebar-w` in `tv-tokens.css:28`, the CSS fallback at `tv-app.css:296`, and the JS default at `tv-app.js:246`). A width the user dragged and saved (`tv-sidebar-w`) is untouched. Reason: five levels of the 14 px step leave about 110 px for a name at 224.
8. **Unchanged:** selection = tint + semibold, no accent bars; transient preview tab (SBH-03); `Show N more files` per folder (UXF-02); JANK-01 scroll preservation of `.tv-side-scroll`.
9. **Opening a folder shows the sidebar.** Any explicit folder open (⌘⇧O, a Recent folder, the palette, the empty-state button, a dropped folder, and the parent mount in UXF-06) sets `state.sidebarOpen = true`, even if the user hid the sidebar earlier in the session, and sets `sidebarUserToggled = true` so the responsive default cannot close it again on the next resize. Reason: SBH-03 opens no tabs, so the tree is the only visible result of opening a folder; a closed sidebar makes the action look like it did nothing, and it is exactly the "make the folder easy to understand" moment. A window narrower than 1,440 px no longer matters. Not applied to silent paths: the focus re-scan, lazy folder loads, session restore. Pointer-style open: no keyboard cursor is seeded (UXF-05 rule).

## CSS

```css
/* DR-41 superseded: no nested scroller */
.tv-folder-body { overflow: visible; max-height: none; }          /* delete .capped rules, tv-app.css:2379-2382 */
.tv-folder-section { display: block; }
.tv-folder-head { position: sticky; top: calc(-1 * var(--tv-s3)); z-index: 1; background-color: var(--tv-bg-sidebar); }  /* no !important: keeps the .tv-flash animation visible */
.tv-folder-head:hover {                                            /* tv-app.css:2341 today: translucent shorthand */
  background-color: var(--tv-bg-sidebar) !important;               /* opaque base ... */
  background-image: linear-gradient(var(--tv-bg-hover), var(--tv-bg-hover)); /* ... hover tint on top */
}
.tv-side-scroll { scroll-padding-top: 34px; }
.tv-tree-count {
  margin-left: auto; padding-left: 8px; flex: 0 0 auto;
  font-size: 11px; font-variant-numeric: tabular-nums;
  color: var(--tv-text-muted) !important;
}
```

Notes. `--tv-bg-hover` is translucent (`rgba(0,0,0,.045)` / `rgba(255,255,255,.06)`), so a hovered sticky head would let scrolling rows show through; the layered hover above keeps the fill opaque. The scroller has `--tv-s3` (12 px) top padding. Measured in headless Chrome with two 40-row roots: `top: 0` pins the head 12 px below the scroll box top (rows show in the gap); `top: calc(-1 * var(--tv-s3))` pins it at 0. Re-check in WKWebView (criterion 9).
## Touch points

| File | Where | Change |
|---|---|---|
| `app/js/tv-tree.js` | `buildTreeNodes` ~158; new `defaultCollapsed`, `subtreeKeys` | order, counts, default expansion, subtree keys (pure, tested in node) |
| `app/js/tv-app.js` | `buildFolderSection` ~1449-1552 | section wrapper, count span, drop `capped` |
| `app/js/tv-app.js` | `registerFolder` ~992; click handler for `[data-folder-toggle]` | apply `defaultCollapsed`; ⌥-click subtree toggle |
| `app/js/tv-app.js` | `captureSidebarScroll` ~1316-1360 | drop the `[data-folder-body]` branch (keep `.tv-side-scroll`) |
| `app/js/tv-app.js` | `openFolderCtx` ~1756; contextmenu delegate ~4886 | add items; give subfolder rows `data-folder-ctx-target` |
| `app/js/tv-app.js` | sidebar key handler (U-17) | ⌥→ / ⌥← |
| `app/js/tv-palette.js` | `CMDS` ~407 | `Collapse All Folders` |
| `app/css/tv-app.css` | 2379-2382; ~2341; ~470; ~361 | as above |
| `app/css/tv-tokens.css` | 28 | `--tv-sidebar-w: 264px` |
| tests | `tv-sidebar-jank.test.js` (capped-body cases), `tv-sidebar-hierarchy.test.js`, `tv-tree-nesting.test.js`, `tv-css-polish.test.js` | remove capped-body assertions; add tests for ordering, defaults, counts, subtree toggle |

## Acceptance criteria

Fixture A: this repo's markdown tree (54 rows when fully expanded; 12 folders). Fixture B: two roots, 40 rows each. Window 1440 × 900.

1. **PASS/FAIL** A: no element in the sidebar has `overflow-y: auto|scroll` except `.tv-side-scroll`; `.tv-folder-body` has no `capped` class and no `max-height`.
2. **PASS/FAIL** A on first paint at 1440 × 900: at most `min(30, floor((H − 54) / 30))` rows below the root head (24 when `H` is 792); the bottom of the last default-visible tree row is at or above the bottom of `.tv-side-scroll`; every top-level folder row (`.claude`, `app`, `tauri-app`) is fully visible without scrolling. Repeat at 1440 × 700 (`H` ≈ 592): budget is 17 and the same visibility holds. Resizing the window afterwards does not change which folders are expanded.
3. **PASS/FAIL** A: at every level folders precede files; names are natural-sorted.
4. **PASS/FAIL** A: each collapsed folder row shows a count equal to the number of markdown files under it (compare with a filesystem count); the root shows 54.
5. **PASS/FAIL** A with a tab open on a file at depth 4 inside a branch that would default to collapsed: that file's ancestors are expanded and the row is visible after mount.
6. **PASS/FAIL** ⌥-click on a collapsed folder with 3 levels below: all descendants open. ⌥-click again: all close. Plain click affects one folder only.
7. **PASS/FAIL** keyboard: cursor on a folder, ⌥→ expands the subtree, ⌥← collapses it.
8. **PASS/FAIL** context menu on a subfolder shows `Expand All`, `Collapse All`, `Reveal in Finder`; on the root head also `Refresh` and `Close Folder`. Both Expand/Collapse items work.
9. **PASS/FAIL** B: scroll the sidebar so root 1's body is half off screen: root 1's head is pinned at the top (offset 0 ± 1 px). Scroll on: root 2's head replaces it. Heads have an opaque fill in light and dark; hover and keyboard cursor do not make them transparent.
10. **PASS/FAIL** the keyboard cursor moved with ↑/↓ across a section boundary never ends under a pinned head (row top ≥ 34 px).
11. **PASS/FAIL** selection: click a file row in a 100-row tree three times in different places; the sidebar scroll offset does not change and no row jumps (JANK-01/02 regression).
12. **PASS/FAIL** clean profile: sidebar is 264 ± 1 px wide; drag to 300 px, reload: 300 px kept; no stored width: 264.
13. **PASS/FAIL** at 264 px, a file at depth 4 with a 20-character name shows at least 14 characters before the middle ellipsis.
14. **PASS/FAIL** selected row is tinted and semibold, with no left border or under-rule; folder rows have no accent bars. (Screenshot check, light and dark.)
15. **PASS/FAIL** `prefers-reduced-motion: reduce`: no new animation exists; chevron transition is still disabled.
16. **PASS/FAIL** `aria`: each section is `role="group"` with a label; options remain `role="option"` inside the listbox; DR-108 cursor still reaches every row.
17. **PASS/FAIL** `tv-tree`, sidebar, jank and css-polish suites updated and green.
18. **PASS/FAIL** Window 1100 × 800 (below 1,440 px, sidebar closed by default), empty state: open a folder (⌘⇧O or the button): the sidebar opens and shows the tree; `sidebarUserToggled` is `true`.
19. **PASS/FAIL** Hide the sidebar with the button, then open a different folder: the sidebar opens. A focus re-scan and a session restore do not open a hidden sidebar.
20. **PASS/FAIL** Opening by mouse leaves no `.kbd-cursor` in the sidebar.

## Edge cases

- A root of 3,000 files in one folder: first paint is the 500-file cap from UXF-02 plus a `Show N more files` row; the row budget does not hide the files of the root (it limits folders expanded, not files listed).
- Re-scan after focus (UXF-02): new folders follow the defaults; folders the user opened or closed keep their state.
- Folder renamed on disk: old key disappears; stale entries in `folderCollapsed` are harmless.
- Open tab outside every open folder: still shown in the legacy "Open" group below the tree. Label stays as is.
- Sticky head covers part of a folder row on `scrollIntoView({block: 'nearest'})` from other code: `scroll-padding-top` handles it.

## Out of scope

Two-pane folders/files layout, virtualised rows (revisit above about 1,000 visible rows), drag and drop, file operations (DR-40), changing the SBH rails or indent step.
