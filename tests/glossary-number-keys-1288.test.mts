import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { applyNamesGlossary } from '../scripts/fightful-watcher';

// «128» → «وان توينتي إيت» in the names glossary turned «نمو 128%» in the Collision viewership story
// into «نمو وان توينتي إيت%» (INCIDENTS #1288).
test('every glossary key is a name: it has at least one letter', () => {
  const names = JSON.parse(fs.readFileSync('scripts/wrestler-names.json', 'utf8'));
  assert.deepEqual(Object.keys(names).filter((k) => !/\p{L}/u.test(k)), []);
});

test('numbers in a story are never translated by the glossary', () => {
  const t = 'بنسبة نمو بلغت 128.3% في إجمالي المشاهدين و128 ألف مشاهد';
  assert.equal(applyNamesGlossary(t), t);
});

test('no published story spells a number in English words with a percent sign', () => {
  const bad = fs.readdirSync('content/news').filter((f) => /(?:توينتي|ثيرتي|فورتي|فيفتي|هاندرد)[^\n%]{0,12}%/.test(fs.readFileSync(`content/news/${f}`, 'utf8')));
  assert.deepEqual(bad, []);
});
