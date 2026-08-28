# Step 4: Ideation
*3 distinct design directions evaluated against URDs; one selected with rationale*

---

## Three Design Directions

### Direction A: "Quick Look, but yours" — Chromeless Floating Windows

**Core interaction model:** The app lives in the menu bar only. Opening a .md file launches a borderless floating window with pure rendered content. Multiple files = multiple windows you arrange spatially. Edit mode triggers by double-click. No sidebar, no tabs, no persistent window state.

**URDs addressed:** URD-05 (view-first), URD-07 (file trust), URD-08 (minimal chrome)

**URDs NOT addressed:**
- URD-04 — no tab/position management; window proliferation with 10+ files
- URD-10 — no streaming UI / live watch indicator
- URD-02 — unconstrained window count leads to memory growth
- URD-06 — no organized review flow for multiple AI-generated files

**Assessment:** Elegant for single-file use. Breaks down for the multi-file AI review workflow.

---

### Direction B: "Browser tab model" — Persistent Lightweight Viewer ✓ CHOSEN

**Core interaction model:** A small, persistent Mac app (~Menu-bar height toolbar + full content area). Files open as browser-like tabs. Cmd+T opens a fuzzy file picker. Tab switching is instant with scroll position memory. Sidebar shows recently opened files and folder tree (Cmd+B to toggle). Mermaid/images render natively. Live file-watch streams updates without scroll disruption. Inline editing on double-click; Esc returns to reading.

**URDs addressed:** URD-01, URD-02, URD-03, URD-04, URD-05, URD-06, URD-07, URD-08, URD-09, URD-10

**URDs NOT addressed:** None — covers all 10.

**Assessment:** The browser tab model is universally understood by developers and knowledge workers. It requires zero learning. All 10 URDs are addressed.

---

### Direction C: "Spatial canvas" — Freeform Multi-document Workspace

**Core interaction model:** Files open as resizable cards on a zoomable canvas (like Miro for markdown). You pan/zoom to navigate. Cards can be pinned, linked, grouped. Relationships between documents are visible spatially.

**URDs addressed:** URD-05 (clean per-card), URD-08 (clean per-card)

**URDs NOT addressed:**
- URD-02 — canvas apps are RAM-intensive; contradicts <80MB goal
- URD-04 — spatial positioning ≠ reliable scroll position memory
- URD-09 — edit on canvas is complex (which card is active?)
- URD-10 — live update in canvas context is disorienting
- URD-03 — Mermaid in canvas = performance risk

**Assessment:** Interesting but contradicts the core RAM and simplicity requirements. Complexity inversely proportional to the value it would deliver for this use case.

---

## Selected Direction: B — "Browser tab model"

**Rationale:**
1. Covers all 10 URDs — the only direction to do so
2. Browser tab paradigm is immediately intuitive for target users (developers, power users)
3. Direction A fails on multi-file workflow management (URD-04, URD-06)
4. Direction C contradicts RAM constraint (URD-02) and simplicity principle (URD-08)
5. The design challenge is making Direction B *feel as light as Direction A* while having all of B's capabilities — achievable through Tauri (native webview, minimal chrome, no electron overhead)

**Key design tension to resolve in wireframes:** How to make a tab-based app feel minimal and non-intimidating when empty. Solution: empty state is a drop zone; sidebar hides by default; toolbar is invisible until hover.

---

## Rapid Sketch — Chosen Direction

```
COMPACT MODE (no sidebar):
┌────────────────────────────────────────────────────┐
│ ○ file1.md  ○ file2.md  • file3.md  [+]           │  ← minimal tab bar
├────────────────────────────────────────────────────┤
│                                                    │
│  # Heading                                         │
│                                                    │
│  Content renders here. Clean typography.           │
│  No UI elements visible unless hovered.            │
│                                                    │
│  ## Sub-heading                                    │
│  More content...                                   │
│                                                    │
└────────────────────────────────────────────────────┘

EXPANDED MODE (sidebar + content):
┌────────────────────────────────────────────────────┐
│ ○ file1.md  ○ file2.md  • file3.md  [+]           │
├──────────────┬─────────────────────────────────────┤
│ 📂 /project  │  # Heading                          │
│   📄 file1   │                                     │
│   📄 file2   │  Content renders here.              │
│   📄 file3 ← │                                     │
│              │  ## Sub-heading                     │
│ RECENT       │  More content...                    │
│ arch-v2.md   │                                     │
└──────────────┴─────────────────────────────────────┘
```
