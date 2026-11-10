import { test } from "node:test";
import assert from "node:assert/strict";
import { dropUnfinishedLastMatch } from "../scripts/fightful-watcher.ts";

// INCIDENTS #1201: Ringside's WWE RAW 9/11 live page, caught while the main event was still going.
const finished = "WWE RAW took place on Monday. Singles Match: Bayley vs. Michin. Bayley then hits a flying elbow drop for the win. The winner of the match, Bayley! ";
const midMatch = "The Judgment Day then make their way down to the ring for the main event of the night. IYO SKY then introduces Becky Lynch as her partner. Tag Team Match: IYO SKY and Becky Lynch vs. The Judgment Day (Raquel Rodriguez and Roxanne Perez) The match starts off with Roxanne Perez and Becky Lynch. Lynch then hits a series of forearms to Rodriguez. Liv Morgan then grabs her leg, allowing Rodriguez to hit a big boot and a Tejana Bomb, but SKY breaks the fall.";
const recent = new Date(Date.now() - 5 * 60_000).toISOString().replace("Z", "");

test("a live page stopped in the middle of the last match loses that match", () => {
  const out = dropUnfinishedLastMatch(finished + midMatch, recent);
  assert.ok(!/Tejana Bomb/.test(out));
  assert.ok(!/Tag Team Match/.test(out));
  assert.ok(/The winner of the match, Bayley!/.test(out));
});

test("a finished last match, an old page and a page with no result yet stay as they are", () => {
  const done = finished + midMatch + " SKY then hits an Over the Moonsault for the win. The winners of the Tag Team Match, IYO SKY and Becky Lynch!";
  assert.equal(dropUnfinishedLastMatch(done, recent), done);
  const old = new Date(Date.now() - 3 * 3600_000).toISOString().replace("Z", "");
  assert.equal(dropUnfinishedLastMatch(finished + midMatch, old), finished + midMatch);
  assert.equal(dropUnfinishedLastMatch(midMatch, recent), midMatch);
  // A card announced for next week (no play-by-play) is not an unfinished match.
  const card = finished + " Announced for next week: Singles Match: IYO SKY vs. Raquel Rodriguez.";
  assert.equal(dropUnfinishedLastMatch(card, recent), card);
});

test("IYO SKY is written the way WWE writes it in every English story", async () => {
  const { ENGLISH_FIXES } = await import("../scripts/english-edition.ts");
  const fix = (t: string) => ENGLISH_FIXES.reduce((s, [re, to]) => s.replace(re, to as any), t);
  assert.equal(fix("Iyo Sky to Challenge Raquel Rodriguez; IYO Sky and Iyo SKY"), "IYO SKY to Challenge Raquel Rodriguez; IYO SKY and IYO SKY");
});
