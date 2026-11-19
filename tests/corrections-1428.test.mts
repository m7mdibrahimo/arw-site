import { test } from "node:test";
import assert from "node:assert/strict";
import { applyCorrections } from "../scripts/news-qa.ts";

// INCIDENTS #1428: «برنامج WrestleVotes Radio على Fightful Select» lost the name and read
// «على تقارير صحفية أن»; «بروك ليساند» and «جرمان سوبلكس» were misspelled.
test("#1428: a scrubbed «on Fightful Select» after a show name is removed", () => {
  assert.equal(
    applyCorrections("وأوضح برنامج WrestleVotes Radio على تقارير صحفية أن هناك رفضا"),
    "وأوضح برنامج WrestleVotes Radio أن هناك رفضا",
  );
  // «كشفت تقارير صحفية» alone stays
  assert.equal(applyCorrections("وكشفت تقارير صحفية أن هناك رفضا"), "وكشفت تقارير صحفية أن هناك رفضا");
});

test("#1428: Lesnar and German Suplex spellings", () => {
  assert.equal(applyCorrections("خسارة بروك ليساند أمام جماهيره"), "خسارة بروك ليسنر أمام جماهيره");
  assert.equal(applyCorrections("وحركة جرمان سوبلكس الخاصة"), "وحركة جيرمان سوبلكس الخاصة");
});
