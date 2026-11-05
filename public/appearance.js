export const appearanceDefaults = {
  theme:'paper', size:20, line:1.8, font:'serif', width:680,
  paragraphSpace:1, letterSpace:0, weight:400, align:'left', hyphens:false,
  gutter:22, motion:'slide', accent:'', customColors:false, pageColor:'#f6f1e5', inkColor:'#3e4136',
};
export const themes = ['paper','white','sepia','sage','rose','slate','night','black'];
export const fonts = {
  serif: ['Georgia', 'Georgia, serif'],
  palatino: ['Palatino', '"Palatino Linotype", "Book Antiqua", Palatino, serif'],
  classic: ['Classic', '"Iowan Old Style", Baskerville, "Times New Roman", serif'],
  sans: ['System', '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif'],
  humanist: ['Humanist', '"Trebuchet MS", Verdana, sans-serif'],
  mono: ['Monospace', 'ui-monospace, "SFMono-Regular", Consolas, monospace'],
};
const number = (value, min, max, fallback) => Number.isFinite(Number(value)) ? Math.max(min, Math.min(max,Number(value))) : fallback;
const colour = value => /^#[a-f0-9]{6}$/i.test(value || '');
export function applyAppearance(element, preferences) {
  if (!element) return;
  element.dataset.theme = themes.includes(preferences.theme) ? preferences.theme : 'paper';
  const properties = {
    '--font-size': number(preferences.size,14,36,20) + 'px',
    '--line': number(preferences.line,1.3,2.4,1.8),
    '--reading-font': (fonts[preferences.font] || fonts.serif)[1],
    '--reading-width': number(preferences.width,340,900,680) + 'px',
    '--paragraph-space': number(preferences.paragraphSpace,.25,2,1) + 'em',
    '--letter-space': number(preferences.letterSpace,0,1.5,0) + 'px',
    '--reading-weight': [400,500,600].includes(Number(preferences.weight)) ? preferences.weight : 400,
    '--text-align': preferences.align === 'justify' ? 'justify' : 'left',
    '--hyphens': preferences.hyphens ? 'auto' : 'none',
    '--reader-gutter': number(preferences.gutter,12,36,22) + 'px',
  };
  for (const [key,value] of Object.entries(properties)) element.style.setProperty(key,value);
  if (colour(preferences.accent)) {
    element.style.setProperty('--accent',preferences.accent);
    const rgb = preferences.accent.slice(1).match(/../g).map(value=>parseInt(value,16));
    element.style.setProperty('--on-accent',rgb[0]*.299+rgb[1]*.587+rgb[2]*.114>160?'#202720':'#ffffff');
  } else { element.style.removeProperty('--accent'); element.style.removeProperty('--on-accent'); }
  for (const key of ['--paper','--ink','--surface','--border','--muted','--tint']) element.style.removeProperty(key);
  if (preferences.customColors && colour(preferences.pageColor) && colour(preferences.inkColor)) {
    element.style.setProperty('--paper',preferences.pageColor);
    element.style.setProperty('--ink',preferences.inkColor);
    element.style.setProperty('--surface','color-mix(in srgb, var(--paper) 96%, var(--ink))');
    element.style.setProperty('--border','color-mix(in srgb, var(--paper) 82%, var(--ink))');
    element.style.setProperty('--muted','color-mix(in srgb, var(--paper) 30%, var(--ink))');
    element.style.setProperty('--tint','color-mix(in srgb, var(--paper) 90%, var(--ink))');
  }
}
