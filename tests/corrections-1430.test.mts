import { test } from "node:test";
import assert from "node:assert/strict";
import { applyCorrections } from "../scripts/news-qa.ts";

// INCIDENTS #1430: «could have killed someone» came out as «كان قد يتسبب في قتل شخص».
test("«كان قد يتسبب» (could have) becomes «كان يمكن أن يتسبب»", () => {
  assert.equal(applyCorrections("ويعترف بأنه كان قد يتسبب في قتل شخص"), "ويعترف بأنه كان يمكن أن يتسبب في قتل شخص");
  assert.equal(applyCorrections("كان قد تسبب في إصابة زميله"), "كان قد تسبب في إصابة زميله");
});
