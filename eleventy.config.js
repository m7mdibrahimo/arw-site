const Image = require("@11ty/eleventy-img");
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
};

function hostFromUrl(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch (e) {
    return "";
  }
}

function siteNameFromHost(host) {
  if (!host) return "رابط تحميل";
  if (KNOWN_HOST_NAMES[host]) return KNOWN_HOST_NAMES[host];
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

// بياخد مصفوفة downloads القديمة (label/url) ويرجعها مقسمة لـ 3 مجموعات جاهزة للعرض الاحترافي الجديد
function groupDownloadsByQuality(downloads) {
  const groups = { low: [], medium: [], high: [] };
  if (!downloads || !downloads.length) return groups;

  downloads.forEach(function (d) {
    if (!d || !d.url) return;
    const host = hostFromUrl(d.url);
    const site = siteNameFromHost(host);
    const item = { url: d.url, site: site, host: host };
    const quality = detectQuality(d.label) || detectQuality(d.url);

    if (quality === "low") {
      groups.low.push(item);
    } else if (quality === "medium") {
      groups.medium.push(item);
    } else if (quality === "high") {
      groups.high.push(item);
    } else {
      // لو الرابط مش محدد له جودة (زي روابط "تحميل متعدد" اللي فيها كل الجودات)
      // نعرضه في الثلاث خانات لأنه صالح لأي جودة يختارها الزائر
      groups.low.push(item);
      groups.medium.push(item);
      groups.high.push(item);
    }
  });

  return groups;
}

function arabicSlug(str) {
  if (!str) return "";
  return str
    .toString()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .normalize('NFC')
    .trim()
    .toLowerCase()
    .replace(/[\.\_\/\\]+/g, '-')
    .replace(/\s+/g, '-')
    .replace(/[^\w\u0600-\u06FF\-]/g, '')
    .replace(/\-\-+/g, '-')
    .replace(/^-+|-+$/g, '');
}

module.exports = function(eleventyConfig) {
  console.log("=== ELEVENTY CONFIG EXECUTING ===");
  eleventyConfig.addFilter("arabicSlug", arabicSlug);
  eleventyConfig.addNunjucksFilter("arabicSlug", arabicSlug);
  eleventyConfig.addFilter("slug", arabicSlug);
  eleventyConfig.addNunjucksFilter("slug", arabicSlug);

  const cleanUrl = function(url) {
    if (!url) return "";
    return url.toString().replace(/\.html$/, '');
  };
  eleventyConfig.addFilter("cleanUrl", cleanUrl);
  eleventyConfig.addNunjucksFilter("cleanUrl", cleanUrl);

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

      // 1. Twitter / X
      const twMatch = rawUrl.match(/^https?:\/\/(?:www\.)?(?:twitter\.com|x\.com)\/([a-zA-Z0-9_]+)\/status\/([0-9]+)/i);
      if (twMatch) {
        const user = twMatch[1];
        const tweetId = twMatch[2];
        return `<div class="social-embed-box embed-twitter" dir="ltr" lang="en" style="min-height:280px;"><blockquote class="twitter-tweet" data-lang="en" lang="en" data-dnt="true" dir="ltr"><div class="embed-skeleton-card"><div class="embed-platform-badge"><svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"/></svg><span>X (Twitter)</span></div><div class="embed-skeleton-shimmer"></div><span class="embed-skeleton-title">جاري تحميل منشور X...</span><span class="embed-skeleton-link"><a href="https://twitter.com/${user}/status/${tweetId}" target="_blank" rel="noopener">فتح المنشور على X (@${user}) &rarr;</a></span></div></blockquote></div>`;
      }

      // 2. Instagram
      const igMatch = rawUrl.match(/^https?:\/\/(?:www\.)?instagram\.com\/(?:p|reel|tv)\/([a-zA-Z0-9_-]+)/i);
      if (igMatch) {
        const igId = igMatch[1];
        const igUrl = `https://www.instagram.com/p/${igId}/?hl=en_US`;
        return `<div class="social-embed-box embed-instagram" dir="ltr" lang="en-US" style="min-height:560px;"><blockquote class="instagram-media instagram-embed" lang="en-US" dir="ltr" data-instgrm-locale="en_US" data-instgrm-captioned data-instgrm-permalink="${igUrl}" data-instgrm-version="14"><div class="embed-skeleton-card instagram-skeleton"><div class="embed-platform-badge"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="2" width="20" height="20" rx="5" ry="5"></rect><path d="M16 11.37A4 4 0 1 1 12.63 8 4 4 0 0 1 16 11.37z"></path><line x1="17.5" y1="6.5" x2="17.51" y2="6.5"></line></svg><span>Instagram</span></div><div class="embed-skeleton-shimmer"></div><span class="embed-skeleton-title">جاري تحميل منشور إنستجرام...</span><span class="embed-skeleton-link"><a href="${igUrl}" target="_blank" rel="noopener">فتح المنشور على Instagram &rarr;</a></span></div></blockquote></div>`;
      }

      // 3. YouTube (Videos, Live Streams, Shorts, Embeds, youtu.be)
      const ytMatch = rawUrl.match(/^https?:\/\/(?:www\.|m\.)?(?:youtube\.com\/(?:watch\?(?:[^&\s"']*(?:&|&amp;))*v=|shorts\/|live\/|embed\/)|youtu\.be\/)([a-zA-Z0-9_-]{11})/i);
      if (ytMatch) {
        const ytId = ytMatch[1];
        return `<div class="social-embed-box embed-yt-wrap" dir="ltr" lang="en"><div class="embed-skeleton-card youtube-skeleton"><div class="embed-platform-badge"><svg width="20" height="20" viewBox="0 0 24 24" fill="#FF0000"><path d="M23.498 6.186a3.016 3.016 0 0 0-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 0 0 .502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 0 0 2.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 0 0 2.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814zM9.545 15.568V8.432L15.818 12l-6.273 3.568z"/></svg><span>YouTube</span></div><div class="embed-skeleton-shimmer"></div><span class="embed-skeleton-title">جاري تشغيل فيديو يوتيوب...</span><span class="embed-skeleton-link"><a href="${rawUrl}" target="_blank" rel="noopener">فتح الفيديو على YouTube &rarr;</a></span></div><iframe src="https://www.youtube-nocookie.com/embed/${ytId}?hl=en&cc_lang_pref=en" title="YouTube video player" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share" allowfullscreen loading="lazy"></iframe></div>`;
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

  eleventyConfig.addCollection("shows", function(collectionApi) {
    return collectionApi.getFilteredByGlob("content/shows/*.md").sort((a,b) => getItemTimestamp(b) - getItemTimestamp(a));
  });
  eleventyConfig.addCollection("recaps", function(collectionApi) {
    return collectionApi.getFilteredByGlob("content/recaps/*.md").sort((a,b) => getItemTimestamp(b) - getItemTimestamp(a));
  });
  eleventyConfig.addCollection("news", function(collectionApi) {
    return collectionApi.getFilteredByGlob("content/news/*.md").sort((a,b) => getItemTimestamp(b) - getItemTimestamp(a));
  });
  eleventyConfig.addCollection("allContent", function(collectionApi) {
    const shows = collectionApi.getFilteredByGlob("content/shows/*.md");
    shows.forEach(function(i){ i.kind = "show"; });
    const recaps = collectionApi.getFilteredByGlob("content/recaps/*.md");
    recaps.forEach(function(i){ i.kind = "recap"; });
    const news = collectionApi.getFilteredByGlob("content/news/*.md");
    news.forEach(function(i){ i.kind = "news"; });
    return shows.concat(recaps, news).sort((a,b) => getItemTimestamp(b) - getItemTimestamp(a));
  });

  eleventyConfig.addCollection("tagList", function(collectionApi) {
    const tagMap = new Map();
    const items = collectionApi.getFilteredByGlob(["content/shows/*.md", "content/recaps/*.md", "content/news/*.md"]);
    items.forEach(item => {
      let tags = item.data.tags;
      if (typeof tags === "string") {
        tags = [tags];
      }
      if (Array.isArray(tags)) {
        tags.forEach(tag => {
          if (!tag) return;
          const cleanTag = tag.trim();
          const slug = arabicSlug(cleanTag);
          if (!slug) return;
          if (!tagMap.has(slug)) {
            tagMap.set(slug, { name: cleanTag, slug: slug, count: 0 });
          }
          tagMap.get(slug).count += 1;
        });
      }
    });
    return Array.from(tagMap.values()).sort((a,b) => b.count - a.count);
  });

  eleventyConfig.addCollection("federationPaginated", function(collectionApi) {
    const feds = [
      { slug: "wwe", code: "WWE", name: "World Wrestling Entertainment", colorClass: "fed-wwe" },
      { slug: "aew", code: "AEW", name: "All Elite Wrestling", colorClass: "fed-aew" },
      { slug: "tna", code: "TNA", name: "Total Nonstop Action Wrestling", colorClass: "fed-tna" },
      { slug: "roh", code: "ROH", name: "Ring of Honor", colorClass: "fed-roh" },
      { slug: "mma", code: "MMA", name: "رياضات القتال المختلطة", colorClass: "fed-mma" },
      { slug: "indie", code: "INDIE", name: "الاتحادات المستقلة", colorClass: "fed-indie" }
    ];
    const shows = collectionApi.getFilteredByGlob("content/shows/*.md");
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
    const shows = collectionApi.getFilteredByGlob("content/shows/*.md");
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
          const slug = arabicSlug(cleanTag);
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

  eleventyConfig.addPassthroughCopy("admin/index.html");
  eleventyConfig.addPassthroughCopy({"admin/config.yml": "admin/config.yml"});
  eleventyConfig.addPassthroughCopy("content/images");
  eleventyConfig.addPassthroughCopy("assets");
  eleventyConfig.addPassthroughCopy("sw.js");
  eleventyConfig.addPassthroughCopy("googlee6fae402f63eee54.html");
  eleventyConfig.addPassthroughCopy("ads.txt");
  if (fs.existsSync("_redirects")) {
    eleventyConfig.addPassthroughCopy("_redirects");
  }

  eleventyConfig.on("eleventy.after", () => {
    if (!fs.existsSync("_site")) fs.mkdirSync("_site", { recursive: true });
    if (fs.existsSync("assets")) {
      if (!fs.existsSync("_site/assets")) fs.mkdirSync("_site/assets", { recursive: true });
      fs.cpSync("assets", "_site/assets", { recursive: true });
    }
    if (fs.existsSync("_redirects")) {
      fs.copyFileSync("_redirects", "_site/_redirects");
    }
    if (fs.existsSync("assets/logo.svg")) {
      fs.copyFileSync("assets/logo.svg", "_site/favicon.svg");
    } else if (fs.existsSync("favicon.svg")) {
      fs.copyFileSync("favicon.svg", "_site/favicon.svg");
    }

    if (fs.existsSync("assets/logo.png")) {
      fs.copyFileSync("assets/logo.png", "_site/favicon.png");
      fs.copyFileSync("assets/logo.png", "_site/apple-touch-icon.png");
      fs.copyFileSync("assets/logo.png", "_site/favicon.ico");
    } else if (fs.existsSync("favicon.png")) {
      fs.copyFileSync("favicon.png", "_site/favicon.png");
      fs.copyFileSync("favicon.png", "_site/apple-touch-icon.png");
      fs.copyFileSync("favicon.png", "_site/favicon.ico");
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
