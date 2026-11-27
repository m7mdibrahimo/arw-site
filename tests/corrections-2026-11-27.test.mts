import { test } from "node:test";
import assert from "node:assert/strict";
import { applyCorrections, checkArticle, BLOCKING_QA_CODES } from "../scripts/news-qa.ts";

// Round 2026-11-27: words from the D-Von Dudley stories.
test("27 November wrong words are corrected", () => {
  assert.equal(applyCorrections("ديفون دادلي ينتتقد المصارعين"), "ديفون دادلي ينتقد المصارعين");
  assert.equal(applyCorrections("وانتتظر الجمهور"), "وانتظر الجمهور");
  assert.equal(applyCorrections("لم يصفه بأنه شخص عنصرى"), "لم يصفه بأنه شخص عنصري");
  assert.equal(applyCorrections("الوزن الخفيف، والهاركودر، وبطولة الفرق"), "الوزن الخفيف، والهاردكور، وبطولة الفرق");
  assert.equal(applyCorrections("ينتقد ويتنافس وانتظر"), "ينتقد ويتنافس وانتظر");
});

test("a word with «نتت» blocks publishing", () => {
  const body = "وجه أسطورة WWE ديفون دادلي انتقادات حادة لجيل المصارعين الحاليين بسبب مظهرهم الجسدي أمام الجماهير.";
  const codes = checkArticle("ديفون دادلي ينتتقد المصارعين الحاليين", body, []).map(i => i.code);
  assert.ok(codes.includes("impossible_letter_pair"));
  assert.ok(BLOCKING_QA_CODES.includes("impossible_letter_pair"));
  const clean = checkArticle("ديفون دادلي ينتقد المصارعين الحاليين", body, []).map(i => i.code);
  assert.ok(!clean.includes("impossible_letter_pair"));
});
