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

const API_KEYS = (process.env.GEMINI_API_KEYS || process.env.GEMINI_API_KEY || "AQ.Ab8RN6KL8UF_W02V7MgbfG4Ne2FHWvzzlEOHHIfhfaBThj_igg")
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

// Extract media embeds (YouTube, Twitter/X, Instagram) from raw HTML
function extractEmbeds(html: string): string[] {
  const embeds: string[] = [];

  // YouTube iframes or watch links
  const ytMatch = html.match(/https?:\/\/(?:www\.)?(?:youtube\.com\/(?:watch\?v=|embed\/)|youtu\.be\/)([a-zA-Z0-9_-]{11})/gi);
  if (ytMatch) {
    const seenIds = new Set<string>();
    for (const link of ytMatch) {
      const idMatch = link.match(/([a-zA-Z0-9_-]{11})$/);
      if (idMatch && !seenIds.has(idMatch[1])) {
        seenIds.add(idMatch[1]);
        embeds.push(
          `<div class="video-container" style="position:relative;padding-bottom:56.25%;height:0;overflow:hidden;margin:24px 0;border-radius:14px;box-shadow:0 8px 24px rgba(0,0,0,0.15);"><iframe src="https://www.youtube-nocookie.com/embed/${idMatch[1]}" style="position:absolute;top:0;left:0;width:100%;height:100%;border:0;" allowfullscreen></iframe></div>`
        );
      }
    }
  }

  // Twitter/X embeds
  const tweetMatches = html.match(/<blockquote class="twitter-tweet"[\s\S]*?<\/blockquote>/gi);
  if (tweetMatches) {
    for (let tweet of tweetMatches) {
      // Remove any tracking reference url back to fightful
      tweet = tweet.replace(/&ref_url=https%3A%2F%2Fwww\.fightful\.com[^\s>"]*/gi, "");
      // Skip tweets from Fightful account directly if any
      if (/x\.com\/(?:Fightful|FightfulSelect)/i.test(tweet)) {
        continue;
      }
      embeds.push(`<div class="tweet-embed" style="margin:24px auto;max-width:550px;">\n${tweet}\n</div>`);
    }
  }

  return embeds;
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

// Convert any occurrence of 'حلقة' to 'عرض' for wrestling shows, and scrub third-party website/reporter branding
function sanitizeWrestlingTerms(text: string): string {
  if (!text) return text;
  return text
    // Strict show terminology
    .replace(/\bحلقة\s+(الرو|سماكداون|ديناميت|كوليجن|رامبيج|إن\s*إكس\s*تي|NXT|RAW|SmackDown|Dynamite|Collision|إمباكت|IMPACT|عرض)\b/gi, "عرض $1")
    .replace(/حلقات\s+عروض/g, "عروض")
    .replace(/حلقة\s+عرض/g, "عرض")
    .replace(/\b(?:في|خلال|من|بـ?|عبر)\s+حلقة\s+([^\s]+)/gi, "في عرض $1")
    .replace(/\bحلقة\s+(اليوم|الليلة|أمس|الأسبوع)\b/g, "عرض $1")
    .replace(/\bآخر\s+حلقة\b/g, "آخر عرض")
    .replace(/\bأحدث\s+حلقة\b/g, "أحدث عرض")
    .replace(/\bالحلقة\s+(القادمة|الماضية|الأخيرة|الافتتاحية|الخاصة)\b/g, "العرض $1")
    .replace(/\bحلقات\s+المصارعة\b/g, "عروض المصارعة")
    .replace(/\bحلقة\s+(جديدة|تلفزيونية|استثنائية)\b/g, "عرض $1")
    // Total Scrub of Fightful & foreign journalist branding to keep all news 100% exclusive to Arab Wrestling
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
    "gemini-3.6-flash",
    "gemini-3.5-flash-lite",
    "gemini-2.5-flash",
    "gemini-3.7-flash",
    "gemini-flash-latest",
    "gemini-flash-lite-latest",
    "gemini-pro-latest",
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
  const titleOptimizerPrompt = `أنت رئيس تحرير رقمي وخبير في كتابة العناوين الصحفية الرياضية وعناوين السيو (SEO & CTR Specialist) لموقع "عرب راسلنج".

المهمة: ابتكار وتصفية واختيار أفضل عنوان على الإطلاق للمقال التالي.

المعايير الصارمة (إلزامية 100%):
1. **عروض ونتائج المصارعة (Results / Spoilers)**:
   - **أولوية اختيار الأحداث (المين إيفنت والنزالات الكبرى أولاً)**:
     - يجب حتماً أن يركز المانشيت على **الحدث الرئيسي (Main Event)** أو النزالات الكبرى والصدمات العنيفة ذات الأسماء الرنانة (مثل: نزال ري ميستيريو ضد أوموس واعتداء النقالة، فوز روكسان بيريز، خسارة بطل، صدمة غير متوقعة).
     - **ممنوع بتاتاً** التركيز على نزالات الافتتاح أو النزالات البسيطة للفرق والبطولات التمهيدية (مثل ماسكاريتا أو لوس أمريكانوس) ما دام هناك حدث رئيسي ناري أو نجوم كبار في العرض!
   - **قاعدة العروض متعددة الليالي (Multi-Night Events مثل Wrestlemania أو Triplemania أو Kingdom)**:
     - إذا كان العرض مقسماً إلى ليالٍ (Night 1 أو Night 2 أو Part 1 أو Part 2):
       - **احذف التاريخ نهائياً ولا تضعه في العنوان مطلقاً!** الهدف هو توفير مساحة كافية لكتابة مانشيت مفصل ومثير جداً لأبرز الأحداث والنزالات.
       - ضع رقم الليلة بالعربية مباشرة بعد اسم العرض: "(الليلة الأولى)" أو "(الليلة الثانية)".
       - ضع وصفاً شيقاً ودقيقاً ومثيراً جداً لأبرز الصدمات والنزالات والأحداث بدلاً من الكلمات الغامضة أو العامة (بدلاً من كلمة مقتضبة وغير واضحة مثل "دمار ري ميستيريو"، اكتب وصفاً درامياً شيقاً يوضح ما جرى مثل: "أوموس يسحق ري ميستيريو بالنقالة.. وروكسان بيريز تخطف فرصة اللقب").
       - الصيغة الإلزامية للعروض متعددة الليالي (بدون تاريخ):
         "نتائج عرض [اسم العرض] (الليلة الأولى): [وصف مثير ومفصل للحدث الأضخم/الرئيسي].. و[حدث بارز آخر]"
         "نتائج عرض [اسم العرض] (الليلة الثانية): [وصف مثير ومفصل للحدث الأضخم/الرئيسي].. و[حدث بارز آخر]"
       - أمثلة صحيحة للعروض متعددة الليالي:
         - "نتائج عرض AAA Triplemanía 34 (الليلة الأولى): أوموس يسحق ري ميستيريو بالنقالة.. وروكسان بيريز تخطف فرصة اللقب"
         - "نتائج عرض WrestleMania 42 (الليلة الأولى): خيانة صادمة تسقط البطل.. وروكسان تخطف فرصة اللقب"

   - **قاعدة العروض العادية (ذات الليلة الواحدة فقط)**:
     - **يجب حتماً تضمين التاريخ بين قوسين**: (${arabicDate}).
     - صيغة العنوان القياسية:
       "نتائج عرض [اسم العرض] (${arabicDate}): [أقوى حدث بالعرض].. و[حدث هام آخر]"
     - أمثلة صحيحة للعروض العادية:
       - "نتائج عرض ROH TV (${arabicDate}): فوز كاسح لـ بانغ بانغ غان.. وأندريتي يحتفظ باللقب"
       - "نتائج عرض CSW Under Pressure (${arabicDate}): جوي بيرسون يخطف الفوز.. وذا ميد من يسيطرون"

2. **التعريب الكامل**:
   - اسم العرض فقط يمكن كتابته بالإنجليزية إذا كان مشهوراً بها (مثل: CSW Under Pressure أو ROH TV أو WWE SmackDown أو AAA Triplemanía 34).
   - باقي الكلمات، وأسماء الفرق، وأسماء المصارعين **يجب أن تكون بالعربية فقط** (مثال: "ذا ميد من" وليس "The Made Men"، "بانغ بانغ غان" وليس "Bang Bang Gang"). ممنوع وضع أسماء فرق أو مصطلحات أجنبية في العنوان.

3. **إذا كان خبراً عادياً أو كواليس**:
   - مانشيت صحفي مشوق ومثير (مثل: "في مسقط رأسها.. ستيفاني فاكير تُسقط ليف مورغان وتتوج باللقب").

4. **طول العنوان وسيو جوجل**:
   - لا يتجاوز 75-80 حرفاً لضمان عدم اقتطاعه في نتائج بحث جوجل أو Google Discover.
   - مليء بالإثارة والتشويق الصحفي، طبيعي وبشري 100% وبدون كليشيهات روبوتية.
   - ممنوع بتاتاً كلمة "حلقة"؛ استبدلها دائماً بكلمة "عرض".

العنوان المقترح حالياً:
${draftTitle}

ملخص ومحتوى المقال الكامل والحدث الرئيسي:
${articleSummary.slice(0, 4500)}

تاريخ العرض (يستخدم فقط إذا كان العرض ليلة واحدة): ${arabicDate}

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

// Re-write article using Gemini
async function rewriteWithGemini(
  originalTitle: string,
  plainText: string,
  categories: string[],
  postDate?: string
): Promise<RewrittenArticle | null> {
  const isResultsPost = /results|spoilers|quick results|full results|recap/i.test(originalTitle) ||
    categories.some(c => /results|spoilers/i.test(c));

  const arabicDate = getArabicDateFormatted(postDate);

  const prompt = `أنت كبير محرري موقع "عرب راسلنج" (arab-wrestling.com)، متخصص في الصحافة الرياضية وتغطية المصارعة الحرة العالمية وفنون القتال.

مهمتك: تحويل الخبر/التقرير الإنجليزي أدناه إلى مادة صحفية عربية شيقة جداً ومثيرة ومكتوبة بأعلى درجات الاحترافية الصحفية وبأسلوب رياضي ممتع كأنك من صاغ الخبر في قلب الحدث.

القواعد التحريرية والتنسيقية الإلزامية (بالغة الأهمية):

1. **التعريب الكامل الشامل**:
   - كل شيء يجب كتابته باللغة العربية (أسماء المصارعين، أسماء الفرق، أنواع المباريات، شروط النزالات، الأحزمة).
   - الاستثناء الوحيد فقط: اسم العرض نفسه في العنوان والافتتاحية (مثل: CSW Under Pressure أو WWE SmackDown أو AEW Collision أو ROH TV).
   - أمثلة للتعريب الصارم:
     - The Made Men -> فريق "ذا ميد من"
     - Machine 17 -> فريق "ماشين 17"
     - Scramble Match -> نزال سكرمبل
     - No Contest -> نزال بلا فائز
     - Main Event -> الحدث الرئيسي
     - Valor And Grayson -> فالور وغرايسون
     - Metra Division Championship -> بطولة ميترا ديفيجن

2. **التنسيق المنظم والفصل بين السطور (حاسم جداً لجمالية العرض)**:
   - في نتائج المباريات، **لا تلصق السطور في بعضها نهائياً**. اجعل بين كل سطر وسطر سطرين فارغين (Double Line Break في الماركداون) حتى يظهر كل جزء في فقرة مستقلة ومريحة للعين تماماً.
   - الهيكل الدقيق لكل مباراة:

**المواجهة الأولى (نوع النزال بالعربي): [المصارع 1] ضد [المصارع 2]**

**تفاصيل النزال:** [شرح سريع ومثير في سطر أو سطرين لأبرز لحظات النزال وكيف انتهى].

🏆 **الفائز:** [اسم الفائز بالعربي] (مع إضافة "واحتفظ باللقب" إذا كان نزال بطولة).

(ثم سطر فارغ قبل المواجهة التالية)

3. **عنوان المقال في حال نتائج العروض**:
   - **إذا كان العرض مقسماً إلى ليالٍ (Night 1 أو Night 2 أو Triplemania أو WrestleMania)**:
     - **احذف التاريخ نهائياً من العنوان!** لا تضع التاريخ إطلاقاً، بل حدد الليلة بالعربية مباشرة بعد اسم العرض واستغل المساحة لكتابة مانشيت مفصل ومثير وشيق لأبرز الصدمات والأحداث بدقة:
     "نتائج عرض [اسم العرض] (الليلة الأولى): [وصف مثير ومفصل للحدث الأضخم].. و[حدث بارز آخر]"
     "نتائج عرض [اسم العرض] (الليلة الثانية): [وصف مثير ومفصل للحدث الأضخم].. و[حدث بارز آخر]"
     مثال: "نتائج عرض AAA Triplemanía 34 (الليلة الأولى): أوموس يسحق ري ميستيريو بالنقالة.. وروكسان بيريز تتألق"
   - **إذا كان العرض عادياً (ليلة واحدة فقط)**:
     - يجب حتماً تضمين التاريخ بين قوسين:
     "نتائج عرض [اسم العرض] (${arabicDate}): [أقوى حدث].. و[حدث هام آخر]"
   - ممنوع كتابة أي كلمات إنجليزية في العنوان باستثناء اسم العرض.

4. **حظر كلمة "حلقة" نهائياً**:
   - استبدلها دائماً بكلمة "عرض" (مثل: "عرض جديد"، "عرض سماكداون"، "عرض Under Pressure").

5. **الاتحاد (federation)**:
   - حدد الاتحاد حصراً من: ["WWE", "AEW", "TNA", "ROH", "MMA", "INDIE"].
   - إذا كان الاتحاد غير الـ 5 الأوائل (مثل CSW أو NJPW أو GCW): يوضع حتماً: INDIE.

6. **حظر ذكر أي مصادر خارجية نهائياً (الحصرية التامة لموقع عرب راسلنج)**:
   - **ممنوع تماماً** ذكر اسم موقع "Fightful" أو "Fightful Select" أو محرريها في أي مكان في العنوان أو نص المقال أو الوسوم.
   - اكتب كل خبر وصِغْ كل معلومة كأنها خبر حصري لموقع "عرب راسلنج" (arab-wrestling.com)، أو اذكر عبارات صحفية عامة مثل: "أفادت مصادرنا الخاصة"، "كشفت تقارير صحفية خاصة"، "وفقاً لمصادر مطلعة في الكواليس"، "علمت مصادرنا".

7. **الوسوم (tags)**:
   - ضع بين 5 إلى 7 وسوم عربية دقيقة (اسم الاتحاد، اسم العرض، نتائج عروض المصارعة، أبرز المصارعين بالعربية، أخبار المصارعة).
   - ممنوع تماماً وضع Fightful أو أي موقع أجنبي في الوسوم.

الخبر الأصلي:
العنوان: ${originalTitle}
التصنيفات: ${categories.join(", ")}
تاريخ الحدث: ${arabicDate}
النص:
${plainText.slice(0, 4000)}

أخرج النتيجة بتنسيق JSON حصراً:
{
  "title": "العنوان المقترح وفقاً للقواعد والتعريب الكامل",
  "federation": "INDIE",
  "tags": ["وسم 1", "وسم 2", "وسم 3", "وسم 4", "وسم 5"],
  "body_markdown": "المحتوى المنسق بسطور مفصولة وفقرات مستقلة..."
}`;

  const text = await queryGemini(prompt, true);
  if (!text) return null;

  try {
    const parsed: RewrittenArticle = JSON.parse(text);

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

// Format date to YYYYMMDDHHMMSS and ISO string strictly in UTC+3 (Cairo/Mecca time)
function formatDate(dateString?: string) {
  const d = dateString ? new Date(dateString) : new Date();
  
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
  const url = `https://www.fightful.com/wp-json/wp/v2/posts?_embed=1&per_page=${fetchCount}`;
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

  // 3. Extract media embeds and append to body
  const embeds = extractEmbeds(contentHtml);
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

// Main check function
export async function runWatcher(options: { forceLatest?: boolean; maxCount?: number; maxPerRun?: number } = {}) {
  const state = loadState();

  if (state.enabled === false && !options.forceLatest) {
    console.log("[Watcher] ⏸️ Watcher is currently PAUSED by admin in watcher-state.json. Skipping execution.");
    return;
  }

  const batchLimit = options.maxCount || 20;
  const maxPerRun = options.maxPerRun || 1; // Default: 1 article per 15-minute cycle to prevent flood
  console.log(`[Watcher] Checking for new posts at ${new Date().toLocaleTimeString()} (Batch: ${batchLimit}, Max Per Run: ${options.forceLatest ? 'Unlimited' : maxPerRun})...`);

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

      const success = await processPost(post);
      if (success) {
        if (!state.processedIds.includes(postId)) {
          state.processedIds.push(postId);
        }
        saveState(state);
        processedCount++;

        // Staggered pacing: limit automated publishing to maxPerRun (default 1) per cycle.
        // This prevents dumping multiple articles simultaneously onto the site, Facebook, and Buffer!
        if (!options.forceLatest && processedCount >= maxPerRun) {
          console.log(`[Watcher] ⏳ Paced release: successfully published ${processedCount} article this cycle. Remaining articles will be published in subsequent 15-minute cycles to protect social media accounts.`);
          break;
        }

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
if (require.main === module || process.argv[1]?.endsWith("fightful-watcher.ts")) {
  const args = process.argv.slice(2);
  const isDaemon = args.includes("--daemon");
  const isForceOne = args.includes("--force-one");
  const urlsArg = args.find(a => a.startsWith("--urls="))?.split("=").slice(1).join("=") ||
                  args.find(a => a.startsWith("--url="))?.split("=").slice(1).join("=");
  const staggerArg = Number(args.find(a => a.startsWith("--stagger="))?.split("=")[1]) || 15;

  if (urlsArg) {
    const rawList = urlsArg.split(/[,\s]+/).map(u => u.trim()).filter(Boolean);
    console.log(`[Watcher] Processing batch of ${rawList.length} articles with ${staggerArg}m safe interval...`);
    (async () => {
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
            // First post publishes now; subsequent posts get staggered by i * staggerArg minutes
            const publishTime = (i === 0) ? new Date() : new Date(Date.now() + i * staggerArg * 60 * 1000);
            console.log(`[Watcher] Scheduled release time: ${publishTime.toISOString()} (+${i * staggerArg}m)`);
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
    })();
  } else if (isDaemon) {
    console.log("[Watcher] Starting daemon mode. Checking every 5 minutes...");
    runWatcher();
    setInterval(() => {
      runWatcher();
    }, 5 * 60 * 1000);
  } else if (isForceOne) {
    console.log("[Watcher] Running test with --force-one...");
    runWatcher({ forceLatest: true, maxCount: 1 });
  } else {
    runWatcher();
  }
}
