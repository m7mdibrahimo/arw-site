// ── Third-source watcher: Ringside News (ringsidenews.com) ───────────────
// Same design as wrestlinginc-watcher.ts: parse the source's public RSS
// feed into a WordPress-post-shaped object and hand it to the existing,
// already-tested processPost() pipeline (spoiler shield, AI title crafting,
// sanitizer, image handling, cross-source duplicate check all reused
// as-is — see wrestlinginc-watcher.ts for how each of those works).
import fs from "fs";
import path from "path";
import { processPost, isSingleMatchResultArticle, deduplicateNewsFiles, findKnownArabicNames } from "./fightful-watcher";

if (fs.existsSync(".env")) {
  try {
    // @ts-ignore
    if (typeof process.loadEnvFile === "function") process.loadEnvFile(".env");
  } catch (e) {}
}

const FEED_URL = "https://www.ringsidenews.com/feed/";
const STATE_FILE = path.join(process.cwd(), "ringsidenews-state.json");
const NEWS_DIR = path.join(process.cwd(), "content", "news");

// Ringside News guids are "https://www.ringsidenews.com/?p=<id>" — the real
// WordPress post ID is right there, no hashing needed like Wrestling Inc
// (whose feed has no such id). Offset well clear of both Fightful's small
// sequential IDs and Wrestling Inc's hash range (900,000,000+).
function idFromGuid(guid: string): number {
  const m = guid.match(/[?&]p=(\d+)/);
  if (m) return 800_000_000 + Number(m[1]);
  let hash = 2166136261;
  for (let i = 0; i < guid.length; i++) {
    hash ^= guid.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return 800_000_000 + (hash >>> 0);
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

interface RsnFeedItem {
  title: string;
  link: string;
  guid: string;
  pubDate: string;
  contentHtml: string;
}

export function parseRingsideNewsFeed(xml: string): RsnFeedItem[] {
  const items: RsnFeedItem[] = [];
  const itemBlocks = xml.match(/<item>[\s\S]*?<\/item>/g) || [];
  for (const block of itemBlocks) {
    const link = extractTag(block, "link");
    const guid = extractTag(block, "guid") || link;
    if (!link || !guid) continue;
    items.push({
      title: extractTag(block, "title"),
      link,
      guid,
      pubDate: extractTag(block, "pubDate"),
      contentHtml: extractTag(block, "content:encoded") || extractTag(block, "description"),
    });
  }
  return items;
}

async function fetchRingsideNewsFeed(): Promise<RsnFeedItem[]> {
  const res = await fetch(FEED_URL, {
    signal: AbortSignal.timeout(15000),
    headers: { "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36" },
  });
  if (!res.ok) throw new Error(`Failed to fetch Ringside News feed: HTTP ${res.status}`);
  return parseRingsideNewsFeed(await res.text());
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

// Identical logic to wrestlinginc-watcher.ts's version — kept in sync
// deliberately rather than shared, since each watcher is meant to stay a
// single, readable file someone can delete independently if a source ever
// needs to be dropped.
export function isLikelyDuplicateOfRecentCoverage(candidateTitle: string, hoursWindow = 48): boolean {
  const candidateNames = findKnownArabicNames(candidateTitle);
  if (candidateNames.length === 0) return false;
  if (!fs.existsSync(NEWS_DIR)) return false;
  const cutoff = Date.now() - hoursWindow * 60 * 60 * 1000;
  const neededMatches = Math.min(candidateNames.length, 2);

  for (const file of fs.readdirSync(NEWS_DIR)) {
    if (!file.endsWith(".md")) continue;
    let header = "";
    try {
      header = fs.readFileSync(path.join(NEWS_DIR, file), "utf-8").slice(0, 1000);
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

export async function runRingsideNewsWatcher(options: { dryRun?: boolean; maxPerRun?: number } = {}): Promise<void> {
  const state = loadState();
  const items = await fetchRingsideNewsFeed();
  console.log(`[RSN Watcher] Fetched ${items.length} items from Ringside News.`);

  // Same purpose as fightful-watcher.ts's watcher-feed.json: lets
  // admin/watcher.html show this source's latest posts too.
  try {
    const feedPath = path.join(process.cwd(), "watcher-feed-ringsidenews.json");
    const cleanFeed = items.slice(0, 30).map(item => ({
      id: idFromGuid(item.guid),
      link: item.link,
      date: item.pubDate,
      date_gmt: item.pubDate ? new Date(item.pubDate).toISOString() : item.pubDate,
      title: { rendered: item.title },
      featured_image: "",
    }));
    fs.writeFileSync(feedPath, JSON.stringify(cleanFeed, null, 2), "utf-8");
  } catch (err) {
    console.warn("[RSN Watcher] Warning: could not write watcher-feed-ringsidenews.json:", err);
  }

  let processedCount = 0;
  const maxPerRun = options.maxPerRun ?? 5;

  for (const item of [...items].reverse()) {
    const id = idFromGuid(item.guid);
    if (state.processedIds.includes(id)) continue;

    const ageHours = item.pubDate ? (Date.now() - new Date(item.pubDate).getTime()) / 3600000 : 999;
    if (ageHours > 24) continue;

    if (isSingleMatchResultArticle(item.title, item.contentHtml)) {
      console.log(`[RSN Watcher] 🛡️ Spoiler shield: skipping "${item.title}"`);
      state.processedIds.push(id);
      continue;
    }

    if (isLikelyDuplicateOfRecentCoverage(item.title)) {
      console.log(`[RSN Watcher] ⏭️ Likely already covered via another source: "${item.title}"`);
      state.processedIds.push(id);
      continue;
    }

    if (options.dryRun) {
      console.log(`[RSN Watcher] [dry-run] Would process: "${item.title}" (${item.link})`);
      processedCount++;
      if (processedCount >= maxPerRun) break;
      continue;
    }

    const fakeWpPost = {
      id,
      title: { rendered: item.title },
      content: { rendered: item.contentHtml },
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
  console.log(`[RSN Watcher] Done. Published ${processedCount} new article(s).`);
}

if (require.main === module) {
  const dryRun = process.argv.includes("--dry-run");
  runRingsideNewsWatcher({ dryRun }).catch(err => {
    console.error("[RSN Watcher] Fatal error:", err);
    process.exit(1);
  });
}
