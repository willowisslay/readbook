import { test, expect } from '@playwright/test';

// Deterministic media lets tests finish pages individually, including while
// generation is slow or playback is paused. Real Kokoro is verified separately.
function silentWav() {
  const buffer = Buffer.alloc(44 + 4800);
  buffer.write('RIFF'); buffer.writeUInt32LE(buffer.length - 8, 4);
  buffer.write('WAVEfmt ', 8); buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20); buffer.writeUInt16LE(1, 22);
  buffer.writeUInt32LE(24000, 24); buffer.writeUInt32LE(48000, 28);
  buffer.writeUInt16LE(2, 32); buffer.writeUInt16LE(16, 34);
  buffer.write('data', 36); buffer.writeUInt32LE(4800, 40);
  return buffer;
}
async function openBook(page) {
  await page.request.post('/api/login', { data: { password: 'browser-test-password' } });
  const result = await page.request.post('/api/books', { data: { title: 'Listening test', description: '', cover: '' } });
  const { id } = await result.json();
  const paragraphs = Array.from({ length: 80 }, (_, i) => `Paragraph ${i + 1}. The evening light settled on the hills. A small path wound through the trees, inviting us to follow it somewhere new. We walked quietly, leaving the noise of the day behind.`);
  const source = paragraphs.join('\n\n');
  await page.request.post(`/api/books/${id}/chapters`, { data: { title: 'A long walk', content: source, format: 'txt', position: 1 } });
  await page.request.post(`/api/books/${id}/chapters`, { data: { title: 'Coming home', content: 'The final chapter. We are home at last.', format: 'txt', position: 2 } });
  await page.addInitScript(() => {
    HTMLMediaElement.prototype.play = function () { return Promise.resolve(); };
  });
  await page.goto('/');
  await page.locator(`[data-book="${id}"]`).click();
  await page.getByRole('button', { name: 'Start reading', exact: true }).click();
  await expect(page.locator('#page-label')).toContainText('1 /');
  return { id, source };
}
async function mockSpeech(page) {
  const requests = [];
  await page.route('**/api/tts', async route => {
    if (route.request().method() !== 'POST') { await route.continue(); return; }
    requests.push(route.request().postDataJSON());
    await route.fulfill({ contentType: 'audio/wav', body: silentWav() });
  });
  return requests;
}
async function endPage(page) {
  await page.locator('#audio-controls audio').evaluate(audio => audio.dispatchEvent(new Event('ended')));
}
async function visibleText(page) {
  return page.evaluate(async () => {
    const { extractPageText } = await import('/reading-pages.js');
    const window = document.querySelector('.page-window');
    const bounds = window.getBoundingClientRect();
    return extractPageText(window.querySelector('article'), bounds.left, bounds.right);
  });
}

test('prefetch stays five pages ahead without moving the reader; completing audio auto turns and refills', async ({ page }) => {
  await openBook(page);
  const requests = await mockSpeech(page);
  const originalText = await visibleText(page);
  await page.getByRole('button', { name: 'Listen', exact: true }).click();
  await expect(page.locator('#listen-status')).toHaveText('Listen mode · 5 pages ready ahead');
  expect(requests).toHaveLength(6);
  expect(requests[0].input).toBe(originalText);
  await expect(page.locator('#page-label')).toContainText('1 /');
  // Even a paused current page cannot cause a seventh request.
  await page.waitForTimeout(200);
  expect(requests).toHaveLength(6);
  await endPage(page);
  await expect(page.locator('#page-label')).toContainText('2 /');
  await expect.poll(() => requests.length).toBe(7);
  expect(requests[1].input).toBe(await visibleText(page));
  await page.getByRole('button', { name: 'Stop listening', exact: true }).click();
  await expect(page.locator('#listen-status')).toBeEmpty();
  await expect(page.locator('.listen-measure')).toHaveCount(0);
  await endPage(page);
  await expect(page.locator('#page-label')).toContainText('2 /');
});

test('automatically enters the next chapter, saves progress, and stops at the end of the book', async ({ page }) => {
  const { id } = await openBook(page);
  const requests = await mockSpeech(page);
  await page.locator('#page-range').evaluate(input => {
    input.value = input.max; input.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await page.getByRole('button', { name: 'Listen', exact: true }).click();
  await expect.poll(() => requests.length).toBe(2);
  await expect(page.locator('#audio-controls audio')).toHaveAttribute('src', /^blob:/);
  await endPage(page);
  await expect(page.locator('.reading-meta')).toContainText('CHAPTER 2 OF 2');
  await expect(page.locator('#page-label')).toHaveText('1 / 1');
  expect(requests[1].input).toBe('The final chapter. We are home at last.');
  await expect.poll(async () => {
    const book = await (await page.request.get(`/api/books/${id}`)).json();
    return book.progress?.chapter_id;
  }).toBe((await (await page.request.get(`/api/books/${id}`)).json()).chapters[1].id);
  await endPage(page);
  await expect(page.getByRole('button', { name: 'Listen', exact: true })).toBeVisible();
  await expect(page.locator('#toast')).toHaveText('You’ve reached the end of the book.');
  expect(requests).toHaveLength(2);
});

test('font and voice changes discard the old queue and regenerate the correct visible page', async ({ page }) => {
  await openBook(page);
  const requests = await mockSpeech(page);
  await page.getByRole('button', { name: 'Listen', exact: true }).click();
  await expect(page.locator('#listen-status')).toContainText('5 pages ready');
  await page.getByRole('button', { name: 'Appearance', exact: true }).click();
  await page.locator('[data-pref=size]').fill('28');
  await page.locator('[data-pref=kokoroVoice]').selectOption('bf_emma');
  await page.getByRole('button', { name: 'Close', exact: true }).click();
  await expect(page.locator('.listen-measure')).toHaveCount(0);
  const before = requests.length;
  const text = await visibleText(page);
  await page.getByRole('button', { name: 'Listen', exact: true }).click();
  await expect.poll(() => requests.length).toBe(before + 6);
  expect(requests[before].input).toBe(text);
  expect(requests[before].voice).toBe('bf_emma');
  await page.getByRole('button', { name: 'Next page', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Listen', exact: true })).toBeVisible();
  await expect(page.locator('.listen-measure')).toHaveCount(0);
});

test('a resize clears queued audio before changing page boundaries', async ({ page }) => {
  await openBook(page);
  await mockSpeech(page);
  await page.getByRole('button', { name: 'Listen', exact: true }).click();
  await expect(page.locator('#listen-status')).toContainText('5 pages ready');
  await page.setViewportSize({ width: 700, height: 390 });
  await expect(page.getByRole('button', { name: 'Listen', exact: true })).toBeVisible();
  await expect(page.locator('.listen-measure')).toHaveCount(0);
});

test('device voices also continue across pages and chapters', async ({ page }) => {
  await page.addInitScript(() => {
    window.mockSpeechQueue = [];
    Object.defineProperty(window, 'speechSynthesis', { value: {
      getVoices: () => [],
      speak: utterance => window.mockSpeechQueue.push(utterance),
      cancel: () => { window.mockSpeechQueue.length = 0; },
    } });
  });
  await openBook(page);
  const requests = await mockSpeech(page);
  await page.locator('#page-range').evaluate(input => {
    input.value = input.max; input.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await page.getByRole('button', { name: 'Appearance', exact: true }).click();
  await page.locator('[data-pref=engine]').selectOption('device');
  await page.getByRole('button', { name: 'Close', exact: true }).click();
  await page.getByRole('button', { name: 'Listen', exact: true }).click();
  await expect.poll(() => page.evaluate(() => {
    window.mockSpeechQueue.shift()?.onend();
    return document.querySelector('.reading-meta').textContent;
  })).toContain('CHAPTER 2 OF 2');
  await expect.poll(() => page.evaluate(() => {
    window.mockSpeechQueue.shift()?.onend();
    return document.querySelector('[data-action=speak]').textContent.trim();
  })).toBe('▷ Listen');
  expect(requests).toHaveLength(0);
});

test('page extraction preserves every word and handles inline emphasis and line breaks', async ({ page }) => {
  const { source } = await openBook(page);
  const extracted = await page.evaluate(async () => {
    const { createPageSource } = await import('/reading-pages.js');
    const response = await fetch('/api/books');
    const books = await response.json();
    const book = await (await fetch('/api/books/' + books[0].id)).json();
    const reader = document.querySelector('.reader');
    const viewport = reader.querySelector('.page-window');
    const measurement = createPageSource(book.chapters, reader, viewport, chapter => chapter.content.split(/\n\s*\n/).map(p => `<p>${p}</p>`).join(''));
    const parts = [];
    let current = measurement.at(0, 0);
    do {
      parts.push(current.text);
      current = current.page + 1 < current.pageCount ? measurement.next(current) : null;
    } while (current);
    measurement.dispose();
    const inline = createPageSource([{ id: 'inline' }], reader, viewport, () => '<p>un<strong>break</strong>able<br>second line</p>');
    const inlineText = inline.at(0, 0).text;
    inline.dispose();
    return { text: parts.join(' ').replace(/\s+/g, ' '), inlineText };
  });
  expect(extracted.text).toBe(source.replace(/\s+/g, ' '));
  expect(extracted.inlineText).toBe('unbreakable\nsecond line');
});
