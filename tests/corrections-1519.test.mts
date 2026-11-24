import { test } from "node:test";
import assert from "node:assert/strict";
import { applyCorrections } from "../scripts/news-qa.ts";

// INCIDENTS #1519: CMLL results wrote Lucky as «لالكي» and Valiente Jr. as «والينتي»; Brian Cage's quote said «ترتفع عدد المشاهدين».
test("CMLL names and the gender of «عدد» are fixed", () => {
  assert.equal(applyCorrections("هزم ثنائي بلاك أونيكس ولالكي"), "هزم ثنائي بلاك أونيكس ولاكي");
  assert.equal(applyCorrections("أركاليس وستيغما ووالينتي جونيور"), "أركاليس وستيغما وفالينتي جونيور");
  assert.equal(applyCorrections("وشاهدوا كيف ترتفع عدد المشاهدين"), "وشاهدوا كيف يرتفع عدد المشاهدين");
  assert.equal(applyCorrections("ترتفع أعداد المشاهدين"), "ترتفع أعداد المشاهدين");
});
