import { test } from "node:test";
import assert from "node:assert/strict";
import { applyCorrections } from "../scripts/news-qa.ts";

// INCIDENTS #1402: «in a box» came out as «الصندوق الذي كنت محجوزة فيه».
test("«محجوزة فيه» (trapped) becomes «محبوسة فيه»", () => {
  assert.equal(applyCorrections("الصندوق الذي كنت محجوزة فيه"), "الصندوق الذي كنت محبوسة فيه");
  assert.equal(applyCorrections("كان محجوزا داخله"), "كان محبوسا داخله");
  assert.equal(applyCorrections("المقعد محجوز له"), "المقعد محجوز له");
});
