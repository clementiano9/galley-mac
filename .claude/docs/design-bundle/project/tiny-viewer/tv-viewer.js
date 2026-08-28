/* ───────────────────────────────────────────────────────────
   tiny-viewer · window builder + interactions
   window.tvBuildApp(opts)        → inner HTML for the .tv root
   window.tvWire(root, opts)      → wire the interactive board
   window.tvAnimateLive(root)     → stream text on the watch board
   opts.screen ∈ reading | live | palette | search | empty
   ─────────────────────────────────────────────────────────── */
(function () {
  const R = window.tvRenderMarkdown;

  // ── icons ────────────────────────────────────────────────
  const I = {
    folder: '<svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3"><path d="M1.8 4.2c0-.6.4-1 1-1h3l1.4 1.4h6c.6 0 1 .4 1 1v6c0 .6-.4 1-1 1H2.8c-.6 0-1-.4-1-1V4.2Z"/></svg>',
    doc: '<svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3"><path d="M4 1.8h5l3 3v9.4c0 .3-.2.5-.5.5H4c-.3 0-.5-.2-.5-.5V2.3c0-.3.2-.5.5-.5Z"/><path d="M9 1.8v3.2h3"/></svg>',
    hash: '<svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"><path d="M6 2.5 4.5 13.5M11.5 2.5 10 13.5M3 5.5h11M2.5 10.5h11"/></svg>',
    clock: '<svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3"><circle cx="8" cy="8" r="6"/><path d="M8 4.6V8l2.4 1.6" stroke-linecap="round"/></svg>',
    search: '<svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3"><circle cx="7" cy="7" r="4.4"/><path d="m10.4 10.4 3 3" stroke-linecap="round"/></svg>',
    bolt: '<svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor"><path d="M9 1 3 9h3.5L7 15l6-8H9.5L9 1Z"/></svg>',
    pin: '<svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3"><path d="M8 1.8v5M8 9.2v5M3.4 6.5h9.2l-1.6 2.7H5L3.4 6.5Z"/></svg>',
    plus: '<svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"><path d="M8 3.5v9M3.5 8h9"/></svg>',
    close: '<svg width="11" height="11" viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"><path d="M3 3l6 6M9 3l-6 6"/></svg>',
    tray: '<svg width="44" height="44" viewBox="0 0 48 48" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"><path d="M24 6v22M16 20l8 8 8-8"/><path d="M8 30v8a4 4 0 004 4h24a4 4 0 004-4v-8"/></svg>',
    ret: '<svg width="12" height="12" viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3v3a2 2 0 01-2 2H3M5 6 2.5 8 5 10"/></svg>',
    updown: '<svg width="12" height="14" viewBox="0 0 12 16" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"><path d="M6 2v12M3 5l3-3 3 3M3 11l3 3 3-3"/></svg>',
  };

  // ── small builders ───────────────────────────────────────
  function titlebar(title) {
    return '<div class="tv-titlebar"><div class="tv-traffic">' +
      '<span class="tv-light c"></span><span class="tv-light m"></span><span class="tv-light x"></span></div>' +
      '<div class="tv-wintitle"><span class="tv-doc-ic">' + I.doc + '</span>' + title + '</div></div>';
  }

  function tab(t) {
    let lead = "";
    if (t.live) lead = '<span class="tv-bolt">' + I.bolt + "</span>";
    else if (t.unsaved) lead = '<span class="tv-dot"></span>';
    const close = '<span class="tv-close" data-act="close">' + I.close + "</span>";
    return '<div class="tv-tab' + (t.active ? " active" : "") + '" data-tab="' + t.name + '">' +
      lead + '<span class="name">' + (t.label || t.name) + "</span>" + close + "</div>";
  }

  function tabbar(tabs) {
    return '<div class="tv-tabbar">' + tabs.map(tab).join("") +
      '<div class="tv-newtab" data-act="newtab" title="New tab (\u2318T)">' + I.plus + "</div></div>";
  }

  function sidebar(active, collapsed) {
    const T = window.TV_TREE;
    const files = T.files.map(function (f) {
      const live = f === "api.md";
      return '<div class="tv-tree-row file' + (f === active ? " active" : "") + '" data-tab="' + f + '">' +
        '<span class="ic">' + I.doc + "</span><span>" + f + "</span>" +
        (live ? '<span class="mini-bolt">' + I.bolt + "</span>" : "") + "</div>";
    }).join("");
    const recent = T.recent.map(function (f) {
      return '<div class="tv-tree-row file"><span class="ic">' + I.doc + "</span><span>" + f + "</span></div>";
    }).join("");
    return '<aside class="tv-sidebar' + (collapsed ? " collapsed" : "") + '">' +
      '<div class="tv-side-scroll">' +
        '<div class="tv-tree-row folder"><span class="ic">' + I.folder + "</span><span>" + T.folder + "</span></div>" +
        files +
        '<div class="tv-side-divider"></div>' +
        '<div class="tv-side-label">Recent</div>' + recent +
      "</div>" +
      '<div class="tv-search"><div class="tv-search-box"><span class="ic">' + I.search + "</span>" +
        "<span>Search\u2026</span><span class=\"kbd\">\u2318F</span></div></div>" +
      "</aside>";
  }

  function docView(key) {
    return '<div class="tv-scroll"><div class="tv-content"><div class="md">' +
      R(window.TV_DOCS[key]) + "</div></div><div class=\"tv-scrollbar\"></div></div>";
  }

  // ── screens ──────────────────────────────────────────────
  function readingTabs(active) {
    return [
      { name: "arch.md", active: active === "arch.md" },
      { name: "api.md", live: true, active: active === "api.md" },
      { name: "schema.md", active: active === "schema.md" },
      { name: "flow.md", active: active === "flow.md" },
    ];
  }

  function screenReading(st) {
    st = st || { active: "schema.md", sidebar: true };
    return titlebar(st.active) + tabbar(readingTabs(st.active)) +
      '<div class="tv-body">' + sidebar(st.active, !st.sidebar) +
      '<div class="tv-viewer">' + docView(st.active) + "</div></div>";
  }

  function screenEdit(st) {
    const src = window.TV_DOCS[st.active];
    const lines = src.split("\n");
    const words = src.replace(/[#>*`|_-]/g, " ").split(/\s+/).filter(Boolean).length;
    const cursor = st.cursorLine != null ? st.cursorLine : 8;
    const rows = lines.map(function (ln, k) {
      const isCur = k === cursor;
      let html = esc(ln)
        .replace(/^(#{1,6}\s.*)$/, '<span class="s-h">$1</span>')
        .replace(/(`[^`]*`)/g, '<span class="s-code">$1</span>')
        .replace(/\|/g, '<span class="s-pipe">|</span>');
      if (isCur) {
        const cut = Math.min(html.length, 24);
        html = html + '<span class="tv-srccaret"></span>';
      }
      return '<div class="tv-srcline' + (isCur ? " cursor-line" : "") + '">' +
        '<span class="tv-gutter">' + (k + 1) + "</span>" +
        '<span class="tv-srctext">' + (html || " ") + "</span></div>";
    }).join("");
    const tabs = readingTabs(st.active).map(function (t) {
      if (t.active) { t.unsaved = true; t.live = false; t.label = t.name + "  \u2014 editing"; }
      return t;
    });
    return titlebar(st.active + " — editing") + tabbar(tabs) +
      '<div class="tv-edit-toolbar">' +
        '<span class="tv-edit-btn" data-act="esc"><span class="kbd">esc</span> Reading</span>' +
        '<span class="tv-edit-btn primary" data-act="save"><span class="kbd">\u2318S</span> Save</span>' +
        '<span class="tv-edit-meta">' + words + " words</span>" +
      "</div>" +
      '<div class="tv-body">' + sidebar(st.active, !st.sidebar) +
      '<div class="tv-viewer"><div class="tv-scroll"><div class="tv-content"><div class="tv-source">' +
      rows + "</div></div><div class=\"tv-scrollbar\"></div></div></div></div>";
  }

  function esc(s) { return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;"); }

  // live-watch (own trimmed doc so the streaming tail + status bar are visible)
  function screenLive() {
    const watch =
      "# AI Output: System Design\n\n" +
      "## Introduction\n\nThe proposed architecture separates concerns into three layers so each can scale, fail, and deploy independently.\n\n" +
      "## Layer 2: Processing\n\nEach event is enriched, deduplicated, and folded into the running aggregate. Processing is idempotent, so replays are safe.\n\n" +
      "## Layer 3: Storage\n";
    const tabs = [
      { name: "arch.md" },
      { name: "ai-output.md", live: true, active: true },
      { name: "flow.md" },
    ];
    return titlebar("ai-output.md") + tabbar(tabs) +
      '<div class="tv-body">' +
      '<div class="tv-viewer">' +
        '<div class="tv-scroll"><div class="tv-content"><div class="md">' + R(watch) +
          '<p class="tv-writing-line" data-stream>' +
          '<span class="streamed"></span><span class="tv-caret"></span></p>' +
        "</div></div><div class=\"tv-scrollbar\" style=\"top:auto;bottom:64px;height:90px\"></div></div>" +
        '<div class="tv-status">' +
          '<span class="live-pill"><span class="blip"></span> Live</span>' +
          '<span class="sep">\u2014</span><span data-elapsed>updated 0.3s ago</span>' +
          '<span class="spacer"></span>' +
          '<span class="tv-pin" data-act="pin"><span class="ic">' + I.pin + "</span> Pin scroll</span>" +
        "</div>" +
      "</div></div>";
  }

  function screenPalette(st) {
    const P = window.TV_PALETTE;
    let list = "";
    P.groups.forEach(function (g, gi) {
      if (gi) list += '<div class="tv-pal-divider"></div>';
      list += '<div class="tv-pal-group">' + g.label + "</div>";
      g.rows.forEach(function (r, ri) {
        const sel = gi === 0 && ri === 0;
        let main = r.main;
        if (r.hl) main = main.replace(new RegExp("(" + r.hl + ")", "i"), '<span class="hl">$1</span>');
        list += '<div class="tv-pal-row' + (sel ? " sel" : "") + '" data-pal-row="' + r.main + '">' +
          '<span class="ic">' + I[r.ic] + "</span><span>" + main + "</span>" +
          '<span class="sub">' + r.sub + "</span></div>";
      });
    });
    const base = screenReading(st || { active: "schema.md", sidebar: true });
    return '<div class="tv-dim-wrap" style="position:absolute;inset:0;display:flex;flex-direction:column">' + base + "</div>" +
      '<div class="tv-palette-scrim" data-act="palette-close"><div class="tv-palette" data-stop>' +
        '<div class="tv-pal-input"><span class="ic">' + I.search + "</span>" +
          '<span class="typed">' + P.query + '</span><span class="pal-caret"></span>' +
          '<span style="margin-left:auto;font-size:12px;color:var(--tv-text-muted)">Search files and headings</span></div>' +
        '<div class="tv-pal-list">' + list + "</div>" +
        '<div class="tv-pal-foot"><span class="k">' + I.updown + " navigate</span>" +
          '<span class="k">' + I.ret + " open</span>" +
          '<span class="k"><span class="tv-kbd">esc</span> close</span></div>' +
      "</div></div>";
  }

  function screenSearch(st) {
    const S = window.TV_SEARCH;
    st = st || { active: "schema.md", sidebar: true };
    let res = '<div class="tv-sr-count">' + S.count + " matches across " + S.fileCount + " files</div>";
    S.files.forEach(function (f) {
      res += '<div class="tv-sr-file"><div class="tv-sr-filehead"><span class="ic">' + I.doc + "</span>" +
        f.name + ' <span class="cnt">(' + f.hits.length + " matches)</span></div>";
      f.hits.forEach(function (h) {
        res += '<div class="tv-sr-row' + (h.sel ? " sel" : "") + '"><span class="ln">L' + h.ln + "</span>" +
          '<span class="snip">' + esc(h.pre) + "<mark>" + h.hit + "</mark>" + esc(h.post) + "</span></div>";
      });
      res += "</div>";
    });
    const bar = '<div class="tv-searchbar"><div class="field"><span class="ic">' + I.search + "</span>" +
      '<span>' + S.query + '</span><span class="pal-caret"></span></div>' +
      '<span class="scope">All open tabs \u00b7 \u2318\u21e7F</span></div>';
    return titlebar("Search \u00b7 all tabs") + tabbar(readingTabs(st.active)) +
      '<div class="tv-body">' + sidebar(st.active, !st.sidebar) +
      '<div class="tv-viewer">' + bar +
      '<div class="tv-scroll"><div class="tv-search-results">' + res + "</div></div></div></div>";
  }

  function screenEmpty() {
    return titlebar("tiny-viewer") +
      '<div class="tv-tabbar"><div class="tv-newtab" data-act="newtab">' + I.plus + "</div></div>" +
      '<div class="tv-body"><div class="tv-viewer"><div class="tv-empty"><div class="tv-dropzone">' +
        '<span class="dz-ic">' + I.tray + "</span>" +
        '<span class="dz-title">Drop .md files here</span>' +
        '<span class="dz-or">\u2014 or \u2014</span>' +
        '<span class="dz-cmd"><span class="kbd">\u2318O</span> to open files</span>' +
      "</div></div>" +
      '<div class="tv-empty-hint">No file open \u00b7 nothing is imported, nothing is synced</div>' +
      "</div></div>";
  }

  // ── public: build a screen ───────────────────────────────
  function build(opts) {
    opts = opts || {};
    switch (opts.screen) {
      case "live": return screenLive();
      case "palette": return screenPalette(opts.state);
      case "search": return screenSearch(opts.state);
      case "empty": return screenEmpty();
      case "edit": return screenEdit(opts.state || { active: "schema.md", sidebar: true });
      default: return screenReading(opts.state);
    }
  }

  // ── public: interactions for the hero board ──────────────
  function wire(root, opts) {
    const state = { active: "schema.md", sidebar: true, mode: "reading", palette: false, cursorLine: 8 };

    function paint() {
      if (state.palette) root.innerHTML = build({ screen: "palette", state: state });
      else if (state.mode === "edit") root.innerHTML = build({ screen: "edit", state: state });
      else root.innerHTML = build({ screen: "reading", state: state });
      if (window.tvResolveDiagrams) window.tvResolveDiagrams(root, state._fast ? 420 : 1100);
      state._fast = true;
    }
    paint();

    root.addEventListener("click", function (e) {
      const closeBtn = e.target.closest(".tv-close");
      if (closeBtn) { e.stopPropagation(); return; }
      const tabEl = e.target.closest("[data-tab]");
      if (tabEl) { state.active = tabEl.getAttribute("data-tab"); state.mode = "reading"; state.palette = false; paint(); return; }
      const act = e.target.closest("[data-act]");
      if (act) {
        const a = act.getAttribute("data-act");
        if (a === "newtab") { state.palette = true; paint(); }
        else if (a === "palette-close") { if (e.target.closest("[data-stop]")) return; state.palette = false; paint(); }
        else if (a === "esc" || a === "save") { state.mode = "reading"; paint(); }
        else if (a === "pin") { act.classList.toggle("on"); }
        return;
      }
      const palRow = e.target.closest("[data-pal-row]");
      if (palRow) {
        const name = palRow.getAttribute("data-pal-row");
        if (window.TV_DOCS[name]) state.active = name;
        else if (name.indexOf("Architecture") !== -1) state.active = "schema.md";
        state.palette = false; paint();
      }
    });

    // double-click rendered content → edit at that line
    root.addEventListener("dblclick", function (e) {
      if (state.mode !== "reading" || state.palette) return;
      const md = e.target.closest(".tv-content");
      if (!md) return;
      const head = e.target.closest("h1,h2,h3,p,td,th,li,code");
      let line = 8;
      if (head) {
        const txt = (head.textContent || "").trim().slice(0, 18).toLowerCase();
        const lines = window.TV_DOCS[state.active].split("\n");
        for (let k = 0; k < lines.length; k++) {
          if (lines[k].toLowerCase().replace(/[#>*`|_\-\s]/g, "").indexOf(txt.replace(/[\s]/g, "").slice(0, 8)) !== -1 && txt.length > 3) { line = k; break; }
        }
      }
      state.cursorLine = line; state.mode = "edit"; paint();
    });

    function isMeta(e) { return e.metaKey || e.ctrlKey; }
    const onKey = function (e) {
      // only when this board is the active interactive surface
      if (e.key === "Escape") {
        if (state.palette) { state.palette = false; paint(); }
        else if (state.mode === "edit") { state.mode = "reading"; paint(); }
        return;
      }
      if (!isMeta(e)) return;
      const k = e.key.toLowerCase();
      if (k === "b") { e.preventDefault(); state.sidebar = !state.sidebar; paint(); }
      else if (k === "k") { e.preventDefault(); state.palette = !state.palette; paint(); }
      else if (k === "e") { e.preventDefault(); state.mode = state.mode === "edit" ? "reading" : "edit"; paint(); }
      else if (k === "s" && state.mode === "edit") { e.preventDefault(); state.mode = "reading"; paint(); }
      else if (k >= "1" && k <= "4") {
        e.preventDefault();
        const f = ["arch.md", "api.md", "schema.md", "flow.md"][+k - 1];
        state.active = f; state.mode = "reading"; state.palette = false; paint();
      }
    };
    document.addEventListener("keydown", onKey);
    root.__tvCleanup = function () { document.removeEventListener("keydown", onKey); };
    return root.__tvCleanup;
  }

  // ── public: stream text on the watch board ───────────────
  function animateLive(root) {
    if (window.tvResolveDiagrams) window.tvResolveDiagrams(root, 800);
    const slot = root.querySelector("[data-stream] .streamed");
    const elapsed = root.querySelector("[data-elapsed]");
    if (!slot) return function () {};
    const words = (window.TV_STREAM || "").split(" ");
    let i = 0, t0 = Date.now();
    const tick = setInterval(function () {
      if (i < words.length) { slot.textContent += (i ? " " : "") + words[i]; i++; }
      else { slot.textContent = ""; i = 0; }
    }, 240);
    const et = setInterval(function () {
      if (elapsed) elapsed.textContent = "updated " + (0.1 + Math.random() * 0.5).toFixed(1) + "s ago";
    }, 900);
    return function () { clearInterval(tick); clearInterval(et); };
  }

  window.tvBuildApp = build;
  window.tvWire = wire;
  window.tvAnimateLive = animateLive;
})();
