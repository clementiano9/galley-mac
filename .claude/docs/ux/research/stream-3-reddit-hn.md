# Stream 3: Reddit / Hacker News Pain Points
*WANs 036–050 | Focus: real user discussions about markdown workflow friction*

---

[WAN-036] [Source: https://www.reddit.com/r/microsaas/comments/1r60dmk/i_built_a_small_app_to_read_aigenerated_markdown/] [Work Role: Developer / AI-heavy workflow user]
VS Code's markdown preview pane fights for screen space and splits the UI awkwardly, while most markdown apps are full editors with far more interface than is needed just to read a file. Users who constantly receive AI-generated .md outputs want a dedicated read-only viewer that gets out of the way.

[WAN-037] [Source: https://www.reddit.com/r/microsaas/comments/1r60dmk/i_built_a_small_app_to_read_aigenerated_markdown/] [Work Role: Developer / AI-heavy workflow user]
Nothing in the standard toolchain updated the rendered view live while an AI tool was actively streaming output to a markdown file on disk. The missing real-time file-watch rendering forced users to keep manually refreshing or switching contexts mid-task.

[WAN-038] [Source: https://www.reddit.com/r/macapps/comments/1qki0f5/viewmd_a_viewonly_markdown_reader_i_built_for/] [Work Role: Developer / knowledge worker]
Opening markdown files in full editors like VS Code or Obsidian just to read AI-generated docs or READMEs feels like overkill; the overhead of a complete editing environment creates unnecessary friction for a pure read task. Users explicitly want a lightweight native viewer that renders the file beautifully and then disappears.

[WAN-039] [Source: https://www.reddit.com/r/ChatGPTCoding/comments/1p2rkyg/free_markdown_editor_that_makes_reading_and/] [Work Role: Developer / AI tools user]
When an AI returns a 500-line response with headers, lists, code blocks, and tables, hunting through the raw markdown source to fix a single typo or adjust formatting is painful and disorienting. Users need bidirectional editing so they can click directly in the rendered preview and have the source update automatically.

[WAN-040] [Source: https://www.reddit.com/r/MacOS/comments/1r79mho/finder_preview_pane_sidebar_wont_render/] [Work Role: Mac power user / developer]
macOS hard-locks .md files into a "Text" category in the Finder sidebar, blocking Quick Look extensions like QLMarkdown and Peek from rendering markdown content there even when they work perfectly in the spacebar Quick Look popup. Users who want rendered markdown in the sidebar without changing their default editor have no reliable native path to achieve it.

[WAN-041] [Source: https://www.reddit.com/r/ObsidianMD/comments/1qw5tmk/obsidian_using_10gb_on_mac/] [Work Role: Knowledge worker / researcher]
Obsidian can consume over 10 GB of RAM on Mac with only a handful of plugins and several tabs open, which is wildly disproportionate for a note-reading application. Users routinely ask whether they need to buy more hardware just to keep a markdown workspace functional.

[WAN-042] [Source: https://www.reddit.com/r/ObsidianMD/comments/1mfs232/too_much_resource_and_0_activity_on_it/] [Work Role: Knowledge worker]
Obsidian uses nearly 4 GB of RAM at idle on an M1 MacBook Air, which users describe as "prohibitive and defeating the purpose of the program." The Electron-based architecture means the memory cost is present even when the user is doing nothing, conflicting with the promise of a lightweight plain-text tool.

[WAN-043] [Source: https://forum.obsidian.md/t/performance-slow-startup-workspace-question/111801] [Work Role: Content creator / researcher]
Obsidian's startup time grows significantly with the number of open tabs and vault size, to the point where one user with 22 tabs considered buying a new MacBook before realizing tab accumulation was the root cause. Switching between many open notes compounds the problem because each reactivated tab triggers a re-render.

[WAN-044] [Source: https://www.reddit.com/r/ObsidianMD/comments/1jwchcg/whats_your_biggest_frustration_with_obsidian/] [Work Role: Knowledge worker / researcher]
Obsidian has three separate search interfaces — command palette, quick switcher, and global search — that feel redundant and disjointed; users want a single unified search that covers everything at once. The fragmented navigation model slows down the core task of quickly switching to the right file.

[WAN-045] [Source: https://www.reddit.com/r/bearapp/comments/1qtf1ow/ive_spent_more_time_migrating_between_bear_and/] [Work Role: Writer / knowledge worker]
Users report spending more hours migrating between Bear and Obsidian and tweaking themes or plugins than actually writing notes, caught in a loop driven by distrust of whichever system's organizational structure they currently inhabit. The cognitive overhead of "building the machine" consistently displaces the actual work the machine is meant to support.

[WAN-046] [Source: https://www.reddit.com/r/bearapp/comments/1qe8eih/switched_from_bear_to_obsidian_last_week_have_not/] [Work Role: Student / knowledge worker]
After switching to Obsidian, a user spent two full weeks only on customization and realized they had stopped taking any actual notes, ultimately returning to Bear for its simplicity. The richness of Obsidian's configuration surface becomes a productivity trap, especially for users whose note types do not require that power.

[WAN-047] [Source: https://www.reddit.com/r/ObsidianMD/comments/1rqthe1/why_is_markdown_to_pdf_so_broken_diagrams_gone/] [Work Role: Developer / researcher / heavy Mermaid user]
Exporting Obsidian notes to PDF silently drops Mermaid flowcharts and Gantt charts to raw fenced code blocks, strips math equations back to LaTeX syntax, and removes code syntax colors. Users who rely on diagrams for design documentation or research notes have no native, reliable export path that preserves all rendered elements.

[WAN-048] [Source: https://www.reddit.com/r/ObsidianMD/comments/1idg29a/cannot_get_obsidian_to_render_mermaid_graphs/] [Work Role: Developer / engineer]
Obsidian's native Mermaid rendering silently fails on macOS with no visible error, showing only a blank block where the diagram should appear; the only resolution in one reported case was a full machine restart with no apparent cause. The unpredictability of diagram rendering erodes confidence in using Mermaid as a reliable documentation format within the app.

[WAN-049] [Source: https://forum.cursor.com/t/critical-performance-degradation-and-ux-regression-in-markdown-preview/150894] [Work Role: Developer]
In Cursor IDE on macOS, opening or switching to any markdown file forces a preview mode and can freeze the editor completely when rendering files of 135 KB or more, making the tool temporarily unusable. Users filing multiple related bug reports indicate that markdown preview performance has become a recurring, unresolved regression rather than an isolated incident.

[WAN-050] [Source: https://www.reddit.com/r/vscode/comments/11k3i4h/various_markdown_preview_problems/] [Work Role: Developer / technical writer]
In VS Code, tabbing back to a previously viewed markdown file lands the editor at a random scroll position rather than where the user left off, because the preview panel's positional sync misidentifies its own location. Users who rely on markdown preview continuously for their work find the jump-around behavior breaks reading flow every time they switch files.
