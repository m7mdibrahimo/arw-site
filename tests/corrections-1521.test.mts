import { test } from "node:test";
import assert from "node:assert/strict";
import { applyCorrections } from "../scripts/news-qa.ts";

// INCIDENTS #1521: Chad Gable's story wrote «فترة احتفازه» instead of «احتفاظه».
test("«احتفاز» is spelled «احتفاظ»", () => {
  assert.equal(applyCorrections("فترة احتفازه الأولى ببطولة القارات"), "فترة احتفاظه الأولى ببطولة القارات");
  assert.equal(applyCorrections("بعد الاحتفاز باللقب"), "بعد الاحتفاظ باللقب");
  assert.equal(applyCorrections("وباحتفازها"), "وباحتفاظها");
});
