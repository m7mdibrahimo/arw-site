import { test } from "node:test";
import assert from "node:assert/strict";
import { applyCorrections } from "../scripts/news-qa.ts";

// INCIDENTS #1559: «عدواتنا»، «الشروط الإجراءات».
test("round 2026-11-26 evening corrections", () => {
  assert.equal(applyCorrections("ما جعل عدواتنا مميزة"), "ما جعل عداوتنا مميزة");
  assert.equal(applyCorrections("بدأت عدواتهما"), "بدأت عداوتهما");
  assert.equal(applyCorrections("لعدم استيفاء الشروط الإجراءات القانونية"), "لعدم استيفاء الشروط الإجرائية القانونية");
});
