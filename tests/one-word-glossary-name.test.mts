import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fixNearGlossaryNames } from '../scripts/news-qa';

// CMLL's Feroz came out «فيروز» in six stories and «فيروس» in four (INCIDENTS #1156).
test('a one-word glossary name one letter off takes the glossary spelling', () => {
  assert.equal(fixNearGlossaryNames('فاز الثنائي ستيغما وأسترال على الثنائي فيروس ودستوربيو.', ['فيروز']), 'فاز الثنائي ستيغما وأسترال على الثنائي فيروز ودستوربيو.');
  assert.equal(fixNearGlossaryNames('ضد فالينتي وفيروس.', ['فيروز']), 'ضد فالينتي وفيروز.');
});

test('other words are left alone', () => {
  assert.equal(fixNearGlossaryNames('فيروسات كثيرة وفيرو', ['فيروز']), 'فيروسات كثيرة وفيرو');
  assert.equal(fixNearGlossaryNames('فيروز وفيروس', ['فيروز']), 'فيروز وفيروس');
  assert.equal(fixNearGlossaryNames('نيوب ضد نيون', ['نيون']), 'نيوب ضد نيون');
});

test('Feroz is in the glossary and no published CMLL story spells him «فيروس»', () => {
  const names = JSON.parse(fs.readFileSync('scripts/wrestler-names.json', 'utf8'));
  assert.equal(names['Feroz'], 'فيروز');
  const dir = 'content/news';
  const bad = fs.readdirSync(dir).filter((f) => /cmll/i.test(f)).filter((f) => /(?<![ء-ي])و?فيروس(?![ء-ي])/.test(fs.readFileSync(path.join(dir, f), 'utf8')));
  assert.deepEqual(bad, []);
});
