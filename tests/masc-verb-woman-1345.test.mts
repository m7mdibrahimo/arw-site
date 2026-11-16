// INCIDENTS #1345: «قبل أن ينضم إليهم لاحقا ميلا مور» — a masculine verb before a woman's name blocks publishing.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkArticle, mascVerbBeforeWoman, BLOCKING_QA_CODES, RETRYABLE_QA_CODES } from '../scripts/news-qa';

test('a masculine verb right before a woman wrestler is caught and blocks', () => {
  assert.equal(mascVerbBeforeWoman('قبل أن ينضم إليهم لاحقا ميلا مور ليكتمل قوام الفريق'), 'ينضم إليهم لاحقا ميلا مور');
  assert.ok(mascVerbBeforeWoman('وفاز ريا ريبلي بالنزال'));
  const issues = checkArticle('فريق ذا دولهاوس يظهر في عرض TNA iMPACT', 'وضمت تيريل هارلي هدسون، قبل أن ينضم إليهم لاحقا ميلا مور.');
  assert.ok(issues.some(i => i.code === 'masc_verb_woman'));
  assert.ok(BLOCKING_QA_CODES.includes('masc_verb_woman') && RETRYABLE_QA_CODES.includes('masc_verb_woman'));
});

test('the feminine verb, a man, and «يظهر» meaning «shows» pass', () => {
  assert.equal(mascVerbBeforeWoman('قبل أن تنضم ميلا مور لاحقا إلى الفريق'), null);
  assert.equal(mascVerbBeforeWoman('وفازت ريا ريبلي بالنزال'), null);
  assert.equal(mascVerbBeforeWoman('فاز سيث رولينز على ريا ريبلي'), null);
  assert.equal(mascVerbBeforeWoman('مقطع فيديو يظهر أليكسا بليس'), null);
});
