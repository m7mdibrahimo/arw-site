// INCIDENTS #1389: «يواصل نائبا الرئيس التنفيذي مات ونيك جاكسون» (Nick Jackson PWG story, 18 Nov 2026) passed every
// dual check, and «وفقا لما كشفه تقارير صحفية» (Anthony Bowens story) got the verb's gender wrong.
import test from 'node:test';
import assert from 'node:assert/strict';
import { checkArticle, applyCorrections } from '../scripts/news-qa.ts';

const pad = ' وهذا نص إضافي عادي لملء الخبر.'.repeat(30);
const duals = (b: string) => checkArticle('عنوان عربي كامل للخبر هنا', b + pad, []).filter((i: { code: string }) => i.code === 'dual_noun').length;

test('«نائبا/نائبي الرئيس» blocks publishing', () => {
  for (const b of [
    'يواصل نائبا الرئيس التنفيذي مات ونيك جاكسون الحديث.',
    'تحدث نائبي رئيس الاتحاد عن العرض.',
  ]) assert.ok(duals(b) > 0, b);
});

test('a single vice president passes', () => {
  for (const b of [
    'قال نائب الرئيس التنفيذي نيك جاكسون إن العرض ناجح.',
    'مات جاكسون ونيك جاكسون من نواب الرئيس التنفيذي.',
  ]) assert.equal(duals(b), 0, b);
});

test('«كشفه تقارير» becomes «كشفته تقارير»', () => {
  assert.match(applyCorrections('وفقا لما كشفه تقارير صحفية مطلعة.'), /كشفته تقارير/);
  assert.match(applyCorrections('وفقا لما كشفه تقرير صحفي.'), /كشفه تقرير/);
});
