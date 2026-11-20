import { test } from "node:test";
import assert from "node:assert/strict";
import { applyCorrections, seriesTitleTranslated } from "../scripts/news-qa.ts";

// INCIDENTS #1441: «سال عما» (no hamza), «والخطى على خطى», «جعلهم يكتفي», Mystii Marks and Giant Baba misspelled.
test("«سال عما» and the other #1441 slips are corrected", () => {
  assert.equal(applyCorrections("حيث سال عما إذا كان"), "حيث سأل عما إذا كان");
  assert.equal(applyCorrections("دخول المصارعة والخطى على خطى والديه"), "دخول المصارعة والسير على خطى والديه");
  assert.equal(applyCorrections("المزدحم جعلهم يكتفي باحتفال"), "المزدحم جعلهم يكتفون باحتفال");
  assert.equal(applyCorrections("فازت على ميستيي ماركس"), "فازت على ميستي ماركس");
  assert.equal(applyCorrections("حيث كان غيانت بابا يدفع"), "حيث كان جاينت بابا يدفع");
});

// INCIDENTS #1441: «documentary series titled The Toni Storm Tapes» came out «بعنوان توني ستورم التقديمية».
test("a series title translated to Arabic is caught; kept in English it passes", () => {
  const src = "AEW has announced a five-part documentary series titled The Toni Storm Tapes, set to premiere on Friday.";
  assert.deepEqual(seriesTitleTranslated("سلسلة من خمسة أجزاء تحمل عنوان توني ستورم التقديمية", src), ["The Toni Storm Tapes"]);
  assert.deepEqual(seriesTitleTranslated("سلسلة من خمسة أجزاء تحمل عنوان The Toni Storm Tapes", src), []);
  assert.deepEqual(seriesTitleTranslated("أي نص", "He watched a movie last night with friends."), []);
});
