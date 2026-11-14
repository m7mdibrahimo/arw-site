// INCIDENTS #1305 — «وأضاف أن لقائه بالجماهير» (D-Von Dudley), «لتطوير أداؤها» (Chelsea Green),
// «لذلك أرادنا ارتداء» and «ويستمر مارك ديفيس في مواصلة مسيرته» (Mark Davis), «كرويل» for Krule and
// «بويستيك» for Dylan Bostic. All are now wrong→right rules in editorial/corrections.json.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { applyCorrections } from "../scripts/news-qa.ts";

test("the noun after «أن» takes «اءه», after a preposition or idafa «أدائها»", () => {
  assert.equal(applyCorrections("وأضاف أن لقائه بالجماهير جعله يدرك"), "وأضاف أن لقاءه بالجماهير جعله يدرك");
  assert.equal(applyCorrections("يرى أن أدائه كان جيدا"), "يرى أن أداءه كان جيدا");
  assert.equal(applyCorrections("تدفعها دائما لتطوير أداؤها."), "تدفعها دائما لتطوير أدائها.");
  assert.equal(applyCorrections("وتحدث عن تراجع أداؤه"), "وتحدث عن تراجع أدائه");
  // the subject keeps its «ؤ»
  assert.equal(applyCorrections("وصار أداؤها أفضل"), "وصار أداؤها أفضل");
});

test("«أرادنا ارتداء» → «أردنا ارتداء», «يستمر في مواصلة» → «يواصل»", () => {
  assert.equal(applyCorrections("لذلك أرادنا ارتداء الملابس المناسبة"), "لذلك أردنا ارتداء الملابس المناسبة");
  assert.equal(applyCorrections("ويستمر مارك ديفيس في مواصلة مسيرته مع اتحاد AEW"), "ويواصل مارك ديفيس مسيرته مع اتحاد AEW");
  assert.equal(applyCorrections("وتستمر في مواصلة العمل"), "وتواصل العمل");
});

test("Krule and Dylan Bostic are spelled as in the glossary", () => {
  const g = JSON.parse(fs.readFileSync("scripts/wrestler-names.json", "utf8"));
  assert.equal(g["Krule"], "كرول");
  assert.equal(g["Dylan Bostic"], "ديلان بوستيك");
  assert.equal(applyCorrections("ظهوره بجانب المصارع كرويل"), "ظهوره بجانب المصارع كرول");
  assert.equal(applyCorrections("اتهم بويستيك اتحاد AEW"), "اتهم بوستيك اتحاد AEW");
});

// Search Console: «كروز مونتانا» 7.7 (252 impressions) on a news page. Each Person in a story's
// structured data now carries the url of the site's indexable tag page about that person.
test("a story's Person entries link their tag page", () => {
  const t = fs.readFileSync("_includes/post-layout.njk", "utf8");
  const about = t.match(/"about": \[\{% for m in ldHeadPeople %\}[^\n]*?\}\{% if not loop\.last/)![0];
  const mentions = t.match(/"mentions": \[\{% for m in ldPeople %\}[^\n]*?\}\{% if not loop\.last/)![0];
  for (const s of [about, mentions]) {
    assert.match(s, /m\.name \| tagHref/);
    assert.match(s, /"url": "https:\/\/arab-wrestling\.com\{\{ mHref \}\}"/);
  }
});
