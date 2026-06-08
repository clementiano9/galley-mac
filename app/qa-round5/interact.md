# QA Round 5 — Edit Mode + Interaction + Keyboard Audit

**Audited by**: qa-interact (round 5)
**Date**: 2026-06-08
**Method**: Full static code review of tv-edit.js, tv-app.js, tv-palette.js, tv-search.js, tv-native.js, tv-app.css + node-executed logic simulations
**Scope**: Edit textarea behavior, keyboard router, sidebar resize, palette/search focus, find-in-page. NEW issues only — previously reported and fixed items excluded.

---

## Findings Table

| ID | Severity | Area | Issue | Evidence | Fix |
|----|----------|------|-------|----------|-----|
| UI-01 | High | Edit / Keyboard | Any `render()` call while in edit mode moves cursor to EOF | `tv-app.js:490-495` calls `TVEdit.wire()` for ALL `render()` calls in edit mode. `tv-edit.js:172-201` rAF: `_tvEditAnchorText` is `null` after first edit entry (consumed), so the `else` branch fires `textarea.setSelectionRange(len, len)`. Trigger: `⌘B` (sidebar toggle), palette theme/accent command, `⌘⇧F` close — all call `render()`. User's cursor teleports to EOF silently. Distinct from the fixed S-09: S-09 was keystroke→markDirty→render→EOF; UI-01 is structural actions (⌘B/theme/accent) → render → EOF. | In `render()`, before calling `TVEdit.wire()`, capture `textarea.selectionStart` and `textarea.selectionEnd` from the OLD DOM. Pass them as parameters to `wire()` (or store in `tab._pendingCursorPos`). In `wire()`, use those values instead of the anchor/EOF fallback. |
| UI-02 | High | Edit / Undo | Tab key insertion destroys the native undo stack | `tv-edit.js:233-242` `onKeydown`: `textarea.value = val.slice(0, start) + indent + val.slice(end)`. Direct `.value` assignment bypasses the browser's input history; `⌘Z` cannot undo the tab insertion, and the entire prior undo stack is broken for that editing session. Any Tab press in the textarea makes the full undo history unrecoverable. | Replace the direct assignment with `document.execCommand('insertText', false, '    ')` which is undoable. Alternatively use `textarea.setRangeText(indent, start, end, 'end')` which also preserves undo history in modern WebKit. |
| UI-03 | High | Focus Management | Closing the command palette or cross-tab search does not return focus to the textarea in edit mode | `tv-palette.js:443-452` `TVPalette.close()`: removes overlay, resets `_open`, does not call `focus()` on anything. `tv-search.js:329-348` `TVSearch.close()`: same. When the user opens palette (⌘K) or search (⌘⇧F) while editing, closes them (Esc/Enter), focus drops to `document.body`. The textarea remains visible and content-intact but is no longer focused — subsequent keypresses go nowhere. User must click to resume editing. | In `TVPalette.open()` and `TVSearch.open()`, save `_prevFocusEl = document.activeElement`. In `close()`, call `if (_prevFocusEl && typeof _prevFocusEl.focus === 'function') _prevFocusEl.focus()` before clearing state. |
| UI-04 | Major | Keyboard Router | `⌘F` in edit mode is silently swallowed — neither opens find bar nor passes through | `tv-app.js:1280-1286`: `if ((k === 'f') && !e.shiftKey) { e.preventDefault(); if (state.mode === 'reading' && state.tabs.length) { _openFindBar(); } return; }` The `e.preventDefault()` fires unconditionally but `_openFindBar()` is gated behind `state.mode === 'reading'`. In edit mode `⌘F` is intercepted and suppressed: no find bar opens, no browser find-in-page triggers. The keypress disappears. | Either allow `_openFindBar()` to open in edit mode too (find bar operates on the rendered markdown DOM, which doesn't exist in edit mode — so this needs care), OR remove `e.preventDefault()` when `state.mode !== 'reading'` so the browser's native textarea search (if any) can fire. Simplest: `if (state.mode === 'reading') { e.preventDefault(); if (state.tabs.length) _openFindBar(); }` — no intercept at all in edit mode. |
| UI-05 | Minor | Sidebar Resize | The `.tv-sidebar-resizer.dragging` CSS class is defined but never applied during an active drag; visual feedback disappears when pointer moves off the element | `tv-app.css:184-189` defines `.tv-sidebar-resizer.dragging { background: var(--tv-accent-weak); border-left: 1.5px solid var(--tv-accent); }`. `tv-app.js:729-759` `wireSidebarResize()`: `pointerdown` sets `_dragging = true` but never calls `resizer.classList.add('dragging')`. `pointerup`/`pointercancel` never call `classList.remove('dragging')`. Result: the accent accent-line feedback only shows on `:hover` (CSS), which ends as soon as the pointer moves away from the 5px strip during drag. | In `pointerdown` handler, add `resizer.classList.add('dragging')`. In `pointerup` and `pointercancel` handlers, add `resizer.classList.remove('dragging')`. |
| UI-06 | Minor | Find / Search | `⌘F` while cross-tab search (`⌘⇧F`) is open activates both UIs simultaneously — find bar overlaid on top of search results | `tv-app.js:1280-1286`: `⌘F` opens `_openFindBar()` with no check for `TVSearch.isOpen()`. The find bar is appended to `.tv` (absolute positioned), while the search container is inside `.tv-viewer`. Both are independently visible. Two search UIs are active, both respond to keyboard (each has its own capture-phase keydown handler), creating ambiguous focus. | Add a guard in the `⌘F` handler: `if (window.TVSearch && TVSearch.isOpen()) return;`. |
| UI-07 | Minor | Keyboard Router | `⌘S` in reading mode has no `preventDefault()`, allowing browser save-as dialog to fire in non-Tauri environments | `tv-app.js:1321-1327`: `if (k === 's') { if (state.mode === 'edit') { e.preventDefault(); handleSave(); } return; }` — `e.preventDefault()` is inside the `mode === 'edit'` guard. In reading mode `⌘S` passes through to the browser, which may open a Save As dialog. In the Tauri app this is moot (WebView has no browser save), but in the browser fallback mode it fires the OS save dialog unexpectedly. | Move `e.preventDefault()` outside the `mode` guard: always call it, but only call `handleSave()` in edit mode. |
| UI-08 | Minor | Edit Scroll | `autoResize` line-height estimate (13 × 1.72 = 22.36px) may produce incorrect scroll-to-caret on double-click entry if fonts are not yet loaded or if the document has wide/CJK content that wraps | `tv-edit.js:188-195`: `var lineHeight = 13 * 1.72; var approxTop = linesBefore * lineHeight; scrollContainer.scrollTop = Math.max(0, approxTop - ...)`. This is a static estimate; actual rendered line height varies if fonts are still loading (`@font-face` async), if system DPI differs, or if long lines wrap. The double-click anchor lands at the correct character but the scroll position may not center the caret in the viewport. | After the `setSelectionRange` call, replace the manual `approxTop` calculation with `textarea.blur(); textarea.focus()` (forces browser scroll-into-caret behavior), or use `textarea.scrollIntoView()` / `scrollLeft/Top` based on `textarea.selectionStart` within the live DOM measurement. |

---

## Confirmed Correct Behaviors (Not Bugs)

- **⌘C / ⌘V / ⌘A / ⌘Z / ⌘X in textarea**: The keyboard router has NO handler for these keys. They pass through untouched to the native textarea. Copy, paste, select-all, undo, cut all work natively. VERIFIED.
- **Tab key dirty flag and source sync**: `onKeydown` calls `onInput()` which sets `tab.source = textarea.value` and `TV.markDirty()`. Dirty dot appears correctly after Tab press.
- **Word count live update**: `updateMeta()` runs on every input event and updates `.tv-edit-meta` in place without a DOM rebuild.
- **Entering edit mode preserves scroll (numerically)**: The scroll listener keeps `tab.scrollTop` live. `render()` restores it. Visual position differs between rendered markdown and raw text heights — this is expected, not a bug.
- **`_findAnchorOffset` duplicate-line handling**: Scoring uses `>` (not `>=`), so first occurrence wins when two lines score identically. Correct behavior.
- **Find marks cleanup on tab switch**: `render()` calls `_closeFindBar()` before replacing `innerHTML`. `_findMatches` is cleared. No stale marks remain after tab switch.
- **`_runFind` DOM mutation safety**: Text nodes processed in reverse order; fragment replacement of each node. No range-invalidation corruption.
- **Sidebar resize + ⌘B collapse/expand cycle**: `state.sidebarWidth` persisted in localStorage. After collapse→expand, `render()` reapplies `--tv-sidebar-w` from `state.sidebarWidth`. Width is preserved.
- **`saveTab` dirty flag**: `saveTab` (existing path) calls `tv.markDirty(tab.id, false)` in `.then()`. Save-as calls `markDirty` after `render()` — cosmetic two-step but functionally correct.
- **`TVNative.saveTab` clear dirty**: `tv-native.js:246` and `tv-native.js:278` both call `tv.markDirty(tab.id, false)` after successful save. Dirty dot is cleared correctly.
- **`⌘⇧F` in edit mode**: Hides `.tv-scroll` (edit textarea container), shows search. On `TVSearch.close()`, restores `.tv-scroll` display. Textarea value and event listeners survive `display:none` round-trip. Content intact.
- **Esc priority chain**: `_findOpen` → `TVPalette.isOpen` → `TVSearch.isOpen` → `state.mode === 'edit'`. Each level handled correctly.

---

## Summary

| Severity | Count | IDs |
|----------|-------|-----|
| High | 3 | UI-01, UI-02, UI-03 |
| Major | 1 | UI-04 |
| Minor | 4 | UI-05, UI-06, UI-07, UI-08 |
| **Total** | **8** | |

**Top 3 issues by impact**:

1. **UI-01 (High)** — Every `render()` call in edit mode (`⌘B`, theme change from palette, accent change) moves cursor to EOF. The S-01/S-09 fix eliminated the per-keystroke regression but the structural-action path remains. A user who presses `⌘B` while editing a paragraph mid-document will find their cursor at the bottom of the file with no visual warning.

2. **UI-02 (High)** — Tab key breaks `⌘Z`. Direct `textarea.value = ...` assignment destroys browser input history. After a single Tab press, the user cannot undo any prior edit in that session. This is a data-ergonomics regression for any user who relies on undo while editing indented content.

3. **UI-03 (High)** — Opening then closing the command palette or cross-tab search in edit mode drops focus to `document.body`. The user must click the textarea to resume typing. There is no focus restoration path.
