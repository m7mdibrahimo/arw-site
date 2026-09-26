// ── News quality gate ─────────────────────────────────────────────────────
// Deterministic checks for defects that have actually reached the live site
// (see INCIDENTS.md). Used two ways:
//   1. By the watcher (processPost) on every generated article BEFORE it is
//      written, so a defective article is fixed or held instead of published.
//   2. As a CLI audit over content/news:  npx tsx scripts/news-qa.ts [--days N] [--json]
// Correction rules live in editorial/corrections.json, the same file the
// watcher applies and feeds to Gemini, so one edit there fixes all three.
import fs from "fs";
import path from "path";
import matter from "gray-matter";

export type Severity = "error" | "warning";
export interface QaIssue { code: string; severity: Severity; field: "title" | "body" | "tags"; message: string; excerpt: string }

const EDITORIAL_DIR = path.join(process.cwd(), "editorial");
export interface Correction { wrong: string; right: string; note?: string; regex?: boolean }
export function loadCorrections(): Correction[] {
  try {
    return JSON.parse(fs.readFileSync(path.join(EDITORIAL_DIR, "corrections.json"), "utf-8")).corrections || [];
  } catch {
    return [];
  }
}

const AR = "\\u0621-\\u064A";
const arBoundL = `(?<![${AR}])`;
const arBoundR = `(?![${AR}])`;
// A one-letter Arabic prefix (و/ف/ب/ل/ك) is part of the written word ("وكيفين أوينز",
// "بسماكداون"), so every rule also matches behind one and keeps it.
const PREFIX = "(و|ف|ب|ل|ك|وب|ول|فب|فل)?";
function correctionRegex(c: Correction): RegExp {
  const body = c.regex ? c.wrong : c.wrong.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(arBoundL + PREFIX + "(?:" + body + ")" + arBoundR, "g");
}

/** Applies every wrong→right rule from editorial/corrections.json. Idempotent. */
export function applyCorrections(text: string, corrections = loadCorrections()): string {
  if (!text) return text;
  let out = text;
  for (const c of corrections) {
    out = out.replace(correctionRegex(c), (_m, prefix = "") =>
      // "بـWWE SmackDown": a joined preposition before an English name takes a tatweel
      prefix && /^[A-Za-z]/.test(c.right) && !prefix.endsWith("و") ? `${prefix}ـ${c.right}` : `${prefix}${c.right}`);
  }
  return out;
}

function excerptAround(text: string, index: number, len = 0): string {
  const start = Math.max(0, index - 25);
  return text.slice(start, index + len + 25).replace(/\s+/g, " ").trim();
}

function stripNonProse(body: string): string {
  return body
    .replace(/<blockquote[\s\S]*?<\/blockquote>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/!?\[[^\]]*\]\([^)]*\)/g, " ")
    .replace(/https?:\/\/\S+/g, " ")
    .replace(/^\s*\{%.*%\}\s*$/gm, " ");
}

interface Rule { code: string; severity: Severity; re: RegExp; message: string; fields?: ("title" | "body" | "tags")[] }
// Words that legitimately repeat (team names like "Bang Bang Gang").
// Words that legitimately repeat: team/wrestler names ("Bang Bang", "JJ"), the old
// letter-by-letter spellings of federations ("دبليو دبليو إي", "إيه إيه إيه") and
// quoted emphasis. Only words of 4+ letters are ever collapsed.
const LEGIT_DOUBLES = new Set(["بانغ", "بانج", "دبليو", "دابليو", "أبدا", "أبداً", "ابدا", "جدا", "جداً", "كلا", "هيا"]);
const SHOW_WORDS = "(?:العرض|عرض|عروض|WWE|AEW|TNA|RAW|Raw|SmackDown|NXT|Dynamite|Collision|Rampage|iMPACT|EVOLVE)";

const RULES: Rule[] = [
  { code: "persian_letters", severity: "error", re: /[گکیپچژڤ]/g, message: "حروف فارسية بدل العربية" },
  { code: "glued_latin_arabic", severity: "error", re: new RegExp(`[A-Za-z][${AR}]|[${AR}]{2}[A-Za-z]`, "g"), message: "حرف عربي ملزوق بكلمة إنجليزية (مثل: AEW Liveة)" },
  { code: "detached_prefix", severity: "error", re: new RegExp(`(?:^|\\s)[لب]\\s+(?=[${AR}])`, "g"), message: "حرف جر منفصل عن الكلمة (مثل: ل زينا)" },
  { code: "repeated_word", severity: "error", re: new RegExp(`(?<![${AR}])([${AR}]{4,})\\s+\\1(?![${AR}])`, "g"), message: "كلمة مكررة مرتين متتاليتين" },
  { code: "forbidden_term", severity: "error", re: new RegExp(`${arBoundL}(?:ال)?(?:مهرجان|يستذكر)${arBoundR}|${arBoundL}(?:ال)?حلق(?:ة|ات)\\s+${SHOW_WORDS}|${SHOW_WORDS}\\s+(?:ال)?حلق(?:ة|ات)${arBoundR}`, "g"), message: "مصطلح ممنوع (حلقة العرض/مهرجان/يستذكر) — المعتمد: عرض، يتذكر" },
  { code: "game_terms", severity: "error", re: /مجريات اللعب|المباراة الكروية|الشوط (?:الأول|الثاني)|أرض الملعب/g, message: "تعبير رياضي غير مناسب للمصارعة (المعتمد: مجريات النزال)" },
  { code: "artifact", severity: "error", re: /\bundefined\b|\bNaN\b|\[object Object\]|\{\{|\}\}|```|\\n|&amp;|&quot;|&#\d+;/g, message: "بقايا كود أو رموز غير مفهومة", fields: ["title", "body"] },
  // Gemini sometimes swaps one letter of a name for a look-alike from another script:
  // «وパاتريك» (Japanese), «ناтан» (Cyrillic), «مصارعة חברה» (Hebrew tag) — INCIDENTS #54.
  { code: "foreign_script", severity: "error", re: /[\u0370-\u03FF\u0400-\u052F\u0590-\u05FF\u0900-\u0DFF\u0E00-\u0E7F\u3040-\u30FF\u3400-\u9FFF\uAC00-\uD7AF]+/g, message: "حروف من لغة أخرى (يابانية/روسية/عبرية...) داخل النص" },
  { code: "ai_leak", severity: "error", re: /كنموذج ذكاء|بصفتي نموذج|as an AI|I cannot|here is the|ترجمة:|النص المترجم|body_markdown|"title"\s*:/gi, message: "نص تسرب من رد الذكاء الاصطناعي" },
  { code: "empty_brackets", severity: "error", re: /\(\s*\)|\[\s*\]|«\s*»|""/g, message: "أقواس أو علامات تنصيص فاضية" },
  { code: "english_jargon", severity: "error", re: new RegExp(`[${AR}]\\s+(?:segment|promo|promoter|heel|babyface|face turn|heel turn|feud|spot|push|booking|booker|squash|botch|kayfabe|go-home|angle|storyline|run-in|pop|heat|tag team|finisher|jobber|mic skills|main event|midcard|house show)\\b|\\b(?:segment|promo|heel|babyface|feud|booking|squash|botch|kayfabe|go-home|storyline)\\s+[${AR}]`, "gi"), message: "مصطلح مصارعة إنجليزي داخل جملة عربية (مثل segment ← فقرة، promo ← خطاب/حوار)", fields: ["title", "body"] },
  { code: "english_title_name", severity: "error", re: new RegExp(`[${AR}]\\s+(?:[A-Z][A-Za-z']+\\s+){0,4}(?:Championships?|Titles?|Tag Team Classic|Cup|Tournament)\\b`, "g"), message: "اسم بطولة/لقب بالإنجليزي داخل النص (يُكتب بالعربية: بطولة العالم للوزن الثقيل...)", fields: ["title", "body"] },
  { code: "glossary_artifact", severity: "error", re: /بطلة? \((?:الاتحاد|العالمي|العالم|القارات|الأمريكي|أمريكا الشمالية|إن إكس تي|سبيد|الاتحاد للفرق|العالمي للفرق|إن إكس تي للفرق|إيفولف|إيفولف للفرق|دبليو دبليو إن)\)/g, message: "اسم بطولة مكسور من القاموس القديم مثل «بطل (الاتحاد)» — يُحذف أو يُكتب اسم البطولة الصحيح (بطولة WWE، بطولة العالم للوزن الثقيل...)", fields: ["title", "body"] },
  { code: "truncated_word", severity: "error", re: /(?<=^|\s)[ءآأؤإئاتثجحخدذرزسشصضطظعغقمنهةى](?=\s)/g, message: "حرف منفرد — كلمة مبتورة (حصل: «ق ليحكم»، «تضرب الح للمرة»)", fields: ["title", "body"] },
  { code: "vague_result", severity: "error", re: /الفائز:\*{0,2}\s*(?:تم\s+حسم|تحديد|حسم\s+النتيجة|غير\s+معروف|لم\s+يتم|لم\s+يحسم|قيد\s+الانتظار|بانتظار|سيتم|يحدد\s+لاحقا|انتهى\s+الحدث|انتهت\s+الأحداث|[^\n]{0,25}وسط\s+أجواء)[^\n]*/g, message: "سطر «الفائز» بلا اسم — نتيجة مخترعة أو ناقصة (حصل: «تم حسم النتيجة وتحديد الفائز في أجواء تنافسية»)", fields: ["body"] },
  { code: "missing_hamza", severity: "error", re: /(?<![\u0621-\u064A])[وف]?(?:الى|الي)(?![\u0621-\u064A])/g, message: "«الى/الي» بلا همزة — «إلى» (حرف الجر) أو «إليّ» حسب المعنى (حصل: «للوصول الي» والمقصود «إليّ»)", fields: ["title", "body"] },
  { code: "double_punct", severity: "warning", re: /[،,]\s*[،,.]|:\s*:|؟\s*؟/g, message: "علامات ترقيم مكررة", fields: ["title", "body"] },
];

const TRANSLITERATED_SHOWS = /(?:سماك\s*داون|داينامايت|ديناميت|داينمايت|كوليجن|رامبيج|إمباكت|(?<![ء-ي])راو(?![ء-ي])|(?<![ء-ي])الرو(?![ء-ي])|[إا]ن\s*[إا]كس\s*تي|[إا]يفولف)/g;

/** A tag must name a person, team, show, federation or topic — never a date ("تاريخ 24 سبتمبر 2026", seen live). */
export function isJunkTag(tag: string): boolean {
  const t = (tag || "").trim();
  return !t || /^تاريخ(?:\s|$)/.test(t) || /^\d+$/.test(t)
    || /(?:يناير|فبراير|مارس|أبريل|ابريل|مايو|يونيو|يوليو|أغسطس|اغسطس|سبتمبر|أكتوبر|اكتوبر|نوفمبر|ديسمبر)\s+\d{4}/.test(t);
}

/** A tag that is really a sentence: a comma-joined list, or a 4+ word phrase
 *  lifted straight out of the headline ("توني خان يتحدث عن اندماج باراماونت وWBD"). */
export function isHeadlineTag(tag: string, title: string): boolean {
  const t = (tag || "").trim();
  if (/[،,]/.test(t)) return true;
  return t.split(/\s+/).length >= 4 && (title || "").includes(t);
}

export function checkArticle(title: string, body: string, tags: string[] = []): QaIssue[] {
  const issues: QaIssue[] = [];
  for (const tag of tags) if (isJunkTag(tag)) issues.push({ code: "junk_tag", severity: "error", field: "tags", message: "وسم عبارة عن تاريخ أو رقم", excerpt: tag });
  const fields: [QaIssue["field"], string][] = [["title", title || ""], ["body", stripNonProse(body || "")], ["tags", tags.join(" | ")]];
  for (const [field, text] of fields) {
    for (const rule of RULES) {
      if (rule.fields && !rule.fields.includes(field)) continue;
      rule.re.lastIndex = 0;
      let m = rule.re.exec(text);
      while (m && rule.code === "repeated_word" && LEGIT_DOUBLES.has(m[1])) m = rule.re.exec(text);
      if (m) issues.push({ code: rule.code, severity: rule.severity, field, message: rule.message, excerpt: excerptAround(text, m.index, m[0].length) });
    }
    TRANSLITERATED_SHOWS.lastIndex = 0;
    const show = TRANSLITERATED_SHOWS.exec(text);
    if (show) issues.push({ code: "transliterated_show", severity: "error", field, message: "اسم عرض/اتحاد مكتوب بالعربي بدل الإنجليزي", excerpt: excerptAround(text, show.index, show[0].length) });
    for (const c of loadCorrections()) {
      const re = correctionRegex(c);
      const m = re.exec(text);
      if (m) issues.push({ code: "known_wrong", severity: "error", field, message: `"${c.wrong}" → "${c.right}"${c.note ? ` (${c.note})` : ""}`, excerpt: excerptAround(text, m.index, m[0].length) });
    }
  }

  const t = title || "";
  // Show/federation names legitimately stay English, so judge by how many real
  // Arabic words the headline has rather than by its Latin letter ratio.
  const arabicWords = t.split(/\s+/).filter(w => new RegExp(`[${AR}]{2,}`).test(w)).length;
  if (arabicWords < 3) issues.push({ code: "title_not_arabic", severity: "error", field: "title", message: "العنوان مش جملة عربية (أقل من 3 كلمات عربية)", excerpt: t });
  if (t.length > 0 && t.length < 25) issues.push({ code: "title_too_short", severity: "warning", field: "title", message: "العنوان قصير جدًا", excerpt: t });
  // "AEW Collision-9-2026": a source date like 9/23/2026 mangled into a slug-ish fragment
  if (/[A-Za-z]-\d{1,2}-\d{4}|\d{1,2}\/\d{1,2}\/\d{4}/.test(t)) issues.push({ code: "mangled_date", severity: "error", field: "title", message: "تاريخ مكتوب بصيغة غير عربية أو مكسور في العنوان (الصيغة المعتمدة: 23 سبتمبر 2026)", excerpt: t });
  if (/^(تصريحات نارية|صدمة مدوية|ليلة نارية|اعترافات صادمة|مفاجأة كبرى)/.test(t)) issues.push({ code: "title_cliche", severity: "error", field: "title", message: "بادئة كليشيه ممنوعة", excerpt: t });

  const prose = stripNonProse(body || "");
  const englishRun = prose.match(/(?:\b[A-Za-z][A-Za-z'’-]*\b[\s,]+){10,}/);
  if (englishRun) issues.push({ code: "english_sentence", severity: "warning", field: "body", message: "جملة إنجليزية كاملة داخل النص", excerpt: englishRun[0].slice(0, 80) });
  if (prose.replace(/\s/g, "").length < 250) issues.push({ code: "body_too_short", severity: "error", field: "body", message: "نص الخبر قصير جدًا أو فاضي", excerpt: prose.slice(0, 80) });
  if (((body || "").match(/\*\*/g) || []).length % 2 === 1) issues.push({ code: "broken_bold", severity: "warning", field: "body", message: "تنسيق ** غير مقفول", excerpt: "" });

  const titleDay = t.match(/\((\d{1,2}) ([ء-ي]+) (\d{4})\)/);
  if (titleDay) {
    const bodyDays = [...prose.matchAll(new RegExp(`(\\d{1,2}) ${titleDay[2]}`, "g"))].map(m => m[1]);
    if (bodyDays.length && !bodyDays.includes(titleDay[1])) {
      issues.push({ code: "title_body_date", severity: "warning", field: "title", message: `تاريخ العنوان (${titleDay[1]}) غير موجود في النص (${[...new Set(bodyDays)].join("، ")})`, excerpt: t });
    }
  }
  return issues;
}

/**
 * Deterministic fixes for defects with exactly one correct repair. Safe to run
 * repeatedly (idempotent) and on published articles. Anything needing judgment
 * (gender agreement, meaning, which spelling is right) is left to the AI copy
 * editor and editorial/corrections.json.
 */
const AR_MONTHS = ["يناير", "فبراير", "مارس", "أبريل", "مايو", "يونيو", "يوليو", "أغسطس", "سبتمبر", "أكتوبر", "نوفمبر", "ديسمبر"];

export function autoFix(text: string): string {
  if (!text) return text;
  const urls: string[] = [];
  let out = text.replace(/https?:\/\/\S+|<[^>]+>/g, m => `\u0000${urls.push(m) - 1}\u0000`);
  // Gemini sometimes writes the intro paragraph twice (SmackDown 25/09 — INCIDENTS #58).
  // A long paragraph repeated word-for-word is never intended: keep the first.
  const seenParagraphs = new Set<string>();
  out = out.split(/\n{2,}/).filter(para => {
    // Sections are separated by a «---» line glued to the next paragraph.
    const key = para.replace(/^(?:\s*-{3,}\s*\n)+/, "").replace(/\s+/g, " ").trim();
    if (key.length < 60) return true;
    if (seenParagraphs.has(key)) return false;
    seenParagraphs.add(key);
    return true;
  }).join("\n\n");
  out = out
    // "TNA iMPACT (9/24/2026)": an American M/D/YYYY date copied from the source
    // title used to get the whole article blocked (mangled_date) — convert it.
    .replace(/\b(1[0-2]|0?[1-9])\/(3[01]|[12]\d|0?[1-9])\/(20\d\d)\b/g, (_m, mo, d, y) => `${Number(d)} ${AR_MONTHS[Number(mo) - 1]} ${y}`)
    // Ringside News ends articles with "Do you think…? Let us know in the comments"
    // — Gemini translated it as a closing paragraph («شاركنا رأيك في التعليقات»).
    // It's the source's sign-off, not news: drop that paragraph.
    .replace(/(^|\n)[^\n]*(?:شاركنا|شاركونا|أخبرنا|أخبرونا|اتركوا|اترك)[^\n]*(?:التعليقات|رأيك|رأيكم)[^\n]*(?=\n|$)/g, "")
    // Punctuation orphaned when the copy editor deletes a clause: «كانديس ليراي، .»
    // (INCIDENTS #57) — keep the stronger mark, drop the space before it.
    .replace(/[،,؛]\s*([.!؟?])/g, "$1")
    .replace(/([،؛])\s*[،,؛]/g, "$1")
    .replace(/[ \t]+([.،؛!؟])(?=\s|$)/g, "$1")
    // "What's Your Story؟": an Arabic question mark inside an English name
    .replace(/([A-Za-z])؟/g, "$1?")
    // "أارون" / "أاماساكي": hamza-alef + alef never occurs in Arabic — it is a long «آ»
    .replace(/[أإ]ا/g, "آ")
    .replace(/ک/g, "ك").replace(/ی/g, "ي").replace(/گ/g, "غ").replace(/پ/g, "ب").replace(/ژ/g, "ج").replace(/ڤ/g, "ف").replace(/چ/g, "تش")
    // "AEW Liveة" → "AEW Live": a lone Arabic letter glued after an English word is always debris
    .replace(new RegExp(`([A-Za-z])[ةه](?![${AR}])`, "g"), "$1")
    // "NXTبطولة" / "عرضMLP" → add the missing space
    .replace(new RegExp(`([A-Za-z])([${AR}])`, "g"), "$1 $2")
    .replace(new RegExp(`([${AR}]{2})([A-Za-z])`, "g"), "$1 $2")
    // "ل زينا" → "لـزينا", "ل *NXT" → "لـ *NXT", "و سامي" → "وسامي"
    .replace(new RegExp(`(^|[\\s(«"])([لب])\\s+(?=[${AR}])`, "gm"), "$1$2ـ")
    .replace(/(^|[\s(«"])([لب])\s+(?=[*«"]?[A-Za-z0-9"«])/gm, "$1$2ـ ")
    .replace(new RegExp(`(?<=[${AR}.،!؟"»)*]\\s)و\\s+(?=[${AR}])`, "g"), "و")
    // "عرض MLP عرض MLP" → "عرض MLP"
    .replace(/(?<!\S)(\S+\s+\S+)(?:\s+\1)+(?!\S)/g, (m, phrase) => new RegExp(`[${AR}]`).test(phrase) ? phrase : m)
    // "صالة صالة" → "صالة" (team names like "بانغ بانغ" are kept)
    .replace(new RegExp(`(?<![${AR}])([${AR}]{4,})(?:\\s+\\1)+(?![${AR}])`, "g"), (m, w) => LEGIT_DOUBLES.has(w) ? m : w)
    // "آدم بيرس (آدم بيرس)" → "آدم بيرس"
    .replace(/(?<![^\s(«"])((?:[^\s()]+\s){0,3}[^\s()]+)\s*\(\1\)/g, "$1")
    .replace(/،\s*،/g, "،").replace(/:\s*:/g, ":").replace(/؟\s*؟/g, "؟");
  return out.replace(/\u0000(\d+)\u0000/g, (_, i) => urls[Number(i)]);
}

// ── Cross-article checks ──────────────────────────────────────────────────
export interface NewsFile { file: string; title: string; body: string; tags: string[]; date: number; sourceUrl?: string }
export function loadNews(newsDir = path.join(process.cwd(), "content", "news")): NewsFile[] {
  return fs.readdirSync(newsDir).filter(f => f.endsWith(".md")).map(file => {
    const { data, content } = matter(fs.readFileSync(path.join(newsDir, file), "utf-8"));
    return { file, title: String(data.title || ""), body: content, tags: (data.tags || []).map(String),
      date: data.date ? new Date(data.date).getTime() : 0, sourceUrl: data.source_url };
  });
}

const STOP = new Set(["في", "من", "على", "إلى", "الى", "عن", "مع", "بعد", "قبل", "بين", "حول", "أن", "إن", "ان", "هذا", "هذه", "التي", "الذي", "وهو", "وهي", "كان", "يكشف", "يعلق", "عرض", "WWE", "AEW", "TNA", "خبر", "رسميا", "رسميًا"]);
export function tokens(text: string): Set<string> {
  return new Set(text.replace(/[^ء-يA-Za-z0-9\s]/g, " ").split(/\s+/)
    .map(w => w.replace(/^(وال|بال|فال|كال|لل|ال|و)(?=[ء-ي]{3,})/, "")).filter(w => w.length > 2 && !STOP.has(w)));
}
export function jaccard(a: Set<string>, b: Set<string>): number {
  let inter = 0;
  for (const x of a) if (b.has(x)) inter++;
  return inter / (a.size + b.size - inter || 1);
}

export interface DuplicatePair { a: string; b: string; reason: string; score: number }
export function findDuplicates(news: NewsFile[], windowHours = 72): DuplicatePair[] {
  const out: DuplicatePair[] = [];
  const prepared = news.map(n => ({ n, t: tokens(n.title), b: tokens(n.body.slice(0, 1500)), tagset: new Set(n.tags.filter(t => !/^(WWE|AEW|TNA|ROH|NJPW|UFC|MLW|AAA|CMLL|NXT)$/i.test(t))) }))
    .sort((x, y) => x.n.date - y.n.date);
  for (let i = 0; i < prepared.length; i++) {
    for (let j = i + 1; j < prepared.length; j++) {
      const x = prepared[i], y = prepared[j];
      if (y.n.date - x.n.date > windowHours * 3600_000) break;
      if (x.n.sourceUrl && x.n.sourceUrl === y.n.sourceUrl) { out.push({ a: x.n.file, b: y.n.file, reason: "same source_url", score: 1 }); continue; }
      const titleSim = jaccard(x.t, y.t);
      const bodySim = jaccard(x.b, y.b);
      const sharedTags = [...x.tagset].filter(t => y.tagset.has(t)).length;
      const score = titleSim * 0.4 + bodySim * 0.6;
      if (bodySim >= 0.3 || (titleSim >= 0.45 && bodySim >= 0.18) || (sharedTags >= 2 && bodySim >= 0.22)) {
        out.push({ a: x.n.file, b: y.n.file, reason: `title ${titleSim.toFixed(2)} body ${bodySim.toFixed(2)} tags ${sharedTags}`, score });
      }
    }
  }
  return out.sort((p, q) => q.score - p.score);
}

function editDistance(a: string, b: string): number {
  if (Math.abs(a.length - b.length) > 2) return 9;
  const dp = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) dp[0][j] = j;
  for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++)
    dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  return dp[a.length][b.length];
}
const normalizeArabic = (s: string) => s.replace(/[أإآ]/g, "ا").replace(/ة/g, "ه").replace(/ى/g, "ي").replace(/\s+/g, " ").trim();

/** Tags are people/teams/shows — near-identical spellings across articles are almost always the same name spelled two ways. */
export function findNameVariants(news: NewsFile[]): { a: string; b: string; countA: number; countB: number }[] {
  const counts = new Map<string, number>();
  for (const n of news) for (const t of n.tags) if (/[ء-ي]/.test(t) && t.length >= 6) counts.set(t, (counts.get(t) || 0) + 1);
  const names = [...counts.keys()];
  const out: { a: string; b: string; countA: number; countB: number }[] = [];
  for (let i = 0; i < names.length; i++) for (let j = i + 1; j < names.length; j++) {
    const a = names[i], b = names[j];
    const na = normalizeArabic(a), nb = normalizeArabic(b);
    const d = na === nb ? 0 : editDistance(na.replace(/ /g, ""), nb.replace(/ /g, ""));
    if (d <= 1 || (d === 2 && Math.min(na.length, nb.length) >= 10)) {
      if (/\d/.test(a + b)) continue;
      out.push({ a, b, countA: counts.get(a)!, countB: counts.get(b)! });
    }
  }
  return out;
}

async function cli() {
  const args = process.argv.slice(2);
  const days = Number(args[args.indexOf("--days") + 1]) || 0;
  const all = loadNews();
  const since = days ? Date.now() - days * 86400_000 : 0;
  const scope = all.filter(n => n.date >= since);
  const report = {
    scanned: scope.length,
    articles: scope.map(n => ({ file: n.file, title: n.title, issues: checkArticle(n.title, n.body, n.tags) })).filter(r => r.issues.length),
    duplicates: findDuplicates(all).filter(p => scope.some(n => n.file === p.a || n.file === p.b)),
    nameVariants: findNameVariants(all),
  };
  if (args.includes("--json")) { console.log(JSON.stringify(report, null, 2)); return; }
  const byCode = new Map<string, number>();
  for (const a of report.articles) for (const i of a.issues) byCode.set(`${i.severity}:${i.code}`, (byCode.get(`${i.severity}:${i.code}`) || 0) + 1);
  console.log(`Scanned ${report.scanned} articles; ${report.articles.length} with issues; ${report.duplicates.length} likely duplicate pairs; ${report.nameVariants.length} name variants.`);
  for (const [k, v] of [...byCode].sort((a, b) => b[1] - a[1])) console.log(`  ${k}: ${v}`);
  if (report.articles.some(a => a.issues.some(i => i.severity === "error")) || report.duplicates.length) process.exitCode = 1;
}
if (require.main === module) cli();
