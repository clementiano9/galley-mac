# tiny-viewer UX Design System — Step Index
*8-Step Research-Driven UX Framework | 2026-03-15*

---

## Quick Reference

| Step | File | Content |
|---|---|---|
| Overview | `UX-DESIGN-SYSTEM.md` | Full synthesized design system (all steps combined) |
| **Step 1** — Web Research Sprint | `research/` folder | 74 raw WANs across 5 parallel research streams |
| **Step 2** — WAAD + URD Synthesis | `step-2-waad-urd.md` | 8 WAAD clusters, 10 URDs, 3 work roles, flow models |
| **Step 3** — Problem Definition | `step-3-problem-definition.md` | 6 problem statements, HMW, metrics, DRs, principles |
| **Step 4** — Ideation | `step-4-ideation.md` | 3 directions, URD coverage analysis, selected direction |
| **Step 5** — Information Architecture | `step-5-ia.md` | App map, 3 user flows, navigation schema, content inventory |
| **Step 6** — Wireframes | `step-6-wireframes.md` | 6 ASCII screens, interaction specs, error states, typography |

---

## Research Streams (Step 1)

| Stream | File | WANs | Focus |
|---|---|---|---|
| 1 | `research/stream-1-hci-research.md` | 001–015 | UX/HCI academic research, cognitive load |
| 2 | `research/stream-2-app-reviews.md` | 016–035 | Bear, Obsidian, Typora, iA Writer, VSCode reviews |
| 3 | `research/stream-3-reddit-hn.md` | 036–050 | Reddit/Hacker News user pain points |
| 4 | `research/stream-4-industry-reports.md` | 051–062 | Industry reports, Stack Overflow survey, NNG |
| 5 | `research/stream-5-performance-ram.md` | 063–074 | Electron vs Tauri RAM, Mermaid performance |

---

## Key Decisions & Rationale

| Decision | Rationale |
|---|---|
| **Direction B** (browser tab model) selected | Only direction covering all 10 URDs |
| **Tauri** (not Electron) for implementation | 58% less RAM, 96% smaller bundle (WAN-067) |
| **Read-first** as primary mode | URD-05, URD-06: AI review workflow demands view-before-edit |
| **Live file watch** as zero-to-one feature | No mainstream tool does this (WAN-037) |
| **No import/sync/database** | URD-07: file sovereignty is top user priority |
| **Double-click to edit** (not toggle/button) | URD-09: edit as extension of reading, not mode switch |
| **Mermaid rendered async** | WAN-072: synchronous Mermaid blocks streaming output |
| **720px max content width** | Optimal reading line length (60–80 chars) per readability research |

---

## 10 Design Requirements Summary

| # | Requirement |
|---|---|
| DR-01 | Render any .md file to visible content in <300ms |
| DR-02 | Render images `![alt](path)`, tables, and Mermaid diagrams |
| DR-03 | Save and restore scroll position per-file across tab switches |
| DR-04 | Idle RAM <80MB; 10 tabs <200MB total |
| DR-05 | Watch files on disk; re-render on change without user action |
| DR-06 | Read actual .md files from disk — no import, sync, or extra files |
| DR-07 | UI chrome invisible at rest; appear on-demand |
| DR-08 | Support inline editing triggered by double-click |
| DR-09 | Support 10+ simultaneous files with <50ms tab-switch time |
| DR-10 | Live watch updates must not alter scroll position |
