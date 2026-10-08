// The English edition the news bots write for each new story (scripts/english-edition.ts, INCIDENTS #354)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import matter from 'gray-matter';
import { checkEnglish, saveEnglishEdition, writeEnglishEdition, findEnglishEdition, englishSlug, dedupeEnglishEditions, englishPrompt, wordCount, type EnglishInput } from '../scripts/english-edition.ts';

const source = 'Cody Rhodes is making the first major change to the American Nightmare logo since he returned to WWE in 2022. The update honors his late dog Pharaoh, who appeared at many WWE events and became a fan favorite on social media. Rhodes said the change was something he had wanted to do for months and that fans will see it on merchandise soon.';
const input: EnglishInput = {
  sourceTitle: 'Cody Rhodes Changing American Nightmare Logo To Honor Late Dog Pharaoh', sourceText: source,
  sourceUrl: 'https://www.ringsidenews.com/cody-rhodes-logo/', sourceId: 802252223,
  arabicTitle: 'كودي رودز يغير شعار American Nightmare', arabicBody: 'كشف كودي رودز...\n\n<https://www.youtube.com/watch?v=abc>\n',
  federation: 'WWE', image: '/content/images/b.jpg', date: '2026-10-07T21:55:39.000Z', filePrefix: '20261008005539',
};
const good = {
  title: 'Cody Rhodes Changing American Nightmare Logo to Honor His Late Dog Pharaoh',
  body: 'Cody Rhodes is updating his American Nightmare logo for the first time, and the new look pays tribute to his late dog, Pharaoh.\n\nPharaoh was a regular at WWE shows and a favorite with fans online. Rhodes said he had planned the change for months, according to Ringside News.',
  tags: ['Cody Rhodes', 'WWE', 'كودي'],
};

test('an English edition that reads like the source, has Arabic, or talks about itself is held back', () => {
  assert.deepEqual(checkEnglish(good, input), []);
  assert.ok(checkEnglish({ ...good, body: good.body + ' كودي' }, input).includes('Arabic letters'));
  assert.ok(checkEnglish({ ...good, body: good.body + '\n\nThis story was translated for Arab Wrestling.' }, input).includes('meta text'));
  assert.ok(checkEnglish({ ...good, body: 'The update honors his late dog Pharaoh, who appeared at many WWE events and became a fan favorite on social media. ' + good.body }, input).includes('copied from the source'));
  // a direct quote may repeat the source word for word
  assert.deepEqual(checkEnglish({ ...good, body: good.body + '\n\n> "The update honors his late dog Pharaoh, who appeared at many WWE events and became a fan favorite on social media."' }, input), []);
  assert.ok(checkEnglish({ ...good, body: '## Heading\n\n' + good.body }, input).includes('markdown formatting'));
  assert.ok(checkEnglish({ ...good, title: 'Short' }, input).includes('title length'));
});

test('the edition is saved once per source story, with its embeds, English tags and the Arabic story\'s picture', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'news-en-'));
  const file = saveEnglishEdition(good, input, dir);
  assert.equal(path.basename(file), '20261008005539-cody-rhodes-changing-american-nightmare-logo-to-honor-his-late-dog-pharaoh.md');
  const m = matter(fs.readFileSync(file, 'utf8'));
  assert.equal(m.data.source_id, 802252223);
  assert.equal(m.data.image, '/content/images/b.jpg');
  assert.deepEqual(m.data.en_tags, ['Cody Rhodes', 'WWE']); // never «tags»: those are the Arabic site's tag pages
  assert.equal(m.data.tags, undefined);
  assert.match(m.data.description, /^Cody Rhodes is updating/);
  assert.match(m.content, /<https:\/\/www\.youtube\.com\/watch\?v=abc>\s*$/);
  // a second edition of the same story replaces the first
  const again = saveEnglishEdition({ ...good, title: 'Cody Rhodes Unveils a New American Nightmare Logo for Pharaoh' }, input, dir);
  assert.deepEqual(fs.readdirSync(dir), [path.basename(again)]);
  assert.equal(findEnglishEdition(802252223, dir), again);
  assert.equal(englishSlug('AEW’s "Big" Night: Moxley & Co.'), 'aews-big-night-moxley-co');
});

test('writing: retried once, never saved when it doesn\'t pass, never for a story before the English news began', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'news-en-'));
  let asked = 0;
  assert.equal(await writeEnglishEdition({ ...input, date: '2026-10-01T00:00:00.000Z' }, async () => { asked++; return JSON.stringify(good); }, dir), null);
  assert.equal(asked, 0);
  assert.equal(await writeEnglishEdition(input, async () => { asked++; return JSON.stringify({ ...good, title: 'كودي' }); }, dir), null);
  assert.equal(asked, 2);
  assert.deepEqual(fs.readdirSync(dir), []);
  const replies = ['not json', '```json\n' + JSON.stringify(good) + '\n```'];
  const file = await writeEnglishEdition(input, async () => replies.shift()!, dir);
  assert.ok(file && fs.existsSync(file));
});

test('two bots writing the same story at once: the second edition goes, its address sent to the first (INCIDENTS #355)', () => {
  const a = fs.mkdtempSync(path.join(os.tmpdir(), 'news-en-a-'));
  const b = fs.mkdtempSync(path.join(os.tmpdir(), 'news-en-b-'));
  const first = saveEnglishEdition({ ...good, title: 'Cody Rhodes Modifying American Nightmare Logo to Honor Late Dog Pharaoh' }, input, a);
  const second = saveEnglishEdition({ ...good, title: 'Cody Rhodes Updating American Nightmare Logo to Honor Pharaoh' }, input, b);
  fs.copyFileSync(second, path.join(a, path.basename(second))); // what the two bots' commits left on main
  const red = path.join(b, '_redirects');
  fs.writeFileSync(red, '/old/* /new/ 301!\n');
  assert.equal(dedupeEnglishEditions(a, red), 1);
  assert.deepEqual(fs.readdirSync(a), [path.basename(first)]);
  assert.match(fs.readFileSync(red, 'utf8'), /^\/en\/news\/cody-rhodes-updating-american-nightmare-logo-to-honor-pharaoh\/\* \/en\/news\/cody-rhodes-modifying-american-nightmare-logo-to-honor-late-dog-pharaoh\/ 301!$/m);
  assert.equal(dedupeEnglishEditions(a, red), 0); // nothing left to do
});

test('the English edition is asked to be as long as the Arabic one', () => {
  const arabicBody = Array(150).fill('كلمة').join(' ') + '\n\n<https://www.youtube.com/watch?v=abc>';
  assert.equal(wordCount(arabicBody), 150);
  assert.match(englishPrompt({ ...input, arabicBody }), /about 150 words \(never more than 180\)/);
});
