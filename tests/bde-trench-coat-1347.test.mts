import test from "node:test";
import assert from "node:assert/strict";
import { applyNamesGlossary } from "../scripts/fightful-watcher.ts";
import { applyCorrections } from "../scripts/news-qa.ts";

// INCIDENTS #1347: «حيث غاب ريتش سوان وBDE» (KC Navarro story) — BDE was not in the glossary, so it stayed in Latin
// in 17 stories; and «بطلاء الوجه ومعطف الخندق» (Stephen Borden story) is a word-for-word «trench coat».
test("BDE is translated from the glossary, with or without «و»", () => {
  assert.equal(applyNamesGlossary("حيث غاب ريتش سوان وBDE وانضم"), "حيث غاب ريتش سوان وبي دي إي وانضم");
  assert.equal(applyNamesGlossary("نجح BDE في خطف الانتصار"), "نجح بي دي إي في خطف الانتصار");
});

test("«معطف الخندق» becomes «المعطف الطويل»", () => {
  assert.equal(applyCorrections("لو ظهرت بطلاء الوجه ومعطف الخندق ومعي المضرب"), "لو ظهرت بطلاء الوجه والمعطف الطويل ومعي المضرب");
});
