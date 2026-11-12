// INCIDENTS #1251: a live-results story rewritten after every match got a new English title — and with it a new
// slug and file — each time, so its earlier URLs became 404s (three addresses in one hour on 11 November 2026,
// 57 older English stories the same). A story already on the English site keeps its address.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import matter from 'gray-matter';
import { saveEnglishEdition } from '../scripts/english-edition.ts';

const input = {
  sourceTitle: 'AEW Dynamite Results', sourceText: 'Will Ospreay and Kyle Fletcher came face to face. Ricochet won.',
  sourceUrl: 'https://www.fightful.com/x', sourceId: 802266374, arabicTitle: 'نتائج', arabicBody: 'نتائج العرض.',
  federation: 'AEW', image: '/content/images/a.jpg', date: '2026-11-12T03:19:08.000Z', filePrefix: '20261112051908',
} as any;
const body = 'Will Ospreay and Kyle Fletcher came face to face on AEW Dynamite, and Ricochet picked up a win in the opener of the night.';

test('a rewritten English story keeps its first slug and file, whatever its new title', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'news-en-1251-'));
  const first = saveEnglishEdition({ title: 'AEW Dynamite Collision Results for November 11, 2026', body, tags: [] }, input, dir);
  assert.equal(path.basename(first), '20261112051908-aew-dynamite-collision-results-for-november-11-2026.md');
  const second = saveEnglishEdition({ title: 'AEW Dynamite and Collision Results for November 11, 2026', body: body + ' More matches were added.', tags: [] }, input, dir);
  assert.equal(second, first);
  assert.deepEqual(fs.readdirSync(dir), [path.basename(first)]);
  const m = matter(fs.readFileSync(second, 'utf8'));
  assert.equal(m.data.slug, 'aew-dynamite-collision-results-for-november-11-2026');
  assert.equal(m.data.title, 'AEW Dynamite and Collision Results for November 11, 2026'); // the title itself is updated
  assert.match(m.content, /More matches were added/);
});

test('the English addresses lost this way before the fix redirect to where their story lives now', () => {
  const red = fs.readFileSync('_redirects', 'utf8');
  for (const from of ['/en/news/aew-dynamite-collision-results-november-11-2026/', '/en/news/tna-bound-for-glory-2026-results-and-highlights/', '/en/news/wwe-raw-results-october-19-2026/']) {
    assert.match(red, new RegExp(`^${from.replace(/[/.-]/g, '\\$&')}\\* /en/news/[a-z0-9-]+/ 301!$`, 'm'), from);
  }
});
