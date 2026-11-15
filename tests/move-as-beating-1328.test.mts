import { test } from "node:test";
import assert from "node:assert/strict";
import { checkArticle, BLOCKING_QA_CODES, applyCorrections } from "../scripts/news-qa.ts";

const codes = (body: string) => checkArticle("أوستن غان يعلن مقاطعة حاويات القمامة", body + " كلام".repeat(80), []).map((i: any) => i.code);

// INCIDENTS #1328: «putting him through a giant swing» came out «قبل تنفيذ حركة ضرب مبرحة».
test("a move written as a vague beating blocks publishing", () => {
  assert.ok(BLOCKING_QA_CODES.includes("move_as_beating"));
  assert.ok(codes("وضع الصندوق فوق رأسه قبل تنفيذ حركة ضرب مبرحة.").includes("move_as_beating"));
  assert.ok(!codes("وضع الصندوق فوق رأسه قبل أن ينفذ عليه حركة الدوران العملاق.").includes("move_as_beating"));
  assert.ok(!codes("نفذ عليه حركة ضربة الرأس الشهيرة.").includes("move_as_beating"));
});

// INCIDENTS #1328: «لجذب جماهير جدد» (Nia Jax) — «جماهير» takes a feminine singular adjective.
test("«جماهير جدد» is corrected to «جماهير جديدة»", () => {
  assert.match(applyCorrections("الطريقة الأفضل لجذب جماهير جدد بفضل الأجواء"), /جماهير جديدة بفضل/);
});

// INCIDENTS #1327: «بمشاركة ست موهوبين» (TNA World X-Cup) — a masculine plural takes «ستة».
test("a masculine counted plural takes the masculine number word", () => {
  assert.match(applyCorrections("بمشاركة ست موهوبين من دول مختلفة"), /ستة موهوبين/);
  assert.match(applyCorrections("بمشاركة خمس متسابقين"), /خمسة متسابقين/);
});
