import { test } from "node:test";
import assert from "node:assert/strict";
import { applyCorrections, checkArticle, BLOCKING_QA_CODES } from "../scripts/news-qa.ts";

// INCIDENTS #1539: typos from the 25 November stories (Ilja Dragunov, Thea Hail).
test("25 November typos are corrected", () => {
  assert.equal(applyCorrections("يعيش مع شعور بالذنب لابتتعاده عن ابنه"), "يعيش مع شعور بالذنب لابتعاده عن ابنه");
  assert.equal(applyCorrections("قالت: «بسعر أو بدون شعر، أنا ثيا هيل»"), "قالت: «بشعر أو بدون شعر، أنا ثيا هيل»");
  assert.equal(applyCorrections("بسعر مرتفع"), "بسعر مرتفع");
});

test("«ابتت» blocks publishing", () => {
  const body = "تحدث إيليا دراغونوف عن شعوره بالذنب لابتتعاده عن ابنه الذي يعيش في بلد آخر بسبب عمله في المصارعة.";
  const codes = checkArticle("إيليا دراغونوف يتحدث عن ابنه", body, []).map(i => i.code);
  assert.ok(codes.includes("impossible_letter_pair"));
  assert.ok(BLOCKING_QA_CODES.includes("impossible_letter_pair"));
  const clean = checkArticle("إيليا دراغونوف يتحدث عن ابنه", body.replace("لابتتعاده", "لابتعاده"), []).map(i => i.code);
  assert.ok(!clean.includes("impossible_letter_pair"));
});
