import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { showSeoText } = require("../lib/show-seo.cjs");

// INCIDENTS #1459: «عرض aew مترجم» 8.0 on Dynamite 18.11 — the Arabic part of the head never said «عرض AEW».
test("an AEW show's head names the federation in its Arabic part", () => {
  const r = showSeoText({ headline: "عرض داينامايت 18.11.2026 مترجم", title: "AEW Dynamite 18.11.2026", programName: "AEW Dynamite", eventDate: "2026-11-18", day: "18 نوفمبر 2026", isLatest: true });
  assert.equal(r.title, "عرض AEW داينامايت الأخير 18.11.2026 كامل مترجم — AEW Dynamite");
  assert.match(r.description, /^مشاهدة وتحميل عرض AEW داينامايت الأخير 18\.11\.2026 مترجم/);
  assert.match(r.description, /آخر عرض AEW داينامايت 18 نوفمبر 2026/);
});

test("the federation is not added twice, to other promotions, or past ~72 letters", () => {
  const ar = showSeoText({ headline: "عرض اي ايه دبليو كوليجن 31.10.2026 مترجم", title: "AEW Collision 31.10.2026", programName: "AEW Collision", eventDate: "2026-10-31", day: "31 أكتوبر 2026", isLatest: false });
  assert.ok(!/عرض AEW/.test(ar.title));
  const raw = showSeoText({ headline: "عرض الرو 16.11.2026 مترجم", title: "WWE RAW 16.11.2026", programName: "WWE RAW", eventDate: "2026-11-16", day: "16 نوفمبر 2026", isLatest: true });
  assert.equal(raw.title, "عرض الرو الأخير 16.11.2026 كامل مترجم — WWE RAW");
  const joined = showSeoText({ headline: "عرض داينامايت 11.11.2026 مترجم", title: "AEW Dynamite and Collision (11.11.2026)", programName: "AEW Dynamite", eventDate: "2026-11-11", day: "11 نوفمبر 2026", isLatest: false });
  assert.ok(joined.title.length <= 72);
  assert.match(joined.title, /^عرض داينامايت وكوليجن 11\.11\.2026/);
  const ac = showSeoText({ headline: "عرض كوليجن 14.11.2026 مترجم", title: "AEW Collision 14.11.2026", programName: "AEW Collision", eventDate: "2026-11-14", day: "14 نوفمبر 2026", isLatest: true, commentary: true });
  assert.equal(ac.title, "عرض AEW كوليجن الأخير 14.11.2026 كامل بالتعليق العربي — AEW Collision");
});
