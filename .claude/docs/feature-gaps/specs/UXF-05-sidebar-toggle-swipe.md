# UXF-05 — One sidebar button, and a two-finger swipe

*Status: specified 2026-10-06 · Priority: Should (sev 2) · Independent of the other UXF items · Owner files: `app/js/tv-app.js`, `app/js/tv-swipe.js` (new), `app/js/tv-icons.js`, `app/js/tv-palette.js`, `app/css/tv-app.css`, `app/index.html`*

## Why

Owner: a two-finger horizontal swipe should hide and show the navigation panel, and the hide/show controls should become **one** button.

Today (UX-SBR "Edge", commit `602c698`): a `«` in the FILES header while the sidebar is open (`tv-app.js:2439`), and a different button in the tab strip while it is closed (`tv-app.js:753-761`). One action, two controls, two places; the control moves when its state changes (heuristic H4). macOS apps show one sidebar glyph in a fixed place.

## Tie-back

URD-08 (minimal chrome: one control, not two), URD-05. DR-07. DR-113 (cursor seeding on ⌘B stays). **Supersedes** the Edge two-control direction recorded in memory `sidebar-edge-direction` and in the `UX-SBR` / `UX-SB3` code comments.

## Part A — the single button

| Property | Value |
|---|---|
| Location | `.tv-tabbar`, first child, always rendered (sidebar open or closed, also in the empty state) |
| Element | `<button class="tv-side-toggle" data-sidebar-toggle type="button" aria-controls="tv-sidebar" aria-expanded="true|false" aria-label="Sidebar">`; the `<aside>` gets `id="tv-sidebar"` |
| Size and spacing | unchanged from `.tv-side-toggle`: 34 px wide, margin `4px 4px 4px 0` |
| Position | identical in both states (same x, y, size) |
| Icon, open | `sidebarOn`: the existing `sidebar` glyph with the left pane tinted (`fill: currentColor; fill-opacity: .35`) |
| Icon, closed | `sidebar` (outline only) |
| Colour | `--tv-text-muted` at rest, `--tv-text-secondary` on hover, never accent (no active-accent state) |
| Tooltip | `Hide sidebar (⌘B)` when open, `Show sidebar (⌘B)` when closed |
| Focus | keyboard ring only (`:focus-visible`), existing rule |

Remove: the `.tv-side-collapse` button in the sidebar header (`tv-app.js:2439-2442`), its CSS (`tv-app.css:345-358`), the `collapseLeft` icon, and the `width: 24px` assertion at `tv-css-polish.test.js:146`. The header keeps the `FILES` label.

Cursor seeding: `toggleSidebar(opts)` takes `{ seedCursor }`. Keyboard routes (⌘B, menu, palette) keep DR-113 (seed the first row so arrow keys work). Pointer routes (button click, swipe) pass `seedCursor: false`, so opening by mouse does not paint a keyboard ring on the first row.

## Part B — the swipe

**Mapping (spatial, like pulling a drawer).** Finger moves right: show the sidebar. Finger moves left: hide it. Other direction, or already in that state: nothing happens. The mapping is one constant (`SWIPE_RIGHT_SHOWS = true`) so it can be flipped. See the open question in step 8.

**Input.** WKWebView delivers a two-finger swipe as `wheel` events with `deltaX`. Normalise to finger direction: if `e.webkitDirectionInvertedFromDevice` is defined, `fingerRight = (inverted ? -dx : dx) > 0`; if it is undefined (other engines, test harness) assume natural scrolling, so `fingerRight = dx < 0`.

**Module.** New `app/js/tv-swipe.js`, loaded after `tv-tree.js` and before `tv-app.js`. It exports `window.TVSwipe.create(opts)` (pure state machine, no DOM access; testable in node with a fake clock) and a DOM adapter that installs **one** passive `wheel` listener on `document` in `init()`. It is installed once, not per render, because `render()` replaces the DOM.

**Gesture rules** (all numbers are constants at the top of the file):

| Rule | Value |
|---|---|
| New gesture begins after a quiet gap of | 160 ms, **or** (amended 2026-10-08, UXF-09) ≥ 10 px of finger movement against an already-fired gesture within 80 ms — momentum never reverses, so a reversal is a new touch. Ownership and the blocked state are read again at that onset |
| Desktop app: touch phases | when the native `swipe-touch` stream is live (UXF-09), one finger touch is one gesture: onset = phase `began` (exact), momentum is never sent, no quiet gap or cool-down applies. The wheel rules above stand down while it is live and remain the fallback (browser build, mice without phases) |
| Eligible events | `deltaMode === 0`; no `shiftKey`, `ctrlKey` (pinch), `altKey`, `metaKey` |
| Distance | `|Σdx| ≥ 48 px` summed over the last 250 ms (sliding window) |
| Direction | over the last 100 ms, `|Σdx| ≥ 1.3 × |Σdy|`, same sign as the 250 ms sum. Judged continuously, never locked on the first pixels (amended 2026-10-07 after owner feedback "it needs to be precise": start-up wobble, diagonal drift, a swipe begun while a vertical scroll still coasts, and a change of mind must all still work) |
| Once per gesture | the momentum tail (events at about 16 ms for up to a second) is part of the same gesture and cannot fire again; a same-direction re-swipe inside the tail does nothing (the sidebar is already in that state) |
| Cool-down after a toggle | 200 ms (was 350; amended 2026-10-08, UXF-09) |

**Scrollers win (never hijack horizontal scrolling).** At the first event of a gesture, walk from `e.target` up to `.tv`. If any ancestor has `overflow-x: auto|scroll` and `scrollWidth > clientWidth + 1`, that scroller owns the whole gesture and the sidebar never toggles, even when the scroller reaches its edge. Covers `.md pre`, `.tbl-wide`, `.tv-diagram-viewport`, `.tv-tab-strip` (when it overflows), `textarea`, `input`, `.tv-source`. To use the swipe over a wide table, move the pointer off it.

**Ignored while:** the palette, cross-tab search, shortcuts overlay, a context menu or the tab-overflow list is open.

**Feedback.** The layout changes at once and the 220 ms slide is specified in **UXF-08** (FLIP on transforms with a ghost for the exit; a triggered slide, not a finger-following drag, because `wheel` events carry no gesture phase). This spec adds no motion of its own. The button's state flips in the same repaint. A polite live-region message (`TV.announce`) says `Sidebar hidden` or `Sidebar shown`. *Iteration 2 reversed the original "no animation" line: the earlier finding that `render()` replaces the DOM still holds, which is why the slide uses FLIP and a ghost.*

**State.** Calls `toggleSidebar({ seedCursor: false })`, which sets `sidebarUserToggled = true` (the responsive default stops overriding the choice) and keeps DR-03 scroll preservation.

**Escape hatch.** Palette command `Disable swipe to toggle sidebar` / `Enable …`, persisted as `localStorage['tv-swipe-sidebar']` (`'0'` = off). Same pattern as the Mermaid toggle (DR-24) and allowed by DR-31 (a palette toggle, not a settings panel).

## Touch points

| File | Where | Change |
|---|---|---|
| `app/js/tv-app.js` | `buildTabbar` ~747-761 | always render the button; new attributes; icon by state |
| `app/js/tv-app.js` | `buildSidebar` ~2435-2443 | drop the `.tv-side-collapse` button; `id="tv-sidebar"` on `<aside>` |
| `app/js/tv-app.js` | `toggleSidebar` ~5671; click handler ~4615; keydown handler ~4375 | `{ seedCursor }` option; pointer callers pass `false` |
| `app/js/tv-app.js` | `init()` | `TVSwipe.install({ onShow, onHide, isEnabled, isBlocked })` |
| `app/js/tv-swipe.js` | new | state machine + DOM adapter |
| `app/js/tv-icons.js` | ~23-24 | add `sidebarOn`; remove `collapseLeft` |
| `app/css/tv-app.css` | 266-287; 331-358 | keep `.tv-side-toggle`; delete `.tv-side-collapse*`; add `[aria-expanded="true"]` colour rule if needed |
| `app/js/tv-palette.js` | `CMDS` ~407 | swipe toggle command |
| `app/index.html` | script list | `<script src="js/tv-swipe.js">` before `tv-app.js` |
| `app/js/tv-swipe.test.js`, `tv-css-polish.test.js:146` | tests | new state-machine tests; remove the pin on the deleted `.tv-side-collapse` |
| `app/CONTRACT.md`, `CLAUDE.md` | module map | add `tv-swipe` |
| Rust | none | `menu:toggle-sidebar` stays |

## Acceptance criteria

1. **PASS/FAIL** Sidebar open: the DOM has exactly one `[data-sidebar-toggle]`, inside `.tv-tabbar`, and none inside `.tv-sidebar`. Same when closed, and in the empty state.
2. **PASS/FAIL** The button's bounding rect (x, y, width, height) is identical open and closed.
3. **PASS/FAIL** Click toggles. `aria-expanded` follows the state; `title` reads `Hide sidebar (⌘B)` / `Show sidebar (⌘B)`; the icon swaps `sidebarOn` / `sidebar`.
4. **PASS/FAIL** Enter and Space on the focused button toggle it.
5. **PASS/FAIL** Opening by click leaves no `.kbd-cursor` in the sidebar; opening by ⌘B seeds the first row (DR-113 intact).
6. **PASS/FAIL** Over plain text, `mouse.wheel(-120, 0)` with the sidebar closed opens it; `mouse.wheel(120, 0)` with it open closes it (natural-scrolling assumption, no inverted flag). The wrong direction for the current state does nothing.
7. **PASS/FAIL** With `webkitDirectionInvertedFromDevice` forced to `false`, the same physical swipe maps to the opposite `deltaX` sign and still shows/hides correctly.
8. **PASS/FAIL** No toggle for: total `|dx|` of 40 px; `dx 100, dy 80` (vertical-dominant); a wheel with `shiftKey`; a wheel with `ctrlKey`; `deltaMode` 1.
9. **PASS/FAIL** A swipe of 30 events over 480 ms with decaying `dx` (momentum) toggles exactly once.
10. **PASS/FAIL** (amended 2026-10-08, UXF-09) A reversed swipe right after a toggle toggles back: a swipe in the other direction that starts while the first swipe's momentum still runs (Δ 100 to 1,200 ms after the lift) toggles every time, and five alternating swipes 150 to 700 ms apart give five toggles. A same-direction swipe inside the tail does nothing. A swipe after 600 ms of quiet toggles as before.
11. **PASS/FAIL** Over a scrolling `pre`, a `.tbl-wide` table, a diagram viewport and an overflowing tab strip: no toggle in either direction, including at the scroller's edge. Over a non-scrolling area of the same page: toggles.
12. **PASS/FAIL** With the palette, search, shortcuts overlay or a context menu open: no toggle.
13. **PASS/FAIL** `prefers-reduced-motion: reduce`: the swipe, button and ⌘B behave the same and run no animation (UXF-08 criteria 1 to 8 govern the motion itself: 220 ms slide normally, none under Reduce Motion).
14. **PASS/FAIL** After a swipe, `TV.state.sidebarUserToggled === true`; `.tv-scroll` scroll offset is unchanged (DR-03); the live region says `Sidebar hidden` or `Sidebar shown`.
15. **PASS/FAIL** `Disable swipe to toggle sidebar` stops the gesture, survives a reload, and the palette row then reads `Enable …`.
16. **PASS/FAIL** Native (WKWebView): real trackpad swipe right and left both work; macOS "swipe between pages" does not navigate the web view; a swipe starting over a wide table scrolls the table and does not toggle.
17. **PASS/FAIL** `node app/js/tv-swipe.test.js` covers items 6-10 with a fake clock; the full test loop passes.

## Edge cases

- Magic Mouse swipes produce the same fine-grained wheel events and work. A mouse wheel with ⇧ is excluded by the modifier rule.
- Edit mode: allowed. A textarea that scrolls sideways owns the gesture; one that wraps does not.
- Window at the 720 px minimum: toggling works; the viewer simply gets the width.
- A gesture that starts in the sidebar: left hides it, right does nothing (already open).
- Reduced-motion users who dislike accidental toggles can use the escape hatch.

## Out of scope

An interactive drag where the sidebar follows the fingers (UXF-08 explains why it needs native scroll phases), edge-swipe from the window border, a three-finger gesture, a Tauri-level back/forward gesture.
