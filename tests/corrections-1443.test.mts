import { test } from "node:test";
import assert from "node:assert/strict";
import { applyCorrections } from "../scripts/news-qa.ts";

// INCIDENTS #1443: «في المجرى النهائي للمواجهة» and «يوم ذكرى ضحايا التحول الجنسي».
test("#1443 slips are corrected", () => {
  assert.equal(applyCorrections("دوره في المجرى النهائي للمواجهة"), "دوره في النتيجة النهائية للمواجهة");
  assert.equal(applyCorrections("تزامنا مع يوم ذكرى ضحايا التحول الجنسي."), "تزامنا مع يوم إحياء ذكرى المتحولين جنسيا.");
});
