// INCIDENTS #1390: a show with Arabic commentary («تعليق عربي») was called «مترجم» everywhere on its page (title,
// description, keywords, JSON-LD names, «subtitleLanguage», «عن العرض», the English copy's «with Arabic subtitles»).
// Owner 2026-11-18: this show and every future Arabic-commentary show are never «مترجم». Other shows stay as they were.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const c = require('../lib/arabic-commentary.cjs');
const { showAbout } = require('../lib/show-about.cjs');

test('the rule is read from the show itself: title, headline, program, address or the front-matter flag', () => {
  for (const t of ['WWE RAW 16.11.2026 (تعليق عربي)', 'WWE RAW (تعليق للعربي)', 'عرض سماك داون بالتعليق العربي', 'عرض الرو بتعليق عربي',
    '/shows/wwe-raw-16-11-2026-%D8%AA%D8%B9%D9%84%D9%8A%D9%82-%D8%B9%D8%B1%D8%A8%D9%8A/', '/shows/wwe-raw-16-11-2026-تعليق-عربي/', 'WWE RAW Arabic Commentary']) {
    assert.ok(c.isArabicCommentary(t), t);
  }
  for (const t of ['WWE RAW (16.11.2026)', 'عرض الرو 16.11.2026 مترجم', 'التعليقات العربية', 'تعليقات الجمهور', '']) assert.ok(!c.isArabicCommentary(t), t);
  assert.ok(c.isArabicCommentaryShow({ title: 'WWE RAW (16.11.2026)', arabic_commentary: true }));
  assert.ok(!c.isArabicCommentaryShow({ title: 'WWE RAW (16.11.2026)', headline: 'عرض الرو 16.11.2026 مترجم', program_name: 'WWE RAW' }));
});

test('«مترجم» becomes «تعليق عربي»; a phrase that already names the commentary just loses the word', () => {
  assert.equal(c.noSubtitleClaim('عرض الرو الأخير 16.11.2026 كامل مترجم — WWE RAW (تعليق للعربي)'), 'عرض الرو الأخير 16.11.2026 كامل بالتعليق العربي — WWE RAW (تعليق للعربي)');
  assert.equal(c.noSubtitleClaim('مشاهدة وتحميل عرض الرو 16.11.2026 مترجم بالعربي كامل أونلاين، من عروض المصارعة الحرة المترجمة.'),
    'مشاهدة وتحميل عرض الرو 16.11.2026 بالتعليق العربي كامل أونلاين، من عروض المصارعة الحرة بالتعليق العربي.');
  assert.equal(c.noSubtitleClaim('WWE RAW (تعليق للعربي) كامل مترجم').trim(), 'WWE RAW (تعليق للعربي) كامل');
  assert.equal(c.noSubtitleList('عرض الرو مترجم, WWE RAW (تعليق للعربي) مترجم, WWE RAW (تعليق للعربي), عرض الرو بالتعليق العربي'), 'عرض الرو بالتعليق العربي, WWE RAW (تعليق للعربي)');
  const ld = c.noSubtitleJson({ '@type': 'VideoObject', name: 'عرض الرو كامل مترجم', alternateName: ['عرض الرو مترجم', 'عرض الرو بالتعليق العربي'], publication: { '@type': 'BroadcastEvent', subtitleLanguage: 'ar' } });
  assert.deepEqual(ld, { '@type': 'VideoObject', name: 'عرض الرو كامل بالتعليق العربي', alternateName: ['عرض الرو بالتعليق العربي'], publication: { '@type': 'BroadcastEvent' } });
  // an unmarked page is never touched
  const page = '<html><head><title>عرض الرو مترجم</title></head><body></body></html>';
  assert.equal(c.commentaryHead(page), page);
});

test('«عن العرض» says «بتعليق عربي» for an Arabic-commentary show and stays «مترجم» for the others', () => {
  const base = { name: 'عرض الرو', dot: '16.11.2026', programName: 'WWE RAW (تعليق للعربي)', federation: 'WWE', eventDate: '2026-11-16', day: '16 نوفمبر 2026', duration: '02:29:33', servers: 4, qualities: ['720p'] };
  const ar = showAbout({ ...base, commentary: true });
  assert.equal(ar.heading, 'عن عرض الرو 16.11.2026 كامل بتعليق عربي');
  assert.ok(!JSON.stringify(ar).includes('مترجم'), JSON.stringify(ar));
  assert.match(ar.paragraphs.join(' '), /بالتعليق العربي كاملًا/);
  const plain = showAbout({ ...base, programName: 'WWE RAW' });
  assert.equal(plain.heading, 'عن عرض الرو 16.11.2026 كامل مترجم');
  assert.match(plain.paragraphs.join(' '), /مترجمًا إلى العربية كاملًا/);
});

// INCIDENTS #1393: an Arabic-commentary show is searched «عرض الرو بالتعليق العربي», «رو بالصوت العربي», «… 16.11.2026 بالتعليق العربي»
test('the commentary search forms: each name with «بالتعليق العربي» / «بالصوت العربي», the intents, the dates, English', () => {
  const names = ['عرض الرو', 'دبليو دبليو إي الرو', 'تحميل عرض الرو', 'عرض الرو مترجم', 'الرو', 'رو', 'راو', 'WWE RAW', 'عرض الرو 16.11.2026'];
  const f = c.commentaryForms({ names, eventDate: '2026-11-16', programName: 'WWE RAW (تعليق للعربي)', isLatest: true });
  for (const want of ['عرض الرو بالتعليق العربي', 'عرض الرو بالصوت العربي', 'عرض الرو تعليق عربي', 'عرض الرو معلق عربي', 'عرض الرو بالعربي',
    'مشاهدة عرض الرو بالتعليق العربي', 'تحميل عرض الرو بالتعليق العربي', 'عرض الرو بالتعليق العربي كامل', 'عرض الرو بالتعليق العربي اون لاين',
    'الرو بالتعليق العربي', 'رو بالصوت العربي', 'راو بالتعليق العربي', 'عرض الرو الأخير بالتعليق العربي',
    'عرض الرو 16.11.2026 بالتعليق العربي', 'عرض الرو 16/11/2026 بالتعليق العربي', 'عرض الرو 16 نوفمبر 2026 بالتعليق العربي',
    'WWE RAW November 16 2026 Arabic commentary', 'WWE RAW Arabic commentary']) assert.ok(f.includes(want), want);
  assert.ok(f.every((x) => !/مترجم|تحميل تحميل|\(/.test(x)), f.join(' | '));
  assert.ok(f.length <= 45, `no stuffing: ${f.length}`);
  assert.equal(new Set(f).size, f.length);
  assert.ok(!c.commentaryForms({ names, programName: 'WWE RAW', isLatest: false }).some((x) => /الأخير|الاخير|\d/.test(x)), 'a program page: no date, no «الأخير»');
  assert.equal(c.englishProgram('WWE RAW (تعليق للعربي)'), 'WWE RAW');
});

test('the Google title and description of an Arabic-commentary show say «بالتعليق العربي» and «بالصوت العربي», short, one date', () => {
  const { showSeoText } = require('../lib/show-seo.cjs');
  const r = showSeoText({ headline: 'عرض الرو 16.11.2026 (تعليق عربي)', title: 'WWE RAW 16.11.2026 (تعليق عربي)', programName: 'WWE RAW (تعليق للعربي)', eventDate: '2026-11-16', day: '16 نوفمبر 2026', isLatest: true, description: 'عرض الرو (تعليق عربي) بالكامل مع جميع النزالات والأحداث.', commentary: true });
  assert.equal(r.title, 'عرض الرو الأخير 16.11.2026 كامل بالتعليق العربي — WWE RAW');
  assert.ok(r.title.length <= 75);
  assert.match(r.description, /كامل بالتعليق العربي أونلاين/);
  assert.match(r.description, /بالصوت العربي/);
  assert.match(r.description, /WWE RAW November 16, 2026 Arabic commentary/);
  assert.ok(!/مترجم|تعليق للعربي/.test(r.title + r.description), r.title + ' / ' + r.description);
  const plain = showSeoText({ headline: 'عرض الرو 16.11.2026 مترجم', title: 'WWE RAW (16.11.2026)', programName: 'WWE RAW', eventDate: '2026-11-16', day: '16 نوفمبر 2026', isLatest: true, description: '' });
  assert.match(plain.title, /كامل مترجم — WWE RAW$/);
});

// ── a real build of sample shows (the fast-lane render: only these pages and their English copies, ~10–40 s) ─────────
const { showPath } = require('../lib/show-permalink.cjs');
// file → its own front-matter lines; dated 2001 so no real show shares a title or address
const SAMPLES: Record<string, string> = {
  'zz-test-1350-commentary.md': `title: WWE RAW 08.01.2001 (تعليق عربي)\nheadline: عرض الرو 08.01.2001 (تعليق عربي)\nprogram_name: WWE Test 1390 (تعليق للعربي)\nevent_date: 2001-01-08\ndescription: عرض الرو (تعليق عربي) بالكامل مع جميع النزالات والأحداث.`,
  'zz-test-1350-flag.md': `title: WWE SmackDown 11.01.2001\nheadline: عرض سماك داون 11.01.2001\nprogram_name: WWE SmackDown\narabic_commentary: true\nevent_date: 2001-01-11\ndescription: عرض سماك داون 11.01.2001 مترجم بالكامل مع جميع النزالات والأحداث.`,
  'zz-test-1350-normal.md': `title: WWE RAW 15.01.2001\nheadline: عرض الرو 15.01.2001 مترجم\nprogram_name: WWE RAW\nevent_date: 2001-01-15\ndescription: عرض الرو 15.01.2001 مترجم بالكامل مع جميع النزالات والأحداث.`,
};
const fm = (own: string) => `---\nshow_type: عرض\nfederation: WWE\n${own}\ndate: 2001-01-20T01:00:00.000+02:00\nduration: 02:10:00\ntags:\n  - WWE\nservers:\n  - url: https://ok.ru/video/1\n  - url: https://vidmoly.org/embed-abc.html\n---\n\n`;
const { arabicSlug } = require('../lib/slug.cjs');
// the sample program's own library page (/library/<slug>/), and a normal program's for comparison
const LIB = `library/${arabicSlug('WWE Test 1390 (تعليق للعربي)')}/index.html`, LIB_NORMAL = 'library/wwe-raw/index.html';
const urlOf = (file: string) => showPath(file, (SAMPLES[file].match(/^title: (.+)$/m) || [])[1], path.join('content', 'shows'), true);

// what the page says about ITSELF: its head, its H1, «عن العرض», its body text and every JSON-LD block. The cards of other
// (translated) shows under it keep their own «مترجم».
function own(html: string): string {
  const pick = (re: RegExp) => (html.match(re) || []).join('\n');
  return [html.slice(0, html.indexOf('</head>')), pick(/<h1[\s\S]*?<\/h1>/g), pick(/<section class="show-about[\s\S]*?<\/section>/g),
    pick(/<div class="post-body">[\s\S]*?<\/div>/g), pick(/<script type="application\/ld\+json">[\s\S]*?<\/script>/g)].join('\n');
}

function built(file: string, en = false): string {
  const out = path.join('_site', en ? 'en' : '', urlOf(file), 'index.html');
  assert.ok(fs.existsSync(out), `${out} was built`);
  return fs.readFileSync(out, 'utf8');
}

test('a built Arabic-commentary show and its program page have no «مترجم» or subtitle claim anywhere, a normal show keeps «مترجم»', { timeout: 300_000 }, () => {
  const files = Object.keys(SAMPLES).map((f) => path.join('content', 'shows', f));
  const urls: string[] = [];
  try {
    Object.entries(SAMPLES).forEach(([, own], i) => fs.writeFileSync(files[i], fm(own)));
    urls.push(...Object.keys(SAMPLES).map(urlOf));
    const r = spawnSync(process.execPath, ['--stack-size=4096', './node_modules/@11ty/eleventy/cmd.cjs'], {
      env: { ...process.env, ARW_FAST_LANE: files.join(','), ARW_FAST_LANE_EXTRA: [LIB, LIB_NORMAL].join(',') }, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024,
    });
    assert.equal(r.status, 0, (r.stderr || '') + (r.stdout || '').slice(-2000));

    for (const slug of ['zz-test-1350-commentary.md', 'zz-test-1350-flag.md']) {
      const ar = own(built(slug));
      assert.match(ar, /<meta name="arw-commentary" content="ar">/, slug);
      assert.ok(!ar.includes('مترجم'), `${slug}: «${(ar.match(/.{60}مترجم.{30}/) || [''])[0]}»`);
      assert.ok(!/subtitleLanguage/.test(ar), slug);
      assert.match(ar, /<title>[^<]*تعليق (?:ال)?عربي[^<]*<\/title>/, slug);
      // the search forms (INCIDENTS #1393): first in the keywords and alternate names, the audio in Arabic on the broadcast
      assert.match(ar, /"keywords": ?"[^"]*بالتعليق العربي[^"]*بالصوت العربي/, slug);
      assert.match(ar, /"alternateName": ?\["[^"\]]*بالتعليق العربي"/, slug);
      assert.match(ar, /"@type": ?"BroadcastEvent"[^}]*"inLanguage": ?"ar"/, slug);
      assert.match(ar, /<h2 id="show-about-h">[^<]*بتعليق عربي/, slug);
      const en = own(built(slug, true));
      assert.ok(!en.includes('مترجم'), `${slug} (en): «${(en.match(/.{60}مترجم.{30}/) || [''])[0]}»`);
      assert.ok(!/subtitle|translated/i.test(en), `${slug} (en): «${(en.match(/.{60}(?:subtitle|translated).{30}/i) || [''])[0]}»`);
      assert.match(en, /Arabic commentary/, slug);
      assert.match(en, /<title>[^<]*with Arabic Commentary[^<]*<\/title>/, slug);
    }

    const normal = built('zz-test-1350-normal.md');
    assert.ok(!normal.includes('arw-commentary'));
    assert.match(normal, /<title>[^<]*كامل مترجم[^<]*<\/title>/);
    assert.match(normal, /"subtitleLanguage": "ar"/);
    assert.match(normal, /<h2 id="show-about-h">[^<]*كامل مترجم/);
    assert.match(built('zz-test-1350-normal.md', true), /with Arabic subtitles in full/);

    // the program's library page: H1, count, intro, «الأخير» heading, head and JSON-LD — and its English copy
    const lib = fs.readFileSync(path.join('_site', LIB), 'utf8');
    assert.match(lib, /<meta name="arw-commentary" content="ar">/);
    assert.ok(!lib.includes('مترجم'), `library: «${(lib.match(/.{60}مترجم.{30}/) || [''])[0]}»`);
    assert.match(lib, /<h1 class="hero-title"><bdi>عروض الرو بتعليق عربي<\/bdi><span class="u">عرض واحد<\/span><\/h1>/);
    assert.match(lib, /<p>شاهد أحدث عروض الرو بتعليق عربي، وتصفّح أرشيف/);
    assert.match(lib, /<h2 style="color:var\(--gold\);">عرض الرو الأخير بتعليق عربي<\/h2>/);
    // its head (INCIDENTS #1393): «… بالتعليق العربي … بالصوت العربي», the search forms in its keywords
    assert.match(lib, /<title>عروض الرو بالتعليق العربي \(عرض واحد\) — مشاهدة وتحميل WWE Test 1390 بالصوت العربي \| عرب راسلنج<\/title>/);
    assert.match(lib, /<meta name="description" content="كل عروض الرو بالتعليق العربي[^"]*بالصوت العربي/);
    assert.match(lib, /"keywords": ?"[^"]*الرو بالتعليق العربي/);
    const libEn = fs.readFileSync(path.join('_site', 'en', LIB), 'utf8');
    assert.ok(!/مترجم|subtitle|translated/i.test(libEn), `library (en): «${(libEn.match(/.{60}(?:مترجم|subtitle|translated).{30}/i) || [''])[0]}»`);
    assert.match(libEn, /shows with Arabic commentary/);
    assert.match(libEn, /<title>WWE Test 1390 Shows with Arabic Commentary \| Arab Wrestling<\/title>/);
    // the home page names these shows as a whole in its structured data, head only
    assert.match(fs.readFileSync('_site/index.html', 'utf8'), /"عروض المصارعة بالتعليق العربي"/);
    const libNormal = fs.readFileSync(path.join('_site', LIB_NORMAL), 'utf8');
    assert.ok(!libNormal.includes('arw-commentary'));
    assert.match(libNormal, /<h1 class="hero-title"><bdi>عروض الرو مترجمة<\/bdi>/);
    assert.match(libNormal, /الأخير مترجم<\/h2>/);
  } finally {
    for (const f of files) fs.rmSync(f, { force: true });
    for (const u of [...urls, path.dirname(LIB)]) for (const d of ['_site', '_site/en']) fs.rmSync(path.join(d, u), { recursive: true, force: true });
  }
});
