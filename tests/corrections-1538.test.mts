import { test } from "node:test";
import assert from "node:assert/strict";
import { applyCorrections } from "../scripts/news-qa.ts";

// INCIDENTS #1538: «تووقعها»، «أكبر سننا»، «بطل AEW الوطنية» went live in the Dragunov stories.
test("Dragunov story typos are corrected", () => {
  assert.equal(applyCorrections("لم يسر بالطريقة التي تووقعها."), "لم يسر بالطريقة التي توقعها.");
  assert.equal(applyCorrections("على يد رجل أكبر سننا عندما"), "على يد رجل أكبر سنا عندما");
  assert.equal(applyCorrections("وأقر بطل AEW الوطنية بأنه"), "وأقر بطل AEW الوطني بأنه");
  assert.equal(applyCorrections("فاز ببطولة AEW الوطنية"), "فاز ببطولة AEW الوطنية");
  assert.equal(applyCorrections("كما توقع الجميع"), "كما توقع الجميع");
});
