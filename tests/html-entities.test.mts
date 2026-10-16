import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "fs";
import { decodeHtmlEntities, applyCorrections } from "../scripts/news-qa";
import { fixEnglishNames } from "../scripts/english-edition";

test("HTML entities from the source become real characters (INCIDENTS #600)", () => {
  assert.equal(decodeHtmlEntities("&#8220;Two of Aussie&#8217;s biggest.&#8221; A &amp; B"), "“Two of Aussie’s biggest.” A & B");
  assert.equal(decodeHtmlEntities("a &lt;b&gt; c"), "a &lt;b&gt; c");
  assert.equal(fixEnglishNames("&#8220;Hello&#8221;"), "“Hello”");
  assert.equal(applyCorrections("قال &quot;نعم&quot;"), 'قال "نعم"');
});

test("no published story keeps a raw HTML entity", () => {
  for (const dir of ["content/news", "content/news-en"]) for (const f of fs.readdirSync(dir)) {
    if (!f.endsWith(".md")) continue;
    assert.ok(!/&#\d+;|&(quot|amp|nbsp|rsquo|ldquo|rdquo);/.test(fs.readFileSync(`${dir}/${f}`, "utf8")), `${dir}/${f}`);
  }
});

test("the watcher stores source_title with entities decoded (INCIDENTS #626)", () => {
  const src = fs.readFileSync("scripts/fightful-watcher.ts", "utf8");
  assert.ok(src.includes("source_title: ${JSON.stringify(decodeHtmlEntities(rawTitle))}"));
});
