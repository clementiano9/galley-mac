# tiny-viewer — UX Design System

> **Status (2026-10-08):** kept as the one-page summary of the UX run. Unique here: the Product Brief, the
> 74-WAN index, the WAAD cluster labels and the Technology Recommendation (Tauri was chosen; the Swift
> alternative was not pursued). The product is now named **Galley**; for current IA, sidebar and wireframes
> the shipped code and the UXF specs in `../feature-gaps/specs/` win over the Step 5–6 sections below.

*Research-Driven Product Design, 8-Step Framework*
*Generated: 2026-03-15 | 74 WANs from 5 research streams*

---

## Product Brief

**Type:** Desktop Mac app
**Name:** tiny-viewer
**Target Audience:** AI power users, developers, knowledge workers who work with many markdown files
**Domain:** Productivity / Developer Tools
**Core Problem:** No existing tool lets you quickly view .md files in an organic, beautiful way while working with AI. VSCode's preview is cramped and loses position. Bear renders well but has no image support and feels disconnected from source files. Obsidian uses 4–10GB RAM. Everything feels haphazard.

---

## Research Foundation: 74 WANs

### Stream 1: UX/HCI Academic Research (WAN-001–015)
| WAN | Source | Observation |
|---|---|---|
| WAN-001 | super-productivity.com | Switching tasks costs 23 min 15s of focus recovery (Gloria Mark, UC Irvine) |
| WAN-002 | super-productivity.com | "Attention residue" — working memory stays anchored to prior task after switching |
| WAN-003 | medium.com | 50 devs averaged 47 context switches/day; only 2.3 hrs genuine deep work out of 8 |
| WAN-004 | blog.continue.dev | Switching from IDE to external tool = 4 discrete context switches per interaction |
| WAN-005 | zuunote.com | Split-pane editors (source + preview) cause "exhausting" divided attention |
| WAN-006 | reddit.com/ObsidianMD | Obsidian's Reading vs. Live Preview use different render engines → inconsistency |
| WAN-007 | newyorker.com | iA Writer's focus mode: 500K+ users among designers, programmers, journalists |
| WAN-008 | legendfiction.substack.com | "Poor or overly busy design" is the primary blocker to sustained writing |
| WAN-009 | pmc.ncbi.nlm.nih.gov | Cognitive Load Theory: extraneous load from bad UI directly harms writing quality |
| WAN-010 | frontiersin.org | Distractions in digital reading impair comprehension even when peripherally visible |
| WAN-011 | mjambon.github.io | 40-participant study: editor choice has quantifiable effect on productivity |
| WAN-012 | froala.com | Devs prefer Git-friendly plain text; WYSIWYG causes platform compatibility issues |
| WAN-013 | medium.com/yandex | Yandex: forced tool-switching = "chronic productivity tax"; combined mode eliminated it |
| WAN-014 | github.blog | GitHub Mermaid rollout addressed need to leave MD context for external diagram tools |
| WAN-015 | jakobnielsenphd.substack.com | Optimal UI = minimum chrome, not zero chrome (zero causes navigation errors) |

### Stream 2: App Reviews — Bear, Obsidian, Typora, iA Writer, VSCode (WAN-016–035)
| WAN | App | Pain Point |
|---|---|---|
| WAN-016 | Bear | Zero inline image support (standard `![alt](path)`) — "deal breaker" |
| WAN-017 | Bear | Images AND tables listed as "No" in official compatibility docs |
| WAN-018 | Bear | No version/edit history — deleted content unrecoverable |
| WAN-019 | Bear | Apple-only ecosystem forces ugly workarounds for Windows access |
| WAN-020 | Bear | Hides markdown syntax without option to display raw markup |
| WAN-021 | Bear | Typing becomes "slow and laggy" in large notes open side by side |
| WAN-022 | Obsidian | Performance degrades significantly with large vaults; file open takes "forever" |
| WAN-023 | Obsidian | M1 MacBook Pro 16GB — Obsidian hangs seconds per interaction |
| WAN-024 | Obsidian | After hours open: "runs incredibly slow, can't even shut down properly" |
| WAN-025 | Obsidian | Up to 3 GB RAM on Linux vs 500MB on Windows — architecture-level bloat |
| WAN-026 | Typora | Typing lag as features grew; "I have to stop typing so it can catch up" |
| WAN-027 | Typora | Switching WYSIWYG ↔ source = 2–3 second pause; 0.5–1s keystroke lag on large files |
| WAN-028 | Typora | 3-device license cap frustrates users working on 5+ computers |
| WAN-029 | iA Writer | No navigable outline view or heading fold — unwieldy for long docs |
| WAN-030 | iA Writer | Document organization breaks down for multi-chapter projects |
| WAN-031 | iA Writer | Separate purchase per platform instead of universal license |
| WAN-032 | iA Writer | No split-screen to show source and preview simultaneously |
| WAN-033 | VSCode | Preview and editor panes fall out of sync; jump to random position on file switch |
| WAN-034 | VSCode | Synchronized scroll causes cursor to jump off-screen with images/diagrams |
| WAN-035 | Generic viewer | App silently saves on touch, cursor jumps to end — "catastrophic at times" |

### Stream 3: Reddit / Hacker News (WAN-036–050)
| WAN | Source | Observation |
|---|---|---|
| WAN-036 | reddit.com/microsaas | VSCode preview fights for space; users want dedicated read-only viewer for AI .md |
| WAN-037 | reddit.com/microsaas | No tool updates rendered view live while AI streams output to file |
| WAN-038 | reddit.com/macapps | "Opening Obsidian/VSCode just to read an AI README feels like overkill" |
| WAN-039 | reddit.com/ChatGPTCoding | Need bidirectional editing to click in rendered preview and fix AI output |
| WAN-040 | reddit.com/MacOS | macOS hard-locks .md to "Text" in Finder sidebar; blocks Quick Look extensions |
| WAN-041 | reddit.com/ObsidianMD | Obsidian consuming 10+ GB RAM with handful of plugins + several tabs |
| WAN-042 | reddit.com/ObsidianMD | "Nearly 4 GB RAM at idle on M1 Air — prohibitive and defeats the purpose" |
| WAN-043 | forum.obsidian.md | 22 tabs considered buying new MacBook before realizing tabs were cause |
| WAN-044 | reddit.com/ObsidianMD | 3 separate search interfaces (palette, switcher, global) = fragmented navigation |
| WAN-045 | reddit.com/bearapp | "Spent more time migrating between Bear and Obsidian than actually writing" |
| WAN-046 | reddit.com/bearapp | Switched to Obsidian, spent 2 weeks configuring, took zero notes, returned to Bear |
| WAN-047 | reddit.com/ObsidianMD | PDF export drops Mermaid diagrams and math equations silently |
| WAN-048 | reddit.com/ObsidianMD | Obsidian's Mermaid silently fails on macOS; blank block, requires full restart |
| WAN-049 | forum.cursor.com | Cursor IDE freezes completely on markdown preview with files ≥135 KB |
| WAN-050 | reddit.com/vscode | VS Code tabs return to random scroll position — "breaks reading flow every time" |

### Stream 4: Industry Reports (WAN-051–062)
| WAN | Source | Observation |
|---|---|---|
| WAN-051 | Stack Overflow Survey 2025 | Markdown = 3rd most-used async tool (25.6%); 59.5% admired rate |
| WAN-052 | Stack Overflow Survey 2025 | Obsidian: 9.9% developer usage, 49.1% admired — above Notion in raw usage |
| WAN-053 | stackoverflow.co | Devs more productive when self-serving answers without interrupting colleagues |
| WAN-054 | xda-developers.com | Plain text faster search than Notion; OS indexes files directly without render latency |
| WAN-055 | xda-developers.com | Markdown chosen for zero migration cost — vendor independence is first-class feature |
| WAN-056 | news.ycombinator.com | Obsidian + VS Code simultaneously on same vault — fluid multi-tool editing pattern |
| WAN-057 | peer.asee.org | Non-proprietary format = top PKM criterion above cost and cross-platform availability |
| WAN-058 | idlen.io | AI doc generators still need "significant human editing for quality" |
| WAN-059 | techreviewer.co | Majority of teams verify AI code 100% of cases; AI output = mandatory-review draft |
| WAN-060 | morphik.ai | Engineers spend 5–8 hrs/week on manual doc review and error correction |
| WAN-061 | nngroup.com | NNG: AI outputs must be edited for conciseness, scannability — mandatory human pass |
| WAN-062 | dev.to | Obsidian + GitHub = core daily knowledge system; git-native documentation mindset |

### Stream 5: Performance / RAM Benchmarks (WAN-063–074)
| WAN | Source | Observation |
|---|---|---|
| WAN-063 | forum.obsidian.md | Obsidian idle RAM ~1GB, spikes to 2.5–3GB during heavy plugin/indexing activity |
| WAN-064 | forum.obsidian.md | Electron/V8 imposes hard 4GB per-process heap limit; OOM before OS intervention |
| WAN-065 | forum.obsidian.md | 4GB limit = structural V8 pointer compression constraint — affects all Electron apps |
| WAN-066 | raftlabs.medium.com | Electron idle: 200–300MB; Tauri idle: 30–40MB — 6–8x memory overhead penalty |
| WAN-067 | reddit.com/programming | Tauri benchmarks: 58% less memory, 96% smaller bundle vs equivalent Electron apps |
| WAN-068 | xda-developers.com | Electron keeps background processes + JS timers alive; sustained CPU/RAM even idle |
| WAN-069 | github.com/electron | Two Electron apps on M1 Max cause system-wide 60fps scroll stuttering |
| WAN-070 | github.com/marktext | MarkText cold start: 12 seconds; MacDown cold start: 0.65 seconds |
| WAN-071 | reddit.com/ObsidianMD | 45-second startup for vault of just 201 files — plugins compound Electron cost |
| WAN-072 | github.com/open-webui | Mermaid rendering throttles subsequent text output speed; disabling restores rate |
| WAN-073 | github.com/mermaid-js | Mermaid live editor: visible keystroke lag with medium-complexity diagrams |
| WAN-074 | gitlab.com | 2.5MB / 11,000-line markdown file causes "painfully slow rendering" in GitLab Wiki |

---

## STEP 2: WAAD Clusters

| Cluster | Insight Label | WANs |
|---|---|---|
| A | "Every tool switch costs 23 minutes of mental recovery" | 001–004, 013, 053 |
| B | "RAM hogs and Electron bloat make apps feel hostile" | 063–071, 022–025, 041–042 |
| C | "Diagrams live in a separate, broken universe" | 016, 017, 047, 048, 072, 073, 074, 014 |
| D | "File switching loses your place and your mind" | 033, 034, 050, 043, 044, 049, 026, 021 |
| E | "I want to read, not configure" | 036–040, 045, 046, 006, 020 |
| F | "AI output review is a distinct, underserved workflow" | 058–061, 037, 036, 038, 039 |
| G | "Source files are sacred — keep tools out of the way" | 054, 055, 057, 062, 018, 019, 028–031, 056, 035 |
| H | "UI chrome should be earned, not imposed" | 007–010, 011, 015 |

---

## STEP 2: URD — Usage Research Data

```
[URD-01] [Context Switching Cost] [All work roles]
Every switch from a markdown viewer to another tool costs 23+ minutes of focus recovery
and introduces measurable attention residue. The AI workflow compounds this: users switch
tools 4+ times per AI interaction cycle.
Supporting WANs: WAN-001, WAN-002, WAN-004, WAN-013

[URD-02] [RAM & Performance] [Developer, AI Power User]
Electron-based markdown apps use 200-300MB at baseline, escalating to 4-10GB in real use,
making them architecturally hostile to users running AI models or other memory-intensive
processes in parallel. Tauri/native approaches achieve 30-40MB.
Supporting WANs: WAN-063, WAN-064, WAN-066, WAN-067, WAN-041, WAN-042, WAN-068

[URD-03] [Diagram & Image Rendering] [Developer, Technical Writer]
Bear has zero image support, Obsidian's Mermaid silently fails on macOS, and Mermaid
rendering is CPU-blocking during AI output streaming. No mainstream markdown tool renders
diagrams reliably without performance degradation.
Supporting WANs: WAN-016, WAN-017, WAN-047, WAN-048, WAN-072, WAN-073

[URD-04] [Multi-file Navigation] [All work roles]
Switching between markdown files in every existing tool loses scroll position,
desynchronizes preview/editor panes, or adds perceptible lag — even on M1 hardware.
The basic contract of "return to where I left off" is unmet.
Supporting WANs: WAN-033, WAN-034, WAN-050, WAN-043, WAN-049

[URD-05] [View-First Simplicity] [AI Power User, Researcher]
Opening VS Code or Obsidian "just to read" an AI-generated .md file is described
universally as overkill. Users want something that renders beautifully and gets out of
the way — a dedicated viewer that is the markdown equivalent of Preview.app.
Supporting WANs: WAN-036, WAN-037, WAN-038, WAN-040

[URD-06] [AI Output Review Workflow] [AI Power User, Developer]
AI-generated markdown requires a mandatory human review pass. The emerging usage pattern
is: AI writes .md to disk → user opens rendered view → reads → spots one issue → fixes
one line → closes. No existing tool is optimized for this read-then-spot-edit loop.
Supporting WANs: WAN-058, WAN-059, WAN-060, WAN-061, WAN-039

[URD-07] [File Trust & Portability] [All work roles]
Users treat non-proprietary file-system-based markdown as a top-priority criterion.
They want to open actual .md files where they live on disk, with zero import, zero sync,
and zero vendor lock-in. Tools that write extra files or databases are actively distrusted.
Supporting WANs: WAN-054, WAN-055, WAN-057, WAN-062, WAN-035

[URD-08] [Minimal UI Chrome] [All work roles]
Minimal chrome is measurably productive (500K iA Writer focus-mode users), but zero
chrome causes navigation errors. The optimal design hides controls until invoked,
keeping the content-to-chrome ratio as high as possible.
Supporting WANs: WAN-007, WAN-009, WAN-010, WAN-015

[URD-09] [Lightweight Inline Editing] [AI Power User, Developer]
Users need editing as an extension of viewing — not a mode switch. The minimal
requirement: click in the rendered output to fix one line, then return to reading.
Full editor features are out of scope; targeted inline edits are essential.
Supporting WANs: WAN-039, WAN-006, WAN-020, WAN-026

[URD-10] [Real-Time File Watch] [AI Power User]
When AI tools stream output to a .md file on disk, users need the viewer to update
in real-time without any manual refresh — watching the document grow live. No
mainstream tool does this reliably. This is a zero-to-one capability gap.
Supporting WANs: WAN-037, WAN-049, WAN-072
```

---

## STEP 2: Work Roles

### Role 1: AI Content Reviewer
- **Goals:** Open AI-generated .md files instantly, read rendered output, spot quality issues, make minimal targeted edits, close and move on. Volume: 5–20 files per session.
- **Pain points:** URD-05 (overkill tools), URD-06 (no optimized review loop), URD-10 (no live streaming), URD-02 (RAM competition with AI processes)
- **Key WANs:** 036, 037, 038, 039, 058, 059, 060

### Role 2: Developer / Technical Writer
- **Goals:** View documentation, READMEs, specs, and design docs across many files. Diagrams (Mermaid, images) must render. Needs fast cross-file navigation. Occasionally makes edits.
- **Pain points:** URD-03 (diagram failure), URD-04 (position loss), URD-02 (RAM), URD-07 (file trust)
- **Key WANs:** 014, 016, 022, 033, 034, 047, 048, 054, 056

### Role 3: Knowledge Worker / Researcher
- **Goals:** Read, reference, and lightly organize notes from the file system. Wants simplicity and zero configuration overhead. Uses markdown for permanence and portability.
- **Pain points:** URD-05 (overkill tools), URD-07 (file trust), URD-08 (chrome overload), Cluster E (overconfiguration trap)
- **Key WANs:** 045, 046, 053, 057, 062

---

## STEP 2: Flow Models

### Sequence Model: AI Output Review Task
```
1. AI completes generation → .md file written to disk
2. User triggers file open (drag to dock / Cmd+O / file association)
3. App opens file in <500ms, renders immediately
4. [if streaming] Live watch: content updates in real-time as AI writes
5. User reads rendered output top-to-bottom
6. User spots issue → double-clicks on paragraph → enters inline edit
7. User fixes line → Cmd+S → returns to reading view
8. User finishes review → Cmd+W closes tab → file remains on disk unchanged
```

### Sequence Model: Multi-file Navigation Task
```
1. User has 8 .md files from an AI session to review
2. Cmd+O or drag-drop folder → all files appear as tabs
3. User reads File 1 to line 47 (scroll position auto-saved)
4. Cmd+] or click Tab 2 → File 2 opens instantly, full render
5. User returns to Tab 1 → picks up exactly at line 47
6. Cmd+K → command palette → fuzzy-search for "architecture" → jumps to file/heading
7. User closes tabs as they finish each file
```

---

## STEP 3: Problem Definition

### Problem Statements
| # | Statement | URD |
|---|---|---|
| P1 | AI Content Reviewer needs a way to open and read any .md file in <1 second without tool overhead because switching to VS Code or Obsidian costs 30+ seconds and 23 minutes of focus recovery. | URD-05, URD-01 |
| P2 | Developer needs a way to see Mermaid diagrams and inline images rendered correctly because Bear has zero image support and Obsidian's Mermaid silently fails on macOS. | URD-03 |
| P3 | All roles need a way to switch between many open markdown files without losing scroll position because every existing tool resets position on tab return. | URD-04 |
| P4 | AI Power User needs a markdown viewer that competes minimally for RAM because running AI processes alongside Electron apps makes machines unusable. | URD-02 |
| P5 | AI Content Reviewer needs a way to watch a file update in real-time as AI writes to it because no existing viewer provides live file-watch streaming. | URD-10 |
| P6 | Knowledge Worker needs to open .md files from disk without any import, sync, or database because they treat file sovereignty as a top-priority requirement. | URD-07 |

### HMW Questions
1. HMW make opening any .md file feel as instant and friction-free as opening a browser tab?
2. HMW render Mermaid diagrams and images beautifully without blocking reading performance?
3. HMW guarantee that returning to an open file always restores the exact scroll position?
4. HMW build a markdown viewer that uses less RAM than a single browser tab (~50MB)?
5. HMW show a file updating live as an AI writes to it, without scrolljacking?
6. HMW open any .md file on disk without leaving any trace, import, or database behind?

### Success Metrics
| HMW | Metric |
|---|---|
| #1 (instant open) | Time-to-render for 100KB .md file < 300ms on M1 |
| #2 (diagrams) | Mermaid + standard images render correctly in 100% of test files |
| #3 (scroll position) | Scroll position restored to within 2 lines on tab return |
| #4 (RAM) | Idle RAM < 80MB; 10 open tabs < 200MB total |
| #5 (live watch) | File updates visible within 200ms of disk write |
| #6 (file trust) | App writes zero files outside .md files user explicitly saves |

### Design Requirements
| # | Requirement | Source |
|---|---|---|
| DR-01 | App must render any .md file to visible content in <300ms | URD-05, URD-01 |
| DR-02 | Must render standard Markdown images, tables, and Mermaid diagrams | URD-03 |
| DR-03 | Scroll position must be saved and restored per-file across tab switches | URD-04 |
| DR-04 | Idle RAM usage must be <80MB; 10 tabs must not exceed 200MB | URD-02 |
| DR-05 | Must watch open files on disk and re-render on change without user action | URD-10 |
| DR-06 | Must read actual .md files from disk — no import, no sync, no extra files written | URD-07 |
| DR-07 | UI chrome must be invisible at rest; appear on-demand (hover, key) | URD-08 |
| DR-08 | Must support inline editing triggered by double-click on rendered content | URD-09 |
| DR-09 | Must support 10+ simultaneously open files with <50ms tab-switch time | URD-04 |
| DR-10 | Live watch updates must not alter scroll position during streaming | URD-10 |

### Design Principles
1. **Read-first, edit second.** Viewing is the primary mode; editing is an opt-in extension.
2. **Files live on disk.** The app is a lens, not a database. Zero import, zero sync.
3. **Speed is respect.** Every interaction must feel instant. Loading states are product failures.
4. **Chrome earns its presence.** Every UI element must justify its visual real estate.
5. **Diagrams are first-class citizens.** Mermaid, images, and tables render perfectly on first load.

### Constraints
| Constraint | Source | Conflicts? |
|---|---|---|
| Must be native macOS or use minimal runtime — no Electron | URD-02, WAN-067 | — |
| Must not write to file system without explicit user save | URD-07, WAN-035 | — |
| Mermaid rendering must be async/non-blocking | URD-03, WAN-072 | DR-01 (mitigated: progressive render) |
| macOS sandbox requires Open Panel for file access | — | DR-06 (mitigated: persistent folder bookmarks) |

---

## STEP 4: Ideation — Selected Direction

**Direction B: "Browser tab model" — Persistent Lightweight Viewer**

A small, persistent Mac app. Files open as browser-like tabs. Cmd+T opens fuzzy file picker. Tab switching is instant with position memory. Sidebar shows files and folder tree (Cmd+B). Mermaid/images render natively. Live file-watch streams without scroll disruption. Inline editing on double-click.

**Chosen because:** Covers all 10 URDs. Browser tab model is universally understood by target users. Direction A (floating windows) lacks persistence (URD-04). Direction C (spatial canvas) contradicts URD-02 (RAM) and URD-08 (chrome).

---

## STEP 5: Information Architecture

### App Map
```
tiny-viewer
│
├── MAIN WINDOW
│   ├── Tab Bar (persistent)
│   │   ├── File tabs (Cmd+1–9 to jump, Cmd+[/] to cycle)
│   │   └── + New Tab button (Cmd+T)
│   │
│   ├── Sidebar Panel (Cmd+B to toggle, 220px)
│   │   ├── Recent Files (last 20)
│   │   ├── Open Folders (with file tree)
│   │   └── Search (Cmd+F: in-file; Cmd+Shift+F: across tabs)
│   │
│   └── Document Viewer
│       ├── Reading Mode (default)
│       │   ├── Rendered markdown (headers, body, tables, code, images)
│       │   ├── Mermaid diagrams (async-rendered)
│       │   └── Live watch indicator (subtle pulse when file is being written)
│       └── Edit Mode (double-click to activate)
│           ├── Source editor (monospace)
│           ├── Cmd+S to save
│           └── Esc to return to Reading Mode
│
├── COMMAND PALETTE (Cmd+K)
│   ├── Open File…
│   ├── Open Folder…
│   ├── Recent Files (fuzzy search)
│   ├── Jump to Heading
│   └── Settings
│
└── SETTINGS (minimal)
    ├── Appearance: Light / Dark / System
    ├── Typography: Font size (Small / Medium / Large)
    ├── Diagrams: Mermaid on/off
    └── Editor: Line numbers on/off
```

### User Flows

**Flow 1: Open AI-generated file(s)**
```
AI writes .md files to disk →
User drags folder to dock OR Cmd+O →
Each file opens as tab; first renders immediately →
[if streaming] ⚡ live watch active; content streams in →
User reads; tabs with Cmd+] →
Spots issue → double-click → inline edit → Cmd+S →
Cmd+W close tab; file stays on disk
```

**Flow 2: Multi-file navigation**
```
8 tabs open →
Click Tab 3 (or Cmd+3) → <50ms switch, position restored →
Cmd+K → "database schema" → jumps to heading in Tab 6 →
Cmd+[ → back to Tab 3, position remembered →
Cmd+Shift+F → "latency" → results across all tabs → click → navigate
```

### Navigation Schema
| Method | Trigger | Scope |
|---|---|---|
| Tab switching | Click, Cmd+1–9, Cmd+[/] | Between open files |
| Command palette | Cmd+K | App-wide |
| Sidebar tree | Cmd+B | File system |
| In-file search | Cmd+F | Current document |
| Cross-tab search | Cmd+Shift+F | All open tabs |
| Drag & drop | Drag .md or folder | Open files |

---

## STEP 6: Wireframes

### Screen 1: Main Window — Reading Mode
```
┌─────────────────────────────────────────────────────────────────────────┐
│ [tiny-viewer]                                              [─][□][✕]    │
├──────────────────────────────────────────────────────────────────────────│
│ ○ arch.md  ○ api.md  ○ schema.md  • db-design.md  ○ flow.md  ○ + …  [+] │
├──────────────────────────────────────────────────────────────────────────│
│ SIDEBAR (Cmd+B)     │                                                    │
│ ─────────────────── │  # Database Design                                 │
│ 📂 /ai-projects     │                                                    │
│   📄 arch.md        │  ## Overview                                       │
│   📄 api.md         │  The system uses a PostgreSQL primary with Redis   │
│   📄 schema.md      │  cache layer. All writes go through...             │
│   📄 db-design.md ← │                                                    │
│   📄 flow.md        │  ## Schema                                         │
│                     │                                                    │
│ ─────────────────── │  | Table    | Rows | Index  |                      │
│ RECENT              │  |----------|------|--------|                      │
│ ─────────────────── │  | users    | 1.2M | email  |                      │
│ arch-v2.md          │  | sessions | 4.8M | token  |                      │
│ spec-draft.md       │  | events   | 50M  | created|                      │
│                     │                                                    │
│ [Search…]  Cmd+F    │  ## Architecture Diagram                           │
│                     │  ┌────────────────────────────────┐               │
│                     │  │  Client → API → PostgreSQL      │               │
│                     │  │               ↓                 │               │
│                     │  │           Redis Cache           │               │
│                     │  └────────────────────────────────┘               │
└─────────────────────┴───────────────────────────────────────────────────┘
  [URD-07] real disk files    [URD-08] zero chrome in document area
  [URD-03] diagram rendered   [URD-02] native/Tauri, not Electron
```

### Screen 2: Edit Mode
```
┌─────────────────────────────────────────────────────────────────────────┐
│ [tiny-viewer]                                              [─][□][✕]    │
├──────────────────────────────────────────────────────────────────────────│
│ ○ arch.md  ○ api.md  ● db-design.md [editing]  ○ flow.md  [+]          │
├──────────────────────────────────────────────────────────────────────────│
│ [Esc: Reading]  [Cmd+S: Save]  [word count: 847]                        │ ← ONLY appears in edit mode
├──────────────────────────────────────────────────────────────────────────│
│                     │  1 | ## Schema                                      │
│                     │  2 |                                               │
│                     │  3 | | Table    | Rows | Index  |  ← cursor       │
│                     │  4 | |----------|------|--------|                 │
│                     │  5 | | users    | 1.2M | email  |                 │
│                     │  8 |                                               │
│                     │  9 | ## Architecture Diagram                       │
└─────────────────────┴───────────────────────────────────────────────────┘
  [URD-09] double-click to enter; cursor at clicked line
  Esc returns to reading at same scroll position
```

### Screen 3: Command Palette (Cmd+K)
```
                   ┌───────────────────────────────┐
                   │ 🔍  architecture schema        │
                   ├───────────────────────────────┤
                   │ Jump to: ## Schema             │
                   │ Jump to: ## Architecture…     │
                   │ Open: arch.md                  │
                   │ Open: spec-draft.md            │
                   │ ─────────────────────────────  │
                   │ Recent: api.md                 │
                   │ Recent: flow.md                │
                   └───────────────────────────────┘
  [URD-05] instant file open; [URD-04] jump-to-heading; keyboard-first
```

### Screen 4: Live Watch State
```
┌─────────────────────────────────────────────────────────────────────────┐
│ [tiny-viewer]                                              [─][□][✕]    │
├──────────────────────────────────────────────────────────────────────────│
│ ○ arch.md  ⚡ ai-output.md  ○ flow.md  [+]                              │
├──────────────────────────────────────────────────────────────────────────│
│                     │  # AI Output: System Design                        │
│                     │                                                    │
│                     │  ## Introduction                                   │
│                     │  The proposed architecture uses three layers...   │
│                     │                                                    │
│                     │  ## Layer 3: Storage                               │
│                     │  ▌  [cursor — AI still writing here]               │
│                     │  ─────────────────────────────────────            │
│                     │  ⚡ Live — last updated 0.2s ago    [Pin scroll]  │
└─────────────────────┴───────────────────────────────────────────────────┘
  [URD-10] scroll position NOT altered unless user pins scroll
  User can scroll up to read completed sections while AI writes
```

### Screen 5: Empty State
```
┌─────────────────────────────────────────────────────────────────────────┐
│ [tiny-viewer]                                              [─][□][✕]    │
├──────────────────────────────────────────────────────────────────────────│
│                    ┌──────────────────────────┐                         │
│                    │                          │                         │
│                    │   Drop .md files here    │                         │
│                    │   or press Cmd+O         │                         │
│                    │                          │                         │
│                    └──────────────────────────┘                         │
└─────────────────────────────────────────────────────────────────────────┘
  [URD-05] zero friction first action; [URD-07] no setup, no vault
```

### Interaction Specifications
| Interaction | Behavior | URD |
|---|---|---|
| File open | Drag .md to dock OR Cmd+O → renders in <300ms | URD-05 |
| Tab switch | Click tab, Cmd+1–9, Cmd+[/] → <50ms, position restored | URD-04 |
| Live watch | ⚡ icon in tab; content streams at bottom; no scroll jump | URD-10 |
| Enter edit | Double-click anywhere → source at clicked line | URD-09 |
| Exit edit | Esc or click reading area → render at same scroll | URD-09 |
| Sidebar | Cmd+B toggles; shows disk files only | URD-07 |
| Diagram render | Mermaid renders async after text; placeholder while loading | URD-03 |
| Search | Cmd+F (in-file), Cmd+Shift+F (all tabs) | URD-04 |

### Error States
| State | Display |
|---|---|
| File not found | "⚠ File moved or deleted" + "Locate file…" button |
| Empty file | "This file is empty." — instant, no spinner |
| Mermaid parse error | Shows diagram source with error line highlighted |
| Permission denied | "Grant access to this folder" → macOS permission dialog |
| File too large (>5MB) | "Large file — rendering may be slower" → renders anyway |

---

## Technology Recommendation

Based on DR-04 (RAM < 80MB) and WAN-066/067 (Tauri 58% less RAM, 96% smaller bundle):

**Recommended stack:** Tauri 2.x (Rust backend + WebView frontend)
- Reuses macOS native WebView (WKWebView) — no bundled Chromium
- FSEvents for live file watch (native macOS API)
- markdown-it or marked.js for rendering (in WebView)
- mermaid.js loaded async (non-blocking)
- Idle RAM target: 30–50MB (achievable with Tauri vs 200-300MB with Electron)

**Alternative:** Swift native app (SwiftUI + WKWebView for markdown rendering)
- Maximum RAM efficiency; best macOS integration
- Higher development cost

---

*Design system complete. 74 WANs → 8 WAAD clusters → 10 URDs → 3 work roles → 10 DRs → 5 design principles → Direction B selected → full IA + wireframes.*
