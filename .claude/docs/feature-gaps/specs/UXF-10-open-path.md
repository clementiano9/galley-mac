# UXF-10 — Open a file by typing its path

*Status: built 2026-10-12 · Priority: Should (sev 3) · Owner files: `app/js/tv-pathfind.js` (new), `app/js/tv-palette.js`, `app/js/tv-app.js`, `app/js/tv-native.js`, `app/index.html`, `tauri-app/src-tauri/src/lib.rs`, contracts*

## Why

Owner: "a way to open a file directly by entering its path … fuzzy autocomplete enough for it to match/suggest when the path is not fully complete but nearly there." Agents print paths; the Open panel needs a click per folder (step 8, iteration 3, D). URD-04, URD-05. Evidence WAN-108 to WAN-119.

## Decision

Path mode inside the ⌘K palette (D2). A query that starts with `/`, `~`, `./` or `../` lists folders and viewable files (the `is_md_name` set) of the typed path.

| Door | Detail |
|---|---|
| Type in ⌘K | `~/`, `/`, `./` (current file's folder), `../`. The zero-query placeholder says `· ~/ for a path` |
| ⌘L | Safari's Open Location key; ⇧⌘G (Finder's) is Find Previous. Opens ⌘K pre-filled with the current file's folder (else the first open folder, else `~`), plus `/`, **all selected**: typing `~` or `/` starts over, → keeps it |
| File ▸ Open Path… ⌘L | native menu item, same path (`menu:open-path`) |
| Palette command | `Open Path…`, kbd ⌘L, `native: true` (dimmed `Needs the desktop app` in the browser) |

## Matching (`TVPathFind`, pure)

1. `parse(q, {home, cwd})` → `{ base, segs, last, style }`. `~user` is not supported. `.` is skipped, `..` goes up.
2. Every complete segment is matched against the **folders** of each candidate folder; the best five (beam) go to the next level. An exact or case-only match at a level drops its fuzzy neighbours; a guess more than 500 below the best is dropped.
3. The last (partial) segment is matched against folders and files of every surviving candidate. Empty last segment lists the folder in natural order.
4. Segment tiers, best first: exact 1000 · case only 980 · prefix ~900 · every query word starts a name word, in order ~760 · initials (`tv` → tiny-viewer) 700 · substring ~560 · ordered letters, gaps ≤ 3 ~400 · typos (optimal string alignment ≤ 1 from 3 letters, ≤ 2 from 7, against the name or its start; the first letter must agree or be swapped with the second) 300/240/180.
5. Hidden names show only when the typed segment starts with `.`.
6. **Known files fallback.** Fewer than three live rows and nothing pending: tabs, recents and open-folder files are matched with the typed segments in order and folders skipped (−40 each), section `Known files` (max 5).

## Palette behaviour

| Key | Folder row | File row |
|---|---|---|
| ⇥ | write `path/` into the field, list it | write the full path |
| ↵ | same as ⇥ (`Go into`) | open the file (pinned tab; already open → activate) |
| ⇧↵ | open the folder in the sidebar (`reopenFolder`) | open |
| ⌘↵ | reveal in Finder | reveal in Finder |

The field keeps the user's style: `~/…` stays `~/…`, an absolute path stays absolute. ⇧↵ never creates a file in path mode. Footer: `⇥ Complete · ↵ Go into/Open · ⇧↵ Open in Sidebar (folders) · ⌘↵ Reveal · esc Clear`. Section title `In ~/folder` when every row shares one folder, else `Closest matches`. Hints: `Reading ~/x…` while a folder is being read; `Galley cannot read ~/x.`; `No folder or markdown file matches “q”.`; browser build `Opening a file by its path needs the desktop app.`

## Native

`list_dir(path)` → `{ path, entries: [{ name, dir }], truncated }`. Expands a leading `~`; follows symlinks; skips package bundles and non-viewable files; natural sort; cap 5,000. Names only (DR-06). Async (`spawn_blocking`). The palette caches listings for one palette session (cleared on close) and refreshes the list when a read lands.

## Acceptance criteria

1. **PASS/FAIL** ⌘L with a file open: palette opens in path mode, field = that file's folder with `~` and a trailing `/`, all text selected, list = that folder's folders and markdown files.
2. **PASS/FAIL** Typing `~/` replaces the selection and lists the home folder; no hidden entries.
3. **PASS/FAIL** `~/ai-proj/tiny-v/REA` (real folders `~/ai-projects/tiny-viewer`) arms `README.md`; ↵ opens it as a tab with `nativePath` set.
4. **PASS/FAIL** One typo in a folder (`tiny-veiwer`) and in a file (`REDAME`) still finds the file.
5. **PASS/FAIL** ⇥ on a folder row writes `…/folder/` and lists it; ⇥ on a file row writes the full path; focus stays in the field; no focus escapes the palette.
6. **PASS/FAIL** ↵ on a folder goes into it; ⇧↵ on a folder opens it in the sidebar; ⌘↵ reveals in Finder.
7. **PASS/FAIL** `./` and `../` resolve against the active file's folder.
8. **PASS/FAIL** A folder that cannot be read shows `Galley cannot read …`; a path with no match shows the no-match hint; neither throws.
9. **PASS/FAIL** File ▸ Open Path… exists with ⌘L and opens the same mode.
10. **PASS/FAIL** Browser build: `Open Path…` row dimmed `Needs the desktop app`; a `~/` query shows the desktop-app hint; no console error.
11. **PASS/FAIL** Plain queries, `#` outline, Appearance pages and ⇧↵ Create behave as before.
12. **PASS/FAIL** Shortcut overlay lists `⌘L Open path` (22 rows) and fits.
13. **PASS/FAIL** Nothing is written to disk (DR-06).
14. **PASS/FAIL** 5 levels × 5,000 entries resolve in under 150 ms (node test).

## Out of scope

Indexing the disk, non-markdown files, creating a file at a typed path, `~user`, a transient preview of the armed file.
