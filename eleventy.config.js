const Image = require("@11ty/eleventy-img");
const fs = require("fs");
const path = require("path");

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
        return `<div class="social-embed-box" dir="ltr" lang="en"><blockquote class="twitter-tweet" data-lang="en" lang="en" data-dnt="true" dir="ltr"><a href="https://twitter.com/${user}/status/${tweetId}">Loading Post on X (@${user})...</a></blockquote></div>`;
      }

      // 2. Instagram
      const igMatch = rawUrl.match(/^https?:\/\/(?:www\.)?instagram\.com\/(?:p|reel|tv)\/([a-zA-Z0-9_-]+)/i);
      if (igMatch) {
        const igId = igMatch[1];
        const igUrl = `https://www.instagram.com/p/${igId}/?hl=en_US`;
        return `<div class="social-embed-box" dir="ltr" lang="en-US"><blockquote class="instagram-media instagram-embed" lang="en-US" dir="ltr" data-instgrm-locale="en_US" data-instgrm-captioned data-instgrm-permalink="${igUrl}" data-instgrm-version="14"><a href="${igUrl}">Loading Post on Instagram...</a></blockquote></div>`;
      }

      // 3. YouTube
      const ytMatch = rawUrl.match(/^https?:\/\/(?:www\.)?(?:youtube\.com\/(?:watch\?v=|shorts\/|embed\/)|youtu\.be\/)([a-zA-Z0-9_-]{11})/i);
      if (ytMatch) {
        const ytId = ytMatch[1];
        return `<div class="embed-yt-wrap" dir="ltr" lang="en"><iframe src="https://www.youtube-nocookie.com/embed/${ytId}?hl=en&cc_lang_pref=en" title="YouTube video player" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share" allowfullscreen loading="lazy"></iframe></div>`;
      }

      // 4. TikTok
      const ttMatch = rawUrl.match(/^https?:\/\/(?:www\.)?tiktok\.com\/@([a-zA-Z0-9_.-]+)\/video\/([0-9]+)/i);
      if (ttMatch) {
        const ttUser = ttMatch[1];
        const ttId = ttMatch[2];
        const ttUrl = `https://www.tiktok.com/@${ttUser}/video/${ttId}?lang=en`;
        return `<div class="social-embed-box" dir="ltr" lang="en"><blockquote class="tiktok-embed" lang="en" dir="ltr" cite="${ttUrl}" data-video-id="${ttId}"><section><a target="_blank" href="${ttUrl}"></a></section></blockquote></div>`;
      }

      // 5. Reddit
      const rdMatch = rawUrl.match(/^https?:\/\/(?:www\.)?(?:reddit\.com\/r\/[^\s\"\'<>]+|redd\.it\/[a-zA-Z0-9]+)/i);
      if (rdMatch) {
        return `<div class="social-embed-box" dir="ltr" lang="en"><blockquote class="reddit-embed-bq" lang="en" dir="ltr" data-embed-height="500"><a href="${rawUrl}"></a></blockquote></div>`;
      }

      // 6. Facebook
      const fbMatch = rawUrl.match(/^https?:\/\/(?:www\.|m\.)?(?:facebook\.com\/(?:[^\/\s]+\/(?:posts|videos)\/[0-9]+|watch\/\?v=[0-9]+|reel\/[0-9]+|story\.php\?[^\s]+)|fb\.watch\/[a-zA-Z0-9_-]+)/i);
      if (fbMatch) {
        return `<div class="social-embed-box" dir="ltr" lang="en"><div class="fb-post" lang="en" dir="ltr" data-href="${rawUrl}" data-width="100%"></div></div>`;
      }

      return match;
    });
  };
  eleventyConfig.addFilter("autoEmbedSocials", autoEmbedSocials);
  eleventyConfig.addNunjucksFilter("autoEmbedSocials", autoEmbedSocials);

  // ضغط الصور تلقائيًا ومنع حدوث أخطاء أو اختفاء للصور
  const optImgShortcode = async function(src, fallback) {
    const defaultFallback = "https://images.unsplash.com/photo-1543429294-fc2d8c7be842?w=800&auto=format&fit=crop";
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

  eleventyConfig.addPassthroughCopy("admin/index.html");
  eleventyConfig.addPassthroughCopy({"admin/config.yml": "admin/config.yml"});
  eleventyConfig.addPassthroughCopy("content/images");
  eleventyConfig.addPassthroughCopy("assets");
  eleventyConfig.addPassthroughCopy("sw.js");
  eleventyConfig.addPassthroughCopy("googlee6fae402f63eee54.html");
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
