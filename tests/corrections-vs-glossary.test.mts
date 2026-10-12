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
