import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { channelHasPost, publicChannelName, UNCERTAIN } from "../worker/src/telegram-check.ts";

// INCIDENTS #1330: two Telegram sends came back «uncertain» but were on the channel.
const enc = (s: string) => encodeURI(s);
const page = `<div class="tgme_widget_message_text"><a href="https://arab-wrestling.com${enc("/news/نيا-جاكس-أحيانا-تحتاج-إلى-عشرة-أعوام-كاملة-لفهم-شخصيتك-ومعرفة-من-تكون/")}" target="_blank">اقرأ</a>
<a href="https://t.me/arab_wrestling">x</a></div>`;

test("an uncertain send whose link is on the channel page is found (encoded href, slash-insensitive)", () => {
  assert.equal(channelHasPost(page, "/news/نيا-جاكس-أحيانا-تحتاج-إلى-عشرة-أعوام-كاملة-لفهم-شخصيتك-ومعرفة-من-تكون/"), true);
  assert.equal(channelHasPost(page, "https://arab-wrestling.com/news/نيا-جاكس-أحيانا-تحتاج-إلى-عشرة-أعوام-كاملة-لفهم-شخصيتك-ومعرفة-من-تكون"), true);
});

test("a story not on the page, or a prefix of one, is not found", () => {
  assert.equal(channelHasPost(page, "/news/نيا-جاكس/"), false);
  assert.equal(channelHasPost(page, "/news/other-story/"), false);
  assert.equal(channelHasPost("", "/news/x/"), false);
});

test("channel name and the uncertain marker", () => {
  assert.equal(publicChannelName("@arab_wrestling"), "arab_wrestling");
  assert.equal(publicChannelName("-1001234567890"), "arab_wrestling");
  assert.equal(UNCERTAIN, 8640000000000000);
});

test("the watcher looks an uncertain Telegram send up on the channel and never resends it", () => {
  const src = readFileSync(new URL("../worker/src/index.ts", import.meta.url), "utf8");
  const at = src.indexOf("=== UNCERTAIN_SEND");
  assert.ok(at > 0);
  const block = src.slice(at, at + 900);
  assert.match(block, /channelHasPost\(channelHtml, item\.url\)/);
  assert.match(block, /markSendSuccess\(env, "telegram"/);
  assert.doesNotMatch(block, /publishToPlatform/);
});

// INCIDENTS #1331: «العرض التطورى» and «النجوم الغائبات» in the Charlotte Flair NXT story.
import { applyCorrections } from "../scripts/news-qa.ts";
test("«التطورى» becomes «التطويري» and «النجوم الغائبات» «النجمات الغائبات»", () => {
  assert.equal(applyCorrections("ظهور نجمات العرض التطورى."), "ظهور نجمات العرض التطويري.");
  assert.equal(applyCorrections("مصارعات NXT والنجوم الغائبات اللاتي"), "مصارعات NXT والنجمات الغائبات اللاتي");
  assert.equal(applyCorrections("منح النجوم الانتصارات"), "منح النجوم الانتصارات");
  assert.equal(applyCorrections("نجوم الحلبات"), "نجوم الحلبات");
});
