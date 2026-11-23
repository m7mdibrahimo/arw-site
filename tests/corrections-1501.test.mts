import { test } from "node:test";
import assert from "node:assert/strict";
import { applyCorrections } from "../scripts/news-qa.ts";

// INCIDENTS #1501: the heavy proverb «لكن الرياح جاءت بما لا تشتهي السفن» and the broken «لتلعب الشكوك رأسها»
// reached the site in the Zoey Serrano story.
test("the ships-and-winds proverb becomes plain Arabic; «تلعب الشكوك رأسها» gets its «ب»", () => {
  assert.equal(applyCorrections("بعد تعافيها، لكن الرياح جاءت بما لا تشتهي السفن بعد أسابيع"), "بعد تعافيها، لكن الأمور سارت على عكس المتوقع بعد أسابيع");
  assert.equal(applyCorrections("وجاءت الرياح بما لا تشتهي السفن."), "والأمور سارت على عكس المتوقع.");
  assert.equal(applyCorrections("ويدفعها لتلعب الشكوك رأسها"), "ويدفعها لتلعب الشكوك برأسها");
  assert.equal(applyCorrections("تلعب الشكوك برأسه"), "تلعب الشكوك برأسه");
});
