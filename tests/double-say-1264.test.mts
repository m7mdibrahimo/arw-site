import { test } from "node:test";
import assert from "node:assert/strict";
import { applyCorrections } from "../scripts/news-qa.ts";

test("#1264 «قالت … قائلة» says it once: «تحدثت … قائلة»", () => {
  assert.equal(applyCorrections("وعن نزالها، قالت شافير عن صعوبة التوقيت قائلة: «أفكر»"), "وعن نزالها، تحدثت شافير عن صعوبة التوقيت قائلة: «أفكر»");
  assert.equal(applyCorrections("وأضافت أنيتا فون قائلة: «كنت»"), "وتحدثت أنيتا فون قائلة: «كنت»");
  assert.equal(applyCorrections("وأضاف شيماس مازحا حول مستقبله قائلا: «لا»"), "وتحدث شيماس مازحا حول مستقبله قائلا: «لا»");
});

test("#1264 «قال إنه … قائلا» and a comma between them stay as they are", () => {
  assert.equal(applyCorrections("قال إنه سعيد قائلا"), "قال إنه سعيد قائلا");
  assert.equal(applyCorrections("قال المدرب ذلك، ثم رد قائلا"), "قال المدرب ذلك، ثم رد قائلا");
  assert.equal(applyCorrections("ثم رد قائلا: «نعم»"), "ثم رد قائلا: «نعم»");
});

test("#1264 «فتره» is written «فترة»", () => {
  assert.equal(applyCorrections("استرجع ذكريات فتره عمله في WWE"), "استرجع ذكريات فترة عمله في WWE");
});
