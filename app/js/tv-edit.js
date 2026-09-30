/* ───────────────────────────────────────────────────────────
   Galley · edit mode
   Exposes: window.TVEdit
     .wordCount(src)             → number
     .renderSource(tab)          → htmlString (content body for edit mode)
     .wire(rootEl, tab)          → cleanup fn
     .applySave(tab)             → void  — delegates to TVFiles.writeFile(tab) [E-05]
     .highlightSource(src)       → htmlString  — syntax-highlighted mirror HTML
   ─────────────────────────────────────────────────────────── */
(function () {

  // ── highlightSource ──────────────────────────────────────
  // Converts raw markdown source into a syntax-highlighted HTML string
  // for the read-only mirror div that sits behind the transparent textarea.
  //
  // ARCHITECTURE NOTE — why textarea + mirror, not contenteditable:
  //   The editor is a plain <textarea>. We add a same-font, same-size mirror
  //   <div class="tv-edit-mirror"> that is absolutely positioned behind the
  //   textarea (which is made transparent). The textarea handles all editing;
  //   the mirror is purely decorative.
  //
  // METRIC SAFETY — why no font-size changes for headings:
  //   Changing font-size in the mirror would cause line-height desync between
  //   the textarea caret and the mirror text, making the caret appear in the
  //   wrong position visually. We restrict heading cues to font-weight and
  //   color only — these are metric-safe in a monospace font because the
  //   monospace font family guarantees identical advance widths across
  //   regular/bold/italic variants (SF Mono, JetBrains Mono, etc. all ship
  //   matched-metrics bold/italic variants). If a glyph is subtly wider in bold
  //   the mirror is decorative only — the textarea caret is still authoritative.
  //   Result: H1 gets weight:700 + accent color, H2/H3 weight:700 + secondary
  //   color — clearly distinguished without any layout desync risk.
  //
  // INLINE SPANS — escaping:
  //   All text nodes are HTML-escaped before wrapping in <span> tags so that
  //   literal <, >, & characters in source don't break the mirror DOM.
  //
  // PERFORMANCE:
  //   Called from a debounced path (~80ms). Processes lines sequentially.
  //   Inline regex is linear in line length. No DOM writes here — pure string.

  function _escHtml(str) {
    return str
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
  }

  // Marker span helper (dimmed syntax punctuation: #, **, *, `, [, ], (, ), |, >…)
  function _M(t) { return '<span class="sm-marker">' + t + '</span>'; }

  // Inline markdown → sm-* span HTML (design "srchl" highlighter, ported).
  // Order matters: code is stashed first so later rules can't match inside it,
  // then images/links, bold, em, and finally code is restored as sm-code chips.
  // Input is HTML-escaped up front, so all captured fragments are already safe.
  function _inlineHL(s) {
    s = _escHtml(s);
    var codes = [];
    s = s.replace(/`([^`]+)`/g, function (_, c) {
      codes.push(c); return '\u0000' + (codes.length - 1) + '\u0000';
    });
    s = s.replace(/(!?)\[([^\]]*)\]\(([^)]+)\)/g, function (_, bang, txt, url) {
      return _M(bang + '[') + '<span class="sm-link">' + txt + '</span>' + _M('](') +
             '<span class="sm-url">' + url + '</span>' + _M(')');
    });
    s = s.replace(/\*\*([^*]+)\*\*/g, _M('**') + '<span class="sm-bold">$1</span>' + _M('**'));
    s = s.replace(/(^|[^\*])\*([^*\s][^*]*?)\*(?!\*)/g, '$1' + _M('*') + '<span class="sm-em">$2</span>' + _M('*'));
    // ~~strikethrough~~ — captured after italic so the '*' rules can't interfere,
    // before code restoration so the digit placeholders stay intact.
    s = s.replace(/~~([^~]+)~~/g, _M('~~') + '<span class="sm-strike">$1</span>' + _M('~~'));
    s = s.replace(/\u0000(\d+)\u0000/g, function (_, i) {
      return '<span class="sm-code">' + _M('`') + codes[+i] + _M('`') + '</span>';
    });
    return s;
  }

  // Lightweight token pass for fenced-code interiors (strings, comments,
  // numbers, common keywords). Uses digit-free placeholders so a later rule
  // can never re-match inside an already-tokenised region.
  function _codeTokens(line) {
    var h = _escHtml(line);
    var stash = [];
    var encId = function (n) { return String(n).replace(/\d/g, function (d) { return String.fromCharCode(65 + +d); }); };
    var decId = function (s) { return +s.split('').map(function (c) { return c.charCodeAt(0) - 65; }).join(''); };
    var keep = function (cls, txt) { stash.push('<span class="' + cls + '">' + txt + '</span>'); return '\u0001' + encId(stash.length - 1) + '\u0001'; };
    h = h.replace(/(&#39;[^&]*?&#39;|'[^']*?'|"[^"]*?")/g, function (m) { return keep('sm-str', m); });
    h = h.replace(/(--[^\n]*|\/\/[^\n]*|#[^\n]*)/g, function (m) { return keep('sm-com', m); });
    h = h.replace(/\b(\d[\d_.]*)\b/g, function (m) { return keep('sm-num', m); });
    h = h.replace(/\b(SELECT|FROM|WHERE|JOIN|ON|GROUP|ORDER|BY|LIMIT|AND|OR|NOT|NULL|const|let|var|function|return|if|else|import|from|true|false)\b/g, function (m) { return keep('sm-key', m); });
    h = h.replace(/\u0001([A-J]+)\u0001/g, function (_, i) { return stash[decId(i)]; });
    return h;
  }

  function _isTableSep(l) {
    return /^\s*\|?[\s:|-]+\|?\s*$/.test(l) && l.indexOf('-') !== -1 && l.indexOf('|') !== -1;
  }

  // Highlight a full source string, returning HTML.
  // Line-based: one pass, lightweight.
  function highlightSource(src) {
    var lines = (src || '').replace(/\r\n/g, '\n').split('\n');
    var inFence = false;
    var out = lines.map(function (l) {
      // fence open/close (``` or ~~~) — the whole line reads as a dim marker
      if (/^(?:```|~~~)/.test(l)) { inFence = !inFence; return '<span class="sm-fence">' + _escHtml(l) + '</span>'; }
      if (inFence) return '<span class="sm-codeline">' + _codeTokens(l) + '</span>';
      // horizontal rule
      if (/^\s*([-*_])\1\1+\s*$/.test(l)) return _M(_escHtml(l));
      // ATX heading — # mark dimmed/tinted, heading text stays ink (inkcolor)
      var h = l.match(/^(#{1,6})(\s+)(.*)$/);
      if (h) {
        var lv = h[1].length;
        return '<span class="sm-marker sm-hmark">' + h[1] + h[2] + '</span>' +
               '<span class="sm-h sm-h' + lv + '">' + _inlineHL(h[3]) + '</span>';
      }
      // blockquote
      var q = l.match(/^(\s*>\s?)(.*)$/);
      if (q) return _M(_escHtml(q[1])) + '<span class="sm-quote">' + _inlineHL(q[2]) + '</span>';
      // task list item ([ ] / [x])
      var t = l.match(/^(\s*-\s+)\[( |x|X)\](\s*)(.*)$/);
      if (t) {
        var done = t[2] !== ' ';
        return _M(_escHtml(t[1])) + '<span class="' + (done ? 'sm-task-done' : 'sm-task') + '">[' + t[2] + ']</span>' +
               _escHtml(t[3]) + (done ? '<span class="sm-task-done-text">' + _inlineHL(t[4]) + '</span>' : _inlineHL(t[4]));
      }
      // list item
      var li = l.match(/^(\s*(?:[-*+]|\d+\.)\s+)(.*)$/);
      if (li) return _M(_escHtml(li[1])) + _inlineHL(li[2]);
      // table rows (incl. separator)
      if (l.indexOf('|') !== -1 && /^\s*\|/.test(l)) {
        if (_isTableSep(l)) return _M(_escHtml(l));
        return _inlineHL(l).replace(/\|/g, '<span class="sm-pipe">|</span>');
      }
      // paragraph
      return _inlineHL(l);
    });
    // join with newlines preserved (the mirror uses white-space:pre-wrap)
    return out.join('\n');
  }

  // ── wordCount ─────────────────────────────────────────────
  // UX-27: Strip non-human-readable content before counting:
  //   1. YAML front-matter block (---…---) at document start
  //   2. URLs (http/https)
  //   3. HTML tags
  //   4. Markdown punctuation characters
  // Approximation — closer to human-readable counts than raw token split.
  function wordCount(src) {
    if (!src) return 0;
    var s = src;
    // 1. Strip YAML front-matter at document start
    s = s.replace(/^---[\s\S]*?---\n?/m, " ");
    // 2. Strip URLs
    s = s.replace(/https?:\/\/\S+/g, " ");
    // 3. Strip HTML tags
    s = s.replace(/<[^>]+>/g, " ");
    // 4. Strip markdown punctuation
    s = s.replace(/[#>*`|_\-]/g, " ");
    return s.split(/\s+/).filter(function (w) { return w.length > 0; }).length;
  }

  // ── renderSource ─────────────────────────────────────────
  // Returns HTML for the editor body (goes inside .tv-viewer > .tv-scroll > .tv-content).
  //
  // BUG-1 FIX: Replace the transparent-overlay + backdrop pattern with a SINGLE plain
  // visible <textarea class="tv-edit-area">. The old design stacked an invisible textarea
  // over a syntax "backdrop" div; this caused:
  //   (a) cursor desync — click-to-position landed in the wrong place because the
  //       textarea's left offset (52px) didn't exactly match the backdrop text column,
  //       so the browser's hit-test for the textarea was shifted relative to what the
  //       user clicked on.
  //   (b) save duplication — renderSource HTML-escaped tab.source and embedded it as
  //       the textarea's initial value via innerHTML, but wire() also set textarea.value
  //       from tab.source. On save, if the HTML-encoded version (with &amp; etc.) leaked
  //       through, the content was duplicated or corrupted.
  //
  // The fix: a single <textarea> that IS the editor.  dev2 styles .tv-edit-area to be
  // visible (color: var(--tv-text-primary)), monospace, full-height, no border/outline.
  // No backdrop, no gutter overlay, no debounced innerHTML rebuild.  The textarea value
  // is the ONLY source of truth; wire() sets it from tab.source once on entry.
  function renderSource(tab) {
    var src = (tab && tab.source != null) ? tab.source : "";

    // EHL-01: Edit syntax highlighting via transparent textarea + mirror div.
    // The mirror (.tv-edit-mirror) sits behind the textarea and displays
    // highlighted HTML. The textarea is transparent so its text is invisible —
    // only the mirror text and the native textarea caret are visible.
    //
    // The mirror HTML is set once here (for initial paint) and updated on each
    // input event in wire() with a ~80ms debounce. wire() is the sole owner of
    // textarea.value (single-source-of-truth invariant unchanged).
    //
    // NOTE: do NOT embed src in the textarea here — wire() sets textarea.value
    // from tab.source so the single-ownership invariant is maintained and no
    // HTML-encoding issues can corrupt the content on save.
    var mirrorHtml = highlightSource(src);

    var html =
      '<div class="tv-edit-wrap">' +
        '<div class="tv-edit-mirror srchl srchl-inkcolor in-editor" aria-hidden="true">' +
          mirrorHtml +
          // trailing newline + sentinel span: ensures the mirror is always at
          // least as tall as the textarea (textarea appends a trailing newline
          // visually; the mirror needs an equivalent trailing line to match height).
          '\n<span class="ehl-sentinel"> </span>' +
        '</div>' +
        '<textarea class="tv-edit-area tv-edit-area--hl"' +
          ' data-edit-area' +
          ' spellcheck="false"' +
          ' autocorrect="off"' +
          ' autocapitalize="off"' +
          ' aria-label="Edit document source"' +
          // F-23: a never-saved file says so, once, while it is still blank.
          (tab && tab.isNew && !src
            ? ' placeholder="Start writing. Nothing is saved until you press ⌘S."'
            : '') +
        '>' +
        '</textarea>' +
      '</div>';

    return html;
  }

  // ── D-08: cursor anchor helpers ──────────────────────────
  // tv-app.js fires dblclick on .tv-content and calls setMode('edit') without
  // passing anchor info. We intercept via a capture-phase listener on document
  // (installed once) to stash:
  //   • the block element's text (for line-level disambiguation)
  //   • a precise caret context string extracted via caretRangeFromPoint
  // wire() reads window._tvEditAnchor and maps it to a source offset.

  var _anchorInstalled = false;

  // Strip markdown inline markers from a rendered text string so it can be
  // searched in the raw source.  The source has **bold**, `code`, *italic*,
  // [link](url) — rendered text has none of those, so we strip them from the
  // source side (not the rendered side) when comparing.
  // This helper does the inverse: given a SOURCE substring, produce the plain
  // version that matches what the renderer would output.
  function _stripInlineMarkers(s) {
    return s
      .replace(/!\[.*?\]\(.*?\)/g, "")   // images
      .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1") // links → link text
      .replace(/`([^`]*)`/g, "$1")        // inline code
      .replace(/\*\*([^*]*)\*\*/g, "$1")  // bold **
      .replace(/__([^_]*)__/g, "$1")      // bold __
      .replace(/\*([^*]*)\*/g, "$1")      // italic *
      .replace(/_([^_]*)_/g, "$1")        // italic _
      .replace(/~~([^~]*)~~/g, "$1");     // strikethrough
  }

  function _installAnchorCapture() {
    if (_anchorInstalled || typeof document === "undefined") return;
    _anchorInstalled = true;
    document.addEventListener("dblclick", function (e) {
      // Only capture clicks inside .tv-content (the rendered markdown area)
      var content = e.target && e.target.closest && e.target.closest(".tv-content");
      if (!content) {
        window._tvEditAnchor = null;
        return;
      }

      // ── Step 1: walk up to nearest block element ──────────────
      var el = e.target;
      var blockTags = /^(P|H[1-6]|LI|PRE|BLOCKQUOTE|TD|TH|FIGURE)$/;
      while (el && el !== content) {
        if (blockTags.test(el.nodeName)) break;
        el = el.parentElement;
      }
      var blockEl = (el && el !== content) ? el : null;
      var blockText = blockEl ? (blockEl.textContent || "").trim().slice(0, 120) : null;

      // ── Step 2: use caretRangeFromPoint for sub-word precision ─
      // caretRangeFromPoint is the WebKit/Chrome API (WKWebView supports it).
      // It returns a Range whose startContainer is the text node and
      // startOffset is the character index within that text node.
      var caretCtx = null; // { nodeText, nodeOffset, window24 }
      if (typeof document.caretRangeFromPoint === "function") {
        var range = document.caretRangeFromPoint(e.clientX, e.clientY);
        if (range && range.startContainer && range.startContainer.nodeType === 3 /* TEXT_NODE */) {
          var nodeText = range.startContainer.textContent || "";
          var nodeOffset = range.startOffset;
          // Extract a ±12 char context window (24 chars total) centred on the click
          var winStart = Math.max(0, nodeOffset - 12);
          var winEnd   = Math.min(nodeText.length, nodeOffset + 12);
          var window24 = nodeText.slice(winStart, winEnd);
          // Left-pad offset so we know where within window24 the click landed
          var offsetInWindow = nodeOffset - winStart;
          caretCtx = {
            nodeText: nodeText,
            nodeOffset: nodeOffset,
            window24: window24,
            offsetInWindow: offsetInWindow,
            blockText: blockText,
          };
        }
      }

      // Fallback: no caretRangeFromPoint — use block text only (old behaviour)
      window._tvEditAnchor = caretCtx || (blockText ? { blockText: blockText, window24: null } : null);
      // Keep legacy compat: wire() may still read _tvEditAnchorText elsewhere
      window._tvEditAnchorText = blockText;
    }, true); // capture phase: fires before bubble-phase listeners
  }

  // Find the character offset in `src` that best corresponds to `anchorText`.
  // Returns -1 if not found or ambiguous.
  // Used as a fallback when caretRangeFromPoint is unavailable.
  function _findAnchorOffset(src, anchorText) {
    if (!anchorText || anchorText.length < 3) return -1;
    // Strip markdown syntax from anchor text for matching
    var stripped = anchorText
      .replace(/^#{1,6}\s+/, "") // headings
      .replace(/[`*_]/g, "")     // inline code/bold/italic markers
      .replace(/\s+/g, " ")
      .trim();
    if (stripped.length < 3) return -1;

    // Search src line by line for the best match
    var lines = src.split("\n");
    var offset = 0;
    var bestOffset = -1;
    var bestScore = 0;

    for (var i = 0; i < lines.length; i++) {
      var linePlain = lines[i]
        .replace(/^#{1,6}\s+/, "")
        .replace(/[`*_[\]]/g, "")
        .replace(/!\[.*?\]\(.*?\)/g, "")
        .replace(/\[.*?\]\(.*?\)/g, "")
        .replace(/\s+/g, " ")
        .trim();

      if (linePlain.length > 0) {
        // Score: count matching leading characters
        var score = 0;
        var minLen = Math.min(stripped.length, linePlain.length);
        for (var j = 0; j < minLen; j++) {
          if (stripped[j].toLowerCase() === linePlain[j].toLowerCase()) score++;
          else break;
        }
        // Also check if the line contains the anchor as a substring
        if (score === 0 && linePlain.indexOf(stripped.slice(0, Math.min(20, stripped.length))) !== -1) {
          score = Math.min(20, stripped.length);
        }
        if (score > bestScore && score >= 4) {
          bestScore = score;
          bestOffset = offset;
        }
      }

      offset += lines[i].length + 1; // +1 for \n
    }

    return bestOffset;
  }

  // ── _findPreciseOffset ────────────────────────────────────
  // Maps a caretRangeFromPoint result to a source character offset.
  //
  // Strategy:
  //   1. Find the source line(s) that correspond to the clicked block
  //      (using _findAnchorOffset for block-level disambiguation).
  //   2. Within that region, search for window24 (the rendered text around
  //      the caret) in the SOURCE.  Because rendered text has markdown markers
  //      stripped, we look for window24 as a substring of the source line
  //      after stripping those markers — or we scan the source directly for
  //      substrings that contain window24 as a subsequence.
  //   3. If a match is found, return the source offset of the start of
  //      window24 plus offsetInWindow.
  //   4. If no precise match, fall back to block-line start.
  //   5. If nothing, return -1.
  function _findPreciseOffset(src, anchor) {
    if (!anchor) return -1;

    // ── A. Determine the search region: start/end offsets in src ──
    var regionStart = -1;
    var regionEnd   = src.length;

    var blockText = anchor.blockText || null;
    if (blockText) {
      var blockLineOffset = _findAnchorOffset(src, blockText);
      if (blockLineOffset >= 0) {
        regionStart = blockLineOffset;
        // Limit search region to ~2000 chars beyond the block line start
        // (covers multi-line blocks like list items, blockquotes, code blocks)
        regionEnd = Math.min(src.length, blockLineOffset + 2000);
      }
    }
    // If we couldn't identify the block, search the whole document
    if (regionStart < 0) {
      regionStart = 0;
      regionEnd   = src.length;
    }

    var window24     = anchor.window24;
    var offsetInWin  = anchor.offsetInWindow;

    // ── B. No caret window → fall back to block line start ────────
    if (!window24 || window24.length < 2) {
      return (regionStart >= 0) ? regionStart : -1;
    }

    var srcRegion = src.slice(regionStart, regionEnd);

    // ── C. Try direct search (plain text paragraphs / headings) ───
    // The rendered text node text matches source text exactly for plain
    // paragraphs, headings (minus # prefix), and list item text.
    var directIdx = srcRegion.indexOf(window24);
    if (directIdx >= 0) {
      return regionStart + directIdx + offsetInWin;
    }

    // ── D. Try stripping inline markers from source region and search ──
    // For bold/italic/code the source has markers; rendered text doesn't.
    // We slide a window through the source region, stripping markers from
    // each candidate sub-string, and look for a match with window24.
    //
    // Efficient approach: find each occurrence of the first char of window24
    // in the source region, then try stripping a window around it.
    var w = window24.trim();
    if (w.length >= 3) {
      var firstChar = w[0];
      var scanPos = 0;
      while (scanPos < srcRegion.length) {
        var idx = srcRegion.indexOf(firstChar, scanPos);
        if (idx === -1) break;
        // Expand a candidate window: strip markers in a ±(w.length + 8) neighbourhood
        var candStart = Math.max(0, idx - 8);
        var candEnd   = Math.min(srcRegion.length, idx + w.length + 8);
        var candidate = _stripInlineMarkers(srcRegion.slice(candStart, candEnd));
        var matchIdx  = candidate.indexOf(w);
        if (matchIdx >= 0) {
          // The match lands somewhere in srcRegion[candStart..candEnd].
          // Map back: find `w` in the unstripped region to get source offset.
          // We search for the first char run of `w` in the original (it may
          // have markers interspersed, so look for a prefix of w).
          var prefix = w.slice(0, Math.min(6, w.length));
          // Try direct prefix in original region near idx
          var prefixSearch = srcRegion.slice(Math.max(0, idx - 2), Math.min(srcRegion.length, idx + w.length + 6));
          var prefixIdx = prefixSearch.indexOf(prefix);
          if (prefixIdx >= 0) {
            var srcOff = regionStart + Math.max(0, idx - 2) + prefixIdx + offsetInWin;
            // Clamp to valid range
            srcOff = Math.max(regionStart, Math.min(src.length, srcOff));
            return srcOff;
          }
        }
        scanPos = idx + 1;
      }
    }

    // ── E. Fallback: return block line start ──────────────────────
    return regionStart;
  }

  // ── _expandToWord ─────────────────────────────────────────
  // Given the full text and a source offset, return [start, end] of the word
  // a NATIVE textarea double-click would select at that point. We use
  // Intl.Segmenter('word') — the ICU/UAX#29 algorithm WebKit/WKWebView itself
  // uses for double-click selection — so the first (synthetic) double-click
  // selects exactly what every subsequent native double-click selects:
  // contractions ("don't"), possessives ("Sam's"), decimals ("3.14") and
  // non-ASCII words ("café") stay whole; hyphens split. Falls back to a
  // Unicode-aware word scan when Intl.Segmenter is unavailable.
  function _expandToWord(text, offset) {
    if (text == null) return [0, 0];
    var len = text.length;
    var off = Math.max(0, Math.min(offset, len));

    if (typeof Intl !== "undefined" && Intl.Segmenter) {
      try {
        var segs = Array.from(new Intl.Segmenter(undefined, { granularity: "word" }).segment(text));
        // The word-like segment the caret sits inside.
        for (var i = 0; i < segs.length; i++) {
          var s = segs[i];
          if (off >= s.index && off < s.index + s.segment.length) {
            if (s.isWordLike) return [s.index, s.index + s.segment.length];
            break; // caret on whitespace/punctuation → collapse
          }
        }
        // Caret resting at a word's trailing boundary (e.g. end of line).
        for (var k = 0; k < segs.length; k++) {
          var sk = segs[k];
          if (sk.isWordLike && sk.index + sk.segment.length === off) return [sk.index, off];
        }
        return [off, off];
      } catch (e) { /* fall through to the scan below */ }
    }

    // Fallback: Unicode letters/digits/_ are word chars; an apostrophe
    // (U+0027/U+2019) or '.' flanked by word chars is word-internal.
    function isW(ch) { return ch != null && /[A-Za-z0-9_À-￿]/.test(ch); }
    function joins(ch, prev, next) {
      return (ch === "'" || ch === "’" || ch === ".") && isW(prev) && isW(next);
    }
    if (off >= len || !isW(text[off])) {
      if (off > 0 && isW(text[off - 1])) off = off - 1; else return [off, off];
    }
    var a = off, b = off;
    while (a > 0 && (isW(text[a - 1]) || joins(text[a - 1], text[a - 2], text[a]))) a--;
    while (b < len && (isW(text[b]) || joins(text[b], text[b - 1], text[b + 1]))) b++;
    return [a, b];
  }

  // ── _caretTopPx ───────────────────────────────────────────
  // Vertical pixel offset of `offset` inside a soft-wrapping textarea, measured
  // by rendering the leading text in a metric-identical mirror div. Robust to
  // wrapped lines (.tv-edit-area is white-space:pre-wrap), where a line-count
  // estimate drifts and can leave the caret off-screen. Returns 0 if it can't
  // measure (e.g. headless/no layout).
  function _caretTopPx(textarea, offset) {
    if (!textarea || typeof document === "undefined" || typeof getComputedStyle !== "function") return 0;
    var cs = getComputedStyle(textarea);
    var div = document.createElement("div");
    var st = div.style;
    st.position = "absolute"; st.top = "0"; st.left = "-9999px";
    st.visibility = "hidden"; st.pointerEvents = "none";
    st.whiteSpace = "pre-wrap"; st.wordBreak = "break-word"; st.overflowWrap = "break-word";
    st.boxSizing = cs.boxSizing;
    st.width = textarea.clientWidth + "px";
    st.fontFamily = cs.fontFamily; st.fontSize = cs.fontSize;
    st.fontWeight = cs.fontWeight; st.fontStyle = cs.fontStyle;
    st.lineHeight = cs.lineHeight; st.letterSpacing = cs.letterSpacing; st.tabSize = cs.tabSize;
    st.paddingTop = cs.paddingTop; st.paddingBottom = "0";
    st.paddingLeft = cs.paddingLeft; st.paddingRight = cs.paddingRight;
    div.textContent = (textarea.value || "").slice(0, offset);
    var marker = document.createElement("span");
    marker.textContent = "​"; // zero-width: gives the caret line a measurable box
    div.appendChild(marker);
    (textarea.parentNode || document.body).appendChild(div);
    var top = marker.offsetTop;
    if (div.parentNode) div.parentNode.removeChild(div);
    return top;
  }

  // ── wire ─────────────────────────────────────────────────
  // Attaches real editing behaviour to the rendered edit DOM.
  //   rootEl  — the .tv-viewer element (or any ancestor containing [data-edit-area])
  //   tab     — the Tab object (mutable; we write .source and .dirty back)
  // Returns a cleanup function.
  //
  // UI-01 FIX: wire() may be called by render() on structural actions like ⌘B /
  // theme / accent changes while the user is already in edit mode.  In those cases
  // the textarea is new (render() replaced the DOM) but the content is the same —
  // we must NOT move the caret.  We distinguish three call sites:
  //   (a) FIRST entry into edit mode:   _tvEditAnchorText may be set (D-08 anchor).
  //       Place caret at anchor or EOF.  This is the only call that sets position.
  //   (b) Re-render in edit mode:       tab._editCursorPos carries the last known
  //       selectionStart/End (captured in onInput / on every structural action).
  //       Restore those positions without moving the caret to EOF.
  //   (c) No prior cursor info:         restore EOF only if truly first time.
  function wire(rootEl, tab) {
    if (!rootEl || !tab) return function () {};

    // Install the capture-phase anchor interceptor (idempotent)
    _installAnchorCapture();

    var textarea = rootEl.querySelector("[data-edit-area]");
    if (!textarea) return function () {};

    // EHL-01: locate the mirror div (sibling to textarea inside .tv-edit-wrap)
    var mirror = rootEl.querySelector(".tv-edit-mirror");

    // BUG-1 FIX: renderSource no longer embeds content in the textarea (that was the
    // source of the duplication bug — HTML-encoded content set via innerHTML could
    // disagree with tab.source).  wire() is now the SOLE place that loads tab.source
    // into the textarea, so there is exactly one write on edit-mode entry and no
    // duplication is possible.
    textarea.value = (tab.source != null) ? tab.source : "";

    // EHL-01: update mirror on initial wire (renderSource pre-populated it for
    // static HTML, but wire() may be called on re-renders where mirror is empty).
    if (mirror) {
      mirror.innerHTML = highlightSource(textarea.value) + '\n<span class="ehl-sentinel"> </span>';
    }

    // Keep textarea height matching content so .tv-scroll handles the scroll
    function autoResize() {
      textarea.style.height = "auto";
      textarea.style.height = textarea.scrollHeight + "px";
    }
    autoResize();

    // D-08 / UI-01: place cursor correctly without clobbering position on re-renders.
    requestAnimationFrame(function () {
      textarea.focus();

      var src = tab.source || "";

      // (a) First entry: anchor from double-click — use precise caretRangeFromPoint
      //     result if available, fall back to block-text anchor.
      var anchor     = window._tvEditAnchor || null;
      var anchorText = window._tvEditAnchorText || null;

      if (anchor || anchorText) {
        // Consume both once
        window._tvEditAnchor     = null;
        window._tvEditAnchorText = null;

        var offset = -1;

        if (anchor && anchor.window24) {
          // Precise path: use caretRangeFromPoint context window
          offset = _findPreciseOffset(src, anchor);
        }

        if (offset < 0 && anchorText) {
          // Block-text fallback
          offset = _findAnchorOffset(src, anchorText);
        }

        if (offset >= 0 && offset <= src.length) {
          // Match native textarea double-click: select the whole word at the
          // click point, so the first double-click behaves like every
          // subsequent one (which the browser word-selects inside the textarea).
          var word = _expandToWord(src, offset);
          textarea.setSelectionRange(word[0], word[1]);

          // ISS-001: scroll the .tv-scroll container so the just-selected word
          // is actually visible — it was landing correctly but often off-screen.
          // Measure the caret's true pixel Y (robust to soft-wrapped lines) and
          // place it ~a third down the viewport.
          // requests-shell.md #1: rootEl is the .tv ROOT (wire(rootEl, tab) is
          // called with tvRoot), and .tv-scroll is a DESCENDANT of it — .closest()
          // only walks upward and always returned null, so this whole block was
          // dead code in every real path (C-35). querySelector walks down instead.
          var scrollContainer = rootEl.querySelector ? rootEl.querySelector(".tv-scroll") : null;
          if (scrollContainer) {
            var caretTop      = _caretTopPx(textarea, word[0]);
            var taTop         = textarea.getBoundingClientRect().top;
            var scTop         = scrollContainer.getBoundingClientRect().top;
            var caretInScroll = (taTop - scTop) + scrollContainer.scrollTop + caretTop;
            var maxScroll     = Math.max(0, scrollContainer.scrollHeight - scrollContainer.clientHeight);
            var target        = caretInScroll - scrollContainer.clientHeight / 3;
            scrollContainer.scrollTop = Math.max(0, Math.min(target, maxScroll));
          }

          // Store cursor position for future re-renders (UI-01)
          tab._editCursorPos = { start: word[0], end: word[1] };
          return;
        }
      }

      // (b) Re-render in edit mode: restore prior cursor position (UI-01 fix)
      if (tab._editCursorPos) {
        var pos = tab._editCursorPos;
        var len = textarea.value.length;
        var s = Math.min(pos.start, len);
        var en = Math.min(pos.end, len);
        textarea.setSelectionRange(s, en);
        return;
      }

      // (c) Truly first entry with no anchor: place at EOF
      var len2 = textarea.value.length;
      textarea.setSelectionRange(len2, len2);
      tab._editCursorPos = { start: len2, end: len2 };
    });

    // Update word count display in the toolbar
    function updateMeta(src) {
      var metaEl = document.querySelector(".tv-edit-meta");
      if (metaEl) {
        metaEl.textContent = wordCount(src) + " words";
      }
    }

    // EHL-01: debounced mirror update — runs ~80ms after the last keystroke.
    // Keeps the highlight visually current without blocking the keystroke path.
    // IME safety: we skip the update if a composition is in progress (compositionstart
    // fires before compositionend; we reset the flag in compositionend so the final
    // composed text still gets highlighted).
    var _hlTimer = null;
    var _composing = false;

    function _updateMirror() {
      if (!mirror) return;
      mirror.innerHTML = highlightSource(textarea.value) + '\n<span class="ehl-sentinel"> </span>';
    }

    function _scheduleHL() {
      if (_hlTimer) clearTimeout(_hlTimer);
      if (_composing) return; // don't re-render during IME composition
      _hlTimer = setTimeout(_updateMirror, 80);
    }

    function _onCompositionStart() { _composing = true; }
    function _onCompositionEnd()   {
      _composing = false;
      _scheduleHL(); // highlight the final composed text
    }

    // S-01 / BUG-1 FIX: onInput is O(1) per keystroke.
    // - Writes tab.source (O(1) assignment) — textarea.value is the ONLY source of truth.
    // - Updates word-count element in place (O(N) text scan, no DOM rebuild).
    // - Calls TV.markDirty(id, true) — render-free (dot toggle only, no render()).
    // - EHL-01: schedules a debounced mirror re-highlight (~80ms).
    // - Does NOT call render(), wire(), or resetCaret via rAF.
    // - UI-01: tracks cursor position so re-renders (⌘B, theme, etc.) restore it.
    function onInput() {
      var src = textarea.value;
      tab.source = src;          // keep tab.source current at all times (O(1))
      tab.dirty = true;
      // UI-01: track cursor position for restoration after re-renders
      tab._editCursorPos = { start: textarea.selectionStart, end: textarea.selectionEnd };
      // Notify app of dirty state — markDirty() is render-free (dot toggle only)
      if (window.TV && typeof window.TV.markDirty === "function") {
        window.TV.markDirty(tab.id, true);
      }
      updateMeta(src);           // update word count element in place
      autoResize();              // adjust textarea height
      _scheduleHL();             // EHL-01: queue mirror update
    }

    // Tab key: insert 4 spaces rather than focus-jumping
    // UI-02 FIX: use setRangeText() which preserves the native undo stack (⌘Z works).
    // The old pattern `textarea.value = ...slice...` wiped the entire undo history.
    function onKeydown(e) {
      if (e.key === "Tab") {
        e.preventDefault();
        var start = textarea.selectionStart;
        var end = textarea.selectionEnd;
        var indent = "    ";
        // setRangeText replaces the selection with indent and keeps undo history intact.
        // Falls back to execCommand for older WebKit environments.
        if (typeof textarea.setRangeText === "function") {
          textarea.setRangeText(indent, start, end, "end");
        } else {
          // execCommand is deprecated but preserves undo in legacy WebKit
          document.execCommand("insertText", false, indent);
        }
        onInput();
      }
    }

    textarea.addEventListener("input", onInput);
    textarea.addEventListener("keydown", onKeydown);
    textarea.addEventListener("compositionstart", _onCompositionStart);
    textarea.addEventListener("compositionend", _onCompositionEnd);

    // Initial meta update
    updateMeta(tab.source || "");

    return function cleanup() {
      if (_hlTimer) clearTimeout(_hlTimer);
      textarea.removeEventListener("input", onInput);
      textarea.removeEventListener("keydown", onKeydown);
      textarea.removeEventListener("compositionstart", _onCompositionStart);
      textarea.removeEventListener("compositionend", _onCompositionEnd);
    };
  }

  // ── applySave ────────────────────────────────────────────
  // E-05: fixed to call TVFiles.writeFile(tab) with the correct single-arg signature.
  // The shell (tv-app.js handleSave) reads tab.source directly; wire() guarantees
  // it is always current. applySave is a convenience for callers that want a one-shot
  // "write to disk and clear dirty" call.
  function applySave(tab) {
    if (!tab) return;
    if (window.TVFiles && typeof window.TVFiles.writeFile === "function") {
      // Correct: pass the tab object (writeFile(tab)), not (fileHandle, source)
      return window.TVFiles.writeFile(tab)
        .then(function () {
          tab.dirty = false;
          if (window.TV && typeof window.TV.markDirty === "function") {
            window.TV.markDirty(tab.id, false);
          }
          if (window.TV && typeof window.TV.render === "function") {
            window.TV.render();
          }
        })
        .catch(function (err) {
          // eslint-disable-next-line no-console
          console.warn("[tv-edit] writeFile failed:", err);
        });
    } else {
      // TVFiles unavailable: clear dirty flag only (in-memory)
      tab.dirty = false;
      if (window.TV && typeof window.TV.markDirty === "function") {
        window.TV.markDirty(tab.id, false);
      }
      if (window.TV && typeof window.TV.render === "function") {
        window.TV.render();
      }
      return Promise.resolve();
    }
  }

  // ── public surface ────────────────────────────────────────
  window.TVEdit = {
    wordCount: wordCount,
    renderSource: renderSource,
    wire: wire,
    applySave: applySave,
    highlightSource: highlightSource,
    // Test-only handles (pure functions / install hook) — not part of the app API.
    _internals: {
      expandToWord: _expandToWord,
      findPreciseOffset: _findPreciseOffset,
      findAnchorOffset: _findAnchorOffset,
      installAnchorCapture: _installAnchorCapture,
    },
  };

  // ISS-001 FIX: install the capture-phase double-click anchor interceptor ONCE
  // at module load. It used to be installed lazily inside wire(), which only runs
  // in edit mode — so the FIRST double-click on a freshly-opened doc (booted in
  // reading mode) had no listener yet: per W3C DOM dispatch the just-added
  // bubble-phase handler that enters edit mode cannot capture the in-flight
  // event, so no anchor was recorded and the caret fell to EOF. Installing at
  // init guarantees the very first double-click is captured before edit mode.
  _installAnchorCapture();

})();
