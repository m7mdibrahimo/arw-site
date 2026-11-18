import { test } from "node:test";
import assert from "node:assert/strict";
import { applyCorrections } from "../scripts/news-qa.ts";
import { fixEnglishNames } from "../scripts/english-edition.ts";

// INCIDENTS #1406: «شعر الجماهير», «أحد ظهوره الأخيرة», «طلبني ... إلى مكتبه», «The Pat McAfeeShow».
test("past verb before الجماهير is feminine; «تشعر الجماهير» untouched", () => {
  assert.equal(applyCorrections("وكيف شعر الجماهير بأنه"), "وكيف شعرت الجماهير بأنه");
  assert.equal(applyCorrections("أن تشعر الجماهير بأن"), "أن تشعر الجماهير بأن");
});
test("«أحد ظهوره الأخيرة» → «أحد ظهوراته الأخيرة»", () => {
  assert.equal(applyCorrections("مجرد أحد ظهوره الأخيرة"), "مجرد أحد ظهوراته الأخيرة");
});
test("«طلبني X إلى مكتبه» → «استدعاني X إلى مكتبه»", () => {
  assert.equal(applyCorrections("طلبني فينس مكمان الأب إلى مكتبه وقال"), "استدعاني فينس مكمان الأب إلى مكتبه وقال");
});
test("«McAfeeShow» is split, the X handle in a link is kept", () => {
  assert.equal(fixEnglishNames("The Rock stated on The Pat McAfeeShow that"), "The Rock stated on The Pat McAfee Show that");
  assert.equal(fixEnglishNames("https://x.com/PatMcAfeeShow/status/1"), "https://x.com/PatMcAfeeShow/status/1");
  assert.equal(fixEnglishNames("follow @McAfeeShow now"), "follow @McAfeeShow now");
});
