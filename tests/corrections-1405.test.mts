import { test } from "node:test";
import assert from "node:assert/strict";
import { applyCorrections } from "../scripts/news-qa.ts";

// INCIDENTS #1405: Brie Bella as «بيكي بيلا», Alberta as «ألبرت», Kasper Brothers as «عائلة كاسبر».
test("Brie Bella, Alberta and the Kasper Brothers", () => {
  assert.equal(applyCorrections("بعد الفوز على بايج وبيكي بيلا"), "بعد الفوز على بايج وبري بيلا");
  assert.equal(applyCorrections("في مدينة كالغاري بمقاطعة ألبرت."), "في مدينة كالغاري بمقاطعة ألبرتا.");
  assert.equal(applyCorrections("بمقاطعة ألبرتا"), "بمقاطعة ألبرتا");
  assert.equal(applyCorrections("برفقة عائلة كاسبر"), "برفقة الإخوة كاسبر");
});
