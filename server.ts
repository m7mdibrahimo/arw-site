import express from "express";
import path from "path";
import fs from "fs";
import { execSync } from "child_process";

const app = express();
const PORT = 3000;

app.use(express.json());

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || "8557696064:AAF_OwtfWAfI1820xx4fj96zj_fY5GcxX5s";
const CHAT_ID = process.env.TELEGRAM_CHAT_ID || "@arab_wrestling";

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
    const { title, text, url, image } = req.body;
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
