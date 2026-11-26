import { test } from "node:test";
import assert from "node:assert/strict";
import { checkArticle, garbledSurnames, BLOCKING_QA_CODES, RETRYABLE_QA_CODES } from "../scripts/news-qa.ts";

// Ciampa story, live 2026-11-26: «دانيال غارسيا» then «إثر إصابة غاريسون في ذراعه» — the source says «Garcia».
test("a surname rewritten as another name later in the story is blocked", () => {
  const body = "اضطر اتحاد AEW لاستبدال دانيال غارسيا بالمصارع كونوسوكي تاكيشيتا في البطولة إثر إصابة غاريسون في ذراعه.";
  assert.deepEqual(garbledSurnames(body), [["غارسيا", "غاريسون"]]);
  assert.ok(checkArticle("توماسو تشامبا يتعرض لإصابة", body).some((i) => i.code === "garbled_surname"));
  assert.ok(BLOCKING_QA_CODES.includes("garbled_surname") && RETRYABLE_QA_CODES.includes("garbled_surname"));
});

test("real words and other people's full names are left alone", () => {
  assert.deepEqual(garbledSurnames("فاز دانيال غارسيا ثم قال غارسيا إنه جاهز"), []);
  assert.deepEqual(garbledSurnames("تحدث ليون سلاتر عن نزال السلالم"), []);
  assert.deepEqual(garbledSurnames("حذف كيانو كارفر بعد شكوى زميلته بيانكا كاريلي، وتقدمت كاريلي بطلب"), []);
});
