// Stable speech units, independent of screen size and font settings. Keep whole
// sentences together, pack short ones, and split oversized ones at clauses first.
export function speechChunks(text, limit = 380) {
  const sentences = new Intl.Segmenter('en', { granularity: 'sentence' }).segment(text);
  const pieces = [];
  for (const sentence of sentences) {
    let start = sentence.index, end = start + sentence.segment.length;
    while (end - start > limit) {
      const sample = text.slice(start, start + limit);
      const clauses = [...sample.matchAll(/[,;:—]\s+/g)];
      const clause = clauses.filter(match => match.index > limit / 2).at(-1);
      const space = sample.lastIndexOf(' ');
      const length = clause ? clause.index + clause[0].length : space > 0 ? space + 1 : limit;
      pieces.push({ start, end: start + length });
      start += length;
    }
    if (end > start) pieces.push({ start, end });
  }
  const packed = [];
  for (const piece of pieces) {
    const previous = packed.at(-1);
    if (previous && piece.end - previous.start <= limit) previous.end = piece.end;
    else packed.push({ ...piece });
  }
  return packed.map(piece => {
    let { start, end } = piece;
    while (start < end && /\s/.test(text[start])) start++;
    while (end > start && /\s/.test(text[end - 1])) end--;
    return { start, end, text: text.slice(start, end) };
  }).filter(piece => piece.text);
}
