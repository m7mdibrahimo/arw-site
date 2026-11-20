import { test } from "node:test";
import assert from "node:assert/strict";
import { applyCorrections } from "../scripts/news-qa.ts";

// INCIDENTS #1434: an indefinite object lost its tanween alif («تقدم عروض تقتصر»).
test("«تقدم عروض تقتصر» becomes «تقدم عروضا تقتصر»", () => {
  assert.equal(applyCorrections("باتت تقدم عروض تقتصر على إرضاء قادتها"), "باتت تقدم عروضا تقتصر على إرضاء قادتها");
  assert.equal(applyCorrections("تقديم عروض تلبي رغبات الجماهير"), "تقديم عروض تلبي رغبات الجماهير");
});
