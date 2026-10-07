// The English site (owner's request, 2026-10-07): every page of the interface also exists under /en/, fully in
// English, same look. The Arabic build stays exactly as it is; this runs after it and writes an English copy of each
// page from the finished Arabic HTML:
//   - the interface's words come from lib/i18n/en.cjs (exact strings, then patterns: dates, page numbers, counts),
//   - a show's / recap's / section's own words from its data (headline → its English title, see contentMap),
//   - the news stay Arabic, as the owner asked: a news headline left in Arabic is marked lang="ar" dir="rtl",
//   - links to a page that has an English copy point to it; the others (a news story, a tag) stay Arabic,
//   - <html lang="en" dir="ltr">, English fonts and /assets/en.css (the left-to-right fixes),
//   - the page scripts get English copies under /en/assets/.
// Every Arabic word left on an English page outside the news is counted and listed (`report`): the goal is zero.
// Both versions get a language button in the header and hreflang links; choosing English is remembered (cookie
// «arw-lang») and an Arabic page then opens in English.
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { parseDocument } = require("htmlparser2");
const render = require("dom-serializer").default;
const DU = require("domutils");
const { Text, Element } = require("domhandler");
const rtlcss = require("rtlcss");

// ── left to right ───────────────────────────────────────────────────────────
// The pages' CSS is written for right to left (margin-left, text-align:right, «to left» fades, translateX…): the
// English pages get it mirrored by rtlcss, the standard tool for this. Same blocks repeat on hundreds of pages: kept.
const flipped = new Map();
function ltrCss(css) {
  if (!flipped.has(css)) {
    let out = css;
    try { out = rtlcss.process(css); } catch (e) {}
    // rtlcss leaves a fading mask alone: «mask-image: linear-gradient(to left, …)» fades the start of a row
    out = out.replace(/((?:-webkit-)?mask(?:-image)?\s*:[^;}]*?)\bto (left|right)\b/g, (w, a, d) => a + "to " + (d === "left" ? "right" : "left"));
    flipped.set(css, out);
  }
  return flipped.get(css);
}
function ltrStyle(style) {
  if (!/(left|right|rtl|ltr|translate|rotate|scale|radius|shadow|gradient|position)/i.test(style)) return style;
  const out = ltrCss("a{" + style + "}");
  const m = /^a\{([\s\S]*)\}$/.exec(out.trim());
  return m ? m[1] : style;
}
// an arrow or a chevron icon points the other way (next is → left to right): its shape, as the site draws it
const ARROW = /(m12 5 7 7-7 7|12 19 5 12 12 5|M19 12H5M12 19l-7-7 7-7|M15 18l-6-6 6-6|9 18 15 12 9 6|15 18 9 12 15 6|M9 18l6-6-6-6|M5 12h14M13 6l6 6-6 6|M5 12h14|M19 12H5)/;

const AR = /[؀-ۿ]/;
const ORIGIN = "https://arab-wrestling.com";

/** Which Arabic pages get an English copy: the interface, not the news stories, tags or the panel. */
function inScope(url) {
  if (url === "/" || url === "/404.html") return true;
  if (/^\/news\/(\d+\/)?$/.test(url)) return true; // the news list (its stories stay Arabic, as the owner asked)
  return /^\/(shows|recaps|nostalgia|library|federation|federations|search|about|contact|privacy|terms|dmca|support|apps)\//.test(url);
}
const enUrl = (url) => (url === "/404.html" ? "/en/404.html" : "/en" + url);

// ── words ───────────────────────────────────────────────────────────────────
function makeTranslator(dict, content) {
  const exact = new Map();
  for (const [ar, en] of Object.entries(content || {})) exact.set(norm(ar), en);
  for (const [ar, en] of Object.entries(dict.ui)) exact.set(norm(ar), en); // the interface wins over content
  const patterns = dict.patterns;
  function tr(s) {
    const out = tr1(s);
    return out === "" && norm(s) !== "" ? norm(s) : out; // a translation never makes words disappear
  }
  function tr1(s) {
    const core = norm(s);
    if (!core || !AR.test(core)) return core;
    const hit = exact.get(core);
    if (hit != null) return hit;
    const apply = (re, rep, text) => { re.lastIndex = 0; if (!re.test(text)) return null; re.lastIndex = 0; return text.replace(re, (...m) => (typeof rep === "function" ? rep(m, tr) : rep)); };
    // 1) each pattern on the whole text: the first that leaves no Arabic wins (a near miss never feeds the next one)
    if (depth > 6) return core;
    depth++;
    try {
      for (const [re, rep] of patterns) {
        const r = apply(re, rep, core);
        if (r != null && !AR.test(r)) return r;
      }
      // 2) else the patterns one after another (a date inside a sentence, then the rest)
      let out = core;
      for (const [re, rep] of patterns) {
        const r = apply(re, rep, out);
        if (r != null) out = r;
        if (!AR.test(out)) break;
        const again = exact.get(norm(out)); if (again != null) return again;
      }
      return out;
    } finally { depth--; }
  }
  let depth = 0;
  return tr;
}
function norm(s) { return String(s).replace(/\s+/g, " ").trim(); }

/** A text keeping its surrounding spaces: «  الرئيسية\n» → «  Home\n». */
function trKeepSpace(raw, tr) {
  const m = /^(\s*)([\s\S]*?)(\s*)$/.exec(raw);
  const en = tr(m[2]);
  return m[1] + en + m[3];
}

// Attributes that are words, not addresses
const WORD_ATTRS = new Set(["alt", "title", "aria-label", "placeholder", "label", "data-title", "data-kindlabel", "data-srv-name", "data-name", "data-label", "data-text", "data-share-title", "data-tooltip", "data-empty", "value", "content"]);
const META_WORDS = /^(description|keywords|twitter:title|twitter:description|twitter:image:alt|og:title|og:description|og:site_name|og:image:alt|apple-mobile-web-app-title|application-name|author)$/;

// ── scripts ─────────────────────────────────────────────────────────────────
// Every quoted Arabic string in a script: '…', "…", `…` (with ${…} kept as it is)
// ('…' and "…" stay on one line, so a stray apostrophe in a comment can't swallow the code after it)
const JS_STR = /(["'])((?:\\.|(?!\1)[^\\\n])*?[؀-ۿ](?:\\.|(?!\1)[^\\\n])*)\1|(`)((?:\\.|[^\\`])*?[؀-ۿ](?:\\.|[^\\`])*)`/g;
function trJs(code, tr, onLeft) {
  code = code.replace(/(["'`])\/search-index\.json\1/g, "$1/en/search-index.json$1"); // the English search finds English names
  code = code.replace(/(toLocale(?:Date|Time)?String\(\s*)(["'])ar(?:-[A-Z]{2})?\2/g, "$1$2en-US$2"); // dates in English
  return code.replace(JS_STR, (whole, q1, b1, q2, b2) => {
    const q = q1 || q2, body = q1 ? b1 : b2;
    // a letter or a digit list a script works with (search normalising «ا», «٠١٢٣…»): not words, stays
    if (/^[\u0600-\u06FF]{1,2}$/.test(body) || /^[٠-٩۰-۹]+$/.test(body)) return whole;
    let en = trPiece(body, tr);
    // markup built in a script («<span>جاري البحث...</span>», «مكتبة العروض</a>»): the words between the tags and in
    // their title / aria-label / placeholder, one by one
    if (AR.test(en) && /[<>]/.test(body)) {
      en = body.replace(/((?:title|aria-label|placeholder|alt)=\\?")([^"\\]*[\u0600-\u06FF][^"\\]*)(\\?")/g, (w, a, v, b) => a + trPiece(v, tr) + b)
        .split(/(<[^>]*>)/).map((part) => (part.startsWith("<") || !AR.test(part) ? part : trPiece(part, tr))).join("");
    }
    if (AR.test(en)) { onLeft && onLeft(body); return whole; }
    return q + (q === "`" ? en.replace(/`/g, "\\`") : en.replace(new RegExp("\\\\?" + q, "g"), "\\" + q)) + q;
  });
}
/** A piece of a script's text, keeping what surrounds the words: « من » → « of », «">عرض جميع النتائج (» → «">See all results (». */
function trPiece(s, tr) {
  const m = /^([^\u0600-\u06FF]*?)([\u0600-\u06FF][\s\S]*[\u0600-\u06FF«»؟]|[\u0600-\u06FF])([^\u0600-\u06FF]*)$/.exec(s);
  if (!m) return s;
  const pad = (x, en) => x.match(/^\s*/)[0] + en + x.match(/\s*$/)[0];
  // the whole piece, then without the markup before it, then without what follows, then the bare words
  for (const [pre, mid, post] of [["", s, ""], [m[1], m[2] + m[3], ""], ["", m[1] + m[2], m[3]], [m[1], m[2], m[3]]]) {
    const en = tr(mid);
    if (en && !AR.test(en)) return pre + pad(mid, en) + post;
  }
  return s;
}

// ── one page ────────────────────────────────────────────────────────────────
function isNewsStory(href) {
  try { href = decodeURIComponent(href); } catch {}
  return /^\/(news|tag)\/(?!\d+\/$)[^/]+\/?/.test(href) && !/^\/news\/(\d+\/)?$/.test(href);
}

function translatePage(html, ctx) {
  const { url, tr, english, report, scriptFor } = ctx;
  // The page's own English title and description (a show, a library section: lib/i18n/content.cjs buildPageMap),
  // else its translated <h1>: what a <title>, a meta description or a structured-data name falls back to when the
  // Arabic one has no English (a show's description is cut at 160 letters, so no lookup can find it)
  const own = (ctx.pages && ctx.pages[url]) || null;
  const doc = parseDocument(html, { decodeEntities: true, recognizeSelfClosing: false });
  stripI18n(doc);
  if (ctx.before) ctx.before(doc); // the English news put in first, so the Arabic headlines they replace are never reported
  let fbTitle = own && own.title;
  if (!fbTitle) {
    const h1 = DU.findOne((e) => e.name === "h1", doc.children, true);
    const t = h1 ? tr(DU.textContent(h1)) : "";
    if (t && !AR.test(t)) fbTitle = t;
  }
  const fbDesc = (own && own.description) || (fbTitle ? `${fbTitle}. Full wrestling shows, highlights and the latest news on Arab Wrestling.` : null);
  const DESC_KEYS = /^(description|og:description|twitter:description)$/, TITLE_KEYS = /^(og:title|twitter:title|og:image:alt|twitter:image:alt)$/;
  const htmlEl = DU.findOne((e) => e.name === "html", doc.children, true);
  if (htmlEl) { htmlEl.attribs.lang = "en"; htmlEl.attribs.dir = "ltr"; }
  const left = [];
  const said = []; // every translated text: where, its Arabic, its English (the repeat check below)
  const keepArabic = (el) => {
    // a news story's own words stay Arabic, set right-to-left in the English page
    for (let p = el; p && p.type !== "root"; p = p.parent) {
      if (p.attribs && (p.attribs["data-ar"] != null || p.attribs.lang === "ar")) return true;
      if (p.name === "a" && p.attribs && p.attribs.href && isNewsStory(p.attribs.href)) return true;
      if (p.attribs && /\b(news-card|news-item|story-card|nw-card|post-card-news)\b/.test(p.attribs.class || "")) return true;
    }
    return false;
  };
  const markArabic = (el) => { if (el && el.attribs && el.attribs.lang !== "ar") { el.attribs.lang = "ar"; el.attribs.dir = "rtl"; } };

  // A sentence split by a name in its own tag: «شاهد عروض <bdi>WWE</bdi> مترجمة» is looked up whole as
  // «شاهد عروض {0} مترجمة» → «Watch {0} shows», and the tags go back in their English places.
  const INLINE = /^(bdi|b|strong|em|i|span|a|bdo|small|mark|time)$/;
  const phrase = (el) => {
    const kids = el.children || [];
    if (kids.length < 2 || !kids.some((k) => k.type === "text" && AR.test(k.data))) return false;
    if (!kids.every((k) => k.type === "text" || (k.type === "tag" && INLINE.test(k.name)))) return false;
    // an icon before or after the words (no text of its own) stays where it is, outside the sentence
    let a = 0, b = kids.length;
    while (a < b && kids[a].type === "tag" && !DU.textContent(kids[a]).trim()) a++;
    while (b > a && kids[b - 1].type === "tag" && !DU.textContent(kids[b - 1]).trim()) b--;
    const before = kids.slice(0, a), after = kids.slice(b), mid = kids.slice(a, b);
    if (!mid.some((k) => k.type === "tag")) return false;
    const tags = [];
    const key = mid.map((k) => (k.type === "text" ? k.data : `{${tags.push(k) - 1}}`)).join("");
    const en = tr(key);
    if (AR.test(en) || !/\{\d\}/.test(en) || en === norm(key)) {
      // a sentence around a name with no English order of its own: its pieces get translated one by one, which can
      // read «Shows WWE Full show». Listed so it gets its line in lib/i18n/en.cjs («[order] عروض {0} مترجمة»)
      // (a name put into a sentence is a <bdi> on this site, or has words on both sides; a badge after a title is fine)
      const between = mid.some((k, i) => k.type === "tag" && mid.slice(0, i).some((x) => x.type === "text" && AR.test(x.data)) && mid.slice(i + 1).some((x) => x.type === "text" && AR.test(x.data)));
      if (between || mid.some((k) => k.type === "tag" && k.name === "bdi")) left.push(`[order] ${norm(key)}`);
      return false;
    }
    const lead = /^\s*/.exec(mid[0].type === "text" ? mid[0].data : "")[0], trail = /\s*$/.exec(mid[mid.length - 1].type === "text" ? mid[mid.length - 1].data : "")[0];
    const parts = (lead + en + trail).split(/(\{\d\})/);
    const words = [];
    for (const part of parts) {
      const m = /^\{(\d)\}$/.exec(part);
      if (m) { if (tags[m[1]]) words.push(tags[m[1]]); }
      else if (part) words.push(new Text(part));
    }
    // in a flex row (a heading with an icon, a button) every loose piece becomes its own item and the gap splits the
    // sentence («What Is  WWE  ?»): there it goes into one <span>
    let sentence = words;
    if (before.length || after.length || /\b(btn|button|cta|chip|pill)\b|-btn\b/.test((el.attribs && el.attribs.class) || "")) {
      const span = new Element("span", { class: "i18n-s" }, words);
      for (const w of words) w.parent = span;
      for (let i = 0; i < words.length; i++) { words[i].prev = words[i - 1] || null; words[i].next = words[i + 1] || null; }
      sentence = [span];
    }
    const out = [...before, ...sentence, ...after];
    for (const k of out) k.parent = el;
    el.children = out;
    for (let i = 0; i < out.length; i++) { out[i].prev = out[i - 1] || null; out[i].next = out[i + 1] || null; }
    return true;
  };

  const walk = (node) => {
    if (node.type === "tag") phrase(node);
    for (const n of node.children || []) {
      if (n.type === "text") {
        // a path separator or a lone arrow points the other way left to right
        if (/^\s*[‹›←→]\s*$/.test(n.data)) { n.data = n.data.replace(/[‹›←→]/, (c) => ({ "‹": "›", "›": "‹", "←": "→", "→": "←" })[c]); continue; }
        if (node.name === "title" && (own || (AR.test(n.data) && AR.test(tr(n.data)) && fbTitle))) { n.data = `${(own && own.title) || fbTitle} | Arab Wrestling`; continue; }
        if (!AR.test(n.data)) { if (/[A-Za-z]{2}/.test(n.data)) said.push({ el: n.parent, ar: norm(n.data), en: norm(n.data).toLowerCase() }); continue; }
        const before = n.data;
        // the menus have little room: their own shorter words first (lib/i18n/en.cjs nav)
        const inNav = /\b(navlink|drop-item|bn-label|bottom-nav|arw-bn)\b/.test(((n.parent && n.parent.attribs && n.parent.attribs.class) || "") + " " + ((n.parent && n.parent.parent && n.parent.parent.attribs && n.parent.parent.attribs.class) || ""));
        const navWord = inNav && ctx.nav && ctx.nav[norm(n.data)];
        const out = navWord ? n.data.replace(/\S[\s\S]*\S|\S/, navWord) : trKeepSpace(n.data, tr);
        if (AR.test(out)) {
          if (keepArabic(n.parent)) markArabic(n.parent);
          else left.push(norm(n.data));
          continue;
        }
        n.data = out;
        said.push({ el: n.parent, ar: norm(before), en: norm(out).toLowerCase() });
      } else if (n.type === "script") {
        const a = n.attribs || {};
        const text = DU.textContent(n);
        if (a.src) {
          const src = scriptFor && scriptFor(a.src);
          if (src) a.src = src;
        }
        if (!text || !AR.test(text)) continue;
        if (/ld\+json/.test(a.type || "")) {
          try {
            const data = JSON.parse(text);
            const fix = (v, k) => {
              if (typeof v === "string") {
                if (/^(url|@id|item|mainEntityOfPage|target)$/.test(k || "") || /^https?:\/\/|^\//.test(v)) return linkFor(v, english) || v;
                if (k === "inLanguage") return "en";
                if (k === "keywords") return v.split(/\s*[,،]\s*/).map((x) => tr(x)).filter((x) => x && !AR.test(x)).join(", ");
                if (!AR.test(v)) return v;
                const en = tr(v);
                if (!AR.test(en)) return en;
                if (/description|text|abstract/i.test(k || "") && fbDesc) return fbDesc;
                if (/^(name|headline|alternativeHeadline|caption|alternateName)$/.test(k || "") && fbTitle) return fbTitle;
                left.push("[ld] " + v); return en;
              }
              // Arabic spellings kept for Arabic searches (alternateName, keywords) have no English: left out
              if (Array.isArray(v)) return v.map((x) => (typeof x === "string" && AR.test(x) && AR.test(tr(x)) ? undefined : fix(x, k))).filter((x) => x !== undefined);
              if (v && typeof v === "object") { const o = {}; for (const [kk, vv] of Object.entries(v)) o[kk] = fix(vv, kk); return o; }
              return v;
            };
            n.children[0].data = JSON.stringify(fix(data));
          } catch { left.push("[ld:unparsed]"); }
        } else {
          n.children[0].data = trJs(text, tr, (s) => left.push("[js] " + s));
        }
      } else if (n.type === "style") {
        if (n.children[0] && !/\bdata-no-flip\b/.test(JSON.stringify(n.attribs || {}))) n.children[0].data = ltrCss(n.children[0].data);
        // words in CSS (content:"…")
        const text = DU.textContent(n);
        if (AR.test(text)) n.children[0].data = text.replace(/(content\s*:\s*)(["'])([^"'\n]*[؀-ۿ][^"'\n]*)\2/g, (w, pre, q, body) => {
          const en = tr(body); if (AR.test(en)) { left.push("[css] " + body); return w; } return pre + q + en + q;
        });
      } else if (n.type === "tag") {
        const a = n.attribs;
        for (const k of Object.keys(a)) {
          const v = a[k];
          if (k === "href" || k === "action") { const l = linkFor(v, english); if (l) a[k] = l; continue; }
          if (k === "src" && /^\/assets\/brand-logo\.png/.test(v)) { a[k] = "/assets/brand-logo-en.png?v=1"; continue; } // the logo with Latin letters
          if (!AR.test(v)) continue;
          if (/^on[a-z]+$/.test(k)) { a[k] = trJs(v, tr, (s) => left.push("[js] " + s)); continue; }
          // a list filter's search words («aew dynamite عرض ديناميت»): the English words are enough
          if (k === "data-name") { a[k] = norm(v.replace(/[\u0600-\u06FF]+/g, " ")); continue; }
          if (k === "content" && !(META_WORDS.test(a.name || "") || META_WORDS.test(a.property || ""))) continue;
          if (k === "content" && a.name === "keywords") { a[k] = v.split(/\s*[,،]\s*/).map((x) => tr(x)).filter((x) => x && !AR.test(x)).join(", "); continue; }
          if (k === "content" && own && DESC_KEYS.test(a.name || a.property || "")) { a[k] = own.description; continue; }
          if (k === "content" && own && TITLE_KEYS.test(a.name || a.property || "")) { a[k] = own.title; continue; }
          if (!WORD_ATTRS.has(k) && !/^data-/.test(k)) continue;
          if (/^(src|data-src|data-url|data-href|data-image)$/.test(k)) continue;
          const en = tr(v);
          if (AR.test(en) && k === "content" && DESC_KEYS.test(a.name || a.property || "") && fbDesc) { a[k] = fbDesc; continue; }
          if (AR.test(en) && k === "content" && TITLE_KEYS.test(a.name || a.property || "") && fbTitle) { a[k] = fbTitle; continue; }
          if (AR.test(en)) { if (keepArabic(n)) continue; left.push(`[${k}] ` + norm(v)); continue; }
          a[k] = en;
        }
        if (a.style) a.style = ltrStyle(a.style);
        if (n.name === "svg" && DU.findOne((x) => x.attribs && ARROW.test((x.attribs.d || "") + " " + (x.attribs.points || "")), n.children, true)) a.class = ((a.class || "") + " i18n-flip").trim();
        if (n.name === "link" && /stylesheet/.test(a.rel || "") && a.href && ctx.cssFor) { const h = ctx.cssFor(a.href); if (h) a.href = h; }
        if (n.name === "meta" && a.property === "og:locale") a.content = "en_US";
        if (n.name === "meta" && a.property === "og:url" && a.content) a.content = linkFor(a.content, english) || a.content;
        if (n.name === "link" && a.rel === "canonical" && a.href) a.href = linkFor(a.href, english) || a.href;
        walk(n);
      }
    }
  };
  // Tags: the Arabic ones have no English and leave; an English one searches the English site (tag pages are Arabic)
  for (const pill of DU.findAll((e) => /\btag-pill\b/.test((e.attribs && e.attribs.class) || ""), doc.children)) {
    const text = DU.textContent(pill).replace(/^#/, "").trim();
    if (AR.test(text)) { DU.removeElement(pill); continue; }
    if (pill.name === "a") pill.attribs.href = "/en/search/?q=" + encodeURIComponent(text);
  }
  for (const box of DU.findAll((e) => /\bpost-tags\b/.test((e.attribs && e.attribs.class) || ""), doc.children)) {
    if (!DU.findOne((e) => /\btag-pill\b/.test((e.attribs && e.attribs.class) || ""), box.children, true)) DU.removeElement(box);
  }
  walk(doc);
  // The Arabic page shows a name twice (Arabic, then English under it); in English both say the same: the second goes
  if (!process.env.I18N_KEEP_REPEATS) for (const el of DU.findAll((e) => /\b(post-ep-name|spotlight-subtitle|wh-en|fg-en|hero-sub-en)\b/.test((e.attribs && e.attribs.class) || ""), doc.children)) {
    const mine = norm(DU.textContent(el)).toLowerCase();
    const sibs = (el.parent && el.parent.children || []).filter((x) => x !== el && x.type === "tag");
    const near = sibs.concat(el.parent && el.parent.parent ? el.parent.parent.children.filter((x) => x.type === "tag") : []);
    if (mine && near.some((x) => !DU.findOne((y) => y === el, [x], true) && norm(DU.textContent(x)).toLowerCase() === mine)) DU.removeElement(el);
  }
  // A path whose last two steps now read the same («AJPW › AJPW»: the promotion, then its section's Arabic name)
  for (const nav of DU.findAll((e) => /crumbs\b/.test((e.attribs && e.attribs.class) || ""), doc.children)) {
    const links = (nav.children || []).filter((k) => k.type === "tag" && !/^[\s‹›>/|·]*$/.test(DU.textContent(k)));
    for (let i = 1; i < links.length; i++) {
      if (norm(DU.textContent(links[i])).toLowerCase() !== norm(DU.textContent(links[i - 1])).toLowerCase()) continue;
      // the plain one goes (the page itself), so the link to the promotion stays; with the separator between them
      const [keep, drop] = links[i].name !== "a" ? [links[i - 1], links[i]] : [links[i], links[i - 1]];
      let sep = keep === links[i - 1] ? keep.next : drop.next;
      while (sep && sep !== links[i]) { const nx = sep.next; DU.removeElement(sep); sep = nx; }
      DU.removeElement(drop);
    }
  }
  // Two different Arabic texts that became the same English side by side (an Arabic name and an English one that
  // are now one name): listed like an untranslated word, so a build shows it («[repeat] …»)
  const attached = (e) => { for (let p = e; p; p = p.parent) { if (p.type === "root") return true; if (p.parent && !p.parent.children.includes(p)) return false; } return false; };
  const groups = new Map();
  for (const x of said) if (x.en.length >= 3 && attached(x.el)) { if (!groups.has(x.en)) groups.set(x.en, []); groups.get(x.en).push(x); }
  for (const [en, xs] of groups) {
    if (xs.length < 2) continue;
    for (let i = 0; i < xs.length; i++) for (let j = i + 1; j < xs.length; j++) {
      if (xs[i].ar.toLowerCase() === xs[j].ar.toLowerCase() || xs[i].el === xs[j].el) continue;
      const cardOf = (e) => { for (let q = e; q; q = q.parent) if (q.attribs && /-card\b/.test(q.attribs.class || "")) return q; return null; };
      if (cardOf(xs[i].el) && cardOf(xs[j].el) && cardOf(xs[i].el) !== cardOf(xs[j].el)) continue; // two shows' cards, each with its own name
      const anc = new Set(); for (let q = xs[i].el; q; q = q.parent) anc.add(q);
      let lca = xs[j].el; while (lca && !anc.has(lca)) lca = lca.parent;
      if (!lca || lca.type !== "tag" || /^(head|html|body)$/.test(lca.name)) continue;
      if (DU.findAll(() => true, lca.children).length > 40) continue;
      left.push(`[repeat] ${en}`);
    }
  }
  if (report) report(url, left);
  return doc;
}

/** «/shows/x/» (or the full address) → «/en/shows/x/» when that page has an English copy. */
function linkFor(href, english) {
  if (!href || typeof href !== "string") return null;
  let h = href;
  let abs = false;
  if (h.startsWith(ORIGIN)) { h = h.slice(ORIGIN.length) || "/"; abs = true; }
  if (!h.startsWith("/") || h.startsWith("//") || (h.startsWith("/en/") && !(english instanceof Map && english.has(h)))) return null;
  const m = /^([^?#]*)([\s\S]*)$/.exec(h);
  let p = m[1];
  let dec = p; try { dec = decodeURI(p); } catch {}
  const key = english.has(dec) ? dec : english.has(dec + "/") ? dec + "/" : null;
  if (!key) return null;
  // (a Map: the English address of each page that has one, an English story's own among them; a Set: «/en» + the address)
  return (abs ? ORIGIN : "") + (english instanceof Map ? english.get(key) : enUrl(key)) + m[2];
}

// ── the language button and hreflang (both versions) ─────────────────────────
// (a globe icon, kept for a wider button)
const GLOBE = '<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="10"/><path d="M2 12h20"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/></svg>';
function langButton(toEnglish, href) {
  // the header's round buttons (.theme-toggle): «EN» on the Arabic site, «ع» on the English one
  const set = toEnglish ? "en" : "ar";
  const label = toEnglish ? "English" : "العربية";
  const style = toEnglish
    ? "font:800 12.5px/1 'Inter',system-ui,-apple-system,'Segoe UI',Roboto,Arial,sans-serif;letter-spacing:.04em;text-decoration:none"
    : "font:800 17px/1 'Cairo',system-ui,sans-serif;text-decoration:none;padding-bottom:3px";
  return `<a data-i18n class="theme-toggle lang-switch" href="${href}" hreflang="${set}" lang="${set}" title="${label}" aria-label="${label}" style="${style}" onclick="try{document.cookie='arw-lang=${set};path=/;max-age=31536000;samesite=lax'}catch(e){}">${toEnglish ? "EN" : "ع"}</a>`;
}
function insertLangButton(doc, button) {
  const theme = DU.findOne((e) => e.attribs && e.attribs.id === "arwThemeToggle", doc.children, true);
  const frag = parseDocument(button).children[0];
  if (theme) { DU.prepend(theme, frag); return true; }
  const nav = DU.findOne((e) => e.name === "nav", doc.children, true);
  if (nav) { DU.appendChild(nav, frag); return true; }
  return false;
}
function headAppend(doc, markup, first) {
  const head = DU.findOne((e) => e.name === "head", doc.children, true);
  if (!head) return;
  const nodes = [...parseDocument(markup).children]; // a copy: moving a node takes it out of that list
  if (first) { const firstEl = head.children[0]; for (const n of nodes) firstEl ? DU.prepend(firstEl, n) : DU.appendChild(head, n); }
  else for (const n of nodes) DU.appendChild(head, n);
}
const hreflang = (arUrl, en = enUrl(arUrl)) => `<link data-i18n rel="alternate" hreflang="ar" href="${ORIGIN}${encodeURI(arUrl)}"><link data-i18n rel="alternate" hreflang="en" href="${ORIGIN}${encodeURI(en)}"><link data-i18n rel="alternate" hreflang="x-default" href="${ORIGIN}${encodeURI(arUrl)}">`;
/** The same, on the page's text (the Arabic page is never re-serialized). */
function stripI18nText(html) {
  return html.replace(/<a data-i18n[^>]*>[\s\S]*?<\/a>/g, "").replace(/<script data-i18n>[\s\S]*?<\/script>/g, "").replace(/<link data-i18n[^>]*>/g, "");
}
/** What an earlier run added (a rebuild that kept the files, a second run): taken out before adding again. */
function stripI18n(doc) { for (const e of DU.findAll((x) => x.attribs && x.attribs["data-i18n"] != null, doc.children)) DU.removeElement(e); }

// ── the whole site ──────────────────────────────────────────────────────────
function walkHtml(dir, base = dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) { if (p === path.join(base, "en")) continue; walkHtml(p, base, out); }
    else if (e.name.endsWith(".html")) out.push(p);
  }
  return out;
}
const urlOf = (site, file) => {
  const rel = "/" + path.relative(site, file).split(path.sep).join("/");
  return rel.endsWith("/index.html") ? rel.slice(0, -"index.html".length) : rel;
};

// ── English news (INCIDENTS #354) ───────────────────────────────────────────
const NEWS_PER_PAGE = 20; // like the Arabic list (pages/news.njk)
const enDate = (iso) => { const d = new Date(iso); return isNaN(d) ? "" : d.toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric", timeZone: "Asia/Riyadh" }); };
const isStoryHref = (h) => { let d = String(h || ""); try { d = decodeURI(d); } catch {} return /^\/(?:en\/)?news\/(?!\d+\/?$)[^/?#]+\/?$/.test(d); };
const cls = (e) => (e && e.attribs && e.attribs.class) || "";
function unmarkArabic(el) { for (const e of [el, ...DU.findAll(() => true, el.children || [])]) if (e.attribs && e.attribs.lang === "ar") { delete e.attribs.lang; delete e.attribs.dir; } }
function setText(el, text) { const t = new Text(text); t.parent = el; el.children = [t]; }
/** A news card («news-card» on the lists and the home page, «related-card» under a page) shows an English story. */
function fillCard(card, x) {
  card.attribs.href = x.en;
  unmarkArabic(card);
  const title = DU.findOne((e) => /^h[2-5]$/.test(e.name) || /\b(related-card-title|card-title)\b/.test(cls(e)), card.children, true);
  if (title) setText(title, x.title);
  for (const img of DU.findAll((e) => e.name === "img", card.children)) { img.attribs.src = x.image; img.attribs.alt = x.title; delete img.attribs.srcset; }
  for (const e of DU.findAll((e) => /background-image/.test((e.attribs && e.attribs.style) || ""), card.children)) e.attribs.style = e.attribs.style.replace(/url\((['"]?)[^)'"]*\1\)/, `url('${x.image}')`);
  const fed = x.federation || "";
  for (const b of DU.findAll((e) => /(^|\s)(cat|related-card-fed)(\s|$)/.test(cls(e)), card.children)) {
    setText(b, fed);
    b.attribs.class = cls(b).replace(/\b(cat|fed)-[a-z0-9]+\b/g, (m, k) => `${k}-${fed.toLowerCase()}`);
  }
  for (const d of DU.findAll((e) => /(^|\s)(date|related-card-date)(\s|$)/.test(cls(e)), card.children)) {
    const texts = (d.children || []).filter((k) => k.type === "text" && k.data.trim());
    if (texts.length) { texts[texts.length - 1].data = " " + enDate(x.date) + " "; for (const t of texts.slice(0, -1)) t.data = " "; }
    else setText(d, enDate(x.date));
  }
}
/** The English pages' news cards show English stories:
 *  - a news-only list (the home page's latest news) and the «related» cards: the newest English stories, the page's
 *    own left out, its promotion's first when every card was one promotion's;
 *  - a list mixing news with shows (a promotion's page, the all-promotions pages, by date): each Arabic story is
 *    swapped for its own English edition, and one with none (an older story) is taken out, so no page repeats the
 *    newest stories and the order by date holds.
 *    (`byDate`: a page that is such a list, though its first page may happen to be all news)
 *  With no English story yet, the Arabic cards stay. */
function refillNews(doc, news, self, byDate = false) {
  if (!news.length) return;
  const dec = (h) => { try { return decodeURI(h); } catch { return h; } };
  const twin = new Map(news.map((x) => [dec(x.ar), x]));
  const cards = DU.findAll((e) => e.name === "a" && /\b(news-card|related-card)\b/.test(cls(e)) && isStoryHref(e.attribs.href), doc.children);
  const groups = new Map();
  for (const c of cards) { if (!groups.has(c.parent)) groups.set(c.parent, []); groups.get(c.parent).push(c); }
  const fedOf = (c) => { const b = DU.findOne((e) => /(^|\s)(cat|related-card-fed)(\s|$)/.test(cls(e)), c.children, true); return b ? DU.textContent(b).trim().toLowerCase() : ""; };
  for (const [parent, list] of groups) {
    const related = /\brelated-card\b/.test(cls(list[0]));
    const mixed = !related && (byDate || (parent.children || []).some((k) => k.type === "tag" && k.name === "a" && !list.includes(k) && /-card\b/.test(cls(k))));
    if (mixed) {
      for (const c of list) { const x = twin.get(dec(c.attribs.href)); if (x && x.en !== self) fillCard(c, x); else DU.removeElement(c); }
      continue;
    }
    const feds = new Set(list.map(fedOf));
    const one = feds.size === 1 ? [...feds][0] : "";
    const pool = news.filter((x) => x.en !== self);
    if (one) pool.sort((a, b) => (String(b.federation).toLowerCase() === one) - (String(a.federation).toLowerCase() === one)); // (a stable sort: newest first within each)
    list.forEach((c, i) => (i < pool.length ? fillCard(c, pool[i]) : DU.removeElement(c)));
  }
}
/** The English list's page n: its cards are these stories, and its page numbers count the English pages. */
function fillNewsList(doc, items, n, total) {
  const cards = DU.findAll((e) => e.name === "a" && /\bnews-card\b/.test(cls(e)), doc.children);
  const grid = cards.length ? cards[0].parent : null;
  if (grid) {
    const mine = cards.filter((c) => c.parent === grid);
    mine.forEach((c, i) => (i < items.length ? fillCard(c, items[i]) : DU.removeElement(c)));
  }
  setPager(doc, n, total, (k) => (k === 1 ? "/en/news/" : `/en/news/${k}/`));
}
/** A list's page numbers, «previous» and «next» for page n of total (href(k): page k's address) */
function setPager(doc, n, total, href) {
  const nav = DU.findOne((e) => e.name === "nav" && /\bpagination-nav\b/.test(cls(e)), doc.children, true);
  if (!nav) return;
  if (total <= 1) { DU.removeElement(nav); return; }
  const prev = DU.findOne((e) => /\bprev\b/.test(cls(e)), nav.children, true), next = DU.findOne((e) => /\bnext\b/.test(cls(e)), nav.children, true);
  // «previous» and «next» are links, or greyed out at either end (like the Arabic list)
  const end = (el, off, to) => {
    if (!el) return;
    const keep = Object.fromEntries(Object.entries(el.attribs).filter(([k]) => !/^(href|aria-disabled|aria-label)$/.test(k)));
    keep.class = cls(el).replace(/\s*\bdisabled\b/g, "");
    if (off) { el.name = "span"; el.attribs = Object.assign(keep, { class: keep.class + " disabled", "aria-disabled": "true" }); }
    else { el.name = "a"; el.attribs = Object.assign({ href: to }, keep, { "aria-label": el === prev ? "Previous page" : "Next page" }); }
  };
  end(prev, n === 1, href(n - 1));
  end(next, n === total, href(n + 1));
  const nums = DU.findOne((e) => /\bpage-numbers\b/.test(cls(e)), nav.children, true);
  if (nums) {
    const show = new Set([1, total, n - 1, n, n + 1].filter((k) => k >= 1 && k <= total));
    let html = "", last = 0;
    for (let k = 1; k <= total; k++) {
      if (!show.has(k) && total > 7) continue;
      if (last && k - last > 1) html += '<span class="page-ellipsis" aria-hidden="true">…</span>';
      html += k === n ? `<span class="page-link active" aria-current="page">${k}</span>` : `<a href="${href(k)}" class="page-link">${k}</a>`;
      last = k;
    }
    const kids = [...parseDocument(html).children];
    for (const k of kids) k.parent = nums;
    nums.children = kids;
    kids.forEach((k, i) => { k.prev = kids[i - 1] || null; k.next = kids[i + 1] || null; });
  }
}

function buildEnglish(site, opts = {}) {
  const t0 = Date.now();
  const dict = opts.dict || require("./en.cjs");
  const tr = makeTranslator(dict, opts.content || {});
  const files = walkHtml(site);
  const pages = files.map((f) => ({ file: f, url: urlOf(site, f) }));
  // Every page with an English copy: its Arabic address → its English one
  const english = new Map(pages.filter((p) => inScope(p.url)).map((p) => [p.url, enUrl(p.url)]));
  // English news (INCIDENTS #354): the stories rendered at /en-src/news/<slug>/, each with its Arabic story. Once there is
  // one, /en/news/ lists them instead of the Arabic headlines, and an Arabic story with an English one points to it.
  const rendered = new Set(pages.map((p) => p.url));
  const news = (opts.news || []).filter((x) => x && x.src && x.en && x.ar && rendered.has(x.src));
  const listPages = Math.ceil(news.length / NEWS_PER_PAGE);
  if (news.length) {
    for (const u of [...english.keys()]) if (/^\/news\/(\d+\/)?$/.test(u)) english.delete(u);
    for (let n = 1; n <= listPages; n++) english.set(n === 1 ? "/news/" : `/news/${n}/`, n === 1 ? "/en/news/" : `/en/news/${n}/`);
    for (const x of news) { english.set(x.ar, x.en); english.set(x.src, x.en); }
  }
  // Lists by date (a promotion's page, all promotions; refillNews): an older story there has no English edition and is
  // taken out, so their English pages are the Arabic pages' cards put back together, PER_PAGE a page, and an Arabic
  // page past the English ones points to the English list's first page
  const FEED = /^\/(federations|federation\/[^/]+)\/(?:(\d+)\/)?$/;
  const feeds = new Map(); // base → { total, perPage, docs: [] }
  const loose = new Set(); // Arabic pages whose English address is the list's first page, not their own English copy
  const feedOf = (url) => { const m = news.length && FEED.exec(url); return m ? { base: `/${m[1]}/`, n: Number(m[2] || 1) } : null; };
  const isCard = (e) => e.type === "tag" && e.name === "a" && /\b(news|show)-card\b/.test(cls(e));
  const twinOf = new Set(news.map((x) => { try { return decodeURI(x.ar); } catch { return x.ar; } }));
  for (const p of pages) {
    const f = english.has(p.url) && feedOf(p.url);
    if (!f) continue;
    const doc = parseDocument(fs.readFileSync(p.file, "utf8"));
    const first = DU.findOne(isCard, doc.children, true);
    const cards = first ? first.parent.children.filter(isCard) : [];
    const kept = cards.filter((c) => !(/\bnews-card\b/.test(cls(c)) && isStoryHref(c.attribs.href)) || twinOf.has((() => { try { return decodeURI(c.attribs.href); } catch { return c.attribs.href; } })())).length;
    if (!feeds.has(f.base)) feeds.set(f.base, { kept: 0, perPage: 0, pages: 0, docs: [] });
    const feed = feeds.get(f.base);
    feed.kept += kept; feed.pages++;
    if (f.n === 1) feed.perPage = cards.length;
  }
  for (const [base, feed] of feeds) {
    if (feed.pages < 2 || !feed.perPage) feed.perPage = 20;
    feed.total = Math.max(1, Math.ceil(feed.kept / feed.perPage));
    for (let n = feed.total + 1; n <= feed.pages; n++) { english.set(`${base}${n}/`, enUrl(base)); loose.add(`${base}${n}/`); }
  }
  const leftovers = new Map(); // text → pages count
  let leftPages = 0;
  const where = new Map(); // text → the first page it was seen on
  const report = (url, left) => { if (left.length) leftPages++; for (const s of left) { leftovers.set(s, (leftovers.get(s) || 0) + 1); if (!where.has(s)) where.set(s, url); } };

  // the page scripts, once each: /assets/x.js → /en/assets/x.js?v=<hash of the English copy>
  const scripts = new Map();
  const scriptFor = (src) => {
    const m = /^\/assets\/([\w.-]+\.js)(\?[^#]*)?$/.exec(src);
    if (!m) return null;
    if (!scripts.has(m[1])) {
      const from = path.join(site, "assets", m[1]);
      if (!fs.existsSync(from)) { scripts.set(m[1], null); return null; }
      const code = fs.readFileSync(from, "utf8");
      if (!AR.test(code)) { scripts.set(m[1], null); return null; }
      const en = trJs(code, tr, (s) => leftovers.set("[js:" + m[1] + "] " + s, (leftovers.get("[js:" + m[1] + "] " + s) || 0) + 1));
      fs.mkdirSync(path.join(site, "en", "assets"), { recursive: true });
      fs.writeFileSync(path.join(site, "en", "assets", m[1]), en);
      scripts.set(m[1], `/en/assets/${m[1]}?v=${crypto.createHash("md5").update(en).digest("hex").slice(0, 10)}`);
    }
    return scripts.get(m[1]);
  };

  // the site's stylesheets, mirrored once each: /assets/x.css → /en/assets/x.css?v=<hash>
  const sheets = new Map();
  const cssFor = (href) => {
    const m = /^\/assets\/([\w.-]+\.css)(\?[^#]*)?$/.exec(href);
    if (!m || m[1] === "en.css") return null;
    if (!sheets.has(m[1])) {
      const from = path.join(site, "assets", m[1]);
      if (!fs.existsSync(from)) { sheets.set(m[1], null); return null; }
      const css = ltrCss(fs.readFileSync(from, "utf8"));
      fs.mkdirSync(path.join(site, "en", "assets"), { recursive: true });
      fs.writeFileSync(path.join(site, "en", "assets", m[1]), css);
      sheets.set(m[1], `/en/assets/${m[1]}?v=${crypto.createHash("md5").update(css).digest("hex").slice(0, 10)}`);
    }
    return sheets.get(m[1]);
  };
  const cssFile = path.join(site, "assets", "en.css");
  const cssHash = fs.existsSync(cssFile) ? crypto.createHash("md5").update(fs.readFileSync(cssFile)).digest("hex").slice(0, 10) : "0";
  const jsFile = path.join(site, "assets", "en.js");
  const jsHash = fs.existsSync(jsFile) ? crypto.createHash("md5").update(fs.readFileSync(jsFile)).digest("hex").slice(0, 10) : "0";
  const enHead = (dict.head || "").replace("__EN_CSS__", cssHash).replace("__EN_JS__", jsHash);
  let written = 0, newsListHtml = null;
  const writePage = (url, doc) => {
    const out = path.join(site, url.slice(1), url.endsWith("/") ? "index.html" : "");
    fs.mkdirSync(path.dirname(out), { recursive: true });
    // (this serializer writes every non-ASCII letter as «&#x…;»: three times the bytes for an Arabic headline; they're
    // plain UTF-8 again, while «&amp; &lt; &quot;» stay escaped)
    fs.writeFileSync(out, render(doc, { encodeEntities: "utf8", decodeEntities: true }).replace(/&#x([0-9a-fA-F]+);/g, (w, h) => (parseInt(h, 16) >= 0xa0 ? String.fromCodePoint(parseInt(h, 16)) : w)));
    written++;
  };
  for (const p of pages) {
    const html = fs.readFileSync(p.file, "utf8");
    if (!/<html[\s>]/i.test(html) || !/<header[\s>]/i.test(html)) continue; // redirect stubs, verification files
    if (p.url.startsWith("/en-src/")) continue; // an English story: below
    const hasEn = english.has(p.url);
    // the Arabic page: language button + hreflang + «you chose English» redirect. Put in as text, never re-written
    // through a parser: the Arabic page stays byte for byte what the build made, plus these (tested)
    const clean = stripI18nText(html);
    const target = hasEn ? english.get(p.url) : "/en/";
    let ar = clean.replace(/<button\b[^>]*\bid="arwThemeToggle"/, (m) => langButton(true, target) + m);
    if (hasEn) {
      ar = ar.replace(/<head\b[^>]*>/i, (m) => m + `<script data-i18n>try{if(/(?:^|; )arw-lang=en(?:;|$)/.test(document.cookie))location.replace(${JSON.stringify(encodeURI(target))}+location.search+location.hash)}catch(e){}</script>`);
      if (!loose.has(p.url)) ar = ar.replace(/<\/head>/i, (m) => hreflang(p.url, target) + m);
    }
    if (ar !== html) fs.writeFileSync(p.file, ar);
    if (p.url === "/news/" && news.length) newsListHtml = clean;
    if (!hasEn || (news.length && /^\/news\/(\d+\/)?$/.test(p.url))) continue; // the English news list: below
    if (news.length && english.get(p.url).startsWith("/en/news/")) continue; // an Arabic story with an English one
    // the English page
    const f = feedOf(p.url);
    const doc = translatePage(clean, { url: p.url, tr, english, report, scriptFor, cssFor, pages: opts.pages, nav: dict.nav, before: news.length ? (d) => {
      if (f) { const first = DU.findOne(isCard, d.children, true); d.grid = first ? first.parent : null; }
      refillNews(d, news, null, !!f);
    } : null });
    if (f) { feeds.get(f.base).docs[f.n] = { doc, arUrl: p.url }; continue; } // put back together below
    insertLangButton(doc, langButton(false, p.url));
    headAppend(doc, hreflang(p.url, english.get(p.url)) + enHead);
    writePage(english.get(p.url), doc);
  }

  // The lists by date, put back together: page n is the Arabic page n's frame with the next PER_PAGE cards
  for (const [base, feed] of feeds) {
    const all = [];
    for (const d of feed.docs) if (d && d.doc.grid) all.push(...d.doc.grid.children.filter(isCard));
    const href = (k) => (k === 1 ? enUrl(base) : `${enUrl(base)}${k}/`);
    for (let n = 1; n <= feed.total; n++) {
      const d = feed.docs[n];
      if (!d) continue;
      const { doc, arUrl } = d;
      if (doc.grid) {
        const kids = all.slice((n - 1) * feed.perPage, n * feed.perPage);
        for (const k of doc.grid.children) k.parent = null;
        kids.forEach((k, i) => { k.parent = doc.grid; k.prev = kids[i - 1] || null; k.next = kids[i + 1] || null; });
        doc.grid.children = kids;
      }
      setPager(doc, n, feed.total, href);
      for (const e of DU.findAll((e) => e.name === "link" && e.attribs.rel === "canonical", doc.children)) e.attribs.href = ORIGIN + href(n);
      for (const e of DU.findAll((e) => e.name === "meta" && e.attribs.property === "og:url", doc.children)) e.attribs.content = ORIGIN + href(n);
      insertLangButton(doc, langButton(false, arUrl));
      headAppend(doc, hreflang(arUrl, href(n)) + enHead);
      writePage(href(n), doc);
    }
  }
  // The English stories: the news layout with an English story in it, the interface made English like every page
  for (const x of news) {
    // its address everywhere (the share buttons, the canonical, the structured data) is the English one
    const html = stripI18nText(fs.readFileSync(path.join(site, x.src.slice(1), "index.html"), "utf8")).replace(/\/en-src\//g, "/en/").replace(/%2Fen-src%2F/gi, "%2Fen%2F"); // (also inside share links)
    const doc = translatePage(html, { url: x.src, tr, english, report, scriptFor, cssFor, pages: opts.pages, nav: dict.nav, before: (d) => {
      refillNews(d, news, x.en);
      // the Arabic story's video summary (a reel in Arabic) has no place in the English one
      for (const e of DU.findAll((e) => e.attribs && e.attribs.id === "arwReelShowcase", d.children)) DU.removeElement(e);
    } });
    insertLangButton(doc, langButton(false, x.ar));
    headAppend(doc, hreflang(x.ar, x.en) + enHead);
    writePage(x.en, doc);
  }
  // The English news list: the Arabic list's page with English stories in it, 20 a page
  if (news.length && newsListHtml) {
    for (let n = 1; n <= listPages; n++) {
      const arUrl = n === 1 ? "/news/" : `/news/${n}/`, enList = english.get(arUrl);
      const doc = translatePage(newsListHtml, { url: "/news/", tr, english, report, scriptFor, cssFor, pages: opts.pages, nav: dict.nav, before: (d) => fillNewsList(d, news.slice((n - 1) * NEWS_PER_PAGE, n * NEWS_PER_PAGE), n, listPages) });
      for (const e of DU.findAll((e) => e.name === "link" && e.attribs.rel === "canonical", doc.children)) e.attribs.href = ORIGIN + enList;
      for (const e of DU.findAll((e) => e.name === "meta" && e.attribs.property === "og:url", doc.children)) e.attribs.content = ORIGIN + enList;
      if (n > 1) for (const t of DU.findAll((e) => e.name === "title", doc.children)) t.children = [new Text(`Pro Wrestling News, page ${n} | Arab Wrestling`)];
      const arHas = rendered.has(arUrl);
      insertLangButton(doc, langButton(false, arHas ? arUrl : "/news/"));
      headAppend(doc, (arHas ? hreflang(arUrl, enList) : "") + enHead);
      writePage(enList, doc);
    }
  }
  // the English stories' first draft, now in /en/news/ (kept for a second run by hand: I18N_KEEP_SRC=1)
  if (!process.env.I18N_KEEP_SRC) fs.rmSync(path.join(site, "en-src"), { recursive: true, force: true });
  // The search index in English: a show's English name (its Arabic headline left out), English labels and addresses;
  // a news story keeps its Arabic title, like on the pages
  const idxFile = path.join(site, "search-index.json");
  if (fs.existsSync(idxFile)) {
    try {
      const items = JSON.parse(fs.readFileSync(idxFile, "utf8"));
      const en = items.filter((it) => !(news.length && it.kind === "news")).map((it) => {
        const o = Object.assign({}, it);
        const news = it.kind === "news";
        if (!news) {
          const title = AR.test(it.title || "") ? tr(it.title) : it.title;
          const head = it.headline ? tr(it.headline) : "";
          o.title = !AR.test(head) && head ? head : title;
          o.headline = "";
          o.description = it.description && !AR.test(tr(it.description)) ? tr(it.description) : "";
        }
        for (const k of ["kindLabel", "show_type"]) if (o[k] && AR.test(o[k])) { const t = tr(o[k]); o[k] = AR.test(t) ? "" : t; }
        o.tags = (it.tags || []).map((t) => (AR.test(t) ? tr(t) : t)).filter((t) => t && !AR.test(t));
        if (o.url) { const l = linkFor(o.url, english); if (l) o.url = l; }
        delete o.inputPath;
        return o;
      });
      for (const x of news) en.push({ title: x.title, headline: "", description: x.description || "", tags: [], federation: x.federation, kind: "news", show_type: "", kindLabel: "News", url: x.en, image: x.image, date: x.date });
      fs.mkdirSync(path.join(site, "en"), { recursive: true });
      fs.writeFileSync(path.join(site, "en", "search-index.json"), JSON.stringify(en));
    } catch (e) { leftovers.set("[search-index] " + e.message, 1); }
  }
  // Search engines: a sitemap of the English pages, named in robots.txt
  const urls = [...new Set(english.values())].filter((u) => u !== "/en/404.html").sort();
  fs.mkdirSync(path.join(site, "en"), { recursive: true });
  fs.writeFileSync(path.join(site, "en", "sitemap.xml"), '<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n' + urls.map((u) => `<url><loc>${ORIGIN}${encodeURI(u)}</loc></url>`).join("\n") + "\n</urlset>\n");
  const robots = path.join(site, "robots.txt");
  if (fs.existsSync(robots) && !/\/en\/sitemap\.xml/.test(fs.readFileSync(robots, "utf8"))) fs.appendFileSync(robots, `\nSitemap: ${ORIGIN}/en/sitemap.xml\n`);
  const top = [...leftovers.entries()].sort((a, b) => b[1] - a[1]);
  const summary = { written, pagesWithArabic: leftPages, arabicLeft: top.length, seconds: Math.round((Date.now() - t0) / 100) / 10 };
  if (opts.leftoversFile) fs.writeFileSync(opts.leftoversFile, top.map(([s, n]) => `${n}\t${where.get(s) || ""}\t${s}`).join("\n"));
  return { summary, leftovers: top };
}

module.exports = { buildEnglish, translatePage, makeTranslator, linkFor, inScope, enUrl, trJs };

if (require.main === module) {
  // node lib/i18n/mirror.cjs <site> [content.json] [leftovers.tsv]
  const site = process.argv[2] || "_site";
  // the content file: the build's node_modules/.cache-arw-i18n-content.json ({ content, pages }) or a plain map
  const data = process.argv[3] && fs.existsSync(process.argv[3]) ? JSON.parse(fs.readFileSync(process.argv[3], "utf8")) : {};
  const r = buildEnglish(site, data.content ? { content: data.content, pages: data.pages, news: data.news, leftoversFile: process.argv[4] } : { content: data, leftoversFile: process.argv[4] });
  console.log(JSON.stringify(r.summary));
}
