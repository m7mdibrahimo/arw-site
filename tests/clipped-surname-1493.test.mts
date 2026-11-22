import test from "node:test";
import assert from "node:assert/strict";
import { checkArticle, clippedSurnames, BLOCKING_QA_CODES, RETRYABLE_QA_CODES } from "../scripts/news-qa.ts";

// «برودي كينج» then «مما منح كين الفوز» / «وقال كين» went live (Brody King / Daniel Garcia story, INCIDENTS #1493)
test("a «نج» surname cut to «ن» after the full name blocks the story", () => {
  const body = "يواجه برودي كينج انتقادات بعد إصابة دانيال غارسيا، مما منح كين الفوز وثلاث نقاط. وقال كين إنه لم يرغب في ذلك.";
  assert.deepEqual(clippedSurnames(body), [["كينج", "كين"]]);
  assert.ok(checkArticle("برودي كينج يعلق على إصابة غارسيا", body).some((i) => i.code === "clipped_surname"));
  assert.ok(BLOCKING_QA_CODES.includes("clipped_surname") && RETRYABLE_QA_CODES.includes("clipped_surname"));
});

test("the right surname, or another wrestler named «كين», is fine", () => {
  assert.deepEqual(clippedSurnames("فاز برودي كينج ثم قال كينج إنه سعيد"), []);
  assert.deepEqual(clippedSurnames("واجه برودي كينج النجم كين شامروك، وقال كين شامروك إنه مستعد"), []);
  assert.deepEqual(clippedSurnames("يواجه كولتن غان فريق بانغ بانغ غانغ"), []);
});
