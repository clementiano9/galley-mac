# U-14 / F-20 — Tab Drag-to-Reorder

*WAAD-grounded requirements · build-ready spec · DR-91 – DR-98*

---

## Title & Scope

**Feature:** Drag a `.tv-tab` element within `.tv-tab-strip` to reorder it. On successful drop, splice `state.tabs` to the new order, update `activeId` if the dragged tab was active, persist the new order into the session model (`tv-session` via `saveSession()`), and re-render.

**Exclusions from this scope:** cross-window tab dragging; sidebar row reorder; drag-to-detach; keyboard-only shortcut as a *full parity* replacement (a lightweight `Move Tab Left / Right` palette command is specified as a Should).

---

## URD Tie-back + WAN Grounding

| URD | Passage | WAAD cluster |
|-----|---------|--------------|
| **URD-04** (Multi-file Navigation) | "The basic contract of 'return to where I left off' is unmet. … file-switching friction is the number-one workflow complaint." The *sequence model* at step-2 §D shows a user working through 8 AI-session files in a deliberate order — the tab strip represents that cognitive ordering. Losing the ability to place tabs in a chosen order is losing place. | **Cluster D** "File switching loses your place" (D2: multi-file navigation fragmentation — WAN-043, 044, 049) |
| **URD-08** (Minimal UI Chrome) | "The optimal design hides controls until invoked." Drag affordance is an *on-demand* gesture — no persistent chrome; the draggable cursor/visual only appears during the act. | **Cluster H** "UI chrome should be earned, not imposed" (H3: minimum viable chrome principle — WAN-015) |
| **DR-09** | "Must support 10+ simultaneously open files with <50ms tab-switch time." With 10+ tabs in an overflow-scrolling strip (`.tv-tab-strip` has `overflow-x: auto`), the user's only spatial tool is tab order. Reordering is the direct complement of DR-09's 10+-tab mandate. | Step-3 problem-definition |
| **DR-47–DR-56** (U-13 session model) | The session persists `{nativePath, scrollTop}` per tab in *order* (DR-47: "ordered array"). A drag-reorder that changes `state.tabs` order without writing it to `tv-session` silently discards the new order on next relaunch — violating the "un-pausing, not restarting" contract. | U-13 spec (waad-grounded-requirements.md Part 2 §6) |

**WAN direct tie:** WAN-043 ("navigating many files requires clicking through folders again"), WAN-049 ("position in multi-file context lost on switch"), WAN-015 (minimum chrome research); Cluster D2 multi-file navigation fragmentation.

---

## Problem Statement + HMW

**Problem statement:** All work roles need to arrange open tabs into a meaningful reading order because with 10+ AI-session files in the tab strip (DR-09), the only spatial organization tool is tab position — and there is no way to reorder once tabs are opened, forcing users to close and reopen files in the desired sequence (URD-04, Cluster D2, WAN-043/049).

**HMW:** How might we let a user move any tab to any position in the strip in a single direct-manipulation gesture, with zero persistent chrome, that survives both the current session and a relaunch?

---

## Decision

### What to build

**Pointer-event drag-and-drop within `.tv-tab-strip`, with HTML5 Drag API as the mechanism, implemented via event delegation on `.tv-tabbar`.**

The HTML5 Drag API (`dragstart` / `dragover` / `drop` / `dragend`) is the correct choice over raw `pointerdown`/`pointermove` for this element:

1. **WKWebView compatibility:** HTML5 drag runs natively in WebKit/WKWebView without needing `setPointerCapture`. The Tauri WKWebView on macOS supports it for same-document intra-element reordering. Raw pointer capture on a `<div>` inside a `position:relative` strip that also contains the Tauri title-bar drag region is fragile (the drag region intercepts `pointerdown` at the Tauri layer, not the WebView layer — `data-tauri-drag-region` is on `.tv-titlebar`, NOT `.tv-tabbar`, so no collision there, but pointer capture interacts with Tauri's native drag-region listener in non-deterministic ways per WKWebView versions).

2. **Native file drag collision guard:** The existing Tauri file-drop path (`tauri://drag-drop`, wired in `tv-native.js:482`) fires via a Rust-level OS event — it is completely disjoint from the HTML5 drag pipeline. `dragstart` is only raised by the browser for DOM elements with `draggable="true"`; an OS-level Finder drag never triggers it. The `'Files'` type guard belongs only on `dragover`/`drop` (where the browser *does* receive a synthetic drag event as the cursor enters the WebView), not on `dragstart` (see DR-96).

3. **Why not pointer events for this feature:** `pointermove` would require manual hit-testing, scroll-adjust math, and a ghost element — all costs that HTML5 drag handles for free. The copy-ghost the browser produces is acceptable; we override it with a custom ghost clone (DR-93) to suppress the semi-transparent copy behaviour that looks wrong in a tab strip context.

### What not to build (and why)

| Rejected option | Reason |
|-----------------|--------|
| Pointer-event drag (raw) | Fragile with `data-tauri-drag-region` in the same chrome layer; no free ghost; requires manual scroll-while-drag math |
| Cross-window tab detach | Not in URD evidence; significant Tauri IPC complexity; out of scope for a "Could" gap |
| Persistent reorder handle (↕ icon on each tab) | Violates URD-08 / Cluster H — earned chrome only; every existing tab-bar pattern in Bear/browsers uses direct drag, not a handle |
| Drag-to-sidebar | No evidence; sidebar has its own ordering semantics (folder tree, then recents) |

### Drag affordance philosophy vs URD-08

URD-08 demands that chrome earns its presence. A drag affordance that *is always visible* (e.g., grip dots, a reorder icon) would add permanent chrome for an infrequent action — the overconfiguration trap (WAN-046, Cluster E). The correct model is **`cursor: grab` on `.tv-tab` hover** (already deferred to a CSS-only token, zero DOM cost) + the standard macOS tab-drag expectation from browsers and Bear. No affordance icon is added to the tab at rest; the reorder affordance is discovered via attempted drag or via the `?` shortcut overlay (DR-23 already lists all gestures, and the palette `Move Tab Left / Move Tab Right` commands surface it). This sits exactly at "minimum-not-zero" (URD-08, WAN-015).

---

## DR Table

| DR | Requirement | URD | MoSCoW |
|----|-------------|-----|--------|
| DR-91 | Each `.tv-tab` element within `.tv-tab-strip` carries `draggable="true"`. The attribute is set in `buildTabbar()` on every tab, regardless of active or dirty state. | URD-04, URD-08 | Must |
| DR-92 | On `dragstart` on a `.tv-tab`: store the dragged tab's `data-tab-id` in `event.dataTransfer` with type `text/plain`; set `event.dataTransfer.effectAllowed = 'move'`; add a `.tv-tab--dragging` class to the source element (opacity 0.4, `will-change: transform`). | URD-04 | Must |
| DR-93 | On `dragstart`, replace the browser default ghost with a custom ghost: clone the dragged `.tv-tab` element, append it off-screen (`position:absolute; top:-9999px`), call `event.dataTransfer.setDragImage(clone, 0, 0)`, and remove the clone after a 0ms timeout. The ghost reflects the tab's actual visual including bolt/dot indicators. | URD-08 | Must |
| DR-94 | On `dragover` over any `.tv-tab` that is *not* the dragged tab: compute the insertion slot by comparing `event.clientX` to the drag-target tab's horizontal midpoint — if `clientX < midpoint` the indicator is placed *before* the target, else *after*. Set `event.preventDefault()` (to allow drop). Render a `.tv-drop-indicator` — a 2px `var(--tv-accent)` vertical bar — at the computed insertion boundary. Only one indicator exists at a time; previous one is removed before the new one is placed. | URD-04, URD-08 | Must |
| DR-95 | On `drop` on `.tv-tab-strip` or any `.tv-tab` within it: read the dragged tab id from `dataTransfer.getData('text/plain')`; compute the final insertion index (same midpoint logic as DR-94); splice `state.tabs` to move the dragged tab to that index; remove `.tv-tab--dragging` and `.tv-drop-indicator`; call `render()` and then `saveSession()`. If the dragged tab was `state.activeId`, it remains active after reorder. | URD-04 | Must |
| DR-96 | Guard against Finder-drag collision in `dragover` and `drop` only: if `event.dataTransfer.types` includes `'Files'`, do NOT call `preventDefault()` on `dragover` and do NOT run any reorder logic in `drop`, allowing Tauri's native `tauri://drag-drop` listener to handle the file open. No `'Files'` check is needed in `dragstart` — `dragstart` fires only on `draggable="true"` DOM elements, never for OS-level Finder drags, so `types` will never contain `'Files'` there. | URD-07, URD-04 | Must |
| DR-97 | On `dragend` (fired on the source tab regardless of where drop lands): always clean up `.tv-tab--dragging` class and all `.tv-drop-indicator` elements from the strip, whether the drop was accepted or cancelled. No state mutation on a cancelled drag. | URD-04 | Must |
| DR-98 | *Should* — Add `Move Tab Left` and `Move Tab Right` palette commands (`⌘K → "Move Tab Left"` / `"Move Tab Right"`) that splice the active tab one position in `state.tabs`, then call `render()` + `TV.saveSession()`. These are the keyboard-accessible reorder path. They are listed in the `?` overlay as flat rows (the overlay is a flat two-column list with no group-header support — no "Tab" group is added). Under `prefers-reduced-motion: reduce`, the `.tv-drop-indicator` appears and disappears without CSS transition (instant class-swap only). | URD-04, URD-08 | Should |

---

## Acceptance Criteria

**AC-1 (basic reorder):** With 4 tabs open, drag tab 1 to position 4 — `state.tabs` order updates, the drag source tab appears at index 3, render completes within one frame, no console errors.

**AC-2 (active-tab tracking):** Drag the currently-active tab to a new position — `state.activeId` is unchanged, and the tab remains visually active at its new position (connected-tab styling, no accent bar).

**AC-3 (session persist):** Reorder 3 tabs, quit the app, relaunch — tabs restore in the reordered sequence (DR-47 `tv-session` array reflects the post-drag order). Session restore is verified by reading `localStorage.getItem('tv-session')` immediately after drop: the `order` of `nativePath` entries must match `state.tabs` order post-splice.

**AC-4 (drop indicator):** While dragging over a non-source tab, exactly one `.tv-drop-indicator` is visible at the computed insertion boundary. Dragging past each tab boundary moves the indicator. On `dragend` (including ESC-cancel), no indicator is present in the DOM.

**AC-5 (Finder drag not broken):** With live-file drag active (dragging a `.md` file from Finder onto the app window), the `dragover` and `drop` handlers for tab reorder do NOT intercept the event (`types` includes `'Files'` → reorder logic skips) and the file opens normally via the Tauri `tauri://drag-drop` path.

**AC-6 (dirty tab):** Dragging a dirty tab (unsaved edits, `tv-dot` indicator) reorders it without any confirm dialog, does not clear `tab.dirty`, and the `tv-dot` is present on the tab at its new position.

**AC-7 (scroll-while-drag):** With 10+ tabs causing `.tv-tab-strip` to overflow, dragging a tab toward the right edge auto-scrolls the strip. This is a browser-native behavior of `overflow-x: auto` + HTML5 drag — no custom implementation needed. Verify: 12 tabs, drag tab 1 toward tab 12 — the strip scrolls without JS intervention.

**AC-8 (reduced-motion):** Under `prefers-reduced-motion: reduce`, `.tv-drop-indicator` appears and disappears without `transition`; `.tv-tab--dragging` applies opacity change without animation. Drag reorder still functions end-to-end.

**AC-9 (palette commands, Should):** `⌘K → "move tab"` surfaces `Move Tab Left` and `Move Tab Right`. Selecting `Move Tab Left` on tab 3 of 4 → tab moves to index 2, `state.tabs` updated, `TV.saveSession()` called. At index 0, `Move Tab Left` is inert (no-op, no error). `?` overlay lists both commands as flat rows (no group header).

---

## Out of Scope

- Cross-window tab detach / tear-off
- Drag a tab out of the strip to close it
- Sidebar file-row reorder
- Reorder persistence across *multiple* named sessions (this spec handles `tv-session` — the single last-session model only)
- Touch-based drag (non-macOS platforms deferred)
- Animate tab positions during drag with FLIP animations (acceptable future enhancement; CSS `transition: transform` on `.tv-tab` would conflict with the `will-change: transform` set during drag — defer to post-MVP)
- Accessibility parity for screen readers beyond the palette commands in DR-98 (full `aria-grabbed` / live-region announcement deferred; the palette commands satisfy WCAG 2.1.1 minimum)

---

## Implementation Notes

### Files and functions to touch

**`app/js/tv-app.js`**

- `buildTabbar()` (line 475): add `draggable="true"` to each `.tv-tab` div in the `tabs.map()` loop. No other attribute changes needed.
- `wireEvents(tvEl)` (line 2774): add four delegated handlers on `tvEl.querySelector('.tv-tabbar')` (or delegate directly on `tvEl` with target checks):
  - `dragstart` → `_onTabDragStart(e)`
  - `dragover` → `_onTabDragOver(e)` (must call `e.preventDefault()` conditionally, see DR-96)
  - `drop` → `_onTabDrop(e)`
  - `dragend` → `_onTabDragEnd(e)` (cleanup only)
- Add three module-level drag-state variables (scoped inside the IIFE, above `wireEvents`):
  ```
  var _dragTabId = null;          // id of the tab being dragged
  var _dragIndicatorEl = null;    // current .tv-drop-indicator element
  ```
- `_onTabDragStart(e)`:
  1. Find `tabEl = e.target.closest('[data-tab-id]')` — if none, return. (No `'Files'` check needed here — `dragstart` only fires on `draggable="true"` DOM elements, never for OS Finder drags; DR-96.)
  2. `_dragTabId = tabEl.dataset.tabId`.
  3. `e.dataTransfer.setData('text/plain', _dragTabId)`.
  4. `e.dataTransfer.effectAllowed = 'move'`.
  5. Build ghost clone, `setDragImage`, schedule removal (DR-93).
  6. `setTimeout(() => tabEl.classList.add('tv-tab--dragging'), 0)` — deferred so browser can capture the ghost before opacity changes.

- `_onTabDragOver(e)`:
  1. `if (e.dataTransfer.types.includes('Files')) return;` — no preventDefault, no indicator (DR-96).
  2. `e.preventDefault()`.
  3. Find nearest `.tv-tab` target, compute midpoint, place `.tv-drop-indicator`.
  4. Guard: if target is the dragged tab itself, remove indicator and return.

- `_onTabDrop(e)`:
  1. `if (e.dataTransfer.types.includes('Files')) return;` (DR-96).
  2. `e.preventDefault()`.
  3. Read `srcId = e.dataTransfer.getData('text/plain')`.
  4. Find `srcIdx = state.tabs.findIndex(t => t.id === srcId)`.
  5. Compute `destIdx` from the same midpoint logic as `_onTabDragOver`.
  6. `if (srcIdx === destIdx) { _cleanupDrag(); return; }` — no-op on same position.
  7. Splice with index correction: `var tab = state.tabs.splice(srcIdx, 1)[0]`. After removal the array has shifted — if `destIdx > srcIdx`, use `destIdx - 1` as the insert index (the removal shifted everything above `srcIdx` down by one); otherwise use `destIdx` unchanged. Then `state.tabs.splice(insertIdx, 0, tab)`.
  8. `_cleanupDrag(); render(); TV.saveSession();`.

- `_onTabDragEnd(e)`: call `_cleanupDrag()` unconditionally.

- `_cleanupDrag()`: remove `.tv-tab--dragging` from any tab in the strip; remove all `.tv-drop-indicator` elements; `_dragTabId = null; _dragIndicatorEl = null`.

**`app/css/tv-app.css`**

Add after the existing `.tv-tab` rules (around line 131):

```css
/* U-14: drag-to-reorder */
.tv-tab[draggable="true"] { cursor: grab; }
.tv-tab[draggable="true"]:active { cursor: grabbing; }
.tv-tab--dragging { opacity: 0.4; will-change: transform; }
.tv-drop-indicator {
  position: absolute;
  top: 4px; bottom: 4px;
  width: 2px;
  background: var(--tv-accent) !important;
  border-radius: 1px;
  pointer-events: none;
  z-index: 10;
}
@media (prefers-reduced-motion: reduce) {
  .tv-tab--dragging { transition: none !important; }
  .tv-drop-indicator { transition: none !important; }
}
```

Note: `.tv-drop-indicator` is `position: absolute` inside `.tv-tab-strip` which is already `position: relative` (line 75 of tv-app.css). The `left` value is computed in JS as `tabEl.offsetLeft` (before slot) or `tabEl.offsetLeft + tabEl.offsetWidth` (after slot). Both are strip-local coordinates — do not subtract `strip.scrollLeft` (see Interaction with tab-bar horizontal scroll).

**`app/js/tv-app.js` — expose `saveSession` on `window.TV`** (required for DR-98 and DR-95)

`saveSession` is defined at line ~4140 but is NOT currently exported on `window.TV` (the public API at lines 4535–4570 omits it). Add it to the exports object:
```js
saveSession: saveSession,
```
This is a required change before either the drag `_onTabDrop` handler or the palette `Move Tab` commands can call `TV.saveSession()` from outside the IIFE. Within `tv-app.js` itself (e.g., in `_onTabDrop` and `_cleanupDrag` which are defined inside the same IIFE) the bare `saveSession()` reference works fine — use `TV.saveSession()` only in `tv-palette.js`.

**`app/js/tv-palette.js`** (DR-98, Should)

In `_buildCommandRows()`: add two entries:
```js
{ main: 'Move Tab Left', action: 'moveTabLeft' },
{ main: 'Move Tab Right', action: 'moveTabRight' },
```
In `_activateRow()`, handle `'moveTabLeft'` and `'moveTabRight'`: find `activeIdx` in `TV.state.tabs`, clamp, splice with the same index-correction logic as `_onTabDrop`, call `TV.render()`, then `TV.saveSession()`.

### Interaction with tab-bar horizontal scroll

`.tv-tab-strip` has `overflow-x: auto`. During HTML5 drag, the browser auto-scrolls the overflow container when the drag cursor approaches its edges — this is a native behavior that requires no JS.

The drop indicator is `position: absolute` inside `.tv-tab-strip` which is `position: relative` (tv-app.css line 75), so its `left` coordinate is strip-local (relative to the strip's own scroll origin, not the viewport). Use `tabEl.offsetLeft` (for "before" slot) or `tabEl.offsetLeft + tabEl.offsetWidth` (for "after" slot) directly — do NOT subtract `strip.scrollLeft`. Subtracting `scrollLeft` would push the indicator off-screen when the strip is scrolled right. `offsetLeft` is already relative to the offset parent (the strip), so it naturally stays at the correct strip-local position regardless of scroll.

### Session order persistence

`saveSession()` already serializes `state.tabs` in array order (DR-47). A post-drop call to `saveSession()` is the entire persistence story — no additional schema changes needed. The `tv-session` entry that is written after reorder will have `nativePath` entries in the new order; `init()` restores them in that order (DR-48). This is a zero-cost integration with U-13.

### WKWebView drag reliability flag

**Known risk:** WKWebView on macOS has historically had bugs with `setDragImage()` — in some macOS versions (12.x, 13.x) the custom ghost does not render and the default ghost (full semi-transparent clone of the element) is used instead. This is a cosmetic degradation only; the drag-and-drop mechanics still work. DR-93 specifies the custom ghost as a Must, but if `setDragImage()` is a no-op, the feature degrades gracefully to the browser default ghost. Verify against the current macOS SDK version in the CI matrix; if `setDragImage` is unreliable in the shipping WKWebView, drop DR-93 to a Should at implementation time without re-opening this spec.

---

## Reduced-Motion Behavior

Under `@media (prefers-reduced-motion: reduce)` (existing block at tv-app.css lines 809–845):

- `.tv-tab--dragging` opacity change: instant (no transition).
- `.tv-drop-indicator` appearance: instant (no fade-in CSS transition should exist on it; ensure none is added).
- The drag interaction itself is unaffected — reduced-motion disables animation, not gestures.
- Palette commands `Move Tab Left / Right` (DR-98): these are already instant state mutations + `render()`, so they are inherently reduced-motion compliant.

---

## Global DR Numbering Continuation

Per `waad-grounded-requirements.md` global DR map:
| Range | Source |
|-------|--------|
| DR-81 – DR-90 | Reserved (Tab Context Menu Part 5 extended future DRs if needed) |
| **DR-91 – DR-98** | **U-14 / F-20 Tab Drag-to-Reorder (this spec)** |

---

*Prepared via UxPipeline Step 3 methodology. Critic passes: (1) WKWebView drag-quirk audit; (2) Finder-drag collision analysis; (3) session-model order-persistence integration check; (4) URD-08 chrome-budget verification. Adversarial review 2026-06-22: APPROVE-WITH-FIXES applied — DR-96 dragstart guard removed (dead code); TV.saveSession export required; drop-indicator left-math corrected (strip-local, no scrollLeft subtraction); splice index correction added; overlay group-header claim dropped. Status: **CLEAR — build-ready**.*
