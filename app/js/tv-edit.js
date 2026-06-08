/* ───────────────────────────────────────────────────────────
   tiny-viewer · edit mode
   Exposes: window.TVEdit
     .wordCount(src)             → number
     .renderSource(tab)          → htmlString (content body for edit mode)
     .wire(rootEl, tab)          → cleanup fn
     .applySave(tab)             → void  — delegates to TVFiles.writeFile(tab) [E-05]
   ─────────────────────────────────────────────────────────── */
(function () {

  // ── wordCount ─────────────────────────────────────────────
  // Strip markdown punctuation then count whitespace-separated tokens.
  function wordCount(src) {
    if (!src) return 0;
    var stripped = src.replace(/[#>*`|_\-]/g, " ");
    return stripped.split(/\s+/).filter(function (w) { return w.length > 0; }).length;
  }

  // ── syntax-highlight a single source line (display layer) ─
  function esc(s) {
    return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  }

  function highlightLine(raw) {
    var s = esc(raw);
    // Bold headers
    s = s.replace(/^(#{1,6}\s.*)$/, '<span class="s-h">$1</span>');
    // Inline code
    s = s.replace(/(`[^`]*`)/g, '<span class="s-code">$1</span>');
    // Pipe chars
    s = s.replace(/\|/g, '<span class="s-pipe">|</span>');
    return s;
  }

  // ── renderSource ─────────────────────────────────────────
  // Returns HTML for the editor body (goes inside .tv-viewer > .tv-scroll > .tv-content).
  // Strategy: a real <textarea class="tv-edit-area"> overlaid over the syntax-highlighted
  // .tv-source gutter view.  The textarea is transparent/borderless so you see the syntax
  // colours through it; typing flows into the textarea while the gutter/syntax layer is a
  // static visual backdrop rendered from the initial tab.source.
  function renderSource(tab) {
    var src = (tab && tab.source != null) ? tab.source : "";
    var lines = src.split("\n");
    var wc = wordCount(src);

    // Build the visible syntax/gutter layer (aria-hidden, pointer-events:none overlay)
    var gutterRows = lines.map(function (ln, k) {
      var html = highlightLine(ln) || " ";
      return '<div class="tv-srcline" aria-hidden="true">' +
        '<span class="tv-gutter">' + (k + 1) + "</span>" +
        '<span class="tv-srctext">' + html + "</span></div>";
    }).join("");

    // Wrapper: position:relative so we can stack textarea over the gutter layer.
    var html =
      '<div class="tv-edit-wrap" style="position:relative;">' +
        // Syntax/gutter visual layer (non-interactive)
        '<div class="tv-source tv-source--backdrop" aria-hidden="true" style="pointer-events:none;user-select:none;">' +
          gutterRows +
        "</div>" +
        // Real editable textarea — transparent, positioned absolutely over the text column
        '<textarea class="tv-edit-area"' +
          ' data-edit-area' +
          ' spellcheck="false"' +
          ' autocorrect="off"' +
          ' autocapitalize="off"' +
          ' style="' +
            'position:absolute;' +
            'top:0;' +
            'left:52px;' +
            'right:0;' +
            'bottom:0;' +
            'min-height:100%;' +
            'font-family:var(--tv-font-mono);' +
            'font-size:13px;' +
            'line-height:1.72;' +
            'color:transparent;' +
            'caret-color:var(--tv-accent);' +
            'background:transparent;' +
            'border:none;' +
            'outline:none;' +
            'resize:none;' +
            'padding:var(--tv-s4) 24px var(--tv-s4) 0;' +
            'width:calc(100% - 52px);' +
            'box-sizing:border-box;' +
            'overflow:hidden;' +
            'white-space:pre-wrap;' +
            'word-break:break-word;' +
          '">' +
          esc(src) +
        "</textarea>" +
      "</div>";

    return html;
  }

  // ── D-08: cursor anchor helpers ──────────────────────────
  // tv-app.js fires dblclick on .tv-content and calls setMode('edit') without
  // passing anchor info. We intercept via a capture-phase listener on document
  // (installed once) to stash the clicked element's text BEFORE setMode runs.
  // wire() reads window._tvEditAnchorText and computes the character offset.

  var _anchorInstalled = false;

  function _installAnchorCapture() {
    if (_anchorInstalled || typeof document === "undefined") return;
    _anchorInstalled = true;
    document.addEventListener("dblclick", function (e) {
      // Only capture clicks inside .tv-content (the rendered markdown area)
      var content = e.target && e.target.closest && e.target.closest(".tv-content");
      if (!content) {
        window._tvEditAnchorText = null;
        return;
      }
      // Walk up to find the nearest block element (p, h1-h6, li, pre, blockquote)
      var el = e.target;
      var blockTags = /^(P|H[1-6]|LI|PRE|BLOCKQUOTE|TD|TH|FIGURE)$/;
      while (el && el !== content) {
        if (blockTags.test(el.nodeName)) break;
        el = el.parentElement;
      }
      // Store trimmed text of the block so wire() can find it in tab.source
      window._tvEditAnchorText = (el && el !== content) ? (el.textContent || "").trim().slice(0, 120) : null;
    }, true); // capture phase: fires before bubble-phase listeners
  }

  // Find the character offset in `src` that best corresponds to `anchorText`.
  // Returns -1 if not found or ambiguous.
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

  // ── wire ─────────────────────────────────────────────────
  // Attaches real editing behaviour to the rendered edit DOM.
  //   rootEl  — the .tv-viewer element (or any ancestor containing [data-edit-area])
  //   tab     — the Tab object (mutable; we write .source and .dirty back)
  // Returns a cleanup function.
  function wire(rootEl, tab) {
    if (!rootEl || !tab) return function () {};

    // Install the capture-phase anchor interceptor (idempotent)
    _installAnchorCapture();

    var textarea = rootEl.querySelector("[data-edit-area]");
    if (!textarea) return function () {};

    // E-05: guarantee tab.source is current from textarea value
    // (renderSource already set the initial value from tab.source; this is belt-and-suspenders)
    if (tab.source != null && textarea.value !== tab.source) {
      textarea.value = tab.source;
    }

    // Keep textarea height matching content so .tv-scroll handles the scroll
    function autoResize() {
      textarea.style.height = "auto";
      textarea.style.height = textarea.scrollHeight + "px";
    }
    autoResize();

    // D-08: place cursor at the double-clicked paragraph instead of EOF.
    // This rAF runs ONCE on wire() — not on every keystroke (S-01 fix: onInput no longer
    // calls wire() or render(), so this rAF fires only when the edit mode is first entered).
    requestAnimationFrame(function () {
      textarea.focus();

      var anchorText = window._tvEditAnchorText || null;
      var src = tab.source || "";
      var offset = -1;

      if (anchorText) {
        offset = _findAnchorOffset(src, anchorText);
        window._tvEditAnchorText = null; // consume once
      }

      if (offset >= 0 && offset <= src.length) {
        // Place cursor at the start of the matching line and scroll into view
        textarea.setSelectionRange(offset, offset);
        // Scroll the textarea to make the caret visible
        // Estimate line height from font-size 13px * line-height 1.72
        var lineHeight = 13 * 1.72; // ~22.36px
        var linesBefore = src.slice(0, offset).split("\n").length - 1;
        var approxTop = linesBefore * lineHeight;
        var scrollContainer = rootEl.closest ? rootEl.closest(".tv-scroll") : null;
        if (scrollContainer) {
          // Offset is relative to textarea, which is inside the scroll container
          scrollContainer.scrollTop = Math.max(0, approxTop - scrollContainer.clientHeight / 3);
        }
      } else {
        // Fallback: place cursor at EOF
        var len = textarea.value.length;
        textarea.setSelectionRange(len, len);
      }
    });

    // Update word count display in the toolbar
    function updateMeta(src) {
      var metaEl = document.querySelector(".tv-edit-meta");
      if (metaEl) {
        metaEl.textContent = wordCount(src) + " words";
      }
    }

    // Rebuild the syntax gutter backdrop from current textarea content.
    // Called on a debounce so it does NOT block the keystroke path.
    function updateBackdrop(src) {
      var backdrop = rootEl.querySelector(".tv-source--backdrop");
      if (!backdrop) return;
      var lines = src.split("\n");
      var gutterRows = lines.map(function (ln, k) {
        var html = highlightLine(ln) || " ";
        return '<div class="tv-srcline" aria-hidden="true">' +
          '<span class="tv-gutter">' + (k + 1) + "</span>" +
          '<span class="tv-srctext">' + html + "</span></div>";
      }).join("");
      backdrop.innerHTML = gutterRows;
    }

    // S-01: debounce backdrop updates so they do NOT fire synchronously on every keystroke.
    // The textarea is the source of truth; the backdrop is a purely visual aid.
    var _backdropTimer = null;
    function scheduleBackdropUpdate(src) {
      if (_backdropTimer !== null) clearTimeout(_backdropTimer);
      _backdropTimer = setTimeout(function () {
        _backdropTimer = null;
        updateBackdrop(src);
      }, 150);
    }

    // S-01: onInput is now O(1) per keystroke.
    // - Writes tab.source (O(1) assignment)
    // - Updates word-count element in place (O(N) text scan but no DOM rebuild)
    // - Calls TV.markDirty(id, true) — per contract this is render-free (cheap flag + dot toggle)
    // - Schedules backdrop update on a 150ms debounce (visually acceptable; not on hot path)
    // - Does NOT call render(), wire(), or resetCaret via rAF
    function onInput() {
      var src = textarea.value;
      tab.source = src;          // keep tab.source current at all times (O(1))
      tab.dirty = true;
      // Notify app of dirty state — dev-frontend makes markDirty() render-free (dot toggle only)
      if (window.TV && typeof window.TV.markDirty === "function") {
        window.TV.markDirty(tab.id, true);
      }
      updateMeta(src);           // update word count element in place
      scheduleBackdropUpdate(src); // debounced backdrop — does not affect caret
      autoResize();              // adjust textarea height
    }

    // Tab key: insert 4 spaces rather than focus-jumping
    function onKeydown(e) {
      if (e.key === "Tab") {
        e.preventDefault();
        var start = textarea.selectionStart;
        var end = textarea.selectionEnd;
        var val = textarea.value;
        var indent = "    ";
        textarea.value = val.slice(0, start) + indent + val.slice(end);
        textarea.setSelectionRange(start + indent.length, start + indent.length);
        onInput();
      }
    }

    textarea.addEventListener("input", onInput);
    textarea.addEventListener("keydown", onKeydown);

    // Initial meta update
    updateMeta(tab.source || "");

    return function cleanup() {
      textarea.removeEventListener("input", onInput);
      textarea.removeEventListener("keydown", onKeydown);
      if (_backdropTimer !== null) { clearTimeout(_backdropTimer); _backdropTimer = null; }
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
  };

})();
