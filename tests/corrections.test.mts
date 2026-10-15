import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

// INCIDENTS #566: «موجو بروكس» / «سيكوند موسمه» (English «second» transliterated) reached a story.
test("Mojo Brookzz is in the glossary and the transliterated «second» is corrected", () => {
  const glossary = JSON.parse(fs.readFileSync("scripts/wrestler-names.json", "utf-8")) as Record<string, string>;
  assert.equal(glossary["Mojo Brookzz"], "موجو بروكز");
  const corrections = JSON.parse(fs.readFileSync("editorial/corrections.json", "utf-8")).corrections as { wrong: string; right: string }[];
  assert.ok(corrections.some(c => c.wrong === "موجو بروكس" && c.right === "موجو بروكز"));
  assert.ok(corrections.some(c => c.wrong === "سيكوند موسمه الأخير"));
  const bad = fs.readdirSync("content/news").filter(f => f.endsWith(".md") && /موجو بروكس|سيكوند موسم/.test(fs.readFileSync(`content/news/${f}`, "utf-8").replace(/^permalink:.*$/m, "")));
  assert.deepEqual(bad, []);
});

// INCIDENTS #581: «كايتلين» vs «كيتلين» (Kaitlyn) and a doubled «لـ لعرض» reached stories.
test("Kaitlyn spelling and the doubled «لـ» are corrected", async () => {
  const { applyCorrections } = await import("../scripts/news-qa");
  const glossary = JSON.parse(fs.readFileSync("scripts/wrestler-names.json", "utf-8")) as Record<string, string>;
  assert.equal(glossary["Kaitlyn"], "كيتلين");
  assert.equal(applyCorrections("عودة كايتلين استعدادا لـ لعرض Destination X"), "عودة كيتلين استعدادا لعرض Destination X");
  const bad = fs.readdirSync("content/news").filter(f => f.endsWith(".md") && /كايتلين|لـ لعرض/.test(fs.readFileSync(`content/news/${f}`, "utf-8").replace(/^permalink:.*$/m, "")));
  assert.deepEqual(bad.filter(f => f.startsWith("2026101")), []);
});
