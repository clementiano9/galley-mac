# F-23 — New File

*Create a markdown file from inside Galley. The document lives in memory until the user saves it; the native Save panel is the only thing that ever writes.*

---

## Why

Galley could only open files that already existed. Anyone who wanted a new note, or an empty file for an agent to write into and Galley to watch, had to leave for another app first.

## URD tie-back

| URD | What it demands here |
|---|---|
| URD-07 File trust | "Tools that write extra files or databases are actively distrusted." Step 3's hard constraint: no writes without an explicit user save (DR-06). So creating must not create a file. |
| URD-05 / URD-08 | Stay a viewer that gets out of the way. No new persistent chrome, no wizard, no template picker. |
| URD-09 | Editing is "an extension of viewing"; full editor features are out of scope. New File adds no editor features — it reuses the existing edit mode. |
| URD-10 / URD-06 | The AI-review workflow: a file made empty here can be pointed at by an agent and read live. So an empty file must be saveable. |

Step 4 chose the browser-tab model. ⌘T stays the "new tab" launcher; **New File gets its own action (⌘N)** rather than overloading ⌘T or the + button.

## Decision

**A new file is an in-memory tab, `Untitled.md`, opened in edit mode. It reaches disk only when the user presses ⌘S, which opens the native Save panel.**

| Rejected alternative | Why |
|---|---|
| Ask for a name and location first, then create an empty file | Writes before the user has typed anything (breaks DR-06's intent) and puts a modal between the user and the page. |
| Auto-create or auto-save drafts in a scratch folder | Writes files nobody asked for; URD-07. |
| Make ⌘T / the + button create a document | Breaks the browser new-tab model (step 4) and the launcher's role. |
| Templates, front matter, split preview | URD-09: full editor features are out of scope. |

## Behaviour

- **Entry points, one action** (`TV.newFile()`): ⌘N, File ▸ New File, palette "New File", a row in the ⌘T launcher, and the ⌘N hint on the empty first-run screen. Not the + button.
- **Name:** `Untitled.md`, then `Untitled 2.md`, … first free number, case-insensitive.
- **Lands in edit mode** with the caret in the editor. A blank file shows one hint, "Start writing. Nothing is saved until you press ⌘S.", until the first keystroke. New File skips the "Leave edit mode?" confirm because you stay in edit mode; the outgoing textarea is still committed to its tab.
- **From the ⌘T launcher** the launcher tab becomes the document in place, as opening a file already does. No orphan tab.
- **Clean until typed.** Closing an untouched blank tab is silent. Once typed, the existing discard confirm and the quit guard (Save All) apply unchanged.
- **⌘S always means "choose where"** for a new file, even when empty. Cancel is quiet ("Save cancelled") and changes nothing. A failed write keeps the buffer and stays in edit mode. ⌘S now also works from reading mode for a new or dirty document, so previewing with ⌘E does not strand a new file.
- **The Save panel opens beside the file you were reading;** else in the most recently opened folder; else wherever macOS last had it. If you were on another unsaved new file, that file's destination.
- **After a successful save it is a normal file tab:** real name and directory, live-watch armed, added to Recent, added to the restorable session immediately, and listed in the sidebar tree if it landed inside an open folder (the folder is re-scanned).
- **Not restored on relaunch while unsaved.** The quit guard already stops you quitting with unsaved work without asking.

## Requirements

| ID | Requirement | URD |
|---|---|---|
| DR-129 | New File creates an in-memory document. Nothing is written until an explicit Save. | URD-07 |
| DR-130 | One `TV.newFile()` action reached by ⌘N, File ▸ New File, the palette, the launcher row, and the empty-state hint. | URD-05, URD-08 |
| DR-131 | The new tab is named `Untitled.md` / `Untitled N.md` (unique among tabs), opens in edit mode with the caret in the editor, and a blank one shows the "nothing is saved" hint. | URD-09 |
| DR-132 | A new tab is clean until the first keystroke; closing an untouched one never prompts. | URD-07 |
| DR-133 | Save on a new file always opens the Save panel, including when empty. Cancel is quiet and changes nothing; failure keeps the buffer in edit mode. | URD-07, URD-10 |
| DR-134 | The Save panel's starting folder follows the folder of the file being read, else the latest open folder, else the OS default. | URD-04 |
| DR-135 | A saved new file becomes a normal file tab (path, live-watch, Recent, session, folder tree). | URD-04, URD-10 |
| DR-136 | The shortcuts overlay lists ⌘N. This takes it to 20 rows, the DR-17 cap; the next shortcut needs a DR-17 amendment first. | URD-08 |

## Bug found on the way

Native Save As never worked for a tab with no path. `tv-native.js` sent `suggested_name`, but Tauri 2 expects `suggestedName`, so the command rejected the call. Fixed, and `tv-native.runtime.test.js` now reads the `save_md_file_as` signature from `lib.rs` and fails if the keys JS sends drift from it. (Recorded in `NATIVE-CONTRACT.md`.)

## Not built

Templates, choosing a name before typing, draft persistence, a New Folder action, creating a file directly inside a chosen sidebar folder (right-click), and a "recent locations" list.

## Verification

- `node app/js/tv-newfile.test.js` — naming, default directory, DR-06 (creating writes nothing), save rules, every entry point, the blank editor.
- `node app/js/tv-native.runtime.test.js` — Save-As arguments, cancel, failure, and the Rust-signature contract.
- Driven end to end in headless Chrome with a fake Tauri bridge that enforces camelCase argument keys: every entry point, blank/typed/dark screenshots, cancel, failure, success (rename, watch, Recent, session, tree refresh), empty-file create, save from reading mode, the default-directory rules.
- Not driven: the real macOS Save panel (`NSSavePanel`) and the native menu. `cargo build` compiles the command and the menu item.
