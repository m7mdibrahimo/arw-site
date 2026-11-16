import test from "node:test";
import assert from "node:assert/strict";
import { applyCorrections } from "../scripts/news-qa.ts";

// INCIDENTS #1351: «باستخدام عصا سنغافورية» (Tasha Steelz, TNA Destination X) — «Singapore cane» is «عصا الكيندو».
test("«عصا سنغافورية» becomes «عصا الكيندو», and «كندو» is spelled one way", () => {
  assert.equal(applyCorrections("باستخدام عصا سنغافورية، تمكنت"), "باستخدام عصا الكيندو، تمكنت");
  assert.equal(applyCorrections("استخدمت هوجان العصا السنغافورية لإبعاد"), "استخدمت هوجان عصا الكيندو لإبعاد");
  assert.equal(applyCorrections("ضربه بعصا الكندو"), "ضربه بعصا الكيندو");
  assert.equal(applyCorrections("بعصا كندو"), "بعصا كيندو");
  assert.equal(applyCorrections("ضربه بعصا الكيندو"), "ضربه بعصا الكيندو");
});

test("«بعد اعتداءها» becomes «بعد اعتدائها», and an accusative «أن اعتداءها» is left alone", () => {
  assert.equal(applyCorrections("بعد اعتداءها العنيف"), "بعد اعتدائها العنيف");
  assert.equal(applyCorrections("بعد اعتداءهم على"), "بعد اعتدائهم على");
  assert.equal(applyCorrections("أن اعتداءها كان"), "أن اعتداءها كان");
});

test("«تراي ميغيل» is the glossary's «تراي ميجيل»", () => {
  assert.equal(applyCorrections("عودة تراي ميغيل المفاجئة"), "عودة تراي ميجيل المفاجئة");
  assert.equal(applyCorrections("فاز تري ميجيل"), "فاز تراي ميجيل");
  assert.equal(applyCorrections("فاز تراي ميجيل"), "فاز تراي ميجيل");
});
