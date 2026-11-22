import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

// The TNA Destination X review called the women's Ultimate X (a #1 contender match) a match
// «على لقب بطولة TNA العالمية للسيدات» / "for the Knockouts World Championship" (INCIDENTS #1354).
test("Arabic and English rules: a number one contender match is never a match for the title (INCIDENTS #1354)", () => {
  const guide = fs.readFileSync("editorial/style-guide.md", "utf-8");
  assert.match(guide, /number one contender match[^\n]*نزال لتحديد المنافس الأول على لقب[^\n]*INCIDENTS #1354/);
  const en = fs.readFileSync("scripts/english-edition.ts", "utf-8");
  assert.match(en, /A number one contender match[^\n]*never "a match for the X Championship"[^\n]*INCIDENTS #1354/);
});

test("the Destination X review no longer says the Ultimate X was for the title (INCIDENTS #1354)", () => {
  // Stories older than 30 days are deleted (INCIDENTS #1481) and content/news-en is gone (#1480): a check on one story runs only while it exists.
  if (!fs.existsSync("content/news-en")) return;
  const ar = fs.readdirSync("content/news").find((f) => f.startsWith("20261116071652-"));
  const en = fs.readdirSync("content/news-en").find((f) => f.startsWith("20261116071652-"));
  if (!ar || !en) return;
  const a = fs.readFileSync(`content/news/${ar}`, "utf-8");
  const e = fs.readFileSync(`content/news-en/${en}`, "utf-8");
  assert.doesNotMatch(a, /ومميزا على لقب/);
  assert.match(a, /حدد المنافسة الأولى على بطولة TNA العالمية للسيدات/);
  assert.doesNotMatch(e, /Ultimate X match for the Knockouts/);
});
