/* ───────────────────────────────────────────────────────────
   tiny-viewer · markdown renderer
   Real block + inline parser → HTML string matching tv-app.css.
   Exposes: window.tvRenderMarkdown(src)  → html string
            window.tvResolveDiagrams(rootEl, [delay])  (placeholder→flow)
   Mermaid fences render an async "loading" placeholder that
   tvResolveDiagrams() swaps for a drawn flow (URD-03).
   ─────────────────────────────────────────────────────────── */
(function () {
  function esc(s) {
    return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  }

  // ── inline formatting ────────────────────────────────────
  function inline(s) {
    s = esc(s);
    const codes = [];
    s = s.replace(/`([^`]+)`/g, function (_, c) {
      codes.push(c); return "\u0000" + (codes.length - 1) + "\u0000";
    });
    s = s.replace(/!\[([^\]]*)\]\(([^)]+)\)/g, '<em>$1</em>'); // inline img → caption-ish
    s = s.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>');
    s = s.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
    s = s.replace(/__([^_]+)__/g, "<strong>$1</strong>");
    s = s.replace(/(^|[^\*])\*([^*\s][^*]*?)\*(?!\*)/g, "$1<em>$2</em>");
    s = s.replace(/(^|[^_])_([^_\s][^_]*?)_(?!_)/g, "$1<em>$2</em>");
    s = s.replace(/\u0000(\d+)\u0000/g, function (_, i) {
      return "<code>" + codes[+i] + "</code>";
    });
    return s;
  }

  // ── code highlighting (lightweight, language-agnostic) ───
  function highlight(code, lang) {
    let h = esc(code);
    const stash = [];
    const keep = function (cls, txt) { stash.push('<span class="' + cls + '">' + txt + "</span>"); return "\u0001" + (stash.length - 1) + "\u0001"; };
    // strings
    h = h.replace(/(&quot;[^&]*?&quot;|&#39;[^&]*?&#39;|'[^']*?'|"[^"]*?")/g, function (m) { return keep("c-str", m); });
    // line comments
    h = h.replace(/(#[^\n]*|\/\/[^\n]*)/g, function (m) { return keep("c-com", m); });
    // numbers
    h = h.replace(/\b(\d[\d_.]*[a-zA-Z%]*)\b/g, function (m) { return keep("c-num", m); });
    // keywords
    const kw = /\b(SELECT|FROM|WHERE|JOIN|LEFT|INNER|ON|GROUP|ORDER|BY|LIMIT|INDEX|CREATE|TABLE|PRIMARY|KEY|AND|OR|NOT|NULL|const|let|var|function|return|if|else|for|while|import|export|from|class|new|await|async|def|true|false|None|null)\b/g;
    h = h.replace(kw, function (m) { return keep("c-key", m); });
    h = h.replace(/\u0001(\d+)\u0001/g, function (_, i) { return stash[+i]; });
    return h;
  }

  function isTableSep(l) { return /^\s*\|?[\s:|-]+\|?\s*$/.test(l) && l.indexOf("-") !== -1 && l.indexOf("|") !== -1; }
  function splitRow(l) {
    l = l.trim().replace(/^\|/, "").replace(/\|$/, "");
    return l.split("|").map(function (c) { return c.trim(); });
  }

  // ── block parser ─────────────────────────────────────────
  function render(src) {
    const lines = src.replace(/\r\n/g, "\n").split("\n");
    let out = "", i = 0, dgN = 0;

    while (i < lines.length) {
      let l = lines[i];

      // blank
      if (/^\s*$/.test(l)) { i++; continue; }

      // fenced code / mermaid
      const fence = l.match(/^```(\w*)\s*$/);
      if (fence) {
        const lang = fence[1] || "";
        let body = [];
        i++;
        while (i < lines.length && !/^```\s*$/.test(lines[i])) { body.push(lines[i]); i++; }
        i++; // closing fence
        if (lang === "mermaid") {
          out += diagramPlaceholder(body.join("\n"), dgN++);
        } else {
          out += '<pre><code>' + highlight(body.join("\n"), lang) + "</code></pre>";
        }
        continue;
      }

      // heading
      const h = l.match(/^(#{1,6})\s+(.*)$/);
      if (h) {
        const lv = h[1].length;
        out += "<h" + lv + ">" + inline(h[2].trim()) + "</h" + lv + ">";
        i++; continue;
      }

      // hr
      if (/^\s*([-*_])\1\1+\s*$/.test(l)) { out += "<hr>"; i++; continue; }

      // standalone image
      const img = l.match(/^!\[([^\]]*)\]\(([^)]+)\)\s*$/);
      if (img) { out += mdImage(img[1], img[2]); i++; continue; }

      // blockquote
      if (/^\s*>\s?/.test(l)) {
        let buf = [];
        while (i < lines.length && /^\s*>\s?/.test(lines[i])) { buf.push(lines[i].replace(/^\s*>\s?/, "")); i++; }
        out += "<blockquote>" + paragraphs(buf.join("\n")) + "</blockquote>";
        continue;
      }

      // table
      if (l.indexOf("|") !== -1 && i + 1 < lines.length && isTableSep(lines[i + 1])) {
        const head = splitRow(l);
        const align = splitRow(lines[i + 1]).map(function (c) {
          if (/^:-+:$/.test(c)) return "center"; if (/-+:$/.test(c)) return "right"; return "left";
        });
        i += 2;
        let rows = [];
        while (i < lines.length && lines[i].indexOf("|") !== -1 && !/^\s*$/.test(lines[i])) { rows.push(splitRow(lines[i])); i++; }
        out += buildTable(head, rows, align);
        continue;
      }

      // task list
      if (/^\s*-\s+\[[ xX]\]\s+/.test(l)) {
        let items = [];
        while (i < lines.length && /^\s*-\s+\[[ xX]\]\s+/.test(lines[i])) {
          const m = lines[i].match(/^\s*-\s+\[([ xX])\]\s+(.*)$/);
          items.push('<li><span class="box ' + (m[1] === " " ? "" : "done") + '"></span><span>' + inline(m[2]) + "</span></li>");
          i++;
        }
        out += '<ul class="task">' + items.join("") + "</ul>";
        continue;
      }

      // unordered list
      if (/^\s*[-*+]\s+/.test(l)) {
        let items = [];
        while (i < lines.length && /^\s*[-*+]\s+/.test(lines[i])) { items.push("<li>" + inline(lines[i].replace(/^\s*[-*+]\s+/, "")) + "</li>"); i++; }
        out += "<ul>" + items.join("") + "</ul>";
        continue;
      }

      // ordered list
      if (/^\s*\d+\.\s+/.test(l)) {
        let items = [];
        while (i < lines.length && /^\s*\d+\.\s+/.test(lines[i])) { items.push("<li>" + inline(lines[i].replace(/^\s*\d+\.\s+/, "")) + "</li>"); i++; }
        out += "<ol>" + items.join("") + "</ol>";
        continue;
      }

      // paragraph
      let buf = [];
      while (i < lines.length && !/^\s*$/.test(lines[i]) &&
             !/^(#{1,6})\s/.test(lines[i]) && !/^```/.test(lines[i]) &&
             !/^\s*>/.test(lines[i]) && !/^\s*[-*+]\s/.test(lines[i]) &&
             !/^\s*\d+\.\s/.test(lines[i]) &&
             !(lines[i].indexOf("|") !== -1 && i + 1 < lines.length && isTableSep(lines[i + 1]))) {
        buf.push(lines[i]); i++;
      }
      out += "<p>" + inline(buf.join(" ")) + "</p>";
    }
    return out;
  }

  function paragraphs(text) {
    return text.split(/\n{2,}/).map(function (p) { return "<p>" + inline(p.replace(/\n/g, " ")) + "</p>"; }).join("");
  }

  function buildTable(head, rows, align) {
    let h = "<tr>" + head.map(function (c, k) { return '<th style="text-align:' + align[k] + '">' + inline(c) + "</th>"; }).join("") + "</tr>";
    let b = rows.map(function (r) {
      return "<tr>" + r.map(function (c, k) {
        const numeric = /^[\d.,]+[%KMBkmbx]*$/.test(c.trim());
        return '<td class="' + (numeric ? "num" : "") + '" style="text-align:' + (align[k] || "left") + '">' + inline(c) + "</td>";
      }).join("") + "</tr>";
    }).join("");
    return '<div class="tbl-wrap"><table><thead>' + h + "</thead><tbody>" + b + "</tbody></table></div>";
  }

  function mdImage(alt, path) {
    return '<figure class="md-img"><div class="frame">' +
      '<svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.4">' +
      '<rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="8.5" cy="9.5" r="1.6"/>' +
      '<path d="M21 16l-5-5L7 20"/></svg></div>' +
      '<figcaption class="cap">' + esc(alt || path) + "</figcaption></figure>";
  }

  // diagram parsed loosely to extract node labels for the rendered flow
  function diagramPlaceholder(body, n) {
    const nodes = [];
    const re = /\[([^\]]+)\]|\(([^)]+)\)|\{([^}]+)\}/g; let m;
    while ((m = re.exec(body))) { const t = (m[1] || m[2] || m[3] || "").trim(); if (t && nodes.indexOf(t) === -1) nodes.push(t); }
    const flow = encodeURIComponent(JSON.stringify(nodes.slice(0, 5)));
    return '<div class="tv-diagram" data-diagram="' + n + '" data-nodes="' + flow + '">' +
      '<span class="dg-label">Diagram</span>' +
      '<div class="dg-load"><div class="dg-shimmer"></div><span>Rendering diagram\u2026</span></div></div>';
  }

  // resolve placeholders → drawn flow
  function resolveDiagrams(root, delay) {
    const arrow = '<span class="dg-arrow"><svg width="30" height="14" viewBox="0 0 30 14" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"><path d="M2 7h24M22 3l5 4-5 4"/></svg></span>';
    const dgs = root.querySelectorAll('.tv-diagram[data-nodes]');
    dgs.forEach(function (dg) {
      const nodes = JSON.parse(decodeURIComponent(dg.getAttribute("data-nodes") || "[]"));
      const run = function () {
        if (!nodes.length) { dg.querySelector(".dg-load").innerHTML = '<span>No diagram nodes</span>'; return; }
        let html = '<div class="dg-flow">';
        nodes.forEach(function (nd, k) {
          const cls = k === nodes.length - 1 ? "dg-node accent" : "dg-node";
          html += '<span class="' + cls + '">' + nd + "</span>";
          if (k < nodes.length - 1) html += arrow;
        });
        html += "</div>";
        dg.querySelector(".dg-load").outerHTML = html;
      };
      setTimeout(run, delay == null ? 1200 : delay);
    });
  }

  window.tvRenderMarkdown = render;
  window.tvResolveDiagrams = resolveDiagrams;
})();
