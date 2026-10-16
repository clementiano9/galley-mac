# Changelog

## 0.2.0 (2026-10-16)

The first public release. Apple silicon, macOS 13 or later.

### New since the 0.1.0 tester builds

- **Open a file by typing its path.** Press ⌘L, or type `/`, `~/` or `./` in the ⌘K
  palette. Completion is fuzzy, so a nearly right path still finds the file. ⇥ accepts.
- **Reading progress.** A thin rail on the right edge appears while you scroll and fades
  when you stop. Point at it to see how far you are and the minutes left; drag it to scroll.
- **One command palette.** ⌘K ranks files and commands in one list, jumps to headings
  with `#`, offers to create a file when nothing matches, and previews Appearance
  settings before you pick one.
- **New File (⌘N).** The document stays in memory until you save it.
- **Document right-click menu.** Copy as Markdown, Find in Document, Find in Files and
  Open Link, beside the standard macOS items.
- **CommonMark and GitHub-flavoured Markdown.** Code blocks inside lists, footnotes,
  reference links, front matter, and sanitised raw HTML such as `<details>` and `<kbd>`.
- **Links.** A relative `.md` link opens in a tab; `#anchor` links land on the heading.
- **Tabs and windows.** ⇧⌘T reopens the last closed tab. The window keeps its size and
  position between launches.
- **Tables.** Wide tables use the free width beside the text, and the header row stays
  visible while you scroll.
- **Sidebar.** Shows every folder that holds markdown, including agent folders such as
  `.claude` and `.codex`; other dot-folders stay hidden. ⇧⌘J reveals the open file. One
  button or a two-finger swipe shows and hides it.
- **Motion.** Short transitions for the sidebar, palette and overlays. Reduce Motion
  turns them off.
- Tab and sidebar context-menu items have icons.

### Fixes

- Images inside dot-folders such as `.github/media` load.
- Relative image paths resolve against the document's folder.

### Install

Download `Galley_0.2.0_aarch64.dmg`, open it and drag Galley to Applications. Galley is
not notarized, so macOS blocks the first launch: open **System Settings > Privacy &
Security**, find the Galley message under **Security**, and click **Open Anyway**.
