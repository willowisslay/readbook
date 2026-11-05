import { test } from 'node:test';
import assert from 'node:assert/strict';
import { markdownAction } from '../public/editor-actions.js';
import { applyAppearance } from '../public/appearance.js';

test('formatting wraps the selected words and preserves a useful caret selection',()=>{
  const result=markdownAction('A quiet story.',2,7,'bold');
  assert.equal(result.value,'A **quiet** story.');
  assert.equal(result.value.slice(result.start,result.end),'quiet');
  const link=markdownAction('Read this',5,9,'link');
  assert.equal(link.value,'Read [this](https://)');
  assert.equal(link.value.slice(link.start,link.end),'https://');
});
test('heading and list tools format lines without discarding surrounding prose',()=>{
  const value='Before\nFirst\nSecond\nAfter';
  const result=markdownAction(value,7,19,'ordered');
  assert.equal(result.value,'Before\n1. First\n2. Second\nAfter');
  assert.equal(markdownAction('Title',0,5,'heading').value,'## Title');
  assert.equal(markdownAction('## Title',0,8,'heading').value,'Title');
  assert.equal(markdownAction('one\ntwo',0,7,'code').value,'```\none\ntwo\n```');
});
test('appearance settings clamp layout values and accept only valid custom colours',()=>{
  const values=new Map(),element={dataset:{},style:{setProperty:(key,value)=>values.set(key,String(value)),removeProperty:key=>values.delete(key)}};
  applyAppearance(element,{theme:'slate',font:'mono',size:900,gutter:-10,align:'justify',customColors:true,pageColor:'#ffeedc',inkColor:'#102030',accent:'#436c9e'});
  assert.equal(element.dataset.theme,'slate');assert.equal(values.get('--font-size'),'36px');assert.equal(values.get('--reader-gutter'),'12px');assert.equal(values.get('--text-align'),'justify');assert.equal(values.get('--paper'),'#ffeedc');
  applyAppearance(element,{theme:'unknown',font:'bad',customColors:true,pageColor:'url(javascript:bad)',inkColor:'#000000'});
  assert.equal(element.dataset.theme,'paper');assert.equal(values.has('--paper'),false);assert.equal(values.get('--reading-font'),'Georgia, serif');
});

test('heading on an empty line leaves the caret after its marker and line selection does not swallow the next line',()=>{
  const heading=markdownAction('',0,0,'heading');
  assert.equal(heading.value,'## ');assert.equal(heading.start,3);assert.equal(heading.end,3);
  const list=markdownAction('first\nsecond',0,6,'list');
  assert.equal(list.value,'- first\nsecond');
});
