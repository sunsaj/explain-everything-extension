const FENCE_PATTERN = /^\s{0,3}((?:\x60){3,}|~{3,})\s*([A-Za-z0-9_+.-]*)\s*$/;
const HEADING_PATTERN = /^\s{0,3}(#{1,6})\s+(.+?)\s*#*\s*$/;
const LIST_PATTERN = /^(\s*)([-+*]|\d+[.)])\s+(.+)$/;
const QUOTE_PATTERN = /^\s{0,3}>\s?(.*)$/;
const HORIZONTAL_RULE_PATTERN = /^\s{0,3}(?:(?:-\s*){3,}|(?:\*\s*){3,}|(?:_\s*){3,})$/;

function appendText(parent, value, documentRef) {
  if (value) parent.append(documentRef.createTextNode(value));
}

function safeLink(rawValue) {
  try {
    const url = new URL(String(rawValue).trim());
    if (!["http:", "https:"].includes(url.protocol)) return null;
    if (url.username || url.password) return null;
    return url.href;
  } catch {
    return null;
  }
}

function createLink(label, href, documentRef) {
  const safeHref = safeLink(href);
  if (!safeHref) return null;
  const anchor = documentRef.createElement("a");
  anchor.setAttribute("href", safeHref);
  anchor.setAttribute("target", "_blank");
  anchor.setAttribute("rel", "noopener noreferrer nofollow");
  appendInline(anchor, label, documentRef);
  return anchor;
}

function findClosing(source, marker, fromIndex) {
  const closing = source.indexOf(marker, fromIndex);
  return closing > fromIndex ? closing : -1;
}

function nextSpecialIndex(source, fromIndex) {
  const specialCharacters = new Set(["\\", "\x60", "!", "[", "*", "_", "~", "<", "\n"]);
  let cursor = fromIndex;
  while (cursor < source.length && !specialCharacters.has(source[cursor])) cursor += 1;
  return cursor;
}

export function appendInline(parent, input, documentRef = document) {
  const source = String(input ?? "");
  let index = 0;

  while (index < source.length) {
    if (source[index] === "\\" && index + 1 < source.length) {
      appendText(parent, source[index + 1], documentRef);
      index += 2;
      continue;
    }

    if (source[index] === "\x60") {
      const closing = findClosing(source, "\x60", index + 1);
      if (closing !== -1) {
        const code = documentRef.createElement("code");
        code.className = "md-inline-code";
        code.textContent = source.slice(index + 1, closing);
        parent.append(code);
        index = closing + 1;
        continue;
      }
    }

    if (source.startsWith("![", index)) {
      const match = source.slice(index).match(/^!\[([^\]]*)\]\(([^)]+)\)/);
      if (match) {
        const replacement = documentRef.createElement("span");
        replacement.className = "md-image-alt";
        replacement.textContent = "Image: " + (match[1].trim() || "image");
        parent.append(replacement);
        index += match[0].length;
        continue;
      }
    }

    if (source[index] === "[") {
      const match = source.slice(index).match(/^\[([^\]]+)\]\(([^)]+)\)/);
      if (match) {
        const link = createLink(match[1], match[2], documentRef);
        if (link) parent.append(link);
        else appendInline(parent, match[1], documentRef);
        index += match[0].length;
        continue;
      }
    }

    if (source[index] === "<") {
      const match = source.slice(index).match(/^<(https?:\/\/[^\s>]+)>/i);
      if (match) {
        const link = createLink(match[1], match[1], documentRef);
        if (link) {
          parent.append(link);
          index += match[0].length;
          continue;
        }
      }
    }

    const pairedMarkers = [["**", "strong"], ["__", "strong"], ["~~", "del"]];
    let paired = false;
    for (const [marker, tagName] of pairedMarkers) {
      if (!source.startsWith(marker, index)) continue;
      const closing = findClosing(source, marker, index + marker.length);
      if (closing === -1) continue;
      const element = documentRef.createElement(tagName);
      appendInline(element, source.slice(index + marker.length, closing), documentRef);
      parent.append(element);
      index = closing + marker.length;
      paired = true;
      break;
    }
    if (paired) continue;

    if (source[index] === "*" || source[index] === "_") {
      const marker = source[index];
      const closing = findClosing(source, marker, index + 1);
      if (closing !== -1 && source.slice(index + 1, closing).trim()) {
        const emphasis = documentRef.createElement("em");
        appendInline(emphasis, source.slice(index + 1, closing), documentRef);
        parent.append(emphasis);
        index = closing + 1;
        continue;
      }
    }

    if (source[index] === "\n") {
      appendText(parent, " ", documentRef);
      index += 1;
      continue;
    }

    const next = nextSpecialIndex(source, index + 1);
    appendText(parent, source.slice(index, next), documentRef);
    index = next;
  }
}

function splitTableRow(line) {
  let value = String(line).trim();
  if (value.startsWith("|")) value = value.slice(1);
  if (value.endsWith("|")) value = value.slice(0, -1);
  const cells = [];
  let cell = "";
  let escaped = false;
  for (const character of value) {
    if (escaped) {
      cell += character;
      escaped = false;
    } else if (character === "\\") {
      escaped = true;
    } else if (character === "|") {
      cells.push(cell.trim());
      cell = "";
    } else {
      cell += character;
    }
  }
  cells.push(cell.trim());
  return cells;
}

function tableAlignments(separatorLine) {
  const cells = splitTableRow(separatorLine);
  if (!cells.length || cells.some((cell) => !/^:?-{3,}:?$/.test(cell.replace(/\s+/g, "")))) return null;
  return cells.map((cell) => {
    const compact = cell.replace(/\s+/g, "");
    if (compact.startsWith(":") && compact.endsWith(":")) return "center";
    if (compact.endsWith(":")) return "right";
    return "left";
  });
}

function isTableStart(lines, index) {
  return index + 1 < lines.length && lines[index].includes("|") && tableAlignments(lines[index + 1]) !== null;
}

function listMatch(line) {
  const match = String(line).match(LIST_PATTERN);
  if (!match) return null;
  return {
    indent: match[1].replace(/\t/g, "  ").length,
    ordered: /^\d/.test(match[2]),
    content: match[3]
  };
}

function isBlockStart(lines, index) {
  const line = lines[index] ?? "";
  return !line.trim() || FENCE_PATTERN.test(line) || HEADING_PATTERN.test(line)
    || QUOTE_PATTERN.test(line) || HORIZONTAL_RULE_PATTERN.test(line)
    || Boolean(listMatch(line)) || isTableStart(lines, index);
}

function appendList(parent, lines, startIndex, documentRef, baseIndent) {
  const first = listMatch(lines[startIndex]);
  const list = documentRef.createElement(first.ordered ? "ol" : "ul");
  let index = startIndex;
  let lastItem = null;

  while (index < lines.length) {
    const item = listMatch(lines[index]);
    if (!item || item.indent < baseIndent) break;
    if (item.indent > baseIndent) {
      if (!lastItem) break;
      index = appendList(lastItem, lines, index, documentRef, item.indent);
      continue;
    }
    if (item.ordered !== first.ordered) break;
    const listItem = documentRef.createElement("li");
    appendInline(listItem, item.content, documentRef);
    list.append(listItem);
    lastItem = listItem;
    index += 1;
  }

  parent.append(list);
  return index;
}

function appendTable(parent, lines, startIndex, documentRef) {
  const headers = splitTableRow(lines[startIndex]);
  const alignments = tableAlignments(lines[startIndex + 1]);
  const wrapper = documentRef.createElement("div");
  wrapper.className = "md-table-scroll";
  const table = documentRef.createElement("table");
  const head = documentRef.createElement("thead");
  const headRow = documentRef.createElement("tr");

  headers.forEach((header, column) => {
    const cell = documentRef.createElement("th");
    cell.className = "md-align-" + (alignments[column] ?? "left");
    appendInline(cell, header, documentRef);
    headRow.append(cell);
  });
  head.append(headRow);
  table.append(head);

  const body = documentRef.createElement("tbody");
  let index = startIndex + 2;
  while (index < lines.length && lines[index].trim() && lines[index].includes("|")) {
    const row = documentRef.createElement("tr");
    const cells = splitTableRow(lines[index]);
    headers.forEach((_header, column) => {
      const cell = documentRef.createElement("td");
      cell.className = "md-align-" + (alignments[column] ?? "left");
      appendInline(cell, cells[column] ?? "", documentRef);
      row.append(cell);
    });
    body.append(row);
    index += 1;
  }
  table.append(body);
  wrapper.append(table);
  parent.append(wrapper);
  return index;
}

function appendBlocks(parent, lines, documentRef) {
  let index = 0;
  while (index < lines.length) {
    const line = lines[index];
    if (!line.trim()) { index += 1; continue; }

    const fence = line.match(FENCE_PATTERN);
    if (fence) {
      const marker = fence[1];
      const language = fence[2];
      const codeLines = [];
      index += 1;
      while (index < lines.length && !new RegExp("^\\s{0,3}" + marker[0] + "{" + marker.length + ",}\\s*$").test(lines[index])) {
        codeLines.push(lines[index]);
        index += 1;
      }
      if (index < lines.length) index += 1;
      const wrapper = documentRef.createElement("div");
      wrapper.className = "md-code-block";
      if (language) {
        const label = documentRef.createElement("span");
        label.className = "md-code-language";
        label.textContent = language;
        wrapper.append(label);
      }
      const pre = documentRef.createElement("pre");
      const code = documentRef.createElement("code");
      code.textContent = codeLines.join("\n");
      pre.append(code);
      wrapper.append(pre);
      parent.append(wrapper);
      continue;
    }

    const heading = line.match(HEADING_PATTERN);
    if (heading) {
      const element = documentRef.createElement("h" + heading[1].length);
      appendInline(element, heading[2], documentRef);
      parent.append(element);
      index += 1;
      continue;
    }
    if (HORIZONTAL_RULE_PATTERN.test(line)) { parent.append(documentRef.createElement("hr")); index += 1; continue; }
    if (isTableStart(lines, index)) { index = appendTable(parent, lines, index, documentRef); continue; }
    const item = listMatch(line);
    if (item) { index = appendList(parent, lines, index, documentRef, item.indent); continue; }

    const quote = line.match(QUOTE_PATTERN);
    if (quote) {
      const quoteLines = [];
      while (index < lines.length) {
        const current = lines[index].match(QUOTE_PATTERN);
        if (!current) break;
        quoteLines.push(current[1]);
        index += 1;
      }
      const blockquote = documentRef.createElement("blockquote");
      appendBlocks(blockquote, quoteLines, documentRef);
      parent.append(blockquote);
      continue;
    }

    const paragraphLines = [line];
    index += 1;
    while (index < lines.length && !isBlockStart(lines, index)) {
      paragraphLines.push(lines[index]);
      index += 1;
    }
    const paragraph = documentRef.createElement("p");
    paragraphLines.forEach((paragraphLine, lineIndex) => {
      const hardBreak = /\s{2}$/.test(paragraphLine);
      appendInline(paragraph, paragraphLine.replace(/\s+$/, ""), documentRef);
      if (lineIndex < paragraphLines.length - 1) {
        if (hardBreak) paragraph.append(documentRef.createElement("br"));
        else appendText(paragraph, " ", documentRef);
      }
    });
    parent.append(paragraph);
  }
}

export function renderMarkdown(input, documentRef = document) {
  const root = documentRef.createElement("div");
  root.className = "markdown-content";
  const lines = String(input ?? "").replace(/\r\n?/g, "\n").split("\n");
  appendBlocks(root, lines, documentRef);
  return root;
}
