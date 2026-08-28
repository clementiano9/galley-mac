# Step 6: Wireframes
*Phase A (annotated ASCII) + Phase B (interaction patterns, error states, breakpoints)*

---

## Phase A — Paper Prototype (Annotated ASCII)

### Screen 1: Main Window — Reading Mode (sidebar open, 5 tabs)

```
┌─────────────────────────────────────────────────────────────────────────┐
│ [tiny-viewer]                                              [─][□][✕]    │ ← standard macOS chrome ONLY
├──────────────────────────────────────────────────────────────────────────│
│ ○ arch.md  ○ api.md  ○ schema.md  • db-design.md  ○ flow.md  [+]       │
│ ↑ ○=unmodified  •=live watch active                                     │
├────────────────┬────────────────────────────────────────────────────────┤
│                │                                                        │
│ 📂 /ai-projects│  # Database Design                          [URD-08]  │
│   📄 arch.md   │                                             zero chrome│
│   📄 api.md    │  ## Overview                                in content │
│   📄 schema.md │  The system uses a PostgreSQL primary with Redis       │
│ → 📄 db-design │  cache layer. All writes go through the main...        │
│   📄 flow.md   │                                                        │
│                │  ## Schema                                             │
│ ─────────────  │                                                        │
│ RECENT         │  | Table    | Rows  | Index    |            [URD-03]  │
│ arch-v2.md     │  |----------|-------|----------|            tables     │
│ spec-draft.md  │  | users    | 1.2M  | email    |            render     │
│                │  | sessions | 4.8M  | token    |                      │
│ [Search…]      │  | events   | 50M   | created  |                      │
│  Cmd+F         │                                                        │
│                │  ## Architecture Diagram                               │
│                │  ┌─────────────────────────────────────┐              │
│                │  │  Client ──→ API Gateway              │  [URD-03]  │
│                │  │              │                        │  Mermaid   │
│                │  │         PostgreSQL                    │  rendered  │
│                │  │              ↓                        │  async     │
│                │  │          Redis Cache                  │            │
│                │  └─────────────────────────────────────┘              │
│                │                                                        │
│                │  ## Indexing Strategy                                  │
│                │  Compound indexes are used for queries that...        │
│                │                                                        │
│                │                                             ▐▌ scroll │
└────────────────┴────────────────────────────────────────────────────────┘
  [URD-07] sidebar shows actual disk files — no import, no database
  [URD-02] native/Tauri rendering — no Electron overhead
  [URD-04] tab • indicates live watch; scroll position remembered per tab
```

---

### Screen 2: Edit Mode (double-click activated)

```
┌─────────────────────────────────────────────────────────────────────────┐
│ [tiny-viewer]                                              [─][□][✕]    │
├──────────────────────────────────────────────────────────────────────────│
│ ○ arch.md  ○ api.md  ● db-design.md [unsaved]  ○ flow.md  [+]          │
│                      ↑ ● = has unsaved changes                         │
├──────────────────────────────────────────────────────────────────────────│
│ [Esc: Return to reading]  [Cmd+S: Save]  [word count: 847]              │ ← Edit toolbar
│ ↑ ONLY appears when in Edit Mode. Hidden in Reading Mode.               │ ← [URD-09]
├────────────────┬────────────────────────────────────────────────────────┤
│                │                                                        │
│ (sidebar same) │  ...previous content above...                         │
│                │                                                        │
│                │   8 |                                                  │
│                │   9 | ## Schema                                        │
│                │  10 |                                                  │
│                │  11 | | Table    | Rows  | Index    |  ← cursor here  │
│                │  12 | |----------|-------|----------|                  │
│                │  13 | | users    | 1.2M  | email    |                 │
│                │  14 | | sessions | 4.8M  | token    |                 │
│                │  15 | | events   | 50M   | created  |                 │
│                │  16 |                                                  │
│                │  17 | ## Architecture Diagram                          │
│                │                                                        │
│                │  [monospace font, syntax highlighting]                 │
│                │                                                        │
└────────────────┴────────────────────────────────────────────────────────┘
  [URD-09] User double-clicked on table → Edit Mode opens at line 11
  Esc → returns to Reading Mode at exact same scroll position
  Cmd+S → saves to disk, returns to Reading Mode
```

---

### Screen 3: Command Palette (Cmd+K)

```
┌─────────────────────────────────────────────────────────────────────────┐
│  (main window dimmed behind)                                            │
│                                                                         │
│                   ┌─────────────────────────────────┐                  │
│                   │ 🔍  architecture schema          │                  │
│                   ├─────────────────────────────────┤                  │
│                   │ ▶ Jump to: ## Schema        tab3 │ ← heading jump  │
│                   │ ▶ Jump to: ## Architecture… tab3 │                 │
│                   │ ─────────────────────────────── │                  │
│                   │   Open: arch.md                 │ ← fuzzy file    │
│                   │   Open: spec-draft.md           │   match         │
│                   │ ─────────────────────────────── │                  │
│                   │   Recent: api.md                │                  │
│                   │   Recent: flow.md               │                  │
│                   └─────────────────────────────────┘                  │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
  [URD-05] instant file open — no mouse required
  [URD-04] jump-to-heading for in-document navigation
  [URD-07] shows disk files only — no database items
```

---

### Screen 4: Live Watch State (AI streaming to file)

```
┌─────────────────────────────────────────────────────────────────────────┐
│ [tiny-viewer]                                              [─][□][✕]    │
├──────────────────────────────────────────────────────────────────────────│
│ ○ arch.md  ⚡ ai-output.md  ○ flow.md  [+]                              │
│            ↑ ⚡ = file is being actively written by external process    │
├──────────────────────────────────────────────────────────────────────────┤
│                │                                                        │
│                │  # AI Output: System Design                            │
│                │                                                        │
│                │  ## Introduction                                       │
│                │  The proposed architecture uses three distinct layers  │
│                │  to separate concerns. Each layer...                   │
│                │                                                        │
│                │  ## Layer 1: Ingestion                                 │
│                │  Events arrive via a Kafka topic subscribed by...      │
│                │                                                        │
│                │  ## Layer 2: Processing                                │
│                │  Each event is validated against a JSON schema...     │
│                │                                                        │
│                │  ## Layer 3: Storage                                   │
│                │  ▌  ← AI is writing here                               │
│                │  (new content appears here as AI writes)               │
│                │                                                        │
│                ├────────────────────────────────────────────────────────│
│                │ ⚡ Live — updated 0.2s ago               [Pin scroll] │ ← [URD-10]
└────────────────┴────────────────────────────────────────────────────────┘
  USER CAN FREELY SCROLL UP to read completed sections [URD-10]
  [Pin scroll] button: when toggled ON, auto-scrolls to follow AI output
  When OFF (default): scroll position held wherever user left it
  File watch uses macOS FSEvents — zero polling overhead
```

---

### Screen 5: Cross-tab Search Results (Cmd+Shift+F)

```
┌─────────────────────────────────────────────────────────────────────────┐
│ [tiny-viewer]                                              [─][□][✕]    │
├──────────────────────────────────────────────────────────────────────────│
│ ○ arch.md  ○ api.md  ○ schema.md  • db-design.md  ○ flow.md  [+]       │
├────────────────┬────────────────────────────────────────────────────────┤
│                │  Search across all tabs: [latency          ] [✕]      │
│ (sidebar)      │                                                        │
│                │  RESULTS (12 matches across 3 files)                  │
│                │  ─────────────────────────────────────────            │
│                │  📄 arch.md (4 matches)                                │
│                │    L.47  "...network latency should be measured..."    │
│                │    L.89  "...p99 latency target is 200ms..."           │
│                │    L.102 "...latency budget breakdown..."              │
│                │    L.134 "...reduce latency by caching..."             │
│                │                                                        │
│                │  📄 db-design.md (6 matches)                           │
│                │    L.23  "...index latency on the users table..."      │
│                │    L.45  "...query latency increased after..."  ←click │
│                │    ...                                                 │
│                │                                                        │
│                │  📄 flow.md (2 matches)                                │
│                │    L.12  "...end-to-end latency..."                    │
│                │                                                        │
└────────────────┴────────────────────────────────────────────────────────┘
  Click any result → navigates to that file + scroll position [URD-04]
  Results stay visible until user closes search (✕ or Esc)
```

---

### Screen 6: Empty State / First Launch

```
┌─────────────────────────────────────────────────────────────────────────┐
│ [tiny-viewer]                                              [─][□][✕]    │
├──────────────────────────────────────────────────────────────────────────│
│                                                                         │
│                                                                         │
│                                                                         │
│                    ┌────────────────────────────┐                       │
│                    │                            │                       │
│                    │     Drop .md files here    │                       │
│                    │                            │                       │
│                    │       ─── or ───           │                       │
│                    │                            │                       │
│                    │     Press  Cmd+O           │                       │
│                    │     to open files          │                       │
│                    │                            │                       │
│                    └────────────────────────────┘                       │
│                                                                         │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
  [URD-05] zero friction first action
  [URD-07] no sign-up, no setup, no vault, no account
  No "Getting Started" tutorial. No "Create your first note" prompt.
  The only action is: open a file.
```

---

## Phase B — Mid-Fidelity Specifications

### Core Interaction Specifications

| Interaction | Trigger | Behavior | URD |
|---|---|---|---|
| **File open — single** | Cmd+O, drag to window, Finder double-click | Renders in <300ms | URD-05 |
| **File open — folder** | Cmd+Shift+O, drag folder to window | All .md files as tabs | URD-05 |
| **Tab switch** | Click, Cmd+1–9, Cmd+[/] | <50ms, scroll position restored | URD-04 |
| **Live watch** | Automatic when file is externally modified | ⚡ in tab, update at bottom | URD-10 |
| **Scroll behavior (live)** | AI writes to file | Content appears at bottom, no jump | URD-10 |
| **Pin scroll** | Click [Pin scroll] button | Auto-scrolls to follow new content | URD-10 |
| **Enter edit mode** | Double-click anywhere in document | Source appears, cursor at line | URD-09 |
| **Exit edit mode** | Esc key | Reading mode resumes at same position | URD-09 |
| **Save** | Cmd+S (in edit mode) | Writes to disk, exits edit mode | URD-09 |
| **Toggle sidebar** | Cmd+B | 220px sidebar slides in/out | URD-07 |
| **Mermaid diagram** | File contains ```mermaid block | Renders async; placeholder while loading | URD-03 |
| **In-file search** | Cmd+F | Highlight + navigate matches in current file | URD-04 |
| **Cross-tab search** | Cmd+Shift+F | Results panel across all open tabs | URD-04 |
| **Command palette** | Cmd+K | Fuzzy: files, headings, recent, actions | URD-05 |
| **Zoom** | Cmd+= / Cmd+- | Scales font size (persists as setting) | — |

---

### Responsive Breakpoints

| Window width | Layout |
|---|---|
| ≥1440px (full screen) | Sidebar visible by default (Cmd+B to hide) |
| 1024–1439px (standard) | Sidebar hidden by default (Cmd+B to show) |
| <1024px (compact) | No sidebar; command palette is primary navigation |

---

### Empty & Error States

| State | Display | Action |
|---|---|---|
| **App first launch** | Drop zone + Cmd+O hint | — |
| **No tabs open** | Drop zone + Cmd+O hint | — |
| **File not found** | Tab shows "⚠ File moved or deleted" | "Locate file…" button |
| **Empty .md file** | "This file is empty." (no spinner, instant) | — |
| **Mermaid parse error** | Shows diagram source with error line highlighted in red | — |
| **File access denied** | "tiny-viewer needs access to this folder" | Opens macOS permission dialog |
| **File too large (>5MB)** | "Large file — rendering may be slower" banner | Renders anyway, banner auto-dismisses |
| **Binary file** | "This file cannot be rendered as markdown" | "Open in Finder" button |

---

### Typography System (Reading Mode)

| Element | Font | Size | Weight | Color |
|---|---|---|---|---|
| H1 | System (SF Pro / San Francisco) | 28px | Bold | Primary text |
| H2 | System | 22px | Semibold | Primary text |
| H3–H6 | System | 18–16px | Medium | Primary text |
| Body | System | 16px (medium) | Regular | Primary text |
| Code (inline) | Monospace | 14px | Regular | Code surface bg |
| Code (block) | Monospace | 13px | Regular | Code surface bg |
| Table | System | 14px | Regular | Primary text |
| Max content width | — | 720px centered | — | — |

**Rationale:** System fonts (SF Pro on macOS) require no loading, look native, and scale with system accessibility settings. Max content width of 720px matches optimal reading line length (60–80 characters) from readability research.
