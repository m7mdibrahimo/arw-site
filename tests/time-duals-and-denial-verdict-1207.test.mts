import { test } from "node:test";
import assert from "node:assert/strict";
import { fixTimeDuals, applyCorrections, checkArticle } from "../scripts/news-qa.ts";
import { parseDuplicateAnswer } from "../scripts/editorial.ts";

// INCIDENTS #1207 — Alexa Bliss «ill for the past two months» was refused 13 times for «الشهرين الماضيين».
test("two months / two weeks become their exact non-dual form before the dual check", () => {
  assert.equal(fixTimeDuals("طوال الشهرين الماضيين،"), "طوال الأسابيع الثمانية الماضية،");
  assert.equal(fixTimeDuals("طوال شهرين متتاليين"), "طوال ثمانية أسابيع متواصلة");
  assert.equal(fixTimeDuals("للشهرين الأخيرين"), "للأسابيع الثمانية الأخيرة");
  assert.equal(fixTimeDuals("بأسبوعين"), "بأربعة عشر يوما");
  assert.equal(fixTimeDuals("أسبوعان فقط"), "أربعة عشر يوما فقط");
  assert.equal(fixTimeDuals("الأسبوعين القادمين"), "الأيام الأربعة عشر القادمة");
  assert.equal(fixTimeDuals("شهرين ونصف"), "شهرين ونصف");
  const once = fixTimeDuals("خلال الشهرين الماضيين وبعد أسبوعين");
  assert.equal(fixTimeDuals(once), once);
  const body = applyCorrections("أكدت أليكسا بليس معاناتها مع المرض طوال الشهرين الماضيين، مؤكدة أن السفر كان صعبا.");
  assert.deepEqual(checkArticle("أليكسا بليس تكشف معاناتها من المرض", body, []).filter(i => i.code === "dual_noun"), []);
});

// INCIDENTS #1207 — Road Dogg's denial was dropped again: «يعتبر رداً ونفياً مباشراً للشائعات…».
test("a duplicate verdict whose reason calls the story a reply/denial is not a duplicate", () => {
  const cands = [{ file: "a.md", title: "t", body: "b", tags: [] }] as any;
  const ans = (reason: string) => JSON.stringify({ duplicate_of: 0, reason });
  assert.equal(parseDuplicateAnswer(ans("الخبر الجديد يعتبر رداً ونفياً مباشراً للشائعات المذكورة في الخبر السابق حول سبب رحيل رود دوغ"), cands), null);
  assert.equal(parseDuplicateAnswer(ans("الخبر الجديد يعتبر متابعة وتفنيداً لنفس الادعاء الذي أورده الخبر المنشور سابقاً"), cands), null);
  // a denial that repeats what is already published is still a duplicate
  assert.ok(parseDuplicateAnswer(ans("الخبر الجديد يكرر نفي شائعات تولي شون مايكلز وهو نفس محتوى الخبر رقم 1"), cands));
  assert.ok(parseDuplicateAnswer(ans("الخبر الجديد يؤكد نفس المعلومة المنشورة سابقاً ونفي شائعات رحيلها، ولا يقدم أي تطور جديد"), cands));
  assert.ok(parseDuplicateAnswer(ans("الخبر الجديد يغطي نفس الحدث (رد فعل الكواليس) المنشور"), cands));
});
