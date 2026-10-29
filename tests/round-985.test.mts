import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { checkArticle, titleVagueTopic, BLOCKING_QA_CODES, RETRYABLE_QA_CODES } from "../scripts/news-qa.ts";
import { checkEnglish, englishStyleRules, type EnglishInput } from "../scripts/english-edition.ts";

const body = "تحدث المصارع جيفون إيفانز عن اللحظة البارزة في عرض WWE Money in the Bank، حين دفعه برون بريكر من أعلى السلم ليحطم سقف سيارة الإسعاف. ورغم قوة السقوط، تمكن إيفانز من العودة للظهور في عرض WWE RAW التالي.";

test("two names joined by «و» before a singular verb are blocked (Jevon Evans story, INCIDENTS #984)", () => {
  const bad = checkArticle("جيفون إيفانز يتحدث عن لقطة سيارة الإسعاف", body + "\n\nيذكر أن إيفانز وبينتا يستعد للمنافسة على الألقاب في عرض WWE Crown Jewel القادم.");
  assert.ok(bad.some((i) => i.code === "pair_singular_verb"));
  const ok = checkArticle("جيفون إيفانز يتحدث عن لقطة سيارة الإسعاف", body + "\n\nيذكر أن إيفانز وبينتا يستعدون للمنافسة على الألقاب في عرض WWE Crown Jewel القادم.");
  assert.ok(!ok.some((i) => i.code === "pair_singular_verb"));
  // one person whose glossary name has a second word starting with «و»
  assert.ok(!checkArticle("كيت ويلسون", body + "\n\nيذكر أن كيت ويلسون يظهر حاليا رفقة فريقه.").some((i) => i.code === "pair_singular_verb"));
  assert.ok(BLOCKING_QA_CODES.includes("pair_singular_verb") && RETRYABLE_QA_CODES.includes("pair_singular_verb"));
});

test("a headline that only names a topic («مستقبل…», «آخر المستجدات حول…») is blocked (TNA/OVW story, INCIDENTS #985)", () => {
  for (const t of ["مستقبل الشراكة وعلاقة العمل بين اتحاد TNA واتحاد OVW", "آخر المستجدات حول جوردين جريس", "تطورات جديدة بشأن مستقبل Wrestling Open Rhode Island"]) {
    assert.ok(checkArticle(t, body).some((i) => i.code === "title_vague_topic"), t);
  }
  for (const t of ["مستقبل كايري ساني مع اتحاد AEW يظل غير حاسم رغم التوقعات القوية", "اتحاد TNA يخطط لتسجيل عروض Xplosion في صالة اتحاد OVW مطلع 2027", "مستقبل البث التلفزيوني لاتحاد AAA قد يكون معلقا"]) {
    assert.ok(!checkArticle(t, body).some((i) => i.code === "title_vague_topic"), t);
  }
  assert.ok(BLOCKING_QA_CODES.includes("title_vague_topic") && RETRYABLE_QA_CODES.includes("title_vague_topic"));
});

test("no published Arabic story keeps a topic-only headline", () => {
  const bad: string[] = [];
  for (const f of fs.readdirSync("content/news")) {
    if (!f.endsWith(".md")) continue;
    const t = (fs.readFileSync(`content/news/${f}`, "utf8").match(/^title:\s*"?(.*?)"?$/m) || [])[1] || "";
    if (titleVagueTopic(t)) bad.push(t);
  }
  assert.deepEqual(bad, []);
});

const input: EnglishInput = {
  sourceTitle: "Where Things Stand With TNA & OVW's Working Relationship", sourceText: "TNA is planning to tape Xplosion at the Davis Arena in Louisville early next year to cut travel costs.",
  sourceUrl: "https://www.ringsidenews.com/where-things-stand-tna-ovws-working-relationship/", sourceId: 1,
  arabicTitle: "اتحاد TNA يخطط لتسجيل عروض Xplosion", arabicBody: "نص.", federation: "TNA", image: "/content/images/b.jpg", date: "2026-10-29T18:42:52.000Z", filePrefix: "20261029214252",
};
const good = { title: "TNA Plans to Tape Xplosion at OVW's Davis Arena in 2027", body: "TNA is set to move the taping of Xplosion to the Davis Arena in Louisville, Kentucky, early next year.\n\nThe change is meant to lower travel costs for the promotion, according to PWInsider.", tags: ["TNA", "OVW"] };

test("English topic-only headlines are a retry, and the «match with X» rule is in the prompt (INCIDENTS #984-#985)", () => {
  assert.ok(!checkEnglish(good, input).includes("vague headline"));
  assert.ok(checkEnglish({ ...good, title: "TNA and OVW Relationship and Future Partnership" }, input).includes("vague headline"));
  assert.ok(checkEnglish({ ...good, title: "Status of WWE Running Another Evolution Event" }, input).includes("vague headline"));
  assert.match(englishStyleRules(input.sourceUrl), /OWN match against X/);
  assert.match(fs.readFileSync("editorial/style-guide.md", "utf8"), /«spot» = «لقطة»/);
});
