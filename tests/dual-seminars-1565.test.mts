// INCIDENTS #1565: «قبل إقامة ندوتين إضافيتين في أبريل وسبتمبر» (Bayley / Lodestone story) and «بضربتي سبير متتاليتين»
// passed every dual check: the feminine dual adjectives and «ندوتين» were not in the lists.
import test from 'node:test';
import assert from 'node:assert/strict';
import { checkArticle } from '../scripts/news-qa.ts';

const pad = ' وهذا نص إضافي عادي لملء الخبر.'.repeat(30);
const duals = (b: string) => checkArticle('عنوان عربي كامل للخبر هنا', b + pad, []).filter((i: { code: string }) => i.code === 'dual_noun').length;

test('feminine dual adjectives and seminars block publishing', () => {
  for (const b of ['قبل إقامة ندوتين إضافيتين في أبريل وسبتمبر.', 'رد عليه بضربة سبير مرتين متتاليتين.', 'أقيمت الندوتان في أورلاندو.'])
    assert.ok(duals(b) > 0, b);
});

test('plural and singular forms pass', () => {
  for (const b of ['قبل إقامة ندوة في أبريل وأخرى في سبتمبر.', 'أقيمت ندوات إضافية.', 'حقق انتصارات متتالية.', 'شارك مصارعون إضافيون.'])
    assert.equal(duals(b), 0, b);
});
