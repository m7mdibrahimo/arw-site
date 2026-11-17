import { test } from "node:test";
import assert from "node:assert/strict";
import { applyCorrections } from "../scripts/news-qa.ts";

// INCIDENTS #1388: Sheamus' caption "The real life Hunger Games" came out as «نزالات الجوع في الحياة الواقعية»
test("a film title translated as «نزالات الجوع» goes back to The Hunger Games", () => {
  assert.equal(applyCorrections("نزالات الجوع في الحياة الواقعية"), "The Hunger Games في الحياة الواقعية");
});
