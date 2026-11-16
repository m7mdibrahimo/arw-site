import { test } from "node:test";
import assert from "node:assert/strict";
import { restoreEnglishTitleNames } from "../scripts/fightful-watcher.ts";
import { applyCorrections } from "../scripts/news-qa.ts";

// INCIDENTS #1363: Hendry's song «Fire Logan Paul» was written «Fire لوغان بول»; Cody's dog Pharaoh became «فاروق».
test("an English quoted title keeps its name in English", () => {
  assert.equal(restoreEnglishTitleNames("بأغنية هندري الشهيرة «Fire لوغان بول» التي"), "بأغنية هندري الشهيرة «Fire Logan Paul» التي");
  assert.equal(restoreEnglishTitleNames("قال «يا لوغان بول»"), "قال «يا لوغان بول»");
});

test("round #1363 corrections", () => {
  assert.equal(applyCorrections("لكلبه الراحل فاروق بتصميم"), "لكلبه الراحل فارو بتصميم");
  assert.equal(applyCorrections("المصارع فاروق في WWF"), "المصارع فاروق في WWF");
  assert.equal(applyCorrections("في بداية ظهور ه، مفكرا"), "في بداية ظهوره، مفكرا");
  assert.equal(applyCorrections("أعلن اتحاد EA Sports رسميا"), "أعلنت شركة EA Sports رسميا");
  assert.equal(applyCorrections("كواليس عرض The Iron Claw"), "كواليس فيلم The Iron Claw");
  assert.equal(applyCorrections("دون الحاجة لخاطرة بلا داع"), "دون الحاجة إلى المخاطرة بلا داع");
});
