# UXF-01 — Wide tables stretch past the text margins

*Status: specified 2026-10-06; **amended 2026-10-06 (iteration 2: width balance)** · Priority: Should (sev 3) · Build with UXF-04 (same CSS block) · Owner files: `app/css/tv-app.css`, `app/css/tv-print.css`, `app/js/tv-app.js`*

## Why

The reading column is 640 px of text (`--tv-content-max` 720 px minus 2 × `--tv-s7` padding). A table sits in a 640 px box and scrolls sideways inside it, even when the pane is 1,200 px wide. Measured: wrapper 640 px in a 1,210 px pane. Owner request: tables should use the free space when they need it.

**Iteration 2 (owner, with a screenshot):** "This is really distracting. I don't think this table needed this much space. We need to find a balance." The shipped rule sized a table to its *max-content* width (what it wants). A 3-column table whose cells are sentences wants about 1,700 px, so it was stretched to the pane (measured 1,122 px beside a 640 px text column). The fix is to size by what the table *needs* and by what kind of content it holds, with a bounded bleed for prose. Evidence and options: step 8, Iteration 2, item A.

## Tie-back

URD-03 (tables render well), URD-06 (AI-output review). DR-02 (render tables), DR-07 (no new chrome). Supersedes the L-02 note at `tv-app.css:722-725` ("table self-contains its scroll within `.tbl-wrap`").

## Behaviour

**Width policy v2 (replaces the three tiers of v1).** Sizing is by *need* (minimum width) and by content kind, not by the table's wish.

| Symbol | Meaning | How it is read |
|---|---|---|
| `C` | text column = `min(640px, pane − 80px)` | CSS custom property `--tv-tbl-col` |
| `A` | most the table may use = `pane − 2 × 24px` | `.tv-scroll.clientWidth − 48` |
| `B` | comfortable ceiling for prose = `min(A, C + 2 × 80px)` (800 px at a pane of 848 px or more) | computed |
| `M` | what the table **needs**: its min-content width | table laid out with `width: min-content` |
| `W` | what it **wants**: its max-content width | table laid out with `width: max-content` |
| `w_i` | natural width of column *i* | cell widths of the header row in the max-content layout |
| `P` | prose threshold = `22em` of the table font (about 308 px, about 45 characters) | `22 × table font-size` |

A **prose column** is a column with `w_i > P`. A **prose table** has at least one. A **short-cell table** has none (numbers, tokens, short labels).

```
ceiling = prose table ? B : A
T = max(C, min(W, ceiling))        // what it should use
T = max(T, min(M, A))              // never narrower than it needs
wide = M > A + 1                   // genuinely wide: scrolls in its own box (v1 tier 3)
```

| Table | Example | Result at a 1,176 px pane |
|---|---|---|
| Short, few columns (`W ≤ C`) | 6 columns of tool names and paths, `W` ≈ 575 | `T = C` (640), aligned with the text |
| Prose (the owner's screenshot) | 3 columns of sentences, `W` ≈ 1,690, `M` ≈ 320 | `T = B` (800): 80 px of bleed each side, not 1,122 |
| Mixed (short columns plus one prose column) | Tool, Status, Notes sentences | `T = B` (800) |
| Short cells, many columns | 10 numeric columns, `W` ≈ 1,017 | `T = W` (1,017), centred; it is allowed to be wide because it needs it |
| Short cells, too many columns | 14 columns of 24-character tokens, `M` > `A` | `.tbl-wide`: `A` wide, scrolls in its own box (UXF-04 height cap, sticky header, edge fade) |
| Prose with an unbreakable string | a 400 px URL in a sentence column, `M` > `B` | `T = min(M, A)`: grows to what it needs, no more |

Why these numbers. 80 px of bleed per side is enough to relieve a dense prose table (three lines per row instead of four, measured) and small enough that the table still reads as belonging to the text column. Prose columns are capped by the prose rule, not the table: a column wider than about 45 characters is already past the 50 to 75 characters per line readability range (Baymard). Numeric and token tables get the pane because wrapping a number is worse than a wide table. GitHub keeps every table inside the column and scrolls it; Notion makes width a per-table choice (`Fit to page width`); neither measures need. See research stream 6.

Rules:
1. Cells wrap before the table grows past its ceiling. A `wide` table is exactly its min-content width.
2. `C`, `A`, `B` follow the pane (window, ⌘B, sidebar drag). The final width `T` is written by JS (rule 6) because `M`, `W` and `w_i` cannot be read in CSS.
3. Applies to top-level tables only (`.md > .tbl-wrap`). A table inside a blockquote keeps today's contained scroll.
4. Border and radius live on `table` (`border-collapse: separate; border-spacing: 0`); corner cells carry the radius.
5. No animation.
6. **JS sizing pass** `sizeTables(root)`, merged with `markWideTables` (one pass, one `requestAnimationFrame` coalescer, one `ResizeObserver` on `.tv-scroll` and each top-level table). Per pass, batch all tables so layout is forced twice in total, not twice per table: (1) for every table set `min-width: 0; width: min-content`; read all `M`; (2) set `width: max-content`; read all `W` and every header cell width; (3) compute `T` and write it as `--tv-tbl-w` on the wrapper, clear the inline measuring styles, toggle `.tbl-wide`, sync `data-edge`. Skip the write when `T` is unchanged (prevents observer loops). Do not run while printing (existing `isPrinting` guard).
7. Edge fade, rule 8 (DR-10 scroll capture) and `.tbl-wide` behaviour are unchanged from v1.
8. A header cell with a long unbroken title (a long header word) counts toward `w_i` like any cell; this is intended.

## CSS (reference implementation, prototyped in headless Chrome)

```css
/* tv-app.css:514 — container for cqw units */
.tv-scroll { container-type: inline-size; }

/* tv-app.css:722-737 — replaces the table block */
.md > .tbl-wrap {
  --tv-tbl-gutter: 24px;
  --tv-tbl-col: min(calc(var(--tv-content-max) - 2 * var(--tv-s7)),
                    calc(100cqw - 2 * var(--tv-s7)));
  margin-block: 0 var(--tv-s4);
  margin-inline: calc(50% - 50cqw + var(--tv-tbl-gutter));   /* span the pane */
  display: grid; justify-content: center;                    /* shrink-to-fit, centred */
  overflow: visible; border: 0; border-radius: 0;
}
.md > .tbl-wrap > table {
  width: var(--tv-tbl-w, auto); min-width: var(--tv-tbl-col);   /* --tv-tbl-w: written by sizeTables() */
  border: 1px solid var(--tv-border); border-radius: var(--tv-radius-md);
  border-collapse: separate; border-spacing: 0;
  font-size: .875em;
}
.md > .tbl-wrap thead tr:first-child th:first-child { border-top-left-radius: calc(var(--tv-radius-md) - 1px); }
.md > .tbl-wrap thead tr:first-child th:last-child  { border-top-right-radius: calc(var(--tv-radius-md) - 1px); }
.md > .tbl-wrap tbody tr:last-child td:first-child  { border-bottom-left-radius: calc(var(--tv-radius-md) - 1px); }
.md > .tbl-wrap tbody tr:last-child td:last-child   { border-bottom-right-radius: calc(var(--tv-radius-md) - 1px); }
.md > .tbl-wrap.tbl-wide { justify-content: start; overflow: auto; }   /* + max-height: UXF-04 */
.md > .tbl-wrap[data-edge="start"] { -webkit-mask-image: linear-gradient(to right, #000 calc(100% - 32px), transparent); mask-image: linear-gradient(to right, #000 calc(100% - 32px), transparent); }
.md > .tbl-wrap[data-edge="end"]   { -webkit-mask-image: linear-gradient(to left,  #000 calc(100% - 32px), transparent); mask-image: linear-gradient(to left,  #000 calc(100% - 32px), transparent); }
.md > .tbl-wrap[data-edge="mid"]   { -webkit-mask-image: linear-gradient(to right, transparent, #000 32px, #000 calc(100% - 32px), transparent); mask-image: linear-gradient(to right, transparent, #000 32px, #000 calc(100% - 32px), transparent); }
@supports not (width: 1cqw) {          /* old WebKit: today's behaviour */
  .md > .tbl-wrap { margin-inline: 0; display: block; overflow-x: auto; }
}
```

Keep the existing `.md th` / `.md td` colour rules (they use `!important` on purpose). Keep the legacy `.md .tbl-wrap` rule for non-top-level tables.

**Find and keyboard scroll must clear the edge fade and the pinned header (decided after QA 1).** Add to the tier-3 wrapper `scroll-padding-inline: 40px; scroll-padding-top: 44px;`. `scrollIntoView` honours the scroll-padding of the scroller it moves, so a ⌘F match in the last column lands 40 px inside the right edge (clear of the 32 px fade) and a match in a body row lands below the pinned header (header row ≈ 40 px). No JS.

```css
.md > .tbl-wrap.tbl-wide { scroll-padding-inline: 40px; scroll-padding-top: 44px; }
```

**Print (decided after QA 1: wrap, shrink wide tables, never clip).** A 14-column table of 24-character strings is 3,382 px wide and cannot fit a page without wrapping. Tables must be complete on paper. In `tv-print.css`:

```css
@media print {
  .md > .tbl-wrap { margin-inline: 0 !important; display: block !important; max-height: none !important; overflow: visible !important; -webkit-mask-image: none !important; mask-image: none !important; }
  .md > .tbl-wrap > table { width: 100% !important; min-width: 0 !important; table-layout: auto; }
  .md th, .md td { position: static !important; overflow-wrap: anywhere; word-break: normal; }
  .md > .tbl-wrap.tbl-wide > table { font-size: .72em; }          /* many-column tables only */
}
```

Wrapping with `overflow-wrap: anywhere` breaks only strings that cannot fit; ordinary text still breaks at spaces. The font shrink applies only to tables the screen layout already flagged `.tbl-wide`.

## Touch points

| File | Where | Change |
|---|---|---|
| `app/css/tv-app.css` | ~514 | add `container-type: inline-size` to `.tv-scroll` |
| `app/css/tv-app.css` | ~745-760 | `width: var(--tv-tbl-w, auto)` on the table; keep the rest |
| `app/css/tv-print.css` | ~157-160 | add the print block below (no clipped columns, nothing lost) |
| `app/js/tv-app.js` | `markWideTables` (~1724) and `setupWideTables` (~1748) | fold into `sizeTables(root)` as in rule 6; keep the observer, the scroll capture and the print guard |
| `app/js/tv-markdown.js` | ~483 | **no change** — the markup `div.tbl-wrap > table > thead + tbody` stays the contract |
| `app/js/tv-tables.test.js` | new/extend | static CSS assertions + a fake-DOM test of the pure function `tableWidth({C, A, M, W, cols, P})` (extract it so the policy is unit-tested without a layout engine: the six rows of the table above are six test cases) |
| `app/CONTRACT.md` | DOM contract | note `.tbl-wide`, `data-edge` |

`index.html` inline `<style>` has no table rules, so nothing there overrides this (ISS-002 check done).

## Acceptance criteria (QA: headless Chrome first, then native WKWebView)

Fixtures: a note with (a) 3×4 table of short labels, (b) 8 columns × 70 rows of short cells (natural width about 954 px), (c) **prose table**: 3 columns (`Pattern | External signal | Evidence`) × 4 to 50 rows whose second and third columns hold 90 to 200 character sentences, (d) 14 columns × 60 rows of 24-character unbreakable strings, (e) **mixed**: `Tool | Status | Notes` with one sentence column, (f) **short6**: 6 columns of tool names, folders and file patterns (natural width about 575 px), (g) **numeric10**: 10 columns, header `Metric`, then 9 values like `$1,284,903` (natural width about 1,000 px), (h) **prose-url**: a prose table with a 420 px unbreakable URL in a cell. Window 1440 × 900, sidebar open (pane about 1,176 to 1,210 px) unless a criterion says otherwise.

1. **PASS/FAIL** (a): table width is 640 ± 1 px and its left edge equals a paragraph's left edge. No inner scrollbar.
2. **PASS/FAIL** (b): table is wider than 640 px and equal to its natural width ± 2 px; left gap and right gap to `.tv-scroll` are equal ± 1 px; `wrapper.scrollWidth === wrapper.clientWidth`.
3. **PASS/FAIL** (c) prose table: table width is `B` = 800 ± 2 px (never more than 800 px at this pane), centred (left gap equals right gap ± 1 px, each at least 188 px at a 1,176 px pane); the left edge is 80 ± 2 px outside the paragraph edge; every sentence cell wraps (row height at least 2 lines); no inner scroll. **FAIL** if the width is anywhere near the pane (the iteration 2 defect: 1,122 px).
3a. **PASS/FAIL** (e) mixed: width 800 ± 2 px. (f) short6: width 640 ± 1 px, left edge equal to the paragraph edge. (g) numeric10: width equals its natural width ± 2 px (about 1,000 px, so it may be wider than 800) and does not exceed `A`.
3b. **PASS/FAIL** (h) prose-url: width is `min(M, A)` ± 2 px, where `M` is the table's measured min-content width; it is wider than 800 px only because the URL needs it, and cell text still wraps everywhere else.
3c. **PASS/FAIL** the policy function: `tableWidth` returns the width in the table above for each of the six rows (unit test, no browser).
3d. **PASS/FAIL** pane 700 px (browser build, window 700 px, sidebar closed): `C` = 620, `A` = 652, `B` = 652, so the prose table is 652 ± 2 px, never wider than `A`; no horizontal scroll on `.tv-scroll`.
4. **PASS/FAIL** (d): wrapper has class `tbl-wide`, `overflow-x: auto`, `scrollWidth > clientWidth`; left gap 24 ± 1 px; scrolling the wrapper horizontally moves the table; last column reachable.
5. **PASS/FAIL** (d): `data-edge` is `start` at rest, `mid` after scrolling a little, `end` at the far edge; the mask fade is present on the matching side(s).
6. **PASS/FAIL**: resize the window from 1440 to 900 px: widths of (b), (c) and (g) recompute without reload (a prose table keeps `T = B` while `B` fits, then follows `A`); (b) stays centred; `tbl-wide` is set or cleared correctly for each table at each width; (g) at a 1,000 px pane becomes `A` wide and `tbl-wide` (its `M` is above `A`).
7. **PASS/FAIL**: toggle the sidebar (⌘B, button, drag handle): tables re-centre; no stale `tbl-wide`.
8. **PASS/FAIL**: ⌘= three times: widths are recomputed (the table font grows, so `W`, `M` and `P` all grow); a table that fitted may become `tbl-wide`; ⌘0 restores the original widths. No observer loop: after the final change the sizing pass runs at most once per animation frame and then stops (assert with a counter in the test harness).
9. **PASS/FAIL**: light and dark themes: header fill and stripes use the tokens; the four outer corners are clean (no square fill outside the rounded border) at 2× device scale.
10. **PASS/FAIL**: a table inside a blockquote keeps its old look and scrolls inside its own box; no overlap with the text column.
11. **PASS/FAIL**: print (`emulateMedia print`, page width 794 px): for every table `wrapper.scrollWidth <= wrapper.clientWidth` (no clipped column), including (d) whose screen width is 3,382 px; the text of the last column of (d) is present and visible (long strings wrap); no max-height; header not sticky; no mask. (d) font size is 0.72 em; (a), (b), (c) keep 0.875 em.
12. **PASS/FAIL**: ⌘F for a string in column 14 of (d): the match scrolls into view horizontally and vertically and is not covered by any edge fade or by the pinned header. Where a fade is drawn on that side the match is at least 40 px inside the edge (`scroll-padding-inline`); where the wrapper is at its scroll limit no fade is drawn on that side (`data-edge=end` fades the left only), so a last-column match may sit closer than 40 px to the right edge (14.5 px measured) and that passes. No trailing padding is added inside the scroller. For a body row, its top is at least 44 px below the wrapper's top.
13. **PASS/FAIL**: live-watch update (DR-10): with `.tv-scroll` at 800 px and wrapper (d) scrolled right, a disk change leaves both offsets unchanged (± 2 px).
14. **PASS/FAIL**: no horizontal scrollbar appears on `.tv-scroll` or `body` at any width from 720 to 2,560 px.
15. **PASS/FAIL**: `node app/js/tv-tables.test.js` and the full test loop pass.
16. **PASS/FAIL** (defect found in native QA): no stray vertical line crosses body cells of a wide table at any scroll position. Screenshot (d) at 2× device scale with `scrollLeft` = 0, mid and max, in light and dark; in the band 0-120 px from the wrapper's left edge and 0-120 px from its right edge, no column of pixels differs from the cell background by more than the row stripe/border tokens, and no line is 1 px wide and taller than one row. Known to occur natively about 56 px from the left edge when scrolled to the end. Engineer: find the cause, do not mask it. Candidates to check in order: the `mask-image` gradient seam (the `data-edge="end"` rule fades the left side), a sub-pixel table width against the rounded border, the scroll box's own edge or scrollbar track, and a cell border left of the first visible column.

## Edge cases

- Table with one column, empty cells, `td.num` right-aligned numerals: all inside tier 1/2 rules.
- Narrow window (minimum 720 px, sidebar open: pane about 496 px): `C` and `A` differ by 32 px; tier 2 is small. Fine.
- A long URL in a small table makes `min-content` larger than `C`: the table grows to what it needs (`T = max(T, min(M, A))`), which is intended.
- A table with one very long header cell and short body cells counts as prose (the header cell sets the column width); if that is unwanted the author can shorten the header. Not special-cased.
- Pasted CSV-style tables with 30+ short columns: `M` > `A` so `wide`; no change from v1.
- The sizing pass runs before first paint (it is in `render()`'s synchronous post-pass), so a table never paints at the wrong width and then jumps.
- Images in cells and inline code: no change.
- `container-type` makes `.tv-scroll` a containing block for fixed-position descendants. No fixed element lives inside `.tv-scroll` today (palette, context menus, toasts and the drag card are children of `.tv`). Keep it that way.
- Browser without container units (`@supports not (width: 1cqw)`): falls back to the old 640 px box with inner scroll.

## Out of scope

Column resizing, per-table "expand" control, horizontal sticky first column, copy-table button.
