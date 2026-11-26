import { test } from "node:test";
import assert from "node:assert/strict";
import { applyCorrections } from "../scripts/news-qa.ts";

// INCIDENTS #1549: «هذا اللحظة» and «تأتي هذه التصريحات لتسليط الضوء» reached the site.
test("feminine nouns after هذا and «تأتي ... لتسلط الضوء» are corrected", () => {
  assert.equal(applyCorrections("ذكريات مميزة مع هذا اللحظة."), "ذكريات مميزة مع هذه اللحظة.");
  assert.equal(applyCorrections("وهذا المرة الأولى"), "وهذه المرة الأولى");
  assert.equal(applyCorrections("هذا الموقف صعب"), "هذا الموقف صعب");
  assert.equal(applyCorrections("تأتي هذه التصريحات لتسليط الضوء على العلاقة"), "تأتي هذه التصريحات لتسلط الضوء على العلاقة");
  assert.equal(applyCorrections("أراد تقليل ظهورها لتسليط الضوء على روسيف"), "أراد تقليل ظهورها لتسليط الضوء على روسيف");
});
