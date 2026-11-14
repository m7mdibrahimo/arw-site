import test from "node:test";
import assert from "node:assert/strict";
import { failingSiteLag } from "../worker/src/health.ts";

// INCIDENTS #1301: every arw-site-static build died out of memory while the bots moved «site» every few minutes;
// /health measured from the newest «site» commit and never spoke. The gap between the newest «site» main commit and
// the live build counts when that build failed.
test("a failed newest site build with the live site 41 minutes behind is a deploy problem", () => {
  const live = 1794657851; // 12:04:11, the live build.json
  const msg = "chore(publish): prune [site-retry]\n\nsite-of: 2a5493aa2383c9c2d73562791e9143c3c9a83024 1794660327\npanel-save: yes";
  assert.equal(failingSiteLag(msg, live, "failure"), (1794660327 - live) * 1000);
  assert.equal(failingSiteLag(msg, live, "success"), 0);
  assert.equal(failingSiteLag(msg, live, ""), 0); // still building
  assert.equal(failingSiteLag(msg, 1794660000, "failure"), 0); // a short gap: one failed build, the retry follows
  assert.equal(failingSiteLag("no site-of line", live, "failure"), 0);
});
