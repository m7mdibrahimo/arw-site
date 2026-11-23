import { test } from "node:test";
import assert from "node:assert/strict";
import { applyCorrections } from "../scripts/news-qa.ts";

// INCIDENTS #1496: «double leg» اتترجمت «التثبيت المزدوج للساقين» — دي حركة إسقاط مش تثبيت.
test("double leg is a takedown, not a pin", () => {
  assert.equal(applyCorrections("محاولة إسقاطه أرضا عبر التثبيت المزدوج للساقين، لكن"), "محاولة إسقاطه أرضا بحركة الإسقاط المزدوج، لكن");
  assert.equal(applyCorrections("حاول تثبيت مزدوج على الساقين"), "حاول بحركة الإسقاط المزدوج");
  assert.equal(applyCorrections("بحركة الإسقاط المزدوج"), "بحركة الإسقاط المزدوج");
});
