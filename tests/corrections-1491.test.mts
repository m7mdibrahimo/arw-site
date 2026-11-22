import { test } from "node:test";
import assert from "node:assert/strict";
import { applyCorrections } from "../scripts/news-qa.ts";

// INCIDENTS #1491: «أحد أعظم من ممارسة هذه الرياضة» و«يصور مقطع خلف الكواليس».
test("round 2026-11-22 «أعظم من مارسوا» and «يصور مقطعا» are corrected", () => {
  assert.equal(applyCorrections("أحد أعظم من ممارسة هذه الرياضة"), "أحد أعظم من مارسوا هذه الرياضة");
  assert.equal(applyCorrections("ليجد نفسه يصور مقطع خلف الكواليس"), "ليجد نفسه يصور مقطعا خلف الكواليس");
  assert.equal(applyCorrections("ليجد نفسه يصور مقطعا خلف الكواليس"), "ليجد نفسه يصور مقطعا خلف الكواليس");
});
