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

// The English pages of name stories had no `mentions` at all: Search Console showed
// «liv morgan boy meets world» (778 impressions) on position 8.9 with nobody listed as a Person.
test("an English headline's people are listed in English (round 2026-10-27)", () => {
  const { englishPersonMentions } = require("../lib/wrestler-mentions.cjs");
  const m = englishPersonMentions("Liv Morgan Calls Cory Matthews Toxic After Rewatching Boy Meets World");
  assert.deepEqual(m, [{ name: "Liv Morgan", ar: "ليف مورغان" }]);
  const two = englishPersonMentions("Seth Rollins Attacks CM Punk Before WWE RAW");
  assert.deepEqual(two.map((x: { name: string }) => x.name).sort(), ["CM Punk", "Seth Rollins"]);
  // tags carry the names a headline leaves out (the layout joins headline and en_tags)
  assert.deepEqual(englishPersonMentions("AEW WrestleDream Results: New Champion Crowned"), []);
  // a promotion, a show or a chance capitalised phrase is never a person
  assert.deepEqual(englishPersonMentions("WWE Announces WrestleMania 43 in Saudi Arabia"), []);
  // no Arabic name leaks into the English structured data
  assert.ok(englishPersonMentions("Liv Morgan and Cody Rhodes").every((x: { name: string }) => !/[\u0621-\u064A]/.test(x.name)));
});

test("every English story that names a glossary person gets it from its headline or tags", () => {
  const fs = require("node:fs");
  const matter = require("gray-matter");
  const { englishPersonMentions } = require("../lib/wrestler-mentions.cjs");
  const dir = "content/news-en";
  const bad: string[] = [];
  for (const f of fs.readdirSync(dir).filter((x: string) => x.endsWith(".md"))) {
    const d = matter(fs.readFileSync(`${dir}/${f}`, "utf-8")).data;
    const hay = [d.title, (d.en_tags || []).join(" ")].join(" ");
    for (const n of englishPersonMentions(hay)) {
      if (!hay.includes(n.name)) bad.push(`${f}: ${n.name}`);
    }
  }
  assert.deepEqual(bad, []);
});
