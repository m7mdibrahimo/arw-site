import { test } from "node:test";
import assert from "node:assert/strict";
import { tweetDateAsShowDate } from "../scripts/news-qa.ts";

const src = `The 2026 All Elite Wrestling Full Gear pay-per-view featured the debut of The Kasper Brothers.
They have arrived at #AEWFullGear! Now, it's official: the Kasper Brothers are ALL ELITE!
— Tony Khan (@TonyKhan) November 15, 2026
The Kaspers finished up with WWE in early November.`;
const at = new Date("2026-11-15T02:50:00Z"); // 21:50 on 14 November in New York

test("Full Gear dated by Tony Khan's UTC sign-off is caught, Arabic and English (INCIDENTS #1317)", () => {
  assert.ok(tweetDateAsShowDate("وشهد عرض AEW Full Gear الذي أقيم يوم 15 نوفمبر الظهور الأول", src, at));
  assert.ok(tweetDateAsShowDate("made their surprise debut at the AEW Full Gear pay-per-view on November 15.", src, at));
});

test("the right day, a date the source itself says, or a later hour in the day is left alone", () => {
  assert.equal(tweetDateAsShowDate("وشهد عرض AEW Full Gear الذي أقيم يوم 14 نوفمبر", src, at), null);
  assert.equal(tweetDateAsShowDate("وشهد عرض AEW Full Gear الذي أقيم يوم 15 نوفمبر", src + "\nFull Gear on November 15 drew well.", at), null);
  assert.equal(tweetDateAsShowDate("وشهد عرض AEW Full Gear الذي أقيم يوم 15 نوفمبر", src, new Date("2026-11-15T15:00:00Z")), null);
});
