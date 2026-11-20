import { test } from "node:test";
import assert from "node:assert/strict";
import { dropJokeExplainers, autoFix } from "../scripts/news-qa.ts";
import { dropEnglishJokeExplainers, fixEnglishNames } from "../scripts/english-edition.ts";

// RJ City story 20/11 — INCIDENTS #1444: both editions ended with a sentence explaining the joke that no source said
test("an Arabic closing sentence explaining the joke goes", () => {
  const body = "مزح آر جي سيتي بالقول إنه سيعود إلى المدرسة الثانوية.\n\nيذكر أنه من غير المعتاد الذهاب إلى المدرسة الثانوية للحصول على شهادة جامعية، في إطار الطابع الساخر لتصريحاته.";
  assert.equal(dropJokeExplainers(body), "مزح آر جي سيتي بالقول إنه سيعود إلى المدرسة الثانوية.");
  assert.ok(!autoFix(body).includes("الطابع الساخر"));
});

test("a sentence about a character's satirical side stays", () => {
  const body = "وكان لدى الاتحاد خطط أكبر للتركيز على الطابع الساخر المتمثل في إعلان نفسه أفضل مصارع لوتشا ليبر في العالم.";
  assert.equal(dropJokeExplainers(body), body);
});

test("the English twin goes too, quotes stay", () => {
  const body = "RJ City joked that he plans to return to high school.\n\n> \"This is what I'm going to high school for.\"\n\nIt is worth noting that attending high school to earn a degree is unusual, highlighting the satirical nature of his comments.";
  assert.equal(dropEnglishJokeExplainers(body), "RJ City joked that he plans to return to high school.\n\n> \"This is what I'm going to high school for.\"");
  assert.ok(!fixEnglishNames(body).includes("satirical nature"));
});

// Round 2026-11-20 (INCIDENTS #1444): every show's BroadcastEvent is a complete online Event
import fs from "node:fs";
test("a show's BroadcastEvent names its VirtualLocation and organizer", () => {
  const layout = fs.readFileSync("_includes/post-layout.njk", "utf8");
  const i = layout.indexOf('"@type": "BroadcastEvent"');
  const pub = layout.slice(i, i + 1200);
  assert.match(pub, /"location": \{ "@type": "VirtualLocation", "url": "https:\/\/arab-wrestling\.com\{\{ page\.url \| cleanUrl \}\}" \}/);
  assert.match(pub, /"organizer": \{ "@type": "Organization"/);
});
