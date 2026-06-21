# WAAD-Grounded Requirements — Gap Iteration

*UxPipeline **Step 3 (Problem Definition)** supplement to `ux-steps/step-3-problem-definition.md`. Seven gaps that the design-classification flagged as needing WAAD iteration (●●/●●●) plus U-04 were traced back through the URD → WAAD cluster → research-stream sources and resolved to crystal-clear, build-ready requirements.*

**Method:** three analyst passes (chrome/config · navigation/state · AI-output workflow) + one adversarial UX-lead critique pass. Every requirement cites a URD; every decision resolves a design tension from the WAAD.

**Status:** all 7 gaps **CLEAR** — implementable with zero open product questions. Critic blockers resolved: ⌘⇧O collision fixed (→ ⌘⌥O), DR numbers globally de-conflicted, undocumented ⌘0 documented, F-19 row-cap and U-13 launch-sequencing promoted into DRs, ambiguous AC timings made measurable.

### Global DR numbering (de-conflicted)
| Range | Source |
|-------|--------|
| DR-01 – DR-10 | `step-3-problem-definition.md` (base, unchanged) |
| DR-11 – DR-32 | Chrome & Config — U-02 (11–15), F-22/U-06 (16–23), F-05/F-18 (24–32) |
| DR-33 – DR-56 | Navigation & State — F-19 (33–41), U-16 (42–46), U-13 (47–56) |
| DR-57 – DR-64 | AI-Output Workflow — U-04 (57–64) |
| DR-65 – DR-71 | Live-Watch Recency Label |
| DR-72 – DR-80 | Tab Context Menu — U-10, U-08, U-12, U-11 (this iteration) |

### Open dependencies (out of scope here, must be resolved before related implementation)
- **U-01 / F-08 (native menu bar)** — U-02 and F-22 hang `View > Appearance` and `Help > Keyboard Shortcuts` off it. The full View/Help menu architecture must be specified there before menu-bar build.
- **F-02 (sidebar Recent section)** — U-13/DR-52 feeds it; F-19 shares sidebar space with it. F-02's visual/IA spec must land before sidebar implementation.

### Current keyboard-shortcut map (verified in `tv-app.js`)
`⌘K` palette · `⌘O` open file · `⌘⇧O` open folder · `⌘B` sidebar · `⌘W` close tab · `⌘1–9` jump tab · `⌘0` reset text size · `⌘⇧F` search all tabs · `⌘F` find in file · `⌘E` edit · `⌘S` save · `⌘=` larger · `⌘−` smaller · `⌘T` new tab · `⌘[` prev tab · `⌘]` next tab · `Esc` exit/close.
**New in this supplement:** `?` shortcut overlay · `⌘⌥O` outline jump.

---

# Part 1 — Chrome & Configuration
*Shared chrome budget (Cluster H "chrome earned, not imposed"; URD-08). Net new always-visible chrome across all three gaps: **zero pixels** — see reconciliation at end of Part 1.*

## 1. U-02 — Discoverable theme toggle

**Problem statement:** Knowledge Worker and AI Content Reviewer need a way to switch between light and dark appearance, because the only current path is ⌘K — invisible to anyone who hasn't discovered the palette (URD-08, URD-05). *(System auto-follow, U-05, is shipped; this gap only bites users who want to override the OS setting inside the app.)*

**HMW:** How might we surface theme switching so it's findable on first encounter yet invisible to every user already satisfied with automatic system appearance?

**Success metric:** Cold launch with system appearance = Light; a first-time user who wants dark locates and activates it **without opening ⌘K and without external docs**. 5-person moderated think-aloud, pass = 4/5 within 30s.

**Decision:** **Build — in the native View menu only. No titlebar icon.** The View menu must exist for HIG/U-01 regardless, so `View > Appearance > Light/Dark/System` costs zero incremental chrome (Cluster H). A persistent sun/moon titlebar button would tax every daily user for a rare override (step-6 Screen 1: "standard macOS chrome ONLY"). U-05 already covers the common case. ⌘K theme rows remain as the power-user path.

| DR | Requirement | URD | MoSCoW |
|----|-------------|-----|--------|
| DR-11 | `View > Appearance` submenu with three items: Light, Dark, System. System checked by default on first launch. | URD-08, URD-05 | Must |
| DR-12 | Selecting Light/Dark applies the theme immediately — no restart, no confirmation. | URD-08 | Must |
| DR-13 | Selecting System re-enables `prefers-color-scheme` auto-follow and deletes the `tv-theme` override key from localStorage. | URD-05, URD-08 | Must |
| DR-14 | The active Appearance choice shows a macOS checkmark at all times. | URD-08 | Should |
| DR-15 | The ⌘K Commands group retains Light/Dark/System rows as a secondary path — not removed. | URD-08 | Should |

**Acceptance criteria**
- `View > Appearance` contains exactly Light, Dark, System.
- First launch, no `tv-theme` key → System checked, app renders per `prefers-color-scheme`.
- `Dark` → `.tv--dark` applied immediately, `tv-theme='dark'` persisted, no reload. `Light` symmetric.
- `System` → `tv-theme` key removed, `matchMedia` listener re-attached so OS changes auto-apply.
- Active item shows checkmark; others don't. Selecting theme via ⌘K keeps the menu checkmark in sync.
- No theme control in titlebar or reading surface at any window size.
- Switch to Dark, quit, relaunch → opens Dark. With System selected, switching macOS to Dark while open switches the app **within 500ms of the `matchMedia` change event** (mock-testable).

**Out of scope:** per-file/tab theme, custom-theme editor, auto-scheduling (day/night), any reading-surface/titlebar theme chrome.

## 2. F-22 / U-06 — Onboarding / keyboard-shortcut discoverability

**Problem statement:** All work roles need a way to discover the app's shortcuts, because there is no in-app reference — `?` does nothing and the palette footer only documents the palette itself (URD-08, URD-05). *Constraint (step-6 Screen 6): no tutorial, no "create your first note," no auto-firing onboarding — a reference on demand, not a guide.*

**HMW:** How might we make the full shortcut vocabulary instantly available to anyone who wants it, without imposing onboarding on anyone who doesn't?

**Success metric:** A user who has never seen docs can enumerate ≥5 application shortcuts within 20s of deciding to look, without leaving the app. 5-person think-aloud, pass = 5/5.

**Decision:** **Build — a `?`-key reference overlay + `Help > Keyboard Shortcuts`.** `?` produces zero chrome at rest and fires only on deliberate, off-happy-path intent (Cluster H "earned"; recognition-over-recall, WAN-015/009). Screen 6 rejects tutorials, not a help reference. `Help > Keyboard Shortcuts` reuses the HIG-mandated Help menu (zero incremental chrome).

| DR | Requirement | URD | MoSCoW |
|----|-------------|-----|--------|
| DR-16 | Pressing `?` in Reading Mode (no modifier, no text input focused, no overlay open) opens a compact shortcut-reference overlay. | URD-08 | Must |
| DR-17 | The overlay lists all application shortcuts in a two-column layout (key / action), max **18 rows**. | URD-08 | Must |
| DR-18 | The overlay closes on any keypress, click outside its bounds, or Esc. No explicit close button required. | URD-08 | Must |
| DR-19 | The overlay must NOT auto-activate on first launch, file open, or any action other than explicit `?` or `Help > Keyboard Shortcuts`. | URD-05 | Must |
| DR-20 | `Help > Keyboard Shortcuts` opens the identical overlay as DR-16. | URD-08 | Must |
| DR-21 | `?` is inert when the palette, cross-tab search, find bar, or any overlay is open, and when any text input has focus (edit textarea, palette field, find input). | URD-08 | Must |
| DR-22 | The overlay is static read-only — no navigation, links, or interactive elements beyond the close behaviour (DR-18). | URD-08 | Should |
| DR-23 | The overlay must include, at minimum: `⌘K` Command Palette, `⌘O` Open File, `⌘⇧O` Open Folder, `⌘T` New Tab, `⌘W` Close Tab, `⌘1–9` Jump to Tab, `⌘[`/`⌘]` Previous/Next Tab, `⌘⇧F` Search All Tabs, `⌘F` Find in File, `⌘⌥O` Outline (per U-16), `⌘E` Toggle Edit, `⌘S` Save, `⌘=`/`⌘−` Larger/Smaller Text, `⌘0` Reset Text Size, `⌘B` Toggle Sidebar, `Esc` Exit/Close, `?` This overlay. | URD-08 | Must |

**Acceptance criteria**
- `?` with a file open (no overlay, no input focused) opens the overlay; `?` on the empty-state dropzone also opens it.
- The overlay lists every DR-23 entry (≤18 rows).
- Any key while open closes it (Esc, space, `?`, letters — all close); click outside closes it.
- `?` while the palette is open does NOT open the overlay (the `?` is typed into the palette field); `?` in the edit textarea inserts `?` and does not open the overlay; `?` while search/find bar open does nothing.
- `Help > Keyboard Shortcuts` opens an indistinguishable overlay.
- No onboarding/tutorial/tooltip-chain/welcome modal fires on any launch. Overlay has no clickable links or controls beyond close.

**Out of scope:** shortcut remapping, tip-of-the-day, palette-footer text changes, FAQ/doc browser, localisation (English only initially).

## 3. F-05 / F-18 — Settings surface

**Problem statement:** Developer and Knowledge Worker need the IA-specified viewer preferences (Theme, Font size, Mermaid on/off, Line numbers on/off) and a `Settings…` palette entry — but a full settings panel risks the overconfiguration trap the product exists to eliminate (URD-05, Cluster E, WAN-045/046).

**HMW:** How might we expose the minimum set of persistent preferences without creating a configuration surface that becomes a productivity trap?

**Decision:** **Build — palette commands + keyboard shortcuts only. No settings panel, no `⌘,` window.** Each candidate control ruled individually:
- **Theme** — IN, already covered by U-02 (View menu + ⌘K). No third copy in a panel.
- **Font size** — IN, as `⌘=`/`⌘−`/`⌘0` + palette rows. An in-session reading-comfort adjustment, not a config task; one keystroke beats open-panel→adjust→close (WAN-007/009).
- **Mermaid on/off** — IN, as a ⌘K toggle command only. Earns its place (CPU cost during AI streaming, URD-03/WAN-072) but is an infrequent expert action — "hidden until invoked" (URD-08).
- **Line numbers** — **OUT.** Editor affordance; this is a viewer ("Preview.app for markdown," URD-05). No WAN/review/forum evidence requests it in reading mode. A toggle for a feature that shouldn't exist is the overconfiguration trap in pure form (WAN-046, Cluster E).
- **Settings panel** — **OUT.** After ruling Line Numbers out and Theme to the View menu, only Font size + Mermaid remain — both inline palette commands with immediate effect. WAN-046 (two weeks lost to Obsidian's settings) is the anti-pattern tiny-viewer's identity depends on avoiding. The `Settings…` command (F-18) is renamed **`Preferences & Shortcuts…`** and opens the `?` shortcut overlay (DR-16), accurately signalling its content.

**Refined problem statement:** Developer and Knowledge Worker need to toggle Mermaid and adjust font size without a settings panel, because these are session-level reading adjustments — not configuration — and a panel would impose the burden the app exists to eliminate (URD-05, Cluster E, WAN-045/046).

**Success metric:** A Developer who wants Mermaid off while reviewing a large AI file locates and activates the toggle within 15s via ⌘K, no prior instruction. 5-person think-aloud, pass = 4/5.

| DR | Requirement | URD | MoSCoW |
|----|-------------|-----|--------|
| DR-24 | `⌘K → "Disable Mermaid diagrams"` immediately stops rendering Mermaid fenced blocks in all open tabs, replacing each with its raw source in a styled code block. | URD-03, URD-08 | Must |
| DR-25 | After disabling, the row shows `Enable Mermaid diagrams`; selecting it restores rendering and re-renders all open tabs. | URD-03, URD-08 | Must |
| DR-26 | Mermaid on/off persists via localStorage `tv-mermaid`; stored value applied before any tab renders on launch. | URD-08 | Must |
| DR-27 | `⌘K → "Increase text size"` / `"Decrease text size"` adjust `--tv-font-body` by +2px/−2px, floored 13px, capped 22px; change visible immediately (no perceptible delay). | URD-08 | Must |
| DR-28 | `⌘=` / `⌘−` trigger the identical adjustment as DR-27; `⌘0` resets to the 16px default. All three are also palette-discoverable and listed in the `?` overlay (DR-23). | URD-08 | Must |
| DR-29 | Font size persists via localStorage `tv-font-size`; applied before any tab renders on launch. | URD-08 | Must |
| DR-30 | A `Preferences & Shortcuts…` palette command opens the `?` shortcut overlay (DR-16). | URD-08 | Should |
| DR-31 | No settings panel/screen/overlay and no `⌘,` shortcut in this or any later sprint without a separate UXR-validated decision. | URD-05, Cluster E | Must (constraint) |
| DR-32 | Line numbers must NOT render in Reading Mode under any condition; no line-number toggle. | URD-05, Cluster E | Must (constraint) |

**Acceptance criteria**
- `⌘K` → `mermaid` → Enter selects `Disable Mermaid diagrams`; open Mermaid blocks revert to code blocks immediately, no reload. Row relabels to `Enable…`; selecting re-renders all tabs. Relaunch with Mermaid disabled → tabs open with code blocks (persisted before first render).
- `⌘=` larger / `⌘−` smaller visible immediately; `⌘0` resets to 16px. `⌘=` at 22px and `⌘−` at 13px → no change, no error. Font size persists across relaunch.
- `⌘K → "Preferences & Shortcuts…"` opens the same overlay as `?`/`Help`. `⌘,` does nothing.
- Reading Mode shows no line numbers on any document, theme, or width. `?` overlay includes `⌘=`/`⌘−`/`⌘0`. `Increase/Decrease text size` rows findable by typing `text` or `size`.

**Out of scope:** `⌘,`/modal settings, per-file/tab font or Mermaid state, three-step segmented font picker (stepless `⌘±`/`⌘0` instead), reading-mode line numbers, extra themes/accents, settings sync.

### Chrome budget reconciliation (Part 1)
**Net new always-visible chrome: zero pixels.** Every addition is either inside the HIG-mandated menu bar (View > Appearance; Help > Keyboard Shortcuts) or behind a deliberate keyboard/palette trigger (`?` overlay; Mermaid/font/Preferences palette rows; `⌘=`/`⌘−`/`⌘0`). The reading surface, titlebar, sidebar, and tab bar gain nothing. **Explicitly rejected:** titlebar theme icon, settings panel/`⌘,`, line-numbers toggle, first-run onboarding/tutorial, floating shortcut badge, per-file theme. This sits at URD-08's "minimum-not-zero": reading window unchanged, every new control requires an explicit gesture to appear.

---

# Part 2 — Multi-file Navigation & State
*All three serve URD-04 ("return exactly where I left off") / Cluster D and Work Role 2. Sidebar stays 220px, ⌘B-toggled.*

## 4. F-19 — Sidebar folder list

**Problem statement:** Developer/Technical Writer needs to see and open all .md files in a loaded folder from the sidebar, because opening 2 of 20 leaves 18 invisible without re-invoking the picker — the multi-file fragmentation of Cluster D2 (WAN-043, WAN-049), violating URD-04.

**HMW:** How might we show every .md file in an opened folder as a clickable sidebar entry without turning the sidebar into a file manager?

**Success metric:** After opening a folder of N .md files (⌘⇧O or folder drag), the sidebar shows all N; zero extra picker invocations to reach any file. Verified: open a 20-file folder → 20 rows.

**Decision:** **Build — scoped to a single-depth flat list per opened folder, not a deep recursive tree.** The IA App Map specifies "Open Folders (recursive .md tree)," but a multi-level expand/collapse tree is chrome the workflow doesn't need: the flow model is a single AI-session working directory ("8 .md files from an AI session"), not a vault hierarchy. WAN-043/044 confirm the failure mode (complex tree adds cognitive overhead). Subfolders containing .md files appear at one secondary indent only; deeper nesting flattened. Sidebar is navigation-only — not Finder.

| DR | Requirement | URD | MoSCoW |
|----|-------------|-----|--------|
| DR-33 | On folder open (F-03), the sidebar displays all .md files in that folder as clickable rows, grouped under a section showing the folder basename. | URD-04, URD-05 | Must |
| DR-34 | Files already open as tabs are visually distinguished (accent dot or bold weight) — not duplicated as separate entries. | URD-04 | Must |
| DR-35 | Clicking an unopened row opens it as a new tab in ≤ file-read time, with no additional picker. | URD-04, URD-05 | Must |
| DR-36 | The folder section is collapsible (click header to toggle) and defaults to expanded. | URD-08 | Should |
| DR-37 | Subfolders containing .md files appear as a single secondary indent level; deeper nesting is flattened. | URD-08 | Should |
| DR-38 | Multiple opened folders each render as their own collapsible section, ordered most-recently-opened first. | URD-04 | Should |
| DR-39 | The folder list displays no non-.md files. | URD-07 | Must |
| DR-40 | The folder list supports no file operations (rename/delete/move) — display and navigation only. | URD-07, URD-08 | Must |
| DR-41 | A folder section renders a maximum of 50 rows, then enables internal section scroll; the sidebar chrome itself does not grow unbounded. | URD-08 | Must |

**Acceptance criteria**
- Open a 20-file folder via ⌘⇧O → 20 rows under a folder-named section appear **within one render cycle of the folder-open event completing**; no picker re-invocation needed.
- Click an unopened row → new tab appears, renders in reading mode; the row gains the "open" distinction within one render cycle.
- Click a row that is the active tab → that tab stays active, the sidebar row shows the active/selected state, no duplicate tab opens.
- Collapse via header click → all rows hide, header + `▶` disclosure remains; click again → re-expand.
- Open a second folder → second independently-collapsible section below the first.
- A subfolder with .md files appears at one extra indent only, not deeper.
- No non-.md entries render even if present. No rename/delete/drag affordances render.
- A 60-file folder shows 50 rows then scrolls internally; the sidebar does not grow past the window.

**Out of scope:** deep multi-level recursion, drag-reorder, file rename/delete/move, sidebar width resize, "open containing folder" (→ tab context menu U-08), file-type icons beyond a .md glyph, FSEvents folder watching (re-run ⌘⇧O to refresh).

## 5. U-16 — Outline / table-of-contents

**Problem statement:** Developer/Technical Writer needs to jump between sections in long architecture/API docs, because scrolling to a heading in a 300-line file breaks reading flow and the ⌘K heading-jump dismisses after one jump (URD-04, flow model).

**HMW:** How might we make heading navigation feel like scanning a physical table of contents, without a persistent panel competing with content?

**Decision:** **Don't build a persistent panel. Palette suffices, with one enhancement: a dedicated `⌘⌥O` shortcut that opens the palette pre-filtered to headings only.** `_parseHeadings` and ⌘K heading-jump already exist (spec-gaps F-19). A persistent outline panel costs sidebar space already claimed by F-19/F-02 and would replicate Obsidian's fragmented-navigation anti-pattern (WAN-044). Target files are 200–500-line AI output (URD-06), not book manuscripts — a 20+-heading doc is the edge, not the center. *Shortcut note: `⌘⇧O` is already Open Folder; the outline shortcut is **`⌘⌥O`** (verified free, not a system binding).* If post-launch research shows >30% of sessions hit 30+-heading files, revisit a slide-in panel — a future gate, not a current build.

**Success metric:** Jump to any heading in two keystrokes (`⌘⌥O` → Enter); key-down to scroll-complete under 300ms.

| DR | Requirement | URD | MoSCoW |
|----|-------------|-----|--------|
| DR-42 | `⌘⌥O` opens the palette pre-filtered to "Jump to heading" results for the **active file only** — no file-open or command rows visible. | URD-04, URD-08 | Must |
| DR-43 | The heading list shows H1–H6 with visual indent matching heading depth (2px per level). | URD-04 | Should |
| DR-44 | Selecting a heading scrolls the document to it and closes the palette within 50ms of selection. | URD-04 | Must |
| DR-45 | If the active document has no headings, the filtered palette shows "No headings in this document" — zero results, no spinner. | URD-04 | Must |
| DR-46 | The existing ⌘K heading-jump path remains functional and unchanged (additive, not a replacement). | URD-04 | Must |

**Acceptance criteria**
- 12-heading doc, press `⌘⌥O` → palette shows only the 12 headings (no file/command rows), indented by H1–H6 depth.
- No-heading doc, `⌘⌥O` → "No headings in this document," no results, no loading state.
- Select heading 7 → document scrolls there, palette closes. Press `⌘⌥O` again → reopens at the heading list cleanly.
- `⌘K` still opens the full mixed palette. `⌘⌥O` does not trigger Open Folder (`⌘⇧O`) or any other binding.

**Out of scope:** persistent sidebar outline, heading-based section folding, tab-bar heading-count badge, heading-level filtering, cross-document outline.

## 6. U-13 — Session restore on relaunch

**Problem statement:** All roles need to relaunch and find exactly the files they had open — no more, no fewer — with scroll positions restored, because the app currently reopens up to 10 recents regardless of last-session state, forcing manual tab cleanup (URD-04, flow model: "picks up exactly at line 47"). A closed tab means "I'm done"; reopening it violates that decision.

**HMW:** How might we make relaunching feel like un-pausing, not restarting?

**Decision:** **Build — two-key model.** `tv-session` (last session only, restored on launch) + `tv-recent-files` (MRU history, display-only — empty state, palette, sidebar Recent). This is the explicit U-13 recommendation and collapses **F-17** (scroll persistence across restarts) into the same implementation. Empty/absent `tv-session` → show the empty state (dropzone + recent list), never auto-open recents.

| DR | Requirement | URD | MoSCoW |
|----|-------------|-----|--------|
| DR-47 | On `beforeunload`, write `tv-session`: ordered array of `{nativePath, scrollTop}` for all open tabs, plus `activeId`. | URD-04 | Must |
| DR-48 | On launch, if `tv-session` is non-empty, restore only those tabs in order, applying scroll after each tab's render completes. | URD-04 | Must |
| DR-49 | If `tv-session` is empty/absent, show the empty state (dropzone + recent list); do NOT auto-open from `tv-recent-files`. | URD-04, URD-08 | Must |
| DR-50 | Session files not accessible at restore time are silently skipped; a single consolidated toast reports the count ("N file(s) from last session were not found"). | URD-07 | Must |
| DR-51 | The previously-active tab (`activeId`) is restored as active after all session tabs load. | URD-04 | Must |
| DR-52 | `tv-recent-files` remains a separate MRU list (≤20), populated on every open, used ONLY for empty-state/palette/sidebar Recent (F-02) — never to auto-open on launch. | URD-04, URD-08 | Must |
| DR-53 | Session scroll positions apply within 100ms of each tab's render-complete event (e.g. a `tv:rendered` event on the tab container), not at DOM-ready. | URD-04 | Must |
| DR-54 | Session restore is transparent — no "Restoring session…" screen or modal; tabs appear sequentially as in a normal multi-file open. | URD-08 | Should |
| DR-55 | Per-file scroll offset is also persisted into `tv-recent-files` entries so files opened individually (not via session) restore scroll on re-open (F-17). | URD-04 | Should |
| DR-56 | OS file-open events (Finder "Open With" / double-click) received during session restore are queued and processed **after** restore completes, appending as additional tabs — restore never races the file-open event. | URD-04 | Must |

**Acceptance criteria**
- Open 3 files; scroll to lines 80/20/5; quit; relaunch → exactly those 3 tabs, same order, same active tab, scroll within 2px.
- Open 3, `⌘W` one, quit, relaunch → exactly 2 tabs; the closed file is not restored.
- Open 5, quit, move one file in Finder, relaunch → 4 tabs + toast "1 file from last session was not found"; no error modal, no blank tab.
- Open 10, `⌘W` all 10, quit, relaunch → empty state (dropzone), no auto-open, recent list visible below.
- First-ever launch (no `tv-session`) → empty state.
- Open 1 file, quit; relaunch via Finder double-click of a different file → previous session's 1 file restores first, then the Finder file appends as an additional tab (DR-56 ordering).
- Palette Recent group and sidebar Recent keep showing MRU regardless of session state. `tv-recent-files` entries carry `scrollTop`; opening a recent restores scroll after render.

**Out of scope:** multiple named sessions, cross-device sync, session history beyond the latest, auto-saving unsaved edits as session state (content always read from disk at restore), "reopen last session" within a running session.

### Navigation reconciliation (Part 2)
Sidebar after these decisions: **folders tree** (top, F-19) · **Recent** (below, F-02 scope) · **search** (pinned bottom) — the three sections the step-5 IA already specified. No outline panel added (palette-only). Session restore adds zero visible chrome. Layout priority in a short window: folders (scroll within section, 50-row cap per DR-41) > Recent (collapse if sidebar <400px) > search (always pinned). No layout conflict among the three; U-13 actually simplifies the Recent section to a static display-only list.

---

# Part 3 — AI-Output Review Workflow

## 7. U-04 — Copy code-block button

**Problem statement:** Developer/AI Content Reviewer needs to copy fenced code blocks from the rendered view in one click, because the "read → spot → use" pattern (Cluster F3, WAN-036/038/039) culminates in extracting code from AI output, and its absence forces a context switch to raw source — the friction URD-06 defines as the primary unserved cost (URD-01: 23-min recovery per switch).

**HMW:** How might we let a user copy a fenced block in a single gesture, with zero risk of copying whitespace/button text/line-numbers, while keeping the viewport in its clean reading state?

**Success metric:** 5-participant test, 100% of copy-from-block tasks complete without switching to source/raw; zero mis-copies (clipboard = code text only). Automatable proxy: `clipboard.readText()` after click exactly equals `pre.querySelector('code').textContent`.

**Decision:** **Build — hover-reveal copy button on fenced blocks only.** Hover-reveal is "earned" chrome (Cluster H), matching the existing `.tv-edit-pencil` and scrollbar-on-hover patterns. The "use" step is a hand-already-on-mouse moment — hover intercepts it with no extra gesture. *Implementation is partially pre-built:* `.tv-copy` / `.tv-copy--copied` CSS (tv-app.css ~1382–1414, `position:relative` on `.md pre`, reduced-motion suppression) and the `[data-copy]` click delegate (tv-app.js ~2215) already exist; only the `<button>` injection in `tv-markdown.js`'s code-fence renderer is missing.

| DR | Requirement | URD | MoSCoW |
|----|-------------|-----|--------|
| DR-57 | Each rendered `<pre><code>` block in reading mode contains a copy button, absolute top-right of the `<pre>` (top/right 8px). | URD-06, URD-08 | Must |
| DR-58 | The button is invisible (`display:none; opacity:0`) unless the `<pre>` is hovered or keyboard-focused (`pre:hover` / `pre:focus-within` → `inline-flex; opacity:1`). | URD-08 | Must |
| DR-59 | Clicking writes exactly `pre.querySelector('code').textContent` via `navigator.clipboard.writeText()` — no markup, no button text, no synthetic newline beyond the source. | URD-06 | Must |
| DR-60 | On success the button enters a "Copied" state (label "Copied", `.tv-copy--copied` class, `aria-label="Copied"`) for 1500ms, then reverts to "Copy" / `aria-label="Copy code"`. | URD-06 | Must |
| DR-61 | The button is Tab-reachable when the `<pre>` is focused; Enter/Space trigger the identical write + Copied state as a click. | URD-08, WCAG 2.1.1 | Must |
| DR-62 | Opacity/colour transitions are suppressed under `prefers-reduced-motion: reduce`; the instant class-swap remains. | URD-08 | Must |
| DR-63 | Inline `<code>` not wrapped in `<pre>` receives no copy button at any hover/focus state. | URD-08 | Must |
| DR-64 | If `navigator.clipboard.writeText()` is unavailable or rejects, the button silently no-ops with a `console.warn` — no toast, modal, or visible change. | URD-08 | Should |

**Acceptance criteria**
- Reading mode, file with a fenced block: no button visible at rest (`display:none`/`opacity:0`).
- Hover a `<pre>` → "Copy" appears top-right within 150ms.
- Click → `clipboard.readText()` is byte-identical to the `<code>` `textContent` (no leading whitespace, no button label). Label → "Copied", background → `--tv-accent-weak` within one frame; reverts after 1500ms (±100ms); `aria-label` reads "Copied" during the window, "Copy code" otherwise.
- Tab into the `<pre>` → button is Tab-reachable with a visible focus ring; Enter/Space copy identically to click.
- Inline `<code>` → no button at any state. `prefers-reduced-motion` → instant class-swap, no transition, still functional. `clipboard` mocked to reject → no toast/modal/visible change, `console.warn` emitted. Edit mode → no button present or reachable.

**Out of scope:** copy whole document, syntax-highlight/language-label changes, copy button on Mermaid SVG, line-number gutter, rich-format copy (plain text only), inline-code copy, edit-mode button.

**Implementation note:** Inject into the code-fence renderer in `tv-markdown.js` (button as first child of `<pre>`; it's `position:absolute` so DOM order is irrelevant):
```html
<button class="tv-copy" data-copy aria-label="Copy code" tabindex="0">
  <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
    <rect x="5" y="5" width="8" height="8" rx="1.5" stroke="currentColor" stroke-width="1.5"/>
    <path d="M3 11V3h8" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
  </svg>Copy
</button>
```
Extend the `[data-copy]` handler (tv-app.js ~2215) to: add `.tv-copy--copied` + set `aria-label="Copied"`; after 1500ms remove the class + restore `aria-label="Copy code"`; on reject `console.warn` only. CSS needs no changes.

---

---

# Part 4 — Live-Watch Recency Label
*Added after the initial 7. Scopes the existing `[data-elapsed]` "updated Xs ago" status-bar label (tv-live.js). It is a **trust signal**, not the update mechanism.*

## 8. Live-update recency label

**URD tie-back:** **URD-10 — Real-Time File Watch** *(primary)*: "when AI tools stream output to a .md file, users need the viewer to update in real-time… watching the document grow live… a zero-to-one capability gap" (WANs 037/049/072; WAAD **Cluster F2** "Live streaming file-watch missing"; Work Role 1 **AI Content Reviewer**). Secondary: **URD-06** (AI-output review loop) for the confidence it provides; **URD-02** (low overhead) bounds its tick cost. The watch satisfies URD-10's *function*; this label satisfies URD-10's *trust* sub-need — "is it actually live, and how fresh is what I'm reading?" without a manual refresh.

**Problem statement:** The AI Content Reviewer needs an ambient signal of how recently the on-screen file changed on disk, because while reviewing AI output streamed to a file they must trust the view is current without re-opening it (URD-10, URD-06).

**HMW:** How might we make the recency of the last disk change legible at a glance — confirming active streaming and signalling when a file has settled — without a noisy, unbounded counter?

**Decision & scope:** Keep the label; make it **humanized, bounded, and self-settling**. It reports time since the last *detected disk change* only; it is not the content-update path, not a progress bar, and is decoupled from Pin scroll.

| DR | Requirement | URD | MoSCoW |
|----|-------------|-----|--------|
| DR-65 | While the active tab is live-watched, the status bar shows a recency label = time since that file's last detected on-disk change. | URD-10 | Must |
| DR-66 | Humanized, bounded format: `<3s` → "updating…"; `3–59s` → "updated Ns ago"; `1–59m` → "updated Nm ago"; `≥1h` → "updated Nh ago". No unbounded decimal seconds. | URD-10, URD-06 | Must |
| DR-67 | Each detected change resets the label to "updating…" and re-pulses the blip — sub-second confirmation the stream is live. | URD-10 | Must |
| DR-68 | **Settle timeout (auto-hide):** after 90s with no change the status bar is removed from the DOM entirely (brief fade-out; instant under reduced-motion). The watch stays armed — the next disk change re-reveals the bar pulsing within 1s; switching to an already-settled tab shows no bar. *(Iteration 2026-06-21: supersedes the original "blip dims to a steady dot, bar persists" — see note below.)* | URD-10, URD-08 | Should |
| DR-69 | Tick cadence: every 1s while the file is recent (`<90s`), then the bar auto-hides (DR-68) so there is no visible counter past 90s — avoids idle CPU churn (URD-02). *(Iteration 2026-06-21: the original "every 60s thereafter / static past 1h" applied to a persistent bar; with auto-hide the minutes/hours cadence is moot.)* | URD-02 | Should |
| DR-70 | The clock measures time since `lastModTime` (last disk change), NOT since tab-open or launch; on tab switch it preserves elapsed (no reset). | URD-10, URD-04 | Must |
| DR-71 | The label reflects only a live watch; when the watch stops (file removed/closed), the status bar and label are removed — never a stale time on a dead watch. | URD-10 | Must |

**Success metric:** In a 5-person session reviewing a file streamed then stopped, users distinguish "actively updating" from "settled/idle" 5/5 without touching the file; each disk write flips the label to "updating…" within 1s; the indicator settles within 90s of the last change.

**Acceptance criteria**
- Label never exceeds the bounded format while visible (no `Xs ago` past 60s; rolls to `1m`). *(With auto-hide the bar is gone before the minutes>1m / hours buckets are reached.)*
- A disk write resets the label to "updating…" and re-pulses the blip within 1s.
- 90s with no change → the status bar auto-hides (removed from the DOM); the watch stays armed and the next disk change re-reveals it pulsing within 1s. Switching to an already-settled tab shows no bar. *(Supersedes "dims to a steady dot".)*
- Switching away from and back to a *recent* live tab preserves the elapsed reading (no reset to 0); a tab that settled while backgrounded stays hidden until its next change.
- Closing or on-disk-removing the file removes the status bar entirely — no stale time shown (DR-71, distinct from auto-hide: the watch is torn down).
- Under `prefers-reduced-motion: reduce`, the blip does not pulse and the settled bar is removed instantly (no fade).

**Scope boundary (out):** absolute timestamps (relative only), per-section/per-line recency, progress-bar semantics, coupling to Pin scroll, localisation (English only).

**Iteration note (2026-06-21):** DR-68 originally specified the settled bar *persist* as a dimmed steady dot. Per **URD-08 / Cluster H ("UI chrome should be earned, not imposed")**, a settled file that has stopped changing has not earned a permanent bar, so the decision was changed to **auto-hide**: the bar is removed 90s after the last change, and re-revealed (pulsing) on the next disk write. The watch stays armed throughout; this is distinct from DR-71 teardown. Trade-off accepted: the next write produces a brief re-appearance ("pop-in"), and the **Pin scroll** control is unavailable while the bar is hidden (it returns with the bar, when Pin again matters because content is growing). Residual (needs Rust mtime plumbing, deferred): a just-opened static file still shows the bar for its first 90s before auto-hiding, because open-time seeds the recency clock.

**Current → target gap:** today's `updated 3847.2s ago` (unbounded, tenths, fixed 900ms tick, no settle state) fails DR-66/DR-68/DR-69 — those drove the change.

---

*Prepared via UxPipeline Step 3 (3 analyst passes + adversarial critique). The initial 7 gaps (DR-11–DR-64) plus the live-watch recency label (DR-65–DR-71) are certified crystal-clear and build-ready as Step-4 (ideation) / engineering inputs.*

---

# Part 5 — Tab Context Menu (U-10, U-08, U-12, U-11)

*Gaps U-10 (tab context menu), U-08 (Reveal in Finder / copy path), U-12 (reload from disk), U-11 (middle-click close). Source URDs: URD-04 (multi-file nav), URD-07 (file trust/reveal), URD-08 (invoke-on-demand chrome).*

| DR | MoSCoW | URD | Requirement | Acceptance Criteria |
|----|--------|-----|-------------|---------------------|
| DR-72 | Must | URD-08 | Right-clicking any `.tv-tab[data-tab-id]` element opens a positioned `openTabCtx` menu and suppresses the WebView default context menu (`preventDefault`). | `contextmenu` on a tab element → menu appears, no browser native menu; `contextmenu` on non-tab area → folder menu path unchanged. |
| DR-73 | Must | URD-07 | "Reveal in Finder" menu item calls `TVNative.revealInFinder(tab.nativePath)` for tabs that have a `nativePath`. | Clicking "Reveal in Finder" on a native-path tab invokes `revealInFinder`; `console` shows no error. |
| DR-74 | Must | URD-07 | "Copy Path" menu item writes `tab.nativePath` to the clipboard via `navigator.clipboard.writeText`; failures are silent `console.warn` only. | After click, `clipboard.readText()` equals the tab's absolute path exactly; no toast/modal on failure. |
| DR-75 | Must | URD-08 | "Reveal in Finder" and "Copy Path" are visually muted (`.disabled` class, `opacity:.38`, `pointer-events:none`) and non-actionable for tabs where `nativePath` is absent (untitled, error tabs). | Disabled items cannot be clicked and produce no action; no JS error thrown. |
| DR-76 | Should | URD-06 | "Reload from Disk" calls `invoke('read_md_file', {path})`, overwrites `tab.source` and `tab.dirty=false`, then re-renders if that tab is active. | After editing a tab, choosing Reload restores the on-disk content; dirty indicator clears; re-render fires only for the active tab. |
| DR-77 | Must | URD-04 | "Close Tab" action in the tab context menu calls `closeTab(tabId)` (same guard logic as the X button, including dirty-confirm dialog). | Closing a dirty tab via the menu shows the "Discard unsaved changes?" dialog; clean tabs close immediately. |
| DR-78 | Should | URD-04 | "Close Others" closes every tab whose `id !== tabId` by iterating a snapshot of `state.tabs` ids before any mutation, so concurrent closes don't skip tabs. | With 4 tabs, choosing "Close Others" on tab 2 leaves only tab 2 open; no tabs are skipped. |
| DR-79 | Should | URD-04 | "Close All" (`.danger` class) closes every tab. | All tabs closed; empty state rendered. |
| DR-80 | Should | URD-04 | Middle-click (`mousedown` with `e.button===1`) on a `.tv-tab` element calls `closeTab` and calls `preventDefault` to suppress autoscroll. | Middle-clicking a tab closes it without any scroll jump; works on both active and inactive tabs. |
