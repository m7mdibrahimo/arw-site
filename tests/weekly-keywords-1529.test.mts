import { test } from "node:test";
import assert from "node:assert/strict";

// INCIDENTS #1529: «مشاهدة عرض الرو» (3.2) and «عرض الرو الاخير 2026» (4.0–4.7, 27 impressions) never reached a weekly
// episode's 14 keywords — seven day forms took half the slots though day searches are rare in Search Console.
test("a weekly episode's keywords carry «الأخير 2026» and «مشاهدة», with four day forms (INCIDENTS #1529)", async () => {
  const { keywordList } = await import("../lib/show-seo.cjs");
  const names = ["عرض الرو", "دبليو دبليو إي راو", "رو", "راو", "عرض الرو الاخير", "عرض الرو الأخير 2026", "عرض الرو مترجم", "تحميل عرض الرو",
    "عرض الرو كامل", "اخر عرض الرو", "مشاهدة عرض الرو", "عرض WWE مترجم", "عرض الرو الاخير مترجم",
    "عرض الرو 23/11/2026", "عرض الرو 23 نوفمبر 2026", "WWE RAW November 23 2026", "WWE RAW 11/23/2026", "WWE RAW 23 November 2026",
    "WWE RAW 23/11/2026", "Monday Night Raw November 23 2026"];
  const kw = keywordList([], names, 14, true);
  assert.equal(kw.length, 14);
  for (const q of ["عرض الرو الأخير 2026", "مشاهدة عرض الرو", "عرض الرو الاخير", "تحميل عرض الرو", "عرض WWE مترجم", "عرض الرو 23/11/2026"]) assert.ok(kw.includes(q), q);
  assert.equal(kw.filter((n) => /\d{1,2}[ ./-]/.test(n)).length, 4);
  assert.ok(!kw.includes("راو"));
  // a yearly event keeps half its slots for its dated names (#1226)
  const yearly = keywordList([], ["عرض كراون جول", "عرض كراون جول 2026 كامل", "كراون جول 1/11/2026", "كراون جول 1 نوفمبر 2026", "Crown Jewel November 1 2026",
    "Crown Jewel 11/1/2026", "Crown Jewel 1 November 2026", "Crown Jewel 1/11/2026", "عرض كراون جول 1.11.2026"], 14, true);
  assert.ok(yearly.slice(0, 7).every((n) => /\d{1,2}[ ./-]/.test(n)), yearly.join(" | "));
});
