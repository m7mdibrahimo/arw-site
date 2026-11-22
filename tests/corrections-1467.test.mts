import { test } from "node:test";
import assert from "node:assert/strict";
import { applyCorrections } from "../scripts/news-qa.ts";

// INCIDENTS #1467: «14 عاما من الرصانة» (sobriety) و«العمل الكامل» (full-time).
test("round 2026-11-22 sobriety / full-time slips are corrected", () => {
  assert.equal(applyCorrections("يتمتع بـ 14 عاما من الرصانة"), "يتمتع بـ 14 عاما من التعافي من الإدمان");
  assert.equal(applyCorrections("رغم انتهاء العمل الكامل له"), "رغم انتهاء العمل بدوام كامل له");
  assert.equal(applyCorrections("سبب تخطيه فترة العمل الكاملة"), "سبب تخطيه فترة العمل بدوام كامل");
});
