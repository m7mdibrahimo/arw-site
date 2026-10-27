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

// INCIDENTS #883: show and recap front matter never passes through applyCorrections, so 13 RAW pages carried the tag
// «رومان راينز» while the glossary (and every story) says «رومان رينز». A tag that a correction would rewrite is a
// misspelling Google cannot connect to the wrestler's page.
test("no show, recap or nostalgia tag is a spelling corrections.json would rewrite", () => {
  const corrections = JSON.parse(fs.readFileSync("editorial/corrections.json", "utf-8")).corrections as { wrong: string; right: string; regex?: boolean }[];
  const wrongOnes = corrections.filter(c => !c.regex && c.right !== c.wrong && /[\u0621-\u064A]/.test(c.wrong));
  const bad: string[] = [];
  for (const dir of ["content/shows", "content/recaps", "content/nostalgia"]) {
    for (const f of fs.readdirSync(dir).filter(x => x.endsWith(".md"))) {
      const text = fs.readFileSync(`${dir}/${f}`, "utf-8");
      const tags = ((text.match(/^tags:\n((?:  - .*\n)+)/m) || ["", ""])[1] || "").split("\n").map(l => l.replace(/^\s*-\s*/, "").trim()).filter(Boolean);
      for (const tag of tags) for (const c of wrongOnes) if (tag === c.wrong) bad.push(`${dir}/${f}: «${c.wrong}» (الصح «${c.right}»)`);
    }
  }
  assert.deepEqual(bad, []);
  // the glossary spelling is the one the show pages carry now
  assert.equal((JSON.parse(fs.readFileSync("scripts/wrestler-names.json", "utf-8")) as Record<string, string>)["Roman Reigns"], "رومان رينز");
  assert.ok(!fs.readFileSync("content/shows/20261027125824-wwe-raw-26-10-2026.md", "utf-8").includes("رومان راينز"));
});
