# Step 5: Information Architecture
*App map, user flows, navigation schema, content inventory*

---

## App Map

```
tiny-viewer
│
├── MAIN WINDOW
│   ├── Tab Bar (persistent, always visible)
│   │   ├── File tabs (Cmd+1–9 to jump, Cmd+[/] to cycle)
│   │   └── + New Tab button (Cmd+T → opens file picker)
│   │
│   ├── Sidebar Panel (Cmd+B to toggle, 220px wide, hidden by default)
│   │   ├── Recent Files (last 20 opened)
│   │   ├── Open Folders (with recursive file tree, .md files only)
│   │   └── Search input (Cmd+F: in-file; Cmd+Shift+F: across all tabs)
│   │
│   └── Document Viewer (all remaining area)
│       ├── Reading Mode (DEFAULT)
│       │   ├── Rendered markdown
│       │   │   ├── Headers (H1–H6)
│       │   │   ├── Body text, emphasis, strong
│       │   │   ├── Inline code and fenced code blocks (syntax-highlighted)
│       │   │   ├── Tables
│       │   │   ├── Standard images: ![alt](path) and ![alt](url)
│       │   │   ├── Blockquotes
│       │   │   └── Task lists [ ] / [x]
│       │   ├── Mermaid diagrams (rendered async, non-blocking)
│       │   │   ├── Placeholder shown during render
│       │   │   └── Error state shows source + highlighted error line
│       │   └── Live watch indicator
│       │       ├── ⚡ icon in tab when file is being written
│       │       └── "Live — last updated Xs ago" status bar (bottom)
│       │
│       └── Edit Mode (opt-in, triggered by double-click)
│           ├── Source markdown text (monospace font)
│           ├── Line numbers (optional, Settings)
│           ├── Minimal edit toolbar (Esc, Cmd+S, word count)
│           └── Esc → returns to Reading Mode at same scroll position
│
├── COMMAND PALETTE (Cmd+K, globally available)
│   ├── Open File… (shows system file picker)
│   ├── Open Folder… (grants persistent folder permission)
│   ├── Recent Files (fuzzy searchable list)
│   ├── Jump to Heading (H1–H6 in current file)
│   └── Settings
│
├── MENU BAR
│   ├── File
│   │   ├── Open… (Cmd+O)
│   │   ├── Open Folder… (Cmd+Shift+O)
│   │   ├── Close Tab (Cmd+W)
│   │   ├── Save (Cmd+S) — only available in Edit Mode
│   │   └── Reveal in Finder
│   ├── View
│   │   ├── Toggle Sidebar (Cmd+B)
│   │   ├── Zoom In / Out (Cmd+= / Cmd+-)
│   │   ├── Toggle Edit Mode (Cmd+E)
│   │   └── Toggle Live Watch (per-file)
│   └── Window (standard macOS: Minimize, Zoom, etc.)
│
└── SETTINGS (accessible via Cmd+K → Settings)
    ├── Appearance
    │   ├── Theme: Light / Dark / System (default: System)
    │   └── Font size: Small (14px) / Medium (16px) / Large (18px)
    ├── Rendering
    │   ├── Mermaid diagrams: on/off (default: on)
    │   └── Syntax highlighting: on/off (default: on)
    └── Editor
        └── Line numbers: on/off (default: off)
```

---

## User Flows

### Flow 1: Open AI-generated file(s) — primary task

```
TRIGGER: AI writes N .md files to a folder on disk

STEP 1: User drags folder onto dock icon
         OR Cmd+O → macOS file picker → select .md file(s)
         OR Cmd+Shift+O → select folder → all .md files load as tabs

STEP 2: First file renders immediately (<300ms)
         Remaining files load as tabs (visible, clickable while loading)

STEP 3 [if AI still writing]: ⚡ icon appears in tab
         Content updates at bottom as AI writes
         Existing scroll position is NOT moved

STEP 4: User reads; scrolls; tabs between files with Cmd+[/]
         Position saved per tab automatically

STEP 5: User spots issue → double-click on paragraph
         → Edit Mode: source appears, cursor at double-clicked line

STEP 6: User edits line → Cmd+S → Reading Mode resumes

STEP 7: Cmd+W closes tab
         File on disk is unchanged unless user explicitly saved
```

### Flow 2: Multi-file navigation with position memory

```
STATE: 8 tabs open from a project review session

ACTION: Click Tab 3 (or press Cmd+3)
→ Switch time: <50ms
→ Scroll position restored automatically

ACTION: Cmd+K → type "database schema"
→ Command palette shows: "Jump to: ## Database Schema (in tab 6)"
→ Select → navigates to Tab 6, scrolls to heading

ACTION: Cmd+[ → back to Tab 3
→ Scroll position remembered from before

ACTION: Cmd+Shift+F → type "latency"
→ Results panel: matches per file, with context snippet
→ Click result → navigates to that file and scroll position

ACTION: Cmd+W × 8 → all tabs closed
→ App returns to empty state
```

### Flow 3: Single-file quick review

```
TRIGGER: User double-clicks .md file in Finder
         (tiny-viewer registered as default .md handler)

STEP 1: If tiny-viewer already open → new tab added
         If tiny-viewer not open → launches, renders file in <500ms

STEP 2: User reads; done.

STEP 3: Cmd+W → tab closed
         App stays open (persists for next file)
         OR if last tab → shows empty state
```

---

## Navigation Schema

| Method | Trigger | Scope | Speed |
|---|---|---|---|
| Tab click | Mouse click on tab | Between open files | <50ms |
| Tab shortcut | Cmd+1–9 | Jump to specific tab | <50ms |
| Tab cycle | Cmd+[  / Cmd+] | Previous/next tab | <50ms |
| Command palette | Cmd+K | App-wide: files, headings, recent | Instant |
| Sidebar tree | Cmd+B, then click | File system navigation | File-open time |
| In-file search | Cmd+F | Current document | Real-time |
| Cross-tab search | Cmd+Shift+F | All open tabs | <500ms |
| Jump to heading | Cmd+K → type heading text | Current document | Instant |
| Drag & drop | Drag .md / folder to window | Open files | File-open time |
| File association | Double-click .md in Finder | Open single file | App launch + render |

---

## Content Inventory per Screen

| Screen | Content elements | URD citation |
|---|---|---|
| **Tab bar** | File name, unsaved dot (●), live-watch lightning (⚡), close button (×) | URD-04 |
| **Reading view** | Rendered markdown content, zero decorative chrome | URD-08 |
| **Mermaid block** | Rendered diagram OR placeholder pulse OR error with highlighted source | URD-03 |
| **Live watch bar** | "⚡ Live — last updated Xs ago", [Pin scroll] toggle | URD-10 |
| **Edit mode toolbar** | Esc (return to reading), Cmd+S (save), word count | URD-09 |
| **Edit mode content** | Monospace source text, optional line numbers | URD-09 |
| **Sidebar** | Recent files list, folder tree (.md files only), search input | URD-07 |
| **Command palette** | Fuzzy-searchable: files, headings, recent, actions | URD-04, URD-05 |
| **Empty state** | Drop zone with drag target, Cmd+O hint text | URD-05 |
| **Settings** | Theme, font size, Mermaid toggle, line numbers — 4 controls total | URD-08 |

---

## Naming & Taxonomy

Derived from user language in WANs (WAN-036, 038, 039, 054, 037):

| User says | App label | ❌ NOT |
|---|---|---|
| "read", "view", "open" | "Open" | "Import", "Create note" |
| "streaming", "live", "updating" | "Live" | "Sync", "Real-time" |
| "search" | "Search" | "Query", "Find notes" |
| "edit", "fix" | "Edit" | "Write mode", "Compose" |
| "folder", "files" | "Folder", "Files" | "Vault", "Workspace", "Library" |
| "close" | "Close" | "Archive", "Done" |

**Principle:** Use the word the user already knows. Introduce zero proprietary vocabulary.
