import fs from "fs";
import path from "path";
import crypto from "crypto";
import sharp from "sharp";

// Load environment variables if .env exists
if (fs.existsSync(".env")) {
  try {
    // @ts-ignore
    if (typeof process.loadEnvFile === "function") {
      process.loadEnvFile(".env");
    }
  } catch (e) {}
}

const API_KEYS = (process.env.GEMINI_API_KEYS || process.env.GEMINI_API_KEY || "")
  .split(",")
  .map(k => k.trim())
  .filter(Boolean);

const STATE_FILE = path.join(process.cwd(), "watcher-state.json");
const IMAGES_DIR = path.join(process.cwd(), "content", "images");
const NEWS_DIR = path.join(process.cwd(), "content", "news");

// Ensure target directories exist
if (!fs.existsSync(IMAGES_DIR)) fs.mkdirSync(IMAGES_DIR, { recursive: true });
if (!fs.existsSync(NEWS_DIR)) fs.mkdirSync(NEWS_DIR, { recursive: true });

// Site Publishing Policy:
// If false (default), all news articles are published to the website archive/news section,
// while social media platforms remain 100% clean and spoiler-free via server.ts.
// If true, single-match micro stubs are also skipped from the site.
const SKIP_SINGLE_MATCH_ON_SITE = process.env.SKIP_SINGLE_MATCH_ON_SITE === "true";

interface WatcherState {
  enabled?: boolean;
  processedIds: number[];
  lastChecked: string;
  apiCallsToday?: number;
  apiCallDate?: string;
}

function loadState(): WatcherState {
  const today = new Date().toISOString().slice(0, 10);
  if (fs.existsSync(STATE_FILE)) {
    try {
      const data = JSON.parse(fs.readFileSync(STATE_FILE, "utf-8"));
      const isNewDay = data.apiCallDate !== today;
      return {
        enabled: data.enabled !== false,
        processedIds: Array.isArray(data.processedIds) ? data.processedIds : [],
        lastChecked: data.lastChecked || new Date().toISOString(),
        apiCallsToday: isNewDay ? 0 : (Number(data.apiCallsToday) || 0),
        apiCallDate: today,
      };
    } catch (e) {
      console.error("[Watcher] Error reading state file, starting fresh:", e);
    }
  }
  return { enabled: true, processedIds: [], lastChecked: new Date().toISOString(), apiCallsToday: 0, apiCallDate: today };
}

function saveState(state: WatcherState) {
  try {
    // Keep only last 1000 IDs to avoid endless file growth
    if (state.processedIds.length > 1000) {
      state.processedIds = state.processedIds.slice(-1000);
    }
    fs.writeFileSync(STATE_FILE, JSON.stringify({
      enabled: state.enabled !== false,
      processedIds: state.processedIds,
      lastChecked: state.lastChecked,
      apiCallsToday: state.apiCallsToday || 0,
      apiCallDate: state.apiCallDate || new Date().toISOString().slice(0, 10),
    }, null, 2), "utf-8");
  } catch (e) {
    console.error("[Watcher] Error saving state file:", e);
  }
}

// Generate random safe filename
function generateRandomImageName(): string {
  const chars = "abcdefghijklmnopqrstuvwxyz0123456789";
  let result = "";
  for (let i = 0; i < 16; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result + ".jpg";
}

// Download and optimize image using Sharp
async function downloadAndOptimizeImage(imageUrl: string): Promise<string | null> {
  try {
    console.log(`[Watcher] Downloading image: ${imageUrl}`);
    const res = await fetch(imageUrl, {
      signal: AbortSignal.timeout(15000),
      headers: {
        "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36",
      },
    });

    if (!res.ok) {
      console.error(`[Watcher] Failed to download image (status ${res.status}): ${imageUrl}`);
      return null;
    }

    const arrayBuffer = await res.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    const randomName = generateRandomImageName();
    const targetPath = path.join(IMAGES_DIR, randomName);

    // Compress with Sharp: auto-orient, max width 1200px, quality 85, mozjpeg
    await sharp(buffer)
      .rotate()
      .resize({ width: 1200, withoutEnlargement: true })
      .jpeg({ quality: 85, mozjpeg: true })
      .toFile(targetPath);

    console.log(`[Watcher] Saved optimized image to /content/images/${randomName}`);
    return `/content/images/${randomName}`;
  } catch (e: any) {
    console.error(`[Watcher] Error processing image:`, e.message || e);
    return null;
  }
}

// Extract YouTube video ID from HTML or text
function extractYouTubeVideoId(content: string): string | null {
  if (!content) return null;
  const match = content.match(/(?:youtube\.com\/(?:watch\?(?:.*&)?v=|embed\/|v\/|shorts\/)|youtu\.be\/)([a-zA-Z0-9_-]{11})/i);
  return match ? match[1] : null;
}

// Get the highest resolution available thumbnail for a YouTube video (like get-youtube-thumbnail.com)
async function getYouTubeThumbnailUrl(videoId: string): Promise<string | null> {
  const qualities = ["maxresdefault", "sddefault", "hqdefault", "0"];
  for (const q of qualities) {
    const url = `https://img.youtube.com/vi/${videoId}/${q}.jpg`;
    try {
      const res = await fetch(url, { method: "HEAD", signal: AbortSignal.timeout(5000) });
      if (res.ok && res.status === 200) {
        const len = Number(res.headers.get("content-length") || 0);
        if (len === 0 || len > 2000) {
          return url;
        }
      }
    } catch (e) {}
  }
  return `https://img.youtube.com/vi/${videoId}/hqdefault.jpg`;
}

// Extract media embed clean links (YouTube, Twitter/X, Instagram) from raw HTML
function extractEmbeds(html: string): string[] {
  const links: string[] = [];
  const seenUrls = new Set<string>();

  // 1. YouTube links (videos, shorts, embeds) -> clean URL: https://www.youtube.com/watch?v=ID
  const ytRegex = /https?:\/\/(?:www\.)?(?:youtube\.com\/(?:watch\?(?:.*&)?v=|embed\/|shorts\/|v\/)|youtu\.be\/)([a-zA-Z0-9_-]{11})/gi;
  let ytMatch: RegExpExecArray | null;
  while ((ytMatch = ytRegex.exec(html)) !== null) {
    const videoId = ytMatch[1];
    const cleanUrl = `https://www.youtube.com/watch?v=${videoId}`;
    if (!seenUrls.has(cleanUrl)) {
      seenUrls.add(cleanUrl);
      links.push(cleanUrl);
    }
  }

  // 2. Twitter / X links -> clean URL: https://x.com/USER/status/ID
  const twRegex = /https?:\/\/(?:twitter\.com|x\.com)\/([a-zA-Z0-9_]+)\/status\/([0-9]+)/gi;
  let twMatch: RegExpExecArray | null;
  while ((twMatch = twRegex.exec(html)) !== null) {
    const user = twMatch[1];
    const tweetId = twMatch[2];
    if (/^(?:Fightful|FightfulSelect)$/i.test(user)) {
      continue;
    }
    const cleanUrl = `https://x.com/${user}/status/${tweetId}`;
    if (!seenUrls.has(cleanUrl)) {
      seenUrls.add(cleanUrl);
      links.push(cleanUrl);
    }
  }

  // 3. Instagram links -> clean URL: https://www.instagram.com/p/ID/
  const igRegex = /https?:\/\/(?:www\.)?instagram\.com\/(?:p|reel|reels|tv)\/([a-zA-Z0-9_-]+)/gi;
  let igMatch: RegExpExecArray | null;
  while ((igMatch = igRegex.exec(html)) !== null) {
    const igId = igMatch[1];
    const cleanUrl = `https://www.instagram.com/p/${igId}/`;
    if (!seenUrls.has(cleanUrl)) {
      seenUrls.add(cleanUrl);
      links.push(cleanUrl);
    }
  }

  // 4. TikTok links -> clean URL: https://www.tiktok.com/@USER/video/ID
  const ttRegex = /https?:\/\/(?:www\.)?tiktok\.com\/@([a-zA-Z0-9_.-]+)\/video\/([0-9]+)/gi;
  let ttMatch: RegExpExecArray | null;
  while ((ttMatch = ttRegex.exec(html)) !== null) {
    const ttUser = ttMatch[1];
    const ttId = ttMatch[2];
    const cleanUrl = `https://www.tiktok.com/@${ttUser}/video/${ttId}`;
    if (!seenUrls.has(cleanUrl)) {
      seenUrls.add(cleanUrl);
      links.push(cleanUrl);
    }
  }

  return links;
}

// Clean HTML to text for AI prompt
function htmlToPlainText(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<figure[\s\S]*?<\/figure>/gi, "")
    .replace(/<blockquote class="twitter-tweet"[\s\S]*?<\/blockquote>/gi, "")
    .replace(/<blockquote class="instagram-media"[\s\S]*?<\/blockquote>/gi, "")
    .replace(/<blockquote class="tiktok-embed"[\s\S]*?<\/blockquote>/gi, "")
    .replace(/<div class="stream-item[\s\S]*?<\/div>/gi, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#8217;/g, "'")
    .replace(/&#8216;/g, "'")
    .replace(/&#8211;/g, "-")
    .replace(/&#8212;/g, "—")
    .replace(/\s+/g, " ")
    .trim();
}

interface RewrittenArticle {
  title: string;
  federation: string;
  tags: string[];
  body_markdown: string;
}

// Remove all Arabic diacritics / tashkeel (fat-ha, damma, kasra, tanween, sukun, shadda, dagger alif, tatweel)
function removeTashkeel(text: string): string {
  if (!text) return "";
  return text
    .replace(/[\u064B-\u065F\u0670\u06D6-\u06ED]/g, "")
    .replace(/\u0640/g, "");
}

// Convert any occurrence of 'حلقة' to 'عرض', enforce English promotion/show names, scrub third-party branding, and strip all tashkeel
export function sanitizeWrestlingTerms(text: string): string {
  if (!text) return text;
  const arBoundL = "(?<![\\u0600-\\u06FF])";
  const arBoundR = "(?![\\u0600-\\u06FF])";
  const arWord = (pattern: string, flags = "g") => new RegExp(arBoundL + "(?:" + pattern + ")" + arBoundR, flags);

  const cleaned = text
    // 1. Enforce English names for Promotions (no Arabic transliterations)
    .replace(arWord("(?:اتحاد\\s+)?(?:دبليو\\s*دبليو\\s*[إا]ي)"), "WWE")
    .replace(arWord("(?:اتحاد\\s+)?(?:[إا]يه\\s*[إا]ي\\s*دبليو)"), "AEW")
    .replace(arWord("(?:اتحاد\\s+)?(?:تي\\s*[إا]ن\\s*[إا]يه)"), "TNA")
    .replace(arWord("(?:اتحاد\\s+)?(?:[آا]ر\\s*[أا]وه\\s*[إا]تش)"), "ROH")
    .replace(arWord("(?:اتحاد\\s+)?(?:[إا]م\\s*[إا]ل\\s*دبليو)"), "MLW")
    .replace(arWord("(?:اتحاد\\s+)?(?:نيو\\s*جابان(?:\\s*برو\\s*ريسل(?:ينغ|نج))?)"), "NJPW")

    // 2. Enforce English names for Shows (no Arabic transliterations)
    .replace(arWord("(?:عرض\\s+)?(?:الرو|الراو)"), "عرض WWE RAW")
    .replace(arWord("(?:عرض\\s+)?(?:سماك\\s*داون|سماكداون)"), "عرض WWE SmackDown")
    .replace(arWord("(?:عرض\\s+)?(?:[إا]ن\\s*[إا]كس\\s*تي)"), "عرض WWE NXT")
    .replace(arWord("(?:عرض\\s+)?(?:ديناميت|داينمايت)"), "عرض AEW Dynamite")
    .replace(arWord("(?:عرض\\s+)?(?:كوليجن|كوليزن|كوليجين)"), "عرض AEW Collision")
    .replace(arWord("(?:عرض\\s+)?(?:رامبيج|رامباج)"), "عرض AEW Rampage")
    .replace(arWord("(?:عرض\\s+)?(?:[إا]مباكت)"), "عرض TNA iMPACT")

    // Fix double occurrences created by replacement (e.g. "عرض عرض" or "WWE WWE")
    .replace(/(?:عرض\s+)+عرض\s+/g, "عرض ")
    .replace(/عرض\s+عرض/g, "عرض")
    .replace(/WWE\s+WWE/g, "WWE")
    .replace(/AEW\s+AEW/g, "AEW")
    .replace(/TNA\s+TNA/g, "TNA")

    // 3. Strict show terminology (strictly replace 'حلقة' and 'مهرجان' with 'عرض' / 'عروض')
    .replace(arWord("مهرجانات"), "عروض")
    .replace(arWord("المهرجانات"), "العروض")
    .replace(arWord("بالمهرجانات"), "بالعروض")
    .replace(arWord("للمهرجانات"), "للعروض")
    .replace(arWord("مهرجان"), "عرض")
    .replace(arWord("المهرجان"), "العرض")
    .replace(arWord("بالمهرجان"), "بالعرض")
    .replace(arWord("للمهرجان"), "للعرض")
    .replace(/\bحلقة\s+(NXT|RAW|SmackDown|Dynamite|Collision|IMPACT|WWE|AEW|TNA|ROH|عرض)\b/gi, "عرض $1")
    .replace(/حلقات\s+عروض/g, "عروض")
    .replace(/حلقة\s+عرض/g, "عرض")
    .replace(arWord("(?:في|خلال|من|بـ?|عبر)\\s+حلقة\\s+([^\\s]+)"), "في عرض $1")
    .replace(arWord("حلقة\\s+(اليوم|الليلة|أمس|الأسبوع)"), "عرض $1")
    .replace(arWord("آخر\\s+حلقة"), "آخر عرض")
    .replace(arWord("أحدث\\s+حلقة"), "أحدث عرض")
    .replace(arWord("الحلقة\\s+(القادمة|الماضية|الأخيرة|الافتتاحية|الخاصة)"), "العرض $1")
    .replace(arWord("حلقات\\s+المصارعة"), "عروض المصارعة")
    .replace(arWord("حلقة\\s+(جديدة|تلفزيونية|استثنائية)"), "عرض $1")
    .replace(arWord("حلقات"), "عروض")
    .replace(arWord("الحلقات"), "العروض")
    .replace(arWord("حلقة\\s+"), "عرض ")
    .replace(/(?:عرض\s+)+عرض\s+/g, "عرض ")
    .replace(/عرض\s+عرض/g, "عرض")

    // 4. Total Scrub of Fightful & foreign journalist branding to keep all news 100% exclusive to Arab Wrestling
    .replace(/Sean\s*Ross\s*Sapp/gi, "مصادر صحفية مطلعة")
    .replace(/Sean\s*Ross/gi, "مصادر صحفية")
    .replace(arWord("شون\\s*روس\\s*ساب"), "مصادر صحفية مطلعة")
    .replace(arWord("شون\\s*روس"), "مصادر صحفية")
    .replace(/Fightful\s*Select/gi, "مصادر خاصة")
    .replace(/موقع\s*\*?Fightful\*?/gi, "مصادر صحفية خاصة")
    .replace(/شبكة\s*\*?Fightful\*?/gi, "مصادر خاصة")
    .replace(/منصة\s*\*?Fightful\*?/gi, "مصادر خاصة")
    .replace(/تقرير\s*\*?Fightful\*?/gi, "تقارير خاصة")
    .replace(arWord("فايت\\s*فول"), "مصادرنا")
    .replace(arWord("فايتفول"), "مصادرنا")
    .replace(/\*?Fightful\*?/gi, "مصادرنا")

    // 5. Enforce Arabic names for Wrestlers (convert English wrestler names, abbreviations and acronyms to standard Arabic)
    // 5.1 Initials & Acronyms
    .replace(/\bAJ\s*Lee\b/gi, "إيه جيه لي")
    .replace(/AJ\s*Lee/gi, "إيه جيه لي")
    .replace(arWord("(?:اي|إي|أى|أي|ايه|إيه)\\s*لي"), "إيه جيه لي")
    .replace(arWord("(?:اي|إي|أى|أي|ايه|إيه)\\s*(?:جاي|جي|جيه)\\s*لي"), "إيه جيه لي")
    .replace(/\bAJ\s*Styles\b/gi, "إيه جيه ستايلز")
    .replace(/AJ\s*Styles/gi, "إيه جيه ستايلز")
    .replace(arWord("(?:اي|إي|أى|أي|ايه|إيه)\\s*ستايلز"), "إيه جيه ستايلز")
    .replace(arWord("(?:اي|إي|أى|أي|ايه|إيه)\\s*(?:جاي|جي|جيه)\\s*ستايلز"), "إيه جيه ستايلز")
    .replace(/\bCJ\s*Perry\b/gi, "سي جيه بيري")
    .replace(arWord("سي\\s*(?:جاي|جي|جيه)\\s*بيري"), "سي جيه بيري")
    .replace(/\bJD\s*McDonagh\b/gi, "جيه دي ماكدونا")
    .replace(arWord("(?:جاي|جي|جيه)\\s*دي\\s*ماكدونا"), "جيه دي ماكدونا")
    .replace(/\bR-Truth\b/gi, "ار تروث")
    .replace(arWord("[آا]?ر\\s*[-ـ]?\\s*تروث"), "ار تروث")
    .replace(/\bCM\s*Punk\b/gi, "سي ام بانك")
    .replace(arWord("سي\\s*[إا]?م\\s*ب[ان]ك"), "سي ام بانك")
    .replace(/\bLA\s*Knight\b/gi, "ال ايه نايت")
    .replace(arWord("[إا]?ل\\s*[إا]?يه\\s*نايت"), "ال ايه نايت")
    .replace(/\bMJF\b/g, "ام جيه اف")
    .replace(arWord("[إا]?م\\s*(?:جاي|جي|جيه)\\s*[إا]?ف"), "ام جيه اف")
    .replace(/\bFTR\b/g, "اف تي ار")
    .replace(arWord("[إا]?ف\\s*تي\\s*[آا]?ر"), "اف تي ار")
    .replace(/\bMVP\b/g, "ام في بي")
    .replace(arWord("[إا]?م\\s*في\\s*بي"), "ام في بي")
    .replace(/\bRVD\b/g, "ار في دي")
    .replace(arWord("[آا]?ر\\s*في\\s*دي"), "ار في دي")
    .replace(/\bJBL\b/g, "جيه بي إل")
    .replace(arWord("(?:جاي|جي|جيه)\\s*بي\\s*[إا]?ل"), "جيه بي إل")
    .replace(/\bPCO\b/g, "بي سي أو")
    .replace(arWord("بي\\s*سي\\s*[أاو]و?"), "بي سي أو")

    // 5.2 Women's Division & Terminology
    .replace(arWord("قسم\\s+النساء"), "قسم السيدات")
    .replace(arWord("مصارعة\\s+النساء"), "مصارعة السيدات")
    .replace(arWord("بطولة\\s+النساء"), "بطولة السيدات")
    .replace(arWord("روستر\\s+النساء"), "قسم السيدات")
    .replace(arWord("فئة\\s+النساء"), "قسم السيدات")
    .replace(arWord("المصارعة\\s+النسائية"), "مصارعة السيدات")
    .replace(arWord("قسم\\s+المصارعة\\s+النسائية"), "قسم السيدات")
    .replace(arWord("المصارعات\\s+النساء"), "مصارعات قسم السيدات")
    .replace(arWord("مصارعات\\s+النساء"), "مصارعات قسم السيدات")

    // 5.3 Active & Legendary Wrestlers (English to Arabic + Arabic Auto-Correction)
    .replace(/\bSeth\s+"?Freakin"?\s+Rollins\b/gi, "سيث رولينز")
    .replace(/\bSeth\s*Rollins\b/gi, "سيث رولينز")
    .replace(arWord("ستيف\\s+رولين?ز"), "سيث رولينز")
    .replace(arWord("سيث\\s+رولنز"), "سيث رولينز")
    .replace(/\bDean\s*Malenko\b/gi, "دين مالينكو")
    .replace(/\bOrange\s*Cassidy\b/gi, "أورانج كاسيدي")
    .replace(arWord("اورانج\\s+كاسيدي"), "أورانج كاسيدي")
    .replace(/\bJay\s*Lethal\b/gi, "جاي ليثال")
    .replace(arWord("جاي\\s+ليثل"), "جاي ليثال")
    .replace(/\bAndrade\s+(?:El\s+Idolo)?\b/gi, "أندرادي إل إيدولو")
    .replace(/\bAndrade\b/gi, "أندرادي")
    .replace(arWord("(?:انقرادي|أنقرادي)\\s*(?:ال|إل)?\\s*(?:إيدولو|ايدولو)?"), "أندرادي إل إيدولو")
    .replace(arWord("(?:انقرادي|أنقرادي)"), "أندرادي")
    .replace(/\bEl\s*Grande\s*Americano\b/gi, "إل غراندي أمريكانو")
    .replace(arWord("(?:ال[أإا]?مرك?نو\\s*الكبير|ال[أإا]?مريكانو\\s*الكبير|الجراندي\\s*امريكانو|إل\\s*جراندي\\s*أمريكانو|الغراندي\\s*امريكانو)"), "إل غراندي أمريكانو")
    .replace(/\bEl\s*Idolo\b/gi, "إل إيدولو")
    .replace(/\bEl\s*Phantasmo\b/gi, "إل فانتازمو")
    .replace(/\bEl\s*Desperado\b/gi, "إل ديسبيرادو")
    .replace(/\bEl\s*Hijo\s*del\s*Vikingo\b/gi, "إل هيخو ديل فيكينغو")
    .replace(/\bEl\s*Cuatrero\b/gi, "إل كواتريرو")
    .replace(/\bEl\s*Fiscal\b/gi, "إل فيسكال")
    .replace(/\bMistico\b/gi, "ميستيكو")
    .replace(/\bPentag[oó]n(?:\s*Jr\.?)?\b/gi, "بينتاغون جونيور")
    .replace(/\bPenta(?:\s*El\s*Zero\s*M)?\b/gi, "بينتا")
    .replace(/\bRey\s*Fenix\b/gi, "ري فينيكس")
    .replace(/\bRob\s*Van\s*Dam\b/gi, "روب فان دام")
    .replace(/\bRey\s*Mysterio\b/gi, "ري ميستيريو")
    .replace(arWord("ري\\s+مستريو"), "ري ميستيريو")
    .replace(arWord("راي\\s+ميستيريو"), "ري ميستيريو")
    .replace(arWord("راي\\s+مستريو"), "ري ميستيريو")
    .replace(/\bDominik\s*Mysterio\b/gi, "دومينيك ميستيريو")
    .replace(arWord("دومينيك\\s+مستريو"), "دومينيك ميستيريو")
    .replace(/\bLiv\s*Morgan\b/gi, "ليف مورغان")
    .replace(arWord("ليف\\s+مورجان"), "ليف مورغان")
    .replace(/\bBrian\s*Cage\b/gi, "برايان كيج")
    .replace(/\bTessa\s*Blanchard\b/gi, "تيسا بلانشارد")
    .replace(/\bStephanie\s*Vaquer\b/gi, "ستيفاني فاكير")
    .replace(arWord("ستيفاني\\s+بايكر"), "ستيفاني فاكير")
    .replace(arWord("ماني\\s+إن\\s+دي\\s+زي"), "موني إن ذا بانك")
    .replace(arWord("ماني\\s+إن\\s+دي"), "موني إن ذا بانك")
    .replace(arWord("موني\\s+إن\\s+دي\\s+بانك"), "موني إن ذا بانك")
    .replace(arWord("موني\\s+ان\\s+دي\\s+بانك"), "موني إن ذا بانك")
    .replace(arWord("ماني\\s+إن\\s+دي\\s+بانك"), "موني إن ذا بانك")
    .replace(arWord("ماني\\s+ان\\s+دي\\s+بانك"), "موني إن ذا بانك")
    .replace(arWord("موني\\s+إن\\s+دي"), "موني إن ذا بانك")
    .replace(arWord("ماني\\s+إن\\s+ذا\\s+بانك"), "موني إن ذا بانك")
    .replace(arWord("موني\\s+ان\\s+ذا\\s+بانك"), "موني إن ذا بانك")
    .replace(arWord("ماني\\s+ان\\s+ذا\\s+بانك"), "موني إن ذا بانك")
    .replace(/\bMITB\b/g, "موني إن ذا بانك")
    .replace(/\bMoney\s+In\s+The\s+Bank\b/gi, "موني إن ذا بانك")
    .replace(/\bTorn\s*Meniscus\b/gi, "تمزق في الغضروف الهلالي")
    .replace(/\bMeniscus\b/gi, "الغضروف الهلالي")
    .replace(/\bDaniel\s*Garcia\b/gi, "دانيال غارسيا")
    .replace(/\bWill\s*Ospreay\b/gi, "ويل أوسبري")
    .replace(arWord("ويل\\s+اوسبري"), "ويل أوسبري")
    .replace(/\bKenny\s*Omega\b/gi, "كيني أوميغا")
    .replace(arWord("كيني\\s+اوميغا"), "كيني أوميغا")
    .replace(/\bCody\s*Rhodes\b/gi, "كودي رودز")
    .replace(/\bRoman\s*Reigns\b/gi, "رومان رينز")
    .replace(/\bJohn\s*Cena\b/gi, "جون سينا")
    .replace(/\bDrew\s*McIntyre\b/gi, "درو ماكنتاير")
    .replace(arWord("درو\\s+ماكنتير"), "درو ماكنتاير")
    .replace(/\bGunther\b/gi, "غونتر")
    .replace(arWord("جونثر"), "غونتر")
    .replace(/\bRandy\s*Orton\b/gi, "راندي اورتون")
    .replace(/\bDamian\s*Priest\b/gi, "داميان بريست")
    .replace(/\bSami\s*Zayn\b/gi, "سامي زين")
    .replace(/\bKevin\s*Owens\b/gi, "كيفين أوينز")
    .replace(arWord("كيفن\\s+اوينز"), "كيفين أوينز")
    .replace(/\bBecky\s*Lynch\b/gi, "بيكي لينش")
    .replace(/\bRhea\s*Ripley\b/gi, "ريا ريبلي")
    .replace(/\bCharlotte\s*Flair\b/gi, "شارلوت فلير")
    .replace(/\bMercedes\s*Mon[eé]\b/gi, "مرسيدس موني")
    .replace(arWord("مرسيدس\\s+مونيه"), "مرسيدس موني")
    .replace(/\bKazuchika\s*Okada\b/gi, "كازوتشيكا اوكادا")
    .replace(/\bBryan\s*Danielson\b/gi, "برايان دانيلسون")
    .replace(/\bHangman\s*(?:Adam\s*)?Page\b/gi, "هانغمان بيج")
    .replace(/\bSwerve\s*Strickland\b/gi, "سويرف ستريكلاند")
    .replace(/\bSwerve\b/gi, "سويرف")
    .replace(/(?<![\u0600-\u06FF])(?:و)?(?:سويرف|سوير|سوري|سوورف)\s*(?:ستريكلاند|ستركلند|ستريكلند|ستريكلاند)(?![\u0600-\u06FF])/g, (m) => m.startsWith("و") ? "وسويرف ستريكلاند" : "سويرف ستريكلاند")
    .replace(/(?<![\u0600-\u06FF])(?:و)?سويرف\s+ستركلند(?![\u0600-\u06FF])/g, (m) => m.startsWith("و") ? "وسويرف ستريكلاند" : "سويرف ستريكلاند")
    .replace(/(?<![\u0600-\u06FF])(?:و)?سوير\s+ستريكلاند(?![\u0600-\u06FF])/g, (m) => m.startsWith("و") ? "وسويرف ستريكلاند" : "سويرف ستريكلاند")
    .replace(/(?<![\u0600-\u06FF])(?:و)?سوير\s+ستركلند(?![\u0600-\u06FF])/g, (m) => m.startsWith("و") ? "وسويرف ستريكلاند" : "سويرف ستريكلاند")
    .replace(/(?<![\u0600-\u06FF])(?:و)?سوري\s+ستركلند(?![\u0600-\u06FF])/g, (m) => m.startsWith("و") ? "وسويرف ستريكلاند" : "سويرف ستريكلاند")
    .replace(/(?<![\u0600-\u06FF])(?:و)?سوري\s+ستريكلاند(?![\u0600-\u06FF])/g, (m) => m.startsWith("و") ? "وسويرف ستريكلاند" : "سويرف ستريكلاند")
    .replace(/(?<![\u0600-\u06FF])(?:و)?ستركلند(?![\u0600-\u06FF])/g, (m) => m.startsWith("و") ? "وستريكلاند" : "ستريكلاند")
    .replace(/(?<![\u0600-\u06FF])(?:و)?سوير\s+(?=(?:أثينا|جاك|موكسلي|كوفي|أوسبري|أوميغا|هانغمان|دانيلسون|كوبلاند|خان|في|ضد|أمام))/g, (m) => m.startsWith("و") ? "وسويرف " : "سويرف ")
    .replace(/\bDarby\s*Allin\b/gi, "داربي ألين")
    .replace(arWord("داربي\\s+الين"), "داربي ألين")
    .replace(/\bMatt\s*Riddle\b/gi, "مات ريدل")
    .replace(/\bOmos\b/gi, "اوموس")
    .replace(/\bDanhausen\b/gi, "دانهاوسن")
    .replace(/\bBlake\s*Monroe\b/gi, "بليك مونرو")
    .replace(/\bGiulia\b/gi, "جوليا")
    .replace(/\bTrick\s*Williams\b/gi, "تريك ويليامز")
    .replace(/\bLil\s*Yachty\b/gi, "ليل ياتي")
    .replace(arWord("(?:ليلت|ليل)\\s*(?:ياشتي|ياشتى|ياختي|ياتشي|ياكيتي)"), "ليل ياتي")
    .replace(arWord("ياشتي"), "ياتي")
    .replace(arWord("ليلت\\s+ياتي"), "ليل ياتي")
    .replace(arWord("(?:سبيشل\\s*بول\\s*هيمن|سبيشال\\s*بول\\s*هيمن|بول\\s*هيمن)"), "بول هيمان")
    .replace(/\bGrayson\s*Waller\b/gi, "غرايسون والر")
    .replace(/\bBaron\s*Corbin\b/gi, "بارون كوربين")
    .replace(/\bSolo\s*Sikoa\b/gi, "سولو سيكوا")
    .replace(/\bJacob\s*Fatu\b/gi, "جاكوب فاتو")
    .replace(/\bZilla\s*Fatu\b/gi, "زيلا فاتو")
    .replace(/\bTama\s*Tonga\b/gi, "تاما تونغا")
    .replace(/\bTanga\s*Loa\b/gi, "تانغا لوا")
    .replace(/\bHikuleo\b/gi, "هيكوليو")
    .replace(/\bJey\s*Uso\b/gi, "جاي أوسو")
    .replace(arWord("جاي\\s+اوسو"), "جاي أوسو")
    .replace(/\bJimmy\s*Uso\b/gi, "جيمي أوسو")
    .replace(arWord("جيمي\\s+اوسو"), "جيمي أوسو")
    .replace(/\bFinn\s*B[aá]lor\b/gi, "فين بالور")
    .replace(/\bBron\s*Breakker\b/gi, "برون بريكر")
    .replace(/\bBraun\s*Strowman\b/gi, "برون سترومان")
    .replace(/\bRoxanne\s*Perez\b/gi, "روكسان بيريز")
    .replace(/\bTiffany\s*Stratton\b/gi, "تيفاني ستراتون")
    .replace(/\bJade\s*Cargill\b/gi, "جايد كارجيل")
    .replace(/\bBianca\s*Belair\b/gi, "بيانكا بيلير")
    .replace(/\bIyo\s*Sky\b/gi, "إيو سكاي")
    .replace(arWord("ايو\\s+سكاي"), "إيو سكاي")
    .replace(/\bKairi\s*Sane\b/gi, "كايري سين")
    .replace(/\bAsuka\b/gi, "أسكا")
    .replace(arWord("اسكا"), "أسكا")
    .replace(/\bBrock\s*Lesnar\b/gi, "بروك ليسنر")
    .replace(arWord("بروك\\s+لازنر"), "بروك ليسنر")
    .replace(/\b(?:The\s*)?Undertaker\b/gi, "أندرتيكر")
    .replace(arWord("اندرتيكر"), "أندرتيكر")
    .replace(/\bTriple\s*H\b/gi, "تريبل إتش")
    .replace(arWord("تربل\\s+اتش"), "تريبل إتش")
    .replace(/\bShawn\s*Michaels\b/gi, "شون مايكلز")
    .replace(/\b(?:Stone\s*Cold\s*)?Steve\s*Austin\b/gi, "ستيف أوستن")
    .replace(/\bThe\s*Rock\b/gi, "ذا روك")
    .replace(/\bDwayne\s*Johnson\b/gi, "دواين جونسون")
    .replace(/\bHulk\s*Hogan\b/gi, "هولك هوغان")
    .replace(/\bBret\s*Hart\b/gi, "بريت هارت")
    .replace(/\bMick\s*Foley\b/gi, "ميك فولي")
    .replace(/\bVince\s*McMahon\b/gi, "فينس مكمان")
    .replace(/\bShane\s*McMahon\b/gi, "شين مكمان")
    .replace(/\bStephanie\s*McMahon\b/gi, "ستيفاني مكمان")
    .replace(/\bTony\s*Khan\b/gi, "توني خان")
    .replace(/\bNick\s*Khan\b/gi, "نيك خان")
    .replace(/\bPaul\s*Heyman\b/gi, "بول هيمان")
    .replace(/\bShinsuke\s*Nakamura\b/gi, "شينسكي ناكامورا")
    .replace(/\bSheamus\b/gi, "شيموس")
    .replace(/\bCesaro\b/gi, "سيزارو")
    .replace(/\bChad\s*Gable\b/gi, "تشاد غيبل")
    .replace(/\bOtis\b/gi, "أوتيس")
    .replace(/\bSantos\s*Escobar\b/gi, "سانتوس إسكوبار")
    .replace(/\bDragon\s*Lee\b/gi, "دراغون لي")
    .replace(/\bBobby\s*Lashley\b/gi, "بوبي لاشلي")
    .replace(/\bShelton\s*Benjamin\b/gi, "شيلتون بنجامين")
    .replace(/\bCedric\s*Alexander\b/gi, "سيدريك ألكسندر")
    .replace(/\bMustafa\s*Ali\b/gi, "مصطفى علي")
    .replace(/\bKeith\s*Lee\b/gi, "كيث لي")
    .replace(/\bSamoa\s*Joe\b/gi, "ساموا جو")
    .replace(/\bWardlow\b/gi, "واردلو")
    .replace(/\bPowerhouse\s*Hobbs\b/gi, "باورهاوس هوبز")
    .replace(/\bHook\b/g, "هوك")
    .replace(/\bRicky\s*Starks\b/gi, "ريكي ستاركس")
    .replace(/\bJay\s*White\b/gi, "جاي وايت")
    .replace(/\bBritt\s*Baker\b/gi, "بريت بيكر")
    .replace(/\bJamie\s*Hayter\b/gi, "جيمي هايتر")
    .replace(/\bKris\s*Statlander\b/gi, "كريس ستاتلاندر")
    .replace(/\bWillow\s*Nightingale\b/gi, "ويلو نايتينغيل")
    .replace(/\bToni\s*Storm\b/gi, "توني ستورم")
    .replace(/\bMariah\s*May\b/gi, "ماريا ماي")
    .replace(/\bSaraya\b/gi, "سارايا")
    .replace(/\bThunder\s*Rosa\b/gi, "ثاندر روزا")
    .replace(/\bBayley\b/gi, "بايلي")
    .replace(/\bNaomi\b/gi, "ناومي")
    .replace(/\bNia\s*Jax\b/gi, "نيا جاكس")
    .replace(/\bChelsea\s*Green\b/gi, "تشيلسي غرين")
    .replace(/\bPiper\s*Niven\b/gi, "بايبر نيفين")
    .replace(/\bLyra\s*Valkyria\b/gi, "لايرا فالكيريا")
    .replace(/\bZoey\s*Stark\b/gi, "زوي ستارك")
    .replace(/\bShayna\s*Baszler\b/gi, "شاينا بازلر")
    .replace(/\bSonya\s*Deville\b/gi, "سونيا ديفيل")
    .replace(/\bNatalya\b/gi, "نتاليا")
    .replace(/\bRaquel\s*Rodriguez\b/gi, "راكيل رودريغيز")
    .replace(/\bDakota\s*Kai\b/gi, "داكوتا كاي")
    .replace(/\bCandice\s*LeRae\b/gi, "كانديس ليراي")
    .replace(/\bIndi\s*Hartwell\b/gi, "إندي هارتويل")
    .replace(/\bMichin\b/gi, "ميتشين")
    .replace(/\bEthan\s*Page\b/gi, "إيثان بيج")
    .replace(/\bWes\s*Lee\b/gi, "ويس لي")
    .replace(/\bJe'?Von\s*Evans\b/gi, "جيفون إيفانز")
    .replace(/\bOba\s*Femi\b/gi, "أوبا فيمي")
    .replace(/\bNathan\s*Frazer\b/gi, "ناثان فريزر")
    .replace(/\bAxiom\b/gi, "أكسيوم")
    .replace(/\bMoose\b/gi, "موس")
    .replace(/\bNic\s*Nemeth\b/gi, "نيك نيميث")
    .replace(/\bJosh\s*Alexander\b/gi, "جوش ألكسندر")
    .replace(/\bSteve\s*Maclin\b/gi, "ستيف ماكلين")
    .replace(/\bEddie\s*Edwards\b/gi, "إدي إدواردز")
    .replace(/\bJoe\s*Hendry\b/gi, "جو هندري")
    .replace(/\bFrankie\s*Kazarian\b/gi, "فرانكي كازاريان")
    .replace(/\bMatt\s*Cardona\b/gi, "مات كاردونا")
    .replace(/\bJordynne\s*Grace\b/gi, "جوردين غريس")
    .replace(/\bMasha\s*Slamovich\b/gi, "ماشا سلاموفيتش")
    .replace(/\bAsh\s*By\s*Elegance\b/gi, "آش باي إليغانس")
    .replace(/\bGisele\s*Shaw\b/gi, "جيزيل شو")
    .replace(/\bJon\s*Moxley\b/gi, "جون موكسلي")
    .replace(/\bChris\s*Jericho\b/gi, "كريس جيريكو")
    .replace(/\bAdam\s*Copeland\b/gi, "آدم كوبلاند")
    .replace(arWord("(?:[أإا]دم|ادم)\\s*(?:كوبلاند|كوبلند)"), "آدم كوبلاند")
    .replace(arWord("كوبلند"), "كوبلاند")
    .replace(/\bAdam\s*Cole\b/gi, "آدم كول")
    .replace(/\bClaudio\s*Castagnoli\b/gi, "كلاوديو كاستاليولي")
    .replace(/\bMalakai\s*Black\b/gi, "مالاكاي بلاك")
    .replace(/\bBuddy\s*Matthews\b/gi, "بادي ماثيوز")
    .replace(/\bBrody\s*King\b/gi, "برودي كينغ")
    .replace(/\bBandido\b/gi, "بانديدو")
    .replace(/\bRicochet\b/gi, "ريكوشيه")
    .replace(/\bRohit\s*Raju\b/gi, "روهيت راجو")
    .replace(/\bDeonna\s*Purrazzo\b/gi, "ديونا بوراتزو")
    .replace(/(?<![\u0600-\u06FF])(?:و)?(?:ديونا\s*)?(?:بوراكزو|بورازو)(?![\u0600-\u06FF])/g, (m) => m.startsWith("و") ? "وديونا بوراتزو" : (m.includes("ديونا") ? "ديونا بوراتزو" : "بوراتزو"))
    .replace(/\bSteven\s*Borden\b/gi, "ستيفن بوردن")
    .replace(/\bGarrett\s*Borden\b/gi, "غاريت بوردن")
    .replace(/\bSting\b/gi, "ستينغ")

    // 6. Simplify archaic words and dual forms into modern, reader-friendly Arabic
    .replace(arWord("(?:نجلا|نجلي|ابنا|ابني)\\s+الأسطورة"), "أبناء الأسطورة")
    .replace(arWord("(?:نجلا|نجلي|ابنا|ابني)\\s+ستينغ"), "أبناء ستينغ")
    .replace(arWord("(?:نجلا|نجلي)"), "أبناء")
    .replace(arWord("ابنا\\s+(ال[^\\s]+|[A-Z][a-z]+|ستينغ)"), "أبناء $1")
    .replace(arWord("ابني\\s+(ال[^\\s]+|[A-Z][a-z]+|ستينغ)"), "أبناء $1")

    // 7. Mandatory federation prefix for show names (e.g. MLP Northern Rising)
    .replace(/\b(?:عرض|عروض|مهرجان)?\s*Northern\s+Rising\b/gi, "عرض MLP Northern Rising")
    .replace(/عرض\s+عرض\s+MLP\s+Northern\s+Rising/gi, "عرض MLP Northern Rising")

    // 8. Enforce Arabic names for Tag Teams & Factions (teams and factions must be strictly in Arabic)
    .replace(/\bThe\s*Wagner\s+Brothers\b/gi, "الإخوة فاغنر")
    .replace(/\bTheWagner\s+Brothers\b/gi, "الإخوة فاغنر")
    .replace(/\bWagner\s+Brothers\b/gi, "الإخوة فاغنر")
    .replace(/\bDr\.?\s*Wagner\s+Jr\.?\b/gi, "دكتور فاغنر جونيور")
    .replace(/\bWar\s+Raiders\b/gi, "وار رايدرز")
    .replace(/\bThe\s+Judgment\s+Day\b/gi, "ذا جادجمنت داي")
    .replace(/\bJudgment\s+Day\b/gi, "ذا جادجمنت داي")
    .replace(/\bThe\s+Bloodline\b/gi, "ذا بلودلاين")
    .replace(/\bBloodline\b/gi, "ذا بلودلاين")
    .replace(/\bThe\s+New\s+Day\b/gi, "ذا نيو داي")
    .replace(/\bNew\s+Day\b/gi, "ذا نيو داي")
    .replace(/\bThe\s+Wyatt\s+Sicks\b/gi, "عائلة وايت 6")
    .replace(/\bWyatt\s+Sicks\b/gi, "عائلة وايت 6")
    .replace(/\bDamage\s+CTRL\b/gi, "داميج كترول")
    .replace(/\bImperium\b/gi, "إمبريوم")
    .replace(/\bThe\s+Lethal\s+Twist\b/gi, "ليثال تويست")
    .replace(/\bLethal\s+Twist\b/gi, "ليثال تويست")
    .replace(/\bThe\s+Outrunners\b/gi, "ذا أوت رانرز")
    .replace(/\bOutrunners\b/gi, "ذا أوت رانرز")
    .replace(/\bBang\s+Bang\s+Gang\b/gi, "بانغ بانغ غانغ")
    .replace(/\bThe\s+Conglomeration\b/gi, "كونغلوميريشن")
    .replace(/\bThe\s+Demand\b/gi, "ذا ديماند")
    .replace(/\bBlackpool\s+Combat\s+Club\b/gi, "بلاكبول كومبات كلوب")
    .replace(/\bDeath\s+Triangle\b/gi, "ديث ترايانغل")
    .replace(/\bHouse\s+of\s+Black\b/gi, "هاوس أوف بلاك")
    .replace(/\bGrizzled\s+Young\s+Veterans\b/gi, "غريزلد يونغ فيترانز")
    .replace(/\bMotor\s+City\s+Machine\s+Guns\b/gi, "موتور سيتي ماشين غانز")
    .replace(/\bPerros\s+Del\s+Mal\b/gi, "بيروس ديل مال")

    // 9. Enforce Arabic for Championship Titles without duplicating federation acronym inside the title
    .replace(/\b(?:AAA|WWE|AEW|TNA|ROH|NJPW|MLW)?\s*World\s+Heavyweight(?:\s+Championship|\s+Titles|\s+Title)?\b/gi, "بطولة العالم للوزن الثقيل")
    .replace(/\b(?:AAA|WWE|AEW|TNA|ROH|NJPW|MLW)?\s*Intercontinental(?:\s+Championship|\s+Titles|\s+Title)?\b/gi, "بطولة القارات")
    .replace(/\b(?:AAA|WWE|AEW|TNA|ROH|NJPW|MLW)?\s*United\s+States(?:\s+Championship|\s+Titles|\s+Title)?\b/gi, "بطولة الولايات المتحدة")
    .replace(/\b(?:AAA|WWE|AEW|TNA|ROH|NJPW|MLW)?\s*Women'?s\s+World(?:\s+Championship|\s+Titles|\s+Title)?\b/gi, "بطولة العالم للسيدات")
    .replace(/\b(?:AAA|WWE|AEW|TNA|ROH|NJPW|MLW)?\s*Women'?s(?:\s+Championship|\s+Titles|\s+Title)?\b/gi, "بطولة السيدات")
    .replace(/\b(?:AAA|WWE|AEW|TNA|ROH|NJPW|MLW)?\s*World\s+Tag\s+Team(?:\s+Championship|\s+Titles|\s+Title)?\b/gi, "بطولة العالم للزوجي")
    .replace(/\b(?:AAA|WWE|AEW|TNA|ROH|NJPW|MLW)?\s*Tag\s+Team(?:\s+Championship|\s+Titles|\s+Title)?\b/gi, "بطولة للزوجي")
    .replace(/بطولة\s+بطولة/g, "بطولة")
    .replace(arWord("بطولة\\s+(?:AAA|WWE|AEW|TNA|ROH|NJPW|MLW)\\s+World\\s+Tag\\s+Team"), "بطولة العالم للزوجي")
    .replace(arWord("بطولة\\s+(?:AAA|WWE|AEW|TNA|ROH|NJPW|MLW)\\s+(?:للفرق|للزوجي)"), "بطولة العالم للزوجي");

  // Always strip all tashkeel / diacritics completely across all articles, titles, and tags
  return removeTashkeel(cleaned);
}

// Helper to remove repetitive clickbait / cliché prefixes (e.g. "تصريحات نارية..", "صدمة مدوية..")
function cleanHeadlineClichés(title: string): string {
  if (!title) return title;
  return title
    .replace(/^(?:تصريحات\s*نارية|صدمة\s*مدوية|اعترافات\s*صادمة|ليلة\s*نارية|مفاجأة\s*مدوية|مفاجأة\s*كبرى|كارثة\s*حقيقية|فضيحة\s*مدوية|عاجل|حصرياً|خاص)\s*[:.،\-–—]+\s*/i, "")
    .replace(/^(?:تصريح\s*ناري|تصريحات\s*ساخنة|تصريحات\s*صادمة|اعترافات\s*نارية|صدمة\s*كبرى)\s*[:.،\-–—]+\s*/i, "")
    .trim();
}

// Helper to call Gemini with retry, quota protection & multi-key fallback
async function queryGemini(prompt: string, jsonMode: boolean = true): Promise<string | null> {
  const state = loadState();
  
  // Circuit breaker: Free tier limit is 1,500 calls/day. Safety cap pauses at 1,200 to protect quota.
  if ((state.apiCallsToday || 0) >= 1200) {
    console.warn(`[Watcher] 🛑 Safety Circuit Breaker: Daily Gemini API calls limit approached (${state.apiCallsToday}/1500). Pausing AI queries until tomorrow to protect quota.`);
    return null;
  }

  const candidateModels = [
    "gemini-3.5-flash-lite", // 500 RPD / 15 RPM (High free quota)
    "gemini-2.5-flash",
    "gemini-2.0-flash",
    "gemini-1.5-flash",
    "gemini-3.5-flash",
    "gemini-3.8-flash",
    "gemini-3.7-flash",
    "gemini-3.6-flash",
    "gemini-flash-latest",
    "gemini-flash-lite-latest",
  ];

  for (const apiKey of API_KEYS) {
    for (const model of candidateModels) {
      try {
        const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
        let res = await fetch(url, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            contents: [{ parts: [{ text: prompt }] }],
            generationConfig: {
              temperature: 0.6,
              maxOutputTokens: 2500,
              ...(jsonMode ? { responseMimeType: "application/json" } : {}),
            },
          }),
        });

        // 429 = Rate limit (RPM or quota on this specific model)
        if (res.status === 429) {
          console.warn(`[Watcher] Rate limit (429) on ${model}, waiting 3s before trying next candidate...`);
          await new Promise(r => setTimeout(r, 3000));
          continue; // Seamlessly failover to next model in list!
        }

        if (!res.ok) {
          const errText = await res.text();
          console.warn(`[Watcher] Model ${model} returned ${res.status}:`, errText.slice(0, 120));
          continue;
        }

        const data: any = await res.json();
        const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
        if (text) {
          // Increment daily quota usage counter
          state.apiCallsToday = (state.apiCallsToday || 0) + 1;
          saveState(state);
          return text;
        }
      } catch (e: any) {
        console.warn(`[Watcher] Error with model ${model}:`, e.message || e);
      }
    }
  }

  return null;
}

// Helper to get formatted Arabic date like "11 سبتمبر 2026"
function getArabicDateFormatted(dateString?: string): string {
  const d = dateString ? new Date(dateString) : new Date();
  const monthsArabic = [
    "يناير", "فبراير", "مارس", "أبريل", "مايو", "يونيو",
    "يوليو", "أغسطس", "سبتمبر", "أكتوبر", "نوفمبر", "ديسمبر"
  ];
  return `${d.getDate()} ${monthsArabic[d.getMonth()]} ${d.getFullYear()}`;
}

// Second-pass AI Tool: Select and craft the ultimate faithful, click-worthy, SEO-optimized title
export async function optimizeTitleForSEOAndCTR(
  originalTitle: string,
  draftTitle: string,
  articleSummary: string,
  isResultsPost: boolean,
  arabicDate: string
): Promise<string> {
  let specificTitleRules = "";
  if (isResultsPost) {
    specificTitleRules = `
نوع المقال: **تقرير نتائج وتغطية عرض مصارعة كامل (Full Show Results)**
1. **القاعدة الصارمة الحاسمة: حظر تام وشامل لأي حرق للنتائج في العنوان (Strict Zero-Spoiler Rule)**:
   - **ممنوع بتاتاً منعاً باتاً ذكر اسم الفائز أو الخاسر أو نتيجة أي نزال في العنوان نهائياً!**
   - **ممنوع منعاً باتاً** استخدام كلمات الحسم أو الفوز أو الخسارة في العنوان، مثل:
     (❌ "يهزم", ❌ "يسقط", ❌ "يتفوق على", ❌ "ينتصر على", ❌ "يخسر أمام", ❌ "يحتفظ بلقبه بعد فوزه", ❌ "يتوج بـ", ❌ "تتويج", ❌ "حسم المواجهة", ❌ "يحسم نزاله").
   - **البديل الاحترافي والتشويقي الإلزامي**:
     اذكر أطراف النزالات الكبرى وطبيعة الصراع والتصفيات دون كشف الفائز:
     - بدلاً من: ❌ "رومان رينز يهزم بينتا"
     - اكتب: ✅ "مواجهة نارية بين رومان رينز وبينتا" أو "صدام ملحمي بين رومان رينز وبينتا على لقب العالم" أو "رومان رينز يدافع عن لقبه أمام بينتا".
     - بدلاً من: ❌ "جيفون إيفانز يهزم إل فيسكال ويتأهل لموني إن ذا بانك"
     - اكتب: ✅ "تصفيات مشتعلة وحاسمة لمواجهة موني إن ذا بانك".
2. **أولوية اختيار الأحداث (المين إيفنت والنزالات الكبرى أولاً)**:
   - يجب حتماً أن يركز المانشيت على **الحدث الرئيسي (Main Event)** أو النزالات الكبرى والأحداث المشتعلة دون كشف نتائجها.
3. **قاعدة العروض متعددة الليالي (Multi-Night Events مثل Triplemania أو WrestleMania)**:
   - **احذف التاريخ نهائياً ولا تضعه في العنوان مطلقاً!**
   - ضع رقم الليلة بالعربية: "(الليلة الأولى)" أو "(الليلة الثانية)".
   - الصيغة: "نتائج عرض [اسم العرض] (الليلة الأولى): [وصف مثير ومفصل للحدث الأضخم/الرئيسي دون ذكر الفائز].. و[حدث بارز آخر]"
4. **قاعدة العروض العادية (ذات الليلة الواحدة فقط)**:
   - **يجب حتماً تضمين التاريخ بين قوسين**: (${arabicDate}).
   - الصيغة: "نتائج عرض [اسم العرض] (${arabicDate}): [المواجهة الكبرى بأطرافها دون ذكر الفائز].. و[أبرز الأحداث والتصفيات]"
5. **أسماء الاتحادات والعروض بالإنجليزية حصراً**:
   - أسماء الاتحادات تظل بالإنجليزية دائماً كما هي: (WWE, AEW, TNA, ROH, NJPW, MLW, AAA, CMLL, UFC).
   - أسماء العروض تظل بالإنجليزية دائماً: (مثل WWE RAW, WWE SmackDown, WWE NXT, AEW Dynamite, AEW Collision, AEW Rampage, TNA iMPACT, Triplemania).
   - باقي الكلمات (النتائج، المصارعين، الأحداث، الوصف) بالعربية التامة وبدون أي تشكيل.`;
  } else {
    specificTitleRules = `
نوع المقال: **خبر صحفي مفرد / كواليس / تصريح / تتويج بلقب / إصابة (Breaking News & Exclusive Report)**
- **تحذير حاسم وقاطع**: هذا خبر صحفي مفرد وليس تقرير نتائج عرض! **ممنوع بتاتاً منعاً باتاً استخدام كلمة "نتائج عرض" أو وضع تاريخ العرض بين قوسين في العنوان!**
- **القاعدة الذهبية الحاسمة (نفس وقائع العنوان الأصلي ولكن بصيغة عربية صحفية رشيقة - 100% Faithful Rephrasing)**:
  - العنوان الإنجليزي الأصلي من المصدر: "${originalTitle}"
  - **مهمتك الأساسية**: صياغة العنوان العربي ليكون **إعادة صياغة عربية رياضية فصيحة وأمينة 100% لنفس وقائع العنوان الأصلي بدقة**:
    - انقل نفس أطراف الحدث بالكامل (من عاد؟ من فاز؟ من تحالف مع من؟ في أي مواجهة؟).
    - **ممنوع منعاً باتاً** حذف أي طرف أو تفصيل مذكور في العنوان الأصلي.
    - **ممنوع منعاً باتاً** اختلاق أي أحداث أو استبدال الوقائع بعبارات تهويل كاذبة فارغة (مثل: ❌ "يفاجئ الجميع", ❌ "عودته الصاعقة", ❌ "زلزال", ❌ "صدمة مدوية", ❌ "يهز الحلبات").
    - **مثال حي للتطبيق الصحيح**:
      - العنوان الأصلي: "El Grande Americano Returns To WWE Raw, Teams With Stephanie Vaquer In Mixed Tag Action"
      - ❌ عنوان تهويلي محظور: "إل غراندي أمريكانو يفاجئ الجميع ويسجل عودته الصاعقة في عرض WWE RAW"
      - ✅ **العنوان الصحفي الرشيق الأمين المعتمد**: "إل غراندي أمريكانو يعود إلى عرض WWE RAW ويتحالف مع ستيفاني فاكير في مواجهة مختلطة"
- **قاعدة أسماء الاتحادات والعروض (تظل بالإنجليزية حصراً بدون ترجمة ولا تعريب)**:
  - أسماء الاتحادات لا تُترجم ولا تُعرّب وتظل بالإنجليزية دائماً كما هي: (WWE, AEW, TNA, ROH, NJPW, MLW, AAA, CMLL, GCW, UFC).
    - ممنوع نهائياً كتابة: "دبليو دبليو إي" أو "إيه إي دبليو" أو "تي إن إيه" أو "نيو جابان".
    - اكتب دائماً: WWE, AEW, TNA, NJPW, MLW.
  - أسماء العروض التابعة للاتحادات تظل بالإنجليزية دائماً:
    - مثل: WWE RAW, WWE SmackDown, WWE NXT, AEW Dynamite, AEW Collision, AEW Rampage, TNA iMPACT, AEW All In, WrestleMania, Royal Rumble, SummerSlam.
    - ممنوع نهائياً كتابة: "الرو", "راو", "سماكداون", "ديناميت", "كوليجن", "إمباكت".
    - اكتب دائماً: WWE RAW, WWE SmackDown, AEW Dynamite, AEW Collision, TNA iMPACT.
- **باقي عناصر العنوان (المصارعين، الأحداث، البطولات، الألقاب، الأفعال، التفاصيل)**:
  - تُترجم وتُكتب باللغة العربية الصحفية الرياضية الحصرية والمثيرة بدون كليشيهات مستهلكة:
  - **حظر تام وتجريم الكليشيهات والبادئات المكررة (Crucial Anti-Cliché & Variety Rule)**:
    - **ممنوع بتاتاً منعاً باتاً** تكرار أو استخدام البادئات المبتذلة المستهلكة مثل:
      - ❌ "تصريحات نارية.."
      - ❌ "صدمة مدوية.."
      - ❌ "ليلة نارية.."
      - ❌ "اعترافات صادمة.."
      - ❌ "مفاجأة كبرى.." / "مفاجأة مدوية.."
      - ❌ "عاجل.." / "حصرياً.." / "كارثة حقيقية.."
    - ممنوع تكرار نفس النمط أو البدء بكلمتين متكررتين في كل خبر. تجنب نهائياً صيغة [كلمة كليشيه].. [الخبر].
  - **قاعدة تصريحات وردود أفعال المصارعين وإعادة الصياغة الذكية (Smart Rewriting vs Literal Translation - حاسمة جداً)**:
    - إذا كان الخبر الأصلي عبارة عن رد فعل أو تصريح (مثل: 'Wrestler: Quote' أو 'Wrestler Reacts To...'):
      - **ممنوع تغيير موضوع الخبر** أو تحويله إلى تقرير نزال قديم وكأنه حدث للتو!
      - **ممنوع الترجمة الحرفية الركيكة**؛ صِغْ جوهر التصريح بأسلوب صحفي عربي رياضي أصيل وجذاب ورشيق:
        - مثال: Sami Zayn: 'Ride Or Dies Rejoice, Justice At Last! Two Time WWE Champion!'
        - ✅ "سامي زين يحتفل مع جماهيره الوفية باستعادة لقب WWE: 'العدالة تحققت أخيراً!'"
  - **قاعدة أسماء المصارعين الصارمة (بالعربية دائماً وحصراً وممنوع نهائياً بالإنجليزية)**:
    - **ممنوع منعاً باتاً كتابة اسم أي مصارع أو نجم باللغة الإنجليزية في العنوان مطلقاً!**
    - الوحيد المسموح به بالإنجليزية فقط هو اسم الاتحاد (WWE, AEW, TNA) أو اسم العرض (WWE RAW, WWE SmackDown).
    - جميع أسماء المصارعين والنجوم تُكتب بالعربية حصراً وبالتعريب الصوتي الفصيح:
      - **El Grande Americano** يُكتب حصراً: **إل غراندي أمريكانو** (ممنوع منعاً باتاً ترجمته إلى "الأمركنو الكبير" أو "الأمريكي الكبير"!).
      - **AJ Lee** تُكتب بالعربية: **إيه جيه لي**
      - **AJ Styles** يُكتب بالعربية: **إيه جيه ستايلز**
      - **CJ Perry** تُكتب بالعربية: **سي جيه بيري**
      - **Orange Cassidy** يُكتب: **أورانج كاسيدي**
      - **Dean Malenko** يُكتب: **دين مالينكو**
      - **Women's Division** يُترجم حصراً: **قسم السيدات** (ممنوع منعاً باتاً كتابة: "قسم النساء")
      - R-Truth يُكتب بالعربية دائماً: **ار تروث**
      - CM Punk يُكتب بالعربية: **سي ام بانك**
      - LA Knight يُكتب بالعربية: **ال ايه نايت**
      - MJF يُكتب بالعربية: **ام جيه اف**
      - MVP يُكتب بالعربية: **ام في بي**
      - أندرادي أو أندرادي إل إيدولو (Andrade / Andrade El Idolo - **ممنوع منعاً باتاً كتابة "انقرادي" أو "أنقرادي"**)
      - **Swerve Strickland** يُكتب بالعربية حصراً: **سويرف ستريكلاند** (ممنوع منعاً باتاً كتابة: "سوير ستريكلاند" أو "سوري ستركلند" أو "سويرف ستركلند"؛ اسمه المعتمد حصراً هو: **سويرف ستريكلاند**).
      - **Adam Copeland** يُكتب بالعربية حصراً: **آدم كوبلاند** (ممنوع كتابة: "أدم كوبلند").
      - **Money In The Bank** تُكتب بالعربية حصراً: **موني إن ذا بانك** (ممنوع منعاً باتاً كتابة: "موني إن دي بانك" أو "ماني إن دي").
      - **Lil Yachty** يُكتب بالعربية حصراً: **ليل ياتي** (ممنوع منعاً باتاً كتابة: "ليل ياشتي" أو "ليلت ياشتي"؛ اسمه المعتمد حصراً هو: **ليل ياتي**).
      - **Deonna Purrazzo** تُكتب بالعربية حصراً: **ديونا بوراتزو** (ممنوع منعاً باتاً كتابة: "ديونا بوراكزو" أو "بورازو").
      - سيث رولينز (Seth Rollins - ممنوع منعاً باتاً كتابة ستيف رولينز)، سولو سيكوا (Solo Sikoa)، كودي رودز، رومان رينز، جون سينا، داميان بريست، درو ماكنتاير، ليف مورغان، ستيفاني فاكير، دومينيك ميستيريو، ري ميستيريو.
  - **قاعدة إلزامية ذكر اسم الاتحاد قبل اسم أي عرض مباشرة (Mandatory Promotion Prefix)**:
    - ممنوع نهائياً كتابة اسم أي عرض بدون ذكر اسم الاتحاد قبله مباشرة (اكتب دائماً: عرض WWE RAW، عرض WWE SmackDown، عرض AEW Collision، عرض TNA iMPACT).
  - **قاعدة اللغة العربية المبسطة والحديثة (حظر الألفاظ التراثية وصيغ التثنية تماماً)**:
    - ممنوع صيغ التثنية الغريبة (❌ "نجلا الأسطورة", ❌ "ابنا ستينغ"؛ اكتب دائماً: "أبناء الأسطورة ستينغ").
  - **قاعدة أسماء الفرق والعصابات بالعربية حصراً**:
    - اكتب أسماء الفرق بالعربية دائماً وبدقة: (فريق الإخوة فاغنر، فريق وار رايدرز، فريق ذا بلودلاين، فريق ذا جادجمنت داي، فريق ذا نيو داي).
  - **قاعدة أسماء الألقاب والبطولات بالعربية الخالصة ودون تكرار اسم الاتحاد**:
    - اكتب اللقب بالعربية مباشرة دون وضع اسم الاتحاد أمامه: "بطولة العالم للزوجي", "بطولة الزوجي", "بطولة العالم للوزن الثقيل", "بطولة القارات", "بطولة العالم للسيدات", "بطولة الولايات المتحدة".
  - **ممنوع بتاتاً استخدام التشكيل نهائياً في العنوان** (بدون فتحة أو ضمة أو كسرة أو تنوين أو سكون أو شدة).`;
  }

  const titleOptimizerPrompt = `أنت كبير محرري ورئيس قسم الأخبار لموقع "عرب راسلنج" (arab-wrestling.com).

المهمة الصحفية:
العنوان الإنجليزي الأصلي من المصدر:
"${originalTitle}"

مسودة العنوان المقترحة:
"${draftTitle}"

المطلوب:
صياغة 5 خيارات عناوين عربية رياضية فصيحة، رشيقة، وممتازة لنفس هذا الخبر، بحيث تكون **مطابقة تماماً لنفس وقائع وأسماء العنوان الأصلي دون زيادة أو نقصان أو اختلاق أحداث**:
1. خيار أول: صياغة إخبارية مباشرة وسريعة تبدأ بالفعل والحدث الأساسي.
2. خيار ثانٍ: صياغة رصينة على أسلوب وكالات الأنباء والصحافة الرياضية الكبرى.
3. خيار ثالث: صياغة تركز على أطراف المواجهة أو التصريح وتبرز الأسماء الرئيسية.
4. خيار رابع: صياغة مشدودة وجذابة تحفز القارئ على معرفة التفاصيل دون أي كليشيهات.
5. خيار خامس: صياغة تجمع بين الرشاقة الصحفية والوضوح التام للقارئ الرياضي.

ثم اختر الصياغة الأفضل والأقوى والأكثر بلاغة والتزاماً بالقواعد لتكون "العنوان النهائي" (champion_title).

القواعد الصارمة الملزمة لجميع العناوين:
${specificTitleRules}

ملخص ومحتوى المقال:
${articleSummary.slice(0, 3000)}

تاريخ العرض (لنتائج العروض فقط): ${arabicDate}

أخرج النتيجة حصراً بتنسيق JSON:
{
  "candidates": [
    { "angle": "صياغة مباشرة", "title": "..." },
    { "angle": "صياغة رصينة", "title": "..." },
    { "angle": "صياغة تبرز الأطراف", "title": "..." },
    { "angle": "صياغة مشدودة", "title": "..." },
    { "angle": "صياغة واضحة ورشيقة", "title": "..." }
  ],
  "champion_title": "العنوان النهائي الفائز الأكثر بلاغة وأمانة لنفس وقائع العنوان الأصلي"
}`;

  try {
    const resText = await queryGemini(titleOptimizerPrompt, true);
    if (resText) {
      const parsed = safeParseJson<{ candidates?: Array<{ angle: string; title: string }>; champion_title?: string; best_title?: string }>(resText);
      if (parsed) {
        if (Array.isArray(parsed.candidates) && parsed.candidates.length > 0) {
          console.log(`[Watcher] 🥊 Headline Tournament - 6 Candidates Generated:`);
          parsed.candidates.forEach((c, idx) => {
            console.log(`  [${idx + 1}] (${c.angle}): "${c.title}"`);
          });
        }
        const winningRaw = parsed.champion_title || parsed.best_title;
        if (winningRaw && winningRaw.trim().length > 10) {
          let winner = cleanHeadlineClichés(sanitizeWrestlingTerms(winningRaw.trim()));
          if (isResultsPost) {
            winner = sanitizeResultsTitleSpoilers(winner);
          }
          console.log(`[Watcher] 🏆 Champion Headline Selected: "${winner}"`);
          return winner;
        }
      }
    }
  } catch (e) {
    console.warn("[Watcher] Title tournament pass skipped, using draft title:", e);
  }

  let finalTitle = cleanHeadlineClichés(sanitizeWrestlingTerms(draftTitle));
  if (isResultsPost) {
    finalTitle = sanitizeResultsTitleSpoilers(finalTitle);
  }
  return finalTitle;
}

// Format markdown to ensure clean spacing between lines and match sections
function formatResultsMarkdown(text: string): string {
  if (!text) return text;
  return text
    // Ensure every match line has its own paragraph
    .replace(/(🏆\s*\*\*الفائز(?:ون|تان|ة)?:?\*\*)/g, "\n\n$1")
    .replace(/(\*\*تفاصيل النزال:\*\*)/g, "\n\n$1")
    .replace(/(\*\*المواجهة (?:الأولى|الثانية|الثالثة|الرابعة|الخامسة|السادسة|السابعة|الثامنة|التاسعة|العاشرة)[^:]*:\*\*)/g, "\n\n---\n\n$1")
    .replace(/(\*\*الحدث الرئيسي\s*\(Main Event\):?\*\*)/g, "\n\n---\n\n$1")
    .replace(/(\*\*كواليس وحوارات خاصة:\*\*)/g, "\n\n---\n\n$1")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}


// Bulletproof detection of Show Results vs Single News
export function isShowResultsArticle(originalTitle: string, plainText: string = ""): boolean {
  const title = (originalTitle || "").trim();

  // 1. Explicit negative checks: Non-show results (financial, medical tests, surveys, or news updates ABOUT results)
  if (/\b(?:financial|quarterly|earnings|fiscal|q[1-4]|medical|drug|wellness|investigation|poll|survey|election|test|exam|blood)\s+.*?\bresults\b/i.test(title)) {
    return false;
  }
  if (/\bresults\s+(?:update|clarification|details|reaction|comment|delayed|postponed)\b/i.test(title) && !/\b(?:quick results|full results)\b/i.test(title)) {
    return false;
  }
  if (/\b(?:preview|previews|set for|card for|how to watch|lineup|schedule|start time)\b/i.test(title) && !/\b(?:results|spoilers)\b/i.test(title)) {
    return false;
  }

  // Single match / title defense / qualifier articles must NEVER be treated as full show results
  if (/\b(?:defeats|defeated|defeating|def\.|pins|pinned|qualifies|advances|wins.*(?:championship|title|match)|retains.*(?:championship|title))\b/i.test(title)) {
    return false;
  }

  // 2. Strong Title Signals for Full Show Results / Spoilers
  // On Fightful, full show recaps ALWAYS announce themselves explicitly in the title:
  // e.g. "WWE Raw Results (9/14/2026): ...", "AEW Dynamite Results: ...", "WWE SmackDown Spoilers: ..."
  const hasResultsInTitle = /\b(?:results|spoilers|quick results|full results|live recap)\b/i.test(title);
  if (hasResultsInTitle) {
    return true;
  }

  return false;
}

/**
 * Ironclad Protection Shield: Detects single-match live coverage / spoiler stubs.
 * Filters out posts like:
 * - "Roman Reigns Defeats Penta To Retain World Heavyweight Championship On 9/14 WWE Raw"
 * - "Je’Von Evans Qualifies For Men’s Money In The Bank Match On WWE Raw"
 * - "Lola Vice Qualifies For Women's Money In The Bank Match On 9/14 WWE Raw"
 * - "Chad Gable Retains Intercontinental Championship Against Dragon Lee And Dr. Wagner Jr On 9/14 WWE Raw"
 * - "Rey Fenix Defeats El Fiscal To Advance In WWE World Heavyweight Title Tournament On 9/14 WWE Raw"
 *
 * GUARANTEES:
 * 1. Full Show Results recaps are NEVER blocked.
 * 2. Upcoming match announcements ("Set For", "Announced For", "To Face") are NEVER blocked.
 * 3. Surprise returns, debuts, and signings ("Returns", "Debuts", "Signs") are NEVER blocked.
 * 4. Backstage news, injuries, surgeries, and interviews/quotes are NEVER blocked.
 */
export function isSingleMatchResultArticle(rawTitle: string, plainText: string = ""): boolean {
  const title = (rawTitle || "").trim();
  if (!title) return false;

  // 1. RULE 1: Full show results are ALWAYS preserved (Never single match stubs)
  if (isShowResultsArticle(title, plainText)) {
    return false;
  }

  // 2. RULE 2: Preserved Content Safeguards (Must NEVER be blocked)
  // 2.1 Upcoming match announcements / Previews / Cards
  if (/\b(?:set for|announced for|added to|scheduled for|card for|match card|lineup for|line-up for|official for|will face|to face|to battle|to clash|to meet|to team|to challenge|to defend|to appear)\b/i.test(title)) {
    return false;
  }

  // 2.2 Wrestler Returns, Debuts, Signings, Releases & Appearances
  if (/\b(?:returns? to|makes? (?:surprise )?return|debuts? (?:on|at|in)|makes? debut|signs? with|signed with|contract|free agent|re-signs?|departs?|leaves?|released by|makes? (?:surprise )?appearance|shows? up at)\b/i.test(title)) {
    return false;
  }

  // 2.3 Backstage reports, Interviews, Quotes, Opinions & Reactions
  if (/\b(?:comments on|comments after|reacts to|reflects on|explains|discusses|reveals|details|opens up|recalls|speaks on|addresses|says|tells|praises|blasts|slams|shuts down|teases|advocates|pitches|names|backstage at|loves|remembers|unhappy with|frustrated with)\b/i.test(title)) {
    return false;
  }
  // Format like: 'Wrestler: Quote' or 'Wrestler On...'
  if (/^[A-Za-z0-9'\s\.\-]+?\s*:\s*['"“]/i.test(title) || /^[A-Za-z0-9'\s\.\-]+?\s+on\s+(?:why|how|what|his|her|their|the)\b/i.test(title)) {
    return false;
  }

  // 2.4 Medical, Injuries, Surgeries, Health, Movies & Non-match news
  if (/\b(?:injury|injured|surgery|torn acl|neck injury|pulled from|medical|health|hospital|out indefinitely|gofundme|trailer|movie|film|podcast|hall of fame|funeral|passes away|passed away|dies at|death of|historic gate|ticket sales|viewership|ratings)\b/i.test(title)) {
    return false;
  }

  // 3. RULE 3: POSITIVE IDENTIFICATION OF LIVE SINGLE-MATCH SPOILERS
  // A. Defeats / Beats / Pins / Submits / Triumphs Over (e.g. "X Defeats Y", "X Pins Y")
  const hasDefeatVerb = /\b(?:defeats?|defeated|defeating|def\.|beats?|beaten|pins?|pinned|submits?|submitted|triumphs? over|victorious over)\b/i.test(title);

  // B. Qualifiers / Tournaments (e.g. "Qualifies For Men's Money In The Bank", "Advances In Title Tournament")
  const hasQualifierVerb = /\b(?:qualifies? for|qualified for|advances? (?:to|in)|advanced (?:to|in)|eliminates?|eliminated from)\b/i.test(title);

  // C. Title Retains / Title Defenses (e.g. "Retains World Heavyweight Championship Against X")
  const hasRetainVerb = /\b(?:retains?|retained)\s+(?:the\s+)?(?:.*?\s+)?(?:championships?|titles?|champions?|gold|belts?|crowns?)|retains? against\b/i.test(title);

  // D. Title Wins / New Champions in single matches (e.g. "Wins Women's Title In Chile", "Captures TNT Championship")
  const hasWinVerb = /\b(?:wins?|won|captures?|captured|crowned(?: new)?|becomes(?: new)?)\s+(?:the\s+)?(?:.*?\s+)?(?:championships?|titles?|champions?|gold|belts?|crowns?|ladder match(?:es)?|battle royals?|eliminators?)\b/i.test(title) ||
                     /\bbecomes (?:the\s+)?no\.?\s*1 contender\b/i.test(title) ||
                     /\bearns (?:a\s+)?(?:.*?\s+)?title shot\b/i.test(title);

  // E. Survives to retain
  const hasSurviveVerb = /\bsurvives?.*to retain\b/i.test(title);

  if (hasDefeatVerb || hasQualifierVerb || hasRetainVerb || hasWinVerb || hasSurviveVerb) {
    return true;
  }

  return false;
}

// Programmatic safeguard: Ensures that show results titles NEVER spoil the match winners
export function sanitizeResultsTitleSpoilers(title: string): string {
  if (!title) return title;
  let clean = title;

  // Patterns in Arabic where a match winner is spoiled in a show results title:
  // e.g. "رومان رينز يهزم بينتا" -> "مواجهة نارية بين رومان رينز وبينتا"
  // e.g. "رومان رينز يسقط بينتا" -> "مواجهة نارية بين رومان رينز وبينتا"
  // e.g. "رومان رينز يتفوق على بينتا" -> "مواجهة نارية بين رومان رينز وبينتا"
  clean = clean.replace(/([^\s:،()]+(?:\s+[^\s:،()]+){0,3})\s+(?:يهزم|يسقط|يتفوق على|ينتصر على|يتغلب على)\s+([^\s:،()]+(?:\s+[^\s:،()]+){0,3})/g, "مواجهة نارية بين $1 و$2");
  
  // "ويحتفظ بـ..." -> "وصراع مشتعل على..."
  clean = clean.replace(/و?يحتفظ\s+(?:بلقبه|باللقب|ببطولة)\s*/g, "وصراع مشتعل على لقب ");
  clean = clean.replace(/و?يتوج\s+(?:بلقب|ببطولة)\s*/g, "ونزال تاريخي على بطولة ");

  return clean.replace(/\s+/g, " ").trim();
}

// Resilient JSON parser that handles code blocks, malformed quotes, and regex fallback
function safeParseJson<T>(rawText: string): T | null {
  if (!rawText) return null;
  let text = rawText.trim();

  if (text.startsWith("```")) {
    text = text.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "").trim();
  }

  // Auto-fix: if "title": unquoted text, wrap it cleanly in quotes
  text = text.replace(/"title"\s*:\s*([^"\n\r\{\[].*?)(,\s*\n|,\s*"|\n)/i, (m, val, ending) => {
    return `"title": "${val.trim().replace(/^"|"$/g, "")}"${ending}`;
  });

  try {
    return JSON.parse(text) as T;
  } catch (e1) {}

  const firstBrace = text.indexOf("{");
  const lastBrace = text.lastIndexOf("}");
  if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
    const jsonBlock = text.slice(firstBrace, lastBrace + 1);
    try {
      return JSON.parse(jsonBlock) as T;
    } catch (e2) {}
  }

  // Regex extraction fallback for resilient parsing of AI responses
  try {
    const titleMatch = text.match(/"title"\s*:\s*"([\s\S]+?)(?<!\\)",?\s*\n/i) ||
                       text.match(/"title"\s*:\s*"([^"]+)"/i) ||
                       text.match(/"title"\s*:\s*([^",\n\r]+)/i);
    const fedMatch = text.match(/"federation"\s*:\s*"([^"]+)"/i);
    const tagsMatch = text.match(/"tags"\s*:\s*\[([\s\S]*?)\]/i);
    const bodyMatch = text.match(/"body_markdown"\s*:\s*"([\s\S]+?)"\s*(?:,\s*"tags"|\})/i);

    if (titleMatch || bodyMatch) {
      const tags: string[] = [];
      if (tagsMatch) {
        const rawTags = tagsMatch[1].match(/"([^"]+)"/g);
        if (rawTags) {
          rawTags.forEach(t => tags.push(t.replace(/"/g, "").trim()));
        }
      }
      return {
        title: titleMatch ? titleMatch[1].replace(/\\"/g, '"').trim() : "",
        federation: fedMatch ? fedMatch[1].trim() : "INDIE",
        tags: tags.length ? tags : ["أخبار المصارعة"],
        body_markdown: bodyMatch ? bodyMatch[1].replace(/\\n/g, "\n").replace(/\\"/g, '"').trim() : ""
      } as unknown as T;
    }
  } catch (e3) {}

  return null;
}

// Rewrites raw English post using Gemini into high-quality Arabic journalism
async function rewriteWithGemini(
  originalTitle: string,
  plainText: string,
  categories: string[],
  postDate?: string,
  isUpdate: boolean = false
): Promise<RewrittenArticle | null> {
  // 100% Bulletproof detection: Differentiates Full Show Results from Single News articles
  const isResultsPost = isShowResultsArticle(originalTitle, plainText);
  console.log(`[Watcher] Article classification: "${originalTitle}" -> [${isResultsPost ? "SHOW_RESULTS (نتائج عرض)" : "NEWS_ARTICLE (خبر صحفي)"}]${isUpdate ? " [REWRITE_UPDATE (تحديث)]" : ""}`);

  const arabicDate = getArabicDateFormatted(postDate);

  const prompt = isResultsPost
    ? `أنت كبير محرري موقع "عرب راسلنج" (arab-wrestling.com)، متخصص في الصحافة الرياضية وتغطية المصارعة الحرة العالمية وفنون القتال.

المهمة: تحويل تقرير العرض الإنجليزي إلى **تقرير نتائج عرض كامل ومفصل** باللغة العربية بأعلى درجات الاحترافية الصحفية.${isUpdate ? `\n\nتنبيه هام جداً (تحديث نتائج وتغطية العرض): هذا المقال يمثل تحديثاً شاملاً ومباشراً لنتائج العرض بعد اكتمال المزيد من النزالات أو انتهاء العرض كاملاً. تأكد من أن التقرير النهائي المحدث يشمل كافة النزالات والأحداث المذكورة من البداية وحتى نهاية النص بشكل مرتب ومفصل دون إغفال أي مباراة أو نتيجة!` : ""}

 القواعد التحريرية والتنسيقية الإلزامية:
1. **قاعدة أسماء الاتحادات والعروض بالإنجليزية حصراً**:
   - أسماء الاتحادات تظل بالإنجليزية دائماً كما هي دون تعريب: (WWE, AEW, TNA, ROH, NJPW, MLW, AAA, CMLL, GCW, UFC, MLP).
   - أسماء العروض التابعة للاتحادات تظل بالإنجليزية دائماً كما هي: (مثل WWE RAW, WWE SmackDown, WWE NXT, AEW Dynamite, AEW Collision, AEW Rampage, TNA iMPACT, ROH TV, Triplemania, MLP Northern Rising).
   - ممنوع نهائياً كتابة: "دبليو دبليو إي" أو "إيه إي دبليو" أو "عرض الرو" أو "سماكداون" أو "ديناميت"؛ اكتب دائماً: WWE, AEW, WWE RAW, WWE SmackDown, AEW Dynamite.
   - **إلزامية ذكر اسم الاتحاد قبل اسم أي عرض مباشرة (Mandatory Promotion Prefix)**: ممنوع نهائياً كتابة اسم العرض مفرداً بدون اسم الاتحاد (اكتب دائماً: عرض MLP Northern Rising، عرض WWE SmackDown، عرض AEW Collision، عرض TNA iMPACT).
   - كل شيء آخر يُترجم ويُكتب بالعربية (أسماء المصارعين، أنواع المباريات، شروط النزالات، الأحزمة، التفاصيل).
   - **أسماء الفرق والعصابات بالعربية دائماً وحصراً**: اكتب أسماء الفرق بالعربية دائماً (الإخوة فاغنر، وار رايدرز، ذا بلودلاين، ذا جادجمنت داي، ذا نيو داي، بيروس ديل مال).
   - **أسماء الألقاب والبطولات بالعربية الخالصة ودون تكرار اسم الاتحاد**: اكتب اللقب بالعربية مباشرة بدون اسم الاتحاد أمامه ("بطولة العالم للزوجي" وليس بطولة AAA للزوجي).
   - **القاعدة الذهبية لما يُكتب بالإنجليزية**: الشيء الوحيد المسموح بكتابته بالإنجليزية هو اسم الاتحاد واسم العرض. كل شيء آخر (المصارعين، الفرق، البطولات، الحركات) يُترجم ويُكتب بالعربية حصراً!
   - **قاعدة اللغة العربية السلسة والمبسطة وحظر صيغ التثنية تماماً**: اكتب بلغة عربية واضحة ومبسطة يفهمها الشباب بسهولة. ممنوع بتاتاً الألفاظ المعقدة أو التراثية أو صيغ التثنية الغريبة (مثل: ❌ "نجلا الأسطورة", ❌ "نجلا", ❌ "ابنا الأسطورة", ❌ "ابنا ستينغ"؛ استخدم دائماً صيغة الجمع الطبيعية: "أبناء الأسطورة ستينغ" أو "أبناء ستينغ").
   - **ممنوع بتاتاً استخدام التشكيل نهائياً في الكلمات (بدون فتحة أو ضمة أو كسرة أو تنوين أو سكون أو شدة)**. اكتب النص واضحاً سلساً بدون أي علامات تشكيل.
2. **التنسيق المنظم والفصل بين السطور**:
   - في نتائج المباريات، اجعل بين كل سطر وسطر سطرين فارغين (Double Line Break).
   - الهيكل الدقيق لكل مباراة:
**المواجهة الأولى (نوع النزال بالعربي): [المصارع 1] ضد [المصارع 2]**

**تفاصيل النزال:** [شرح سريع ومثير في سطر أو سطرين لأبرز لحظات النزال وكيف انتهى].

🏆 **الفائز:** [اسم الفائز بالعربي] (مع إضافة "واحتفظ باللقب" إذا كان نزال بطولة).

3. **العنوان لنتائج العروض (حظر تام وشامل لأي حرق لنتائج النزالات في العنوان - Strict Zero-Spoiler Rule)**:
   - **ممنوع نهائياً ذكر اسم الفائز أو الخاسر أو نتيجة أي نزال في العنوان مطلقاً!**
   - اذكر أطراف النزال الرئيسي أو الصدام الناري دون كشف الفائز (مثل: "مواجهة نارية بين رومان رينز وبينتا.. وتصفيات مشتعلة لموني إن ذا بانك").
   - إذا كان العرض ليلة واحدة: "نتائج عرض [اسم العرض مسبوقاً باسم الاتحاد] (${arabicDate}): [أطراف المواجهة الكبرى دون ذكر الفائز].. و[أبرز الأحداث والتصفيات]"
   - إذا كان مقسماً لليالٍ (Night 1 / Night 2): احذف التاريخ واكتب: "نتائج عرض [اسم العرض مسبوقاً باسم الاتحاد] (الليلة الأولى): [أطراف الحدث الرئيسي دون ذكر الفائز].. و[حدث بارز]"
4. **حظر تام لكلمتي "حلقة" و"مهرجان" نهائياً**: استبدلها دائماً بكلمة "عرض" (أو "عروض" للجمع). لا يوجد حلقة ولا مهرجان، بل اسمه "عرض".
5. **الاتحاد (federation)**: حدد الاتحاد حصراً من: ["WWE", "AEW", "TNA", "ROH", "MMA", "INDIE"].
6. **حظر ذكر أي مصادر خارجية نهائياً**: صِغْ كل شيء كأنه حصري لموقع عرب راسلنج، ممنوع تماماً ذكر Fightful أو محرريها.
7. **الوسوم (tags)**: بين 5 إلى 7 وسوم دقيقة (تتضمن اسم الاتحاد بالإنجليزية مثل WWE أو AEW، واسم العرض بالإنجليزية مثل WWE RAW، وباقي الوسوم وأسماء المصارعين بالعربية).

التقرير الأصلي:
العنوان: ${originalTitle}
التصنيفات: ${categories.join(", ")}
تاريخ الحدث: ${arabicDate}
النص:
${plainText.slice(0, 16000)}

أخرج النتيجة بتنسيق JSON حصراً:
{
  "title": "نتائج عرض...",
  "federation": "WWE",
  "tags": ["وسم 1", "وسم 2", "وسم 3", "وسم 4", "وسم 5"],
  "body_markdown": "المحتوى المنسق بسطور مفصولة وفقرات مستقلة..."
}
`
    : `أنت كبير محرري موقع "عرب راسلنج" (arab-wrestling.com)، متخصص في الصحافة الرياضية وتغطية المصارعة الحرة العالمية وفنون القتال.

المهمة: تحويل هذا الخبر/الكواليس/التصريح إلى **مقال صحفي إخباري رياضي حصري ومثير ومفصل** باللغة العربية.

القواعد التحريرية والتنسيقية الإلزامية (حاسمة جداً):
1. **طبيعة المقال**: هذا خبر صحفي مفرد (News). **ممنوع منعاً باتاً كتابة كلمة "نتائج عرض" أو وضع التاريخ بين قوسين في بداية العنوان!**
2. **العنوان (مطابقة تامة لوقائع العنوان الأصلي بصياغة عربية رياضية فصيحة ورشيقة - 100% Faithful Rephrasing)**:
   - **القاعدة الذهبية للعنوان**: صِغْ العنوان ليكون نقلاً أميناً ومطابقاً 100% لنفس وقائع وأسماء العنوان الأصلي الإنجليزي: (${originalTitle}).
   - المطلوب هو **إعادة صياغة صحفية رشيقة باللغة العربية لنفس الخبر**، وليس ترجمة آلية ميتة، مع الالتزام الصارم بنفس الأحداث.
   - **حظر تام للبادئات المكررة**: ممنوع منعاً باتاً بدء العناوين بعبارات مكررة مثل:
     - ❌ "تصريحات نارية.."
     - ❌ "صدمة مدوية.."
     - ❌ "ليلة نارية.."
     - ❌ "اعترافات صادمة.."
     - ❌ "مفاجأة كبرى.."
   - كل عنوان يجب أن يبدأ بأسلوب مختلف ومتنوع يبرز جوهر الخبر مباشرة (مثل: اسم المصارع وفعل الحدث، أو تصريح مثير بين علامتي اقتباس).
   - **قاعدة الالتزام التام بالحقائق وتفاصيل الخبر وعدم اختلاق المفاجآت أو التهويل الفارغ (Factual Truth & Zero Hallucinated Clickbait - حاسمة جداً)**:
      - **ممنوع منعاً باتاً استبدال وقائع وتفاصيل الخبر المحددة بعبارات تهويل كاذبة أو فارغة** (مثل: ❌ "يفاجئ الجميع", ❌ "عودته الصاعقة", ❌ "يهز الحلبات", ❌ "صدمة مدوية").
      - إذا كان العنوان الأصلي يحتوي على حدثين مترابطين (مثل: عودة مصارع + تشكيل فريق في نزال مختلط مع شريك محدد):
        - **يجب أن يذكر العنوان العربي تفاصيل الحدثين الحقيقيين بدقة**:
          - مثال: "El Grande Americano Returns To WWE Raw, Teams With Stephanie Vaquer In Mixed Tag Action"
          - ❌ صياغة تهويلية مبتذلة وفارغة ممنوعة: "إل غراندي أمريكانو يفاجئ الجميع ويسجل عودته الصاعقة في عرض WWE RAW"
          - ✅ **الصياغة الصحفية الذكية والدقيقة**: "إل غراندي أمريكانو يعود إلى عرض WWE RAW ويتحالف مع ستيفاني فاكير في مواجهة مختلطة"
      - الإثارة الصحفية المطلوبة تتحقق بـ **جمال وبلاغة الأسلوب الرياضي الفصيح ونقل الحقائق والأسماء الهامة**، وليس باختلاق كلمة "مفاجأة" أو "صاعقة" حيث لا توجد مفاجأة ولا صدمة!
   - **قاعدة تصريحات وردود أفعال المصارعين وإعادة الصياغة الصحفية الذكية (Smart Rewriting vs Literal Translation - حاسمة جداً)**:
     - إذا كان الخبر الأصلي عبارة عن رد فعل، تغريدة، منشور إنستغرام أو تويتر، أو تصريح لمصارع (مثل: 'Wrestler: Quote' أو 'Wrestler Reacts To...'):
       - **ممنوع منعاً باتاً تغيير زاوية أو موضوع الخبر** أو تحويله إلى تقرير عن فوز بنزال أو خسارة لقب وكأنه حدث للتو مع تجاهل التصريح!
       - **ممنوع الترجمة الحرفية الركيكة** للألفاظ الإنجليزية (مثل ترجمة "Ride or dies rejoice" حرفياً بـ "يا رفاقي الأوفياء ابتهجوا").
       - **المطلوب**: استيعاب جوهر الفكرة والزاوية الأساسية، ثم إعادة صياغتها بأسلوب صحفي عربي رياضي أصيل وجذاب ورشيق:
         - مثال: Sami Zayn: ‘Ride Or Dies Rejoice, Justice At Last! Two Time WWE Champion!’
           -> ❌ تجنب الترجمة الحرفية: سامي زين: "يا رفاقي الأوفياء ابتهجوا..."
           -> ✅ **العنوان الصحفي المعتمد**: سامي زين يحتفل مع جماهيره الوفية باستعادة لقب WWE: "العدالة تحققت أخيراً!"
     - في المتن: اكتب بلغة عربية صحفية بليغة وسلسة، تركز على رسالة المصارع وفرحته وتواصله مع جماهيره، مع جعل تفاصيل النزال السابق خلفية سياقية قصيرة فقط.
3. **متن المقال (أمين 100% لوقائع المصدر، سريع، شيق، مركز، وبدون حشو أو تهويل)**:
   - **قاعدة الأمانة الخبرية التامة (100% Factual Fidelity)**:
     - انقل جميع الوقائع، الأسماء، النزالات، والأحداث الواردة في النص الإنجليزي بأمانة تامة ودقة متناهية دون زيادة أحداث من عندك أو حذف تفاصيل هامة.
     - الصيغة تكون عربية رياضية فصيحة وسلسة وممتعة، وليست ترجمة حرفية ركيكة.
   - **قاعدة الإيجاز المشوق (Punchy & Concise)**: الزائر يمل بسرعة من النصوص الطويلة؛ اجعل الخبر مختصراً ومكثفاً في **فقرتين إلى 3 فقرات قصيرة فقط** (ما بين 120 إلى 180 كلمة):
     - **الفقرة الأولى (جوهر الحدث)**: ادخل في صلب الحدث مباشرة وبوضوح تام ينقل الواقعة الرئيسية دون مقدمات إنشائية ميتة.
     - **الفقرة الثانية (تفاصيل ما جرى والكواليس)**: كيف وقع الحدث، وتفاصيل النزال أو التصريحات الحقيقية المذكورة في المصدر بدقة.
     - **الفقرة الثالثة (ماذا بعد؟)**: سطرين ختاميين عن الأثر المرتقب في العروض القادمة والسيناريوهات المشتعلة.
   - **ممنوع بتاتاً**: الحشو الكلامي الزائد، أو تكرار العبارات، أو التطويل الممل، أو اختلاق أحداث لم ترد في المصدر إطلاقاً.
4. **قاعدة أسماء الاتحادات والعروض بالإنجليزية حصراً (Strict Rule)**:
   - **أسماء الاتحادات تظل بالإنجليزية دائماً كما هي دون أي تعريب أو ترجمة**:
     (WWE, AEW, TNA, ROH, NJPW, MLW, AAA, CMLL, GCW, UFC, MLP).
     - ممنوع نهائياً: "دبليو دبليو إي", "إيه إي دبليو", "تي إن إيه", "نيو جابان".
     - اكتب دائماً: WWE, AEW, TNA, NJPW, MLW.
   - **أسماء العروض التابعة للاتحادات تظل بالإنجليزية دائماً كما هي**:
     (مثل: WWE RAW, WWE SmackDown, WWE NXT, AEW Dynamite, AEW Collision, AEW Rampage, TNA iMPACT, AEW All In, WrestleMania, Royal Rumble, SummerSlam, MLP Northern Rising).
     - ممنوع نهائياً: "الرو", "راو", "سماكداون", "ديناميت", "كوليجن", "إمباكت".
     - اكتب دائماً: WWE RAW, WWE SmackDown, AEW Dynamite, AEW Collision, TNA iMPACT.
   - **إلزامية ذكر اسم الاتحاد قبل اسم أي عرض مباشرة (Mandatory Promotion Prefix)**:
     - ممنوع نهائياً كتابة اسم أي عرض بدون ذكر اسم الاتحاد قبله مباشرة في العناوين أو المتن ليعرف القارئ تبعية العرض فوراً.
     - اكتب دائماً: "عرض MLP Northern Rising" (ممنوع نهائياً: "عرض Northern Rising" فقط بدون MLP)، "عرض WWE SmackDown"، "عرض AEW Collision"، "عرض TNA iMPACT".
   - **أسماء المصارعين والمصارعات بالعربية دائماً وحصراً ودون أخطاء (ممنوع منعاً باتاً كتابة اسم أي مصارع بالإنجليزية سواء في العنوان أو المتن)**:
      - **AJ Lee** تُكتب بالعربية حصراً: **ايه جيه لي** (ممنوع منعاً باتاً كتابة "اي لي" أو "إي لي" أو "إي جاي لي").
      - **AJ Styles** يُكتب بالعربية حصراً: **ايه جيه ستايلز** (ممنوع نهائياً كتابة "اي ستايلز" أو "اي جي ستايلز").
      - **CJ Perry** تُكتب بالعربية: **سي جيه بيري**
      - **Orange Cassidy** يُكتب: **أورانج كاسيدي**
      - **Dean Malenko** يُكتب: **دين مالينكو**
      - **Women's Division** يُترجم حصراً: **قسم السيدات** (ممنوع نهائياً كتابة "قسم النساء").
      - أندرادي أو أندرادي إل إيدولو (Andrade / Andrade El Idolo - **ممنوع منعاً باتاً كتابة "انقرادي" أو "أنقرادي"**)
      - روهيت راجو (Rohit Raju)
      - ستيفن بوردن (Steven Borden)، غاريت بوردن (Garrett Borden)، ستينغ (Sting)
      - **حظر تام وقاطع للترجمة الحرفية لأسماء المصارعين والشخصيات المقنعة والترفيهية (Luchadores, Personas & Gimmicks)**:
         - **ممنوع بتاتاً منعاً باتاً ترجمة اسم أي مصارع أو لقب أو شخصية مقنعة ترجمة حرفية لمعناها!**
         - جميع الأسماء تُكتب حصراً **بالتعريب الصوتي الفصيح**:
           - **El Grande Americano** يُكتب حصراً: **إل غراندي أمريكانو** (ممنوع منعاً باتاً ترجمته إلى "الأمركنو الكبير" أو "الأمريكي الكبير" أو أي اختراع حرفي!).
           - **The Undertaker** يُكتب: **أندرتيكر** (ممنوع: "حفار القبور").
           - **The Rock** يُكتب: **ذا روك** (ممنوع: "الصخرة").
           - **El Hijo del Vikingo** يُكتب: **إل هيخو ديل فيكينغو** (ممنوع: "ابن الفايكنغ").
         - **Swerve Strickland** يُكتب بالعربية حصراً: **سويرف ستريكلاند** (ممنوع منعاً باتاً كتابة "سوير ستريكلاند" أو "سوري ستركلند" أو "سويرف ستركلند"؛ اسمه المعتمد حصراً في الموقع هو: **سويرف ستريكلاند**).
         - **Adam Copeland** يُكتب بالعربية: **آدم كوبلاند** (ممنوع كتابة "أدم كوبلند").
         - **Money In The Bank** تُكتب بالعربية حصراً: **موني إن ذا بانك** (ممنوع كتابة: "موني إن دي بانك" أو "ماني").
         - **Lil Yachty** يُكتب بالعربية حصراً: **ليل ياتي** (ممنوع منعاً باتاً كتابة "ليل ياشتي" أو "ليلت ياشتي" أو "ياشتي"؛ اسمه المعتمد حصراً في الموقع هو: **ليل ياتي**).
         - **Deonna Purrazzo** تُكتب بالعربية حصراً: **ديونا بوراتزو** (ممنوع منعاً باتاً كتابة: "ديونا بوراكزو" أو "بورازو"؛ اسمها المعتمد حصراً في الموقع هو: **ديونا بوراتزو**).
         - **Paul Heyman** يُكتب بالعربية: **بول هيمان** (ممنوع كتابة "بول هيمن" أو "سبيشل بول هيمن").
         - سيث رولينز (Seth Rollins - ممنوع منعاً باتاً كتابة ستيف رولينز)، سولو سيكوا (Solo Sikoa)، ار تروث (ممنوع بتاتاً R-Truth)، سي ام بانك (CM Punk)، ال ايه نايت (LA Knight)، ام جيه اف (MJF)، ام في بي (MVP)، كودي رودز، رومان رينز، جون سينا، داميان بريست، درو ماكنتاير، ليف مورغان، ستيفاني فاكير، دومينيك ميستيريو، ري ميستيريو، اوموس، برايان كيج.
   - **قاعدة أسماء الفرق والعصابات بالعربية دائماً وحصراً (ممنوع نهائياً بالإنجليزية)**:
      - **ممنوع نهائياً كتابة اسم أي فريق أو عصابة أو تحالف بالإنجليزية** في العنوان أو المتن (مثل ❌ The Wagner Brothers, ❌ War Raiders, ❌ The New Day, ❌ The Bloodline, ❌ The Judgment Day).
      - اكتب الفرق بالعربية دائماً: فريق الإخوة فاغنر، فريق وار رايدرز، فريق ذا بلودلاين، فريق ذا جادجمنت داي، فريق ذا نيو داي، فريق بيروس ديل مال، فريق غريزلد يونغ فيترانز.
    - **قاعدة أسماء الألقاب والبطولات بالعربية الخالصة ودون تكرار اسم الاتحاد (Championship Titles)**:
      - **ممنوع نهائياً كتابة أسماء البطولات بالإنجليزية** (مثل ❌ AAA World Tag Team).
      - **ممنوع تكرار اسم الاتحاد داخل اسم البطولة**؛ اكتب اسم اللقب بالعربية مباشرة دون وضع اسم الاتحاد أمامه لأن اسم الاتحاد يُذكر مع اسم العرض.
      - اكتب دائماً: **"بطولة العالم للزوجي"** (وليس بطولة AAA للزوجي)، "بطولة العالم للوزن الثقيل"، "بطولة القارات"، "بطولة العالم للسيدات"، "بطولة الولايات المتحدة"، "بطولة التلفزيون".
    - **القاعدة الذهبية الصارمة لما يُكتب بالإنجليزية في كامل المقال**:
      - الشيء الوحيد المسموح بكتابته بالإنجليزية هو **اسم الاتحاد** (WWE, AEW, TNA, AAA, CMLL, NJPW, MLW, UFC) و**اسم العرض مسبوقاً باسم الاتحاد** (مثل عرض AAA Triplemanía 34، عرض WWE SmackDown).
      - **كل شيء آخر (المصارعين، الفرق، الألقاب، الحركات، التفاصيل) يُترجم ويُكتب بالعربية حصراً وبدون أي استثناء!**
    - **قاعدة اللغة العربية المبسطة والحديثة (حظر الألفاظ التراثية وصيغ التثنية تماماً)**:
      - اكتب المقال والعنوان بلغة عربية صحفية مبسطة وسلسة جداً وواضحة يفهمها جمهور الشباب بسهولة.
      - **ممنوع بتاتاً منعاً باتاً استخدام صيغ التثنية الغريبة أو الألفاظ المعقدة** (مثل: ❌ "نجلا الأسطورة", ❌ "نجلا", ❌ "ابنا الأسطورة", ❌ "ابنا ستينغ", ❌ "ابنا", ❌ "ابني", ❌ "خضم", ❌ "غمار", ❌ "أتون").
      - **استخدم دائماً صيغة الجمع البسيطة الطبيعية والواضحة**: اكتب حصراً **"أبناء الأسطورة ستينغ"** أو **"أبناء ستينغ"**، واستخدم "خلال"، "وسط".
    - التفاصيل، الكواليس، النزالات، الحوارات، التحليلات بالعربية.
    - **ممنوع بتاتاً استخدام التشكيل نهائياً في الكلمات (بدون فتحة أو ضمة أو كسرة أو تنوين أو سكون أو شدة)**؛ اكتب كل النصوص خالية تماماً من التشكيل لتكون سهلة وسريعة القراءة.
5. **حظر تام لكلمتي "حلقة" و"مهرجان" نهائياً**: في عالم المصارعة لا يوجد مصطلح "حلقة" ولا "مهرجان"، الاسم المعتمد دائماً هو **"عرض"** (أو **"عروض"** للجمع). استبدل أي ورود لكلمة حلقة أو مهرجان بكلمة "عرض" دائماً (مثل: عرض WrestleMania، عرض AAA Triplemanía، عروض WWE الشهرية، عروض AEW).
6. **الاتحاد (federation)**: حدد الاتحاد حصراً من: ["WWE", "AEW", "TNA", "ROH", "MMA", "INDIE"].
7. **حظر ذكر أي مصادر خارجية نهائياً**: صِغْ كل معلومة كأنها خبر حصري لموقع عرب راسلنج (أو "أفادت مصادرنا الخاصة", "كشفت تقارير مطلعة"). ممنوع ذكر Fightful.
8. **الوسوم (tags)**: بين 5 إلى 7 وسوم دقيقة (تتضمن اسم الاتحاد بالإنجليزية مثل WWE أو AEW، واسم العرض بالإنجليزية مثل WWE RAW، وباقي الوسوم وأسماء المصارعين بالعربية).

الخبر الأصلي:
العنوان: ${originalTitle}
التصنيفات: ${categories.join(", ")}
تاريخ الحدث: ${arabicDate}
النص:
${plainText.slice(0, 4000)}

أخرج النتيجة بتنسيق JSON حصراً:
{
  "title": "العنوان الصحفي المثير وفقاً للقواعد...",
  "federation": "WWE",
  "tags": ["وسم 1", "وسم 2", "وسم 3", "وسم 4", "وسم 5"],
  "body_markdown": "متن المقال الإخباري السريع والمثير بدون حشو..."
}
`;

  const text = await queryGemini(prompt, true);
  if (!text) return null;

  try {
    const parsed = safeParseJson<RewrittenArticle>(text);
    if (!parsed || !parsed.title || !parsed.body_markdown) {
      console.warn("[Watcher] safeParseJson returned incomplete object:", text.slice(0, 150));
      return null;
    }

    // Sanitize any instances of 'حلقة' to 'عرض' & remove cliché prefixes
    parsed.title = cleanHeadlineClichés(sanitizeWrestlingTerms(parsed.title));
    if (isResultsPost) {
      parsed.title = sanitizeResultsTitleSpoilers(parsed.title);
    }
    parsed.body_markdown = formatResultsMarkdown(sanitizeWrestlingTerms(parsed.body_markdown));
    parsed.tags = (parsed.tags || []).map(t => sanitizeWrestlingTerms(t));

    // Validate & normalize federation strictly to the site's 6 allowed categories
    const ALLOWED_FEDERATIONS = ["WWE", "AEW", "TNA", "ROH", "MMA", "INDIE"];
    let fed = (parsed.federation || "").trim().toUpperCase();
    if (fed === "UFC" || fed === "PFL" || fed === "BELLATOR") {
      fed = "MMA";
    } else if (!ALLOWED_FEDERATIONS.includes(fed)) {
      fed = "INDIE";
    }
    parsed.federation = fed;

    // Validate tags length (force 5-7 tags)
    if (!Array.isArray(parsed.tags) || parsed.tags.length < 5) {
      const baseTags = ["أخبار المصارعة", parsed.federation ? `عروض ${parsed.federation}` : "عروض المصارعة"];
      parsed.tags = Array.from(new Set([...(parsed.tags || []), ...baseTags])).slice(0, 7);
    }
    if (parsed.tags.length > 7) {
      parsed.tags = parsed.tags.slice(0, 7);
    }

    // Pass 2: Run through our dedicated Title Optimizer with date & full Arabic rules
    await new Promise(r => setTimeout(r, 1500)); // Gentle 1.5s pause to respect Gemini free tier RPM limits
    console.log(`[Watcher] Optimizing title with dedicated AI Title Engine (Date: ${arabicDate})...`);
    parsed.title = await optimizeTitleForSEOAndCTR(originalTitle, parsed.title, parsed.body_markdown, isResultsPost, arabicDate);
    // Double-pass sanitization guarantee to ensure 0% chance of typos, English terms or tashkeel slipping through
    parsed.title = cleanHeadlineClichés(sanitizeWrestlingTerms(parsed.title));
    parsed.body_markdown = sanitizeWrestlingTerms(parsed.body_markdown);
    parsed.tags = (parsed.tags || []).map(t => sanitizeWrestlingTerms(t));
    console.log(`[Watcher] Final Optimized Title: "${parsed.title}" (length: ${parsed.title.length} chars)`);

    return parsed;
  } catch (e) {
    console.warn(`[Watcher] JSON parse error:`, e);
    return null;
  }
}

// Canonical Arabic slug matching eleventy.config.js
function arabicSlug(str: string): string {
  if (!str) return "";
  return str
    .toString()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .normalize("NFC")
    .trim()
    .toLowerCase()
    .replace(/[\.\_\/\\]+/g, "-")
    .replace(/\s+/g, "-")
    .replace(/[^\w\u0600-\u06FF\-]/g, "")
    .replace(/\-\-+/g, "-")
    .replace(/^-+|-+$/g, "");
}

// Generate clean Arabic slug from title
function generateSlug(title: string): string {
  return arabicSlug(title) || title
    .replace(/[^\u0621-\u064A\u0660-\u0669a-zA-Z0-9\s-]/g, "")
    .trim()
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .slice(0, 80);
}

// Format date to YYYYMMDDHHMMSS and ISO string strictly in UTC+3 (Egypt / Cairo time)
function formatDate(dateString?: string) {
  let d: Date;
  if (!dateString) {
    d = new Date();
  } else {
    const s = dateString.endsWith("Z") || dateString.includes("+") ? dateString : dateString + "Z";
    d = new Date(s);
  }
  if (isNaN(d.getTime())) d = new Date();
  
  // Shift epoch ms by +3 hours to read UTC parts as exact local UTC+3 time
  const shifted = new Date(d.getTime() + 3 * 3600000);
  const pad = (n: number) => String(n).padStart(2, "0");
  
  const Y = shifted.getUTCFullYear();
  const M = pad(shifted.getUTCMonth() + 1);
  const D = pad(shifted.getUTCDate());
  const h = pad(shifted.getUTCHours());
  const m = pad(shifted.getUTCMinutes());
  const s = pad(shifted.getUTCSeconds());
  
  const prefix = `${Y}${M}${D}${h}${m}${s}`;
  const iso = `${Y}-${M}-${D}T${h}:${m}:${s}.000+03:00`;

  return { prefix, iso };
}

// Fetch posts from Fightful WordPress REST API
async function fetchLatestFightfulPosts(limit: number = 10): Promise<any[]> {
  const fetchCount = Math.max(limit, 30);
  const url = `https://www.fightful.com/wp-json/wp/v2/posts?_embed=1&per_page=${fetchCount}&_cb=${Date.now()}`;
  console.log(`[Watcher] Fetching latest posts from: ${url}`);
  
  const res = await fetch(url, {
    headers: {
      "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      "Accept": "application/json",
    },
  });

  if (!res.ok) {
    throw new Error(`Failed to fetch from Fightful API: HTTP ${res.status}`);
  }

  const posts = await res.json();

  // Automatically update watcher-feed.json with latest 30 posts for admin/watcher.html
  try {
    const feedPath = path.join(process.cwd(), "watcher-feed.json");
    const cleanFeed = (Array.isArray(posts) ? posts : []).slice(0, 30).map((p: any) => ({
      id: p.id,
      link: p.link,
      date: p.date,
      date_gmt: p.date_gmt || p.date,
      title: { rendered: p.title?.rendered || "" },
      featured_image: p.jetpack_featured_media_url || p._embedded?.["wp:featuredmedia"]?.[0]?.source_url || ""
    }));
    fs.writeFileSync(feedPath, JSON.stringify(cleanFeed, null, 2), "utf-8");
  } catch (err) {
    console.warn("[Watcher] Warning: could not write watcher-feed.json:", err);
  }

  return posts.slice(0, limit);
}

// Search for an existing news file corresponding to a Fightful post ID or URL
function findExistingNewsFile(postId: number, postUrl?: string): { filePath: string; fileName: string } | null {
  try {
    if (!fs.existsSync(NEWS_DIR)) return null;
    const files = fs.readdirSync(NEWS_DIR);
    for (const file of files) {
      if (!file.endsWith(".md")) continue;
      const fullPath = path.join(NEWS_DIR, file);
      let header = "";
      try {
        const fd = fs.openSync(fullPath, "r");
        const buffer = Buffer.alloc(1500);
        const bytesRead = fs.readSync(fd, buffer, 0, 1500, 0);
        fs.closeSync(fd);
        header = buffer.toString("utf-8", 0, bytesRead);
      } catch (e) {
        continue;
      }

      if (postId && (header.includes(`source_id: ${postId}`) || header.includes(`source_id: "${postId}"`))) {
        return { filePath: fullPath, fileName: file };
      }
      if (postUrl) {
        const cleanUrl = postUrl.replace(/\/+$/, "");
        if (header.includes(cleanUrl) || header.includes(postUrl)) {
          return { filePath: fullPath, fileName: file };
        }
      }
    }
  } catch (e) {
    console.error("[Watcher] Error scanning for existing news file:", e);
  }
  return null;
}

// Process a single Fightful post
async function processPost(post: any, customDate?: Date | string, bypassSpoilerFilter: boolean = false): Promise<boolean> {
  const postId = post.id;
  const rawTitle = post.title?.rendered?.replace(/&#8217;/g, "'").replace(/&#8216;/g, "'").replace(/&amp;/g, "&") || "News";
  const postUrl = post.link || "";
  const sourceDate = post.date_gmt || post.date;
  const effectiveDate = customDate ? (customDate instanceof Date ? customDate.toISOString() : customDate) : sourceDate;
  const contentHtml = post.content?.rendered || "";

  // Check if this post was already published on the site (e.g. show results/coverage updated over the course of the event)
  const existingFile = findExistingNewsFile(postId, postUrl);
  const isUpdate = Boolean(existingFile);

  console.log(`\n--------------------------------------------------`);
  console.log(`[Watcher] Processing post #${postId}: "${rawTitle}"${isUpdate ? ` [UPDATE to ${existingFile?.fileName}]` : ""}`);
  console.log(`[Watcher] Effective publish date: ${effectiveDate} (Source: ${sourceDate})`);

  // Extract primary article image strictly from WordPress featured media or body image (NEVER from YouTube video)
  let imageUrl = post.jetpack_featured_media_url || post._embedded?.["wp:featuredmedia"]?.[0]?.source_url;
  if (!imageUrl) {
    const bodyImgMatch = contentHtml.match(/<img[^>]+src=["']([^"']+)["']/i);
    if (bodyImgMatch && bodyImgMatch[1]) {
      imageUrl = bodyImgMatch[1];
    }
  }

  // Detect YouTube video solely for embedding the video watch link in the article text (NEVER as cover image)
  let ytVideoId = extractYouTubeVideoId(contentHtml) || extractYouTubeVideoId(post.link || "");

  // Extract categories & tags
  const terms: string[] = [];
  if (Array.isArray(post._embedded?.["wp:term"])) {
    for (const group of post._embedded["wp:term"]) {
      if (Array.isArray(group)) {
        for (const t of group) {
          if (t.name) terms.push(t.name);
        }
      }
    }
  }

  // Clean plain text for AI
  const plainText = htmlToPlainText(contentHtml);
  if (plainText.length < 25) {
    console.warn(`[Watcher] Post #${postId} has insufficient text content, skipping.`);
    return false;
  }

  const isSingleMatch = isSingleMatchResultArticle(rawTitle, plainText);

  // Single-Match Spoiler Shield: Only skip on site if explicitly configured, otherwise publish to site
  if (SKIP_SINGLE_MATCH_ON_SITE && !bypassSpoilerFilter && isSingleMatch) {
    console.log(`[Watcher] 🛡️ Single-Match Spoiler Shield: Post #${postId} ("${rawTitle}") is an individual match outcome stub. Skipping on site.`);
    return false;
  }

  // 1. Download & compress image (with fallback)
  let localImagePath: string | null = null;
  if (imageUrl) {
    localImagePath = await downloadAndOptimizeImage(imageUrl);
  }

  // If image download failed but this is an update, reuse existing article image
  if ((!localImagePath || localImagePath === "/favicon.png") && existingFile) {
    try {
      const oldContent = fs.readFileSync(existingFile.filePath, "utf-8");
      const imgMatch = oldContent.match(/^image:\s*["']?([^"'\r\n]+)["']?/m);
      if (imgMatch && imgMatch[1] && !imgMatch[1].includes("favicon")) {
        localImagePath = imgMatch[1];
        console.log(`[Watcher] Reusing existing verified image: ${localImagePath}`);
      }
    } catch (e) {}
  }

  if (!localImagePath) {
    console.warn(`[Watcher] Could not download image for post #${postId}, using reliable site fallback banner.`);
    // Look for any existing jpg image in content/images as a safe fallback
    try {
      const existing = fs.readdirSync(IMAGES_DIR).filter(f => f.endsWith(".jpg"));
      if (existing.length > 0) {
        localImagePath = `/content/images/${existing[0]}`;
      }
    } catch (e) {}
    if (!localImagePath) {
      localImagePath = "/favicon.png";
    }
  }

  // 2. Rewrite with Gemini AI
  console.log(`[Watcher] Calling Gemini for Arabic rewriting & title crafting...`);
  const rewritten = await rewriteWithGemini(rawTitle, plainText, terms, sourceDate, isUpdate);
  if (!rewritten || !rewritten.title || !rewritten.body_markdown) {
    console.error(`[Watcher] Failed to rewrite post #${postId} with Gemini.`);
    return false;
  }

  console.log(`[Watcher] Generated Arabic Title: "${rewritten.title}"`);
  console.log(`[Watcher] Federation: ${rewritten.federation} | Tags (${rewritten.tags.length}): ${rewritten.tags.join(", ")}`);

  // 3. Extract media embeds and append clean standalone URLs to body
  const embeds = extractEmbeds(contentHtml);
  if (ytVideoId) {
    const cleanYtUrl = `https://www.youtube.com/watch?v=${ytVideoId}`;
    if (!embeds.includes(cleanYtUrl)) {
      embeds.push(cleanYtUrl);
    }
  }
  let finalBody = rewritten.body_markdown.trim();
  if (embeds.length > 0) {
    finalBody += `\n\n${embeds.join("\n\n")}`;
  }

  // 4. Create or update markdown file (Upon re-publishing/updating, delete old file completely as requested)
  const { prefix, iso } = formatDate(effectiveDate);
  let oldSlug = "";
  let oldFileName = "";

  if (existingFile) {
    oldFileName = existingFile.fileName;
    try {
      const oldContent = fs.readFileSync(existingFile.filePath, "utf-8");
      const tMatch = oldContent.match(/^title:\s*["']?([^"'\r\n]+)["']?/m);
      if (tMatch && tMatch[1]) {
        oldSlug = arabicSlug(tMatch[1]);
      } else {
        oldSlug = existingFile.fileName.replace(/^\d+-/, "").replace(/\.md$/, "");
      }

      // Delete the old file completely so it is replaced with a fresh new article
      if (fs.existsSync(existingFile.filePath)) {
        fs.unlinkSync(existingFile.filePath);
        console.log(`[Watcher] 🗑️ Deleted old article file: ${existingFile.fileName}`);
      }
    } catch (e) {
      console.warn(`[Watcher] Warning: could not delete old file:`, e);
    }
  }

  const slug = generateSlug(rewritten.title);
  const targetFileName = `${prefix}-${slug}.md`;
  const targetFilePath = path.join(NEWS_DIR, targetFileName);

  const tagsYaml = rewritten.tags.map(t => `  - ${t}`).join("\n");
  const markdownContent = `---
federation: ${rewritten.federation || "WWE"}
title: ${JSON.stringify(rewritten.title)}
date: ${iso}
source_id: ${postId}
source_url: ${JSON.stringify(postUrl)}
single_match_result: ${isSingleMatch}
tags:
${tagsYaml}
image: ${localImagePath}
layout: post-layout.njk
---
${finalBody}
`;

  fs.writeFileSync(targetFilePath, markdownContent, "utf-8");
  console.log(`[Watcher] Successfully published fresh news file: ${targetFilePath}`);

  // Register 301 redirect if old article had a different URL
  if (oldSlug && oldSlug !== slug) {
    try {
      const redirectsPath = path.join(process.cwd(), "_redirects");
      if (fs.existsSync(redirectsPath)) {
        const oldPath = `/news/${oldSlug}/`;
        const newPath = `/news/${slug}/`;
        const redirRule = `${oldPath}* ${newPath}:splat 301!`;
        const currentRedir = fs.readFileSync(redirectsPath, "utf-8");
        if (!currentRedir.includes(oldPath)) {
          fs.appendFileSync(redirectsPath, `\n${redirRule}\n`, "utf-8");
          console.log(`[Watcher] 🔀 Added 301 redirect from old article URL to new URL: ${redirRule}`);
        }
      }
    } catch (e) {}
  }

  // Update admin-file-order.json so updated article appears at the very top of Decap CMS
  const orderPath = path.join(process.cwd(), "admin-file-order.json");
  if (fs.existsSync(orderPath)) {
    try {
      let order = JSON.parse(fs.readFileSync(orderPath, "utf-8"));
      if (Array.isArray(order)) {
        if (oldFileName) order = order.filter(f => f !== oldFileName);
        order = order.filter(f => f !== targetFileName);
        order.unshift(targetFileName);
        fs.writeFileSync(orderPath, JSON.stringify(order, null, 2), "utf-8");
      }
    } catch (e) {}
  }

  // Handle publish-state for this article:
  // If this is a single-match result, mark it as claimed across all social platforms
  // so social feeds remain 100% spoiler-free!
  // Otherwise, clear any old slug state so social platforms will publish fresh news.
  try {
    const stateFile = path.join(process.cwd(), "_data", "publish-state.json");
    if (fs.existsSync(stateFile)) {
      const pState = JSON.parse(fs.readFileSync(stateFile, "utf-8"));
      if (isSingleMatch) {
        const siteUrl = `https://arab-wrestling.com/news/${slug}/`;
        const itemKey = siteUrl.replace(/[^a-zA-Z0-9_-]/g, "_");
        const now = Date.now();
        for (const platform of ["telegram", "facebook", "instagram", "x"] as const) {
          if (!pState[platform]) pState[platform] = {};
          pState[platform][itemKey] = now;
        }
        fs.writeFileSync(stateFile, JSON.stringify(pState, null, 2), "utf-8");
        console.log(`[Watcher] 🛡️ Social Media Shield: Post #${postId} ("${rawTitle}") saved to site archive, and marked claimed in publish-state.json to keep social media 100% spoiler-free!`);
      } else {
        let modified = false;
        for (const platform of ["telegram", "facebook", "instagram", "x"] as const) {
          if (pState[platform]) {
            for (const k of Object.keys(pState[platform])) {
              if ((oldSlug && k.includes(oldSlug)) || (slug && k.includes(slug))) {
                delete pState[platform][k];
                modified = true;
              }
            }
          }
        }
        if (modified) {
          fs.writeFileSync(stateFile, JSON.stringify(pState, null, 2), "utf-8");
          console.log(`[Watcher] 📢 Reset publish-state so social media platforms will re-publish this post!`);
        }
      }
    }
  } catch (e) {}

  return true;
}


// Maximum allowed age (in hours) for auto-publishing articles from Fightful.
// Anything older than 5 hours is considered old news in automated mode.
const MAX_AUTO_PUBLISH_AGE_HOURS = 5;

// Main check function
export async function runWatcher(options: { forceLatest?: boolean; maxCount?: number; maxPerRun?: number } = {}) {
  const state = loadState();

  if (state.enabled === false && !options.forceLatest) {
    console.log("[Watcher] ⏸️ Watcher is currently PAUSED by admin in watcher-state.json. Skipping execution.");
    return;
  }

  const batchLimit = options.maxCount || 30;
  console.log(`[Watcher] Checking for new posts at ${new Date().toLocaleTimeString()} (Batch: ${batchLimit}, Max Age: ${MAX_AUTO_PUBLISH_AGE_HOURS}h)...`);

  try {
    const posts = await fetchLatestFightfulPosts(batchLimit);
    if (!Array.isArray(posts) || posts.length === 0) {
      console.log("[Watcher] No posts found.");
      return;
    }

    let processedCount = 0;

    // Process from oldest to newest among the fetched batch
    const candidatePosts = [...posts].reverse();

    for (const post of candidatePosts) {
      const postId = post.id;
      const isAlreadyProcessed = state.processedIds.includes(postId);

      if (isAlreadyProcessed && !options.forceLatest) {
        continue;
      }

      // Check age: strictly skip old news in automated watcher mode
      const rawTitle = post.title?.rendered?.replace(/&#8217;/g, "'").replace(/&#8216;/g, "'").replace(/&amp;/g, "&") || `Post #${postId}`;
      const postDateGmt = post.date_gmt
        ? (post.date_gmt.endsWith("Z") ? post.date_gmt : post.date_gmt + "Z")
        : (post.date ? post.date + "Z" : "");
      const postTime = postDateGmt ? new Date(postDateGmt).getTime() : NaN;
      const ageHours = !isNaN(postTime) ? (Date.now() - postTime) / (1000 * 60 * 60) : 999;

      // In automated mode, skip old news (older than MAX_AUTO_PUBLISH_AGE_HOURS)
      if (!options.forceLatest && ageHours > MAX_AUTO_PUBLISH_AGE_HOURS) {
        console.log(`[Watcher] ⏭️ Skipping OLD post #${postId} ("${rawTitle}"): published ${ageHours.toFixed(1)}h ago (older than ${MAX_AUTO_PUBLISH_AGE_HOURS}h threshold).`);
        if (!state.processedIds.includes(postId)) {
          state.processedIds.push(postId);
        }
        continue;
      }

      // Check single-match live result spoiler shield if enabled for site
      const contentHtml = post.content?.rendered || "";
      const plainText = htmlToPlainText(contentHtml);
      if (SKIP_SINGLE_MATCH_ON_SITE && isSingleMatchResultArticle(rawTitle, plainText)) {
        console.log(`[Watcher] 🛡️ Single-Match Spoiler Shield: Skipping individual match outcome #${postId} ("${rawTitle}") on site.`);
        if (!state.processedIds.includes(postId)) {
          state.processedIds.push(postId);
        }
        continue;
      }


      const success = await processPost(post);
      if (success) {
        if (!state.processedIds.includes(postId)) {
          state.processedIds.push(postId);
        }
        saveState(state);
        processedCount++;


        // Pause 3.5 seconds between posts to respect API rate limits
        await new Promise(r => setTimeout(r, 3500));
      }

      if (options.forceLatest && processedCount >= 1) {
        break;
      }
    }

    state.lastChecked = new Date().toISOString();
    saveState(state);

    console.log(`[Watcher] Check completed. New posts published: ${processedCount}`);
  } catch (e) {
    console.error("[Watcher] Error during watcher execution:", e);
  }
}

// Command-line runner
async function cli() {
  const args = process.argv.slice(2);
  const isDaemon = args.includes("--daemon");
  const isForceOne = args.includes("--force-one");
  const urlsArg = args.find(a => a.startsWith("--urls="))?.split("=").slice(1).join("=") ||
                  args.find(a => a.startsWith("--url="))?.split("=").slice(1).join("=") ||
                  args.find(a => a.startsWith("--post-urls="))?.split("=").slice(1).join("=") ||
                  args.find(a => a.startsWith("--post-url="))?.split("=").slice(1).join("=");

  if (urlsArg) {
    const rawList = urlsArg.split(/[,\s]+/).map(u => u.trim()).filter(Boolean);
    console.log(`[Watcher] Processing batch of ${rawList.length} articles immediately...`);
    const state = loadState();
    let successCount = 0;
    for (let i = 0; i < rawList.length; i++) {
      const itemUrl = rawList[i];
      const cleanUrl = itemUrl.replace(/\/+$/, "");
      const slug = cleanUrl.split("/").pop();
      if (!slug) {
        console.warn(`[Watcher] Could not determine slug from URL: ${itemUrl}`);
        continue;
      }

      console.log(`\n[Watcher] [${i + 1}/${rawList.length}] Fetching article with slug: "${slug}"...`);
      try {
        const apiUrl = `https://www.fightful.com/wp-json/wp/v2/posts?slug=${encodeURIComponent(slug)}&_embed=1`;
        const res = await fetch(apiUrl, {
          headers: { "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36" }
        });
        const posts: any = await res.json();
        if (Array.isArray(posts) && posts[0]) {
          // All posts publish immediately at current time
          const publishTime = new Date();
          console.log(`[Watcher] Publish time: ${publishTime.toISOString()} (Immediate)`);
          const ok = await processPost(posts[0], publishTime);
          if (ok) {
            successCount++;
            if (!state.processedIds.includes(posts[0].id)) {
              state.processedIds.push(posts[0].id);
              saveState(state);
            }
          }
        } else {
          console.error(`[Watcher] Post not found for slug: ${slug}`);
        }
      } catch (err: any) {
        console.error(`[Watcher] Error processing "${slug}":`, err.message);
      }

      // 2-second rate limit pause between posts
      await new Promise(r => setTimeout(r, 2000));
    }

    state.lastChecked = new Date().toISOString();
    saveState(state);
    await fetchLatestFightfulPosts(30).catch(() => {});
    console.log(`\n[Watcher] Batch complete! Successfully processed and scheduled ${successCount} articles.`);
  } else if (isDaemon) {
    console.log("[Watcher] Starting daemon mode. Checking every 5 minutes...");
    await runWatcher();
    setInterval(async () => {
      await runWatcher();
    }, 5 * 60 * 1000);
  } else if (isForceOne) {
    console.log("[Watcher] Running test with --force-one...");
    await runWatcher({ forceLatest: true, maxCount: 1 });
  } else {
    await runWatcher();
  }
}

if (require.main === module || process.argv[1]?.endsWith("fightful-watcher.ts")) {
  cli().catch(err => {
    console.error("[Watcher] Fatal error:", err);
    process.exit(1);
  });
}
