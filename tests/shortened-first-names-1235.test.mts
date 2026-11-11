// INCIDENTS #1235: «Alexis» (Mercedes Moné's sister) was published as «أليكس».
import test from 'node:test';
import assert from 'node:assert/strict';
import { fixShortenedFirstNames } from '../scripts/news-qa.ts';

test('a full first name in the source keeps its full Arabic spelling', () => {
  const src = 'The star took to her newsletter to reveal that she lost her younger sister, Alexis, in September.';
  assert.equal(fixShortenedFirstNames('فقدت شقيقتها الصغرى أليكس في شهر سبتمبر، وكانت «أليكس» تحب المصارعة.', src),
    'فقدت شقيقتها الصغرى أليكسيس في شهر سبتمبر، وكانت «أليكسيس» تحب المصارعة.');
  assert.equal(fixShortenedFirstNames('وتحدثت عن ذكرياتها مع أليكس.', src), 'وتحدثت عن ذكرياتها مع أليكسيس.');
});

test('the short name stays when the source uses it, and longer words are left alone', () => {
  const both = 'Alexis Bliss and Alex Shelley';
  assert.equal(fixShortenedFirstNames('أليكس شيلي', both), 'أليكس شيلي');
  assert.equal(fixShortenedFirstNames('أليكسا بليس وأليكس', 'Alexis'), 'أليكسا بليس وأليكسيس');
  assert.equal(fixShortenedFirstNames('جون سينا', 'Jonathan Gresham and John Cena'), 'جون سينا');
  assert.equal(fixShortenedFirstNames('أليكس شيلي', 'Alex Shelley'), 'أليكس شيلي');
});
