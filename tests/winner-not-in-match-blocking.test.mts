import test from "node:test";
import assert from "node:assert/strict";
import { BLOCKING_QA_CODES, RETRYABLE_QA_CODES, checkArticle } from "../scripts/news-qa.ts";

// INCIDENTS: Main Event 4/11 — «تغلبت كانديس ليراي على بايج» above «🏆 الفائز: بايج» was published because the check was not blocking.
const bad = "بث اتحاد WWE عرض Main Event.\n\n**المواجهة الثانية: نزال فردي**\n\nتغلبت كانديس ليراي على بايج.\n\n🏆 **الفائز:** بايج\n";
test("winner_not_in_match blocks publishing and is retryable", () => {
  assert.ok(BLOCKING_QA_CODES.includes("winner_not_in_match"));
  assert.ok(RETRYABLE_QA_CODES.includes("winner_not_in_match"));
  assert.ok(checkArticle("نتائج عرض WWE Main Event (4 نوفمبر 2026)", bad).some(i => i.code === "winner_not_in_match"));
});
test("a correct winner line is not flagged", () => {
  const ok = bad.replace("تغلبت كانديس ليراي على بايج.", "تغلبت بايج على كانديس ليراي.");
  assert.ok(!checkArticle("نتائج عرض WWE Main Event (4 نوفمبر 2026)", ok).some(i => i.code === "winner_not_in_match"));
});
