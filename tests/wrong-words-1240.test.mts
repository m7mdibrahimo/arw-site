// INCIDENTS #1240: «المسؤول الإيضاحي الأول» (Triple H), «نزيلين رباعيين» (TNA X-Cup), «عائلة أنواعي» (Rikishi),
// «لتوقيع التوقيعات» (Jim Duggan), «ساموا الأحرار» went live.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { applyCorrections } from '../scripts/news-qa.ts';

test('the wrong words of #1240 are corrected', () => {
  assert.equal(applyCorrections('نشر المسؤول الإيضاحي الأول في WWE رسالة'), 'نشر المسؤول الإبداعي الأول في WWE رسالة');
  assert.equal(applyCorrections('البطولة التي تضم نزيلين رباعيين'), 'البطولة التي تضم نزالين رباعيين');
  assert.equal(applyCorrections('إرث عائلة أنواعي العريق'), 'إرث عائلة أنواي العريق');
  assert.equal(applyCorrections('أسافر حول العالم لتوقيع التوقيعات'), 'أسافر حول العالم لتوقيع الصور للمعجبين');
  assert.equal(applyCorrections('ساموا الأحرار يمثلون ثقافتنا'), 'أبناء ساموا الفخورون يمثلون ثقافتنا');
});

test('the glossary carries Anoa\'i and Chief Content Officer', () => {
  const g = JSON.parse(readFileSync(new URL('../scripts/wrestler-names.json', import.meta.url), 'utf8'));
  assert.equal(g["Anoa'i"], 'أنواي');
  assert.equal(g['Chief Content Officer'], 'المسؤول الإبداعي الأول');
});


test('«بناتي» (my daughters) is never turned into Natalya, «ناتي» still is', () => {
  assert.equal(applyCorrections('وتكفلت بتعليم بناتي في الجامعة'), 'وتكفلت بتعليم بناتي في الجامعة');
  assert.equal(applyCorrections('واجهت ناتي في الحلبة'), 'واجهت ناتاليا في الحلبة');
  assert.equal(applyCorrections('فازت على ناتي'), 'فازت على ناتاليا');
});
