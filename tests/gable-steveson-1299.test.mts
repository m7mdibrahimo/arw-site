// INCIDENTS #1299: the glossary writes Gable Steveson «غيبل ستيفسون», but an old UFC story (Jon Jones) had «غايبل».
import test from 'node:test';
import assert from 'node:assert/strict';
import { applyCorrections } from '../scripts/news-qa.ts';

test('«غايبل ستيفسون» becomes the glossary spelling', () => {
  assert.equal(applyCorrections('قرار إخراج غايبل ستيفسون من القفص'), 'قرار إخراج غيبل ستيفسون من القفص');
});
