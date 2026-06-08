# QA Round 5 — Usability Flows Audit
**Audited by**: qa-flows  
**Date**: 2026-06-08  
**Method**: Full static code review tracing each named workflow end-to-end.  
**Scope**: NEW issues only. Items reported in rounds 1-4 and marked RESOLVED are not re-reported.

---

## Summary Table (severity-ordered)

| ID | Severity | Flow | Issue | Evidence | Suggested Fix |
|----|----------|------|-------|----------|---------------|
| UF-01 | Critical | Live watch — read mode | `openInto()` calls `TVNative.startWatch()` directly but NEVER calls `TVLive.start()`. The `_watching` map in `tv-live.js` is always empty for production-opened files. Consequences: (1) the Live status bar (pill, elapsed timer, Pin button) is never shown for any real file; (2) the ⚡ bolt icon never appears in the tab strip; (3) `TVLive.refresh()` called after `file-changed` is a no-op (returns immediately because `_watching[activeId]` is undefined); (4) `ensureRenderListener` is never set up, so the tabchange handler that cleans up the live UI never registers. Live watch fires correctly at the Rust/FSEvents layer and `file-changed` updates `tab.source`, but the user sees zero visual indication that a file is being watched or has updated. | `tv-native.js:80-109` (`openInto` — no `TVLive.start` call); `tv-live.js:272-308` (`start` shows status bar and timer); `tv-live.js:366-378` (`refresh` checks `_watching[activeId]` — always undefined) | In `openInto()`, after `startWatch(tab)`, add: `if (window.TVLive && typeof TVLive.start === 'function' && tab && tab.id) { TVLive.start(tab.id); }`. Also add `tab.live = true` before `startWatch(tab)` so the bolt icon renders in `buildTabbar`. Mirror this fix in the save-as path (`tv-native.js:273`): `tab.live = true; startWatch(tab)` is present, but `TVLive.start(tab.id)` is still missing. |
| UF-02 | Critical | Edit → tab switch (any method) | Switching tabs while in edit mode silently abandons unsaved edits. `activateTab()` unconditionally sets `state.mode = 'reading'` and calls `render()` before checking whether the current tab is dirty. The same discard path is triggered by: clicking another tab in the tab bar, pressing ⌘1-9, ⌘\[/⌘\], navigating via the ⌘K palette, navigating via ⌘⇧F search results, and clicking a sidebar file row. The `closeTab` guard (S-03 / ⌘W) correctly prompts for dirty tabs, but this protection does NOT apply to tab-switch. The dirty dot (●) persists on the abandoned tab, but the textarea is destroyed and the user's in-progress edits are lost. | `tv-app.js:955-957` (`state.mode = 'reading'; render()` — no dirty check); `tv-app.js:971-997` (`closeTab` has the guard; `activateTab` does not); `tv-search.js:185-191` (`_activateRow` calls `TV.activateTab` — no guard); `tv-palette.js:337-342` (`_activateRow` calls `TV.activateTab` — no guard) | In `activateTab()`, before `state.mode = 'reading'`, check if the outgoing tab is dirty AND currently in edit mode. If so, show the same confirmation dialog used by `closeTab`: if the user confirms "discard", proceed; otherwise abort the tab switch and restore focus to the textarea. |
| UF-03 | High | Drag file onto app (Tauri) | In Tauri mode, file drop is handled via the `'tauri://drag-drop'` event (a Tauri-specific IPC event). The browser `dragenter` / `dragover` / `dragleave` events registered by `tv-files.js` are never fired by the Tauri WebView for files dragged from the Finder. As a result, the `.tv-drag-over` CSS class (dashed blue border + accent overlay) is never applied during a Tauri drag operation. The dropzone gives zero visual feedback while a file is in mid-air over the window — the user cannot tell whether the app will accept the drop. After the drop completes, the file opens correctly (the `tauri://drag-drop` handler works), but the moment of drag-over has no affordance. | `tv-native.js:350-353` (listens to `'tauri://drag-drop'` only — no hover/enter event); `tv-files.js:107-147` (browser `dragenter` / `dragleave` — never fires in Tauri); `tv-app.css:1016-1026` (`.tv-drag-over` styles — never applied in production) | Register `tauri://drag-enter` and `tauri://drag-leave` listeners in `tv-native.js` alongside `tauri://drag-drop`. In each handler, call `setDragHint(true/false)` via a reference to `window.TVFiles` or a shared helper. Alternatively, expose a `setDragHint` method on `window.TVFiles` and import it from `tv-native.js`. |
| UF-04 | High | Edit → ⌘K palette → same-tab heading jump | When user is in edit mode and presses ⌘K, the palette opens with no mode check. Selecting a heading row calls `TV.scrollToHeading(tabId, headingText)` → `activateTab(tabId)` → `state.mode = 'reading'` → `render()`. This silently abandons the edit session (same as UF-02 but triggered by a heading-jump on the SAME currently-edited file). A user who double-clicks into a long document to edit a section, then uses ⌘K to find another heading, loses all their typing with no warning. | `tv-app.js:1262-1267` (⌘K handler — no mode guard); `tv-palette.js:337-342` (`_activateRow` → `TV.scrollToHeading` → `activateTab` → `state.mode='reading'`); `tv-app.js:1071` (`scrollToHeading` calls `activateTab` unconditionally) | Two fixes needed: (1) Guard the ⌘K handler: if `state.mode === 'edit'` and the active tab is dirty, either close the palette immediately with a toast ("Save your edits first") or show the same discard prompt before opening it. (2) In `scrollToHeading`, if `tabId === state.activeId` and `state.mode === 'edit'`, navigate the textarea scroll instead of calling `activateTab`. |
| UF-05 | High | ⌘F find while in edit mode | Pressing ⌘F while in edit mode does nothing and gives no feedback. The keyboard router at `tv-app.js:1280-1285` guards: `if (state.mode === 'reading' && state.tabs.length)`. Neither the find bar is opened nor is a hint displayed that find is unavailable in edit mode. The macOS Edit > Find menu item (wired via `listen('menu:find')` at `tv-app.js:1426-1428`) has the identical guard. A user who double-clicks to edit and then instinctively presses ⌘F to search will get a completely silent failure, likely believing the shortcut is broken. | `tv-app.js:1280-1285` (⌘F guard excludes edit mode); `tv-app.js:1426-1428` (`menu:find` guard identical); `lib.rs:440-444` (menu Find item is always enabled regardless of mode) | Show a brief toast or statusline hint: "Exit edit mode (Esc) to use Find". Alternatively, when ⌘F is pressed in edit mode, save-or-discard the edit first, exit to reading mode, then open the find bar. The native Edit > Find menu item should also be disabled when in edit mode (update `lib.rs` to disable or handle gracefully). |
| UF-06 | High | Find bar closes on every render | The find bar is closed (and all highlights cleared) on every `render()` call. `render()` is called for: tab switch, mode change, theme change, font-size change, sidebar toggle, and live file-changed update. A user who opens ⌘F, types a query, then switches themes or resizes the sidebar loses the find session with no explanation. The find bar disappears silently — not on Escape, not because of a user gesture. | `tv-app.js:437-439` (`if (_findOpen) { _closeFindBar(); }` inside `render()` — no exception for non-destructive renders); `tv-app.js:1040` (`setTheme` → `render()`); `tv-app.js:1063` (`setFontSize` — does NOT call `render()` directly, so zoom is safe); `tv-app.js:1051-1052` (`toggleSidebar` → `render()`) | For renders that do not destroy the find target (theme change, sidebar toggle, font size), preserve the find state: save `_findQuery`, `_findIndex`, and the mark positions. After `render()`, if the session was active, re-run `_runFind(_findQuery)` and restore `_findIndex`. Tab-switch should still close the bar (the searched content changes). |
| UF-07 | Medium | Recent files — MRU not promoted on reopen | When the user clicks a recent file in the sidebar or empty-state list, `openInto(doc)` is called which does call `saveRecentPath(doc.path)`. However, the fallback branch in `wireEvents` (lines 800-807: `else if (doc && doc.name)`) creates a tab directly via `openDoc()` without calling `saveRecentPath`. More importantly: there is no path where the empty-state `.tv-recent-row` click also starts file watching. The fallback branch creates the tab but does not call `startWatch`, so a file reopened from the empty-state recent list without going through `TVNative.openInto` is never watched for external changes. | `tv-app.js:795-814` (recent file click handler — primary path calls `TVNative.openInto`; fallback at 800-807 skips `startWatch` and `saveRecentPath`); `tv-native.js:80-109` (`openInto` handles watch + recents) | Remove the fallback branch entirely: always call `TVNative.openInto(doc)` when `TVNative.available` is true. The fallback was added defensively but is dead code in Tauri mode. |
| UF-08 | Medium | Navigation: heading-only scroll (scrollToHeading) only scans h1-h3 | `scrollToHeading` at `tv-app.js:1080` queries `'.md h1, .md h2, .md h3'` only. The palette parser (`tv-palette.js:73-79`) also only extracts `#{1,3}` headings. So h4-h6 headings never appear in the palette "Jump to Heading" group and are unreachable via keyboard navigation. Documents that use h4/h5/h6 (common in technical documentation with many nesting levels) provide no jump targets for deeper sections. | `tv-app.js:1080` (`querySelectorAll('.md h1, .md h2, .md h3')` — excludes h4/h5/h6); `tv-palette.js:73-75` (`match(/^(#{1,3})\s+/...)` — excludes h4-h6) | Change the querySelectorAll to `'.md h1,.md h2,.md h3,.md h4,.md h5,.md h6'` and the regex to `/^(#{1,6})\s+(.+)/`. Cap the palette list to avoid overwhelming the results (e.g. max 12 headings). |
| UF-09 | Medium | First launch (no recents): ⌘O on empty dropzone goes silent if TVNative is unavailable | On the empty-state dropzone, the `[data-newtab]` click handler checks `if (window.TVFiles && typeof TVFiles.openPicker === 'function')` first. This correctly delegates to `TVNative.openPicker()` via `TVFiles.openPicker`. But if `TVNative.available` is false (plain browser, no Tauri) AND `showOpenFilePicker` is also unavailable (Safari, Firefox), `openPicker` falls through to the hidden `<input type="file">` fallback. That `<input>` is inserted into `document.body` — but `document.body` may have `overflow: hidden` from the app shell or the input may not trigger on iOS/Safari. More critically: the `<input>` is `click()`ed synchronously, but most browsers block programmatic clicks unless triggered directly from a user-gesture event. Since the `[data-newtab]` `click` delegation calls `TVFiles.openPicker()` via a chained callback (not the original `click` event), the hidden-input `.click()` may be blocked as not user-initiated in Safari. | `tv-files.js:207-231` (hidden-input fallback — synchronous `input.click()` after async delegate chain); `tv-app.js:817-823` (newtab handler delegates through `TVFiles.openPicker`) | Not critical in Tauri. For browser path: call `input.click()` directly in the top-level user-event handler (not in a Promise callback). The `[data-newtab]` click is the right place — pass the `click` event through rather than delegating via async chain. Low real-world impact since Tauri is the primary target. |
| UF-10 | Medium | Tab-switch scroll restore: synchronous set before layout | In `activateTab()` at `tv-app.js:959-963`, `render()` is called synchronously and then `newScrollEl.scrollTop = incoming.scrollTop` is set immediately on the next line. However, `render()` calls `root.innerHTML = '...'` which triggers a synchronous layout, so reading `scrollTop` immediately after should be safe. The problem is `scrollIntoView({ behavior: 'smooth' })` called in `scrollToHeading` (rAF after `activateTab`) races with the synchronous `scrollTop` assignment in `activateTab`. The `scrollTop` set in `activateTab` (to restore the previously-saved position) is overridden by `scrollIntoView({ behavior: 'smooth' })` ~16ms later. When a user uses ⌘K → heading jump on an ALREADY-VISITED tab, the tab first snaps to its saved scroll position (correct) then immediately smooth-scrolls to the heading (overriding the snap), which visually looks like a double-scroll jerk. | `tv-app.js:959-963` (synchronous `scrollTop` assignment after `render()`); `tv-app.js:1085-1097` (rAF `scrollIntoView` 16ms later overrides the restored `scrollTop`); `tv-app.js:1071` (`scrollToHeading` calls `activateTab` which also sets `scrollTop`) | In `scrollToHeading`, skip the `activateTab` synchronous scroll restoration when the intent is to navigate to a specific heading: pass a flag to `activateTab` or use `requestAnimationFrame` for the scroll restore too, so both settle in the same frame. |
| UF-11 | Medium | Dead isMostRecent variable in readNext() | `readNext()` computes `var isMostRecent = (pending.length === recentPaths.length - 1 - openedCount)` at `tv-app.js:1576`, but this variable is never read or used anywhere in the function. The intended logic (`openedCount === 0` check at line 1607) correctly identifies the first-loaded tab as the MRU. The dead variable is confusing dead code that gives a false impression of additional logic. Separately, the formula itself is incorrect for its stated purpose: on the first call, `pending.length` is `recentPaths.length - 1` (one item was shifted), `openedCount` is 0, so `isMostRecent = (N-1 === N-1-0)` = true — accidentally correct on first call but unreliable for subsequent calls with skipped (failed) files. | `tv-app.js:1576` (assigned but never used) | Remove the `isMostRecent` variable. The correct MRU identification is already at line 1607 (`if (openedCount === 0) { firstOpenedId = tabId; }`). |
| UF-12 | Low | ⌘S in reading mode: silently does nothing (no feedback) | Pressing ⌘S while in reading mode does nothing and gives no indication to the user. The keyboard router (`tv-app.js:1321-1326`) only calls `handleSave()` when `state.mode === 'edit'`. The native menu `menu:save` listener has the same guard. The File > Save menu item is always enabled regardless of mode. Users who habitually press ⌘S (especially after returning to reading mode from editing) receive no confirmation that there's nothing to save, and may be left uncertain whether their last save succeeded. | `tv-app.js:1321-1326` (⌘S only fires `handleSave` in edit mode); `tv-app.js:1418-1420` (`menu:save` same guard); `lib.rs:411-416` (Save menu item always enabled, no state) | Options: (1) Disable the File > Save menu item when not in edit mode (requires emitting a state signal to Rust, which is complex). (2) When ⌘S fires in reading mode and there is an active tab, show a brief toast "Nothing to save — file is up to date" (or similar). (3) At minimum: if the active tab has `dirty=true` but mode is `'reading'` (e.g. after the edit session was abandoned via UF-02), trigger `handleSave()` anyway. |
| UF-13 | Low | Toast appended to document.body, below palette scrim | `showToast()` in `tv-native.js:64-73` appends the toast `<div>` to `document.body`. The CSS positions it `position: absolute; bottom: 56px; left: 50%; z-index: 50`. Because `document.body` likely has no `position` context of its own, `position: absolute` resolves relative to the initial containing block (the viewport), which is functionally correct. However, the palette scrim (`tv-palette.js` → appended to `.tv` with `z-index: 30`) creates a stacking context inside `.tv`. The toast at `z-index: 50` on `body` renders ABOVE everything, including the palette. This means if a save fails while the palette is open, the toast overlaps the palette — acceptable — but the toast `pointer-events: none` means the user cannot dismiss it and it will persist for 3 seconds obscuring the palette results. Additionally (L-15, still open): appending to `document.body` rather than `.tv` means the toast does not respect the `.tv` overflow boundary and will render outside the app chrome in certain window configurations. | `tv-native.js:64-73` (`document.body.appendChild(t)`); `tv-app.css:1067-1083` (toast CSS — `position:absolute` on body); `tv-app.css:635` (palette scrim `z-index: 30` on `.tv`) | Append the toast to `window.TV && window.TV.el()` (the `.tv` root element) instead of `document.body`. Ensure `z-index: 50` is higher than the palette (`z-index: 30`) within the same stacking context. This keeps the toast clipped by the app bounds and in the correct visual layer. |
| UF-14 | Low | Tab indicator bolt icon / sidebar mini-bolt always absent in production | `buildTabbar()` and `buildSidebar()` render the bolt icon and `mini-bolt` when `t.live === true`. But `openInto()` never sets `tab.live = true` (confirmed: only the demo seed path and `save_md_file_as` path set `tab.live`). Because `TVLive.start` is also never called (UF-01), `tab.live` remains `false` for every production-opened file. Users see no visual distinction between watched and un-watched files. This compounds UF-01: even if the status bar were shown, the tab-level indicator that a file is "live-watched" is always missing. | `tv-native.js:80-109` (`openInto` — no `tab.live = true`); `tv-app.js:154-161` (bolt rendered when `t.live`); `tv-app.js:229, 247` (sidebar mini-bolt when `t.live`) | In `openInto()`, add `tab.live = true` after `tab.nativePath = doc.path`. This is a prerequisite for UF-01's fix and for the tab indicator to function. |

---

## Workflow Traces — Findings by Flow

### Flow 1: First launch → open a file → read

- Empty dropzone renders correctly. ⌘O delegates to `TVNative.openPicker()` → `pick_md_files` (Rust) → `openInto()`. File opens, tab renders. Functionally correct.
- **UF-01**: No live status bar or bolt icon appears even though FSEvents watcher is running.
- **UF-14**: Bolt icon never shown in tab or sidebar.
- **UF-03**: If user drags a file instead of using ⌘O, there is zero drag-over visual feedback.

### Flow 2: Multi-file → tabs → switch → scroll → close → reopen

- ⌘1-9 and ⌘\[/⌘\] tab cycling work by code inspection.
- Per-tab scroll is preserved (E-04 confirmed solid).
- **UF-02**: Switching tabs from edit mode silently discards unsaved edits.
- Unsaved-change guard on ⌘W (close) is solid (S-03 fix confirmed).
- **UF-07**: Reopening from sidebar Recent works via `openInto`; the fallback path misses `startWatch`.
- Recents MRU: `openInto` calls `saveRecentPath` — order is updated correctly on reopen.

### Flow 3: Read → double-click → edit → ⌘S save → back to reading (URD-06)

- Double-click enters edit mode, cursor anchored to clicked paragraph (D-08 fix solid).
- `tab.source` is kept live by `onInput` — no duplication bug.
- ⌘S in edit mode: `handleSave()` → `TVNative.saveTab(tab)` → `save_md_file` → marks clean → exits to reading. Functionally correct.
- **UF-02**: Any tab switch during editing silently discards edits.
- **UF-12**: ⌘S in reading mode is silent.

### Flow 4: Navigation — ⌘K / ⌘⇧F / ⌘F

- ⌘K: Palette opens correctly; heading jump, file activate, theme/accent commands all work by code inspection.
- **UF-04**: ⌘K while in edit mode silently switches tabs and discards edits.
- **UF-08**: h4-h6 headings not shown in palette.
- ⌘⇧F: Cross-tab search opens; results navigate and scroll correctly (S-07 confirmed solid).
- **UF-02**: Search result navigation from edit mode silently discards edits.
- ⌘F: Find bar works in reading mode; keyboard nav, count display, Escape all functional.
- **UF-05**: ⌘F in edit mode is silently ignored.
- **UF-06**: Find bar closes whenever render() fires (theme change, sidebar toggle, tab switch).

### Flow 5: Live watch — external change updates view

- FSEvents path: Rust emits `file-changed` → `handleFileChanged` in `tv-native.js` → updates `tab.source` → `tv.render()` → `TVLive.refresh()`.
- **UF-01**: `TVLive.refresh()` is a no-op because `_watching` map is empty. Status bar never shown.
- DR-10 scroll preservation during live update: `handleFileChanged` saves and restores `scrollTop` — correct.
- Dirty guard on live update: if `tab.dirty`, shows toast and skips update — correct (N-01/S-06 solid).
- File deleted: `handleFileRemoved` stops watch, sets dirty, shows toast — correct (E-08 solid).
- **UF-14**: Bolt icon never shows in tab strip.

### Flow 6: Theme / zoom / sidebar-resize — persistence across restart

- Theme toggle (titlebar button + ⌘K command + menu): persisted to `localStorage('tv-theme')` — correct.
- Zoom: ⌘+/⌘- and View menu zoom items all call `setFontSize()` which sets `--tv-md-font` and persists — correct (INT-01/INT-02 solid).
- Sidebar drag-resize: persisted to `localStorage('tv-sidebar-w')` — correct.
- On restart, `init()` reads all three values from localStorage — correct.

### Flow 7: Recents — MRU order, deduplication

- `saveRecentPath` deduplicates and caps at 10 — correct.
- MRU order restored: `readNext()` processes `recentPaths[0]` first (most recent) → `firstOpenedId` → `state.activeId` — correct.
- **UF-11**: Dead `isMostRecent` variable is confusing but not functionally broken.
- Deduplication by `nativePath` in tabKey — correct (E-12 solid).

---

## Regression Verification of Previously-Fixed Items

| Previously-Fixed Item | Current Status | Evidence |
|-----------------------|---------------|----------|
| E-01 async file picker (hang) | SOLID | `lib.rs:64-91` uses oneshot channel correctly |
| E-02 dummy data removed | SOLID | `tv-docs.js:16-22` gates on `demo=1` |
| E-03 ⌘S silent no-op | SOLID | `tv-app.js:1179-1191` delegates to `TVNative.saveTab` |
| E-04 scroll corruption | SOLID | `tv-app.js:949-963` saves outgoing before `activeId` changes |
| E-06 prevId in tabchange | SOLID | `tv-app.js:967` emits `prevId` correctly |
| E-08 file-removed JS listener | SOLID | `tv-native.js:345-349` registers `file-removed` listener |
| S-03 close dirty guard | SOLID | `tv-app.js:977-993` uses `window.__TAURI__.dialog.ask` |
| INT-01 zoom var | SOLID | `tv-app.js:1063` sets `--tv-md-font` |
| INT-04 javascript&#58; bypass | SOLID | `tv-markdown.js:41-55` complete entity decode chain |
| D-08 cursor anchor | SOLID | `tv-edit.js:68-138` capture-phase dblclick anchor |
| F-08 native menu bar | SOLID | `lib.rs:380-529`; all 12 menu events wired in `wireNativeMenuEvents` |

---

## Issue Count

| Severity | Count | IDs |
|----------|-------|-----|
| Critical | 2 | UF-01, UF-02 |
| High | 4 | UF-03, UF-04, UF-05, UF-06 |
| Medium | 5 | UF-07, UF-08, UF-09, UF-10, UF-11 |
| Low | 3 | UF-12, UF-13, UF-14 |
| **Total** | **14** | |
