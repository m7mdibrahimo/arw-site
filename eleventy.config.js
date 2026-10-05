const Image = require("@11ty/eleventy-img").default;
const fs = require("fs");
const path = require("path");

// خريطة أسماء بعض مواقع التحميل الشائعة عشان تظهر بشكل احترافي بدل اسم الدومين الخام
const KNOWN_HOST_NAMES = {
  "multiup.io": "MultiUp",
  "playmogo.com": "PlayMogo",
  "streamtape.com": "StreamTape",
  "mediafire.com": "MediaFire",
  "mega.nz": "MEGA",
  "gofile.io": "GoFile",
  "1fichier.com": "1Fichier",
  "pixeldrain.com": "PixelDrain",
  "dood.re": "DoodStream",
  "dood.to": "DoodStream",
  "dropgalaxy.in": "DropGalaxy",
  "krakenfiles.com": "KrakenFiles",
  "send.cm": "Send.cm",
  "uptobox.com": "UptoBox",
  "uqload.vc": "Uqload",
  "uqload.to": "Uqload",
  "uqload.com": "Uqload",
  "uqload.co": "Uqload",
  "uqload.io": "Uqload",
  "uqload.net": "Uqload",
  "vidtube.one": "VidTube",
  "vidtube.me": "VidTube",
  "vidtube.io": "VidTube",
  "vidtube.to": "VidTube",
  "vidtube.com": "VidTube",
  "vidtube.net": "VidTube",
  "vidtube.site": "VidTube",
  "streamhg.com": "StreamHG",
  "streamhg.to": "StreamHG",
  "hgcloud.to": "StreamHG",
  "hgcloud.io": "StreamHG",
  "hgcloud.com": "StreamHG",
};

// لوجوهات مخصصة عالية الدقة لمواقع التحميل
const KNOWN_HOST_LOGOS = {
  "uqload.vc": "/assets/hosts/uqload.png",
  "uqload.to": "/assets/hosts/uqload.png",
  "uqload.com": "/assets/hosts/uqload.png",
  "uqload.co": "/assets/hosts/uqload.png",
  "uqload.io": "/assets/hosts/uqload.png",
  "uqload.net": "/assets/hosts/uqload.png",
  "vidtube.one": "/assets/hosts/vidtube.png",
  "vidtube.me": "/assets/hosts/vidtube.png",
  "vidtube.io": "/assets/hosts/vidtube.png",
  "vidtube.to": "/assets/hosts/vidtube.png",
  "vidtube.com": "/assets/hosts/vidtube.png",
  "vidtube.net": "/assets/hosts/vidtube.png",
  "vidtube.site": "/assets/hosts/vidtube.png",
  "streamhg.com": "/assets/hosts/streamhg.png",
  "streamhg.to": "/assets/hosts/streamhg.png",
  "hgcloud.to": "/assets/hosts/streamhg.png",
  "hgcloud.io": "/assets/hosts/streamhg.png",
  "hgcloud.com": "/assets/hosts/streamhg.png",
};

function hostFromUrl(url) {
  try {
    const raw = String(url || "").trim();
    const withProto = raw.startsWith("http://") || raw.startsWith("https://") ? raw : `https://${raw}`;
    return new URL(withProto).hostname.replace(/^www\./, "").toLowerCase();
  } catch (e) {
    return "";
  }
}

function siteNameFromHost(host) {
  if (!host) return "رابط تحميل";
  if (KNOWN_HOST_NAMES[host]) return KNOWN_HOST_NAMES[host];
  if (host.includes("streamhg") || host.includes("hgcloud") || host.includes("shgcloud") || host.includes("hgplayer") || host.includes("hgstream")) {
    return "StreamHG";
  }
  // لو فيه سب دومين زي e24.uqload.vc أو dl.vidtube.one
  const parts = host.split(".");
  if (parts.length > 2) {
    const root = parts.slice(-2).join(".");
    if (KNOWN_HOST_NAMES[root]) return KNOWN_HOST_NAMES[root];
    if (root.includes("streamhg") || root.includes("hgcloud") || root.includes("shgcloud") || root.includes("hgplayer") || root.includes("hgstream")) {
      return "StreamHG";
    }
  }
  const base = host.split(".")[0];
  return base.charAt(0).toUpperCase() + base.slice(1);
}

// بيحدد الجودة (منخفضة/متوسطة/عالية) بناءً على نص الـ label أو رقم الجودة الموجود جوه الرابط نفسه
function detectQuality(text) {
  const t = (text || "").toLowerCase();
  if (t.includes("منخفضة") || t.includes("480")) return "low";
  if (t.includes("متوسطة") || t.includes("720")) return "medium";
  if (t.includes("عالية") || t.includes("1080") || t.includes("4k") || t.includes("2160")) return "high";
  return null;
}

// بياخد نص (ممكن يكون فيه أكتر من رابط، كل رابط في سطر) ويرجع مصفوفة روابط نضيفة (بيلقط أي رابط حتى لو مكتوب مع نص أو بدون https://)
function extractUrls(text) {
  if (!text) return [];
  const lines = String(text).split(/[\r\n]+/);
  const result = [];
  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) continue;
    const httpMatches = line.match(/https?:\/\/[^\s"'<>\)]+/g);
    if (httpMatches) {
      httpMatches.forEach(function (u) {
        const cleaned = u.replace(/[\.,;:!]+$/, "");
        if (cleaned) result.push(cleaned);
      });
    } else {
      const cleaned = line.replace(/^[-\*\d\.\s]+/, "").replace(/[\.,;:!]+$/, "").trim();
      if (/^[a-zA-Z0-9-]+\.[a-zA-Z]{2,}(\/[^\s"'<>\)]*)?$/.test(cleaned)) {
        result.push("https://" + cleaned);
      }
    }
  }
  return result;
}

// بياخد مصفوفة downloads (بأي صيغة من الصيغ القديمة) + نصوص الصناديق الجديدة الصريحة من اللوحة
// (downloadsLow/downloadsMedium/downloadsHigh - كل واحد نص فيه رابط أو أكتر، كل رابط في سطر)
// ويرجعهم مقسمين لـ 3 مجموعات جاهزة للعرض، مع تعرف تلقائي على اسم ولوجو كل موقع
function groupDownloadsByQuality(downloads, downloadsLow, downloadsMedium, downloadsHigh) {
  const groups = { low: [], medium: [], high: [] };

  function pushItem(quality, url, hintText) {
    if (!url) return;
    const host = hostFromUrl(url);
    const site = siteNameFromHost(host);
    let logo = KNOWN_HOST_LOGOS[host] || KNOWN_HOST_LOGOS[rootHost];
    if (!logo && (host.includes("streamhg") || host.includes("hgcloud") || host.includes("shgcloud") || host.includes("hgplayer") || host.includes("hgstream"))) {
      logo = "/assets/hosts/streamhg.png";
    }
    if (!logo) {
      logo = `https://www.google.com/s2/favicons?domain=${host}&sz=64`;
    }
    const item = { url: url, site: site, host: host, logo: logo };
    const detected = quality || detectQuality(hintText) || detectQuality(url);

    if (detected === "low") {
      groups.low.push(item);
    } else if (detected === "medium") {
      groups.medium.push(item);
    } else if (detected === "high") {
      groups.high.push(item);
    } else {
      // لو الرابط مش محدد له جودة (زي روابط "تحميل متعدد" اللي فيها كل الجودات)
      // نعرضه في الثلاث خانات لأنه صالح لأي جودة يختارها الزائر
      groups.low.push(item);
      groups.medium.push(item);
      groups.high.push(item);
    }
  }

  // الصناديق الجديدة الصريحة من اللوحة (نص فيه رابط أو أكتر، الموقع هيتعرف على كل رابط لوحده تلقائيًا)
  extractUrls(downloadsLow).slice(0, 15).forEach(function (u) { pushItem("low", u); });
  extractUrls(downloadsMedium).slice(0, 15).forEach(function (u) { pushItem("medium", u); });
  extractUrls(downloadsHigh).slice(0, 15).forEach(function (u) { pushItem("high", u); });

  // الصيغ القديمة الموجودة في المقالات السابقة (عشان مقالاتك القديمة تفضل شغالة زي ما هي)
  (downloads || []).forEach(function (d) {
    if (!d) return;
    if (d.url_low || d.url_medium || d.url_high) {
      pushItem("low", d.url_low, d.label);
      pushItem("medium", d.url_medium, d.label);
      pushItem("high", d.url_high, d.label);
    } else if (d.url) {
      pushItem(null, d.url, d.label);
    }
  });

  return groups;
}

const { arabicSlug } = require("./lib/slug.cjs");
const { toEmbedUrl } = require("./lib/embed.cjs");
const { obfuscateUrl } = require("./lib/obfuscate.cjs");

// بيوحّد أشكال الألف المختلفة (أ إ آ) لألف عادية (ا) عشان "اخبار المصارعة" و"أخبار المصارعة"
// يتحسبوا نفس الوسم بدل ما يتقسموا لصفحتين منفصلتين. بيتستخدم بس لحساب الـ slug (تجميع/تصنيف)،
// مش للعنوان أو الرابط الأصلي بتاع المقالات، عشان مايغيرش أي رابط مقال موجود بالفعل.
// Tag pages with fewer items are noindex (pages/tag.njk) and are not linked (tagHref).
const MIN_INDEXED_TAG_ITEMS = 3;
let tagCountBySlug = new Map();

function normalizeArabicHamza(str) {
  if (!str) return "";
  return str.toString().replace(/[أإآ]/g, 'ا');
}

function ytFacade(ytId) {
  return `<div class="social-embed-box embed-yt-wrap yt-facade" data-yt="${ytId}" dir="ltr" lang="en"><button type="button" class="yt-facade-btn" aria-label="تشغيل فيديو يوتيوب"><img src="https://i.ytimg.com/vi/${ytId}/hqdefault.jpg" alt="" loading="lazy" decoding="async"><span class="yt-play" aria-hidden="true"></span></button><a class="yt-facade-link" href="https://www.youtube.com/watch?v=${ytId}" target="_blank" rel="noopener">فتح على YouTube</a></div>`;
}

module.exports = function(eleventyConfig) {
  console.log("=== ELEVENTY CONFIG EXECUTING ===");
  // One line per written file (5000+) only slows the host's build log down.
  eleventyConfig.setQuietMode(true);

  // Resized article images (optImg → _site/img) are reused between builds, so a build only
  // resizes new images instead of all ~2000 (about a minute on the host). Locally they stay in
  // ".cache/optimg". Cloudflare's build cache doesn't carry any folder of ours between builds
  // (".cache" is kept only for projects it detects as Eleventy; checked in the build logs), so
  // there each build takes the already-resized files from the live site, listed in
  // /img-cache.json. A file's name is a hash of its source and settings, so the same name is
  // always the same picture; eleventy-img skips any output that already exists.
  const IMG_CACHE = ".cache/optimg";
  const IMG_RE = /^[A-Za-z0-9_-]+-\d+\.(jpeg|jpg|png|webp|avif)$/;
  const LIVE = process.env.ARW_LIVE_ORIGIN || "https://arab-wrestling.com";
  const syncDir = (from, to) => {
    if (!fs.existsSync(from)) return 0;
    fs.mkdirSync(to, { recursive: true });
    const have = new Set(fs.readdirSync(to));
    let n = 0;
    for (const f of fs.readdirSync(from)) {
      if (have.has(f)) continue;
      fs.copyFileSync(path.join(from, f), path.join(to, f));
      n++;
    }
    return n;
  };
  const fetchLiveImages = async () => {
    const started = Date.now();
    const list = await fetch(`${LIVE}/img-cache.json?_=${Date.now()}`, { signal: AbortSignal.timeout(10000) }).then(r => (r.ok ? r.json() : []));
    fs.mkdirSync("_site/img", { recursive: true });
    const have = new Set(fs.readdirSync("_site/img"));
    const todo = (Array.isArray(list) ? list : []).filter(f => typeof f === "string" && IMG_RE.test(f) && !have.has(f));
    let ok = 0, next = 0;
    const worker = async () => {
      while (next < todo.length) {
        const f = todo[next++];
        try {
          const r = await fetch(`${LIVE}/img/${f}`, { signal: AbortSignal.timeout(20000) });
          if (!r.ok || !String(r.headers.get("content-type") || "").startsWith("image/")) continue;
          const buf = Buffer.from(await r.arrayBuffer());
          const len = Number(r.headers.get("content-length") || 0);
          if (!buf.length || (len && len !== buf.length)) continue;
          const tmp = path.join("_site/img", `.${f}.part`);
          fs.writeFileSync(tmp, buf);
          fs.renameSync(tmp, path.join("_site/img", f));
          ok++;
        } catch {}
      }
    };
    await Promise.all(Array.from({ length: 32 }, worker));
    return `${ok}/${todo.length} from the live site in ${((Date.now() - started) / 1000).toFixed(1)}s`;
  };
  eleventyConfig.on("eleventy.before", async () => {
    try { console.log(`[img-cache] restored ${process.env.CF_PAGES ? await fetchLiveImages() : syncDir(IMG_CACHE, "_site/img")} resized images`); }
    catch (e) { console.log(`[img-cache] restore skipped: ${e.message}`); }
  });
  // /build.json: which commits this deployment contains, so the panel can say «ظهر على الموقع ✓»
  // the moment a save is really live instead of guessing a delay.
  eleventyConfig.on("eleventy.after", () => {
    try {
      const { execSync } = require("child_process");
      const git = (cmd) => { try { return execSync(cmd, { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim(); } catch { return ""; } };
      const commit = process.env.CF_PAGES_COMMIT_SHA || git("git rev-parse HEAD");
      const commitTime = Number(git("git log -1 --format=%ct")) || 0;
      const recent = git("git log -60 --format=%H").split("\n").filter(Boolean);
      fs.mkdirSync("_site", { recursive: true });
      fs.writeFileSync("_site/build.json", JSON.stringify({ commit, commitTime, recent, builtAt: new Date().toISOString() }));
    } catch (e) { console.log(`[build.json] skipped: ${e.message}`); }
  });
  eleventyConfig.on("eleventy.after", () => {
    try {
      const files = fs.existsSync("_site/img") ? fs.readdirSync("_site/img").filter(f => IMG_RE.test(f)) : [];
      fs.writeFileSync("_site/img-cache.json", JSON.stringify(files));
      if (!process.env.CF_PAGES) console.log(`[img-cache] saved ${syncDir("_site/img", IMG_CACHE)} new resized images`);
    } catch (e) { console.log(`[img-cache] save skipped: ${e.message}`); }
  });
  eleventyConfig.addGlobalData("buildTime", () => new Date().toISOString());

  // The home slider shows each pinned item as it is NOW. _data/pinned.json keeps a copy
  // taken when the item was pinned, so an edited headline/description/image never reached
  // the slider (AEW All Out Tailgate Brawl kept the All Out headline and an "All In London"
  // description after being fixed — 2026-09-27). The copy is only a fallback now.
  eleventyConfig.addFilter("freshPinned", (pinned, all) => {
    if (!Array.isArray(pinned)) return pinned;
    const norm = (u) => { let x = String(u || ""); try { x = decodeURIComponent(x); } catch (e) {} return x.replace(/index\.html$/, "").replace(/\/?$/, "/"); };
    const byUrl = new Map((all || []).map((p) => [norm(p.url), p]));
    return pinned.map((item) => {
      const page = byUrl.get(norm(item.url));
      if (!page) return item;
      const d = page.data || {};
      const isShow = item.kind === "show" || item.kind === "recap" || /\/(shows|recaps|nostalgia)\//.test(page.url);
      return {
        ...item,
        title: (isShow ? d.headline || d.title : d.title) || item.title,
        subtitle: isShow ? d.title || item.subtitle : item.subtitle,
        image: d.image || item.image,
        description: d.description || item.description,
        federation: d.federation || item.federation,
      };
    });
  });
  eleventyConfig.addFilter("arabicSlug", arabicSlug);
  eleventyConfig.addNunjucksFilter("arabicSlug", arabicSlug);
  eleventyConfig.addFilter("slug", arabicSlug);
  eleventyConfig.addNunjucksFilter("slug", arabicSlug);
  eleventyConfig.addFilter("toEmbedUrl", toEmbedUrl);
  eleventyConfig.addNunjucksFilter("toEmbedUrl", toEmbedUrl);
  eleventyConfig.addFilter("obfuscateUrl", obfuscateUrl);
  eleventyConfig.addNunjucksFilter("obfuscateUrl", obfuscateUrl);

  const cleanUrl = function(url) {
    if (!url) return "";
    return url.toString().replace(/\.html$/, '');
  };
  eleventyConfig.addFilter("cleanUrl", cleanUrl);
  eleventyConfig.addNunjucksFilter("cleanUrl", cleanUrl);

  // بيحول مدة زي "02:15:05" أو "45:12" أو "00:19::15" لصيغة ISO 8601 (PT2H15M5S) المطلوبة في Schema.org VideoObject
  const parseCleanDuration = function(str) {
    if (!str) return null;
    const cleanStr = str.toString().trim().replace(/^['"\s]+|['"\s]+$/g, "");
    if (!cleanStr) return null;
    const nums = (cleanStr.match(/\d+/g) || []).map(function(n){ return parseInt(n, 10); });
    if (!nums.length) return null;
    let h = 0, m = 0, s = 0;
    if (nums.length >= 3) {
      h = nums[0];
      m = nums[1];
      s = nums[2];
    } else if (nums.length === 2) {
      if (cleanStr.endsWith(":")) {
        h = nums[0];
        m = nums[1];
        s = 0;
      } else {
        m = nums[0];
        s = nums[1];
      }
    } else if (nums.length === 1) {
      s = nums[0];
    }
    const totalSec = h * 3600 + m * 60 + s;
    if (totalSec <= 0) return null;
    return { h: h, m: m, s: s, totalSec: totalSec };
  };

  const isoDuration = function(str) {
    const parsed = parseCleanDuration(str);
    if (!parsed) return "";
    let out = "PT";
    if (parsed.h) out += parsed.h + "H";
    if (parsed.m) out += parsed.m + "M";
    if (parsed.s) out += parsed.s + "S";
    return out;
  };
  eleventyConfig.addFilter("isoDuration", isoDuration);
  eleventyConfig.addNunjucksFilter("isoDuration", isoDuration);

  // بيحول مدة الفيديو إلى ثوانٍ رقمية (مثل 7200) المطلوبة في خريطة فيديوهات جوجل
  const durationSeconds = function(str) {
    const parsed = parseCleanDuration(str);
    return parsed ? parsed.totalSec : null;
  };
  eleventyConfig.addFilter("durationSeconds", durationSeconds);
  eleventyConfig.addNunjucksFilter("durationSeconds", durationSeconds);

  // يضمن أن رابط مشغل الفيديو يبدأ بـ https:// دائماً ومطابق لاشتراطات خرائط جوجل
  const safePlayerUrl = function(url) {
    if (!url) return "";
    const u = url.toString().trim();
    if (u.startsWith("http://") || u.startsWith("https://")) return u;
    if (u.startsWith("//")) return "https:" + u;
    return "https://" + u;
  };
  eleventyConfig.addFilter("safePlayerUrl", safePlayerUrl);
  eleventyConfig.addNunjucksFilter("safePlayerUrl", safePlayerUrl);

  // بيحول أي رابط صورة/ملف لرابط مطلق كامل (لو كان نسبي زي /content/images/x.jpg)
  const absUrl = function(url) {
    if (!url) return "";
    const u = url.toString();
    if (u.startsWith("http://") || u.startsWith("https://")) return u;
    return "https://arab-wrestling.com" + (u.startsWith("/") ? u : "/" + u);
  };
  eleventyConfig.addFilter("absUrl", absUrl);
  eleventyConfig.addNunjucksFilter("absUrl", absUrl);

  // اسم عرض نظيف لمصدر الخبر انطلاقا من source_url (fightful.com -> Fightful.com)
  const KNOWN_SOURCE_NAMES = { "fightful.com": "Fightful.com", "wrestlinginc.com": "Wrestling Inc", "ringsidenews.com": "Ringside News" };
  const sourceName = function(url) {
    if (!url) return "";
    try {
      const host = new URL(url).hostname.replace(/^www\./, "");
      return KNOWN_SOURCE_NAMES[host] || host;
    } catch (e) {
      return "";
    }
  };
  eleventyConfig.addFilter("sourceName", sourceName);
  eleventyConfig.addNunjucksFilter("sourceName", sourceName);

  const dateObj = function(str) {
    return new Date(str);
  };
  eleventyConfig.addFilter("dateObj", dateObj);
  eleventyConfig.addNunjucksFilter("dateObj", dateObj);

  const arabicShowName = function(str) {
    if (!str) return "";
    return str
      .replace(/\bRAW\b/gi, 'الرو')
      .replace(/\bNXT\b/gi, 'ان اكس تي')
      .replace(/\b(Smackdown|SmackDown)\b/gi, 'سماكداون')
      .replace(/\bDynamite\b/gi, 'ديناميت')
      .replace(/\bCollision\b/gi, 'كوليجن')
      .replace(/\bRampage\b/gi, 'رامبيج')
      .replace(/\bRoyal Rumble\b/gi, 'رويال رامبل')
      .replace(/\bWrestleMania\b/gi, 'ريسلمانيا')
      .replace(/\bSummerSlam\b/gi, 'سمرسلام');
  };
  eleventyConfig.addFilter("arabicShowName", arabicShowName);
  eleventyConfig.addNunjucksFilter("arabicShowName", arabicShowName);

  const stripDate = function(str) {
    if (!str) return "";
    return str
      .toString()
      .replace(/\b\d{1,2}[\.\/\-]\d{1,2}[\.\/\-]\d{2,4}\b/gi, '')
      .replace(/\b(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]* \d{1,2},? \d{2,4}\b/gi, '')
      .replace(/\s+/g, ' ')
      .trim();
  };
  eleventyConfig.addFilter("stripDate", stripDate);
  eleventyConfig.addNunjucksFilter("stripDate", stripDate);

  const formatDate = function(dateObj, format) {
    if (!dateObj) return "";
    let day, month, year;
    const months = ["يناير","فبراير","مارس","أبريل","مايو","يونيو","يوليو","أغسطس","سبتمبر","أكتوبر","نوفمبر","ديسمبر"];

    if (dateObj instanceof Date) {
      if (isNaN(dateObj.getTime())) return "";
      day = dateObj.getUTCDate();
      month = dateObj.getUTCMonth();
      year = dateObj.getUTCFullYear();
    } else if (typeof dateObj === "string") {
      const str = dateObj.trim();
      const ymdMatch = str.match(/^(\d{4})[\.\/\-](\d{1,2})[\.\/\-](\d{1,2})/);
      if (ymdMatch) {
        year = parseInt(ymdMatch[1], 10);
        month = parseInt(ymdMatch[2], 10) - 1;
        day = parseInt(ymdMatch[3], 10);
      } else {
        const dmyMatch = str.match(/^(\d{1,2})[\.\/\-](\d{1,2})[\.\/\-](\d{4})/);
        if (dmyMatch) {
          day = parseInt(dmyMatch[1], 10);
          month = parseInt(dmyMatch[2], 10) - 1;
          year = parseInt(dmyMatch[3], 10);
        }
      }
    }

    if (day === undefined || isNaN(day) || month === undefined || isNaN(month) || year === undefined || isNaN(year)) {
      const d = new Date(dateObj);
      if (isNaN(d.getTime())) return String(dateObj);
      day = d.getUTCDate();
      month = d.getUTCMonth();
      year = d.getUTCFullYear();
    }

    if (month >= 0 && month < 12 && day > 0 && year > 0) {
      return day + " " + months[month] + " " + year;
    }
    return String(dateObj);
  };
  eleventyConfig.addFilter("date", formatDate);
  eleventyConfig.addNunjucksFilter("date", formatDate);

  const jsonify = function(obj){
    return JSON.stringify(obj);
  };
  eleventyConfig.addFilter("jsonify", jsonify);
  eleventyConfig.addNunjucksFilter("jsonify", jsonify);

  // Pagination Helper: Smart Compact Range with Ellipses
  const smartPagination = function(pagination) {
    if (!pagination || !pagination.hrefs || pagination.hrefs.length <= 1) return [];

    const total = pagination.hrefs.length;
    const current = (pagination.pageNumber !== undefined ? pagination.pageNumber : 0) + 1;
    const delta = 2;

    const range = [];
    const rangeWithDots = [];
    let l;

    for (let i = 1; i <= total; i++) {
      if (i === 1 || i === total || (i >= current - delta && i <= current + delta)) {
        range.push(i);
      }
    }

    for (let i of range) {
      if (l) {
        if (i - l === 2) {
          rangeWithDots.push({
            pageNum: l + 1,
            url: pagination.hrefs[l],
            isCurrent: (l + 1) === current,
            isEllipsis: false
          });
        } else if (i - l !== 1) {
          rangeWithDots.push({
            isEllipsis: true
          });
        }
      }
      rangeWithDots.push({
        pageNum: i,
        url: pagination.hrefs[i - 1],
        isCurrent: i === current,
        isEllipsis: false
      });
      l = i;
    }

    return rangeWithDots;
  };
  eleventyConfig.addFilter("smartPagination", smartPagination);
  eleventyConfig.addNunjucksFilter("smartPagination", smartPagination);

  // تحويل روابط منصات التواصل إلى Embeds حية تلقائيًا وسريعًا
  const autoEmbedSocials = function(contentHtml) {
    if (!contentHtml || typeof contentHtml !== "string") return contentHtml;
    
    // Pattern to match paragraphs that contain standalone social URLs
    return contentHtml.replace(/<p>(?:<a\s+[^>]*href=["']([^"']+)["'][^>]*>[\s\S]*?<\/a>|([^<]+))<\/p>/gi, (match, hrefUrl, textUrl) => {
      let rawUrl = (hrefUrl || textUrl || "").trim();
      if (!rawUrl || !rawUrl.startsWith("http")) return match;

      // 1. Twitter / X (Supports any handle or status link)
      const twMatch = rawUrl.match(/^https?:\/\/(?:www\.)?(?:twitter\.com|x\.com)\/([^\/\r\n]+)\/status\/([0-9]+)/i);
      if (twMatch) {
        let user = twMatch[1].trim();
        const tweetId = twMatch[2];
        if (!/^[a-zA-Z0-9_]+$/.test(user)) {
          user = "i";
        }
        return `<div class="social-embed-box embed-twitter" dir="ltr" lang="en" style="min-height:280px;"><blockquote class="twitter-tweet" data-lang="en" lang="en" data-dnt="true" dir="ltr"><div class="embed-skeleton-card"><div class="embed-platform-badge"><svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"/></svg><span>X (Twitter)</span></div><div class="embed-skeleton-shimmer"></div><span class="embed-skeleton-title">جاري تحميل منشور X...</span><span class="embed-skeleton-link"><a href="https://twitter.com/${user}/status/${tweetId}" target="_blank" rel="noopener">فتح المنشور على X &rarr;</a></span></div></blockquote></div>`;
      }

      // 2. Instagram
      const igMatch = rawUrl.match(/^https?:\/\/(?:www\.)?instagram\.com\/(?:p|reel|reels|tv)\/([a-zA-Z0-9_-]+)/i);
      if (igMatch) {
        const igId = igMatch[1];
        const igUrl = `https://www.instagram.com/p/${igId}/?hl=en_US`;
        return `<div class="social-embed-box embed-instagram" dir="ltr" lang="en-US" style="min-height:560px;"><blockquote class="instagram-media instagram-embed" lang="en-US" dir="ltr" data-instgrm-locale="en_US" data-instgrm-captioned data-instgrm-permalink="${igUrl}" data-instgrm-version="14"><div class="embed-skeleton-card instagram-skeleton"><div class="embed-platform-badge"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="2" width="20" height="20" rx="5" ry="5"></rect><path d="M16 11.37A4 4 0 1 1 12.63 8 4 4 0 0 1 16 11.37z"></path><line x1="17.5" y1="6.5" x2="17.51" y2="6.5"></line></svg><span>Instagram</span></div><div class="embed-skeleton-shimmer"></div><span class="embed-skeleton-title">جاري تحميل منشور إنستجرام...</span><span class="embed-skeleton-link"><a href="${igUrl}" target="_blank" rel="noopener">فتح المنشور على Instagram &rarr;</a></span></div></blockquote></div>`;
      }

      // 3. YouTube (Videos, Live Streams, Shorts, Embeds, youtu.be)
      const ytMatch = rawUrl.match(/^https?:\/\/(?:www\.|m\.)?(?:youtube\.com\/(?:watch\?(?:[^&\s"']*(?:&|&amp;))*v=|shorts\/|live\/|embed\/)|youtu\.be\/)([a-zA-Z0-9_-]{11})/i);
      if (ytMatch) {
        const ytId = ytMatch[1];
        // A thumbnail that becomes the player on click: an iframe in the HTML made Google list every
        // story with a YouTube clip under «video isn't on a watch page» (INCIDENTS #142), and it loads faster.
        return ytFacade(ytId);
      }

      // 4. TikTok
      const ttMatch = rawUrl.match(/^https?:\/\/(?:www\.)?tiktok\.com\/@([a-zA-Z0-9_.-]+)\/video\/([0-9]+)/i);
      if (ttMatch) {
        const ttUser = ttMatch[1];
        const ttId = ttMatch[2];
        const ttUrl = `https://www.tiktok.com/@${ttUser}/video/${ttId}?lang=en`;
        return `<div class="social-embed-box embed-tiktok" dir="ltr" lang="en" style="min-height:480px;"><blockquote class="tiktok-embed" lang="en" dir="ltr" cite="${ttUrl}" data-video-id="${ttId}"><section><div class="embed-skeleton-card"><div class="embed-platform-badge"><span>TikTok</span></div><div class="embed-skeleton-shimmer"></div><span class="embed-skeleton-title">جاري تحميل فيديو TikTok...</span><span class="embed-skeleton-link"><a target="_blank" href="${ttUrl}">فتح الفيديو على TikTok &rarr;</a></span></div></section></blockquote></div>`;
      }

      // 5. Reddit
      const rdMatch = rawUrl.match(/^https?:\/\/(?:www\.)?(?:reddit\.com\/r\/[^\s\"\'<>]+|redd\.it\/[a-zA-Z0-9]+)/i);
      if (rdMatch) {
        return `<div class="social-embed-box embed-reddit" dir="ltr" lang="en" style="min-height:260px;"><blockquote class="reddit-embed-bq" lang="en" dir="ltr" data-embed-height="500"><div class="embed-skeleton-card"><div class="embed-platform-badge"><span>Reddit</span></div><div class="embed-skeleton-shimmer"></div><span class="embed-skeleton-title">جاري تحميل منشور Reddit...</span><span class="embed-skeleton-link"><a href="${rawUrl}" target="_blank" rel="noopener">فتح المنشور على Reddit &rarr;</a></span></div></blockquote></div>`;
      }

      // 6. Facebook (Posts, Shares, Videos, Reels, fb.watch, Permalinks)
      const fbMatch = rawUrl.match(/^https?:\/\/(?:www\.|m\.)?(?:facebook\.com\/(?:share\/(?:p|v|r)?\/[a-zA-Z0-9_-]+|[^\/\s"']+\/(?:posts|videos|photos)\/[0-9]+|permalink\.php\?[^\s"']+|photo(?:\.php|\/)\?[^\s"']+|watch\/?\?[^\s"']+|reel\/[0-9]+|story\.php\?[^\s"']+|[^\s"'<>]+)|fb\.watch\/[a-zA-Z0-9_-]+)/i);
      if (fbMatch) {
        return `<div class="social-embed-box embed-facebook" dir="ltr" lang="ar" style="min-height:420px; max-width:580px; margin:36px auto; display:flex; justify-content:center; text-align:center;"><div class="fb-post" data-href="${rawUrl}" data-width="auto" data-show-text="true" style="margin:0 auto; width:100%; display:flex; justify-content:center;"><blockquote cite="${rawUrl}" class="fb-xfbml-parse-ignore"><div class="embed-skeleton-card facebook-skeleton"><div class="embed-platform-badge"><svg width="20" height="20" viewBox="0 0 24 24" fill="#1877F2"><path d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z"/></svg><span>Facebook</span></div><div class="embed-skeleton-shimmer"></div><span class="embed-skeleton-title">جاري تحميل منشور فيسبوك...</span><span class="embed-skeleton-link"><a href="${rawUrl}" target="_blank" rel="noopener">فتح المنشور على Facebook &rarr;</a></span></div></blockquote></div></div>`;
      }

      return match;
    });
  };
  eleventyConfig.addFilter("autoEmbedSocials", autoEmbedSocials);
  eleventyConfig.addFilter("groupDownloadsByQuality", groupDownloadsByQuality);
  eleventyConfig.addNunjucksFilter("autoEmbedSocials", autoEmbedSocials);

  // --------------------------------------------------------------------------
  // 1. ربط أسماء المصارعين بالوسوم تلقائياً (Auto-Tag Linking for Superstars)
  // --------------------------------------------------------------------------
  const WRESTLING_SUPERSTARS = [
    { names: ["رومان رينز", "Roman Reigns"], slug: "رومان-رينز" },
    { names: ["كودي رودز", "Cody Rhodes"], slug: "كودي-رودز" },
    { names: ["سي إم بانك", "سي ام بانك", "CM Punk"], slug: "سي-ام-بانك" },
    { names: ["جون سينا", "John Cena"], slug: "جون-سينا" },
    { names: ["راندي أورتن", "راندي اورتن", "Randy Orton"], slug: "راندي-اورتن" },
    { names: ["ذا روك", "The Rock"], slug: "ذا-روك" },
    { names: ["بروك ليسنر", "Brock Lesnar"], slug: "بروك-ليسنر" },
    { names: ["أندرتيكر", "اندرتيكر", "The Undertaker"], slug: "اندرتيكر" },
    { names: ["سيث رولينز", "Seth Rollins"], slug: "سيث-رولينز" },
    { names: ["سامي زين", "Sami Zayn"], slug: "سامي-زين" },
    { names: ["كيفين أوينز", "كيفن اوينز", "Kevin Owens"], slug: "كيفين-اوينز" },
    { names: ["غونتر", "Gunther"], slug: "غونتر" },
    { names: ["درو ماكنتاير", "Drew McIntyre"], slug: "درو-ماكنتاير" },
    { names: ["إل إيه نايت", "ال ايه نايت", "LA Knight"], slug: "ال-ايه-نايت" },
    { names: ["ري ميستيريو", "ري ميستريو", "Rey Mysterio"], slug: "ري-ميستيريو" },
    { names: ["دومينيك ميستيريو", "دومينيك ميستريو", "Dominik Mysterio"], slug: "دومينيك-ميستيريو" },
    { names: ["سولو سيكوا", "Solo Sikoa"], slug: "سولو-سيكوا" },
    { names: ["جاكوب فاتو", "Jacob Fatu"], slug: "جاكوب-فاتو" },
    { names: ["جون موكسلي", "Jon Moxley"], slug: "جون-موكسلي" },
    { names: ["ويل أوسبري", "ويل اوسبري", "Will Ospreay"], slug: "ويل-اوسبري" },
    { names: ["ريا ريبلي", "Rhea Ripley"], slug: "ريا-ريبلي" },
    { names: ["بيكي لينش", "Becky Lynch"], slug: "بيكي-لينش" },
    { names: ["شارلوت فلير", "Charlotte Flair"], slug: "شارلوت-فلير" },
    { names: ["بايلي", "Bayley"], slug: "بايلي" },
    { names: ["ليف مورغان", "ليف مورجان", "Liv Morgan"], slug: "ليف-مورغان" },
    { names: ["تيفاني ستراتون", "Tiffany Stratton"], slug: "تيفاني-ستراتون" },
    { names: ["إيو سكاي", "ايو سكاي", "IYO SKY"], slug: "ايو-سكاي" },
    { names: ["بيانكا بيلير", "Bianca Belair"], slug: "بيانكا-بيلير" },
    { names: ["جايد كارجيل", "Jade Cargill"], slug: "جايد-كارجيل" },
    { names: ["توني خان", "Tony Khan"], slug: "توني-خان" },
    { names: ["تريبل إتش", "تربل اتش", "Triple H"], slug: "تريبل-اتش" },
    { names: ["فين بالور", "Finn Balor"], slug: "فين-بالور" },
    { names: ["ديميان بريست", "Damian Priest"], slug: "ديميان-بريست" },
    { names: ["داربي ألين", "داربي الين", "Darby Allin"], slug: "داربي-الين" },
    { names: ["سويرف ستريكلاند", "Swerve Strickland"], slug: "سويرف-ستريكلاند" },
    { names: ["كيني أوميغا", "كيني اوميغا", "Kenny Omega"], slug: "كيني-اوميغا" },
    { names: ["كازوتشيكا أوكادا", "Kazuchika Okada"], slug: "كازوتشيكا-اوكادا" },
    { names: ["آدم كول", "ادم كول", "Adam Cole"], slug: "ادم-كول" },
    { names: ["إم جيه إف", "ام جيه اف", "MJF"], slug: "ام-جيه-اف" }
  ];

  // Auto-linking of superstar names disabled as requested (keeps articles pure text)
  const autoLinkWrestlingStars = function(html) {
    return html;
  };
  eleventyConfig.addFilter("autoLinkWrestlingStars", autoLinkWrestlingStars);
  eleventyConfig.addNunjucksFilter("autoLinkWrestlingStars", autoLinkWrestlingStars);

  // --------------------------------------------------------------------------
  // --------------------------------------------------------------------------
  // 2. حماية الحرق ملغية تماماً بناءً على طلب المستخدم
  // --------------------------------------------------------------------------
  const wrapSpoilers = function(contentHtml) {
    return contentHtml;
  };
  eleventyConfig.addFilter("wrapSpoilers", wrapSpoilers);
  eleventyConfig.addNunjucksFilter("wrapSpoilers", wrapSpoilers);

  // ضغط الصور تلقائيًا ومنع حدوث أخطاء أو اختفاء للصور
  const optImgShortcode = async function(src, fallback) {
    const defaultFallback = "https://i.ibb.co/1fd4qVfY/9ovb3phc5b2u3q4d.jpg";
    let input = (src && typeof src === "string" && src.trim()) ? src.trim() : (fallback || defaultFallback);
    if (!input) return defaultFallback;

    let cleanInput = input;
    if (!cleanInput.startsWith("http://") && !cleanInput.startsWith("https://")) {
      if (!cleanInput.startsWith("/")) {
        cleanInput = "/" + cleanInput;
      }
    }

    const isLocal = cleanInput.startsWith("/content/") || cleanInput.startsWith("/images/");
    
    if (isLocal) {
      let decoded = cleanInput;
      try {
        decoded = decodeURIComponent(cleanInput);
      } catch (e) {}

      let resolvedSource = null;
      const candidates = [
        "." + cleanInput,
        "." + decoded,
        "." + decoded.normalize("NFD"),
        "." + decoded.normalize("NFC")
      ];

      for (const cand of candidates) {
        if (fs.existsSync(cand)) {
          resolvedSource = cand;
          break;
        }
      }

      if (!resolvedSource) {
        try {
          const filename = path.basename(decoded);
          const imagesDir = "./content/images";
          if (fs.existsSync(imagesDir)) {
            const files = fs.readdirSync(imagesDir);
            const targetNFC = filename.normalize("NFC");
            const targetNFD = filename.normalize("NFD");
            for (const f of files) {
              if (f === filename || f.normalize("NFC") === targetNFC || f.normalize("NFD") === targetNFD) {
                resolvedSource = path.join(imagesDir, f);
                break;
              }
            }
          }
        } catch (err) {}
      }

      if (resolvedSource) {
        try {
          const metadata = await Image(resolvedSource, {
            widths: [800],
            formats: ["jpeg"],
            outputDir: "_site/img/",
            urlPath: "/img/",
            sharpJpegOptions: { quality: 80, progressive: true }
          });
          const jpeg = metadata && metadata.jpeg && metadata.jpeg.length ? metadata.jpeg[metadata.jpeg.length - 1] : null;
          if (jpeg && jpeg.url) {
            return jpeg.url;
          }
        } catch (e) {
          console.error("optImg local processing error:", resolvedSource, e);
        }
      }

      try {
        return encodeURI(decodeURIComponent(cleanInput));
      } catch (e) {
        return cleanInput;
      }
    }

    try {
      const metadata = await Image(cleanInput, {
        widths: [800],
        formats: ["jpeg"],
        outputDir: "_site/img/",
        urlPath: "/img/",
        sharpJpegOptions: { quality: 80, progressive: true }
      });
      const jpeg = metadata && metadata.jpeg && metadata.jpeg.length ? metadata.jpeg[metadata.jpeg.length - 1] : null;
      if (jpeg && jpeg.url) {
        return jpeg.url;
      }
    } catch (e) {
      try {
        return encodeURI(decodeURIComponent(cleanInput));
      } catch (err) {
        return cleanInput;
      }
    }

    return cleanInput;
  };

  eleventyConfig.addNunjucksAsyncShortcode("optImg", optImgShortcode);

  const getItemTimestamp = function(item) {
    if (!item) return 0;
    if (item.date instanceof Date && !isNaN(item.date.getTime())) {
      return item.date.getTime();
    }
    if (item.data && item.data.date) {
      const d = new Date(item.data.date);
      if (!isNaN(d.getTime())) return d.getTime();
    }
    return 0;
  };

  const isNotFuture = function(item) {
    const ts = getItemTimestamp(item);
    // If the post has a date more than 2 minutes in the future, it is scheduled and hidden until that time
    if (ts && ts > (Date.now() + 120000)) {
      return false;
    }
    return true;
  };

  function deduplicateItems(items) {
    const seenIds = new Set();
    const seenUrls = new Set();
    const seenTitles = new Set();
    return items.filter(function(item) {
      const d = item.data || {};
      const sId = d.source_id ? String(d.source_id) : null;
      const sUrl = d.source_url ? String(d.source_url).replace(/\/+$/, "") : null;
      const title = (d.title || "").trim();

      if (sId) {
        if (seenIds.has(sId)) return false;
        seenIds.add(sId);
      }
      if (sUrl) {
        if (seenUrls.has(sUrl)) return false;
        seenUrls.add(sUrl);
      }
      if (title) {
        if (seenTitles.has(title)) return false;
        seenTitles.add(title);
      }
      return true;
    });
  }

  // Called once per article (2000+ times per build), each time over every item:
  // the per-item parts (url, federation, tags, date) are worked out once and kept.
  const relatedInfo = new WeakMap();
  const infoOf = function(item) {
    let info = relatedInfo.get(item);
    if (!info) {
      info = {
        url: (item.url || "").replace(/\/+$/, ""),
        fed: (item.data && item.data.federation || "").toString().trim().toUpperCase(),
        tags: item.data && Array.isArray(item.data.tags) ? item.data.tags.map(t => String(t || "").trim().toLowerCase()) : null,
        time: getItemTimestamp(item)
      };
      relatedInfo.set(item, info);
    }
    return info;
  };
  const getRelatedPosts = function(currentUrl, tags, federation, allContent, limit) {
    if (!allContent || !Array.isArray(allContent)) return [];
    const maxItems = (typeof limit === "number" && limit > 0) ? limit : 4;
    const normUrl = (currentUrl || "").replace(/\/+$/, "");

    const currentTags = Array.isArray(tags)
      ? tags.map(t => String(t || "").trim().toLowerCase()).filter(Boolean)
      : [];
    const targetFed = (federation || "").toString().trim().toUpperCase();

    // Same order as sorting everything by score, then newest, then original position — keeping only the top few.
    const best = [];
    const better = (a, b) => a.score !== b.score ? a.score > b.score : a.time !== b.time ? a.time > b.time : a.idx < b.idx;
    for (let idx = 0; idx < allContent.length; idx++) {
      const item = allContent[idx];
      if (!item || !item.url) continue;
      const info = infoOf(item);
      if (info.url === normUrl) continue;

      let score = 0;
      if (targetFed && info.fed && targetFed === info.fed) {
        score += 3;
      }
      if (currentTags.length > 0 && info.tags) {
        for (const t of currentTags) {
          if (t && info.tags.includes(t)) {
            score += 5;
          }
        }
      }

      const cand = { item, score, time: info.time, idx };
      if (best.length === maxItems && !better(cand, best[best.length - 1])) continue;
      let at = best.length;
      while (at > 0 && better(cand, best[at - 1])) at--;
      best.splice(at, 0, cand);
      if (best.length > maxItems) best.pop();
    }

    return best.map(s => s.item);
  };
  eleventyConfig.addFilter("getRelatedPosts", getRelatedPosts);
  eleventyConfig.addNunjucksFilter("getRelatedPosts", getRelatedPosts);


  eleventyConfig.addCollection("shows", function(collectionApi) {
    return collectionApi.getFilteredByGlob("content/shows/*.md")
      .filter(item => isNotFuture(item) && !(item.data && item.data.nostalgia_series) && !(item.data && item.data.tags && (Array.isArray(item.data.tags) ? (item.data.tags.includes("nostalgia") || item.data.tags.includes("نوستالجيا")) : (item.data.tags === "nostalgia" || item.data.tags === "نوستالجيا"))))
      .sort((a,b) => getItemTimestamp(b) - getItemTimestamp(a));
  });
  eleventyConfig.addCollection("recaps", function(collectionApi) {
    return collectionApi.getFilteredByGlob("content/recaps/*.md").filter(isNotFuture).sort((a,b) => getItemTimestamp(b) - getItemTimestamp(a));
  });
  eleventyConfig.addCollection("news", function(collectionApi) {
    const raw = collectionApi.getFilteredByGlob("content/news/*.md").filter(isNotFuture).sort((a,b) => getItemTimestamp(b) - getItemTimestamp(a));
    return deduplicateItems(raw);
  });
  eleventyConfig.addCollection("nostalgiaShows", function(collectionApi) {
    return collectionApi.getFilteredByGlob(["content/nostalgia/*.md", "content/nostalgia-series/*.md"]).filter(isNotFuture).sort((a,b) => getItemTimestamp(b) - getItemTimestamp(a));
  });
  eleventyConfig.addCollection("allContent", function(collectionApi) {
    const shows = collectionApi.getFilteredByGlob(["content/shows/*.md", "content/nostalgia/*.md"]).filter(isNotFuture);
    shows.forEach(function(i){ i.kind = "show"; });
    const recaps = collectionApi.getFilteredByGlob("content/recaps/*.md").filter(isNotFuture);
    recaps.forEach(function(i){ i.kind = "recap"; });
    const news = deduplicateItems(collectionApi.getFilteredByGlob("content/news/*.md").filter(isNotFuture));
    news.forEach(function(i){ i.kind = "news"; });
    return shows.concat(recaps, news).sort((a,b) => getItemTimestamp(b) - getItemTimestamp(a));
  });

  const getDateValue = function(item) {
    const raw = (item.data && (item.data.event_date || item.data.date)) || null;
    if (raw instanceof Date && !isNaN(raw.getTime())) return raw;
    if (raw) {
      const d = new Date(raw);
      if (!isNaN(d.getTime())) return d;
    }
    return null;
  };

  // بيجمع كل عروض "البرامج" اللي ليها حلقات أو نسخ متكررة (لما تتحط خانة "اسم البرنامج" في اللوحة).
  // - لو البرنامج له رقم موسم/حلقة صريح (زي برنامج بحلقات مرقّمة): بيتجمع ويترقّم عادي.
  // - لو مفيش رقم موسم/حلقة (زي عروض أسبوعية متكررة زي الرو/سماكداون/ديناميت): الموقع بيستنتج تلقائيًا
  //   السنة من "تاريخ العرض" بدل الموسم، وتاريخ العرض المختصر (يوم/شهر) بدل رقم الحلقة، فتحصل على نفس شكل
  //   الترقيم الاحترافي من غير ما تكتب أي أرقام يدوي - بس اسم البرنامج واحد موحّد في كل نسخة (مثلاً "WWE Raw").
  // الدالة دي عامة وبتتنادى مرتين: مرة على مجلد "shows" ومرة على مجلد "recaps"، عشان نفس الميزة تشتغل في الاتنين.
  const buildProgramsGrouped = function(collectionApi, glob) {
    const items = collectionApi.getFilteredByGlob(glob);
    const map = new Map();

    const seriesDefs = collectionApi.getFilteredByGlob("content/nostalgia-series/*.md");
    const nostalgiaSeriesMap = new Map();
    seriesDefs.forEach(function(sItem) {
      const sSlug = String(sItem.fileSlug || "").trim();
      if (sSlug) {
        const isProg = (sItem.data.series_type === "program") || /برنامج/i.test(sItem.data.title || "");
        nostalgiaSeriesMap.set(sSlug, {
          title: sItem.data.title || sSlug,
          series_type: sItem.data.series_type || (isProg ? "program" : "shows"),
          isProgram: isProg
        });
      }
    });

    items.forEach(function(item) {
      const inputPath = String(item.inputPath || "");
      const isNostalgia = !!(item.data && (item.data.nostalgia_series || inputPath.includes("content/nostalgia")));
      let rawName = item.data && item.data.program_name;
      let isProgram = false;

      if (isNostalgia) {
        const ref = String(item.data.nostalgia_series || "").trim();
        const sInfo = nostalgiaSeriesMap.get(ref);
        let sTitle = (sInfo && sInfo.title) || item.data.nostalgia_series_title || ref;
        if (!sTitle) {
          sTitle = (item.data.title || "").replace(/\s*\(نوستالجيا\)\s*/g, "");
        }
        isProgram = (item.data.series_type === "program") ||
                    (sInfo && sInfo.series_type === "program") ||
                    /برنامج/i.test(sTitle) ||
                    /برنامج/i.test(item.data.title || "");

        const cleanEventName = String(sTitle).replace(/^عرض\s+/g, "").trim();
        if (isProgram) {
          if (/^برنامج\s+/i.test(cleanEventName)) {
            rawName = "حلقات " + cleanEventName;
          } else {
            rawName = "حلقات برنامج " + cleanEventName;
          }
        } else {
          rawName = "رحلة الوصول إلى عرض " + cleanEventName;
        }
        item.data.program_name = rawName;
      }

      if (!rawName || !String(rawName).trim()) return;
      const name = String(rawName).trim();
      const slug = isNostalgia ? arabicSlug("nostalgia-" + (item.data.nostalgia_series || name)) : arabicSlug(name);
      if (!slug) return;

      if (!map.has(slug)) {
        map.set(slug, { 
          slug: slug, 
          name: name, 
          isNostalgia: isNostalgia,
          isProgram: isProgram,
          seriesType: isProgram ? "program" : "shows",
          episodes: [] 
        });
      }

      const seasonRaw = parseInt(item.data.season_number, 10);
      const dateVal = getDateValue(item);
      const season = isNaN(seasonRaw) ? null : seasonRaw;
      const year = dateVal ? dateVal.getUTCFullYear() : null;
      const monthNum = dateVal ? (dateVal.getUTCMonth() + 1) : null;
      const dayNum = dateVal ? dateVal.getUTCDate() : null;
      const shortDate = dateVal ? ("يوم " + dayNum + " شهر " + monthNum) : null;
      const isAnnual = isNostalgia || (item.data.is_annual === true || item.data.is_annual === "true");

      const episodeRaw = isNostalgia ? (item.data.nostalgia_order || item.data.episode_number) : item.data.episode_number;
      const episodeLabel = (episodeRaw !== undefined && episodeRaw !== null && String(episodeRaw).trim() !== "")
        ? String(episodeRaw).trim()
        : null;
      const episodeSortNum = (episodeLabel !== null && /^\d+$/.test(episodeLabel)) ? parseInt(episodeLabel, 10) : null;

      const groupKey = isAnnual ? -1 : (season !== null ? season : (year !== null ? year : 0));
      const groupType = isNostalgia ? "nostalgia" : (isAnnual ? "annual" : (season !== null ? "season" : (year !== null ? "year" : "misc")));

      let pillLabel = isAnnual
        ? (item.data.title || item.data.headline || "").trim()
        : (episodeLabel !== null ? episodeLabel : (shortDate || null));

      if (isNostalgia) {
        const isMain = item.data.nostalgia_main === true || item.data.nostalgia_main === "true";
        if (isProgram) {
          pillLabel = isMain ? "الحلقة الختامية" : ("الحلقة " + (item.data.nostalgia_order || 1));
        } else {
          pillLabel = isMain ? "العرض الختامي" : ("عرض " + (item.data.nostalgia_order || 1));
        }
      }

      map.get(slug).episodes.push({
        url: item.url,
        title: item.data.title || "",
        headline: item.data.headline || "",
        image: item.data.image || "",
        season: season,
        episodeLabel: episodeLabel,
        episodeSortNum: episodeSortNum,
        shortDate: shortDate,
        year: year,
        month: monthNum,
        day: dayNum,
        groupKey: groupKey,
        groupType: groupType,
        pillLabel: pillLabel,
        isNostalgia: isNostalgia,
        isProgram: isProgram,
        seriesType: isProgram ? "program" : "shows",
        timestamp: getItemTimestamp(item),
        federation: (item.data && item.data.federation) || "",
        eventDate: (item.data && (item.data.event_date || item.data.date)) || null,
        duration: (item.data && item.data.duration) || "",
        showType: (item.data && item.data.show_type) || ""
      });
    });

    const programs = Array.from(map.values());

    programs.forEach(function(prog) {
      prog.episodes.sort(function(a, b) {
        if (a.groupKey !== b.groupKey) return a.groupKey - b.groupKey;
        const ea = a.episodeSortNum === null ? Infinity : a.episodeSortNum;
        const eb = b.episodeSortNum === null ? Infinity : b.episodeSortNum;
        if (ea !== eb) return ea - eb;
        return a.timestamp - b.timestamp;
      });

      const seasonsMap = new Map();
      prog.episodes.forEach(function(ep) {
        if (!seasonsMap.has(ep.groupKey)) seasonsMap.set(ep.groupKey, { type: ep.groupType, episodes: [] });
        seasonsMap.get(ep.groupKey).episodes.push(ep);
      });

      prog.seasons = Array.from(seasonsMap.entries())
        .map(function(entry) {
          return { number: entry[0], type: entry[1].type, episodes: entry[1].episodes };
        })
        .sort(function(a, b) { return a.number - b.number; });

      // "series" = برنامج/مسلسل ليه رقم موسم أو رقم/عنوان حلقة مكتوب صريح (زي WWE LFG) → يستخدم كلمة "حلقة/حلقات".
      // "recurring" = عرض متكرر مفيهوش أي ترقيم صريح وبيعتمد على تاريخ العرض بس (زي WWE Raw) → يستخدم كلمة "عرض/عروض".
      prog.mode = (prog.isProgram || prog.seriesType === "program")
        ? "series"
        : (prog.isNostalgia
            ? "recurring"
            : (prog.episodes.some(function(ep) { return ep.season !== null || ep.episodeLabel !== null; }) ? "series" : "recurring"));
    });

    return programs;
  };

  eleventyConfig.addCollection("programsGrouped", function(collectionApi) {
    return buildProgramsGrouped(collectionApi, ["content/shows/*.md", "content/nostalgia/*.md"]);
  });
  // «مكتبة العروض»: every section the shows are linked to (the dashboard's «اسم البرنامج»),
  // the most recently created section first, each with its shows newest first. Nostalgia series have their
  // own section and are left out; scheduled (future) shows are not listed yet.
  const buildLibrary = function(collectionApi) {
    const now = Date.now();
    return buildProgramsGrouped(collectionApi, ["content/shows/*.md"])
      .filter(function(p) { return !p.isNostalgia; })
      .map(function(p) {
        const shows = p.episodes.filter(function(e) { return !e.isNostalgia && e.timestamp <= now; })
          .sort(function(a, b) { return b.timestamp - a.timestamp; });
        const fedCount = {};
        shows.forEach(function(e) { if (e.federation) fedCount[e.federation] = (fedCount[e.federation] || 0) + 1; });
        const federation = Object.keys(fedCount).sort(function(a, b) { return fedCount[b] - fedCount[a]; })[0] || "";
        // When the section first appeared on the site = its oldest show.
        const firstAdded = shows.length ? shows[shows.length - 1].timestamp : 0;
        return { slug: p.slug, name: p.name, federation: federation, shows: shows, count: shows.length, latest: shows[0] || null, firstAdded: firstAdded };
      })
      .filter(function(p) { return p.count > 0; })
      // Newest section first: a section created today tops the library.
      .sort(function(a, b) { return (b.firstAdded - a.firstAdded) || (b.latest.timestamp - a.latest.timestamp); });
  };
  eleventyConfig.addCollection("library", buildLibrary);
  // One entry per page of a program's shows (20 per page, like «عروض المصارعة»):
  // /library/<slug>/, /library/<slug>/2/, …
  const LIBRARY_PAGE_SIZE = 20;
  eleventyConfig.addCollection("libraryPages", function(collectionApi) {
    const pages = [];
    buildLibrary(collectionApi).forEach(function(prog) {
      const total = Math.max(1, Math.ceil(prog.shows.length / LIBRARY_PAGE_SIZE));
      const href = function(n) { return "/library/" + prog.slug + "/" + (n > 1 ? n + "/" : ""); };
      for (let i = 0; i < total; i++) {
        pages.push({
          prog: prog,
          pageNumber: i + 1,
          totalPages: total,
          items: prog.shows.slice(i * LIBRARY_PAGE_SIZE, (i + 1) * LIBRARY_PAGE_SIZE),
          href: href(i + 1),
          prev: i > 0 ? href(i) : null,
          next: i + 1 < total ? href(i + 2) : null,
          pageLinks: Array.from({ length: total }, function(_, k) { return { n: k + 1, href: href(k + 1), current: k === i }; })
        });
      }
    });
    return pages;
  });
  eleventyConfig.addFilter("libraryFederations", function(library) {
    const seen = [];
    (library || []).forEach(function(p) { if (p.federation && seen.indexOf(p.federation) === -1) seen.push(p.federation); });
    const order = ["WWE", "AEW", "TNA", "ROH", "NJPW", "CMLL", "AAA", "MLW", "UFC"];
    return seen.sort(function(a, b) {
      const ia = order.indexOf(a), ib = order.indexOf(b);
      return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib) || a.localeCompare(b);
    });
  });
  eleventyConfig.addCollection("recapsProgramsGrouped", function(collectionApi) {
    return buildProgramsGrouped(collectionApi, "content/recaps/*.md");
  });

  // بيرجع كل بيانات التنقل بين الحلقات (البرنامج + الموسم الحالي + الحلقة السابقة/التالية) لصفحة عرض معينة.
  // بيتنادى من جوه القالب زي: {% set nav = getEpisodeNav(program_name, page.url, collections.programsGrouped) %}
  const episodeShortLabel = function(ep, mode) {
    if (!ep) return "";
    if (ep.isNostalgia || ep.groupType === "nostalgia") {
      return (ep.headline || ep.title || "").replace(/\s*\(نوستالجيا\)\s*/g, "");
    }
    if (ep.groupType === "annual") return ep.pillLabel || ep.headline || ep.title || "";
    const noun = mode === "series" ? "الحلقة " : "العرض ";
    if (ep.episodeLabel !== null && ep.episodeLabel !== undefined) return noun + ep.episodeLabel;
    if (ep.shortDate) return ep.shortDate;
    return ep.headline || ep.title || "";
  };

  const seasonBadgeLabel = function(seasonObj) {
    if (!seasonObj) return "";
    if (seasonObj.type === "season") return "الموسم " + seasonObj.number;
    if (seasonObj.type === "year") return "سنة " + seasonObj.number;
    return "";
  };

  const getEpisodeNav = function(programName, currentUrl, programs) {
    if (!programName || !String(programName).trim()) return null;
    const slug = arabicSlug(programName);
    if (!slug) return null;
    let prog = (programs || []).find(function(p) { return p.slug === slug; });
    if (!prog) {
      prog = (programs || []).find(function(p) {
        return p.slug === ("nostalgia-" + slug) || p.name === programName;
      });
    }
    if (!prog) return null;
    // القسم بيظهر من أول عرض واحد يتضاف (مش لازم يستنى عرضين)، عشان يبان ومتجهز يكبر أول ما تضيف نسخ تانية.

    const clean = function(u) { return (u || "").toString().replace(/\.html$/, ""); };
    const cleanCurrent = clean(currentUrl);

    let idx = -1;
    prog.episodes.forEach(function(ep, i) {
      if (clean(ep.url) === cleanCurrent) idx = i;
    });

    const activeSeason = idx >= 0
      ? prog.episodes[idx].groupKey
      : prog.seasons[0].number;

    const activeSeasonObj = prog.seasons.find(function(s) { return s.number === activeSeason; }) || null;
    const prevEp = idx > 0 ? prog.episodes[idx - 1] : null;
    const nextEp = (idx >= 0 && idx < prog.episodes.length - 1) ? prog.episodes[idx + 1] : null;

    return {
      program: prog,
      currentIndex: idx,
      activeSeason: activeSeason,
      activeSeasonLabel: seasonBadgeLabel(activeSeasonObj),
      prevEp: prevEp,
      nextEp: nextEp,
      prevEpLabel: episodeShortLabel(prevEp, prog.mode),
      nextEpLabel: episodeShortLabel(nextEp, prog.mode)
    };
  };
  eleventyConfig.addNunjucksGlobal("getEpisodeNav", getEpisodeNav);

  // ===== نوستالجيا: بيجمع أي عرض/ملخص مكتوب فيه "nostalgia_series" في مجموعة (سلسلة) واحدة =====
  // مفيش محتاج مجلد جديد أو Content type جديد: أي عرض عادي في content/shows أو content/recaps
  // ضيف عليه الحقول التالية في الـ frontmatter بيتحول تلقائيًا لجزء من مسلسل نوستالجيا:
  //   nostalgia_series: "extreme-rules-2012"   -> السلاج بتاع السلسلة (نفس السلاج لكل حلقات نفس السلسلة)
  //   nostalgia_order: 1                       -> ترتيب الحلقة جوه السلسلة (العرض الشهري بياخد آخر رقم)
  //   nostalgia_main: true                     -> بس على العرض الشهري (العرض الرئيسي/نهاية المسلسل)
  //   nostalgia_era: "2012"                    -> اختياري، تسمية العصر لو عايز تجمع أكتر من سنة سوا
  // Year filter for the nostalgia page: every year (newest first) with its series
  // count, and the year whose shows are being added right now (latest-added series).
  // Reading time in minutes (Nunjucks' own wordcount only counts Latin words).
  eleventyConfig.addFilter("readingMinutes", function(html) {
    const text = String(html || "").replace(/<[^>]+>/g, " ").replace(/https?:\/\/\S+/g, " ");
    const words = text.split(/\s+/).filter(function(w) { return /[\u0621-\u064AA-Za-z0-9]/.test(w); }).length;
    return Math.max(1, Math.round(words / 180));
  });

  eleventyConfig.addFilter("nostalgiaYears", function(series) {
    const counts = new Map();
    let current = null, latest = -1;
    (series || []).forEach(function(s) {
      if (!s.year) return;
      const y = String(s.year);
      counts.set(y, (counts.get(y) || 0) + 1);
      if ((s.addedAt || 0) > latest) { latest = s.addedAt || 0; current = y; }
    });
    const years = Array.from(counts.entries())
      .map(function([year, count]) { return { year: year, count: count, isCurrent: year === current }; })
      .sort(function(a, b) { return Number(b.year) - Number(a.year); });
    // Grouped by decade (newest first) so the panel stays short however many years are added.
    const decades = [];
    years.forEach(function(y) {
      const start = Math.floor(Number(y.year) / 10) * 10;
      let d = decades.find(function(x) { return x.start === start; });
      if (!d) { d = { start: start, end: start + 9, years: [] }; decades.push(d); }
      d.years.push(y);
    });
    return { years: years, decades: decades, current: current };
  });

  eleventyConfig.addCollection("nostalgiaSeries", function(collectionApi) {
    const map = new Map();

    // 1. قراءة السلاسل الرئيسية المعرفة من content/nostalgia-series/*.md
    const seriesDefs = collectionApi.getFilteredByGlob("content/nostalgia-series/*.md");
    seriesDefs.forEach(function(item) {
      const slug = String(item.fileSlug || "").trim();
      if (!slug) return;
      const isProg = (item.data.series_type === "program") || /برنامج/i.test(item.data.title || "");
      map.set(slug, {
        slug: slug,
        title: item.data.title || slug,
        series_type: item.data.series_type || (isProg ? "program" : "shows"),
        isProgram: isProg,
        era: item.data.year || null,
        year: item.data.year || null,
        federation: item.data.federation || "WWE",
        poster: item.data.image || null,
        description: item.data.description || null,
        episodes: []
      });
    });

    // 2. قراءة حلقات وعروض النوستالجيا وربطها بالسلسلة
    const items = collectionApi.getFilteredByGlob(["content/shows/*.md", "content/nostalgia/*.md", "content/recaps/*.md"])
      .filter(item => item.data && item.data.nostalgia_series);

    items.forEach(function(item) {
      const rawRef = String(item.data.nostalgia_series).trim();
      if (!rawRef) return;

      // البحث عن السلسلة بالسلاج أو بالاسم
      let s = map.get(rawRef);
      if (!s) {
        s = Array.from(map.values()).find(x => x.title === rawRef || x.slug === rawRef);
      }
      if (!s) {
        // إنشاء السلسلة تلقائياً إذا أضاف المستخدم عرضاً ببيانات قديمة دون ملف سلسلة منفصل
        const isProg = (item.data.series_type === "program") || /برنامج/i.test(item.data.title || "") || /برنامج/i.test(rawRef);
        const fallbackSlug = arabicSlug(rawRef) || rawRef;
        s = {
          slug: fallbackSlug,
          title: item.data.nostalgia_title || item.data.program_name || rawRef,
          series_type: item.data.series_type || (isProg ? "program" : "shows"),
          isProgram: isProg,
          era: item.data.nostalgia_era || null,
          year: item.data.nostalgia_era || null,
          federation: item.data.federation || "WWE",
          poster: item.data.image || null,
          description: null,
          episodes: []
        };
        map.set(fallbackSlug, s);
      }

      // تعيين الاتحاد تلقائياً على العرض إذا لم يكن محدداً
      if (!item.data.federation && s.federation) {
        item.data.federation = s.federation;
      }
      // تعيين اسم البرنامج تلقائياً ليعمل شريط ترقيم الحلقات في صفحة العرض
      if (!item.data.program_name) {
        if (s.isProgram) {
          item.data.program_name = /^برنامج\s+/i.test(s.title) ? ("حلقات " + s.title) : ("حلقات برنامج " + s.title);
        } else {
          item.data.program_name = "سلسلة " + s.title;
        }
      }

      const dateVal = getDateValue(item);
      // When the episode was added to the site: files are named «YYYYMMDDHHMMSS-…».
      const addedStamp = (String(item.inputPath || "").split("/").pop() || "").match(/^(\d{14})/);
      const addedAt = addedStamp ? Number(addedStamp[1]) : 0;
      if (addedAt > (s.addedAt || 0)) s.addedAt = addedAt;
      s.episodes.push({
        url: item.url,
        title: item.data.title || "",
        headline: item.data.headline || "",
        federation: item.data.federation || s.federation || "WWE",
        image: item.data.image || "",
        event_date: item.data.event_date || item.data.date || null,
        year: dateVal ? dateVal.getUTCFullYear() : (s.year || null),
        order: (item.data.nostalgia_order !== undefined && item.data.nostalgia_order !== null)
          ? parseInt(item.data.nostalgia_order, 10) : 999,
        isMain: item.data.nostalgia_main === true || item.data.nostalgia_main === "true",
        isProgram: s.isProgram,
        seriesType: s.series_type
      });
    });

    const series = Array.from(map.values());
    series.forEach(function(s) {
      s.episodes.sort((a, b) => a.order - b.order);
      s.count = s.episodes.length;
      s.mainEpisode = s.episodes.find(e => e.isMain) || (s.episodes.length ? s.episodes[s.episodes.length - 1] : null);
      if (!s.poster) {
        s.poster = s.mainEpisode ? s.mainEpisode.image : (s.episodes[0] && s.episodes[0].image);
      }
      if (!s.year) {
        const years = s.episodes.map(e => e.year).filter(Boolean);
        s.year = s.era || (years.length ? Math.min(...years) : null);
      }
    });

    // ترتيب السلاسل بالأحدث
    series.sort(function(a, b) {
      const da = a.mainEpisode && a.mainEpisode.event_date ? new Date(a.mainEpisode.event_date).getTime() : 0;
      const db = b.mainEpisode && b.mainEpisode.event_date ? new Date(b.mainEpisode.event_date).getTime() : 0;
      return db - da;
    });

    return series;
  });

  eleventyConfig.addCollection("tagList", function(collectionApi) {
    const tagMap = new Map();
    const items = collectionApi.getFilteredByGlob(["content/shows/*.md", "content/nostalgia/*.md", "content/recaps/*.md", "content/news/*.md"]);
    items.forEach(item => {
      let tags = item.data.tags;
      if (typeof tags === "string") {
        tags = [tags];
      }
      if (Array.isArray(tags)) {
        tags.forEach(tag => {
          if (!tag) return;
          const cleanTag = tag.trim();
          const slug = arabicSlug(normalizeArabicHamza(cleanTag));
          if (!slug) return;
          if (!tagMap.has(slug)) {
            tagMap.set(slug, { name: cleanTag, slug: slug, count: 0 });
          }
          tagMap.get(slug).count += 1;
        });
      }
    });
    tagCountBySlug = new Map(Array.from(tagMap.values()).map(t => [t.slug, t.count]));
    return Array.from(tagMap.values()).sort((a,b) => b.count - a.count);
  });

  // Link a tag only when its page is indexable (3+ items — pages/tag.njk puts noindex on
  // smaller ones) and link the canonical hamza-normalized slug directly. Every article used
  // to link 1,700+ noindex tag pages plus ~440 redirecting spellings, which Search Console
  // reported as "Excluded by noindex" / "Page with redirect" and which ate the crawl budget
  // Google should spend on articles ("Discovered – currently not indexed").
  eleventyConfig.addFilter("tagHref", (tag) => {
    const slug = arabicSlug(normalizeArabicHamza(String(tag || "").trim()));
    if (!slug || (tagCountBySlug.get(slug) || 0) < MIN_INDEXED_TAG_ITEMS) return "";
    return `/tag/${slug}/`;
  });

  eleventyConfig.addCollection("federationPaginated", function(collectionApi) {
    const feds = [
      { slug: "wwe", code: "WWE", name: "World Wrestling Entertainment", colorClass: "fed-wwe" },
      { slug: "aew", code: "AEW", name: "All Elite Wrestling", colorClass: "fed-aew" },
      { slug: "njpw", code: "NJPW", name: "New Japan Pro-Wrestling", colorClass: "fed-njpw" },
      { slug: "tna", code: "TNA", name: "Total Nonstop Action Wrestling", colorClass: "fed-tna" },
      { slug: "roh", code: "ROH", name: "Ring of Honor", colorClass: "fed-roh" },
      { slug: "mma", code: "MMA", name: "رياضات القتال المختلطة", colorClass: "fed-mma" },
      { slug: "indie", code: "INDIE", name: "الاتحادات المستقلة", colorClass: "fed-indie" }
    ];
    const shows = collectionApi.getFilteredByGlob(["content/shows/*.md", "content/nostalgia/*.md"]);
    shows.forEach(function(i){ i.kind = "show"; });
    const recaps = collectionApi.getFilteredByGlob("content/recaps/*.md");
    recaps.forEach(function(i){ i.kind = "recap"; });
    const news = collectionApi.getFilteredByGlob("content/news/*.md");
    news.forEach(function(i){ i.kind = "news"; });
    const allContent = shows.concat(recaps, news).sort((a,b) => getItemTimestamp(b) - getItemTimestamp(a));

    const pageSize = 20;
    const pages = [];

    feds.forEach(fed => {
      const fedItems = allContent.filter(item => {
        if (!item.data || !item.data.federation) return false;
        const f = String(item.data.federation).trim().toUpperCase();
        return f === fed.code.toUpperCase() || f === fed.slug.toUpperCase();
      });
      const totalPages = Math.max(1, Math.ceil(fedItems.length / pageSize));

      const hrefs = [];
      for (let p = 1; p <= totalPages; p++) {
        hrefs.push(p === 1 ? `/federation/${fed.slug}/` : `/federation/${fed.slug}/${p}/`);
      }

      for (let p = 1; p <= totalPages; p++) {
        const start = (p - 1) * pageSize;
        const pageItems = fedItems.slice(start, start + pageSize);
        const prevUrl = p > 1 ? hrefs[p - 2] : null;
        const nextUrl = p < totalPages ? hrefs[p] : null;

        const delta = 2;
        const range = [];
        const rangeWithDots = [];
        let l;
        for (let i = 1; i <= totalPages; i++) {
          if (i === 1 || i === totalPages || (i >= p - delta && i <= p + delta)) {
            range.push(i);
          }
        }
        for (let i of range) {
          if (l) {
            if (i - l === 2) {
              rangeWithDots.push({
                pageNum: l + 1,
                url: hrefs[l],
                isCurrent: (l + 1) === p,
                isEllipsis: false
              });
            } else if (i - l !== 1) {
              rangeWithDots.push({ isEllipsis: true });
            }
          }
          rangeWithDots.push({
            pageNum: i,
            url: hrefs[i - 1],
            isCurrent: i === p,
            isEllipsis: false
          });
          l = i;
        }

        pages.push({
          fed: fed,
          pageNumber: p,
          totalPages: totalPages,
          items: pageItems,
          totalItems: fedItems.length,
          permalink: hrefs[p - 1] + "index.html",
          url: hrefs[p - 1],
          previousHref: prevUrl,
          nextHref: nextUrl,
          paginationItems: rangeWithDots
        });
      }
    });

    return pages;
  });

  eleventyConfig.addCollection("tagPaginated", function(collectionApi) {
    const shows = collectionApi.getFilteredByGlob(["content/shows/*.md", "content/nostalgia/*.md"]);
    shows.forEach(function(i){ i.kind = "show"; });
    const recaps = collectionApi.getFilteredByGlob("content/recaps/*.md");
    recaps.forEach(function(i){ i.kind = "recap"; });
    const news = collectionApi.getFilteredByGlob("content/news/*.md");
    news.forEach(function(i){ i.kind = "news"; });
    const allContent = shows.concat(recaps, news).sort((a,b) => getItemTimestamp(b) - getItemTimestamp(a));

    const tagMap = new Map();
    allContent.forEach(item => {
      let tags = item.data.tags;
      if (typeof tags === "string") tags = [tags];
      if (Array.isArray(tags)) {
        tags.forEach(tag => {
          if (!tag) return;
          const cleanTag = tag.trim();
          const slug = arabicSlug(normalizeArabicHamza(cleanTag));
          if (!slug) return;
          if (!tagMap.has(slug)) {
            tagMap.set(slug, { name: cleanTag, slug: slug, items: [] });
          }
          tagMap.get(slug).items.push(item);
        });
      }
    });

    const pageSize = 20;
    const pages = [];

    tagMap.forEach((tagObj) => {
      const tagItems = tagObj.items;
      const totalPages = Math.max(1, Math.ceil(tagItems.length / pageSize));

      const hrefs = [];
      for (let p = 1; p <= totalPages; p++) {
        hrefs.push(p === 1 ? `/tag/${tagObj.slug}/` : `/tag/${tagObj.slug}/${p}/`);
      }

      for (let p = 1; p <= totalPages; p++) {
        const start = (p - 1) * pageSize;
        const pageItems = tagItems.slice(start, start + pageSize);
        const prevUrl = p > 1 ? hrefs[p - 2] : null;
        const nextUrl = p < totalPages ? hrefs[p] : null;

        const delta = 2;
        const range = [];
        const rangeWithDots = [];
        let l;
        for (let i = 1; i <= totalPages; i++) {
          if (i === 1 || i === totalPages || (i >= p - delta && i <= p + delta)) {
            range.push(i);
          }
        }
        for (let i of range) {
          if (l) {
            if (i - l === 2) {
              rangeWithDots.push({
                pageNum: l + 1,
                url: hrefs[l],
                isCurrent: (l + 1) === p,
                isEllipsis: false
              });
            } else if (i - l !== 1) {
              rangeWithDots.push({ isEllipsis: true });
            }
          }
          rangeWithDots.push({
            pageNum: i,
            url: hrefs[i - 1],
            isCurrent: i === p,
            isEllipsis: false
          });
          l = i;
        }

        pages.push({
          tagObj: { name: tagObj.name, slug: tagObj.slug, count: tagItems.length },
          pageNumber: p,
          totalPages: totalPages,
          items: pageItems,
          totalItems: tagItems.length,
          permalink: hrefs[p - 1] + "index.html",
          url: hrefs[p - 1],
          previousHref: prevUrl,
          nextHref: nextUrl,
          paginationItems: rangeWithDots
        });
      }
    });

    return pages;
  });

  // Transform to strip all internal developer HTML comments from published pages for privacy & cleaner code
  eleventyConfig.addTransform("stripComments", function(content, outputPath) {
    if (outputPath && outputPath.endsWith(".html") && !outputPath.includes("/admin/")) {
      return content.replace(/<!--(?!\[if)[\s\S]*?-->/g, "");
    }
    return content;
  });

  // The owner's panel, at /admin/ (the old Decap panel there was retired on 2026-09-28; the
  // new one was at /studio/ for its first days — that address redirects here). Static files, no build step. Its code goes to a folder named
  // after the build — Cloudflare keeps .js for 4 hours in browsers, so a fixed path would keep
  // serving yesterday's panel after an update. The page itself (pages/studio.njk) is never cached.
  const STUDIO_VERSION = String(process.env.CF_PAGES_COMMIT_SHA || Date.now().toString(36)).slice(0, 10);
  eleventyConfig.addGlobalData("studioVersion", STUDIO_VERSION);
  eleventyConfig.addPassthroughCopy({ "studio/js": `admin/${STUDIO_VERSION}/js` });
  eleventyConfig.addPassthroughCopy({ "studio/vendor": `admin/${STUDIO_VERSION}/vendor` });
  eleventyConfig.addPassthroughCopy({ "studio/studio.css": `admin/${STUDIO_VERSION}/studio.css` });
  eleventyConfig.addPassthroughCopy({ "studio/manifest.webmanifest": "admin/manifest.webmanifest" });
  eleventyConfig.addPassthroughCopy({"_data/pinned.json": "data/pinned.json"});
  eleventyConfig.addPassthroughCopy("watcher-state.json");
  eleventyConfig.addPassthroughCopy("watcher-feed.json");
  eleventyConfig.addPassthroughCopy("watcher-feed-wrestlinginc.json");
  eleventyConfig.addPassthroughCopy("watcher-feed-ringsidenews.json");
  if (fs.existsSync("dist/videos")) {
    eleventyConfig.addPassthroughCopy({"dist/videos": "videos"});
  }
  eleventyConfig.addPassthroughCopy("content/images");
  eleventyConfig.addPassthroughCopy("assets");
  eleventyConfig.addPassthroughCopy("sw.js");
  eleventyConfig.addPassthroughCopy("manifest.json");
  eleventyConfig.addPassthroughCopy("googlee6fae402f63eee54.html");
  eleventyConfig.addPassthroughCopy("nxuwkfsaraeq723u4jfsdf3yivfgmn.html");
  eleventyConfig.addPassthroughCopy("tiktokB09bhAwdbHqKJSxwpoKGsFAf46fRPa6c.txt");
  eleventyConfig.addPassthroughCopy("tiktokuOJmqoSFpXuJX6VMj9SICyoMTCTvK3H0.txt");
  eleventyConfig.addPassthroughCopy("tiktokB3tgkt0dNmlKDHhe0BRwvie3TesB9SZT.txt");
  eleventyConfig.addPassthroughCopy("ads.txt");
  if (fs.existsSync("_headers")) {
    eleventyConfig.addPassthroughCopy("_headers");
  }

  eleventyConfig.on("eleventy.after", () => {
    if (!fs.existsSync("_site")) fs.mkdirSync("_site", { recursive: true });
    if (fs.existsSync("assets")) {
      if (!fs.existsSync("_site/assets")) fs.mkdirSync("_site/assets", { recursive: true });
      fs.cpSync("assets", "_site/assets", { recursive: true });
    }
    if (fs.existsSync("_redirects")) {
      const { toPagesRedirects, renamedArticleRedirects, writeRedirectPages } = require("./lib/redirects.cjs");
      const tooLong = [];
      fs.writeFileSync("_site/_redirects", toPagesRedirects(fs.readFileSync("_redirects", "utf-8"), "_site", renamedArticleRedirects(), tooLong));
      writeRedirectPages(tooLong, "_site"); // over-long Arabic redirects (INCIDENTS #200)
    }
    if (fs.existsSync("_headers")) {
      fs.copyFileSync("_headers", "_site/_headers");
    }
    if (fs.existsSync("manifest.json")) {
      fs.copyFileSync("manifest.json", "_site/manifest.json");
    }
    if (fs.existsSync("favicon.svg")) {
      fs.copyFileSync("favicon.svg", "_site/favicon.svg");
    } else if (fs.existsSync("assets/logo.svg")) {
      fs.copyFileSync("assets/logo.svg", "_site/favicon.svg");
    }

    if (fs.existsSync("favicon.ico")) {
      fs.copyFileSync("favicon.ico", "_site/favicon.ico");
    } else if (fs.existsSync("assets/logo.png")) {
      fs.copyFileSync("assets/logo.png", "_site/favicon.ico");
    }

    if (fs.existsSync("apple-touch-icon.png")) {
      fs.copyFileSync("apple-touch-icon.png", "_site/apple-touch-icon.png");
    } else if (fs.existsSync("favicon.png")) {
      fs.copyFileSync("favicon.png", "_site/apple-touch-icon.png");
    }

    if (fs.existsSync("favicon.png")) {
      fs.copyFileSync("favicon.png", "_site/favicon.png");
    } else if (fs.existsSync("assets/logo.png")) {
      fs.copyFileSync("assets/logo.png", "_site/favicon.png");
    }
    const files = fs.readdirSync(".");
    files.forEach(file => {
      if (file.startsWith("google") && file.endsWith(".html")) {
        fs.copyFileSync(file, `_site/${file}`);
      }
    });

  });

  return {
    dir: {
      input: ".",
      includes: "_includes",
      output: "_site"
    },
    templateFormats: ["njk", "md"],
    markdownTemplateEngine: "njk",
    htmlTemplateEngine: "njk"
  };
};
