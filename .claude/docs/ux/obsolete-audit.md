# Obsolete-design audit — 2026-10-06

*Check run before the UXF-01…06 design, as the owner asked ("ensure you are not following obsolete designs"). Compared `.claude/docs/**`, the two contracts and the external mockups against the shipped code on `feat/ux-feedback-2026-10` and `git log` (rename to Galley `1f3ffdd`; Edge sidebar `602c698`; SBH `49a47a2`; JANK `ca6f72b`; polish `cd25988`; F-23 `66a85e6`; F-24 `deb660f`).*

**Nothing was deleted or edited** (apart from the new step-8 row in `INDEX.md`). Actions are proposals: **delete**, **mark superseded** (add a banner, keep the text), **update**.

## A. Files in the repo

| File / section | Why it is obsolete | Action |
|---|---|---|
| `ux/UX-DESIGN-SYSTEM.md` (whole file) | Verbatim concatenation of steps 2–6, titled "tiny-viewer". It holds no step-7 tokens although `docs/README.md` calls it "the step-7 output". Its tail still offers "Swift native app" as an alternative; Tauri shipped | **delete** (duplicate of the step files); fix the two links to it |
| `ux/gemini-step7-prompt.md` | Prompt for a Gemini mock-up run under the old name; the visual design came from the claude.ai design import and now lives in `tv-tokens.css` | **delete** |
| `ux/INDEX.md` | Titled "tiny-viewer"; lists only 10 DRs while the DR range runs past DR-128; no rows for step 7 or step 8 (step 8 row added by this audit's author) | **update**: rename to Galley; link `feature-gaps/waad-grounded-requirements.md` for DR-11+; add a step-7 row (design import) |
| `ux/step-5-ia.md` — App Map | Sidebar "220px, hidden by default" (shipped 224, resizable 160–480, open from 1,440 px); "⌘T opens file picker" (⌘T is the launcher page); "Line numbers (Settings)" and a Settings panel (forbidden by DR-31/DR-32); palette "Settings" (now "Preferences & Shortcuts…", DR-30); Recent at the top of the sidebar (F-02 put it below the tree) | **mark superseded** for the App Map; keep flows |
| `ux/step-6-wireframes.md` — Screens 1–6, breakpoints | Window title `[tiny-viewer]`; flat folder list with `📂`; live marker drawn as `•`; "[Search…]" box (shipped: "Find in document"); sidebar breakpoints already implemented (F-09) | **mark superseded** (historical wireframes) |
| `ux/step-2-waad-urd.md` — journey map | "DESIRED (tiny-viewer)" product name only | **update** (one word), low priority |
| `feature-gaps/waad-grounded-requirements.md` — F-19 "Decision" paragraph and its acceptance criteria | Says "single-depth flat list, one secondary indent only, deeper nesting flattened". ISS-005/SBH made the tree fully recursive; only the DR-37 table row carries the supersede note | **update**: strike the decision, the "one extra indent" criterion and the out-of-scope line "deep multi-level recursion" |
| same file — **DR-41** (50-row cap with internal scroll) and the "Navigation reconciliation" line citing it | Shown to hide 8 of 12 folders in a 54-row tree; replaced by UXF-03 | **mark superseded by UXF-03** |
| same file — Part 2 header "Sidebar stays 220px, ⌘B-toggled" | Width is 224 by default, resizable, default becomes 264 in UXF-03 | **update** |
| same file — DR-17/DR-23 amendment "Shipped list is now 19 rows" | `SHORTCUTS` holds 20 rows since ⌘N (F-23); UXF-06 makes it 21 and raises the cap to 22 | **update** |
| same file — F-19 out-of-scope "FSEvents folder watching (re-run ⌘⇧O to refresh)" | Folder ▸ Refresh exists; UXF-02 adds a focus re-scan | **update** |
| `feature-gaps/spec-gaps.md` | Snapshot of 2026-06-08. The Status column still says "Missing" for items that are built (F-01 tab cycling, F-03 open folder, F-04 palette actions, F-07 find, F-08 menu bar, F-09 responsive sidebar, F-10 reveal in Finder, F-11 zoom…) | **mark superseded** (banner: "point-in-time; see git log"), or move to an `archive/` folder |
| `feature-gaps/ux-gaps.md` | Same snapshot problem (U-02, U-04, U-06, U-10…U-17 are built) | **mark superseded** |
| `feature-gaps/specs/F-02-recent-files.md` | "in the 220px sidebar" | **update** (one phrase) |
| `feature-gaps/specs/U-17-sidebar-keyboard-nav.md` | Written for a listbox with capped folder bodies and no expand-all; UXF-03 adds section groups, sticky heads and ⌥-arrows | **update** after UXF-03 lands |
| `qa/QA-REPORT.md`, `qa/round2/*`, `qa/round5/*` | Point-in-time reports against the old name, a flat tree and since-fixed defects; they can mislead as acceptance baselines | **mark superseded** (banner: "historical, not a baseline") |
| `app/CONTRACT.md` | `TV` API list omits `registerFolder`, `closeFolder`, `openFolder`, `openShortcuts`, `openErrorTab`, `openUntitledTab`, `saveSession`…; state block omits `openFolders`, `folderCollapsed`, `sidebarWidth`; DOM contract lists no tab-bar toggle or sidebar header. A "binding" contract that omits what ships | **update** as each UXF lands (add `TV.revealInSidebar`, `.tbl-wide`, `data-edge`, `tv-swipe`) |
| `tauri-app/NATIVE-CONTRACT.md` | Command table lacks `pick_folder`, `reveal_in_finder`, `print_page`, `take_pending_opens` (all registered at `lib.rs:1352-1368`); the "C-29 DirTree truncation" section describes the 3-tier shape and 5,000-entry re-scan that UXF-02 replaces | **update**; replace C-29 |
| `CLAUDE.md` (project) | States the commands "are tabulated in NATIVE-CONTRACT.md" (they are not all); module map will lack `tv-swipe` | **update** with UXF-05 |
| `docs/README.md` | Describes `ux/` as "steps 2–6 plus the step-7 output `UX-DESIGN-SYSTEM.md`" | **update** (step-8 files; drop the step-7 claim if the file is deleted) |
| `.claude/queue.json`, `queue.config.json`, `queue-state/` (27 Jun Foreman runs) | Gitignored runtime state of finished runs; a stale `run.json` already tripped the budget once (see memory `foreman-rerun-gotchas`) | **delete locally** (not tracked) |

## B. External mock-ups (claude.ai design project, imported by DesignSync; not in the repo)

| Mock-up | Why obsolete | Action |
|---|---|---|
| "Mirror / Edge" sidebar-toggle mock-up | Edge was chosen (`602c698`) and is itself superseded by UXF-05 (one button). The old open question "consolidate the mock-up on Edge" is closed | **delete** the Mirror variant; replace Edge with the single-button state pair |
| "Sidebar Hierarchy" (SBH) | Rails, indent and one-root rules are still shipped and right. Its fully-expanded default and capped body are superseded by UXF-03 | **update** the default-state frame only |
| "More Files Options" | The "More files" bucket was dropped for full recursion (note A6 at `tv-app.css:2445`) | **delete** |

## C. Code that these specs make obsolete (remove when the UXF lands)

| Code | Superseded by |
|---|---|
| `tv-app.js:2439-2442` header `.tv-side-collapse` button; `tv-app.css:345-358`; `collapseLeft` icon; pin at `tv-css-polish.test.js:146`; `UX-SBR` / `UX-SB3` comments (`tv-app.js:747-751`, `4375`, `4615`; `tv-app.css:266-272`, `331-333`) | UXF-05 |
| `.tv-folder-body.capped` (`tv-app.css:2379-2382`), `capped` in `buildFolderSection` (`tv-app.js:1460`), the `[data-folder-body]` branch of the sidebar scroll capture (`tv-app.js:1316-1360`), capped-body cases in `tv-sidebar-jank.test.js` | UXF-03 |
| Three-tier `DirTree` (`files/subfolders/deep/skipped/skippedExact`): `lib.rs:108-154` and `695-1005`, `tv-tree.js` `assembleTree`/`collectTreeFilePaths`, `tv-palette.js:396-400`, `tv-native.js:464-472` comments | UXF-02 |
| `.tbl-wrap` L-02 note and rule (`tv-app.css:722-726`) | UXF-01 |
| `.tv-flash` used as the only "reveal" cue | UXF-06 adds `.tv-reveal`; `.tv-flash` stays for non-active rows |
| `unwatchFolder` (`tv-native.js:653`): unwatches a path that is never watched as a folder | remove or implement real folder watching (open question in step 8) |
| `icons.reveal`, `icons.copy`, `icons.refresh` read in the context menus (`tv-app.js:1768`, `1871`, `2104`…) but absent from `tv-icons.js`, so those menu items render an empty icon slot | add the three glyphs, or drop the empty `.ic` spans |

## D. Auto-memory notes (outside the repo, for the assistant)

`sidebar-edge-direction` (Edge, "mock-up consolidation open") is superseded by UXF-05; `sidebar-hierarchy-sbh` and `sidebar-selection-jank` describe the capped body as a fact to design around, which UXF-03 removes; `galley-polish-pass-2026-08` says implementation "not started", but `cd25988` shipped 30 accepted items.

## E. Added by iteration 2 (2026-10-06)

| File / section | Why it is obsolete | Action |
|---|---|---|
| `UXF-01-wide-tables.md`, the three v1 tiers | Sized a table by its max-content width; stretched prose tables to the pane (1,122 px measured) | **updated** in place: width policy v2 |
| `UXF-02-folder-visibility.md`: "hidden (dot) folders are included", footer wording `Show N folders without markdown` | Superseded by the agent allow-list and the single `Show N more folders` toggle | **updated** with a pointer to UXF-07 |
| `UXF-05-sidebar-toggle-swipe.md`: "no animation" feedback paragraph | Superseded by UXF-08 | **updated** |
| `step-8-evaluation.md` section 6, UXF-01 "Why B" ("grow to fit") | The "grow to fit" rule is replaced by "size by need and content kind" (iteration 2, item A) | **mark superseded** (banner already implied by the Iteration 2 section; add one line if the file is reprinted) |
| `tv-app.css`: about 40 `transition` and `animation` declarations with literal durations (.10 s to 1.4 s) | One motion token set replaces them (UXF-08) | **update** during UXF-08; keep the loops and the 6 s banner dismiss as listed there |
| `tv-files.js:14`, `tv-native.js:39`, `lib.rs:184, 269, 494, 702, 1489`: the three-extension lists `md markdown txt` | `mdc` is a viewable extension (UXF-07) | **update** |
| `waad-grounded-requirements.md` DR-39 "The folder list displays no non-.md files" | Amended: `.mdc` and six extensionless rule files are viewable (UXF-07) | **update** |

