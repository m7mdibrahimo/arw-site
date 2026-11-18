import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { applyCorrections } from "../scripts/news-qa.ts";

// INCIDENTS #1411: Wrestling Open RI names written wrong (Vinny Scalice, All Go Nelli, Anthony Greene).
test("Wrestling Open RI names are corrected", () => {
  assert.equal(applyCorrections("برايس دونوفان ويني ساليس"), "برايس دونوفان وفيني سكاليس");
  assert.equal(applyCorrections("فاز أوكس آدامز على ألل غو نلي"), "فاز أوكس آدامز على أول غو نيلي");
  assert.equal(applyCorrections("المكون من إنتوني غرين"), "المكون من أنتوني غرين");
});
test("glossary has the Wrestling Open RI names", () => {
  const g = JSON.parse(readFileSync("scripts/wrestler-names.json", "utf8"));
  assert.equal(g["Vinny Scalice"], "فيني سكاليس");
  assert.equal(g["All Go Nelli"], "أول غو نيلي");
  assert.equal(g["Anthony Greene"], "أنتوني غرين");
});
