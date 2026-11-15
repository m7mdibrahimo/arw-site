import { test } from "node:test";
import assert from "node:assert/strict";
import { fixNamesWithoutWaw, autoFix, applyCorrections, checkArticle, BLOCKING_QA_CODES } from "../scripts/news-qa.ts";

// INCIDENTS #1334: «بين أوستن آريز لابرون كوزون» and «وتحددى تريفور لي» went live in the MLW Fusion results story.
test("two glossary names side by side after «بين/ضد/(» or on a winner line get their «و»", () => {
  assert.equal(fixNamesWithoutWaw("أقيم نزال نصف نهائي كأس الأوبرا بين أوستن آريز لابرون كوزون."), "أقيم نزال نصف نهائي كأس الأوبرا بين أوستن آريز ولابرون كوزون.");
  assert.equal(fixNamesWithoutWaw("🏆 **الفائز:** كايل فليتشر كيفن نايت"), "🏆 **الفائز:** كايل فليتشر وكيفن نايت");
  assert.equal(fixNamesWithoutWaw("ذا برين (أليك برايس جوردان أوليفر) وهوك"), "ذا برين (أليك برايس وجوردان أوليفر) وهوك");
  assert.equal(fixNamesWithoutWaw("في مواجهة ضد كايل فليتشر كيفن نايت"), "في مواجهة ضد كايل فليتشر وكيفن نايت");
  assert.equal(autoFix("بين أوستن آريز لابرون كوزون."), "بين أوستن آريز ولابرون كوزون.");
});

test("a verb and its object, and names already joined, are left alone", () => {
  for (const s of ["واجه كودي رودز بارون كوربين في نزال قوي", "هزم بروك ليسنر ذا أندرتيكر", "بين أوستن آريز ولابرون كوزون", "زميله في فريق ذا شيلد رومان رينز"]) assert.equal(fixNamesWithoutWaw(s), s);
});

test("the check blocks publishing", () => {
  assert.ok(BLOCKING_QA_CODES.includes("names_without_waw"));
  const issues = checkArticle("نتائج عرض MLW Fusion", "أقيم نزال نصف نهائي بين أوستن آريز لابرون كوزون." + " كلام".repeat(80), []);
  assert.ok(issues.some((i: any) => i.code === "names_without_waw"));
});

test("«وتحددى» and «جوست جاي» are corrected", () => {
  assert.equal(applyCorrections("وتحددى تريفور لي المصارع بريك سافاج"), "وتحدى تريفور لي المصارع بريك سافاج");
  assert.equal(applyCorrections("جومبو وجوست جاي"), "جومبو وجاست جاي");
});
