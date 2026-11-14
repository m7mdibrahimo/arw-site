import { test } from "node:test";
import assert from "node:assert/strict";
import { checkArticle, applyCorrections, BLOCKING_QA_CODES } from "../scripts/news-qa.ts";

// INCIDENTS #1308: «ولا أتقاضى أجري بطريقة لعينة» (Clark Connors) and «دابينا تورنه» / «شان غالوي» (Freelance Hadouken)
test("a curse turned into a manner («بطريقة لعينة») blocks publishing", () => {
  const body = "أعتقد أن ما أفعله الآن أفضل بكثير، ولا أتقاضى أجري بطريقة لعينة. أنا سعيد للغاية هذا العام.";
  const codes = checkArticle("كلارك كونورز يقارن عامه الأول في AEW بعامه الأول في NJPW", body, []).map(i => i.code);
  assert.ok(codes.includes("curse_as_manner"));
  assert.ok(BLOCKING_QA_CODES.includes("curse_as_manner"));
  assert.ok(checkArticle("عنوان", "وتحدث بشكل لعين عن الأمر", []).some(i => i.code === "curse_as_manner"));
});

test("the meaning written plainly, and «المصارعة اللعينة» as an adjective, pass", () => {
  const ok = "أعتقد أن ما أفعله الآن أفضل بكثير، ولم يعد أجري مجرد وجبات تشانكو. وقال: كم من المصارعة اللعينة يستطيع الناس مشاهدتها؟";
  assert.ok(!checkArticle("عنوان", ok, []).some(i => i.code === "curse_as_manner"));
});

test("Davina Thorne and Sean Galway are fixed in every story", () => {
  const text = applyCorrections("تفوق بريان غورتا على ميجيكو، وشان غالوي، ودابينا تورنه، وريك بريكس");
  assert.ok(text.includes("شون غالواي"), text);
  assert.ok(text.includes("دافينا ثورن"), text);
  assert.ok(!text.includes("دابينا"), text);
});
