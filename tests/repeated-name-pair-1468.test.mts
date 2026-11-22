// INCIDENTS #1468: «أن داكس هاروود وكاش ويلر سيدافع داكس هاروود وكاش ويلر عن بطولة» reached the site (FTR story, 22 Nov 2026).
import test from 'node:test';
import assert from 'node:assert/strict';
import { checkArticle } from '../scripts/news-qa.ts';

const pad = ' وهذا نص إضافي عادي لملء الخبر.'.repeat(30);
const codes = (b: string) => checkArticle('عنوان عربي كامل للخبر هنا', b + pad, []).filter((i: { excerpt: string }) => i.excerpt.trim() !== 'هذا نص إضافي عادي لملء الخبر').map((i: { code: string }) => i.code);

test('a pair of names written twice around one verb blocks publishing', () => {
  assert.ok(codes('وأعلن الاتحاد رسميا أن داكس هاروود وكاش ويلر سيدافع داكس هاروود وكاش ويلر عن البطولة.').includes('repeated_phrase'));
});

test('the fixed sentence passes', () => {
  assert.ok(!codes('وأعلن الاتحاد رسميا أن الثنائي داكس هاروود وكاش ويلر سيدافع عن البطولة.').includes('repeated_phrase'));
});
