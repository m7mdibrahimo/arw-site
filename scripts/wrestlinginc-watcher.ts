// ── Second-source watcher: Wrestling Inc (wrestlinginc.com) ──────────────
// Same publishing pipeline as fightful-watcher.ts (spoiler shield, AI title
// crafting, sanitizer, image handling) — this file only fetches and adapts
// Wrestling Inc's public RSS feed into the WordPress-post shape that
// processPost() already expects, then hands off to the exact same,
// already-tested pipeline. It does not duplicate any of that logic.
//
// Extra safety this source needs that Fightful didn't: since two
// independent outlets can cover the same real-world story, every candidate
// is checked against recently-published articles (any source) for
// wrestler-name overlap before it's allowed through — see
// isLikelyDuplicateOfRecentCoverage().
import fs from "fs";
import path from "path";
import { processPost, deduplicateNewsFiles, findKnownArabicNames, geminiQuotaExhausted, lastPostShouldRetry } from "./fightful-watcher";

if (fs.existsSync(".env")) {
  try {
    // @ts-ignore
    if (typeof process.loadEnvFile === "function") process.loadEnvFile(".env");
  } catch (e) {}
}

const FEED_URL = "https://www.wrestlinginc.com/feed/";
const STATE_FILE = path.join(process.cwd(), "wrestlinginc-state.json");
const NEWS_DIR = path.join(process.cwd(), "content", "news");

// Hashed IDs land far above Fightful's real (small, WordPress-sequential)
// post IDs, so an accidental numeric collision between the two sources'
// processedIds is effectively impossible.
function stableIdFromGuid(guid: string): number {
  let hash = 2166136261; // FNV-1a
  for (let i = 0; i < guid.length; i++) {
    hash ^= guid.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return 900_000_000 + (hash >>> 0);
}

function decodeXmlEntities(str: string): string {
  return str
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

function extractTag(block: string, tag: string): string {
  const cdataMatch = block.match(new RegExp(`<${tag}[^>]*>\\s*<!\\[CDATA\\[([\\s\\S]*?)\\]\\]>\\s*</${tag}>`, "i"));
  if (cdataMatch) return cdataMatch[1].trim();
  const plainMatch = block.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`, "i"));
  return plainMatch ? decodeXmlEntities(plainMatch[1].trim()) : "";
}

interface WiFeedItem {
  title: string;
  link: string;
  guid: string;
  pubDate: string;
  contentHtml: string;
  thumbnail: string;
}

export function parseWrestlingIncFeed(xml: string): WiFeedItem[] {
  const items: WiFeedItem[] = [];
  const itemBlocks = xml.match(/<item>[\s\S]*?<\/item>/g) || [];
  for (const block of itemBlocks) {
    const link = extractTag(block, "link");
    const guid = extractTag(block, "guid") || link;
    if (!link || !guid) continue;
    const thumbMatch = block.match(/<media:thumbnail[^>]+url=["']([^"']+)["']/i);
    items.push({
      title: extractTag(block, "title"),
      link,
      guid,
      pubDate: extractTag(block, "pubDate"),
      contentHtml: extractTag(block, "content:encoded") || extractTag(block, "description"),
      thumbnail: thumbMatch ? thumbMatch[1] : "",
    });
  }
  return items;
}

async function fetchWrestlingIncFeed(): Promise<WiFeedItem[]> {
  const res = await fetch(FEED_URL, {
    signal: AbortSignal.timeout(15000),
    headers: { "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36" },
  });
  if (!res.ok) throw new Error(`Failed to fetch Wrestling Inc feed: HTTP ${res.status}`);
  return parseWrestlingIncFeed(await res.text());
}

function loadState(): { processedIds: number[]; lastChecked: string } {
  try {
    if (fs.existsSync(STATE_FILE)) return JSON.parse(fs.readFileSync(STATE_FILE, "utf-8"));
  } catch (e) {}
  return { processedIds: [], lastChecked: "" };
}

function saveState(state: { processedIds: number[]; lastChecked: string }) {
  fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2), "utf-8");
}

// Proper-noun overlap check against everything published site-wide (any
// source) in the last 48h. Two+ shared capitalized-word tokens between the
// candidate's English title and an existing article's stored source title
// is treated as the same real-world story already covered. Comparing raw
// English words against the site's Arabic content doesn't work — instead
// this runs the candidate's English title through the same wrestler-names
// glossary the translation pipeline itself uses, so "Logan Paul" resolves
// to "لوغان بول" before ever touching an Arabic title.
function extractTitleField(header: string): string {
  const quoted = header.match(/^title:\s*"(.+?)"\s*$/m);
  if (quoted) return quoted[1];
  const bare = header.match(/^title:\s*(.+?)\s*$/m);
  return bare ? bare[1] : "";
}

function extractDateField(header: string): number {
  const m = header.match(/^date:\s*(\S+)/m);
  if (!m) return NaN;
  const t = new Date(m[1]).getTime();
  return Number.isNaN(t) ? NaN : t;
}

export function isLikelyDuplicateOfRecentCoverage(candidateTitle: string, hoursWindow = 48): boolean {
  const candidateNames = findKnownArabicNames(candidateTitle);
  if (candidateNames.length === 0) return false; // no recognized names — can't compare safely, let it through
  if (!fs.existsSync(NEWS_DIR)) return false;
  const cutoff = Date.now() - hoursWindow * 60 * 60 * 1000;
  const neededMatches = Math.min(candidateNames.length, 2);

  for (const file of fs.readdirSync(NEWS_DIR)) {
    if (!file.endsWith(".md")) continue;
    const filePath = path.join(NEWS_DIR, file);
    let header = "";
    try {
      // Publish date comes from frontmatter, never from filesystem mtime —
      // git operations (pull/rebase/checkout) reset mtime to "now" for every
      // touched file regardless of when the article actually went live.
      header = fs.readFileSync(filePath, "utf-8").slice(0, 1000);
    } catch (e) {
      continue;
    }
    const publishedAt = extractDateField(header);
    if (Number.isNaN(publishedAt) || publishedAt < cutoff) continue;
    const targetTitle = extractTitleField(header);
    if (!targetTitle) continue;
    const matches = candidateNames.filter(name => targetTitle.includes(name)).length;
    if (matches >= neededMatches) return true;
  }
  return false;
}

// Wrestling Inc's RSS carries only a one-line teaser (~250 chars), never the
// story. Articles written from that teaser came out as generic filler with
// nothing the headline promised (e.g. "3 Things We Hated & 3 We Loved" with no
// things). The full text lives in the page's <article class="news-post">.
const MIN_FULL_TEXT = 600;
export function extractWrestlingIncArticle(html: string): string | null {
  const start = html.indexOf('<article class="news-post"');
  if (start === -1) return null;
  const end = html.indexOf("</article>", start);
  let article = html.slice(start, end === -1 ? undefined : end);
  const firstP = article.search(/<p[\s>]/i);
  if (firstP > 0) article = article.slice(firstP); // drop headline/byline/"Add Wrestling Inc. on Google"
  article = article
    .replace(/<(script|style|noscript|svg|form|button)[\s\S]*?<\/\1>/gi, "")
    .replace(/<p[^>]*>\s*Written by[\s\S]*?<\/p>/gi, "");
  const text = article.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
  return text.length >= MIN_FULL_TEXT ? article : null;
}

export async function fetchWrestlingIncFullHtml(url: string): Promise<string | null> {
  try {
    const res = await fetch(url, {
      signal: AbortSignal.timeout(20000),
      headers: { "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126 Safari/537.36" },
    });
    if (!res.ok) return null;
    return extractWrestlingIncArticle(await res.text());
  } catch {
    return null;
  }
}

function toWpPost(item: { title: string; link: string; pubDate: string; contentHtml: string; thumbnail: string }, id: number) {
  return {
    id,
    title: { rendered: item.title },
    content: { rendered: item.contentHtml + (item.thumbnail ? `<img src="${item.thumbnail}">` : "") },
    link: item.link,
    date_gmt: new Date(item.pubDate).toISOString(),
    date: new Date(item.pubDate).toISOString(),
  };
}

/** Manual add/update from the admin panel (fightful-watcher.yml routes this source's URLs here). */
export async function processWrestlingIncUrl(url: string): Promise<boolean> {
  const norm = (u: string) => u.replace(/[?#].*$/, "").replace(/\/+$/, "").toLowerCase();
  const item = (await fetchWrestlingIncFeed()).find(i => norm(i.link) === norm(url));
  if (!item) {
    console.warn(`[WI Watcher] ${url} is no longer in the RSS feed, so its full text can't be fetched.`);
    return false;
  }
  const id = stableIdFromGuid(item.guid);
  const full = await fetchWrestlingIncFullHtml(item.link);
  if (!full) {
    console.warn(`[WI Watcher] Could not fetch the full article text for ${url}; not publishing a teaser-only story.`);
    return false;
  }
  const ok = await processPost(toWpPost({ ...item, contentHtml: full }, id), new Date(), false, { manual: true });
  const state = loadState();
  if (!state.processedIds.includes(id)) state.processedIds.push(id);
  saveState(state);
  return ok;
}

export async function runWrestlingIncWatcher(options: { dryRun?: boolean; maxPerRun?: number } = {}): Promise<void> {
  const state = loadState();
  const items = await fetchWrestlingIncFeed();
  console.log(`[WI Watcher] Fetched ${items.length} items from Wrestling Inc.`);

  // Same purpose as fightful-watcher.ts's watcher-feed.json: lets
  // admin/watcher.html show this source's latest posts too.
  try {
    const feedPath = path.join(process.cwd(), "watcher-feed-wrestlinginc.json");
    const cleanFeed = items.slice(0, 30).map(item => ({
      id: stableIdFromGuid(item.guid),
      link: item.link,
      date: item.pubDate,
      date_gmt: item.pubDate ? new Date(item.pubDate).toISOString() : item.pubDate,
      title: { rendered: item.title },
      featured_image: item.thumbnail || "",
    }));
    fs.writeFileSync(feedPath, JSON.stringify(cleanFeed, null, 2), "utf-8");
  } catch (err) {
    console.warn("[WI Watcher] Warning: could not write watcher-feed-wrestlinginc.json:", err);
  }

  let processedCount = 0;
  const maxPerRun = options.maxPerRun ?? 5;

  for (const item of [...items].reverse()) {
    const id = stableIdFromGuid(item.guid);
    if (state.processedIds.includes(id)) continue;

    const ageHours = item.pubDate ? (Date.now() - new Date(item.pubDate).getTime()) / 3600000 : 999;
    if (ageHours > 24) continue; // same freshness window as the Fightful watcher

    // No title-name pre-filter here: it dropped any story whose title shared a
    // single wrestler name with ANY article of the last 48h (every Roman Reigns
    // story, for example) and left no trace (INCIDENTS #43). processPost's own
    // duplicate guard compares the content, asks Gemini to confirm, and records
    // real duplicates in _data/duplicate-skips.json.

    if (options.dryRun) {
      console.log(`[WI Watcher] [dry-run] Would process: "${item.title}" (${item.link})`);
      processedCount++;
      if (processedCount >= maxPerRun) break;
      continue;
    }

    const full = await fetchWrestlingIncFullHtml(item.link);
    if (!full) {
      // Not marked processed: a transient fetch failure is retried next run.
      console.warn(`[WI Watcher] ⏭️ Full text unavailable, skipping for now: "${item.title}"`);
      continue;
    }
    const fakeWpPost = toWpPost({ ...item, contentHtml: full }, id);

    const ok = await processPost(fakeWpPost);
    if (!ok && geminiQuotaExhausted()) {
      // Gemini is out of quota: the article was never really tried. Leave it
      // unprocessed so the next run picks it up (INCIDENTS #37 — these used to
      // be marked processed and lost for good).
      console.warn(`[WI Watcher] ⏸️ Gemini quota exhausted — "${item.title}" left for the next run.`);
      break;
    }
    if (!ok && lastPostShouldRetry()) continue; // e.g. results not posted yet — retry next run
    state.processedIds.push(id);
    saveState(state);
    if (ok) {
      processedCount++;
      await new Promise(r => setTimeout(r, 3500));
    }
    if (processedCount >= maxPerRun) break;
  }

  state.lastChecked = new Date().toISOString();
  saveState(state);
  deduplicateNewsFiles();
  console.log(`[WI Watcher] Done. Published ${processedCount} new article(s).`);
}

if (require.main === module) {
  const dryRun = process.argv.includes("--dry-run");
  runWrestlingIncWatcher({ dryRun }).catch(err => {
    console.error("[WI Watcher] Fatal error:", err);
    process.exit(1);
  });
}
