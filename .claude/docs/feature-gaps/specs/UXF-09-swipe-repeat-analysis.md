# UXF-09 — Why the second swipe fails, and the fix

*Status: analysis 2026-10-08 · Follows UXF-05 (swipe) and UXF-08 (220 ms slide) · Owner feedback 2026-10-07: "Trackpad is better on the first swipe, but on the second it's still not very responsive."*

## Verdict

- **Root cause (proven):** the recogniser's only gesture boundary is a 160 ms silence in `wheel` events. macOS sends momentum events for 0.7–1.3 s after the fingers lift, and a new touch stops that momentum. The gap the page sees between the last momentum event and the second swipe is 32–81 ms, so the second swipe joins the first gesture. That gesture has already fired (`g.done`), so every event of the second swipe is ignored.
- **Shipped code, back-to-back:** 0/10 second toggles when the second swipe starts 100–500 ms after the first lift, 4/10 at 800 ms, 10/10 at 1200 ms. Five alternating swipes: 1 of 5 toggles happens.
- **Fix:** **Stage 1 now:** JS only (option A). A reversal inside a gesture that has already fired starts a new gesture, because momentum never reverses. Harness result: 190/190, with no extra toggles and no change in single-swipe behaviour. **Stage 2 (with the finger-following drag):** forward native touch phases from Rust as `swipe-touch` (option B′), so each finger touch is one gesture.

## How the evidence was gathered

| Piece | What |
|---|---|
| Native harness | The scratch `qa-galley` build of the current tree. Its embedded `TVSwipe.create` is identical to `app/js/tv-swipe.js`. A dylib is injected with `DYLD_INSERT_LIBRARIES` and runs it **headless**: window at (−20000, −20000), Accessory activation policy, never active, `_setWindowOcclusionDetectionEnabled:NO`. rAF ran at 60.3 fps off-screen. The owner's dev app was not touched. |
| Events | Real `NSEvent` scroll-wheel events with phases: began/changed/ended, may-begin, momentum begin/continue/end. They are delivered in AppKit order: an `NSEvent` local monitor first, then `-[WKWebView scrollWheel:]`. |
| Trackpad model | A fling of 150–210 px over 110–170 ms, released at speed. Momentum starts at the release speed and decays by 0.92–0.955 per frame, so tails last 0.7–1.3 s. A touchdown cancels momentum (as AppKit does), then may-begin, then the first movement 25–60 ms later. |
| Logs | Every DOM `wheel` event (t, `e.timeStamp`, dx, dy, target, `isOwned`) and every NSEvent (phase, momentumPhase, deltas). |
| Node replay | `replay9.js` feeds the recorded DOM streams through the real `tv-swipe.js` and through an instrumented copy of it. It reproduces the app's toggles in **80/80** trials, so the traces below are the shipped state machine's own decisions. |

Scratch files (session scratchpad, not in the repo) are in `/private/tmp/claude-501/-Users-clementozemoya-ai-projects-tiny-viewer/e187be5a-b2e5-4c84-b01e-dd688fd8e790/scratchpad/qa-native/`: `inject9.m` (harness and the B′/C prototypes), `qa9.py` (trackpad model), `run9.py` / `run9r.py` (trials), `replay9.js`, `synth9.js`, `tv-swipe-A.js`, `tv-swipe-B.js`, `res9-*.json`.

## Root cause — H1, momentum merges the second swipe (proven)

Hide, then show. Δ is the time from the hide swipe's lift to the show swipe's touchdown. 10 trials per row.

| Δ | Momentum 1, full length (ms) | Momentum 1, reached the DOM (ms) | DOM gap at the touch-2 onset (min–med–max ms) | Gap ≤ 160 ms | Second toggle (shipped) |
|---|---|---|---|---|---|
| 100 | 770–1192 | 93–101 | 43–59–81 | 10/10 | **0/10** |
| 200 | 701–1319 | 188–198 | 32–48–71 | 10/10 | **0/10** |
| 300 | 766–1218 | 286–301 | 36–51–70 | 10/10 | **0/10** |
| 500 | 733–1249 | 487–500 | 32–48–69 | 10/10 | **0/10** |
| 800 | 735–1274 | 575–794 | 40–108–262 | 6/10 | 4/10 |
| 1200 | 784–1320 | 619–1064 | 163–470–616 | 0/10 | 10/10 |

Trace of the shipped machine (`b2b100` #0, replayed). Hide fires at 171 ms. The show swipe's first event (dx −3 at 429 ms) arrives 61 ms after the last momentum event:

```
    171  +18   19   FIRE sx=-54
    368  +18   11   ignored: gesture already done     <- momentum of swipe 1, cut at touchdown
    429  +61   -3   ignored: gesture already done     <- swipe 2 starts: same gesture, already done
    452  +15  -24   ignored: gesture already done
  …every event up to 1153 ms: ignored
```

A gap of 32–81 ms cannot be told apart from timing noise by a threshold. Momentum and touch events arrive with a p99 gap of 30–42 ms and a maximum of 194 ms during a toggle stall (H4). Lowering `QUIET_MS` therefore cannot fix this.

## The other hypotheses

| # | Hypothesis | Verdict | Evidence |
|---|---|---|---|
| H2 | The 350 ms cool-down blocks the second swipe | **Refuted** as a cause | The cool-down returns `null` without setting `done`, so it delays a toggle but never drops one. A replay with correct touch boundaries plus the 350 ms cool-down gets 190/190. For Δ = 100 it adds up to about 80 ms. |
| H3 | Target ownership after the slide (ghost, sidebar, table under the pointer) | **Refuted** in general; true in one case | No touch onset over text was owned (0/600). `.tv-sidebar-ghost` has `pointer-events: none`. `.tv-body.tv-animating` is `overflow: hidden` and `.tv-side-scroll` is `overflow-x: hidden`, and neither counts as a scroller. **The case:** a table wider than the pane with the sidebar open but narrower without it is a scroller only while the sidebar is open (3 of 12 table widths in a probe: pane 930 px open, 1200 px closed). Over such a table, swipe-show works and swipe-hide never does, by the "scrollers win" design. |
| H4 | The toggle's main-thread work delays or drops wheel events | **Partly true, not the cause** | Dispatch stalls at the toggle reach 193 ms (p99 42 ms). WebKit coalesces the queued events: 26,556 non-zero events went in and 26,451 reached the DOM, with equal \|dx\| totals (one event carried 114 px). A stall longer than 160 ms splits a gesture. The re-fire is in the same direction and the state guard makes it a no-op. In that case the `e.timeStamp` gap was 83 ms. `e.timeStamp` follows the NSEvent time: median lag 0 ms, p99 20 ms. |
| H5 | WebKit hides what a JS heuristic needs | **Confirmed** | `WheelEvent` has no phase. WebKit stops zero-delta events from reaching the DOM ([Element.cpp](https://github.com/WebKit/WebKit/blob/main/Source/WebCore/dom/Element.cpp), "Events with no deltas…"), so may-begin, ended and momentum-end never arrive. Measured: 4,701 zero-delta events injected (600 ended, 360 may-begin, 600 momentum-end, 3,141 sub-pixel momentum) and 0 reached the DOM. Only native code can see "fingers down". |

## Results — every option, same harness

Toggles hit / expected (+ extra toggles). 10 trials per back-to-back row and 5 per single-swipe row.

| Scenario | Shipped | A (JS reversal) | C (native recogniser) | B′ (native touch phases → JS) |
|---|---|---|---|---|
| b2b Δ 100 / 200 / 300 / 500 ms | 10/20 each | 20/20 each | 20/20 each | 20/20 each |
| b2b Δ 800 / 1200 ms | 14/20 · 20/20 | 20/20 · 20/20 | 20/20 · 20/20 | 20/20 · 20/20 |
| rep: hide, hide again, show | 10/20 | 20/20 | 20/20 | 20/20 |
| alt5: 5 alternating, 150–700 ms apart | 10/50 | **50/50** | **50/50** | **50/50** |
| **All back-to-back** | **104/190 (55%)** | **190/190** | **190/190** | **190/190** |
| Single swipes, must toggle (a–f0, both directions, 14 kinds) | 70/70 | 70/70 | 70/70 | 70/70 |
| Must not toggle (vertical drift, ±30 px wiggle, over a wide table and at its edge, ⌃-wheel) | 25/25 quiet | 25/25 quiet | 25/25 quiet | 25/25 quiet |

Second-toggle latency from the onset of touch 2: median 45–66 ms for A, C and B′ (B′ median 50 ms, p90 66 ms), the same as the first toggle (48–63 ms). B′ phase messages travel by `evaluateJavaScript`, the same path as a Tauri `emit`, and add no measurable delay. Every run used a headless window and checked rAF at 60 fps before it started.

A node stress test (`synth9.js`, 200 seeded trials per row) covers cases the harness did not:

| Variant | Shipped | A |
|---|---|---|
| Momentum not cut at touchdown (both streams interleave) | 200/400 | 400/400 |
| 120 Hz event rate (ProMotion) | 203/400 | 400/400 |
| 1–6 px reverse jitter at lift, back-to-back | 200/400 | 400/400 |
| 1–6 px reverse jitter at lift, single swipe (must toggle once) | 200/200 | 200/200, no extra |

## Options

| | A — JS reversal onset | B′ — native touch phases, JS rules | C — native recogniser | D — finger-following drag |
|---|---|---|---|---|
| Fixes back-to-back | Yes (190/190). It relies on a physical fact: momentum never reverses. | Yes (190/190). One touch is one gesture by definition. | Yes (190/190) | Needs B′ |
| What it misses | A same-direction re-swipe inside a tail (a no-op anyway). A tail that follows a gesture over a scroller stays owned until it goes quiet. | Nothing seen | Nothing seen | — |
| Size | about 25 lines in `tv-swipe.js` plus tests | Rust about 60 lines plus JS about 40 | Rust about 90 lines plus JS veto | Large: a drag controller and settle physics, and it reworks the FLIP/ghost slide |
| Risk | Low; one module | Medium: the first `objc2` code in `lib.rs`, an unsafe block, a monitor for the app's life | Medium. Gesture rules live in Rust, which has no test suite. | High |
| Testability | Node, with the existing harness pattern | Node (touch path) plus the native harness | Needs new `cargo test` | Native harness only |
| DR-04 cost | none | One `emit` per touch event, only during the first 1000 ms of a touch, never for momentum: median 10 and at most 12 per swipe; at most about 62 (60 Hz) for a long reading scroll messages per touch | One `emit` per swipe | As B′, for the whole touch |
| "Scrollers win" | Unchanged: ownership is read at every gesture onset | `elementFromPoint` at the touch-down point | The same, in JS | The same |
| 220 ms slide | Unchanged. A reversal mid-slide finishes the slide and starts the next (UXF-08 interruption). | Unchanged | Unchanged | Replaced by a tracked drag |

**Local monitor feasibility (B′/C):** events posted through the app's event queue (`[NSApp postEvent:]`) reached an `NSEvent addLocalMonitorForEventsMatchingMask:handler:` monitor 59/59 times, carrying `phase`, `momentumPhase` and precise deltas. The trials then ran the monitor and `-[WKWebView scrollWheel:]` in AppKit's order. With the monitor returning each event unchanged, the page scrolled normally and the wide table scrolled in 20/20 "over the table" trials. The objc2 bindings are already in `Cargo.lock` through tao/wry (`objc2` 0.6.4, `block2` 0.6.2, `objc2-app-kit` 0.3.2 `NSEvent::addLocalMonitorForEventsMatchingMask_handler`), so this adds no new crates, only features. Tauri and wry do not expose wheel phases themselves.

## Implementation (2026-10-08) — both stages shipped

- **Stage 1, `app/js/tv-swipe.js` (wheel path, also the browser fallback):** the reversal onset as designed (`REV_MS` 80, `REV_PX` 10, ownership and blocked state re-read at the onset, seeded with the reversed events), `COOLDOWN_MS` 350 → 200. Single-swipe rules unchanged.
- **Stage 2, B′:** `lib.rs` installs an `NSEvent` local monitor for `ScrollWheel` on the main thread from `setup()` (`objc2` / `block2` / `objc2-app-kit`, features only, already in the lock file). It returns every event unchanged and forwards finger phases only (`swipe_phase`: may-begin/began → `began`, changed, ended, cancelled; momentum and phase-less wheels dropped) as `swipe-touch` `{ phase, t, dx, dy, precise, inverted, x, y, mods }`. `SwipeForwarder` coalesces `changed` to one message per 16 ms (deltas summed, nothing lost) and only for the first 1,000 ms of a touch: about 8 messages per swipe in the harness. `tv-native.js` forwards it to `TVSwipe.touch()`: one touch is one gesture, and while the stream is live (a message in the last 300 ms) the wheel path stands down. An `onTrack` hook reports the running distance, the seam for the finger-following drag (D, not built).
- **Found by the native harness:** AppKit's `began` event already carries the first movement. Dropping it made a 53 px flick count as 47 px (2 of 95 single swipes missed); `touch()` now counts it.
- **Results:** node replay of the recorded streams (`.claude/docs/feature-gaps/fixtures/uxf09-swipe-streams.json`): shipped rules 94/190, wheel path 190/190, touch path 190/190, 0 extra. Off-screen `qa-galley` harness (AppKit dispatch, so the Rust monitor runs): 190/190 through `swipe-touch`, 190/190 with the monitor bypassed (wheel path alone), single swipes 95/95, wide table still scrolls.

## Recommendation

**Stage 1 (ship now): option A.** It is proven against the cause, it is one file, and it keeps the node-testable state machine. **Stage 2: option B′, built together with D** when the finger-following drag is wanted. B′ is the stream D needs, and it removes the last timing inference. Choose B′ over C because the gesture rules stay in one JS module with tests, and Rust stays a phase forwarder with no rules.

### Stage 1 design (`app/js/tv-swipe.js`)

Constants: keep `QUIET_MS 160`, `WINDOW_MS 250`, `AXIS_MS 100`, `AXIS_RATIO 1.3` and `TRIGGER_PX 48`. Change `COOLDOWN_MS` from 350 to **200**. New: **`REV_MS 80`** and **`REV_PX 10`**.

```
feed(ev):
  onset = !g || t - lastT > QUIET_MS                          // as today
  if !onset and g.firedSign:                                  // the gesture already toggled
    g.rev += {t, fdx};  keep the last REV_MS
    if Σ g.rev.fdx points against g.firedSign by ≥ REV_PX:    // momentum never reverses → a new touch
      onset = true;  seed = the reversed g.rev entries before this event
  if onset: g = { recent: seed or [], owned: isOwned(target), done: false, firedSign: 0 }  // ownership read again
  … the rules are unchanged; on FIRE set g.firedSign = sign(sx)
```

Optional hardening (H4): measure time with `e.timeStamp` instead of the dispatch time, so a toggle stall does not split a gesture. In the data, the stall was 193 ms by dispatch time and 83 ms by `e.timeStamp`.

### Stage 2 design (B′)

| Layer | Change |
|---|---|
| Rust `lib.rs` `setup` | `#[cfg(target_os = "macos")] install_swipe_monitor(app.handle())`. A local monitor with mask `ScrollWheel` that drops events where `momentumPhase != None` or `phase == None` (a mouse wheel), keeps only the main window, and returns the event unchanged. It emits `swipe-touch` on may-begin/began (`begin`, with the location in CSS px), on changed (`move`, only during the first 1000 ms of the touch) and on ended/cancelled (`end`). The monitor lives for the app's life. |
| Payload | `{ phase: "begin"|"move"|"end", t: f64 ms, dx: f64 (finger, sign by isDirectionInvertedFromDevice), dy: f64, x: f64, y: f64, mods: bool }` |
| `NATIVE-CONTRACT.md` § Events | Add the `swipe-touch` row as above. Note: never sent for momentum or mouse wheels; macOS only. |
| `tv-native.js` | `listen('swipe-touch', e => TVSwipe.touch(e.payload))` |
| `tv-swipe.js` | `touch(m)`: one touch is one gesture. Ownership comes from `elementFromPoint(x, y)` at `begin`, and the same thresholds apply. The first `touch()` call turns off the wheel path's toggling; the browser build keeps A. |
| Cargo | macOS target deps `objc2 = "0.6"`, `block2 = "0.6"`, `objc2-app-kit = { version = "0.3", features = ["NSEvent", "block2", "objc2-core-foundation"] }` |

## Change list

Stage 1: `app/js/tv-swipe.js` (the rule above). `app/js/tv-swipe.test.js`: replace criterion-10 test 1, add a seeded back-to-back generator (the qa9 trackpad model) and two inline recorded traces (b2b100, alt5). Amend `UXF-05` criterion 10: "A swipe in the other direction that starts while the first swipe's momentum still runs toggles back. A same-direction swipe does nothing." Stage 2: `tauri-app/src-tauri/Cargo.toml`, `src/lib.rs`, `NATIVE-CONTRACT.md`, `app/js/tv-native.js`, `app/js/tv-swipe.js`, and tests (`tv-swipe.test.js` touch path, plus a `tv-native.runtime.test.js` guard that reads `swipe-touch` from `lib.rs`).

## Test strategy and targets

1. **Node (author):** `tv-swipe.test.js` back-to-back generator, Δ 100–1200 ms × 50 seeds: second toggle 100%, extra 0. Single-swipe acceptance items 6–11 unchanged.
2. **Native harness (qa-dept, headless, as above):** `run9.py cur,A b2b100,…,b2b1200,rep,alt5 10` needs **≥ 98% hits and 0 extra**. `run9r.py` a–j2 must match shipped (all must-toggle hit, every must-not quiet), and the table must still scroll.
3. **Replay:** commit no fixture under `app/` (`frontendDist` embeds it). Keep recordings in `.claude/docs/` or generate them with the seeded model.
4. **Owner check on the real trackpad:** hide → show at a natural pace, 10 times; and 5 alternating swipes.

## Risks

- **The model is not real hardware.** The harness generates AppKit-style phases and momentum. On a real trackpad the momentum curve and the touchdown delay differ, but A depends only on momentum never reversing and on a 48 px swipe moving ≥ 10 px in 80 ms. **Expected real-trackpad hit rate for a back-to-back reversal: ≥ 95%.** Same-direction repeats remain a no-op by design.
- **A 60 px back-and-forth inside one touch can toggle twice** under A (C and B′ treat one touch as one gesture). The 200 ms cool-down limits this to one flip per 200 ms.
- **Tables that only overflow with the sidebar open** still swallow swipe-hide (H3), by design. If the owner reports it, the option is "a scroller at its edge in the swipe direction yields".
- **B′:** an `unsafe` block, and the first objc2 use in `lib.rs`. The monitor must return the event (never `nil`), or scrolling breaks.
