// INCIDENTS #1362: «took to X/X» (Twitter→X turned «X/Twitter» into «X/X»), «بما قدماه» (dual verb) and «الذي جري بينهم» went live
import test from 'node:test';
import assert from 'node:assert/strict';
import { checkArticle, applyCorrections } from '../scripts/news-qa.ts';
import { twitterToX } from '../scripts/english-edition.ts';

const pad = ' وهذا نص إضافي عادي لملء الخبر.'.repeat(30);
const codes = (b: string) => checkArticle('عنوان عربي كامل للخبر هنا', b + pad, []).map((i: { code: string }) => i.code);

test('«X/Twitter» and «Twitter/X» become one «X»', () => {
  assert.equal(twitterToX('He took to X/Twitter to praise the crew.'), 'He took to X to praise the crew.');
  assert.equal(twitterToX('He posted on Twitter/X and Twitter (X).'), 'He posted on X and X.');
  assert.equal(twitterToX('He posted on Twitter.'), 'He posted on X.');
});

test('a dual verb with a pronoun «قدماه» blocks publishing', () => {
  assert.ok(codes('مشيدا بما قدماه منذ انضمامهم.').includes('dual_form'));
  assert.ok(!codes('مشيدا بما قدمه الثنائي منذ انضمامهم.').includes('dual_form'));
});

test('«جري بين» is corrected to «جرى بين»', () => {
  assert.equal(applyCorrections('التفاعل الذي جري بين الطرفين'), 'التفاعل الذي جرى بين الطرفين');
  assert.equal(applyCorrections('بعد الجري في الحلبة'), 'بعد الجري في الحلبة');
});
