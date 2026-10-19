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

test("NWA Powerrr, MLW Fusion and CMLL weekly programs carry the spellings visitors use (INCIDENTS #549)", () => {
  const cfg = readFileSync(new URL("../eleventy.config.js", import.meta.url), "utf8");
  for (const q of ['"nwa-powerrr": [', '"ان دبليو ايه باور"', '"mlw-fusion": [', '"ام ال دبليو فيوجن"', '"cmll-lunes-clasico": [', '"لونيس كلاسيكو"', '/^cmll-/.test(p.slug)']) assert.ok(cfg.includes(q), q);
});

test("Lucha Libre AAA carries the Arabic spellings visitors type (INCIDENTS #717)", () => {
  const src = readFileSync("eleventy.config.js", "utf8");
  const line = src.split("\n").find((l) => l.includes('"lucha-libre-aaa": ['))!;
  for (const q of ["لوتشا ليبري ايه ايه ايه", "لوتشا ليبري", "Lucha Libre AAA مترجم"]) assert.ok(line.includes(`"${q}"`), q);
});
