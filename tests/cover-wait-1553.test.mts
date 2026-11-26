import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { isMissingCover, shouldWaitForCover, COVER_WAIT_MINUTES } from "../scripts/fightful-watcher.ts";

test("#1553 the site icon or no picture counts as a missing cover", () => {
  assert.equal(isMissingCover("/favicon.png"), true);
  assert.equal(isMissingCover('"/favicon.png"'), true);
  assert.equal(isMissingCover(""), true);
  assert.equal(isMissingCover(undefined), true);
  assert.equal(isMissingCover("/content/images/abc123.jpg"), false);
});

test("#1553 a fresh story with no picture waits; an older one does not", () => {
  const now = Date.parse("2026-11-26T14:11:00Z");
  assert.equal(shouldWaitForCover("2026-11-26T14:11:00", now), true);   // Fightful date_gmt, no Z
  assert.equal(shouldWaitForCover("2026-11-26T14:00:00.000Z", now), true);
  assert.equal(shouldWaitForCover(new Date(now - (COVER_WAIT_MINUTES + 1) * 60000).toISOString(), now), false);
  assert.equal(shouldWaitForCover(undefined, now), false);
  assert.equal(shouldWaitForCover("garbage", now), false);
});

test("#1553 the watcher waits before the fallback and repairs icon covers every run", () => {
  const src = fs.readFileSync(new URL("../scripts/fightful-watcher.ts", import.meta.url), "utf-8");
  const wait = src.indexOf("shouldWaitForCover(post.date_gmt || post.date)");
  const fallback = src.indexOf("using reliable site fallback banner");
  const rewrite = src.indexOf("const rewritten = await rewriteWithGemini(");
  assert.ok(wait > 0 && wait < fallback && fallback < rewrite, "the wait sits before the fallback and before Gemini");
  const run = src.slice(src.indexOf("export async function runWatcher("));
  assert.match(run.slice(0, 600), /await healMissingCovers\(\)/);
});
