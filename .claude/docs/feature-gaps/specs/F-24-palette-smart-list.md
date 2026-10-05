# F-24 — Command palette: one smart list

*The ⌘K palette rebuilt as one ranked list with a tiered matcher, context-aware zero-query, Create-on-no-match, `#` headings mode and Appearance preview pages.*

---

## Why

A live audit of the old palette found: it opened on six Theme/Accent rows so "Open File…" was row 7 and "New File" row 9; commands that do nothing (Save, Close Tab) showed with no document open; headings from every tab flooded the list and pushed Commands below the fold; the group "Open File" (already-open tabs) shared a name with the command "Open File…" (a picker); the left edge was ragged; and typing "new" matched "Accent: Warm". Research (`scratchpad/palette-research.md`, graded sources) and four prototypes led to this option (artifact "Palette Options", option A + C's Appearance pages).

## URD tie-back

URD-08 minimal chrome (nothing persistent, one invoked surface), URD-05 view-first (the next file or the next action is one key away), URD-04 multi-file navigation (the previous tab is armed, so ⌘K ↵ flips back), URD-07 / DR-06 (Create makes an unsaved document; nothing is written).

## Behaviour

- **Zero-query, ≤ 8 rows, no scroll, only things that can run.**
  - First run: Recent (files and folders), then Actions: New File, Open File…, Open Folder….
  - Tabs open: **Switch to** (other tabs, latest first, the previous one armed), **Recent** (2), **Actions** (4): New File, Open File…, Edit document, Appearance. With unsaved work Save leads. The two commands you ran last float to the top.
- **Typing** ranks four groups in a fixed order: Switch to, Headings (current document only; other tabs fold into one "N more in other tabs" row that opens ⌘⇧F), Files (recents and open folders' files that are not open), Actions. 8 rows total shared by best match.
- **Matcher tiers:** prefix, every word starts a word, initials, substring (3+ letters), constrained subsequence (first letter on a word start, small gaps), then one adjacent transposition. Aliases rank below labels ("new tab" finds Start Page). Loose subsequences no longer match.
- **Unavailable commands** are dimmed with a reason ("Open a file first", "Nothing to save") and skipped by the arrows.
- **Create:** when nothing runnable matches, one row, **Create "notes.md"**, is armed. ⇧↵ creates from any query. The file opens in edit mode, unsaved; the Save panel suggests the typed name (F-23).
- **`#`** scopes the list to the current document's headings. ⌘⌥O opens the palette with `#` typed.
- **Appearance** is one row. ↵ opens a page: Theme, Accent, Text size. On a value page ↑↓ previews live (the whole app repaints), ↵ applies and closes, Esc reverts and goes back, ⌫ on an empty field goes back, closing mid-preview reverts. Typing "dark" or "warm" offers the value directly; "theme" / "text size" opens that page.
- **Keys:** ↑↓ and ⌃N/⌃P move; ↵ runs; ⌘↵ reveals in Finder (file rows); ⇧↵ creates; Esc clears the query, then closes; Tab stays in the field (focus trap). Hover tints a row and never moves the armed row; click runs it.
- **Verbs:** the armed row shows its verb and a solid ↵ keycap (Switch to, Jump to, Open, Run, Create, Apply, Toggle); the footer lists only the keys that act on it.

## Look (no bar, no border, no ring)

Four levels: L1 input (17/500) and the armed row label (14/600); L2 labels 14/400; L3 secondary text 12.5; L4 group headers (caps), chips and footer 11. One row grid: 20px icon column (always present) | label with inline secondary text | trailing slot. The armed row is `--tv-sel-strong` (accent at .24 light / .28 dark, 1.33–1.66:1 against the surface, up from 1.18–1.37:1) plus semibold weight and the ↵ keycap; the fill alone is under 3:1, so the keycap and weight carry the state. Hover is `--tv-bg-hover`. No left border, accent bar, under-rule, inset bar or focus ring anywhere on the palette (commit 6a209e3; the palette input draws no ring per C-10). Forced-colors maps the armed row to Highlight.

## Requirements

| ID | Requirement | URD |
|---|---|---|
| DR-137 | Zero-query shows at most 8 rows, never scrolls, and lists only commands that can run now. | URD-08 |
| DR-138 | The previous tab is armed at zero-query when tabs are open. | URD-04 |
| DR-139 | Matching is tiered; a loose subsequence does not match; aliases rank below labels. | URD-05 |
| DR-140 | Groups: Switch to, Headings (current document), Files, Actions; no group title is also a command label. | URD-08 |
| DR-141 | A command that cannot run is dimmed with a reason and cannot be armed. | URD-08 |
| DR-142 | No runnable match → Create "<query>.md" (⇧↵ always); unsaved until Save. | URD-07 |
| DR-143 | `#` lists the current document's headings; ⌘⌥O opens the palette with `#` typed. | URD-04 |
| DR-144 | Theme, Accent and Text size are one Appearance row opening preview pages; ↑↓ previews without persisting; Esc and closing revert. | URD-08 |
| DR-145 | Hover never moves the armed row; the armed row shows its Enter verb. | URD-05 |
| DR-146 | Combobox + listbox with aria-activedescendant, live result count, focus trap and restore. | URD-08 |

## Replaces

The old flat Theme ×3, Accent ×3, Increase/Decrease text size rows (⌘= ⌘− ⌘0 remain), the "Jump to Heading" / "Open File" / "Recent" / "Commands" groups, and the `_outlineMode` special case. "New Tab" is now **Start Page** (alias "new tab").

## Not built (prototyped in the artifact only)

Entering a path (full or fuzzy) to open a file or folder. It needs a Rust command that lists a directory and resolves each path segment; see the artifact's design note for rules and open questions.

## Verification

`node app/js/tv-palette.test.js` (matcher tiers, every state's model, wiring and look guards), `tv-newfile.test.js` (named creation), headless Chrome end to end, and a QA subagent in the web build and the native app.
