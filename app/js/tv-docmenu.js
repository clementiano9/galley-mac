/* ───────────────────────────────────────────────────────────
   Galley · document context menu helpers  (DOC-MENU)
   window.TVDocMenu = { toMarkdown(node), selectionMarkdown(sel), resolveLink(href, docPath) }

   The menu itself is WebKit's native one, edited in lib.rs (willOpenMenu);
   its Galley items arrive as the `doc-menu` event and tv-app.js runs them.
   This module holds the pure parts so node tests can drive them:
     · toMarkdown — serialise rendered document HTML (tv-markdown.js output)
       back to markdown for "Copy as Markdown";
     · resolveLink — what a link in a document points at.
   ─────────────────────────────────────────────────────────── */
(function (root, factory) {
  var api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) root.TVDocMenu = api;
}(typeof window !== 'undefined' ? window : this, function () {
  'use strict';

  var BLOCK = /^(P|H[1-6]|UL|OL|LI|BLOCKQUOTE|PRE|TABLE|HR|FIGURE|DIV|SECTION|DETAILS|SUMMARY)$/;

  function attr(n, k) { return (n.getAttribute && n.getAttribute(k)) || ''; }
  function hasClass(n, c) { return !!(n.classList && n.classList.contains(c)); }
  function kids(n) { return Array.prototype.slice.call(n.childNodes || []); }

  function inlineOf(n) {
    return kids(n).map(inline).join('').replace(/[ \t]*\n[ \t]*/g, ' ').replace(/ {2,}/g, ' ');
  }

  function inline(n) {
    if (n.nodeType === 3) return n.nodeValue || '';
    if (n.nodeType !== 1 && n.nodeType !== 11) return '';
    var tag = n.nodeName;
    if (tag === 'BUTTON' || tag === 'svg' || tag === 'SVG') return '';
    if (tag === 'BR') return '\u0001'; // hard break; written out by toMarkdown
    if (tag === 'STRONG' || tag === 'B') return wrap('**', inlineOf(n));
    if (tag === 'EM' || tag === 'I') return wrap('*', inlineOf(n));
    if (tag === 'DEL' || tag === 'S') return wrap('~~', inlineOf(n));
    if (tag === 'CODE') return '`' + (n.textContent || '') + '`';
    if (tag === 'KBD') return '<kbd>' + (n.textContent || '') + '</kbd>';
    if (tag === 'IMG') return '![' + attr(n, 'alt') + '](' + (attr(n, 'data-img-raw-src') || attr(n, 'src')) + ')';
    if (tag === 'SUP' && n.querySelector && n.querySelector('[data-footnote-ref]')) {
      var ref = n.querySelector('[data-footnote-ref]');
      return '[^' + attr(ref, 'href').replace(/^#fn-/, '') + ']';
    }
    if (tag === 'A') {
      if (n.hasAttribute && n.hasAttribute('data-footnote-backref')) return '';
      var text = inlineOf(n), href = attr(n, 'href');
      if (!href) return text;
      return text === href ? '<' + href + '>' : '[' + text + '](' + href + ')';
    }
    return inlineOf(n);
  }

  function wrap(mark, s) {
    var m = /^(\s*)([\s\S]*?)(\s*)$/.exec(s);
    return m[2] ? m[1] + mark + m[2] + mark + m[3] : s;
  }

  function decodeDiagram(n) {
    try { return decodeURIComponent(escape(atob(attr(n, 'data-mermaid')))); } catch (e) { return ''; }
  }

  // Block-level serialisation. Returns markdown blocks separated by blank lines.
  // sep: '\n\n' between blocks, '\n' inside a tight list item.
  function blocks(n, sep) {
    var out = [], run = '';
    function flush() { if (run.trim()) out.push(run.trim()); run = ''; }
    kids(n).forEach(function (c) {
      if (c.nodeType === 1 && BLOCK.test(c.nodeName)) {
        flush();
        var b = block(c);
        if (b) out.push(b);
      } else {
        run += inline(c);
      }
    });
    flush();
    return out.join(sep || '\n\n');
  }

  function block(n) {
    var tag = n.nodeName;
    if (/^H[1-6]$/.test(tag)) return new Array(+tag[1] + 1).join('#') + ' ' + inlineOf(n).trim();
    if (tag === 'P' || tag === 'SUMMARY') return inlineOf(n).trim();
    if (tag === 'HR') return n.hasAttribute && n.hasAttribute('data-footnotes') ? '' : '---';
    if (tag === 'PRE') {
      var code = n.querySelector ? n.querySelector('code') : null;
      var body = (code || n).textContent.replace(/\n$/, '');
      var fence = /```/.test(body) ? '````' : '```';
      return fence + attr(n, 'data-lang') + '\n' + body + '\n' + fence;
    }
    if (tag === 'BLOCKQUOTE') return blocks(n).split('\n').map(function (l) { return l ? '> ' + l : '>'; }).join('\n');
    if (tag === 'UL' || tag === 'OL') return list(n);
    if (tag === 'LI') return list({ nodeName: 'UL', childNodes: [n], getAttribute: function () { return ''; } });
    if (tag === 'TABLE') return table(n);
    if (tag === 'FIGURE') {
      var img = n.querySelector ? n.querySelector('img') : null;
      return img ? inline(img) : '';
    }
    if (tag === 'DIV' && hasClass(n, 'tv-diagram')) return '```mermaid\n' + decodeDiagram(n) + '\n```';
    if (tag === 'SECTION' && n.hasAttribute && n.hasAttribute('data-footnotes')) {
      // A note's later paragraphs indent four spaces to stay in the note.
      return kids(n.querySelector ? n.querySelector('ol') || n : n).filter(function (li) { return li.nodeName === 'LI'; })
        .map(function (li) {
          return '[^' + attr(li, 'id').replace(/^fn-/, '') + ']: ' +
            blocks(li).trim().split('\n').map(function (l, i) { return i && l ? '    ' + l : l; }).join('\n');
        })
        .join('\n');
    }
    return blocks(n);
  }

  function list(n) {
    var ordered = n.nodeName === 'OL';
    var num = parseInt(attr(n, 'start'), 10) || 1;
    var taskList = hasClass(n, 'task');
    var items = kids(n).filter(function (li) { return li.nodeName === 'LI'; });
    // A loose list (items hold <p>) keeps blank lines between its items.
    var loose = items.some(function (li) {
      var c = (li.querySelector && li.querySelector('.task-body')) || li;
      return kids(c).some(function (k) { return k.nodeName === 'P'; });
    });
    return items.map(function (li) {
      var marker = ordered ? (num++) + '. ' : '- ';
      // Continuation lines indent to the content column, which starts after
      // "- " / "1. " (a task's [ ] is part of the content).
      var pad = new Array(marker.length + 1).join(' ');
      var content = li;
      if (taskList || hasClass(li, 'task')) {
        var box = li.querySelector ? li.querySelector('.box') : null;
        marker += '[' + (box && hasClass(box, 'done') ? 'x' : ' ') + '] ';
        content = (li.querySelector && li.querySelector('.task-body')) || li;
      }
      var body = blocks(content, loose ? '\n\n' : '\n').split('\n')
        .map(function (l, i) { return i === 0 || !l ? l : pad + l; }).join('\n');
      return marker + body;
    }).join(loose ? '\n\n' : '\n');
  }

  function table(n) {
    var rows = n.querySelectorAll ? Array.prototype.slice.call(n.querySelectorAll('tr')) : [];
    if (!rows.length) return '';
    function cells(tr) {
      return kids(tr).filter(function (c) { return c.nodeName === 'TH' || c.nodeName === 'TD'; });
    }
    function line(tr) {
      return '| ' + cells(tr).map(function (c) { return inlineOf(c).trim().replace(/\|/g, '\\|'); }).join(' | ') + ' |';
    }
    var head = cells(rows[0]);
    var sep = '| ' + head.map(function (c) {
      var a = ((c.style && c.style.textAlign) || attr(c, 'align') || '').toLowerCase();
      return a === 'center' ? ':---:' : a === 'right' ? '---:' : '---';
    }).join(' | ') + ' |';
    return [line(rows[0]), sep].concat(rows.slice(1).map(line)).join('\n');
  }

  function toMarkdown(node) {
    return blocks(node).replace(/ ?\u0001 ?/g, '\\\n').replace(/\n{3,}/g, '\n\n').trim();
  }

  function fragmentOf(node) { return { nodeType: 11, childNodes: [node] }; }

  // The markdown of the current selection. Inside a code block or an inline
  // code span the selected text keeps its code formatting.
  function selectionMarkdown(sel) {
    if (!sel || !sel.rangeCount || sel.isCollapsed) return '';
    var range = sel.getRangeAt(0);
    var anc = range.commonAncestorContainer;
    var el = anc.nodeType === 1 ? anc : anc.parentNode;
    var pre = el && el.closest ? el.closest('pre') : null;
    if (pre) return '```' + attr(pre, 'data-lang') + '\n' + sel.toString().replace(/\n$/, '') + '\n```';
    var code = el && el.closest ? el.closest('code') : null;
    if (code) return '`' + sel.toString() + '`';
    var frag = range.cloneContents();
    var top = kids(frag).filter(function (c) { return c.nodeType === 1; });
    // Across list items the clone holds bare <li>s: give them back their list
    // (type, task class, and the number the first selected item had).
    var list = el && el.closest ? el.closest('ul, ol') : null;
    if (list && top.length && top.every(function (c) { return c.nodeName === 'LI'; })) {
      var start = firstSelectedNumber(list, range);
      return toMarkdown(fragmentOf({
        nodeType: 1, nodeName: list.nodeName, childNodes: top, classList: list.classList,
        getAttribute: function (k) { return k === 'start' ? String(start) : list.getAttribute(k); }
      }));
    }
    // Across table rows the clone holds bare rows: keep them a table, with the
    // header row when it was not selected.
    var table = el && el.closest ? el.closest('table') : null;
    if (table && frag.querySelector && frag.querySelector('tr')) {
      var rows = Array.prototype.slice.call(frag.querySelectorAll('tr'));
      var head = table.querySelector('thead tr');
      if (head && !frag.querySelector('th')) rows.unshift(head);
      return toMarkdown(fragmentOf({ nodeType: 1, nodeName: 'TABLE', childNodes: [], querySelectorAll: function () { return rows; } }));
    }
    // A selection that starts inside an ordered list and runs past it clones
    // that list without its numbering: restore the first selected number.
    if (top[0] && top[0].nodeName === 'OL' && top[0].setAttribute) {
      var n0 = range.startContainer;
      while (n0 && n0.parentNode !== el) n0 = n0.parentNode;
      if (n0 && n0.nodeName === 'OL') top[0].setAttribute('start', String(firstSelectedNumber(n0, range)));
    }
    return toMarkdown(frag);
  }

  // The number shown on the first item of `list` that the range touches.
  function firstSelectedNumber(list, range) {
    var items = Array.prototype.filter.call(list.children, function (c) { return c.nodeName === 'LI'; });
    var i = 0;
    while (i < items.length && !range.intersectsNode(items[i])) i++;
    return (parseInt(attr(list, 'start'), 10) || 1) + (i < items.length ? i : 0);
  }

  // What a document link points at: { kind: 'web' | 'mail' | 'anchor' |
  // 'doc' | 'file' | 'none', url?, path?, hash? }. docPath = the open file's
  // absolute path; relative links resolve against its folder.
  var DOC_EXT = /\.(md|markdown|mdown|mkd|mdx|mdc|txt)$/i;
  function resolveLink(href, docPath) {
    href = String(href || '').trim();
    if (!href) return { kind: 'none' };
    if (href.charAt(0) === '#') return { kind: 'anchor', hash: href.slice(1) };
    if (/^https?:/i.test(href)) return { kind: 'web', url: href };
    if (/^mailto:/i.test(href)) return { kind: 'mail', url: href };
    if (/^[a-z][a-z0-9+.-]*:/i.test(href)) return { kind: 'none' };
    var m = /^([^?#]*)(?:\?[^#]*)?(?:#(.*))?$/.exec(href);
    var rel = m[1];
    try { rel = decodeURIComponent(rel); } catch (e) { /* keep */ }
    if (!rel) return { kind: 'anchor', hash: m[2] || '' };
    var base = rel.charAt(0) === '/' ? '' : String(docPath || '').replace(/\/[^/]*$/, '');
    if (!base && rel.charAt(0) !== '/') return { kind: 'none' };
    var parts = (base + '/' + rel).split('/'), outParts = [];
    parts.forEach(function (p) {
      if (!p || p === '.') return;
      if (p === '..') outParts.pop(); else outParts.push(p);
    });
    var path = '/' + outParts.join('/');
    return { kind: DOC_EXT.test(path) ? 'doc' : 'file', path: path, hash: m[2] || '' };
  }

  return { toMarkdown: toMarkdown, selectionMarkdown: selectionMarkdown, resolveLink: resolveLink };
}));
