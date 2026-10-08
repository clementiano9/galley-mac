# Step 8: Evaluation & Iteration — UX feedback batch 2026-10

*Scope: six pieces of product-owner feedback on Galley (branch `feat/ux-feedback-2026-10`). Requirement IDs for the fixes are **UXF-01 … UXF-06**; the build specs are in `../feature-gaps/specs/`. Stale documents found on the way are listed in [`obsolete-audit.md`](obsolete-audit.md).*

**Method.** Code read against the shipped build (not the old wireframes). Live measurements in headless Chrome against the web build (`app/` over HTTP) and a faithful Node port of `read_dir_tree`. CSS prototypes were run in headless Chrome only; every acceptance check must be repeated in the native WKWebView before sign-off. Severity uses Nielsen's 0–4 scale.

---

## 1. Evidence (measured, not assumed)

| # | Finding | Number |
|---|---|---|
| E1 | The current scan shows almost none of a real tree. Node port of `read_dir_tree` (200-entry budget, depth-first, filesystem order) on `~/ai-projects`: 26 top-level folders contain markdown | **1 shown** (2 if the order is reversed) of 26. Of all 490 markdown-bearing folders, 1 to 19 are shown |
| E2 | Same port on this repo: the root's own `README.md` and `CLAUDE.md` never appear in alphabetical order, because `.claude/` uses the whole budget first | 12 of 15 folders, 0 root files (or 0 of 15 in the other order) |
| E3 | Presentation hides folders even when the scan is complete. A 54-row tree gets `.tv-folder-body.capped` (DR-41): its own scroller, `max-height: 60vh`, scrollbar invisible at rest | 540 px visible of 1,620 px; **8 of 12 folders** (`notes`, `ux`, `research`, `queue-state`, `packets`, `app`, `sample-docs`, `tauri-app`) sit below the fold with no cue |
| E4 | Files are never sorted. Rust returns `read_dir` order and `walk()` in `tv-tree.js` sorts folders only | File order is not alphabetical |
| E5 | Tables: wrapper is 640 px in a 1,210 px pane (570 px unused). Header scrolls away | header at **−299 px** after 300 px scroll |
| E6 | Prototype CSS (UXF-01/04) in the same pane: tables 640 / 954 / 1,162 px, centred; header pinned at 0 px; a 14-column table keeps its own scroll with the header pinned inside it | see specs |
| E7 | The existing reveal flash (`.tv-flash`) cannot show on the active row: `.tv-tree-row.active` sets `background-color … !important`, which beats an animation | reveal needs its own cue |
| E8 | Shortcut overlay holds exactly 20 rows, equal to the DR-17 cap | a new shortcut needs the cap raised |
| E9 | `read_dir_tree` is a synchronous command, so it runs on the main thread. Safe at 200 entries; not at 20,000 | must become async |
| E10 | Folder ▸ Refresh calls `registerFolder()`, which toasts "already open" and re-scrolls. Wrong feedback for a refresh | fix in UXF-02 |

---

## 2. Heuristic evaluation

| ID | Issue | Heuristic | Finding | Sev |
|---|---|---|---|---|
| H-01 | UXF-02/03 | H1 Visibility of status | Capped body hides two thirds of the tree with no scroll cue (E3). Footer says "Show N more files" but never says folders are missing | 4 |
| H-02 | UXF-02 | H5 Error prevention | Depth-first 200-entry budget lets one folder starve its siblings (E1, E2). `.git` and `node_modules` burn the budget | 4 |
| H-03 | UXF-03 | H2 Real-world match | Unsorted files (E4); files listed before folders, so structure is the last thing seen | 3 |
| H-04 | UXF-03 | H6 Recognition over recall | A collapsed folder gives no hint of its size. Everything expanded by default, so the user must scroll to learn the shape | 3 |
| H-05 | UXF-03 | H3 User control | No expand-all / collapse-all. No way to find the current file | 2 |
| H-06 | UXF-01 | H8 Minimalist design | 570 px of empty margin beside a table that scrolls sideways inside a 640 px box | 3 |
| H-07 | UXF-04 | H6 Recognition over recall | After one screen of rows the reader must scroll up to learn what a column means | 3 |
| H-08 | UXF-05 | H4 Consistency | One action, two controls in two places (header « and tab-strip toggle). macOS shows one sidebar glyph in a fixed place | 2 |
| H-09 | UXF-05 | H7 Flexibility | No trackpad gesture for a panel that sits on the left edge | 1 |
| H-10 | UXF-06 | H7 Flexibility | No way to locate the open file in the tree; user scans by eye | 2 |
| H-11 | UXF-02 | H9 Error recovery | Unreadable folders and cap drops are silent | 2 |
| H-12 | UXF-06 | H10 Documentation | Shortcut overlay is the only shortcut reference and is full (E8) | 1 |

---

## 3. Simulated think-aloud (critical task: "open a folder, understand it, reach the right file")

**WR1 AI Content Reviewer** — *"An agent just wrote twelve files across four folders."* Opens the project folder. Thinks: "Where is `plan/`?" Sees `research/` and two others; the tree ends mid-screen. Assumes the rest is missing and goes to Finder. **Friction:** H-01, E3. Later reads a comparison table, scrolls, loses the column names. **Friction:** H-07. Feeling: doubt, then irritation.

**WR2 Developer / Technical Writer** — Opens a monorepo. Expects every package with a README. Sees one folder, no `README.md` at the root. Concludes "the scanner is broken". **Friction:** H-02, E1/E2. Opens a deep spec; wants to see its siblings; has to hunt. **Friction:** H-10. Wants more room for a 12-column API table. **Friction:** H-06.

**WR3 Knowledge Worker / Researcher** — Opens a notes folder of 300 files in 40 folders. Wants the shape, not the files. Everything is expanded; counts are missing; names look random (E4). Gives up and uses search. **Friction:** H-03, H-04. Swipes with two fingers expecting the panel to move. Nothing happens. **Friction:** H-09.

---

## 4. Emotional impact check

Step 3 defines no Emotional Design Goals (EG-##). The standing intents are Design Principles 3–4 ("speed is respect", "chrome earns its presence") and DR-07. They are used as proxies; the check is by moment, not for the product.

| Proxy goal | Moment | Today | Element responsible | After UXF |
|---|---|---|---|---|
| Calm orientation | First sight of an opened folder | **missed** | capped inner scroller, unsorted files, nothing summarised (E3, E4) | met — folders first, counts, one scroller (UXF-03) |
| Trust that nothing is hidden | After the scan finishes | **missed** | silent caps (E1) | met — every folder present or marked "…" (UXF-02) |
| Chrome earned | Looking for the sidebar control | **partly met** | the control moves between states (H-08) | met — one fixed button (UXF-05) |
| Effortless reading | Scrolling a long table | **missed** | header scrolls away (E5) | met (UXF-04) |

---

## 5. URD cross-reference

Step 2 records no E-type URDs; all ten are F-type. Status after this batch:

| URD | Need | Status | Resolved by |
|---|---|---|---|
| URD-03 | Tables render well | open → resolved | UXF-01, UXF-04 |
| URD-04 | Multi-file navigation, "where am I" | open → resolved | UXF-02, UXF-03, UXF-06 |
| URD-05 | View-first simplicity | open → resolved | UXF-03 |
| URD-06 | AI-output review loop | improved | UXF-01, UXF-04 (long tables), UXF-02 (all files visible) |
| URD-07 | File trust, read-only | unchanged — the scan stays read-only; UXF-02 reads names only (DR-06 holds) | — |
| URD-08 | Minimal chrome | improved | UXF-05 removes one control; UXF-03 removes a nested scroller |
| URD-02 | Low RAM / speed | at risk, guarded | UXF-02 scan is bounded (20,000 entries) and async; UXF-03 caps first paint at the rows that fit the sidebar (at most 30) |
| URD-10 | Live updates | **unresolved remainder** | The tree is a snapshot. UXF-02 adds a focus re-scan only. Continuous folder watching stays open (see §9) |
| URD-01, 09 | — | not touched | — |

---

## 6. Decisions — ideas considered, one chosen

### UXF-01 Tables stretch past the text margins
- **A. Full-bleed always** — every table spans the pane. Simple, but a 3×4 table looks stranded and breaks the text rhythm.
- **B. Grow to fit, centred, capped at the pane (chosen).** Table width = natural width, never narrower than the 640 px column, never wider than the pane minus 24 px gutters. Symmetric overhang.
- **C. Click-to-expand modal.** Extra chrome; breaks URD-05.

**Why B.** Short tables look exactly as before (DR-07, no new chrome). Wide tables use the free space (URD-03). Pure CSS with container units; JS only marks the rare table that still overflows. Prototype confirmed 640 / 954 / 1,162 px outcomes (E6). Uses `.tv-scroll { container-type: inline-size }` — Safari 16+.

### UXF-02 What the navigator shows
- **A. Raise the caps.** One-line change, but any fixed cap still starves something and a 200k-entry scan blocks the main thread.
- **B. Lazy per-folder listing (Finder model).** Unbounded, but shows every folder including empty and vendored ones, and hides the shape until the user opens each one.
- **C. Breadth-first scan, deterministic, with lazy "…" folders (chosen).**

**Why C.** Breadth-first guarantees every top-level folder is seen before any deep one (E1, E2). **Shown:** every folder that holds markdown (`.md`, `.markdown`, `.txt`) at any depth, hidden folders included (`.claude/` holds this repo's own docs), with a small deny-list of generated trees (`.git`, `node_modules`, …). **Not shown by default:** folders with no markdown; a footer row `Show N folders without markdown` turns them on. A folder the budget did not reach is shown with `…` and loads when opened, so nothing is silently missing (H-01, H-02). Names sorted naturally; scan is async; the tree re-scans on window focus.

### UXF-03 Understanding everything under a folder
- **A. Keep everything expanded, raise the 50-row cap.** Longer scroll; still a nested scroller.
- **B. Two panes: folders on top, files below.** Strong model, but it doubles the sidebar's structure and changes SBH.
- **C. Outline-first tree (chosen).** Folders first, natural sort, smart default expansion (sized to the sidebar height, at most 30 rows; opening a folder always shows the sidebar), a markdown count on every folder, one scroller with sticky folder headers, ⌥-click and menu for expand/collapse all, default width 264 px.

**Why C.** It keeps the approved SBH rails and indentation and fixes the comprehension defects found in E3, E4 and H-03…H-05. Counts let a collapsed folder answer "how big is this?" without opening it (H6). Removing the nested scroller closes the defect behind "folders still not showing" and simplifies JANK-01. Supersedes DR-41.

### UXF-04 Sticky table header
- **A. `position: sticky` on `th`, wrapper not a scroll container (chosen), inner scroller only for tables wider than the pane.**
- **B. JS-cloned floating header.** Works everywhere, but doubles the DOM, needs column-width sync, and doubles the accessibility tree.
- **C. Every table scrolls inside a max-height box.** Sticky works, but a scroll trap on every long table.
- **D. `overflow-x: clip`.** Keeps sticky but kills horizontal scrolling.

**Why A.** The reason sticky fails today is that `.tbl-wrap` is `overflow-x:auto`, which makes it the scroll container for the sticky header. UXF-01 already removes that overflow for every table that fits, so sticky works against the page scroller with no JS. Only a table wider than the pane keeps a scroller, and that one gets a height cap so its header also sticks. Needs `border-collapse: separate`.

### UXF-05 One sidebar button and a swipe
- **A. Button in the title bar next to the traffic lights.** Native look, but it is a drag region and the browser build's fake lights differ.
- **B. Always-present button at the far left of the tab bar (chosen).** Same position, both states.
- **C. Hover-revealed edge handle.** Invisible at rest; re-entry becomes a guess.

**Why B.** It is the existing `.tv-side-toggle`, kept visible in both states, so the change is small and the control never moves (H4). Remove the header « (supersedes the "Edge" two-control direction, commit `602c698`). Gesture: finger right shows, finger left hides (spatial, like a drawer). Direction can be flipped with one constant. Horizontal scrollers always win. One toggle per swipe. No animation exists, so reduced motion is met by construction.

### UXF-06 Reveal file in sidebar
- **A. Command only** (palette). Discoverable only to palette users.
- **B. Command + shortcut + tab menu + View menu (chosen).** `⇧⌘J` (the Xcode "reveal in navigator" key; free here).
- **C. Auto-reveal on every tab switch.** Moves the tree under the reader on each switch; fights JANK-01. Rejected.

**Why B.** Four doors to one action. A file outside every open folder mounts its parent folder as a new root (SBH-02 "unrelated → new root"), because the user asked to see where the file lives. Cue is a ring pulse, not the old flash (E7).

---

## 7. Summative readiness (for a later real-user test)

| Item | Plan |
|---|---|
| Method | Moderated think-aloud, 5 participants (2 AI reviewers, 2 developers, 1 researcher), on real folders of 50–500 markdown files; plus unmoderated task timing |
| Tasks | T1 Open a 40-folder project; name all top-level folders. T2 Find and open a file four levels deep. T3 Read a 60-row, 8-column table and say what column 5 is at row 50. T4 Open a 14-column table and read its last column. T5 Hide the sidebar, then bring it back, by any route. T6 From a tab, show where the file lives. |
| Benchmarks | T1 ≥ 95% of top-level folders named, 0 "is this missing?" remarks. T2 ≤ 20 s. T3 no scroll-up. T4 completed without a wrong-way scroll. T5 ≤ 5 s, ≥ 4/5 find the button on first look. T6 ≤ 5 s, ≥ 4/5 |
| Instrument | AttrakDiff2 pragmatic-quality items, given straight after T1 and T3 (the two emotional moments), not at session end. SEQ (single ease question) after each task |
| System metrics | First paint of a 5,000-file tree ≤ 200 ms; scan of 20,000 entries ≤ 500 ms with the UI responsive; zero main-thread stalls over 100 ms |

---

## 8. Iteration plan (prioritised: severity × URD impact)

| Rank | Issue | Sev | URD | Fix | Build note |
|---|---|---|---|---|---|
| 1 | UXF-02 folders missing | 4 | 04, 05, 07 | Breadth-first async scan, deny-list, sorted, lazy "…" folders | Rust + tree glue; build first |
| 2 | UXF-03 hierarchy hard to read | 4 | 05, 08, 04 | Remove nested scroller, folders first, counts, smart expansion | **Quick win:** removing `.capped` alone fixes E3 today |
| 3 | UXF-01 wide tables | 3 | 03, 06 | Breakout CSS | Ship with 4 |
| 4 | UXF-04 sticky header | 3 | 06, 03 | Sticky `th` | Same CSS block as 1 |
| 5 | UXF-06 reveal | 2 | 04 | `⇧⌘J`, palette, tab menu, View menu | Needs 02 and 03 |
| 6 | UXF-05 one button + swipe | 2 | 08 | Fixed toggle; gesture module | Independent |

---

## 9. Open questions

1. **Swipe direction.** The request reads "swipe right/left … hide/show". It can mean right = hide. The spec uses the spatial mapping (finger right shows the left-hand panel). One constant flips it.
2. **Folder watching.** The tree is a snapshot; new files from a running agent appear after window focus, not instantly. Continuous FSEvents watching of the folder is the proper fix and is a separate Rust change. Not specified here.
3. **Folders without markdown.** Default is hidden with a footer toggle. If the owner wants them always visible, flip one default.

## 10. Obsolete-design check

Done before designing. Findings are in [`obsolete-audit.md`](obsolete-audit.md). Three of them change decisions here: the "single-depth tree" decision for F-19 (superseded by ISS-005), DR-41 (superseded by UXF-03), and the Edge "two controls" direction (superseded by UXF-05).

---

# Iteration 2 (2026-10-06): width balance, agent folders, motion

*The owner tried the build and gave three more pieces of feedback. Requirement IDs: UXF-01 amended, **UXF-07** (agent folders) and **UXF-08** (motion system) new. Research: `research/stream-6-iteration-2.md` (WAN-075 to WAN-107). Illustration for the owner: `iteration-2-illustration.html`. Measurements ran in headless Chrome against the live web build; the owner's dev window was not touched.*

## A. Tables are too wide (UXF-01)

**Feedback.** "This is really distracting. I don't think this table needed this much space. We need to find a balance." The screenshot: a 3-column table of sentences, stretched to about 1,160 px beside a 640 px text column.

**Evidence.**
- E11. The shipped rule sizes a table to its max-content width, what it wants. A prose table wants about 1,690 px, so it takes the pane. Measured: **1,122 px** (prose table, 1,176 px pane), also 1,122 px for a mixed table whose one prose column wants 984 px. A short-cell 6-column table was 640 px, fine.
- E12. Same table at 640 px (strict column): rows are four lines tall, dense but tidy. At 800 px: three lines, calm. At 1,122 px: two lines, the table dominates the page. (Prototype screenshots, three variants.)
- E13. GitHub caps tables at the column and scrolls inside (`max-width: 100%`, WAN-075); Notion leaves width to the author (`Fit to page width`, WAN-076). Neither measures what the table needs. A prose column wider than about 45 characters is past the 50 to 75 character readable measure (WAN-077).

**Heuristic findings.** H-13 (H8, sev 3): a table far wider than every other block pulls the eye from the text. H-14 (H4, sev 2): table width unrelated to content kind: a table of numbers and a table of sentences get the same treatment.

**Think-aloud.** WR1 (reviewing an agent's comparison table): "I read this left to right and my eyes travel a whole screen per row." WR2 (API table with 10 numeric columns): "Give this one room, it is data." WR3 (notes table of sentences): "Keep it near the text."

**Ideas.**
- **A1. Strict column** (GitHub model): never wider than the text. Safe, but wide numeric tables scroll for no reason and prose tables run four lines per row.
- **A2. One fixed bleed for every table** (column plus 160 px). Simple CSS, but numbers and tokens wrap badly at 800 px while they only need 1,000.
- **A3. Size by need and content kind (chosen).** `M` (min-content) is what the table needs; `W` (max-content) is what it wants. A table never gets less than it needs. A prose table (any column wider than 22 em, about 45 characters) may bleed to 800 px; a table of short cells may use the pane; a table that needs more than the pane scrolls in its own box.
- A4. A per-table "fit to page" control (Notion). Rejected: new chrome (DR-07) for something a default can decide.

**Choice and reasons.** A3. It removes the distraction where it happens (prose) and keeps the benefit the owner asked for earlier (data tables stretch). The bleed is one constant (`BLEED`, 80 px per side) so the owner can set it to 0 (A1 for prose) with no redesign. Exact rules, a unit-testable policy function and fixtures: UXF-01.

## B. Dot-folders (UXF-07)

**Feedback.** Do not show every dot-folder automatically; do show agent folders such as `.codex` and dot-files; find the balance and illustrate it.

**Evidence.**
- E14. Today every dot-folder with markdown shows except the deny-list: `.husky`, `.changeset` and similar appear beside `.claude`.
- E15. `.cursor/` never shows, although it is the best-known agent folder: Cursor rules are `.mdc` files and the scanner lists only `md`, `markdown`, `txt` (WAN-085). Extensionless rule files (`.cursorrules`, `.windsurfrules`, `.clinerules`, `.roorules`, `.goosehints`, `.rules`) are never listed either (WAN-083, 094, 095).
- E16. About twenty tools keep markdown in named dot-folders (`.claude .cursor .github .kiro .junie .opencode .augment .trae .kilo .roo .windsurf .devin .continue .amazonq .agents .gemini .codex .specstory`, WAN-084 to 099).
- E17. `.codex` in a project usually holds `config.toml`, which is not markdown; the global `~/.codex` holds prompts and skills (WAN-092).

**Heuristic findings.** H-15 (H2, sev 3): the audience expects its agent folders, not every tool folder. H-16 (H5, sev 3): `.cursor` is lost to a file-extension gap, not to a design choice. H-17 (H8, sev 2): unrelated dot-folders add noise.

**Think-aloud.** WR4 Agent Operator opens a repo: "Where are my rules? There is `.husky` but no `.cursor`." Then, in a notes vault: "Why is `.obsidian` here?" Opens `~` to inspect global agent config: expects `.claude`, `.codex`, `.gemini` together.

**Ideas.**
- **B1. Keep showing every dot-folder.** Fails the owner's first sentence.
- **B2. Hide every dot-folder behind a toggle** (Finder style). Fails the second sentence: `.claude` hidden.
- **B3. Allow-list of agent folder names, other dot-folders behind one footer toggle (chosen).** Plus the two extensions and six file names that the scanner misses; plus folders that hold an open file; plus names the user adds.
- B4. Detect agent folders by content (any dot-folder containing `SKILL.md`, `AGENTS.md`, `*.mdc`). Clever and fragile: it would surface `.husky` the day it gains a `README`.

**Choice and reasons.** B3. It is explainable in one sentence ("known agent folders show; other dot-folders wait behind one toggle"), editable in one constant, and matches how the tools are documented. Agent folders get **no** badge (quiet chrome, no accent bars); the cue is that revealed extras are dimmed. A folder with nothing viewable stays an extra, so `.codex` with only `config.toml` waits behind the toggle (open question 1). Policy table, list, fixtures: UXF-07.

## C. Motion (UXF-08)

**Feedback.** Animate the sidebar for button, ⌘B and swipe; the whole app feels stiff; "I want the user experience to be perfect."

**Evidence.**
- E18. About 40 `transition` and `animation` declarations in `tv-app.css`, durations from .10 s to 1.4 s, no shared tokens. The moments that matter most snap: sidebar, palette, find bar, new tab, edit mode, theme.
- E19. `render()` replaces the DOM, so CSS transitions between states never fire and exits cannot play. Only enter keyframes on inserted nodes work.
- E20. **FLIP prototype** (headless Chrome, 1440 × 900): the layout changes once, then transforms glide the column. Text column left edge 495 px before, 495 px on frame 0, 360 px at the end; `.tv-viewer` width constant on all 16 sampled frames; sidebar slides -264 to 0; no leftover ghost or animation.
- E21. A `wheel` event has no begin, end or cancel phase. A finger-following sidebar cannot know when to settle or return.

**Heuristic findings.** H-18 (H1, sev 2): nothing shows where the sidebar went or came from. H-19 (H4, sev 2): timing is inconsistent across components. H-20 (H8, sev 1): the app feels abrupt, which reads as unfinished.

**Think-aloud.** WR1 pressing ⌘B: "It just jumps, my text moves sideways, I lose my place for a second." WR2 opening ⌘K: "It appears fine, but everything else in the app glides and this snaps." WR3: "I did not notice the animations I do have."

**Ideas.**
- **C1. Animate the sidebar's width.** Reflows the document every frame (tables re-size, text re-centres). Rejected.
- **C2. Slide the sidebar over a content that snaps.** No reflow, but the text jumps at once and the slide looks detached.
- **C3. FLIP: layout once, transforms for the sidebar and a glide for the column (chosen).** One reflow, no per-frame layout.
- Swipe: **S1** interactive, follows the fingers: needs native scroll phases; **S2 triggered 220 ms slide (chosen)**.
- App-wide: **M1** animate everything (showy), **M2** none (stiff), **M3 (chosen)** one token set plus a per-moment decision: animate the few arrivals (sidebar, palette, search, find bar, new tab pill, edit view, theme), tokenise the existing ones, keep frequent actions and everything touching reading text static.

**Choice and reasons.** C3 + S2 + M3. Tokens: 100 / 160 / 220 ms, 120 ms exit, three easings, enter faster than leave, no bounce (WAN-100 to 107). Reduce Motion removes all movement; at most an 80 ms opacity fade. Tab switch, tab close, scroll restore and live updates never animate (DR-09, DR-03, DR-10). 29 rows decided in UXF-08.

## Iteration 2: cross-references and plan

| URD / DR | Change |
|---|---|
| URD-11 (new) Agent instruction files | resolved by UXF-07 |
| URD-03, URD-06 | UXF-01 amended: tables balanced rather than maximal |
| URD-08 | UXF-08 adds motion with a hard quiet-chrome rule (no motion on frequent actions) |
| DR-03, DR-09, DR-10 | explicit constraints in UXF-08 |
| DR-39 | amended by UXF-07: viewable set gains `.mdc` and six extensionless rule files |

**Summative additions.** T7: read a prose table and say what row 3's evidence is (no sideways eye travel; time to answer). T8: find the agent rules in a repo with `.claude`, `.cursor`, `.husky` and `.vscode` (target: 5/5 find them in 10 s with no remark about `.husky`). T9: hide and show the sidebar by swipe and button. Instrument for T9: semantic differential pair *stiff / fluid* and one SEQ, given straight after T9. Benchmark: median "fluid" at least 5 on a 7-point scale; no participant reports lost place.

| Rank | Item | Sev | Build note |
|---|---|---|---|
| 1 | UXF-07 agent folders | 3 | small: JS policy plus `mdc` and six names in Rust |
| 2 | UXF-01 amend: width balance | 3 | JS sizing pass plus one CSS variable |
| 3 | UXF-08 motion system | 2 | tokens first (no visible change), then sidebar, then the other arrivals |

## Iteration 2: open questions

1. **Config files.** `.codex/config.toml`, `.claude/settings.json`, `.cursor/mcp.json` are agent files but not markdown. Showing them needs a read-only code view (they must not open in the markdown renderer or be editable). Not in this batch. Until then a folder holding only config stays behind the toggle. Do you want the code view?
2. **Prose bleed.** 80 px per side (800 px table). If it still feels wide, `BLEED` = 0 gives the strict column. Your call after you see it.
3. **Interactive swipe.** The sidebar following your fingers needs the native scroll phases forwarded from Rust. Worth a follow-up?
