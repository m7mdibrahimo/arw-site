// Keeps show-results articles in step with their source while the show is live.
// Fightful / Ringside / Wrestling Inc publish a results page when the show starts
// and keep adding matches until it ends; the article used to freeze at whatever
// was there on first publish (the owner re-published by hand after every show —
// which also changed the URL and re-posted to social). For HOURS after publish,
// every watcher run re-reads the source and, when it has grown, rewrites the
// article in place (keepUrl: same file/URL, no social re-post).
//   npx tsx scripts/live-results-updater.ts [--dry-run]
import fs from "fs";
import path from "path";
import crypto from "crypto";
import matter from "gray-matter";
import { processPost, htmlToPlainText, countResultLines, geminiQuotaExhausted } from "./fightful-watcher";
import { extractRingsideArticle } from "./ringsidenews-watcher";
import { extractWrestlingIncArticle } from "./wrestlinginc-watcher";

const NEWS_DIR = path.join(process.cwd(), "content", "news");
const STATE_FILE = path.join(process.cwd(), "live-results-state.json");
const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126 Safari/537.36";

export const LIVE_WINDOW_HOURS = 8;     // follow a results article this long after it went live
const SETTLE_MS = 20 * 60_000;          // source unchanged this long = the show is over
const MIN_GAP_MS = 15 * 60_000;         // never rewrite the same article more often
const NEW_RESULTS_STEP = 2;             // mid-show: rewrite once 2+ new finishes arrived
const MAX_REWRITES = 8;
const MAX_PER_RUN = 2;

export interface LiveEntry {
  lastSeenHash: string;
  lastChangeAt: number;
  generatedHash: string;
  generatedResults: number;
  generatedLength: number;
  lastRegenAt: number;
  rewrites: number;
}

export interface SourceSnapshot { hash: string; results: number; length: number }

/** Pure decision: should this article be rewritten from the current source? */
export function decideLiveUpdate(entry: LiveEntry, snap: SourceSnapshot, now: number): { entry: LiveEntry; rewrite: boolean; reason: string } {
  const e = { ...entry };
  if (snap.hash !== e.lastSeenHash) { e.lastSeenHash = snap.hash; e.lastChangeAt = now; }
  if (snap.hash === e.generatedHash) return { entry: e, rewrite: false, reason: "unchanged" };
  if (snap.results === 0 || snap.results < e.generatedResults) return { entry: e, rewrite: false, reason: "source has fewer results (bad fetch?)" };
  if (e.rewrites >= MAX_REWRITES) return { entry: e, rewrite: false, reason: "rewrite cap reached" };
  if (now - e.lastRegenAt < MIN_GAP_MS) return { entry: e, rewrite: false, reason: "rewritten recently" };
  if (snap.results >= e.generatedResults + NEW_RESULTS_STEP) return { entry: e, rewrite: true, reason: `${snap.results - e.generatedResults} new results` };
  // The show is over: the page stopped changing and holds more than the article was written from.
  const grew = snap.results > e.generatedResults || snap.length > e.generatedLength * 1.1;
  if (grew && now - e.lastChangeAt >= SETTLE_MS) return { entry: e, rewrite: true, reason: "final results settled" };
  return { entry: e, rewrite: false, reason: "waiting" };
}

async function fetchSource(url: string): Promise<{ title?: string; html: string; image?: string } | null> {
  if (/fightful\.com/.test(url)) {
    const id = url.match(/[?&]p=(\d+)/)?.[1];
    const slug = url.replace(/[?#].*$/, "").replace(/\/+$/, "").split("/").pop();
    const api = id ? `https://www.fightful.com/wp-json/wp/v2/posts/${id}?_embed=1` : `https://www.fightful.com/wp-json/wp/v2/posts?slug=${encodeURIComponent(slug || "")}&_embed=1`;
    const res = await fetch(api, { signal: AbortSignal.timeout(20000), headers: { "User-Agent": UA } });
    if (!res.ok) return null;
    const data: any = await res.json();
    const post = Array.isArray(data) ? data[0] : data;
    if (!post?.content?.rendered) return null;
    return { title: post.title?.rendered, html: post.content.rendered, image: post._embedded?.["wp:featuredmedia"]?.[0]?.source_url };
  }
  const res = await fetch(url, { signal: AbortSignal.timeout(20000), headers: { "User-Agent": UA } });
  if (!res.ok) return null;
  const page = await res.text();
  const image = page.match(/<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)/i)?.[1];
  const html = /ringsidenews\.com/.test(url) ? extractRingsideArticle(page) : /wrestlinginc\.com/.test(url) ? extractWrestlingIncArticle(page) : null;
  return html ? { html, image } : null;
}

const snapshotOf = (html: string): SourceSnapshot => {
  const text = htmlToPlainText(html).replace(/\s+/g, " ").trim();
  return { hash: crypto.createHash("sha1").update(text).digest("hex"), results: countResultLines(text), length: text.length };
};

export async function runLiveResultsUpdater(options: { dryRun?: boolean } = {}): Promise<number> {
  if (!fs.existsSync(NEWS_DIR)) return 0;
  let state: Record<string, LiveEntry> = {};
  try { state = JSON.parse(fs.readFileSync(STATE_FILE, "utf-8")); } catch {}
  const now = Date.now();
  const next: Record<string, LiveEntry> = {};
  let rewritten = 0;

  const files = fs.readdirSync(NEWS_DIR).filter(f => f.endsWith(".md")).sort().reverse().slice(0, 200);
  for (const file of files) {
    const filePath = path.join(NEWS_DIR, file);
    const { data } = matter(fs.readFileSync(filePath, "utf-8"));
    if (data.source_results === undefined || !data.source_url) continue;
    const liveSince = new Date(data.published_at || data.date).getTime();
    if (!Number.isFinite(liveSince) || now - liveSince > LIVE_WINDOW_HOURS * 3600_000) continue;

    const src = await fetchSource(String(data.source_url)).catch(() => null);
    if (!src) { if (state[file]) next[file] = state[file]; continue; }
    const snap = snapshotOf(src.html);
    // First sighting: if the source still says what the article was written from, that's the baseline.
    const base: LiveEntry = state[file] || {
      lastSeenHash: "", lastChangeAt: now, lastRegenAt: 0, rewrites: 0,
      generatedResults: Number(data.source_results) || 0,
      generatedHash: snap.results === Number(data.source_results) ? snap.hash : "",
      generatedLength: snap.results === Number(data.source_results) ? snap.length : 0,
    };
    const decision = decideLiveUpdate(base, snap, now);
    next[file] = decision.entry;
    console.log(`[Live Results] ${file.slice(0, 70)} — ${snap.results} results (article: ${base.generatedResults}) → ${decision.reason}`);
    if (!decision.rewrite || options.dryRun || rewritten >= MAX_PER_RUN) continue;
    if (geminiQuotaExhausted()) { console.warn("[Live Results] Gemini quota exhausted — next run."); break; }

    const date = new Date(data.date).toISOString();
    const oldImage = String(data.image || "");
    const post = {
      id: Number(data.source_id),
      title: { rendered: src.title || String(data.source_title || "") },
      content: { rendered: src.html + (src.image ? `<img src="${src.image}">` : "") },
      link: String(data.source_url),
      date_gmt: date,
      date,
    };
    const ok = await processPost(post, date, false, { manual: true, keepUrl: true }).catch(e => { console.error("[Live Results]", e.message); return false; });
    if (!ok) { console.warn(`[Live Results] ⚠️ Rewrite refused for ${file}; keeping the published version.`); continue; }
    rewritten++;
    next[file] = { ...decision.entry, generatedHash: snap.hash, generatedResults: snap.results, generatedLength: snap.length, lastRegenAt: now, rewrites: decision.entry.rewrites + 1 };
    console.log(`[Live Results] ✅ Rewrote ${file} from the updated source (${decision.reason}).`);
    // The rewrite stores a fresh copy of the cover image; drop the old one if nothing else uses it.
    const newImage = String(matter(fs.readFileSync(filePath, "utf-8")).data.image || "");
    if (oldImage && oldImage !== newImage && oldImage.startsWith("/content/images/")) {
      const stillUsed = fs.readdirSync(NEWS_DIR).some(f => fs.readFileSync(path.join(NEWS_DIR, f), "utf-8").includes(oldImage));
      const oldPath = path.join(process.cwd(), oldImage);
      if (!stillUsed && fs.existsSync(oldPath)) fs.unlinkSync(oldPath);
    }
  }

  if (!options.dryRun) fs.writeFileSync(STATE_FILE, JSON.stringify(next, null, 2) + "\n");
  return rewritten;
}

if (require.main === module) {
  runLiveResultsUpdater({ dryRun: process.argv.includes("--dry-run") })
    .then(n => console.log(`[Live Results] Done: ${n} article(s) rewritten.`))
    .catch(e => { console.error("[Live Results] Fatal:", e); process.exit(0); });
}
