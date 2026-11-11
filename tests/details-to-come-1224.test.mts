import { test } from "node:test";
import assert from "node:assert/strict";
import { claimNotInSource, applyCorrections } from "../scripts/news-qa.ts";

const SOURCE = `The John Cena Classic is finally moving forward after John Cena himself appeared on RAW, announcing that the tournament is set to take place on December 14th. Since then, he's announced that both Cody Rhodes and the newly signed Zilla Fatu will be entrants in the tournament. Cena has also shed more light on the details surrounding the tournament during a recent interview, detailing the setup, his reasons behind hosting the tournament in the first place, and what he expects to achieve through it.`;
const LABEL = "تفاصيل هتتكشف قريب / details to come";

test("#1224 Arabic: details the source says were already given are not written as coming", () => {
  const ar = "ومن المتوقع أن يكشف سينا المزيد من التفاصيل حول نظام البطولة خلال الأيام القادمة.";
  assert.ok(claimNotInSource(ar, SOURCE).includes(LABEL));
});

test("#1224 English: no invented promise of details", () => {
  const en = "Cena has stated in recent interviews that he will provide further details on the tournament's structure soon.";
  assert.ok(claimNotInSource(en, SOURCE, "en").includes(LABEL));
});

test("#1224 a source that promises details lets the sentence through", () => {
  const promised = `${SOURCE} Cena said he will reveal the full bracket next week.`;
  assert.ok(!claimNotInSource("ومن المتوقع أن يكشف سينا المزيد من التفاصيل.", promised).includes(LABEL));
  assert.ok(!claimNotInSource("Cena will reveal more details next week.", promised, "en").includes(LABEL));
});

test("#1224 the past tense passes", () => {
  assert.ok(!claimNotInSource("وقد كشف سينا في مقابلة حديثة تفاصيل أكثر عن نظام البطولة.", SOURCE).includes(LABEL));
});

test("#1224 corrections: one fan and Bayley's old name", () => {
  assert.equal(applyCorrections("فوق صدر أحد الجماهير"), "فوق صدر أحد المشجعين");
  assert.equal(applyCorrections("باسم دابينا روز"), "باسم دافينا روز");
});
