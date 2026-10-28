// The English edition the news bots write for each new story (scripts/english-edition.ts, INCIDENTS #354)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import matter from 'gray-matter';
import { englishStyleRules, checkEnglish, saveEnglishEdition, writeEnglishEdition, findEnglishEdition, englishSlug, dedupeEnglishEditions, englishPrompt, wordCount, embedLines, syncEnglishFromArabic, catchUpEnglishEditions, type EnglishInput } from '../scripts/english-edition.ts';

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
  assert.ok(checkEnglish({ ...good, title: 'Logan Paul: These Female Wrestler On Some Other Shit' }, input).includes('profanity in title'));
  assert.ok(checkEnglish({ ...good, body: good.body + '\n\nThis story was translated for Arab Wrestling.' }, input).includes('meta text'));
  assert.ok(checkEnglish({ ...good, body: 'The update honors his late dog Pharaoh, who appeared at many WWE events and became a fan favorite on social media. ' + good.body }, input).includes('copied from the source'));
  // a direct quote may repeat the source word for word
  assert.deepEqual(checkEnglish({ ...good, body: good.body + '\n\n> "The update honors his late dog Pharaoh, who appeared at many WWE events and became a fan favorite on social media."' }, input), []);
  assert.ok(checkEnglish({ ...good, body: '## Heading\n\n' + good.body }, input).includes('markdown formatting'));
  assert.ok(checkEnglish({ ...good, title: 'Short' }, input).includes('title length'));
  // a headline that hides whose story it is (live 2026-10-27/28 on /en/)
  assert.ok(checkEnglish({ ...good, title: 'TNA Talent Drawing Outside Interest as Contract Nears Expiration' }, input).includes('vague headline'));
  assert.ok(checkEnglish({ ...good, title: "Major Update on Bruce Prichard's WWE Future" }, input).includes('vague headline'));
  assert.ok(!checkEnglish({ ...good, title: 'TNA Star Joe Hendry Signs New Contract' }, input).includes('vague headline'));
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
  // A hard cut at 80 letters cut a word in half in three live addresses («…his-character-change-a»,
  // «…dream-ma», «…royal-rumb», 2026-10-27): the slug ends on a whole word.
  const long = englishSlug('Tony D\'Angelo Says A Lot of Behind the Scenes Stuff Caused His Character Change and the Family Breakup');
  assert.ok(long.length <= 80, long);
  assert.ok(!/-[a-z]{1,2}$/.test(long), long);
  assert.ok(!long.endsWith('dream-ma'), long);
  assert.equal(englishSlug('Sami Zayn Thought His Chance at the WWE Championship Had Passed After Royal Rumble 2026').slice(-4) === 'rumb', false);

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

test('the Arabic story\'s posts and videos — bare links, as the bots write them — and its pictures reach the English one (INCIDENTS #359)', () => {
  const arabicBody = 'كشف كودي رودز...\n\nhttps://www.youtube.com/watch?v=abc\n\nhttps://x.com/CodyRhodes/status/123\n\n<https://www.instagram.com/p/XyZ/>\n';
  assert.deepEqual(embedLines(arabicBody), ['https://www.youtube.com/watch?v=abc', 'https://x.com/CodyRhodes/status/123', '<https://www.instagram.com/p/XyZ/>']);
  assert.equal(wordCount(arabicBody), 3); // the links are no words
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'news-en-'));
  const file = saveEnglishEdition({ ...good, body: good.body + '\n\nhttps://x.com/CodyRhodes/status/123' }, { ...input, arabicBody, gallery: ['/content/images/g1.jpg', '/content/images/g2.jpg'] }, dir);
  const m = matter(fs.readFileSync(file, 'utf8'));
  assert.deepEqual(m.data.gallery, ['/content/images/g1.jpg', '/content/images/g2.jpg']);
  assert.equal(m.content.match(/x\.com\/CodyRhodes\/status\/123/g)!.length, 1); // already there: not added twice
  assert.match(m.content, /^https:\/\/www\.youtube\.com\/watch\?v=abc$/m);
  assert.match(m.content, /^<https:\/\/www\.instagram\.com\/p\/XyZ\/>$/m);
  assert.doesNotMatch(m.data.description, /https?:/);
});

test('English stories written before catch up with their Arabic story\'s posts, videos and pictures, without a request', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sync-'));
  const en = path.join(root, 'news-en'), ar = path.join(root, 'news');
  fs.mkdirSync(en); fs.mkdirSync(ar);
  const enFile = saveEnglishEdition(good, { ...input, arabicBody: 'نص' }, en); // written when the Arabic story had nothing
  fs.writeFileSync(path.join(ar, '20261008005539-x.md'), '---\ntitle: "خبر"\nsource_id: 802252223\nimage: /content/images/b.jpg\ngallery:\n  - /content/images/g1.jpg\n---\nنص\n\nhttps://x.com/a/status/1\n\nhttps://www.youtube.com/watch?v=abcdefghijk\n');
  assert.equal(syncEnglishFromArabic(en, ar), 1);
  const m = matter(fs.readFileSync(enFile, 'utf8'));
  assert.deepEqual(m.data.gallery, ['/content/images/g1.jpg']);
  assert.equal(m.data.image, '/content/images/b.jpg');
  assert.match(m.content, /\n\nhttps:\/\/x\.com\/a\/status\/1\n\nhttps:\/\/www\.youtube\.com\/watch\?v=abcdefghijk\n$/);
  assert.equal(syncEnglishFromArabic(en, ar), 0); // up to date: untouched
});

test("English rules tell Gemini not to call a past event upcoming (INCIDENTS #432)", () => {
  assert.match(englishStyleRules("https://x.com/a"), /upcoming/);
});

test('an English edition whose Arabic story was skipped as a duplicate is removed, its address sent to the story it duplicates (INCIDENTS #494)', async () => {
  const { pruneDuplicateOrphanEnglish } = await import('../scripts/english-edition.ts');
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'orphan-'));
  const en = path.join(root, 'en'), ar = path.join(root, 'ar');
  fs.mkdirSync(en); fs.mkdirSync(ar);
  const fm = (id: number, url: string, extra = '') => `---\ntitle: "T"\nsource_id: ${id}\nsource_url: "${url}"\n${extra}---\nbody\n`;
  fs.writeFileSync(path.join(ar, '20261013192723-a.md'), fm(1, 'https://f.com/a/'));
  fs.writeFileSync(path.join(en, '20261013192723-first-story.md'), fm(1, 'https://f.com/a/', 'slug: "first-story"\n'));
  fs.writeFileSync(path.join(en, '20261013194547-second-story.md'), fm(2, 'https://r.com/b/', 'slug: "second-story"\n'));
  fs.writeFileSync(path.join(en, '20261013194600-kept.md'), fm(3, 'https://r.com/c/', 'slug: "kept"\n'));
  const skips = path.join(root, 'skips.json');
  fs.writeFileSync(skips, JSON.stringify({ 'https://r.com/b/': { matchedFile: '20261013192723-a.md' } }));
  const red = path.join(root, '_redirects');
  fs.writeFileSync(red, '/old/* /new/ 301!\n');
  assert.equal(pruneDuplicateOrphanEnglish(en, ar, skips, red), 1);
  assert.deepEqual(fs.readdirSync(en).sort(), ['20261013192723-first-story.md', '20261013194600-kept.md']);
  assert.match(fs.readFileSync(red, 'utf8'), /^\/en\/news\/second-story\/\* \/en\/news\/first-story\/ 301!$/m);
  assert.equal(pruneDuplicateOrphanEnglish(en, ar, skips, red), 0);
});

test('a number the source never says blocks the English edition (INCIDENTS #516)', () => {
  const src = { ...input, sourceText: input.sourceText + ' He wrestled 150 to 200 matches a year, about 1,200 in total.' };
  const ok = { ...good, body: good.body + ' He worked 150 to 200 matches a year, about 1,200 in total, since 2012.' };
  assert.deepEqual(checkEnglish(ok, src), []);
  assert.ok(checkEnglish({ ...ok, body: ok.body.replace('200 matches', '250 matches') }, src).some((x) => x.startsWith('number not in source')));
});

test("a contraction glued to the next word in a headline gets its space (INCIDENTS #535: «He'sStill»)", async () => {
  const { normalizeEnglishTitle } = await import("../scripts/english-edition.ts");
  assert.equal(normalizeEnglishTitle("David Finlay Details Aspects of AEW He'sStill Adjusting To"), "David Finlay Details Aspects of AEW He's Still Adjusting To");
  assert.equal(normalizeEnglishTitle("CM Punk Isn't Done"), "CM Punk Isn't Done");
});

test('«the Rock» keeps its capital T in a headline (INCIDENTS #551)', async () => {
  const { normalizeEnglishTitle } = await import("../scripts/english-edition.ts");
  assert.equal(normalizeEnglishTitle("Cody Rhodes Calls Relationship With the Rock Complicated"), "Cody Rhodes Calls Relationship With The Rock Complicated");
  assert.equal(normalizeEnglishTitle("John Cena Will Not Pitch the Rock on a Team-Up"), "John Cena Will Not Pitch The Rock on a Team-Up");
});

test('INCIDENTS #590: a word the writer repeated is collapsed; quotes and ring names stay', async () => {
  const { collapseRepeatedEnglishWords, repeatedEnglishWords, fixEnglishNames } = await import('../scripts/english-edition.ts');
  assert.equal(fixEnglishNames('Bought With With His Own Money'), 'Bought With His Own Money');
  assert.equal(collapseRepeatedEnglishWords('and Kevin Kevin Owens to secure'), 'and Kevin Owens to secure');
  assert.equal(collapseRepeatedEnglishWords('on Club Shay Shay with Bang Bang'), 'on Club Shay Shay with Bang Bang');
  assert.equal(collapseRepeatedEnglishWords('He said "kind of and and kind of" today'), 'He said "kind of and and kind of" today');
  assert.equal(collapseRepeatedEnglishWords('> but every every year'), '> but every every year');
  assert.deepEqual(repeatedEnglishWords('Kevin Kevin Owens and "and and"'), ['Kevin Kevin']);
});

test("a small word inside a hyphenated compound stays lowercase (INCIDENTS #622)", async () => {
  const { normalizeEnglishTitle } = await import("../scripts/english-edition.ts");
  assert.equal(normalizeEnglishTitle("TNA Title 2-Out-Of-3 Falls Match Set for iMPACT"), "TNA Title 2-Out-of-3 Falls Match Set for iMPACT");
  assert.equal(normalizeEnglishTitle("Face-To-Face Showdown"), "Face-to-Face Showdown");
});

test('English grammar slips are fixed on save: «a experimental», «I’re» (monitor round 2026-10-18)', async () => {
  const { aToAn, fixIre, fixEnglishNames, englishGrammarSlips } = await import('../scripts/english-edition.ts');
  assert.equal(aToAn('Placing a experimental match and a emotional message. A injury hit.'), 'Placing an experimental match and an emotional message. An injury hit.');
  assert.equal(aToAn('a one-time deal, a user, a European tour, a UFO, a hour, a unanimous win, a unique one'), 'a one-time deal, a user, a European tour, a UFO, a hour, a unanimous win, a unique one');
  assert.equal(aToAn('Plan A and Option A or B stay'), 'Plan A and Option A or B stay');
  assert.equal(aToAn('> a eager quote'), '> a eager quote');
  assert.equal(fixIre('I feel like I’re starving. I\'re ready'), 'I feel like I’m starving. I\'m ready');
  assert.equal(fixEnglishNames('He made a experimental move'), 'He made an experimental move');
  assert.deepEqual(englishGrammarSlips('a experimental'), ['a/an, I\'re or pronoun-case typo']);
  assert.deepEqual(englishGrammarSlips('an experimental'), []);
  // a preposition never takes the subject form; a speaker's own quote and «after he» (a conjunction) stay as written (INCIDENTS #870)
  const { fixPronounCase } = await import('../scripts/english-edition.ts');
  assert.equal(fixPronounCase('with he and his group at Survivor Series'), 'with him and his group at Survivor Series');
  assert.equal(fixPronounCase('a chance for she and the team, between they and us'), 'a chance for her and the team, between them and us');
  assert.equal(fixPronounCase('after he won, before she arrived, to we the people'), 'after he won, before she arrived, to us the people');
  assert.equal(fixPronounCase('> "It had something to do with I never changed my name"'), '> "It had something to do with I never changed my name"');
  assert.deepEqual(englishGrammarSlips('with he and his group'), ['a/an, I\'re or pronoun-case typo']);
});

test('Mercedes Mone always gets her accent', async () => {
  const { fixEnglishNames } = await import('../scripts/english-edition.ts');
  assert.equal(fixEnglishNames('Mercedes Mone beat Mercedes Moné and Mercedes Mones'), 'Mercedes Moné beat Mercedes Moné and Mercedes Mones');
});

test("a word opening a quotation is capital in a headline; «Def.» becomes «Defeats» (INCIDENTS #688)", async () => {
  const { normalizeEnglishTitle, fixEnglishNames } = await import("../scripts/english-edition.ts");
  assert.equal(normalizeEnglishTitle("Tommy Dreamer Posts Teaser Video for 'the Midnight Dreamer'"), "Tommy Dreamer Posts Teaser Video for 'The Midnight Dreamer'");
  assert.equal(fixEnglishNames("Mercedes Moné Def. Thekla to Retain Title"), "Mercedes Moné Defeats Thekla to Retain Title");
});

test('Mike Bailey is «he», never the singular «they» (INCIDENTS #713)', async () => {
  const { fixEnglishNames } = await import('../scripts/english-edition.ts');
  assert.equal(fixEnglishNames('Speedball Mike Bailey Says They Are Seriously Doubting Themselves After AEW WrestleDream'), 'Speedball Mike Bailey Says He Is Seriously Doubting Himself After AEW WrestleDream');
  assert.equal(fixEnglishNames('Speedball reflected, noting that they are doubting. Speedball competed in their first main event, though they were eliminated.'), 'Speedball reflected, noting that he is doubting. Speedball competed in his first main event, though he was eliminated.');
  assert.equal(fixEnglishNames('Fans say they are happy.'), 'Fans say they are happy.');
  assert.match(englishStyleRules('https://www.fightful.com/x'), /never the singular "they/);
});

// INCIDENTS #718: «Lexis King Drops Diss Track Targetting Zilla Fatu» — British double-t spelling in a headline.
test("British spellings become American (INCIDENTS #718)", async () => {
  const { fixEnglishNames } = await import("../scripts/english-edition.ts");
  assert.equal(fixEnglishNames("Diss Track Targetting Zilla Fatu"), "Diss Track Targeting Zilla Fatu");
  assert.equal(fixEnglishNames("a fan favourite, defence"), "a fan favorite, defense");
});

// INCIDENTS #736: Gemini typed a literal «\n» in the Ciampa story; it reached the page as text
test('a literal backslash-n typed by Gemini is saved as a real line break', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'news-en-'));
  const file = saveEnglishEdition({ ...good, body: good.body.replace('\n\n', ' \\n\\n> "Quote here," he said. \\n\\n') }, input, dir);
  assert.ok(!fs.readFileSync(file, 'utf8').includes('\\n'));
});

// INCIDENTS #755: a markdown quote marker inside a quoted caption («"> Out of office ."»)
test('a stray "> " marker inside quotes is removed', async () => {
  const { fixEnglishNames } = await import('../scripts/english-edition.ts');
  assert.equal(fixEnglishNames('with the caption, "> Out of office ."'), 'with the caption, "Out of office."');
});

// INCIDENTS #781: «the October 13 episode» in a story whose source address says 10-20
test('an episode date contradicting the source address is flagged', () => {
  const body = 'WWE NXT viewership saw a decrease for the October 13 episode on CW Network. According to Wrestlenomics, the show drew 655,000 viewers, below the mark of last week. ' + 'More text here to make the body long enough for the length check. '.repeat(3);
  const input = { sourceText: 'NXT drew 655,000 viewers.', sourceUrl: 'https://www.fightful.com/wrestling/wwe-nxt-10-20-viewership-drops-below-700000-viewers/', arabicTitle: 'x', arabicBody: 'x' } as any;
  const t = 'WWE NXT Viewership Drops Below 700,000 Viewers';
  assert.ok(checkEnglish({ title: t, body, tags: [] } as any, input).some((x) => x.includes('episode date')));
  assert.ok(!checkEnglish({ title: t, body: body.replace('October 13', 'October 20'), tags: [] } as any, input).some((x) => x.includes('episode date')));
});

test('a singular subject with «belong» gets its s (INCIDENTS #813)', async () => {
  const { fixEnglishNames } = await import('../scripts/english-edition.ts');
  assert.equal(fixEnglishNames('Says It Belong to Australian Wrestling'), 'Says It Belongs to Australian Wrestling');
  assert.equal(fixEnglishNames('The titles belong to them'), 'The titles belong to them');
  const fs = await import('node:fs');
  assert.deepEqual(fs.readdirSync('content/news-en').filter((f) => f.endsWith('.md') && /\b[Ii]t [Bb]elong (to|in)\b/i.test(fs.readFileSync(`content/news-en/${f}`, 'utf8'))), []);
});

test('an article glued to the next word by a hyphen is held back («on the-ring», INCIDENTS #829)', () => {
  assert.ok(checkEnglish({ ...good, body: good.body + ' She hopes to manage stars on the-ring soon.' }, input).includes('article glued to the next word with a hyphen'));
  assert.deepEqual(checkEnglish({ ...good, body: good.body + ' A state-of-the-art arena.' }, input), []);
});

test('a foreign-language scratchpad or a translation arrow blocks the English edition (INCIDENTS #872)', async () => {
  const cyr = ' > "Если вы прочитаете это заявление без автора, вы подумаете, что это подросток." -> "If you read that statement, you would think a teenager wrote it."';
  assert.ok(checkEnglish({ ...good, body: good.body + cyr }, input).includes('letters from another script'));
  assert.ok(checkEnglish({ ...good, body: good.body + cyr }, input).includes('translation arrow left in the text'));
  const { fixEnglishNames } = await import('../scripts/english-edition.ts');
  assert.equal(fixEnglishNames(cyr), ' > "If you read that statement, you would think a teenager wrote it."');
  // a normal English quote has no arrow and stays untouched
  assert.deepEqual(checkEnglish({ ...good, body: good.body + ' > "This is a show you put together."' }, input), []);
});

test("a word glued to a hyphenated compound in an English headline gets its space (INCIDENTS #874: «Life-AlteringInjury»)", async () => {
  const { fixEnglishNames, englishStyleRules } = await import('../scripts/english-edition.ts');
  assert.equal(fixEnglishNames('Chris Bey Reflects on His Life-AlteringInjury'), 'Chris Bey Reflects on His Life-Altering Injury');
  // real CamelCase names are never split
  assert.equal(fixEnglishNames('Drew McIntyre and WrestleMania'), 'Drew McIntyre and WrestleMania');
  // a brand name that legitimately follows a hyphen stays whole
  assert.equal(fixEnglishNames('Scooby-Doo and WWE: Robo-WrestleMania!'), 'Scooby-Doo and WWE: Robo-WrestleMania!');
  assert.match(englishStyleRules('https://x.com/a'), /Life-AlteringInjury/);
});

test('a show name ending in «!» or «?» is never followed by a full stop (round 2026-10-27)', async () => {
  const { fixEnglishNames } = await import('../scripts/english-edition.ts');
  // «the October 29 episode of TNA iMPACT!.» and «Notsam Wrestling Live!.» were live on 2026-10-27
  assert.equal(fixEnglishNames('The Hardys clash again on the October 29 episode of TNA iMPACT!. The promotion announced it.'), 'The Hardys clash again on the October 29 episode of TNA iMPACT! The promotion announced it.');
  assert.equal(fixEnglishNames('He appeared on Notsam Wrestling Live!. When asked, he laughed.'), 'He appeared on Notsam Wrestling Live! When asked, he laughed.');
  // a normal sentence keeps its full stop, and an ellipsis stays
  assert.equal(fixEnglishNames('He waited... Then he left.'), 'He waited... Then he left.');
  const fs = await import('node:fs');
  assert.deepEqual(fs.readdirSync('content/news-en').filter((f) => f.endsWith('.md') && /[!?]\.(?:\s|$)/.test(fs.readFileSync(`content/news-en/${f}`, 'utf8'))), []);
});

test('the writer never inserts a bracketed word into a direct quote (round 2026-10-27)', async () => {
  const { fixEnglishNames } = await import('../scripts/english-edition.ts');
  // «I came back from my ACL tear...[which] that happened» was in the live Ilja Dragunov story
  assert.equal(fixEnglishNames('I came back from my ACL tear...[which] that happened in the most unexciting way possible.'), 'I came back from my ACL tear...which happened in the most unexciting way possible.');
  assert.equal(fixEnglishNames('I was back [and] that felt strange.'), 'I was back and that felt strange.');
  // a real markdown link is not a bracketed word
  assert.equal(fixEnglishNames('See [which](https://example.com) here.'), 'See [which](https://example.com) here.');
  // the rules say it, too
  const { englishStyleRules } = await import('../scripts/english-edition.ts');
  assert.match(englishStyleRules('https://x.com/a'), /square brackets/);
});

test('a word dropped from a transcribed quote is put back («One the things», round 2026-10-27)', async () => {
  const { fixEnglishNames } = await import('../scripts/english-edition.ts');
  assert.equal(fixEnglishNames('One the things he said that he noticed was that I was athletic.'), 'One of the things he said that he noticed was that I was athletic.');
  const fs = await import('node:fs');
  assert.deepEqual(fs.readdirSync('content/news-en').filter((f) => f.endsWith('.md') && /\bOne the things\b/.test(fs.readFileSync(`content/news-en/${f}`, 'utf8'))), []);
});

// INCIDENTS #883: the description was built from the first prose line only, so a story whose opening line is a short
// topic sentence («Monica Monroe was recruited by AJ Styles.») had a 40-letter description that said nothing.
test("a short opening line does not leave a one-sentence description", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'news-en-'));
  const file = saveEnglishEdition({
    ...good,
    body: 'Monica Monroe was recruited by AJ Styles.\n\nMonroe won the WWE ID Women\'s Championship earlier this month, and she said the call from Styles changed her career.',
  }, input, dir);
  const m = matter(fs.readFileSync(file, 'utf8'));
  assert.ok(m.data.description.length > 100, m.data.description);
  assert.ok(/Monroe/.test(m.data.description), m.data.description);
});

// INCIDENTS #883: «currently … current» in one clause («currently part of the faction's current on-screen alliance»).
test("the same word is not repeated in one clause of English prose", async () => {
  const { fixEnglishNames } = await import('../scripts/english-edition.ts');
  assert.equal(fixEnglishNames("He is currently part of the faction's current on-screen alliance."), "He is now part of the faction's current on-screen alliance.");
  assert.equal(fixEnglishNames('Currently working with the current champion.'), 'Now working with the current champion.');
  // «current» used once, or «currently» with another adjective, stays
  assert.equal(fixEnglishNames('He is currently out with an injury.'), 'He is currently out with an injury.');
  assert.equal(fixEnglishNames('He is part of the current roster.'), 'He is part of the current roster.');
});

test('a filler left in a transcribed quote is dropped (INCIDENTS #895)', async () => {
  const { fixEnglishNames } = await import('../scripts/english-edition.ts');
  assert.equal(
    fixEnglishNames('"I totally agree with you. I feel like, just because I\'ve been thinking that also."'),
    '"I totally agree with you. I feel like I\'ve been thinking that also."',
  );
});

// Round 2026-10-28: the Weapons Wild story (Wrestling Inc source) shipped a paragraph with no subject —
// « victory can only be achieved by pinfall or submission inside the ring.» The cause was a dropped first
// word; a deterministic fix raises the first letter and the check now refuses such a line, so a broken
// sentence can no longer reach the English site.
test("a line that starts with a lowercase letter is a broken sentence and is fixed", async () => {
  const { fixLineStarts, fixEnglishNames, checkEnglish } = await import('../scripts/english-edition.ts');
  assert.equal(fixLineStarts('The wheel was spun.\n\n victory can only be achieved by pinfall or submission.'), 'The wheel was spun.\n\nVictory can only be achieved by pinfall or submission.');
  assert.equal(fixLineStarts('victory can only be achieved inside the ring.'), 'Victory can only be achieved inside the ring.');
  // quotes, embeds and markdown lines keep their own first letter
  assert.equal(fixLineStarts('> "he said it was over"'), '> "he said it was over"');
  assert.equal(fixLineStarts('<https://arab-wrestling.com/shows/wwe-raw-26-10-2026/>'), '<https://arab-wrestling.com/shows/wwe-raw-26-10-2026/>');
  // a whole story goes through the fix when it is saved; a single phrase handed to fixEnglishNames keeps its letter
  assert.equal(fixEnglishNames('a fan favorite'), 'a fan favorite');
  const input = { sourceId: 1, sourceUrl: 'https://www.wrestlinginc.com/x/', sourceTitle: 'Tavion Heights And Myles Borne Set For Weapons Wild Match', sourceText: 'Tavion Heights and Myles Borne will meet in a Weapons Wild Match at Halloween Havoc. Security stepped in before a brawl.', arabicTitle: 'عنوان', arabicBody: 'متن الخبر', federation: 'WWE', date: '2026-10-28T01:36:05.000Z', image: '/content/images/x.jpg', filePrefix: '20261028043605' };
  const good = { title: 'Tavion Heights and Myles Borne Set for Weapons Wild Match', body: 'Tavion Heights and Myles Borne will meet in a Weapons Wild Match at NXT Halloween Havoc. Security stepped in before a brawl could start inside the ring.' + ' The match was made official for the October 31 event.' };
  assert.deepEqual(checkEnglish(good, input as any), []);
  assert.ok(checkEnglish({ ...good, body: good.body + '\n\n victory can only be achieved by pinfall or submission.' }, input as any).includes('line starts lowercase (broken sentence)'));
});


// Round 2026-10-28: the English edition of a lineup or results story was never written — its card lines can only be
// written with the source's own names, so every attempt failed «copied from the source». The catch-up retried the same
// story every bot run (two Gemini requests every ten minutes) and, first in the queue, kept every other missing
// edition out (INCIDENTS #924).
test('a card or result line is not «copied prose», but copied sentences still are (round 2026-10-28)', () => {
  const card = 'Místico & Último Guerrero vs. Yota Tsuji & Hirooki Goto\nThree-Way Tag Team Match — NJPW STRONG Openweight Tag Team Championship: Los Hermanos Chávez (Ángel de Oro & Niebla Roja) (c) vs. United Empire (Francesco Akira & Templario) vs. Unbound Co. (Taiji Ishimori & Titán)';
  const sourceSentence = 'Two more matches were added to the CMLL x NJPW Lucha Kingdom card for November 16 at Arena México in Mexico City.';
  const src: EnglishInput = { ...input, sourceUrl: 'https://www.fightful.com/wrestling/yota-tsuji', sourceText: `${sourceSentence} ${card.replace(/\n/g, ' ')}` };
  const body = 'Two more matches were announced for the November 16 show at Arena México.\n\n' + card + '\n\nA singles match between Konosuke Takeshita and Bárbaro Cavernario was also announced.';
  const issues = checkEnglish({ title: 'Yota Tsuji and Hirooki Goto Team at CMLL Lucha Kingdom', body, tags: [] }, src);
  assert.ok(!issues.includes('copied from the source'), issues.join(', '));
  const copied = checkEnglish({ title: 'Yota Tsuji and Hirooki Goto Team at CMLL Lucha Kingdom', body: body + '\n\n' + sourceSentence, tags: [] }, src);
  assert.ok(copied.includes('copied from the source'));
});

test('the catch-up skips a story whose edition keeps failing and still writes the others (round 2026-10-28)', async () => {
  const newsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'news-ar-'));
  const englishDir = fs.mkdtempSync(path.join(os.tmpdir(), 'news-en-catch-'));
  const stateFile = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'catchup-')), 'english-catchup.json');
  const when = new Date(Date.now() - 3600_000).toISOString();
  const ids = [910001, 910002, 910003, 910004];
  // the first two stories (highest file names, tried first) can never pass; the last two are fine
  ids.forEach((id, n) => {
    const prefix = `202610280${String(4 - n).padStart(2, '0')}00`;
    fs.writeFileSync(path.join(newsDir, `${prefix}-story-${id}.md`),
      `---\ntitle: "خبر رقم ${n}"\ndate: ${when}\nsource_id: ${id}\nsource_url: "https://www.fightful.com/wrestling/story-${id}"\nimage: /content/images/x.jpg\nfederation: WWE\n---\nمحتوى الخبر العربي رقم ${n}.\n`, 'utf-8');
  });
  let calls = 0;
  const ask = async (prompt: string) => {
    calls++;
    const marker = prompt.match(/MARKER-(\d+)/);
    return marker && ['910001', '910002'].includes(marker[1])
      ? JSON.stringify({ ...good, title: 'عنوان عربي للخبر' })
      : JSON.stringify(good);
  };
  const fetchSource = async (url: string) => ({ title: 'Source', text: `MARKER-${url.split('-').pop()} ${'Body text that is long enough to be a source article. '.repeat(12)}` });
  const done = await catchUpEnglishEditions(ask, fetchSource, 2, undefined, stateFile, newsDir, englishDir);
  assert.equal(done, 2);
  const written = fs.readdirSync(englishDir).map((f) => matter(fs.readFileSync(path.join(englishDir, f), 'utf-8')).data.source_id).sort();
  assert.deepEqual(written, [910003, 910004]);
  const failed = JSON.parse(fs.readFileSync(stateFile, 'utf-8'));
  assert.deepEqual(Object.keys(failed).sort(), ['910001', '910002']);
  // the next run spends nothing on the two that just failed: they wait six hours
  calls = 0;
  assert.equal(await catchUpEnglishEditions(ask, fetchSource, 2, undefined, stateFile, newsDir, englishDir), 0);
  assert.equal(calls, 0);
});
