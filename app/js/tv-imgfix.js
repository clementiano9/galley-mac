/* ───────────────────────────────────────────────────────────
   Galley · post-render image path resolver
   Exposes: window.tvResolveImages(rootEl, docPath)

   After tvRenderMarkdown() injects HTML, relative <img> elements carry
   only data-img-raw-src (no src attribute) so the browser cannot pre-fetch
   against the page URL before resolution. Absolute srcs (http/https/
   data:image/blob:) already have their src set by the renderer.

   This module:
   1. Reads data-img-raw-src for each img that has no src yet.
   2. Resolves relative paths to an absolute URL:
        - Browser mode: against docPath (e.g. 'http://localhost:8768/sample-docs/')
        - Tauri mode:   via window.__TAURI__.core.convertFileSrc(absPath)
   3. Sets img.src via DOM (never via innerHTML/string HTML).
   4. Wires onerror via DOM after src is set, avoiding false broken-states
      from the placeholder phase (no-src images don't fire onerror).

   The module is idempotent: imgs that already have a non-empty src are
   skipped. Calling it again on the same rootEl is safe.
   ─────────────────────────────────────────────────────────── */
(function () {
  'use strict';

  /* ── helpers ─────────────────────────────────────────────── */

  // True if the URL already has an explicit scheme (absolute).
  function hasScheme(src) {
    return /^[a-zA-Z][a-zA-Z0-9+\-.]*:/.test(src);
  }

  // Resolve a relative src against a base directory URL string.
  function resolveAgainstBase(src, baseUrl) {
    try {
      return new URL(src, baseUrl).href;
    } catch (e) {
      return null;
    }
  }

  // Convert an absolute filesystem path to an asset:// URL via Tauri's
  // convertFileSrc. Returns null on failure.
  function toAssetUrl(absPath) {
    try {
      var core = window.__TAURI__ && window.__TAURI__.core;
      if (core && typeof core.convertFileSrc === 'function') {
        return core.convertFileSrc(absPath);
      }
      // Tauri v1 fallback
      var tauri = window.__TAURI__ && window.__TAURI__.tauri;
      if (tauri && typeof tauri.convertFileSrc === 'function') {
        return tauri.convertFileSrc(absPath);
      }
    } catch (e) { /* fall through */ }
    return null;
  }

  // Extract parent directory from an absolute fs path, with trailing slash.
  function nativeParentDir(nativePath) {
    if (!nativePath) return null;
    var idx = nativePath.lastIndexOf('/');
    if (idx < 0) return null;
    return nativePath.slice(0, idx + 1);
  }

  /* ── C-26: overflow cue for wide blocks ───────────────────────
     .md pre / .md .tbl-wrap are already horizontally scrollable
     (overflow-x:auto) but give no sign that there is more content off to
     the right — a clipped line just stops. We only track WHETHER there is
     more to scroll (data-overflow="1"); the right-edge fade itself is CSS
     (appended block, owner: modules). Re-evaluated on resize (ResizeObserver)
     and on scroll, so the cue correctly clears once the user reaches the
     right edge instead of lying there forever. One observer per rendered
     document — disconnected before the next render's elements are set up. */
  var _overflowObserver = null;
  var _overflowScrollEls = [];

  function _clearOverflowCues() {
    if (_overflowObserver) { _overflowObserver.disconnect(); _overflowObserver = null; }
    _overflowScrollEls.forEach(function (rec) {
      rec.el.removeEventListener('scroll', rec.handler);
    });
    _overflowScrollEls = [];
  }

  function _updateOverflowAttr(el) {
    var remaining = el.scrollWidth - el.scrollLeft - el.clientWidth;
    if (remaining > 1) {
      el.setAttribute('data-overflow', '1');
    } else {
      el.removeAttribute('data-overflow');
    }
  }

  function _setupOverflowCues(rootEl) {
    if (!rootEl) return;
    _clearOverflowCues(); // disconnect the previous render's observer first
    var targets = rootEl.querySelectorAll('.md pre, .md .tbl-wrap');
    if (!targets.length) return;

    var hasRO = typeof window.ResizeObserver === 'function';
    if (hasRO) {
      _overflowObserver = new ResizeObserver(function (entries) {
        entries.forEach(function (entry) { _updateOverflowAttr(entry.target); });
      });
    }

    Array.prototype.forEach.call(targets, function (el) {
      _updateOverflowAttr(el); // initial state
      if (hasRO) _overflowObserver.observe(el);
      var handler = function () { _updateOverflowAttr(el); };
      el.addEventListener('scroll', handler);
      _overflowScrollEls.push({ el: el, handler: handler });
    });
  }

  // Wire the broken-image handler onto an img after its src is set.
  // For block images the figure parent gets .tv-img-missing.
  // For inline images the img itself gets .tv-img-broken.
  function wireOnerror(img) {
    var figure = img.parentNode && img.parentNode.classList &&
                 img.parentNode.classList.contains('md-img') ? img.parentNode : null;
    if (figure) {
      img.onerror = function () {
        figure.classList.add('tv-img-missing');
      };
    } else {
      img.onerror = function () {
        img.classList.add('tv-img-broken');
      };
    }
  }

  /* ── main resolver ───────────────────────────────────────── */

  // rootEl   — the element to search for images (typically .tv-content)
  // docPath  — document base path:
  //   Browser mode: sidebar group path (e.g. '/sample-docs') or full URL
  //   Tauri mode:   tab.nativePath (absolute fs path of the .md file)
  function tvResolveImages(rootEl, docPath) {
    if (!rootEl) return;

    // C-26: this is the post-render hook the shell already calls once per
    // render regardless of whether the document has images, so it doubles
    // as the wiring point for the overflow cue. Must run BEFORE the
    // images-empty early return below, or an image-less document with a
    // wide code block would never get the cue.
    _setupOverflowCues(rootEl);

    // Only target imgs that have data-img-raw-src but NO src yet.
    // Absolute srcs were set by the renderer and are skipped here.
    var imgs = rootEl.querySelectorAll('img[data-img-raw-src]');
    if (!imgs.length) return;

    var isTauri = !!(window.TVNative && window.TVNative.available);

    // ── Tauri mode ────────────────────────────────────────────
    if (isTauri) {
      var nativeDir = nativeParentDir(docPath || '');

      Array.prototype.forEach.call(imgs, function (img) {
        // Skip if src already resolved (absolute src set by renderer or prior call)
        if (img.getAttribute('src')) return;

        var rawSrc = img.getAttribute('data-img-raw-src') || '';
        if (!rawSrc || hasScheme(rawSrc)) {
          // Absolute or data: — set src directly (these were emitted by renderer)
          if (rawSrc) {
            img.setAttribute('src', rawSrc);
            wireOnerror(img);
          }
          return;
        }

        if (!nativeDir) return; // no path context, can't resolve

        // Build the absolute fs path
        var absPath;
        if (rawSrc.slice(0, 2) === './') {
          absPath = nativeDir + rawSrc.slice(2);
        } else if (rawSrc.slice(0, 3) === '../') {
          try {
            absPath = new URL('file://' + nativeDir + rawSrc).pathname;
          } catch (e) {
            absPath = nativeDir + rawSrc;
          }
        } else {
          absPath = nativeDir + rawSrc;
        }

        // R8-FIX: path traversal guard. After resolving the absolute path, refuse to
        // serve it if it escapes the document's directory (e.g. ../../etc/passwd).
        // nativeDir always ends with '/' (guaranteed by nativeParentDir()), so a
        // simple prefix check is sufficient. Fire the missing-image state instead.
        if (absPath.indexOf(nativeDir) !== 0) {
          wireOnerror(img);
          if (img.onerror) img.onerror();
          return;
        }

        var assetUrl = toAssetUrl(absPath);
        if (assetUrl) {
          img.setAttribute('src', assetUrl);
          wireOnerror(img);
        }
      });
      return;
    }

    // ── Browser mode ──────────────────────────────────────────
    // Build a base URL from docPath (e.g. '/sample-docs' → 'http://localhost:8770/sample-docs/')
    var baseUrl = null;
    if (docPath) {
      if (/^https?:\/\//.test(docPath)) {
        baseUrl = docPath.replace(/\/?$/, '/');
      } else {
        var origin = window.location.origin;
        var p = docPath.replace(/\/?$/, '/');
        if (p.charAt(0) !== '/') p = '/' + p;
        baseUrl = origin + p;
      }
    }
    if (!baseUrl) {
      baseUrl = window.location.href.replace(/\/[^/]*$/, '/');
    }

    Array.prototype.forEach.call(imgs, function (img) {
      // Skip already-resolved (absolute srcs set by renderer)
      if (img.getAttribute('src')) return;

      var rawSrc = img.getAttribute('data-img-raw-src') || '';
      if (!rawSrc) return;

      if (hasScheme(rawSrc)) {
        // Absolute URL: just set it (these were emitted by renderer already but
        // guard here in case something slipped through without src attribute)
        img.setAttribute('src', rawSrc);
        wireOnerror(img);
        return;
      }

      // Relative: resolve against document base
      var resolved = resolveAgainstBase(rawSrc, baseUrl);
      if (resolved) {
        img.setAttribute('src', resolved);
        wireOnerror(img);
      } else {
        // Resolution failed (bad base/src) — surface the missing state
        // instead of leaving a silent srcless img.
        wireOnerror(img);
        if (img.onerror) img.onerror();
      }
    });
  }

  window.tvResolveImages = tvResolveImages;
})();
