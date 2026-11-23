import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { applyCorrections } from "../scripts/news-qa.ts";

// INCIDENTS #1499: the RAW preview of 23 November said «مدينة وويتشيتا» (an extra و) for Wichita.
test("Wichita is «ويتشيتا»: the extra و is removed, a real «and Wichita» stays", () => {
  const glossary = JSON.parse(fs.readFileSync("scripts/wrestler-names.json", "utf-8")) as Record<string, string>;
  assert.equal(glossary["Wichita"], "ويتشيتا");
  assert.equal(applyCorrections("يقام العرض في مدينة وويتشيتا بولاية كانساس"), "يقام العرض في مدينة ويتشيتا بولاية كانساس");
  assert.equal(applyCorrections("يقام في دنفر وويتشيتا"), "يقام في دنفر وويتشيتا");
  const bad = fs.readdirSync("content/news").filter(f => f.endsWith(".md") && /(?:مدينة|في|من) وويتشيتا/.test(fs.readFileSync(`content/news/${f}`, "utf-8")));
  assert.deepEqual(bad, []);
});
