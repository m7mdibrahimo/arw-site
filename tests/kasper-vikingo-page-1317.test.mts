import { test } from "node:test";
import assert from "node:assert/strict";
import { applyCorrections } from "../scripts/news-qa.ts";

test("«الأخوة كاسبر» → «الإخوة كاسبر», but «روح الأخوة والصداقة» stays (INCIDENTS #1317)", () => {
  assert.equal(applyCorrections("الأخوة كاسبر يوقعون عقدا"), "الإخوة كاسبر يوقعون عقدا");
  assert.equal(applyCorrections("الظهور الأول للأخوة كاسبر"), "الظهور الأول للإخوة كاسبر");
  assert.equal(applyCorrections("روح الأخوة والصداقة"), "روح الأخوة والصداقة");
  assert.equal(applyCorrections("الأخوة في الحلبة"), "الأخوة في الحلبة");
});

test("«ديل فيكينغو» follows the glossary «ديل فيكينجو»", () => {
  assert.equal(applyCorrections("إصابة إل هيخو ديل فيكينغو"), "إصابة إل هيخو ديل فيكينجو");
});

test("«ليضع حد النهاية لمسيرته داخل الحلبة» → «ليختم بذلك مسيرته»", () => {
  assert.equal(applyCorrections("في عرض UFC 334 ليضع حد النهاية لمسيرته داخل الحلبة."), "في عرض UFC 334 ليختم بذلك مسيرته.");
});

test("Hangman «بيدج» is never «بايج» later in the same story, but Saraya's Paige stays", () => {
  assert.equal(applyCorrections("فوزهم على هانغمان بيدج. استهدف بايج وبروديدو"), "فوزهم على هانغمان بيدج. استهدف بيدج وبروديدو");
  assert.equal(applyCorrections("هانغمان بيدج وسارايا التي عرفت باسم بايج"), "هانغمان بيدج وسارايا التي عرفت باسم بايج");
});
