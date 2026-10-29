import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { createRequire } from "node:module";
import { applyCorrections } from "../scripts/news-qa.ts";

const require = createRequire(import.meta.url);
const { metaDescription } = require("../lib/meta-description.cjs");

// INCIDENTS #983 — «أشاد الرئيسة التنفيذية» (SiriusXM story), «خطا داستنيا»/«برنامج داستاني» and «لهيمن» (Paul Heyman story).
test("a masculine verb before a woman's job title and the broken storyline words are corrected", () => {
  assert.equal(applyCorrections("أشاد الرئيسة التنفيذية لشركة SiriusXM"), "أشادت الرئيسة التنفيذية لشركة SiriusXM");
  assert.equal(applyCorrections("وقال المديرة العامة"), "وقالت المديرة العامة");
  assert.equal(applyCorrections("أشاد الرئيس التنفيذي"), "أشاد الرئيس التنفيذي");
  assert.equal(applyCorrections("لمنحه خطا داستنيا جديدا في برنامج داستاني"), "لمنحه خطا قصصيا جديدا في برنامج قصصي");
  assert.equal(applyCorrections("آخر ظهور لهيمن في عرض WWE RAW"), "آخر ظهور لهايمن في عرض WWE RAW");
  assert.equal(applyCorrections("داستن رودس"), "داستن رودس");
  const names = JSON.parse(fs.readFileSync("scripts/wrestler-names.json", "utf-8"));
  assert.equal(names["The Ultimate Warrior"], "ذا ألتيميت واريور");
  assert.match(fs.readFileSync("editorial/style-guide.md", "utf-8"), /الرئيسة التنفيذية لشركة SiriusXM تشيد/);
});

// INCIDENTS #983 — the English description stopped at «…last month due.»: dropping the half word left «due» hanging.
test("an English description never ends on «due», «than» or «rather»", () => {
  const lead = 'Sami Zayn recently discussed his decision to refrain from posting on social media following the death of Benjamin "PAC" Satterly last month due to bronchial asthma. During an interview he explained more.';
  const d = metaDescription(lead);
  assert.doesNotMatch(d, /\bdue\.$/);
  assert.match(d, /last month\.$/);
  const foley = "Mick Foley stated that AEW has become the wrestling show that keeps pulling him back because the company treats the entire roster with importance rather than focusing only on a few top stars. More text follows here.";
  assert.doesNotMatch(metaDescription(foley), /\b(?:rather|than)\.$/);
  for (const f of fs.readdirSync("content/news-en")) {
    const m = fs.readFileSync(`content/news-en/${f}`, "utf-8").match(/^description: "(.*)"$/m);
    if (m) assert.doesNotMatch(m[1], / (?:due|than|rather|his|their)\.$/, f);
  }
});
