import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

// INCIDENTS #1560: Cody Rhodes's story ended with an invented, illogical link («مما يمهد لاحتمال استخدامها مجددا»).
test("the editorial guide forbids an invented closing link sentence (INCIDENTS #1560)", async () => {
  const { editorialGuideForPrompt } = await import("../scripts/editorial");
  assert.ok(editorialGuideForPrompt().includes("INCIDENTS #1560"));
  const bad = fs.readdirSync("content/news").filter(f => f.endsWith(".md") && /مما يمهد لاحتمال استخدامها مجددا/.test(fs.readFileSync(`content/news/${f}`, "utf-8")));
  assert.deepEqual(bad, []);
});
