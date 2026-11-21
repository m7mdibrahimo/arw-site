import { test } from "node:test";
import assert from "node:assert/strict";
import { applyCorrections, checkArticle, BLOCKING_QA_CODES } from "../scripts/news-qa.ts";

// INCIDENTS #1458: words from the 21 November stories (Cruz, Shiloh Hill, Ken Anderson, The Rock).
test("21 November wrong words are corrected", () => {
  assert.equal(applyCorrections("لا أستطيع تحمل المصارعة بالمقنعات"), "لا أستطيع تحمل المصارعة بالأقنعة");
  assert.equal(applyCorrections("زملاؤه لا يفاجئون بوجوده"), "زملاؤه لا يتفاجؤون بوجوده");
  assert.equal(applyCorrections("وكان يثب نحوه"), "وكان يقفز نحوه");
  assert.equal(applyCorrections("يريد أن يثبت نفسه"), "يريد أن يثبت نفسه");
  assert.equal(applyCorrections("ليفاغئه ذا روك"), "ليفاجئه ذا روك");
});

test("a word with «غئ» blocks publishing", () => {
  const body = "أكد ماك أفي كلامه، ليفاغئه ذا روك بهجوم فوري حطم الطاولة تحته أمام الجماهير في الملعب.";
  const codes = checkArticle("ذا روك يهاجم بات ماك أفي", body, []).map(i => i.code);
  assert.ok(codes.includes("impossible_letter_pair"));
  assert.ok(BLOCKING_QA_CODES.includes("impossible_letter_pair"));
  const clean = checkArticle("ذا روك يهاجم بات ماك أفي", body.replace("ليفاغئه", "ليفاجئه"), []).map(i => i.code);
  assert.ok(!clean.includes("impossible_letter_pair"));
});
