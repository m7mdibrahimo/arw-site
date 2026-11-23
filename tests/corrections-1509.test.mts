import { test } from "node:test";
import assert from "node:assert/strict";
import { applyCorrections } from "../scripts/news-qa.ts";

// INCIDENTS #1509: «مع اقتراب موعد عرض Survivor Series بخلاصة مواجهات كبرى» — meaningless rendering of a stacked card.
test("«بخلاصة مواجهات» becomes «بمجموعة من مواجهات»", () => {
  assert.equal(applyCorrections("عرض حافل بخلاصة مواجهات كبرى"), "عرض حافل بمجموعة من مواجهات كبرى");
  assert.equal(applyCorrections("خلاصة القول"), "خلاصة القول");
});
