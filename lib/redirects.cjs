// Converts the repo's _redirects (written in Netlify syntax: `301!`, domain-level
// sources) into rules Cloudflare Pages actually honours.
//
// Pages rejects every line whose status isn't a bare number, so `301!` made the
// ENTIRE file a no-op — every renamed/merged article or tag URL 404'd. Pages also
// ignores domain-level sources and caps splat rules at 100, so a `/old/* /new/:splat`
// rule stays a splat only when its target actually has sub-pages (tag pagination,
// section indexes); otherwise it becomes static rules for the URLs the page has
// (/old/, /old, /old/index.html). Arabic paths match both raw and encoded as-is.
// Order matters: Pages counts every rule from the first splat onward toward the
// 100-rule dynamic cap (verified on a preview deploy — with one splat on line 5,
// rules past line 100 silently stopped working), so all static rules go first.
const fs = require("fs");
const path = require("path");

const PAGES_STATIC_LIMIT = 2000;
const PAGES_DYNAMIC_LIMIT = 100;
const PAGES_LINE_LIMIT = 1000;

function hasSubPages(siteDir, dest) {
  try {
    const dir = path.join(siteDir, decodeURI(dest));
    return fs.readdirSync(dir, { withFileTypes: true }).some(e => e.isDirectory());
  } catch {
    return false;
  }
}

function toPagesRedirects(text, siteDir = "_site", extra = [], tooLong = []) {
  const staticRules = [];
  const dynamicRules = [];
  const seen = new Set();
  const add = (from, to, code, isDynamic = false) => {
    if (seen.has(from)) return;
    seen.add(from);
    // Pages matches the request path as the browser sends it — percent-encoded. A rule written
    // in Arabic letters never matched: every Arabic tag and renamed-story redirect answered 404
    // (INCIDENTS #200). Only the non-ASCII runs are encoded, so «%E2%80%8E» rules stay as they are.
    const enc = (p) => p.replace(/[^\x00-\x7F]+/g, encodeURIComponent);
    const rule = `${enc(from)} ${enc(to)} ${code}`;
    // Pages rejects a rule longer than 1,000 characters; a very long Arabic slug can't redirect here
    if (rule.length > PAGES_LINE_LIMIT) { tooLong.push([from, to]); return; }
    (isDynamic ? dynamicRules : staticRules).push(rule);
  };
  for (const raw of text.split("\n")) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const [from, to, rawCode = "301"] = line.split(/\s+/);
    if (!from || !to || !from.startsWith("/")) continue; // domain-level: unsupported on Pages
    const code = rawCode.replace(/!$/, "");
    if (from.endsWith("/*") && to.endsWith("/:splat")) {
      const base = from.slice(0, -1);
      const dest = to.slice(0, -":splat".length);
      if (dynamicRules.length < PAGES_DYNAMIC_LIMIT && hasSubPages(siteDir, dest)) {
        add(from, to, code, true);
      } else {
        add(base, dest, code);
        add(base.slice(0, -1), dest, code);
        add(`${base}index.html`, dest, code);
      }
    } else {
      add(from, to, code, from.includes("*") || from.includes(":"));
    }
  }
  // Automatic ones (renamedArticleRedirects) never override a written rule and never push the
  // file past the limit: the build must not fail because an article was renamed.
  for (const [from, to] of extra) {
    if (seen.has(from) || staticRules.length + 3 > PAGES_STATIC_LIMIT) continue;
    add(from, to, "301");
    add(from.slice(0, -1), to, "301");
    add(`${from}index.html`, to, "301");
  }
  if (staticRules.length > PAGES_STATIC_LIMIT || dynamicRules.length > PAGES_DYNAMIC_LIMIT) {
    throw new Error(`_redirects exceeds Cloudflare Pages limits (${staticRules.length}/${PAGES_STATIC_LIMIT} static, ${dynamicRules.length}/${PAGES_DYNAMIC_LIMIT} dynamic)`);
  }
  return [...staticRules, ...dynamicRules].join("\n") + "\n";
}

/**
 * A news URL comes from the title (content/news/news.json), so fixing a word in a published title
 * moves the story to a new URL and the one already shared on Telegram/Facebook/Instagram 404s (CMLL
 * 28 Sep: «بآربارو» → «باربارو», INCIDENTS #127). The file name keeps the URL the story was first
 * published under («20260929081500-<slug>.md»): whenever the two differ, the old one redirects.
 * Newest first, so the recent (most shared) stories win if the limit is ever reached.
 */
function renamedArticleRedirects(contentDir = "content/news", siteDir = "_site") {
  const matter = require("gray-matter");
  const { arabicSlug } = require("./slug.cjs");
  const out = [];
  let files = [];
  try { files = fs.readdirSync(contentDir).filter(f => /^\d{14}-.+\.md$/.test(f)).sort().reverse(); } catch { return out; }
  for (const f of files) {
    let data;
    try { ({ data } = matter(fs.readFileSync(path.join(contentDir, f), "utf-8"))); } catch { continue; }
    const current = data.permalink ? String(data.permalink).replace(/index\.html$/, "") : `/news/${arabicSlug(data.title || f.replace(/\.md$/, ""))}/`;
    const original = `/news/${f.replace(/\.md$/, "").replace(/^\d{14}-/, "")}/`;
    const dec = (u) => { try { return decodeURIComponent(u); } catch { return u; } };
    if (dec(original) === dec(current)) continue;
    // never shadow a page that really lives at that address
    if (fs.existsSync(path.join(siteDir, dec(original), "index.html"))) continue;
    out.push([dec(original), dec(current)]);
  }
  return out;
}

/**
 * A redirect too long for Pages (a long Arabic slug, over 1,000 characters encoded) becomes a small
 * page at the old address that sends the reader on (INCIDENTS #200). Only a «/…/» path with no page
 * of its own; the old URL keeps working from Telegram, Facebook and search.
 */
function writeRedirectPages(rules, siteDir = "_site") {
  const esc = (x) => String(x).replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
  let n = 0;
  for (const [from, to] of rules) {
    if (!from.endsWith("/") || /[*:]/.test(from) || from.includes("..")) continue;
    const file = path.join(siteDir, from, "index.html");
    // Linux allows 255 bytes per folder name; an Arabic slug can be longer — skip it, never fail the build
    if (fs.existsSync(file) || from.split("/").some(seg => Buffer.byteLength(seg) > 255)) continue;
    try { fs.mkdirSync(path.dirname(file), { recursive: true }); } catch { continue; }
    fs.writeFileSync(file, `<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8"><title>عرب راسلنج</title><link rel="canonical" href="${esc(to)}"><meta name="robots" content="noindex"><meta http-equiv="refresh" content="0;url=${esc(to)}"><script>location.replace(${JSON.stringify(to)}+location.search+location.hash)</script></head><body><a href="${esc(to)}">انتقل إلى الخبر</a></body></html>`);
    n++;
  }
  return n;
}

/**
 * Older addresses of every article that Google may still hold: the file name without its date
 * prefix («2026-08-06-اقتراب-عودة-درو-ماكنتاير-لـ-wwe-…») and the slug of the title, when the
 * article now lives at a pinned permalink. Search Console showed nine such addresses answering 404
 * while still getting impressions (599 for one story — INCIDENTS #274). They become small redirect
 * pages, not _redirects rules: Pages allows only 2,000 static rules and ~1,000 are needed.
 */
function legacyArticleAddresses(contentDir = "content/news", siteDir = "_site") {
  const matter = require("gray-matter");
  const { arabicSlug } = require("./slug.cjs");
  const dec = (u) => { try { return decodeURIComponent(u); } catch { return u; } };
  const out = [];
  let files = [];
  try { files = fs.readdirSync(contentDir).filter(f => f.endsWith(".md")); } catch { return out; }
  for (const f of files) {
    let data;
    try { ({ data } = matter(fs.readFileSync(path.join(contentDir, f), "utf-8"))); } catch { continue; }
    const current = dec(data.permalink ? String(data.permalink).replace(/index\.html$/, "") : `/news/${arabicSlug(data.title || f.replace(/\.md$/, ""))}/`);
    const olds = new Set([
      `/news/${f.replace(/\.md$/, "").replace(/^\d{14}-/, "").replace(/^\d{4}-\d{2}-\d{2}-/, "")}/`,
      `/news/${arabicSlug(data.title || "")}/`,
    ].map(dec));
    for (const old of olds) {
      if (old === current || old === "/news//") continue;
      if (fs.existsSync(path.join(siteDir, old, "index.html"))) continue; // never shadow a real page
      out.push([old, current]);
    }
  }
  return out;
}

/**
 * The source-folder address of every news story, show and recap («/content/shows/2026-08-08-
 * smackdown-07-08-2026/»): early builds published pages there and Google still sends readers to
 * them — 19 impressions for one SmackDown page answered 404 (INCIDENTS #284). Each one becomes a
 * small redirect page to where that file lives now (nostalgia has a _redirects wildcard already).
 */
function contentFolderAddresses(contentRoot = "content", siteDir = "_site") {
  const matter = require("gray-matter");
  const { arabicSlug } = require("./slug.cjs");
  const { showPath } = require("./show-permalink.cjs");
  const dec = (u) => { try { return decodeURIComponent(u); } catch { return u; } };
  const current = {
    news: (f, d) => d.permalink ? String(d.permalink).replace(/index\.html$/, "") : `/news/${arabicSlug(d.title || f.replace(/\.md$/, ""))}/`,
    shows: (f, d) => showPath(f, d.title, path.join(contentRoot, "shows")),
    recaps: (f, d) => `/recaps/${arabicSlug(d.title || f.replace(/\.md$/, ""))}/`,
  };
  const out = [];
  for (const [section, urlOf] of Object.entries(current)) {
    let files = [];
    try { files = fs.readdirSync(path.join(contentRoot, section)).filter(f => f.endsWith(".md")); } catch { continue; }
    for (const f of files) {
      let data;
      try { ({ data } = matter(fs.readFileSync(path.join(contentRoot, section, f), "utf-8"))); } catch { continue; }
      const to = dec(urlOf(f, data));
      if (!fs.existsSync(path.join(siteDir, to, "index.html"))) continue; // only to a page that really exists
      out.push([dec(`/content/${section}/${f.replace(/\.md$/, "")}/`), to]);
    }
  }
  return out;
}

module.exports = { toPagesRedirects, renamedArticleRedirects, writeRedirectPages, legacyArticleAddresses, contentFolderAddresses };
