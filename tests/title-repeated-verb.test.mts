import test from 'node:test';
import assert from 'node:assert/strict';
import { checkArticle, BLOCKING_QA_CODES, RETRYABLE_QA_CODES } from '../scripts/news-qa.ts';

// INCIDENTS #1473: «بوبي لاشلي يؤكد أنه لا يفكر في الاعتزال ويؤكد: ما زال لدي الكثير لأقدمه» went live.
test('the same speech verb twice in a headline is blocked and sent back to the writer', () => {
  const body = 'أكد بوبي لاشلي نجم اتحاد AEW أنه لا ينوي إنهاء مسيرته في حلبات المصارعة حاليا رغم بلوغه سن الخمسين، وقال إنه ما زال قادرا على العطاء.';
  const bad = checkArticle('بوبي لاشلي يؤكد أنه لا يفكر في الاعتزال ويؤكد: ما زال لدي الكثير لأقدمه', body, []);
  assert.ok(bad.some((i) => i.code === 'title_repeated_verb'));
  assert.ok(BLOCKING_QA_CODES.includes('title_repeated_verb') && RETRYABLE_QA_CODES.includes('title_repeated_verb'));
  for (const ok of ['بوبي لاشلي يرفض فكرة الاعتزال ويؤكد: ما زال لدي الكثير لأقدمه', 'رومان رينز يكشف موعد عودته ويرد على منتقديه']) {
    assert.ok(!checkArticle(ok, body, []).some((i) => i.code === 'title_repeated_verb'), ok);
  }
});
