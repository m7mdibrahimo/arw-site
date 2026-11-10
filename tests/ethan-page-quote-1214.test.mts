import test from 'node:test';
import assert from 'node:assert/strict';
import { quotedTitleNotInSource } from '../scripts/news-qa.ts';
import { metaDescription } from '../lib/meta-description.cjs';
import { applyCorrections } from '../scripts/news-qa.ts';

test('quotedTitleNotInSource: a quote the source never said is flagged (Ethan Page, INCIDENTS #1214)', () => {
  const src = "WWE's Ethan Page Explains Why He Feels 'Weird' After Intercontinental Title Win\n\"I feel weird, mostly because this is the ultimate goal\"";
  assert.deepEqual(quotedTitleNotInSource("WWE's Ethan Page Explains Why He Feels 'I'm Weird' After Intercontinental Title Win", src), ["i'm weird"]);
  assert.deepEqual(quotedTitleNotInSource("WWE's Ethan Page Explains Why He Feels 'Weird' After Intercontinental Title Win", src), []);
  assert.deepEqual(quotedTitleNotInSource("Becky Lynch: Raquel Rodriguez Follows Around Liv Morgan Like She's a Puppy", 'x'), []);
  assert.deepEqual(quotedTitleNotInSource('Bret Hart Says Modern Wrestling Has Become “Hokey”', 'it has become "hokey" now'), []);
});

test('metaDescription: no «lawsuit involving.» and no «Almost a year after …» fragment (INCIDENTS #1214)', () => {
  const flair = 'Ric Flair expressed his great happiness following a significant legal victory alongside boxing legend Mike Tyson in a $50 million lawsuit involving a cannabis company. On Tuesday, November 10, 2026, a federal judge refused to dismiss the lawsuit.';
  const d1 = metaDescription(flair);
  assert.doesNotMatch(d1, /involving\.$/);
  assert.match(d1, /lawsuit\.$/);
  const gunn = "Westside Gunn's feud with WWE appears to be over. Almost a year after publicly cutting ties with the company, Gunn left a meeting with Nick Khan on good terms. Gunn posted on X on November 10 that he had just wrapped up one of the biggest meetings of his life.";
  const d2 = metaDescription(gunn);
  assert.doesNotMatch(d2, /with the company\.$/);
});

test('corrections: «ينود/هواي/بيفالو» are fixed (Jeff Cobb, Westside Gunn, INCIDENTS #1214)', () => {
  assert.equal(applyCorrections('لم ينود مغادرة الاتحاد، وأصوله في غوام وهواي، ومدينته بيفالو'), 'لم يرد مغادرة الاتحاد، وأصوله في غوام وهاواي، ومدينته بافالو');
});
