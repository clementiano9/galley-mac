# Stream 5: Performance & RAM Benchmarks
*WANs 063–074 | Focus: Electron overhead, Tauri advantages, rendering performance*

---

[WAN-063] [Source: https://forum.obsidian.md/t/pc-memory-issues-with-obsidian/83978] [Work Role: Power user / knowledge worker]
Obsidian users on Mac report typical RAM consumption around 1 GB at idle, with occasional spikes to 2.5-3 GB during heavy plugin activity or indexing operations.

[WAN-064] [Source: https://forum.obsidian.md/t/basic-memory-management-to-avoid-oom-errors/102927] [Work Role: Developer / advanced Obsidian user]
Obsidian's Electron/V8 memory cage imposes a hard 4 GB per-process heap ceiling, meaning large vaults with aggressive plugins can hit out-of-memory errors before the OS would otherwise intervene.

[WAN-065] [Source: https://forum.obsidian.md/t/obsidian-build-without-v8-pointer-compression/101874] [Work Role: Developer / power user]
The 4 GB limit is a structural consequence of V8 pointer compression baked into Electron, not an Obsidian-specific bug, making it an architectural constraint for any Electron-based markdown tool that handles large datasets.

[WAN-066] [Source: https://raftlabs.medium.com/tauri-vs-electron-a-practical-guide-to-picking-the-right-framework-5df80e360f26] [Work Role: Desktop app developer]
Electron apps idle at 200-300 MB of RAM at baseline, while Tauri apps sit closer to 30-40 MB at idle, meaning Electron carries roughly a 6-8x memory overhead penalty before any application logic runs.

[WAN-067] [Source: https://www.reddit.com/r/programming/comments/1jwjw7b/tauri_vs_electron_benchmark_58_less_memory_96/] [Work Role: Desktop app developer / architect]
Benchmarks show Tauri consuming approximately 58% less memory and producing 96% smaller install bundles than equivalent Electron apps, with the gap attributable to Tauri reusing the OS-native WebView instead of bundling Chromium.

[WAN-068] [Source: https://www.xda-developers.com/sick-every-pc-program-electron-app/] [Work Role: Developer / tech journalist]
Electron apps keep multiple background processes alive, rely on JavaScript timers that never sleep, and use a full Chromium rendering engine even for static content, causing sustained CPU and RAM usage well above what a native UI toolkit would require.

[WAN-069] [Source: https://github.com/electron/electron/issues/48311] [Work Role: Developer / Mac power user]
On macOS with an M1 Max MacBook Pro, having two Electron apps open simultaneously (e.g., Discord and VS Code) causes system-wide 60fps scroll stuttering even when CPU and GPU usage remains low, pointing to compositor-level overhead from Electron's rendering pipeline.

[WAN-070] [Source: https://github.com/marktext/marktext/issues/3862] [Work Role: Developer / writer]
MarkText, an Electron-based markdown editor, has a cold-start time exceeding 12 seconds, compared to MacDown's 0.65-second launch, illustrating the startup latency cost Electron imposes on even moderately featured markdown tools.

[WAN-071] [Source: https://www.reddit.com/r/ObsidianMD/comments/1id0xnx/using_macos_ive_been_getting_high_startup_times/] [Work Role: Knowledge worker / student]
An Obsidian user on a recent M1 Mac reported 45-second startup times for a vault of just 201 files, with plugin initialization identified as the primary driver, indicating that plugin architecture compounds Electron's inherent startup cost.

[WAN-072] [Source: https://github.com/open-webui/open-webui/issues/4881] [Work Role: Developer / AI tooling user]
Rendering a Mermaid diagram inside a markdown stream provably throttles subsequent text output speed; disabling Mermaid rendering entirely restores normal output rate, confirming that diagram rendering is a blocking, CPU-heavy operation in markdown pipelines.

[WAN-073] [Source: https://github.com/mermaid-js/mermaid-live-editor/issues/891] [Work Role: Developer / technical writer]
In the Mermaid live editor, flowchart rendering latency becomes noticeable as diagram complexity increases even modestly, with users reporting visible keystroke lag during live-preview updates for medium-sized diagrams.

[WAN-074] [Source: https://gitlab.com/gitlab-org/gitlab/-/issues/336792] [Work Role: Developer / documentation engineer]
A 2.5 MB markdown file with approximately 11,000 lines caused painfully slow rendering in GitLab's Wiki, establishing that naive full-document markdown rendering breaks down well before files reach large-note territory for technical documentation users.
