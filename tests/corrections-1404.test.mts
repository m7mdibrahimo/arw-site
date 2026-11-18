import { test } from "node:test";
import assert from "node:assert/strict";
import { applyCorrections } from "../scripts/news-qa.ts";

// INCIDENTS #1404: AZM spelled out as letters, «تميز» for «تمييز», and «أطوار» for persona.
test("AZM, «تمييز ما إذا» and the persona sentence", () => {
  assert.equal(applyCorrections("ستواجه كوين أميناتا وإيه جيه ام ومينا شيراكاوا"), "ستواجه كوين أميناتا وازوم ومينا شيراكاوا");
  assert.equal(applyCorrections("القدرة على تميز ما إذا كان المصارع يستمتع"), "القدرة على تمييز ما إذا كان المصارع يستمتع");
  assert.equal(applyCorrections("المبالغة في التفكير بطريقة أطوار شخصيتها"), "المبالغة في التفكير في طريقة أداء شخصيتها");
  assert.equal(applyCorrections("حافظ على تميز أدائه"), "حافظ على تميز أدائه");
});
