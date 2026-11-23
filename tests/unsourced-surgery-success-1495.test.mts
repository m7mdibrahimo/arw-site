import { test } from "node:test";
import assert from "node:assert/strict";
import { fixUnsourcedSurgerySuccess } from "../scripts/news-qa.ts";

// Fightful 23 Nov 2026: «Briscoe required and got knee surgery» — nothing about it going well (INCIDENTS #1495).
const src = "Mark Briscoe has been sidelined with a knee injury. It was claimed to Fightful that Briscoe required and got knee surgery and has been healing up.";

test("a surgery the source never called successful loses «ناجحة»", () => {
  assert.equal(fixUnsourcedSurgerySuccess("خضع بريسكو لعملية جراحية ناجحة في الركبة", src), "خضع بريسكو لعملية جراحية في الركبة");
  assert.equal(fixUnsourcedSurgerySuccess("أجرى جراحة في الركبة ناجحة", src), "أجرى جراحة في الركبة");
});

test("a source that says it went well keeps «ناجحة»", () => {
  const ok = "خضع لعملية جراحية ناجحة";
  assert.equal(fixUnsourcedSurgerySuccess(ok, "He underwent successful knee surgery."), ok);
  assert.equal(fixUnsourcedSurgerySuccess(ok, "The surgery went well."), ok);
});
