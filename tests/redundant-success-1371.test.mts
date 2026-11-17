// INCIDENTS #1371: «ونجح الأخير في تثبيت خصمه بنجاح» and «لا تصدر الحدث».
import test from 'node:test';
import assert from 'node:assert/strict';
import { applyCorrections } from '../scripts/news-qa.ts';

test('«نجح … بنجاح» loses the repeated «بنجاح»', () => {
  assert.equal(applyCorrections('ونجح الأخير في تثبيت خصمه بنجاح ليفوز بالحزام'), 'ونجح الأخير في تثبيت خصمه ليفوز بالحزام');
  assert.equal(applyCorrections('نجحت في حسم النزال بنجاح.'), 'نجحت في حسم النزال.');
  // «بنجاح» without «نجح» before it stays
  assert.equal(applyCorrections('أنهى العملية بنجاح'), 'أنهى العملية بنجاح');
});

test('«لا تصدر الحدث» becomes «لا تتصدر الحدث»', () => {
  assert.equal(applyCorrections('تلعب دور رفع مستوى الآخرين لا تصدر الحدث'), 'تلعب دور رفع مستوى الآخرين لا تتصدر الحدث');
  assert.equal(applyCorrections('وهو لا يصدر العروض'), 'وهو لا يتصدر العروض');
});
