import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

// INCIDENTS #479: the NXT show pages carry the misspellings visitors type with «مترجم»
// INCIDENTS #923: …but never the adult-site searches («اكس ان اكس اكس» = xnxx) Google once showed them for
test("NXT aliases keep the real misspellings and none of the adult-site searches", async () => {
  const src = readFileSync("eleventy.config.js", "utf8");
  const line = src.split("\n").find((l) => l.includes('"wwe-nxt": ['))!;
  for (const q of ["ان اكس تي", "ان اكس تي مترجم", "NXT مترجم"]) assert.ok(line.includes(`"${q}"`), q);
  const { isOffTopicQuery, weakQueries } = await import("../scripts/seo-new-shows.ts");
  const aliases = [...line.matchAll(/"([^"]+)"/g)].map((m) => m[1]);
  assert.deepEqual(aliases.filter(isOffTopicQuery), []);
  assert.ok(!/"اكس ان اكس"|"اكس اكس ان"/.test(readFileSync("lib/show-seo.cjs", "utf8")));
  for (const q of ["اكس ان اكس اكس مترجم", "اكس ان اكس عرب", "اكس مترجم", "xnxx"]) assert.ok(isOffTopicQuery(q), q);
  for (const q of ["ان اكس تي مترجم", "عرض ان اكس اكس مترجم", "اكس تي", "عرض الرو الاخير", "nxt مترجم", "نيكي بيلا", "ساسكس"]) assert.ok(!isOffTopicQuery(q), q);
  const qs = [{ q: "اكس ان اكس", impressions: 9, clicks: 0, position: 8 }, { q: "عرض ان اكس تي", impressions: 9, clicks: 0, position: 8 }];
  assert.deepEqual(weakQueries(qs).map((x: any) => x.q), ["عرض ان اكس تي"]);
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
