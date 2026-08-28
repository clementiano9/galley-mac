# QA Round 2 — Native Integration, Security, Performance/Robustness Audit

**Audited by**: qa-native  
**Date**: 2026-06-08  
**Scope**: Rust/Tauri integration, security, performance, robustness — NEW issues only  
**Known/fixed exclusions**: E-01 through E-15, D-01 through D-08 (QA-REPORT.md Round 2)  
**Method**: Full static code review of lib.rs, tv-native.js, tv-live.js, tv-markdown.js, tv-files.js, tv-app.js, tauri.conf.json, capabilities/default.json + `cargo check` (passes clean) + Node.js execution of renderer logic

---

## Findings

| ID | Severity | File:Line |
|----|----------|-----------|
| N-01 | **Critical / DATA LOSS** | tv-native.js:126, tv-live.js:161 |
| N-02 | **High / Security** | tv-markdown.js:35 |
| N-03 | **High / Security** | tv-markdown.js:42 |
| N-04 | **High / UX-Security** | tv-app.js (wireEvents), tv-native.js (init) |
| N-05 | **Medium / Performance – DR-04** | lib.rs:45, tv-native.js:104 |
| N-06 | **Medium / Error UX** | tv-native.js:213-215, tv-app.js:671-675 |
| N-07 | **Medium / Security** | tauri.conf.json:23 |
| N-08 | **Low / Performance** | lib.rs:246-254 |
| N-09 | **Low / Error UX** | tv-native.js:106-108 |
| N-10 | **Low / Robustness** | lib.rs:194-200, tv-native.js:167-186 |
| N-11 | **Low / Compatibility** | tauri.conf.json:23, tv-markdown.js:392-393 |

---

## N-01 — DATA LOSS: file-changed overwrites unsaved edits in edit mode

**Severity**: Critical  
**Requirement**: DR-06 (must not lose user data); DR-05/DR-10 (file watch must not corrupt user state)

**Issue**: Both `tv-native.js` handleFileChanged and `tv-live.js` poll-mode handler unconditionally assign `tab.source = payload.content` (or `tab.source = newText`) when a file-changed event arrives. The mode check that follows only gates the re-render call, not the source assignment. As a result, if the user is in edit mode and the watched file is modified externally while the user has typed unsaved content, `tab.source` is silently overwritten with the new disk content. When the user then presses Cmd+S, `handleSave()` calls `TVNative.saveTab(tab)` which sends `tab.source` — which is now the external content, not the user's edits. The user's edits are permanently discarded with no warning.

**Evidence**:
- `tv-native.js:126`: `tab.source = payload.content;` — runs unconditionally before the mode check at line 129
- `tv-live.js:161`: `tab.source = newText;` — runs unconditionally before the mode check at line 170
- The mode guard `tv.state.mode === 'reading'` only prevents `tv.render()`, not the source assignment

**Reproduction**:
1. Open a .md file that is also being written by an external process (e.g., an AI writing output)
2. Double-click to enter edit mode; type several paragraphs of text (`tab.dirty = true`)
3. The external process writes new content to the file; FSEvents fires; `handleFileChanged` runs
4. `tab.source` is now set to the new disk content; the textarea still visually shows the user's text
5. User presses Cmd+S — `save_md_file` receives `tab.source` (disk content), saves it to disk
6. User's typed paragraphs are permanently gone; no error, no warning, no conflict dialog

**Expected behavior**: When `tab.dirty === true` (user has unsaved edits), incoming file-changed events must not overwrite `tab.source`. The correct behavior is to either: (a) skip the update entirely and show a "File changed on disk — your edits are unsaved" toast, or (b) keep the user's in-memory content and flag a conflict state that the user must resolve.

**Fix**: In both `handleFileChanged` (tv-native.js) and the poll handler (tv-live.js), add a dirty guard before the source assignment:
```
if (tab.dirty) {
  showToast((tab.name || 'File') + ' changed on disk — save or discard your edits first');
  return;
}
tab.source = payload.content;
```

---

## N-02 — SECURITY: percent-encoded `javascript:` bypasses link sanitizer

**Severity**: High  
**Requirement**: Security (E-14 fix was incomplete); DR-06 (no unintended code execution)

**Issue**: The link sanitizer in `tv-markdown.js` strips ASCII whitespace from the href before testing for `javascript:`, but does NOT URL-decode the href. A markdown author can write `[click](javascript%3Aalert(1))` — the `%3A` is the percent-encoding of `:`. After `href.replace(/\s/g, '')` the string is still `javascript%3Aalert(1)`, which does not match `/^javascript:/i`. The sanitizer passes it through and renders `<a href="javascript%3Aalert(1)">click</a>`. Modern WebKit (used by Tauri/WKWebView) URL-decodes hrefs before navigation, converting `%3A` to `:`, and executes `javascript:alert(1)`. CSP `script-src 'self'` does not reliably block `javascript:` navigation in all WKWebView versions.

**Evidence** (verified by Node.js execution of the inline() function):
```
Input:  [click](javascript%3Aalert(1))
Output: <a href="javascript%3Aalert(1">click</a>
```
The bypass was confirmed: a link is emitted, the href contains the encoded javascript: URI.

**Fix**: URL-decode the href before the scheme check:
```js
var h = href.replace(/\s/g, '');
try { h = decodeURIComponent(h); } catch(e) {}
if (/^javascript:/i.test(h) || /^vbscript:/i.test(h)) { return esc(text); }
```
`tv-markdown.js:35`

---

## N-03 — SECURITY: `file:` protocol links not blocked

**Severity**: High  
**Requirement**: Security; the Tauri app has filesystem access privileges

**Issue**: The link sanitizer blocks `javascript:`, `vbscript:`, and non-image `data:` URIs, but does not block the `file:` protocol. A markdown document containing `[SSH key](file:///Users/username/.ssh/id_rsa)` renders as a live clickable link. In Tauri's WKWebView, clicking a `file://` link can attempt navigation to a local file. If WKWebView's navigation delegate permits it, sensitive local files could be loaded into the app frame. Even if navigation is blocked at the WKWebView level, the link is still surfaced as clickable UI, which is misleading and potentially dangerous if Tauri's navigation policy changes or relaxes.

**Evidence** (verified by Node.js execution):
```
Input:  [SSH key](file:///Users/username/.ssh/id_rsa)
Output: <a href="file:///Users/username/.ssh/id_rsa">SSH key</a>
```

**Fix**: Add `file:` to the blocked schemes in the link sanitizer (`tv-markdown.js:36`):
```js
if (/^javascript:/i.test(h) || /^vbscript:/i.test(h) || /^file:/i.test(h)) {
  return esc(text);
}
```

---

## N-04 — SECURITY/UX: External `https://` links have no click interceptor — silently do nothing

**Severity**: High  
**Requirement**: Basic usability; Tauri-specific integration requirement

**Issue**: The app renders external links (`[click](https://example.com)`) as plain `<a>` tags with no `target` attribute and no `rel="noopener"`. There is no click interceptor anywhere in the codebase (neither in `wireEvents()` in tv-app.js nor in tv-native.js) that catches clicks on external URLs and routes them to `tauri-plugin-opener`. In Tauri v2, the WKWebView navigation delegate blocks external HTTP/HTTPS navigation by default. The result is that clicking any external link in a rendered document silently does nothing. This makes the app non-functional for the common markdown use case of embedding hyperlinks. The `opener` plugin (`tauri_plugin_opener::init()`) is already loaded in `lib.rs:284` and registered (`opener:default` in `capabilities/default.json:11`) — it just is never called.

**Evidence**:
- `tv-markdown.js:42`: `return '<a href="' + esc(href) + '">' + text + '</a>';` — no `target`, no `rel`
- `tv-app.js wireEvents()`: click delegation handles tab, close, newtab, search, edit-esc, edit-save only; no `<a>` click handler
- `tv-native.js init()`: no link click listener registered
- `lib.rs:284`: `tauri_plugin_opener::init()` loaded but never invoked from JS
- `capabilities/default.json:11`: `opener:default` granted

**Fix**: Add a delegated click handler in `wireEvents()` (tv-app.js) for anchor tags in the rendered `.md` area:
```js
var anchor = e.target.closest('.md a[href]');
if (anchor) {
  e.preventDefault();
  var href = anchor.getAttribute('href');
  if (href && (href.startsWith('http://') || href.startsWith('https://'))) {
    if (window.__TAURI__) {
      window.__TAURI__.core.invoke('plugin:opener|open_url', { url: href }).catch(function(){});
    }
  }
  return;
}
```

---

## N-05 — PERFORMANCE / DR-04: Large files read fully into Rust heap, IPC-serialized, and held in JS heap

**Severity**: Medium  
**Requirement**: DR-04 (idle RAM < 80 MB; 10 tabs < 200 MB)

**Issue**: `read_file_doc()` calls `std::fs::read_to_string(&pb)` which reads the entire file into a Rust `String`. This string is serialized to JSON for the Tauri IPC channel, deserialized on the JS side as a JavaScript string, and stored as `tab.source`. At the IPC transfer boundary all three representations exist simultaneously: the Rust `String`, the JSON-encoded bytes on the channel, and the JS string — roughly 3× the file size in peak RAM. For a 100 MB file, this is ~300 MB peak for a single file open, which by itself exceeds DR-04's total 10-tab budget of 200 MB. The watcher also re-reads the full file on every `Modify`/`Create` event (lib.rs:206), compares with the last content (also stored in RAM via `Arc<Mutex<Option<String>>>`), and emits the entire content again over IPC if changed. There is no file size check or limit anywhere in the read path.

**Evidence**:
- `lib.rs:45`: `std::fs::read_to_string(&pb)` — unbounded read
- `lib.rs:206`: watcher re-read inside `EventKind::Modify | EventKind::Create` arm — same unbounded read
- `lib.rs:173`: `Arc<Mutex<Option<String>>> last_content` — holds a copy of the last content in Rust heap
- No size check before any of these reads

**Fix**: Add a pre-read size check using `std::fs::metadata(&pb)?.len()` and return an `Err` if the file exceeds a configurable limit (e.g., 10 MB for initial implementation). Surface the error to the user as a toast (N-09 fix applies here too). For the watcher, apply the same limit to the re-read.

---

## N-06 — ERROR UX: Save failures (disk full, read-only, permission denied) are silent

**Severity**: Medium  
**Requirement**: Basic error UX; DR-06 (user must know when their save succeeded)

**Issue**: When `save_md_file` or `save_md_file_as` returns an error (disk full, read-only file system, permission denied, path no longer exists), the error propagates to the JS `.catch()` handler in `TVNative.saveTab()` as a `console.warn` only. The `handleSave()` caller also has a `.catch()` that calls `setMode('reading')`. The net effect is: the user presses Cmd+S, edit mode closes, the dirty dot remains (markDirty is not called on failure), and there is no toast, alert, or any user-visible indication that the save failed. For a tool that is the sole safeguard for file modifications (DR-06), silent save failure is a significant UX defect.

**Evidence**:
- `tv-native.js:213-215`: `.catch(function(err){ if (err) console.warn('[TVNative] saveTab (save_md_file) failed', err); })`
- `tv-app.js:671-675`: `.catch(function(err){ console.warn('[Galley] native save failed:', err); setMode('reading'); })`
- No call to `showToast()` or any user-facing error in either catch block

**Fix**: In `TVNative.saveTab()` and `handleSave()` catch handlers, call `showToast()` with a descriptive message:
```js
.catch(function(err) {
  showToast('Save failed: ' + (err || 'unknown error'));
  // Do NOT call setMode('reading') on failure — keep the user in edit mode
  // so they can retry or copy their content.
});
```
`tv-native.js` already has a working `showToast()` implementation.

---

## N-07 — SECURITY: CSP missing `base-uri` directive

**Severity**: Medium  
**Requirement**: Security (defense-in-depth; supplements E-14 fix)

**Issue**: The CSP in `tauri.conf.json:23` does not include a `base-uri` directive. The `base-uri` directive restricts the URLs that can be used in a `<base>` element. Without it, `base-uri` defaults to `*` (any origin). If a future XSS vector is introduced (e.g., via a new rendering path, a Mermaid vulnerability, or a third-party library), an attacker-controlled `<base href="https://attacker.com/">` tag could redirect all subsequent relative URL resolutions (script src, link href, fetch) to the attacker's origin, bypassing the `script-src 'self'` restriction for relative URLs. This is a defense-in-depth issue; the current app has no `<base>` injection vector, but adding `base-uri` costs nothing and eliminates the risk permanently.

**Evidence**:
- `tauri.conf.json:23`: CSP value: `"default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self'; connect-src 'self' ipc: http://ipc.localhost"` — `base-uri` absent

**Fix**: Append `base-uri 'none'` to the CSP string in `tauri.conf.json:23`:
```
"default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self'; connect-src 'self' ipc: http://ipc.localhost; base-uri 'none'"
```

---

## N-08 — PERFORMANCE: Multiple tabs in the same directory create redundant FSEventStream watchers

**Severity**: Low  
**Requirement**: DR-04 (RAM/resource efficiency); P4 (RAM competition with AI processes)

**Issue**: The `watch_file` command keys the watcher `HashMap` by the target FILE path (`lib.rs:149`, `260`). If a user opens 5 files from `~/Documents`, there are 5 entries in the HashMap, each holding a `RecommendedWatcher` that calls `watcher.watch(&watch_dir, NonRecursive)` on `~/Documents`. On macOS, `notify`'s `RecommendedWatcher` uses FSEvents; each watcher creates a separate `FSEventStream` for the same directory path. This means 5 concurrent FSEventStream handles, 5 kernel-level event subscriptions, and 5 callback threads (or shared thread pool entries) all watching the same directory. While correctness is maintained (each callback filters to its own target file), the resource overhead is proportional to the number of tabs in the same directory.

**Evidence**:
- `lib.rs:149`: `if map.contains_key(&path)` — deduplication is by file path, not directory path
- `lib.rs:246-254`: `watcher.watch(&watch_dir, RecursiveMode::NonRecursive)` — one new FSEventStream per file

**Fix**: Key the watcher HashMap by DIRECTORY path, not file path, and maintain a set of interested file paths per directory entry. One FSEventStream per directory; the callback filters to any of the registered files. This reduces N watchers on the same directory to 1.

---

## N-09 — ERROR UX: Binary/non-UTF8 files via drag-drop fail silently

**Severity**: Low  
**Requirement**: P1 (responsive, communicative UX); basic error feedback

**Issue**: When a binary or non-UTF8 file is dragged into the app, `tv-native.js handleDragDrop` calls `invoke('read_md_file', { path })`. Rust's `read_file_doc` calls `std::fs::read_to_string()` which returns `Err(Os { kind: InvalidData, ... })` for non-UTF8 content. This error propagates to the JS `.catch()` handler which calls `console.error('[TVNative] drag-drop read_md_file failed', path, err)`. No tab is opened, no toast is shown. From the user's perspective, dropping the file simply does nothing — no visual feedback whatsoever.

**Evidence**:
- `tv-native.js:106-108`:
  ```js
  .catch(function (err) {
    console.error('[TVNative] drag-drop read_md_file failed', path, err);
  });
  ```
- `lib.rs:45-46`: `std::fs::read_to_string` — fails for non-UTF8 with `InvalidData`

**Fix**: In the `.catch()` handler call `showToast('Cannot open "' + fileName + '": file is not valid UTF-8 text')`. The `showToast` function is already defined in tv-native.js scope.

---

## N-10 — ROBUSTNESS: File removed then recreated — live watch is not restored

**Severity**: Low  
**Requirement**: DR-05 (live watch must remain functional through normal file lifecycle events)

**Issue**: When a watched file is deleted, `handleFileRemoved` (tv-native.js) correctly calls `stopWatch(tab)`, which invokes `unwatch_file` and removes the `RecommendedWatcher` from the HashMap. It also sets `tab.live = false`. If the file is then recreated at the same path (common in atomic-rename editor workflows when the file is briefly absent), no watcher is running and no `file-changed` event fires. The tab remains with stale content and `live: false` permanently. The user must close and reopen the file to resume live watch.

This affects the primary use case (DR-05): an AI process that occasionally replaces its output file atomically (delete + write) will cause the watcher to stop after the first replacement.

**Evidence**:
- `tv-native.js:167-186` (`handleFileRemoved`): calls `stopWatch(tab)` and `tab.live = false` — watcher is permanently stopped
- `lib.rs:194-200`: `EventKind::Remove` emits `file-removed`; no restart logic exists

**Fix**: After the `Remove` event fires and `stopWatch` is called, start a one-shot retry timer (e.g., 500ms) to check if the file has reappeared and re-invoke `startWatch(tab)` if it has. Alternatively, instead of fully stopping the watcher on `Remove`, keep the directory watcher active and listen for a subsequent `Create` event on the same path to auto-resume.

---

## N-11 — COMPATIBILITY: Mermaid 11.x blob: Web Workers blocked by CSP

**Severity**: Low  
**Requirement**: DR-02 (Mermaid diagrams must render correctly)

**Issue**: Mermaid 11.x uses Web Workers for layout computation on some diagram types (flowcharts with large node counts, sequence diagrams). Web Workers created from inline blob: URLs require `worker-src blob:` (or a CSP directive that allows it). The current CSP has no `worker-src` directive; it falls back to `script-src 'self'`, which blocks `blob:` worker creation. When a Mermaid diagram type that uses a blob: worker is encountered, the worker creation fails silently, and Mermaid falls back to synchronous main-thread rendering. For complex diagrams this can cause the UI to freeze for hundreds of milliseconds (violating DR-01's 300ms render budget). Less complex diagrams will still render correctly via the main-thread path, so this is not a complete failure — the fallback node-flow renderer would catch any outright `mermaid.render()` rejections.

**Evidence**:
- `tauri.conf.json:23`: no `worker-src` directive present
- `tv-markdown.js:392-393`: `window.mermaid.initialize({ startOnLoad: false, theme, securityLevel: 'strict' })`
- Mermaid 11.15.0 (`js/vendor/mermaid.min.js`, 3.2 MB) includes Web Worker spawn code for certain diagram types

**Fix**: Add `worker-src 'self' blob:` to the CSP in `tauri.conf.json:23`. This allows Mermaid to use its worker-based rendering path while restricting workers to the self origin and blob: (which Mermaid generates programmatically from bundled code, not from external URLs).

---

## Summary by Severity

| Severity | Count | IDs |
|----------|-------|-----|
| Critical / DATA LOSS | 1 | N-01 |
| High / Security or UX-Security | 3 | N-02, N-03, N-04 |
| Medium | 3 | N-05, N-06, N-07 |
| Low | 4 | N-08, N-09, N-10, N-11 |
| **Total** | **11** | |

**cargo check**: Passes clean. No Rust compile errors or warnings.

**Regressions from QA-REPORT.md Round 2**: None detected. All E-01 through E-15 and D-01 through D-08 resolutions were confirmed intact. E-08 partial (JS file-removed listener) is now fully resolved (tv-native.js:167-186 wires `handleFileRemoved` in `init()`).

---

## Priority Order for Build Department

1. **N-01** (Critical/DATA LOSS) — Add `if (tab.dirty) { showToast(...); return; }` guard before `tab.source` assignment in both tv-native.js:126 and tv-live.js:161.
2. **N-02** (High/Security) — URL-decode href before scheme test in tv-markdown.js:35 to close the `javascript%3A` bypass.
3. **N-03** (High/Security) — Block `file:` protocol links in tv-markdown.js:36.
4. **N-04** (High/UX-Security) — Add delegated `<a>` click handler in tv-app.js wireEvents() to open external URLs via `tauri-plugin-opener`. The plugin and capability are already loaded.
5. **N-06** (Medium) — Show a toast on save failure; do not silently exit edit mode.
6. **N-07** (Medium) — Add `base-uri 'none'` to CSP in tauri.conf.json.
7. **N-05** (Medium) — Add file size check before `read_to_string` to protect DR-04 RAM budget.
8. **N-09** (Low) — Show toast for binary/non-UTF8 drag-drop failures.
9. **N-08**, **N-10**, **N-11** (Low) — Address in a follow-up pass.

**QA Sign-off**: Blocked on N-01 (DATA LOSS), N-02 (security bypass), N-03 (security), N-04 (external links silently broken).
