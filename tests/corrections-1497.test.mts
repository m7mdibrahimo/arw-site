import { test } from "node:test";
import assert from "node:assert/strict";
import { applyCorrections } from "../scripts/news-qa.ts";

// INCIDENTS #1497: «خسارته فرصا كبيرة في اتحاد WWE وAEW» (one «اتحاد» before two promotions) and the literal
// «أفسد تماما تعامله مع القيادة» reached the site in the Jeff Hardy story.
test("«اتحاد WWE وAEW» loses the singular «اتحاد»; one promotion keeps it", () => {
  assert.equal(applyCorrections("فرصا كبيرة في اتحاد WWE وAEW."), "فرصا كبيرة في WWE وAEW.");
  assert.equal(applyCorrections("عبر اتحادي WWE وTNA"), "عبر WWE وTNA");
  assert.equal(applyCorrections("انضم إلى اتحاد WWE وقرر البقاء"), "انضم إلى اتحاد WWE وقرر البقاء");
  assert.equal(applyCorrections("وأضاف أنه أفسد تماما تعامله مع القيادة"), "وأضاف أنه أخطأ كثيرا حين كان يقود سيارته");
});
