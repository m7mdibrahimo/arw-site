// INCIDENTS #1304 — «بين البطلة كوين أميناتا والمتنافستين بيرسيفوني ومايا وورلد» (AEW Tailgate Brawl story):
// the dual_noun list had «منافستين» but not «متنافستين/مرشحتين/متحديتين». And «مقدمات ارتفاع ضغط الدم»
// (a word-for-word preeclampsia) sat in the Alexa Bliss story.
import { test } from "node:test";
import assert from "node:assert/strict";
import { applyCorrections, checkArticle } from "../scripts/news-qa.ts";

const pad = " نص الخبر الطويل بما يكفي للفحص".repeat(20);
const codes = (b: string) => checkArticle("عنوان عربي كامل للخبر هنا", b + pad, []).map(i => i.code);

test("feminine dual rivals are blocked", () => {
  for (const w of ["بين البطلة والمتنافستين بيرسيفوني ومايا", "المرشحتان للفوز", "أمام المتحديتين"]) {
    assert.ok(codes(`مواجهة ثلاثية ${w} في العرض.`).includes("dual_noun"), w);
  }
  // the masculine sound plural «المتنافسين» is the same spelling as the dual, so it stays allowed
  assert.ok(!codes("يتنافس المتنافسين على اللقب في العرض.").includes("dual_noun"));
  assert.ok(!codes("بين البطلة وكل من بيرسيفوني ومايا وورلد.").includes("dual_noun"));
});

test("preeclampsia is written «تسمم الحمل»", () => {
  assert.equal(applyCorrections("علامات الإصابة بمقدمات ارتفاع ضغط الدم"), "علامات الإصابة بتسمم الحمل");
});

import fs from "node:fs";
test("a show's BroadcastEvent says its subtitles are Arabic («مترجم»)", () => {
  const layout = fs.readFileSync("_includes/post-layout.njk", "utf8");
  assert.match(layout, /"@type": "BroadcastEvent", "name": [^\n]*?"isLiveBroadcast": false, "subtitleLanguage": "ar"/);
});
