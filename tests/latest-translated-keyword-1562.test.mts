import { test } from "node:test";
import assert from "node:assert/strict";

// INCIDENTS #1562: «عرض الرو الاخير مترجم» (4.7 on RAW 23.11; 219 clicks site-wide) and «عرض سماك داون الاخير مترجم» (3.9 on
// SmackDown 20.11) were in the pages' alternateName but never among the 14 keywords: they counted as one more «الاخير» form.
test("the newest weekly episode's keywords carry «<show> الاخير مترجم» (INCIDENTS #1562)", async () => {
  const { keywordList } = await import("../lib/show-seo.cjs");
  const names = ["عرض الرو", "دبليو دبليو إي راو", "رو", "راو", "عرض رو الاخير", "عرض الرو الاخير", "عرض الرو الأخير 2026", "عرض الرو مترجم", "تحميل عرض الرو",
    "عرض الرو كامل", "اخر عرض الرو", "مشاهدة عرض الرو", "عرض WWE مترجم", "عرض الرو الاخير مترجم", "عرض الرو الأخير مترجم",
    "عرض الرو 23/11/2026", "عرض الرو 23 نوفمبر 2026", "WWE RAW November 23 2026", "WWE RAW 11/23/2026", "WWE RAW 23 November 2026"];
  const kw = keywordList([], names, 14, true);
  assert.equal(kw.length, 14);
  assert.ok(kw.includes("عرض الرو الاخير مترجم"), kw.join(" | "));
  assert.ok(!kw.includes("عرض الرو الأخير مترجم"), "one hamza spelling only");
  for (const q of ["عرض الرو الاخير", "عرض الرو الأخير 2026", "عرض الرو مترجم", "تحميل عرض الرو", "مشاهدة عرض الرو", "عرض WWE مترجم"]) assert.ok(kw.includes(q), q);
  // an older episode has no «الاخير» names (dropLatestClaims), so its list does not change
  const old = keywordList([], names.filter((n) => !/ال[اأ]خير|^اخر/.test(n)), 14, true);
  assert.ok(!old.some((n) => /ال[اأ]خير/.test(n)));
});
