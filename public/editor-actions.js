export function markdownAction(value, start, end, action) {
  const selected = value.slice(start, end);
  const wraps = { bold: ['**','**','bold text'], italic: ['_','_','italic text'], link: ['[','](https://)','link text'], code: selected.includes('\n') ? ['```\n','\n```','code'] : ['`','`','code'] };
  if (wraps[action]) {
    const [before, after, placeholder] = wraps[action], text = selected || placeholder;
    const replacement = before + text + after;
    const result = value.slice(0,start) + replacement + value.slice(end);
    const selectionStart = action === 'link' ? start + before.length + text.length + 2 : start + before.length;
    return { value: result, start: selectionStart, end: action === 'link' ? selectionStart + 8 : selectionStart + text.length };
  }
  const lineStart = start === 0 ? 0 : value.lastIndexOf('\n', start - 1) + 1;
  const selectionEnd = end > start && value[end - 1] === '\n' ? end - 1 : end;
  let lineEnd = value.indexOf('\n', selectionEnd);
  if (lineEnd < 0) lineEnd = value.length;
  const lines = value.slice(lineStart,lineEnd).split('\n');
  const replacement = lines.map((line,index) => {
    if (action === 'heading') return line.startsWith('## ') ? line.slice(3) : '## ' + line.replace(/^#{1,6} /,'');
    if (action === 'quote') return line.startsWith('> ') ? line.slice(2) : '> ' + line;
    if (action === 'ordered') return `${index + 1}. ` + line.replace(/^\d+\. /,'');
    return line.startsWith('- ') ? line.slice(2) : '- ' + line;
  }).join('\n');
  const result = value.slice(0,lineStart) + replacement + value.slice(lineEnd);
  if (start === end) {
    const caret = Math.max(lineStart, start + replacement.length - (lineEnd - lineStart));
    return { value: result, start: caret, end: caret };
  }
  return { value: result, start: lineStart, end: lineStart + replacement.length };
}
