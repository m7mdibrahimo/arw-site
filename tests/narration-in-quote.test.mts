import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkArticle } from '../scripts/news-qa.ts';

const pad = ' ' + 'كلام إضافي عن الخبر. '.repeat(40);
const title = 'تيفاني ستراتون تتحدث عن شخصيتها الشريرة في WWE';

test('narration leaking into a first-person quote is caught (Tiffany Stratton story, 2026-11-24)', () => {
  const body = 'وقالت: «أعرف كيف أكون قاسية. كنت الفتاة التي تجادل والدها دائما، واستغلت ذلك لتقديم شخصية حقيقية ومقنعة».' + pad;
  assert.ok(checkArticle(title, body).some((i) => i.code === 'narration_in_quote'));
});

test('the fixed sentence and a quote with its own subject pass', () => {
  const fixed = 'وقالت: «أعرف كيف أكون قاسية. كنت الفتاة التي تجادل والدي دائما»، وأوضحت أنها استغلت ذلك لتقديم شخصية حقيقية.' + pad;
  assert.ok(!checkArticle(title, fixed).some((i) => i.code === 'narration_in_quote'));
  const own = 'وقالت: «كنت مصابة واستغللت ذلك، وأنا سعيدة الآن».' + pad;
  assert.ok(!checkArticle(title, own).some((i) => i.code === 'narration_in_quote'));
});
