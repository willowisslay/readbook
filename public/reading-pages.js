export function extractPageText(content, left, right) {
  const walker = document.createTreeWalker(content, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT);
  const parts = [];
  let node;
  while ((node = walker.nextNode())) {
    if (node.nodeType === Node.ELEMENT_NODE) {
      if (node.tagName === 'BR') {
        const rect = node.getBoundingClientRect();
        if (rect.left >= left && rect.left < right) {
          parts.push({ text: '\n', block: node.closest('p,blockquote') });
        }
      }
      continue;
    }
    if (!node.length) continue;
    const range = document.createRange();
    const rectAt = index => {
      range.setStart(node, index);
      range.setEnd(node, index + 1);
      return range.getBoundingClientRect();
    };
    const lowerBound = predicate => {
      let low = 0, high = node.length;
      while (low < high) {
        const middle = (low + high) >> 1;
        if (predicate(rectAt(middle))) high = middle;
        else low = middle + 1;
      }
      return low;
    };
    const start = lowerBound(rect => rect.right > left + 0.5);
    const end = lowerBound(rect => rect.left >= right - 0.5);
    if (end > start) {
      // Preserve inline emphasis without inserting spaces inside words.
      const block = node.parentElement.closest('p,h1,h2,h3,h4,h5,h6,blockquote');
      if (parts.length && block !== parts.at(-1).block) parts.push({ text: '\n', block });
      parts.push({ text: node.textContent.slice(start, end), block });
    }
  }
  return parts.map(part => part.text).join('').trim();
}

// Measure future pages without changing the visible page, playback element,
// reading position, or saved progress. Only one extra chapter DOM is retained.
export function createPageSource(chapters, reader, viewport, renderChapter) {
  const width = viewport.clientWidth, height = viewport.clientHeight;
  const window = document.createElement('div');
  window.className = 'page-window listen-measure';
  window.setAttribute('aria-hidden', 'true');
  window.inert = true;
  Object.assign(window.style, {
    position: 'fixed', left: '-100000px', top: '0', visibility: 'hidden',
    pointerEvents: 'none', margin: '0', flex: 'none', maxWidth: 'none',
    width: width + 'px', height: height + 'px',
  });
  const content = document.createElement('article');
  content.className = 'page-content';
  content.style.columnWidth = width + 'px';
  content.style.height = height + 'px';
  window.append(content);
  reader.append(window);
  let measuredChapter = -1, count = 1;

  function at(chapter, page) {
    if (!chapters[chapter]) return null;
    if (chapter !== measuredChapter) {
      content.innerHTML = renderChapter(chapters[chapter]);
      measuredChapter = chapter;
      count = Math.max(1, Math.round((content.scrollWidth + 40) / (width + 40)));
    }
    const left = window.getBoundingClientRect().left + page * (width + 40);
    return {
      key: chapters[chapter].id + ':' + page,
      chapter, page, pageCount: count,
      text: extractPageText(content, left, left + width),
    };
  }

  return {
    at,
    next(current) {
      if (current.page + 1 < current.pageCount) return at(current.chapter, current.page + 1);
      return at(current.chapter + 1, 0);
    },
    dispose() { window.remove(); },
  };
}
