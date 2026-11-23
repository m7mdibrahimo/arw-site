import { test } from "node:test";
import assert from "node:assert/strict";
import { applyCorrections } from "../scripts/news-qa.ts";

// INCIDENTS #1504: the Damian Priest story wrote «نتفليكس» (platforms stay in English), translated
// "live action" as «أفلام الأكشن الحية» (a wrong rule in the prompt taught it) and «مسيرة ممثلة».
test("Netflix stays in English; live action and acting career read as plain Arabic", () => {
  assert.equal(applyCorrections("متاحا على منصة نتفليكس منذ 20 نوفمبر"), "متاحا على منصة Netflix منذ 20 نوفمبر");
  assert.equal(applyCorrections("عرضته نيتفليكس."), "عرضته Netflix.");
  assert.equal(applyCorrections("من الرسوم المتحركة إلى أفلام الأكشن الحية."), "من الرسوم المتحركة إلى أفلام الأكشن.");
  assert.equal(applyCorrections("تريد مسيرة ممثلة في هوليوود"), "تريد مسيرة تمثيلية في هوليوود");
});
