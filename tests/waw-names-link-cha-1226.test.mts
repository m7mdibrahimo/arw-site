import { test } from "node:test";
import assert from "node:assert/strict";
import { applyNamesGlossary } from "../scripts/fightful-watcher.ts";
import { autoFix, applyCorrections, checkArticle } from "../scripts/news-qa.ts";
import { fixEnglishNames } from "../scripts/english-edition.ts";
import { createRequire } from "node:module";

const { keywordList } = createRequire(import.meta.url)("../lib/show-seo.cjs");

test("#1226 a glossary name straight after «و» is translated like the same name without it", () => {
  assert.equal(applyNamesGlossary("هارلي كاميرون وShotzi"), "هارلي كاميرون وشوتزي");
  assert.equal(applyNamesGlossary("على A.J. Francis وLacey Lane"), "على إيه جيه فرانسيس ولاسي لين");
});

test("#1226 a company or promotion after «و» stays English", () => {
  assert.equal(applyNamesGlossary("NXT وTNA وEVOLVE."), "NXT وTNA وEVOLVE.");
  assert.equal(applyNamesGlossary("باراماونت وWarner Bros. Discovery معتبرا"), "باراماونت وWarner Bros. Discovery معتبرا");
});

test("#1226 «available at this link» is dropped, a quote with it stays", () => {
  const out = autoFix("تحدثت عن الفيلم.\n\nوأضافت أن كتابها الجديد 'Bulletproof Angel' متاح عبر الرابط المخصص له.\n\nhttps://www.youtube.com/watch?v=a");
  assert.ok(!out.includes("الرابط"));
  assert.ok(out.includes("https://www.youtube.com"));
  const q = "وقال: «الكتاب متاح عبر الرابط التالي». وانتهى اللقاء.";
  assert.equal(autoFix(q), q);
});

test("#1226 «حرصا بشدة» is a dual verb, «حرصا على» is not", () => {
  const codes = (b: string) => checkArticle("عنوان خبر عن WWE واضح ومباشر للقارئ", b, []).map(i => i.code);
  assert.ok(codes("وأكدت أن فينس مكمان وإدارة WWE حرصا بشدة على حماية شخصيتها طوال الوقت.").includes("dual_form"));
  assert.ok(!codes("تم نقلها إلى المستشفى حرصا على سلامتها بعد نهاية النزال.").includes("dual_form"));
});

test("#1226 Vince's name and AZM are corrected", () => {
  assert.equal(applyCorrections("فانس مكمان"), "فينس مكمان");
  assert.equal(applyCorrections("سكادي وأي زد إم وأثينا"), "سكادي وازوم وأثينا");
});

test("#1226 «Cha Cha» is a real double in an English results line", () => {
  assert.ok(fixEnglishNames("Chris Farrow def. Cha Cha Charlie to retain the BRCW Cha Cha Championship").includes("Cha Cha Charlie to retain the BRCW Cha Cha Championship"));
});

test("#1226 a yearly event's keywords lead with its year; a weekly episode's list is unchanged", () => {
  const names = ["عرض كراون جول", "كراون جول", "عرض كراون جول 7/11/2026", "عرض كراون جول 7 نوفمبر 2026", "عرض كراون جول الأخير 2026", "عرض كراون جول 2026", "مشاهدة عرض كراون جول 2026", "كراون جول 2026 مترجم", "عرض كراون جول 2026 كامل", "كراون جول 2026", "Crown Jewel 2026"];
  const kw = keywordList([], names, 14, true);
  assert.deepEqual(kw.slice(0, 3), ["عرض كراون جول 2026", "كراون جول 2026", "Crown Jewel 2026"]);
  assert.ok(kw.includes("عرض كراون جول 7/11/2026"));
  const weekly = ["عرض الرو", "الرو 2026", "عرض الرو 9/11/2026", "WWE RAW November 9 2026"];
  assert.deepEqual(keywordList([], weekly, 14, true), ["عرض الرو 9/11/2026", "WWE RAW November 9 2026", "عرض الرو", "الرو 2026"]);
});
