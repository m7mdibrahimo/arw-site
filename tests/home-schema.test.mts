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
