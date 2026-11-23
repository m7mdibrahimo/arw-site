import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { applyCorrections } from "../scripts/news-qa.ts";

// INCIDENTS #1503: the glossary taught Gemini «Co-Main Event» = «النزال المشترك» and «وتحديد منذ» reached the site.
test("co-main event is «النزال الرئيسي الثاني»; «وتحديد منذ» gets its alef", () => {
  const glossary = JSON.parse(fs.readFileSync("scripts/wrestler-names.json", "utf-8")) as Record<string, string>;
  assert.equal(glossary["Co-Main Event"], "النزال الرئيسي الثاني");
  assert.equal(applyCorrections("يواجه وايلدر في النزال المشترك للعرض"), "يواجه وايلدر في النزال الرئيسي الثاني للعرض");
  assert.equal(applyCorrections("منذ 18 شهرا، وتحديد منذ تعادله"), "منذ 18 شهرا، وتحديدا منذ تعادله");
});
