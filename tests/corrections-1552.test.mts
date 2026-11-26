import { test } from "node:test";
import assert from "node:assert/strict";
import { applyCorrections, checkArticle } from "../scripts/news-qa.ts";

// INCIDENTS #1552: «فترة حملة رودز للقب», «تميزها بين X وبين Y» and «عبارتين ساخرتين» reached the site.
test("«فترة حمل» and «تمييز بين … وبين» are corrected", () => {
  assert.equal(applyCorrections("وانتهت فترة حملة رودز الثالثة للقب"), "وانتهت فترة حمل رودز الثالثة للقب");
  assert.equal(applyCorrections("خلال فترة حملته الثانية"), "خلال فترة حمله الثانية");
  assert.equal(applyCorrections("مع تميزها الواضح بين استمرار عداوتها وبين رفضها للإساءات"), "مع تمييزها الواضح بين استمرار عداوتها وبين رفضها للإساءات");
  assert.equal(applyCorrections("التميز بين زملائه في الفريق"), "التميز بين زملائه في الفريق");
  assert.equal(applyCorrections("الحملة الانتخابية"), "الحملة الانتخابية");
});

test("«عبارتين» / «منشورين» / «تغريدتين» are blocked as dual nouns", () => {
  for (const w of ["عبارتين", "منشورين", "تغريدتين"]) {
    const issues = checkArticle("خبر", `نشرت ${w} ساخرة عبر منصة إكس`);
    assert.ok(issues.some((i) => i.code === "dual_noun"), w);
  }
});
