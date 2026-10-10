import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";

// INCIDENTS #401: a missing `const targetFilePath` made every watcher crash at the last step of processPost.
// tsc finds names that are used but never defined (TS2304/TS2552) without running anything.
test("watcher scripts use no undefined names", () => {
  const files = ["fightful-watcher", "ringsidenews-watcher", "wrestlinginc-watcher", "news-qa", "editorial", "english-edition"].map(f => `scripts/${f}.ts`);
  const r = spawnSync("npx", ["tsc", "--noEmit", "--skipLibCheck", "--target", "es2022", "--module", "esnext", "--moduleResolution", "bundler", "--allowImportingTsExtensions", "--esModuleInterop", ...files], { encoding: "utf-8" });
  const bad = (r.stdout || "").split("\n").filter(l => /TS2304|TS2552/.test(l));
  assert.deepEqual(bad, []);
});
