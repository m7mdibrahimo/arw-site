import { test } from "node:test";
import assert from "node:assert/strict";
import { applyCorrections } from "../scripts/news-qa.ts";

// INCIDENTS #1533: «برنامج كيفن أوينز Show» — a half-translated show name.
test("the KO Show is named, not half-translated", () => {
  assert.equal(applyCorrections("بدأت كظهور ضمن برنامج كيفن أوينز Show قبل أن تتحول"), "بدأت كظهور ضمن برنامج The KO Show الخاص بكيفن أوينز قبل أن تتحول");
  assert.equal(applyCorrections("فاز على كيفن أوينز في النزال"), "فاز على كيفن أوينز في النزال");
});
