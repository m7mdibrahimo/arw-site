import { test } from "node:test";
import assert from "node:assert/strict";
import { applyCorrections } from "../scripts/news-qa.ts";

// INCIDENTS #1433: «real name» came out as the clumsy «المعروف حقيقيا باسم».
test("«المعروف حقيقيا باسم» becomes «واسمه الحقيقي»", () => {
  assert.equal(applyCorrections("كارفر، المعروف حقيقيا باسم كيفن روبرتسون، تم وضعه"), "كارفر، واسمه الحقيقي كيفن روبرتسون، تم وضعه");
});
