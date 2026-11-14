// INCIDENTS #1312: «واجه روب فان دام عائقين في نفس الرحلة، تمثلا في…» (RVD story) passed every dual check, and 13 published
// stories had «لسببين»، «أمران أساسيان»، «خيارين»، «الأمرين». The Val Venis story wrote «إصبع الوسطى».
import test from 'node:test';
import assert from 'node:assert/strict';
import { checkArticle, applyCorrections } from '../scripts/news-qa.ts';

const pad = ' وهذا نص إضافي عادي لملء الخبر.'.repeat(30);
const duals = (b: string) => checkArticle('عنوان عربي كامل للخبر هنا', b + pad, []).filter((i: { code: string }) => i.code === 'dual_noun').length;

test('dual reasons, things and options block publishing', () => {
  for (const b of [
    'وبهذا، واجه روب فان دام عائقين في نفس الرحلة.',
    'المشكلة تمثلا في تعطل رحلته.',
    'قرر الاتحاد التخلي عن هذه الخطط لسببين؛ الأول هو الجدول.',
    'المرونة والقدرة على التكيف أمران أساسيان.',
    'تدرس WWE خيارين مختلفين.',
    'إنها مزيج من الأمرين.',
    'هما السببان الرئيسيان في وصوله.',
  ]) assert.ok(duals(b) > 0, b);
});

test('plural and singular forms pass', () => {
  for (const b of [
    'وبهذا تعرض روب فان دام لمشكلة مزدوجة في الرحلة نفسها.',
    'قرر الاتحاد التخلي عن هذه الخطط لعدة أسباب، أولها الجدول.',
    'تدرس WWE أكثر من خيار قبل القرار.',
    'العاملين في مجال المصارعة يعرفون ذلك.',
    'يتمثل الحل في تغيير الخطة.',
    'وجد طريقه إلى البطولة.',
  ]) assert.equal(duals(b), 0, b);
});

test('«إصبع الوسطى» is corrected', () => {
  assert.match(applyCorrections('قام بإظهار إصبع الوسطى له'), /الإصبع الأوسط/);
});
