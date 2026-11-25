// INCIDENTS #1395: a show's VideoObject keywords were its first 14 alternateNames — the program's bare spellings
// («رو», «راو», «دبليو دبليو اي رو») — while the forms the newest RAW is searched by in Search Console
// («عرض الرو الاخير» 5.5, «تحميل عرض الرو» 4.5) and its dated names never reached them.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const { keywordList } = createRequire(import.meta.url)('../lib/show-seo.cjs');

const names = ["عرض الرو", "دبليو دبليو إي راو", "دبليو دبليو اي رو", "رو", "الرو", "راو", "عرض رو", "الرو الاخير", "الرو مترجم",
  "WWE Raw", "WWE RAW مترجم", "Monday Night Raw", "raw مترجم", "wwe مترجم", "مصارعة حرة مترجم", "تحميل عرض الرو",
  "عرض الرو الاخير", "عرض الرو الاخير مترجم", "عرض الرو 16/11/2026", "عرض الرو 16 نوفمبر 2026", "WWE RAW November 16 2026"];

test("a show's video keywords lead with its dated names and searched forms, not bare spellings (INCIDENTS #1395)", () => {
  const kw = keywordList([], names, 14, true);
  assert.equal(kw.length, 14);
  for (const k of ["عرض الرو الاخير", "تحميل عرض الرو", "عرض الرو الاخير مترجم", "عرض الرو 16/11/2026", "WWE RAW November 16 2026"]) assert.ok(kw.includes(k), k);
  // the old way (first 14) missed all of them
  for (const k of ["عرض الرو الاخير", "تحميل عرض الرو", "عرض الرو 16/11/2026"]) assert.ok(!names.slice(0, 14).includes(k));
});

test("among the searched forms, the program's own name and «الاخير» come before short generic ones (INCIDENTS #1395)", () => {
  const list = ["عرض الرو", "عرض رو مترجم", "اخر عرض الرو", "آخر عرض الرو", "عرض الرو كامل", "عرض رو الاخير", "عرض WWE مترجم", "تحميل عرض الرو",
    "عرض الرو الاخير", "عرض الرو الاخير مترجم", "عرض الرو مترجم", "رو", "راو", "عرض الرو 16/11/2026", "WWE RAW November 16 2026"];
  const kw = keywordList([], list, 8, true);
  assert.deepEqual(kw.slice(2, 7), ["عرض الرو", "عرض الرو الاخير", "عرض الرو مترجم", "تحميل عرض الرو", "عرض الرو كامل"]);
  assert.ok(!kw.includes("عرض WWE مترجم"));
});

test("one spelling per search word, and a recap's words last (INCIDENTS #1395)", () => {
  const list = ["عرض الرو", "عرض الرو الاخير", "عرض الرو الأخير", "عرض الرو الأخير 2026", "ملخص عرض الرو الاخير", "عرض الرو مترجم", "تحميل عرض الرو",
    "عرض الرو 16/11/2026"];
  const kw = keywordList([], list, 6, true);
  // «عرض الرو الأخير 2026» is its own search, not a spelling of «الاخير» (INCIDENTS #1529)
  assert.deepEqual(kw, ["عرض الرو 16/11/2026", "عرض الرو", "عرض الرو الاخير", "عرض الرو الأخير 2026", "عرض الرو مترجم", "تحميل عرض الرو"]);
});
