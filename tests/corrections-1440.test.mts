import { test } from "node:test";
import assert from "node:assert/strict";
import { applyCorrections } from "../scripts/news-qa.ts";

// INCIDENTS #1440: Brad Gilmore was cut to «براد غيل», and «إحدى أحداث» (أحداث is masculine).
test("«براد غيل» becomes «براد غيلمور» and «إحدى أحداث» becomes «أحد أحداث»", () => {
  assert.equal(applyCorrections("في حوار مع براد غيل، قالت"), "في حوار مع براد غيلمور، قالت");
  assert.equal(applyCorrections("في حوار مع براد غيلمور"), "في حوار مع براد غيلمور");
  assert.equal(applyCorrections("الإشارة إلى إحدى أحداث المصارعة"), "الإشارة إلى أحد أحداث المصارعة");
});
