# UXF-08 — Motion system

*Status: specified 2026-10-06 (iteration 2) · Priority: Should (sev 2) · Supersedes the "no animation" lines of UXF-05 · Owner files: `app/css/tv-tokens.css`, `app/css/tv-app.css`, `app/js/tv-motion.js` (new), `app/js/tv-app.js`, `app/js/tv-palette.js`, `app/js/tv-search.js`*

## Why

Owner: "We need transitional animations for the swipe to reveal or hide the sidebar. Honestly, I think the entire application could use a few animations here and there to smooth things out; it's looking a bit stiff. I want the user experience to be perfect."

The app has 40 or so ad-hoc transitions and keyframes in `tv-app.css`, each with its own duration (.1 s to 1.4 s) and easing, and no shared tokens. Meanwhile the moments that matter most snap: the sidebar, overlays opening, a new tab, edit mode, theme. This spec does two things: one token set that every motion uses, and a decision for every state change (animate, or deliberately not).

## Tie-back

URD-08 (quiet chrome: motion that explains, never decorates), URD-01 (no attention cost), URD-02 (speed and RAM). DR-03 and DR-10 (no scroll animation on restore or live update), DR-09 (tab switch under 50 ms), DR-07. Heuristic H1 (visibility of system status: motion shows where a thing came from).

## Principles (from the research, stream 6)

1. **Purposeful.** Motion supports the experience without overshadowing it; it is optional and cancellable (Apple HIG, Motion).
2. **Not for frequent actions.** "Generally avoid adding motion to UI interactions that occur frequently" (HIG). Tab switch, tab close, row selection, scrolling: no motion.
3. **Short.** 100 to 400 ms; about 100 ms feels immediate; 500 ms drags (NN/g). Enter slower than leave. Linear's own tokens: instant, 100, 150, 250, 350 ms.
4. **Spatial.** Motion says where something came from (a drawer slides from its edge), not decoration (Linear).
5. **No bounce.** Springs with zero bounce; linear motion looks non-physical for movement (WWDC23). A critically damped cubic-bezier is the web equivalent.
6. **Compositor only.** Animate `transform` and `opacity`. Never width, height, top, left, margin or padding (FLIP, Aerotwist).
7. **Reduce Motion means no movement.** WKWebView maps macOS Reduce Motion to `prefers-reduced-motion` (WebKit blog). Here: no transform, and at most an 80 ms opacity fade where an element would otherwise pop.
8. **Complete at rest.** Animation runs on top of the final DOM. Content is visible and interactive on the first frame.

## Tokens (`tv-tokens.css`)

```css
:root {
  --tv-dur-fast: 100ms;    /* hover, press, chevron, menus, palette / search / find bar enter, mode crossfade */
  --tv-dur-base: 160ms;    /* toast in, shortcuts overlay, new tab pill, theme crossfade, image fade */
  --tv-dur-slow: 220ms;    /* sidebar slide (the one big movement) */
  --tv-dur-exit: 120ms;    /* anything that exits and can be seen leaving (toast out) */
  --tv-dur-highlight: 1200ms; /* attention pulses: reveal ring, flash. Not a transition. */
  --tv-ease-enter: cubic-bezier(.2, .7, .2, 1);    /* appearing: decelerate */
  --tv-ease-exit:  cubic-bezier(.4, 0, 1, 1);      /* leaving: accelerate */
  --tv-ease-move:  cubic-bezier(.32, .72, 0, 1);   /* travelling: critically damped, no overshoot */
  --tv-fade-reduced: 80ms; /* the only motion allowed under Reduce Motion */
}
@media (prefers-reduced-motion: reduce) {
  :root { --tv-dur-fast: 0ms; --tv-dur-base: 0ms; --tv-dur-slow: 0ms; --tv-dur-exit: 0ms; --tv-dur-highlight: 0ms; }
}
```

Rules for CSS:
- Every `transition` and `animation` duration is a token, except the allowed list: the looping live and loading indicators (`tv-pulse`, `tv-blink`, `tv-blip`, `tv-shim`, `tv-drag-pulse`), the 6 s large-file banner dismiss, and the two highlight keyframes (which use `--tv-dur-highlight`).
- No `transition: all`. List the properties.
- Motion lives in `@media (prefers-reduced-motion: no-preference)`. The `reduce` block lists the few opacity fades kept at `--tv-fade-reduced` (palette, search, shortcuts overlay, find bar).
- Hover and press colour changes use `--tv-dur-fast` with `--tv-ease-enter`.

`tv-motion.js` (new, about 60 lines, no DOM dependency except `matchMedia` and `getComputedStyle`): `TVMotion.reduced()`, `TVMotion.dur(name)` (reads the token), `TVMotion.play(el, keyframes, { dur, ease })` which returns the `Animation` or `null` under Reduce Motion, plus `TVMotion.cancelAll(group)`.

## The constraint that shapes the technique

`render()` replaces the whole of `#tv-root`'s `innerHTML`. Consequences, as rules:

| Situation | Works? | Rule |
|---|---|---|
| CSS `transition` between two states of an element | no: the element is replaced, there is no "before" | do not rely on it, except `:hover` and `:focus` (same element for the duration) |
| `@keyframes` on a node that was just inserted | yes | use it for every enter effect |
| Exit animation of a node `render()` removes | no | exits exist only for nodes that own their lifecycle (toasts, the sidebar ghost below) |
| A view that persists across renders | yes | `#tv-toasts`, `#tv-live-region`, overlays appended to `.tv` |
| Browser-managed snapshots | yes where supported | `document.startViewTransition` for the theme crossfade only |

## Sidebar show and hide

**Technique: FLIP on transforms, with a ghost for the exit.** The layout changes once, at t = 0 (one reflow, as today). Two or three transform animations then hide the jump. The reading column never reflows during the animation, so there is no text-reflow jank, no per-frame table sizing (UXF-01) and no per-frame layout.

Let `S` = the sidebar width (measured `getBoundingClientRect().width` of the sidebar before hiding; `state.sidebarWidth` before showing). Let `delta` = **measured** First minus Last: the horizontal centre of `.tv-viewer` before the toggle minus its centre after the render (FLIP; do not compute it as `S / 2`).

```
Show (the final layout is already rendered):
  sidebar : translateX(-S) -> none          220 ms --tv-ease-move
  viewer  : translateX(delta) -> none       220 ms --tv-ease-move   // delta is negative: the centred column glides right
Hide (before render, clone the old sidebar):
  ghost   : none -> translateX(-S)          220 ms --tv-ease-move   // clone sits at left:0, width S, over .tv-body
  viewer  : translateX(delta) -> none       220 ms --tv-ease-move   // delta is positive: the column glides left
```

Why measured: the viewer's width changes by `S` plus the 12 px drag handle that has a net 6 px (`margin-left: -6px`), so its centre moves by `(S + 6) / 2` (135 px for `S` = 264), not `S / 2`. Using `S / 2` leaves a 3 px jump on frame 0. **Prototype result (headless Chrome, 1440 × 900):** with the measured delta, the text column's left edge is 495 px before the toggle and 495 px on frame 0, then glides to 360 px (hide) and back (show); `.tv-viewer` width stays 1440 (hide) or 1170 (show) on every sampled frame; the sidebar slides from -264 to 0; no ghost or animation remains afterwards.

Steps in `toggleSidebar(opts)`:
1. `animate = opts.animate !== false && !TVMotion.reduced() && this is a user action`. Not animated: first paint, the responsive auto-open (≥ 1,440 px) or auto-collapse, session restore, window resize.
2. FIRST: note the centre of `.tv-viewer`; if hiding, also `ghost = sidebarEl.cloneNode(true)` and note its inner scroll offset.
3. `state.sidebarOpen = !state.sidebarOpen; render();` inside a one-shot `TV.on('render')` listener (so a batched render is measured after it happens).
4. LAST / INVERT / PLAY (compute `delta` from the viewer's centre now vs the centre noted in step 2) with `TVMotion.play` on the new nodes (`will-change: transform` set before, removed on `finish`). `.tv-body` gets `.tv-animating` (`overflow: hidden`) so the translated viewer never creates a horizontal scrollbar; the ghost is `position: absolute; left: 0; top: 0; height: 100%; width: S; pointer-events: none` with `aria-hidden="true"`; its inner scroll offset is re-applied with CSSOM.
5. Cleanup on `finish` or `cancel`: remove ghost, remove `.tv-animating`, clear `will-change`.
6. Interruption: a second toggle while one runs calls `finish()` on the running animations first (jump to end), then starts the new one. A `render()` for any other reason mid-animation cancels it silently; cleanup still runs.
7. The resizer (12 px) and the keyboard cursor are not animated.

**The swipe is a triggered slide, not a finger-following drag (decision).** A `wheel` event has no begin, end or cancel: it is a stream of deltas followed by a momentum tail, and the web exposes no gesture phase. A follow-the-finger sidebar needs to know when the fingers lift and whether to settle or return; without that it can stick half open, and the layout has only two states anyway. The swipe therefore fires the same 220 ms slide as the button the moment its 80 px threshold is crossed (UXF-05). The interactive version needs native scroll phases (NSEvent `phase` and `momentumPhase`) forwarded from Rust, which is a separate, larger change; it is listed as a follow-up, not specified here.

## The audit: every state change

Duration, easing and property per row. "Static" is a decision, with its reason.

| # | Moment | Today | Decision | Spec |
|---|---|---|---|---|
| 1 | Sidebar show (button, ⌘B, menu, palette, swipe, open-folder, reveal) | snap | **Animate** | slide as above, 220 ms `--tv-ease-move`, transform |
| 2 | Sidebar hide (same routes) | snap | **Animate** | ghost slide as above |
| 3 | Sidebar auto-open and auto-collapse, session restore | snap | Static | not a user action; resize must not animate |
| 4 | Tab switch | snap | **Static** | DR-09 under 50 ms; frequent (HIG) |
| 5 | New tab appears | snap | **Animate** | the new pill only: opacity 0 to 1, 160 ms `--tv-ease-enter`; other tabs do not move |
| 6 | Tab close, close others | snap | Static | frequent; ⌘W repeated must feel instant |
| 7 | Tab drag reorder | existing | Keep | tokenise the existing transition |
| 8 | Hover and press on rows, buttons, tabs | .10 to .15 s | **Tokenise** | 100 ms `--tv-ease-enter`, colour only |
| 9 | Folder expand and collapse | chevron .14 s | **Chevron only** | rotate 100 ms; rows appear at once (a 100-row subtree animated by height is per-frame layout) |
| 10 | Selection tint on a sidebar row | none (DOM replaced) | Static | cannot persist; instant is correct |
| 11 | Command palette open | snap | **Animate in** | *Amended 2026-10-09 (owner: "I can hardly see any animation")*: scrim fades 0 to 1, panel opacity 0 to 1 plus translateY −8 px and scale .96 to none, both 160 ms `--tv-ease-enter` (Spotlight-style); Reduce Motion: 80 ms scrim fade; **close is instant** |
| 12 | Cross-tab search open | snap | **Animate in** | same as 11 |
| 13 | Find bar open | snap | **Animate in** | opacity plus translateY -6 px to 0, 100 ms; close instant |
| 14 | Shortcuts overlay | .16 s | **Tokenise** | 160 ms enter, close instant |
| 15 | Context menu, tab overflow list | .12 s fade | **Tokenise** | opacity only, 100 ms; close instant (macOS menus) |
| 16 | Toast | .18 s | **Tokenise** | 160 ms in, 120 ms out, `translate` 6 px and opacity |
| 17 | Reveal ring, flash | 1.2 to 1.4 s | **Tokenise** | `--tv-dur-highlight`; `box-shadow` / background on one row; static ring under Reduce Motion |
| 18 | Edit mode enter and exit | snap | **Animate** | new view opacity .5 to 1, 100 ms, no translate; never fully transparent |
| 19 | Live update of document text | snap | **Static** | DR-10; streaming updates must not touch rendered nodes with animation |
| 20 | Live pill, caret, shimmer | loops | Keep | the only infinite loops; off under Reduce Motion (already) |
| 21 | Theme switch (palette commit, menu) | snap | **Animate** | View Transitions crossfade, 160 ms; instant where unsupported; **previews (hover) stay instant** |
| 22 | Sticky headers pin | n/a | Static | state, not an event |
| 23 | Scroll restoration (tab switch, live re-render, restore) | instant | **Never animate** | DR-03, DR-10 |
| 24 | Heading jump, find-next scroll | smooth | Keep | `behavior: 'smooth'` unless Reduce Motion, then `'auto'` |
| 25 | Reveal-in-sidebar scroll | instant | Static | jump plus ring; smooth over a long list wastes time |
| 26 | Image and diagram load-in | .4 s fade, shimmer | **Tokenise** | 160 ms opacity; skeleton shimmer stays |
| 27 | Empty state to first document | snap | Static | first-use must be instant |
| 28 | Sidebar drag-resize, table re-centre on resize | direct | Static | direct manipulation; never animate layout |
| 29 | Drag-over card, large-file banner | existing | Keep | tokenise the card's 180 ms |

## Touch points

| File | Where | Change |
|---|---|---|
| `app/css/tv-tokens.css` | root block | the tokens and the Reduce Motion block |
| `app/css/tv-app.css` | the ~40 `transition` / `animation` declarations (inventory by `rg "transition:\|animation:"`) | replace literals with tokens; wrap enter keyframes in `no-preference`; `.tv-body.tv-animating { overflow: hidden }`; `.tv-sidebar-ghost`; enter keyframes for palette, search, find bar, tab pill, edit view |
| `app/js/tv-motion.js` | new, loaded before `tv-app.js` | `TVMotion` as above |
| `app/js/tv-app.js` | `toggleSidebar` ~6108; `buildTabbar`; `setMode`; `setTheme`; heading scroll ~5778 | FLIP; mark new tab id; edit crossfade class; `startViewTransition` wrapper; reduce guard on smooth scroll |
| `app/js/tv-palette.js`, `tv-search.js` | open paths | add the enter class when the overlay is created |
| `app/index.html` | script list | `tv-motion.js` |
| tests | new `tv-motion.test.js` (static: token use, no literal durations outside the allow-list, no `transition: all`, reduce block present; runtime with a fake `matchMedia` for `TVMotion.play`) | |
| `UXF-05` | "Feedback" paragraph and criterion 13 | amended to point here |

## Acceptance criteria

Headless Chrome for the web layer (`page.evaluate(() => document.getAnimations())`, `emulateMedia({ reducedMotion })`), then the native build for the checks marked N. Fixture K: a note with 200 paragraphs, 3 tables, 1 diagram, a folder tree of 60 files.

1. **PASS/FAIL** Show: within one frame of the toggle, `document.getAnimations()` holds exactly 2 animations (sidebar and viewer); both have `duration` 220 and the `--tv-ease-move` curve; both finish; afterwards no inline `transform`, no `.tv-animating`, no `will-change`, no ghost in the DOM.
2. **PASS/FAIL** Hide: a `.tv-sidebar-ghost` exists during the animation (`aria-hidden="true"`, `pointer-events: none`, width `S`), 2 animations run, the ghost is gone afterwards.
3. **PASS/FAIL** No per-frame layout: sampling `.tv-viewer`, `.tv-content` and every `.tbl-wrap` widths on 8 consecutive frames gives identical values (± 0.5 px) after the first frame.
4. **PASS/FAIL** No jump on frame 0: the left edge of `.tv-content` right after the toggle (before the first animation tick) equals its pre-toggle left edge ± 1 px; at the end it equals the final layout's.
5. **PASS/FAIL** Button click, ⌘B, View menu (N), palette command and the swipe all produce criterion 1 or 2.
6. **PASS/FAIL** Interrupt: toggle twice within 100 ms: no leaked ghost or class, final state matches the second toggle, no animation left running.
7. **PASS/FAIL** Not animated: first load at 1,440 px, window resize across the auto-collapse threshold, and session restore produce **no visible animation** and no animation on any document, sidebar, viewer or tab node. One exception is allowed (the **idle warm-up**, ruling 2026-10-07): at most once per launch, no sooner than about 3 s after load and only while no input is pending, one animation of 100 ms or less on a single inert node that carries `data-tv-warmup`, `aria-hidden="true"`, `inert`, `pointer-events: none`, `opacity` of 0.001 or less and `position: fixed` or absolute outside the layout flow. It must change no layout (every element's bounding box is identical before, during and after), take no focus, be skipped under Reduce Motion, and the node must be removed when it finishes (no leftover node or animation). Reason: it removes the native cold-start stall of the first real sidebar toggle (measured 115 ms down to 21 ms) at no visible cost. Test: record `document.getAnimations()` for 6 s after load; every entry targets the `data-tv-warmup` node, there is at most one, and it is gone at 6 s.
8. **PASS/FAIL** Reduce Motion: with `reducedMotion: 'reduce'` every moment in the audit table that says Animate runs with no animation that has `transform` or `translate` keyframes, and with opacity-only fades of at most 80 ms (palette, search, shortcuts, find bar) or none. Exercise all 29 rows.
9. **PASS/FAIL** Compositor-only: for every animation recorded while exercising the audit, `getKeyframes()` property names are a subset of `transform, translate, scale, opacity` (the highlight rows may add `boxShadow` and `backgroundColor`). No animation targets width, height, top, left, margin, padding or max-height.
10. **PASS/FAIL** Tokens: a static test finds no literal `ms` or `s` duration in any `transition` or `animation` declaration of `tv-app.css` except the allow-list; no `transition: all`; every duration token is defined once in `tv-tokens.css`; the Reduce Motion block zeroes the five durations.
11. **PASS/FAIL** DR-09: after clicking a tab, `document.getAnimations()` holds nothing targeting `.tv-scroll`, `.md` or their descendants for 3 frames; the new content is in the DOM and `opacity: 1` on the first frame; click to active class under 50 ms.
12. **PASS/FAIL** DR-03/DR-10: `.tv-scroll` has `scroll-behavior: auto`; after a tab switch `scrollTop` equals the saved value on the first frame; during a live-watch update stream (5 updates per second for 5 s) no animation targets the document nodes and `scrollTop` does not change.
13. **PASS/FAIL** New tab pill: opening a file adds one animation of 160 ms on the new `.tv-tab` only; closing a tab adds none; switching tabs adds none.
14. **PASS/FAIL** Overlays: opening the palette and the cross-tab search each add one animation of 100 ms with a start `opacity` of 0 and an end of 1; closing adds none; typing in the palette is never delayed (keystroke to row update under 16 ms with the animation running).
15. **PASS/FAIL** Find bar: open 100 ms animation, close instant; ⌘F then Esc ten times leaves no stuck state.
16. **PASS/FAIL** Edit mode: entering and leaving edit adds one 100 ms opacity animation whose start value is at least 0.5; the text is selectable at once.
17. **PASS/FAIL** Theme: committing a theme calls `document.startViewTransition` once, the root crossfade lasts 160 ms; hovering the Appearance rows in the palette (preview) does not call it; where the API is missing the switch is instant and throws nothing; under Reduce Motion it is not called.
18. **PASS/FAIL** Smooth scroll: a heading jump calls `scrollIntoView({ behavior: 'smooth' })`, and `'auto'` under Reduce Motion (spy).
19. **PASS/FAIL** No idle motion: with a static document, no infinite animation runs (`getAnimations().filter(iterations === Infinity)` is empty) unless a live watch is active or a diagram is loading.
20. **PASS/FAIL** Frame budget (N): on Fixture K, during the sidebar animation at most 2 animation frames exceed 20 ms (requestAnimationFrame deltas) after the first.
21. **PASS/FAIL** Toast and context menu keep their behaviour: toast 160 ms in, 120 ms out; context menu 100 ms fade in, instant out.
22. **PASS/FAIL** Existing suites pass; `node app/js/tv-motion.test.js` passes.

## Edge cases

- `render()` is batched (`TV.batch`): the FLIP runs after the batched render, in the one-shot `render` listener, never between renders.
- A very narrow window (720 px) with a 264 px sidebar: `S/2` = 132 px, the translated viewer stays inside `.tv-body` (`overflow: hidden` while animating).
- Sidebar scroll offset: the ghost reproduces it; the live sidebar restores its own (JANK-01).
- The tab strip and find bar live inside the viewer and translate with it; both are transforms, so they stay interactive.
- `will-change` is set only while animating so memory (DR-04) is not held.
- The idle warm-up (criterion 7) exists only to prime the animation pipeline. It is not a precedent for hidden work: any other pre-warming needs its own measured justification and the same zero-visible-change test.
- View Transitions need Safari 18 (macOS 15). Older systems get the instant theme switch; nothing else depends on it.
- If a future feature makes the sidebar persist across renders, replace the FLIP with a width-free transform on the persistent node; the tokens and rules stay.

## Out of scope

Interactive finger-following sidebar (needs native scroll phases), spring physics through `linear()` easing, page transitions between tabs, animating tree rows, list reordering, per-user motion settings (macOS Reduce Motion is the setting), sound and haptics.
