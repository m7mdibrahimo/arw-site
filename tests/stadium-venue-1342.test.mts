import test from "node:test";
import assert from "node:assert/strict";
import { applyCorrections } from "../scripts/news-qa.ts";

// INCIDENTS #1342: خبر فال فينيس كتب «خارج صالة State Farm Stadium في غلانديل» و«الجنين كشان بشري»،
// وخبر ام جيه اف كتب «هاجم أوسبراي بحزام التتويج».
test("a Stadium is «ملعب», not «صالة»", () => {
  assert.equal(applyCorrections("خارج صالة State Farm Stadium في غلانديل"), "خارج ملعب State Farm Stadium في غلينديل");
  assert.equal(applyCorrections("في صالة Madison Square Garden"), "في صالة Madison Square Garden");
});

test("broken words and wrong phrases are fixed", () => {
  assert.equal(applyCorrections("يبدأ فيه الجنين كشان بشري"), "يبدأ فيه الجنين ككائن بشري");
  assert.equal(applyCorrections("هاجم أوسبراي بحزام التتويج"), "هاجم أوسبراي بحزام البطولة");
});
