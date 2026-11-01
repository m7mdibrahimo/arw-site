import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
test("a numeric bot file name is not an early-build story (no extra redirect page per story)", () => {
  const src = require("node:fs").readFileSync("lib/redirects.cjs", "utf8");
  assert.match(src, /\^\\d\{8,\}/);
  const out = require("../lib/redirects.cjs").contentFolderAddresses("content", "_site");
  assert.equal(out.filter((x: string[]) => /\/content\/news\/1786\d/.test(x[0])).length, 0);
});
import { applyCorrections } from "../scripts/news-qa.ts";
test("Chioda spelling and the archaic informer word are corrected", () => {
  assert.equal(applyCorrections("قال مايك تشيودا"), "قال مايك تشيدا");
  assert.equal(applyCorrections("رفض لعب دور الوشي لصالح الإدارة"), "رفض لعب دور المخبر لصالح الإدارة");
});
import { metaDescription } from "../lib/meta-description.cjs";
test("meta description keeps a slightly long first sentence whole and ignores a ? inside a quoted title", () => {
  const a = metaDescription("AEW World Champion Will Ospreay recently discussed how watching WCW cruiserweights on television and practicing on a backyard trampoline shaped his high-flying wrestling style. Speaking with WKMG News 6 ahead of his successful title defense at AEW WrestleDream 2026, Ospreay explained that his mother");
  assert.match(a, /wrestling style\.$/);
  const b = metaDescription('Michael P.S. Hayes recently appeared on "What\'s Your Story? With Steph McMahon" to discuss the real story behind the Fabulous Freebirds\' departure from WWE in 1984. Hayes explained that the group');
  assert.ok(!b.includes("departure,"));
  assert.match(b, /in 1984\.$/);
});
