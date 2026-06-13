/* ───────────────────────────────────────────────────────────
   tiny-viewer · edit mode
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

  // Process inline markdown spans within a single line of text.
  // Returns HTML string with appropriate <span> wrappers.
  // Characters outside special spans are HTML-escaped.
  // Handles: **bold**, *italic*, _italic_, `code`, [link](url)
  // Marker characters are preserved but dimmed via s-mark spans.
  function _inlineHL(raw) {
    // We'll build the result by walking through the string character by character,
    // matching patterns greedily left-to-right.
    var out = '';
    var i = 0;
    var len = raw.length;

    while (i < len) {
      // ── inline code `…` ──
      if (raw[i] === '`') {
        var end = raw.indexOf('`', i + 1);
        if (end !== -1) {
          var marker = raw.slice(i, i + 1);
          var content = raw.slice(i + 1, end);
          out += '<span class="ehl-mark">' + _escHtml(marker) + '</span>';
          out += '<span class="ehl-code">' + _escHtml(content) + '</span>';
          out += '<span class="ehl-mark">' + _escHtml(marker) + '</span>';
          i = end + 1;
          continue;
        }
      }

      // ── bold **…** or __…__ ──
      if (i + 1 < len) {
        var twoCh = raw.slice(i, i + 2);
        if (twoCh === '**' || twoCh === '__') {
          var closer = raw.indexOf(twoCh, i + 2);
          if (closer !== -1 && closer > i + 2) {
            var bContent = raw.slice(i + 2, closer);
            out += '<span class="ehl-mark">' + _escHtml(twoCh) + '</span>';
            out += '<span class="ehl-bold">' + _inlineHL(bContent) + '</span>';
            out += '<span class="ehl-mark">' + _escHtml(twoCh) + '</span>';
            i = closer + 2;
            continue;
          }
        }
      }

      // ── italic *…* or _…_ (single, not double) ──
      if (raw[i] === '*' || raw[i] === '_') {
        var iMark = raw[i];
        // make sure it's single (not ** or __)
        if (raw[i + 1] !== iMark) {
          var iEnd = -1;
          // find closing single marker
          for (var j = i + 1; j < len; j++) {
            if (raw[j] === iMark && raw[j - 1] !== '\\' && raw[j + 1] !== iMark) {
              iEnd = j;
              break;
            }
          }
          if (iEnd !== -1 && iEnd > i + 1) {
            var iContent = raw.slice(i + 1, iEnd);
            out += '<span class="ehl-mark">' + _escHtml(iMark) + '</span>';
            out += '<span class="ehl-italic">' + _escHtml(iContent) + '</span>';
            out += '<span class="ehl-mark">' + _escHtml(iMark) + '</span>';
            i = iEnd + 1;
            continue;
          }
        }
      }

      // ── link [text](url) ──
      if (raw[i] === '[') {
        var lbClose = raw.indexOf(']', i + 1);
        if (lbClose !== -1 && raw[lbClose + 1] === '(') {
          var lpClose = raw.indexOf(')', lbClose + 2);
          if (lpClose !== -1) {
            var lText = raw.slice(i + 1, lbClose);
            var lUrl  = raw.slice(lbClose + 2, lpClose);
            out += '<span class="ehl-mark">[</span>';
            out += '<span class="ehl-link">' + _escHtml(lText) + '</span>';
            out += '<span class="ehl-mark">](</span>';
            out += '<span class="ehl-link-url">' + _escHtml(lUrl) + '</span>';
            out += '<span class="ehl-mark">)</span>';
            i = lpClose + 1;
            continue;
          }
        }
      }

      // plain character
      out += _escHtml(raw[i]);
      i++;
    }

    return out;
  }

  // Highlight a full source string, returning HTML.
  // Line-based: one pass, lightweight.
  function highlightSource(src) {
    if (!src) return '';
    var lines = src.split('\n');
    var out = [];
    var inFence = false;
    var fenceLang = '';

    for (var i = 0; i < lines.length; i++) {
      var line = lines[i];

      // ── fenced code block ──
      var fenceMatch = line.match(/^(`{3,}|~{3,})([\w-]*)/);
      if (fenceMatch) {
        if (!inFence) {
          inFence = true;
          fenceLang = fenceMatch[2] || '';
          out.push(
            '<span class="ehl-fence-mark">' + _escHtml(fenceMatch[1]) + fenceLang + '</span>'
          );
        } else {
          inFence = false;
          fenceLang = '';
          out.push('<span class="ehl-fence-mark">' + _escHtml(line) + '</span>');
        }
        continue;
      }

      if (inFence) {
        out.push('<span class="ehl-fence-line">' + _escHtml(line) + '</span>');
        continue;
      }

      // ── ATX headings # ## ### ──
      var hMatch = line.match(/^(#{1,6})(\s+)(.*)/);
      if (hMatch) {
        var hLevel = hMatch[1].length;
        var hClass = 'ehl-h' + hLevel;
        out.push(
          '<span class="ehl-mark">' + _escHtml(hMatch[1]) + '</span>' +
          _escHtml(hMatch[2]) +
          '<span class="' + hClass + '">' + _inlineHL(hMatch[3]) + '</span>'
        );
        continue;
      }

      // ── setext headings (=== or ---) ──
      if (/^={3,}\s*$/.test(line)) {
        out.push('<span class="ehl-h1">' + _escHtml(line) + '</span>');
        continue;
      }
      if (/^-{3,}\s*$/.test(line) && i > 0) {
        out.push('<span class="ehl-h2">' + _escHtml(line) + '</span>');
        continue;
      }

      // ── blockquote > ──
      if (/^>/.test(line)) {
        var bqMark = line.match(/^(>+\s?)(.*)/);
        if (bqMark) {
          out.push(
            '<span class="ehl-bq-mark">' + _escHtml(bqMark[1]) + '</span>' +
            '<span class="ehl-bq">' + _inlineHL(bqMark[2]) + '</span>'
          );
        } else {
          out.push('<span class="ehl-bq">' + _escHtml(line) + '</span>');
        }
        continue;
      }

      // ── list markers (- / * / + / 1.) ──
      var listMatch = line.match(/^(\s*)([-*+]|\d+\.)(\s+)(.*)/);
      if (listMatch) {
        out.push(
          _escHtml(listMatch[1]) +
          '<span class="ehl-list-mark">' + _escHtml(listMatch[2]) + '</span>' +
          _escHtml(listMatch[3]) +
          _inlineHL(listMatch[4])
        );
        continue;
      }

      // ── HR --- / *** / ___ ──
      if (/^(\s*[-*_]){3,}\s*$/.test(line)) {
        out.push('<span class="ehl-hr">' + _escHtml(line) + '</span>');
        continue;
      }

      // ── plain paragraph text — inline highlighting only ──
      out.push(_inlineHL(line));
    }

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
        '<div class="tv-edit-mirror" aria-hidden="true">' +
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
          textarea.setSelectionRange(offset, offset);

          // Scroll the .tv-scroll container so the caret line is near the
          // top-third of the viewport.  We approximate line height from the
          // textarea's own scrollHeight / line-count ratio.
          var linesBefore = src.slice(0, offset).split("\n").length - 1;
          var totalLines  = (src.split("\n").length) || 1;
          var scrollContainer = rootEl.closest ? rootEl.closest(".tv-scroll") : null;
          if (scrollContainer) {
            var ratio    = linesBefore / Math.max(totalLines - 1, 1);
            var maxScroll = scrollContainer.scrollHeight - scrollContainer.clientHeight;
            var approxTop = ratio * Math.max(0, maxScroll);
            scrollContainer.scrollTop = Math.max(
              0,
              approxTop - scrollContainer.clientHeight / 3
            );
          }

          // Store cursor position for future re-renders (UI-01)
          tab._editCursorPos = { start: offset, end: offset };
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
  };

})();
