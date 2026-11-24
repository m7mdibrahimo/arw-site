import { test } from "node:test";
import assert from "node:assert/strict";
import { applyCorrections } from "../scripts/news-qa.ts";

// INCIDENTS #1524: Cody Rhodes «أموره غير الحسمة» + «بينهمدين»; Jade Cargill «نجمات WWE الحاليين» + «التي مهدن».
test("broken words and feminine-plural agreement are corrected", () => {
  assert.equal(applyCorrections("أموره غير الحسمة مع ذا روك"), "أموره غير المحسومة مع ذا روك");
  assert.equal(applyCorrections("الأمر بينهمدين يتعلق"), "الأمر بينهم يتعلق");
  assert.equal(applyCorrections("نجمات WWE الحاليين يواصلن"), "نجمات WWE الحاليات يواصلن");
  assert.equal(applyCorrections("النجمات الحاليين"), "النجمات الحاليات");
  assert.equal(applyCorrections("بالنجمات التي مهدن الطريق"), "بالنجمات اللواتي مهدن الطريق");
  assert.equal(applyCorrections("المشاكل التي تواجه"), "المشاكل التي تواجه");
});
