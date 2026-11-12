// INCIDENTS #1250: «ذا نيو ليفل (مارك ديفيس وجيك دويل)» — team members copied from another line of the source.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "fs";
import { wrongTeamMembers, checkArticle, BLOCKING_QA_CODES, RETRYABLE_QA_CODES } from "../scripts/news-qa.ts";

test("members from another team are caught", () => {
  assert.ok(wrongTeamMembers("أمام سويرف ستريكلاند وفريق ذا نيو ليفل (مارك ديفيس وجيك دويل) في نزال Texas Death"));
  assert.ok(wrongTeamMembers("دافع فريق سويرف ستريكلاند وفريق ذا نيو ليفل (كوفي وأوستن غان) عن البطولة"));
  assert.ok(wrongTeamMembers("هانغمان آدم بيدج وبروديدو (بروديدو) في منافسات الفرق الثلاثية"));
});

test("the right members, a shortened list, a title before a name and non-member brackets pass", () => {
  assert.equal(wrongTeamMembers("فريق ذا نيو ليفل (أوستن كريد وكوفي)"), null);
  assert.equal(wrongTeamMembers("ذا نيو ليفل (المكون من كوفي وأوستن كريد)"), null);
  assert.equal(wrongTeamMembers("ذا يانغ باكس (مات ونيك جاكسون)"), null);
  assert.equal(wrongTeamMembers("فريق بروديدو (برودي كينج وبطل ROH العالمي بانديدو)"), null);
  assert.equal(wrongTeamMembers("ذا يانغ باكس (نزال ثلاثي بالسلالم والكراسي والطاولات على لقب أزواج الرجال)"), null);
  assert.equal(wrongTeamMembers("إف تي آر (داكس هاروود وكاش ويلر) ضد موتور سيتي ماشين جانز (أليكس شيلي وكريس سابين)"), null);
});

test("it blocks publishing and is retried", () => {
  const issues = checkArticle("ترشيحات عرض AEW Full Gear 2026", "يدخل الثلاثي كمرشحين أمام فريق ذا نيو ليفل (مارك ديفيس وجيك دويل) في النزال.");
  assert.ok(issues.some((i) => i.code === "wrong_team_members"));
  assert.ok(BLOCKING_QA_CODES.includes("wrong_team_members"));
  assert.ok(RETRYABLE_QA_CODES.includes("wrong_team_members"));
});

test("no published story carries a wrong member list", () => {
  for (const f of fs.readdirSync("content/news")) {
    assert.equal(wrongTeamMembers(fs.readFileSync(`content/news/${f}`, "utf-8")), null, f);
  }
});
