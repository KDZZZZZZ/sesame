(() => {
  'use strict';

  const MAX_INPUT = 16000;
  const MAX_DEPTH = 8;
  const ALLOWED_PROTOCOLS = new Set(['http:', 'https:', 'mailto:']);

  const blockStart = line => /^(?:#{1,6}\s+| {0,3}(?:[-*_]\s*){3,}$| {0,3}(?:```|~~~)| {0,3}>| {0,3}(?:[-+*]|\d+[.)])\s+)/.test(line);
  const text = value => document.createTextNode(value ?? '');
  const el = (tag, className) => {
    const node = document.createElement(tag);
    if (className) node.className = className;
    return node;
  };

  function safeUrl(raw) {
    const value = String(raw ?? '').trim();
    if (!value || value.startsWith('//') || !/^[a-z][\w+.-]*:/i.test(value)) return null;
    try {
      const url = new URL(value);
      if (!ALLOWED_PROTOCOLS.has(url.protocol)) return null;
      return value;
    } catch {
      return null;
    }
  }

  function appendInline(parent, source, depth = 0) {
    if (!source) return;
    if (depth > MAX_DEPTH) {
      parent.append(text(source));
      return;
    }
    let index = 0, pending = '';
    const flush = () => {
      if (pending) parent.append(text(pending));
      pending = '';
    };
    const literal = value => { pending += value; };
    const escaped = '\\`*_{}[]()#+-.!|~>';
    while (index < source.length) {
      const rest = source.slice(index);
      if (source[index] === '\\' && source[index + 1] && escaped.includes(source[index + 1])) {
        literal(source[index + 1]);
        index += 2;
        continue;
      }
      const code = /^(`+)([\s\S]*?)\1/.exec(rest);
      if (code) {
        flush();
        const node = el('code', 'md-inline-code');
        node.textContent = code[2];
        parent.append(node);
        index += code[0].length;
        continue;
      }
      const imageOrLink = rest.startsWith('![') || rest.startsWith('[');
      if (imageOrLink) {
        const image = rest.startsWith('!['), labelStart = image ? 2 : 1;
        const labelEnd = rest.indexOf(']', labelStart);
        if (labelEnd > labelStart && rest[labelEnd + 1] === '(') {
          const urlEnd = rest.indexOf(')', labelEnd + 2);
          if (urlEnd > labelEnd + 2) {
            const label = rest.slice(labelStart, labelEnd);
            const target = rest.slice(labelEnd + 2, urlEnd).trim();
            const match = /^(\S+)(?:\s+["']([^"']*)["'])?$/.exec(target);
            const href = match ? safeUrl(match[1]) : null;
            flush();
            if (image) {
              const fallback = el(href ? 'a' : 'span', 'md-image-alt');
              fallback.textContent = label ? `[image: ${label}]` : '[image]';
              if (href) {
                fallback.href = href;
                fallback.target = '_blank';
                fallback.rel = 'noopener noreferrer';
                if (match[2]) fallback.title = match[2];
              }
              parent.append(fallback);
            } else if (href) {
              const anchor = el('a');
              anchor.href = href;
              anchor.target = '_blank';
              anchor.rel = 'noopener noreferrer';
              if (match[2]) anchor.title = match[2];
              appendInline(anchor, label, depth + 1);
              parent.append(anchor);
            } else {
              parent.append(text(label));
            }
            index += urlEnd + 1;
            continue;
          }
        }
      }
      const paired = [
        ['**', 'strong'], ['__', 'strong'], ['~~', 's'], ['*', 'em'], ['_', 'em'],
      ].find(([marker]) => rest.startsWith(marker));
      if (paired) {
        const [marker, tag] = paired;
        const close = rest.indexOf(marker, marker.length);
        const before = source[index - 1] ?? '';
        const after = rest[marker.length] ?? '';
        const intrawordUnderscore = marker === '_' && /\w/.test(before) && /\w/.test(after);
        if (!intrawordUnderscore && close > marker.length) {
          flush();
          const node = el(tag);
          appendInline(node, rest.slice(marker.length, close), depth + 1);
          parent.append(node);
          index += close + marker.length;
          continue;
        }
      }
      literal(source[index]);
      index++;
    }
    flush();
  }

  function paragraph(lines) {
    const node = el('p');
    lines.forEach((line, index) => {
      if (index) node.append(el('br'));
      appendInline(node, line);
    });
    return node;
  }

  function codeBlock(lines, start) {
    const open = /^( {0,3})(```|~~~)\s*([\w.+#-]*)/.exec(lines[start]);
    const fence = open[2], language = open[3] ?? '';
    let end = start + 1;
    while (end < lines.length && !new RegExp(`^ {0,3}${fence}`).test(lines[end])) end++;
    const figure = el('figure', 'md-code-block');
    if (language) {
      const label = el('figcaption', 'md-code-language');
      label.textContent = language;
      figure.append(label);
    }
    const pre = el('pre'), code = el('code');
    if (language) code.className = `language-${language}`;
    code.textContent = lines.slice(start + 1, end).join('\n');
    pre.append(code);
    figure.append(pre);
    return { node: figure, next: end < lines.length ? end + 1 : end };
  }

  function table(lines, start) {
    const split = splitTableRow, headers = split(lines[start]), divider = split(lines[start + 1] ?? '');
    if (headers.length < 2 || divider.length < 2 || !divider.every(cell => /^:?-{3,}:?$/.test(cell.trim()))) return null;
    const aligns = divider.map(cell => cell.startsWith(':') && cell.endsWith(':') ? 'center' : cell.endsWith(':') ? 'right' : cell.startsWith(':') ? 'left' : '');
    let next = start + 2;
    const rows = [];
    while (next < lines.length && split(lines[next]).length > 1 && lines[next].trim()) rows.push(split(lines[next++]));
    const wrapper = el('div', 'md-table-wrap'), tableNode = el('table'), thead = el('thead'), headRow = el('tr'), tbody = el('tbody');
    headers.forEach((cell, index) => {
      const th = el('th');
      if (aligns[index]) th.style.textAlign = aligns[index];
      appendInline(th, cell);
      headRow.append(th);
    });
    thead.append(headRow);
    rows.forEach(row => {
      const tr = el('tr');
      headers.forEach((_header, index) => {
        const td = el('td');
        if (aligns[index]) td.style.textAlign = aligns[index];
        appendInline(td, row[index] ?? '');
        tr.append(td);
      });
      tbody.append(tr);
    });
    tableNode.append(thead, tbody);
    wrapper.append(tableNode);
    return { node: wrapper, next };
  }

  function splitTableRow(line) {
    const cells = [];
    let value = '', index = 0, codeFence = '';
    let input = String(line ?? '').trim();
    if (input.startsWith('|')) input = input.slice(1);
    if (input.endsWith('|') && !isEscaped(input, input.length - 1)) input = input.slice(0, -1);
    while (index < input.length) {
      const char = input[index];
      if (char === '\\' && input[index + 1]) {
        value += input[index + 1] === '|' ? '|' : char + input[index + 1];
        index += 2;
        continue;
      }
      if (char === '`') {
        const match = /^`+/.exec(input.slice(index))[0];
        if (!codeFence) codeFence = match;
        else if (match === codeFence) codeFence = '';
        value += match;
        index += match.length;
        continue;
      }
      if (char === '|' && !codeFence) {
        cells.push(value.trim());
        value = '';
        index++;
        continue;
      }
      value += char;
      index++;
    }
    cells.push(value.trim());
    return cells;
  }

  function isEscaped(value, index) {
    let slashes = 0;
    for (let cursor = index - 1; cursor >= 0 && value[cursor] === '\\'; cursor--) slashes++;
    return slashes % 2 === 1;
  }

  function list(lines, start, depth) {
    const first = /^( *)([-+*]|\d+[.)])\s+(.*)$/.exec(lines[start]);
    if (!first) return null;
    const ordered = /\d/.test(first[2]), base = first[1].length, root = el(ordered ? 'ol' : 'ul');
    if (ordered) root.start = Number.parseInt(first[2], 10);
    let index = start;
    while (index < lines.length) {
      const current = /^( *)([-+*]|\d+[.)])\s+(.*)$/.exec(lines[index]);
      if (!current || current[1].length !== base || /\d/.test(current[2]) !== ordered) break;
      const itemLines = [current[3]];
      index++;
      while (index < lines.length) {
        const next = /^( *)([-+*]|\d+[.)])\s+(.*)$/.exec(lines[index]);
        if (next && next[1].length <= base) break;
        if (!next && lines[index].slice(0, base + 1).trim()) break;
        if (!lines[index].trim()) {
          const afterBlank = lines[index + 1] ?? '';
          const nested = /^( *)([-+*]|\d+[.)])\s+/.exec(afterBlank);
          if (!nested || nested[1].length <= base) break;
        }
        if (!next && lines[index].slice(0, base + 1).trim() && (blockStart(lines[index]) || table(lines, index))) break;
        itemLines.push(lines[index].slice(Math.min(lines[index].length, base + 2)));
        index++;
      }
      const item = el('li');
      const task = /^\s*\[([ xX])]\s+/.exec(itemLines[0]);
      if (task) {
        const input = el('input');
        input.type = 'checkbox';
        input.disabled = true;
        input.checked = task[1].toLowerCase() === 'x';
        item.className = 'md-task';
        item.append(input);
        itemLines[0] = itemLines[0].slice(task[0].length);
      }
      renderBlocks(item, itemLines.join('\n'), depth + 1);
      root.append(item);
    }
    return { node: root, next: index };
  }

  function quote(lines, start, depth) {
    const quoted = [];
    let index = start;
    while (index < lines.length && /^ {0,3}>/.test(lines[index])) {
      quoted.push(lines[index].replace(/^ {0,3}> ?/, ''));
      index++;
    }
    const node = el('blockquote');
    renderBlocks(node, quoted.join('\n'), depth + 1);
    return { node, next: index };
  }

  function renderBlocks(container, source, depth = 0) {
    if (depth > MAX_DEPTH) {
      container.append(text(source));
      return;
    }
    const lines = String(source ?? '').replace(/\r\n?/g, '\n').split('\n');
    let index = 0;
    while (index < lines.length) {
      if (!lines[index].trim()) {
        index++;
        continue;
      }
      if (/^ {0,3}(?:```|~~~)/.test(lines[index])) {
        const result = codeBlock(lines, index);
        container.append(result.node);
        index = result.next;
        continue;
      }
      const heading = /^(#{1,6})\s+(.+)$/.exec(lines[index]);
      if (heading) {
        const node = el(`h${heading[1].length}`);
        appendInline(node, heading[2]);
        container.append(node);
        index++;
        continue;
      }
      if (/^ {0,3}(?:[-*_]\s*){3,}$/.test(lines[index])) {
        container.append(el('hr'));
        index++;
        continue;
      }
      if (/^ {0,3}>/.test(lines[index])) {
        const result = quote(lines, index, depth);
        container.append(result.node);
        index = result.next;
        continue;
      }
      const tableResult = table(lines, index);
      if (tableResult) {
        container.append(tableResult.node);
        index = tableResult.next;
        continue;
      }
      const listResult = list(lines, index, depth);
      if (listResult) {
        container.append(listResult.node);
        index = listResult.next;
        continue;
      }
      const para = [];
      while (index < lines.length && lines[index].trim() && !blockStart(lines[index]) && !table(lines, index)) para.push(lines[index++]);
      if (!para.length) para.push(lines[index++]);
      container.append(paragraph(para));
    }
  }

  function render(container, input) {
    if (!container || typeof container.replaceChildren !== 'function') throw new TypeError('SesameMarkdown.render requires a DOM container.');
    const source = String(input ?? '');
    const trimmed = source.length > MAX_INPUT ? `${source.slice(0, MAX_INPUT)}\n\n…` : source;
    const root = el('div', 'sesame-markdown');
    renderBlocks(root, trimmed);
    container.replaceChildren(...root.childNodes);
    return container;
  }

  window.SesameMarkdown = Object.freeze({
    render,
    supported: 'Safe offline subset: headings, paragraphs, emphasis, strong, strike, inline code, fenced code with labels, nested ordered/unordered/task lists, blockquotes, thematic breaks, http/https/mailto links, GFM-style tables, and image fallbacks. Raw HTML is text.',
  });
})();
