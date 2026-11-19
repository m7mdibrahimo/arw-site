import { test } from "node:test";
import assert from "node:assert/strict";
import { fixNearGlossaryNames, fixEnglishNames } from "../scripts/english-edition.ts";

// INCIDENTS #1422: «Indi Hallwell» (Indi Hartwell) reached the TNA iMPACT preview; «Paul Heymon», «Clark Conners» earlier
test("a glossary wrestler's misspelled last name takes the glossary spelling", () => {
  assert.equal(fixNearGlossaryNames("as Indi Hallwell, Gabby Forza and Allie"), "as Indi Hartwell, Gabby Forza and Allie");
  assert.equal(fixNearGlossaryNames("Paul Heymon said"), "Paul Heyman said");
  assert.equal(fixNearGlossaryNames("Clark Conners won"), "Clark Connors won");
  assert.equal(fixEnglishNames("Indi Hallwell won."), "Indi Hartwell won.");
});

test("possessives, plurals, team names and real look-alike names stay", () => {
  for (const s of ["Chris Jericho's match", "Trios Championship", "The Collection", "Rey Misterio Sr.", "Royal Rumbles", "Four Horsemen", "Indi Hartwell"]) {
    assert.equal(fixNearGlossaryNames(s), s);
  }
});
