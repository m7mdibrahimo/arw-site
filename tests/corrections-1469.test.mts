import { test } from "node:test";
import assert from "node:assert/strict";
import { applyCorrections } from "../scripts/news-qa.ts";

// INCIDENTS #1469: «العرض الكامل لعرض» و«نزال تخللته تبادل».
test("round 2026-11-22 repeated «العرض… لعرض» and «تخللته تبادل» are corrected", () => {
  assert.equal(applyCorrections("مشاهدة العرض الكامل لعرض Lucha Libre AAA"), "مشاهدة الحلقة الكاملة من عرض Lucha Libre AAA");
  assert.equal(applyCorrections("بعد نزال تخللته تبادل للضربات"), "بعد نزال تخلله تبادل للضربات");
  assert.equal(applyCorrections("صراعا طويلا تخللته نزالات قوية"), "صراعا طويلا تخللته نزالات قوية");
});
