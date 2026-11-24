import { test } from "node:test";
import assert from "node:assert/strict";
import { titlePromotionsUncovered, checkArticle, BLOCKING_QA_CODES, applyCorrections } from "../scripts/news-qa.ts";

// INCIDENTS #1514: the injury-report headline listed NJPW but the body only named it in the shared opening line.
test("a promotion listed in the headline needs its own sentence in the body", () => {
  const title = "قائمة إصابات المصارعين في اتحادات WWE وAEW وTNA وNJPW";
  const body = "يغيب عدد من المصارعين في اتحادات WWE وAEW وTNA وNJPW. في اتحاد WWE، يغيب لوغان بول.\n\nوفي اتحاد AEW، يغيب آدم كول. أما في اتحاد TNA، فيتعافى كريس باي.";
  assert.deepEqual(titlePromotionsUncovered(title, body), ["NJPW"]);
  assert.ok(checkArticle(title, body).some(i => i.code === "title_promo_uncovered"));
  assert.ok(BLOCKING_QA_CODES.includes("title_promo_uncovered"));
  assert.deepEqual(titlePromotionsUncovered(title, body + "\n\nوفي اتحاد NJPW، يغيب توموهيرو إيشي."), []);
});

test("headlines with one or two promotions are not checked", () => {
  assert.deepEqual(titlePromotionsUncovered("إيفا ماري تكشف شروطها للانضمام إلى AEW بعد رحيلها عن WWE", "تحدثت إيفا ماري عن مستقبلها."), []);
});

test("«ثنائي الفرق» becomes «الثنائي»", () => {
  const out = applyCorrections("بالإضافة إلى غياب ثنائي الفرق إيزايا كاسيدي ومارك كوين");
  assert.match(out, /غياب الثنائي إيزايا/);
});
