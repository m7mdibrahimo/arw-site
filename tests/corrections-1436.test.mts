import { test } from "node:test";
import assert from "node:assert/strict";
import { applyCorrections } from "../scripts/news-qa.ts";

// INCIDENTS #1436: San Antonio was written «سان أنيو».
test("«سان أنيو» becomes «سان أنطونيو»", () => {
  assert.equal(applyCorrections("في مدينة سان أنيو بولاية تكساس"), "في مدينة سان أنطونيو بولاية تكساس");
  assert.equal(applyCorrections("في سان أنطونيو"), "في سان أنطونيو");
});
