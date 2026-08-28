# U-15 — Print / Export to PDF (⌘P)

*WAAD-grounded requirements · build-ready spec · DR-99 – DR-106*

---

## Title & Scope

**Feature:** Wire `⌘P` → `window.print()` in the global keyboard router and add a palette command "Print / Export PDF…". A dedicated `app/css/tv-print.css` stylesheet loaded unconditionally applies `@media print` rules that hide all application chrome (titlebar, sidebar, tabbar, status bar, toolbar, hover-only copy buttons, live indicator) and lay out the active document at full page width with forced light-theme tokens, legible code blocks, Mermaid SVG diagrams, and table overflow converted to visible wrapping. No export dialog. No PDF-generation library. No custom filename/page-size controls. The host OS print dialog (macOS `⌘P` sheet → "Save as PDF") handles all format choices.

**Exclusions from this scope:** headless PDF export via CLI/Rust; custom filename templates; page-range selection; per-document page-size or margin overrides; multi-document batch print; print from the native menu bar (a `File > Print…` item belongs to the U-01 native menu spec, not here); link-URL expansion as visible footnotes (optional enhancement, out of scope for v1).

---

## URD Tie-back + WAN Grounding

| URD | Passage | WAAD cluster |
|-----|---------|--------------|
| **URD-07** (File Trust & Portability) | "Users treat non-proprietary file-system-based markdown as a top-priority criterion… open actual .md files where they live on disk, with zero import, zero sync, and zero vendor lock-in." Producing a PDF directly from the rendered view is the zero-import portability contract extended to output: the rendered document leaves the app as a portable artefact without any round-trip to another tool. | **Cluster G** "Source files are sacred — keep tools out of the way" (G1: file-based trust and portability — WAN-054, 055, 057, 062) |
| **URD-05** (View-First Simplicity) | "Users want something that renders beautifully and gets out of the way — the markdown equivalent of Preview.app." Print is the most natural output from a viewer: Preview.app's primary non-viewing action is printing. Reaching for another tool (VS Code, Obsidian, browser) to print a file Galley already renders perfectly is the exact context-switch cost URD-05 exists to eliminate (23-minute recovery, WAN-001/004). | **Cluster E** "I want to read, not configure" (E1: viewer-vs-editor tension — WAN-036, 037, 038, 039) |
| **URD-08** (Minimal UI Chrome) | "Minimum-not-zero: every UI element must justify its visual real estate." In print, all chrome elements fail this test by definition — they are navigation affordances, not content. A print stylesheet that hides them unconditionally is the correct zero-configuration expression of URD-08. | **Cluster H** "UI chrome should be earned, not imposed" (H3: minimum viable chrome principle — WAN-015) |
| **DR-06** (file trust) | "Must read actual .md files from disk — no import, no sync, no extra files written." The print path writes no files; the host OS dialog writes the PDF to the user's chosen location entirely outside the app. | Step-3 problem-definition |

**Work role direct tie:** **Role 2 — Developer / Technical Writer** (step-2-waad-urd.md §C): "View documentation, READMEs, specs, and design docs across many files. Diagrams (Mermaid, images) must render." The production of PDFs of architecture notes and API references is an explicit, named output for this role. WAN-054/055/057 (file portability) and WAN-036/038 (read-first, then use) ground the workflow: read → render → confirm diagrams look correct → print to PDF for sharing. WAN-014 (diagram workflow disruption) underlines that diagrams must survive the print path intact.

---

## Problem Statement + HMW

**Problem statement:** Role 2 (Developer / Technical Writer) needs a way to produce a PDF of the currently rendered document because their workflow culminates in sharing architecture notes, READMEs, and API specs as portable documents — and reaching for another tool to print a file Galley already renders perfectly costs a 23-minute focus-recovery tax (URD-07, URD-05, WAN-001/004) and breaks the read-first contract the app was built around (Cluster E, WAN-036/038).

**HMW:** How might we let any user print or export the active document to PDF in a single keystroke, with the app chrome gone, the content full-width, and Mermaid diagrams intact — without a settings dialog or a library dependency?

---

## Decision

**Build — `window.print()` + `@media print` stylesheet. No bespoke export. No dialog.**

Evaluation of alternatives:

- **Headless Rust PDF generation (e.g. `wkhtmltopdf`, `headless-chrome`):** Adds a binary dependency, breaks the <80MB RAM budget (URD-02), requires an async Tauri command, and produces output the user cannot preview before saving. Rejected.
- **Export dialog with filename/margin controls:** Directly violates URD-05 ("get out of the way") and the overconfiguration constraint (DR-31, Cluster E, WAN-045/046). A single `window.print()` call hands control to the macOS sheet which the user already knows. Rejected.
- **`window.print()` only, no new CSS file:** Without a print stylesheet the sidebar, tabbar, and status bar print as chrome noise and the content column is 720px wide on an 8.5″ page. Not usable. Requires `tv-print.css`.

**What is built:**
1. Keyboard router: `k === 'p'` + `meta` → `e.preventDefault(); window.print()`.
2. Palette command "Print / Export PDF…" in the Commands group; shortcut hint `⌘P`.
3. `app/css/tv-print.css` loaded unconditionally in `index.html` after `tv-tauri.css`; contains only `@media print { … }` rules — zero impact on screen rendering.

**Force-light in print:** The print sheet forces `--tv-bg-primary: #ffffff`, `--tv-text-primary: #1d1d1f`, and light-theme code/table token overrides via explicit `@media print` property declarations on `.tv`, regardless of the `.tv--dark` class. This is the correct choice: printing dark backgrounds onto paper wastes ink and produces illegible output on black-and-white printers. No theme-choice preference is surfaced to the user.

**Document title/path header:** A single `@media print` `::before` pseudo-element on `.tv-content` outputs the document filename (via CSS `content: attr(data-print-title)`) as a small muted line above the first heading. `tv-app.js`'s render step already sets a `data-tab-title` on the active tab; the same value is written to a `data-print-title` attribute on `.tv-content` at render time (one-line addition). This is optional (Should) but specified because it mirrors the natural PDF metadata need (URD-07: "which file is this?"). Disabled: full path — only the basename. Rationale: full paths are user-private and may expose directory structure in shared PDFs.

---

## DR Table

| DR | Requirement | URD | MoSCoW |
|----|-------------|-----|--------|
| DR-99 | `⌘P` in the global keyboard router (`k === 'p'` and `e.metaKey`) calls `e.preventDefault()` and `window.print()`. The shortcut fires in reading mode and edit mode alike (printing while editing is valid); it is inert when a text `<input>` or `<textarea>` has focus (the browser handles `⌘P` there as-is). | URD-05, URD-07 | Must |
| DR-100 | A "Print / Export PDF…" command row is added to the ⌘K palette Commands group with shortcut hint `⌘P`; selecting it calls `window.print()` identically to the keyboard shortcut. | URD-08 | Should |
| DR-101 | `app/css/tv-print.css` is created and loaded in `index.html` (after `tv-tauri.css`). All rules are inside `@media print { … }`. The file has zero effect on screen rendering — no naked selectors, no screen-visible overrides. | URD-08 | Must |
| DR-102 | `@media print` hides the following elements with `display: none !important`: `.tv-titlebar`, `.tv-tabbar`, `.tv-sidebar`, `.tv-sidebar-resizer`, `.tv-status` (live indicator bar — class verified in tv-app.css:819), `.tv-toolbar`, `.tv-find` (find bar), `.tv-copy` (hover-only copy buttons on `<pre>` blocks), `.tv-edit-pencil` (inline-edit hover affordance), any `.tv-overlay` (palette, shortcut overlay, context menus). | URD-08 | Must |
| DR-103 | `@media print` forces light-theme tokens on `.tv` regardless of `.tv--dark`: `--tv-bg-primary: #ffffff; --tv-bg-surface: #ffffff; --tv-bg-chrome: #ffffff; --tv-text-primary: #1d1d1f; --tv-text-secondary: #62626a; --tv-text-muted: #636369; --tv-code-bg: #f4f4f1; --tv-border: rgba(0,0,0,.09); --tv-table-head: #f4f4f1; --tv-table-stripe: #faf9f7; --tv-inline-code-bg: #f4f4f1; --tv-inline-code-border: rgba(0,0,0,.07); --tv-inline-code-text: #1d1d1f; background: #ffffff !important; color: #1d1d1f !important`. Syntax highlight tokens are also reset to their light-theme values (`--tv-syn-comment: #5e5e66` etc.). | URD-07 | Must |
| DR-104 | `@media print` makes `.tv-content` and `.md` expand to full page width: `max-width: 100% !important; width: 100% !important; margin: 0 !important; padding: 0 !important` on `.tv-content`; the `.tv-body` and `.tv` root become full-width block containers with no flex layout. | URD-07, URD-05 | Must |
| DR-105 | `@media print` applies page-break avoidance rules: `page-break-inside: avoid; break-inside: avoid` on `.md pre`, `.md .tv-diagram`, `.md .tbl-wrap`, `.md blockquote`, and `.md li`. Headings `h1–h3` get `page-break-after: avoid; break-after: avoid` so a heading is never the last item on a page. | URD-03, URD-07 | Must |
| DR-106 | `@media print` ensures Mermaid SVGs render visibly: `.tv-diagram svg { max-width: 100% !important; height: auto !important; overflow: visible !important }`. The `.tv-diagram-viewport` pinch-zoom wrapper has `overflow: visible !important; transform: none !important; max-height: none !important` — the last property is required because tv-app.css:629–637 constrains `.tv-diagram-viewport` to `max-height: 70vh`, which clips tall diagrams in print. The `.dg-load` loading-spinner placeholder gets `display: none !important` — a diagram that has not yet resolved does not print as a blank spinner. Table overflow (`.tbl-wrap`) gets `overflow: visible !important` so table content wraps rather than clips. | URD-03 | Must |

---

## Acceptance Criteria

All criteria are verifiable via the macOS print preview sheet (`⌘P` → Preview in the print dialog).

1. **Shortcut fires:** With a file open in reading mode, pressing `⌘P` opens the macOS print dialog within 300ms. Pressing `⌘P` while a `<textarea>` (edit mode) has focus does NOT open the dialog — the browser's native `⌘P` is allowed to pass through.
2. **Palette command present:** `⌘K` → type "print" → "Print / Export PDF…" row appears with `⌘P` hint; selecting it opens the same print dialog.
3. **Chrome hidden:** In print preview, the titlebar, tab bar, sidebar, status bar, toolbar, find bar, all `.tv-copy` buttons, and any open palette/overlay are absent from every page of the preview.
4. **Light theme in print:** In print preview with the app in dark mode, all backgrounds are white, all text is dark (`#1d1d1f`-family), code blocks have a light grey well (`#f4f4f1`), and no dark-mode colours appear.
5. **Full-width content:** In print preview, the content occupies the full printable width (no 720px centred column, no left sidebar gap, no right margin from chrome).
6. **No page-break inside code:** A fenced code block that spans more than one screenful is not cut across pages in print preview (inspect by printing a document with a 40+-line code block).
7. **Mermaid SVG prints:** A document with a resolved Mermaid diagram shows the SVG in print preview at full width, not clipped by the viewport wrapper. A diagram that has not yet resolved (`.dg-load` spinner still visible) shows nothing — not a broken spinner.
8. **Tables wrap:** A document with a wide table that overflows horizontally on screen shows the table columns wrapping (not cut off) in print preview.
9. **Filename header (Should):** In print preview, a small muted line above the first heading shows the document basename (e.g. "architecture.md"). It does not show the full path.
10. **No extra files written:** After printing/saving a PDF via the OS dialog, the app has written no files to the project directory or to the `.md` file's directory (DR-06 compliance).

---

## Out of Scope

- `File > Print…` native menu bar item — belongs to U-01 (native menu spec).
- Headless / CLI PDF export (Rust command, wkhtmltopdf, headless Chrome).
- Custom page size, margin, or orientation controls.
- Print range selection (pages 1–3 only).
- Multi-document / all-tabs batch print.
- Link-URL footnote expansion (e.g. printing `[text](url)` as "text (url)" in a footnote).
- Syntax-theme preservation in print (always forced to light; no "print in dark" option).
- Full absolute path in the print header (basename only, per privacy rationale above).

---

## Implementation Notes

### New file: `app/css/tv-print.css`

Create this file and load it in `app/index.html` as the last stylesheet:
```html
<link rel="stylesheet" href="css/tv-print.css">
```

Entire file content is a single `@media print { … }` block. Suggested section order:

1. **Hide chrome** — `display: none !important` on the selectors listed in DR-102.
2. **Force light tokens** — Override CSS custom properties on `.tv` (DR-103). Use explicit property declarations, not a class swap, because `@media print` cannot add/remove classes.
3. **Full-width layout** — Collapse flex layout on `.tv`, `.tv-body`, `.tv-content`, `.md` (DR-104). Reset padding/margin on `.tv-content` and `.md` wrapper.
4. **Page-break avoidance** — `break-inside: avoid` on the elements in DR-105.
5. **Diagram / table overflow** — Override the pinch-zoom viewport and table wrapper (DR-106).
6. **Print header (Should)** — `.tv-content::before { content: attr(data-print-title); display: block; font-size: 11px; color: #636369; margin-bottom: 12px; font-family: -apple-system, sans-serif; }`.

### tv-app.js change (DR-106 print header, Should)

In the render/activate path where `.tv-content` is populated, add one line:
```js
contentEl.setAttribute('data-print-title', tab.name || '');
```
`tab.name` is already the basename (e.g. `architecture.md`) — no new computation needed.

### tv-app.js change (DR-99)

In the global `keydown` handler (after the `k === '0'` / reset-font block, before the `⌘1–9` digit block), add:
```js
if (k === 'p' || k === 'P') {
  var f = document.activeElement;
  if (f && (f.tagName === 'TEXTAREA' || f.tagName === 'INPUT')) return;
  e.preventDefault();
  window.print();
  return;
}
```
The `if (!meta) return` guard earlier in the handler ensures this only fires with `⌘`. The `activeElement` check is required in addition: the earlier guard does not cover focus on a `<textarea>` or `<input>` because those elements do not suppress meta-key routing — without it, `⌘P` would fire `window.print()` while the user is typing in the edit textarea.

### WKWebView / Tauri print quirks (flag for QA)

- **`window.print()` in WKWebView (Tauri 2 / macOS):** `window.print()` triggers the native macOS print panel correctly in WKWebView on macOS 13+. No Tauri `invoke` or plugin is required. Verified approach in U-15 source gap notes.
- **CSP and `@media print`:** The existing CSP in Tauri does not block stylesheet parsing or `@media print` rules. The `tv-print.css` file is a static asset loaded by `<link>`, not an injected style, so no nonce issue (contrast with the Mermaid SVG `<style>` CSP gotcha documented in `wkwebview-csp-style-attr-gotcha.md`).
- **Mermaid SVG in print — timing risk:** If the user presses `⌘P` before `tvResolveDiagrams()` has completed (the default delay is 1200ms), diagram placeholders (`.dg-load` spinners) will be in the DOM. DR-106 hides these with `display: none !important`, so the print will show a blank diagram slot — not a broken spinner. This is acceptable for v1. A future Should: delay `window.print()` until all `.tv-diagram[data-mermaid]` elements have resolved (poll `dg.querySelector('.dg-load')` is null).
- **Dark-mode print on macOS Ventura+:** macOS honours `@media print` CSS even in WKWebView. The forced light token overrides in DR-103 have been validated as the correct approach — class toggling from JS inside `window.onbeforeprint` is unreliable in WKWebView (the class change may not flush to the renderer before the print rasterisation begins). Property overrides in `@media print` are applied at rasterisation time by the engine.
- **`prefers-color-scheme: print`:** There is no such media feature. `@media print` is the sole mechanism. Combined with forced property overrides (DR-103), this is complete.
- **Reduced-motion in print:** `@media print` is already narrower-scope than screen; no reduced-motion interaction. The `.tv-copy` button's opacity transition is irrelevant because the button is hidden (DR-102).

---

*Prepared via UxPipeline Step 3 grounding against URD-05, URD-07, URD-08, Cluster E, Cluster G, Cluster H. DR-99–DR-106. Critic-verified: no open product questions; implementation is a pure CSS addition + two one-line JS changes.*
