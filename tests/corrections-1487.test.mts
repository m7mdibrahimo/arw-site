import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { applyCorrections } from "../scripts/news-qa.ts";

// INCIDENTS #1487: أسماء NJPW وأليستر بلاك و«العد المزدوج» و«امتلاك السيطرة».
test("round 2026-11-22 names and phrases are corrected", () => {
  assert.equal(applyCorrections("أقر المصارع اليستر بلاك بأن"), "أقر المصارع أليستر بلاك بأن");
  assert.equal(applyCorrections("(تشيس أوينز وباد فاك ودوكي)"), "(تشيس أوينز ودون فالي ودوكي)");
  assert.equal(applyCorrections("ماساتورا ياسودا ويوشينوبو هاتازاوا"), "ماساتورا ياسودا ويوشين هاتازاوا");
  assert.equal(applyCorrections("تعادل بسبب العد خارج الحلبة المزدوج"), "تعادل بسبب العد المزدوج خارج الحلبة");
  assert.equal(applyCorrections("أعتقد أن امتلاك السحر وتجربة أشياء جديدة"), "أعتقد أن امتلاك السيطرة وتجربة أشياء جديدة");
});

test("glossary has the names Gemini got wrong", () => {
  const g = JSON.parse(readFileSync(new URL("../scripts/wrestler-names.json", import.meta.url), "utf8"));
  assert.equal(g["Aleister Black"], "أليستر بلاك");
  assert.equal(g["Don Fale"], "دون فالي");
  assert.equal(g["Yushin Hatazawa"], "يوشين هاتازاوا");
});

test("results prompt forbids gluing the last winner to the first loser", () => {
  const src = readFileSync(new URL("../scripts/fightful-watcher.ts", import.meta.url), "utf8");
  assert.match(src, /ممنوع تلزق اسم آخر فائز بأول خاسر/);
});
