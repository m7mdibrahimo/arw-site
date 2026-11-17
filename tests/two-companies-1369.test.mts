import test from "node:test";
import assert from "node:assert/strict";
import { applyCorrections, checkArticle } from "../scripts/news-qa.ts";

// The WWE Orlando story wrote «مشروع مشترك بين شركتي X وY» (a dual) and the Full Gear story spelled
// The Conglomeration «كونغلوميريشن» while the glossary says «ذا كونجلوميريشن» (INCIDENTS #1369).
test("«شركتي X وY» becomes «شركة X وشركة Y» (INCIDENTS #1369)", () => {
  assert.equal(applyCorrections("مشروع مشترك بين شركتي Orlando Performance Center SPE LLC وWWE PC Holdings LLC."),
    "مشروع مشترك بين شركة Orlando Performance Center SPE LLC وشركة WWE PC Holdings LLC.");
  assert.equal(applyCorrections("عرض مشترك بين شركتي WWE وAEW"), "عرض مشترك بين شركة WWE وشركة AEW");
});

test("a «شركتي X» left over is blocked as a dual (INCIDENTS #1369)", () => {
  const issues = checkArticle("خبر عن الاندماج", "الكيان المدمج بين شركتي MVP المملوكة للنجم جيك بول ودوري PFL.");
  assert.ok(issues.some((i: any) => i.code === "dual_noun"));
});

test("The Conglomeration is spelled as in the glossary (INCIDENTS #1369)", () => {
  assert.equal(applyCorrections("ضد فريق ديث رايدرز وفريق كونغلوميريشن"), "ضد فريق ديث رايدرز وفريق كونجلوميريشن");
});
