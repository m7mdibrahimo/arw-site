// INCIDENTS #1259: «his Kliq This podcast» came out «برنامج الكواليس الخاص به», and «You were the first person that
// came to me» came out «كنت أول شخص يأتي إلي» (reads «I was» with no tashkeel).
import test from 'node:test';
import assert from 'node:assert/strict';
import { podcastNameTranslated, fixYouWereQuote } from '../scripts/news-qa.ts';

test('a podcast the source names in English and the story renames in Arabic is caught', () => {
  assert.deepEqual(podcastNameTranslated('طالب بإقالته خلال استضافته في برنامج الكواليس الخاص به', 'during an episode of his Kliq This podcast'), ['Kliq This']);
});

test('the English name kept, or a plain «برنامجه/البرنامج», passes', () => {
  assert.deepEqual(podcastNameTranslated('في بودكاست Kliq This الخاص به', 'his Kliq This podcast'), []);
  assert.deepEqual(podcastNameTranslated('خلال استضافته في برنامجه وفي أحدث حلقات البرنامج', 'on What Do You Want To Talk About?'), []);
  assert.deepEqual(podcastNameTranslated('تحدث في برنامج الواقع', 'on Busted Open'), []);
  assert.deepEqual(podcastNameTranslated('في برنامج الكواليس', 'an unrelated source with no known podcast'), []);
});

test('«You were the first» quote gets its «أنت»', () => {
  const src = '"You were the first person that came to me and asked me what I wanted," Rhodes recalled.';
  assert.equal(fixYouWereQuote('وقال كودي: «كنت أول شخص يأتي إلي ويسألني عما أريده».', src), 'وقال كودي: «أنت أول شخص يأتي إلي ويسألني عما أريده».');
  assert.equal(fixYouWereQuote('«كنت أول شخص يأتي إلي»', 'I was the first person there'), '«كنت أول شخص يأتي إلي»');
});
