import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { applyCorrections } from "../scripts/news-qa.ts";

// The Good Brothers' PAC story spelled Canyon Ceman «كانيون سيتمان» and turned "WWE did not hire him"
// into «ضياع فرصة حصوله على دور أكبر» / "derailed a bigger push" (INCIDENTS #1356).
test("Canyon Ceman has one Arabic spelling in the glossary and the corrections (INCIDENTS #1356)", () => {
  const glossary = JSON.parse(fs.readFileSync("scripts/wrestler-names.json", "utf-8")) as Record<string, string>;
  assert.equal(glossary["Canyon Ceman"], "كانيون سيمان");
  assert.equal(applyCorrections("المسؤول السابق كانيون سيتمان"), "المسؤول السابق كانيون سيمان");
});

test("Arabic and English rules: a concrete outcome in a quote is never softened (INCIDENTS #1356)", () => {
  const guide = fs.readFileSync("editorial/style-guide.md", "utf-8");
  assert.match(guide, /ضياع فرصة دور أكبر[^\n]*INCIDENTS #1356/);
  const en = fs.readFileSync("scripts/english-edition.ts", "utf-8");
  assert.match(en, /never soften it into a vaguer one[^\n]*INCIDENTS #1356/);
});

test("the PAC story says WWE did not hire him, same URL (INCIDENTS #1356)", () => {
  const ar = fs.readdirSync("content/news").find((f) => f.startsWith("20261116075900-"));
  const en = fs.readdirSync("content/news-en").find((f) => f.startsWith("20261116075900-"));
  assert.ok(ar && en);
  const a = fs.readFileSync(`content/news/${ar}`, "utf-8");
  const e = fs.readFileSync(`content/news-en/${en}`, "utf-8");
  assert.match(a, /permalink: "\/news\/ثنائي-wwe-السابق-ذا-جود-براذرز-يعلق-على-رحيل-باك-نجم-aew\/index.html"/);
  assert.doesNotMatch(a, /سيتمان|دور أكبر/);
  assert.doesNotMatch(e, /derailed a bigger push/);
});
