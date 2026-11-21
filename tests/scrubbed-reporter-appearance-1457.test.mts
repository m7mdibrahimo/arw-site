// INCIDENTS #1457: «أكدت تقارير صحفية مطلعة، خلال ظهوره في حوار صحفي، أنه تحدث…» and
// «أوضحت تقارير صحفية مطلعة خلال ظهوره في جلسة أسئلة وأجوبة» reached the site (stories of 21 Nov 2026).
import test from 'node:test';
import assert from 'node:assert/strict';
import { checkArticle, BLOCKING_QA_CODES, applyCorrections } from '../scripts/news-qa.ts';

const pad = ' وهذا نص إضافي عادي لملء الخبر.'.repeat(30);
const codes = (b: string) => checkArticle('عنوان عربي كامل للخبر هنا', b + pad, []).map((i: { code: string }) => i.code);

test('«تقارير صحفية … خلال ظهوره» blocks publishing', () => {
  for (const b of [
    'أكدت تقارير صحفية مطلعة، خلال ظهوره في حوار صحفي، أنه تحدث مع مصادر داخل الاتحاد.',
    'أوضحت تقارير صحفية مطلعة خلال ظهوره في جلسة أسئلة وأجوبة أن دانتي مارتن غاب عن الحلبات.',
  ]) assert.ok(codes(b).includes('scrubbed_reporter_appearance'), b);
  assert.ok(BLOCKING_QA_CODES.includes('scrubbed_reporter_appearance'));
});

test('a wrestler\'s own appearance next to a report passes', () => {
  for (const b of [
    'وبحسب تقارير صحفية مطلعة، فإن دانتي مارتن غاب عن الحلبات لمدة شهر.',
    'تحدث النجم خلال ظهوره في بودكاست جديد عن مستقبله في الاتحاد.',
  ]) assert.ok(!codes(b).includes('scrubbed_reporter_appearance'), b);
});

test('«الإراك» is corrected to «الإدراك»', () => {
  assert.equal(applyCorrections('قدرته على الإراك البصري'), 'قدرته على الإدراك البصري');
});
