# Stream 2: App Store Reviews — Bear, Obsidian, Typora, iA Writer, VSCode
*WANs 016–035 | Focus: real user pain points from reviews and forums*

---

[WAN-016] [Source: https://www.reddit.com/r/bearapp/comments/1heqvo2/new_to_bear_and_need_some_advice/] [Work Role: Technical writer / researcher]
A Bear user with hundreds of Markdown documents reports that inline images using standard `![alt](path)` syntax are completely invisible inside Bear, calling it a "deal breaker": "Inline image display — many of my documents include images and diagrams and these are marked up as standard markdown. I cannot see these inside Bear!!!"

[WAN-017] [Source: https://www.markdownguide.org/tools/bear/] [Work Role: Knowledge worker / note-taker]
Bear's Markdown compatibility has documented gaps: image syntax (`![alt](url)`) is listed as "No" support, and tables are also listed as "No," meaning users who rely on standard Markdown portability must abandon either Bear or their existing file format.

[WAN-018] [Source: https://community.bear.app/t/feedback-on-bear-notes-love-it-but-a-few-pain-points/14326] [Work Role: Personal knowledge management (PKM) user]
A Bear power user reports that there is no version or edit history for notes, meaning accidentally deleted content cannot be recovered: "Recently I accidentally deleted some content from a note, and there was no way to recover it. A version history feature would be invaluable for peace of mind."

[WAN-019] [Source: https://community.bear.app/t/feedback-on-bear-notes-love-it-but-a-few-pain-points/14326] [Work Role: Cross-platform professional]
Bear's Apple-only ecosystem forces Windows workarounds that break workflows: "Every time I am on my Windows PC and I want to save something to Bear I have to paste it on Google Keep and copy on Bear from my Mac or similar tricks."

[WAN-020] [Source: https://community.bear.app/t/markdown-hiding-syntax-highlighting-vs-rich-text/9919] [Work Role: Developer / Markdown power user]
Bear 2's decision to hide Markdown syntax while the cursor is away frustrates users who want to see raw markup: "I like Markdown. I want to see the Markdown. Let me see it! Hiding the markdown markup while writing without an option to force its display is a problem."

[WAN-021] [Source: https://community.bear.app/t/bear-app-mac-os-error-when-try-to-print-a-note/18556] [Work Role: Writer / heavy note-taker]
A Bear forum thread reveals a recurring performance regression: "Typing becomes slow and laggy in large notes when open side by side" — a bug that accrued 10 replies and 426 views before a fix was shipped, suggesting it affected many users.

[WAN-022] [Source: https://medium.com/@theo-james/10-problems-with-obsidian-youll-realize-when-it-s-too-late-17e903886847] [Work Role: Researcher / PKM user]
Obsidian's performance degrades significantly as vault size grows: "Large vaults filled with hundreds or thousands of notes, attachments, and backlinks will eventually slow Obsidian down. Opening a file might take longer, searching through your notes can turn into a frustrating waiting game."

[WAN-023] [Source: https://forum.obsidian.md/t/obsidian-has-become-very-slow-lags-constantly/84634] [Work Role: Knowledge worker on Mac]
An Obsidian user on an M1 MacBook Pro with 16 GB RAM reports the app hangs for several seconds on every interaction — clicking a tab, scrolling, even opening the File menu: "Every time I click anything... it hangs for several seconds with the spinning rainbow ball."

[WAN-024] [Source: https://forum.obsidian.md/t/my-obsidian-is-slowing-down-to-the-point-of-being-completely-unusable-macos/69877] [Work Role: Mac power user]
Obsidian progressively deteriorates during long sessions and cannot shut down cleanly: "If Obsidian is open for several hours, it starts to run incredibly slow: response times range from a few seconds to infinity. I often can't even get the application to shut down properly."

[WAN-025] [Source: https://www.reddit.com/r/ObsidianMD/comments/1j1zi8t/why_does_obsidian_consume_so_much_ram_on_linux/] [Work Role: Developer / power user]
Obsidian's Electron foundation causes bloated RAM consumption — up to 3 GB on Linux vs. 500 MB on Windows — alarming users who need to run memory-intensive applications alongside their notes: "I noticed a spike in RAM usage... Obsidian uses nearly 3 GB of RAM."

[WAN-026] [Source: https://github.com/typora/typora-issues/issues/1861] [Work Role: Technical writer / developer]
Typora's WYSIWYG mode introduces noticeable typing lag as the app has grown in features: "Typora now very frequently lags when I type. I have to stop typing so it can catch up. Sometimes I can actually watch individual characters appear one by one."

[WAN-027] [Source: https://www.reddit.com/r/Typora/comments/rs7l2q/review_typora_a_markdown_writers_soul_mate/] [Work Role: Writer working with large documents]
Switching between Typora's WYSIWYG and source-code modes takes 2–3 seconds and editing in WYSIWYG on large files is half-a-second to a second behind keystrokes: "Switching between the two is horrendous — maybe a 2-3 second pause."

[WAN-028] [Source: https://www.reddit.com/r/Typora/comments/rs7l2q/review_typora_a_markdown_writers_soul_mate/] [Work Role: Multi-device professional]
Typora's three-device license cap frustrates users who work across more machines: "My one small gripe about Typora is that the license limits me to three devices. I work on five different computers fairly regularly. I never use it on more than one device at a time, so this restriction is kind of a bummer."

[WAN-029] [Source: https://www.reddit.com/r/iawriter/comments/10hjasg/ia_writer_a_heartfelt_critique/] [Work Role: Long-form writer / author]
iA Writer still lacks a navigable outline view or the ability to fold sections by headings, making it unwieldy for long manuscripts: "The Mac and iOS versions still lack a navigable outline view or the ability to fold sections by headings — either of which would make it far easier to work with longer manuscripts."

[WAN-030] [Source: https://elephas.app/blog/iawriter-review] [Work Role: Author / book writer]
iA Writer's document organization cannot handle multi-chapter projects without manual workarounds: "The biggest issue relates to its document library. While it's easy to find short-form writing, managing chapters becomes cumbersome if you're writing anything long-form like a book."

[WAN-031] [Source: https://elephas.app/blog/iawriter-review] [Work Role: Cross-platform writer]
iA Writer requires a separate purchase for each platform (Mac, iOS, Windows) with no universal license, which frustrates users who write across devices: "Separate purchase required for each platform instead of a universal license across all devices."

[WAN-032] [Source: https://elephas.app/blog/iawriter-review] [Work Role: Technical writer]
iA Writer lacks a split-screen showing Markdown source alongside the rendered preview, creating friction for users who want to verify formatting: "The lack of a split screen to view Markdown code and final result side-by-side is limiting."

[WAN-033] [Source: https://www.reddit.com/r/vscode/comments/11k3i4h/various_markdown_preview_problems/] [Work Role: Developer / documentation author]
VS Code's Markdown preview and editor panes fall out of sync when switching between files, causing the editor to jump to an unexpected position: "When previewing multiple files, when I tab back to a file, I arrive at a random position in the editor rather than where I left off."

[WAN-034] [Source: https://stackoverflow.com/questions/61831197/vscode-jumpiness-when-editing-markdown-and-preview-pane-is-open] [Work Role: Developer / technical writer]
VS Code's synchronized scroll between the Markdown editor and preview pane causes the text cursor to jump off-screen unpredictably, especially when notes contain images or rendered diagrams: "The text window jumps with the cursor location moving up the window to the point of disappearing at the top."

[WAN-035] [Source: https://apps.apple.com/us/app/1494902837?see-all=reviews] [Work Role: General user / reader]
A Mac App Store Markdown viewer app silently saves files on read and corrupts edits due to cursor-jump bugs: "When editing, often the cursor jumps to the end of the file... this app seems to cache old versions and ALWAYS saves after touching a file — that's catastrophic at times."
