// INCIDENTS #1358: «بعد دعوته السابقة لنجمي التميز نوام دار وروميو مورينو» (RAW preview, 16 Nov 2026) and
// «يشيد بنجمي WWE تريك ويليامز وأوبا فيمي» passed every dual check: the construct dual of «نجم» was not listed.
import test from 'node:test';
import assert from 'node:assert/strict';
import { checkArticle } from '../scripts/news-qa.ts';

const pad = ' وهذا نص إضافي عادي لملء الخبر.'.repeat(30);
const duals = (b: string) => checkArticle('عنوان عربي كامل للخبر هنا', b + pad, []).filter((i: { code: string }) => i.code === 'dual_noun').length;

test('construct dual «نجمي X» blocks publishing', () => {
  for (const b of [
    'وذلك بعد دعوته السابقة لنجمي التميز نوام دار وروميو مورينو.',
    'أشاد ام جيه اف بنجمي WWE تريك ويليامز وأوبا فيمي.',
    'نزال سريع بين نجمي AAA في الجولة الأولى.',
  ]) assert.ok(duals(b) > 0, b);
});

test('names, plural and «نجمي المفضل» pass', () => {
  for (const b of [
    'وذلك بعد أن وجه الدعوة إلى نوام دار وروميو مورينو.',
    'أشاد ام جيه اف بتريك ويليامز وأوبا فيمي من WWE.',
    'قال: "إنه نجمي المفضل منذ الطفولة".',
    'يضم العرض نجوم AEW الكبار.',
  ]) assert.equal(duals(b), 0, b);
});
