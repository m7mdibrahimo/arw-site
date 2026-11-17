import { test } from "node:test";
import assert from "node:assert/strict";
import { applyCorrections } from "../scripts/news-qa.ts";

// INCIDENTS #1384: «راضية تماما مسارها الحالي» — missing «عن».
test("satisfied-with needs «عن»", () => {
  assert.equal(applyCorrections("شددت على أنها راضية تماما مسارها الحالي"), "شددت على أنها راضية تماما عن مسارها الحالي");
  assert.equal(applyCorrections("هو راض جدا أدائه"), "هو راض جدا عن أدائه");
  assert.equal(applyCorrections("أنها راضية تماما عن مسارها"), "أنها راضية تماما عن مسارها");
});
