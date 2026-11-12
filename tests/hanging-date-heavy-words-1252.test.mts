import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { applyCorrections } from '../scripts/news-qa.ts';

const require = createRequire(import.meta.url);
const { metaDescription } = require('../lib/meta-description.cjs');

// INCIDENTS #1252: the El Clon English description ended «…the Young Bucks during the November 11.»
test('an English description never ends on «the <Month> <day>» cut from its noun', () => {
  const lead = 'El Clon made his in-ring return for AEW, pairing up alongside Brian Cage and Kevin Knight to battle Jack Perry and the Young Bucks during the November 11 episode of AEW Collision.\n\nHis prior appearance for the promotion occurred in August.';
  const d = metaDescription(lead);
  assert.doesNotMatch(d, /the November 11\.$/);
  assert.match(d, /\.$/);
});

test('«خالي الوفاض» and «آخر ظهور سابق» are rewritten before publishing', () => {
  assert.equal(applyCorrections('إلا أنه خرج في النهاية خالي الوفاض دون أي ألقاب.'), 'إلا أنه خرج في النهاية دون أي ألقاب.');
  assert.equal(applyCorrections('فرصتها لاستعادة اللقب منذ خروجها خالية الوفاض أمام بيرسيفوني.'), 'فرصتها لاستعادة اللقب منذ خسارته أمام بيرسيفوني.');
  assert.equal(applyCorrections('يعود آخر ظهور سابق لإل كلون إلى أغسطس.'), 'يعود آخر ظهور لإل كلون إلى أغسطس.');
});

test('a draw under 🏆 becomes 🤝, and «لعب X ضد Y» blocks publishing', async () => {
  const { fixDrawTrophy, checkArticle, BLOCKING_QA_CODES } = await import('../scripts/news-qa.ts');
  assert.equal(fixDrawTrophy('🏆 **النتيجة:** تعادل بسبب انتهاء العد خارج الحلبة.'), '🤝 **النتيجة:** تعادل بسبب انتهاء العد خارج الحلبة.');
  assert.equal(fixDrawTrophy('🏆 **الفائز:** ديفيد فينلي'), '🏆 **الفائز:** ديفيد فينلي');
  const body = 'نص تمهيدي عن العرض.\n\nلعبت بطلة العالم للسيدات في CMLL بيرسيفوني ضد جيبسي ماك، وانتهى النزال بفوز بيرسيفوني.';
  const codes = checkArticle('نتائج عرض AEW Dynamite', body, []).map((i: any) => i.code);
  assert.ok(codes.includes('played_against'));
  assert.ok(BLOCKING_QA_CODES.includes('played_against'));
  assert.ok(!checkArticle('خبر', 'وأكدت أنها ستعطي كل ما لديها وتلعب بأقصى طاقة ممكنة ضد ثاندر روزا.', []).some((i: any) => i.code === 'played_against'));
});

test('a live update that drops the opening scenes of a published results report is refused', async () => {
  const { resultsUpdateLostNarrative } = await import('../scripts/fightful-watcher.ts');
  const scene = 'بدأ العرض بفيديو عن نزال Blood & Guts الأسبوع الماضي. وفي الكواليس، دار نقاش حاد بين ويل أوسبراي وذا يانغ باكس وستيفن بوردن وآدم كوبلاند بعد خسارتهم. ';
  const oldBody = `أقيم العرض من صالة مافيريك سنتر.\n\n${scene.repeat(3)}\n\n**المواجهة الأولى: نزال فرق**\n\nفاز فريق على فريق.\n\n🏆 **الفائزون:** فريق`;
  const thin = 'شهد العرض أحداثا مثيرة.\n\n**المواجهة الأولى**\n\nواجه فريق فريقا وانتهى النزال بفوزه.\n\n🏆 **الفائزون:** فريق';
  assert.equal(resultsUpdateLostNarrative(oldBody, thin), true);
  assert.equal(resultsUpdateLostNarrative(oldBody, oldBody + '\n\n**الحدث الرئيسي**\n\nفازت.\n\n🏆 **الفائزة:** كوين أميناتا'), false);
});

test('an English embed link glued under the last sentence gets its own paragraph', async () => {
  const { embedOwnParagraph } = await import('../scripts/english-edition.ts');
  assert.equal(embedOwnParagraph('…wrestle more matches.\nhttps://www.youtube.com/watch?v=ahQeGMHCIN0'), '…wrestle more matches.\n\nhttps://www.youtube.com/watch?v=ahQeGMHCIN0');
  assert.equal(embedOwnParagraph('https://x.com/a/status/1\nhttps://x.com/b/status/2'), 'https://x.com/a/status/1\nhttps://x.com/b/status/2');
});
