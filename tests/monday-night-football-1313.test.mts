// INCIDENTS #1313: the Continental Classic story called the NFL game «عرض Monday Night Football», wrote the
// reigning champion as «حامل لقب Continental Champion», and its headline said AEW «يكشف عن المشاركين»
// while the source said they are only TO BE announced.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

test("an NFL broadcast is «مباراة», never «عرض»", async () => {
  const { applyCorrections } = await import("../scripts/news-qa");
  assert.equal(applyCorrections("ستكشف الأسماء خلال استراحة عرض Monday Night Football يوم الاثنين"), "ستكشف الأسماء خلال استراحة مباراة Monday Night Football يوم الاثنين");
  assert.equal(applyCorrections("بعد حلقة Sunday Night Football"), "بعد مباراة Sunday Night Football");
  // a real wrestling show name stays untouched
  assert.equal(applyCorrections("في عرض AEW Dynamite"), "في عرض AEW Dynamite");
});

test("«Continental Champion» in Arabic text becomes «البطولة القارية», Championship stays", async () => {
  const { applyCorrections } = await import("../scripts/news-qa");
  assert.equal(applyCorrections("بصفته حامل لقب Continental Champion الحالي"), "بصفته حامل البطولة القارية الحالي");
  assert.equal(applyCorrections("على لقب Continental Championship"), "على لقب Continental Championship");
});

test("the prompts say a to-be-announced reveal stays future and «in past years» is not a plan", () => {
  const src = fs.readFileSync("scripts/fightful-watcher.ts", "utf-8");
  assert.match(src, /إعلان قادم يبقى قادما في العنوان/);
  assert.match(src, /«in past years» ليست وعدا/);
  const bad = fs.readdirSync("content/news").filter(f => f.endsWith(".md") && /(?:عرض|حلقة) (?:Monday|Thursday|Sunday) Night Football|لقب Continental Champion(?![A-Za-z])/.test(fs.readFileSync(`content/news/${f}`, "utf-8").replace(/^permalink:.*$/m, "")));
  assert.deepEqual(bad, []);
});
