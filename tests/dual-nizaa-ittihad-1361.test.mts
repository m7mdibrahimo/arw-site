// INCIDENTS #1361: «وشارك بانك في نزاعين» (Lizzy Rain story) and «في اتحادين WWE وWCW» (Kevin Nash travel story,
// 16 Nov 2026) passed every dual check: «نزاع» was not listed, nor «اتحادين/اتحادي» before a promotion name.
import test from 'node:test';
import assert from 'node:assert/strict';
import { checkArticle } from '../scripts/news-qa.ts';

const pad = ' وهذا نص إضافي عادي لملء الخبر.'.repeat(30);
const duals = (b: string) => checkArticle('عنوان عربي كامل للخبر هنا', b + pad, []).filter((i: { code: string }) => i.code === 'dual_noun').length;

test('«نزاعين» and «اتحادين WWE» block publishing', () => {
  for (const b of [
    'وشارك بانك في نزاعين ضمن عروض WWE NXT Live.',
    'خلال فترة العمل المزدحمة في اتحادين WWE وWCW.',
    'من جانب مسؤولي اتحادي WWE وAAA.',
  ]) assert.ok(duals(b) > 0, b);
});

test('«بين الاتحادين» and plurals pass', () => {
  for (const b of [
    'تتواصل الشراكة بين الاتحادين منذ عام 2025.',
    'شارك بانك في نزاعات كثيرة ضمن عروض WWE.',
    'يتنافس WWE وWCW على الجماهير.',
  ]) assert.equal(duals(b), 0, b);
});
