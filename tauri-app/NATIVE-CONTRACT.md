# tiny-viewer — Native (Tauri) Integration Contract

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
| `save_md_file_as` | `content: String, suggested_name: String` | `Option<FileDoc>` | Native save dialog; returns new path (null if cancelled) |
| `watch_file` | `path: String` | `()` | Start an FSEvents watch (notify crate). On change, re-read and emit `file-changed` |
| `unwatch_file` | `path: String` | `()` | Stop watching that path |

### Events (Rust → JS via `app.emit` / `Emitter`)
- `file-changed` — payload `{ path: String, content: String }` (fired by the watcher).
- Native drag-drop uses Tauri's built-in `tauri://drag-drop` window event
  (payload `{ paths: string[], position }`) — the bridge listens for it.

## Frontend bridge (`app/js/tv-native.js` → `window.TVNative`)
```js
TVNative.available            // boolean: !!window.__TAURI__
TVNative.init()               // wire drag-drop + file-changed listener; called once at boot
TVNative.openPicker()         // invoke pick_md_files → TV.openDoc(...) each + start watch + set tab.nativePath
TVNative.saveTab(tab)         // tab.nativePath ? save_md_file : save_md_file_as; updates tab name/path; clears dirty
TVNative.startWatch(tab)      // invoke watch_file(tab.nativePath)
TVNative.stopWatch(tab)       // invoke unwatch_file(tab.nativePath)
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
