import test from "node:test";
import assert from "node:assert/strict";
import { titleVagueTopic } from "../scripts/news-qa.ts";

test("a title that hides the news behind «تشكك في حسم المرشح» is blocked (INCIDENTS #1449)", () => {
  assert.ok(titleVagueTopic("تقارير تشكك في حسم المرشح الأول لاستضافة عرض WWE Royal Rumble 2028"));
  assert.equal(titleVagueTopic("تقارير: أورلاندو لم تعد المرشح الأول لاستضافة عرض WWE Royal Rumble 2028"), null);
});
