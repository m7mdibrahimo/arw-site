import { test } from "node:test";
import assert from "node:assert/strict";
import { applyCorrections } from "../scripts/news-qa.ts";

// INCIDENTS #1399: «reigning Continental Champion» became «بطل Continental المعزز».
test("«reigning» champion is «الحالي», not «المعزز»", () => {
  assert.equal(applyCorrections("بينما يلتقي بطل Continental المعزز جون موكسلي"), "بينما يلتقي بطل Continental الحالي جون موكسلي");
  assert.equal(applyCorrections("بطلة TBS المعززة أميناتا"), "بطلة TBS الحالية أميناتا");
  assert.equal(applyCorrections("الدعم المعزز للفريق"), "الدعم المعزز للفريق");
});
