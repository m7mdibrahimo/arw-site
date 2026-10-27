import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

// INCIDENTS #894: English stories render at /en-src/news/, so «page.url.startsWith('/news/')» missed them and every
// English news page's BreadcrumbList said «Home → Highlights (/en/recaps/) → WWE → story».
test("the news breadcrumb step comes from isNews, never from the /news/ URL", () => {
  const t = fs.readFileSync("_includes/post-layout.njk", "utf-8");
  const crumb = t.slice(t.indexOf('"@type": "BreadcrumbList"'), t.indexOf("{% set ldProg"));
  assert.match(crumb, /set sectionName = 'الأخبار' if isNews else/);
  assert.match(crumb, /set sectionUrl = '\/news\/' if isNews else/);
  assert.match(crumb, /set ldFed = federation if \(federation and not isNews/);
  assert.doesNotMatch(crumb, /startsWith\('\/news\/'\)/);
  assert.match(t, /set isNews = [^\n]*"content\/news" in page\.inputPath/);
});
