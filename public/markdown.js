import { Marked } from './vendor/marked.js';
import DOMPurify from './vendor/purify.js';

const escape = text => String(text).replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
const parser = new Marked({ gfm: true, breaks: false });
parser.use({ renderer: {
  html({ text }) { return escape(text); },
  image({ text }) { return escape(text); },
  checkbox({ checked }) { return `<span class="md-task ${checked ? 'checked' : ''}" aria-hidden="true"></span>`; },
} });

export function renderMarkdown(source) {
  const html = DOMPurify.sanitize(parser.parse(source), {
    ALLOWED_TAGS: ['p','br','h1','h2','h3','h4','h5','h6','ul','ol','li','strong','em','del','s','blockquote','pre','code','hr','table','thead','tbody','tr','th','td','a','span'],
    ALLOWED_ATTR: ['href','title','start','class','aria-hidden','align'],
    ALLOW_DATA_ATTR: false,
  });
  const template = document.createElement('template');
  template.innerHTML = html;
  for (const link of template.content.querySelectorAll('a[href]')) {
    link.target = '_blank'; link.rel = 'noopener noreferrer';
  }
  return template.innerHTML;
}

export function renderChapter(chapter) {
  return chapter.format === 'md' ? renderMarkdown(chapter.content) : chapter.content.split(/\n\s*\n/).map(paragraph => `<p>${escape(paragraph).replace(/\n/g,'<br>')}</p>`).join('');
}
