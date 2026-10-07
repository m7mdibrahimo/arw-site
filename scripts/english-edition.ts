// English news (owner's request, 2026-10-07 — INCIDENTS #354): every new story the news bots publish in Arabic also
// gets an English edition, written from the same English source (never translated back from the Arabic), in our own
// words, for the English site (/en/news/). Old stories stay Arabic only.
//
// It runs after the Arabic story is saved and never holds it up: no English edition (Gemini out of quota, a check
// failed) just means the story stays Arabic on the English site's lists, and the next run's catch-up
// (catchUpEnglishEditions) tries again for the last day's stories.
import fs from "fs";
import path from "path";
import matter from "gray-matter";

export const NEWS_EN_DIR = path.join(process.cwd(), "content", "news-en");
const NEWS_DIR = path.join(process.cwd(), "content", "news");
// The English site's news start here: stories published before are never given an English edition
export const ENGLISH_NEWS_SINCE = "2026-10-07T21:00:00Z"; // midnight Makkah: the first English stories are that night's
const AR = /[؀-ۿ]/;

export interface EnglishInput {
  sourceTitle: string;     // the source's own headline
  sourceText: string;      // the source article as plain text
  sourceUrl: string;
  sourceId: number | string;
  arabicTitle: string;     // the Arabic story as published (same facts, same scope)
  arabicBody: string;
  federation: string;
  image: string;
  date: string;            // the Arabic story's date (ISO)
  filePrefix: string;      // the Arabic file's «20261007224918» prefix
}
export interface EnglishEdition { title: string; body: string; tags: string[] }

/** Which outlet a story comes from, for «according to …» */
export function outletOf(url: string): string {
  if (/fightful\.com/i.test(url)) return "Fightful";
  if (/ringsidenews\.com/i.test(url)) return "Ringside News";
  if (/wrestlinginc\.com/i.test(url)) return "Wrestling Inc";
  return "";
}

/** The lines that are only a link (<https://…>): embeds the site turns into a video or a post, kept as they are */
export function embedLines(body: string): string[] {
  return String(body || "").split("\n").map((l) => l.trim()).filter((l) => /^<https?:\/\/[^>\s]+>$/.test(l));
}

export function englishPrompt(i: EnglishInput): string {
  const outlet = outletOf(i.sourceUrl);
  const embeds = embedLines(i.arabicBody);
  return `You write for the English edition of Arab Wrestling, a professional-wrestling news site.
Write one news story in English from the SOURCE below. Return JSON only: {"title": "...", "body": "...", "tags": ["..."]}.

Rules:
- Facts come only from the SOURCE. Cover the same story and the same facts as the published Arabic version (given for scope only; never translate from it). Never add facts, opinions, rumors or speculation that the source doesn't have.
- Write it in your own words. Do not copy the source's sentences: rephrase everything except direct quotes.
- Direct quotes stay exactly as the source has them, each in its own markdown blockquote line starting with > and the quote in straight double quotes.
- Headline: Title Case, clear and specific, under 90 characters, no clickbait, no emoji, no all caps.
- Body: a strong lead sentence, then short paragraphs (2-3 sentences each), AP style, American English. A results report lists every result the source lists, one per line, in the form "Winner def. Loser" with the stipulation or title if the source gives one.
- If the source reports something (an exclusive, a backstage report), attribute it${outlet ? `: "according to ${outlet}"` : ""}.
- Official spellings for wrestlers, promotions, shows, events and championships (WWE, AEW, TNA, ROH, NJPW, SmackDown, RAW, NXT, Dynamite…).
- No markdown headings (#), no bold, no lists with bullets, no links in the text.${embeds.length ? `
- Put each of these lines in the body exactly as written, on its own line, where it fits the story (they become videos/posts on the page):
${embeds.join("\n")}` : ""}
- Never mention Arab Wrestling, translation, AI, or that this is a rewrite.
- tags: 3 to 6 English tags (people, promotion, show or event).

SOURCE HEADLINE: ${i.sourceTitle}
SOURCE${outlet ? ` (${outlet})` : ""}:
${String(i.sourceText).slice(0, 12000)}

ARABIC VERSION (scope only):
${i.arabicTitle}
${String(i.arabicBody).slice(0, 6000)}`;
}

/** What blocks an English edition (an empty list: it's fine) */
export function checkEnglish(e: EnglishEdition, i: EnglishInput): string[] {
  const issues: string[] = [];
  const title = String(e?.title || "").trim(), body = String(e?.body || "").trim();
  if (!title || title.length < 15 || title.length > 140) issues.push("title length");
  if (!body || body.replace(/\s+/g, " ").length < 180) issues.push("body too short");
  if (AR.test(title + body)) issues.push("Arabic letters"); // (an Arabic tag is only dropped, when saved)
  if (/\b(as an ai|language model|arab wrestling|translated|translation)\b/i.test(title + "\n" + body)) issues.push("meta text");
  if (/^#{1,6}\s/m.test(body) || /\*\*/.test(body)) issues.push("markdown formatting");
  if (/[\u{1F300}-\u{1FAFF}]/u.test(title)) issues.push("emoji in title");
  // padded: far longer than the source
  const prose = body.replace(/<https?:\/\/[^>]+>/g, "").replace(/\s+/g, " ").length;
  if (i.sourceText.length < 800 && prose > i.sourceText.length * 3.5) issues.push("padded");
  // copied: a long run of the source's own words outside a quote
  const src = i.sourceText.toLowerCase().replace(/\s+/g, " ");
  const prosLines = body.split("\n").filter((l) => !/^\s*>/.test(l) && !/^<https?:/.test(l.trim())).join(" ").toLowerCase().replace(/[“”"]/g, '"');
  const words = prosLines.replace(/"[^"]*"/g, " ").split(/\s+/).filter(Boolean);
  for (let k = 0; k + 14 <= words.length; k++) { if (src.includes(words.slice(k, k + 14).join(" "))) { issues.push("copied from the source"); break; } }
  return issues;
}

export function englishSlug(title: string): string {
  return String(title).toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "").replace(/['’]/g, "")
    .replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 80).replace(/-+$/, "");
}

const yaml = (v: unknown) => JSON.stringify(v);
/** The edition's file (an existing one for the same source story is replaced) */
export function saveEnglishEdition(e: EnglishEdition, i: EnglishInput, dir = NEWS_EN_DIR): string {
  fs.mkdirSync(dir, { recursive: true });
  let slug = englishSlug(e.title) || `story-${i.sourceId}`;
  const existing = findEnglishEdition(i.sourceId, dir);
  // another story already has this address: the source id keeps it unique
  if (fs.readdirSync(dir).some((f) => f.endsWith(`-${slug}.md`) && (!existing || path.join(dir, f) !== existing))) slug = `${slug}-${i.sourceId}`;
  const body = e.body.replace(/\r/g, "").replace(/\n{3,}/g, "\n\n").trim();
  // the embeds the Arabic story has and the English one left out go at its end
  const missing = embedLines(i.arabicBody).filter((l) => !body.includes(l));
  const finalBody = missing.length ? `${body}\n\n${missing.join("\n\n")}` : body;
  const lead = body.split("\n").find((l) => l.trim() && !/^\s*>/.test(l) && !/^<https?:/.test(l.trim())) || "";
  const description = lead.length > 158 ? lead.slice(0, lead.lastIndexOf(" ", 155)) + "…" : lead;
  const file = path.join(dir, `${i.filePrefix}-${slug}.md`);
  const fm = [
    "---",
    `title: ${yaml(e.title.trim())}`,
    `slug: ${yaml(slug)}`,
    `description: ${yaml(description)}`,
    `federation: ${i.federation || "WWE"}`,
    `date: ${i.date}`,
    `source_id: ${i.sourceId}`,
    `source_url: ${yaml(i.sourceUrl)}`,
    `en_tags:`,
    ...[...new Set((e.tags || []).map((t) => String(t).trim()).filter((t) => t && !AR.test(t)))].slice(0, 6).map((t) => `  - ${yaml(t)}`),
    `image: ${i.image}`,
    "---",
    finalBody,
    "",
  ].join("\n");
  if (existing && existing !== file) fs.rmSync(existing, { force: true });
  fs.writeFileSync(file, fm, "utf-8");
  return file;
}

export function findEnglishEdition(sourceId: number | string, dir = NEWS_EN_DIR): string | null {
  if (!fs.existsSync(dir)) return null;
  for (const f of fs.readdirSync(dir).filter((x) => x.endsWith(".md"))) {
    const p = path.join(dir, f);
    if (new RegExp(`^source_id:\\s*${String(sourceId).replace(/[^\w-]/g, "")}\\s*$`, "m").test(fs.readFileSync(p, "utf-8"))) return p;
  }
  return null;
}

type Ask = (prompt: string, json?: boolean, temperature?: number) => Promise<string | null>;
const parse = (raw: string | null): EnglishEdition | null => {
  if (!raw) return null;
  try { const j = JSON.parse(raw.replace(/^```(?:json)?\s*|\s*```$/g, "")); return j && typeof j.title === "string" && typeof j.body === "string" ? { title: j.title, body: j.body, tags: Array.isArray(j.tags) ? j.tags : [] } : null; } catch { return null; }
};

/** Write and save the English edition of a story just published in Arabic. Two tries; null when it doesn't pass. */
export async function writeEnglishEdition(i: EnglishInput, ask: Ask, dir = NEWS_EN_DIR): Promise<string | null> {
  if (new Date(i.date).getTime() < new Date(ENGLISH_NEWS_SINCE).getTime()) return null;
  for (let attempt = 0; attempt < 2; attempt++) {
    const e = parse(await ask(englishPrompt(i), true, 0.4));
    if (!e) continue;
    e.title = e.title.replace(/\s+/g, " ").trim();
    const issues = checkEnglish(e, i);
    if (issues.length) { console.warn(`[English] ✋ ${i.sourceId}: ${issues.join(", ")}${attempt ? "" : " — retrying"}`); continue; }
    const file = saveEnglishEdition(e, i, dir);
    console.log(`[English] ✅ ${path.basename(file)}`);
    return file;
  }
  return null;
}

/** The last day's Arabic stories with no English edition yet (Gemini was out, a check failed): tried again from the
 *  source, at most `limit` a run. */
export async function catchUpEnglishEditions(ask: Ask, fetchSource: (url: string) => Promise<{ title: string; text: string } | null>, limit = 4): Promise<number> {
  if (!fs.existsSync(NEWS_DIR)) return 0;
  const since = Math.max(Date.now() - 24 * 3600_000, new Date(ENGLISH_NEWS_SINCE).getTime());
  const todo = fs.readdirSync(NEWS_DIR).filter((f) => f.endsWith(".md")).sort().reverse().map((f) => path.join(NEWS_DIR, f))
    .map((p) => { try { const m = matter(fs.readFileSync(p, "utf-8")); return { p, d: m.data as any, body: m.content }; } catch { return null; } })
    .filter((x): x is { p: string; d: any; body: string } => !!x && x.d.source_id != null && !!x.d.source_url && new Date(x.d.date).getTime() >= since && !findEnglishEdition(x.d.source_id));
  let done = 0;
  for (const x of todo.slice(0, limit)) {
    const src = await fetchSource(String(x.d.source_url)).catch(() => null);
    if (!src || src.text.length < 200) continue;
    const prefix = (path.basename(x.p).match(/^(\d{14})-/) || [])[1] || new Date(x.d.date).toISOString().replace(/\D/g, "").slice(0, 14);
    const file = await writeEnglishEdition({
      sourceTitle: src.title, sourceText: src.text, sourceUrl: String(x.d.source_url), sourceId: x.d.source_id,
      arabicTitle: String(x.d.title || ""), arabicBody: x.body, federation: String(x.d.federation || "WWE"),
      image: String(x.d.image || ""), date: new Date(x.d.date).toISOString(), filePrefix: prefix,
    }, ask);
    if (file) done++;
  }
  return done;
}
