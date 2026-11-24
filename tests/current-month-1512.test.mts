import { test } from "node:test";
import assert from "node:assert/strict";
import { applyCorrections, checkArticle, BLOCKING_QA_CODES } from "../scripts/news-qa.ts";

// INCIDENTS #1512: «بنهاية شهر ديسمبر الجاري» in a story published on 24 November.
const title = "مكتبة عروض AEW الكاملة ستكون متاحة على HBO Max بنهاية شهر ديسمبر";
const body = "ستصبح مكتبة عروض اتحاد AEW الكاملة متاحة للبث عبر منصة HBO Max بحلول نهاية شهر ديسمبر الجاري. ومنذ الأول من يناير 2025، وفرت المنصة عروض AEW Dynamite وAEW Collision، مع إضافة الأرشيف القديم على مراحل.";
const nov = new Date("2026-11-23T23:43:10Z");

test("«ديسمبر الجاري» in a November story blocks publishing", () => {
  assert.ok(BLOCKING_QA_CODES.includes("wrong_current_month"));
  assert.ok(checkArticle(title, body, [], { now: nov }).some((i) => i.code === "wrong_current_month"));
  assert.ok(!checkArticle(title, body.replace("ديسمبر الجاري", "ديسمبر المقبل"), [], { now: nov }).some((i) => i.code === "wrong_current_month"));
  assert.ok(!checkArticle(title, body.replace("ديسمبر الجاري", "نوفمبر الجاري"), [], { now: nov }).some((i) => i.code === "wrong_current_month"));
  // Mecca time: 23:30 UTC on 30 November is already December on the site's clock
  assert.ok(!checkArticle(title, body, [], { now: new Date("2026-11-30T22:30:00Z") }).some((i) => i.code === "wrong_current_month"));
  // without the publish time (old stories re-checked) it never fires
  assert.ok(!checkArticle(title, body).some((i) => i.code === "wrong_current_month"));
});

test("«أتوسل إليكم، من فضلك» becomes plural", () => {
  assert.equal(applyCorrections("«أتوسل إليكم، من فضلك، لا تلاحقوا الأشخاص»"), "«أتوسل إليكم، من فضلكم، لا تلاحقوا الأشخاص»");
  assert.equal(applyCorrections("قال لها: من فضلك، انتظري"), "قال لها: من فضلك، انتظري");
});
