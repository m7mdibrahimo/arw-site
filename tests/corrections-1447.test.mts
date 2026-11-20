import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { applyCorrections } from "../scripts/news-qa.ts";

// INCIDENTS #1447: «ويتشاتا» for Wichita, and a ring announcer called «التعليق الصوتي».
test("#1447 Wichita is spelled ويتشيتا", () => {
  assert.equal(applyCorrections("في مدينة ويتشاتا بولاية كانساس"), "في مدينة ويتشيتا بولاية كانساس");
});
test("#1447 style guide says a ring announcer is «تقديم النزالات»", () => {
  assert.match(readFileSync("editorial/style-guide.md", "utf8"), /ring announcer.*تقديم النزالات/);
});
