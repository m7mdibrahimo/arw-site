import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

// INCIDENTS #1173: GCW Rock Bottom was renamed «… 25.09.2026» → «… (2026)» in the panel, its page moved to a new address,
// but the sitemap kept «lastmod 2026-09-27», so Google never re-crawled it and kept the old dated URL as canonical.
test("a panel edit that changes the title stamps url_changed", async () => {
  const { stampUrlChange } = await import("../worker/src/studio");
  const before = "---\ntitle: GCW Rock Bottom 25.09.2026\ndate: 2026-09-27T08:22:00.000+03:00\n---\n\nbody\n";
  const renamed = "---\ntitle: GCW Rock Bottom (2026)\ndate: 2026-09-27T08:22:00.000+03:00\n---\n\nbody\n";
  const out = stampUrlChange(before, renamed, "2026-11-09T04:33:25.000Z");
  assert.match(out, /^url_changed: 2026-11-09T04:33:25\.000Z$/m);
  assert.ok(out.endsWith("---\n\nbody\n"));
  // a second rename replaces the stamp instead of adding another line
  const again = stampUrlChange(out, out.replace("(2026)", "Night 1 (2026)"), "2026-11-10T00:00:00.000Z");
  assert.equal(again.match(/^url_changed:/gm)!.length, 1);
  assert.match(again, /^url_changed: 2026-11-10T00:00:00\.000Z$/m);
  // other edits leave the file alone (quotes around the same title don't count as a change)
  const edited = before.replace("body", "new body");
  assert.equal(stampUrlChange(before, edited, "x"), edited);
  assert.equal(stampUrlChange(before, before.replace("title: GCW Rock Bottom 25.09.2026", 'title: "GCW Rock Bottom 25.09.2026"'), "x"), before.replace("title: GCW Rock Bottom 25.09.2026", 'title: "GCW Rock Bottom 25.09.2026"'));
  assert.match(fs.readFileSync("worker/src/studio.ts", "utf8"), /body\.content = stampUrlChange\(existing\.content, body\.content,/);
});

test("the sitemap and dateModified use url_changed when it is later than the date", () => {
  assert.match(fs.readFileSync("pages/sitemap.njk", "utf8"), /item\.date \| lastChange\(item\.data\.url_changed\) \| isoDay/);
  assert.match(fs.readFileSync("_includes/post-layout.njk", "utf8"), /"dateModified": \{\{ page\.date \| lastChange\(url_changed\)/);
  assert.match(fs.readFileSync("content/shows/20260927052200-gcw-rock-bottom-2026.md", "utf8"), /^url_changed: 2026-11-09/m);
});
