# QA Round 2 — State Management, Interaction & Event Logic Audit

**Audited by**: qa-state  
**Date**: 2026-06-08  
**Scope**: Interaction, state management, and event logic — new issues only. Known-fixed items (E-04, E-06, etc.) verified for regressions; none found.  
**Method**: Full static code review + `node` logic simulations of all state transitions.

---

## Findings (ordered by severity)

| ID | Severity | Requirement | File:Line | Issue |
|----|----------|-------------|-----------|-------|
| S-01 | Critical | DR-08 | tv-app.js:633-638, tv-edit.js:261-269 | `markDirty()` calls `render()` — full DOM rebuild fires on every keystroke in edit mode, resetting cursor to EOF |
| S-02 | High | DR-09 | tv-app.js:537-540, tv-palette.js:346-354, tv-search.js:234-249 | `render()` destroys overlay DOM without notifying TVPalette/TVSearch — both enter a ghost-open state where `_open=true` but the overlay is detached |
| S-03 | High | DR-08 / DR-06 | tv-app.js:553-576, tv-app.js:771-775 | `closeTab()` has no dirty-flag check — closing a tab with unsaved edits (⌘W, close button) silently discards all changes |
| S-04 | High | DR-05 | tv-native.js:218-238 | `saveTab()` save-as path sets `tab.nativePath` but never calls `startWatch()` — the newly saved file is not registered with FSEvents and will not receive live-watch updates |
| S-05 | High | DR-03 | tv-app.js:846-886 | `init()` restores recent files sequentially via `readNext()`; each `openDoc→activateTab` makes the opened tab active; the last file in the recents array (oldest, index N-1) ends up active instead of index 0 (most recently used) |
| S-06 | Medium | DR-05 / DR-08 | tv-native.js:113-147, tv-app.js:633-638 | `handleFileChanged()` updates `tab.source` unconditionally even when `state.mode === 'edit'`. If the user's last disk write arrived after their most recent keypress, `tab.source` is now the disk version. A subsequent ⌘S saves the disk content, not the user's edits |
| S-07 | Medium | DR-03 | tv-search.js:192-219, tv-app.js:543-547 | After a search-result navigation, the scroll position set by `_activateRow` is never written back to `tab.scrollTop`. Switching away and returning restores the pre-search scroll position, not the found result's position |
| S-08 | Minor | DR-09 | tv-app.js:770-775, tv-palette.js:417-426, tv-search.js:326-345 | ⌘W (and tab-close button) trigger `render()` which replaces the `.tv` element's innerHTML, detaching any open overlay without resetting `_open`. After ⌘W while palette is open, ⌘K is a no-op until Esc is pressed. After ⌘W while search is open, ⌘⇧F reopens search correctly but `_savedScroll.el` is stale. Applies to any `render()` call (tab switch, mode change, theme change) with an overlay open |
| S-09 | Minor | DR-08 | tv-edit.js:206-235 | The cursor-anchor `requestAnimationFrame` in `wire()` always falls back to EOF when `window._tvEditAnchorText` is `null` (consumed after first use). Because `markDirty→render→wire()` fires on every keystroke (S-01 root), every keystroke after the first triggers an rAF that moves the cursor to EOF |
| S-10 | Minor | DR-05 | tv-native.js:162-186 | `handleFileRemoved()` calls `tv.markDirty(tab.id, true)` (which internally calls `render()`) and then immediately calls `tv.render()` again on line 185 — two full renders in sequence for one file-removed event |
| S-11 | Minor | DR-03 | tv-app.js:604-630 | `scrollToHeading()` queues a `requestAnimationFrame` after `activateTab()`. If the user switches tabs again before that rAF fires, the rAF runs against the new tab's DOM and scrolls (and saves `scrollTop` to) the wrong tab |
| S-12 | Minor | DR-03 | tv-app.js:846-886 | During production boot, `openDoc→activateTab` is called once per recent file. Each call triggers a full `render()`. With 10 recent files, 10 sequential renders fire during boot — each visible to the user as a flash |

---

## Detailed Findings

---

### S-01 — Critical — markDirty triggers full DOM rebuild on every keystroke

**Severity**: Critical  
**Requirement**: DR-08 (inline editing), DR-09 (tab-switch <50 ms)

**Sequence**:
1. User enters edit mode and begins typing.
2. `tv-edit.js:261-269` — `onInput()` fires on every keystroke, calls `TV.markDirty(tab.id, true)`.
3. `tv-app.js:633-638` — `markDirty()` calls `render()` unconditionally.
4. `render()` replaces `root.innerHTML` with the full rebuilt DOM, including `TVEdit.renderSource(tab)` which iterates every line of the document to build syntax-highlighted gutter HTML (`tv-edit.js:41-95`).
5. `TVEdit.wire(tvRoot, activeTab)` is called again on the new DOM (`tv-app.js:411-416`).
6. `wire()` queues a `requestAnimationFrame` that calls `textarea.setSelectionRange(len, len)` — cursor jumps to EOF (S-09 is the cascading cursor bug).

**Expected**: `markDirty` updates the tab's dirty flag and re-renders the tab bar indicator only (or defers the full render until save/mode-change).  
**Actual**: A full O(N) DOM rebuild fires for every character typed. For a 500-line document, every keypress rebuilds ~500 `<div class="tv-srcline">` elements. Cursor position is lost after each character via the rAF in `wire()`.

**Evidence**: `tv-app.js:633-638`; `tv-edit.js:261-269`, `tv-edit.js:199-235`.

**Fix**: In `markDirty()`, update `state.tabs[i].dirty` and then only update the tab-bar indicator in the DOM (toggle the `.tv-dot` class on the specific tab element) without a full `render()`. Reserve `render()` for mode changes and explicit tab switches. Alternatively, update the `updateBackdrop()` call within `wire()` itself (already present at `tv-edit.js:247-258`) and skip the `markDirty→render` round-trip entirely.

---

### S-02 — High — Overlay ghost-open state after render() destroys .tv element

**Severity**: High  
**Requirement**: DR-09 (usable with many overlays / shortcuts)

**Sequence (palette)**:
1. User opens command palette (⌘K). `TVPalette._open = true`, `_overlayEl` appended to `.tv`.
2. User presses ⌘W (close tab). `closeTab()` → `render()` → `root.innerHTML = ...` — the entire `.tv` element is replaced. `_overlayEl` is now detached from the live DOM.
3. Palette is invisible. `TVPalette._open` is still `true`.
4. User presses ⌘K to reopen palette. `TVPalette.open()` checks `if (_open)` → tries `document.getElementById('tv-pal-input-field')` on the live DOM. Returns `null`. No focus, nothing happens. ⌘K is a no-op until the user presses Esc first.

**Same sequence applies to TVSearch** after any `render()` call (tab switch, ⌘B sidebar toggle, theme change, mode change) with search open.

**Expected**: Pressing ⌘K after any app state change opens or focuses the palette correctly.  
**Actual**: Any `render()` call while an overlay is open leaves the overlay module in a ghost-open state, blocking re-open until Esc is pressed.

**Evidence**: `tv-app.js:537-540` (`activateTab` calls `render()` before emitting anything); `tv-palette.js:346-354` (open guard); `tv-app.js:537-575` (all paths that call `render()` without notifying overlays); `tv-search.js:234-249` (same pattern).

**Fix**: `render()` in `tv-app.js` should call `TVPalette.close()` and `TVSearch.close()` before replacing `root.innerHTML`, so the modules reset their state. Or, `TV` should emit a `'beforerender'` event that both modules listen to for cleanup.

---

### S-03 — High — closeTab() discards dirty (unsaved) edits without confirmation

**Severity**: High  
**Requirement**: DR-06 ("the app writes zero files outside .md files user explicitly saves" implies unsaved edits must not be silently lost)

**Sequence**:
1. User enters edit mode, types several paragraphs. `tab.dirty = true`.
2. User presses ⌘W, or clicks the tab's close button.
3. `closeTab()` (`tv-app.js:553-576`) splices the tab from `state.tabs`, picks a neighbor, calls `render()`.
4. All edits are gone. No dialog, no warning, no `beforeunload`.

**Expected**: At minimum, a confirmation dialog ("Save before closing?" with Save / Discard / Cancel) when `tab.dirty === true`.  
**Actual**: Tab is closed silently. Data loss guaranteed for any user who triggers ⌘W while editing.

**Evidence**: `tv-app.js:553-576` — no dirty check; `tv-app.js:771-775` — keyboard ⌘W; `tv-app.js:430-437` — close button in event delegation. No `window.addEventListener('beforeunload', ...)` anywhere in the codebase.

**Fix**: In `closeTab(id)`, before splicing: `if (tab.dirty && !confirm('Discard unsaved changes to "' + tab.name + '"?')) return;`. For a better UX, show a native Tauri dialog (`dialog().ask(...)`) in Tauri mode. Also add `window.addEventListener('beforeunload', function(e) { if (state.tabs.some(t => t.dirty)) { e.preventDefault(); e.returnValue = ''; } })` for browser environments.

---

### S-04 — High — saveTab save-as does not register the new file with FSEvents watcher

**Severity**: High  
**Requirement**: DR-05 (live file watch for all open files)

**Sequence**:
1. User creates a new tab (paste content) and presses ⌘S.
2. `handleSave()` → `TVNative.saveTab(tab)`. `tab.nativePath` is null → `save_md_file_as` invoked.
3. User picks a save location. `save_md_file_as` returns `FileDoc{name, path, content}`.
4. `tv-native.js:226-231` sets `tab.nativePath = d.path` and calls `tv.saveRecentPath(d.path)`.
5. `startWatch(tab)` is **never called**. The file is now on disk with a `nativePath` but no FSEvents watcher.
6. If an external process modifies the file, no `file-changed` event fires. The live indicator is never shown.

**Expected**: After successful save-as, `startWatch(tab)` is called so the file participates in live watch.  
**Actual**: File saved, live watching permanently absent for the tab until the app restarts and the file is re-opened from recents.

**Evidence**: `tv-native.js:218-238` — `saveTab` save-as branch; compare with `openInto()` at `tv-native.js:66-95` which correctly calls `startWatch(tab)`.

**Fix**: In the `save_md_file_as` `.then()` handler at `tv-native.js:223`, after `tab.nativePath = d.path`, add: `tab.live = true; if (window.TVLive) TVLive.start(tab.id); if (typeof tv.render === 'function') tv.render();`

---

### S-05 — High — Recent files restored in inverted MRU order (oldest file becomes active tab)

**Severity**: High  
**Requirement**: DR-03 (scroll position and session restoration should feel natural)

**Sequence**:
1. User opens files A, B, C in that order. `tv-recent-files` in localStorage = `[C, B, A]` (newest first per `saveRecentPath` prepend logic, `tv-app.js:98-102`).
2. App restarts. `init()` calls `readNext()` with `pending = [C, B, A]`.
3. `readNext()` processes C first: `openDoc` → `activateTab(C)` → C is active.
4. Then B: `openDoc` → `activateTab(B)` → B is active.
5. Then A: `openDoc` → `activateTab(A)` → A is active.
6. Boot completes with A (the **oldest** used file) as the active tab, not C (the most recently used).

**Expected**: After restore, C (recents index 0, most recently used) is the active tab.  
**Actual**: A (recents index 2, least recently used) is active.

**Evidence**: `tv-app.js:853-886` — `readNext()` sequential processing; `tv-app.js:518` — `openDoc` calls `activateTab` which always sets `state.activeId` to the last opened.

**Fix**: In `readNext()`, track the ID of the first-opened tab (recents[0]) and after all files are loaded, call `activateTab(firstId)` explicitly. Or: suppress `activateTab` during batch restore and call it once at the end.

---

### S-06 — Medium — file-changed event silently overwrites tab.source during edit mode

**Severity**: Medium  
**Requirement**: DR-05, DR-08

**Sequence**:
1. User opens a live-watched file and enters edit mode.
2. User has typed some text. `tab.source` is current (onInput kept it live).
3. External AI process writes a new version of the file to disk. FSEvents fires `file-changed`.
4. `handleFileChanged()` (`tv-native.js:113-147`): `tab.source = payload.content` — overwrites the in-memory source with disk content.
5. The textarea still shows the user's edits (the DOM was not re-rendered because mode is 'edit').
6. User has NOT typed since step 4. `tab.source` is the disk version.
7. User presses ⌘S: `handleSave()` reads `tab.source` (disk version) and saves it.
8. User's edits are lost. The disk version is saved, not the user's edit.

**Note**: If the user types even one character after the overwrite, `onInput` runs and `tab.source = textarea.value` (the user's edits) — save would then be correct. The bug is the window between the file-changed event and the next user keystroke.

**Expected**: During edit mode, incoming `file-changed` events should be queued or ignored so the user's in-progress edits are not overwritten. Or the textarea should be immediately synced from the overwritten `tab.source` (which would be disruptive but at least visible).  
**Actual**: `tab.source` is silently replaced; the textarea shows stale text; ⌘S can lose the user's work.

**Evidence**: `tv-native.js:126` — `tab.source = payload.content` with no mode guard; `tv-app.js:654-692` — `handleSave` reads `tab.source` directly.

**Fix**: In `handleFileChanged()`, add a mode guard: `if (tv.state.mode === 'edit' && activeTab && activeTab.id === tab.id) { /* queue the update or show a merge notice */ return; }`. A simpler approach: sync `tab.source` from `textarea.value` at save time (already guaranteed by `onInput`, but explicitly read `document.querySelector('[data-edit-area]').value` in `handleSave` as a safety override).

---

### S-07 — Medium — Search-result scroll position not persisted to tab.scrollTop (DR-03 violation)

**Severity**: Medium  
**Requirement**: DR-03

**Sequence**:
1. User opens search (⌘⇧F), types a query, clicks a result in tab B at line 200.
2. `_activateRow()` closes search, calls `TV.activateTab(tabB.id)`, then in a rAF:
   - `scrollEl.scrollTop = ratio * (scrollEl.scrollHeight - scrollEl.clientHeight)` (proportional scroll).
   - `tab.scrollTop` is NOT updated (no assignment to `tab.scrollTop`).
3. User switches to tab C, then back to tab B.
4. `activateTab(B)` restores `tab.scrollTop` — which is the **pre-search** saved value, not the search-result position.
5. User's found result is lost.

**Expected**: After navigating to a search result, the position is treated as the new saved scroll for that tab.  
**Actual**: The search scroll is ephemeral; any subsequent tab switch discards it.

**Evidence**: `tv-search.js:213-218` — proportional scroll set, no `tab.scrollTop` update; compare with `scrollToHeading()` at `tv-app.js:624-629` which DOES update `tab.scrollTop` in its rAF.

**Fix**: In `_activateRow()` rAF at `tv-search.js:218`, add `var tab = ...; if (tab) tab.scrollTop = scrollEl.scrollTop;` after setting `scrollEl.scrollTop`. Mirror what `scrollToHeading()` does at `tv-app.js:624-627`.

---

### S-08 — Minor — Overlay ghost-open state triggered by any render() while overlay is open

**Severity**: Minor (refinement of S-02 root cause — all render() paths)

**Requirement**: DR-09

Extends S-02: the ghost-open state is not limited to ⌘W. Any call to `render()` while TVPalette or TVSearch is open triggers it — including ⌘B (sidebar toggle), theme change, accent change, `setMode()`, `markDirty()`, or clicking a tab in the sidebar. The specific scenario of a tab switch (⌘1–9 or sidebar click) while palette is open is the most likely user-visible trigger.

**Evidence**: `tv-app.js:581` (`setMode` calls `render()`); `tv-app.js:589` (`setTheme` calls `render()`); `tv-app.js:596` (`setAccent` calls `render()`); `tv-app.js:601` (`toggleSidebar` calls `render()`); `tv-app.js:638` (`markDirty` calls `render()`).

---

### S-09 — Minor — Cursor jumps to EOF on every keystroke (cascading from S-01)

**Severity**: Minor (the manifestation; S-01 is the root cause)  
**Requirement**: DR-08

Because `markDirty→render→wire()` fires on every keystroke (S-01), the `requestAnimationFrame` inside `wire()` runs on every character typed. `window._tvEditAnchorText` is consumed (set to `null`) after the first `wire()` call, so on all subsequent calls `offset = -1` and the fallback `textarea.setSelectionRange(len, len)` runs — placing the cursor at the end of the document.

A user typing in the middle of a 500-word document will find their cursor jumping to the end after every character.

**Evidence**: `tv-edit.js:206-235` — rAF in `wire()` reads `window._tvEditAnchorText`; `tv-edit.js:214-216` — consumed after first use; `tv-edit.js:231-234` — EOF fallback.

---

### S-10 — Minor — handleFileRemoved triggers two renders in sequence

**Severity**: Minor  
**Requirement**: DR-05

`handleFileRemoved()` in `tv-native.js:162-186` calls `tv.markDirty(tab.id, true)` at line 181 (which calls `render()` internally via `tv-app.js:638`), and then calls `tv.render()` again explicitly at line 185. Two full DOM rebuilds fire synchronously for a single file-removed event.

**Evidence**: `tv-native.js:181` — `markDirty` (triggers render); `tv-native.js:185` — explicit `tv.render()`.

**Fix**: Remove the explicit `tv.render()` call at line 185. The `markDirty` call at line 181 already triggers a render. Alternatively, replace `tv.markDirty(tab.id, true)` with direct `tab.dirty = true` and call `tv.render()` once at line 185.

---

### S-11 — Minor — scrollToHeading rAF can scroll wrong tab on rapid switches

**Severity**: Minor  
**Requirement**: DR-03

`scrollToHeading()` queues a `requestAnimationFrame` after `activateTab()`. If the user switches tabs again before that rAF fires (e.g., via ⌘1 keyboard shortcut), the rAF executes against the new tab's DOM, finds headings from the new tab's content, and writes an incorrect `scrollTop` to `getActiveTab()` (which now returns the second tab).

**Evidence**: `tv-app.js:604-630` — rAF captures `getActiveTab()` inside the callback, which by then may have changed; no stale-closure guard.

**Fix**: Capture `var targetTabId = tabId` before the rAF. Inside the rAF, verify `window.TV.state.activeId === targetTabId` before scrolling and saving.

---

### S-12 — Minor — 10 sequential renders fire during boot with 10 recent files

**Severity**: Minor  
**Requirement**: DR-01 (sub-300ms render), P4 (RAM efficiency during load)

`init()` calls `openDoc` for each recent file. `openDoc` calls `activateTab` which calls `render()`. With 10 recent files, 10 full renders fire sequentially during the boot `readNext()` chain. Each render involves full DOM replacement, inline style application, `tvEmit('render')` to all listeners, and `tvResolveDiagrams` scheduling. Users may see rapid tab flashes during startup.

**Evidence**: `tv-app.js:853-886` — `readNext()` loop; `tv-app.js:518` — `openDoc` calls `activateTab`; `tv-app.js:540` — `activateTab` calls `render()`.

**Fix**: Batch the recent-file opens: add all tabs to `state.tabs` without calling `activateTab` (skip the render), then call `activateTab(firstRecentId)` once at the end to do a single render.

---

## Regressions on E-04 / E-06 (verify fixed, no new regressions)

**E-04 (scroll corruption)**: Verified fixed. `activateTab()` saves outgoing `scrollTop` before changing `state.activeId` (line 529-535). `render()` no longer saves scroll (comment at line 360-361 confirms removal). The continuous scroll listener correctly updates `tab.scrollTop`. No regression found.

**E-06 (tabchange missing prevId)**: Verified fixed. `tvEmit('tabchange', { id, prevId: prevId || null, tab })` at line 550. `tv-live.js:239-256` correctly reads `payload.prevId` to remove the outgoing live UI. No regression found.

---

## Coverage Gaps Identified

- No test for `closeTab()` with `tab.dirty === true` (silent data loss — S-03).
- No test for `markDirty` call chain in edit mode (S-01 performance regression).
- No test for overlay state after `render()` (S-02 / S-08).
- No test for boot sequence with multiple recent files (S-05 MRU order inversion).
- No test for `handleFileChanged` during `state.mode === 'edit'` (S-06).
- No test for `saveTab` save-as path + `startWatch` (S-04).

---

## Summary

| Severity | Count | IDs |
|----------|-------|-----|
| Critical | 1 | S-01 |
| High | 4 | S-02, S-03, S-04, S-05 |
| Medium | 2 | S-06, S-07 |
| Minor | 5 | S-08, S-09, S-10, S-11, S-12 |

**Total new issues**: 12

**QA Sign-off**: S-01 and S-03 must be fixed before this build can be considered production-ready. S-01 makes editing functionally unusable (cursor jumps to EOF on every character). S-03 is a silent data-loss bug. S-02/S-04/S-05 should be resolved before the first public release.
