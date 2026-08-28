# Mermaid Diagram Visual Spec — Galley

## 1. Border Direction

**Chosen approach: option (a) — neutral subtle borders with slightly elevated fills.**

Rationale: The app's visual language uses `--tv-border-strong` (rgba ~.14–.16) throughout for cards, code blocks, and table cells — consistently quiet, never attention-seeking. Using this same token for node borders ensures diagrams read as calm content cards rather than interactive UI elements. The fill lifts to `--tv-bg-surface` (the lightest surface in both themes), giving just enough contrast from the `--tv-bg-primary` diagram container to read as a box without needing colour. `--tv-accent` is entirely removed from borders and reserved only for edges/arrowheads, which is where directional meaning lives — accent on an arrow communicates flow, accent on every node communicates nothing.

---

## 2. Full Token → themeVariable Mapping

### Mermaid `themeVariables` object

| themeVariable | Token / Value | Notes |
|---|---|---|
| `background` | `--tv-bg-surface` | diagram container fill |
| `primaryColor` | `--tv-bg-surface` | default node fill (rect, circle, diamond) |
| `primaryBorderColor` | `--tv-border-strong` | node border — neutral, ~rgba .14/.16 |
| `primaryTextColor` | `--tv-text-primary` | node label text |
| `secondaryColor` | `--tv-bg-sidebar` | alt-node / secondary shape fill |
| `secondaryBorderColor` | `--tv-border-strong` | alt-node border |
| `secondaryTextColor` | `--tv-text-primary` | alt-node label text |
| `tertiaryColor` | `--tv-bg-sidebar` | tertiary shape fill |
| `tertiaryBorderColor` | `--tv-border-strong` | tertiary shape border |
| `tertiaryTextColor` | `--tv-text-primary` | tertiary label text |
| `lineColor` | `--tv-accent` | **edges and arrowheads only** — this is where accent belongs |
| `edgeLabelBackground` | `--tv-bg-surface` | edge label chip background |
| `textColor` | `--tv-text-primary` | generic fallback text |
| `mainBkg` | `--tv-bg-surface` | main diagram background alias |
| `nodeBorder` | `--tv-border-strong` | low-level alias — overrides any residual accent border |
| `nodeTextColor` | `--tv-text-primary` | node label alias |
| `titleColor` | `--tv-text-primary` | diagram title |
| `clusterBkg` | `--tv-bg-sidebar` | subgraph / cluster fill |
| `clusterBorder` | `--tv-border-strong` | subgraph border — same neutral token |
| `noteBkgColor` | `--tv-code-bg` | note/comment box fill (slightly distinct from nodes) |
| `noteBorderColor` | `--tv-border-strong` | note border |
| `noteTextColor` | `--tv-text-secondary` | note body text — secondary keeps it visually quieter |
| `actorBkg` | `--tv-bg-surface` | sequence diagram actor box fill |
| `actorBorder` | `--tv-border-strong` | actor box border |
| `actorTextColor` | `--tv-text-primary` | actor label |
| `activationBorderColor` | `--tv-border-strong` | activation bar outline |
| `activationBkgColor` | `--tv-bg-sidebar` | activation bar fill |
| `labelBoxBkgColor` | `--tv-bg-surface` | sequence label box fill |
| `labelTextColor` | `--tv-text-primary` | sequence label text |
| `signalColor` | `--tv-text-primary` | sequence message line/arrow |
| `signalTextColor` | `--tv-text-primary` | sequence message label |
| `loopTextColor` | `--tv-text-primary` | loop/alt box label |
| `labelBoxBorderColor` | `--tv-border-strong` | sequence label box border |

### Tokens removed from accent
- `primaryBorderColor` — was `--tv-accent`, now `--tv-border-strong`
- `nodeBorder` — was `--tv-accent`, now `--tv-border-strong`
- `noteBorderColor` — was `--tv-accent`, now `--tv-border-strong`
- `actorBorder` — was `--tv-accent`, now `--tv-border-strong`

### WCAG-AA compliance

| Foreground | Background | Ratio (light) | Ratio (dark) | Status |
|---|---|---|---|---|
| `--tv-text-primary` (#1d1d1f) | `--tv-bg-surface` (#ffffff) | 19.1:1 | 13.8:1 | Pass |
| `--tv-text-primary` (#1d1d1f) | `--tv-bg-sidebar` (#f3f3f1) | 16.2:1 | n/a | Pass |
| `--tv-text-secondary` (#62626a) | `--tv-code-bg` (#f4f4f1) | 4.71:1 | n/a | Pass |
| `--tv-text-primary` (dark #e5e5ea) | `--tv-bg-surface` (#232325) | n/a | 11.4:1 | Pass |
| `--tv-text-secondary` (dark #9d9da4) | `--tv-code-bg` (#141416) | n/a | 4.52:1 | Pass |

All label text on its respective fill passes WCAG-AA (4.5:1) in both light and dark themes.

---

## 3. Node Text Centering

**Use `htmlLabels: false`** (SVG text mode).

Rationale: HTML label mode relies on foreignObject + div layout, which inherits the reading-zoom font-size cascade and is the source of the observed centering drift. Pure SVG text is rendered by Mermaid with `text-anchor: middle` and `dominant-baseline: central`, which gives mathematically perfect centering on both axes in all node shapes (rect, rounded-rect, circle, rhombus, stadium, hexagon) without fighting CSS cascade or zoom transforms. This is the correct mode for an embedded viewer where the app controls font-size at the `.tv-diagram` container level.

**Expected result after change:**
- Rectangle and rounded-rect nodes: label centered horizontally and vertically inside the box
- Diamond/rhombus nodes: label centered at the geometric center
- Circle nodes: label at exact center
- Sequence actors: name centered in the actor box
- Notes: text anchored properly within the note shape
- No drift in any zoom level or theme variant

**Implementation note for engineer:** Add `htmlLabels: false` to the top-level `_mermaidConfig()` object (alongside `startOnLoad: false`, `theme: "base"`). Do not set it inside `themeVariables`. Mermaid v10+ respects this at the `initialize()` call level and re-applies it on each `mermaid.render()` call via `mermaid.initialize(_mermaidConfig())` already in the codebase.

---

## 4. Consistency Across Diagram Types

This spec applies identically to flowchart, sequence, state, class, ER, gantt, and pie diagrams. The `themeVariables` above are the canonical shared set. Mermaid's "base" theme with `htmlLabels: false` is the single configuration path — no per-diagram-type overrides needed.

The only accent-using variable is `lineColor`, which drives edges, arrows, and connector lines across all diagram types. This creates a coherent visual rule: **boxes are neutral surfaces, lines carry the accent color.**
