import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

// INCIDENTS #489: Eleventy ran out of memory, its child process was killed, the wrapper turned «no exit code» into 0
// and Cloudflare deployed a half-written site as a success. A killed build must now exit with a failure.
const OLD = `#!/usr/bin/env node
if (process.env.INCREASED_STACK !== "1") {
  const cp = require("child_process");
  const res = cp.spawnSync(process.execPath, ["--stack-size=4096", ...process.argv.slice(1)], {
    stdio: "inherit",
    env: { ...process.env, INCREASED_STACK: "1" }
  });
  process.exit(res.status ?? 0);
}

process.kill(process.pid, "SIGKILL"); // stands in for the real build being killed
`;

test("the patched Eleventy wrapper fails when the build is killed (an old patch is replaced)", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "patch-11ty-"));
  const file = path.join(dir, "cmd.cjs");
  fs.writeFileSync(file, OLD);
  const p = spawnSync(process.execPath, ["scripts/patch-eleventy.js", file], { encoding: "utf8" });
  assert.equal(p.status, 0);
  const patched = fs.readFileSync(file, "utf8");
  assert.ok(!patched.includes("res.status ?? 0"));
  assert.equal((patched.match(/INCREASED_STACK !== "1"/g) || []).length, 1);
  const run = spawnSync(process.execPath, [file], { encoding: "utf8" });
  assert.equal(run.status, 1, "a killed build must not look like a success");
  assert.match(run.stderr, /killed/);
  // running the patch again changes nothing
  spawnSync(process.execPath, ["scripts/patch-eleventy.js", file]);
  assert.equal(fs.readFileSync(file, "utf8"), patched);
});
