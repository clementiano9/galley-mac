# Step 3: Problem Definition
*Design brief grounded in URD evidence — every item cites a URD number*

---

## Problem Statements

| # | Statement | URD |
|---|---|---|
| P1 | AI Content Reviewer needs a way to open and read any .md file in <1 second without tool overhead because switching to VS Code or Obsidian costs 30+ seconds and 23 minutes of focus recovery. | URD-05, URD-01 |
| P2 | Developer needs a way to see Mermaid diagrams and inline images rendered correctly because Bear has zero image support and Obsidian's Mermaid silently fails on macOS. | URD-03 |
| P3 | All roles need a way to switch between many open markdown files without losing scroll position because every existing tool resets position on tab return. | URD-04 |
| P4 | AI Power User needs a markdown viewer that competes minimally for RAM because running AI processes alongside Electron apps makes machines unusable. | URD-02 |
| P5 | AI Content Reviewer needs a way to watch a file update in real-time as AI writes to it because no existing viewer provides live file-watch streaming. | URD-10 |
| P6 | Knowledge Worker needs to open .md files from disk without any import, sync, or database because they treat file sovereignty as a top-priority requirement. | URD-07 |

---

## HMW Questions

1. HMW make opening any .md file feel as instant and friction-free as opening a browser tab?
2. HMW render Mermaid diagrams and images beautifully without blocking reading performance?
3. HMW guarantee that returning to an open file always restores the exact scroll position?
4. HMW build a markdown viewer that uses less RAM than a single browser tab (~50MB)?
5. HMW show a file updating live as an AI writes to it, without scrolljacking?
6. HMW open any .md file on disk without leaving any trace, import, or database behind?

---

## Success Metrics

| HMW | Measurable Metric |
|---|---|
| #1 (instant open) | Time-to-render for 100KB .md file < 300ms on M1 |
| #2 (diagrams) | Mermaid + standard images render correctly in 100% of test files |
| #3 (scroll position) | Scroll position restored to within 2 lines on tab return |
| #4 (RAM) | Idle RAM < 80MB; 10 open tabs < 200MB total |
| #5 (live watch) | File updates visible within 200ms of disk write |
| #6 (file trust) | App writes zero files outside .md files user explicitly saves |

---

## Design Requirements

| # | Requirement | Source |
|---|---|---|
| DR-01 | App must render any .md file to visible content in <300ms | URD-05, URD-01 |
| DR-02 | Must render standard Markdown images `![alt](path)`, tables, and Mermaid diagrams | URD-03 |
| DR-03 | Scroll position must be saved and restored per-file across tab switches | URD-04 |
| DR-04 | Idle RAM usage must be <80MB; 10 tabs must not exceed 200MB | URD-02 |
| DR-05 | Must watch open files on disk and re-render on change without user action | URD-10 |
| DR-06 | Must read actual .md files from disk — no import, no sync, no extra files written | URD-07 |
| DR-07 | UI chrome must be invisible at rest; appear on-demand (hover, key) | URD-08 |
| DR-08 | Must support inline editing triggered by double-click on rendered content | URD-09 |
| DR-09 | Must support 10+ simultaneously open files with <50ms tab-switch time | URD-04 |
| DR-10 | Live watch updates must not alter scroll position during streaming | URD-10 |

---

## Design Principles

1. **Read-first, edit second.** Viewing is the primary mode; editing is an opt-in extension that never forces a mode switch.
2. **Files live on disk.** The app is a lens, not a database. Zero import, zero sync. Open any .md file where it lives.
3. **Speed is respect.** Every interaction must feel instant. Loading states are product failures.
4. **Chrome earns its presence.** The interface exists to serve content. Every UI element must justify its visual real estate.
5. **Diagrams are first-class citizens.** Mermaid, images, and tables render perfectly on first load with no configuration.

---

## Constraints as Requirements

| Constraint | Source | Conflicts with? |
|---|---|---|
| Must be native macOS (Swift/Tauri) — no Electron | URD-02, WAN-067 | None |
| Must not write to the file system without explicit user save action | URD-07, WAN-035 | DR-10 (mitigated: file watch is read-only) |
| Mermaid rendering must be async/non-blocking | URD-03, WAN-072 | DR-01 (mitigated: progressive render — text first, diagrams after) |
| macOS sandbox for App Store distribution | — | DR-06 (mitigated: use NSOpenPanel + persistent folder bookmarks) |
| Live file watch on macOS requires FSEvents API | WAN-037 | None |

**⚠ Conflict flagged:** macOS sandbox restrictions require explicit user permission to access file-system paths outside the sandbox container. This conflicts with "open any .md file from anywhere" (URD-07). **Mitigation:** Use macOS `NSOpenPanel` to grant persistent permission to folders (security-scoped bookmark API), which persists across app restarts.
