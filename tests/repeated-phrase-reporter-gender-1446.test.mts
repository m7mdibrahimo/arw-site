// INCIDENTS #1446: «في مركز أداء WWE في مركز أداء WWE»، «عودة سويرف ستريكلاند إلى جانب عودة سويرف ستريكلاند»،
// «أكدت تقارير صحفية مطلعة … موضحا» and «كفايتا تبدآن بالعرق» all reached the site (stories of 20 Nov 2026).
import test from 'node:test';
import assert from 'node:assert/strict';
import { checkArticle, BLOCKING_QA_CODES } from '../scripts/news-qa.ts';

const pad = ' وهذا نص إضافي عادي لملء الخبر.'.repeat(30);
const codes = (b: string, t = 'عنوان عربي كامل للخبر هنا') => checkArticle(t, b + pad, []).filter((i: { excerpt: string }) => i.excerpt.trim() !== 'هذا نص إضافي عادي لملء الخبر').map((i: { code: string }) => i.code);

test('a 3+ word phrase written twice in a row blocks publishing', () => {
  for (const b of [
    'تحدثت زيلينا فيغا عن ذكريات طريفة في مركز أداء WWE في مركز أداء WWE، حيث انتقدت إحدى الحصص.',
    'شهد العرض نزالا قويا بالإضافة إلى عودة سويرف ستريكلاند إلى جانب عودة سويرف ستريكلاند.',
  ]) assert.ok(codes(b).includes('repeated_phrase'), b);
  assert.ok(BLOCKING_QA_CODES.includes('repeated_phrase'));
});

test('a repeated prefix that continues into a different name passes', () => {
  for (const b of [
    'حقق الفريق بطولة AEW العالمية للفرق وبطولة AEW العالمية للفرق الثلاثية.',
    'شارك بانتظام في عروض AEW Dark وعروض AEW Dark: Elevation وخاض نزالات كثيرة.',
  ]) assert.ok(!codes(b).includes('repeated_phrase'), b);
});

test('«تقارير صحفية … موضحا» blocks, «موضحة» passes', () => {
  assert.ok(codes('أكدت تقارير صحفية مطلعة خلال بث مباشر أن الإدارة لا تحمله المسؤولية، موضحا أن ما حدث حادث مؤسف.').includes('scrubbed_reporter_gender'));
  assert.ok(!codes('أكدت تقارير صحفية مطلعة خلال بث مباشر أن الإدارة لا تحمله المسؤولية، موضحة أن ما حدث حادث مؤسف.').includes('scrubbed_reporter_gender'));
  assert.ok(BLOCKING_QA_CODES.includes('scrubbed_reporter_gender'));
});

test('body-part duals block, singular passes', () => {
  assert.ok(codes('قالت إن كفايتا تبدآن بالعرق فور إخبارها.').includes('dual_form'));
  assert.ok(codes('رفع يداه إلى السماء بعد الفوز.').includes('dual_form'));
  assert.ok(!codes('قالت إن العرق بدأ يتصبب من يدي فور إخبارها.').includes('dual_form'));
});
