const Image = require("@11ty/eleventy-img");

function arabicSlug(str) {
  if (!str) return "";
  return str
    .toString()
    .normalize('NFC')
    .trim()
    .replace(/\s+/g, '-')
    .replace(/[^\w\u0600-\u06FF\-]/g, '')
    .replace(/\-\-+/g, '-');
}

module.exports = function(eleventyConfig) {
  eleventyConfig.addFilter("arabicSlug", arabicSlug);
  eleventyConfig.addNunjucksFilter("arabicSlug", arabicSlug);
  eleventyConfig.addFilter("slug", arabicSlug);
  eleventyConfig.addNunjucksFilter("slug", arabicSlug);

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
    const d = new Date(dateObj);
    if (isNaN(d.getTime())) return dateObj;
    const months = ["يناير","فبراير","مارس","أبريل","مايو","يونيو","يوليو","أغسطس","سبتمبر","أكتوبر","نوفمبر","ديسمبر"];
    return d.getDate() + " " + months[d.getMonth()] + " " + d.getFullYear();
  };
  eleventyConfig.addFilter("date", formatDate);
  eleventyConfig.addNunjucksFilter("date", formatDate);

  const jsonify = function(obj){
    return JSON.stringify(obj);
  };
  eleventyConfig.addFilter("jsonify", jsonify);
  eleventyConfig.addNunjucksFilter("jsonify", jsonify);

  // ضغط الصور تلقائيًا: يقلل الحجم لأقل من 100 كيلوبايت مع الحفاظ على الجودة العالية
  eleventyConfig.addNunjucksAsyncShortcode("optImg", async function(src, fallback) {
    let input = (src && typeof src === "string" && src.trim()) ? src.trim() : (fallback || "");
    if (!input) return "";

    let cleanInput = input;
    if (!cleanInput.startsWith("http://") && !cleanInput.startsWith("https://")) {
      if (!cleanInput.startsWith("/")) {
        cleanInput = "/" + cleanInput;
      }
    }

    const isLocal = cleanInput.startsWith("/content/");
    const source = isLocal ? "." + cleanInput : cleanInput;
    const fs = require("fs");

    if (isLocal && !fs.existsSync(source)) {
      return cleanInput;
    }

    try {
      const metadata = await Image(source, {
        widths: [720],
        formats: ["jpeg"],
        outputDir: "_site/img/",
        urlPath: "/img/",
        sharpJpegOptions: { quality: 72, progressive: true }
      });
      const jpeg = metadata.jpeg && metadata.jpeg.length ? metadata.jpeg[metadata.jpeg.length - 1] : null;
      return jpeg ? jpeg.url : cleanInput;
    } catch (e) {
      return cleanInput;
    }
  });

  eleventyConfig.addCollection("shows", function(collectionApi) {
    return collectionApi.getFilteredByGlob("content/shows/*.md").sort((a,b) => b.date - a.date);
  });
  eleventyConfig.addCollection("recaps", function(collectionApi) {
    return collectionApi.getFilteredByGlob("content/recaps/*.md").sort((a,b) => b.date - a.date);
  });
  eleventyConfig.addCollection("news", function(collectionApi) {
    return collectionApi.getFilteredByGlob("content/news/*.md").sort((a,b) => b.date - a.date);
  });
  eleventyConfig.addCollection("allContent", function(collectionApi) {
    const shows = collectionApi.getFilteredByGlob("content/shows/*.md");
    shows.forEach(function(i){ i.kind = "show"; });
    const recaps = collectionApi.getFilteredByGlob("content/recaps/*.md");
    recaps.forEach(function(i){ i.kind = "recap"; });
    const news = collectionApi.getFilteredByGlob("content/news/*.md");
    news.forEach(function(i){ i.kind = "news"; });
    return shows.concat(recaps, news).sort((a,b) => b.date - a.date);
  });

  eleventyConfig.addCollection("tagList", function(collectionApi) {
    const tagSet = new Map();
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
          if (!tagSet.has(cleanTag)) {
            tagSet.set(cleanTag, 0);
          }
          tagSet.set(cleanTag, tagSet.get(cleanTag) + 1);
        });
      }
    });
    return Array.from(tagSet.entries()).map(([name, count]) => ({
      name,
      slug: arabicSlug(name),
      count
    })).sort((a,b) => b.count - a.count);
  });

  eleventyConfig.addPassthroughCopy("admin/index.html");
  eleventyConfig.addPassthroughCopy({"admin/config.yml": "admin/config.yml"});
  eleventyConfig.addPassthroughCopy("content/images");

  eleventyConfig.on("eleventy.after", () => {
    const fs = require("fs");
    if (fs.existsSync("favicon.svg")) {
      if (!fs.existsSync("_site")) fs.mkdirSync("_site", { recursive: true });
      fs.copyFileSync("favicon.svg", "_site/favicon.svg");
      fs.copyFileSync("favicon.svg", "_site/favicon.ico");
      fs.copyFileSync("favicon.svg", "_site/favicon.png");
      fs.copyFileSync("favicon.svg", "_site/apple-touch-icon.png");
    }
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
