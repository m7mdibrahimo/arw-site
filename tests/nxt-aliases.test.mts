import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

// INCIDENTS #479: the NXT show pages carry the misspellings visitors type with «مترجم»
test("NXT aliases include the misspelt + مترجم forms Google showed", () => {
  const src = readFileSync("eleventy.config.js", "utf8");
  const line = src.split("\n").find((l) => l.includes('"wwe-nxt": ['))!;
  for (const q of ["اكس مترجم", "اكس ان اكس اكس مترجم", "اكس ان اكس مترجم"]) assert.ok(line.includes(`"${q}"`), q);
});

import { checkArticle } from "../scripts/news-qa.ts";
// INCIDENTS #479: «X وX جونيور» is a father/son (or Jr) team, not a doubled name
test("doubled_name ignores name + same name Jr", () => {
  const body = "تمكن فريق سومبراس ديابوليكاس (سومبرا ديابوليكا وسومبرا ديابوليكا جونيور) من تحقيق الفوز على خصومهم.";
  assert.ok(!checkArticle("عنوان عربي كامل للخبر هنا", body, []).some((i) => i.code === "doubled_name"));
  assert.ok(checkArticle("عنوان عربي كامل للخبر هنا", "فريق من ويل أوسبراي وغريت أو خان وغريت أو خان في نزال.", []).some((i) => i.code === "doubled_name"));
});
