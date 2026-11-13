// INCIDENTS #1272 — ROH TV 12 Nov results: «وكارلي برايفر» (Carlie Bravo) slipped past the near-miss glossary fixer
// because of the joined «و»; «بطولة ROH للوزن النقي» for the Pure Championship; «ليقتنصا/ويخرجا» duals.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { fixNearGlossaryNames, applyCorrections } from "../scripts/news-qa.ts";

test("a joined و/ب/ل before the first name does not hide a near-miss glossary name", () => {
  assert.equal(fixNearGlossaryNames("الكابتن شون دين وكارلي برايفر، برفقة", ["كارلي برافو"]), "الكابتن شون دين وكارلي برافو، برفقة");
  assert.equal(fixNearGlossaryNames("فاز على كارلي برايفر.", ["كارلي برافو"]), "فاز على كارلي برافو.");
  // a right spelling stays as it is
  assert.equal(fixNearGlossaryNames("وكارلي برافو", ["كارلي برافو"]), "وكارلي برافو");
});

test("ROH Pure titles are «بيور», never «الوزن النقي»", () => {
  assert.equal(applyCorrections("**المواجهة الثانية: بطولة ROH للوزن النقي**"), "**المواجهة الثانية: بطولة ROH بيور**");
  assert.equal(applyCorrections("بطولة ROH النسائية للوزن النقي"), "بطولة ROH بيور للسيدات");
  assert.equal(applyCorrections("سيواجه بطل ROH للوزن النقي لي موريارتي"), "سيواجه بطل ROH بيور لي موريارتي");
});

test("result-verb duals «ليقتنصا/ويخرجا/ليعزلا» become plural", () => {
  assert.equal(applyCorrections("ليقتنصا التثبيت ويخرجا بانتصار"), "ليقتنصوا التثبيت ويخرجوا بانتصار");
  assert.equal(applyCorrections("ليعزلا الخصم"), "ليعزلوا الخصم");
});

test("glossary has the ROH names the story misspelled", () => {
  const g = JSON.parse(fs.readFileSync("scripts/wrestler-names.json", "utf-8"));
  assert.equal(g["Kiran Grey"], "كيران غراي");
  assert.equal(g["B3CCA"], "بيكا");
  assert.equal(g["Tehuti Miles"], "تيهوتي مايلز");
  assert.equal(applyCorrections("كيران غري وتيهوتي مائلز وبيبيكا"), "كيران غراي وتيهوتي مايلز وبيكا");
});
