"use strict";
// A show with Arabic commentary («تعليق عربي») is not translated: nothing on its page may call it «مترجم» or claim
// Arabic subtitles (owner 2026-11-18, about WWE RAW 16.11.2026 (تعليق عربي), INCIDENTS #1390).
//
// «مترجم» in the head becomes «بالتعليق العربي» — the way these shows are searched (INCIDENTS #1393).
//
// The rule is read from the show itself — its title, headline, program name or address saying «تعليق عربي» /
// «تعليق للعربي» / «بالتعليق العربي», or the front-matter flag «arabic_commentary: true» — so every future
// Arabic-commentary show gets it with no manual step. Other shows stay exactly as they were.
//
// The page's head (title, description, keywords, og/twitter, the JSON-LD names and descriptions) is written by many
// SEO helpers that add «مترجم» forms (lib/show-seo.cjs, eleventy.config.js): the layout marks such a page with
// <meta name="arw-commentary" content="ar"> and the «arabicCommentary» transform rewrites those words in the head
// (commentaryHead below). The visible text (the H1, «عن العرض») is written right at its source.

const AR = "ء-ي";
const COMMENTARY = new RegExp(`(?<![${AR}])[وب]?(?:ال)?تعليق\\s*(?:لل|بال|ال|ب)?عربي(?![${AR}])|\\barabic[\\s-]+commentary\\b`, "i");

const decode = (v) => {
  const s = String(v == null ? "" : v);
  try { return decodeURIComponent(s); } catch { return s; }
};

/** Any of the given texts (title, headline, program, address…) says the show has Arabic commentary. */
function isArabicCommentary(...vals) {
  return vals.some((v) => typeof v === "string" && COMMENTARY.test(decode(v).replace(/[-_]+/g, " ")));
}

/** A show's front matter (or the layout's variables): the flag, or its own words. */
function isArabicCommentaryShow(data = {}) {
  const flag = data.arabic_commentary;
  if (flag === true || flag === "true" || flag === "yes") return true;
  if (flag === false || flag === "false" || flag === "no") return false;
  return isArabicCommentary(data.title, data.headline, data.program_name, data.url, data.slug, data.page && data.page.url);
}

// «مترجم» and its forms, as whole words (an Arabic letter on neither side)
const W = (re) => new RegExp(`(?<![${AR}])${re}(?![${AR}])`, "g");
const REPLACE = [
  // «مترجمًا إلى العربية» (the «عن العرض» lead sentence of older builds)
  [W("و?(?:ال)?مترجم(?:[ةه]|[ً]?ا?[ً]?)\\s+(?:إلى|الى)\\s+العربي[ةه]"), "بالتعليق العربي"],
  // «مترجم بالعربي», «مترجمة بالعربية», «مترجم عربي»
  [W("و?مترجم[ةه]?\\s+(?:بالعربي[ةه]?|عربي[ةه]?|للعربي[ةه]?)"), (m) => (m.startsWith("و") ? "وبالتعليق العربي" : "بالتعليق العربي")],
  // «من عروض المصارعة الحرة المترجمة»
  [W("المترجم[ةه]?"), "بالتعليق العربي"],
  // «مترجم», «مترجمة», «مترجمه», «ومترجم», «مترجمًا», «مترجمان»…
  [W("و?مترجم(?:[ةه]|[ً]?ا[ً]?|ان|ين|ون)?"), (m) => (m.startsWith("و") ? "وبالتعليق العربي" : "بالتعليق العربي")],
];
const DROP = [W("و?(?:ال)?مترجم(?:[ةه]|[ً]?ا?[ً]?)\\s+(?:إلى|الى)\\s+العربي[ةه]"), W("و?(?:ال)?مترجم[ةه]?\\s+(?:بالعربي[ةه]?|عربي[ةه]?|للعربي[ةه]?)"), W("و?(?:ال)?مترجم(?:[ةه]|[ً]?ا[ً]?|ان|ين|ون)?")];

/** One phrase: «مترجم» becomes «بتعليق عربي»; a phrase that already names the commentary just loses the word. */
function phrase(seg) {
  if (!/مترجم/.test(seg)) return seg;
  if (/تعليق/.test(seg)) {
    let out = seg;
    for (const re of DROP) out = out.replace(re, "");
    return out.replace(/\s{2,}/g, " ").replace(/\s+([).])/g, "$1");
  }
  let out = seg;
  for (const [re, to] of REPLACE) out = out.replace(re, to);
  return out;
}

// phrases end at punctuation or a dash; a parenthesis stays inside its phrase («WWE RAW (تعليق للعربي) مترجم»)
const SPLIT = /([،,|—–:"«»\n]|\s-\s|&quot;)/;
/** A whole text (a title, a description, a list of names): every phrase rewritten. */
function noSubtitleClaim(text) {
  const s = String(text == null ? "" : text);
  if (!/مترجم/.test(s)) return s;
  return s.split(SPLIT).map((p, i) => (i % 2 ? p : phrase(p))).join("").replace(/\s{2,}/g, " ");
}

/** A comma list («keywords»): rewritten, emptied names gone, each name once. */
function noSubtitleList(text, sep = ", ") {
  const seen = new Set();
  return String(text || "").split(/\s*,\s*/).map((n) => noSubtitleClaim(n).trim()).filter((n) => n && !seen.has(n) && seen.add(n)).join(sep);
}

/** JSON-LD: every string rewritten, arrays without repeats, no «subtitleLanguage». */
function noSubtitleJson(node) {
  if (typeof node === "string") return noSubtitleClaim(node).trim();
  if (Array.isArray(node)) {
    const seen = new Set();
    return node.map(noSubtitleJson).filter((v) => {
      if (typeof v !== "string") return true;
      if (!v || seen.has(v)) return false;
      seen.add(v);
      return true;
    });
  }
  if (node && typeof node === "object") {
    const out = {};
    for (const [k, v] of Object.entries(node)) {
      if (k === "subtitleLanguage") continue;
      out[k] = k === "keywords" && typeof v === "string" ? noSubtitleList(v) : noSubtitleJson(v);
    }
    return out;
  }
  return node;
}

const MARK = /<meta name="arw-commentary" content="ar"\s*\/?>/;
const isMarked = (html) => MARK.test(String(html || ""));

/** A built page marked as Arabic commentary: its head and JSON-LD say «تعليق عربي», never «مترجم». */
function commentaryHead(html) {
  const s = String(html || "");
  if (!isMarked(s)) return s;
  const end = s.indexOf("</head>");
  let head = end < 0 ? s : s.slice(0, end);
  const rest = end < 0 ? "" : s.slice(end);
  head = head.replace(/<title>([^<]*)<\/title>/, (m, t) => `<title>${noSubtitleClaim(t)}</title>`);
  head = head.replace(/<meta\b[^>]*>/g, (tag) => {
    if (!/مترجم/.test(tag)) return tag;
    const keywords = /\bname="keywords"/.test(tag);
    return tag.replace(/\bcontent="([^"]*)"/, (m, v) => `content="${keywords ? noSubtitleList(v) : noSubtitleClaim(v)}"`);
  });
  // alt/aria words in the head are none; the JSON-LD may sit in the head or the body
  const fixLd = (part) => part.replace(/(<script type="application\/ld\+json">)([\s\S]*?)(<\/script>)/g, (m, a, body, z) => {
    if (!/مترجم|subtitleLanguage/.test(body)) return m;
    try {
      return a + JSON.stringify(noSubtitleJson(JSON.parse(body))) + z;
    } catch {
      return a + noSubtitleClaim(body).replace(/"subtitleLanguage"\s*:\s*"[^"]*"\s*,?\s*/g, "") + z;
    }
  });
  return fixLd(head) + fixLd(rest);
}

// ── how people search an Arabic-commentary show (owner 2026-11-18: «اي حد يكتب العروض بالتعليق العربي او بالصوت
// العربي يظهرله العروض»). Head and structured data only: the alternate names / keywords of the show page and of its
// program's library page. Short and per name — no lists in the visible text (INCIDENTS #1393).
const AR_MONTHS = ["يناير", "فبراير", "مارس", "أبريل", "مايو", "يونيو", "يوليو", "أغسطس", "سبتمبر", "أكتوبر", "نوفمبر", "ديسمبر"];
const EN_MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
// a name that is only a name: Arabic letters, no date, no intent or quality word
const NOT_A_NAME = /مترجم|تعليق|الاخير|الأخير|مشاهد|تحميل|(?:^|\s)(?:اخر|آخر|كامل|اون|لاين|نتفلكس|ملخص|نتائج|شاهد|عروض|مصارع[ةه]|حلقات|الجديد|اليوم)(?=\s|$)/;

/** Arabic program names from a list of a page's names («عرض الرو», «الرو», «رو», «راو»…), the first few, each once. */
function baseNames(names, max = 6) {
  const out = [];
  for (const raw of names || []) {
    const n = String(raw || "").replace(/\s+/g, " ").trim();
    if (!n || !/^[\u0600-\u06FF ]+$/.test(n) || NOT_A_NAME.test(n) || n.split(" ").length > 4 || out.includes(n)) continue;
    out.push(n);
    if (out.length >= max) break;
  }
  return out;
}

/** The English program name without its commentary mark: «WWE RAW (تعليق للعربي)» → «WWE RAW» */
const englishProgram = (name) => String(name || "").replace(/\(([^)]*)\)/g, (m, inner) => (COMMENTARY.test(inner) ? "" : m)).replace(COMMENTARY, "").replace(/[^\x20-\x7E]+/g, " ").replace(/\s+/g, " ").trim();

/**
 * The commentary search forms of one show (or, with no date, of its program): «عرض الرو بالتعليق العربي», «رو بالصوت العربي»,
 * «مشاهدة عرض الرو بالتعليق العربي», «عرض الرو 16.11.2026 بالتعليق العربي», «WWE RAW Arabic commentary»…
 */
function commentaryForms({ names = [], eventDate = "", programName = "", isLatest = false } = {}) {
  const base = baseNames(names);
  const main = base.find((n) => /^عرض\s/.test(n)) || base[0] || "";
  const out = [];
  const add = (...xs) => xs.forEach((x) => x && !out.includes(x) && out.push(x));
  if (main) {
    add(`${main} بالتعليق العربي`, `${main} بالصوت العربي`, `${main} تعليق عربي`, `${main} بتعليق عربي`, `${main} معلق عربي`, `${main} صوت عربي`, `${main} بالعربي`,
      `مشاهدة ${main} بالتعليق العربي`, `تحميل ${main} بالتعليق العربي`, `${main} بالتعليق العربي كامل`, `${main} بالتعليق العربي اون لاين`,
      `مشاهدة ${main} بالصوت العربي`, `${main} كامل بالصوت العربي`);
    if (isLatest) add(`${main} الأخير بالتعليق العربي`, `${main} الاخير بالتعليق العربي`, `اخر ${main} بالتعليق العربي`, `${main} الاخير بالصوت العربي`);
  }
  for (const n of base) if (n !== main) add(`${n} بالتعليق العربي`, `${n} بالصوت العربي`);
  const ymd = String(eventDate || "").match(/(\d{4})-(\d{2})-(\d{2})/);
  const en = englishProgram(programName);
  if (ymd) {
    const [y, m, d] = [Number(ymd[1]), Number(ymd[2]), Number(ymd[3])];
    const dot = `${String(d).padStart(2, "0")}.${String(m).padStart(2, "0")}.${y}`, slash = `${d}/${m}/${y}`, word = `${d} ${AR_MONTHS[m - 1]} ${y}`;
    if (main) add(`${main} ${dot} بالتعليق العربي`, `${main} ${slash} بالتعليق العربي`, `${main} ${word} بالتعليق العربي`, `${main} ${dot} بالصوت العربي`, `مشاهدة ${main} ${dot} بالتعليق العربي`);
    if (en) add(`${en} ${EN_MONTHS[m - 1]} ${d} ${y} Arabic commentary`, `${en} ${dot} Arabic commentary`);
  }
  if (en) add(`${en} Arabic commentary`, `${en} with Arabic commentary`, `${en} بالتعليق العربي`);
  return out;
}

/** commentaryForms first, then the page's own names, each once */
const withCommentaryForms = (names, opts) => [...new Set([...commentaryForms({ names, ...opts }), ...(names || [])])];

module.exports = { COMMENTARY, isArabicCommentary, isArabicCommentaryShow, noSubtitleClaim, noSubtitleList, noSubtitleJson, commentaryHead, isMarked, baseNames, englishProgram, commentaryForms, withCommentaryForms };
