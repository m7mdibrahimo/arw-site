// INCIDENTS #1284: the English FAA ground-stop story showed «\"due to extraordinary circumstances…\"» on its page —
// a quote mark Gemini escaped twice in its JSON reached the text with its backslash. It is a plain quote mark now.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import matter from 'gray-matter';
import { saveEnglishEdition, unescapeQuotes } from '../scripts/english-edition.ts';

test('an escaped quote mark is a plain one', () => {
  assert.equal(unescapeQuotes('issued \\"due to safety,\\" it said'), 'issued "due to safety," it said');
  assert.equal(unescapeQuotes('no quotes here'), 'no quotes here');
});

test('a saved English story never keeps «\\"» in its text (INCIDENTS #1284)', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'news-en-1284-'));
  const file = saveEnglishEdition({
    title: 'FAA Orders Nationwide Ground Stop at All U.S. Airports',
    body: 'The Federal Aviation Administration issued a nationwide ground stop. The agency said the directive was issued \\"due to extraordinary circumstances and for reasons of safety,\\" and that all departing traffic should stay on the ground.',
    tags: [],
  }, {
    sourceTitle: 'FAA Orders Ground Stop', sourceText: 'The FAA issued a ground stop due to extraordinary circumstances and for reasons of safety.',
    sourceUrl: 'https://www.fightful.com/x', sourceId: 999001284, arabicTitle: 'وقف الرحلات', arabicBody: 'وقف الرحلات.',
    federation: 'WWE', image: '/content/images/a.jpg', date: '2026-11-13T22:32:45.000Z', filePrefix: '20261114003245',
  } as any, dir);
  const m = matter(fs.readFileSync(file, 'utf8'));
  assert.doesNotMatch(m.content, /\\"/);
  assert.match(m.content, /issued "due to extraordinary circumstances and for reasons of safety,"/);
});
