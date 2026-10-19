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
