import { test } from "node:test";
import assert from "node:assert/strict";
import { applyCorrections } from "../scripts/news-qa.ts";

// INCIDENTS #1000 — garbled phrases in the 2026-11-01 evening stories.
test("garbled Arabic phrases are corrected", () => {
  assert.equal(applyCorrections("وأكد أن الملب قلقل لدرجة كبيرة"), "وأكد أن المقلب أقلقه لدرجة كبيرة");
  assert.equal(applyCorrections("لم يعدو كونه مقلبا"), "لم يكن سوى مقلبا");
  assert.equal(applyCorrections("في أول ظهور لها المستقلة"), "في أول ظهور لها في المصارعة المستقلة");
});
