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
import { collapseRepeatedNames } from "../lib/names.cjs";

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

/** The source's HTML entities («&#8220;», «&amp;», «&quot;») turned into the real characters (INCIDENTS #600).
 *  Only quotes, apostrophes, dashes, ellipsis, ampersand and non-breaking space: «&lt;»/«&gt;» stay (they may be real markup). */
export function decodeHtmlEntities(text: string): string {
  const named: Record<string, string> = { amp: "&", quot: '"', apos: "'", nbsp: " ", ldquo: "“", rdquo: "”", lsquo: "‘", rsquo: "’", ndash: "–", mdash: "—", hellip: "…" };
  return String(text)
    .replace(/&#(\d{2,5});/g, (m, n) => (+n === 60 || +n === 62 ? m : String.fromCodePoint(+n)))
    .replace(/&#x([0-9a-f]{2,5});/gi, (m, n) => (parseInt(n, 16) === 60 || parseInt(n, 16) === 62 ? m : String.fromCodePoint(parseInt(n, 16))))
    .replace(/&(amp|quot|apos|nbsp|ldquo|rdquo|lsquo|rsquo|ndash|mdash|hellip);/g, (_m, n) => named[n]);
}

/** Applies every wrong→right rule from editorial/corrections.json. Idempotent. */
export function applyCorrections(text: string, corrections = loadCorrections()): string {
  if (!text) return text;
  let out = decodeHtmlEntities(text);
  for (const c of corrections) {
    out = out.replace(correctionRegex(c), (_m, prefix = "") =>
      // "بـWWE SmackDown": a joined preposition before an English name takes a tatweel
      prefix && /^[A-Za-z]/.test(c.right) && !prefix.endsWith("و") ? `${prefix}ـ${c.right}` : `${prefix}${c.right}`);
    // a rule that deletes a phrase leaves a double space behind
    if (!c.right) out = out.replace(/(\S) {2,}(?=\S)/g, "$1 ");
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
const TATWEEL_PREFIXES = new Set(["ب", "ل", "ال", "وب", "ول", "فب", "فل", "لل", "بال", "وال", "كال", "ولل", "وبال"]);
const LEGIT_DOUBLES = new Set(["بانغ", "بانج", "دبليو", "دابليو", "أبدا", "أبداً", "ابدا", "جدا", "جداً", "كلا", "هيا"]);
// Ring names that ARE a doubled word — «كيلي كيلي», «بووم بووم», «زي زي» — come from the names
// glossary: the repeated-word fix turned «Kelly Kelly» into «كيلي» (INCIDENTS #138).
try {
  const names = JSON.parse(fs.readFileSync(path.join(process.cwd(), "scripts", "wrestler-names.json"), "utf-8")) as Record<string, string>;
  for (const v of Object.values(names)) for (const m of String(v).matchAll(/(?<!\S)(\S+)\s+\1(?!\S)/g)) LEGIT_DOUBLES.add(m[1]);
} catch { /* the glossary is optional here */ }
// How many different glossary wrestler names (Arabic spelling) a line holds; longest names are
// taken first so «تانك ليدجر» isn't also counted as «تانك».
let GLOSSARY_AR: string[] | null = null;
function glossaryNamesIn(line: string): number {
  if (!GLOSSARY_AR) {
    try {
      const names = JSON.parse(fs.readFileSync(path.join(process.cwd(), "scripts", "wrestler-names.json"), "utf-8")) as Record<string, string>;
      GLOSSARY_AR = [...new Set(Object.values(names).map(String).filter((v) => /^[\u0621-\u064A ]{5,}$/.test(v)))].sort((a, b) => b.length - a.length);
    } catch { GLOSSARY_AR = []; }
  }
  let rest = ` ${line} `, n = 0;
  for (const name of GLOSSARY_AR) {
    const re = new RegExp(`(?<![\\u0621-\\u064A])و?${name}(?![\\u0621-\\u064A])`);
    if (re.test(rest)) { n++; rest = rest.replace(re, " "); }
  }
  return n;
}
const SHOW_WORDS = "(?:العرض|عرض|عروض|WWE|AEW|TNA|RAW|Raw|SmackDown|NXT|Dynamite|Collision|Rampage|iMPACT|EVOLVE)";

const RULES: Rule[] = [
  { code: "tatweel_before_arabic", severity: "error", re: /\u0640(?=[\u0621-\u064A])|\u0640 +(?!ذا(?![\u0621-\u064A]))(?=[\u0621-\u064A])/g, message: "تطويل «ـ» (أو «ـ » بعدها مسافة) قبل اسم عربي («لـرويس»، «بـتايتشي») — التطويل بيتكتب بس قبل الاسم الإنجليزي (بـWWE)", fields: ["title", "body", "tags"] },
  { code: "show_feminine_adjective", severity: "error", re: /عرض\s+(?:[A-Za-z0-9'’!.&*-]+\s+){0,5}[A-Za-z0-9'’!.&*-]+\s+(?:الأخيرة|الاخيرة|القادمة|الماضية)(?![\u0621-\u064A])/g, message: "«عرض» مذكر: «عرض RAW الأخير/القادم» مش «الأخيرة/القادمة» (INCIDENTS #621)" },
  { code: "verbless_opening", severity: "error", re: /(?:^|\n)\s*عرض\s+(?:اتحاد|شركة)\s+[^\n.،]{2,40}?\s+أحدث\s+(?:عرض|حلقة)\s+من/g, message: "جملة افتتاحية من غير فعل («عرض اتحاد X أحدث عرض من…») — ابدأ بفعل: «قدم اتحاد X أحدث حلقة من…» (INCIDENTS #783)", fields: ["body"] },
  { code: "persian_letters", severity: "error", re: /[گکیپچژڤ]/g, message: "حروف فارسية بدل العربية" },
  { code: "glued_latin_arabic", severity: "error", re: new RegExp(`[A-Za-z][${AR}]|[${AR}]{2}[A-Za-z]|(?<![${AR}])[بلك](?=[A-Z]{2,})`, "g"), message: "حرف عربي ملزوق بكلمة إنجليزية (مثل: AEW Liveة، بWWE — اكتب «في WWE» أو «لـ WWE»)" },
  { code: "glued_prefix_quote", severity: "error", re: new RegExp(`(?<![${AR}])[بلك]["“«](?=[${AR}])`, "g"), message: "حرف جر ملزوق بعلامة اقتباس (ب\"الصدمة\") — اكتب «بالصدمة» بدون اقتباس أو الاقتباس كله بين علامتين" },
  { code: "broken_word", severity: "error", re: /(?<![ء-ي\w])(?:ص|ث|ج|ح|خ|ذ|ز|ش|ض|ط|ظ|غ|ق|ك)(?![ء-ي\w])(?=\s+(?:من|في|على|عن|إلى|الى)\s)/g, message: "كلمة مكسورة: حرف عربي واحد لوحده (غالبا «ص» بدل «صورة»)", fields: ["title", "body"] },
  { code: "broken_word", severity: "error", re: /(?<![ء-ي])(?:أنها|أنه|إنها|إنه|بأنها|بأنه|وأنها|وأنه)\s+لست(?![ء-ي])/g, message: "نحو: «لست» مع ضمير الغائب — الصح «ليست/ليس»", fields: ["title", "body"] },
  { code: "broken_word", severity: "error", re: /(?<![ء-ي])[ء-ي]{2,}يتة(?![ء-ي])/g, message: "كلمة مكسورة: «…يتة» (تاء زيادة — مثل «احترافيتة» بدل «احترافيته/احترافيتها»)", fields: ["title", "body"] },
  { code: "broken_word", severity: "error", re: /(?<![ء-ي])وة(?![ء-ي])/g, message: "كلمة مكسورة: «وة» لوحدها (غالبا «و» + ترجمة مقطوعة لاسم — مثل «هانك وة تانك» بدل «هانك وتانك»)", fields: ["title", "body"] },
  { code: "detached_prefix", severity: "error", re: new RegExp(`(?:^|\\s)[لب]\\s+(?=[${AR}])`, "g"), message: "حرف جر منفصل عن الكلمة (مثل: ل زينا)" },
  { code: "repeated_word", severity: "error", re: new RegExp(`(?<![${AR}])([${AR}]{4,})\\s+\\1(?![${AR}])`, "g"), message: "كلمة مكررة مرتين متتاليتين" },
  { code: "repeated_word_waw", severity: "error", re: new RegExp(`(?<![${AR}])(?:لل|ال|بال|كال)(?!كثير|نهائي|قمصان)([${AR}]{3,})\\s+وال\\1(?![${AR}])`, "g"), message: "نفس الكلمة مكررة حوالين «و» («للدعم والدعم المعنوي») — اشطب التكرار" },
  { code: "forbidden_term", severity: "error", re: new RegExp(`${arBoundL}(?:ال)?(?:مهرجان|يستذكر)${arBoundR}|${arBoundL}(?:ال)?حلق(?:ة|ات)\\s+${SHOW_WORDS}|${SHOW_WORDS}\\s+(?:ال)?حلق(?:ة|ات)${arBoundR}`, "g"), message: "مصطلح ممنوع (حلقة العرض/مهرجان/يستذكر) — المعتمد: عرض، يتذكر" },
  // A sentence that ends right on the verb of speech: «…لم يره الجمهور بالكامل بعد، وقال.» — the quote was lost (INCIDENTS #535)
  // A story must open with its first sentence, not a bold/markdown heading line («**المواجهة الأولى: نزال فرق للسيدات**» opened the Sisters of Sin story — INCIDENTS #558)
  { code: "stray_heading", severity: "error", re: /^\s*(?:\*\*[^*\n]{3,90}\*\*|#{1,6}\s[^\n]*)[ \t]*(?:\n|$)/, message: "الخبر بيبدأ بسطر عنوان فرعي (** أو #) بدل أول جملة", fields: ["body"] },
  { code: "dangling_speech", severity: "error", re: /(?<![ء-ي])(?:و|ف)?(?:قال|قالت|أضاف|أضافت|تابع|تابعت|أكد|أكدت|أوضح|أوضحت|وصف|وصفت|كتب|كتبت)(?:\s*:(?!\s*[>"«“])|)\s*(?:\.|$)/gm, message: "جملة بتخلص عند «وقال.» بلا كلام — الاقتباس ضاع، شيل الجملة أو كمّلها", fields: ["body"] },
  // A quote opened with no «, or closed with no »: "> لم يكن ينبغي… مناسبا»." — one half of the pair was dropped (INCIDENTS #500)
  { code: "unbalanced_guillemets", severity: "error", re: /^[^«»\n]*[«»][^«»\n]*$/gm, message: "علامة اقتباس « أو » من غير زوجها — افتح وقفّل الاقتباس", fields: ["body"] },
  // Straight quote marks glued to the «» pair: «معلقا عليها بقوله: "«من الجيد العودة»"» — the reader sees doubled marks.
  { code: "doubled_quote_marks", severity: "error", re: /["“”]\*?«|»\*?["“”]/g, message: "علامة تنصيص \" ملزوقة في «» (حصل: \"«من الجيد»\") — استخدم «» بس", fields: ["body"] },
  // A quote run into the narration with no «»: «وأضاف: أنا سعيد بأن لدي هذا المقطع…» — the reader can't
  // tell where his words stop and ours start, and the writer then pinned his dream on Copeland (INCIDENTS #349).
  { code: "unquoted_quote", severity: "error", re: /(?<![؀-ۿ])(?:و?(?:أضاف|أضافت|قال|قالت|تابع|تابعت)|قائلا|قائلة|مضيفا|مضيفة)\s*:\s*(?:أنا|إنني|إني|لقد|نحن|كنت|شعرت|أعتقد|أعرف|لا أعرف|أنا سعيد)(?![؀-ۿ])/g, message: "اقتباس من غير علامات «» بعد «وأضاف:» — حط كلام الشخص بين «»", fields: ["body"] },
  // A quote block left in English inside the Arabic story — the wife's three paragraphs about Jeff Cannonball,
  // Chad Gable's whole answer (half of it with Arabic words dropped in the middle), West's tweet (INCIDENTS #376).
  // 6 English words in a row inside a «> » line; names, show titles and hashtags are shorter than that.
  { code: "english_quote", severity: "error", re: /^>[^\n]*?(?<![A-Za-z'’])(?:[A-Za-z][A-Za-z'’]+[\s,.;:!?—-]+){6,}[A-Za-z][A-Za-z'’]+/gm, message: "اقتباس بالإنجليزي جوه الخبر العربي — لازم يتترجم للعربي", fields: ["body"] },
  { code: "game_terms", severity: "error", re: /مجريات اللعب|المباراة الكروية|الشوط (?:الأول|الثاني)|أرض الملعب/g, message: "تعبير رياضي غير مناسب للمصارعة (المعتمد: مجريات النزال)" },
  // A word the model broke in two scripts: «شخصية أك uma الشهيرة» (Akuma — INCIDENTS #143). Latin names in
  // the text are capitalised (WWE, SiriusXM); a short lowercase fragment glued after Arabic is a broken word.
  // A big number written out in words is where the model gets the number wrong: «ألفا وخمسمائة وواحدا
  // وخمسين دولارا وفلسين» for $1,501.51 (INCIDENTS #188). Amounts and years stay in digits.
  { code: "spelled_number", severity: "error", re: /(?<![\u0600-\u06FF])(?:ألفين|ألفا|ألف)\s+و(?:مائة|مئة|مائتين|ثلاثمائة|أربعمائة|خمسمائة|ستمائة|سبعمائة|ثمانمائة|تسعمائة|ستة|سبعة|خمسة|أربعة|ثلاثة|تسعة|ثمانية|اثنين|واحد|عشرة|عشرين|ثلاثين|أحد|اثني)|(?<![\u0600-\u06FF])(?:مئتي|مائتي)\s+(?:يوم|أسبوع|شهر|مرة)|(?<![\u0600-\u06FF])(?:فلسين|فلسا|سنتا|سنتات)(?![\u0600-\u06FF])|(?<![\u0600-\u06FF])(?:(?:واحد|اثنين|ثلاثة|أربعة|خمسة|ستة|سبعة|ثمانية|تسعة)\s+و)?(?:ال)?(?:عشرين|ثلاثين|أربعين|خمسين|ستين|سبعين|ثمانين|تسعين)\s+(?:عاما|عامًا|عام|سنة)(?![\u0600-\u06FF])/g, message: "رقم كبير أو سنة أو سن أو مبلغ مكتوب بالحروف — يتكتب بالأرقام زي المصدر", fields: ["title", "body"] },
  // \u00AB\u0641\u064A \u0627\u0644\u062A synergies \u0627\u0644\u0633\u0646\u0648\u064A\u0629\u00BB \u2014 a 9-letter fragment slipped past the old {2,8} limit (INCIDENTS #303)
  { code: "number_word_digits", severity: "error", re: /(?<![\u0621-\u064A])[لبوفك]?(?:أحد عشر|إحدى عشرة|اثنا عشر|اثني عشر|اثنتا عشرة|ثلاثة عشر|أربعة عشر|خمسة عشر|ستة عشر|سبعة عشر|ثمانية عشر|تسعة عشر|عشرين|ثلاثين|أربعين|خمسين|ستين|سبعين|ثمانين|تسعين|مئة|مائة|عشرة|ثلاثة|أربعة|خمسة|ستة|سبعة|ثمانية|تسعة) \d/g, message: "كلمة رقم عربية قدام رقم بالأرقام (مثل: أحد عشر 1000) — اكتب الرقم مرة واحدة", fields: ["title", "body"] },
  // alif wasl dropped after «ال»: «القتناع» ← «الاقتناع» (the writer glued ال to a word that starts with a hidden alif) — INCIDENTS #499
  { code: "dropped_alef", severity: "error", re: /(?<![ء-ي])[لبوفك]?ال(?:قتناع|ستخدام|ستمرار|نتصار|نتقال|نتظار|جتماع|حتفال|ختيار|عتماد|ستعداد|نسحاب|نضمام|ستقالة|ستثناء|ستقرار|ستقبال|رتباط|نطلاق|نتهاء|عتراف|عتذار|فتتاح|ستسلام|ستحقاق|نفجار|نقسام|ستلام)(?![ء-ي])/g, message: "ألف الوصل ساقطة بعد «ال» (القتناع ← الاقتناع)", fields: ["title", "body"] },
  { code: "broken_word", severity: "error", re: /(?<=[\u0600-\u06FF]) (?!vs\b)(?:[a-z]{2,14})(?=[\s،,.؛:!؟?)]|$)(?! [A-Za-z])/g, message: "كلمة مكسورة: حروف إنجليزي صغيرة ملزوقة في كلمة عربي", fields: ["title", "body"] },
  // Two Arabic words run together with no space: «ترقب جماهيريدائم» (INCIDENTS #680). A nisba ending in ي glued to a common adjective/noun.
  // A dual pronoun glued to the next word, as Gemini wrote «العداوة المستمرة بينهمامستمرة بينهم» (INCIDENTS #740)
  { code: "glued_arabic_words", severity: "error", re: /(?<![\u0600-\u06FF])(?:بينهما|عليهما|منهما|عنهما|معهما|فيهما|ضدهما)[\u0621-\u064A]{3,}(?![\u0600-\u06FF])/g, message: "كلمتين عربي ملزوقين من غير مسافة (مثل: بينهمامستمرة)", fields: ["title", "body"] },
  { code: "glued_arabic_words", severity: "error", re: /(?<![\u0600-\u06FF])[\u0621-\u064A]{2,}ي(?:دائم|مستمر|كبير|كامل|واسع|ضخم|هائل|مثير|قوي|رسمي|مباشر|مفاجئ)(?![\u0600-\u06FF])/g, message: "كلمتين عربي ملزوقين من غير مسافة (مثل: جماهيريدائم)", fields: ["title", "body"] },
  // «أعلن توني خان رسمي عن» / «وقع عقدا رسمي» — the adverb «رسميا» lost its alif (an auto-learned rule did it to 450 stories, INCIDENTS #789/#790). After a verb or an accusative noun it is always «رسميا».
  { code: "adverb_without_alef", severity: "error", re: /(?<![\u0621-\u064A])(?:[وفلب]?(?:أعلن|أعلنت|أعلنوا|يعلن|تعلن|ويعلن|ليعلن|ينضم|انضم|انضمت|تنضم|وانضم|وتنضم|وقع|وقعت|توقع|يوقع|عاد|تعود|يعود|الإعلان)(?: [\u0621-\u064A]+){0,2}|[\u0621-\u064A]{3,}ا)(?<! [وبلك]?(?:إعلان|بيان|تأكيد|عقد|توضيح|ظهور|نفي|تعليق|طلب|رد|تصريح|حساب|موقع|بشكل|توقيع|اتفاق|موعد|قرار|اعتذار|منشور|فيديو|دعوة)) رسمي(?= (?:عن|إلى|على|مع|في|بعد|عبر)(?![\u0621-\u064A]))/g, message: "«رسميا» اتكتبت «رسمي» من غير ألف", fields: ["title", "body"] },
  // «Wrestling» spelled in Arabic letters inside a promotion/show name («تبرانس ساوث ورايتسلينغ», «برو ريسلينغ إيف»): promotion names stay in English (INCIDENTS #687).
  { code: "arabic_wrestling_name", severity: "error", re: /(?<![\u0600-\u06FF])[وبلفك]?(?:رايتسلينغ|رايستلينغ|ريستلينغ|ريسلينغ|ريسلنغ|رسلينغ)(?![\u0600-\u06FF])/g, message: "اسم اتحاد أو برنامج فيه Wrestling مكتوبة بحروف عربي (لازم بالإنجليزي)", fields: ["title", "body"] },
  { code: "artifact", severity: "error", re: /\bundefined\b|\bNaN\b|\[object Object\]|\{\{|\}\}|```|\\n|&amp;|&quot;|&#\d+;/g, message: "بقايا كود أو رموز غير مفهومة", fields: ["title", "body"] },
  // Gemini sometimes swaps one letter of a name for a look-alike from another script:
  // «وパاتريك» (Japanese), «ناтан» (Cyrillic), «مصارعة חברה» (Hebrew tag) — INCIDENTS #54.
  { code: "foreign_script", severity: "error", re: /[\u0370-\u03FF\u0400-\u058F\u0590-\u05FF\u0900-\u0DFF\u0E00-\u0E7F\u1000-\u109F\u10A0-\u10FF\u1200-\u137F\u3040-\u30FF\u3400-\u9FFF\uAC00-\uD7AF]+/g, message: "حروف من لغة أخرى (يابانية/روسية/عبرية/بورمية...) داخل النص" },
  { code: "ai_leak", severity: "error", re: /كنموذج ذكاء|بصفتي نموذج|as an AI|I cannot|here is the|ترجمة:|النص المترجم|body_markdown|"title"\s*:/gi, message: "نص تسرب من رد الذكاء الاصطناعي" },
  // Not blocking (ai_leak is): the copy editor removes it — «خلال إضافة علامات التنصيص… كما في المصدر» (INCIDENTS #254)
  { code: "echoed_instruction", severity: "error", re: /علامات التنصيص|كما (?:في|ورد في) المصدر/g, message: "تعليمات للكاتب اتنقلت جوه النص — احذفها", fields: ["title", "body"] },
  { code: "editor_note", severity: "error", re: /(?:^|\n)[ \t]*(?:تبسيط|تعديل|تصحيح|حذف|إضافة|تغيير|تحسين|توحيد|ضبط)\s+[^\n]{0,80}(?:لتتوافق|ليتوافق|لتطابق|بما يتوافق|معيار|الفصحى|دون زيادات|عبارة الختم|الصياغة المعتمدة)[^\n]*/g, message: "ملاحظة المحرر لنفسه اتكتبت كفقرة في الخبر — احذفها", fields: ["body"] },
  { code: "empty_brackets", severity: "error", re: /\(\s*\)|\[\s*\]|«\s*»|""/g, message: "أقواس أو علامات تنصيص فاضية" },
  { code: "english_jargon", severity: "error", re: new RegExp(`[${AR}]\\s+(?:segment|promo|promoter|heel|babyface|face turn|heel turn|feud|spot|push|booking|booker|squash|botch|kayfabe|go-home|angle|storyline|run-in|pop|heat|tag team|finisher|jobber|mic skills|main event|midcard|house show)\\b|(?<!عرض|TNA)\\s+impact\\s+(?=ال)|\\b(?:segment|promo|heel|babyface|feud|booking|squash|botch|kayfabe|go-home|storyline)\\s+[${AR}]`, "gi"), message: "مصطلح مصارعة إنجليزي داخل جملة عربية (مثل segment ← فقرة، promo ← خطاب/حوار)", fields: ["title", "body"] },
  { code: "english_title_name", severity: "error", re: new RegExp(`[${AR}]\\s+(?:[A-Z][A-Za-z']+\\s+){0,4}(?:Championships?(?!\\s+Wrestling)|Titles?)\\b`, "g"), message: "اسم لقب بالإنجليزي داخل النص (يُكتب بالعربية: بطولة العالم للوزن الثقيل...). أسماء الدورات (Cup/Classic/Tournament) تبقى بالإنجليزي", fields: ["title", "body"] },
  { code: "glossary_artifact", severity: "error", re: /بطلة? \((?:الاتحاد|العالمي|العالم|القارات|الأمريكي|أمريكا الشمالية|إن إكس تي|سبيد|الاتحاد للفرق|العالمي للفرق|إن إكس تي للفرق|إيفولف|إيفولف للفرق|دبليو دبليو إن)\)/g, message: "اسم بطولة مكسور من القاموس القديم مثل «بطل (الاتحاد)» — يُحذف أو يُكتب اسم البطولة الصحيح (بطولة WWE، بطولة العالم للوزن الثقيل...)", fields: ["title", "body"] },
  { code: "truncated_word", severity: "error", re: /(?<=^|\s)[ءآأؤإئاتثجحخدذرزسشصضطظعغقمنهةى](?=\s)/g, message: "حرف منفرد — كلمة مبتورة (حصل: «ق ليحكم»، «تضرب الح للمرة»)", fields: ["title", "body"] },
  { code: "draw_as_winner", severity: "error", re: /الفائز(?:ة|ان|تان|ون|ين|ات)?:\*{0,2}\s*(?:انتهى|انتهت|انتهاء|لا\s+يوجد|لا\s+فائز|بلا\s|بدون\s|تعادل|التعادل|النزال\s+(?:انتهى|بلا))[^\n]*/g, message: "سطر «الفائز» فيه تعادل أو «بلا نتيجة» — اكتبه «🤝 **النتيجة:** …» (حصل: «الفائز: انتهى النزال بالتعادل»)", fields: ["body"] },
  { code: "vague_result", severity: "error", re: /الفائز(?:ة|ان|تان|ون|ين|ات)?:\*{0,2}\s*(?:تم\s+حسم|تحديد|حسم\s+النتيجة|غير\s+معروف|لم\s+يتم|لم\s+يحسم|قيد\s+الانتظار|بانتظار|سيتم|يحدد\s+لاحقا|انتهى\s+الحدث|انتهت\s+الأحداث|[^\n]{0,25}وسط\s+أجواء)[^\n]*/g, message: "سطر «الفائز» بلا اسم — نتيجة مخترعة أو ناقصة (حصل: «تم حسم النتيجة وتحديد الفائز في أجواء تنافسية»)", fields: ["body"] },
  // Filler that stands in for a missing fact — «حيث تخوض داكوتا كاي خطواتها القادمة» when the source said «last wrestled in April» (INCIDENTS #293)
  { code: "vague_filler", severity: "error", re: /(?:ت|ي)خوض(?:ان)?\s+(?:[ء-ي]+\s+){0,3}خطوات(?:ها|ه|هما)\s+(?:القادمة|المقبلة|التالية)/g, message: "جملة حشو مبهمة مكان واقعة — اكتب اللي قاله المصدر بالظبط (حصل: «تخوض داكوتا كاي خطواتها القادمة» والمصدر: آخر نزال لها في أبريل)", fields: ["title", "body"] },
  // The reporter's name is scrubbed to «تقارير صحفية» but his first-person «he asked / he checked» stays — «أكدت تقارير صحفية مطلعة أنه تحرى عن وضع هوليداي» (INCIDENTS #333)
  { code: "scrubbed_reporter_pronoun", severity: "error", re: /تقارير\s+صحفية(?:\s+مطلعة)?\s+(?:ب?[أإا]نه|ب?[أإا]نها)\s+(?:تحرى|تحرّى|سأل|استفسر|تواصل|تحقق|علم|اطلع|اتصل|تحدث)/g, message: "اسم الصحفي اتشال وفضل ضميره («تقارير صحفية أنه تحرى») — الجملة مش مفهومة، اكتب الواقعة من غير ضمير الصحفي (مثلا: «وبحسب تقارير صحفية مطلعة، فإن...»)", fields: ["title", "body"] },
  // The scrubbed reporter placeholder stuck after a job word — «مع الصحفي تقارير صحفية مطلعة» (INCIDENTS #498)
  { code: "scrubbed_reporter_role", severity: "error", re: /(?:الصحفي|الصحفية|المراسل|المراسلة|الكاتب|المحلل)\s+تقارير\s+صحفية/g, message: "اسم الصحفي اتشال وفضلت كلمة «الصحفي» قبل «تقارير صحفية» — اكتب «تقارير صحفية مطلعة» من غير «الصحفي»", fields: ["title", "body"] },
  // American football: a touchdown is «تاتشداون», never «هدف» (INCIDENTS #498)
  { code: "touchdown_as_goal", severity: "error", re: /(?:بتسجيل|سجل|سجلت|بإحراز|أحرز|أحرزت)\s+(?:هدفين|هدفا|أهداف\w*|هدفه|هدفيه)\s+(?:خلال|في|ضد)\s+مواجهة\s+فريقه/g, message: "touchdown في الكرة الأمريكية يتكتب «تاتشداون» مش «هدف»", fields: ["title", "body"] },
  // A multi-word name listed twice in a row — «ويل أوسبراي وهينيرا وغريت أو خان وغريت أو خان» (INCIDENTS #294)
  { code: "doubled_name", severity: "error", re: /(?:(?<![ء-ي])|(?<=(?<![ء-ي])و))((?:[ء-ي]+\s+){1,3}[ء-ي]+)\s+و\1(?![ء-ي])(?!\s*(?:الثاني|الثانية|جونيور|جونير|سينيور|الابن|II|2)(?![ء-ي]))/g, message: "اسم مكتوب مرتين ورا بعض — اكتب أعضاء الفريق زي المصدر (حصل: «غريت أو خان وغريت أو خان»)", fields: ["title", "body"] },
  // «خلال عرض WWE RAW في عرض WWE RAW بتاريخ 21 سبتمبر» — the show named twice in one breath (INCIDENTS #299)
  { code: "doubled_show_phrase", severity: "error", re: /عرض\s+((?:[A-Za-z0-9'’-]+\s+){0,3}[A-Za-z0-9'’-]+)\s+(?:في|خلال|ب)\s*عرض\s+\1(?![A-Za-z0-9])/g, message: "اسم العرض مكرر في نفس الجملة — اكتبه مرة واحدة (حصل: «خلال عرض WWE RAW في عرض WWE RAW»)", fields: ["title", "body"] },
  // «تواجه كل من كراتوس روميو كيفيدو في نزال» — the «و» between the two names dropped (INCIDENTS #301)
  { code: "kol_min_no_waw", severity: "error", re: /كل\s+من\s+(?:(?!و)[ء-ي]+\s+){2,4}في\s+نزال/g, message: "«كل من» بعدها اسمين من غير «و» بينهم (حصل: «تواجه كل من كراتوس روميو كيفيدو» والصح «كراتوس وروميو كيفيدو»)", fields: ["title", "body"] },
  // «فى فيلم»، «الذى دفعه»، «لقاء صحفى» — ى مكان ي في آخر الكلمة (INCIDENTS #303)
  { code: "alif_maqsura_ya", severity: "error", re: /(?<![ء-ي])(?:فى|الذى|التى|صحفى|عربى|الثنائى|الثلاثى|الرباعى|التاريخى|الرسمى|حوارى|جوهرى|نارى|الدولى|المحلى|العالمى|الأسبوعى|الاسبوعى|الإعلامى|الاعلامى|الأمريكى|الامريكى|الشخصى|المهنى|الرئيسى|الحقيقى|النهائى)(?![ء-ي])/g, message: "ى مكان ي (حصل: «فى WWE»، «الذى»، «صحفى»، «الثنائى»، «التاريخى») — الصح «في»، «الذي»، «صحفي»، «الثنائي»، «التاريخي» (INCIDENTS #594)", fields: ["title", "body"] },
  // «خلال استضافتها في برنامج أن المخطط…» — the show/podcast name was dropped and the sentence has no name after «برنامج» (INCIDENTS #594)
  { code: "dropped_show_name", severity: "error", re: /(?<![ء-ي])(?:في|خلال|عبر|على)\s+(?:برنامج|بودكاست)\s+(?:أن|إن|حيث|التي|الذي)(?![ء-ي])/g, message: "«في برنامج» وبعدها مباشرة «أن/حيث» — اسم البرنامج اتشال (حصل: «استضافتها في برنامج أن المخطط»). اكتب اسم البرنامج من المصدر أو احذف «في برنامج»", fields: ["title", "body"] },
  // Latin letters glued to an Arabic stem that is not a prefix: «يOH» (for YOH), «نagai», «إيفيs» — a name half-transliterated (INCIDENTS #438)
  { code: "mixed_script_word", severity: "error", re: /(?<![ء-ي])(?!(?:و|ب|ل|ك|ف|ال|لل|وال|بال|كال|فال|وب|ول|وبال|ولل|فب|فل|وس|س)\u0640?(?=[A-Za-z]))[ء-ي]+(?=[A-Za-z])/g, message: "حروف عربي ملزوقة في حروف إنجليزي جوه نفس الاسم (حصل: «يOH»، «نagai») — اكتب الاسم كله إنجليزي أو كله عربي", fields: ["title", "body"] },
  // Noun duals the verb-dual check above does not see: «إضافة نزالين»، «مواجهتين» (INCIDENTS #438)
  { code: "punt_kick_wording", severity: "error", re: /(?<![ء-ي])[وفبلك]?(?:ال)?ركلة\s+(?:ال)?(?:قاضية|مباشرة)(?![ء-ي])|(?<![ء-ي])[وفبلك]?(?:ال)?بانت\s+(?:ال)?قاضية(?![ء-ي])|ضربة\s+قاضية\s+باستخدام/g, message: "Punt Kick تتكتب «ركلة البانت» — مش «الركلة القاضية/المباشرة» (الضربة القاضية = KO)", fields: ["title", "body"] },
  { code: "dual_noun", severity: "error", re: /(?<![ء-ي])(?:[وفبلك]?(?:ال)?|لل)(?:نزال(?:ين|ان)|مواجهت(?:ين|ان)|لقب(?:ين|ان)|حدث(?:ين|ان)|عرض(?:ين|ان)|مباراتين|مباراتان|بطولت(?:ين|ان)|تاتشداون(?:ين|ان)|فوزين|انتصارين|هزيمتين|ضربتين|ظهور(?:ين|ان)|فريق(?:ين)|فريقي(?=\s)|أخ(?:وين|وان)|شقيق(?:ين|ان)|طاولت(?:ين|ان)|جولت(?:ين|ان)|ليلتا|ليلتان|ليلتين|اثنتين|الاثنتين|عضوت(?:ين|ان)|نجمت(?:ين|ان)|مصارعت(?:ين|ان)|خصمت(?:ين|ان)|شخصيت(?:ين|ان)|مرحلت(?:ين|ان)|درجت(?:ين|ان)|فترت(?:ين|ان)|طفل(?:ين|ان)|طفلت(?:ين|ان)|ولد(?:ين|ان)|ابن(?:ين|ان)|ابنت(?:ين|ان)|مشجع(?:ين|ان)|شخص(?:ين|ان)|حلقت(?:ين|ان)|ركلت(?:ين|ان)|حركت(?:ين|ان)|صديق(?:ين|ان)|صديقت(?:ين|ان)|ممثلت(?:ين|ان)|ممثلان|شقيقت(?:ين|ان)|زميلت(?:ين|ان)|منافست(?:ين|ان)|تسجيل(?:ين|ان)|يومي(?=\s+\d)|عضوتي(?=\s+(?:فريق|ال))|عضوي(?=\s+(?:فريق|ال)))(?![ء-ي])/g, message: "اسم مثنى (نزالين/مواجهتين/لقبين…) ممنوع — قول «نزالات» أو «نزال فرق ونزال سيدات» أو العدد (2)", fields: ["title", "body"] },
  // Sportsbook ad copy («UFC 333 odds courtesy of MyBookie») is an advert, not news — never publish a story that promotes a betting site.
  { code: "betting_promo", severity: "error", re: /(?<![A-Za-z])(?:MyBookie|MyBookkie|BetOnline|Bovada|DraftKings|FanDuel|BetMGM|Stake\.com|1xBet)(?![A-Za-z])|برعاية\s+(?:موقع\s+)?(?:مراهنات|رهانات)/gi, message: "خبر ترويجي لموقع مراهنات (MyBookie…) — مش خبر", fields: ["title", "body"] },
  // «2 عرض متتاليين» (the RAW 6pm story): the digit 2 before a singular noun is a dual in disguise, and «متتاليين» is a dual adjective.
  { code: "dual_noun", severity: "error", re: /(?<![\d.\/:-])2\s+(?:عرض|نزال|لقب|مباراة|مصارع|فريق|حدث|ليلة|مواجهة)(?![ء-ي])|(?<![ء-ي])(?:متتالي(?:ين|ان)|منفصل(?:ين|ان)|مختلف(?:ين|ان))(?![ء-ي])/g, message: "مثنى مقنّع (2 عرض / متتاليين) ممنوع — اكتب الجملة بشكل تاني (سيقام عدة عروض / عروض متتالية)", fields: ["title", "body"] },
  { code: "dual_form", severity: "error", re: /(?<![ء-ي])(?:اللذان|اللذين|اللتان|اللتين|قاما|واصلا|(?<!جي\s)فازا|حققا|(?:ي|ت|سي|ست)(?:واجه|شارك|ستعد|خوض|نضم|لتق|ظهر|تنافس)ان|قدما(?=\s+(?:دعم|(?!عندما|بعدما|حينما|بينما|مثلما|كلما|ربما|حيثما|طالما)[ء-ي]+ا\s))|(?:ي|ت)(?:فوز|حتفظ|هزم|تغلب|نجح|تعاون|دخل|عود|علن|حصل|خسر|تأهل|نتصر|ستعيد|دافع|توج)ان|(?:ل|[وف])?(?!تدخلا)(?:ت)?(?:احتفظ|تغلب|هزم|نجح|توج|دخل|عاد|تعمد)(?:ا|تا)|(?:فازتا|حققتا|واصلتا)|(?:ال|ب)?بطلت(?:ين|ان)|بطلتا(?=\s)|بطلا\s+(?:العالم|الفرق|الزوجي)|حاملت(?:ي|ا)\s+(?:ال|لقب)|(?:[بلوفك]|وب|ول|فب|فل)?اتحادي(?=\s)|اتحادا(?=(?:\s+[ء-ي]+){1,3}\s+و(?!أن|إن|ان|لم|لا|لن|ما|هو|هي|كان|قد|كل|بين)[ء-ي])|أجريتا|أجرتا|[ء-ي]{2,}تيهما|(?:و|ف)?(?:عرفا|كشفا|شاركا|أكدا|هزما|خسرا|دخلا|عادا|نجحا|حصلا|وصلا)(?=\s)|(?:ال)?(?:نجمان|ثنائيان|مصارعان|فريقان|خصمان|بطلان|طريقيهما)|حياتهما|(?:ل)?صالحهما|(?:ب|و|ف)?(?:بينهما|عليهما|معهما|عنهما|إليهما|فيهما)|خاضا|ارتديا|(?:ي|س)?يرتديان|ليقحما|نفسيهما|مواجهتهما|أنهما|كلاهما|كليهما|كلتاهما|كليكما|كلاكما|[ء-ي]{3,}تهما)(?![ء-ي])/g, message: "صيغة مثنى (اللذان/اللذين/حققا/واصلا/يواجهان/يحتفظان/تفوزان/البطلتين/حاملتي...) ممنوعة — اجمع الفعل والضمير (اللي، حققوا، واصلوا، يواجهون) أو كرر الاسم", fields: ["title", "body"] },
  // Past/present dual verbs the list above missed: «ظهرا للمرة الأولى»، «تحالفا مع»، «تنافسا»، «يتأهلان» (Kofi/Creed story, INCIDENTS #540).
  // «ظهرا» also means «at noon» («الساعة 2 ظهرا في…») — only the verb sense (followed by للمرة/معا/مع…) is flagged.
  { code: "dual_form", severity: "error", re: /(?<![ء-ي])(?:و|ف)?(?:ظهرا(?=\s+(?:للمرة|معا|سويا|مع\s|بجانب|ضمن))|(?:اشتكيا|اشتكتا|يكونا|تكونا|بقيا(?=\s)|ظلا(?=\s)|حققاها|حققاه|سمعاها|سمعاه|سمعاهم|انضما(?=\s)|اشتهرا(?=\s)|كانا(?=\s)|كانتا(?=\s)|قالا(?=\s)|أضافا|تحدثا|شاهدا|لاحظا|تلقيا|تحالفا(?=\s+مع\s)|تنافسا(?=\s+(?:على|ضد|مع|في)\s)|التقي(?:ا|تا)|التقتا|تزوجا|قررا|احتفظا|غادرا|تواجه(?:ا|تا)|أصبحا|اختارا|أعلنا|يتواجهان|الاثنان|يعرفان|يخوضان|يتقاسمان|يجمعان|يتشاركان|يشتركان|يحاولان|يقدمان|يسعيان|يملكان|يمتلكان|يتمتعان|يمثلان|يبدوان|يعتبران|يطمئنان|(?:ي|ت)(?:حقق|سجل|واصل|جذب|تصدر|حصد|تجاوز|كمل|ستمر|ستحوذ|حتل|صنع|قدم|ضم|تخطى|بلغ|رتفع|نخفض|تراجع)ان|(?:ال)?عرضا(?=\s+[A-Za-z])|يمتلكا|يحملان|يتبادلان|يقودان|يريدان|يلتقيان|يستعدان|يتأهلان|يدافعان|(?:ي|ت)(?:علق|تحدث|عبر|شكر|رد|ؤكد|صرح|كشف|ناقش|علن|روي|ستعرض|وجه|نشر|شيد|حتفل)ان|يعملان|يشاركان|ترتبطان|تصبحان|تستعدان|تتواجهان|تلتقيان|تشاركان|تتنافسان|تستمران|تواجهان|تظهران|تتحديان|تتحدان|دفعاه|دفعاها|دفعاهم|دفعتاه|جعلاه|جعلاها|جعلتاه|تسببا(?=\s+في)|تسببتا(?=\s+في)|ساهمتا|ساهما(?=\s+في)|تراجعا(?=\s+عن)|تراجعتا(?=\s+عن)|(?:ل|ف|و)?يقررا|(?:س|ل|ف|و)?يتحالفان|(?:س|ل|ف|و)?تتحالفان|(?:س|ل|ف|و)?يتحدان|(?:س|ل|ف|و)?يتعاونان)(?![ء-ي]))/g, message: "فعل مثنى (ظهرا/تحالفا مع/التقيا/يتأهلان…) ممنوع — اجمع الفعل (ظهروا، تحالفوا، يتأهلون) أو كرر الاسم", fields: ["title", "body"] },
  // Dual verbs and the dual verb with a pronoun glued on, which the lists above miss: «يقدمانها»، «يخوضانه»، «انتقدا»، «يخططان»، «واتفقا»، «أنهيا» (INCIDENTS #812)
  { code: "dual_form", severity: "error", re: /(?<![ء-ي])(?:(?:ي|ت)(?:قدم|خوض|خطط|نتقد|طلب|واجه|شارك|عمل|لعب|حقق)ان(?:ه|ها|هم|ته|تها)?|[وف]?(?:انتقدا|أعجبا|ابتكرا|اتفقا|اختلفا|أنهيا|أكملا|وافقا|بدأا))(?![ء-ي])/g, message: "صيغة مثنى (يقدمانها/يخوضانه/انتقدا/اتفقا/أنهيا…) ممنوعة — اكتب الأسماء بفعل جمع أو أعد صياغة الجملة", fields: ["title", "body"] },
  // A quote block opened with a straight " and never closed: «> "بعض الناس يرثون… إلى الأبد.» (Brooke Hogan story, INCIDENTS #812)
  { code: "unclosed_straight_quote", severity: "error", re: /^>\s*["“][^"”\n]{5,}$/gm, message: "اقتباس بدأ بعلامة \" ومتقفلش — اقفله بنفس العلامة", fields: ["body"] },
  // Duals the lists above missed, found in published stories: «ابنيه/ابنيها/شقيقيه» (dual noun + pronoun), «اتحادا WWE وAEW» (dual noun before Latin names), «مواجهتي بطولة / لقبي بطولة» (construct dual) — INCIDENTS #815
  { code: "dual_noun", severity: "error", re: /(?<![ء-ي])(?:[وفبلك]?(?:ال)?|لل)(?:ابني|ابنتي|شقيقي|شقيقتي|أخوي|زميلي|ولدي|طفلي|صديقي)(?:ه|ها|هم|هن)(?![ء-ي])|(?<![ء-ي])[وفبلك]?اتحادا(?=\s+[A-Za-z])|(?<![ء-ي])(?:مواجهتي|نزالي|لقبي|بطولتي|عرضي|فريقي)\s+(?:بطولة|لقب|على\s+(?:لقب|بطولة)|ضمن)(?![ء-ي])/g, message: "اسم مثنى (ابنيه/شقيقيه/اتحادا/لقبي بطولة/مواجهتي بطولة…) ممنوع — قول «أبنائه/إخوته/اتحاد X واتحاد Y/نزالات/بطولة كذا وبطولة كذا»", fields: ["title", "body"] },
  // Dual pronoun «هما» on prepositions/nouns the lists above miss: «عند صعودهما الطائرة»، «فمر بالقرب منهما» (INCIDENTS #755)
  { code: "dual_form", severity: "error", re: /(?<![ء-ي])(?:[وف]?(?<!(?:واحد|واحدة|أحدهم|أحد|إحدى)\s)(?:منهما|لهما|بهما)|(?:صعود|دخول|خروج|وصول|عودة|لقاء|ضد|حول|أمام|وراء|خلف|بعد|قبل|بجانب|جانب)هما)(?![ء-ي])/g, message: "ضمير مثنى (منهما/لهما/بهما/صعودهما…) ممنوع — قول «منهم/لهم/بهم» أو كرر الاسم", fields: ["title", "body"] },
  // Feminine-plural verb glued to «كن» — «يقدمكن» for «يقدمن» (INCIDENTS #422)
  { code: "fem_plural_kn", severity: "error", re: /(?<![ء-ي])[يت](?:قدم|شارك|ظهر|حقق|واجه|قدّم|عمل|لعب|فز|خسر)كن(?![ء-ي])/g, message: "فعل جمع المؤنث غلط («يقدمكن» الصح «يقدمن»)", fields: ["title", "body"] },
  { code: "missing_hamza", severity: "error", re: /(?<![\u0621-\u064A])[وف]?(?:الى|الي)(?![\u0621-\u064A])/g, message: "«الى/الي» بلا همزة — «إلى» (حرف الجر) أو «إليّ» حسب المعنى (حصل: «للوصول الي» والمقصود «إليّ»)", fields: ["title", "body"] },
  // A draft that dropped hamzas everywhere («انها»، «اشار إلى ان»، «اطلق»…) is a bad
  // Gemini output, not a few typos — the counted check below blocks it (INCIDENTS #64).
  // An all-caps English film/book title half-transliterated — «بعنوان I FOUGHT جون موكسلي» for «I FOUGHT JON MOXLEY» (INCIDENTS #339)
  { code: "mixed_caps_title", severity: "error", re: /(?<![A-Za-z])(?!(?:WWE|AEW|NXT|TNA|NJPW|ROH|AAA|CMLL|NWA|UFC|MLW|GCW|DX)\b)[A-Z]{2,}(?:\s+[A-Z]{2,})*\s+(?=[ء-ي]+\s+[ء-ي]+)(?<=(?:بعنوان|اسم|عنوان)\s+[A-Z\s]+)/g, message: "عنوان إنجليزي كله كابيتال واسم عربي ملزوق فيه (حصل: «بعنوان I FOUGHT جون موكسلي») — اكتب العنوان كامل زي المصدر بين «»", fields: ["title", "body"] },
  // One speaker, two genders in the same sentence — «مشيرا إلى … موضحة أنه» about Kevin Owens (INCIDENTS #345)
  // Only a «حال» followed by أن/إلى/على…: «معلومات مؤكدة حول» is an adjective, not the speaker.
  { code: "mixed_haal_gender", severity: "error", re: /(?<![ء-ي])(?:مشيرا|مؤكدا|موضحا|مضيفا|معربا|لافتا|منتقدا|معتبرا)(?=\s+(?:أن|إن|إلى|على|عن|بأن|لأن)[ء-ي]{0,3}(?![ء-ي]))[^.؟!\n]{0,200}?(?<![ء-ي])(?:مشيرة|مؤكدة|موضحة|مضيفة|معربة|لافتة|منتقدة|معتبرة)(?=\s+(?:أن|إن|إلى|على|عن|بأن|لأن)[ء-ي]{0,3}(?![ء-ي]))|(?<![ء-ي])(?:مشيرة|مؤكدة|موضحة|مضيفة|معربة|لافتة|منتقدة|معتبرة)(?=\s+(?:أن|إن|إلى|على|عن|بأن|لأن)[ء-ي]{0,3}(?![ء-ي]))[^.؟!\n]{0,200}?(?<![ء-ي])(?:مشيرا|مؤكدا|موضحا|مضيفا|معربا|لافتا|منتقدا|معتبرا)(?=\s+(?:أن|إن|إلى|على|عن|بأن|لأن)[ء-ي]{0,3}(?![ء-ي]))/g, message: "حال مذكر ومؤنث لنفس المتكلم في جملة واحدة (حصل: «مشيرا إلى… موضحة أنه» عن كيفن أوينز) — وحّد التذكير أو التأنيث حسب المتكلم", fields: ["body"] },
  { code: "double_punct", severity: "warning", re: /[،,]\s*[،,.]|:\s*:|؟\s*؟/g, message: "علامات ترقيم مكررة", fields: ["title", "body"] },
];

const TRANSLITERATED_SHOWS = /(?:سماك\s*داون|(?:داينامايت|ديناميت|داينمايت)(?!\s*كيد)|كوليجن|رامبيج|إمباكت|(?<![ء-ي])راو(?![ء-ي])|(?<![ء-ي])الرو(?![ء-ي])|[إا]ن\s*[إا]كس\s*تي|[إا]يفولف)/g;

/** A tag must name a person, team, show, federation or topic — never a date ("تاريخ 24 سبتمبر 2026", seen live). */
export function isJunkTag(tag: string): boolean {
  const t = (tag || "").trim();
  // A one-word generic tag (a medium, «independent») names no one and no show (INCIDENTS #169)
  return !t || /^تاريخ(?:\s|$)/.test(t) || /^\d+$/.test(t) || /^(?:تلفزيون|التلفزيون|اندبندنت|إندبندنت|مستقل|المستقلة|رياضة|مصارعة|المصارعة)$/.test(t)
    // INDIE is the site's own section, not a promotion: «اتحاد INDIE» names nobody (INCIDENTS #194)
    || /^اتحاد\s+INDIE$/i.test(t)
    || /(?:يناير|فبراير|مارس|أبريل|ابريل|مايو|يونيو|يوليو|أغسطس|اغسطس|سبتمبر|أكتوبر|اكتوبر|نوفمبر|ديسمبر)\s+\d{4}/.test(t);
}

/** A tag that is really a sentence: a comma-joined list, or a 4+ word phrase
 *  lifted straight out of the headline ("توني خان يتحدث عن اندماج باراماونت وWBD"). */
export function isHeadlineTag(tag: string, title: string): boolean {
  const t = (tag || "").trim();
  if (/[،,]/.test(t)) return true;
  return t.split(/\s+/).length >= 4 && (title || "").includes(t);
}

const SHOW_WEEKDAY: [RegExp, number][] = [[/WWE RAW/i, 1], [/WWE NXT/i, 2], [/AEW Dynamite/i, 3], [/TNA iMPACT/i, 4], [/WWE SmackDown/i, 5], [/AEW Collision/i, 6]];
const AR_UNITS = ["", "الأول", "الثاني", "الثالث", "الرابع", "الخامس", "السادس", "السابع", "الثامن", "التاسع"];
function arabicDay(word: string): number | null {
  const w = word.trim();
  if (/^\d{1,2}$/.test(w)) return Number(w);
  if (w === "العاشر") return 10;
  if (w === "الحادي عشر") return 11;
  if (w === "الثاني عشر") return 12;
  if (w === "العشرين") return 20;
  if (w === "الثلاثين") return 30;
  const teen = AR_UNITS.indexOf(w.replace(/ عشر$/, ""));
  if (/ عشر$/.test(w) && teen >= 3) return 10 + teen;
  const m = w.match(/^(\S+) و(العشرين|الثلاثين)$/);
  if (m) { const u = m[1] === "الحادي" ? 1 : AR_UNITS.indexOf(m[1]); if (u > 0) return (m[2] === "العشرين" ? 20 : 30) + u; }
  const u = AR_UNITS.indexOf(w);
  return u > 0 ? u : null;
}
const AR_WEEKDAYS = ["الأحد", "الاثنين", "الثلاثاء", "الأربعاء", "الخميس", "الجمعة", "السبت"];
/** «الثلاثاء الثلاثين من سبتمبر» when the 30th was a Wednesday (INCIDENTS #198): the excerpt, else null. */
export function weekdayNotOnDate(text: string, year = new Date().getUTCFullYear()): string | null {
  const re = new RegExp(`(${AR_WEEKDAYS.join("|")})،?\\s+(?:الموافق\\s+)?(\\d{1,2}|ال[\\u0600-\\u06FF]+(?: (?!من )و?[\\u0600-\\u06FF]+)?)\\s+(?:من\\s+)?(${AR_MONTHS.join("|")})(?:\\s+(\\d{4}))?`, "g");
  for (const m of text.matchAll(re)) {
    const day = arabicDay(m[2]), month = AR_MONTHS.indexOf(m[3]);
    if (!day || day > 31 || month < 0) continue;
    if (new Date(Date.UTC(m[4] ? +m[4] : year, month, day)).getUTCDay() !== AR_WEEKDAYS.indexOf(m[1])) return m[0];
  }
  return null;
}
/** The excerpt when a weekly show is dated to a day it doesn't air on (this year), else null. */
export function showOnWrongWeekday(text: string, year = new Date().getUTCFullYear()): string | null {
  const re = new RegExp(`(WWE RAW|WWE NXT|AEW Dynamite|TNA iMPACT|WWE SmackDown|AEW Collision)[^.،\\n]{0,40}?(?:يوم|مساء|ليلة|صباح) (\\d{1,2}|ال[\\u0600-\\u06FF]+(?: و?[\\u0600-\\u06FF]+)?) (?:من )?(${AR_MONTHS.join("|")})(?: (20\\d\\d))?`, "gi");
  for (const m of text.matchAll(re)) {
    const day = arabicDay(m[2]);
    const yr = m[4] ? Number(m[4]) : year; // «18 يناير 2027» is judged in 2027, not in the current year
    const month = AR_MONTHS.indexOf(m[3]);
    const want = SHOW_WEEKDAY.find(([r]) => r.test(m[1]))?.[1];
    if (!day || day > 31 || month < 0 || want === undefined) continue;
    if (/Live|المحلي|الحي|جولة|house/i.test(m[0])) continue; // house shows run any night
    if (new Date(Date.UTC(yr, month, day)).getUTCDay() !== want) return m[0];
  }
  return null;
}

/**
 * Codes that stop a story from being published after the copy editor has had its go (processPost in fightful-watcher.ts).
 * dual_noun / dual_form joined them in INCIDENTS #471: ~4% of stories reached the site with «نزالين» / «حققا» / «أنهما»
 * although the style guide bans the dual. english_title_name is not blocking: «Championship» is also part of tournament names.
 */
export const BLOCKING_QA_CODES = ["betting_promo", "adverb_without_alef", "title_not_arabic", "english_quote", "artifact", "foreign_script", "hamza_dropped", "ai_leak", "editor_note", "body_too_short", "mangled_date", "vague_result", "draw_as_winner", "broken_word", "fem_plural_kn", "glued_latin_arabic", "detached_prefix", "glued_prefix_quote", "number_word_digits", "dropped_alef", "mixed_script_word", "tatweel_before_arabic", "dual_noun", "dual_form", "dangling_speech", "stray_heading", "show_wrong_day", "weekday_mismatch", "show_feminine_adjective", "punt_kick_wording", "singles_label_team_winner", "team_size_label", "glued_arabic_words", "arabic_wrestling_name", "federation_mismatch", "winner_mismatch", "verbless_opening"];
/** Blocking codes that are one-off Gemini glitches: a fresh translation on the next run usually comes out clean. */
export const RETRYABLE_QA_CODES = ["artifact", "adverb_without_alef", "foreign_script", "hamza_dropped", "ai_leak", "editor_note", "vague_result", "results_without_winners", "english_quote", "mixed_script_word", "name_not_in_source", "dual_noun", "dual_form", "dangling_speech", "stray_heading", "show_wrong_day", "weekday_mismatch", "show_feminine_adjective", "punt_kick_wording", "singles_label_team_winner", "team_size_label", "arabic_wrestling_name", "federation_mismatch", "winner_mismatch"];


/** Winners («🏆 **الفائز:** …») whose name isn't in the text of their own match block. */
export function winnersNotInMatch(body: string): string[] {
  const out: string[] = [];
  const norm = (x: string) => x.replace(/[أإآ]/g, "ا").replace(/ة/g, "ه").replace(/ى/g, "ي");
  let block = "";
  for (const line of body.split("\n")) {
    const w = line.match(/^\s*🏆\s*\*\*\s*(?:الفائز|الفائزة|الفائزان|الفائزتان|الفائزون|الفائزات)\s*:?\s*\*\*\s*:?\s*(.+)$/);
    if (!w) {
      if (/^\s*\*\*[^*]+\*\*\s*$/.test(line)) block = ""; // a new match heading
      else block += " " + line;
      continue;
    }
    const name = w[1].replace(/\([^)]*\)/g, " ").replace(/\*/g, "").trim();
    if (!name || !block.trim()) { block = ""; continue; }
    // Names left out: «حسمتها النتيجة لصالح المنتصرة»
    if (/لصالح\s+(?:المنتصر|الفائز)|حسمتها النتيجة|بين الطرفين حسم/.test(block)) { out.push(name); block = ""; continue; }
    // Another winner in the text: «تفوق آلان على…» above «الفائزة: شانتل جوردان»
    const skip = /^(?:فريق|الثنائي|الثلاثي|الفريق|ثنائي|ثلاثي|ذا|بطل|بطلة|البطل|البطلة|المصارع|المصارعة|النجم|النجمة|كل|من)$/;
    const first = (x: string) => norm((x.split(/\s+/).find(y => y.length > 1 && !skip.test(y)) || "").replace(/[،,.]/g, ""));
    const said = block.match(/(?:^|\s)(?:تفوق|تفوقت|تغلب|تغلبت|فاز|فازت|هزم|هزمت)\s+(?:فريق\s+|الثنائي\s+|الثلاثي\s+)?([\u0600-\u06FF][^،.]{1,40}?)\s+على\s/);
    const k = first(name), sk = said ? first(said[1]) : "";
    if (k && sk && k !== sk && !norm(block).includes(k)) out.push(name);
    block = "";
  }
  return out;
}
/** «… فليتشر … سيتعاون مع كايل فليتشر»: a sentence where the partner after «يتعاون/يتحالف مع» carries the surname that already
 *  appeared earlier in the same sentence — the source repeated the same name for both partners. Returns the excerpt, or null. */
export function selfPartnered(text: string): string | null {
  for (const sentence of stripNonProse(String(text)).split(/(?<=[.!؟?\n])/)) {
    const m = new RegExp(`(?<![${AR}])(?:و|ف)?(?:س)?[يت](?:تعاون|تحالف|تحد|شارك|تشارك)\\s+مع\\s+([${AR}]+\\s+[${AR}]+)`).exec(sentence);
    if (!m) continue;
    // a relative shares the surname legitimately: «يتحد مع شقيقه رايان نيميث»
    if (/^(?:شقيق|أخي|اخي|أخيه|اخيه|ابن|والد|زوج|عم|خال|قريب|إخوة|اخوة)/.test(m[1].trim())) continue;
    const last = m[1].trim().split(/\s+/).pop()!.replace(/^ال/, "");
    if (last.length < 4 || /^(?:فريق|اتحاد|بطولة|عرض|نزال|مباراة|منافس|لاعب|مصارع|الثنائي|الثلاثي)/.test(last)) continue;
    const before = sentence.slice(0, m.index);
    if (new RegExp(`(?<![${AR}])(?:[وفبلك]|ال)?${last}(?![${AR}])`).test(before)) return sentence.slice(Math.max(0, m.index - 20), m.index + m[0].length).trim();
  }
  return null;
}

/**
 * A match with no winner is not a «🏆 الفائز:» line. «🏆 الفائز: انتهى النزال بلا نتيجة» / «تعادل» /
 * «لم يُعلن» read as a nonsense winner (INCIDENTS #635: ROH TV 15/10 — and 16 more results stories).
 * Rewrites such a line to «🤝 **النتيجة:** …». A real winner line is left alone.
 */
export const NO_WINNER_VALUE = /^(?:انتهى|انتهت|انتهاء|لا\s+يوجد|لا\s+فائز|بلا\s|بدون\s|دون\s+(?:نتيجة|فائز)|لم\s|تعادل|التعادل|غير\s+(?:محدد|معروف|معلن)|النزال\s+(?:انتهى|انتهت|بلا))/;
export function noWinnerLines(body: string): string {
  return String(body || "").replace(/^([ \t]*(?:[*-][ \t]+)?)🏆[ \t]*\*{0,2}[ \t]*الفائز(?:ة|ان|تان|ون|ات)?[ \t]*:?[ \t]*\*{0,2}[ \t]*:?[ \t]*([^\n]+)$/gm, (all, lead, value) => {
    const v = String(value).trim();
    if (!NO_WINNER_VALUE.test(v)) return all;
    let out = v.replace(/^لا\s+يوجد(?:\s+فائز)?\s*/, "").replace(/^\(\s*([^)]*?)\s*\)\s*$/, "$1").trim();
    if (/^(?:لم\s+يُ?عل[نم]|لم\s+يتم|غير\s+(?:محدد|معروف|معلن))/.test(out)) out = "لم تُعلن النتيجة";
    out = out.replace(/\s*\/\s*غير\s+محدد$/, "");
    if (!out) out = "بدون فائز";
    return `${lead}🤝 **النتيجة:** ${out}`;
  });
}


export function checkArticle(title: string, body: string, tags: string[] = []): QaIssue[] {
  const issues: QaIssue[] = [];
  for (const tag of tags) if (isJunkTag(tag)) issues.push({ code: "junk_tag", severity: "error", field: "tags", message: "وسم عبارة عن تاريخ أو رقم", excerpt: tag });
  // A paragraph break left as «</p><p>» inside the Arabic text, which stripNonProse hides (INCIDENTS #751)
  const strayP = /[ء-ي.،»"]\s*<\/p>\s*<p>/.exec(body || "");
  if (strayP) issues.push({ code: "artifact", severity: "error", field: "body", message: "بقايا كود أو رموز غير مفهومة (</p><p>)", excerpt: excerptAround(body, strayP.index, strayP[0].length) });
  // «تمكن A من الفوز على B» followed by «الفائز: B» — the winner line contradicts the sentence above it (INCIDENTS #761)
  const winnerSwap = /(?:تمكن(?:ت)?|فاز(?:ت)?|انتصر(?:ت)?)\s+([^\n.«»]{3,80}?)\s+(?:من\s+الفوز\s+)?على\s+(?:فريق\s+)?([^\n.،«»]{3,80}?)(?:\s+(?:بعد|في|خلال|بفضل|عبر)\s[^\n]*)?\.?\s*\n+\s*🏆\s*\*\*الفائز(?:ة|ون|ين|ات)?:\*\*\s*([^\n]+)/.exec(body || "");
  if (winnerSwap) {
    const norm = (t: string) => t.replace(/^(?:فريق|ال)\s*/, "").replace(/\s+/g, " ").trim();
    const a = norm(winnerSwap[1]), b = norm(winnerSwap[2]), w = norm(winnerSwap[3]);
    if (b && w.includes(b) && !w.includes(a.split(" و")[0].trim())) issues.push({ code: "winner_mismatch", severity: "error", field: "body", message: "سطر «الفائز» بيذكر الخاسر — عكس الجملة اللي فوقه", excerpt: excerptAround(body, winnerSwap.index, Math.min(winnerSwap[0].length, 160)) });
  }
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

  // The same paragraph/bullet twice (a Gemini list slip: INCIDENTS #400). Compared without «و», spaces and punctuation.
  const lineKeys = new Set<string>();
  for (const line of stripNonProse(body || "").split(/\n+/)) {
    const key = line.replace(/[^\u0621-\u064Aa-zA-Z0-9]/g, "").replace(/و/g, "");
    if (key.length < 60) continue;
    if (lineKeys.has(key)) { issues.push({ code: "duplicate_paragraph", severity: "error", field: "body", message: "نفس الفقرة/النقطة مكررة مرتين", excerpt: line.slice(0, 80) }); break; }
    lineKeys.add(key);
  }

  // A result block whose prose says one wrestler won while the «الفائز» line names the other
  // (INCIDENTS #437: «حسم سوسا النتيجة» above «الفائز: إدي إدواردز»).
  for (const block of (body || "").split(/\n(?=\*\*المواجهة)/)) {
    const win = block.match(/الفائز(?:ة)?:\*{0,2}\s*([^\n]+)/);
    const said = block.match(/(?<![ء-ي])(?:حسم|حسمت|يحسم|تحسم|فاز|فازت)\s+([ء-ي]+(?:\s+[ء-ي]+)?)\s+(?:النتيجة|النزال|المواجهة)/);
    if (!win || !said) continue;
    const names = said[1].split(/\s+/).filter((w) => w.length > 2);
    if (names.length && !names.some((w) => win[1].includes(w.replace(/^ال/, "")))) {
      issues.push({ code: "winner_contradiction", severity: "error", field: "body", message: "النص بيقول فاز واحد وسطر «الفائز» بيقول التاني — راجع النتيجة من المصدر", excerpt: said[0] });
      break;
    }
  }

  // A finished match told in the present tense: «تواجه ار تروث وداميان بريست في نزال فردي» above «الفائز: داميان بريست»
  // — the writer turned «faced» into «تواجه/يواجه» (INCIDENTS #645). A result block narrates in the past: «واجه».
  for (const block of (body || "").split(/\n(?=\*\*(?:المواجهة|الحدث))/)) {
    if (!/^\*\*(?:المواجهة|الحدث)/.test(block) || !/الفائز|النتيجة:/.test(block)) continue;
    const m = block.match(/(?:^|\n|\.\s|،\s)(?:تواجه|يواجه)\s+(?!ال)[ء-ي]+(?:\s+[ء-ي]+){0,2}\s+و(?:داميان|[ء-ي]{3,})[^\n.]{0,40}\s+في\s+نزال/);
    if (m) { issues.push({ code: "result_present_tense", severity: "error", field: "body", message: "نزال انتهى مكتوب بالمضارع («تواجه … وداميان بريست») — اكتبه بالماضي: «واجه فلان فلان»", excerpt: m[0].trim().slice(0, 80) }); break; }
  }

  // «نزال فردي» above «الفائز: فريق موتور سيتي ماشين غانز» — a tag match labelled as a singles match
  // (INCIDENTS #672). A singles winner is never «فريق …».
  for (const block of (body || "").split(/\n(?=\*\*(?:المواجهة|الحدث))/)) {
    const head = block.match(/^\*\*(?:المواجهة|الحدث)[^\n]*?:\s*([^\n]*)\*\*/);
    const win = block.match(/الفائز(?:ة)?:\*{0,2}\s*([^\n]+)/);
    if (head && win && /نزال فردي/.test(head[1]) && /^فريق\s/.test(win[1].trim())) {
      issues.push({ code: "singles_label_team_winner", severity: "error", field: "body", message: "المواجهة مكتوبة «نزال فردي» والفائز «فريق …» — النزال فرق، صحح طبيعة المواجهة من سطر المصدر", excerpt: head[1].slice(0, 60) });
      break;
    }
  }

  // «نزال فرق سداسي» above a winners line with four names: 4 vs 4 is «نزال فرق ثماني» (INCIDENTS #689).
  // Four glossary names in the winners line can't be a 3-on-3 match.
  for (const block of (body || "").split(/\n(?=\*\*(?:المواجهة|الحدث))/)) {
    const head = block.match(/^\*\*(?:المواجهة|الحدث)[^\n]*?:\s*([^\n]*)\*\*/);
    const win = block.match(/الفائز(?:ة)?:\*{0,2}\s*([^\n]+)/);
    if (!head || !win || !/فرق سداسي/.test(head[1]) || /^فريق\s/.test(win[1].trim())) continue;
    if (!/[()（]/.test(win[1]) && glossaryNamesIn(win[1]) >= 4) {
      issues.push({ code: "team_size_label", severity: "error", field: "body", message: "المواجهة مكتوبة «نزال فرق سداسي» والفائزين أربعة — ٤ ضد ٤ هو «نزال فرق ثماني»", excerpt: head[1].slice(0, 60) });
      break;
    }
  }

  // A weekly show on a date that isn't its day: «AEW Dynamite يوم الثامن والعشرين من سبتمبر»
  // (a Monday) — the tribute Dynamite was the 30th; the writer made the date up (INCIDENTS #151).
  const wrongDay = showOnWrongWeekday(body || "");
  if (wrongDay) issues.push({ code: "show_wrong_day", severity: "error", field: "body", message: "تاريخ العرض مش في يومه الأسبوعي — راجع التاريخ من المصدر", excerpt: wrongDay });
  const badWeekday = weekdayNotOnDate(`${title || ""}\n${body || ""}`);
  if (badWeekday) issues.push({ code: "weekday_mismatch", severity: "error", field: "body", message: "اسم اليوم مش مطابق للتاريخ — صحح اليوم من التاريخ", excerpt: badWeekday });

  // A wrestler teamed with himself: «فليتشر … سيتعاون مع كايل فليتشر» (the source wrote «Fletcher will team with Fletcher» — INCIDENTS #602)
  const selfPartner = selfPartnered(`${title || ""}\n${body || ""}`);
  if (selfPartner) issues.push({ code: "self_partner", severity: "error", field: "body", message: "المصارع متعاون مع نفسه — اسم الشريك غلط أو مكرر، احذفه أو اكتب «شريكه»", excerpt: selfPartner });

  // A results story of one federation naming another one's titles: «ACW Mischief Night … بطولة AEW الوطنية» (INCIDENTS #731)
  if (/\bACW\b/.test(title || "") && !/\bAEW\b/.test(title || "") && /(?:بطولة|لقب|حزام)\s+AEW\b/.test(body || "")) issues.push({ code: "federation_mismatch", severity: "error", field: "body", message: "العنوان عن ACW والنص بيقول «بطولة AEW» — اسم الاتحاد غلط", excerpt: ((body || "").match(/(?:بطولة|لقب|حزام)\s+AEW[^\n]{0,20}/) || [""])[0] });

  // Dropped hamzas across the text = a broken Gemini draft: retranslate it.
  // No «ف» prefix («روب فان دام»), and «ان» before a number is «N-1 Victory», not «أن».
  const HAMZALESS = /(?<![\u0621-\u064A])[وبل]?(?:ان|انه|انها|انهم|اذا|اشار|اشارت|اكد|اكدت|اطلق|اضاف|اوضح|اكثر|ايضا|اخر|امام|اصبح|اصبحت|اعلن|اعلنت|تاثير|اسلوب|اثار|اثارت|اثارة|اقدم|اقدمت|اقل|اربعة|اجنحة|اعادت|اعاد|الانجاز|ازمة|اصدار|اسماء|امريكا|ابرزها|ابرز|اضافة|اسقاطها|اسقاط|اهم|اخرى|اخيرا|اولى|اكبر|احدى|اصيب|اصابة|اصابات|اعلى|احداث|اظهر|اظهرت|اعتبر|اعتبرت|اراد|ارادت)(?![\u0621-\u064A]|[\s-]*(?:\d|واحد))/g;
  const hamzaless = ((body || "") + " " + (title || "")).match(HAMZALESS) || [];
  if (hamzaless.length >= 3) issues.push({ code: "hamza_dropped", severity: "error", field: "body", message: `همزات ساقطة في ${hamzaless.length} مواضع — النص يحتاج إعادة ترجمة`, excerpt: hamzaless.slice(0, 6).join("، ") });

  const t = title || "";
  // Show/federation names legitimately stay English, so judge by how many real
  // Arabic words the headline has rather than by its Latin letter ratio.
  const arabicWords = t.split(/\s+/).filter(w => new RegExp(`[${AR}]{2,}`).test(w)).length;
  if (arabicWords < 3) issues.push({ code: "title_not_arabic", severity: "error", field: "title", message: "العنوان مش جملة عربية (أقل من 3 كلمات عربية)", excerpt: t });
  if (t.length > 0 && t.length < 25) issues.push({ code: "title_too_short", severity: "warning", field: "title", message: "العنوان قصير جدًا", excerpt: t });
  // "AEW Collision-9-2026": a source date like 9/23/2026 mangled into a slug-ish fragment
  if (/[A-Za-z]-\d{1,2}-\d{4}|\d{1,2}\/\d{1,2}\/\d{4}/.test(t)) issues.push({ code: "mangled_date", severity: "error", field: "title", message: "تاريخ مكتوب بصيغة غير عربية أو مكسور في العنوان (الصيغة المعتمدة: 23 سبتمبر 2026)", excerpt: t });
  if (/^(تصريحات نارية|صدمة مدوية|ليلة نارية|اعترافات صادمة|مفاجأة كبرى)/.test(t)) issues.push({ code: "title_cliche", severity: "error", field: "title", message: "بادئة كليشيه ممنوعة", excerpt: t });
  // A quip lifted word for word into the headline: «...في دار أيتام بالمكسيك على ما أعتقد» (INCIDENTS #299)
  if (/على ما (?:أعتقد|أظن)|(?:^|\s)(?:أعتقد|أظن)$/.test(t)) issues.push({ code: "title_first_person", severity: "error", field: "title", message: "العنوان فيه تحفظ بصيغة المتكلم منقول حرفيًا من تصريح ساخر — اكتب العنوان بصيغة الخبر", excerpt: t });
  // «تقرير نسب المشاهدة والتقييمات لعرض WWE NXT 2026» — says nothing about which night (INCIDENTS #299)
  if (/^تقرير (?:أرقام|نسب)/.test(t) && !/\d{1,2} (?:يناير|فبراير|مارس|أبريل|مايو|يونيو|يوليو|أغسطس|سبتمبر|أكتوبر|نوفمبر|ديسمبر)|الليلة|الماضي|الأخير/.test(t)) issues.push({ code: "ratings_title_no_date", severity: "error", field: "title", message: "عنوان تقرير المشاهدة من غير تاريخ العرض — اكتب اليوم والشهر (مثل: بتاريخ 29 سبتمبر)", excerpt: t });

  const prose = stripNonProse(body || "");
  const englishRun = prose.match(/(?:\b[A-Za-z][A-Za-z'’-]*\b[\s,]+){10,}/);
  if (englishRun) issues.push({ code: "english_sentence", severity: "warning", field: "body", message: "جملة إنجليزية كاملة داخل النص", excerpt: englishRun[0].slice(0, 80) });
  if (prose.replace(/\s/g, "").length < 250) issues.push({ code: "body_too_short", severity: "error", field: "body", message: "نص الخبر قصير جدًا أو فاضي", excerpt: prose.slice(0, 80) });
  if (((body || "").match(/\*\*/g) || []).length % 2 === 1) issues.push({ code: "broken_bold", severity: "warning", field: "body", message: "تنسيق ** غير مقفول", excerpt: "" });

  // A results block whose winner isn't in its own match text: «تاركة بصمتها في النزال، تفوق آلان على…
  // 🏆 الفائزة: شانتل جوردان», «حسمتها النتيجة لصالح المنتصرة» with no names (EVE 2/10 — INCIDENTS #269)
  const lost = winnersNotInMatch(body || "");
  if (lost.length) issues.push({ code: "winner_not_in_match", severity: "error", field: "body", message: `الفائز مش مذكور في وصف نزاله (${lost.length}) — اكتب النزال من المصدر بأسماء الطرفين`, excerpt: lost.slice(0, 3).join("، ") });

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

const AR_ORDINALS = ["الأولى", "الثانية", "الثالثة", "الرابعة", "الخامسة", "السادسة", "السابعة", "الثامنة", "التاسعة", "العاشرة",
  "الحادية عشرة", "الثانية عشرة", "الثالثة عشرة", "الرابعة عشرة", "الخامسة عشرة", "السادسة عشرة", "السابعة عشرة", "الثامنة عشرة", "التاسعة عشرة", "العشرون"];

/**
 * A results report where some matches got only a «---» separator instead of their
 * «**المواجهة N: …**» heading (wXw Extreme Wrestling Party 25/09: matches 2, 3 and 6).
 * Give each one a heading and renumber every «المواجهة» heading in order.
 */
export function headUnheadedMatches(text: string): string {
  const HEADING = /^\*\*المواجهة\s/;
  const lines = text.split("\n");
  if (!lines.some(l => HEADING.test(l.trim()))) return text;
  // Only touch reports that really have a match without a heading.
  const unheaded = (i: number) => {
    if (!/^-{3,}$/.test(lines[i].trim())) return false;
    let j = i + 1;
    while (j < lines.length && !lines[j].trim()) j++;
    const next = (lines[j] || "").trim();
    if (!next || next.startsWith("**") || next.startsWith("🏆")) return false;
    return lines.slice(j + 1, j + 4).some(l => l.trim().startsWith("🏆"));
  };
  // A match written as a bare result paragraph straight after a finished match («فاز ليو راش على … بالاستبعاد»
  // between «المواجهة الرابعة» and «السادسة» in the PRODUCE Volume 5 report): same missing heading.
  const bare = new Set<number>();
  let prevEnded = false;
  for (let i = 0; i < lines.length; i++) {
    const t = lines[i].trim();
    if (!t) continue;
    if (t.startsWith("🏆")) { prevEnded = true; continue; }
    if (prevEnded && /^(?:فاز|فازت|حقق|حققت)\s/.test(t)) { bare.add(i); continue; }
    prevEnded = false;
  }
  if (!lines.some((_, i) => unheaded(i)) && !bare.size) return text;
  const ORDINAL = new RegExp(`^(\\*\\*المواجهة\\s+)(?:${[...AR_ORDINALS].sort((a, b) => b.length - a.length).join("|")}|\\d+)`);
  let n = 0;
  for (let i = 0; i < lines.length && n < AR_ORDINALS.length; i++) {
    const line = lines[i].trim();
    if (HEADING.test(line)) {
      // Renumber only the ordinal; keep «(نزال فردي): …» and the rest as written.
      if (ORDINAL.test(line)) lines[i] = line.replace(ORDINAL, `$1${AR_ORDINALS[n]}`);
      n++;
    } else if (unheaded(i)) {
      lines[i] = `**المواجهة ${AR_ORDINALS[n]}**\n`;
      n++;
    } else if (bare.has(i)) {
      lines[i] = `**المواجهة ${AR_ORDINALS[n]}**\n\n${lines[i]}`;
      n++;
    }
  }
  return lines.join("\n");
}

const FILLER_NOUNS = "مواجهات|نزالات|أحداثا|منافسات";
const FILLER_ADJ = "حماسية|نارية|مثيرة|قوية";

/**
 * A finished show's results title that only names the match («نتائج عرض AAA on FOX (26
 * سبتمبر 2026): مستر إغوانا في مواجهة تيروس») says nothing the reader came for. When the
 * report's own 🏆 lines name one side as the winner, state the outcome instead.
 */
/**
 * Counts in a title are written in words: «عرض AEW All Out: 3 أمور كرهناها» rendered with
 * the 3 flipped to the wrong side of the English name (bidi), unreadable (owner, 2026-09-27,
 * INCIDENTS #85). Numbers 3–10 take the opposite gender of the counted noun's singular,
 * so only nouns whose gender is known are converted; others are left for Gemini's rule.
 */
const NUM_WORDS: Record<string, [string, string]> = { // [before a masculine noun, before a feminine noun]
  "3": ["ثلاثة", "ثلاث"], "4": ["أربعة", "أربع"], "5": ["خمسة", "خمس"], "6": ["ستة", "ست"], "7": ["سبعة", "سبع"],
  "8": ["ثمانية", "ثماني"], "9": ["تسعة", "تسع"], "10": ["عشرة", "عشر"],
};
const MASC_PLURALS = "أمور|أشياء|أسباب|عروض|نزالات|مصارعين|نجوم|أسئلة|أيام|أشهر|أعوام|أسابيع|ألقاب|أبطال|فرق|دروس|أخطاء|أسرار|تغييرات|أحداث|أسماء|مواسم|أرقام|أهداف|عقود|أجزاء";
const FEM_PLURALS = "مواجهات|بطولات|لحظات|مفاجآت|نقاط|حلقات|مباريات|مرات|ساعات|دقائق|سنوات|صفقات|مصارعات|نجمات|فقرات|تحديات|قصص|علامات|رسائل|أفكار|طرق|قواعد|توقعات|ملاحظات|حقائق|نسخ";
/**
 * A story about tonight's show says «الليلة», not today's date: «الكشف عن خطط جايدا باركر في عرض
 * WWE RAW يوم 28 سبتمبر» was written during RAW on 28 September (US time) — the owner: «ده تاريخ
 * النهارده، يتكتب عليه عرض الليلة» (INCIDENTS #114). Shows are dated in US Eastern time. Not for
 * results reports, whose title is show + date.
 */
export function tonightInTitle(title: string, now = Date.now()): string {
  const months = ["يناير", "فبراير", "مارس", "أبريل", "مايو", "يونيو", "يوليو", "أغسطس", "سبتمبر", "أكتوبر", "نوفمبر", "ديسمبر"];
  const us = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", month: "numeric", day: "numeric" }).formatToParts(new Date(now));
  const m = Number(us.find(p => p.type === "month")?.value) - 1, d = Number(us.find(p => p.type === "day")?.value);
  const re = new RegExp(`\\s*(?:يوم|ليلة|بتاريخ)?\\s*(?:(?:الأحد|الاثنين|الإثنين|الثلاثاء|الأربعاء|الخميس|الجمعة|السبت)\\s+)?\\(?(\\d{1,2})\\s+(${months.join("|")})(?:\\s+\\d{4})?\\)?`, "g");
  // «WWE RAW ال 12 أكتوبر» (the date came after a stray «ال») must not become «ال الليلة» (INCIDENTS #466)
  return title.replace(re, (all, day, month, offset: number, whole: string) => (+day === d && months.indexOf(month) === m && !/(الأسبوع|الشهر|اليوم)\s*$/.test(whole.slice(0, offset)) ? " الليلة" : all)).replace(/(^|\s)ال\s+الليلة/g, "$1الليلة").replace(/\s{2,}/g, " ").trim();
}

/**
 * «(بتوقيت أمريكا)» explains a date inside a story; in a headline it is clutter: «WWE RAW 28 سبتمبر 2026
 * (بتوقيت أمريكا): ثلاثة أمور كرهناها…» (INCIDENTS #122). The body keeps it.
 */
export function dropTimezoneFromTitle(title: string): string {
  // A lone apostrophe glued to the start/end of a headline: «…عرض Heatwave 2026'» (62 August stories, INCIDENTS #414)
  if ((title.match(/'/g) || []).length === 1) title = title.replace(/^\s*'|'\s*$/, "");
  return title
    // «عرض WWE NXT/2026»: a year glued to a show name by a slash (INCIDENTS #268)
    .replace(/([A-Za-z])\/20\d\d\b/g, "$1")
    // An Arabic headline quotes with «», not "": «بولي راي يشيد بـرومان رينز: "هو يؤدي…"» (INCIDENTS #268)
    .replace(/"([^"\n]+)"/g, "«$1»")
    // "Escapes <show> with the title" is a retention, not surviving a show: «داربي ألين ينجو من عرض
    // AEW Grand Slam: France ويحتفظ ببطولة TNT» (INCIDENTS #319)
    .replace(/(^|\s)([يت])نجو من (عرض .+?) و[يت]حتفظ (ب.+)$/, "$1$2حتفظ $4 في $3")
    .replace(/\s*[(（]?\s*(?:ب|و)?توقيت\s+(?:أمريكا|امريكا|الولايات المتحدة|أمريكا الشمالية|الساحل الشرقي)\s*[)）]?/g, "").replace(/\s+([:،])/g, "$1").replace(/\s{2,}/g, " ").trim()
    // never the same name twice in a row: «نتائج عرض WWE RAW WWE RAW» (INCIDENTS #462)
    .replace(/^.*$/s, (t) => collapseRepeatedNames(t));
}

/**
 * "Shelved / on hold / tabled" is a pause, not a cancellation: «اتحاد AEW يلغي خططه لنزال بنمط
 * Elimination Chamber» when the source said the match is "still shelved and tabled" (INCIDENTS #291).
 * Unless the source itself cancels (cancel/scrap/nix/axe/drop), cancellation wording becomes freezing.
 */
export function shelvedNotCancelled(text: string, source: string): string {
  if (!/\b(?:shelved|shelve|on hold|tabled|on the back burner|on ice|put aside)\b/i.test(source)) return text;
  if (/\b(?:cancel(?:l?ed|s|ling)?|cancellation|scrap(?:ped|s)?|nix(?:ed)?|axed|called off|dropped|abandon(?:ed)?|killed)\b/i.test(source)) return text;
  const map: Array<[RegExp, string]> = [
    [/(^|[^ء-ي])يلغي(?![ء-ي])/g, "$1يجمّد"],
    [/(^|[^ء-ي])تلغي(?![ء-ي])/g, "$1تجمّد"],
    [/(^|[^ء-ي])(و?)(?:ألغى|الغى)(?![ء-ي])/g, "$1$2جمّد"],
    [/(^|[^ء-ي])(و?)(?:ألغت|الغت)(?![ء-ي])/g, "$1$2جمّدت"],
    [/(^|[^ء-ي])(و?[بل]?)(?:إلغاء|الغاء)(?![ء-ي])/g, "$1$2تجميد"],
    [/(^|[^ء-ي])(و?)ال(?:إلغاء|الغاء)(?![ء-ي])/g, "$1$2التجميد"],
  ];
  return map.reduce((t, [re, to]) => t.replace(re, to), text);
}

/**
 * A bare "Vince" is not always McMahon: the Choppa City story about Vince Russo leaving JCW went out as
 * «مغادرة فينس مكمان لاتحاد JCW» while its own body said «روسو» (INCIDENTS #294). When the source names
 * Russo and never McMahon, every «مكمان» in the draft is Russo.
 */
export function vinceIsRusso(text: string, source: string): string {
  if (!/\bRusso\b/i.test(source) || /\bMcMahon\b/i.test(source)) return text;
  return text.replace(/(^|[^ء-ي])(و?[بل]?)(?:ماك\s?ماهون|مكماهون|مكمان)(?![ء-ي])/g, "$1$2روسو");
}

/**
 * The social shield's note lands in the front matter and on the dashboard; the model once wrote
 * «عюدات» there (a Cyrillic «ю» inside an Arabic word) and no check reads that field (INCIDENTS #295).
 * Letters from another script are dropped from the note before it is written.
 */
export function cleanSpoilerNote(note: string): string {
  return note.replace(/[Ͱ-ϿЀ-֏֐-׿ऀ-෿฀-๿က-႟Ⴀ-ჿሀ-፿぀-ヿ㐀-鿿가-힯]+/g, "").replace(/\s{2,}/g, " ").trim();
}

export function numberWordsInTitle(title: string): string {
  // «ثاندر روزا تتحدث ثاندر روزا عن نزالها…»: the subject written again after its verb (INCIDENTS #96)
  title = title.replace(/^((?:[^\s:]+\s+){0,3}[^\s:]+)\s+([^\s:]+)\s+\1(?=\s)/, "$1 $2");
  const used: Record<string, string> = {};
  const conv = (gender: 0 | 1) => (_m: string, pre: string | undefined, n: string) => {
    const word = NUM_WORDS[n][gender]; used[n] = word;
    // «بـ 6 أيام» → «بستة أيام», «لـ 3 ساعات» → «لثلاث ساعات»
    return `${pre ? pre[0] : ""}${word} `;
  };
  let out = title
    .replace(new RegExp(`(?<![\\d.,/:])(?:([بل]ـ\\s*))?\\b(10|[3-9])\\s+(?=(?:${MASC_PLURALS})(?![\\u0621-\\u064A]))`, "g"), conv(0))
    .replace(new RegExp(`(?<![\\d.,/:])(?:([بل]ـ\\s*))?\\b(10|[3-9])\\s+(?=(?:${FEM_PLURALS})(?![\\u0621-\\u064A]))`, "g"), conv(1));
  // «ثلاثة أمور كرهناها و3 أحببناها»: the same count repeated without its noun.
  out = out.replace(/(^|\s)و(10|[3-9])\s+(?=[\u0621-\u064A])/g, (m, sp, n) => used[n] ? `${sp}و${used[n]} ` : m);
  return out;
}

const OUTCOME_VERB = /(?:يفوز|تفوز|يفوزون|يفوزان|فوز|يتغلب|تتغلب|يتغلبان|ينتصر|تنتصر|ينتصرون|انتصار|يهزم|تهزم|يحتفظ|تحتفظ|يحتفظان|احتفاظ|يتوج|تتوج|تتويج|يسقط|تسقط|يحسم|تحسم|حسم|يخطف|تخطف|ينتزع|تنتزع|يتأهل|تتأهل|يطيح|تطيح|يكتسح|يقصي|خسارة|سقوط)/;
const VAGUE_SUBTITLE = /(?:بطل جديد|بطلة جديدة|التفاصيل الكاملة|مواجهات|نزالات|منافسات|أحداث|ليلة|قمة|صراع|صراعات|بقيادة|حافل|حافلة|قوية|كبرى|نارية|مثيرة|ملحمية|حماسية)/;
/**
 * A finished show's results title with only filler («نتائج عرض WWE x AAA Worlds Collide (26
 * سبتمبر 2026): مواجهات كبرى بقيادة سي ام بانك…») names the main-event winner instead,
 * read from the report's own «الحدث الرئيسي» block (INCIDENTS #80).
 */
function mainEventTitle(title: string, body: string): string {
  // «نتائج عرض wXw Pro-Wrestling Grand Prix (الليلة الثانية)» — no subtitle at all: once
  // the main event has a winner, the finished report's title names it (INCIDENTS #96).
  const m = title.includes(":") ? title.match(/^(نتائج\s+[^:]+:\s*)(.+)$/) : [title, `${title.trim()}: `, "…"] as RegExpMatchArray;
  // Filler («مواجهات كبرى…») or a bare line-up («يوتا تسوجي ضد هيرووكي غوتو وجيب كيد ضد…»):
  // once the report's main event has a winner, the title says who won it.
  const plainSub = m ? m[2].replace(/[\u064B-\u0652\u0670]/g, "") : "";  // «يُسقط» → «يسقط»
  // «فوز فريق في الحدث الرئيسي»: an earlier cut-off name — rebuild it from the report.
  const brokenOwn = /^فوز\s+(?:فريق|الفريق|ثنائي|الثنائي|ثلاثي)?\s*في الحدث الرئيسي$/.test(plainSub.trim());
  if (!m || (!brokenOwn && OUTCOME_VERB.test(plainSub)) || !(brokenOwn || m[2] === "…" || VAGUE_SUBTITLE.test(m[2]) || /(?:^|\s)(?:ضد|في\s+مواجهة|يواجه|تواجه|يواجهان)\s/.test(m[2]))) return title;
  // MMA cards split into prelims/main card: «the main event» of a report is not reliable there.
  if (/\b(?:UFC|PFL|Bellator|ONE|KSW|MMA)\b/i.test(m[1])) return title;
  const main = body.split(/\n(?=\*\*|#{2,4}\s)/).find(b => /^(?:\*\*|#{2,4}\s*)?الحدث الرئيسي/.test(b.trim()));
  const w = main && main.match(/🏆\s*\*{0,2}\s*(الفائز(?:ة|ان|تان|ون)?)(?:\s*\([^)\n]*\))?\s*:?\s*\*{0,2}:?\s*([^\n(*]+)/);
  if (!w) return title;
  // Only the name: drop «بالاستبعاد», «للاحتفاظ بالبطولة», «بعد…» and anything after them.
  const winner = w[2].replace(/\s+(?:بال(?:استبعاد|تثبيت|إخضاع|عد|ضربة)|(?:و|ل|لل)?(?:ال)?(?:احتفاظ|يحتفظ|تحتفظ|يتوج|تتوج|تتويج|انتزاع)|بعد|عبر|إثر|وسط|في\s+(?:الحدث|النزال|المواجهة|عرض|نزال|مواجهة|الجولة))(?:\s.*)?$/, "").replace(/[.!؟?،,؛:]+$/, "").trim();
  // A bare «فريق» (its name cut off) is not a winner's name — never title with it.
  if (!winner || winner.split(/\s+/).length > 9 || /^(?:فريق|الفريق|ثنائي|الثنائي|ثلاثي)$/.test(winner)) return title;
  // «فوز X» has no gender or number: right for a man, a woman or a team alike.
  return `${m[1]}فوز ${winner} في الحدث الرئيسي`;
}

export function resultsTitleOutcome(title: string, body: string): string {
  if (!/^نتائج\s+(?:عرض|نهائي|الليلة|تسريبات)/.test(title)) return title;
  const byMain = mainEventTitle(title, body);
  if (byMain !== title) return byMain;
  // The whole subtitle must be exactly «A في مواجهة B»: no «..», «،» or second clause.
  const m = title.match(/^(.*?:\s*)([^:.،,؛]+?)\s+(?:في\s+مواجهة|يواجه|تواجه|يواجهان|تواجهان|ضد)\s+([^:.،,؛]+?)\s*$/);
  if (!m) return title;
  const [, head, a, b] = m;
  const words = (x: string) => x.trim().split(/\s+/).length;
  if (words(a) > 5 || words(b) > 5 || /(?:^|\s)(?:و|ضد)\s/.test(` ${b} `) || /^(?:دامية|قوية|نارية|مثيرة|حاسمة)/.test(b)) return title;
  const norm = (x: string) => x.replace(/^(?:فريق|الفريق|ثنائي|الثنائي|البطل|البطلة)\s+/, "").replace(/[.!…]+$/, "").trim();
  const [na, nb] = [norm(a), norm(b)];
  // The winner line must belong to THIS match: its block (up to the next heading) names both sides.
  for (const block of body.split(/\n(?=\*\*|#{2,4}\s|---)/)) {
    if (!block.includes(na) || !block.includes(nb)) continue;
    const w = block.match(/🏆\s*\*{0,2}\s*(الفائز(?:ة|ان|تان|ون)?)(?:\s*\([^)\n]*\))?\s*:?\s*\*{0,2}:?\s*([^\n(*]+)/);
    if (!w) continue;
    const who = norm(w[2]);
    const winner = who === na ? a : who === nb ? b : "";
    if (!winner) continue;
    const loser = winner === a ? b : a;
    const feminine = w[1] === "الفائزة" || /(?:تغلبت|تفوقت|فازت|نجحت|انتصرت|احتفظت|توجت|حسمت|تمكنت|خطفت)/.test(block);
    const verb = /ان$|تان$|ون$/.test(w[1]) ? "يتغلبان على" : feminine ? "تتغلب على" : "يتغلب على";
    return `${head}${winner} ${verb} ${loser}`;
  }
  return title;
}

/**
 * An English title name the term rules cut in half: «NWA World بطولة السيدات TV Championship»,
 * «NXT بطولة السيدات North American Championship», «إيفولفبطولة السيدات» (INCIDENTS #189).
 * A «بطولة السيدات» standing between English words of one title name goes back to «Women's».
 */
export function repairMixedTitles(text: string): string {
  if (!text) return text;
  const W = "[A-Za-z0-9][\\w'’.&-]*";
  const promo = /^(?:[A-Z0-9]{2,6}|C4)$/; // C4, MLP, ROW, NWA… come before «Women's»; Speed, TV, US come after
  return text
    .replace(/إيفولف\s*بطولة\s+السيدات/g, "WWE EVOLVE Women's Championship")
    .replace(/بطولة العالم للسيدات\s+Tag\s+Team\s+Championships?/g, "بطولة العالم للفرق النسائية")
    .replace(/(بطولة العالم للزوجي)\s+(?:Tag\s+Team\s+)?Championships?/g, "$1")
    // English words on both sides: «NWA World بطولة السيدات TV Championship» → «NWA World Women's TV Championship»
    .replace(new RegExp(`((?:${W}\\s+)+)بطولة\\s+السيدات\\s+((?:${W})(?:\\s+${W})*)`, "g"), "$1Women's $2")
    // English only after: «بطولة السيدات C4 Championship» → «C4 Women's Championship», «بطولة السيدات Speed Championship» → «Women's Speed Championship»
    .replace(new RegExp(`بطولة\\s+السيدات\\s+(${W})\\s+(Championships?)`, "g"), (_m, a: string, c: string) => promo.test(a) && !/^(?:US|TV)$/.test(a) ? `${a} Women's ${c}` : `Women's ${a} ${c}`)
    .replace(new RegExp(`بطولة\\s+السيدات\\s+((?:${W}\\s+)+Championships?)`, "g"), "Women's $1")
    // English only before, closing the name: «*NXT بطولة السيدات*» → «*NXT Women's Championship*»
    .replace(new RegExp(`((?:${W}\\s+)+)بطولة\\s+السيدات(?=\\s*[*)])`, "g"), "$1Women's Championship");
}

const AGE_UNITS: Record<string, number> = { واحد: 1, اثنين: 2, ثلاثة: 3, أربعة: 4, خمسة: 5, ستة: 6, سبعة: 7, ثمانية: 8, تسعة: 9,
  // the accusative after «عمره/البالغ»: «تسعا وأربعين عاما» (INCIDENTS #269)
  واحدا: 1, ثلاثا: 3, أربعا: 4, خمسا: 5, ستا: 6, سبعا: 7, ثمانيا: 8, تسعا: 9 };
const AGE_TENS: Record<string, number> = { عشرين: 20, ثلاثين: 30, أربعين: 40, خمسين: 50, ستين: 60, سبعين: 70, ثمانين: 80, تسعين: 90 };
/**
 * Body only (titles keep counts in words): an age or a span of years written out becomes digits —
 * «البالغ من العمر سبعين عاما» ← «70 عاما». The copy editor was told and left it (INCIDENTS #202).
 */
/**
 * An age in the Arabic body that the source never states: Dawn Marie «تقترب من عامها السادس
 * والستين» when the source said 56 (INCIDENTS #341). Returns the numbers to block on.
 */
export function ageNotInSource(body: string, source: string): string[] {
  const text = String(body || "").replace(/https?:\/\/\S+/g, " ");
  const found: string[] = [];
  const re = /الـ\s?(\d{2})\s+(?:من\s+(?:عمره|عمرها|العمر)|عامه|عامها)|(?:عامه|عامها)\s+الـ\s?(\d{2})|(?:البالغ|البالغة)\s+من\s+العمر\s+(\d{2})\s+عاما/g;
  for (const m of text.matchAll(re)) {
    const n = m[1] || m[2] || m[3];
    if (!new RegExp(`(?<!\\d)${n}(?!\\d)`).test(source) && !found.includes(n)) found.push(n);
  }
  return found;
}
export function spelledAgesToDigits(body: string): string {
  return String(body || "").replace(/(?<![\u0600-\u06FF])(?:(واحدا|ثلاثا|أربعا|خمسا|ستا|سبعا|ثمانيا|تسعا|واحد|اثنين|ثلاثة|أربعة|خمسة|ستة|سبعة|ثمانية|تسعة)\s+و)?(?:ال)?(عشرين|ثلاثين|أربعين|خمسين|ستين|سبعين|ثمانين|تسعين)\s+(عاما|عامًا|عام|سنة)(?![\u0600-\u06FF])/g,
    (_m, u: string | undefined, t: string, w: string) => `${(u ? AGE_UNITS[u] : 0) + AGE_TENS[t]} ${w}`)
    // Round hundreds before a unit: «مسافة لا تقل عن خمسمائة قدم» ← «500 قدم» (INCIDENTS #225)
    .replace(/(?<![\u0600-\u06FF\d])(?<![\d][\s\u00A0])(مائة|مئة|مائتي|مائتين|ثلاثمائة|أربعمائة|خمسمائة|ستمائة|سبعمائة|ثمانمائة|تسعمائة)\s+(قدم|أقدام|متر|أمتار|ميل|كيلومتر|دولار|رطل|كيلوغرام|مشجع|متفرج)(?![\u0600-\u06FF])/g,
      (_m, h: string, w: string) => `${HUNDREDS[h]} ${w}`)
    // An age as an ordinal: «سيكون في الثالثة والأربعين من عمره» ← «في الـ43 من عمره» (INCIDENTS #239)
    .replace(/(?<![\u0600-\u06FF])(?:ال)?(الحادية|الثانية|الثالثة|الرابعة|الخامسة|السادسة|السابعة|الثامنة|التاسعة|الحادي|الثاني|الثالث|الرابع|الخامس|السادس|السابع|الثامن|التاسع)\s+و(?:ال)?(عشرين|ثلاثين|أربعين|خمسين|ستين|سبعين|ثمانين|تسعين)\s+(من\s+(?:عمره|عمرها|العمر)|عامه|عامها)(?![\u0600-\u06FF])/g,
      (_m, u: string, t: string, w: string) => `الـ${ORD_UNITS[u.replace(/^ال/, "")] + AGE_TENS[t]} ${w}`)
    // «عامها السادس والستين» ← «عامها الـ66» (INCIDENTS #341)
    .replace(/(?<![\u0600-\u06FF])(عامه|عامها)\s+(?:ال)?(الحادية|الثانية|الثالثة|الرابعة|الخامسة|السادسة|السابعة|الثامنة|التاسعة|الحادي|الثاني|الثالث|الرابع|الخامس|السادس|السابع|الثامن|التاسع)\s+و(?:ال)?(عشرين|ثلاثين|أربعين|خمسين|ستين|سبعين|ثمانين|تسعين)(?![\u0600-\u06FF])/g,
      (_m, w: string, u: string, t: string) => `${w} الـ${ORD_UNITS[u.replace(/^ال/, "")] + AGE_TENS[t]}`)
    // …and round thousands: «أكثر من ألفي تذكرة» ← «2000 تذكرة» (INCIDENTS #238)
    // Never after a number: «899 ألف مشاهد» became «899 1000 مشاهد» (INCIDENTS #244)
    .replace(/(?<![\u0600-\u06FF\d])(?<![\d][\s\u00A0])(ألف|ألفي|ألفين)\s+(تذكرة|مشجع|متفرج|مشاهد|دولار|قدم|متر|ميل)(?![\u0600-\u06FF])/g,
      (_m, k: string, w: string) => `${k === "ألف" ? 1000 : 2000} ${w}`)
    // Round hundreds before a span of time or a count: «لأكثر من مئتي يوم» ← «200 يوم» (INCIDENTS #508)
    .replace(/(?<![\u0600-\u06FF\d])(?<![\d][\s\u00A0])(مئتي|مئتين|مائة|مئة|مائتي|مائتين|ثلاثمائة|أربعمائة|خمسمائة|ستمائة|سبعمائة|ثمانمائة|تسعمائة)\s+(يوم|يوما|أسبوع|أسبوعا|شهر|شهرا|مرة|مباراة|نزال)(?![\u0621-\u064A])/g,
      (_m, h: string, w: string) => `${h.startsWith("مئتي") || h.startsWith("مئتين") ? 200 : HUNDREDS[h] ?? 100} ${w}`)
    // A year written out: «في عام ألفين وتسعة عشر» ← «في عام 2019» (INCIDENTS #508)
    .replace(/(?<![\u0600-\u06FF])ألفين\s+و(?:(واحد|اثنين|ثلاثة|أربعة|خمسة|ستة|سبعة|ثمانية|تسعة)\s+و)?(?:ال)?(عشرين|ثلاثة\s+عشر|أربعة\s+عشر|خمسة\s+عشر|ستة\s+عشر|سبعة\s+عشر|ثمانية\s+عشر|تسعة\s+عشر|أحد\s+عشر|اثني\s+عشر|عشرة|واحد|اثنين|ثلاثة|أربعة|خمسة|ستة|سبعة|ثمانية|تسعة)(?![\u0621-\u064A])/g,
      (_m, u: string | undefined, t: string) => {
        const teens: Record<string, number> = { "أحد عشر": 11, "اثني عشر": 12, "ثلاثة عشر": 13, "أربعة عشر": 14, "خمسة عشر": 15, "ستة عشر": 16, "سبعة عشر": 17, "ثمانية عشر": 18, "تسعة عشر": 19, عشرة: 10, عشرين: 20, واحد: 1, اثنين: 2, ثلاثة: 3, أربعة: 4, خمسة: 5, ستة: 6, سبعة: 7, ثمانية: 8, تسعة: 9 };
        return String(2000 + (teens[t.replace(/\s+/g, " ")] ?? 0) + (u ? AGE_UNITS[u] : 0));
      });
}
/**
 * A price written out in words becomes digits: «ستة وعشرين دولارا وتسعة وتسعين سنتا» ← «26.99 دولار»,
 * «دولار واحد وتسعة وتسعين سنتا» ← «1.99 دولار». Amounts stay numerals (style guide); the writer spelled
 * both parts of a Prime Video price (INCIDENTS #495).
 */
export function spelledMoneyToDigits(body: string): string {
  const U = "(?:واحدا|اثنين|ثلاثة|ثلاثا|أربعة|أربعا|خمسة|خمسا|ستة|ستا|سبعة|سبعا|ثمانية|ثمانيا|تسعة|تسعا)";
  const T = "(?:عشرة|عشرين|ثلاثين|أربعين|خمسين|ستين|سبعين|ثمانين|تسعين)";
  const NUM = `(?:${U}\\s+و${T}|${T}|${U})`;
  const val = (w: string): number => {
    let n = 0;
    for (const x of w.trim().split(/\s+و?/).filter(Boolean)) n += AGE_UNITS[x] ?? AGE_TENS[x] ?? (x === "عشرة" ? 10 : 0);
    return n;
  };
  const re = new RegExp(`(?<![\\u0600-\\u06FF])(?:(${NUM})\\s+دولارا?|دولار\\s+واحد)\\s+و(${NUM})\\s+سنتا(?![\\u0621-\\u064A])`, "g");
  return String(body || "").replace(re, (m, d: string | undefined, c: string) => {
    const dollars = d ? val(d) : 1;
    const cents = val(c);
    return dollars && cents && cents < 100 ? `${dollars}.${String(cents).padStart(2, "0")} دولار` : m;
  });
}
const ORD_UNITS: Record<string, number> = { حادية: 1, ثانية: 2, ثالثة: 3, رابعة: 4, خامسة: 5, سادسة: 6, سابعة: 7, ثامنة: 8, تاسعة: 9, حادي: 1, ثاني: 2, ثالث: 3, رابع: 4, خامس: 5, سادس: 6, سابع: 7, ثامن: 8, تاسع: 9 };
const HUNDREDS: Record<string, number> = { مائة: 100, مئة: 100, مائتي: 200, مائتين: 200, ثلاثمائة: 300, أربعمائة: 400, خمسمائة: 500, ستمائة: 600, سبعمائة: 700, ثمانمائة: 800, تسعمائة: 900 };

/**
 * A clause written twice in one paragraph: «…إثر تغلبه على دومينيك ميستيريو في عرض AAA
 * TripleMania 34 الشهر الماضي، وهذا يأتي بعد تغلبه على دومينيك ميستيريو في عرض AAA
 * TripleMania 34 الشهر الماضي حيث…» (INCIDENTS #258). Seven or more words repeated
 * word-for-word are never intended: drop the second copy and its lead-in back to the
 * comma that ends the first one.
 */
export function dropRepeatedClause(line: string, minWords = 7): string {
  for (let guard = 0; guard < 5; guard++) {
    const words = [...line.matchAll(/\S+/g)].map(m => ({ w: m[0].replace(/[،,.:؛!?؟«»"()]/g, ""), start: m.index!, end: m.index! + m[0].length }));
    let hit: { i: number; j: number; n: number } | null = null;
    for (let i = 0; i < words.length && !hit; i++) {
      for (let j = i + minWords; j + minWords <= words.length && !hit; j++) {
        let n = 0;
        while (j + n < words.length && i + n < j && words[i + n].w && words[i + n].w === words[j + n].w) n++;
        if (n >= minWords) hit = { i, j, n };
      }
    }
    if (!hit) return line;
    const firstEnd = words[hit.i + hit.n - 1].end;
    const comma = line.lastIndexOf("،", words[hit.j].start);
    const cut = comma >= firstEnd - 1 ? comma + 1 : words[hit.j].start;
    line = (line.slice(0, cut).replace(/\s+$/, "") + " " + line.slice(words[hit.j + hit.n - 1].end).replace(/^[\s،,]+/, "")).replace(/\s+$/, "");
  }
  return line;
}

/**
 * A block the writer glued onto the end of a paragraph: «…(9:18). **المواجهة الثالثة…**» (CMLL Viernes
 * Espectacular) and «…قال: > "…"» (Booker T, Lash Legend) rendered as plain text with a stray «>» or «**».
 * A match heading or a quote marker always starts its own paragraph (INCIDENTS #404).
 */
export function splitGluedBlocks(text: string): string {
  if (!text) return text;
  return text
    .replace(/([.!؟?)”"»:])[ \t]+(\*\*(?:المواجهة|الحدث الرئيسي)\s)/g, "$1\n\n$2")
    .replace(/([^\n>])[ \t]+> (?=["«“])/g, "$1\n\n> ");
}

/**
 * The dual pronoun «-هما» is never written (style guide: no dual at all): «علاقتهما» → «علاقتهم», «بينهما» → «بينهم».
 * About a quarter of the stories carried it (INCIDENTS #463). Words whose verb or predicate must agree with the dual
 * («أنهما ستواجهان», «وهما», «كلاهما») and dual nouns («لقبيهما») are left to the dual_form check and the editor.
 */
const DUAL_PRONOUN_KEEP = /^(?:[وفبلك]?(?:مهما|هما)|[وفبلك]?(?:أنهما|إنهما|لكنهما|كأنهما)|ولكنهما|[وفبلك]?متهما|كلاهما|كليهما|كلتاهما|كلتيهما|وكلاهما)$/;
const DUAL_PRONOUN_PREP = /^[وف]?(?:عل|إل|ف|لد)يهما$/;
export function dualPronounsToPlural(text: string): string {
  if (!text) return text;
  return text.replace(/(?<![ء-ي])[ء-ي]{2,}هما(?![ء-ي])/g, (w) => {
    if (DUAL_PRONOUN_KEEP.test(w)) return w;
    if (/يهما$/.test(w) && !DUAL_PRONOUN_PREP.test(w)) return w;
    return w.slice(0, -1);
  });
}

export function autoFix(text: string): string {
  if (!text) return text;
  text = splitGluedBlocks(text);
  // «عرض» is masculine: «في عرض SmackDown الأخيرة» went live in 28 stories (INCIDENTS #621) — the adjective agrees with it
  text = text.replace(/(عرض\s+(?:[A-Za-z0-9'’!.&*-]+\s+){0,5}[A-Za-z0-9'’!.&*-]+\s+)(الأخير|الاخير|القادم|الماضي)ة(?![\u0621-\u064A])/g, "$1$2");
  text = dualPronounsToPlural(text);
  // A match card copied from the source keeps «(c)» for the champion: «كيلاني جوردان (c) ضد رين سنكلير» went live (INCIDENTS #508)
  text = text.replace(/(^[^\n]*\n(?:[^\n]*\n){0,2}?)?([^\n]*?)\s*\(c\)/gim, (m: string, prev: string | undefined, line: string) =>
    `${prev || ""}${line} (${/للسيدات|السيدات|للنساء/.test((prev || "") + line) ? "البطلة" : "البطل"})`);
  // A straight quote glued to the «» pair: > "«أنا حتى لا أعرف…»" went live in the Russo story (INCIDENTS #489) — the
  // «» stays, the extra marks go
  text = text.replace(/["“”]+(\*{0,2})«/g, "$1«").replace(/»(\*{0,2})["“”]+/g, "»$1");
  // A quote marker written in the middle of a sentence («وقال بيشوف: > نعم…») shows as a literal «>» — the quote goes
  // on its own line (INCIDENTS #470)
  text = text.replace(/^([^>\n][^\n]*?[:：،])[ \t]+>[ \t]+(?=\S)/gm, "$1\n\n> ");
  text = repairMixedTitles(text);
  // An instruction the writer echoed into the text: «خلال إضافة علامات التنصيص وعلامة الاستفهام كما في
  // المصدر، استرجع شيفاني…» went live (INCIDENTS #254) — the clause goes, the sentence stays
  text = text.replace(/(?:^|(?<=[\n.،]\s?))(?:خلال|مع|بعد|عبر)\s+إضافة\s+علامات\s+التنصيص[^،.\n]*(?:كما\s+(?:في|ورد\s+في)\s+المصدر)?[،,]\s*/g, "");
  // The editor's note to itself as its own paragraph: «تبسيط عبارة الختم لتتوافق مع معيار الفصحى البيضاء البسيطة ودون
  // زيادات» ended the Bowens/PAC story (INCIDENTS #485) — the whole line goes, the editor_note check blocks the rest
  text = text.replace(/(?:^|\n)[ \t]*(?:تبسيط|تعديل|تصحيح|حذف|إضافة|تغيير|تحسين|توحيد|ضبط)\s+[^\n]{0,80}(?:لتتوافق|ليتوافق|لتطابق|بما يتوافق|معيار|الفصحى|دون زيادات|عبارة الختم|الصياغة المعتمدة)[^\n]*[ \t]*(?=\n|$)/g, "");
  // An editor's note to itself left in the text: «(المصدر يشير إلى أنه اختار AEW بدلا من WWE NXT، وليس أنه
  // انتقل فعليا…)» went live in the David Finlay story (INCIDENTS #251)
  // «(مع تصحيح اسم المصارع إلى تايران تاكي)» went live in the NXT pre-show story (INCIDENTS #321)
  text = text.replace(/\s*\((?:المصدر|ملاحظة|ملحوظة|توضيح|للتوضيح|تنبيه|(?:مع|بعد|تم)\s+(?:تصحيح|تعديل))(?:\s|:)[^()\n]{0,240}\)/g, "");
  // «ال» written twice: «والالثنائي سيخوض» (INCIDENTS #229). Only before nouns that never start with «ال»
  // themselves, so «الالتزام» and «الالتفاف» stay as they are.
  text = text.replace(/(?<![\u0600-\u06FF])([وفبلك]?)الال(?=(?:ثنائي|فريق|نجم|نجمة|مصارع|مصارعة|عرض|اتحاد|بطل|بطلة|بطولة|نزال|لقب)(?![\u0600-\u06FF]))/g, "$1ال");
  // A match heading never carries the outcome: «…Bound for Glory: BDE ينهزم أمام Mr Elegance**» sat above
  // «الفائز: BDE» (INCIDENTS #221). The winner line says who won; the heading keeps the match only.
  text = text.replace(/^(\*\*(?:المواجهة|الحدث الرئيسي|النزال)[^\n*]*?):\s*[^\n*:]*?(?:ينهزم|يهزم|تهزم|تنهزم|يفوز|تفوز|يتغلب|تتغلب|ينتصر|تنتصر|يسقط|تسقط)[^\n*]*\*\*$/gm, "$1**");
  // A word cut after «الأ» and its rest glued to the next one: «بالأ اتحادات» ← «بالاتحادات» (INCIDENTS #195)
  text = text.replace(/(?<![\u0600-\u06FF])([بلوفك]?)الأ ا(?=[\u0600-\u06FF]{2,})/g, "$1الا");
  // The same members in brackets twice: «ذا كريد برذرز (جوليوس كريد وبروتوس كريد) (جوليوس كريد وبروتوس كريد)»
  // went live in the 20/10 NXT card story (INCIDENTS #507) — one copy stays
  text = text.replace(/(\([^()\n]{2,120}\))(?:[ \t]*\1)+/g, "$1");
  // HTML line breaks written into the markdown body («<br><br>**المواجهة الأولى…»)
  text = text.replace(/<br\s*\/?>/gi, "\n").replace(/\n{3,}/g, "\n\n");
  const urls: string[] = [];
  let out = text.replace(/https?:\/\/\S+|<[^>]+>/g, m => `\u0000${urls.push(m) - 1}\u0000`);
  // Gemini sometimes writes the intro twice — as two paragraphs (SmackDown 25/09) or
  // two consecutive lines (C4 18/09) — INCIDENTS #58/#59. A long line repeated
  // word-for-word is never intended: keep the first, and drop a «---» left orphaned.
  const seenLines = new Set<string>();
  out = out.split("\n").map(line => dropRepeatedClause(line)).filter(line => {
    const key = line.replace(/\s+/g, " ").trim();
    if (key.length < 60) return true;
    if (seenLines.has(key)) return false;
    seenLines.add(key);
    return true;
  }).join("\n").replace(/(\n-{3,}[ \t]*)(?:\n[ \t]*)*\n-{3,}[ \t]*(?=\n)/g, "$1").replace(/\n{3,}/g, "\n\n");
  out = headUnheadedMatches(out);
  out = out
    // "TNA iMPACT (9/24/2026)": an American M/D/YYYY date copied from the source
    // title used to get the whole article blocked (mangled_date) — convert it.
    .replace(/\b(1[0-2]|0?[1-9])\/(3[01]|[12]\d|0?[1-9])\/(20\d\d)\b/g, (_m, mo, d, y) => `${Number(d)} ${AR_MONTHS[Number(mo) - 1]} ${y}`)
    // Ringside News ends articles with "Do you think…? Let us know in the comments"
    // — Gemini translated it as a closing paragraph («شاركنا رأيك في التعليقات»).
    // It's the source's sign-off, not news: drop that paragraph.
    .replace(/(^|\n)[^\n]*(?:شاركنا|شاركونا|أخبرنا|أخبرونا|اتركوا|اترك)[^\n]*(?:التعليقات|رأيك|رأيكم)[^\n]*(?=\n|$)/g, "")
    // …and its other sign-off: «ما رأيك في دخول ويل أوسبراي…? هل تراه…?» (INCIDENTS #98)
    .replace(/(^|\n)[ \t]*(?:ما|وما)\s+رأيك(?:م)?(?![\u0600-\u06FF])[^\n]*(?=\n|$)/g, "")
    // …and «وهل تعتقد أن كيز وجد مكانه الصحيح في عروض WWE?» as the last line (INCIDENTS #226)
    .replace(/(^|\n)[ \t]*(?:و|ف)?(?:هل\s+(?:تعتقد|تعتقدون|تظن|تظنون|ترى|ترون|تتوقع|تتوقعون)|برأيك|برأيكم)(?![\u0600-\u06FF])[^\n]*[?؟][ \t]*(?=\n?$)/g, "")
    // An English «?» or «,» right after an Arabic word («عرض AEW All Out?» is English; «بيكر,» is not)
    .replace(new RegExp(`([${AR}])\\?`, "g"), "$1؟").replace(new RegExp(`([${AR}]),(?=\\s)`, "g"), "$1،")
    // Punctuation orphaned when the copy editor deletes a clause: «كانديس ليراي، .»
    // (INCIDENTS #57) — keep the stronger mark, drop the space before it.
    // «ة» only ends a word: one glued to the next word lost its space («عالم المصارعةجاز»,
    // «المصارعةالحرة» — INCIDENTS #107)
    .replace(/ة(?=[\u0621-\u064A])/g, "ة ")
    // A connective written twice («رغبتها في أن أن يكون» — Lola Vice, INCIDENTS #107): keep one.
    // «لا لا» is left alone (it can be a quoted «no, no»).
    .replace(/(?<![\u0600-\u06FF])(في|من|على|أن|إلى|عن|مع|قد|ما|التي|الذي|بعد|قبل|حيث|كما|هذا|هذه|بين|لم|لن|إن|أو|ثم)\s+\1(?![\u0600-\u06FF])/g, "$1")
    .replace(/[،,؛]\s*([.!؟?])/g, "$1")
    .replace(/([،؛])\s*[،,؛]/g, "$1")
    .replace(/[ \t]+([.،؛!؟])(?=\s|$)/g, "$1")
    // «---**المواجهة الثانية**»: a separator glued to the next heading renders as literal text
    .replace(/(^|\n)(-{3,})[ \t]*(?=[^\s-])/g, "$1$2\n\n")
    // Filler Gemini keeps adding although the style guide bans it (All Out 26/09 — INCIDENTS #72)
    .replace(/(?:^|(?<=[\n.]\s*))تجهيزا\s+(?:للمنافسات|للمنافسة|للمواجهة|للنزال)(?:\s+(?:القوية|الكبرى|المرتقبة))?[،,]\s*/g, "")
    .replace(new RegExp(`[،,]\\s*(?:و)?شهد(?:ت)?\\s+(?:العرض|الأمسية|الليلة)\\s+(?:${FILLER_NOUNS})\\s+(?:${FILLER_ADJ})[^.\\n]*(?=\\.)`, "g"), "")
    .replace(new RegExp(`(^|[.!])[ \\t]*(?:و)?شهد(?:ت)?\\s+(?:العرض|الأمسية|الليلة)\\s+(?:${FILLER_NOUNS})\\s+(?:${FILLER_ADJ})[^.\\n]*\\.[ \\t]*`, "gm"), "$1")
    // Self-promotion lines («لا تنسى زيارة موقعنا باستمرار…», «لا تنسى الفواصل…»)
    .replace(/(^|\n)[ \t]*لا\s+تنس[ىي][^\n]*(?=\n|$)/g, "$1")
    // Leftovers of the old glossary: «(بطولة WWE الموحدة - بطل (الاتحاد))», «بطولة X (بطل (الاتحاد للفرق))»
    .replace(/\s*[-–]\s*بطل \(الاتحاد[^()\n]*\)/g, "")
    .replace(/\s*\(بطل \(الاتحاد[^()\n]*\)\)/g, "")
    // «عرض WWE WWE RAW»: a correction («مندي نايت رو» → «WWE RAW») after a federation name already there
    .replace(/\b(WWE|AEW|TNA|AAA|NJPW|ROH|NXT|UFC|CMLL|NOAH|GCW|wXw)\s+\1\b/g, "$1")
    // «فريق The نيو ليفل»: an English article left before an Arabic team name
    .replace(new RegExp(`\\b[Tt]he\\s+(?=[${AR}])`, "g"), "ذا ")
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
    // «> كلام…»: a blockquote that lost its opening « (INCIDENTS #500)
    .replace(/^(>[ \t]*)([^«»\n]+»)/gm, "$1«$2")
    // "ل زينا" → "لـزينا", "ل *NXT" → "لـ *NXT", "و سامي" → "وسامي"
    .replace(new RegExp(`(^|[\\s(«"])([لب])\\s+(?=[${AR}])`, "gm"), "$1$2ـ")
    .replace(/(^|[\s(«"])([لب])\s+(?=[*«"]?[A-Za-z0-9"«])/gm, "$1$2ـ ")
    .replace(new RegExp(`(?<=[${AR}.،!؟"»)*]\\s)و\\s+(?=[${AR}])`, "g"), "و")
    // «لـذا روك» reads as the word «لذا» (therefore) and «بـبطولة» as a typo: keep a space after the
    // prefix before «ذا» and drop the tatweel before the plain word «بطولة» (INCIDENTS #449)
    .replace(new RegExp(`(?<![${AR}])(و?[لب])ـذا(?=\\s)`, "g"), "$1ـ ذا")
    .replace(new RegExp(`(?<![${AR}])(و?[لب])ـ(?=بطول)`, "g"), "$1")
    // «بـأو خان» is Great-O-Khan with the first word dropped: «أو» alone is the conjunction «or»
    .replace(new RegExp(`(?<![${AR}])(و?[لب])ـأو\\s+خان`, "g"), "$1غريت أو خان")
    // "مؤقـتا" / "رسميـا" → "مؤقتا" / "رسميا": a tatweel inside a word is debris; only a joined
    // prefix keeps it («بـ» / «لـ» / «الـ» / «وبـ»…) (INCIDENTS #318)
    .replace(new RegExp(`(?<![${AR}])([${AR}]+)ـ(?=[${AR}])`, "g"), (m, w) => TATWEEL_PREFIXES.has(w) ? m : w)
    // "عرض MLP عرض MLP" → "عرض MLP"
    .replace(/(?<!\S)(\S+\s+\S+)(?:\s+\1)+(?!\S)/g, (m, phrase) => new RegExp(`[${AR}]`).test(phrase) ? phrase : m)
    // "صالة صالة" → "صالة" (team names like "بانغ بانغ" are kept)
    .replace(new RegExp(`(?<![${AR}])([${AR}]{4,})(?:\\s+\\1)+(?![${AR}])`, "g"), (m, w) => LEGIT_DOUBLES.has(w) ? m : w)
    // "آدم بيرس (آدم بيرس)" → "آدم بيرس"
    .replace(/(?<![^\s(«"])((?:[^\s()]+\s){0,3}[^\s()]+)\s*\(\1\)/g, "$1")
    .replace(/،\s*،/g, "،").replace(/:\s*:/g, ":").replace(/؟\s*؟/g, "؟");
  // A paragraph ending on a comma («…بسبب إصابة في الظهر عام 2022، »): the source's
  // "…which you can read here" link was dropped mid-sentence (INCIDENTS #93) — close it.
  out = out.split("\n").map(line => /^[ \t]*[-*#|>]/.test(line) || line.trim().length < 40 ? line
    : line.replace(/[،,][ \t]*$/, ".")).join("\n");
  // The glossary turns «بـRoman Reigns» into «بـرومان رينز» and leaves the tatweel behind. A tatweel joins a
  // preposition to an ENGLISH name only («بـWWE»); before an Arabic name it is a typo («لـرويس كيس»,
  // «بـتايتشي» sat in ~200 stories — INCIDENTS #564)
  out = out.replace(/\u0640+(?=[\u0621-\u064A])/g, "");
  // «وبـ إيجنت زيرو» (tatweel + space before an Arabic name) → «وبإيجنت زيرو»; «لـ ذا روك» keeps its space (#449)
  out = out.replace(/\u0640+ +(?!ذا(?![\u0621-\u064A]))(?=[\u0621-\u064A])/g, "");
  return out.replace(/\u0000(\d+)\u0000/g, (_, i) => urls[Number(i)]);
}

// ── Cross-article checks ──────────────────────────────────────────────────
export interface NewsFile { file: string; title: string; body: string; tags: string[]; date: number; sourceUrl?: string; federation?: string }
export function loadNews(newsDir = path.join(process.cwd(), "content", "news")): NewsFile[] {
  return fs.readdirSync(newsDir).filter(f => f.endsWith(".md")).map(file => {
    const { data, content } = matter(fs.readFileSync(path.join(newsDir, file), "utf-8"));
    return { file, title: String(data.title || ""), body: content, tags: (data.tags || []).map(String),
      date: data.date ? new Date(data.date).getTime() : 0, sourceUrl: data.source_url, federation: data.federation ? String(data.federation) : undefined };
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

/**
 * A glossary wrestler the Arabic body talks about (twice or more) while the source never names him:
 * the story about El Hijo de Fishman said «إل هيخو ديل فيكينغو» all through, so a living wrestler was
 * named in a death (INCIDENTS #462). Returns the English names to block on. The name's last word must be
 * missing from the source, so nicknames and partial names don't trip it.
 */
export function wrestlerNotInSource(body: string, source: string, glossary: Record<string, string>): string[] {
  const text = String(body || "").replace(/https?:\/\/\S+/g, " ");
  const src = String(source || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
  if (src.length < 200) return [];
  const found: string[] = [];
  // Aliases share one Arabic name («Stephanie McHare» and «Stephanie Vaquer»): any alias in the source clears it.
  const named = new Set<string>();
  for (const [en, ar] of Object.entries(glossary)) {
    const w = en.split(/\s+/).filter(x => /^[A-Za-z]{4,}$/.test(x)).pop();
    if (w && src.includes(w.toLowerCase().slice(0, Math.max(4, w.length - 2)))) named.add(ar);
  }
  for (const [en, ar] of Object.entries(glossary)) {
    if (named.has(ar)) continue;
    const words = en.split(/\s+/).filter(w => /^[A-Za-z]{4,}$/.test(w));
    if (words.length < 2 || ar.length < 8 || !/^[؀-ۿ ]+$/.test(ar)) continue;
    let hits = 0;
    for (let i = text.indexOf(ar); i !== -1 && hits < 2; i = text.indexOf(ar, i + ar.length)) {
      if (!/[ء-ي]/.test(text[i - 1] || "") && !/[ء-ي]/.test(text[i + ar.length] || "")) hits++;
    }
    // One mention is enough when no word of the English name is in the source either: «يوشيكي إينامورا» stood for
    // Yuki Iino in a NOAH story (the swap was never repeated), INCIDENTS #463
    const anyWordInSource = words.some(w => src.includes(w.toLowerCase().slice(0, Math.max(4, w.length - 2))));
    if (hits < 2 && !(hits === 1 && !anyWordInSource)) continue;
    found.push(en);
  }
  return found;
}
