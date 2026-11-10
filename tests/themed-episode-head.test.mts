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

// INCIDENTS #1191: «AEW Dynamite Blood & Guts» was titled «… — AEW Dynamite» (no episode name), «AEW Fright Night Dynamite»
// (theme in the middle) had no «AEW Fright Night»/«Fright Night 2026», and «MLP Special: Josh Alexander vs Stu Grayson»
// had no Arabic name of either fighter.
test("themed episode name in the title tail, a mid-name theme's forms, and a card's fighters in Arabic (INCIDENTS #1191)", () => {
  const bg = { headline: "عرض داينامايت 04.11.2026 مترجم", title: "AEW Dynamite Blood & Guts 04.11.2026", programName: "AEW Dynamite", eventDate: "2026-11-04", day: "4 نوفمبر 2026", isLatest: false };
  assert.ok(showSeoText(bg).title.endsWith("— AEW Dynamite Blood & Guts"), showSeoText(bg).title);
  const raw = { headline: "عرض الرو 02.11.2026 مترجم", title: "WWE Raw 02.11.2026", programName: "WWE Raw", eventDate: "2026-11-02", day: "2 نوفمبر 2026", isLatest: false };
  assert.ok(showSeoText(raw).title.endsWith("— WWE Raw"));
  const rager = { headline: "عرض كوليجن 07.11.2026 مترجم", title: "AEW Collision Chris Jericho’s Rock N’ Wrestling Rager 07.11.2026", programName: "AEW Collision", eventDate: "2026-11-07", day: "7 نوفمبر 2026", isLatest: false };
  assert.ok(showSeoText(rager).title.length <= 75);
  const fn = showNameForms({ headline: "عرض داينامايت 28.10.2026 مترجم", title: "AEW Fright Night Dynamite 28.10.2026", programName: "AEW Dynamite", eventDate: "2026-10-28", isShow: true });
  for (const f of ["Fright Night", "AEW Fright Night", "AEW Fright Night 2026", "Fright Night Dynamite"]) assert.ok(fn.includes(f), f);
  const mlp = showNameForms({ headline: "عرض ام ال بي 21.10.2026 مترجم", title: "MLP Special: Josh Alexander vs Stu Grayson 21.10.2026", programName: "MLP Special", eventDate: "2026-10-21", isShow: true });
  for (const f of ["جوش ألكسندر ضد ستو غرايسون", "ستو غرايسون مترجم"]) assert.ok(mlp.includes(f), f);
  const ufc = showNameForms({ headline: "عرض يو اف سي فايت نايت 285 مترجم", title: "UFC Fight Night 285: Hernandez vs. Rodrigues", programName: "UFC Fight Night", eventDate: "2026-09-20", isShow: true });
  assert.ok(!ufc.some((f) => /[ء-ي]+ مترجم$/.test(f) && /هيرنانديز/.test(f)));
});
