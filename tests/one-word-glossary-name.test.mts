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
  assert.equal(names['Virus'], 'فيروس');
  const dir = 'content/news';
  // CMLL also has a luchador really named Virus («فيروس»): a story whose English twin lists «Virus» is right (INCIDENTS #1293)
  const enVirus = new Set(fs.readdirSync('content/news-en').map((f) => fs.readFileSync(path.join('content/news-en', f), 'utf8'))
    .filter((t) => /\bVirus\b/.test(t)).map((t) => (t.match(/^source_id:\s*(\S+)/m) || [])[1]));
  const bad = fs.readdirSync(dir).filter((f) => /cmll/i.test(f)).filter((f) => {
    const t = fs.readFileSync(path.join(dir, f), 'utf8');
    return /(?<![ء-ي])و?فيروس(?![ء-ي])/.test(t) && !enVirus.has((t.match(/^source_id:\s*(\S+)/m) || [])[1]);
  });
  assert.deepEqual(bad, []);
});
