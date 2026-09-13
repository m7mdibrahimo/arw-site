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
  const igRegex = /https?:\/\/(?:www\.)?instagram\.com\/(?:p|reel|tv)\/([a-zA-Z0-9_-]+)/gi;
  let igMatch: RegExpExecArray | null;
  while ((igMatch = igRegex.exec(html)) !== null) {
    const igId = igMatch[1];
    const cleanUrl = `https://www.instagram.com/p/${igId}/`;
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
function sanitizeWrestlingTerms(text: string): string {
  if (!text) return text;
  const arBoundL = "(?<![\\u0600-\\u06FF])";
  const arBoundR = "(?![\\u0600-\\u06FF])";

  const cleaned = text
    // 1. Enforce English names for Promotions (no Arabic transliterations)
    .replace(new RegExp(arBoundL + "(?:اتحاد\\s+)?(?:دبليو\\s*دبليو\\s*[إا]ي)" + arBoundR, "gi"), "WWE")
    .replace(new RegExp(arBoundL + "(?:اتحاد\\s+)?(?:[إا]يه\\s*[إا]ي\\s*دبليو)" + arBoundR, "gi"), "AEW")
    .replace(new RegExp(arBoundL + "(?:اتحاد\\s+)?(?:تي\\s*[إا]ن\\s*[إا]يه)" + arBoundR, "gi"), "TNA")
    .replace(new RegExp(arBoundL + "(?:اتحاد\\s+)?(?:[آا]ر\\s*[أا]وه\\s*[إا]تش)" + arBoundR, "gi"), "ROH")
    .replace(new RegExp(arBoundL + "(?:اتحاد\\s+)?(?:[إا]م\\s*[إا]ل\\s*دبليو)" + arBoundR, "gi"), "MLW")
    .replace(new RegExp(arBoundL + "(?:اتحاد\\s+)?(?:نيو\\s*جابان(?:\\s*برو\\s*ريسل(?:ينغ|نج))?)" + arBoundR, "gi"), "NJPW")

    // 2. Enforce English names for Shows (no Arabic transliterations)
    .replace(new RegExp(arBoundL + "(?:عرض\\s+)?(?:الرو|الراو)" + arBoundR, "gi"), "عرض WWE RAW")
    .replace(new RegExp(arBoundL + "(?:عرض\\s+)?(?:سماك\\s*داون|سماكداون)" + arBoundR, "gi"), "عرض WWE SmackDown")
    .replace(new RegExp(arBoundL + "(?:عرض\\s+)?(?:[إا]ن\\s*[إا]كس\\s*تي)" + arBoundR, "gi"), "عرض WWE NXT")
    .replace(new RegExp(arBoundL + "(?:عرض\\s+)?(?:ديناميت|داينمايت)" + arBoundR, "gi"), "عرض AEW Dynamite")
    .replace(new RegExp(arBoundL + "(?:عرض\\s+)?(?:كوليجن|كوليزن|كوليجين)" + arBoundR, "gi"), "عرض AEW Collision")
    .replace(new RegExp(arBoundL + "(?:عرض\\s+)?(?:رامبيج|رامباج)" + arBoundR, "gi"), "عرض AEW Rampage")
    .replace(new RegExp(arBoundL + "(?:عرض\\s+)?(?:[إا]مباكت)" + arBoundR, "gi"), "عرض TNA iMPACT")

    // Fix double occurrences created by replacement (e.g. "عرض عرض" or "WWE WWE")
    .replace(/(?:عرض\s+)+عرض\s+/g, "عرض ")
    .replace(/عرض\s+عرض/g, "عرض")
    .replace(/WWE\s+WWE/g, "WWE")
    .replace(/AEW\s+AEW/g, "AEW")
    .replace(/TNA\s+TNA/g, "TNA")

    // 3. Strict show terminology (replace 'حلقة' with 'عرض')
    .replace(/\bحلقة\s+(NXT|RAW|SmackDown|Dynamite|Collision|IMPACT|WWE|AEW|TNA|ROH|عرض)\b/gi, "عرض $1")
    .replace(/حلقات\s+عروض/g, "عروض")
    .replace(/حلقة\s+عرض/g, "عرض")
    .replace(new RegExp(arBoundL + "(?:في|خلال|من|بـ?|عبر)\\s+حلقة\\s+([^\\s]+)" + arBoundR, "gi"), "في عرض $1")
    .replace(new RegExp(arBoundL + "حلقة\\s+(اليوم|الليلة|أمس|الأسبوع)" + arBoundR, "g"), "عرض $1")
    .replace(new RegExp(arBoundL + "آخر\\s+حلقة" + arBoundR, "g"), "آخر عرض")
    .replace(new RegExp(arBoundL + "أحدث\\s+حلقة" + arBoundR, "g"), "أحدث عرض")
    .replace(new RegExp(arBoundL + "الحلقة\\s+(القادمة|الماضية|الأخيرة|الافتتاحية|الخاصة)" + arBoundR, "g"), "العرض $1")
    .replace(new RegExp(arBoundL + "حلقات\\s+المصارعة" + arBoundR, "g"), "عروض المصارعة")
    .replace(new RegExp(arBoundL + "حلقة\\s+(جديدة|تلفزيونية|استثنائية)" + arBoundR, "g"), "عرض $1")
    .replace(/\bحلقة\s+/g, "عرض ")

    // 4. Total Scrub of Fightful & foreign journalist branding to keep all news 100% exclusive to Arab Wrestling
    .replace(/Sean\s*Ross\s*Sapp/gi, "مصادر صحفية مطلعة")
    .replace(/Sean\s*Ross/gi, "مصادر صحفية")
    .replace(/شون\s*روس\s*ساب/gi, "مصادر صحفية مطلعة")
    .replace(/شون\s*روس/gi, "مصادر صحفية")
    .replace(/Fightful\s*Select/gi, "مصادر خاصة")
    .replace(/موقع\s*\*?Fightful\*?/gi, "مصادر صحفية خاصة")
    .replace(/شبكة\s*\*?Fightful\*?/gi, "مصادر خاصة")
    .replace(/منصة\s*\*?Fightful\*?/gi, "مصادر خاصة")
    .replace(/تقرير\s*\*?Fightful\*?/gi, "تقارير خاصة")
    .replace(/فايت\s*فول/gi, "مصادرنا")
    .replace(/فايتفول/gi, "مصادرنا")
    .replace(/\*?Fightful\*?/gi, "مصادرنا");

  // Always strip all tashkeel / diacritics completely across all articles, titles, and tags
  return removeTashkeel(cleaned);
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
async function optimizeTitleForSEOAndCTR(
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
  - تُترجم وتُكتب باللغة العربية الصحفية الرياضية الحصرية والمثيرة بدون كليشيهات:
    - أمثلة لعناوين الأخبار الصحيحة:
      - "في ليلة تاريخية.. ستيفاني فاكير تُسقط ليف مورغان وتتوج بلقب العالم للسيدات في تشيلي"
      - "صدمة مدوية في WWE RAW.. ستيفاني فاكير تنتزع لقب العالم للسيدات أمام جماهير بلادها"
      - "بضربة قاضية في الجولة الثانية.. رايان غارسيا يسحق كونور بين في نزال تاريخي"
      - "رسمياً.. الإعلان عن موعد ومكان إقامة مواجهة الدم والدموع في قمة AEW القادمة"
      - "جراحة عاجلة في الفم.. بلايك مونرو تكشف تفاصيل إصابتها المروعة بعد ضربة ركبة جوليا"
      - "وفاءً لذكراه.. نجوم AEW يقدمون تحية مؤثرة للراحل آندي ويليامز 'ذا بوتشر'"
  - أسماء المصارعين بالعربية دائماً (كودي رودز، رومان رينز، جون سينا، ويل أوسبري، ستيفاني فاكير، دانيال غارسيا).
  - الألقاب والأحزمة بالعربية (لقب العالم، بطولة السيدات، بطولة القارات).
  - **ممنوع بتاتاً استخدام التشكيل نهائياً في العنوان** (بدون فتحة أو ضمة أو كسرة أو تنوين أو سكون أو شدة).`;
  }

  const titleOptimizerPrompt = `أنت رئيس تحرير رقمي وخبير في كتابة العناوين الصحفية الرياضية وعناوين السيو (SEO & CTR Specialist) لموقع "عرب راسلنج".

المهمة: ابتكار واختيار أفضل عنوان على الإطلاق للمقال التالي.

المعايير الصارمة:
${specificTitleRules}

5. **طول العنوان وسيو جوجل**:
   - لا يتجاوز 75-80 حرفاً لضمان عدم اقتطاعه في نتائج بحث جوجل أو Google Discover.
   - ممنوع بتاتاً كلمة "حلقة"؛ استبدلها دائماً بكلمة "عرض".
   - **ممنوع بتاتاً استخدام التشكيل نهائياً في العنوان** (بدون فتحة أو ضمة أو كسرة أو تنوين أو شدة). اكتب العنوان نظيفاً وسهلاً.

العنوان المقترح حالياً:
${draftTitle}

ملخص ومحتوى المقال الكامل:
${articleSummary.slice(0, 4500)}

تاريخ العرض (يستخدم فقط إذا كان المقال نتائج عرض ليلة واحدة): ${arabicDate}

أجب بنص JSON فقط بالشكل التالي:
{
  "best_title": "العنوان النهائي الأقوى والأمثل للسيو والمتوافق مع القواعد السابقة"
}`;

  try {
    const resText = await queryGemini(titleOptimizerPrompt, true);
    if (resText) {
      const parsed = JSON.parse(resText);
      if (parsed.best_title && parsed.best_title.trim().length > 10) {
        return sanitizeWrestlingTerms(parsed.best_title.trim());
      }
    }
  } catch (e) {
    console.warn("[Watcher] Title optimization pass skipped, using draft title:", e);
  }

  return sanitizeWrestlingTerms(draftTitle);
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
  postDate?: string
): Promise<RewrittenArticle | null> {
  // 100% Bulletproof detection: Differentiates Full Show Results from Single News articles
  const isResultsPost = isShowResultsArticle(originalTitle, plainText);
  console.log(`[Watcher] Article classification: "${originalTitle}" -> [${isResultsPost ? "SHOW_RESULTS (نتائج عرض)" : "NEWS_ARTICLE (خبر صحفي)"}]`);

  const arabicDate = getArabicDateFormatted(postDate);

  const prompt = isResultsPost
    ? `أنت كبير محرري موقع "عرب راسلنج" (arab-wrestling.com)، متخصص في الصحافة الرياضية وتغطية المصارعة الحرة العالمية وفنون القتال.

المهمة: تحويل تقرير العرض الإنجليزي إلى **تقرير نتائج عرض كامل ومفصل** باللغة العربية بأعلى درجات الاحترافية الصحفية.

القواعد التحريرية والتنسيقية الإلزامية:
1. **قاعدة أسماء الاتحادات والعروض بالإنجليزية حصراً**:
   - أسماء الاتحادات تظل بالإنجليزية دائماً كما هي دون تعريب: (WWE, AEW, TNA, ROH, NJPW, MLW, AAA, CMLL, GCW, UFC).
   - أسماء العروض التابعة للاتحادات تظل بالإنجليزية دائماً كما هي: (مثل WWE RAW, WWE SmackDown, WWE NXT, AEW Dynamite, AEW Collision, AEW Rampage, TNA iMPACT, ROH TV, Triplemania).
   - ممنوع نهائياً كتابة: "دبليو دبليو إي" أو "إيه إي دبليو" أو "عرض الرو" أو "سماكداون" أو "ديناميت"؛ اكتب دائماً: WWE, AEW, WWE RAW, WWE SmackDown, AEW Dynamite.
   - كل شيء آخر يُترجم ويُكتب بالعربية (أسماء المصارعين، أنواع المباريات، شروط النزالات، الأحزمة، التفاصيل).
   - **ممنوع بتاتاً استخدام التشكيل نهائياً في الكلمات (بدون فتحة أو ضمة أو كسرة أو تنوين أو سكون أو شدة)**. اكتب النص واضحاً سلساً بدون أي علامات تشكيل.
2. **التنسيق المنظم والفصل بين السطور**:
   - في نتائج المباريات، اجعل بين كل سطر وسطر سطرين فارغين (Double Line Break).
   - الهيكل الدقيق لكل مباراة:
**المواجهة الأولى (نوع النزال بالعربي): [المصارع 1] ضد [المصارع 2]**

**تفاصيل النزال:** [شرح سريع ومثير في سطر أو سطرين لأبرز لحظات النزال وكيف انتهى].

🏆 **الفائز:** [اسم الفائز بالعربي] (مع إضافة "واحتفظ باللقب" إذا كان نزال بطولة).

3. **العنوان لنتائج العروض**:
   - إذا كان العرض ليلة واحدة: "نتائج عرض [اسم العرض] (${arabicDate}): [أقوى حدث بالعرض].. و[حدث هام آخر]"
   - إذا كان مقسماً لليالٍ (Night 1 / Night 2): احذف التاريخ واكتب: "نتائج عرض [اسم العرض] (الليلة الأولى): [وصف مفصل للحدث الرئيسي].. و[حدث بارز]"
4. **حظر كلمة "حلقة" نهائياً**: استبدلها دائماً بكلمة "عرض".
5. **الاتحاد (federation)**: حدد الاتحاد حصراً من: ["WWE", "AEW", "TNA", "ROH", "MMA", "INDIE"].
6. **حظر ذكر أي مصادر خارجية نهائياً**: صِغْ كل شيء كأنه حصري لموقع عرب راسلنج، ممنوع تماماً ذكر Fightful أو محرريها.
7. **الوسوم (tags)**: بين 5 إلى 7 وسوم دقيقة (تتضمن اسم الاتحاد بالإنجليزية مثل WWE أو AEW، واسم العرض بالإنجليزية مثل WWE RAW، وباقي الوسوم وأسماء المصارعين بالعربية).

التقرير الأصلي:
العنوان: ${originalTitle}
التصنيفات: ${categories.join(", ")}
تاريخ الحدث: ${arabicDate}
النص:
${plainText.slice(0, 4000)}

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
2. **العنوان**: مانشيت إخباري صحفي رياضي قوي ومثير وجذاب وحصري (مثل مانشيتات كبرى الصحف الرياضية):
   - أمثلة: "في ليلة تاريخية بتشيلي.. ستيفاني فاكير تُسقط ليف مورغان وتتوج بلقب العالم للسيدات", "صدمة مدوية في WWE RAW.. ستيفاني فاكير تنتزع لقب العالم للسيدات أمام جماهير بلادها".
3. **متن المقال (سريع، شيق، مركز، وبدون حشو أو تطويل ممل)**:
   - **قاعدة الإيجاز المشوق (Punchy & Concise)**: الزائر يمل بسرعة من النصوص الطويلة؛ اجعل الخبر مختصراً ومكثفاً ومثيراً في **فقرتين إلى 3 فقرات قصيرة فقط** (ما بين 120 إلى 180 كلمة):
     - **الفقرة الأولى (الحدث الأهم والمفاجأة)**: ادخل في صلب الحدث مباشرة بصدمة وإثارة وبدون مقدمات بطيئة.
     - **الفقرة الثانية (اللقطة الحاسمة والكواليس)**: كيف وقع الحدث، واللقطة المفصلية أو تصريحات الكواليس الساخنة.
     - **الفقرة الثالثة (ماذا بعد؟)**: سطرين ختاميين عن الأثر المرتقب في العروض القادمة والسيناريوهات المشتعلة.
   - **ممنوع بتاتاً**: الحشو الكلامي الزائد، أو تكرار العبارات، أو التطويل الممل؛ ركز على الزبدة والمفيد المثير فقط ليكون المقال سريع القراءة وممتعاً.
4. **قاعدة أسماء الاتحادات والعروض بالإنجليزية حصراً (Strict Rule)**:
   - **أسماء الاتحادات تظل بالإنجليزية دائماً كما هي دون أي تعريب أو ترجمة**:
     (WWE, AEW, TNA, ROH, NJPW, MLW, AAA, CMLL, GCW, UFC).
     - ممنوع نهائياً: "دبليو دبليو إي", "إيه إي دبليو", "تي إن إيه", "نيو جابان".
     - اكتب دائماً: WWE, AEW, TNA, NJPW, MLW.
   - **أسماء العروض التابعة للاتحادات تظل بالإنجليزية دائماً كما هي**:
     (مثل: WWE RAW, WWE SmackDown, WWE NXT, AEW Dynamite, AEW Collision, AEW Rampage, TNA iMPACT, AEW All In, WrestleMania, Royal Rumble, SummerSlam).
     - ممنوع نهائياً: "الرو", "راو", "سماكداون", "ديناميت", "كوليجن", "إمباكت".
     - اكتب دائماً: WWE RAW, WWE SmackDown, AEW Dynamite, AEW Collision, TNA iMPACT.
   - **كل ما عدا ذلك يُترجم ويُصاغ باللغة العربية الصحفية الاحترافية السلسة**:
     - أسماء المصارعين والمصارعات بالعربية دائماً (كودي رودز، رومان رينز، جون سينا، ويل أوسبري، كيني أوميغا، ستيفاني فاكير، دانيال غارسيا).
     - الألقاب والبطولات بالعربية (لقب العالم، بطولة الزوجي، بطولة القارات، بطولة السيدات).
     - التفاصيل، الكواليس، النزالات، الحوارات، التحليلات بالعربية.
   - **ممنوع بتاتاً استخدام التشكيل نهائياً في الكلمات (بدون فتحة أو ضمة أو كسرة أو تنوين أو سكون أو شدة)**؛ اكتب كل النصوص خالية تماماً من التشكيل لتكون سهلة وسريعة القراءة.
5. **حظر كلمة "حلقة" نهائياً**: استبدلها دائماً بكلمة "عرض".
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

    // Sanitize any instances of 'حلقة' to 'عرض'
    parsed.title = sanitizeWrestlingTerms(parsed.title);
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
    console.log(`[Watcher] Final Optimized Title: "${parsed.title}" (length: ${parsed.title.length} chars)`);

    return parsed;
  } catch (e) {
    console.warn(`[Watcher] JSON parse error:`, e);
    return null;
  }
}

// Generate clean Arabic slug from title
function generateSlug(title: string): string {
  return title
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
      featured_image: p._embedded?.["wp:featuredmedia"]?.[0]?.source_url || ""
    }));
    fs.writeFileSync(feedPath, JSON.stringify(cleanFeed, null, 2), "utf-8");
  } catch (err) {
    console.warn("[Watcher] Warning: could not write watcher-feed.json:", err);
  }

  return posts.slice(0, limit);
}

// Process a single Fightful post
async function processPost(post: any, customDate?: Date | string): Promise<boolean> {
  const postId = post.id;
  const rawTitle = post.title?.rendered?.replace(/&#8217;/g, "'").replace(/&#8216;/g, "'").replace(/&amp;/g, "&") || "News";
  const postUrl = post.link || "";
  const sourceDate = post.date_gmt || post.date;
  const effectiveDate = customDate ? (customDate instanceof Date ? customDate.toISOString() : customDate) : sourceDate;
  const contentHtml = post.content?.rendered || "";

  console.log(`\n--------------------------------------------------`);
  console.log(`[Watcher] Processing post #${postId}: "${rawTitle}"`);
  console.log(`[Watcher] Effective publish date: ${effectiveDate} (Source: ${sourceDate})`);

  // Extract featured image with fallback to content images
  let imageUrl = post._embedded?.["wp:featuredmedia"]?.[0]?.source_url;
  if (!imageUrl) {
    const bodyImgMatch = contentHtml.match(/<img[^>]+src=["']([^"']+)["']/i);
    if (bodyImgMatch && bodyImgMatch[1]) {
      imageUrl = bodyImgMatch[1];
    }
  }

  // Detect YouTube video (from post content, or fetch web page if Watch/video post)
  let ytVideoId = extractYouTubeVideoId(contentHtml) || extractYouTubeVideoId(post.link || "");
  if (!ytVideoId && (/watch:/i.test(rawTitle) || /fusion/i.test(rawTitle) || /highlights/i.test(rawTitle) || /video/i.test(rawTitle)) && post.link) {
    try {
      const pageRes = await fetch(post.link, {
        headers: { "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)" },
        signal: AbortSignal.timeout(6000)
      });
      if (pageRes.ok) {
        const pageHtml = await pageRes.text();
        ytVideoId = extractYouTubeVideoId(pageHtml);
      }
    } catch (e) {}
  }

  // If a YouTube video is detected, extract the highest resolution thumbnail (matching get-youtube-thumbnail.com)
  if (ytVideoId) {
    const ytThumb = await getYouTubeThumbnailUrl(ytVideoId);
    if (ytThumb) {
      if (!imageUrl || /watch:/i.test(rawTitle) || imageUrl.includes("maxresdefault") || imageUrl.includes("default.jpg") || imageUrl.includes("hqdefault")) {
        console.log(`[Watcher] 🎥 Detected YouTube video (${ytVideoId}), using max resolution thumbnail: ${ytThumb}`);
        imageUrl = ytThumb;
      }
    }
  }

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
  const rewritten = await rewriteWithGemini(rawTitle, plainText, terms, sourceDate);
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

  // 4. Create markdown file
  const { prefix, iso } = formatDate(effectiveDate);
  const slug = generateSlug(rewritten.title);
  const fileName = `${prefix}-${slug}.md`;
  const filePath = path.join(NEWS_DIR, fileName);

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

  fs.writeFileSync(filePath, markdownContent, "utf-8");
  console.log(`[Watcher] Successfully created news file: ${filePath}`);

  return true;
}

// Maximum allowed age (in hours) for auto-publishing articles from Fightful.
// Anything older than 3 hours is strictly considered old news and will NEVER be published automatically.
const MAX_AUTO_PUBLISH_AGE_HOURS = 3;

// Main check function
export async function runWatcher(options: { forceLatest?: boolean; maxCount?: number; maxPerRun?: number } = {}) {
  const state = loadState();

  if (state.enabled === false && !options.forceLatest) {
    console.log("[Watcher] ⏸️ Watcher is currently PAUSED by admin in watcher-state.json. Skipping execution.");
    return;
  }

  const batchLimit = options.maxCount || 20;
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


        // Pause 2 seconds between posts to respect API rate limits
        await new Promise(r => setTimeout(r, 2000));
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
