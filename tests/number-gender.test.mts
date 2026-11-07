import { test } from "node:test";
import assert from "node:assert/strict";
import { fixNumberGender, applyCorrections } from "../scripts/news-qa.ts";

test("feminine nouns take the short number form", () => {
  assert.equal(fixNumberGender("ابتعدت لمدة ستة سنوات"), "ابتعدت لمدة ست سنوات");
  assert.equal(fixNumberGender("أعلن عن أربعة مواجهات"), "أعلن عن أربع مواجهات");
  assert.equal(fixNumberGender("وثمانية بطولات"), "وثماني بطولات");
});
test("masculine nouns take the -ة form", () => {
  assert.equal(fixNumberGender("أربع نزالات و ست أيام"), "أربعة نزالات و ستة أيام");
});
test("correct text and counted victories are untouched", () => {
  const ok = "ثلاثة انتصارات وست سنوات وثلاثة أيام وخمس مرات";
  assert.equal(fixNumberGender(ok), ok);
  assert.equal(applyCorrections(ok), ok);
});
