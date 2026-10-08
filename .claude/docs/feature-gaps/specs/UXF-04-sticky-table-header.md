# UXF-04 — Table headers stay visible while scrolling

*Status: specified 2026-10-06 · Priority: Should (sev 3) · **Depends on UXF-01** (ships in the same CSS block) · Owner files: `app/css/tv-app.css`, `app/css/tv-print.css`*

## Why

Measured: 300 px into a long table the header row is 299 px above the pane top. The reader must scroll back up to learn what a column means (heuristic H6).

The header cannot stick today for a structural reason, not a missing rule: `.tbl-wrap` is `overflow-x: auto; overflow-y: hidden`. That makes it the scroll container for any `position: sticky` descendant, and it never scrolls vertically, so the header has nothing to stick to. A sticky `th` only sticks to the page pane when no ancestor between it and `.tv-scroll` is a scroll container.

## Tie-back

URD-06 (review loop), URD-03 (tables). DR-02. DR-07 (no new chrome: the header already exists; it only stays put).

## Behaviour

1. Every table with a header row pins that row to the top of the reading pane (`top: 0` of `.tv-scroll`) while any body row of the table is in view. It releases when the last row passes.
2. **Tiers 1 and 2 (UXF-01):** the wrapper is not a scroll container (`overflow: visible`), so `th { position: sticky; top: 0 }` sticks to `.tv-scroll`. No JS.
3. **Tier 3 (`.tbl-wide`, a table wider than the pane):** the wrapper must scroll sideways, so it is a scroll container. It also gets a height cap so the same sticky rule works *inside* it:
   `max-height: max(320px, calc(100vh - 160px))` and `overflow: auto`. A tall tier-3 table therefore scrolls in its own box with its header pinned; a short one is not capped. (160 px is the title bar, tab bar, bottom bar and a margin; keep it as the token `--tv-chrome-h`.)
4. Pinned header looks the same as the resting header: opaque `--tv-table-head` fill (existing `!important`), bottom hairline from its `border-bottom`. No shadow, no accent. There is no "stuck" state, so there is no JS and no observer.
5. Cells use `border-collapse: separate` (UXF-01 rule 4). Collapsed borders do not travel with a sticky cell in WebKit and Blink.
6. `z-index: 1` on `th`: above body cells, below every overlay (palette, context menu, find bar, toasts).
7. Use `th`, not `thead` or `tr`, as the sticky element. `th` is the form Safari supports for the longest.
8. Print: header is `position: static` and the wrapper has no height cap (UXF-01 print rules).
9. No animation; nothing for `prefers-reduced-motion`.

## CSS (add to the UXF-01 block)

```css
.md .tbl-wrap th { position: sticky; top: 0; z-index: 1; }
.md > .tbl-wrap.tbl-wide { max-height: max(320px, calc(100vh - var(--tv-chrome-h, 160px))); }
```

Nested tables (inside a blockquote) keep the legacy wrapper and have no sticky header. They are rare and short.

## Touch points

| File | Where | Change |
|---|---|---|
| `app/css/tv-app.css` | ~729 (`.md th`) | add `position: sticky; top: 0; z-index: 1` |
| `app/css/tv-app.css` | UXF-01 block | `.tbl-wide` max-height rule |
| `app/css/tv-tokens.css` | ~31 | `--tv-chrome-h: 160px` |
| `app/css/tv-print.css` | table rules | `th { position: static !important }`, no max-height (already in UXF-01) |
| `app/js/tv-tables.test.js` | UXF-01 test file | assert `th` is sticky and that no ancestor of `th` up to `.tv-scroll` has `overflow` other than `visible` for tiers 1–2 |

## Acceptance criteria

Same fixtures and window as UXF-01. "Header offset" = `th.getBoundingClientRect().top − .tv-scroll.getBoundingClientRect().top`.

1. **PASS/FAIL** (b, 70 rows): scroll `.tv-scroll` so the table top is 300 px above the pane top: header offset is 0 ± 1 px. (Baseline was −299.)
2. **PASS/FAIL** (b): scroll to 20 px before the last row: header offset is still 0.
3. **PASS/FAIL** (b): scroll until the table's bottom edge passes the pane top: the header is gone with the table (not stuck over the next paragraph).
4. **PASS/FAIL** (c, prose): same as 1.
5. **PASS/FAIL** (a, 4 rows): the table is shorter than the pane: header does not move or overlap anything while the page scrolls past it.
6. **PASS/FAIL** (d, wide): wrapper height is `min(natural height, max(320, viewport − 160))`. Scroll the wrapper vertically by 400 px: header offset **inside the wrapper** is 0; scroll it horizontally: header scrolls horizontally with the columns (header and body stay aligned, ± 1 px per column).
7. **PASS/FAIL** (d): with the wrapper at its vertical end, the next wheel gesture scrolls the page (scroll chaining works; no trap).
8. **PASS/FAIL**: header fill is opaque in light and dark; body text never shows through the pinned header.
9. **PASS/FAIL**: open the palette (⌘K) and a context menu while a header is pinned: both draw above it.
10. **PASS/FAIL**: ⌘F, match in a body row near the pinned header: the match is not hidden behind the header. In tiers 1-2 find scrolls the page with `block: center`; in tier 3 the wrapper's `scroll-padding-top: 44px` (UXF-01) keeps the row at least 44 px below the wrapper top.
11. **PASS/FAIL**: print preview: no sticky behaviour, no clipped rows.
12. **PASS/FAIL** native: repeat 1, 2 and 6 in the built app (WKWebView). If sticky `th` fails there, report it; do not ship a JS clone without asking.
13. **PASS/FAIL**: existing suites pass.

## Edge cases

- Find-in-page highlights and `scrollIntoView({block: 'nearest'})` can park a row under the pinned header. Only the find bar uses `center`; if another caller uses `nearest` on content, add `scroll-padding-top: 44px` to `.tv-scroll`.
- The floating find bar sits over the top-right of the pane and will cover the right end of a pinned header. This is the same overlap it has with text today.
- Tier-3 chaining: nested scrollers can trap a wheel gesture. WebKit chains at the start of a new gesture, not mid-momentum, which is the accepted behaviour.
- A table with an empty header row: sticky row is empty but harmless.

## Out of scope

Sticky first column, sticky header for tables inside blockquotes, a "stuck" shadow, JS-cloned headers.
