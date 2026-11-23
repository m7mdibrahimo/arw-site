// INCIDENTS #1500 — CMLL Domingo Familiar 22-11: match 5's sentence sat above its heading, the heading said
// «نزال فردي» over «الفائزون: بانديدو وفرانشيسكو أكيرا», Keyra and Kira were both «كيرا», and the title read
// «وبانديدو فرانشيسكو أكيرا» (one-word name, missing «و»).
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { checkArticle, fixNamesWithoutWaw } from "../scripts/news-qa.ts";

const broken = `أقيم العرض.

**المواجهة الرابعة: نزال من ثلاث جولات**

فازت تيسا بلانشارد وكيرا وسكادي على أوليمبيا وكايرا وكانديلا.

🏆 **الفائزات:** تيسا بلانشارد وكيرا وسكادي

---
هزم بانديدو وفرانشيسكو أكيرا كلا من أفيرنو ويوتاني.

**المواجهة الخامسة: نزال فردي**

🏆 **الفائزون:** بانديدو وفرانشيسكو أكيرا
`;

test("a match heading with only its winner line is blocked", () => {
  const codes = checkArticle("نتائج عرض CMLL", broken).map((i) => i.code);
  assert.ok(codes.includes("match_without_text"), codes.join(","));
  assert.ok(codes.includes("singles_label_team_winner"), codes.join(","));
});

test("the fixed layout passes", () => {
  const fixed = broken.replace("---\nهزم بانديدو وفرانشيسكو أكيرا كلا من أفيرنو ويوتاني.\n\n**المواجهة الخامسة: نزال فردي**\n",
    "---\n**المواجهة الخامسة: نزال فرق**\n\nفاز بانديدو وفرانشيسكو أكيرا على أفيرنو ويوتاني.\n");
  const codes = checkArticle("نتائج عرض CMLL", fixed).map((i) => i.code);
  assert.ok(!codes.includes("match_without_text") && !codes.includes("singles_label_team_winner"), codes.join(","));
});

test("a one-word name after «و» followed by a full name gets its «و»", () => {
  assert.equal(fixNamesWithoutWaw("فيلانو الثالث جونيور وبانديدو فرانشيسكو أكيرا يشاركون"), "فيلانو الثالث جونيور وبانديدو وفرانشيسكو أكيرا يشاركون");
  assert.equal(fixNamesWithoutWaw("فاز بانديدو وفرانشيسكو أكيرا"), "فاز بانديدو وفرانشيسكو أكيرا");
});

test("Keyra and Kira are two names in the glossary", () => {
  const g = JSON.parse(fs.readFileSync("scripts/wrestler-names.json", "utf8"));
  assert.notEqual(g["Keyra"], g["Kira"]);
  assert.equal(g["Candela"], "كانديلا");
});
