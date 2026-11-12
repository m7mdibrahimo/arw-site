// INCIDENTS #1267: «Last we saw each other was backstage at Natural Born Killers» (an event) came out «في كواليس فيلم
// Natural Born Killers» in a story about the Bloodsport movie.
import test from 'node:test';
import assert from 'node:assert/strict';
import { fixEventCalledMovie } from '../scripts/news-qa.ts';

const src = 'Last we saw each other was backstage at Natural Born Killers and none of that was said. Riddle borrowed heavily from the 1988 Bloodsport movie. It is like you ripped off the movie Bloodsport.';

test('an event the story calls «فيلم» becomes «عرض»', () => {
  assert.equal(fixEventCalledMovie('آخر مرة التقينا فيها كانت في كواليس فيلم Natural Born Killers ولم يحدث أي حديث.', src),
    'آخر مرة التقينا فيها كانت في كواليس عرض Natural Born Killers ولم يحدث أي حديث.');
});

test('a real movie in the source stays «فيلم»', () => {
  assert.equal(fixEventCalledMovie('واتهمه بتقليد فيلم Bloodsport لعام 1988', src), 'واتهمه بتقليد فيلم Bloodsport لعام 1988');
  assert.equal(fixEventCalledMovie('شارك في فيلم The Marine', 'He starred in The Marine (2006).'), 'شارك في فيلم The Marine');
  assert.equal(fixEventCalledMovie('شارك في فيلم Fast X', 'He appears in the film Fast X.'), 'شارك في فيلم Fast X');
});

test('a name the source never mentions is left alone', () => {
  assert.equal(fixEventCalledMovie('شاهد فيلم Rocky', src), 'شاهد فيلم Rocky');
});
