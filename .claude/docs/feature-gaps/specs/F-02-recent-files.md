# F-02 — Sidebar "Recent Files" Section

*Persisted recently-opened files that are NOT currently open as tabs, rendered as a distinct, display-only navigation section below the folder tree in the 220px sidebar.*

> **✅ Visual/IA SIGNED OFF (product owner, 2026-06-22) — Option A.** Decision: a persistent `RECENT` section sits **below the folder tree(s) and above the always-pinned search row**, with **a muted relative timestamp** ("3m ago") per row. Not collapsible; not empty-state-only. Rationale: matches the step-5 IA and gives a recency cue for re-finding the file the AI just touched. Row layout per DR-83 (filename `flex:1; min-width:0; ellipsis` + timestamp `flex:0 0 auto; nowrap`). This blockquote records the sign-off that satisfied F-02's original deferral condition; implementation is unblocked.

---

## URD Tie-Back

**Primary:** URD-04 — Multi-file Navigation ("The basic contract of 'return exactly where I left off' is unmet"); URD-08 — Minimal UI Chrome ("UI chrome earns its presence").

**Secondary:** URD-05 — View-First Simplicity (re-surface files without re-invoking the picker); URD-07 — File Trust & Portability (never auto-open files; display-only, zero side-effects).

---

## WAAD / WAN Grounding

**Cluster D2 — Multi-file navigation fragmentation:**
- WAN-043: File switching requires re-opening picker to reach a file already reviewed once.
- WAN-044: Complex navigation structures (vault trees) add cognitive overhead without helping the user re-find yesterday's file.
- WAN-049: No equivalent of a browser's "recently visited" — users must reconstruct history manually.

**WAN mapping:**
| WAN | Cluster | Relevance to F-02 |
|-----|---------|-------------------|
| WAN-043 | D2 | Closed file disappears entirely; must re-invoke picker |
| WAN-044 | D2 | Over-hierarchical nav is worse than a flat recent list |
| WAN-049 | D2 | No MRU display means file history is inaccessible between sessions |
| WAN-007 | H1 | Only show recent list when it provides value — not always |
| WAN-015 | H3 | Minimum-not-zero: Recent section is one of those minimum items |

---

## Problem Statement

**Developer / AI Content Reviewer** needs a way to see and return to recently reviewed files without invoking the picker, **because** closing a tab removes a file from view entirely — even though it is stored in `tv-recent-files` — forcing a full picker round-trip that contradicts the "return exactly where I left off" contract of multi-file work (URD-04), and imposing the 23-minute focus-recovery cost of any tool switch (URD-01).

**Role most affected:** AI Content Reviewer processing 5–20 files per session (flow model: "12 files reviewed in 15 minutes") — they close tabs as they finish each file and need to re-open the last one if they realise they missed something.

**HMW:** How might we surface recently-opened files in the sidebar so they are re-openable in one click, without adding persistent chrome or auto-opening files the user explicitly closed?

---

## Decision: What to Build / What Not to Build

### What to build

A **"Recent" section** inside the sidebar's scrollable list area (`div.tv-side-scroll`), positioned **below folder trees (F-19) and ungrouped open-tab groups**, and **above the pinned search row** at the bottom. The section renders the closed subset of `tv-recent-files` — paths that exist in the MRU but are NOT currently open as tabs — as clickable, display-only rows, each showing the filename and a muted relative timestamp.

The section header ("Recent") matches the existing `.tv-side-label` treatment: 10.5 px, uppercase, muted, identical to the "Open" group label already rendered. Individual rows match `.tv-tree-row.recent` which already has CSS in `tv-app.css:1591`. The clock icon (`TV_ICONS.clock`) already used in the existing stub is retained.

**Cap:** Display at most **8 entries** in the sidebar (not 10; see rationale below). The MRU list itself remains capped at 20 (DR-52). Eight is the empirically tight max for a 220 px sidebar without requiring the section to scroll within the section — the sidebar's own `overflow-y:auto` scrolling handles overflow at the panel level (consistent with F-19's approach: section scroll is inside each folder section, not the entire sidebar).

### What NOT to build — explicit exclusions

| Excluded | Reason |
|----------|--------|
| Auto-open recent files on launch | DR-49/DR-52: session restore owns launch; Recent is MRU display only, never auto-open |
| File operations on recent rows (rename, delete, move, pin) | URD-07 ("the app is a lens, not a database"), URD-08 (no file-manager chrome) — display and navigate only |
| A "Clear Recent" affordance in the sidebar | No WAN/URD supports it in the sidebar; this can be a palette command (`Clear recent files`) in a future iteration; not in scope here |
| Showing files that are currently open as tabs | De-duplicate against `state.tabs[].nativePath` — a file that is already a tab must not appear in Recent (DR-34 / DR-52 extension) |
| Showing non-native-path tabs in Recent | Browser-drop or untitled tabs have no `nativePath` and are never saved to `tv-recent-files`; no change needed |
| Relative timestamps shown for every recent row | Timestamp is optional context, not required navigation. Show it only when `ts > 0` (i.e., entry has a real timestamp). Legacy/migrated entries show no timestamp (matches existing `relativeTime()` behaviour) |
| Collapsible Recent section header | Adding collapse/expand to the Recent header is premature chrome (Cluster H). If the sidebar is too short, the user scrolls the panel — same as folder sections. Revisit only if user research surfaces it. |
| Toast + path-removal on missing-file click | The shipped `.catch` path calls `openErrorTab()` (F-06 recovery card). Diverging from this to a toast + silent removal would make Recent the only open path with different failure UX — inconsistent and unjustified. |

### Sidebar layout priority (reconciliation with F-19 and search)

The step-5 IA specifies: **folders (top) · Recent (middle) · search (pinned bottom)**. After F-19 was scoped (DR-33–DR-41), the layout is:

```
┌─────────────────────────────┐  ← .tv-side-header ("Files" label + « button)
│  [F-19] Folder sections     │  ← .tv-side-scroll (overflow-y: auto, flex: 1)
│    ▾ my-ai-session/         │
│      file-a.md              │
│      file-b.md              │
│  ─────────────────────────  │  ← .tv-side-divider
│  [legacy open-tab groups]   │  ← tabs NOT covered by an open folder
│  ─────────────────────────  │  ← .tv-side-divider (only if closedRecent.length > 0)
│  RECENT                     │  ← .tv-side-label.tv-side-recent-label
│    clock  notes.md  3m ago  │  ← .tv-tree-row.recent (data-recent-path)
│    clock  spec.md   1h ago  │
│    …up to 8 rows…           │
└─────────────────────────────┘  ← .tv-side-scroll ends
┌─────────────────────────────┐
│  [Find in document  ⌘F]     │  ← .tv-search (pinned, not in scroll area)
└─────────────────────────────┘
```

**Short-window behaviour (sidebar height < ~300 px):** The sidebar panel scrolls internally (`.tv-side-scroll` `overflow-y:auto`). The Recent section is not collapsed or hidden — it scrolls off and is reachable by scrolling. The search row is pinned outside `.tv-side-scroll` and is always visible regardless of window height.

**Retraction of the `waad-grounded-requirements.md` Part 2 "collapse Recent if sidebar <400px" note:** That note specified sidebar height, not window height — it was not a typo. The retraction is justified on two grounds: (1) the sidebar's own `overflow-y:auto` scroll already handles the case — the Recent section remains reachable by scrolling without any additional collapse state; (2) an auto-collapse keyed on a dynamic height threshold requires a `ResizeObserver` on the sidebar, new boolean state, and extra render logic — complexity that violates URD-08's "minimum-not-zero" principle when the scroll-and-reach behavior is already adequate. The 8-entry cap further limits the height impact. If post-launch research reveals that Recent being off-screen by default in typical window sizes causes discoverability failures, a collapsible header can be added as a targeted follow-on (with its own WAN evidence).

**De-duplication contract:** The Recent section rebuilds on every `render()` call. At rebuild time, construct `openNativePaths` as the set of `state.tabs[].nativePath` values; filter `loadRecentPaths()` to exclude any path in that set; then slice to 8. This means: when the user closes a tab, the next `render()` adds that file to Recent automatically. When the user opens a file from Recent, the tab appears and the file disappears from Recent automatically.

---

## DR Table

*Continues from DR-80 (Tab Context Menu, Part 5 of waad-grounded-requirements.md).*

| DR | Requirement | URD | MoSCoW |
|----|-------------|-----|--------|
| DR-81 | The sidebar renders a "Recent" section below all open-file groups (folder trees and ungrouped tabs) and above the pinned search row. The section appears only when `closedRecent.length > 0`; it is absent (no divider, no label) when there are no closed recent files to show. | URD-04, URD-08 | Must |
| DR-82 | The Recent section shows at most 8 rows: the 8 most-recently-opened native paths from `tv-recent-files` that are NOT currently open as tabs (de-duplicated against `state.tabs[].nativePath`). | URD-04, URD-08 | Must |
| DR-83 | Each Recent row displays the file basename, a clock icon (`TV_ICONS.clock`), and — when `entry.ts > 0` — a muted relative-time label via `relativeTime(entry.ts)` trailing the row. The row is flex-layout: filename span has `min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; flex:1` so it truncates before the timestamp is clipped; the timestamp span is `flex:0 0 auto`. Row uses `.tv-tree-row.recent` and `data-recent-path` for click delegation. Note: `relativeTime()` returns `"just now"` for entries less than 60 s old (ts within the last minute). | URD-04, URD-08 | Must |
| DR-84 | Clicking a Recent row opens the file as a new tab (`read_md_file` → `TVNative.openInto(doc)`). After `openInto()` resolves, the click handler looks up the stored `scrollTop` from `loadRecentEntries()` for that path, finds the created tab via `state.tabs.find(t => t.nativePath === rpath)`, and sets `tab.scrollTop` directly — the next `render()` call applies it at `newScroll.scrollTop = activeTab.scrollTop \|\| 0` (~tv-app.js:1857). There is no `tv:rendered` event and `openInto()` / `openDoc()` accept no `nativeScrollTop` parameter. If the file is not accessible on disk, the existing `.catch` path calls `openErrorTab(name, rpath, kind)` — consistent with every other open path in the codebase (F-06/F-16 recovery card). The error tab is NOT replaced by a toast + path-removal. | URD-04, URD-05 | Must |
| DR-85 | Recent rows are navigation-only: no hover affordances for rename/delete/move/pin, no right-click file operations, no drag. The only interaction is click-to-open. | URD-07, URD-08 | Must |
| DR-86 | The Recent section rebuilds on every `render()` call: adding a new tab removes it from Recent; closing a tab adds it to Recent — both happen automatically without any explicit sync step. | URD-04 | Must |
| DR-87 | Recent rows must be reachable via the sidebar keyboard-cursor (`sbKbd`). **Blocked by / coordinated with U-17.** The current `sbKbd` cursor queries only `[role="option"][data-sidebar-tab]` (tv-app.js:1965) — Recent rows have neither attribute and are therefore invisible to arrow-key navigation. The resolution: (a) Recent rows emit `role="option"` + `data-sidebar-item="recent:<path>"` instead of (or in addition to) `data-recent-path`; (b) U-17 widens the `sbKbd` selector to also match `[role="option"][data-sidebar-item]`; (c) the `Enter`/`Space` handler in the keyboard router routes `data-sidebar-item` prefixed `"recent:"` to the recent-open flow (not `activateTab`). DR-87 is a **Should** on this spec; its implementation is gated on U-17 landing. Until U-17 ships, Recent rows remain click-only. | URD-08 | Should |
| DR-88 | Clicking a Recent row that is already being loaded (i.e., `read_md_file` is in flight) does not open a duplicate tab. De-duplication follows the existing `tabKey` / `openDoc` dedup logic. | URD-04 | Must |
| DR-89 | The Recent section's "RECENT" label uses `.tv-side-label.tv-side-recent-label` (10.5 px, uppercase, muted — already defined in `tv-app.css:1583`). The divider above it uses `.tv-side-divider`. No additional visual treatment is needed beyond what is already in the CSS. | URD-08 | Must |
| DR-90 | `saveRecentPath()` is called (and already is called) whenever a native file is opened. No new persistence calls are needed for F-02; the Recent section derives entirely from the existing `tv-recent-files` localStorage key populated by DR-47/DR-52. | URD-07 | Must (constraint) |

---

## Acceptance Criteria

These are measurable and mock-testable without running the Tauri build (browser-mode accessible).

**AC-1 — Appears only when needed:**
Open 0 tabs, localStorage `tv-recent-files` is empty → no "RECENT" label, no divider, no recent rows in the sidebar. Verified: sidebar HTML contains no `.tv-side-recent-label` element.

**AC-2 — Correct content after close:**
Open files A, B, C as tabs. `tv-recent-files` contains paths for A, B, C. Close tab B via ⌘W → `render()` fires → sidebar "Recent" section appears with exactly 1 row for B's filename. Close tabs A and C → Recent shows 3 rows (C, B, A in MRU order — most recently opened first, not most recently closed).

**AC-3 — De-duplication against open tabs:**
A, B, C are open tabs and all are in `tv-recent-files`. Sidebar has zero Recent rows (all are open). Close B → 1 Recent row. Reopen B from Recent row → B becomes a tab; sidebar Recent has 0 rows again.

**AC-4 — Cap at 8:**
Populate `tv-recent-files` with 15 paths, all closed (no open tabs). Sidebar shows exactly 8 rows, in MRU order (index 0–7).

**AC-5 — Relative timestamp:**
`tv-recent-files` entry with `ts = Date.now() - 3*60*1000` (3 minutes ago) → row shows "3m ago". Entry with `ts = Date.now() - 30*1000` (30 seconds ago) → row shows "just now" (`relativeTime()` returns "just now" for any entry < 60 s old). Entry with `ts = 0` (legacy/migrated) → no timestamp shown, row renders cleanly with just the filename and clock icon.

**AC-6 — Click opens file and restores scroll:**
`tv-recent-files` entry for path `/a/b/notes.md` with stored `scrollTop: 847`. User clicks the Recent row. `read_md_file` resolves → `TVNative.openInto(doc)` is called → the click handler calls `loadRecentEntries()`, finds the entry for `/a/b/notes.md`, sets `tab.scrollTop = 847` on the created tab. The subsequent `render()` applies `newScroll.scrollTop = 847`. The viewer renders at 847 px offset (±5 px). The file disappears from Recent and appears as an active tab.

**AC-7 — File not found (error tab, not toast):**
Recent row for a path that no longer exists on disk → click → `read_md_file` rejects → `.catch` calls `openErrorTab(name, rpath, 'not-found')` → an error tab opens showing the F-06 recovery card ("File moved or deleted" + "Locate file…" button). No toast, no path removal from `tv-recent-files`. This is consistent with `openErrorTab` behavior for every other open path in the codebase.

**AC-8 — Layout order:**
When F-19 folder sections are present AND Recent is non-empty: folder sections render first (top of `.tv-side-scroll`), then ungrouped open-tab groups (if any), then `.tv-side-divider`, then "RECENT" label, then recent rows. Search row remains outside `.tv-side-scroll` at the bottom, always visible. Verified by reading emitted HTML.

**AC-9 — No file ops:**
Right-click a Recent row → no context menu appears (or the WebView default menu if present, but no custom menu with rename/delete). No drag handle, no pin button visible at any hover/focus state.

**AC-10 — Session restore does not auto-open recents:**
Simulate cold launch (no `tv-session`): empty state is shown, NOT files from `tv-recent-files`. The Recent section IS visible in the sidebar (if non-empty). Consistent with DR-49.

---

## Out of Scope

- **Auto-opening** any recent file on launch (DR-49/DR-52 — session restore owns launch).
- **"Clear Recent" button** in the sidebar — palette command in a future iteration only.
- **File operations** (rename/delete/move/pin) on Recent rows — display + navigate only (URD-07).
- **Collapsible Recent header** — not warranted by WAN data at this stage.
- **Cross-session MRU beyond 20 entries** — cap is DR-52, unchanged.
- **Non-native-path entries in Recent** — browser-drop / untitled tabs never reach `tv-recent-files`.
- **Separate "Recent" palette group** — the palette already has its own Recent group fed by `tv-recent-files` (tv-palette.js); that is a separate surface and is not changed here.
- **Hover tooltip with full path** — the full path is available on the empty-state `.tv-recent-path` row already; sidebar rows are tight (220 px) and show basename only. Full path as a native `title` attribute on the row (`title={path}`) is a Should-level detail for the implementer to include but is not a Must for this spec.

---

## Implementation Notes

*(Based on code actually read. Files: `app/js/tv-app.js`, `app/css/tv-app.css`, `app/index.html`.)*

### State of play

The skeleton is already present. `buildSidebar()` (`tv-app.js:1216`) already:
- Loads `closedRecent` via `loadRecentPaths()` filtered against `openNativePaths` and sliced to 10 (line 1251–1253).
- Renders `.tv-side-divider` + `.tv-side-label.tv-side-recent-label` + `.tv-tree-row.recent[data-recent-path]` rows (lines 1337–1349).
- Uses `TV_ICONS.clock` per row.

CSS is fully present: `.tv-side-recent-label` (tv-app.css:1583) and `.tv-tree-row.recent` (tv-app.css:1591) are already defined and passing contrast ratios.

The click handler for `data-recent-path` exists in `wireEvents()` — a click on a `.tv-tree-row[data-recent-path]` opens the file via the native bridge.

### Delta to implement DR-81 through DR-90

**1. Change the cap from 10 to 8** (`tv-app.js:1252`):
```
.slice(0, 8)   // was: .slice(0, 10)
```

**2. Add relative timestamp to each row** (`tv-app.js:1340–1348`):
The current Recent loop iterates over `p` (a plain string path) from `loadRecentPaths()`. Switch the data source to `loadRecentEntries()` so the loop variable becomes `entry: {path, ts, scrollTop}`. Use `entry.path` wherever `p` was used (HTML attribute, de-duplication lookup, `data-recent-path`). Build a `tsLabel` via `relativeTime(entry.ts)` and append it as `<span class="tv-recent-ts">` after the filename span. CSS needed: `.tv-tree-row.recent .tv-recent-ts` — `flex: 0 0 auto; font-size: 10.5px; color: var(--tv-text-muted); opacity: .7; white-space: nowrap; padding-left: 4px;` — the no-shrink, nowrap rules ensure the timestamp is never clipped. The filename span needs `min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; flex: 1;` to absorb truncation instead.

**3. Scroll restoration on open** (`tv-app.js` click handler for `data-recent-path`, ~line 2864):
After `TVNative.openInto(doc)` resolves, add:
```js
var entries = loadRecentEntries();
var entry = null;
for (var i = 0; i < entries.length; i++) {
  if (entries[i].path === rpath) { entry = entries[i]; break; }
}
if (entry && entry.scrollTop) {
  var created = state.tabs.find(function (t) { return t.nativePath === rpath; });
  if (created) created.scrollTop = entry.scrollTop;
}
```
No new event needed. The next `render()` call applies `newScroll.scrollTop = activeTab.scrollTop || 0` at ~tv-app.js:1857. There is no `tv:rendered` event. `openInto()` and `openDoc()` have no `nativeScrollTop` parameter — the tab must be mutated directly after it is created.

**4. File-not-found handling** (`tv-app.js` click handler, ~line 2881):
The `.catch` path at line 2881–2887 **already** calls `openErrorTab(rpath.split('/').pop() || rpath, rpath, kind)`. This is the correct behavior — consistent with every other open path in the codebase. No changes needed here. Do NOT add toast + path-removal; the shipped F-06 recovery card is the intended UX for missing files from any open path.

**5. No changes needed to:**
- `saveRecentPath()` — already correct, called on every native open.
- `loadRecentPaths()` / `loadRecentEntries()` — already correct.
- The `.catch` / `openErrorTab` path (~line 2881) — already ships the correct F-06 recovery card; no changes.
- The divider and section-label HTML in `buildSidebar()` — already present and conditional on `closedRecent.length`.
- Session restore (DR-49/DR-52) — Recent section is display-only; no change to launch sequence.
- The pinned search row (`.tv-search`) — already outside `.tv-side-scroll`; layout is correct.

### Files to touch

| File | Function / Line | Change |
|------|----------------|--------|
| `app/js/tv-app.js` | `buildSidebar()` ~line 1252 | Change slice cap from 10 → 8; switch `closedRecent` source to `loadRecentEntries()` (loop var `entry` instead of `p`) |
| `app/js/tv-app.js` | `buildSidebar()` ~line 1340 | Use `entry.path` / `entry.ts`; add `tv-recent-ts` span with `relativeTime(entry.ts)` guard |
| `app/js/tv-app.js` | `data-recent-path` click handler ~line 2864 | After `openInto()` resolves: look up `entry.scrollTop` via `loadRecentEntries()`, set `tab.scrollTop` on the created tab |
| `app/js/tv-app.js` | `data-recent-path` rows in `buildSidebar()` | Add `role="option"` + `data-sidebar-item="recent:<path>"` to each row (DR-87, coordinated with U-17) |
| `app/css/tv-app.css` | After `.tv-tree-row.recent .ic` (~line 1596) | Add `.tv-tree-row.recent .tv-recent-ts` rule (flex: 0 0 auto; nowrap; muted) |
| `app/css/tv-app.css` | `.tv-tree-row.recent > span:not([class])` or filename span rule | Add `min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; flex:1` for truncation |

No Rust/Tauri changes. No `index.html` changes. No new modules. No `_removeRecentPath` helper needed (error path uses `openErrorTab`, not path removal).

---

*Prepared via UxPipeline Step 3 method (URD → WAAD cluster → code verification → adversarial critique pass). Assigned DR-81–DR-90. All decisions traceable to a URD or a WAAD cluster.*
