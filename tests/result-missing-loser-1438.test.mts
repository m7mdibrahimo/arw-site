import test from 'node:test';
import assert from 'node:assert/strict';
import { applyCorrections, checkArticle, BLOCKING_QA_CODES, RETRYABLE_QA_CODES } from '../scripts/news-qa.ts';

const codes = (t: string, b: string) => checkArticle(t, b).map(i => i.code);
const title = 'نتائج عرض NJPW Bound For Unbound (20 نوفمبر 2026): يوتا تسوجي وشينغو تاكاغي في المواجهات الكبرى';

test('a result with only its winner blocks publishing (Yuto-Ice def. Fuminori Abe, INCIDENTS #1438)', () => {
  assert.ok(BLOCKING_QA_CODES.includes('result_missing_loser'));
  assert.ok(RETRYABLE_QA_CODES.includes('result_missing_loser'));
  const bad = 'أقام اتحاد NJPW عرضا في طوكيو.\n\n**المواجهة الخامسة: نزال فردي**\n\nحقق يوتو آيس الفوز في المواجهة.\n\n🏆 **الفائز:** يوتو آيس';
  assert.ok(codes(title, bad).includes('result_missing_loser'));
  const good = bad.replace('حقق يوتو آيس الفوز في المواجهة.', 'فاز يوتو آيس على فومينوري آبي.');
  assert.ok(!codes(title, good).includes('result_missing_loser'));
  const withLoser = bad.replace('حقق يوتو آيس الفوز في المواجهة.', 'حقق يوتو آيس الفوز على فومينوري آبي في المواجهة.');
  assert.ok(!codes(title, withLoser).includes('result_missing_loser'));
});

test('the dropped hamza of «الإعلامية» is fixed before publishing (Brie Bella, INCIDENTS #1438)', () => {
  assert.equal(applyCorrections('خلال الفعاليات الاعلامية للحدث'), 'خلال الفعاليات الإعلامية للحدث');
});
