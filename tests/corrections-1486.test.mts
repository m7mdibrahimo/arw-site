import { test } from "node:test";
import assert from "node:assert/strict";
import { applyCorrections } from "../scripts/news-qa.ts";

// INCIDENTS #1486: «ويوصفه» و«لم أتحصل».
test("round 2026-11-22 «يوصفه» and «أتحصل» are corrected", () => {
  assert.equal(applyCorrections("ام جيه اف يهدد بفصل برودي كينج ويوصفه بالمصارع غير الآمن"), "ام جيه اف يهدد بفصل برودي كينج ويصفه بالمصارع غير الآمن");
  assert.equal(applyCorrections("ولم أتحصل حتى على فرصة"), "ولم أحصل حتى على فرصة");
  assert.equal(applyCorrections("شعورا لا يوصف"), "شعورا لا يوصف");
});
