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

    // Single plain visible textarea — no backdrop, no gutter.
    // Inline style provides the minimum geometry; dev2 owns the rest via .tv-edit-area.
    var html =
      '<div class="tv-edit-wrap">' +
        '<textarea class="tv-edit-area"' +
          ' data-edit-area' +
          ' spellcheck="false"' +
          ' autocorrect="off"' +
          ' autocapitalize="off"' +
        '>' +
        // NOTE: do NOT embed src here — wire() sets textarea.value from tab.source
        // so the single-ownership invariant is maintained and no HTML-encoding issues
        // can corrupt the content on save.
        '</textarea>' +
      '</div>';

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

    // BUG-1 FIX: renderSource no longer embeds content in the textarea (that was the
    // source of the duplication bug — HTML-encoded content set via innerHTML could
    // disagree with tab.source).  wire() is now the SOLE place that loads tab.source
    // into the textarea, so there is exactly one write on edit-mode entry and no
    // duplication is possible.
    textarea.value = (tab.source != null) ? tab.source : "";

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

    // S-01 / BUG-1 FIX: onInput is O(1) per keystroke.
    // - Writes tab.source (O(1) assignment) — textarea.value is the ONLY source of truth.
    // - Updates word-count element in place (O(N) text scan, no DOM rebuild).
    // - Calls TV.markDirty(id, true) — render-free (dot toggle only, no render()).
    // - NO backdrop rebuild: the old debounced innerHTML write was the mechanism that
    //   caused cursor desync.  The plain visible textarea needs no backdrop at all.
    // - Does NOT call render(), wire(), or resetCaret via rAF.
    function onInput() {
      var src = textarea.value;
      tab.source = src;          // keep tab.source current at all times (O(1))
      tab.dirty = true;
      // Notify app of dirty state — markDirty() is render-free (dot toggle only)
      if (window.TV && typeof window.TV.markDirty === "function") {
        window.TV.markDirty(tab.id, true);
      }
      updateMeta(src);           // update word count element in place
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
