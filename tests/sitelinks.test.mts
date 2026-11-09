// The links Google shows under «عرب راسلنج» (owner, 2026-11-09): he wants only his four sections there —
// عروض المصارعة /shows/، مكتبة العروض /library/، الأخبار /news/، نوستالجيا /nostalgia/. Google picked «صفحة 119»
// (/federations/119/), «Pro Wrestling Shows …» (/en/, whose description was still Arabic), «مصارعة WWE الحرة»
// (/federation/wwe/) and «من نحن» (/about/); Search Console also showed /shows/3/, /federations/49/, /apps/ and
// /support/ taking those slots (position ~1.3, thousands of impressions, almost no clicks).
// Google chooses sitelinks itself; these tests lock every signal the site controls, all of it in the head.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const nunjucks = require("nunjucks");
const env = new nunjucks.Environment(null, { autoescape: false });

const FOUR = [
  ["عروض المصارعة", "/shows/"],
  ["مكتبة العروض", "/library/"],
  ["الأخبار", "/news/"],
  ["نوستالجيا", "/nostalgia/"],
];

// the rendered robots meta of a template's head for one context
function robots(file: string, ctx: Record<string, unknown>) {
  const src = fs.readFileSync(file, "utf-8");
  const lines = src.split("\n").filter((l) => /name="robots"/.test(l));
  assert.equal(lines.length, 1, `${file}: one robots line`);
  return env.renderString(lines[0], ctx).trim();
}
const noindex = (s: string) => /<meta name="robots" content="noindex, follow">/.test(s) && !/content="index/.test(s);
const indexable = (s: string) => /<meta name="robots" content="index, follow/.test(s) && !/noindex/.test(s);

test("page 2+ of every listing is noindex, follow; page 1 stays indexable", () => {
  const cases: [string, (n: number) => Record<string, unknown>][] = [
    ["pages/shows.njk", (n) => ({ pagination: { pageNumber: n - 1 } })],
    ["pages/news.njk", (n) => ({ pagination: { pageNumber: n - 1 } })],
    ["pages/federation.njk", (n) => ({ fedPage: { pageNumber: n } })],
    ["pages/library-program.njk", (n) => ({ lp: { pageNumber: n } })],
    ["pages/tag.njk", (n) => ({ tagPage: { pageNumber: n }, tagObj: { count: 50 } })],
  ];
  for (const [file, ctx] of cases) {
    assert.ok(indexable(robots(file, ctx(1))), `${file} page 1 must be indexable`);
    for (const n of [2, 3, 119]) assert.ok(noindex(robots(file, ctx(n))), `${file} page ${n} must be noindex, follow`);
  }
  // a thin tag stays noindex on page 1 as before
  assert.ok(noindex(robots("pages/tag.njk", { tagPage: { pageNumber: 1 }, tagObj: { count: 2 } })));
});

test("paginated pages keep a self-canonical (never page 1 together with noindex)", () => {
  for (const f of ["pages/shows.njk", "pages/news.njk", "pages/federations.njk"]) {
    assert.match(fs.readFileSync(f, "utf-8"), /<link rel="canonical" href="https:\/\/arab-wrestling\.com\{\{ page\.url \| cleanUrl \}\}">/, f);
  }
  assert.match(fs.readFileSync("pages/federation.njk", "utf-8"), /<link rel="canonical" href="https:\/\/arab-wrestling\.com\{\{ fedPage\.url \}\}">/);
});

test("the pages that kept taking the four slots are noindex, follow", () => {
  // /federations/ lists every item 20 at a time (~250 pages): «صفحة 119» came from there
  for (const n of [0, 1, 118]) assert.ok(noindex(robots("pages/federations.njk", { pagination: { pageNumber: n } })), `/federations/ page ${n + 1}`);
  for (const f of ["pages/about.njk", "pages/apps.njk", "support.njk"]) assert.ok(noindex(robots(f, {})), f);
});

test("the four sections stay indexable", () => {
  assert.ok(indexable(robots("pages/shows.njk", { pagination: { pageNumber: 0 } })));
  assert.ok(indexable(robots("pages/news.njk", { pagination: { pageNumber: 0 } })));
  for (const f of ["pages/library.njk", "pages/nostalgia.njk"]) {
    const src = fs.readFileSync(f, "utf-8");
    assert.ok(!/noindex/.test(src.split("</head>")[0]), `${f} must not be noindex`);
  }
});

test("the home page names the same four, in the owner's order, in its structured data, footer and menu", () => {
  const home = fs.readFileSync("index.njk", "utf-8");
  const nav = [...home.matchAll(/"@type": "SiteNavigationElement",\s*"position": (\d),\s*"name": "([^"]+)",\s*"description": "[^"]+",\s*"url": "https:\/\/arab-wrestling\.com([^"]+)"/g)];
  assert.deepEqual(nav.map((m) => [m[2], m[3]]), FOUR);
  assert.deepEqual(nav.map((m) => m[1]), ["1", "2", "3", "4"]);
  const footer = (home.match(/<nav class="footer-nav"[^>]*>([\s\S]*?)<\/nav>/) || [])[1] || "";
  assert.deepEqual([...footer.matchAll(/<a href="([^"]+)">([^<]+)<\/a>/g)].map((m) => [m[2], m[1]]), FOUR);
  // the header menu links each section with the same words (the anchor text Google reads)
  for (const [name, url] of FOUR) assert.ok(home.includes(`<a class="navlink" href="${url}">${name}</a>`), `menu: ${name}`);
});

test("the sitemap lists the four sections at 0.9 and never a noindex page", () => {
  const sm = fs.readFileSync("pages/sitemap.njk", "utf-8");
  const prio = (u: string) => (sm.match(new RegExp(`<loc>https://arab-wrestling\\.com${u.replace(/\//g, "\\/")}</loc>[\\s\\S]*?<priority>([\\d.]+)</priority>`)) || [])[1];
  for (const [, url] of FOUR) assert.equal(prio(url), "0.9", url);
  for (const u of ["/federations/", "/about/", "/apps/", "/support/"]) assert.ok(!sm.includes(`<loc>https://arab-wrestling.com${u}</loc>`), `${u} is noindex and must not be in the sitemap`);
  assert.ok(!/<loc>[^<]*\/(shows|news|federations)\/\{\{/.test(sm), "no paginated listing in the sitemap");
});

test("/en/ gets an English description: the home page's current description has its translation", () => {
  // /en/ fell back to the Arabic sentence whenever the home description changed, and Google showed /en/
  // («Pro Wrestling Shows …») next to the Arabic home page.
  const { ui } = require("../lib/i18n/en.cjs");
  const home = fs.readFileSync("index.njk", "utf-8");
  const desc = (home.match(/<meta name="description" content="([^"]+)">/) || [])[1];
  assert.ok(desc && !/\{\{|\{%/.test(desc), "the home description is plain text");
  assert.ok(ui[desc], `lib/i18n/en.cjs has no English for the home description: «${desc}»`);
  assert.ok(!/[؀-ۿ]/.test(ui[desc]));
  for (const m of home.matchAll(/"@type": "SiteNavigationElement",[\s\S]*?"description": "([^"]+)"/g)) {
    assert.ok(ui[m[1]] && !/[؀-ۿ]/.test(ui[m[1]]), `no English for «${m[1]}»`);
  }
});
