// INCIDENTS #1463: «محادثة ضمت إحدى التوأمين بيلا» (LA Knight story) passed every dual check, and
// «العرض الذي نظمه ستريمر Twitch أمين» (Raj Dhesi / Final Slam) was published with the English word.
import test from 'node:test';
import assert from 'node:assert/strict';
import { checkArticle, applyCorrections } from '../scripts/news-qa.ts';

const pad = ' وهذا نص إضافي عادي لملء الخبر.'.repeat(30);
const duals = (b: string) => checkArticle('عنوان عربي كامل للخبر هنا', b + pad, []).filter((i: { code: string }) => i.code === 'dual_noun').length;

test('dual twins block publishing', () => {
  for (const b of ['ضمت إحدى التوأمين بيلا.', 'وصل التوأمان إلى الحلبة.', 'هزم توأمين في ليلة واحدة.']) assert.ok(duals(b) > 0, b);
  assert.equal(duals('ظهرت إحدى توأم بيلا في العرض.'), 0);
});

test('«ستريمر Twitch» is corrected', () => {
  assert.match(applyCorrections('العرض الذي نظمه ستريمر Twitch أمين'), /نظمه صانع المحتوى على منصة تويتش أمين/);
  assert.match(applyCorrections('نظمه الستريمر على منصة تويتش أمين'), /صانع المحتوى على منصة تويتش أمين/);
});
