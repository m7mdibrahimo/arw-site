// INCIDENTS #1241: «أن تحسم المجموعتان صراعهم» (Royce Keys), «دافعت المجموعتان ميتشين وبي فاب» (SmackDown results),
// «خلق المحتوى» and «أمنته بمركز نفسي أفضل» (Austin Creed) went live.
import test from 'node:test';
import assert from 'node:assert/strict';
import { applyCorrections, checkArticle, BLOCKING_QA_CODES } from '../scripts/news-qa.ts';

const filler = ' وهذا نص إضافي طويل بما يكفي للفحص.'.repeat(30);

test('«المجموعتان / المجموعتين» is a dual noun that blocks publishing', () => {
  for (const s of ['ومن المقرر أن تحسم المجموعتان صراعهم المستمر', 'دافعت المجموعتان ميتشين وبي فاب عن لقبهم', 'ضمن المجموعتين A وB', 'جرى توزيعهم على مجموعتين']) {
    const codes = checkArticle('عنوان عربي كامل للخبر هنا', s + filler, []).map(i => i.code);
    assert.ok(codes.includes('dual_noun'), s);
  }
  assert.ok(BLOCKING_QA_CODES.includes('dual_noun'));
  const ok = checkArticle('عنوان عربي كامل للخبر هنا', 'ضمن المجموعة A والمجموعة B' + filler, []).map(i => i.code);
  assert.ok(!ok.includes('dual_noun'));
});

test('the wrong words of #1241 are corrected', () => {
  assert.equal(applyCorrections('بعد سنوات من السفر وخلق المحتوى'), 'بعد سنوات من السفر وصناعة المحتوى');
  assert.equal(applyCorrections('هذه العقلية أمنته بمركز نفسي أفضل'), 'هذه العقلية أمنته بحالة نفسية أفضل');
});

test('dual «جعلا» / «متشابهتان» block publishing; «بتولى» is corrected', () => {
  for (const s of ['طوله ووزنه جعلا نجوم WWE يظهرون بشكل أصغر', 'لعبة League of Legends والمصارعة متشابهتان للغاية']) {
    const codes = checkArticle('عنوان عربي كامل للخبر هنا', s + filler, []).map(i => i.code);
    assert.ok(codes.includes('dual_form'), s);
  }
  const ok = checkArticle('عنوان عربي كامل للخبر هنا', 'طوله ووزنه جعلت نجوم WWE يظهرون بشكل أصغر' + filler, []).map(i => i.code);
  assert.ok(!ok.includes('dual_form'));
  assert.equal(applyCorrections('مهتم بتولى تمثيله'), 'مهتم بتولي تمثيله');
});
