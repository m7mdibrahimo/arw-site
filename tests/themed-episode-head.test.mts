import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { showSeoText, showNameForms } = require("../lib/show-seo.cjs");

// INCIDENTS #1175: the owner renamed Collision 07.11 to «AEW Collision Chris Jericho’s Rock N’ Wrestling Rager» with a curly
// apostrophe; the plain-letters test dropped the episode's English name from the description and the structured data.
test("a curly apostrophe in the title keeps the themed episode's English name in the head", () => {
  const a = { headline: "عرض كوليجن 07.11.2026 مترجم", title: "AEW Collision Chris Jericho’s Rock N’ Wrestling Rager 07.11.2026", programName: "AEW Collision", eventDate: "2026-11-07", day: "7 نوفمبر 2026", isLatest: true, description: "عرض كوليجن مترجم بالكامل مع جميع النزالات والأحداث." };
  const seo = showSeoText(a);
  assert.match(seo.description, /AEW Collision Chris Jericho's Rock N' Wrestling Rager November 7, 2026/);
  assert.ok(seo.title.length <= 75, seo.title);
  const forms = showNameForms({ ...a, isShow: true });
  for (const f of ["AEW Collision Chris Jericho's Rock N' Wrestling Rager", "Chris Jericho's Rock N' Wrestling Rager 2026", "Chris Jerichos Rock N Wrestling Rager"]) assert.ok(forms.includes(f), f);
});

test("a themed weekly episode carries its theme alone, with «and» for «&»; a plain weekly episode gains nothing", () => {
  const forms = showNameForms({ headline: "عرض داينامايت 04.11.2026 مترجم", title: "AEW Dynamite Blood & Guts 04.11.2026", programName: "AEW Dynamite", eventDate: "2026-11-04", isShow: true });
  for (const f of ["Blood & Guts", "AEW Blood & Guts 2026", "Blood and Guts", "AEW Blood and Guts 2026"]) assert.ok(forms.includes(f), f);
  const raw = showNameForms({ headline: "عرض الرو 02.11.2026 مترجم", title: "WWE Raw 02.11.2026", programName: "WWE Raw", eventDate: "2026-11-02", isShow: true });
  assert.ok(!raw.includes("WWE 2026") && !raw.includes("2026 مترجم"));
});
