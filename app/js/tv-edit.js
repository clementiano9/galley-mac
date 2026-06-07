/* ───────────────────────────────────────────────────────────
   tiny-viewer · edit mode
   Exposes: window.TVEdit
     .wordCount(src)             → number
     .renderSource(tab)          → htmlString (content body for edit mode)
     .wire(rootEl, tab)          → cleanup fn
     .applySave(tab)             → void (shell calls on ⌘S)
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
  // The shell replaces the content area on each TV.render() call; we only need the initial
  // HTML here. The live wire() call keeps textarea content in sync with tab.source.
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
    // The textarea matches the gutter's left offset (52px) to align with text column.
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
            'left:52px;' +    // align with .tv-gutter width
            'right:0;' +
            'bottom:0;' +
            'min-height:100%;' +
            'font-family:var(--tv-font-mono);' +
            'font-size:13px;' +
            'line-height:1.72;' +
            'color:transparent;' +      // text invisible — syntax layer shows through
            'caret-color:var(--tv-accent);' +
            'background:transparent;' +
            'border:none;' +
            'outline:none;' +
            'resize:none;' +
            'padding:var(--tv-s4) 24px var(--tv-s4) 0;' +
            'width:calc(100% - 52px);' +
            'box-sizing:border-box;' +
            'overflow:hidden;' +        // outer .tv-scroll handles scroll
            'white-space:pre-wrap;' +
            'word-break:break-word;' +
          '">' +
          esc(src) +
        "</textarea>" +
      "</div>";

    return html;
  }

  // ── wire ─────────────────────────────────────────────────
  // Attaches real editing behaviour to the rendered edit DOM.
  //   rootEl  — the .tv-viewer element (or any ancestor containing [data-edit-area])
  //   tab     — the Tab object (mutable; we write .source and .dirty back)
  // Returns a cleanup function.
  function wire(rootEl, tab) {
    if (!rootEl || !tab) return function () {};

    var textarea = rootEl.querySelector("[data-edit-area]");
    if (!textarea) return function () {};

    // Focus immediately so user can type
    // Use rAF to ensure layout is ready
    requestAnimationFrame(function () {
      textarea.focus();
      // Place cursor at end of document for clean UX
      var len = textarea.value.length;
      textarea.setSelectionRange(len, len);
    });

    // Keep textarea height matching content so .tv-scroll handles the scroll
    function autoResize() {
      textarea.style.height = "auto";
      textarea.style.height = textarea.scrollHeight + "px";
    }
    autoResize();

    // Update word count display in the toolbar
    function updateMeta(src) {
      var metaEl = null;
      // Walk up to the .tv-viewer then look across to .tv-edit-toolbar
      var viewer = rootEl.closest ? rootEl.closest(".tv-viewer") : null;
      if (!viewer && rootEl.parentElement) {
        // rootEl might already be .tv-viewer or higher
        viewer = rootEl.querySelector ? rootEl : null;
      }
      // Try to find .tv-edit-meta in the document (it lives outside .tv-viewer)
      metaEl = document.querySelector(".tv-edit-meta");
      if (metaEl) {
        metaEl.textContent = wordCount(src) + " words";
      }
    }

    // Rebuild the syntax gutter backdrop from current textarea content.
    // We do this on input to keep line numbers and syntax accurate.
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

    function onInput() {
      var src = textarea.value;
      tab.source = src;
      tab.dirty = true;
      // Notify shell via TV.markDirty if available
      if (window.TV && typeof window.TV.markDirty === "function") {
        window.TV.markDirty(tab.id, true);
      }
      updateMeta(src);
      updateBackdrop(src);
      autoResize();
    }

    // Tab key: insert literal tab (4 spaces) rather than focus-jumping
    function onKeydown(e) {
      if (e.key === "Tab") {
        e.preventDefault();
        var start = textarea.selectionStart;
        var end = textarea.selectionEnd;
        var val = textarea.value;
        var indent = "    "; // 4 spaces
        textarea.value = val.slice(0, start) + indent + val.slice(end);
        textarea.setSelectionRange(start + indent.length, start + indent.length);
        onInput(); // keep state in sync
      }
    }

    textarea.addEventListener("input", onInput);
    textarea.addEventListener("keydown", onKeydown);

    return function cleanup() {
      textarea.removeEventListener("input", onInput);
      textarea.removeEventListener("keydown", onKeydown);
    };
  }

  // ── applySave ────────────────────────────────────────────
  // Shell calls this on ⌘S. Delegates to TVFiles if available and tab has a
  // fileHandle; otherwise marks not-dirty (in-memory save).
  function applySave(tab) {
    if (!tab) return;
    if (tab.fileHandle && window.TVFiles && typeof window.TVFiles.writeFile === "function") {
      window.TVFiles.writeFile(tab.fileHandle, tab.source)
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
      // In-memory save: just clear dirty flag
      tab.dirty = false;
      if (window.TV && typeof window.TV.markDirty === "function") {
        window.TV.markDirty(tab.id, false);
      }
      if (window.TV && typeof window.TV.render === "function") {
        window.TV.render();
      }
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
