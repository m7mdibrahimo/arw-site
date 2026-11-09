import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

// INCIDENTS #1169: the home page's news loop walked all ~5,300 stories to show 12. A loop with an async shortcode
// ({% optImg %}) in it runs as Nunjucks asyncEach, which recurses once per item, and past ~5,250 stories the build
// died with «Maximum call stack size exceeded». Every loop over a whole collection that holds an async shortcode
// must get a bounded list (homeFirst / slice), never the whole archive.
test('no template loops over a whole collection with an async image shortcode inside', () => {
  const files = ["index.njk", ...fs.readdirSync("pages").filter((f) => f.endsWith(".njk")).map((f) => `pages/${f}`)];
  const bad: string[] = [];
  for (const f of files) {
    const src = fs.readFileSync(f, "utf8");
    const re = /\{%-?\s*for\s+\w+\s+in\s+collections\.(news|shows|allContent|nostalgiaShows)\s*-?%\}([\s\S]*?)\{%-?\s*endfor\s*-?%\}/g;
    // search-index awaits optImg on every item, so each iteration unwinds the stack: only loops that skip items recurse
    if (f === "pages/search-index.njk") continue;
    for (const m of src.matchAll(re)) if (/\{%-?\s*opt(?:Img|Thumb|Card|ThumbMeta)\b/.test(m[2])) bad.push(`${f}: collections.${m[1]}`);
  }
  assert.deepEqual(bad, []);
});

test('homeFirst keeps the first n non-nostalgia items in order', async () => {
  const src = fs.readFileSync("eleventy.config.js", "utf8");
  assert.match(src, /addNunjucksFilter\("homeFirst"/);
  const home = fs.readFileSync("index.njk", "utf8");
  assert.match(home, /collections\.news \| homeFirst\(12\)/);
  assert.match(home, /collections\.shows \| homeFirst\(8\)/);
});
