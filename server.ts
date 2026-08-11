import express from "express";
import path from "path";
import fs from "fs";
import { execSync, exec } from "child_process";
import webpush from "web-push";

const app = express();
const PORT = 3000;

app.use(express.json());

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

// Manage Telegram Sent Posts Deduplication and Pending Queue
const TG_SENT_FILE = path.join(process.cwd(), "telegram_sent.json");
const TG_PENDING_FILE = path.join(process.cwd(), "telegram_pending.json");

function getTelegramSentMap(): Record<string, number> {
  if (!fs.existsSync(TG_SENT_FILE)) return {};
  try {
    return JSON.parse(fs.readFileSync(TG_SENT_FILE, "utf-8")) || {};
  } catch (e) {
    return {};
  }
}

function saveTelegramSentMap(map: Record<string, number>) {
  try {
    fs.writeFileSync(TG_SENT_FILE, JSON.stringify(map, null, 2));
  } catch (e) {}
}

function getTelegramPendingQueue(): Record<string, any> {
  if (!fs.existsSync(TG_PENDING_FILE)) return {};
  try {
    return JSON.parse(fs.readFileSync(TG_PENDING_FILE, "utf-8")) || {};
  } catch (e) {
    return {};
  }
}

function saveTelegramPendingQueue(queue: Record<string, any>) {
  try {
    fs.writeFileSync(TG_PENDING_FILE, JSON.stringify(queue, null, 2));
  } catch (e) {}
}

function escapeTelegramHtml(str: string): string {
  if (!str) return "";
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
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
    if (fs.existsSync(p) && fs.statSync(p).isFile()) {
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
}) {
  try {
    const { title, text, url, image } = data;
    const articleUrl = normalizeArticleUrl(url || 'https://arab-wrestling.com');

    let fullImageUrl = image;
    if (image && typeof image === 'string' && !image.startsWith('http')) {
      fullImageUrl = 'https://arab-wrestling.com' + (image.startsWith('/') ? '' : '/') + image;
    }

    const safeTitle = escapeTelegramHtml(title || "");
    const safeText = escapeTelegramHtml(text || "");
    const messageHtml = `<b>${safeTitle}</b>\n\n${safeText}\n\n🔗 <a href="${articleUrl}"><b>تابع المحتوى على موقع عرب راسلنج</b></a>`;

    let result: any = { ok: false };
    const localImgPath = resolveLocalImagePath(image);

    // Strategy 1: Direct File Binary Upload via FormData (100% Guaranteed for local image files)
    if (localImgPath) {
      try {
        console.log(`[Telegram] Found local image file at ${localImgPath}, uploading binary directly...`);
        const fileBuffer = fs.readFileSync(localImgPath);
        const ext = path.extname(localImgPath).toLowerCase();
        let mimeType = 'image/jpeg';
        if (ext === '.png') mimeType = 'image/png';
        else if (ext === '.webp') mimeType = 'image/webp';
        else if (ext === '.gif') mimeType = 'image/gif';

        const blob = new Blob([new Uint8Array(fileBuffer)], { type: mimeType });
        const formData = new FormData();
        formData.append("chat_id", CHAT_ID);
        formData.append("photo", blob, path.basename(localImgPath));
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
        } else {
          console.warn("[Telegram] Direct file upload sendPhoto returned error:", result);
        }
      } catch (fileErr) {
        console.error("[Telegram] Error uploading local image file:", fileErr);
      }
    }

    // Strategy 2: Fetch remote image buffer and upload via FormData
    if (!result.ok && fullImageUrl) {
      try {
        console.log(`[Telegram] Trying to fetch remote image from ${fullImageUrl}...`);
        const imgRes = await fetch(fullImageUrl);
        if (imgRes.ok) {
          const arrayBuffer = await imgRes.arrayBuffer();
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
        }
      } catch (fetchErr) {
        console.warn("[Telegram] Failed to fetch remote image buffer:", fetchErr);
      }
    }

    // Strategy 3: sendPhoto using URL string
    if (!result.ok && fullImageUrl) {
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
      } catch (urlErr) {
        console.warn("[Telegram] sendPhoto via URL string failed:", urlErr);
      }
    }

    // Strategy 4: Fallback to sendMessage HTML (Text only)
    if (!result.ok) {
      console.warn("[Telegram] Photo upload failed all attempts, falling back to sendMessage HTML...", result);
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
    }

    // Strategy 5: Plain text sendMessage without HTML formatting
    if (!result.ok) {
      console.warn("[Telegram] HTML parse failed, retrying plain text sendMessage...", result);
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

// Background Worker: Checks pending queue every 10 seconds and sends delayed posts
async function processTelegramPendingQueue() {
  const queue = getTelegramPendingQueue();
  const sentMap = getTelegramSentMap();
  const now = Date.now();
  let updated = false;

  for (const key in queue) {
    const item = queue[key];
    if (now >= item.publishAt) {
      // Only skip if sent very recently (less than 2 minutes ago, e.g. sent via immediate trigger)
      if (sentMap[key] && (now - sentMap[key] < 120000)) {
        console.log(`[Telegram Queue] Skipping ${key} as it was already sent very recently.`);
        delete queue[key];
        updated = true;
        continue;
      }

      console.log(`[Telegram Queue] Executing delayed post to Telegram for: ${item.title}`);
      try {
        const result = await executeTelegramPost(item);
        if (result.ok) {
          sentMap[key] = Date.now();
          saveTelegramSentMap(sentMap);
          delete queue[key];
          updated = true;
        } else {
          item.retries = (item.retries || 0) + 1;
          if (item.retries >= 5) {
            console.error(`[Telegram Queue] Dropping post after 5 failures: ${key}`, result);
            delete queue[key];
          } else {
            item.publishAt = now + 30000; // Retry in 30 seconds
          }
          updated = true;
        }
      } catch (err) {
        console.error(`[Telegram Queue] Error processing ${key}:`, err);
        item.retries = (item.retries || 0) + 1;
        if (item.retries >= 5) {
          delete queue[key];
        } else {
          item.publishAt = now + 30000;
        }
        updated = true;
      }
    }
  }

  if (updated) {
    saveTelegramPendingQueue(queue);
  }
}

// Start queue background processor
setInterval(processTelegramPendingQueue, 10000);

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
    if (!title && !text) {
      return res.status(400).json({ success: false, error: "العنوان أو النص مطلوب" });
    }

    // Trigger Eleventy build in background so static page is generated immediately
    exec("npx @11ty/eleventy", (err) => {
      if (err) console.error("[Eleventy AutoBuild Error]:", err);
      else console.log("[Eleventy AutoBuild] Site rebuilt successfully for new post!");
    });

    // Generate strict unique deduplication key
    const rawKey = postId || url || slug || id || title || "";
    const dedupKey = rawKey.toString().toLowerCase().trim().replace(/[^a-z0-9\u0600-\u06FF_-]/g, "");

    const sentMap = getTelegramSentMap();
    const pendingQueue = getTelegramPendingQueue();

    // Check if sent recently (less than 10 minutes) unless force/immediate is passed
    const lastSentTime = sentMap[dedupKey];
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
          sentMap[dedupKey] = Date.now();
          saveTelegramSentMap(sentMap);
        }
        if (url && (url.includes("/shows/") || url.includes("/recaps/") || collection === "shows" || collection === "recaps")) {
          sendPushToAllSubscribers({ title, text, url, image, collection, kind }).catch((e) => {});
        }
        return res.json({ success: true, message: "تم النشر فوراً على التليجرام!", result });
      } else {
        return res.status(400).json({ success: false, error: result.description || "فشل النشر", result });
      }
    }

    // Default delay: 3 MINUTES (180,000 ms) as requested
    const delayMs = req.body?.delayMs !== undefined ? Number(req.body.delayMs) : 180000;
    const publishAt = Date.now() + delayMs;

    pendingQueue[dedupKey] = {
      postId: dedupKey,
      title,
      text,
      url,
      image,
      collection,
      kind,
      publishAt,
      retries: 0
    };

    saveTelegramPendingQueue(pendingQueue);

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
