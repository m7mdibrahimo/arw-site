import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { checkArticle, applyCorrections } from "../scripts/news-qa.ts";

// INCIDENTS #1266: «خلال عرض AEW Collision في عرض AEW Collision يوم 24 أكتوبر» reached the site,
// «أو فريق ذا كونجلوميريشن غيرهم» lost its «أو», and the UFC 334 card had fighters missing from the glossary.
test("the same show name twice in a row is blocked", () => {
  const issues = checkArticle("توني خان يكشف السبب", "ظهر الاسم على الشاشة خلال عرض AEW Collision في عرض AEW Collision يوم 24 أكتوبر.");
  assert.ok(issues.some((i: any) => i.code === "repeated_phrase"), JSON.stringify(issues));
  const ok = checkArticle("توني خان يكشف السبب", "ظهر الاسم على الشاشة خلال عرض AEW Collision يوم 24 أكتوبر، ثم تغير في عرض AEW Dynamite.");
  assert.ok(!ok.some((i: any) => i.code === "repeated_phrase"), JSON.stringify(ok));
});

test("«سواء … أو X غيرهم» gets its missing «أو»", () => {
  assert.equal(
    applyCorrections("قادرة على تهديد أي فريق، سواء كان فريق ديث رايدرز أو فريق ذا كونجلوميريشن غيرهم."),
    "قادرة على تهديد أي فريق، سواء كان فريق ديث رايدرز أو فريق ذا كونجلوميريشن أو غيرهم.",
  );
  const fine = "سواء كان فريق ديث رايدرز أو فريق ذا كونجلوميريشن أو غيرهم.";
  assert.equal(applyCorrections(fine), fine);
  assert.equal(applyCorrections("سواء كان فريق ديث رايدرز أو وغيرهم."), "سواء كان فريق ديث رايدرز أو وغيرهم.");
});

test("UFC 334 fighters are in the names glossary", () => {
  const names = JSON.parse(fs.readFileSync("scripts/wrestler-names.json", "utf-8"));
  for (const n of ["Uros Medic", "Donte Johnson", "Heili Alateng", "Samuel Sanches", "Yousri Belgaroui"]) assert.ok(names[n], n);
});
