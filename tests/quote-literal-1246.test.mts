import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

// INCIDENTS #1246: Austin Creed's quote was translated word for word («أخرج عبر الشاشة», «وهذا ما أزدهر من خلاله», «أؤدي عملي بنجاح»).
test("literal quote translations from the Austin Creed story are corrected (INCIDENTS #1246)", async () => {
  const { applyCorrections } = await import("../scripts/news-qa");
  assert.equal(applyCorrections("لأنني أخرج عبر الشاشة أمام 20 ألف مشجع"), "لأنني أظهر على الهواء أمام 20 ألف مشجع");
  assert.equal(applyCorrections("وهذا ما أزدهر من خلاله وهو فرصة الفشل"), "وهذا ما يجعلني أتألق وهو فرصة الفشل");
  assert.equal(applyCorrections("أشعر أنني أؤدي عملي بنجاح"), "أشعر أنني بارع في عملي");
  const bad = fs.readdirSync("content/news").filter(f => f.endsWith(".md") && /أخرج عبر الشاشة|ما أزدهر من خلاله|أؤدي عملي بنجاح/.test(fs.readFileSync(`content/news/${f}`, "utf-8")));
  assert.deepEqual(bad, []);
  assert.ok(fs.readFileSync("editorial/style-guide.md", "utf-8").includes("INCIDENTS #1246"));
});

// INCIDENTS #1246: RAW 09.11.2026 — «عرض الرو مترجم» (5.0), «عرض الرو الاخير» (5.4) never reached the article's keywords.
test("a weekly episode's keywords lead with the searched forms after the program name (INCIDENTS #1246)", async () => {
  const { keywordList } = await import("../lib/show-seo.cjs");
  const names = ["عرض الرو", "دبليو دبليو إي راو", "دبليو دبليو اي رو", "رو", "الرو", "راو", "عرض رو", "WWE Raw", "عرض الرو الاخير", "عرض الرو مترجم", "تحميل عرض الرو",
    "عرض الرو 9/11/2026", "عرض الرو 9 نوفمبر 2026", "WWE RAW November 9 2026", "WWE RAW 11/9/2026", "WWE RAW 9 November 2026", "WWE RAW 9/11/2026", "Monday Night Raw November 9 2026"];
  const kw = keywordList(["WWE"], names, 14, true);
  for (const q of ["عرض الرو", "عرض الرو الاخير", "عرض الرو مترجم", "تحميل عرض الرو", "عرض الرو 9/11/2026"]) assert.ok(kw.includes(q), q);
  assert.ok(!kw.includes("راو"));
  // a yearly event keeps its own order (INCIDENTS #1226)
  const yearly = keywordList([], ["عرض كراون جول", "كراون جول", "عرض كراون جول 2026 كامل", "مشاهدة عرض كراون جول"], 14, true);
  assert.equal(yearly.indexOf("كراون جول") < yearly.indexOf("مشاهدة عرض كراون جول"), true);
});
