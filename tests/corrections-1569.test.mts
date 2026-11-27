import { test } from "node:test";
import assert from "node:assert/strict";
import { applyCorrections } from "../scripts/news-qa.ts";

// INCIDENTS #1569: «يضم فريق المكسيك إلى جانب ري ميستيريو كل من…» — «كل» مفعول به فالصح «كلا من».
test("«يضم … إلى جانب X كل من» becomes «كلا من»", () => {
  assert.equal(
    applyCorrections("يضم فريق المكسيك إلى جانب ري ميستيريو كل من بينتا وري فينيكس"),
    "يضم فريق المكسيك إلى جانب ري ميستيريو كلا من بينتا وري فينيكس",
  );
  // «كل من» فاعل لفعل تاني — ما يتغيرش
  assert.equal(applyCorrections("بينما يمثل فريق المكسيك كل من ري ميستيريو"), "بينما يمثل فريق المكسيك كل من ري ميستيريو");
});
