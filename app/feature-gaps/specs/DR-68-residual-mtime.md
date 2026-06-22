# DR-68 Residual — Live-Watch Open-Time Recency Uses Wrong Clock

*UxPipeline **Step 3 (Problem Definition)** supplement to `app/feature-gaps/waad-grounded-requirements.md` Part 4 "Live-Watch Recency Label". This spec closes the single open residual identified in the DR-68 Iteration note (2026-06-21): a just-opened static file shows the recency bar for its first 90 s because the recency clock is seeded from open time rather than the file's real on-disk last-modified timestamp.*

**Status:** CLEAR — implementable with zero open product questions.

---

## Title & Scope

Correct the recency clock source for the live-watch status bar (DR-65–DR-71) so that on tab open the clock is seeded from the file's real on-disk `mtime` (last-modified time) instead of `Date.now()`. This is purely a data-plumbing correctness fix: no visual change to the bar, blip, or bolt — only the **time from which elapsed is measured** changes.

Scope: Rust `watch_file` event plumbing; JS open and session-restore paths; session-restore `tab.lastModTime` seeding. Does NOT change DR-65–DR-71's bar appearance, auto-hide threshold (90 s), tick cadence, or any CSS.

---

## URD Tie-Back

**Primary — URD-10 (Real-Time File Watch):**
> "When AI tools stream output to a .md file, users need the viewer to update in real-time… watching the document grow live… a zero-to-one capability gap." (WANs 037/049/072; WAAD Cluster F2 "Live streaming file-watch missing"; Work Role 1 AI Content Reviewer.)

DR-70 (already ratified) requires the recency clock to measure time since `lastModTime` (last disk change), not since tab-open or launch. The residual is that on open, `lastModTime` is set to `Date.now()` when no real mtime is available — violating DR-70 for every file that was last modified before the open moment.

**Secondary — URD-02 (RAM & Performance):**
> "Tauri/native approaches achieve 30–40 MB." The fix must not add a polling loop or extra I/O beyond one `metadata()` call per file open (already made during `read_file_doc()`).

---

## Problem Statement

The AI Content Reviewer needs the live-watch indicator to open in the correct state for each file — pulsing only when the file is genuinely fresh — because a false "active" signal on a static file undermines trust in the live-watch feature (URD-10 trust sub-need: "is it actually live, and how fresh is what I'm reading?").

**HMW:** How might we make the recency bar reflect the actual time since the last disk change at open, not the time since the tab was opened, so a static file opens settled (no bar) and a just-written file opens pulsing?

---

## Current State Analysis

### What is already implemented

1. `FileDoc` struct in `lib.rs` already has `pub modified: Option<u64>` (epoch ms), and `read_file_doc()` already calls `std::fs::metadata(&pb).and_then(|m| m.modified()).ok().and_then(|t| t.duration_since(UNIX_EPOCH).ok()).map(|d| d.as_millis() as u64)` — the mtime is available in every `FileDoc` response.

2. `tv-native.js openInto()` (line 142) already seeds `tab.lastModTime = doc.modified` when a file is opened via the file picker, folder open, drag-drop, or Finder "Open With" path.

3. `tv-live.js start()` (line 524) already reads `tab.lastModTime` when creating `watchState`: `lastModTime: (typeof tab.lastModTime === 'number' ? tab.lastModTime : Date.now())`. A tab seeded with a real mtime correctly derives elapsed on first paint.

4. Poll mode in `startPollingMode()` (lines 400–415) already reads the real `file.lastModified` from the FileSystem API handle at open time and seeds both `watchState.lastModTime` and the poll-loop baseline — the browser-mode path is fully correct.

### The actual gaps (true residuals)

**Gap 1 — Session restore does not seed `lastModTime`.**
`tv-app.js` session restore (line 4424) calls `invoke('read_md_file', { path: ePath })` which returns a full `FileDoc` including `modified`, but the restored `newTab` object never receives `doc.modified` as `lastModTime`. `tv-live.js start()` then falls back to `Date.now()`, making every session-restored tab appear freshly modified on relaunch.

**Gap 2 — Session restore does not set `tab.live = true` or call `TVLive.start()`.**
The session restore loop (lines 4430–4460) creates `newTab` via `makeTab()` but never sets `newTab.live = true`. Without `tab.live`, `TVLive.start()` is never called for the restored tab (the post-render loop at line 4370 gates on `t.live`). Session-restored native tabs get no live watch at all today — they silently lose file-watch coverage on relaunch.

**Gap 3 — `FileChanged` event payload does not carry `modified`.**
When the Rust watcher emits `file-changed`, the `FileChanged` struct only carries `{ path, content }` — no mtime. `onFileChange()` in `tv-live.js` therefore stamps `watchState.lastModTime = Date.now()`, which is semantically correct (the change was just detected) but could drift slightly from the actual on-disk mtime if the FS event is delayed. This is an acceptable approximation for in-session changes (the detected-change moment is the user-relevant event), but carrying mtime would enable exact accuracy. This is a Should-level improvement (DR-119), not a Must.

**Gap 4 — "Reload from Disk" (DR-76) does not refresh `tab.lastModTime`.**
After a reload, `tab.lastModTime` retains its prior value. The next `TVLive.refresh()` call will call `onFileChange` which stamps `Date.now()`, but there is a brief window where the bar shows stale recency. Low severity.

---

## Decision

**Build — seed `lastModTime` from `doc.modified` in every path that calls `read_md_file`, and set `tab.live = true` for session-restored native tabs.** No new Rust commands, no new JS polling, no visual changes. Specifically:

1. **Session restore** (tv-app.js ~line 4435): after `makeTab()`, add `if (typeof doc.modified === 'number') { newTab.lastModTime = doc.modified; }` and `newTab.live = true;`. The existing post-render `TVLive.start()` loop (line 4370) already gates on `t.live`, so Gap 2 is fixed with one line.

2. **`FileChanged` payload** (lib.rs `FileChanged` struct + watch_file handler): add `pub modified: Option<u64>` to `FileChanged`; in the `Modify | Create` arm, after reading `new_content`, call `std::fs::metadata(&target_clone).and_then(|m| m.modified())...` to populate it. In `tv-native.js handleFileChanged`, pass `payload.modified` to `TVLive.notifyChange(tabId, payload.modified)` / `TVLive.refresh(payload.modified)`, and extend `tv-live.js onFileChange(watchState, ts)` to stamp `watchState.lastModTime` from `ts` when present. **Do not update `tab.lastModTime` here** — `tab.lastModTime` is seed-only (consumed once by `TVLive.start()` to init `watchState.lastModTime`); after `start()` runs, `watchState.lastModTime` is the authoritative in-session clock, so a `tab.lastModTime`-only update in `handleFileChanged` is a no-op. This is the Should-level precision improvement (DR-119).

3. **Reload from Disk** (tv-app.js `reloadActiveTab` / DR-76 handler): after `invoke('read_md_file')`, seed `tab.lastModTime = doc.modified` when present, then call `TVLive.refresh()` (already happens today for the re-render).

The open-time seeding in `openInto()` is already correct and needs no change.

---

## DR Table

| DR | Requirement | URD | MoSCoW |
|----|-------------|-----|--------|
| DR-116 | On session restore, each restored native tab must have `tab.lastModTime` set from `doc.modified` (epoch ms from `read_md_file`) before `TVLive.start()` runs, so a static file opens settled (no bar) and a recently written file opens pulsing. | URD-10, URD-04 | Must |
| DR-117 | On session restore, each restored native tab must have `tab.live = true` set so the post-render `TVLive.start()` loop arms the file watcher — session-restored tabs must be live-watched, not silently unwatched. Side effect: an N-tab session triggers N concurrent `watch_file` calls at relaunch. This is consistent with the existing per-tab watcher model (each tab already calls `watch_file` on its first open). N-08 (coalesce to one FSEvents stream per directory) remains deferred and out of scope for this spec. | URD-10, URD-04 | Must |
| DR-118 | The "Reload from Disk" path (DR-76) must update `tab.lastModTime` from the `modified` field of the `FileDoc` returned by `read_md_file`, so the recency bar reflects the reload's mtime rather than a stale pre-reload value. | URD-10 | Should |
| DR-119 | The `FileChanged` Rust event payload must carry a `modified: Option<u64>` field (epoch ms of the on-disk mtime at change time). When present, `tv-native.js handleFileChanged` must pass it as a timestamp argument to `TVLive.notifyChange(tabId, ts)` / `TVLive.refresh(ts)`, and `tv-live.js onFileChange(watchState, ts)` must use it in place of `Date.now()` to stamp `watchState.lastModTime` — so the authoritative in-session clock uses the real disk mtime rather than event-receipt time. Falling back to `Date.now()` when `modified` is absent or zero. Note: `tab.lastModTime` is a seed-only field consumed once by `TVLive.start()` to init `watchState.lastModTime`; after `start()` runs, `watchState.lastModTime` is the authoritative in-session clock — a `tab.lastModTime`-only update in `handleFileChanged` is therefore a no-op and must not be used as the DR-119 implementation. | URD-10, URD-02 | Should |
| DR-120 | When `doc.modified` is absent (`None` / `null` / `undefined`) at open or restore time — due to permission failure, network volume, or platform limitation — the clock MUST fall back to `Date.now()` and no error or toast is surfaced; the watch still arms normally. | URD-02, URD-08 | Must |

---

## Acceptance Criteria

All criteria are measurable without mocking the file system, using real disk files.

**AC-1 (static file, open via picker):**
Open a file whose on-disk mtime is > 90 s ago (e.g. any file last modified an hour ago). Result: no live status bar appears; no live bolt icon appears in the tab strip. The file is still watched (a subsequent write re-shows the bar within 1 s).

**AC-2 (fresh file, open via picker):**
Open a file written within the last 5 s (e.g. `touch /tmp/test.md && open with picker`). Result: status bar appears pulsing with "updating…" or "updated Ns ago"; bolt icon visible in tab strip.

**AC-3 (session restore, static file):**
Open a static file (mtime > 90 s), quit, relaunch. Result: no bar, no bolt on the restored tab. The tab is still live-watched — write to the file → bar appears within 1 s.

**AC-4 (session restore, fresh file):**
Arrange a file modified within the last 10 s, open it, immediately quit and relaunch within the 90 s window. Result: bar shows on the restored tab with elapsed ≥ the time since actual modification (not 0 s from relaunch).

**AC-5 (stream writes — bar resets):**
Open a file, write to it via `echo "x" >> file.md`, confirm the bar resets to "updating…" and the bolt re-lights within 1 s. Write again after 95 s of silence — bar re-appears pulsing.

**AC-6 (mtime unavailable):**
Simulate `modified = None` from Rust (or `doc.modified = undefined` in JS) by testing from a network-mounted volume that does not expose mtime. Result: bar appears (clock seeds from `Date.now()`), no error toast, no crash.

**AC-7 (reload from disk):**
With a file open > 90 s since last write, trigger "Reload from Disk". Result: bar does not reappear (mtime is old, isRecent() remains false); `tab.lastModTime` reflects the reloaded mtime.

---

## Out of Scope

- **No visual change** to the bar, blip, bolt, or CSS (DR-65–DR-71 already define all appearance).
- **Absolute timestamps** in the bar (relative format only, per DR-66).
- **Server-side mtime propagation** — the fix only applies to local disk files that `std::fs::metadata()` can read.
- **Sub-second mtime precision** — epoch ms is sufficient; no nanosecond handling.
- **Cross-device mtime sync** — cloud-synced files (iCloud Drive, Dropbox) may expose the synced mtime, not the local-write mtime; this is documented as a known caveat, not a bug.
- **Watcher session-level mtime polling** — change events use event-receipt time via `Date.now()` unless DR-119 is also implemented; either is acceptable for in-session accuracy.
- **N-08 optimization** (one FSEventStream per directory instead of per tab) — not in this spec.

---

## Implementation Notes

### Rust — `FileChanged` struct (DR-119, Should)

```rust
// In src/lib.rs — extend FileChanged
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FileChanged {
    pub path: String,
    pub content: String,
    /// File mtime at change time, epoch ms; None if metadata() fails.
    pub modified: Option<u64>,
}
```

In the `Modify | Create` arm of the watcher callback, after reading `new_content`:

```rust
let modified = std::fs::metadata(&target_clone)
    .and_then(|m| m.modified())
    .ok()
    .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
    .map(|d| d.as_millis() as u64);

let _ = app_handle.emit("file-changed", FileChanged {
    path: path_clone.clone(),
    content: new_content,
    modified,
});
```

Cost: one extra `metadata()` syscall per detected write, already within the watcher callback that just did a `read_to_string`. Negligible. The `modified` field is `Option<u64>` so failure is silent.

### JS — `tv-app.js` session restore (DR-116, DR-117, Must)

In the `.then(function (doc) { ... })` block inside `readSessionNext()` (after `newTab.nativePath = doc.path || ePath;`), add:

```js
// DR-116: seed recency clock from real mtime so static files open settled.
if (typeof doc.modified === 'number') { newTab.lastModTime = doc.modified; }
// DR-117: mark as live so the post-render TVLive.start() loop arms the watcher.
newTab.live = true;
```

The existing post-render loop at line 4369–4372 (`if (t.live) TVLive.start(t.id)`) already handles arming the watcher — no further change needed there.

### JS — `tv-native.js` `handleFileChanged` + `tv-live.js` `onFileChange` (DR-119, Should)

**Why `tab.lastModTime` alone is insufficient:** `tab.lastModTime` is a seed-only field — `TVLive.start()` reads it once to initialise `watchState.lastModTime` when the watch begins. After `start()` completes, `watchState.lastModTime` is the authoritative in-session clock (stamped by `onFileChange` on every detected change). Setting `tab.lastModTime` inside `handleFileChanged` does not reach `watchState.lastModTime` and is therefore a no-op for live recency.

**Canonical approach:** thread the disk mtime through the call chain so `onFileChange` can use it instead of `Date.now()`.

Step 1 — extend `tv-live.js onFileChange` to accept an optional timestamp:

```js
function onFileChange(watchState, ts) {
    watchState.lastModTime = (typeof ts === 'number' && ts > 0) ? ts : Date.now();
    // ... rest of function unchanged
}
```

Step 2 — in `tv-native.js handleFileChanged`, pass `payload.modified` when calling into TVLive:

```js
// Active tab path — pass disk mtime so watchState.lastModTime uses the real value.
if (window.TVLive && typeof TVLive.refresh === 'function') {
    TVLive.refresh(payload.modified);  // refresh() threads ts → onFileChange
}
// Background tab path:
if (window.TVLive && typeof TVLive.notifyChange === 'function') {
    TVLive.notifyChange(tab.id, payload.modified);  // threads ts → onFileChange
}
```

Step 3 — thread `ts` through `TVLive.refresh(ts)` and `TVLive.notifyChange(tabId, ts)` in `tv-live.js` so `onFileChange(watchState, ts)` receives it. Poll mode's `onFileChange` calls (lines ~347, ~359) pass no `ts` — they correctly continue using `Date.now()` since `file.lastModified` is already applied to `watchState.lastModTime` directly in `startPollingMode`.

Fallback: if `payload.modified` is absent, zero, or `undefined`, `onFileChange` falls back to `Date.now()` — identical to pre-DR-119 behaviour.

### JS — Reload from Disk (DR-118, Should)

In `reloadActiveTab()` (tv-app.js ~line 4484), after `invoke('read_md_file')` resolves:

```js
if (typeof doc.modified === 'number') { tab.lastModTime = doc.modified; }
```

### Cross-Platform Caveats

- **macOS (primary target):** `std::fs::metadata().modified()` always succeeds for local files. APFS and HFS+ expose mtime.
- **Network volumes (AFP, SMB, NFS):** mtime may be unavailable (`SystemTimeError`) or coarse-grained (1 s or 2 s resolution). DR-120 fallback (`Date.now()`) applies.
- **iCloud Drive "evicted" files:** `modified()` may reflect the cloud mtime, not the local cache time. The bar shows the cloud-reported mtime, which may be accurate or slightly ahead of the local write event. Acceptable caveat.
- **Sandboxed builds:** `std::fs::metadata()` on the watched file is covered by the same file-system entitlement that `read_to_string()` already requires. No additional entitlement needed.

### Clock-Skew Note

`watchState.lastModTime` is compared against `Date.now()` (JS wall clock) in `isRecent()` and `paintRecency()`. The Rust mtime is read from the OS via `SystemTime`, which on macOS is UTC-based and congruent with the JS `Date.now()` epoch. Clock skew between these two is zero (same process host). However, on network volumes the mtime timestamp is provided by the server, which may have clock drift relative to the local machine. In pathological cases a server mtime could be slightly in the future, causing `delta` to be negative and `formatRecency()` to return `"updating…"`. No crash, but the bar would show as permanently active until a real local change is detected. This is an acceptable edge case for network-volume users; no mitigation required.

---

*Prepared via UxPipeline Step 3. DR-116–DR-120 are certified crystal-clear and build-ready as engineering inputs. Zero open product questions.*
