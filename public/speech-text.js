// Clean narration without changing the stored chapter or its visual rendering.
// Offsets map spoken characters back to source text for device word boundaries.
export function prepareSpeechText(source) {
  const keep = new Uint8Array(source.length).fill(1);
  const separators = new Set();
  const remove = (start, end) => keep.fill(0, start, end);
  function omit(pattern) {
    for (const match of source.matchAll(pattern)) remove(match.index, match.index + match[0].length);
  }
  // Keep link labels and image descriptions, not Markdown delimiters/targets.
  for (const match of source.matchAll(/!?\[([^\]\n]*)\]\([^\n)]*\)/g)) {
    const start = match.index + match[0].indexOf('[') + 1;
    remove(match.index, start);
    remove(start + match[1].length, match.index + match[0].length);
  }
  omit(/^\s{0,3}(?:`{3,}|~{3,})[^\n]*$/gm);
  omit(/^[ \t]*(?:[*_-][ \t]*){3,}$/gm);
  omit(/^[ \t]*\|?[:\- \t|]{3,}\|?[ \t]*$/gm);
  omit(/^[ \t]{0,3}#{1,6}[ \t]+/gm);
  omit(/^[ \t]*>+[ \t]?/gm);
  omit(/^[ \t]*(?:[-+*]|\d+[.)])[ \t]+(?:\[[ xX]\][ \t]+)?/gm);
  for (let i = 0; i < source.length; i++) {
    if ('*_`~'.includes(source[i])) keep[i] = 0;
    if (source[i] === '\\') {
      keep[i] = 0;
      // Escapes before punctuation are formatting. A bare path separator needs
      // a word boundary, so "one\\two" does not become "onetwo".
      if (!/[\\`*_\[\]{}()#+\-.!>~|"']/.test(source[i + 1] || '')) separators.add(i);
    }
    if (source[i] === '|') { keep[i] = 0; separators.add(i); }
  }
  const characters = [], offsets = [];
  let space = null, lineBreak = false;
  for (let i = 0; i < source.length; i++) {
    if (separators.has(i)) space ??= i;
    if (!keep[i]) continue;
    if (/\s/.test(source[i])) { space ??= i; lineBreak ||= /[\r\n]/.test(source[i]); continue; }
    if (space !== null && characters.length) { characters.push(lineBreak ? '\n' : ' '); offsets.push(space); }
    space = null; lineBreak = false;
    characters.push(source[i]); offsets.push(i);
  }
  return { text: characters.join(''), offsets };
}

export function cleanSpeechText(source) { return prepareSpeechText(source).text; }
