// INCIDENTS #1480/#1481: the owner — Arabic only («خليها عربي وبس»), and a story lives one month («خلي ان الاخبار تتمسح بعد
// شهر من اضافتها في الموقع عشان الاستهلاك والمساحة»). An old address of either goes to its Arabic page / the news page.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { publishedAt, expired, picturesIn, KEEP_DAYS } from '../scripts/expire-news';
import { goneTarget } from '../site-worker/fast.js';
import { ENGLISH_EDITION } from '../scripts/fightful-watcher';

const story = (head: string, body = '') => `---\ntitle: "x"\n${head}\n---\n${body}`;
const now = Date.parse('2026-11-22T12:00:00Z');

test('INCIDENTS #1481: a story is expired 30 days after it reached the site (published_at, else date)', () => {
  assert.equal(KEEP_DAYS, 30);
  assert.equal(publishedAt(story('date: 2026-10-01T10:00:00.000+03:00\npublished_at: 2026-10-02T07:00:00.000Z')), Date.parse('2026-10-02T07:00:00.000Z'));
  assert.equal(publishedAt(story('date: "2026-10-01T10:00:00.000+03:00"')), Date.parse('2026-10-01T10:00:00.000+03:00'));
  assert.equal(expired(story('published_at: 2026-10-22T11:00:00.000Z'), now), true);
  assert.equal(expired(story('published_at: 2026-10-23T13:00:00.000Z'), now), false);
  assert.equal(expired(story('title2: no date at all'), now), false, 'a story with no date is never deleted');
});

test('INCIDENTS #1481: its pictures are found in the header and the body', () => {
  assert.deepEqual(picturesIn(story('image: /content/images/ab12.jpg', 'text ![](/content/images/cd34.webp) and /content/images/ab12.jpg')).sort(), ['ab12.jpg', 'cd34.webp']);
});

test('INCIDENTS #1481: pictures go from R2 only after the deletion reached main, and only those no page uses', () => {
  const wf = fs.readFileSync('.github/workflows/expire-news.yml', 'utf8');
  assert.match(wf, /cron: '23 2 \* \* \*'/);
  assert.ok(wf.indexOf('git push origin HEAD:main') < wf.indexOf('--drop-pictures'));
  assert.match(wf, /if: steps\.expire\.outputs\.pushed == '1'/);
  // the retry loop never writes over the first list (the first run removed no picture that way)
  assert.equal(wf.match(/--out \/tmp\/expired-pictures\.json/g)!.length, 1);
  assert.match(wf, /--drop-pictures \/tmp\/expired-again\.json/);
  const src = fs.readFileSync('scripts/expire-news.ts', 'utf8');
  assert.match(src, /filter\(\(p\) => !used\.has\(p\)\)/);
});

test('INCIDENTS #1480/#1481: an old English address goes to its Arabic page, a deleted story to the news page', () => {
  assert.equal(goneTarget('/en/'), '/');
  assert.equal(goneTarget('/en'), '/');
  assert.equal(goneTarget('/en/shows/wwe-raw/'), '/shows/wwe-raw/');
  assert.equal(goneTarget('/en/news/some-story/'), '/news/');
  assert.equal(goneTarget('/en/news/'), '/news/');
  assert.equal(goneTarget('/news/خبر-قديم/'), '/news/');
  assert.equal(goneTarget('/news/'), null);
  assert.equal(goneTarget('/shows/x/'), null);
  assert.equal(goneTarget('/enigma/'), null);
});

test('INCIDENTS #1480: no English story is written, and /en/ is not built', () => {
  assert.equal(ENGLISH_EDITION, false);
  // The folder stays (empty, .gitkeep) so old checks that list it still run (INCIDENTS #1484); no English story lives in it.
  assert.deepEqual(fs.existsSync('content/news-en') ? fs.readdirSync('content/news-en').filter((f) => f.endsWith('.md')) : [], []);
  assert.doesNotMatch(fs.readFileSync('eleventy.config.js', 'utf8'), /eleventyConfig\.on\("eleventy\.after", englishCopy\)/);
});

test('INCIDENTS #1507: an expired story\'s picture leaves the backup too, and nothing else does', () => {
  const src = fs.readFileSync('scripts/expire-news.ts', 'utf8');
  assert.match(src, /deleteMedia\(`content\/images\/\$\{p\}`, \{ withBackup: true \}\)/);
  const store = fs.readFileSync('scripts/media-store.ts', 'utf8');
  assert.match(store, /opts\.withBackup \? "\?backup=1" : ""/);
  const media = fs.readFileSync('media-worker/src/index.ts', 'utf8');
  assert.match(media, /url\.searchParams\.get\("backup"\) === "1" && key\.startsWith\("content\/images\/"\)/);
  // the reels and the other deletes don't ask for it
  assert.doesNotMatch(fs.readFileSync('scripts/show-reel-monitor.ts', 'utf8'), /withBackup/);
});
