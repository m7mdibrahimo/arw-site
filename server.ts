import express from "express";
import path from "path";
import fs from "fs";
import { execSync, exec } from "child_process";
import webpush from "web-push";

const app = express();
const PORT = process.env.PORT ? Number(process.env.PORT) : 3000; // Render injects PORT automatically

app.use(express.json());

// CORS: the admin panel lives on arab-wrestling.com (a different origin than
// this Render-hosted API), so browser fetch() calls need these headers or
// they'll be blocked silently.
app.use((req, res, next) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") {
    return res.sendStatus(204);
  }
  next();
});

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || "8557696064:AAF_OwtfWAfI1820xX4fj96zj_fY5GcxX5s";
const CHAT_ID = process.env.TELEGRAM_CHAT_ID || "@arab_wrestling";

// Initialize VAPID Keys for Web Push Notifications
const VAPID_FILE = path.join(process.cwd(), "vapid.json");
let vapidKeys: { publicKey: string; privateKey: string };

if (fs.existsSync(VAPID_FILE)) {
  try {
    vapidKeys = JSON.parse(fs.readFileSync(VAPID_FILE, "utf-8"));
  } catch (e) {
    vapidKeys = webpush.generateVAPIDKeys();
    fs.writeFileSync(VAPID_FILE, JSON.stringify(vapidKeys, null, 2));
  }
} else {
  vapidKeys = webpush.generateVAPIDKeys();
  fs.writeFileSync(VAPID_FILE, JSON.stringify(vapidKeys, null, 2));
}

webpush.setVapidDetails(
  "mailto:admin@arab-wrestling.com",
  vapidKeys.publicKey,
  vapidKeys.privateKey
);

// Manage Web Push Subscriptions
const SUBS_FILE = path.join(process.cwd(), "subscriptions.json");

function getSubscriptions(): any[] {
  if (!fs.existsSync(SUBS_FILE)) return [];
  try {
    return JSON.parse(fs.readFileSync(SUBS_FILE, "utf-8")) || [];
  } catch (e) {
    return [];
  }
}

function saveSubscriptions(subs: any[]) {
  try {
    fs.writeFileSync(SUBS_FILE, JSON.stringify(subs, null, 2));
  } catch (e) {}
}

// Push API Endpoints
app.get("/api/push/public-key", (req, res) => {
  res.json({ success: true, publicKey: vapidKeys.publicKey });
});

app.post("/api/push/subscribe", (req, res) => {
  const { subscription } = req.body;
  if (!subscription || !subscription.endpoint) {
    return res.status(400).json({ success: false, error: "Invalid subscription" });
  }

  const subs = getSubscriptions();
  const exists = subs.some((s) => s.endpoint === subscription.endpoint);
  if (!exists) {
    subs.push(subscription);
    saveSubscriptions(subs);
  }

  res.json({ success: true, message: "تم الاشتراك في الإشعارات بنجاح!" });
});

app.post("/api/push/unsubscribe", (req, res) => {
  const { endpoint } = req.body;
  if (!endpoint) return res.json({ success: true });

  const subs = getSubscriptions();
  const filtered = subs.filter((s) => s.endpoint !== endpoint);
  saveSubscriptions(filtered);

  res.json({ success: true });
});

// Helper to send push notification to all subscribers (SHOWS & RECAPS ONLY)
async function sendPushToAllSubscribers(data: {
  title: string;
  text?: string;
  headline?: string;
  url: string;
  image?: string;
  collection?: string;
  kind?: string;
}) {
  const { title, text, headline, url, image, collection, kind } = data;

  // STRICT RULE: NEVER SEND NEWS NOTIFICATIONS! ONLY SHOWS AND RECAPS
  const isNews = collection === "news" || kind === "news" || (url && url.includes("/news/"));
  if (isNews) {
    console.log("Push notification blocked: News notifications are strictly disabled.");
    return { success: false, reason: "News disabled" };
  }

  const isShow = kind === "show" || collection === "shows" || (url && url.includes("/shows/"));
  const label = isShow ? "عرض جديد" : "ملخص جديد";

  const pushPayload = JSON.stringify({
    title: `عرب راسلنج 🔔 | ${label}: ${title || ""}`,
    body: headline || text || "تم إضافة عرض/ملخص جديد على الموقع. اضغط للمشاهدة الآن.",
    url: url || "/",
    image: image || "/favicon.png",
    kind: isShow ? "show" : "recap",
  });

  const subs = getSubscriptions();
  const validSubs: any[] = [];
  let sentCount = 0;

  await Promise.all(
    subs.map(async (sub) => {
      try {
        await webpush.sendNotification(sub, pushPayload);
        sentCount++;
        validSubs.push(sub);
      } catch (err: any) {
        if (err.statusCode === 410 || err.statusCode === 404) {
          // Subscription expired or unregistered by browser
        } else {
          validSubs.push(sub);
        }
      }
    })
  );

  saveSubscriptions(validSubs);
  return { success: true, sentCount, totalSubs: subs.length };
}

app.post("/api/push/send", async (req, res) => {
  try {
    const result = await sendPushToAllSubscribers(req.body);
    res.json(result);
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Telegram Sent Posts Deduplication — persisted to disk. This is what lets the
// site watcher (below) know which items it has already posted, both across
// poll cycles and across server restarts/redeploys.
const SENT_STATE_FILE = path.join(process.cwd(), "telegram-sent-map.json");
const SENT_STATE_MAX_AGE_MS = 90 * 24 * 60 * 60 * 1000; // prune entries older than 90 days

function loadSentMap(): Record<string, number> {
  if (!fs.existsSync(SENT_STATE_FILE)) return {};
  try {
    const parsed = JSON.parse(fs.readFileSync(SENT_STATE_FILE, "utf-8"));
    const now = Date.now();
    const pruned: Record<string, number> = {};
    for (const k of Object.keys(parsed || {})) {
      if (now - parsed[k] < SENT_STATE_MAX_AGE_MS) pruned[k] = parsed[k];
    }
    return pruned;
  } catch (e) {
    return {};
  }
}

function persistSentMap() {
  try {
    fs.writeFileSync(SENT_STATE_FILE, JSON.stringify(telegramSentMap));
  } catch (e) {
    console.error("[Telegram] Failed to persist sent-state file:", e);
  }
}

const telegramSentMap: Record<string, number> = loadSentMap();

function escapeTelegramHtml(str: string): string {
  if (!str) return "";
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function isValidImageFile(p: string): boolean {
  if (!fs.existsSync(p) || !fs.statSync(p).isFile()) return false;
  const stat = fs.statSync(p);
  if (stat.size < 100) return false;

  try {
    const buf = Buffer.alloc(12);
    const fd = fs.openSync(p, "r");
    fs.readSync(fd, buf, 0, 12, 0);
    fs.closeSync(fd);

    const hex = buf.subarray(0, 8).toString("hex");
    if (hex.startsWith("ffd8")) return true; // JPG
    if (hex.startsWith("89504e47")) return true; // PNG
    if (buf.subarray(0, 4).toString() === "RIFF" && buf.subarray(8, 12).toString() === "WEBP") return true; // WEBP
    if (hex.startsWith("47494638")) return true; // GIF
  } catch (e) {}

  return false;
}

function isValidImageBuffer(buffer: ArrayBuffer | Buffer): boolean {
  if (!buffer || buffer.byteLength < 100) return false;
  const buf = Buffer.from(buffer as any);
  const hex = buf.subarray(0, 8).toString("hex");
  if (hex.startsWith("ffd8")) return true; // JPG
  if (hex.startsWith("89504e47")) return true; // PNG
  if (buf.subarray(0, 4).toString() === "RIFF" && buf.subarray(8, 12).toString() === "WEBP") return true; // WEBP
  if (hex.startsWith("47494638")) return true; // GIF
  return false;
}

function resolveLocalImagePath(imgStr: string | undefined): string | null {
  if (!imgStr || typeof imgStr !== 'string') return null;
  let clean = imgStr.replace(/^https?:\/\/[^\/]+/, "");
  if (!clean.startsWith("/")) clean = "/" + clean;

  const candidates = [
    path.join(process.cwd(), clean),
    path.join(process.cwd(), "_site", clean),
    path.join(process.cwd(), "content/images", path.basename(clean)),
    path.join(process.cwd(), "_site/img", path.basename(clean)),
    path.join(process.cwd(), "_site/content/images", path.basename(clean)),
    path.join(process.cwd(), "public", clean),
    path.join(process.cwd(), "assets", clean)
  ];

  for (const p of candidates) {
    if (isValidImageFile(p)) {
      return p;
    }
  }
  return null;
}

function normalizeArticleUrl(urlStr: string | undefined): string {
  if (!urlStr || typeof urlStr !== 'string') return 'https://arab-wrestling.com';
  try {
    const parsed = new URL(urlStr);
    parsed.pathname = parsed.pathname.replace(/[A-Z]+/g, (m) => m.toLowerCase());
    return decodeURIComponent(parsed.toString());
  } catch (e) {
    return urlStr;
  }
}

async function executeTelegramPost(data: {
  title: string;
  text?: string;
  url?: string;
  image?: string;
  collection?: string;
  kind?: string;
}, strictImage: boolean = false) {
  try {
    const { title, text, url, image } = data;
    const articleUrl = normalizeArticleUrl(url || 'https://arab-wrestling.com');

    let fullImageUrl = image;
    if (image && typeof image === 'string' && !image.startsWith('http')) {
      fullImageUrl = 'https://arab-wrestling.com' + (image.startsWith('/') ? '' : '/') + image;
    }

    const safeTitle = escapeTelegramHtml(title || "");
    const safeText = escapeTelegramHtml(text || "");
    const safeUrl = escapeTelegramHtml(articleUrl || "");
    const messageHtml = `<b>${safeTitle}</b>\n\n${safeText}\n\n🔗 <a href="${safeUrl}"><b>تابع المحتوى على موقع عرب راسلنج</b></a>`;

    let result: any = { ok: false };
    const localImgPath = resolveLocalImagePath(image);

    const isRateLimited = (res: any) => res && res.error_code === 429;
    const isImageProcessFailed = (res: any) => res && res.error_code === 400 && typeof res.description === 'string' && res.description.includes('IMAGE_PROCESS_FAILED');

    // Strategy 1: Direct File Binary Upload via FormData (for local image files)
    if (localImgPath && fs.existsSync(localImgPath) && fs.statSync(localImgPath).size > 0) {
      try {
        console.log(`[Telegram] Uploading local image binary (${localImgPath})...`);
        const fileBuffer = fs.readFileSync(localImgPath);
        const ext = path.extname(localImgPath).toLowerCase();
        let mimeType = 'image/jpeg';
        let fileName = path.basename(localImgPath);
        if (ext === '.png') mimeType = 'image/png';
        else if (ext === '.webp') mimeType = 'image/webp';
        else if (ext === '.gif') mimeType = 'image/gif';

        const blob = new Blob([new Uint8Array(fileBuffer)], { type: mimeType });
        const formData = new FormData();
        formData.append("chat_id", CHAT_ID);
        formData.append("photo", blob, fileName);
        formData.append("caption", messageHtml);
        formData.append("parse_mode", "HTML");

        const tgRes = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendPhoto`, {
          method: "POST",
          body: formData
        });
        result = await tgRes.json().catch(() => ({ ok: false }));
        if (result.ok) {
          console.log("[Telegram] sendPhoto via direct file upload succeeded!");
          return result;
        }
        if (isRateLimited(result)) {
          console.warn("[Telegram] Rate limit (429) hit during sendPhoto file upload.");
          return result;
        }
        if (isImageProcessFailed(result)) {
          console.warn("[Telegram] Local image process failed (400), skipping remaining photo strategies...");
        } else {
          console.warn("[Telegram] Direct file upload sendPhoto returned error:", result);
        }
      } catch (fileErr) {
        console.error("[Telegram] Error uploading local image file:", fileErr);
      }
    }

    // Strategy 2: Fetch remote image buffer and upload via FormData
    if (!result.ok && fullImageUrl && !isImageProcessFailed(result) && !isRateLimited(result)) {
      try {
        console.log(`[Telegram] Trying to fetch remote image from ${fullImageUrl}...`);
        const imgRes = await fetch(fullImageUrl);
        if (imgRes.ok) {
          const arrayBuffer = await imgRes.arrayBuffer();
          if (isValidImageBuffer(arrayBuffer)) {
            const contentType = imgRes.headers.get("content-type") || "image/jpeg";
            const blob = new Blob([new Uint8Array(arrayBuffer)], { type: contentType });

            const formData = new FormData();
            formData.append("chat_id", CHAT_ID);
            formData.append("photo", blob, "photo.jpg");
            formData.append("caption", messageHtml);
            formData.append("parse_mode", "HTML");

            const tgRes = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendPhoto`, {
              method: "POST",
              body: formData
            });
            result = await tgRes.json().catch(() => ({ ok: false }));
            if (result.ok) {
              console.log("[Telegram] sendPhoto via fetched image buffer succeeded!");
              return result;
            }
            if (isRateLimited(result)) {
              console.warn("[Telegram] Rate limit (429) hit during fetched image upload.");
              return result;
            }
          } else {
            console.warn("[Telegram] Fetched image buffer is invalid image data, skipping photo upload.");
          }
        }
      } catch (fetchErr) {
        console.warn("[Telegram] Failed to fetch remote image buffer:", fetchErr);
      }
    }

    // Strategy 3: sendPhoto using URL string
    if (!result.ok && fullImageUrl && !isImageProcessFailed(result) && !isRateLimited(result)) {
      try {
        const payload = {
          chat_id: CHAT_ID,
          photo: fullImageUrl,
          caption: messageHtml,
          parse_mode: "HTML"
        };
        const tgRes = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendPhoto`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload)
        });
        result = await tgRes.json().catch(() => ({ ok: false }));
        if (result.ok) {
          console.log("[Telegram] sendPhoto via URL string succeeded!");
          return result;
        }
        if (isRateLimited(result)) {
          console.warn("[Telegram] Rate limit (429) hit during URL sendPhoto.");
          return result;
        }
      } catch (urlErr) {
        console.warn("[Telegram] sendPhoto via URL string failed:", urlErr);
      }
    }

    // If an image was expected but every photo strategy above failed, and we're in
    // strict mode (used by the pending-queue worker), don't fall back to text yet —
    // signal the caller so it can retry later instead of permanently losing the image.
    if (!result.ok && !isRateLimited(result) && strictImage && image) {
      console.warn("[Telegram] Image expected but not ready yet, deferring post (strictImage).");
      return { ok: false, error_code: "IMAGE_NOT_READY", description: "Image not yet available, will retry" };
    }

    // Strategy 4: Fallback to sendMessage HTML (Text only)
    if (!result.ok && !isRateLimited(result)) {
      console.log("[Telegram] Posting article message to channel via formatted HTML...");
      const payload = {
        chat_id: CHAT_ID,
        text: messageHtml,
        parse_mode: "HTML",
        disable_web_page_preview: false
      };
      const tgRes = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });
      result = await tgRes.json().catch(() => ({ ok: false }));
      if (result.ok) return result;
      if (isRateLimited(result)) return result;
    }

    // Strategy 5: Plain text sendMessage without HTML formatting
    if (!result.ok && !isRateLimited(result)) {
      console.warn("[Telegram] HTML parse failed, retrying plain text sendMessage...");
      const plainText = `${title || ""}\n\n${text || ""}\n\n🔗 تابع المحتوى على موقع عرب راسلنج:\n${articleUrl}`;
      const payload = {
        chat_id: CHAT_ID,
        text: plainText,
        disable_web_page_preview: false
      };
      const tgRes = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });
      result = await tgRes.json().catch(() => ({ ok: false }));
    }

    return result;
  } catch (err: any) {
    console.error("[Telegram] Error executing Telegram post:", err);
    return { ok: false, description: err.message || "Network error" };
  }
}

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

function sanitizeKey(str: string): string {
  if (!str) return "";
  return str.toLowerCase().replace(/[^a-z0-9\u0600-\u06FF_-]/g, "");
}

function parseFrontmatter(fileContent: string): Record<string, string> {
  const match = fileContent.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!match) return {};
  const yamlStr = match[1];
  const result: Record<string, string> = {};
  for (const line of yamlStr.split("\n")) {
    const colonIdx = line.indexOf(":");
    if (colonIdx > 0) {
      const key = line.slice(0, colonIdx).trim();
      let val = line.slice(colonIdx + 1).trim();
      if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
        val = val.slice(1, -1);
      }
      result[key] = val;
    }
  }
  return result;
}

// Simple in-memory scheduler: "wait, then send". No file storage, no polling
// loop — just a plain timer per post. If the server restarts mid-wait, that
// one post is lost, which is an accepted tradeoff for keeping this simple.
//
// If many posts happen to become due around the same moment (e.g. 50 posts
// published back-to-back), we don't want to fire 50 Telegram API calls at
// once — Telegram flood-blocks rapid concurrent sends. So the 3-minute timer
// only ENQUEUES the post; a single worker sends them one at a time with a
// small gap in between. Each post still fires ~3 minutes after its own
// publish, this just prevents a pile-up from being sent all in one instant.
type QueuedPost = { key: string; item: any; imageRetries: number };
const telegramSendQueue: QueuedPost[] = [];
let isSendingTelegramQueue = false;

function scheduleTelegramPost(key: string, item: any, delayMs: number) {
  setTimeout(() => enqueueTelegramSend(key, item, 0), delayMs);
}

function enqueueTelegramSend(key: string, item: any, imageRetries: number) {
  telegramSendQueue.push({ key, item, imageRetries });
  processTelegramSendQueue();
}

async function processTelegramSendQueue() {
  if (isSendingTelegramQueue) return; // a worker loop is already running
  isSendingTelegramQueue = true;
  try {
    while (telegramSendQueue.length > 0) {
      const job = telegramSendQueue.shift()!;
      await sendTelegramPostWithImageRetry(job.key, job.item, job.imageRetries);
      // small gap between actual sends so Telegram never sees a burst
      if (telegramSendQueue.length > 0) {
        await new Promise(r => setTimeout(r, 3500));
      }
    }
  } finally {
    isSendingTelegramQueue = false;
  }
}

async function sendTelegramPostWithImageRetry(key: string, item: any, imageRetries: number) {
  if (telegramSentMap[key]) {
    console.log(`[Telegram] Skipping ${key}, already sent.`);
    return;
  }

  console.log(`[Telegram] Sending scheduled post: ${item.title}`);
  try {
    // strictImage=true: don't silently fall back to text-only — we want to
    // know if the image isn't ready yet so we can retry instead.
    const result = await executeTelegramPost(item, true);

    if (result.ok) {
      telegramSentMap[key] = Date.now();
      persistSentMap();
      if (item.url && (item.url.includes("/shows/") || item.url.includes("/recaps/") || item.collection === "shows" || item.collection === "recaps")) {
        sendPushToAllSubscribers(item).catch(() => {});
      }
      return;
    }

    if (result.error_code === 429) {
      const retrySec = (result.parameters?.retry_after || result.retry_after || 35) + 5;
      console.warn(`[Telegram] Rate limited, retrying ${key} in ${retrySec}s.`);
      setTimeout(() => enqueueTelegramSend(key, item, imageRetries), retrySec * 1000);
      return;
    }

    if (result.error_code === "IMAGE_NOT_READY") {
      if (imageRetries >= 30) {
        console.warn(`[Telegram] Image still not ready after ${imageRetries} retries for ${key}. Sending without image.`);
        const fallback = await executeTelegramPost(item, false); // allow text-only fallback now
        if (fallback.ok) {
          telegramSentMap[key] = Date.now();
          persistSentMap();
          if (item.url && (item.url.includes("/shows/") || item.url.includes("/recaps/") || item.collection === "shows" || item.collection === "recaps")) {
            sendPushToAllSubscribers(item).catch(() => {});
          }
        }
        return;
      }
      console.log(`[Telegram] Image not ready yet for ${key} (attempt ${imageRetries + 1}/30), retrying in 30s...`);
      setTimeout(() => enqueueTelegramSend(key, item, imageRetries + 1), 30000);
      return;
    }

    console.error(`[Telegram] Failed to send ${key}:`, result);
  } catch (err) {
    console.error(`[Telegram] Error sending ${key}:`, err);
  }
}

// ─────────────────────────────────────────────────────────────────────────
// Site Watcher: watches the REAL public site (arab-wrestling.com — served
// through Cloudflare/GitHub, a separate pipeline from this API server) and
// only posts an item once it has personally verified, over the public
// internet, that:
//   1) the article page itself responds live (not 404), and
//   2) the image itself responds live and is a real image (not 404, not a
//      broken/placeholder response).
// It never trusts a local file or a fixed delay — it checks the exact same
// URLs a visitor or Telegram would see, with cache-busting so a stale
// Cloudflare edge cache can't fool it into thinking something is missing
// (or thinking something is ready when the edge is still serving old data).
// If verification fails, the item is simply retried on the next poll cycle
// — nothing is lost, and nothing goes out until it's genuinely confirmed.
// ─────────────────────────────────────────────────────────────────────────

const SITE_ORIGIN = "https://arab-wrestling.com";
const REMOTE_INDEX_URL = `${SITE_ORIGIN}/search-index.json`;
const WATCHER_POLL_MS = 60000; // re-check the live site every 60 seconds
// Content published in the few minutes before this server booted is still
// treated as "new" (covers the moment right after a redeploy). Anything
// older than this at boot time is assumed to already be known/published.
const WATCHER_BOOTSTRAP_GRACE_MS = 5 * 60 * 1000;
// If an item still isn't fully verifiable after this long, stop waiting on
// the image specifically and publish with text + link only, so a post is
// never lost forever because of one stuck image.
const WATCHER_MAX_WAIT_MS = 20 * 60 * 1000;

function cacheBust(url: string): string {
  return url + (url.includes("?") ? "&" : "?") + "_cb=" + Date.now();
}

async function fetchLiveSearchIndex(): Promise<any[]> {
  try {
    const res = await fetch(cacheBust(REMOTE_INDEX_URL), { headers: { "Cache-Control": "no-cache" } });
    if (!res.ok) {
      console.warn(`[Watcher] Live search-index.json returned ${res.status}`);
      return [];
    }
    const data = await res.json();
    return Array.isArray(data) ? data : [];
  } catch (e) {
    console.error("[Watcher] Failed to fetch live search-index.json:", e);
    return [];
  }
}

function watcherKeyFor(item: any): string {
  return sanitizeKey(normalizeArticleUrl(SITE_ORIGIN + (item.url || "")));
}

// Pulls a short plain-text snippet out of the article's own rendered body
// (the <div class="post-body ..."> block in post-layout.njk) so the Telegram
// caption always has a real summary of the article, even for news items that
// don't set a headline/description field.
function extractSnippetFromHtml(html: string, maxLen: number = 220): string {
  const startMarker = 'class="post-body';
  const markerIdx = html.indexOf(startMarker);
  if (markerIdx === -1) return "";
  const startIdx = html.indexOf(">", markerIdx) + 1;
  if (startIdx <= 0) return "";
  const endIdx = html.indexOf('class="post-tags', startIdx);
  const raw = endIdx !== -1 ? html.slice(startIdx, endIdx) : html.slice(startIdx, startIdx + 4000);

  let text = raw
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/\s+/g, " ")
    .trim();

  if (text.length > maxLen) {
    text = text.slice(0, maxLen).trim() + "…";
  }
  // Sanity check: reject anything that isn't real prose (e.g. a stray
  // leftover HTML fragment from unusual markup, or basically nothing).
  if (text.length < 15 || text.startsWith("<")) return "";
  return text;
}

// Actually hits the public page URL and the public image URL — the exact
// things a real visitor (or Telegram) would load — before anything is sent.
async function verifyLiveOnSite(item: any): Promise<{ ok: boolean; imageBuffer?: ArrayBuffer; imageContentType?: string; bodySnippet?: string }> {
  const pageUrl = SITE_ORIGIN + (item.url || "");
  let bodySnippet = "";

  try {
    const pageRes = await fetch(cacheBust(pageUrl), { headers: { "Cache-Control": "no-cache" } });
    if (!pageRes.ok) return { ok: false };
    const html = await pageRes.text();
    bodySnippet = extractSnippetFromHtml(html);
  } catch (e) {
    return { ok: false };
  }

  if (!item.image) return { ok: true, bodySnippet }; // nothing to verify for the image

  const imageUrl = item.image.startsWith("http") ? item.image : SITE_ORIGIN + item.image;
  try {
    const imgRes = await fetch(cacheBust(imageUrl), { headers: { "Cache-Control": "no-cache" } });
    if (!imgRes.ok) return { ok: false, bodySnippet };
    const contentType = imgRes.headers.get("content-type") || "";
    if (!contentType.startsWith("image/")) return { ok: false, bodySnippet };
    const buf = await imgRes.arrayBuffer();
    if (!isValidImageBuffer(buf)) return { ok: false, bodySnippet };
    return { ok: true, imageBuffer: buf, imageContentType: contentType, bodySnippet };
  } catch (e) {
    return { ok: false, bodySnippet };
  }
}

// Sends to Telegram using the EXACT image bytes we just verified live on the
// site — no separate re-fetch, no guessing, no risk of a mismatch.
async function sendVerifiedTelegramPost(
  data: { title: string; text?: string; url: string },
  imageBuffer?: ArrayBuffer,
  imageContentType?: string
) {
  const safeTitle = escapeTelegramHtml(data.title || "");
  const safeText = escapeTelegramHtml(data.text || "");
  const safeUrl = escapeTelegramHtml(normalizeArticleUrl(data.url || SITE_ORIGIN));
  const messageHtml = `<b>${safeTitle}</b>\n\n${safeText}\n\n🔗 <a href="${safeUrl}"><b>تابع المحتوى على موقع عرب راسلنج</b></a>`;

  if (imageBuffer) {
    try {
      const blob = new Blob([new Uint8Array(imageBuffer)], { type: imageContentType || "image/jpeg" });
      const formData = new FormData();
      formData.append("chat_id", CHAT_ID);
      formData.append("photo", blob, "photo.jpg");
      formData.append("caption", messageHtml);
      formData.append("parse_mode", "HTML");
      const tgRes = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendPhoto`, { method: "POST", body: formData });
      const result = await tgRes.json().catch(() => ({ ok: false }));
      if (result.ok) return result;
      console.warn("[Watcher] sendPhoto with verified image failed, falling back to text:", result);
    } catch (e) {
      console.warn("[Watcher] Error sending verified image, falling back to text:", e);
    }
  }

  const payload = { chat_id: CHAT_ID, text: messageHtml, parse_mode: "HTML", disable_web_page_preview: false };
  const tgRes = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });
  return await tgRes.json().catch(() => ({ ok: false }));
}

const watcherPendingSince: Record<string, number> = {};

async function tryPublishSiteItem(item: any, key: string) {
  const verify = await verifyLiveOnSite(item);
  if (!watcherPendingSince[key]) watcherPendingSince[key] = Date.now();
  const waited = Date.now() - watcherPendingSince[key];

  if (!verify.ok) {
    if (waited < WATCHER_MAX_WAIT_MS) {
      console.log(`[Watcher] "${item.title}" not fully live on arab-wrestling.com yet, will re-check.`);
      return; // try again on the next poll — nothing is lost
    }
    console.warn(`[Watcher] "${item.title}" still not fully live after ${Math.round(waited / 60000)} min — publishing with text + link only.`);
  }

  const collection = item.kind === "show" ? "shows" : item.kind === "recap" ? "recaps" : "news";
  const payload = {
    title: item.title,
    text: item.headline || item.description || verify.bodySnippet || "",
    url: SITE_ORIGIN + (item.url || "")
  };

  console.log(`[Watcher] Verified live on site, publishing: ${item.title}`);
  const result = await sendVerifiedTelegramPost(payload, verify.ok ? verify.imageBuffer : undefined, verify.imageContentType);

  if (result && result.ok) {
    telegramSentMap[key] = Date.now();
    persistSentMap();
    delete watcherPendingSince[key];
    if (collection === "shows" || collection === "recaps") {
      sendPushToAllSubscribers({ ...payload, image: item.image, collection, kind: item.kind }).catch(() => {});
    }
  } else {
    console.error(`[Watcher] Failed to publish "${item.title}":`, result);
  }
}

async function watcherBootstrap() {
  const items = await fetchLiveSearchIndex();
  if (!items.length) {
    console.log("[Watcher] Could not reach live search-index.json at boot, will try again on next poll.");
    return;
  }
  const now = Date.now();
  let pending = 0;
  for (const item of items) {
    const key = watcherKeyFor(item);
    if (!key || telegramSentMap[key]) continue; // already known from persisted state
    const ts = item.date ? new Date(item.date).getTime() : 0;
    if (ts && now - ts <= WATCHER_BOOTSTRAP_GRACE_MS) {
      pending++; // recent enough — leave unmarked so the first poll verifies + sends it
      continue;
    }
    // Predates this boot by more than the grace window: treat as already-published history.
    telegramSentMap[key] = now;
  }
  persistSentMap();
  console.log(`[Watcher] Bootstrapped with ${items.length} live items (${pending} pending publish).`);
}

let watcherPolling = false;
async function watcherPoll() {
  if (watcherPolling) return; // don't overlap if a previous poll is still verifying/sending
  watcherPolling = true;
  try {
    const items = await fetchLiveSearchIndex();
    for (const item of items) {
      const key = watcherKeyFor(item);
      if (key && !telegramSentMap[key]) {
        await tryPublishSiteItem(item, key);
      }
    }
  } catch (e) {
    console.error("[Watcher] Poll error:", e);
  } finally {
    watcherPolling = false;
  }
}

watcherBootstrap();
setInterval(watcherPoll, WATCHER_POLL_MS);

// Telegram API endpoints
app.get("/api/telegram/status", async (req, res) => {
  try {
    const response = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/getMe`);
    const data = await response.json();
    res.json({ success: true, bot: data, channel: CHAT_ID });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

app.post("/api/telegram/post", async (req, res) => {
  res.setHeader("Content-Type", "application/json");
  try {
    const { title, text, url, image, collection, kind, id, slug, postId, immediate, force } = req.body || {};

    // TEMP DEBUG: log exactly what arrives, to compare news vs shows requests.
    // Remove this once the image issue is confirmed fixed.
    console.log("[Telegram DEBUG] Incoming post:", {
      title,
      collection,
      kind,
      image,
      imageType: typeof image,
      url
    });

    if (!title && !text) {
      return res.status(400).json({ success: false, error: "العنوان أو النص مطلوب" });
    }

    // Trigger Eleventy build in background so static page is generated immediately
    exec("npx @11ty/eleventy", (err) => {
      if (err) console.error("[Eleventy AutoBuild Error]:", err);
      else console.log("[Eleventy AutoBuild] Site rebuilt successfully for new post!");
    });

    // Generate strict unique deduplication key. Prefer the URL (normalized the
    // same way the site watcher does) so a manual publish here and an
    // automatic publish from the watcher recognize each other as the same
    // item and never double-post.
    const rawKey = url ? normalizeArticleUrl(url) : (postId || slug || id || title || "");
    const dedupKey = sanitizeKey(rawKey.toString());

    // Check if sent recently (less than 10 minutes) unless force/immediate is passed
    const lastSentTime = telegramSentMap[dedupKey];
    if (dedupKey && lastSentTime && (Date.now() - lastSentTime < 600000) && !force && !immediate) {
      console.log(`[Telegram] Already sent recently for key: ${dedupKey}`);
      return res.json({
        success: true,
        message: "تم نشر هذا الموضوع مسبقاً على التليجرام",
        alreadySent: true
      });
    }

    // If immediate send is explicitly requested
    if (immediate) {
      const result = await executeTelegramPost({ title, text, url, image, collection, kind });
      if (result.ok) {
        if (dedupKey) {
          telegramSentMap[dedupKey] = Date.now();
          persistSentMap();
        }
        if (url && (url.includes("/shows/") || url.includes("/recaps/") || collection === "shows" || collection === "recaps")) {
          sendPushToAllSubscribers({ title, text, url, image, collection, kind }).catch((e) => {});
        }
        return res.json({ success: true, message: "تم النشر فوراً على التليجرام!", result });
      } else {
        return res.status(400).json({ success: false, error: result.description || "فشل النشر", result });
      }
    }

    // Default delay: 3 MINUTES (180,000 ms) as requested.
    // Just a plain in-memory timer — wait, then send. Nothing is written to disk.
    const delayMs = req.body?.delayMs !== undefined ? Number(req.body.delayMs) : 180000;
    scheduleTelegramPost(dedupKey, { title, text, url, image, collection, kind }, delayMs);

    return res.json({
      success: true,
      queued: true,
      message: "تم تسجيل الموضوع بنجاح! سيتم نشره تلقائياً على التليجرام بعد 3 دقائق لضمان اكتمال بناء الصفحة والميديا على الموقع."
    });
  } catch (error: any) {
    console.error("[Telegram API Error]:", error);
    return res.status(500).json({ success: false, error: error.message || "خطأ في السيرفر" });
  }
});

const sitePath = path.join(process.cwd(), "_site");
const indexPath = path.join(sitePath, "index.html");

if (!fs.existsSync(indexPath)) {
  console.log("Building Eleventy site...");
  try {
    execSync("npx @11ty/eleventy", { stdio: "inherit" });
  } catch (err) {
    console.error("Eleventy build error:", err);
  }
}

// Smart URL resolution middleware to handle date-prefixed, spaces, and clean URLs seamlessly
app.use((req, res, next) => {
  if (req.method !== "GET") return next();

  try {
    const rawPath = req.path;
    const decodedPath = decodeURIComponent(rawPath);
    const match = decodedPath.match(/^\/(news|shows|recaps)\/(.+)$/);

    if (match) {
      const section = match[1];
      let requestedSlug = match[2];

      if (requestedSlug.endsWith(".html")) {
        requestedSlug = requestedSlug.slice(0, -5);
      }

      const sectionDir = path.join(sitePath, section);
      if (fs.existsSync(sectionDir)) {
        // Direct file check first
        const directFile = path.join(sectionDir, `${requestedSlug}.html`);
        if (fs.existsSync(directFile)) {
          return res.sendFile(directFile);
        }

        const files = fs.readdirSync(sectionDir);
        const norm = (s: string) => s
          .normalize('NFD')
          .replace(/[\u0300-\u036f]/g, '')
          .toLowerCase()
          .replace(/\.html$/, '')
          .replace(/^\d{4}-\d{2}-\d{2}-/, '')
          .replace(/[\s\-_]+/g, '');

        const targetNorm = norm(requestedSlug);
        if (targetNorm) {
          const foundFile = files.find(f => norm(f) === targetNorm);
          if (foundFile) {
            return res.sendFile(path.join(sectionDir, foundFile));
          }
        }
      }
    }
  } catch (e) {}

  next();
});

// Serve static assets from _site
app.use(express.static(sitePath, {
  extensions: ["html", "htm"],
  index: "index.html"
}));

// Route for admin CMS
app.use("/admin", express.static(path.join(sitePath, "admin")));

// Fallback route
app.get("*", (req, res) => {
  const file404 = path.join(sitePath, "404.html");
  if (fs.existsSync(file404)) {
    res.status(404).sendFile(file404);
  } else if (fs.existsSync(indexPath)) {
    res.sendFile(indexPath);
  } else {
    res.status(404).send("Page not found");
  }
});

app.listen(PORT, "0.0.0.0", () => {
  console.log(`Server listening on http://0.0.0.0:${PORT}`);
});
