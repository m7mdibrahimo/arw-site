import { test } from "node:test";
import assert from "node:assert/strict";
import { tonyKhanTweetMisattributed, applyCorrections, checkArticle } from "../scripts/news-qa.ts";

const TK = "https://x.com/TonyKhan/status/2120319572033024395";

test("#1225 Tony Khan's only tweet credited to the team is caught (Arabic)", () => {
  assert.ok(tonyKhanTweetMisattributed("أعلن فريق إف تي آر عن المواجهة عبر وسائل التواصل الاجتماعي.", TK));
  assert.equal(tonyKhanTweetMisattributed("أعلن توني خان عن المواجهة عبر وسائل التواصل الاجتماعي.", TK), "");
});

test("#1225 English", () => {
  assert.ok(tonyKhanTweetMisattributed("FTR announced the matchup on social media.", TK, "en"));
  assert.equal(tonyKhanTweetMisattributed("Tony Khan announced the matchup on social media.", TK, "en"), "");
});

test("#1225 a tweet from anyone else leaves the story alone", () => {
  assert.equal(tonyKhanTweetMisattributed("أعلن فريق إف تي آر عن المواجهة عبر وسائل التواصل.", "https://x.com/DaxFTR/status/1"), "");
  assert.equal(tonyKhanTweetMisattributed("أعلن فريق إف تي آر عن المواجهة عبر وسائل التواصل.", `${TK}\nhttps://x.com/DaxFTR/status/1`), "");
});

test("#1225 «النجمين» is corrected, «نجمين» blocks publishing", () => {
  assert.equal(applyCorrections("بين النجمين الكبيرين"), "بين النجوم الكبار");
  assert.equal(applyCorrections("التقى النجمين"), "التقى النجوم");
  assert.ok(checkArticle("جون سينا يكشف عن انضمام نجمين آخرين من WWE NXT", "نص الخبر هنا طويل بما يكفي لفحصه.", []).some(i => i.code === "dual_noun"));
});
