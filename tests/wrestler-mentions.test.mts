import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { personMentions, people } = require("../lib/wrestler-mentions.cjs");

// The head of a news page said nothing about who the story is about, while Search Console showed name
// queries on positions 10-11 («ماكس كاستر» 11.1, «المصارع باك» 10.2). The story's NewsArticle now lists
// the people its headline names as `mentions`, with the Arabic and the English spelling (2026-10-27).
test("a headline's people are listed with their English spelling", () => {
  const m = personMentions("سامي زين يعتقد أن فرصة الفوز ببطولة WWE قد ضاعت بعد عرض WWE Royal Rumble 2026");
  assert.deepEqual(m, [{ name: "سامي زين", en: "Sami Zayn" }]);
  assert.deepEqual(personMentions("وفاة المصارع باك المعروف باسم بينجامين ساتيرلي عن عمر يناهز أربعين عاما"), [{ name: "باك", en: "PAC" }]);
  const two = personMentions("سيث رولينز يهاجم سي ام بانك قبل عرض WWE RAW");
  assert.deepEqual(two.map((x: { en: string }) => x.en).sort(), ["CM Punk", "Seth Rollins"]);
});

test("a show, a title or a faction is never listed as a person", () => {
  assert.deepEqual(personMentions("عرض WWE موني إن ذا بانك 2026: النزالات الجاذبة والمخيبة"), []);
  assert.deepEqual(personMentions("بيشوب كاون يكشف تفاصيل تأسيس فريق ذا ديماند").map((x: { en: string }) => x.en), ["Bishop Kaun"]);
  assert.ok(people().every((p: { en: string }) => !/^The\s/.test(p.en)));
});

test("a name is matched whole, never inside a longer word", () => {
  // «باك» must not match «باكستيج» or «باكيت»
  assert.deepEqual(personMentions("باكستيج الفريق أصبح أقوى هذا الأسبوع"), []);
});
