// INCIDENTS #1558: the Alexa Bliss/Bray Wyatt story said «قبل أن ينفصلا» (a dual subjunctive no list knew).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fixSubjunctiveDuals, applyCorrections } from '../scripts/news-qa.ts';

test('separate/part/ally/team-up dual subjunctives become the plural', () => {
  assert.equal(fixSubjunctiveDuals('قبل أن ينفصلا بطريقة درامية'), 'قبل أن ينفصلوا بطريقة درامية');
  assert.equal(fixSubjunctiveDuals('قبل أن يفترقا'), 'قبل أن يفترقوا');
  assert.equal(fixSubjunctiveDuals('ليتحالفا ضد الجميع'), 'ليتحالفوا ضد الجميع');
  assert.equal(fixSubjunctiveDuals('أن يتعاونا مجددا'), 'أن يتعاونوا مجددا');
  assert.match(applyCorrections('قبل أن ينفصلا رسميا'), /ينفصلوا/);
});
