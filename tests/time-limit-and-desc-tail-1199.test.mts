import { test } from "node:test";
import assert from "node:assert/strict";
import { timeLimitWinAsDraw } from "../scripts/news-qa.ts";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { metaDescription } = require("../lib/meta-description.cjs");

// INCIDENTS #1199: «MZRY(c) def. Kratos via time limit expiration to retain» went out as a draw.
const src = "NWA World Television Championship: MZRY(c) def. Kratos via time limit expiration to retain the title.\nTiffany Nieves (c) def. Ruby Red to retain the title.";

test("a time-limit win written as a draw is caught", () => {
  const body = "دافع MZRY عن لقبه ضد كراتوس وانتهى النزال بالتعادل بسبب انتهاء الوقت.\n\n🤝 **النتيجة:** تعادل بسبب انتهاء الوقت";
  assert.ok(timeLimitWinAsDraw(body, src));
});

test("the fixed story and a real time-limit draw pass", () => {
  assert.equal(timeLimitWinAsDraw("حافظ MZRY على الحزام بعد انتهاء الوقت.\n\n🏆 **الفائز:** MZRY (بعد انتهاء الوقت)", src), "");
  assert.equal(timeLimitWinAsDraw("🤝 **النتيجة:** تعادل بسبب انتهاء الوقت", "A vs. B ended in a time limit draw."), "");
  assert.equal(timeLimitWinAsDraw("🤝 **النتيجة:** تعادل", "A def. B. C vs. D was a draw."), "");
});

test("a description never ends on one starting word of the next sentence", () => {
  const d = metaDescription("Stigma is finally set to defend his title. CMLL announced that Stigma will defend the CMLL World Lightweight Championship against Calavera Jr. I. This will mark his first title defense since July 2022. Stigma successfully defended the championship three times prior to this upcoming match.");
  assert.ok(!/\bThis\.$/.test(d), d);
  assert.ok(d.endsWith("Calavera Jr. I."), d);
});

const seo = require("../lib/show-seo.cjs");
test("WWE Evolve describes itself with the full category; so do RAW/SmackDown (#1221)", () => {
  const ev = seo.showSeoText({ headline: "عرض ايفولف 04.11.2026 مترجم", title: "WWE Evolve 04.11.2026", programName: "WWE Evolve", eventDate: "2026-11-04", day: "4 نوفمبر 2026", isLatest: false });
  assert.match(ev.description, /من عروض المصارعة الحرة المترجمة\.$/);
  const sd = seo.showSeoText({ headline: "عرض سماك داون 06.11.2026 مترجم", title: "WWE SmackDown 06.11.2026", programName: "WWE SmackDown", eventDate: "2026-11-06", day: "6 نوفمبر 2026", isLatest: false });
  assert.match(sd.description, /من عروض المصارعة الحرة المترجمة\.$/); // INCIDENTS #1221
});

test("weekly pages carry «تحميل عروض المصارعة» in structured data", () => {
  const ev = seo.showNameForms({ headline: "عرض ايفولف 04.11.2026 مترجم", title: "WWE Evolve 04.11.2026", programName: "WWE Evolve", eventDate: "2026-11-04", isShow: true, isLatest: false });
  assert.ok(ev.includes("تحميل عروض المصارعة"), "evolve");
  const raw = seo.showNameForms({ headline: "عرض الرو 02.11.2026 مترجم", title: "WWE RAW 02.11.2026", programName: "WWE RAW", eventDate: "2026-11-02", isShow: true, isLatest: false });
  assert.ok(raw.includes("تحميل عروض المصارعة"), "raw, INCIDENTS #1221");
  const nxt = seo.showNameForms({ headline: "عرض ان اكس تي 04.11.2026 مترجم", title: "WWE NXT 04.11.2026", programName: "WWE NXT", eventDate: "2026-11-04", isShow: true, isLatest: false });
  assert.ok(nxt.includes("تحميل عروض المصارعة"), "nxt, INCIDENTS #1228");
});
