import { test } from "node:test";
import assert from "node:assert/strict";
import { applyCorrections } from "../scripts/news-qa";

// INCIDENTS #1213: a rule written with «ال» missed its «لل» form, and «العرض» took feminine adjectives.
test("a rule written with «ال» also fixes the «لل» form", () => {
  assert.equal(applyCorrections("حقق كل ما يمكن للمصارعة الحرة أن تقدمه"), "حقق كل ما يمكن للمصارعة أن تقدمه");
  assert.equal(applyCorrections("لحبه الشديد وللمصارعة الحرة"), "لحبه الشديد وللمصارعة");
  assert.equal(applyCorrections("عالم المصارعة الحرة"), "عالم المصارعة");
  // idempotent
  assert.equal(applyCorrections("يمكن للمصارعة أن تقدمه"), "يمكن للمصارعة أن تقدمه");
});

test("«العرض» takes a masculine adjective after a preposition", () => {
  assert.equal(applyCorrections("فاز في العرض الأخيرة من Dynamite"), "فاز في العرض الأخير من Dynamite");
  assert.equal(applyCorrections("يظهر في العرض القادمة"), "يظهر في العرض القادم");
  // «نسخة العرض الأخيرة»: the adjective describes «نسخة» — left alone
  assert.equal(applyCorrections("نسخة العرض الأخيرة"), "نسخة العرض الأخيرة");
});
