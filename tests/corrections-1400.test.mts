import { test } from "node:test";
import assert from "node:assert/strict";
import { applyCorrections } from "../scripts/news-qa.ts";

// INCIDENTS #1400: a dropped «مع», a misspelled «Nacho» and a film called «عرض».
test("«اتفق مسبقا» keeps «مع» before the name", () => {
  assert.equal(applyCorrections("أنه لم يتفق مسبقا ذا أندرتيكر على الكلام"), "أنه لم يتفق مسبقا مع ذا أندرتيكر على الكلام");
  assert.equal(applyCorrections("لم يتفق مسبقا مع ذا أندرتيكر"), "لم يتفق مسبقا مع ذا أندرتيكر");
});
test("Nacho is «ناتشو»", () => {
  assert.equal(applyCorrections("تحية خاصة، ناهشو."), "تحية خاصة، ناتشو.");
});
test("a «…: The Movie» title is a film, not a show", () => {
  assert.equal(applyCorrections("المشاركة في عرض Psych: The Movie عام 2017"), "المشاركة في فيلم Psych: The Movie عام 2017");
  assert.equal(applyCorrections("في عرض WWE RAW"), "في عرض WWE RAW");
});
