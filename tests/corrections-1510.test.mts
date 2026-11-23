import { test } from "node:test";
import assert from "node:assert/strict";
import { applyCorrections } from "../scripts/news-qa.ts";

// INCIDENTS #1510: «ضمن الخطط التي يخطط اتحاد WWE لتنفيذها» — the plans/plan repetition.
test("«ضمن الخطط التي يخطط X لتنفيذها» becomes «ضمن ما يخطط X لتنفيذه»", () => {
  assert.equal(
    applyCorrections("لا يزال السيناريو ضمن الخطط التي يخطط اتحاد WWE لتنفيذها، لكن"),
    "لا يزال السيناريو ضمن ما يخطط اتحاد WWE لتنفيذه، لكن",
  );
  assert.equal(applyCorrections("كشف عن الخطط التي وضعها الاتحاد"), "كشف عن الخطط التي وضعها الاتحاد");
});
