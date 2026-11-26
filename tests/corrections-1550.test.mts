import { test } from "node:test";
import assert from "node:assert/strict";
import { applyCorrections } from "../scripts/news-qa.ts";

// INCIDENTS #1550: «خطى خطوة», «ظروف العمل للخلف» and «كيد كاوص» reached the site.
test("«خطا خطوة», «لمن جاء بعده» and «كاوس» are corrected", () => {
  assert.equal(applyCorrections("لكنه خطى خطوة إضافية"), "لكنه خطا خطوة إضافية");
  assert.equal(applyCorrections("وخطى خطوات كبيرة"), "وخطا خطوات كبيرة");
  assert.equal(applyCorrections("على خطى والده"), "على خطى والده");
  assert.equal(applyCorrections("لتحسين ظروف العمل للخلف"), "لتحسين ظروف العمل لمن جاء بعده");
  assert.equal(applyCorrections("بابا جوس وكيد كاوص"), "بابا جوس وكيد كاوس");
});
