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

/** The numbered sub-folders of a built list («/tag/x/» → ["2","3",…]): its pagination. */
function pageNumbers(siteDir, dest) {
  try {
    return fs.readdirSync(path.join(siteDir, decodeURI(dest)), { withFileTypes: true }).filter(e => e.isDirectory() && /^\d+$/.test(e.name)).map(e => e.name);
  } catch {
    return [];
  }
}

/** A page the build wrote: «/shows/x/» → _site/shows/x/index.html. */
function builtPage(siteDir, p) {
  if (!p || !p.startsWith("/") || /[*:]/.test(p)) return false;
  try {
    const rel = decodeURI(p.endsWith("/") ? p : `${p}/`);
    return fs.existsSync(path.join(siteDir, rel, "index.html"));
  } catch { return false; }
}

function toPagesRedirects(text, siteDir = "_site", extra = [], tooLong = [], dropped = []) {
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
  const lines = text.split("\n").map(l => l.trim()).filter(l => l && !l.startsWith("#")).map(l => l.split(/\s+/))
    .filter(([from, to]) => from && to && from.startsWith("/")); // domain-level: unsupported on Pages
  const isSplat = (from, to) => from.endsWith("/*") && to.endsWith("/:splat");
  // A wildcard rule that isn't «/old/* → /new/:splat» can only be dynamic, so its room is kept first:
  // a splat that doesn't fit becomes static rules instead. New articles give more tags sub-pages, and
  // the 100th splat once pushed the file to 101 and failed every build (INCIDENTS #314).
  const fixedDynamic = new Set(lines.filter(([from, to]) => !isSplat(from, to) && /[*:]/.test(from)).map(([from]) => from)).size;
  let splatRoom = Math.max(0, PAGES_DYNAMIC_LIMIT - fixedDynamic);
  for (const [from, to, rawCode = "301"] of lines) {
    const code = rawCode.replace(/!$/, "");
    // A live page never redirects to a page that doesn't exist: a September rule sent the GCW «20 Years Of Bad Boy»
    // show to an address its URL had stopped using, so the page Google had in the sitemap answered 404 (INCIDENTS #455).
    const fromPage = from.endsWith("/*") ? from.slice(0, -1) : from;
    const toPage = to.endsWith("/:splat") ? to.slice(0, -":splat".length) : to;
    if (siteDir && builtPage(siteDir, fromPage) && toPage.startsWith("/") && !/[*:]/.test(toPage) && !builtPage(siteDir, toPage)) {
      dropped.push([from, to]);
      continue;
    }
    if (isSplat(from, to)) {
      const base = from.slice(0, -1);
      const dest = to.slice(0, -":splat".length);
      if (splatRoom > 0 && !seen.has(from) && hasSubPages(siteDir, dest)) {
        splatRoom--;
        add(from, to, code, true);
      } else {
        add(base, dest, code);
        add(base.slice(0, -1), dest, code);
        add(`${base}index.html`, dest, code);
        // …and the pages of its paginated list («/tag/مصارعة-حرة/7/» → «/tag/مصارعة/7/»): Google holds those addresses too, and a
        // static rule can't carry a splat. Only while the file keeps room for the rules that come after (INCIDENTS #570).
        for (const n of pageNumbers(siteDir, dest)) {
          if (staticRules.length + 150 > PAGES_STATIC_LIMIT) break;
          add(`${base}${n}/`, `${dest}${n}/`, code);
        }
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
 * A library page lives only while a program has shows. When the panel files a show under another
 * program (CMLL Dia de Muertos Puebla → «CMLL Lunes Clasico», 27 Oct), its old library page was
 * already sent to Google (seo/new-shows.json) and then answered 404 (INCIDENTS #951). Each such
 * page now redirects to the library the show is listed in today (read from the show's built page),
 * or to the show itself — never over a page that still exists.
 */
function vanishedLibraryRedirects(siteDir = "_site", seoFile = "seo/new-shows.json", redirectsFile = "_redirects") {
  const out = [];
  let pages = {};
  try { pages = JSON.parse(fs.readFileSync(seoFile, "utf-8")).pages || {}; } catch { return out; }
  // an address _redirects already sends somewhere keeps its written rule («/library/roh/ → /federation/roh/»)
  let written = new Set();
  try { written = new Set(fs.readFileSync(redirectsFile, "utf-8").split("\n").map((l) => l.trim().split(/\s+/)[0]).filter(Boolean)); } catch {}
  for (const lang of ["", "/en"]) {
    let shows = [];
    try { shows = fs.readdirSync(path.join(siteDir, lang, "shows")).sort().reverse(); } catch { continue; }
    for (const url of Object.keys(pages)) {
      const m = url.match(/^https:\/\/arab-wrestling\.com\/library\/([a-z0-9-]+)\/$/);
      if (!m || written.has(`${lang}/library/${m[1]}/`) || builtPage(siteDir, `${lang}/library/${m[1]}/`)) continue;
      // the show whose own address is the library's plus a date («<slug>-26-10-2026», «<slug>-2026»)
      const show = shows.find(d => d.replace(/(-\d{2}-\d{2})?-\d{4}$/, "") === m[1] && builtPage(siteDir, `${lang}/shows/${d}/`));
      if (!show) continue;
      let to = `${lang}/shows/${show}/`;
      try {
        const html = fs.readFileSync(path.join(siteDir, lang, "shows", show, "index.html"), "utf-8");
        const lib = html.match(new RegExp(`"${lang}/library/([a-z0-9-]+)/"`));
        if (lib && builtPage(siteDir, `${lang}/library/${lib[1]}/`)) to = `${lang}/library/${lib[1]}/`;
      } catch {}
      out.push([`${lang}/library/${m[1]}/`, to]);
    }
  }
  return out;
}

/**
 * A show or recap whose title the panel edited a few times in its first minutes (MLP Josh Alexander vs Stu Grayson,
 * 29 Oct: «(Northern Rising) 22.10» → «(Northern Rising) 21.10» → «21.10») went live — and was sent to Google and
 * Bing (seo/new-shows.json) — under an in-between address that then answered 404 (INCIDENTS #961). Each such
 * address now redirects to the page of the file whose file-name address and current address together hold every
 * word of it; when two files fit, the closest one wins, and a tie is left alone. Never over a page that exists.
 */
function vanishedShowRedirects(siteDir = "_site", seoFile = "seo/new-shows.json", redirectsFile = "_redirects", contentRoot = "content") {
  const out = [];
  let pages = {};
  try { pages = JSON.parse(fs.readFileSync(seoFile, "utf-8")).pages || {}; } catch { return out; }
  let written = new Set();
  try { written = new Set(fs.readFileSync(redirectsFile, "utf-8").split("\n").map((l) => l.trim().split(/\s+/)[0]).filter(Boolean)); } catch {}
  const matter = require("gray-matter");
  const { arabicSlug } = require("./slug.cjs");
  const { showPath } = require("./show-permalink.cjs");
  const candidates = { shows: [], recaps: [] };
  for (const section of Object.keys(candidates)) {
    let files = [];
    try { files = fs.readdirSync(path.join(contentRoot, section)).filter((f) => f.endsWith(".md")); } catch { continue; }
    for (const f of files) {
      let data;
      try { ({ data } = matter(fs.readFileSync(path.join(contentRoot, section, f), "utf-8"))); } catch { continue; }
      const to = section === "shows" ? showPath(f, data.title, path.join(contentRoot, "shows")) : `/recaps/${arabicSlug(data.title || f.replace(/\.md$/, ""))}/`;
      const fileSlug = f.replace(/\.md$/, "").replace(/^\d{14}-/, "").replace(/^\d{4}-\d{2}-\d{2}-/, "");
      const words = new Set([...fileSlug.split("-"), ...to.split("/")[2].split("-")].filter(Boolean));
      candidates[section].push({ to, words });
    }
  }
  for (const lang of ["", "/en"]) {
    for (const url of Object.keys(pages)) {
      const m = url.match(/^https:\/\/arab-wrestling\.com\/(shows|recaps)\/([a-z0-9-]+)\/$/);
      if (!m) continue;
      const from = `${lang}/${m[1]}/${m[2]}/`;
      if (written.has(from) || builtPage(siteDir, from)) continue;
      const want = m[2].split("-").filter(Boolean);
      const fit = candidates[m[1]].filter((c) => want.every((w) => c.words.has(w)) && builtPage(siteDir, `${lang}${c.to}`)).sort((a, b) => a.words.size - b.words.size);
      if (!fit.length || (fit[1] && fit[1].words.size === fit[0].words.size)) continue;
      out.push([from, `${lang}${fit[0].to}`]);
    }
  }
  return out;
}

/**
 * An English story is built only while its Arabic pair exists. When the owner deletes the Arabic story from
 * the panel (Natalia Markova, 29 Oct), the English one — already in /en/sitemap.xml and sent to Google —
 * answered 404 until a round wrote a rule by hand (INCIDENTS #772, #982). Every English story whose
 * source_id has no Arabic story now sends its address to the English news page. Never over a page that exists.
 */
function orphanEnglishRedirects(contentRoot = "content", siteDir = "_site", redirectsFile = "_redirects") {
  const out = [];
  const idOf = (t) => (t.match(/^source_id:\s*"?(\d+)/m) || [])[1];
  let ar, en;
  try {
    ar = new Set(fs.readdirSync(path.join(contentRoot, "news")).filter((f) => f.endsWith(".md")).map((f) => idOf(fs.readFileSync(path.join(contentRoot, "news", f), "utf-8"))).filter(Boolean));
    en = fs.readdirSync(path.join(contentRoot, "news-en")).filter((f) => f.endsWith(".md"));
  } catch { return out; }
  let written = new Set();
  try { written = new Set(fs.readFileSync(redirectsFile, "utf-8").split("\n").map((l) => l.trim().split(/\s+/)[0].replace(/\*$/, "")).filter(Boolean)); } catch {}
  for (const f of en) {
    const t = fs.readFileSync(path.join(contentRoot, "news-en", f), "utf-8");
    const id = idOf(t);
    const slug = (t.match(/^slug:\s*"?([^"\n]+)"?/m) || [])[1];
    if (!id || !slug || ar.has(id)) continue;
    const from = `/en/news/${slug}/`;
    if (written.has(from) || builtPage(siteDir, from)) continue;
    out.push([from, "/en/news/"]);
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
  // Only stories that existed when the early «/content/…» builds were live can have been indexed there
  // (fixed on 2026-10-06, INCIDENTS #284); a newer story never lived at that address, and one redirect
  // page per story is a file each against Cloudflare Pages' 20,000-file limit.
  const EARLY_BUILDS_END = "20261007";
  const stamp = (f) => { const m = f.match(/^(\d{4})-?(\d{2})-?(\d{2})/); return m ? m[1] + m[2] + m[3] : ""; };
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
      const early = stamp(f) < EARLY_BUILDS_END;
      let data;
      try { ({ data } = matter(fs.readFileSync(path.join(contentRoot, section, f), "utf-8"))); } catch { continue; }
      const to = dec(urlOf(f, data));
      if (!fs.existsSync(path.join(siteDir, to, "index.html"))) continue; // only to a page that really exists
      if (early) out.push([dec(`/content/${section}/${f.replace(/\.md$/, "")}/`), to]);
      // an annual show's page drops the year its file name carries («revpro-14-year-anniversary-show-2026»
      // lives at «/shows/revpro-14-year-anniversary-show/»), and Google still sends readers there (INCIDENTS #325)
      const fileSlug = dec(`/${section}/${f.replace(/\.md$/, "").replace(/^\d{14}-/, "").replace(/^\d{4}-\d{2}-\d{2}-/, "")}/`);
      // A show whose title was edited after it went live moved to a new address (AEW Dynamite 06.10.2026 → «…Grand Slam France…»):
      // its first address came from the file name and Google still sends readers there, so this holds for every date (INCIDENTS #850).
      // Never over a page that really exists at that address.
      if (section === "shows" && fileSlug !== to && !fs.existsSync(path.join(siteDir, fileSlug, "index.html"))) out.push([fileSlug, to]);
      // …and its English copy: the mirror had «/en/shows/roh-01-10-2026/» too, which answered 404 (INCIDENTS #961)
      if (section === "shows" && fileSlug !== to && fs.existsSync(path.join(siteDir, "en", to, "index.html")) && !fs.existsSync(path.join(siteDir, "en", fileSlug, "index.html"))) out.push([`/en${fileSlug}`, `/en${to}`]);
    }
  }
  return out;
}

module.exports = { orphanEnglishRedirects, toPagesRedirects, renamedArticleRedirects, vanishedLibraryRedirects, vanishedShowRedirects, writeRedirectPages, legacyArticleAddresses, contentFolderAddresses };
