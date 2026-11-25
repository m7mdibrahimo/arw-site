import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { checkArticle } from '../scripts/news-qa.ts';

// INCIDENTS #1534: «وأأنشطته» and «المشروبات الكحولة» went live in two Steve Austin stories.
test('a hamza typed twice at a word start is blocked, real words pass', () => {
  for (const w of ['منذ ابتعاده عن الحلبات وأأنشطته الحالية', 'أأنشطة جديدة'])
    assert.ok(checkArticle('عنوان الخبر عن النزال', w).some((i) => i.code === 'doubled_first_letter'), w);
  for (const w of ['وأنشطته الحالية', 'وأكد أوستن', 'ملأ القاعة'])
    assert.ok(!checkArticle('عنوان الخبر عن النزال', w).some((i) => i.code === 'doubled_first_letter'), w);
});

test('«الكحولة» is corrected to «الكحولية»', () => {
  const j = JSON.parse(readFileSync('editorial/corrections.json', 'utf8'));
  const list = (Array.isArray(j) ? j : Object.values(j).find(Array.isArray)) as any[];
  const e = list.find((c) => c.regex && String(c.wrong).includes('كحولة'));
  assert.ok(e);
  const fix = (t: string) => t.replace(new RegExp(e.wrong, 'g'), e.right);
  assert.equal(fix('استهلاكه للمشروبات الكحولة بشكل كبير'), 'استهلاكه للمشروبات الكحولية بشكل كبير');
  assert.equal(fix('المشروبات الكحولية'), 'المشروبات الكحولية');
});
