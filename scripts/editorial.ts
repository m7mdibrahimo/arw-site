// ── Editorial memory + AI copy-editing for the news pipeline ─────────────────
// One place the whole pipeline learns from:
//   editorial/style-guide.md   — rules sent verbatim to Gemini with every article
//   editorial/corrections.json — wrong→right spellings, auto-applied AND shown to Gemini
// Adding a rule/correction there changes every future article, with no code change.
//
// On top of that, every generated article gets a second Gemini pass acting as a
// copy editor (proofreadPrompt/applyProofEdits) and, when a similar recent story
// exists, a Gemini same-story check (duplicatePrompt) before it may be published.
import fs from "fs";
import path from "path";
import { loadCorrections, applyCorrections, checkArticle, tokens, jaccard, type NewsFile, type QaIssue } from "./news-qa";

const EDITORIAL_DIR = path.join(process.cwd(), "editorial");

export function editorialGuideForPrompt(): string {
  let guide = "";
  try {
    guide = fs.readFileSync(path.join(EDITORIAL_DIR, "style-guide.md"), "utf-8");
  } catch {}
  const corrections = loadCorrections();
  const never = corrections.filter(c => !c.regex).map(c => `- ❌ ${c.wrong} ← ✅ ${c.right}`);
  // Pattern rules (mostly show/federation names) are applied automatically after
  // writing, but Gemini should also learn the approved form itself.
  const approved = [...new Set(corrections.filter(c => c.regex && c.right && (/[A-Za-z]/.test(c.right) || c.right.includes(" "))).map(c => c.right))];
  return `${guide}\n\n## صيغ ممنوعة وتصحيحها (أخطاء وصلت للموقع من قبل — لا تكررها أبداً)\n${never.join("\n")}\n\n## أسماء تُكتب دائماً بهذه الصيغة بالضبط (لا تعرّبها ولا تغيّرها)\n${approved.join("، ")}\n`;
}

export interface ArticleDraft { title: string; body: string; tags: string[] }
export interface ProofEdit { field: "title" | "body" | "tags"; find: string; replace: string; reason?: string }

export function proofreadPrompt(article: ArticleDraft, sourceTitle: string, sourceText: string, namesHint: string, issues: QaIssue[]): string {
  const issueLines = issues.map(i => `- [${i.field}] ${i.message}: «${i.excerpt}»`).join("\n");
  return `أنت المدقق اللغوي ورئيس التحرير النهائي لموقع "عرب راسلنج". أمامك خبر مكتوب بالعربية مأخوذ عن مصدر إنجليزي. مهمتك إيجاد كل خطأ فيه وإصلاحه بأقل تعديل ممكن قبل النشر.

راجع كل جملة في العنوان والمتن والوسوم بحثاً عن:
1. أخطاء إملائية ونحوية (التذكير والتأنيث، الهمزات، حروف الجر المنفصلة، كلمات مكررة، جمل مبتورة أو غير مفهومة).
2. أسماء مصارعين أو فرق مكتوبة بصيغة مختلفة عن الصيغة المعتمدة، أو بشكلين مختلفين داخل نفس الخبر.
3. أي معلومة تخالف المصدر الإنجليزي: تاريخ، رقم، اسم، نتيجة، أو معنى جملة تُرجم خطأ.
4. أسماء عروض أو اتحادات مكتوبة بالعربي بدل الإنجليزي، أو مصطلحات ممنوعة حسب الدليل.
5. ترجمة حرفية ركيكة تجعل الجملة غير مفهومة للقارئ العربي.

قواعد التعديل:
- لا تعيد كتابة الخبر ولا تغيّر أسلوبه؛ أصلح الخطأ فقط.
- لا تضف معلومات غير موجودة في المصدر.
- "find" يجب أن يكون نصاً منسوخاً حرفياً من الخبر كما هو (يكفي جزء الجملة الذي فيه الخطأ)، و"replace" هو نفس الجزء بعد التصحيح.
- للوسوم: "find" هو الوسم كاملاً كما هو، و"replace" هو الوسم المصحح.
- إذا كان الخبر سليماً تماماً أعد قائمة فارغة.

${editorialGuideForPrompt()}
${namesHint ? `\n${namesHint}\n` : ""}
${issueLines ? `\nمشاكل رصدها الفحص الآلي ويجب إصلاحها:\n${issueLines}\n` : ""}
=== المصدر الإنجليزي ===
${sourceTitle}
${sourceText.slice(0, 7000)}

=== الخبر العربي المطلوب مراجعته ===
العنوان: ${article.title}
الوسوم: ${article.tags.join(" | ")}
المتن:
${article.body}

أعد JSON فقط بهذا الشكل:
{"edits":[{"field":"title|body|tags","find":"النص الخطأ كما هو","replace":"النص الصحيح","reason":"سبب مختصر"}]}`;
}

export function parseProofEdits(raw: string | null): ProofEdit[] | null {
  if (!raw) return null;
  try {
    const json = JSON.parse(raw.replace(/^```(?:json)?\s*|\s*```$/g, ""));
    if (!Array.isArray(json?.edits)) return null;
    return json.edits.filter((e: any) => e && ["title", "body", "tags"].includes(e.field)
      && typeof e.find === "string" && typeof e.replace === "string");
  } catch {
    return null;
  }
}

const latinWords = (t: string) => (t.match(/[A-Za-z][A-Za-z'’.-]*/g) || []).map(w => w.toLowerCase());
const numbers = (t: string) => t.match(/\d+/g) || [];

/**
 * An edit may introduce an English word or a number only if the English source
 * contains it — the copy editor fixes language, it never gets to invent a date,
 * score or name spelling (seen in testing: "Reid" → "Reed", a title date changed
 * with no source to back it). With no source text, such edits are always refused.
 */
export function editIsGrounded(find: string, replace: string, sourceText: string): boolean {
  const src = sourceText.toLowerCase();
  const had = new Set([...latinWords(find), ...numbers(find)]);
  return [...latinWords(replace), ...numbers(replace)].every(tok => had.has(tok) || new RegExp(`(^|[^a-z0-9])${tok.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}([^a-z0-9]|$)`).test(src));
}

const DIACRITICS = /[\u064B-\u0652\u0670]/g;
const QA_PROBE_PAD = " ".repeat(260) + "نص عربي للفحص فقط";
/**
 * The copy editor must never make an article worse by the site's own rules
 * (seen: "عرض MLW Fusion" → "إم إل دبليو فيوجن", an Arabic title name replaced by
 * "AEW World Trios Championships", "حلقة العرض" → "عرض العرض"), and must not churn
 * text with diacritic-only edits ("رسميا" → "رسمياً") that aren't the site's style.
 */
let approvedSpellings: string[] | null = null;
function approvedNames(): string[] {
  if (!approvedSpellings) {
    const rights = loadCorrections().filter(c => !c.regex).map(c => c.right);
    let glossary: string[] = [];
    try { glossary = Object.values(JSON.parse(fs.readFileSync(path.join(process.cwd(), "scripts", "wrestler-names.json"), "utf-8"))) as string[]; } catch {}
    approvedSpellings = [...new Set([...rights, ...glossary])].filter(n => /[\u0621-\u064A]/.test(n) && n.includes(" ") && n.length >= 6);
  }
  return approvedSpellings;
}

export function editIsAnImprovement(find: string, replace: string): boolean {
  if (find.replace(DIACRITICS, "") === replace.replace(DIACRITICS, "")) return false;
  if (applyCorrections(replace) !== replace) return false; // introduces a known-wrong form
  // Never undo an approved spelling (seen: "ذا يانغ باكس" → "يانغ باكس").
  if (approvedNames().some(n => find.includes(n) && !replace.includes(n))) return false;
  const codes = (t: string) => new Set(checkArticle("عنوان عربي للفحص فقط", t + QA_PROBE_PAD, []).filter(i => i.severity === "error").map(i => i.code));
  const before = codes(find);
  return [...codes(replace)].every(c => before.has(c));
}

/** Applies only safe, verifiable edits: the text to replace must exist verbatim, and an edit may not balloon into a rewrite. */
export function applyProofEdits(article: ArticleDraft, edits: ProofEdit[], sourceText = ""): { article: ArticleDraft; applied: ProofEdit[] } {
  const out = { title: article.title, body: article.body, tags: [...article.tags] };
  const applied: ProofEdit[] = [];
  for (const e of edits) {
    const find = e.find.trim();
    // The site writes without tashkeel/tanween; never let an edit add it ("يوما" → "يوماً", seen live).
    const replace = DIACRITICS.test(find) ? e.replace.trim() : e.replace.trim().replace(DIACRITICS, "");
    DIACRITICS.lastIndex = 0;
    if (!find || find === replace || find.length > 400 || replace.length > find.length * 2 + 40) continue;
    if (!editIsGrounded(find, replace, sourceText)) continue;
    if (!editIsAnImprovement(find, replace)) continue;
    // "يُذكر أن" (it is worth noting) is not "يتذكر" (remembers) — seen in testing.
    if (/(^|[^\u0621-\u064A])[وف]?يذكر/.test(find) && /يتذكر/.test(replace)) continue;
    if (e.field === "tags") {
      const i = out.tags.indexOf(find);
      if (i === -1 || !replace) continue;
      out.tags[i] = replace;
    } else {
      if (!out[e.field].includes(find)) continue;
      if (e.field === "title" && !replace) continue;
      out[e.field] = out[e.field].split(find).join(replace);
    }
    applied.push({ ...e, find, replace });
  }
  out.tags = [...new Set(out.tags.filter(Boolean))];
  return { article: out, applied };
}

// ── Cross-source duplicate confirmation ──────────────────────────────────────
export function findDuplicateCandidates(draft: ArticleDraft, news: NewsFile[], now = Date.now(), hours = 48): NewsFile[] {
  const t = tokens(draft.title);
  const b = tokens(draft.body.slice(0, 1500));
  return news
    .filter(n => now - n.date <= hours * 3600_000 && n.date <= now + 3600_000)
    .map(n => ({ n, score: Math.max(jaccard(t, tokens(n.title)), jaccard(b, tokens(n.body.slice(0, 1500)))) }))
    .filter(x => x.score >= 0.15)
    .sort((x, y) => y.score - x.score)
    .slice(0, 5)
    .map(x => x.n);
}

export function duplicatePrompt(draft: ArticleDraft, candidates: NewsFile[]): string {
  const list = candidates.map((c, i) => `[${i}] العنوان: ${c.title}\nبداية المتن: ${c.body.replace(/\s+/g, " ").slice(0, 700)}`).join("\n\n");
  return `أنت محرر في موقع أخبار مصارعة ينشر من أكثر من مصدر إنجليزي، ومهمتك منع نشر نفس الخبر مرتين.

الخبر الجديد:
العنوان: ${draft.title}
بداية المتن: ${draft.body.replace(/\s+/g, " ").slice(0, 900)}

أخبار منشورة بالفعل خلال آخر يومين:
${list}

هل الخبر الجديد يغطي **نفس الخبر/الحدث** لأحد الأخبار المنشورة (حتى لو بصياغة أو عنوان مختلف أو من مصدر آخر)؟
- نتائج عروض في أيام مختلفة، أو عروض مختلفة، ليست تكراراً.
- خبر متابعة يضيف تطوراً جديداً حقيقياً (قرار جديد، نتيجة جديدة، تصريح جديد) ليس تكراراً.
- نفس الإعلان أو نفس التصريح أو نفس الواقعة من مصدر آخر = تكرار.

أعد JSON فقط: {"duplicate_of": رقم الخبر المكرر أو null, "reason": "سبب مختصر"}`;
}

export function parseDuplicateAnswer(raw: string | null, candidates: NewsFile[]): { file: string; reason: string } | null {
  if (!raw) return null;
  try {
    const json = JSON.parse(raw.replace(/^```(?:json)?\s*|\s*```$/g, ""));
    const i = json?.duplicate_of;
    if (typeof i !== "number" || !candidates[i]) return null;
    return { file: candidates[i].file, reason: String(json.reason || "") };
  } catch {
    return null;
  }
}

// ── Persistent records (committed by the watcher workflows' `git add -A`) ────
const SKIPS_FILE = path.join(process.cwd(), "_data", "duplicate-skips.json");
/** Source URLs already judged duplicates — so a skipped post isn't re-sent to Gemini on every run. */
export function isKnownDuplicate(sourceUrl: string): boolean {
  try {
    return Boolean(sourceUrl && JSON.parse(fs.readFileSync(SKIPS_FILE, "utf-8"))[sourceUrl]);
  } catch {
    return false;
  }
}
export function recordDuplicate(sourceUrl: string, matchedFile: string, reason: string) {
  if (!sourceUrl) return;
  let skips: Record<string, any> = {};
  try { skips = JSON.parse(fs.readFileSync(SKIPS_FILE, "utf-8")); } catch {}
  skips[sourceUrl] = { matchedFile, reason, at: new Date().toISOString() };
  const entries = Object.entries(skips).slice(-500);
  fs.writeFileSync(SKIPS_FILE, JSON.stringify(Object.fromEntries(entries), null, 2) + "\n", "utf-8");
}

const LOG_FILE = path.join(EDITORIAL_DIR, "proofread-log.jsonl");
/** Every correction the AI copy editor made — recurring ones belong in corrections.json. */
export function logProofEdits(file: string, applied: ProofEdit[]) {
  if (!applied.length) return;
  fs.mkdirSync(EDITORIAL_DIR, { recursive: true });
  const lines = fs.existsSync(LOG_FILE) ? fs.readFileSync(LOG_FILE, "utf-8").split("\n").filter(Boolean) : [];
  lines.push(...applied.map(e => JSON.stringify({ at: new Date().toISOString(), file, ...e })));
  fs.writeFileSync(LOG_FILE, lines.slice(-3000).join("\n") + "\n", "utf-8");
}
