import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

// INCIDENTS #698: _data/deliveries (~6,800 files) and the bots' state files were loaded as global data and deep-copied
// into every page's data: 4.5 GB of heap, the build died out of memory on Cloudflare.
test("the bots' bookkeeping stays out of Eleventy's global data", () => {
  const src = fs.readFileSync("eleventy.config.js", "utf8");
  assert.ok(src.includes('eleventyConfig.on("eleventy.globalDataFiles"'), "the globalDataFiles filter is gone");
  const m = /eleventy\.globalDataFiles[\s\S]*?\.test\(/.exec(src);
  assert.ok(m, "filter regex missing");
  for (const f of ["deliveries/", "publish-state", "duplicate-skips", "show-reel-state"]) assert.ok(src.includes(f.replace("-", "-")), f);
});

// 2026-11-14: _data/videoLinks.json (~1,400 objects, read by the show pages) was deep-copied the same way into each of
// ~10,000 pages: ~2 GB, peak 5.2–6.6 GB, and the full build died out of memory again. It comes in once, frozen, and
// Eleventy shares a frozen object instead of copying it.
test("videoLinks is global data Eleventy shares, never copies per page", async () => {
  const src = fs.readFileSync("eleventy.config.js", "utf8");
  const m = /eleventy\.globalDataFiles[\s\S]*?\.test\(/.exec(src);
  assert.ok(m && m[0].includes("videoLinks\\.json$"), "videoLinks.json is left out of the data files");
  assert.match(src, /addGlobalData\("videoLinks", \(\) => \{\s*try \{ return deepFreeze\(JSON\.parse\(fs\.readFileSync\(path\.join\(__dirname, "_data\/videoLinks\.json"\)/);
  // the Eleventy behaviour this relies on (an upgrade that copies frozen objects would bring the 2 GB back)
  const { createRequire } = await import("node:module");
  const { Merge } = createRequire(import.meta.url)("@11ty/eleventy-utils");
  const shared = Object.freeze({ links: Object.freeze({ a: Object.freeze({ ok: true }) }), broken: Object.freeze([]) });
  const page = Merge({}, { videoLinks: shared, other: { x: 1 } }, { title: "t" });
  assert.equal(page.videoLinks, shared, "a frozen global object is shared, not copied");
  assert.equal(page.title, "t");
});
