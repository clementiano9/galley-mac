/* ───────────────────────────────────────────────────────────
   tiny-viewer · markdown SOURCE highlighter (edit mode)
   window.tvHighlightSource(src) → array of per-line HTML
   window.tvBuildEditMock(variant) → full edit-mode window HTML
   Variant look is pure CSS: scope with .srchl-ink / -semantic / -typo
   (see tv-srchl.css). Spans carry semantic classes only.
   ─────────────────────────────────────────────────────────── */
(function () {
  function esc(s) {
    return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  }
  const M = (t) => '<span class="sm-marker">' + t + "</span>";

  /* inline: code` protected first, then images/links, bold, em */
  function inline(s) {
    s = esc(s);
    const codes = [];
    s = s.replace(/`([^`]+)`/g, function (_, c) {
      codes.push(c); return "\u0000" + (codes.length - 1) + "\u0000";
    });
    s = s.replace(/(!?)\[([^\]]*)\]\(([^)]+)\)/g, function (_, bang, txt, url) {
      return M(bang + "[") + '<span class="sm-link">' + txt + "</span>" + M("](") +
             '<span class="sm-url">' + url + "</span>" + M(")");
    });
    s = s.replace(/\*\*([^*]+)\*\*/g, M("**") + '<span class="sm-bold">$1</span>' + M("**"));
    s = s.replace(/(^|[^\*])\*([^*\s][^*]*?)\*(?!\*)/g, "$1" + M("*") + '<span class="sm-em">$2</span>' + M("*"));
    s = s.replace(/\u0000(\d+)\u0000/g, function (_, i) {
      return '<span class="sm-code">' + M("`") + codes[+i] + M("`") + "</span>";
    });
    return s;
  }

  /* tiny token pass for fenced-code interiors */
  function codeTokens(line) {
    let h = esc(line);
    const stash = [];
    // digit-free placeholder (A–J encode 0–9) so later numeric/keyword
    // rules can never re-match inside a stashed region
    const encId = (n) => String(n).replace(/\d/g, (d) => String.fromCharCode(65 + +d));
    const decId = (s) => +s.split("").map((c) => c.charCodeAt(0) - 65).join("");
    const keep = (cls, txt) => { stash.push('<span class="' + cls + '">' + txt + "</span>"); return "\u0001" + encId(stash.length - 1) + "\u0001"; };
    h = h.replace(/(&#39;[^&]*?&#39;|'[^']*?'|"[^"]*?")/g, (m) => keep("sm-str", m));
    h = h.replace(/(--[^\n]*|\/\/[^\n]*|#[^\n]*)/g, (m) => keep("sm-com", m));
    h = h.replace(/\b(\d[\d_.]*)\b/g, (m) => keep("sm-num", m));
    h = h.replace(/\b(SELECT|FROM|WHERE|JOIN|ON|GROUP|ORDER|BY|LIMIT|AND|OR|NOT|NULL|const|let|var|function|return|if|else|import|from|true|false)\b/g, (m) => keep("sm-key", m));
    h = h.replace(/\u0001([A-J]+)\u0001/g, (_, i) => stash[decId(i)]);
    return h;
  }

  function isTableSep(l) {
    return /^\s*\|?[\s:|-]+\|?\s*$/.test(l) && l.indexOf("-") !== -1 && l.indexOf("|") !== -1;
  }

  function highlightSource(src) {
    const lines = (src || "").replace(/\r\n/g, "\n").split("\n");
    let inFence = false;
    return lines.map(function (l) {
      // fence open/close
      if (/^```/.test(l)) { inFence = !inFence; return '<span class="sm-fence">' + esc(l) + "</span>"; }
      if (inFence) return '<span class="sm-codeline">' + codeTokens(l) + "</span>";
      // hr
      if (/^\s*([-*_])\1\1+\s*$/.test(l)) return M(esc(l));
      // heading
      const h = l.match(/^(#{1,6})(\s+)(.*)$/);
      if (h) {
        const lv = h[1].length;
        return '<span class="sm-marker sm-hmark">' + h[1] + h[2] + "</span>" +
               '<span class="sm-h sm-h' + lv + '">' + inline(h[3]) + "</span>";
      }
      // blockquote
      const q = l.match(/^(\s*>\s?)(.*)$/);
      if (q) return M(esc(q[1])) + '<span class="sm-quote">' + inline(q[2]) + "</span>";
      // task list
      const t = l.match(/^(\s*-\s+)\[( |x|X)\](\s*)(.*)$/);
      if (t) {
        const done = t[2] !== " ";
        return M(esc(t[1])) + '<span class="' + (done ? "sm-task-done" : "sm-task") + '">[' + t[2] + "]</span>" +
               esc(t[3]) + (done ? '<span class="sm-task-done-text">' + inline(t[4]) + "</span>" : inline(t[4]));
      }
      // list
      const li = l.match(/^(\s*(?:[-*+]|\d+\.)\s+)(.*)$/);
      if (li) return M(esc(li[1])) + inline(li[2]);
      // table rows (incl. separator)
      if (l.indexOf("|") !== -1 && /^\s*\|/.test(l)) {
        if (isTableSep(l)) return M(esc(l));
        return inline(l).replace(/\|/g, '<span class="sm-pipe">|</span>');
      }
      // paragraph
      return inline(l);
    });
  }

  /* ── static edit-mode window mock (for the design canvas) ── */
  const SAMPLE = [
    "# Database Schema",
    "",
    "## Overview",
    "",
    "The system uses a **PostgreSQL** primary with *aggressive* caching and `READ COMMITTED` isolation. Details live in the [runbook](https://internal/runbook).",
    "",
    "> Writes invalidate affected cache keys on commit.",
    "",
    "- [x] Partition events by month",
    "- [ ] Composite index on (user_id, created_at)",
    "",
    "| Table | Rows | Index |",
    "|-------|------|-------|",
    "| users | 1.2M | email |",
    "",
    "```sql",
    "SELECT id, email FROM users",
    "WHERE created_at > '2026-01-01'",
    "LIMIT 50;  -- hot path",
    "```",
    "",
    "---",
    "",
    "![architecture](assets/arch.png)",
  ].join("\n");

  function buildEditMock(variant, opts) {
    opts = opts || {};
    const src = opts.src || SAMPLE;
    const lines = src.replace(/\r\n/g, "\n").split("\n");
    let cursorLine = 9;
    if (typeof opts.cursor === "number") cursorLine = opts.cursor;
    else if (typeof opts.cursor === "string") {
      const i = lines.findIndex(function (l) { return l.indexOf(opts.cursor) !== -1; });
      if (i !== -1) cursorLine = i;
    }
    const words = src.replace(/[#>*`|_\-\[\]()]/g, " ").split(/\s+/).filter(Boolean).length;
    const rows = highlightSource(src).map(function (html, k) {
      const cur = k === cursorLine;
      return '<div class="tv-srcline' + (cur ? " cursor-line" : "") + '">' +
        '<span class="tv-gutter">' + (k + 1) + "</span>" +
        '<span class="tv-srctext srchl-text">' + (html || " ") + (cur ? '<span class="tv-srccaret"></span>' : "") + "</span></div>";
    }).join("");
    const doc = '<svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3"><path d="M4 1.8h5l3 3v9.4c0 .3-.2.5-.5.5H4c-.3 0-.5-.2-.5-.5V2.3c0-.3.2-.5.5-.5Z"/><path d="M9 1.8v3.2h3"/></svg>';
    var panelLeft = '<svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3"><rect x="2" y="3" width="12" height="10" rx="1.6"/><path d="M6 3v10"/><path d="M3.6 5.6h1.1M3.6 7.4h1.1" stroke-linecap="round"/></svg>';
    // UX-SBR: edit mode has no sidebar — neutral toggle keeps re-entry visible (never a dead-end)
    var sbToggle = '<button type="button" class="tv-sidebar-toggle" data-act="sidebar" aria-pressed="false" title="Show sidebar (⌘B)" aria-label="Show sidebar (⌘B)">' + panelLeft + "</button>";
    const bolt = '<svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor"><path d="M9 1 3 9h3.5L7 15l6-8H9.5L9 1Z"/></svg>';
    const tabs = (opts.tabs || [
      { name: "arch.md" },
      { name: "schema.md", active: true },
      { name: "flow.md" },
    ]).map(function (t) {
      const lead = t.active ? '<span class="tv-dot"></span>' : (t.live ? '<span class="tv-bolt">' + bolt + "</span>" : "");
      const label = t.active ? t.name + "  —  editing" : t.name;
      return '<div class="tv-tab' + (t.active ? " active" : "") + '">' + lead + '<span class="name">' + label + "</span></div>";
    }).join("");
    return (
      '<div class="tv-titlebar"><div class="tv-traffic">' +
        '<span class="tv-light c"></span><span class="tv-light m"></span><span class="tv-light x"></span></div>' +
        '<div class="tv-wintitle"><span class="tv-doc-ic">' + doc + "</span>schema.md — editing</div></div>" +
      '<div class="tv-tabbar">' + sbToggle + tabs + "</div>" +
      '<div class="tv-edit-toolbar">' +
        '<span class="tv-edit-btn"><span class="kbd">esc</span> Reading</span>' +
        '<span class="tv-edit-btn primary"><span class="kbd">⌘S</span> Save</span>' +
        '<span class="tv-edit-meta">' + words + ' words</span>' +
      "</div>" +
      '<div class="tv-body"><div class="tv-viewer"><div class="tv-scroll"><div class="tv-content">' +
        '<div class="tv-source srchl srchl-' + variant + '">' + rows + "</div>" +
      '</div><div class="tv-scrollbar"></div></div></div></div>'
    );
  }

  window.tvHighlightSource = highlightSource;
  window.tvBuildEditMock = buildEditMock;
})();
