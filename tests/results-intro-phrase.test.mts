// INCIDENTS #1154: «وتلخص النتائج الكاملة للمواجهات أدناه» — the results don't summarize anything.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { applyCorrections } from '../scripts/news-qa.ts';

test('the broken results intro is rewritten before publishing', () => {
  assert.equal(applyCorrections('في المكسيك. وتلخص النتائج الكاملة للمواجهات أدناه.'), 'في المكسيك. وإليكم النتائج الكاملة للمواجهات.');
  assert.equal(applyCorrections('وتلخص النتائج الكاملة أدناه:'), 'وإليكم النتائج الكاملة للمواجهات:');
});

test('no published story keeps the broken intro', () => {
  const bad = fs.readdirSync('content/news').filter(f => /تلخص النتائج الكاملة[^.\n]{0,20}أدناه/.test(fs.readFileSync(`content/news/${f}`, 'utf8')));
  assert.deepEqual(bad, []);
});
