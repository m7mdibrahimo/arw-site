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
import { processPost, deduplicateNewsFiles, findKnownArabicNames } from "./fightful-watcher";

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

    if (isLikelyDuplicateOfRecentCoverage(item.title)) {
      console.log(`[WI Watcher] ⏭️ Likely already covered via another source: "${item.title}"`);
      state.processedIds.push(id);
      continue;
    }

    if (options.dryRun) {
      console.log(`[WI Watcher] [dry-run] Would process: "${item.title}" (${item.link})`);
      processedCount++;
      if (processedCount >= maxPerRun) break;
      continue;
    }

    const fakeWpPost = {
      id,
      title: { rendered: item.title },
      content: { rendered: item.contentHtml + (item.thumbnail ? `<img src="${item.thumbnail}">` : "") },
      link: item.link,
      date_gmt: new Date(item.pubDate).toISOString(),
      date: new Date(item.pubDate).toISOString(),
    };

    const ok = await processPost(fakeWpPost);
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
