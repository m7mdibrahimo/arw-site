import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

// INCIDENTS #1381: corrections.json rewrote «إكزافيير وودز» into «إكزافييه وودز» while the names glossary (what Gemini
// is told) says «إكسافير وودز» — so stories carried both, 12 to 8, and a new story used a third look. Same for Austin
// Aries, Gangrel, Hirooki Goto, Iyo Sky and Brooks Jensen. A name correction must land on the glossary spelling.
const glossary = JSON.parse(fs.readFileSync("scripts/wrestler-names.json", "utf-8")) as Record<string, string>;
const corrections = JSON.parse(fs.readFileSync("editorial/corrections.json", "utf-8")).corrections as { wrong: string; right: string; regex?: boolean }[];
const loose = (s: string) => s.replace(/[ً-ْ]/g, "").replace(/[اأإآويىءئؤةه]/g, "").replace(/[زس]/g, "س").replace(/[غجك]/g, "ج").replace(/\s+/g, " ").trim();

test("a name correction never lands on a spelling the glossary writes differently", () => {
  const spellings = new Set(Object.values(glossary).map(v => v.replace(/\s*\(.*\)\s*$/, "").trim()));
  const byLoose = new Map<string, string[]>();
  for (const [en, ar] of Object.entries(glossary)) {
    const v = ar.replace(/\s*\(.*\)\s*$/, "").trim();
    if (v.includes(" ") && loose(v).length >= 5) byLoose.set(loose(v), [...(byLoose.get(loose(v)) || []), `${en}=${v}`]);
  }
  const bad = corrections.filter(c => !c.regex && /[ء-ي]/.test(c.right) && !spellings.has(c.right.trim()) && !spellings.has(c.right.trim().replace(/^[وبلفك]/, "")))
    .flatMap(c => { const g = byLoose.get(loose(c.right)); return g ? [`«${c.wrong}» → «${c.right}» but the glossary has ${g.join(", ")}`] : []; });
  assert.deepEqual(bad, []);
});

test("Xavier Woods, Austin Aries, Gangrel, Hirooki Goto and Bryan Idol have one spelling everywhere", () => {
  assert.equal(glossary["Xavier Woods"], "إكسافير وودز");
  assert.equal(glossary["Austin Aries"], "أوستن آريز");
  assert.equal(glossary["Gangrel"], "غانغريل");
  assert.equal(glossary["Hirooki Goto"], "هيرووكي غوتو");
  assert.equal(glossary["Bryan Idol"], "برايان آيدول");
  const wrong = ["إكزافييه وودز", "أوستن أريس", "جانجريل", "هيروكي جوتو", "برايان إيدول"];
  for (const w of wrong) assert.ok(corrections.some(c => c.wrong === w), `missing correction for ${w}`);
  const bad: string[] = [];
  for (const f of fs.readdirSync("content/news").filter(f => f.endsWith(".md"))) {
    const t = fs.readFileSync(`content/news/${f}`, "utf-8").replace(/^(permalink|source_url):.*$/gm, "");
    for (const w of wrong) if (t.includes(w)) bad.push(`${f}: ${w}`);
  }
  assert.deepEqual(bad, []);
});
