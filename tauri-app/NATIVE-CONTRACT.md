# Galley — Native (Tauri) Integration Contract

We are turning the working web frontend (`../app/`) into a **native macOS app** via
Tauri v2 (Rust shell + system WKWebView). This satisfies the platform requirements:
native macOS (no Electron), RAM < 80MB (DR-04), FSEvents live-watch (DR-05/10),
NSOpenPanel file access (DR-06/URD-07). The web frontend stays the UI; native
capabilities come from Rust commands + events.

`withGlobalTauri: true` is set, so the frontend calls Tauri via `window.__TAURI__`
(no imports/bundler). `frontendDist` = `../../app` (the single source of truth UI).

## Rust ⇄ JS contract (BINDING)

`FileDoc` (serde) = `{ name: String, path: String, content: String }`.

### Rust commands (registered in `invoke_handler`)
| Command | Args | Returns | Purpose |
|---|---|---|---|
| `pick_md_files` | — | `Vec<FileDoc>` | Native NSOpenPanel (dialog plugin), multiple, `.md/.markdown/.txt` filter; reads each chosen file |
| `read_md_file` | `path: String` | `FileDoc` | Read one file (drag-drop paths, live re-read) |
| `save_md_file` | `path: String, content: String` | `()` | Overwrite an existing file (Save). ONLY writes the file the user saves (DR-06) |
| `save_md_file_as` | `content: String, suggested_name: String, directory: Option<String>` | `Option<FileDoc>` | Native save dialog; returns new path (null if cancelled). `directory` (F-23) is where the panel opens; a missing or non-existent folder is ignored |
| `watch_file` | `path: String` | `()` | Start an FSEvents watch (notify crate). On change, re-read and emit `file-changed` |
| `unwatch_file` | `path: String` | `()` | Stop watching that path |
| `read_dir_tree` | `path: String, uncapped: Option<bool>` | `DirTree` | Scan a folder for the sidebar tree (async, off the main thread). `uncapped: true` uses the wide budget and file cap — see UXF-02 below |
| `confirm_close` | — | `()` | C-02: the frontend has cleared the quit; releases the guard and exits |
| `confirm_quit_dialog` | `count: u32` | `"save" \| "discard" \| "cancel"` | C-02: native unsaved-changes sheet (Save All / Discard / Cancel) |
| `set_appearance_check` | `choice: String` | `()` | C-36: check the matching View ▸ Appearance row. `"light" \| "dark" \| "system"` — the USER'S choice, not the resolved colour |
| `set_recent_files` | `paths: Vec<String>` | `()` | C-36: rebuild File ▸ Open Recent from the frontend MRU (first 10) |

**Argument keys are camelCase on the wire.** Tauri 2 camelCases command parameters, so
the `suggested_name` above is `suggestedName` from JS (`invoke('save_md_file_as',
{ content, suggestedName, directory })`). The snake_case spelling is rejected with a
"missing required key" error — which silently broke saving any tab without a path until
F-23. `tv-native.runtime.test.js` reads this signature from `lib.rs` and fails if the
keys JS sends drift from it.

### Events (Rust → JS via `app.emit` / `Emitter`)
- `file-changed` — payload `{ path: String, content: String }` (fired by the watcher).
- `file-removed` — payload `{ path: String }` when a watched file is deleted.
- `swipe-touch` — UXF-09, macOS only. Trackpad finger phases from an `NSEvent` local scroll-wheel
  monitor (`install_swipe_monitor`, which returns every event unchanged). Payload (camelCase)
  `{ phase: "began"|"changed"|"ended"|"cancelled", t: f64 ms (NSEvent clock), dx, dy: scrollingDeltaX/Y,
  precise: hasPreciseScrollingDeltas, inverted: isDirectionInvertedFromDevice, x, y: window points
  from the top-left, mods: ⇧⌃⌥⌘ held }`. Never sent for momentum or phase-less mouse wheels;
  `changed` is coalesced to one message per 16 ms and only for a touch's first 1,000 ms.
  `tv-native.js` forwards it to `TVSwipe.touch()`.
- `open-files` — payload `string[]`; Finder "Open With" / double-click, and File ▸ Open Recent.
- `tv-close-requested` — payload `()`. **C-02**: emitted for EVERY quit route (red
  close button, ⌘Q, ⇧⌘W). See the quit contract below.
- `menu:*` — one event per custom menu item id (`menu:new-file` (⌘N, F-23), `menu:print`, `menu:find-next`,
  `menu:find-prev`, `menu:reveal-in-finder`, `menu:reveal-in-sidebar` (View ▸ Reveal in Sidebar ⇧⌘J,
  UXF-06 → `TV.revealInSidebar()`), `menu:appearance-*`, …).
- Native drag-drop uses Tauri's built-in `tauri://drag-drop` window event
  (payload `{ paths: string[], position }`) — the bridge listens for it.

## C-02 · The quit contract (BINDING)

Edits live only in `tab.source`; the session store persists `{nativePath, scrollTop}`
and re-reads from disk on restore (U-13 keeps draft persistence out of scope). So
quitting with a dirty tab used to discard typed work silently — WKWebView does not
fire `beforeunload` on ⌘Q or Dock-Quit. The guard closes that hole:

1. Rust intercepts `WindowEvent::CloseRequested`, calls `api.prevent_close()` and
   emits `tv-close-requested`. The App menu's Quit is a **custom** item
   (`menu:quit`, ⌘Q) rather than `PredefinedMenuItem::quit`, and Window ▸ Close
   Window (`menu:close-window`, ⇧⌘W) emits the same event, so all three routes
   converge.
2. `tv-native.js` counts dirty tabs (`TV.hasDirtyTabs()` when the shell exports it,
   otherwise `TV.state.tabs`). None dirty → `confirm_close` immediately.
3. Dirty → `confirm_quit_dialog { count }`. **Save All** saves each dirty tab
   sequentially through the normal save path, then `confirm_close` — but only if
   nothing is still dirty (a cancelled Save As must not become a silent discard).
   **Discard** → `confirm_close`. **Cancel** → nothing happens.
4. `tv-native.js` guards against a second `tv-close-requested` arriving while a
   sheet is already up (P1-7) — every route emits the event and Rust's
   `prevent_close()` does not stop a second one, so without the guard two
   `confirm_quit_dialog` sheets could stack on the same window with
   contradictory outcomes.
5. `confirm_quit_dialog` failing asks the user to retry on the FIRST failure (a
   transient glitch should not quit out from under them without asking), then
   falls through to `confirm_close` on the SECOND CONSECUTIVE failure (P1-8) — a
   window that cannot even ask about unsaved changes must not become
   permanently unquittable, which is worse than the data-loss case the dialog
   exists to prevent. The Rust guard only arms once `take_pending_opens` has
   been called (i.e. `tv-native.js` booted and registered its listener, which it
   does BEFORE that call). A frontend that never loads therefore cannot make the
   app unquittable.

`confirm_close` sets the guard flag and calls `app.exit(0)`: on a single-window
document app the red button, ⇧⌘W and ⌘Q all mean the same thing.

## UXF-02 · DirTree (the folder scan)

```
DirTree = { path, root: DirNode, truncated: bool, unreadable: u32 }
DirNode = { name, path,
            files: [{name, path}],   // direct .md/.markdown/.txt, natural-sorted, ≤ FILE_CAP
            filesHidden: u32,        // direct markdown files beyond FILE_CAP
            folders: [DirNode],      // direct subfolders, natural-sorted, incl. mdCount 0
            mdCount: u32,            // markdown files in this subtree (filesHidden included)
            scanned: bool }          // false = budget/depth ran out first: empty, mdCount 0
```
Both structs are `#[serde(rename_all = "camelCase")]`; `tv-native.runtime.test.js` reads the
field names from `lib.rs` and fails on drift. The walk is breadth-first so one subtree can never
starve its siblings. Budget (entries read) 20,000 / 200,000 uncapped; FILE_CAP 500 / 5,000;
depth 40. Never scanned (below the picked root): `.git`, `node_modules`, `.venv`, `venv`,
`__pycache__`, `.next`, `.nuxt`, `Pods`, `.cache`, `.tox`, `.gradle`, `.terraform`; `target`
beside a `Cargo.toml`; `dist`/`build` beside `package.json`/`pyproject.toml`; package bundles
(`.app`, `.framework`, `.xcodeproj`, `.xcworkspace`, `.photoslibrary`). Symlinked folders are not
followed, symlinked files are. Read-only: names and paths, never content (DR-06).

**Viewable files (UXF-07):** extension `md`, `markdown`, `mdc` (Cursor rules), `txt`, or one
of the extensionless agent rule files `.cursorrules .windsurfrules .clinerules .roorules
.goosehints .rules` at any depth (`is_md_name`, `AGENT_FILE_NAMES` in `lib.rs`). The same test
gates `pick_folder`, the Open/Save panel filters and Finder "Open With" (`fileAssociations`
lists `mdc`). Nothing else is ever listed: `.env`, `settings.json`, `config.toml` never appear.
Which dot-folders the sidebar SHOWS is a frontend policy (`TVTree.AGENT_FOLDERS`); Rust lists
every folder it scans.

`truncated` is true when any node is unscanned or has `filesHidden > 0`. The frontend loads an
unscanned folder (or a capped one, with `uncapped: true`) by calling `read_dir_tree` with that
folder's path and grafting the returned `root` in place (`TVTree.graftNode`).

## C-36 · Menu ⇄ frontend

- **Appearance is the single appearance control** — the old "Toggle Dark Mode" item
  is gone. `tv-native.js` calls `set_appearance_check` on every render when the
  choice changed, reading `localStorage['tv-theme']` (absent = `system`), so the
  checkmark is truthful whatever route the user took (DR-14).
- **Open Recent** is pushed from JS via `set_recent_files` (the MRU is localStorage,
  unreadable from Rust). Clicking an entry emits `open-files` with that one path, so
  it reuses the existing open handler.
- ⌘P, ⌘G and ⇧⌘G are now menu accelerators. macOS consumes the key before the
  WebView sees it, so the JS keydown handlers cannot double-fire.

## Frontend bridge (`app/js/tv-native.js` → `window.TVNative`)
```js
TVNative.available            // boolean: !!window.__TAURI__
TVNative.init()               // wire drag-drop + file-changed listener; called once at boot
TVNative.openPicker()         // invoke pick_md_files → TV.openDoc(...) each + start watch + set tab.nativePath
TVNative.saveTab(tab)         // tab.nativePath ? save_md_file : save_md_file_as; updates tab name/path; clears dirty
TVNative.startWatch(tab)      // invoke watch_file(tab.nativePath)
TVNative.stopWatch(tab)       // invoke unwatch_file(tab.nativePath)
TVNative.readDirTree(p, opts) // read_dir_tree; opts.uncapped -> wide budget + file cap (UXF-02)
TVNative.showToast(msg, opts) // opts.kind 'error' -> dismissible, ~6s (C-01)
TVNative.syncRecentMenu()     // push the MRU into File > Open Recent (C-36)
TVNative.syncAppearanceMenu() // re-check the View > Appearance row (C-36)
TVNative.notifyTheme(choice)  // direct hook: tv-app.js's setTheme() calls this on
                               // every theme change so the checkmark updates the
                               // same tick, instead of waiting one 'render' event
                               // for syncAppearanceMenu() above to catch it (C-36)
```
- `tab.nativePath` = absolute fs path; the bridge sets it AFTER `TV.openDoc` returns
  (find tab by id, assign). Do NOT change shell's openDoc signature.
- On `file-changed`: find the tab whose `nativePath === payload.path`, set
  `tab.source = payload.content`; if it's the active reading tab, capture
  `.tv-scroll`.scrollTop, `TV.render()`, restore scrollTop (DR-10 no scrolljack).

## Integration into existing modules
- `tv-files.js`: in `openPicker()` and `writeFile()`/save, if `window.TVNative?.available`
  delegate to TVNative; else keep the existing browser fallback (showOpenFilePicker /
  `<input type=file>` / download). Drag-drop: under Tauri the browser drop won't carry
  paths, so rely on TVNative's `tauri://drag-drop`; keep browser DnD as fallback.
- `tv-live.js`: when starting watch on a tab that has `nativePath`, call
  `TVNative.startWatch(tab)` instead of polling. The demo-stream mode stays for seed
  tabs without a path. The `file-changed` handler lives in tv-native.js.
- `index.html`: add `<script src="js/tv-native.js"></script>` BEFORE `tv-app.js`,
  add `<link rel="stylesheet" href="css/tv-tauri.css">`, and the bridge sets
  `document.documentElement.classList.add('tauri')` when `window.__TAURI__` exists.

## Native window chrome (`app/css/tv-tauri.css`, scoped to `html.tauri`)
The Tauri window uses macOS Overlay title bar (real traffic lights overlay the top-left).
So under `html.tauri`:
- Hide the design's fake `.tv-traffic` lights (`display:none`).
- Pad `.tv-titlebar` left ~78px so the native traffic lights sit cleanly; keep the
  centered `.tv-wintitle`.
- Make `.tv-titlebar` draggable: add `data-tauri-drag-region` (shell already? if not,
  use CSS `-webkit-app-region: drag` won't work in WKWebView — use the attribute; the
  bridge can add it to the titlebar after render, or set on the element).
- Everything else (tabs, sidebar, content) unchanged.

## Build & run
- `cd tauri-app && cargo tauri dev` (or `cargo tauri build` for the .app bundle).
- Rust changes live in `src-tauri/src/lib.rs`. Verify with `cargo build` in `src-tauri/`.
