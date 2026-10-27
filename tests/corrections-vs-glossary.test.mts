import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

// INCIDENTS #453: corrections.json turned «شيلوه هيل» into «شيلو هيل» while the names glossary says «شايلو هيل»,
// so the two rules pulled stories in opposite directions. A correction must never rewrite a name into a spelling
// the glossary does not have, nor rewrite a glossary spelling into something else.
test("corrections never contradict the names glossary", () => {
  const glossary = JSON.parse(fs.readFileSync("scripts/wrestler-names.json", "utf-8")) as Record<string, string>;
  const corrections = JSON.parse(fs.readFileSync("editorial/corrections.json", "utf-8")).corrections as { wrong: string; right: string }[];
  const spellings = new Set(Object.values(glossary).map(v => v.replace(/\s*\(.*\)\s*$/, "").trim()));
  const bad: string[] = [];
  for (const c of corrections) {
    if (spellings.has(c.wrong.trim()) && c.right !== c.wrong) bad.push(`«${c.wrong}» is a glossary spelling but is rewritten to «${c.right}»`);
  }
  assert.deepEqual(bad, []);
  assert.equal(glossary["KAIRI"], "كايري");
});

// INCIDENTS #489: «كانيلس» reached two stories while the glossary spelling is «كانيليس».
test("Kanellis is spelled as the glossary says, in the glossary, the corrections and every story", () => {
  const glossary = JSON.parse(fs.readFileSync("scripts/wrestler-names.json", "utf-8")) as Record<string, string>;
  assert.equal(glossary["Maria Kanellis"], "ماريا كانيليس");
  assert.equal(glossary["Mike Kanellis"], "مايك كانيليس");
  const corrections = JSON.parse(fs.readFileSync("editorial/corrections.json", "utf-8")).corrections as { wrong: string; right: string }[];
  assert.ok(corrections.some(c => c.wrong === "كانيلس" && c.right === "كانيليس"));
  const bad = fs.readdirSync("content/news").filter(f => f.endsWith(".md") && fs.readFileSync(`content/news/${f}`, "utf-8").replace(/^permalink:.*$/m, "").includes("كانيلس"));
  assert.deepEqual(bad, []);
});

// The glossary said «آش باي إيليجانس» while corrections.json and 39 published stories said «آش باي إليغانس»,
// so Gemini got two spellings for one wrestler and a story used the glossary's (2026-10-27).
test("Ash By Elegance has one spelling in the glossary, the corrections and every story", () => {
  const glossary = JSON.parse(fs.readFileSync("scripts/wrestler-names.json", "utf-8")) as Record<string, string>;
  assert.equal(glossary["Ash By Elegance"], "آش باي إليغانس");
  const corrections = JSON.parse(fs.readFileSync("editorial/corrections.json", "utf-8")).corrections as { wrong: string; right: string }[];
  assert.ok(corrections.some(c => c.wrong === "آش باي إيليجانس" && c.right === "آش باي إليغانس"));
  const bad = fs.readdirSync("content/news").filter(f => f.endsWith(".md") && fs.readFileSync(`content/news/${f}`, "utf-8").includes("إيليجانس"));
  assert.deepEqual(bad, []);
});
