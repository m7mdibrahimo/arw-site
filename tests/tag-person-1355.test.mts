import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);

// Tag pages had no structured data; «كروز مونتانا» ranked 7.7 on a news story, not the person's tag page (INCIDENTS #1355).
test("a tag that is a person's whole name gives their English name; other tags give nothing", () => {
  const { tagPerson } = require("../lib/wrestler-mentions.cjs");
  assert.deepEqual(tagPerson("كروز مونتانا"), { name: "كروز مونتانا", en: "Cruz Montana" });
  assert.deepEqual(tagPerson("شينا باسلر"), { name: "شينا باسلر", en: "Shayna Baszler" });
  assert.equal(tagPerson("WWE"), null);
  assert.equal(tagPerson("مونتانا"), null);
  assert.equal(tagPerson(""), null);
});

test("the tag page's head carries CollectionPage + Person structured data, only where it is indexable", () => {
  const t = fs.readFileSync("pages/tag.njk", "utf-8");
  assert.match(t, /tagPerson\(tagObj\.name\)/);
  assert.match(t, /\{% if tagObj\.count >= 3 and tagPage\.pageNumber <= 1 %\}\s*\{% set tagUrl/);
  assert.match(t, /"@type": "CollectionPage"/);
  assert.match(t, /"@type": "BreadcrumbList"/);
  assert.match(fs.readFileSync("eleventy.config.js", "utf-8"), /addNunjucksGlobal\("tagPerson"/);
});
