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
  try {
    const { title, text, url, image, collection, kind } = req.body;
    if (!title && !text) {
      return res.status(400).json({ success: false, error: "العنوان أو النص مطلوب" });
    }

    const messageText = `<b>${title || ""}</b>\n\n${text || ""}\n\n🔗 <a href="${url || 'https://arab-wrestling.com'}">اقرأ الخبر كاملاً على موقع عرب راسلنج</a>`;

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

    const tgRes = await fetch(telegramUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });

    const result = await tgRes.json();

    // Trigger Web Push notification if it's a Show or Recap!
    if (url && (url.includes("/shows/") || url.includes("/recaps/") || collection === "shows" || collection === "recaps")) {
      sendPushToAllSubscribers({ title, text, url, image, collection, kind }).catch((e) =>
        console.error("Error triggering push on Telegram post:", e)
      );
    }

    if (result.ok) {
      res.json({ success: true, message: "تم نشر الخبر بنجاح على قناة التليجرام!", result });
    } else {
      res.status(400).json({ success: false, error: result.description || "فشل النشر", result });
    }
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
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
