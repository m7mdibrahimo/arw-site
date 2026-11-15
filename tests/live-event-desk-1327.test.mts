import { test } from "node:test";
import assert from "node:assert/strict";
import { liveEventInResults } from "../scripts/news-qa.ts";
import { federationFromSourceDesk } from "../scripts/fightful-watcher.ts";
import { parseRingsideNewsFeed } from "../scripts/ringsidenews-watcher.ts";

// INCIDENTS #1327: «WWE NXT Holiday Live Tour Results (11/14)» came out «نتائج عرض WWE NXT (14 نوفمبر 2026)».
test("a live tour's results keep the source's event name in the title and the opening", () => {
  const r = liveEventInResults(
    "نتائج عرض WWE NXT (14 نوفمبر 2026): فوز سي ام بانك وبايلي في الحدث الرئيسي",
    "أقيم عرض WWE NXT بتاريخ 14 نوفمبر 2026 في صالة فوكس ثياتر.\n\n**المواجهة الأولى: نزال فردي**",
    "WWE NXT Holiday Live Tour Results (11/14)",
  );
  assert.equal(r.title, "نتائج عرض WWE NXT Holiday Live Tour (14 نوفمبر 2026): فوز سي ام بانك وبايلي في الحدث الرئيسي");
  assert.match(r.body, /^أقيم عرض WWE NXT Holiday Live Tour بتاريخ/);
});

test("TV episodes and titles that already say Live are left alone", () => {
  const tv = "نتائج عرض WWE NXT (10 نوفمبر 2026): فوز أوبا فيمي في الحدث الرئيسي";
  assert.equal(liveEventInResults(tv, "أقيم عرض WWE NXT", "WWE NXT Results (11/10): Oba Femi").title, tv);
  const live = "نتائج عرض WWE NXT Live (7 نوفمبر 2026): فوز شايلو هيل في الحدث الرئيسي";
  assert.equal(liveEventInResults(live, "", "WWE NXT Live Results (11/7)").title, live);
  const impact = "نتائج عرض TNA iMPACT: فوز نيك نيميث في الحدث الرئيسي";
  assert.equal(liveEventInResults(impact, "", "TNA Thursday Night Impact Results 11/12/26 W/ Live Updates: Elijah Vs. Nic Nemeth").title, impact);
});

// INCIDENTS #1327: Ringside News filed the Ruby Hardy story under «TNA Wrestling News»; it came out «WWE».
test("Ringside News' promotion desk overrides a promotion the text never names", () => {
  const r = federationFromSourceDesk("WWE", ["WWE", "جيف هاردي", "روبي هاردي"], ["TNA Wrestling News", "TNA Wrestling Videos", "Jeff Hardy"], "Jeff Hardy's daughter Ruby trained in the ring with her father.");
  assert.equal(r.federation, "TNA");
  assert.deepEqual(r.tags, ["TNA", "جيف هاردي", "روبي هاردي"]);
  // the text names WWE: the writer's pick stays
  assert.equal(federationFromSourceDesk("WWE", ["WWE"], ["TNA Wrestling News"], "He also appeared on WWE NXT.").federation, "WWE");
  // topics only, or two desks: nothing to go by
  assert.equal(federationFromSourceDesk("WWE", ["WWE"], ["Jeff Hardy", "AEW Full Gear"], "x").federation, "WWE");
  assert.equal(federationFromSourceDesk("WWE", ["WWE"], ["AEW News", "TNA Wrestling News"], "x").federation, "WWE");
});

test("the Ringside News feed parser keeps each item's categories", () => {
  const xml = `<rss><channel><item><title>T</title><link>https://www.ringsidenews.com/a/</link><guid>g</guid><pubDate>Sun, 15 Nov 2026 13:27:36 +0000</pubDate>
<category><![CDATA[TNA Wrestling News]]></category><category><![CDATA[Jeff Hardy]]></category><content:encoded><![CDATA[<p>x</p>]]></content:encoded></item></channel></rss>`;
  assert.deepEqual(parseRingsideNewsFeed(xml)[0].categories, ["TNA Wrestling News", "Jeff Hardy"]);
});

// INCIDENTS #1327: «بعد تعرضه لإصابتين طويلتي الأمد» (Noam Dar) went live — the dual list had no «إصابتين».
test("«إصابتين» and «طويلتي الأمد» are dual forms", async () => {
  const { checkArticle } = await import("../scripts/news-qa.ts");
  const codes = (body: string) => checkArticle("نوام دار يعترف بأنه فكر في الاعتزال", body + " كلام".repeat(80), []).map((i: any) => i.code);
  assert.ok(codes("فكر في الاعتزال بعد تعرضه لإصابتين طويلتي الأمد على التوالي.").includes("dual_noun"));
  assert.ok(!codes("فكر في الاعتزال بعد تعرضه لإصابة طويلة الأمد ثم إصابة أخرى بعدها مباشرة.").includes("dual_noun"));
});
