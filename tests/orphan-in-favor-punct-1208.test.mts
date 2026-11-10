// INCIDENTS #1208: «والذي حسمه ري فينيكس لصالح، بينما…» — «لصالح» with no pronoun before a comma.
import test from 'node:test';
import assert from 'node:assert/strict';
import { checkArticle, BLOCKING_QA_CODES } from '../scripts/news-qa.ts';

const pad = ' كلام عادي كثير '.repeat(40);
const codes = (b: string) => checkArticle('عنوان تجريبي طويل بما يكفي للفحص هنا', b + pad).map((i) => i.code);

test('orphan_in_favor blocks «لصالح» right before punctuation', () => {
  assert.ok(BLOCKING_QA_CODES.includes('orphan_in_favor'));
  assert.ok(codes('قرر بيرس إقامة نزال ثلاثي، والذي حسمه ري فينيكس لصالح، بينما احتفل بايج.').includes('orphan_in_favor'));
  assert.ok(codes('تجاوز منافسه ليحسم لقب البطولة لصالح.').includes('orphan_in_favor'));
});

test('orphan_in_favor leaves «لصالحه،» and names like «الصالح» alone', () => {
  assert.ok(!codes('تجاوز منافسه ليحسم لقب البطولة لصالحه، منتزعا فرصة كبيرة.').includes('orphan_in_favor'));
  assert.ok(!codes('فاز على فريق The 8th Day المكون من تيمور العظيم وعدي الصالح.').includes('orphan_in_favor'));
  assert.ok(!codes('حسم النزال لصالح فريقه، ثم احتفل.').includes('orphan_in_favor'));
});
