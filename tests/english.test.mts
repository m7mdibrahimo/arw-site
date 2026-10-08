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
  assert.match(after, /document\.prerendering[\s\S]*prerenderingchange/); // …decided when shown, never while prerendered
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

// English news (INCIDENTS #354): new stories get an English edition from the English source; the English site lists
// them, and an Arabic story with one points to it.
const card = (href: string, title: string, fed = 'WWE') => `<a class="news-card reveal" href="${href}"><div class="news-thumb"><img class="thumb-img" src="/x.jpg" alt="${title}"></div><div class="news-body"><span class="kind-badge kind-news">خبر</span><span class="cat cat-${fed.toLowerCase()}">${fed}</span><h3>${title}</h3><span class="date">07 أكتوبر</span></div></a>`;
const pager = '<nav class="pagination-nav" aria-label="تصفح الصفحات"><div class="pagination-wrap"><span class="page-link prev disabled" aria-disabled="true"><span>السابق</span></span><div class="page-numbers"><span class="page-link active" aria-current="page">1</span><a href="/news/2/" class="page-link">2</a></div><a href="/news/2/" class="page-link next" aria-label="الصفحة التالية"><span>التالي</span></a></div></nav>';

test('English news: the list, the story, the cards and the language buttons', () => {
  const site = fs.mkdtempSync(path.join(os.tmpdir(), 'en-news-'));
  const put = (u: string, html: string) => { fs.mkdirSync(path.join(site, u), { recursive: true }); fs.writeFileSync(path.join(site, u, 'index.html'), html); };
  put('', page('عرب راسلنج', `<div class="grid-12">${card('/news/خبر-أ/', 'خبر أ')}${card('/news/خبر-ب/', 'خبر ب', 'AEW')}</div>`));
  put('news', page('الأخبار', `<script type="application/ld+json">{"@type":"CollectionPage","mainEntity":{"@type":"ItemList","itemListElement":[{"@type":"ListItem","position":1,"url":"https://arab-wrestling.com/news/خبر-ج/"}]}}</script><div class="grid-12">${card('/news/خبر-أ/', 'خبر أ')}${card('/news/خبر-ب/', 'خبر ب', 'AEW')}</div>${pager}`));
  put('news/2', page('الأخبار', `<div class="grid-12">${card('/news/خبر-ج/', 'خبر ج')}</div>${pager}`));
  put('news/خبر-أ', page('خبر أ', '<p>خبر</p>'));
  put('news/خبر-ب', page('خبر ب', '<p>خبر</p>'));
  const story = (t: string) => page(t, `<article><h1>${t}</h1><p>Cody Rhodes is making the first major change to his logo.</p><a class="sh-wa" href="https://wa.me/?text=https%3A%2F%2Farab-wrestling.com%2Fen-src%2Fnews%2Fcody-logo%2F">WhatsApp</a><link rel="canonical" href="https://arab-wrestling.com/en-src/news/cody-logo/"></article><div class="related"><a class="related-card" href="/news/خبر-ب/"><span class="related-card-fed fed-aew">AEW</span><h4 class="related-card-title">خبر ب</h4></a></div>`);
  put('en-src/news/cody-logo', story('Cody Rhodes Changing His Logo'));
  put('en-src/news/aew-story', story('An AEW Story'));
  const news = [
    { src: '/en-src/news/cody-logo/', en: '/en/news/cody-logo/', ar: '/news/خبر-أ/', title: 'Cody Rhodes Changing His Logo', date: '2026-10-07T21:55:39.000Z', image: '/a.jpg', federation: 'WWE', description: 'Cody.' },
    { src: '/en-src/news/aew-story/', en: '/en/news/aew-story/', ar: '/news/خبر-ب/', title: 'An AEW Story', date: '2026-10-07T20:00:00.000Z', image: '/b.jpg', federation: 'AEW', description: 'AEW.' },
  ];
  fs.writeFileSync(path.join(site, 'search-index.json'), JSON.stringify([{ title: 'خبر أ', kind: 'news', url: '/news/خبر-أ/' }]));
  mirror.buildEnglish(site, { content: {}, news });
  const read = (u: string) => fs.readFileSync(path.join(site, u, 'index.html'), 'utf8');

  // the list: English stories only, newest first, one page (no page numbers)
  const list = read('en/news');
  assert.match(list, /<html lang="en" dir="ltr">/);
  assert.match(list, /href="\/en\/news\/cody-logo\/"[\s\S]*Cody Rhodes Changing His Logo[\s\S]*href="\/en\/news\/aew-story\/"/);
  assert.match(list, /<span class="cat cat-aew">AEW<\/span>/);
  assert.match(list, /"itemListElement":\[\{"@type":"ListItem","position":1,"url":"https:\/\/arab-wrestling\.com\/en\/news\/cody-logo\/"\},\{[^\]]*aew-story\/"\}\]/);
  assert.match(list, /<img class="thumb-img" src="\/a\.jpg" alt="Cody Rhodes Changing His Logo">/);
  assert.doesNotMatch(list, /pagination-nav/);
  const noButton = (h: string) => h.replace(/<meta name="description"[^>]*>/, '').replace(/<a[^>]*lang-switch[\s\S]*?<\/a>/, '');
  assert.doesNotMatch(noButton(list), AR);
  assert.ok(!fs.existsSync(path.join(site, 'en', 'news', '2')));
  // the story: English, its related card another English story, its button to its Arabic story
  const s = read('en/news/cody-logo');
  assert.match(s, /<h1>Cody Rhodes Changing His Logo<\/h1>/);
  assert.match(s, /<a class="related-card" href="\/en\/news\/aew-story\/">[\s\S]*An AEW Story/);
  assert.match(s, /class="theme-toggle lang-switch" href="\/news\/%D8%AE%D8%A8%D8%B1-%D8%A3\/"|class="theme-toggle lang-switch" href="\/news\/خبر-أ\/"/);
  assert.match(s, /hreflang="en" href="https:\/\/arab-wrestling\.com\/en\/news\/cody-logo\/"/);
  assert.doesNotMatch(s, /en-src/i);
  assert.doesNotMatch(noButton(s), AR);
  // the Arabic story points to its English one; one with none points to the English home
  assert.match(read('news/خبر-أ'), /class="theme-toggle lang-switch" href="\/en\/news\/cody-logo\/"/);
  assert.match(read('news/خبر-أ'), /hreflang="en" href="https:\/\/arab-wrestling\.com\/en\/news\/cody-logo\/"/);
  // the English home's news cards are the English stories
  const home = read('en');
  assert.match(home, /href="\/en\/news\/cody-logo\/"/);
  assert.doesNotMatch(home, /خبر أ/);
  // no Arabic story copied to /en/, no draft left, the search finds the English story
  assert.ok(!fs.existsSync(path.join(site, 'en-src')));
  const idx = JSON.parse(fs.readFileSync(path.join(site, 'en', 'search-index.json'), 'utf8'));
  assert.deepEqual(idx.map((x: any) => x.url), ['/en/news/cody-logo/', '/en/news/aew-story/']);
  assert.match(fs.readFileSync(path.join(site, 'en', 'sitemap.xml'), 'utf8'), /\/en\/news\/cody-logo\//);
});

test('English news list: page numbers, «previous» and «next» count the English pages', () => {
  const site = fs.mkdtempSync(path.join(os.tmpdir(), 'en-pages-'));
  fs.mkdirSync(path.join(site, 'news'), { recursive: true });
  fs.writeFileSync(path.join(site, 'news', 'index.html'), page('الأخبار', `<div class="grid-12">${Array.from({ length: 20 }, (_, k) => card(`/news/خبر-${k}/`, `خبر ${k}`)).join('')}</div>${pager}`));
  const news = Array.from({ length: 45 }, (_, k) => {
    const u = `/en-src/news/s${k}/`;
    fs.mkdirSync(path.join(site, u), { recursive: true });
    fs.writeFileSync(path.join(site, u, 'index.html'), page(`Story ${k}`, `<h1>Story ${k}</h1>`));
    return { src: u, en: `/en/news/s${k}/`, ar: `/news/خبر-${k}/`, title: `Story ${k}`, date: '2026-10-07T20:00:00.000Z', image: '/a.jpg', federation: 'WWE' };
  });
  mirror.buildEnglish(site, { content: {}, news });
  const p = (n: string) => fs.readFileSync(path.join(site, 'en', 'news', n, 'index.html'), 'utf8');
  assert.equal(p('').match(/class="news-card/g)!.length, 20);
  assert.equal(p('3').match(/class="news-card/g)!.length, 5);
  assert.match(p(''), /<span class="page-link prev disabled" aria-disabled="true">/);
  assert.match(p(''), /<a href="\/en\/news\/2\/" class="page-link next" aria-label="Next page">/);
  assert.match(p('2'), /<a href="\/en\/news\/" class="page-link prev" aria-label="Previous page">/);
  assert.match(p('2'), /<span class="page-link active" aria-current="page">2<\/span>/);
  assert.match(p('3'), /<span class="page-link next disabled" aria-disabled="true">/);
  assert.match(p('3'), /<title>Pro Wrestling News, page 3 \| Arab Wrestling<\/title>/);
});

test('a list mixing news and shows by date: each story becomes its own English edition, an older one is taken out', () => {
  const site = fs.mkdtempSync(path.join(os.tmpdir(), 'en-mixed-'));
  const put = (u: string, html: string) => { fs.mkdirSync(path.join(site, u), { recursive: true }); fs.writeFileSync(path.join(site, u, 'index.html'), html); };
  const show = '<a class="show-card reveal" href="/shows/aew-dynamite-06-10-2026/"><h3>عرض ديناميت 06.10.2026 مترجم</h3></a>';
  put('federation/aew', page('AEW', `<div class="grid-12">${card('/news/خبر-ب/', 'خبر ب', 'AEW')}${show}${card('/news/خبر-قديم/', 'خبر قديم', 'AEW')}</div>`));
  put('shows/aew-dynamite-06-10-2026', page('عرض', '<p>x</p>'));
  put('en-src/news/aew-story', page('An AEW Story', '<h1>An AEW Story</h1>'));
  put('en-src/news/wwe-story', page('A WWE Story', '<h1>A WWE Story</h1>'));
  mirror.buildEnglish(site, { content: { 'عرض ديناميت 06.10.2026 مترجم': 'AEW Dynamite 06.10.2026' }, news: [
    { src: '/en-src/news/wwe-story/', en: '/en/news/wwe-story/', ar: '/news/خبر-أ/', title: 'A WWE Story', date: '2026-10-07T22:00:00.000Z', image: '/a.jpg', federation: 'WWE' },
    { src: '/en-src/news/aew-story/', en: '/en/news/aew-story/', ar: '/news/%D8%AE%D8%A8%D8%B1-%D8%A8/', title: 'An AEW Story', date: '2026-10-07T20:00:00.000Z', image: '/b.jpg', federation: 'AEW' },
  ] });
  const html = fs.readFileSync(path.join(site, 'en', 'federation', 'aew', 'index.html'), 'utf8');
  assert.equal(html.match(/class="news-card/g)!.length, 1);
  assert.match(html, /href="\/en\/news\/aew-story\/"[\s\S]*An AEW Story[\s\S]*AEW Dynamite 06\.10\.2026/);
  assert.doesNotMatch(html, /A WWE Story|خبر/);
});

test('a promotion\'s pages in English: the older stories out, the rest put back 20 a page, no empty page', () => {
  const site = fs.mkdtempSync(path.join(os.tmpdir(), 'en-feed-'));
  const put = (u: string, html: string) => { fs.mkdirSync(path.join(site, u), { recursive: true }); fs.writeFileSync(path.join(site, u, 'index.html'), html); };
  const show = (k: number) => `<a class="show-card reveal" href="/shows/s${k}/"><h3>S${k}</h3></a>`;
  // three Arabic pages: page 1 = 1 new story (with an English edition) + 19 old ones, page 2 = 10 old + 10 shows, page 3 = 15 shows
  const p1 = card('/news/جديد/', 'جديد') + Array.from({ length: 19 }, (_, k) => card(`/news/قديم-${k}/`, 'قديم')).join('');
  const p2 = Array.from({ length: 10 }, (_, k) => card(`/news/قديم-ب-${k}/`, 'قديم')).join('') + Array.from({ length: 10 }, (_, k) => show(k)).join('');
  const p3 = Array.from({ length: 15 }, (_, k) => show(10 + k)).join('');
  [p1, p2, p3].forEach((g, i) => put(i ? `federation/wwe/${i + 1}` : 'federation/wwe', page('WWE', `<div class="grid-12">${g}</div>${pager}`)));
  put('en-src/news/new', page('New', '<h1>New</h1>'));
  mirror.buildEnglish(site, { content: {}, news: [{ src: '/en-src/news/new/', en: '/en/news/new/', ar: '/news/جديد/', title: 'A New Story', date: '2026-10-07T22:00:00.000Z', image: '/a.jpg', federation: 'WWE' }] });
  const read = (u: string) => fs.readFileSync(path.join(site, u, 'index.html'), 'utf8');
  const one = read('en/federation/wwe'), two = read('en/federation/wwe/2');
  assert.equal(one.match(/class="(news|show)-card/g)!.length, 20); // the story + 19 shows
  assert.match(one, /href="\/en\/news\/new\/"[\s\S]*A New Story/);
  assert.equal(two.match(/class="(news|show)-card/g)!.length, 6);
  assert.match(two, /href="\/shows\/s24\/"/);
  assert.ok(!fs.existsSync(path.join(site, 'en', 'federation', 'wwe', '3')));
  assert.match(two, /<span class="page-link next disabled"/);
  assert.match(one, /<a href="\/en\/federation\/wwe\/2\/" class="page-link next"/);
  // the third Arabic page: its button goes to the English list, with no English twin declared
  const ar3 = read('federation/wwe/3');
  assert.match(ar3, /class="theme-toggle lang-switch" href="\/en\/federation\/wwe\/"/);
  assert.doesNotMatch(ar3, /<link[^>]*hreflang="en"/);
});
