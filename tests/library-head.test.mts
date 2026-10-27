// The library page of a program with one or two shows used to have almost the newest episode's own <title> and
// description («عرض … مترجم كامل (17 أكتوبر 2026)» twice), so Google kept only the episode (/library/njpw-special-events/
// was still "URL unknown to Google" after 147 hours, /library/cmll-international-womens-grand-prix/ discovered but not
// indexed). INCIDENTS #862: the head of such a page is the collection's, and this test renders the real front matter.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const nunjucks = require('nunjucks');

const AR_MONTHS = ['يناير', 'فبراير', 'مارس', 'أبريل', 'مايو', 'يونيو', 'يوليو', 'أغسطس', 'سبتمبر', 'أكتوبر', 'نوفمبر', 'ديسمبر'];

function frontMatterLine(src: string, key: string): string {
  const m = src.match(new RegExp(`^  ${key}: "([^"]*)"$`, 'm'));
  assert.ok(m, `${key} exists in the front matter`);
  return m![1];
}

function headMaker() {
  const src = fs.readFileSync(new URL('../pages/library-program.njk', import.meta.url), 'utf8');
  const title = frontMatterLine(src, 'pageTitle');
  const desc = frontMatterLine(src, 'pageDesc');
  const env = new nunjucks.Environment(null, { autoescape: false });
  env.addFilter('arCount', (n: any, one: string, two: string, few: string, many: string) => {
    n = Number(n) || 0;
    const r = n % 100;
    if (n === 1) return one;
    if (n === 2) return two;
    if (r >= 3 && r <= 10) return n + ' ' + few;
    return n + ' ' + many;
  });
  env.addFilter('yearOf', (d: any) => String(d || '').slice(0, 4));
  // «17 أكتوبر 2026», the way eleventy.config.js formats a date
  env.addFilter('date', (d: any) => {
    const [y, m, day] = String(d || '').split('-').map(Number);
    return `${day} ${AR_MONTHS[m - 1]} ${y}`;
  });
  env.addGlobal('libAltNames', () => '');
  return (prog: any) => ({
    title: env.renderString(title, { lp: { prog, pageNumber: 1 } }),
    desc: env.renderString(desc, { lp: { prog, pageNumber: 1 } }),
  });
}

test('a one-show library page has a collection head, never the newest episode head again (INCIDENTS #862)', () => {
  const head = headMaker();
  const prog = {
    name: 'NJPW Special Events',
    arName: 'عرض ان جيه بي ديليو تايتشي سكول برو ريسلنج 2',
    arLibTitle: 'عروض ان جيه بي ديليو تايتشي سكول برو ريسلنج 2 مترجمة',
    count: 1,
    latest: { eventDate: '2026-10-17' },
    aliases: [],
  };
  const h = head(prog);
  // the collection's title: plural, the year (people search it) and how many shows it holds — no episode pitch
  assert.match(h.title, /^عروض .+ 2026 المترجمة \(عرض واحد\) — NJPW Special Events$/);
  assert.doesNotMatch(h.title, /كامل|17 أكتوبر/);
  assert.match(h.desc, /^كل عروض NJPW Special Events 2026 المترجمة بالعربي \(عرض واحد\)/);
  assert.match(h.desc, /روابط المشاهدة والتحميل/);
  // two shows: the dual form, not «عرض واحد»
  assert.match(head({ ...prog, count: 2 }).title, /\(عرضان\)/);
  // …and it is clearly not the newest episode's own head
  const { showSeoText } = require('../lib/show-seo.cjs');
  const ep = showSeoText({ headline: 'عرض ان جيه بي ديليو تايتشي سكول برو ريسلنج 2 17.10.2026 مترجم', title: 'NJPW Taichi School Pro Wrestling 2 2026', programName: 'NJPW Special Events', eventDate: '2026-10-17', day: '17 أكتوبر 2026', isLatest: true });
  assert.notEqual(h.title, ep.title);
  assert.notEqual(h.desc, ep.description);
});

test('a big weekly program keeps «الأخير» in its library head (the #547 shape was only for one-off programs)', () => {
  const head = headMaker();
  const h = head({ name: 'WWE RAW', arName: 'عرض الرو', arLibTitle: 'عروض الرو مترجمة', count: 40, latest: { eventDate: '2026-10-19' }, aliases: [] });
  assert.match(h.title, /^عرض الرو الأخير كامل مترجم \(19 أكتوبر 2026\) — WWE RAW$/);
  assert.match(h.desc, /^مشاهدة وتحميل عرض الرو الاخير كامل ومترجم بالعربي \(19 أكتوبر 2026\)/);
});
