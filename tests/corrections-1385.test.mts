import { test } from "node:test";
import assert from "node:assert/strict";
import { applyCorrections } from "../scripts/news-qa.ts";

// INCIDENTS #1385: grammar slips and «بطولة» used for the champion.
test("champion, not championship, before a name; grammar slips", () => {
  assert.equal(applyCorrections("يرى بطولة القارات إيثان بايج أن المشاركة فكرة سيئة"), "يرى بطل القارات إيثان بايج أن المشاركة فكرة سيئة");
  assert.equal(applyCorrections("فاز ببطولة القارات يوم الاثنين"), "فاز ببطولة القارات يوم الاثنين");
  assert.equal(applyCorrections("يواصل مسيرته كبطل للقسم القاري"), "يواصل مسيرته كبطل للقارات");
  assert.equal(applyCorrections("ليغلبته مشاعر التأثر"), "لتغلبه مشاعر التأثر");
  assert.equal(applyCorrections("وكان العودة صعبة"), "وكانت العودة صعبة");
});
