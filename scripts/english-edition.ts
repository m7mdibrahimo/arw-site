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
import { splitGluedBlocks } from "./news-qa";

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
  gallery?: string[];      // the source article's own pictures in its text, as the Arabic story shows them
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

/** Words in a story's text, its embed lines left out (the English edition is as long as the Arabic one, INCIDENTS #355) */
export function wordCount(body: string): number {
  return String(body || "").split("\n").filter((l) => !isEmbedLine(l)).join("\n").replace(/<https?:\/\/[^>\s]+>/g, " ").split(/\s+/).filter((w) => /[\p{L}\p{N}]/u.test(w)).length;
}

/** A line that is only a link — «https://x.com/…/status/…» as the bots write it, or «<https://…>»: the site turns it
 *  into the post or video itself. (Only the «<…>» form was recognised, and the bots write the bare one: no English story
 *  ever got the Arabic story's posts and videos, INCIDENTS #359.) */
export function isEmbedLine(line: string): boolean {
  return /^(?:<https?:\/\/[^>\s]+>|https?:\/\/\S+)$/.test(String(line || "").trim());
}
/** The embed lines of a story, kept as they are */
export function embedLines(body: string): string[] {
  return String(body || "").split("\n").map((l) => l.trim()).filter(isEmbedLine);
}
const linkOf = (line: string) => line.trim().replace(/^<|>$/g, "");

/** How every English story is written: the separate request below and the joint one (jointEnglishRules) share them */
export function englishStyleRules(sourceUrl: string): string {
  const outlet = outletOf(sourceUrl);
  return `- Write it in your own words. Do not copy the source's sentences: rephrase everything except direct quotes.
- Direct quotes stay exactly as the source has them, each in its own markdown blockquote line starting with > and the quote in straight double quotes.
- Headline: Title Case, clear and specific, under 90 characters, no clickbait, no emoji, no all caps.
- Body: a strong lead sentence, then short paragraphs (2-3 sentences each), AP style, American English. A results report lists every result the source lists, one per line, in the form "Winner def. Loser" with the stipulation or title if the source gives one.
- If the source reports something (an exclusive, a backstage report), attribute it${outlet ? `: "according to ${outlet}"` : ""}.
- Official spellings for wrestlers, promotions, shows, events and championships (WWE, AEW, TNA, ROH, NJPW, SmackDown, RAW, NXT, Dynamite…).
- No markdown headings (#), no bold, no lists with bullets, no links in the text.
- Never mention Arab Wrestling, translation, AI, or that this is a rewrite.`;
}

/** The English edition inside the Arabic story's own request (owner's request, INCIDENTS #356): one request writes the
 *  story in English from the source FIRST (en_title, en_body, en_tags — the first keys of the JSON, so it is written
 *  first), then the Arabic story is that same English story in Arabic. The English one goes to the English site as
 *  written: no second request for it. */
export function jointEnglishRules(sourceUrl: string): string {
  return `
ENGLISH EDITION — WRITE IT FIRST (the English rules; they apply to en_title, en_body and en_tags only):
Step 1: rewrite the source as one English news story: en_title, en_body, en_tags. Facts only from the source, nothing added.
${englishStyleRules(sourceUrl)}
- Length: the same length the Arabic rules set for this story (the Arabic and English bodies have about the same number of words).
- en_tags: 3 to 6 English tags (people, promotion, show or event).
Step 2: title, body_markdown and tags are the Arabic version of exactly that English story: the same facts in the same order and the same length, written by every Arabic rule above (where the two differ, e.g. naming the outlet, the Arabic follows the Arabic rules).
`;
}

export function englishPrompt(i: EnglishInput): string {
  const outlet = outletOf(i.sourceUrl);
  const embeds = embedLines(i.arabicBody);
  const words = wordCount(i.arabicBody);
  return `You write for the English edition of Arab Wrestling, a professional-wrestling news site.
Write one news story in English from the SOURCE below. Return JSON only: {"title": "...", "body": "...", "tags": ["..."]}.

Rules:
- Facts come only from the SOURCE. Cover the same story and the same facts as the published Arabic version (given for scope only; never translate from it). Never add facts, opinions, rumors or speculation that the source doesn't have.
${englishStyleRules(i.sourceUrl)}
- Length: the same as the Arabic version, about ${words} words${words > 60 ? ` (never more than ${Math.round(words * 1.2)})` : ""}: keep only what the Arabic version keeps. A results report still lists every result.${embeds.length ? `
- Put each of these lines in the body exactly as written, on its own line, where it fits the story (they become videos/posts on the page):
${embeds.join("\n")}` : ""}
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
const galleryYaml = (g?: string[]) => (g && g.length ? ["gallery:", ...g.map((x) => `  - ${x}`)] : []);
/** The edition's file (an existing one for the same source story is replaced) */
/** Wrong→right spellings fixed in every English story before it is saved (INCIDENTS #385) */
export const ENGLISH_FIXES: [RegExp, string][] = [
  [/\bM By Elegance\b/g, "Ash By Elegance"],
];
export function fixEnglishNames(text: string): string {
  return ENGLISH_FIXES.reduce((t, [re, to]) => t.replace(re, to), text);
}

export function saveEnglishEdition(e: EnglishEdition, i: EnglishInput, dir = NEWS_EN_DIR): string {
  e = { ...e, title: fixEnglishNames(e.title), body: fixEnglishNames(e.body) };
  fs.mkdirSync(dir, { recursive: true });
  let slug = englishSlug(e.title) || `story-${i.sourceId}`;
  const existing = findEnglishEdition(i.sourceId, dir);
  // another story already has this address: the source id keeps it unique
  if (fs.readdirSync(dir).some((f) => f.endsWith(`-${slug}.md`) && (!existing || path.join(dir, f) !== existing))) slug = `${slug}-${i.sourceId}`;
  const body = splitGluedBlocks(e.body.replace(/\r/g, "")).replace(/\n{3,}/g, "\n\n").trim();
  // the embeds the Arabic story has and the English one left out go at its end
  const missing = embedLines(i.arabicBody).filter((l) => !body.includes(linkOf(l)));
  const finalBody = missing.length ? `${body}\n\n${missing.join("\n\n")}` : body;
  const lead = body.split("\n").find((l) => l.trim() && !/^\s*>/.test(l) && !isEmbedLine(l)) || "";
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
    ...galleryYaml(i.gallery),
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

/** Every English story carries what its Arabic story shows besides the text: the posts and videos (embed lines) and the
 *  source's pictures (gallery). Run with each bot run, no request: it brings the stories written before this up to
 *  date, and keeps up when an Arabic story gains a video later (INCIDENTS #359). Returns how many stories changed. */
export function syncEnglishFromArabic(dir = NEWS_EN_DIR, newsDir = NEWS_DIR): number {
  if (!fs.existsSync(dir) || !fs.existsSync(newsDir)) return 0;
  const arabic = new Map<string, { body: string; gallery: string[] }>();
  for (const f of fs.readdirSync(newsDir).filter((x) => x.endsWith(".md") && x >= "20261007")) {
    try {
      const m = matter(fs.readFileSync(path.join(newsDir, f), "utf-8"));
      if (m.data.source_id != null) arabic.set(String(m.data.source_id), { body: m.content, gallery: Array.isArray(m.data.gallery) ? m.data.gallery.map(String) : [] });
    } catch {}
  }
  let changed = 0;
  for (const f of fs.readdirSync(dir).filter((x) => x.endsWith(".md"))) {
    const p = path.join(dir, f);
    const raw = fs.readFileSync(p, "utf-8");
    const m = raw.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
    const id = m && (m[1].match(/^source_id:\s*(\S+)\s*$/m) || [])[1];
    const ar = id ? arabic.get(id) : undefined;
    if (!m || !ar) continue;
    let [fm, body] = [m[1], m[2].replace(/\s+$/, "")];
    const missing = embedLines(ar.body).filter((l) => !body.includes(linkOf(l)));
    if (missing.length) body = `${body}\n\n${missing.join("\n\n")}`;
    const fmNoGallery = fm.replace(/^gallery:\n(?:  - .*\n?)*/m, "").replace(/\n$/, "");
    const fmNew = ar.gallery.length ? fmNoGallery.replace(/^(image:.*)$/m, (l) => [l, ...galleryYaml(ar.gallery)].join("\n")) : fmNoGallery;
    const out = `---\n${fmNew}\n---\n${body}\n`;
    if (out !== raw) { fs.writeFileSync(p, out, "utf-8"); changed++; console.log(`[English] 🔗 ${f}: ${missing.length} post(s)/video(s), ${ar.gallery.length} picture(s) from its Arabic story`); }
  }
  return changed;
}

/** Two English editions of one story (two bots wrote it at once, INCIDENTS #355): the first by file name stays — the
 *  one the build keeps too — the others go, each address sent to it. Returns how many went. */
export function dedupeEnglishEditions(dir = NEWS_EN_DIR, redirectsFile = path.join(process.cwd(), "_redirects")): number {
  if (!fs.existsSync(dir)) return 0;
  const kept = new Map<string, string>(); // source id → slug
  let removed = 0;
  for (const f of fs.readdirSync(dir).filter((x) => x.endsWith(".md")).sort()) {
    const p = path.join(dir, f);
    let d: any;
    try { d = matter(fs.readFileSync(p, "utf-8")).data; } catch { continue; }
    if (d.source_id == null) continue;
    const slug = String(d.slug || f.replace(/^\d{14}-|\.md$/g, ""));
    const keep = kept.get(String(d.source_id));
    if (!keep) { kept.set(String(d.source_id), slug); continue; }
    fs.rmSync(p, { force: true });
    removed++;
    console.log(`[English] 🗑️ ${f}: a second English edition of story ${d.source_id} — /en/news/${keep}/ stays`);
    if (slug !== keep && fs.existsSync(redirectsFile)) {
      const rule = `/en/news/${slug}/* /en/news/${keep}/ 301!`;
      if (!fs.readFileSync(redirectsFile, "utf-8").includes(`/en/news/${slug}/`)) fs.appendFileSync(redirectsFile, `\n${rule}\n`, "utf-8");
    }
  }
  return removed;
}

/** The English story the Arabic story's own request wrote (jointEnglishRules): checked like any other, then saved as
 *  written. null when there is none or it doesn't pass: the caller then asks for one on its own (writeEnglishEdition). */
export function saveJointEnglishEdition(raw: { en_title?: unknown; en_body?: unknown; en_tags?: unknown } | null | undefined, i: EnglishInput, dir = NEWS_EN_DIR): string | null {
  if (new Date(i.date).getTime() < new Date(ENGLISH_NEWS_SINCE).getTime()) return null;
  if (!raw || typeof raw.en_title !== "string" || typeof raw.en_body !== "string") return null;
  const e: EnglishEdition = { title: raw.en_title.replace(/\s+/g, " ").trim(), body: raw.en_body, tags: Array.isArray(raw.en_tags) ? raw.en_tags.map(String) : [] };
  const issues = checkEnglish(e, i);
  if (issues.length) { console.warn(`[English] ✋ ${i.sourceId} (written with the Arabic): ${issues.join(", ")} — asking for it on its own`); return null; }
  const file = saveEnglishEdition(e, i, dir);
  console.log(`[English] ✅ ${path.basename(file)} (written with the Arabic: no extra request)`);
  return file;
}

/** The last day's Arabic stories with no English edition yet (Gemini was out, a check failed): tried again from the
 *  source, at most `limit` a run. Each bot catches up only its own outlet's stories (`outlets`; "" = none of the three):
 *  the three bots run at the same time, and two of them catching up the same story wrote it twice (INCIDENTS #355). */
export async function catchUpEnglishEditions(ask: Ask, fetchSource: (url: string) => Promise<{ title: string; text: string } | null>, limit = 4, outlets?: string[]): Promise<number> {
  if (!fs.existsSync(NEWS_DIR)) return 0;
  dedupeEnglishEditions();
  syncEnglishFromArabic();
  const since = Math.max(Date.now() - 24 * 3600_000, new Date(ENGLISH_NEWS_SINCE).getTime());
  const todo = fs.readdirSync(NEWS_DIR).filter((f) => f.endsWith(".md")).sort().reverse().map((f) => path.join(NEWS_DIR, f))
    .map((p) => { try { const m = matter(fs.readFileSync(p, "utf-8")); return { p, d: m.data as any, body: m.content }; } catch { return null; } })
    .filter((x): x is { p: string; d: any; body: string } => !!x && x.d.source_id != null && !!x.d.source_url && new Date(x.d.date).getTime() >= since
      && (!outlets || outlets.includes(outletOf(String(x.d.source_url)))) && !findEnglishEdition(x.d.source_id));
  let done = 0;
  for (const x of todo.slice(0, limit)) {
    const src = await fetchSource(String(x.d.source_url)).catch(() => null);
    if (!src || src.text.length < 200) continue;
    const prefix = (path.basename(x.p).match(/^(\d{14})-/) || [])[1] || new Date(x.d.date).toISOString().replace(/\D/g, "").slice(0, 14);
    const file = await writeEnglishEdition({
      sourceTitle: src.title, sourceText: src.text, sourceUrl: String(x.d.source_url), sourceId: x.d.source_id,
      arabicTitle: String(x.d.title || ""), arabicBody: x.body, federation: String(x.d.federation || "WWE"),
      image: String(x.d.image || ""), gallery: Array.isArray(x.d.gallery) ? x.d.gallery.map(String) : [], date: new Date(x.d.date).toISOString(), filePrefix: prefix,
    }, ask);
    if (file) done++;
  }
  return done;
}
