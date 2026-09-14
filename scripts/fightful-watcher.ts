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
    .replace(/\bRob\s*Van\s*Dam\b/gi, "روب فان دام")
    .replace(/\bRey\s*Mysterio\b/gi, "ري ميستيريو")
    .replace(arWord("ري\\s+مستريو"), "ري ميستيريو")
    .replace(/\bDominik\s*Mysterio\b/gi, "دومينيك ميستيريو")
    .replace(arWord("دومينيك\\s+مستريو"), "دومينيك ميستيريو")
    .replace(/\bLiv\s*Morgan\b/gi, "ليف مورغان")
    .replace(arWord("ليف\\s+مورجان"), "ليف مورغان")
    .replace(/\bBrian\s*Cage\b/gi, "برايان كيج")
    .replace(/\bTessa\s*Blanchard\b/gi, "تيسا بلانشارد")
    .replace(/\bStephanie\s*Vaquer\b/gi, "ستيفاني فاكير")
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
    .replace(/\bHangman\s*Adam\s*Page\b/gi, "هانغمان بيج")
    .replace(/\bHangman\s*Page\b/gi, "هانغمان بيج")
    .replace(/\bSwerve\s*Strickland\b/gi, "سويرف ستريكلاند")
    .replace(/\bDarby\s*Allin\b/gi, "داربي ألين")
    .replace(arWord("داربي\\s+الين"), "داربي ألين")
    .replace(/\bMatt\s*Riddle\b/gi, "مات ريدل")
    .replace(/\bOmos\b/gi, "اوموس")
    .replace(/\bDanhausen\b/gi, "دانهاوسن")
    .replace(/\bBlake\s*Monroe\b/gi, "بليك مونرو")
    .replace(/\bGiulia\b/gi, "جوليا")
    .replace(/\bTrick\s*Williams\b/gi, "تريك ويليامز")
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
    .replace(/\bAdam\s*Cole\b/gi, "آدم كول")
    .replace(/\bClaudio\s*Castagnoli\b/gi, "كلاوديو كاستاليولي")
    .replace(/\bMalakai\s*Black\b/gi, "مالاكاي بلاك")
    .replace(/\bBuddy\s*Matthews\b/gi, "بادي ماثيوز")
    .replace(/\bBrody\s*King\b/gi, "برودي كينغ")
    .replace(/\bBandido\b/gi, "بانديدو")
    .replace(/\bRicochet\b/gi, "ريكوشيه")
    .replace(/\bRohit\s*Raju\b/gi, "روهيت راجو")
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

// Second-pass AI Tool: Select and craft the ultimate viral, click-worthy, SEO-optimized title
export async function optimizeTitleForSEOAndCTR(
  draftTitle: string,
  articleSummary: string,
  isResultsPost: boolean,
  arabicDate: string
): Promise<string> {
  let specificTitleRules = "";
  if (isResultsPost) {
    specificTitleRules = `
نوع المقال: **تقرير نتائج وتغطية عرض مصارعة كامل (Full Show Results)**
1. **أولوية اختيار الأحداث (المين إيفنت والنزالات الكبرى أولاً)**:
   - يجب حتماً أن يركز المانشيت على **الحدث الرئيسي (Main Event)** أو النزالات الكبرى والصدمات العنيفة.
2. **قاعدة العروض متعددة الليالي (Multi-Night Events مثل Triplemania أو WrestleMania)**:
   - **احذف التاريخ نهائياً ولا تضعه في العنوان مطلقاً!**
   - ضع رقم الليلة بالعربية: "(الليلة الأولى)" أو "(الليلة الثانية)".
   - الصيغة: "نتائج عرض [اسم العرض] (الليلة الأولى): [وصف مثير ومفصل للحدث الأضخم/الرئيسي].. و[حدث بارز آخر]"
3. **قاعدة العروض العادية (ذات الليلة الواحدة فقط)**:
   - **يجب حتماً تضمين التاريخ بين قوسين**: (${arabicDate}).
   - الصيغة: "نتائج عرض [اسم العرض] (${arabicDate}): [أقوى حدث بالعرض].. و[حدث هام آخر]"
4. **أسماء الاتحادات والعروض بالإنجليزية حصراً**:
   - أسماء الاتحادات تظل بالإنجليزية دائماً كما هي: (WWE, AEW, TNA, ROH, NJPW, MLW, AAA, CMLL, UFC).
   - أسماء العروض تظل بالإنجليزية دائماً: (مثل WWE RAW, WWE SmackDown, WWE NXT, AEW Dynamite, AEW Collision, AEW Rampage, TNA iMPACT, Triplemania).
   - باقي الكلمات (النتائج، المصارعين، الأحداث، الوصف) بالعربية التامة وبدون أي تشكيل.`;
  } else {
    specificTitleRules = `
نوع المقال: **خبر صحفي مفرد / كواليس / تصريح / تتويج بلقب / إصابة (Breaking News & Exclusive Report)**
- **تحذير حاسم وقاطع**: هذا خبر صحفي مفرد وليس تقرير نتائج عرض! **ممنوع بتاتاً منعاً باتاً استخدام كلمة "نتائج عرض" أو وضع تاريخ العرض بين قوسين في العنوان!**
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
    - يجب أن يمتلك كل عنوان **شخصية مستقلة وأسلوباً صحفياً فريداً ومتنوعاً ومميزاً** يناسب سياق الخبر بدقة:
      - أسلوب السرد المباشر بالفعل القوي: "ليف مورغان تكشف عن سيناريو مسيرتها الأقرب إلى قلبها في WWE"
      - أسلوب الاقتباس أو المقارنة المثيرة: "برايان كيج: عروض AEW المدفوعة تتفوق بمراحل وتسحق عروض WWE"
      - أسلوب الدفاع أو كسر الصمت: "براين كيج يكسر صمته ويدافع بقوة عن تيسا بلانشارد في أزمتها الكبرى"
      - أسلوب الحدث والتتويج: "ستيفاني فاكير تُسقط ليف مورغان وتتوج بلقب العالم للسيدات في تشيلي"
      - أسلوب الإصابة والكواليس: "بلايك مونرو تكشف تفاصيل إصابتها المروعة بعد ضربة ركبة جوليا"
      - أسلوب التكريم والوفاء: "نجوم AEW يقدمون تحية مؤثرة للراحل آندي ويليامز 'ذا بوتشر'"
  - **قاعدة تصريحات وردود أفعال المصارعين وإعادة الصياغة الذكية (Smart Rewriting vs Literal Translation - حاسمة جداً)**:
    - إذا كان الخبر الأصلي أو العنوان الإنجليزي يحتوي على تصريح لمصارع أو رد فعل على السوشيال ميديا (مثل: 'Wrestler: Quote' أو 'Wrestler Reacts To...'):
      - **ممنوع منعاً باتاً تغيير موضوع أو زاوية الخبر** أو تحويله إلى تقرير عن فوز بنزال أو خسارة لقب وكأنه حدث للتو!
      - **ممنوع الترجمة الحرفية الركيكة** للألفاظ الإنجليزية (مثل ترجمة 'Ride or dies rejoice' حرفياً بـ 'يا رفاقي الأوفياء ابتهجوا').
      - **المطلوب**: استيعاب جوهر الفكرة والزاوية الأساسية، ثم إعادة صياغتها بأسلوب صحفي عربي رياضي أصيل وجذاب ورشيق:
        - مثال: إذا كان العنوان الإنجليزي:
          "Sami Zayn: 'Ride Or Dies Rejoice, Justice At Last! Two Time WWE Champion!'"
        - ❌ ترجمة حرفية ممنوعة: "سامي زين: يا رفاقي الأوفياء ابتهجوا، العدالة تحققت أخيراً!"
        - ❌ تغيير زاوية الخبر الممنوع: "سامي زين ينتزع لقب WWE من سي ام بانك بعرض SmackDown"
        - ✅ **الصياغة الصحفية الذكية المعتمدة**: "سامي زين يحتفل مع جماهيره الوفية باستعادة لقب WWE: 'العدالة تحققت أخيراً!'"
  - **قاعدة أسماء المصارعين الصارمة (بالعربية دائماً وحصراً وممنوع نهائياً بالإنجليزية)**:
    - **ممنوع منعاً باتاً كتابة اسم أي مصارع أو نجم باللغة الإنجليزية في العنوان مطلقاً!**
    - الوحيد المسموح به بالإنجليزية فقط هو اسم الاتحاد (WWE, AEW, TNA) أو اسم العرض (WWE RAW, WWE SmackDown).
    - جميع أسماء المصارعين والنجوم تُكتب بالعربية حصراً، بما في ذلك الأسماء المختصرة أو التي تبدأ بحرف مفرد:
      - **AJ Lee** تُكتب بالعربية دائماً وبدقة: **ايه جيه لي** (ممنوع منعاً باتاً كتابة: "اي لي" أو "إي لي" أو "إي جاي لي")
      - **AJ Styles** يُكتب بالعربية: **ايه جيه ستايلز** (ممنوع نهائياً: "اي ستايلز" أو "اي جي ستايلز")
      - **CJ Perry** تُكتب بالعربية: **سي جيه بيري**
      - **Orange Cassidy** يُكتب: **أورانج كاسيدي**
      - **Dean Malenko** يُكتب: **دين مالينكو**
      - **Women's Division** يُترجم حصراً: **قسم السيدات** (ممنوع منعاً باتاً كتابة: "قسم النساء")
      - R-Truth يُكتب بالعربية دائماً: **ار تروث** (ممنوع نهائياً R-Truth)
      - CM Punk يُكتب بالعربية: **سي ام بانك**
      - LA Knight يُكتب بالعربية: **ال ايه نايت**
      - MJF يُكتب بالعربية: **ام جيه اف**
      - MVP يُكتب بالعربية: **ام في بي**
      - أندرادي أو أندرادي إل إيدولو (Andrade / Andrade El Idolo - **ممنوع منعاً باتاً كتابة "انقرادي" أو "أنقرادي"**)
      - روهيت راجو (Rohit Raju)
      - ستيفن بوردن (Steven Borden)، غاريت بوردن (Garrett Borden)، ستينغ (Sting)
      - سيث رولينز (Seth Rollins - ممنوع منعاً باتاً كتابة ستيف رولينز)، سولو سيكوا (Solo Sikoa)، كودي رودز، رومان رينز، جون سينا، داميان بريست، درو ماكنتاير، ليف مورغان، ستيفاني فاكير، دومينيك ميستيريو، ري ميستيريو، اوموس، برايان كيج... إلخ.
  - **قاعدة إلزامية ذكر اسم الاتحاد قبل اسم أي عرض مباشرة (Mandatory Promotion Prefix)**:
    - **ممنوع نهائياً كتابة اسم أي عرض بدون ذكر اسم الاتحاد قبله مباشرة** ليعرف القارئ تبعية العرض فوراً.
    - اكتب دائماً: "عرض MLP Northern Rising" (ممنوع نهائياً: "عرض Northern Rising" فقط بدون MLP)، "عرض WWE SmackDown"، "عرض AEW Collision"، "عرض TNA iMPACT"، "عرض AAA Triplemanía"، "عرض MLW Battle Riot"، "عرض CMLL Viernes Espectacular".
  - **قاعدة اللغة العربية المبسطة والحديثة (حظر الألفاظ التراثية وصيغ التثنية تماماً)**:
    - صِغ العنوان بلغة عربية صحفية سهلة وسلسة ومبسطة جداً تناسب جمهور الشباب ومحبي الرياضة.
    - **ممنوع بتاتاً منعاً باتاً استخدام صيغ التثنية الغريبة أو الألفاظ المعقدة** (مثل: ❌ "نجلا الأسطورة", ❌ "نجلا", ❌ "ابنا الأسطورة", ❌ "ابنا ستينغ", ❌ "ابنا", ❌ "ابني", ❌ "خضم", ❌ "غمار", ❌ "أتون").
    - **استخدم دائماً صيغة الجمع البسيطة الطبيعية والواضحة**: اكتب حصراً **"أبناء الأسطورة ستينغ"** أو **"أبناء ستينغ"**، واستخدم "خلال"، "وسط".
  - **قاعدة أسماء الفرق والعصابات بالعربية حصراً (ممنوع نهائياً بالإنجليزية)**:
    - **ممنوع بتاتاً كتابة اسم أي فريق أو عصابة أو تحالف بالإنجليزية** (مثل: ❌ The Wagner Brothers, ❌ War Raiders, ❌ The New Day, ❌ The Bloodline, ❌ The Judgment Day).
    - اكتب أسماء الفرق بالعربية دائماً وبدقة: (فريق الإخوة فاغنر، فريق وار رايدرز، فريق ذا بلودلاين، فريق ذا جادجمنت داي، فريق ذا نيو داي، فريق بيروس ديل مال، فريق غريزلد يونغ فيترانز).
  - **قاعدة أسماء الألقاب والبطولات بالعربية الخالصة ودون تكرار اسم الاتحاد (Championship Titles)**:
    - **ممنوع نهائياً كتابة أسماء الأحزمة بالإنجليزية** (مثل ❌ AAA World Tag Team, ❌ WWE Undisputed Championship).
    - **ممنوع تكرار اسم الاتحاد داخل اسم البطولة**؛ اكتب اللقب بالعربية مباشرة دون وضع اسم الاتحاد أمامه (اكتب: **"بطولة العالم للزوجي"** وليس "بطولة AAA للزوجي"، لأن اسم الاتحاد مذكور بالفعل مع اسم العرض مثل "في عرض AAA Triplemanía 34").
    - أمثلة للألقاب بالعربية: "بطولة العالم للزوجي", "بطولة الزوجي", "بطولة العالم للوزن الثقيل", "بطولة القارات", "بطولة العالم للسيدات", "بطولة الولايات المتحدة", "بطولة التلفزيون".
  - **القاعدة الذهبية لما يُكتب بالإنجليزية في كامل الموقع**:
    - **الشيء الوحيد المسموح بكتابته بالإنجليزية هو اسم الاتحاد** (WWE, AEW, TNA, AAA, CMLL, NJPW, MLW, UFC) **واسم العرض مسبوقاً باسم الاتحاد** (مثل: عرض AAA Triplemanía 34, عرض WWE SmackDown).
    - **كل شيء آخر (المصارعين، الفرق، الألقاب، الحركات، التفاصيل) يُترجم ويُكتب بالعربية حصراً!**
  - **ممنوع بتاتاً استخدام التشكيل نهائياً في العنوان** (بدون فتحة أو ضمة أو كسرة أو تنوين أو سكون أو شدة).`;
  }

  const titleOptimizerPrompt = `أنت أعظم رئيس تحرير رقمي وعبقري صياغة عناوين الصحافة الرياضية والمصارعة الحرة العالمية (Elite Sports Headlining Director & Viral CTR Master) لموقع "عرب راسلنج".

المهمة: ابتكار 6 عناوين صحفية خارقة الجاذبية وغير مسبوقة للمقال، مأخوذة 100% من صلب الخبر دون أي تزييف، ثم إجراء منافسة تقييمية حاسمة (Tournament Evaluation) لاختيار وصقل "العنوان البطل الخارق" (Champion Title) الذي يستحيل على القارئ تجاوزه!

القواعد الصارمة الملزمة لجميع العناوين:
${specificTitleRules}

5. **طول العنوان وسيو جوجل ومصطلحات العروض**:
   - الطول المثالي: بين 55 و 80 حرفاً لضمان الظهور الكامل الجذاب في Google Discover ومواقع التواصل.
   - **ممنوع بتاتاً استخدام كلمتي "حلقة" أو "مهرجان" نهائياً**؛ استخدم دائماً كلمة **"عرض"** (أو "عروض").
   - **إلزامية ذكر اسم الاتحاد قبل اسم أي عرض مباشرة** (مثل: عرض WWE SmackDown، عرض AEW Dynamite، عرض MLP Northern Rising).
   - **ممنوع بتاتاً استخدام أي علامات تشكيل نهائياً** في العنوان (بدون فتحة أو ضمة أو كسرة أو تنوين أو شدة).
   - **القاعدة الذهبية لما يكتب بالإنجليزية**: الشيء الوحيد المسموح بكتابته بالإنجليزية هو اسم الاتحاد واسم العرض مسبوقاً باسم الاتحاد. كل شيء آخر (المصارعين، الفرق، الألقاب) يترجم ويكتب بالعربية حصراً وبدون أي استثناء!

 المطلوب بدقة:
قم بابتكار 6 عناوين متنوعة تمثل 6 زوايا صحفية مختلفة تماماً:
1. **الزاوية 1 (الصدمة والحدث الأقوى - Direct Shock & Impact)**: تركز على اللحظة الأكثر إثارة ومفاجأة في صلب الخبر بأسلوب حاسم ومباشر.
2. **الزاوية 2 (التصريح الحارق والاقتباس المثير - Fiery Quote & Provocation)**: تصريح جريء أو اقتباس قوي للمصارع بين علامتي اقتباس ("...") يقلب الموازين.
3. **الزاوية 3 (كشف الأسرار والكواليس الخفية - Backstage Revelation & Intrigue)**: تركز على ما دار خلف الستار، والسر غير المعلن عن السيناريو أو العقد أو الإصابة.
4. **الزاوية 4 (الصراع والتهديد المرتقب - Conflict & High Stakes)**: تسلط الضوء على الخصومة المشتعلة، والتحدي الناري، وتبعات ما سيحدث في العروض القادمة.
5. **الزاوية 5 (المفارقة والغموض المحفز للفضول - Curiosity Gap & The Unexpected)**: التقاط مفارقة غريبة أو زاوية مثيرة للتساؤل والدهشة تدفع القارئ فوراً للنقر لمعرفة الحقيقة.
6. **الزاوية 6 (الصحافة الرياضية الراقية والرشيقة - Elite Sports Journalism)**: صياغة رصينة، بليغة، ومشدودة كعناوين كبريات الصحف والشبكات الرياضية العالمية.

ثم قم بمقارنتها واختيار العنوان الأقوى والأكثر خطورة وجاذبية ومصداقية وصقله ليكون "العنوان البطل الخارق" (champion_title).

العنوان المقترح حالياً:
${draftTitle}

ملخص ومحتوى المقال الكامل:
${articleSummary.slice(0, 4500)}

تاريخ العرض (يستخدم فقط إذا كان المقال نتائج عرض ليلة واحدة): ${arabicDate}

أخرج النتيجة حصراً بتنسيق JSON:
{
  "candidates": [
    { "angle": "الصدمة والحدث الأقوى", "title": "..." },
    { "angle": "التصريح الحارق", "title": "..." },
    { "angle": "كشف الكواليس والأسرار", "title": "..." },
    { "angle": "الصراع والتهديد المرتقب", "title": "..." },
    { "angle": "المفارقة والغموض", "title": "..." },
    { "angle": "الصحافة الرياضية الراقية", "title": "..." }
  ],
  "champion_title": "العنوان النهائي الفائز الأكثر إثارة واحترافية والتزاماً بالقواعد"
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
          const winner = cleanHeadlineClichés(sanitizeWrestlingTerms(winningRaw.trim()));
          console.log(`[Watcher] 🏆 Champion Headline Selected: "${winner}"`);
          return winner;
        }
      }
    }
  } catch (e) {
    console.warn("[Watcher] Title tournament pass skipped, using draft title:", e);
  }

  return cleanHeadlineClichés(sanitizeWrestlingTerms(draftTitle));
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
function isShowResultsArticle(originalTitle: string, plainText: string = ""): boolean {
  const title = (originalTitle || "").trim();
  const text = (plainText || "").trim();

  // 1. Explicit negative checks: Non-show results (financial, medical tests, surveys, or news updates ABOUT results)
  if (/\b(?:financial|quarterly|earnings|fiscal|q[1-4]|medical|drug|wellness|investigation|poll|survey|election|test|exam|blood)\s+.*?\bresults\b/i.test(title)) {
    return false;
  }
  if (/\bresults\s+(?:update|clarification|details|reaction|comment|delayed|postponed)\b/i.test(title) && !/\b(?:live coverage|quick results|full results)\b/i.test(title)) {
    return false;
  }
  if (/\b(?:preview|previews|set for|card for|how to watch|lineup|schedule|start time)\b/i.test(title) && !/\b(?:results|spoilers)\b/i.test(title)) {
    return false;
  }

  // 2. Strong Title Signals for Full Show Results / Spoilers
  // Matches "Results", "Spoilers", "Quick Results", "Full Results", "Live Coverage", "Live Recap"
  const hasResultsInTitle = /\b(?:results|spoilers|quick results|full results|live coverage|live recap|post-show recap)\b/i.test(title);

  // 3. Body Signals: Check if content actually describes a full show with multiple matches
  const matchSignals = (text.match(/\b(?:def\.|defeated|defeats|vs\.?|championship|battle royal|eliminator match|main event|pinfall|submission)\b/gi) || []).length;
  const hasMultipleMatches = matchSignals >= 3;
  const hasFullResultsIntro = /\b(?:full results|live coverage|detailed results|results for the|live recap)\b/i.test(text);

  // If title explicitly announces results/spoilers -> 100% SHOW RESULTS!
  if (hasResultsInTitle) {
    return true;
  }

  // If title doesn't have "Results", but the body explicitly contains a full show results intro AND multiple match results:
  if (hasFullResultsIntro && hasMultipleMatches && !/\b(?:wins|defeated|injur|return|sign|update|report|rumor|excited|comments|reacts)\b/i.test(title)) {
    return true;
  }

  return false;
}

// Resilient JSON parser that handles code blocks, malformed quotes, and regex fallback
function safeParseJson<T>(rawText: string): T | null {
  if (!rawText) return null;
  let text = rawText.trim();

  if (text.startsWith("```")) {
    text = text.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "").trim();
  }

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
    const titleMatch = text.match(/"title"\s*:\s*"([\s\S]+?)(?<!\\)",?\s*\n/i) || text.match(/"title"\s*:\s*"([^"]+)"/i);
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

3. **العنوان لنتائج العروض**:
   - إذا كان العرض ليلة واحدة: "نتائج عرض [اسم العرض مسبوقاً باسم الاتحاد] (${arabicDate}): [أقوى حدث بالعرض].. و[حدث هام آخر]"
   - إذا كان مقسماً لليالٍ (Night 1 / Night 2): احذف التاريخ واكتب: "نتائج عرض [اسم العرض مسبوقاً باسم الاتحاد] (الليلة الأولى): [وصف مفصل للحدث الرئيسي].. و[حدث بارز]"
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
2. **العنوان (صحفي رياضي راقٍ، جذاب، متجدد، وممنوع منعاً باتاً الكليشيهات المبتذلة)**:
   - **حظر تام للبادئات المكررة**: ممنوع منعاً باتاً بدء العناوين بعبارات مكررة مثل:
     - ❌ "تصريحات نارية.."
     - ❌ "صدمة مدوية.."
     - ❌ "ليلة نارية.."
     - ❌ "اعترافات صادمة.."
     - ❌ "مفاجأة كبرى.."
   - كل عنوان يجب أن يبدأ بأسلوب مختلف ومتنوع يبرز جوهر الخبر مباشرة (مثل: اسم المصارع وفعل الحدث، أو تصريح مثير بين علامتي اقتباس، أو حدث رياضي مفاجئ).
   - أمثلة صحيحة ممتازة:
     - "ليف مورغان تكشف عن سيناريو مسيرتها الأقرب إلى قلبها في WWE"
     - "برايان كيج: عروض AEW المدفوعة تتفوق بمراحل وتسحق مهرجانات WWE"
     - "براين كيج يكسر صمته ويدافع بقوة عن تيسا بلانشارد في أزمتها الكبرى"
     - "ستيفاني فاكير تُسقط ليف مورغان وتتوج بلقب العالم للسيدات في تشيلي"
   - **قاعدة تصريحات وردود أفعال المصارعين وإعادة الصياغة الصحفية الذكية (Smart Rewriting vs Literal Translation - حاسمة جداً)**:
     - إذا كان الخبر الأصلي عبارة عن رد فعل، تغريدة، منشور إنستغرام أو تويتر، أو تصريح لمصارع (مثل: 'Wrestler: Quote' أو 'Wrestler Reacts To...'):
       - **ممنوع منعاً باتاً تغيير زاوية أو موضوع الخبر** أو تحويله إلى تقرير عن فوز بنزال أو خسارة لقب وكأنه حدث للتو مع تجاهل التصريح!
       - **ممنوع الترجمة الحرفية الركيكة** للألفاظ الإنجليزية (مثل ترجمة "Ride or dies rejoice" حرفياً بـ "يا رفاقي الأوفياء ابتهجوا").
       - **المطلوب**: استيعاب جوهر الفكرة والزاوية الأساسية، ثم إعادة صياغتها بأسلوب صحفي عربي رياضي أصيل وجذاب ورشيق:
         - مثال: Sami Zayn: ‘Ride Or Dies Rejoice, Justice At Last! Two Time WWE Champion!’
           -> ❌ تجنب الترجمة الحرفية: سامي زين: "يا رفاقي الأوفياء ابتهجوا..."
           -> ✅ **العنوان الصحفي المعتمد**: سامي زين يحتفل مع جماهيره الوفية باستعادة لقب WWE: "العدالة تحققت أخيراً!"
     - في المتن: اكتب بلغة عربية صحفية بليغة وسلسة، تركز على رسالة المصارع وفرحته وتواصله مع جماهيره، مع جعل تفاصيل النزال السابق خلفية سياقية قصيرة فقط.
3. **متن المقال (سريع، شيق، مركز، وبدون حشو أو تطويل ممل)**:
   - **قاعدة الإيجاز المشوق (Punchy & Concise)**: الزائر يمل بسرعة من النصوص الطويلة؛ اجعل الخبر مختصراً ومكثفاً ومثيراً في **فقرتين إلى 3 فقرات قصيرة فقط** (ما بين 120 إلى 180 كلمة):
     - **الفقرة الأولى (الحدث الأهم والمفاجأة)**: ادخل في صلب الحدث مباشرة بصدمة وإثارة وبدون مقدمات بطيئة.
     - **الفقرة الثانية (اللقطة الحاسمة والكواليس)**: كيف وقع الحدث، واللقطة المفصلية أو تصريحات الكواليس الساخنة.
     - **الفقرة الثالثة (ماذا بعد؟)**: سطرين ختاميين عن الأثر المرتقب في العروض القادمة والسيناريوهات المشتعلة.
   - **ممنوع بتاتاً**: الحشو الكلامي الزائد، أو تكرار العبارات، أو التطويل الممل؛ ركز على الزبدة والمفيد المثير فقط ليكون المقال سريع القراءة وممتعاً.
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
    parsed.title = await optimizeTitleForSEOAndCTR(parsed.title, parsed.body_markdown, isResultsPost, arabicDate);
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
async function processPost(post: any, customDate?: Date | string): Promise<boolean> {
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

  // Clear publish-state for this article so social platforms re-publish the updated content
  try {
    const stateFile = path.join(process.cwd(), "_data", "publish-state.json");
    if (fs.existsSync(stateFile)) {
      const pState = JSON.parse(fs.readFileSync(stateFile, "utf-8"));
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
