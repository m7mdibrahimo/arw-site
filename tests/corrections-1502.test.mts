import { test } from "node:test";
import assert from "node:assert/strict";
import { applyCorrections } from "../scripts/news-qa.ts";

// INCIDENTS #1502: «عرض Saw 11» (a film called a show) and the empty closing sentence «وتابعت مشيدة به.» reached the site.
test("a known film is «فيلم» not «عرض»; the empty «وتابعت مشيدة به.» is dropped", () => {
  assert.equal(applyCorrections("قراءة نص لعرض Saw 11 قريبا"), "قراءة نص لفيلم Saw 11 قريبا");
  assert.equal(applyCorrections("بمسلسل Baywatch وعرض Saw 11"), "بمسلسل Baywatch وفيلم Saw 11");
  assert.equal(applyCorrections("في عرض Halloween Havoc"), "في عرض Halloween Havoc");
  assert.equal(applyCorrections("ثم تخرج وتتألق». وتابعت مشيدة به."), "ثم تخرج وتتألق».");
  assert.equal(applyCorrections("وتابع مشيدا به قائلا: «رائع»"), "وتابع مشيدا به قائلا: «رائع»");
});
