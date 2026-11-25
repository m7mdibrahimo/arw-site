import { test } from "node:test";
import assert from "node:assert/strict";
import { applyCorrections } from "../scripts/news-qa.ts";

// INCIDENTS #1541: wording from the 25 November stories (Robert Stone, Kevin Knight, CM Punk).
test("25 November evening wording is corrected", () => {
  assert.equal(applyCorrections("واختتم حديثه بمزابة خفيفة"), "واختتم حديثه بمزحة خفيفة");
  assert.equal(applyCorrections("داخل صالة أليستير أرينا قرب شيكاغو"), "داخل صالة أولستيت أرينا قرب شيكاغو");
  assert.equal(applyCorrections("وعن ما يميز عروض AEW"), "وعما يميز عروض AEW");
  assert.equal(applyCorrections("أو يورن موكسلي كما أحب"), "أو موكسلي الممل كما أحب");
  assert.equal(applyCorrections("أخطط لإسقاطه في النوم"), "أخطط لإسقاطه بالضربة القاضية");
  assert.equal(applyCorrections("وعن مسيرته"), "وعن مسيرته");
  assert.equal(applyCorrections("وعن ماذا تحدث"), "وعن ماذا تحدث");
});
