import { test } from "node:test";
import assert from "node:assert/strict";
import { splitGluedBlocks, applyCorrections } from "../scripts/news-qa.ts";

test("a quote with no opening mark glued after a sentence gets its own paragraph (INCIDENTS #1442)", () => {
  const ar = "تم تسريب شائعات كاذبة حول إعداد ألعاب نارية إضافية للعرض. > لقد سربنا بالفعل للمواقع الإخبارية شائعة.";
  assert.match(splitGluedBlocks(ar), /للعرض\.\n\n> لقد سربنا/);
  const en = "misinformation regarding extra pyro was intentionally circulated. > We had actually leaked to the dirt sheets.";
  assert.match(splitGluedBlocks(en), /circulated\.\n\n> We had/);
  assert.equal(splitGluedBlocks("Score: 5 > 3 points"), "Score: 5 > 3 points");
});

test("«مهووسان» dual becomes plural (INCIDENTS #1442)", () => {
  assert.equal(applyCorrections("نحن مهووسون بالمصارعة، ومهووسان بعالم ديزني"), "نحن مهووسون بالمصارعة، ومهووسون بعالم ديزني");
});
