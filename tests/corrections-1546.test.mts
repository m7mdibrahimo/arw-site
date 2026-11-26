import { test } from "node:test";
import assert from "node:assert/strict";
import { applyCorrections, autoFix } from "../scripts/news-qa.ts";

// INCIDENTS #1546: «منافشه»، «باغى»، «الإيقاف بنايت»، «أن جيل صاعدا» reached the site.
test("spelling and case mistakes of 2026-11-26 are corrected", () => {
  assert.equal(applyCorrections("مشيدا بشكل خاص بمنافشه باك"), "مشيدا بشكل خاص بمنافسه باك");
  assert.equal(applyCorrections("وبعد محاولات عديدة، باغى بيلي منافسه"), "وبعد محاولات عديدة، باغت بيلي منافسه");
  assert.equal(applyCorrections("نجح موكسلي في الإيقاف بنايت"), "نجح موكسلي في الإيقاع بنايت");
  assert.equal(applyCorrections("نجح في الإيقاف بنايت"), "نجح في الإيقاع بنايت");
  assert.equal(applyCorrections("تم الإيقاف بسبب الإصابة"), "تم الإيقاف بسبب الإصابة");
  assert.equal(applyCorrections("مؤكدة أن جيل صاعدا جديدا"), "مؤكدة أن جيلا صاعدا جديدا");
});

test("the story's last paragraph gets its full stop", () => {
  const body = "واصلت البطولة فعالياتها في العرض.\n\nتتواصل منافسات البطولة في عرض AEW Collision القادم حيث يلتقي نيك واين مع توماسو تشامبا في المجموعة الذهبية";
  assert.ok(autoFix(body).trimEnd().endsWith("الذهبية."));
  assert.ok(autoFix(body + "\n").trimEnd().endsWith("الذهبية."));
});
