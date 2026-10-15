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

test("Street Fight movie → Street Fighter in Arabic and English (INCIDENTS #589)", async () => {
  const { applyCorrections } = await import("../scripts/news-qa");
  assert.equal(applyCorrections("بطولة فيلم Street Fight الجديد"), "بطولة فيلم Street Fighter الجديد");
  const { fixEnglishNames } = await import("../scripts/english-edition.ts");
  assert.equal(fixEnglishNames("the new Street Fight movie"), "the new Street Fighter movie");
  assert.equal(fixEnglishNames("Street Fighter movie"), "Street Fighter movie");
});

test("the faction is «The 946» in English after a preposition (INCIDENTS #598)", async () => {
  const { fixEnglishNames } = await import("../scripts/english-edition.ts");
  assert.equal(fixEnglishNames("rivalry between 946 and The Bloodline"), "rivalry between The 946 and The Bloodline");
  assert.equal(fixEnglishNames("Carmelo Hayes join 946"), "Carmelo Hayes join The 946");
  assert.equal(fixEnglishNames("with The 946 now"), "with The 946 now");
  const bad = fs.readdirSync("content/news-en").filter(f => /\b(joining|join|joined|joins|between|with|of|and|by|from|against) 946\b/i.test(fs.readFileSync(`content/news-en/${f}`, "utf-8")));
  assert.deepEqual(bad, []);
});

// INCIDENTS #599: «اربعة» (hamza dropped) and «الجمعة الخامس عشر من أكتوبر» (a Friday that is a Thursday) reached the Street Fighter story.
test("number words get their hamza and spelled-out dates are weekday-checked", async () => {
  const { applyCorrections, weekdayNotOnDate } = await import("../scripts/news-qa");
  assert.equal(applyCorrections("بلغ اربعة وثلاثين بالمئة"), "بلغ أربعة وثلاثين بالمئة");
  assert.equal(weekdayNotOnDate("يوم الجمعة الخامس عشر من أكتوبر", 2026), "الجمعة الخامس عشر من أكتوبر");
  assert.equal(weekdayNotOnDate("يوم الجمعة السادس عشر من أكتوبر", 2026), null);
  const bad = fs.readdirSync("content/news").filter(f => f.endsWith(".md") && /(?<![ء-ي])ا(?:ربعة|ربعين)(?![ء-ي])/.test(fs.readFileSync(`content/news/${f}`, "utf-8").replace(/^permalink:.*$/m, "")));
  assert.deepEqual(bad, []);
});
