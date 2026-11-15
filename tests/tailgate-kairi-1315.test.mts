import { test } from "node:test";
import assert from "node:assert/strict";
import { checkArticle, BLOCKING_QA_CODES, applyCorrections, fixNearGlossaryNames } from "../scripts/news-qa.ts";

// INCIDENTS #1315: «لعرض عرض AEW Collision» (Kairi), «نزال التايلغيت براول» (Don Callis Family), «هيان» for Hyan.
test("«عرض عرض» blocks publishing", () => {
  const codes = checkArticle("مستجدات كايري", "التقت توني خان أثناء استضافة الرحلة لعرض عرض AEW Collision الأخير، لكنها لم توقع.", [])
    .map(i => i.code).filter(c => BLOCKING_QA_CODES.includes(c));
  assert.ok(codes.includes("doubled_show_word"));
});

test("Tailgate Brawl is a pre-show written in English", () => {
  assert.equal(applyCorrections("ففي نزال التايلغيت براول، تمكن"), "ففي العرض التمهيدي Tailgate Brawl، تمكن");
  assert.equal(applyCorrections("خلال تايلغيت براول"), "خلال Tailgate Brawl");
});

test("a one-word name missing one long vowel takes the glossary spelling", () => {
  assert.equal(fixNearGlossaryNames("لإضافة هيان وسكاي بلو، ووهيان", ["هايان"]), "لإضافة هايان وسكاي بلو، ووهيان");
  assert.equal(fixNearGlossaryNames("على هيان لتفوز", ["هايان"]), "على هايان لتفوز");
  // a word not one vowel away stays
  assert.equal(fixNearGlossaryNames("هنا الآن", ["هايان"]), "هنا الآن");
});

test("a doubled «عرض» left by the copy editor is collapsed, «استعرض عرض» stays", () => {
  assert.equal(applyCorrections("أثناء استضافة الرحلة لعرض عرض AEW Collision"), "أثناء استضافة الرحلة لعرض AEW Collision");
  assert.equal(applyCorrections("قدم عرض عرض AEW Dynamite"), "قدم عرض AEW Dynamite");
  assert.equal(applyCorrections("بينما استعرض عرض TNA iMPACT"), "بينما استعرض عرض TNA iMPACT");
});
