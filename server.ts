import express from "express";
import path from "path";
import fs from "fs";
import { execSync } from "child_process";
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
    const articleUrl = url || 'https://arab-wrestling.com';
    const messageText = `<b>${title || ""}</b>\n\n${text || ""}\n\n🔗 <a href="${articleUrl}"><b>تابع المحتوى على موقع عرب راسلنج</b></a>`;

    let telegramUrl = `https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`;
    let payload: any = {
      chat_id: CHAT_ID,
      text: messageText,
      parse_mode: "HTML",
      disable_web_page_preview: false
    };

    if (image) {
      telegramUrl = `https://api.telegram.org/bot${BOT_TOKEN}/sendPhoto`;
      payload = {
        chat_id: CHAT_ID,
        photo: image,
        caption: messageText,
        parse_mode: "HTML"
      };
    }

    let tgRes = await fetch(telegramUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });

    let result = await tgRes.json().catch(() => ({ ok: false, description: "Invalid response from Telegram API" }));

    // Fallback to text sendMessage if sendPhoto failed
    if (!result.ok && image) {
      console.warn("[Telegram] sendPhoto failed, retrying with sendMessage...", result);
      telegramUrl = `https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`;
      payload = {
        chat_id: CHAT_ID,
        text: messageText,
        parse_mode: "HTML",
        disable_web_page_preview: false
      };
      tgRes = await fetch(telegramUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });
      result = await tgRes.json().catch(() => ({ ok: false, description: "Invalid response from Telegram API" }));
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
      if (sentMap[key]) {
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

          // Trigger Web Push Notification for Shows & Recaps after 3-minute delay!
          if (item.url && (item.url.includes("/shows/") || item.url.includes("/recaps/") || item.collection === "shows" || item.collection === "recaps")) {
            sendPushToAllSubscribers(item).catch((e) =>
              console.error("Error sending push notification:", e)
            );
          }
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
    const { title, text, url, image, collection, kind, id, slug, postId, immediate } = req.body || {};
    if (!title && !text) {
      return res.status(400).json({ success: false, error: "العنوان أو النص مطلوب" });
    }

    // Generate strict unique deduplication key
    const rawKey = postId || url || slug || id || title || "";
    const dedupKey = rawKey.toString().toLowerCase().trim().replace(/[^a-z0-9\u0600-\u06FF_-]/g, "");

    const sentMap = getTelegramSentMap();
    const pendingQueue = getTelegramPendingQueue();

    if (dedupKey && (sentMap[dedupKey] || pendingQueue[dedupKey])) {
      console.log(`[Telegram] Duplicate or already queued post for key: ${dedupKey}`);
      return res.json({
        success: true,
        message: "تم تسجيل هذا الموضوع مسبقاً وسيرسل في موعده المحدد",
        alreadySent: true
      });
    }

    // If immediate send is explicitly requested (e.g., manual test)
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

    // Default behavior: Schedule post after 3 MINUTES (180,000 ms) delay
    // This allows static site generator to complete building page & uploading images!
    const delayMs = req.body?.delayMs || (3 * 60 * 1000); // 3 Minutes
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
      message: "تم تسجيل الموضوع بنجاح! سيتم نشره تلقائياً على التليجرام وشبكة الإشعارات بعد 3 دقائق لضمان اكتمال بناء الصفحة والميديا على الموقع."
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
