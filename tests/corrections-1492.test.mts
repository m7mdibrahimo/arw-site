import { test } from "node:test";
import assert from "node:assert/strict";
import { applyCorrections } from "../scripts/news-qa.ts";

// INCIDENTS #1492: «كالاوى»، «نزال باينيارد»، «ومنذ الحين»، «شغورها الفندقي»، «تعرض عرض خاص».
test("round 2026-11-23 corrections", () => {
  assert.equal(applyCorrections("وأكد كالاوى قائلا"), "وأكد كالاوي قائلا");
  assert.equal(applyCorrections("في نزال باينيارد قبل"), "في نزال Boneyard قبل");
  assert.equal(applyCorrections("ومنذ الحين، ظهر"), "ومنذ ذلك الحين، ظهر");
  assert.equal(applyCorrections("ومنذ ذلك الحين، ظهر"), "ومنذ ذلك الحين، ظهر");
  assert.equal(applyCorrections("تنقلاتها وشغورها الفندقي."), "تنقلاتها وإقامتها في الفنادق.");
  assert.equal(applyCorrections("قناة ESPN2 تعرض عرض خاص من WWE"), "قناة ESPN2 تعرض عرضا خاصا من WWE");
  assert.equal(applyCorrections("تعرض عرضا خاصا من WWE"), "تعرض عرضا خاصا من WWE");
});
