import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cleanSpeechText, prepareSpeechText } from '../public/speech-text.js';

test('removes emphasis and escape punctuation without losing prose or natural punctuation', () => {
  const source=String.raw`\*Hello\*, **world**! An un**break**able promise, _quietly_ made. \"Yes,\" she said.`;
  assert.equal(cleanSpeechText(source),'Hello, world! An unbreakable promise, quietly made. "Yes," she said.');
});
test('strips headings, bullets, code fences, dividers, and link targets but keeps their words', () => {
  const source='# A beginning\n\n- **A story**\n- [Read me](https://example.com)\n\n***\n\n```txt\nA quiet ending.\n```';
  assert.equal(cleanSpeechText(source),'A beginning\nA story\nRead me\nA quiet ending.');
  assert.equal(cleanSpeechText('![Cover description](cover.png)'),'Cover description');
});
test('preserves names, numbers, currency, and the source offsets used for word tracking', () => {
  const source='It’s **£5.50** — "yes", she said. **Bold** text.';
  const cleaned=prepareSpeechText(source);
  assert.equal(cleaned.text,'It’s £5.50 — "yes", she said. Bold text.');
  assert.equal(cleaned.offsets[cleaned.text.indexOf('Bold')],source.indexOf('Bold'));
  assert.ok(cleaned.offsets.every((offset,i)=>i===0||offset>cleaned.offsets[i-1]));
  assert.equal(cleanSpeechText(cleaned.text),cleaned.text);
});
test('formatting-only content is skipped and bare backslashes do not join words', () => {
  assert.equal(cleanSpeechText('***\n___\n\\'), '');
  assert.equal(cleanSpeechText(String.raw`one\two`),'one two');
});
