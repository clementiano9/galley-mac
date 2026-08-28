# U-17 — Sidebar Keyboard Navigation / Accessibility

*WAAD-grounded requirements · build-ready spec · DR-107 – DR-115*

*Continues from DR-106 (reserved gap between U-14 and U-17). DR range for this spec: **DR-107 – DR-115**.*

---

## Title & Scope

Add full keyboard navigation and ARIA semantics to the Galley sidebar so that every file row, folder header, and Recent row reachable by mouse is equally reachable by keyboard. The implementation must honour the **WKWebView focus constraint** (see *Decision* below): no programmatic `element.focus()` calls on non-form elements. The sidebar already has `role="listbox"` / `role="option"` structure and an `sbKbd` cursor model in the codebase; this spec closes the remaining gaps: no keyboard entry point, folder-toggle (Left/Right) keys, Recent-row participation, folder-section rows from `buildFolderSection`, and formal Esc-to-content behaviour.

**Scope boundary:** keyboard nav for open-file rows, folder-tree file rows (DR-33–41 / F-19), and Recent rows (DR-87 / F-02). Out of scope: the pinned search box, the folder-context menu, the resizer handle, and any screen-reader live regions beyond `aria-activedescendant`.

---

## URD Tie-Back + WAN Grounding

| URD | Cluster / WANs | Relevance |
|-----|---------------|-----------|
| **URD-08 — Minimal UI Chrome** | H3 / WAN-015 | Keyboard nav is the power-user alternative to the mouse; without it the sidebar fails the "minimum-not-zero" rule — it has chrome (the sidebar itself) that is unreachable by a subset of users. |
| **URD-04 — Multi-file Navigation** | D2 / WAN-043, 049 | Switching between files in the sidebar is a primary multi-file navigation path; keyboard-only users are locked out of it entirely today. |
| **URD-05 — View-First Simplicity** | E1 / WAN-036, 038 | Forcing a keyboard user to reach for the mouse to navigate files contradicts the "get out of the way" principle. |

**Coverage gap context:** Step 2 explicitly flags *"Accessibility (screen reader support for rendered markdown)"* as a Coverage Gap. U-17 does not address the full rendered-markdown gap (that is screen-reader work for the content pane) but it closes the navigation gap — the sidebar is the primary wayfinding surface.

---

## Problem Statement

Developer, AI Content Reviewer, and Knowledge Worker roles can navigate the sidebar only by mouse today. Plain `<div>` folder-section rows in `buildFolderSection()` carry no ARIA roles; the existing `sbKbd` cursor only handles `[role="option"][data-sidebar-tab]` rows and so misses folder headers, subfolder rows, deep-bucket rows, and Recent rows. There is no defined keyboard entry point into the sidebar from the rest of the app — Tab stops skip it entirely. A keyboard-only user (or VoiceOver user) cannot discover, enter, or navigate the file list.

**HMW:** How might we make every sidebar row keyboard-navigable with a single entry gesture, without touching DOM focus in a way that breaks under macOS Full Keyboard Access = OFF?

---

## Decision: Widget Role, Cursor Model, and Entry Point

### 1. Widget role: keep `role="listbox"` + `role="option"`, extend to folder rows

The existing `#tv-sidebar-listbox` element already has `role="listbox" aria-orientation="vertical"`. Open-file rows already have `role="option"`. The spec widens the cursor to include folder-tree rows that today have no ARIA role:

- **`tv-folder-head`** (folder section header with collapse toggle) → `role="option"` + `data-sidebar-tab` sentinel OR a separate `data-sidebar-folder` attribute handled in the cursor. See DR-108.
- **`.tv-tree-row.subfolder`** (subfolder and deep-bucket toggle rows inside `buildFolderSection`) → `role="option"` similarly.
- **`.tv-tree-row.file` inside `buildFolderSection`** (folder-tree file rows, `data-tree-file-path`) → `role="option"` + cursor participation via a `data-sidebar-item` attribute that unifies both tab-keyed and path-keyed rows. See DR-108.
- **`.tv-tree-row.recent`** rows → already in the `buildSidebar()` HTML but today lack `role="option"` and `data-sidebar-tab`; add `data-sidebar-item` with value `recent:<path>` to bring them into the cursor query. See DR-109.

**Why not `role="tree"` / `role="treeitem"`?** The sidebar is a flat-ish two-level list with collapsible sections, not a deep recursive hierarchy. `role="listbox"` with `aria-orientation="vertical"` is simpler, already partially implemented, and matches what the palette uses. `role="tree"` would require `aria-level`, `aria-posinset`, `aria-setsize` on every row — correct but significantly more complex for marginal SR benefit at the one-level depth of F-19. Decision: **stay `listbox`**. Revisit if a true deep-tree feature lands.

### 2. Cursor model: `aria-activedescendant` + `.kbd-cursor` class — no DOM focus

**Critical constraint (WKWebView focus gotcha):** `element.focus()` on a `div[tabindex]` is a silent no-op when macOS Full Keyboard Access (`AppleKeyboardUIMode`) is 0 (the default for most users). The existing `sbKbd` model already implements the correct pattern:

- `sbKbd = { active: boolean, id: string | null }` — tracks whether sidebar keyboard mode is on and which row is highlighted.
- `renderSidebarCursor()` — applies `.kbd-cursor` outline class to the target row and sets `aria-activedescendant` on `#tv-sidebar-listbox` to the row's `id` attribute.
- A document-level `keydown` listener gated on `sbKbd.active` handles ArrowUp/Down/Enter/Space/Home/End — already implemented (tv-app.js ~3830–3910).

The gaps to close are: (a) no keyboard **entry point** (Tab or shortcut to set `sbKbd.active = true`), (b) ArrowLeft/Right for folder collapse/expand not implemented, (c) folder-tree rows and Recent rows not in the `[role="option"][data-sidebar-tab]` query used by the cursor.

### 3. Entry point

The sidebar has `tabindex="-1"` on `#tv-sidebar-listbox` (currently not Tab-reachable). The entry mechanism:

- **⌘B opens the sidebar AND activates the cursor** when pressed while the sidebar is closed. This is the natural "I want to use the sidebar" gesture. The seeding is **new work** — `toggleSidebar()` today only flips state and calls `render()` with no cursor seeding (see DR-113).
- **Tab key from the tab bar reaches the sidebar listbox** — `#tv-sidebar-listbox` gets `tabindex="0"` so the browser's natural Tab order lands on it. On focus (via Tab), set `sbKbd.active = true` and seed `sbKbd.id` to the first option (or restore the last-used id). This fires from the `focus` event on the listbox element.
- **Mouse click on any sidebar row** already sets `sbKbd.active = true` (existing behaviour, tv-app.js ~2844).

### 4. Esc returns focus to content

When `sbKbd.active` is true and Esc is pressed: clear `sbKbd.active`, remove `.kbd-cursor`, and — as the only `element.focus()` call permitted in this spec — focus the active tab's `.tv-scroll` element. **Prerequisite:** `.tv-scroll` is currently rendered as a plain `<div class="tv-scroll" data-scroll>` with no `tabindex` in `buildViewer()` (~tv-app.js lines 1465/1480/1518/1559), which makes `.focus()` on it a no-op (same WKWebView gotcha). `buildViewer()` must emit `.tv-scroll` with `tabindex="0"` before this call can work. DR-112 is therefore blocked on that one-line change in `buildViewer()`. If `.tv-scroll` is absent or focus silently fails, fall through without error.

### 5. Enter/Space, ArrowLeft/Right behaviour

| Key | On a **file row** | On a **folder-head / subfolder row** |
|-----|-------------------|--------------------------------------|
| `Enter` or `Space` | Open the file (call `activateTab` for tab-id rows, `read_md_file` for path-only rows) | Toggle collapse (call `toggleFolderCollapse(key)`) |
| `ArrowLeft` | No-op (already at file level) | Collapse the section (if expanded); if already collapsed, move cursor to parent folder-head |
| `ArrowRight` | No-op | Expand the section (if collapsed); if already expanded, move cursor to first child file row |
| `ArrowDown` / `ArrowUp` | Move cursor to next/prev option (existing behaviour, extended to all rows) | Same |
| `Home` / `End` | Jump to first/last option (existing) | Same |
| `Esc` | Deactivate cursor, return focus to `.tv-scroll` | Same |

### 6. Coexistence with existing mouse handlers

No mouse handlers change. The `sbKbd` flag is an additive layer — mouse and keyboard nav are completely independent and can interleave. A mouse click on a row always sets `sbKbd.active = true` and `sbKbd.id` to that row (existing), so the user can pick up arrow-key nav immediately after any click.

---

## DR Table

| DR | Requirement | URD | MoSCoW |
|----|-------------|-----|--------|
| DR-107 | `#tv-sidebar-listbox` carries `tabindex="0"` so the browser's natural Tab order can reach it. On `focus` event (raised by Tab or programmatic call), if `sbKbd.id` is null or no longer present in the DOM, seed it to the first `[data-sidebar-item]` option in the listbox; set `sbKbd.active = true`; call `renderSidebarCursor()`. The `focus` handler must not fire if the sidebar is collapsed (`state.sidebarOpen === false`). | URD-08, URD-04 | Must |
| DR-108 | Every row type in `buildFolderSection()` that is today a plain `<div>` without `role` receives `role="option"` and a `data-sidebar-item` attribute whose value is a stable string key: `file:<nativePath>` for file rows, `folder:<path>` for folder-head rows, `subfolder:<path>/<subName>` for subfolder-toggle rows, `deep:<path>/__deep` for deep-bucket toggle rows. Each such element also carries a unique DOM `id` (e.g. `sbitem-<hash>`) so `aria-activedescendant` can reference it. The widened selector `[role="option"][data-sidebar-tab],[role="option"][data-sidebar-item]` must be applied in **all three** places in `renderSidebarCursor()` that currently hard-code `[role="option"][data-sidebar-tab]`: (a) the clear-pass query (~line 1964), (b) the find-target loop (~line 1975), and (c) the clamp block (~lines 1981–1984). The clamp block additionally hard-codes `getAttribute('data-sidebar-tab')` to read the cursor id — this must be generalised to prefer `data-sidebar-item` and fall back to `data-sidebar-tab`: `el.getAttribute('data-sidebar-item') \|\| el.getAttribute('data-sidebar-tab')`. Without all three fixes, stale `.kbd-cursor` ghosts accumulate on folder rows and the cursor self-deactivates when it clamps to a folder row (returning `null` from the tab-only read). | URD-08, URD-04 | Must |
| DR-109 | Recent rows in `buildSidebar()` (`.tv-tree-row.recent`) receive `role="option"` and `data-sidebar-item="recent:<encodedPath>"`. They are included in the `renderSidebarCursor()` query and the arrow-key navigation sequence. `Enter`/`Space` on a Recent row triggers the same open action as a click (`read_md_file` → `TVNative.openInto`). | URD-04, URD-08 | Should |
| DR-110 | The existing document-level sidebar keydown handler (tv-app.js ~3830–3910) is extended: (a) `ArrowLeft` on a folder-head or subfolder-toggle row calls `toggleFolderCollapse(key)` to collapse it if expanded, or moves the cursor to the nearest ancestor folder-head if already collapsed. (b) `ArrowRight` on a folder-head or subfolder-toggle row calls `toggleFolderCollapse(key)` to expand if collapsed, or moves the cursor to the first child file row if already expanded. Both operations call `render()` (which rebuilds the sidebar) and then `renderSidebarCursor()` in a `requestAnimationFrame` callback to reapply the cursor to the new DOM. | URD-08, URD-04 | Should |
| DR-111 | The Enter/Space branch (~tv-app.js lines 3899–3909) today unconditionally calls `activateTab(sbKbd.id)`. When `sbKbd.id` holds a `data-sidebar-item` key (not a tab id), this silently misroutes — `activateTab` receives a non-tab string and does nothing useful. The branch must be rewritten as a dispatch: (1) read the cursor row's `data-sidebar-item` value if present; (2) if it starts with `folder:`, `subfolder:`, or `deep:`, call `toggleFolderCollapse(key)` and return; (3) if it starts with `file:`, call `read_md_file` for the stored path then `TVNative.openInto(doc)` and return; (4) if it starts with `recent:`, invoke the same open path as a Recent row click and return; (5) only if the row has `data-sidebar-tab` (not `data-sidebar-item`) fall through to the existing `activateTab(sbKbd.id)` call. After any action, `sbKbd.active` remains `true` so arrows keep working. | URD-04, URD-08 | Must |
| DR-112 | `Esc` while `sbKbd.active` is true: clear `sbKbd.active = false`; call `renderSidebarCursor()` to remove the highlight; then call `document.querySelector('.tv-scroll')?.focus()` to return keyboard attention to the content pane. This is the only `element.focus()` call in the sidebar keyboard system. The Esc case already fires (tv-app.js ~3841–3846) but does not restore focus to content; add the `.tv-scroll` focus call there. **Prerequisite for this to work:** `buildViewer()` must emit `.tv-scroll` with `tabindex="0"` — today it renders `<div class="tv-scroll" data-scroll>` with no `tabindex` (~lines 1465/1480/1518/1559), which makes `.focus()` a silent no-op in WKWebView (same gotcha as `div[role="option"]`). The one-line fix `tabindex="0"` on `.tv-scroll` in `buildViewer()` is a hard prerequisite; DR-112's Esc-to-content behaviour is blocked without it. | URD-08, URD-04 | Must |
| DR-113 | When `⌘B` opens the sidebar (sidebar was closed, `state.sidebarOpen` was false), after `render()` completes: set `sbKbd.active = true`, seed `sbKbd.id` to the first `[data-sidebar-item],[data-sidebar-tab]` option in `#tv-sidebar-listbox`, and call `renderSidebarCursor()` in a `requestAnimationFrame`. This gives a keyboard user immediate arrow-key navigation upon opening the sidebar via its primary shortcut. **This is new work:** `toggleSidebar()` (~tv-app.js lines 3584–3590) today only flips `state.sidebarOpen` and calls `render()` — no `sbKbd` seeding exists there. Add the seeding block inside the "if now open" branch of `toggleSidebar()`. | URD-08 | Should |
| DR-114 | All `[role="option"]` rows in the sidebar carry `aria-selected="false"` by default. The row whose `data-sidebar-tab` id matches `state.activeId` (open files) carries `aria-selected="true"`. Folder-head, subfolder-toggle, and Recent rows always carry `aria-selected="false"` (they have no persistent selection state). The listbox carries `aria-activedescendant` pointing to the cursor row when `sbKbd.active` is true; the attribute is removed when `sbKbd.active` is false. These rules are already partially implemented; this DR consolidates them to cover the new row types from DR-108–DR-109. | URD-08, WCAG 4.1.2 | Must |
| DR-115 | Under `prefers-reduced-motion: reduce`, the `.kbd-cursor` outline appears and disappears instantly (no CSS transition). The constraint applies to the full `.tv-tree-row` cascade: any transition that today exists on `.tv-tree-row` base styles (e.g. `background`, `border-color`, `color`) and that would visually animate the row gaining or losing the cursor must also be suppressed inside a `@media (prefers-reduced-motion: reduce)` override block. The existing `.tv-tree-row.kbd-cursor` rule itself uses only `outline` (no transition), so it is satisfied; this DR's scope is the cascade — all inherited or class-combined transitions on `.tv-tree-row` elements must be stripped to `transition: none` within the reduced-motion block. | URD-08 | Must (constraint) |

---

## Acceptance Criteria

### Entry and exit

- With a file open and the sidebar visible: press Tab from the tab bar → `#tv-sidebar-listbox` receives Tab focus; the first sidebar row shows a `.kbd-cursor` outline (2px `var(--tv-accent)`); VoiceOver announces the row label via `aria-activedescendant`.
- Press Esc while the sidebar cursor is active → cursor highlight disappears; keyboard attention moves to the content pane (VoiceOver focus returns to the document area, or `.tv-scroll` element).
- ⌘B with sidebar closed → sidebar opens AND first row gains cursor highlight within one animation frame. ⌘B again collapses sidebar; `sbKbd.active` is cleared.

### Arrow navigation (open-file rows)

- ArrowDown moves cursor to next option; ArrowUp moves to previous. Cursor wraps between Home (first) and End (last) using Home/End keys. Cursor does NOT wrap cyclically on ArrowDown at end or ArrowUp at beginning — it stops at boundary (existing behaviour).
- Cursor id survives a `render()` call: re-rendering the sidebar (e.g., a tab opens) does not lose the cursor position.

### Folder-tree rows (DR-108, DR-110)

- Open a folder with 3 subfolders; navigate to a subfolder-toggle row via arrows; press ArrowRight → subfolder expands, cursor moves to first child file row. Press ArrowLeft on that file row → no-op. Press ArrowLeft on the subfolder-toggle row → subfolder collapses. VoiceOver announces the chevron state via the row label.
- Navigate to a folder-head row; press Enter → section toggles (same as click on folder head). Navigate to a folder-tree file row; press Enter → file opens as a new tab.

### Recent rows (DR-109)

- Navigate past the last open-file row → ArrowDown continues into Recent rows. Press Enter on a Recent row → file opens as a new tab; the row disappears from Recent (it's now open); cursor moves to nearest remaining option.
- Recent rows have `.kbd-cursor` outline when highlighted.

### ARIA correctness

- The active tab's sidebar row has `aria-selected="true"`; all others have `aria-selected="false"`.
- When `sbKbd.active` is true, `#tv-sidebar-listbox[aria-activedescendant]` equals the `id` of the `.kbd-cursor` row.
- When `sbKbd.active` is false, `#tv-sidebar-listbox` has no `aria-activedescendant` attribute.
- VoiceOver (macOS, Full Keyboard Access OFF) can navigate the sidebar via arrows once the listbox has Tab focus — the `aria-activedescendant` model ensures VoiceOver reads the highlighted option without requiring DOM focus on the row elements.

### Non-regression

- Mouse click on any sidebar row continues to work identically — no regression to existing click handlers.
- ⌘K, ⌘F, ⌘⇧F, palette operations: opening any overlay still clears `sbKbd.active` (existing guard at tv-app.js ~3969–3971 covers ⌘K; same pattern must apply to all overlay-open paths).
- Scrolling the content pane via mouse wheel while `sbKbd.active` is true deactivates the cursor (existing `wheel` guard at tv-app.js ~2802–2807).
- The keyboard router does not intercept ArrowUp/Down when `sbKbd.active` is false, leaving browser-native scroll behaviour intact.

---

## Out of Scope

- Screen-reader support for the rendered markdown content pane (a separate, larger effort)
- Keyboard drag-reorder of sidebar items (no UXR evidence for this; U-14 tab-reorder is the parallel feature for the tab bar)
- `aria-level`, `aria-posinset`, `aria-setsize` on folder rows (deferred unless `role="tree"` is adopted in a future iteration)
- Search box keyboard handling (the pinned `.tv-search-box` at the bottom — it is a button, already `tabindex="0"`, and its Tab stop is separate from the listbox)
- Context-menu keyboard invocation on sidebar rows (e.g. Shift+F10 / Apps key) — deferred
- Sidebar resize handle keyboard control

---

## Implementation Notes

### What already exists (do not re-implement)

- `sbKbd = { active, id }` — cursor state object (tv-app.js line 289)
- `renderSidebarCursor()` — applies `.kbd-cursor` and `aria-activedescendant` (tv-app.js ~1959–1991). Currently queries only `[role="option"][data-sidebar-tab]` in three places (clear-pass ~1964, find-target loop ~1975, clamp ~1981–1984). All three must be widened (DR-108).
- Document-level keydown handler for ArrowDown/Up/Enter/Space/Home/End/Esc (tv-app.js ~3830–3910) — extend for ArrowLeft/Right (DR-110) and for path-keyed rows (DR-111).
- `.tv-tree-row.kbd-cursor` CSS rule with 2px accent outline (tv-app.css lines 301–305) — already correct, no changes needed.
- `sbKbd.active = true` on sidebar click (tv-app.js ~2844) and `sbKbd.active = false` on content click/wheel/overlay-open — all existing guards remain.

### What to add

1. **`buildFolderSection()` and `buildTreeFileRow()` (tv-app.js ~578–703):** Add `role="option"` and `data-sidebar-item="<key>"` and `id="sbitem-<hash>"` to: `tv-folder-head` divs, `.tv-tree-row.subfolder` divs, and `.tv-tree-row.file` rows that currently only have `data-tree-file-path`. The hash can be a short deterministic slug of the key string (replace `/` and `.` with `_`, truncate to 32 chars) — no crypto needed.

2. **`buildSidebar()` Recent rows (tv-app.js ~1340–1347):** Add `role="option"`, `data-sidebar-item="recent:<path>"`, and `id="sbitem-recent-<hash>"` to each `.tv-tree-row.recent` div.

3. **`#tv-sidebar-listbox` focus handler (wireEvents or `buildSidebar`):** Add a `focus` event listener to `#tv-sidebar-listbox` (delegated or direct) that seeds `sbKbd` on Tab-in (DR-107). Guard: only if `state.sidebarOpen`.

4. **`toggleSidebar()` (tv-app.js ~3584):** After `render()`, when the sidebar is now open, seed `sbKbd` to the first option (DR-113).

5. **`buildViewer()` prerequisite for DR-112 (tv-app.js ~1465/1480/1518/1559):** Add `tabindex="0"` to every `.tv-scroll` div emitted by `buildViewer()`. Without this, `.tv-scroll` has no `tabindex` and `.focus()` is a WKWebView no-op. This is a one-line (×4 call-sites) change that unblocks the Esc-to-content path.

6. **Esc handler (tv-app.js ~3841–3846):** After clearing `sbKbd.active` and calling `renderSidebarCursor()`, add `document.querySelector('.tv-scroll')?.focus()` (DR-112). This is the single permitted `element.focus()` call in this feature and depends on the `buildViewer()` tabindex fix above.

8. **ArrowLeft/Right in the sidebar keydown handler (tv-app.js ~3869):** Identify whether `sbKbd.id` refers to a folder-type row (`data-sidebar-item` starting with `folder:`, `subfolder:`, or `deep:`) or a file row, then call `toggleFolderCollapse(key)` or cursor-move accordingly (DR-110). `toggleFolderCollapse` calls `render()` internally; call `renderSidebarCursor()` in a `requestAnimationFrame` after it.

7. **Enter/Space dispatch (tv-app.js ~3899–3909):** The existing branch unconditionally calls `activateTab(sbKbd.id)`, silently misrouting any non-tab id. Replace with a full dispatch (DR-111): read the cursor row's `data-sidebar-item` value; if present, dispatch on prefix (`folder:`/`subfolder:`/`deep:` → `toggleFolderCollapse`, `file:` → `read_md_file` + `TVNative.openInto`, `recent:` → Recent open path); only fall through to `activateTab` if the row has `data-sidebar-tab` (not `data-sidebar-item`). Retrieve the cursor row element by querying `#tv-sidebar-listbox` for the element whose `data-sidebar-item` or `data-sidebar-tab` matches `sbKbd.id` — the same lookup pattern already used in `renderSidebarCursor()`.

### Guard list — keys the handler must NOT intercept when sidebar mode is inactive

`sbKbd.active === false` → all arrow/Enter/Space keys pass through (existing guard). Additionally, the handler already returns early when `input, textarea, [contenteditable]` have focus (implied by the existing `if (!sbKbd.active) return` gate). No changes needed to the guard logic; extending the active-row logic is sufficient.

---

## Visual Design Step Needed: NO

The cursor highlight (`.tv-tree-row.kbd-cursor` → 2px `var(--tv-accent)` outline, -2px offset, `var(--tv-radius-sm)`) already exists in `tv-app.css` lines 301–305 and is visually verified in the existing open-file rows. The new rows (folder-head, subfolder, Recent) share the same `.tv-tree-row` base class and will inherit the rule immediately. The only potential tweak is confirming the outline renders correctly on the taller `.tv-folder-head` element (which uses a slightly different height), but that is a one-line CSS verification, not a visual design exploration. No new color tokens, no new component states, no new layout work required.

---

*Prepared via UxPipeline Step 3 method (URD → WAAD cluster → code verification → adversarial critique pass). DR-107–DR-115 assigned. All decisions traceable to a URD or a WAAD cluster. WKWebView focus constraint honoured throughout. Adversarial review 2026-06-22: APPROVE-WITH-FIXES applied — DR-108 three-site selector fix, DR-111 dispatch-first rewrite, DR-112 + Decision §4 `.tv-scroll tabindex="0"` prerequisite, DR-113/Decision §3 new-work clarification, DR-115 full cascade scope.*
