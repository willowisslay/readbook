import { speechChunks } from './speech-chunks.js';

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
      const block = node.parentElement.closest('p,h1,h2,h3,h4,h5,h6,blockquote,li,pre,td,th');
      if (parts.length && block !== parts.at(-1).block) parts.push({ text: '\n', block });
      parts.push({ text: node.textContent.slice(start, end), block });
    }
  }
  return parts.map(part => part.text).join('').trim();
}

// A sentence may cross a visual page. Speech follows the sentence; the visible
// page advances at the next speech boundary rather than restarting the voice.
export function createSpeechSource(chapters, reader, viewport, renderChapter, { preserveUnits = false } = {}) {
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
  window.append(content); reader.append(window);
  const plans = new Map();

  function prepare(chapter, base = 0) {
    if (!chapters[chapter]) return null;
    if (plans.has(chapter)) return plans.get(chapter);
    content.innerHTML = renderChapter(chapters[chapter]);
    const pageCount = Math.max(1, Math.round((content.scrollWidth + 40) / (width + 40)));
    const { text, runs } = speechTextRuns(content);
    const origin = window.getBoundingClientRect().left;
    function pageAt(offset) {
      let low = 0, high = runs.length;
      while (low < high) {
        const middle = (low + high) >> 1;
        if (runs[middle].end > offset) high = middle; else low = middle + 1;
      }
      const run = runs[Math.min(low, runs.length - 1)];
      if (!run || !run.node.length) return 0;
      const index = Math.max(0, Math.min(run.node.length - 1, offset - run.start));
      const range = document.createRange();
      range.setStart(run.node, index); range.setEnd(run.node, index + 1);
      return Math.max(0, Math.min(pageCount - 1, Math.floor((range.getBoundingClientRect().left - origin + .5) / (width + 40))));
    }
    const chunks = [];
    for (const unit of speechChunks(text)) {
      let start = unit.start;
      while (start < unit.end) {
        while (start < unit.end && /\s/.test(text[start])) start++;
        if (start >= unit.end) break;
        const firstPage = pageAt(start);
        let end = unit.end;
        // Very small viewports can fit fewer than one long sentence in six
        // pages. Respect the horizon even for that exceptional case.
        if (!preserveUnits && pageAt(end - 1) > firstPage + 5) {
          let low = start + 1, high = end;
          while (low < high) {
            const middle = (low + high) >> 1;
            if (pageAt(middle) > firstPage + 5) high = middle; else low = middle + 1;
          }
          end = low;
          const space = text.lastIndexOf(' ', end - 1);
          if (space > start) end = space + 1;
        }
        const lastPage = pageAt(end - 1);
        const pageBreaks = [{ page: firstPage, fraction: 0, offset: 0 }];
        for (let page = firstPage + 1; page <= lastPage; page++) {
          let low = start, high = end - 1;
          while (low < high) {
            const middle = (low + high) >> 1;
            if (pageAt(middle) >= page) high = middle; else low = middle + 1;
          }
          pageBreaks.push({ page, fraction: (low - start) / (end - start), offset: low - start });
        }
        chunks.push({
          key: chapters[chapter].id + ':' + start + ':' + end,
          chapter, page: firstPage, endPage: lastPage, pageCount,
          pageOrdinal: base + firstPage, endOrdinal: base + lastPage,
          chunk: chunks.length, text: text.slice(start, end).trim(), pageBreaks,
        });
        start = end;
      }
    }
    // Empty content still advances to the following chapter without audio.
    if (!chunks.length) chunks.push({ key: chapters[chapter].id, chapter, page: 0, endPage: 0, pageOrdinal: base, endOrdinal: base, pageCount, chunk: 0, text: '' });
    const plan = { chunks, pageCount, base };
    plans.set(chapter, plan);
    return plan;
  }

  return {
    at(chapter, page) {
      const plan = prepare(chapter);
      return plan?.chunks.find(chunk => chunk.endPage >= page) || plan?.chunks.at(-1);
    },
    next(current) {
      const plan = plans.get(current.chapter);
      return plan.chunks[current.chunk + 1] || prepare(current.chapter + 1, plan.base + plan.pageCount)?.chunks[0] || null;
    },
    dispose() { window.remove(); plans.clear(); },
  };
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

export function speechTextRuns(content) {
  const runs = [];
  let text = '', previousBlock = null;
  const walker = document.createTreeWalker(content, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT);
  let node;
  while ((node = walker.nextNode())) {
    if (node.nodeType === Node.ELEMENT_NODE) {
      if (node.tagName === 'BR') text += '\n';
      continue;
    }
    const block = node.parentElement.closest('p,h1,h2,h3,h4,h5,h6,blockquote,li,pre,td,th');
    if (text && block !== previousBlock && !text.endsWith('\n')) text += '\n';
    runs.push({ start: text.length, end: text.length + node.length, node });
    text += node.textContent;
    previousBlock = block;
  }
  return { text, runs };
}
