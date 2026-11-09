import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

// INCIDENTS #1180: «هذا ما استحققه» (broken verb) and «بين نجوم WWE والقسم الرئيسي وعرض NXT» (main roster split from WWE).
test("#1180 wording mistakes are corrected automatically", async () => {
  const { applyCorrections } = await import("../scripts/news-qa");
  assert.equal(applyCorrections("هذا ما استحققه على ما يبدو"), "هذا ما أستحقه على ما يبدو");
  assert.equal(applyCorrections("مواجهات بين نجوم WWE والقسم الرئيسي وعرض NXT"), "مواجهات بين نجوم القسم الرئيسي في WWE وعرض NXT");
  // the past tense stays as it is
  assert.equal(applyCorrections("لقد استحققته"), "لقد استحققته");
  const bad = fs.readdirSync("content/news").filter(f => f.endsWith(".md") &&
    /استحققه(?![ء-ي])|نجوم WWE والقسم الرئيسي/.test(fs.readFileSync(`content/news/${f}`, "utf-8")));
  assert.deepEqual(bad, []);
});

// INCIDENTS #1180: «CMLL Sabados De Coliseo» (filed title-cased, no accents) had no correctly written Spanish name in its head.
test("a CMLL program carries its Spanish name with accents and lowercase «de»", async () => {
  const { showNameForms } = await import("../lib/show-seo.cjs");
  const forms = showNameForms({ headline: "عرض سي ام ال ال سابادوس دي كوليسيو 07.11.2026 مترجم", title: "CMLL Sabados De Coliseo 07.11.2026",
    programName: "CMLL Sabados De Coliseo", eventDate: "2026-11-07", aliases: [], isShow: true });
  for (const f of ["CMLL Sábados de Coliseo", "Sábados de Coliseo 07.11.2026", "CMLL Sabados de Coliseo"]) assert.ok(forms.includes(f), f);
  // a WWE program gets nothing new
  const raw = showNameForms({ headline: "عرض الرو 02.11.2026 مترجم", title: "WWE Raw 02.11.2026", programName: "WWE Raw", eventDate: "2026-11-02", aliases: [], isShow: true });
  assert.ok(!raw.some(f => /[áéíóú]/.test(f)));
});
