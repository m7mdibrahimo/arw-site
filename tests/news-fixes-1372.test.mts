// INCIDENTS #1372: «ليزسي رين», «نيي بلا روجا», «النزالات الملحية», «الإعلان عن الكشف عن», «رفع مستوى الآخرين لا تتصدر».
import test from 'node:test';
import assert from 'node:assert/strict';
import { applyCorrections } from '../scripts/news-qa.ts';

test('names: Lizzy Rain and Niebla Roja', () => {
  assert.equal(applyCorrections('فاز سي ام بانك وليزسي رين على جاكسون دريك'), 'فاز سي ام بانك وليزي رين على جاكسون دريك');
  assert.equal(applyCorrections('أنخيل دي أورو ونيي بلا روجا'), 'أنخيل دي أورو ونيبلا روخا');
});

test('«النزالات الملحية» → «الملحمية»', () => {
  assert.equal(applyCorrections('ليلة من الفرص الكبرى والنزالات الملحية'), 'ليلة من الفرص الكبرى والنزالات الملحمية');
  assert.equal(applyCorrections('نزالات ملحية'), 'نزالات ملحية'); // indefinite is left to the editor
});

test('«الإعلان عن الكشف عن» loses the repeat', () => {
  assert.equal(applyCorrections('ينتظر الجمهور الإعلان عن الكشف عن العضو الخامس'), 'ينتظر الجمهور الكشف عن العضو الخامس');
});

test('«رفع مستوى الآخرين لا تتصدر الحدث» → «وليس تصدر»', () => {
  assert.equal(applyCorrections('إن دورها هو رفع مستوى الآخرين لا تتصدر الحدث'), 'إن دورها هو رفع مستوى الآخرين وليس تصدر الحدث');
  assert.equal(applyCorrections('وهو لا يصدر العروض'), 'وهو لا يتصدر العروض');
});
