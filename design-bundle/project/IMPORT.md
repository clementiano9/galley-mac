# Design import — claude.ai project "Tiny viewer"

Imported **2026-06-27** via the `DesignSync` tool (claude.ai login, design-system read scope).

- **Source project:** `Tiny viewer` (`PROJECT_TYPE_PROJECT`, owner Clement)
- **Project id:** `53b28f4b-645a-459d-983e-4e018a735b18`
- **URL:** https://claude.ai/design/p/53b28f4b-645a-459d-983e-4e018a735b18?file=tiny-viewer+Mockups.html

This refreshes the older **2026-06-07** snapshot in this folder, which predated the
edit-mode source-highlighter and the folder/"more files" design work.

## Pulled in this import (new since the 06-07 snapshot)

| File | Feeds | Notes |
|------|-------|-------|
| `tiny-viewer/tv-srchl.js` | ISS-004 | Markdown **source** highlighter for edit mode. `window.tvHighlightSource(src)` → array of per-line HTML; spans carry semantic classes (`sm-h`, `sm-bold`, `sm-code`, `sm-link`, `sm-str`, `sm-num`, `sm-key`, `sm-com`, `sm-task-done`, …). |
| `tiny-viewer/tv-srchl.css` | ISS-004 | Variant skins, all driven by `css/tv-tokens.css` semantic tokens. |
| `tiny-viewer More Files Options.html` | ISS-005 | Sidebar deep-file ("more files") treatments + the folder-nesting primitives. |

## Design decisions these encode (read before building ISS-004 / ISS-005)

- **"Ink+" = the `.srchl-inkcolor` variant** (variant **D · "INK + COLOR"** in `tv-srchl.css`):
  headings/body stay ink, colour is reserved for code (full token pass), inline code,
  links, and completed checks; the heading `#` mark gets a light accent tint. The
  other variants (`-ink`, `-semantic`, `-typo`) are alternatives, not the pick.
- **Folder nesting primitives** (from "More Files Options.html"): `.tv-folder-head` +
  `.tv-chev.open` (disclosure), `.tv-folder-body`, `.tv-tree-row.subfolder`, and
  `.tv-tree-row.nested` (indented child). Deep files (>1 level) flatten into a bucket;
  treatment **#1 (breadcrumb prefix)** is the chosen direction, treatment **#3
  (collapsible bucket)** the runner-up. NOTE: an explicit "close folder" button is not
  in these files — design it consistent with `.tv-folder-head` / the close affordances
  in `tiny-viewer Mockups.html`.
  **SUPERSEDED (folder-nesting fix):** recursive nesting is kept — subfolders are
  collapsible children at full depth (per-row depth-keyed guide rails), so the deep-file
  "More files" bucket is dropped; and close-folder now closes the folder's open files.
- `tv-srchl.css` consumes `--tv-syn-fn / -str / -num / -key / -comment`, `--tv-accent-text`,
  `--tv-code-bg`, `--tv-code-border`. Confirm those tokens exist in `app/css/tv-tokens.css`
  before wiring; add any missing ones.

---

# Second import — 2026-08-10 · "Sidebar hierarchy"

Pulled via `DesignSync` from the same project
(`?file=tiny-viewer+Sidebar+Hierarchy.html`).

| File | Feeds | Notes |
|------|-------|-------|
| `tiny-viewer Sidebar Hierarchy.html` | SBH-01/02/03 | Three sidebar defects, three independent fixes, plus a live demo of all three. |

The design system it links (`_ds/tiny-viewer-design-system-99677a1e-…/`) was read but
not mirrored: `styles.css` is an `@import` barrel and the five token files it pulls in
are already reproduced in `app/css/tv-tokens.css`. The one geometry the tokens do NOT
carry is the tree indent (PAD 8 / STEP 14 / GUTTER 16) — that lives in
`TVTree.treeIndent`, with the matching rail offsets in the SBH-01 CSS block.

## Design decisions these encode — ALL THREE IMPLEMENTED 2026-08-10

- **SBH-01 · Fix 1 — depth is a number.** A child of a folder at depth *d* is depth
  *d*+1, recursively, no floor and no first-level special case. Indent =
  `8 + depth*14`, and file rows add a 16px chevron gutter so a file's doc icon aligns
  under the folder icon at the same depth. One 1px guide rail per ANCESTOR level at
  `8 + i*14 + 5` (13px, 27px, 41px …). Built in `TVTree.treeIndent` +
  `buildTreeNodes` (already recursive); rails are a repeating gradient clipped to
  `--tv-depth * 14px`, not absolutely-positioned elements — inline `left`/`top` is
  dropped under the Tauri CSP. Row hover/active MUST use `background-color`, never the
  `background` shorthand, which would erase the rails.
- **SBH-02 · Fix 2 — one root per tree.** A folder mounts ONCE.
  (1) descendant of an open root → do not mount; expand ancestors, scroll into view,
  flash once, report *"X is already in Y"*; (2) ancestor of open roots → mount and fold
  those roots in as children; (3) unrelated → new root, most recent first;
  (4) **no breadcrumb affix on rows** — that path prefix only ever existed to
  disambiguate the flat "More files" bucket, which is gone. The decision is pure and
  lives in `TVTree.planFolderOpen` / `chainKeysTo`; `TV.registerFolder` executes it.
- **SBH-03 · Fix 3 — opening a folder opens NO tabs.** Mounting a folder is a
  *navigation* act, opening a document a *reading* act. `openFolder` / `reopenFolder`
  no longer fan files out into tabs. A single click on a tree file opens the ONE
  transient tab (italic); the next single click replaces it; double-clicking the file
  or its tab pins it, as does entering edit mode. Browsing thirty files costs one tab.

Covered by `node app/js/tv-sidebar-hierarchy.test.js` (64 assertions) and verified live
in the running app.

## In the project but NOT pulled (read directly on claude.ai if needed)

`tiny-viewer Syntax Review.html` (dark-mode **rendered code-block** palette study —
separate concern from edit-mode source highlighting; "Calm" is the marked pick),
`tiny-viewer Demo.html`, `tiny-viewer/tv-demo.jsx`, `tiny-viewer/design-canvas.jsx`,
and the `uploads/` UX docs.
