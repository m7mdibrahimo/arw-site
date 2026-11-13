import { test } from "node:test";
import assert from "node:assert/strict";
import { autoFix, applyCorrections, showRelativeMasculine } from "../scripts/news-qa.ts";

test("«بعرض يوم X، والتي سجلت» → «الذي سجل» (INCIDENTS #1278)", () => {
  assert.equal(showRelativeMasculine("ومقارنة بعرض يوم 4 نوفمبر 2026، والتي سجلت 552 ألف مشاهد"),
    "ومقارنة بعرض يوم 4 نوفمبر 2026، الذي سجل 552 ألف مشاهد");
  assert.equal(showRelativeMasculine("خلال عرض WWE NXT (بتاريخ 11 أغسطس 2026)، والتي شهدت هجومه"),
    "خلال عرض WWE NXT (بتاريخ 11 أغسطس 2026)، الذي شهد هجومه");
  assert.equal(showRelativeMasculine("في عرض WWE Royal Rumble، والتي شهدت إقصاءه"), "في عرض WWE Royal Rumble، الذي شهد إقصاءه");
  assert.match(autoFix("ومقارنة بعرض يوم 4 نوفمبر، والتي سجلت 552 ألف مشاهد."), /بعرض يوم 4 نوفمبر، الذي سجل 552/);
});

test("a feminine or plural word before «عرض» keeps «والتي»", () => {
  for (const s of [
    "ضمن أحداث عرض AEW Dynamite (بتاريخ 12 أغسطس)، والتي شهدت إقامة مواجهتين",
    "هو نسخة 2019 من نفس العرض، والتي شهدت فوز جاكوب فاتو",
    "عقب أحداث عرض WWE RAW لهذا الأسبوع، والتي شهدت هجوما",
    "الحلقة الأخيرة، والتي شهدت عودته",
  ]) assert.equal(showRelativeMasculine(s), s);
});

test("Natsupoi/Xelhua spellings are corrected (INCIDENTS #1278)", () => {
  assert.match(applyCorrections("شينغو تاكاغي ونا تسوبوي ضد جيف كوب"), /وناتسوبوي/);
  assert.match(applyCorrections("نيون، إسفينخي، خيلوا، إل هيخو"), /، شيلوا،/);
  assert.equal(applyCorrections("وتخيلوا شعوري"), "وتخيلوا شعوري");
});
