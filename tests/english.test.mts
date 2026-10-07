// The English site (/en/, lib/i18n/mirror.cjs, owner 2026-10-07): every interface page in English from the finished
// Arabic page, the news left Arabic, the Arabic page itself untouched apart from the language button.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const mirror = require('../lib/i18n/mirror.cjs');
const dict = require('../lib/i18n/en.cjs');
const content = require('../lib/i18n/content.cjs');
const render = require('dom-serializer').default;
const AR = /[؀-ۿ]/;

const HEADER = '<header><nav class="nav"><a class="brand" href="/">عرب راسلنج</a><ul id="navMenu"><li><a class="navlink" href="/">الرئيسية</a></li><li><a class="navlink" href="/library/">مكتبة العروض</a></li><li class="utility-row"><button aria-label="تبديل الوضع الليلي" class="theme-toggle" id="arwThemeToggle" type="button">x</button></li></ul></nav></header>';
const page = (head: string, body: string) => `<!DOCTYPE html>\n<html lang="ar" dir="rtl">\n<head>\n<meta charset="UTF-8">\n<title>${head}</title>\n<meta name="description" content="آخر أخبار المصارعة الحرة بالعربية: انتقالات، إصابات، وقرارات WWE وAEW وTNA أولاً بأول.">\n<img alt="" src="/x.png" />\n</head>\n<body>\n${HEADER}\n${body}\n</body>\n</html>\n`;
const tr = mirror.makeTranslator(dict, {
  'عرض ديناميت 06.10.2026 مترجم': 'AEW Dynamite 06.10.2026',
  'عرض ديناميت مترجم بالكامل مع جميع النزالات والأحداث.': 'The complete AEW Dynamite show, with every match and moment.',
});
const english = new Set(['/', '/library/', '/shows/aew-dynamite-06-10-2026/', '/news/']);
const run = (html: string, url = '/') => {
  const left: string[] = [];
  const doc = mirror.translatePage(html, { url, tr, english, report: (_u: string, l: string[]) => left.push(...l), nav: dict.nav });
  return { html: render(doc, { encodeEntities: 'utf8', decodeEntities: true }).replace(/&#x([0-9a-fA-F]+);/g, (w: string, h: string) => (parseInt(h, 16) >= 0xa0 ? String.fromCodePoint(parseInt(h, 16)) : w)), left };
};

test('an interface page becomes English: words, direction, links, menu', () => {
  const { html, left } = run(page('مكتبة العروض | عرب راسلنج', '<h1>مكتبة العروض</h1><a href="/shows/aew-dynamite-06-10-2026/">عرض ديناميت 06.10.2026 مترجم</a><time>6 أكتوبر 2026</time><span>عرضان مترجمان</span><a href="/tag/x/">x</a>'), '/library/');
  assert.deepEqual(left, []);
  assert.match(html, /<html lang="en" dir="ltr">/);
  assert.match(html, /<title>Show Library \| Arab Wrestling<\/title>/);
  assert.match(html, /<a class="navlink" href="\/en\/library\/">Library<\/a>/); // the menu's short word
  assert.match(html, /<h1>Show Library<\/h1>/);
  assert.match(html, /href="\/en\/shows\/aew-dynamite-06-10-2026\/">AEW Dynamite 06\.10\.2026</);
  assert.match(html, />October 6, 2026</);
  assert.match(html, />2 shows</);
  assert.match(html, /href="\/tag\/x\/"/); // a page with no English copy keeps its address
  assert.doesNotMatch(html.replace(/<meta name="description"[^>]*>/, ''), AR);
});

test('a news story stays Arabic, set right to left; a sentence around a name keeps English order', () => {
  const { html, left } = run(page('عرب راسلنج', '<div class="related-card"><a href="/news/خبر-ما/"><h4>خبر عن كودي رودز, وراندي أورتن</h4></a></div><p>كل أقسام عروض <bdi>WWE</bdi> في مكان واحد، اختر القسم وتصفّح عروضه من الأحدث للأقدم.</p><h2>أقسام <bdi>WWE</bdi></h2>'));
  assert.deepEqual(left, []);
  // the headline is kept whole (a «,» in it once made a rule drop every Arabic part and leave the card empty)
  assert.match(html, /<h4 lang="ar" dir="rtl">خبر عن كودي رودز, وراندي أورتن<\/h4>/);
  assert.match(html, /<p>Every <bdi>WWE<\/bdi> section in one place\. Pick a section/);
  assert.match(html, /<h2><bdi>WWE<\/bdi> Sections<\/h2>/);
});

test('no Arabic word and no translation-made repeat goes unnoticed', () => {
  const { left } = run(page('عرب راسلنج', '<p>جملة لا يعرفها القاموس</p><div class="card"><h3>عرض ديناميت 06.10.2026 مترجم</h3><b>AEW Dynamite 06.10.2026</b></div><p>نص <bdi>X</bdi> آخر غير معروف</p>'));
  assert.ok(left.includes('جملة لا يعرفها القاموس'));
  assert.ok(left.some((s) => s.startsWith('[repeat] aew dynamite 06.10.2026')), left.join(' | '));
  assert.ok(left.some((s) => s.startsWith('[order] ')), left.join(' | '));
});

test('the Arabic name and its English line, now the same, are shown once; a path never repeats a step', () => {
  const { html } = run(page('عرب راسلنج', '<div class="slide"><h2>عرض ديناميت 06.10.2026 مترجم</h2><p class="spotlight-subtitle">AEW Dynamite 06.10.2026</p></div><nav class="lib-crumbs"><a href="/">الرئيسية</a><span>‹</span><a href="/library/federation/ajpw/"><bdi>AJPW</bdi></a><span>‹</span><span><bdi>AJPW</bdi></span></nav>'));
  assert.equal(html.match(/AEW Dynamite 06\.10\.2026/g)!.length, 1);
  assert.match(html, /<a href="\/library\/federation\/ajpw\/"><bdi>AJPW<\/bdi><\/a><\/nav>/);
  assert.match(html, /<span>›<\/span>/); // the path points left to right
});

test('the Arabic site is untouched apart from the language button, and a second run changes nothing', () => {
  const site = fs.mkdtempSync(path.join(os.tmpdir(), 'en-site-'));
  const ar = page('عرب راسلنج', '<p>الأخبار</p>');
  fs.writeFileSync(path.join(site, 'index.html'), ar);
  fs.mkdirSync(path.join(site, 'news', 'x'), { recursive: true });
  const story = page('خبر', '<p>خبر</p>');
  fs.writeFileSync(path.join(site, 'news', 'x', 'index.html'), story);
  for (let i = 0; i < 2; i++) mirror.buildEnglish(site, { content: {} });
  const after = fs.readFileSync(path.join(site, 'index.html'), 'utf8');
  const strip = (s: string) => s.replace(/<a data-i18n[^>]*>[\s\S]*?<\/a>/g, '').replace(/<script data-i18n>[\s\S]*?<\/script>/g, '').replace(/<link data-i18n[^>]*>/g, '');
  assert.equal(strip(after), ar); // byte for byte (alt="" and «/>» kept as the build wrote them)
  assert.equal(after.match(/lang-switch/g)!.length, 1);
  assert.match(after, /hreflang="en" href="https:\/\/arab-wrestling\.com\/en\/"/);
  assert.match(after, /arw-lang=en/); // English chosen before: the Arabic page opens in English
  // a news story has no English copy: its button goes to the English home, and it never redirects
  const s2 = fs.readFileSync(path.join(site, 'news', 'x', 'index.html'), 'utf8');
  assert.match(s2, /class="theme-toggle lang-switch" href="\/en\/"/);
  assert.doesNotMatch(s2, /location\.replace/);
  assert.ok(fs.existsSync(path.join(site, 'en', 'index.html')));
  assert.ok(!fs.existsSync(path.join(site, 'en', 'news', 'x', 'index.html')));
  assert.match(fs.readFileSync(path.join(site, 'en', 'index.html'), 'utf8'), /class="theme-toggle lang-switch" href="\/"[^>]*lang="ar"/);
});

test('one Arabic text for many shows gets a general English one, never one show\'s name', () => {
  const map = content.buildContentMap({});
  for (const [ar, en] of Object.entries(map) as [string, string][]) {
    assert.doesNotMatch(en, AR, ar);
    // a description shared by several shows never carries a date
    if (/مترجم بالكامل مع جميع النزالات/.test(ar)) assert.doesNotMatch(en, /\d{2}\.\d{2}\.\d{4}/, ar);
  }
});

test('the dictionary is English, and the scripts keep what they compute with', () => {
  for (const [ar, en] of Object.entries(dict.ui) as [string, string][]) assert.doesNotMatch(String(en), AR, ar);
  assert.equal(mirror.trJs("var a='ا', d='٠١٢٣٤٥٦٧٨٩', t='جاري البحث...', u='/search-index.json';", tr), "var a='ا', d='٠١٢٣٤٥٦٧٨٩', t='Searching…', u='/en/search-index.json';");
});
