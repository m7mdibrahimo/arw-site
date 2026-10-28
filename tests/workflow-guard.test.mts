// A round's push goes through the GitHub Actions token of the repo, and that token has NO `workflows`
// permission: a commit that touches `.github/workflows/` is refused with «refusing to allow a GitHub App to
// create or update workflow … without `workflows` permission» (round 2026-10-28 04:30 UTC — the whole round
// was lost and Guard Heartbeat went red). A workflow can only be changed by the owner, so a round that edits
// one is stopped here, before anything else is pushed.
import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";

const git = (args: string[]) => {
  try {
    return execFileSync("git", args, { encoding: "utf-8" });
  } catch {
    return "";
  }
};

test("the working tree and the last commit touch no workflow file", () => {
  const dirty = git(["status", "--porcelain", "--", ".github/workflows"]).trim();
  assert.equal(dirty, "", `a workflow file was edited in this round — it can never be pushed:\n${dirty}\n` +
    "رجّع تعديل .github/workflows زي ما كان (git checkout -- .github/workflows) وصلّح السبب في scripts/ أو lib/ أو tests/ — الـtoken مالوش workflows permission، فأي تعديل في الـworkflow بيترفض بالكامل.");
  const last = git(["show", "--name-only", "--format=", "HEAD"]).split("\n").filter((x) => x.startsWith(".github/workflows/"));
  assert.deepEqual(last, [], "the last commit changes a workflow file (the push will be refused)");
});
