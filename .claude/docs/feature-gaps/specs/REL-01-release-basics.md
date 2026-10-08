# REL-01 · Release basics: text context menu, markdown rendering, links

Owner feedback (2026-10-08): "for an app that views text there is no contextual menu when
selecting a text … look around for any other similar basic missing features", then
"block entries are not being displayed properly" (a fenced block inside a list item showed
as inline code with stray backticks, and the list restarted at 1).

## Audit: what was missing

| Gap | Cause | Fix |
|---|---|---|
| No context menu in the document | `tv-app.js` called `preventDefault()` on every `contextmenu` outside tabs/sidebar | DOC-MENU below |
| Fences, paragraphs, quotes, tables inside list items; `3.` restarts at 1; loose lists split | hand-written line parser had no list-item containers | MD-01 below |
| Indented fences, 4-space code, autolinks, hard breaks, `\` escapes, reference links, footnotes, raw HTML (`<details>`, `<kbd>`) | same parser | MD-01 |
| A relative link (`[spec](../spec.md)`) navigated the app's WebView away | click handler only handled `http(s)` and `#` | links below |
| `#anchor` links missed headings with punctuation | headings had no ids; text lookup only | GitHub slug ids |
| Window size/position reset on every launch | no frame persistence | AppKit frame autosave |
| No way to reopen a closed tab | — | File ▸ Reopen Closed Tab ⇧⌘T |

Not changed (already present): Edit menu Copy/Select All, Find/Find Next, Print, zoom,
Open Recent, session restore, Window menu, middle-click closes a tab, copy-code button.

## DOC-MENU · the document context menu

Standard macOS pattern for a WKWebView app: WebKit builds its native menu and the app
edits it in `NSView willOpenMenu:withEvent:` (lib.rs `doc_menu`, plan in `plan_doc_menu`).

- **Selected text:** Look Up, Translate, Search with Google, Copy, **Copy as Markdown**,
  Share, Speech, then **Find in Document**, **Find in Files**.
- **Link:** **Open Link** (same route as a click), Copy Link, Share.
- **Image:** Copy Image, Share. Open/Download items are dropped (DR-06; no new windows).
- **Blank document area:** Select All (document only), Find…, Edit Source, Print….
- **Source editor (textarea):** WebKit's editing menu, untouched apart from dropped items.
- Dropped everywhere: Back, Forward, Reload, Stop, Open Link, any "…in New Window", any Download.
- Chrome (tabs, sidebar) keeps its own menus; elsewhere in the chrome no menu shows.

## MD-01 · renderer

`tv-markdown.js` parses with vendored `marked` 18.1.0 (CommonMark +
GFM). Renderer overrides keep Galley markup (copy buttons, `.tbl-wrap`, task boxes, image
figures/placeholders, diagram placeholders, scheme guards). Raw HTML renders only through
DOMPurify 3.4.16 (no `script`/`style`/`iframe`/forms; relative `<img>` resolve like markdown
images); without DOMPurify raw HTML shows as text. Code blocks carry `data-lang`.
Footnotes are Galley's own marked extension (linear; numeric `fn-N` / `fnref-N` ids, so a
label never reaches the HTML) — `marked-footnote` was dropped after QA measured it quadratic
(1 MB: 8–22 s). YAML front matter renders as a muted `yaml` block, not a setext heading.

## Links

`TVDocMenu.resolveLink`: web/mail → default browser; `#id` → element (footnotes) or heading;
relative markdown file → opens in a tab; other relative file → revealed in Finder. A
document link never navigates the WebView.

## Acceptance

1. The owner's screenshot document renders the fence inside item 1 and numbers item 2 as 2.
2. Right-click on selected text shows the native menu with the items above; Copy as Markdown
   puts the selection's markdown on the clipboard (round-trip tests in `tv-docmenu.test.js`).
3. No menu item navigates the app or downloads; editable text keeps its editing menu.
4. Relative `.md` links open in Galley; `#anchor` TOC links land on the heading.
5. Quit and relaunch keeps the window frame; ⇧⌘T reopens the last closed file.
6. `node app/js/tv-markdown.commonmark.test.js`, `tv-docmenu.test.js` and the Rust
   `doc_menu_*` tests pass; every existing suite still passes.
