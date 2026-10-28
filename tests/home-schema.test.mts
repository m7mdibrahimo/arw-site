// The home page's structured data (INCIDENTS #870): it is the page Google picks for the site's biggest queries
// («عرض الرو الاخير», «عرض سماك داون الاخير», «مصارعة حرة»), so its head says it is a collection page listing the
// latest episodes — head only, nothing a visitor sees, and the owner's four sections stay exactly as they are (#502).
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const home = fs.readFileSync("index.njk", "utf-8");

test("the home page is a CollectionPage with an ItemList of the latest shows", () => {
  assert.match(home, /"@type": "CollectionPage"/);
  assert.match(home, /"mainEntity": \{\s*"@type": "ItemList",\s*"itemListElement": \[/);
  assert.match(home, /for item in collections\.shows/);
  assert.match(home, /item\.url \| cleanUrl/);
  assert.match(home, /"@type": "Thing", "name": "Professional Wrestling", "sameAs": "https:\/\/en\.wikipedia\.org\/wiki\/Professional_wrestling"/);
});

test("the owner's four sections under the site name are untouched", () => {
  const names = [...home.matchAll(/"@type": "SiteNavigationElement",\s*"position": \d,\s*"name": "([^"]+)"/g)].map((m) => m[1]);
  assert.deepEqual(names, ["عروض المصارعة", "مكتبة العروض", "الأخبار", "نوستالجيا"]);
});

test("the home page says what the biggest whole-site queries ask, in its head only (INCIDENTS #914)", () => {
  // «مصارعه حره» (2656 ظهور، ترتيب 7.4)، «مصارعه» (1060، 8.9)، «مصارعة اون لاين» (933، 6.2)،
  // «المصارعه الحره» (304، 8.3) — Search Console, 2026-10-28. Google reads the spelled-out forms from the
  // structured data; they never reach the visible page.
  const keywords = (home.match(/"keywords": \[([\s\S]*?)\],/) || [])[1] || "";
  for (const q of ["مصارعة حرة", "مصارعه حره", "المصارعة الحرة", "المصارعه الحره", "مصارعة", "مصارعه", "مصارعة اون لاين", "عروض المصارعة الحرة مترجمة"]) {
    assert.ok(keywords.includes(`"${q}"`), `keywords is missing «${q}»`);
  }
  const alt = (home.match(/"alternateName": \[([^\]]*)\],\s*\n\s*"isPartOf"/) || [])[1] || "";
  assert.ok(alt.includes("موقع المصارعة الحرة"), alt);
  // no JSON-LD comment leaks into the rendered script
  assert.ok(!/"keywords": \[[^\]]*\/\//.test(home));
});
