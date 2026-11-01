import { test } from "node:test";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
import assert from "node:assert/strict";
import { applyCorrections } from "../scripts/news-qa.ts";
import { ENGLISH_FIXES } from "../scripts/english-edition.ts";

// INCIDENTS #999 — «ذا هارديز بويز», «تي إكستريم ليتا», «رويس كي» in the 2026-11-01 stories.
test("Hardy Boyz / Team Xtreme / Royce Keys spellings are corrected", () => {
  assert.equal(applyCorrections("فريق ذا هارديز بويز"), "فريق ذا هاردي بويز");
  assert.equal(applyCorrections("في فريق تي إكستريم"), "في فريق تيم إكستريم");
  assert.equal(applyCorrections("رويس كي وسولو سيكوا"), "رويس كيز وسولو سيكوا");
  assert.equal(applyCorrections("رويس كيز"), "رويس كيز");
  const fix = (t: string) => ENGLISH_FIXES.reduce((x, [re, to]) => x.replace(re, to), t);
  assert.equal(fix("Solo Sikoa takes on Royce Key in singles"), "Solo Sikoa takes on Royce Keys in singles");
  assert.equal(fix("Royce Keys wins"), "Royce Keys wins");
});

test("the latest weekly episode carries «تحميل المصارعة» in its alternate names", () => {
  const { showNameForms } = require("../lib/show-seo.cjs");
  const f = showNameForms({ headline: "عرض سماك داون 30.10.2026 مترجم", title: "WWE SmackDown 30.10.2026", programName: "WWE SmackDown", eventDate: "2026-10-30", isShow: true });
  assert.ok(f.includes("تحميل المصارعة"));
});
