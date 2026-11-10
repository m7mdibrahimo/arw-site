import { test } from "node:test";
import assert from "node:assert/strict";

// INCIDENTS #1211: the Lance Storm story invented «وكاتسويوري شيباتا» for Christopher Daniels; the «و» in front of the
// name hid it from the name_not_in_source check, and «».يذكر» / «تزاوجا» / «لأبق» / «أنت وأنا سواسية» went live.
test("a glossary name behind a one-letter prefix still counts as not in the source", async () => {
  const { wrestlerNotInSource } = await import("../scripts/news-qa.ts");
  const gl = { "Katsuyori Shibata": "كاتسويوري شيباتا", "Christopher Daniels": "كريستوفر دانييلز" };
  const source = "It was supposed to be the Impact players against AJ Styles and Christopher Daniels, and Justin didn't make his flight. ".repeat(3);
  assert.deepEqual(wrestlerNotInSource("كان من المفترض أن يواجه إيه جيه ستايلز وكاتسويوري شيباتا، لكن جاستن لم يلحق برحلته.", source, gl), ["Katsuyori Shibata"]);
  assert.deepEqual(wrestlerNotInSource("كان من المفترض أن يواجه إيه جيه ستايلز وكريستوفر دانييلز.", source, gl), []);
  // a longer Arabic word that merely ends with the name's letters is not the name
  assert.deepEqual(wrestlerNotInSource("قال إنه يحب ستايلز وأكاتسويوري شيباتا.", source, gl), []);
});

test("autoFix spaces a sentence glued to a closing quote, corrections fix the Maclin/Barnett/Fletcher words", async () => {
  const { autoFix, applyCorrections } = await import("../scripts/news-qa.ts");
  assert.equal(autoFix("«ما كنت لأبقى حيا لولا وجودك».يذكر أن زفافهم أقيم"), "«ما كنت لأبقى حيا لولا وجودك». يذكر أن زفافهم أقيم");
  assert.equal(applyCorrections("يذكر أن ماكلين وبورازو تزاوجا في نوفمبر"), "يذكر أن ماكلين وبورازو تزوجوا في نوفمبر");
  assert.equal(applyCorrections("ما كنت لأبق حيا لولا وجودك"), "ما كنت لأبقى حيا لولا وجودك");
  assert.equal(applyCorrections("دعمها المستمر في أوقات الشوائب"), "دعمها المستمر في الأوقات الصعبة");
  assert.equal(applyCorrections("ليعلق قائلا: «أنت وأنا سواسية»"), "ليعلق قائلا: «وأنا أيضا»");
  assert.equal(applyCorrections("العمل في السينما يتطلب تقديرا هائلا ووقتا طويلا"), "العمل في السينما يتطلب تفانيا كبيرا ووقتا طويلا");
  // «الشوائب» alone is a real word (gymnastics story) and stays
  assert.equal(applyCorrections("جعل الشوائب البسيطة أمرا صعبا"), "جعل الشوائب البسيطة أمرا صعبا");
});
