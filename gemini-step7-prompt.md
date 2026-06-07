# Gemini Prompt — Step 7: Visual Design for tiny-viewer

## FILES TO UPLOAD WITH THIS PROMPT
Upload these 4 files:
- `UX-DESIGN-SYSTEM.md`
- `ux-steps/step-3-problem-definition.md`
- `ux-steps/step-5-ia.md`
- `ux-steps/step-6-wireframes.md`

---

## PROMPT

You are a senior product designer executing Step 7 (Visual Design) of a research-driven UX design process for a macOS desktop app called **tiny-viewer** — a lightweight markdown viewer for AI power users.

Read all attached files completely before beginning. They contain the full product context:
- 10 Usage Research Data items (URD-01 through URD-10)
- 10 Design Requirements (DR-01 through DR-10)
- 5 Design Principles
- App map, user flows, navigation schema
- 6 annotated ASCII wireframes with interaction specs

Every design decision must trace back to at least one URD.

---

## WHAT I NEED

Generate **hi-fi visual mockup images** of this macOS app for the following 5 screens. Use Nano Banana to create each as a photorealistic macOS app screenshot.

### Visual Design Direction

**Aesthetic:** Native macOS app. Think the clarity of Apple's Preview.app or Notes.app meets the typography of Bear or iA Writer. Clean, understated, premium.

**Colour:**
- Light theme (primary): warm off-white backgrounds (#FAFAFA or similar), soft grey UI chrome, muted blue accent for active tab/selection
- Dark theme: true dark (#1C1C1E or similar macOS dark), not pitch black. Soft contrast text (#E5E5EA)
- Live watch ⚡ indicator: subtle amber/gold pulse — noticeable without alarming
- Unsaved ● indicator: muted blue dot
- All text must be clearly readable (WCAG AA contrast)

**Typography:**
- System font (SF Pro / San Francisco) for all UI and body text
- SF Mono for code blocks and edit mode
- Body text: 16px on 720px max-width content column, centered
- Headers: bold, clear hierarchy H1 (28px) → H2 (22px) → H3 (18px)

**Chrome:**
- Standard macOS window chrome (traffic lights, title bar)
- Tab bar: slim, browser-style, 32px height max
- Sidebar: 220px, light grey background, collapsible
- Everything else invisible — the document IS the interface

**Spacing:**
- 8px base grid
- Content padding: 40px horizontal, 24px vertical
- Tab bar items: 8px horizontal padding between tabs

---

## 5 SCREENS TO GENERATE AS IMAGES

Generate each screen as a separate image. Each should look like a real macOS app screenshot at retina resolution (aim for ~1440×900 or similar desktop proportion).

### IMAGE 1: Reading Mode — Light Theme, Sidebar Open

Show:
- macOS window with standard traffic light buttons (red/yellow/green)
- Tab bar with 4 tabs: `arch.md`, `api.md`, `schema.md` (active), `flow.md`
- One tab shows ⚡ icon (live watch indicator) — `api.md`
- Sidebar (left, 220px): folder tree showing `/ai-projects/` with 4 .md files listed, "RECENT" section below with 2 files, and a search input at bottom
- Main content area rendering a markdown document with:
  - H1 heading: "Database Schema"
  - H2 subheading: "Overview" with a short paragraph below
  - A rendered markdown table (3 columns: Table, Rows, Index — 4 data rows)
  - H2: "Architecture Diagram" with a rendered Mermaid-style flowchart below it (boxes connected by arrows: Client → API → PostgreSQL → Redis Cache)
  - More body text below
- Scrollbar visible on right edge (macOS overlay style)
- Zero visible toolbars, buttons, or chrome in the content area — just the rendered document
- Overall feel: calm, spacious, content-first

**Design rationale to follow:**
- URD-08: minimal chrome — sidebar is the only UI panel; content area is pure markdown
- URD-03: table and diagram render perfectly as first-class content
- URD-04: tabs show which file is active, with clear visual differentiation

---

### IMAGE 2: Reading Mode — Dark Theme, No Sidebar

Show:
- Same app in dark mode (macOS dark chrome)
- Tab bar with 3 tabs, middle one active
- NO sidebar (collapsed)
- Content showing a different document with:
  - H1 heading
  - Code block (syntax highlighted — dark surface like GitHub dark theme)
  - An inline image placeholder (rendered `![diagram](path)` showing a chart/image)
  - Blockquote section
  - Body paragraph
- 720px content column centered in the window with generous margins
- Dark but not pitch black — warm dark background (#1C1C1E range)

**Design rationale:**
- URD-08: with sidebar hidden, content gets maximum space
- URD-03: code blocks and images render beautifully in dark mode
- DR-07: zero chrome visible in content area

---

### IMAGE 3: Live Watch State — AI Streaming

Show:
- Light or dark theme (your choice for best visual impact)
- Tab bar: one tab has ⚡ amber/gold icon and label `ai-output.md`
- Content showing a document being actively written:
  - Several completed sections (H1, H2, paragraphs) at top
  - At the bottom of content: a blinking cursor or subtle animation indicating "AI is writing here"
  - Below that, a thin status bar at window bottom: `⚡ Live — updated 0.3s ago` on the left, `[Pin scroll]` toggle button on the right
- The status bar should feel subtle — not intrusive, just informative
- Maybe show the scroll position is mid-document (user scrolled up to read while AI writes below)

**Design rationale:**
- URD-10: live file watch without scrolljacking — user reads completed sections while AI appends
- DR-10: scroll position preserved during streaming

---

### IMAGE 4: Command Palette Overlay

Show:
- Main window dimmed/blurred behind
- Centered floating palette (like Spotlight or Raycast):
  - Search input at top with placeholder "Search files and headings..."
  - User has typed "arch" in the search field
  - Results list below:
    - Section: "Jump to Heading" — showing `## Architecture Overview` and `## Architecture Diagram` with file name hint
    - Section divider
    - Section: "Open File" — showing `arch.md` and `arch-v2.md`
    - Section: "Recent" — showing 2 recently opened files
  - First result is highlighted/selected (subtle blue highlight)
- The palette should feel fast, minimal — keyboard-first

**Design rationale:**
- URD-05: instant file access without touching the mouse
- URD-04: jump-to-heading enables in-document navigation

---

### IMAGE 5: Edit Mode

Show:
- Tab bar: active tab shows ● (unsaved changes dot) and label like `● schema.md [editing]`
- A slim edit toolbar below the tab bar (only visible in edit mode):
  - Left: `Esc` button (return to reading)
  - Center: `Cmd+S Save` button
  - Right: word count `847 words`
  - Toolbar background slightly different from content — subtle visual separation
- Content area shows raw markdown source in monospace font (SF Mono):
  - Line numbers on left gutter (muted grey)
  - Cursor visible on a specific line
  - Syntax highlighting: headers in bold, `code` in distinct colour, links coloured
- No sidebar visible
- Feel: clean code editor, minimal — not VS Code, more like a focused writing tool

**Design rationale:**
- URD-09: edit mode is triggered from reading; toolbar appears only here then disappears on Esc
- DR-08: inline editing without full IDE overhead

---

## AFTER GENERATING ALL 5 IMAGES

After producing the mockup images, provide a written **Visual Design Specification** covering:

### Colour Palette
- Semantic colour token table (light + dark values as hex)
- Token names: bg-primary, bg-surface, bg-sidebar, text-primary, text-secondary, text-muted, accent, accent-subtle, border, code-bg, live-indicator, tab-active-bg, tab-inactive-bg

### Type Scale
- Full table: element, size, weight, line-height, colour token

### Spacing System
- 8px base grid values
- Key measurements: tab bar height, sidebar width, content padding, toolbar height, status bar height

### Component State Matrix
For each component (tab, sidebar row, command palette result, button), list:
- Default, hover, active, focus, disabled states
- Colour tokens used per state

### Accessibility Notes
- Contrast ratios for all text/background pairs (note which pass WCAG AA)
- Focus ring specification for keyboard navigation
- `prefers-reduced-motion` behaviour for ⚡ pulse animation
