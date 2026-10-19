import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { showSeoText, showNameForms } = require("../lib/show-seo.cjs");

// INCIDENTS #690: two parts of one event on one day had the same title/description, and an AEW show got «wwe AEW WrestleDream 2026 مترجم».
test("the two parts of an event keep their part mark in the head", () => {
  const mk = (part: string) => showSeoText({ headline: `عرض ريف برو / سي ام ال ال فانتاستيكا مانيا يو كيه (${part}) 17.10.2026 مترجم`, title: "RevPro/CMLL Fantastica Mania UK 2026", programName: "RevPro", eventDate: "2026-10-17", day: "17 أكتوبر 2026", isLatest: false, description: "" });
  const a = mk("العرض الاول"), b = mk("العرض الثاني");
  assert.notEqual(a.title, b.title);
  assert.notEqual(a.description, b.description);
  assert.ok(a.title.includes("(العرض الاول)") && b.title.includes("(العرض الثاني)"));
  const plain = showSeoText({ headline: "عرض سماك داون 16.10.2026 مترجم", title: "WWE SmackDown", programName: "WWE SmackDown", eventDate: "2026-10-16", day: "16 أكتوبر 2026", isLatest: false, description: "" });
  assert.ok(!plain.title.includes("("));
});

test("«wwe …» search names only for WWE programs", () => {
  const forms = (prog: string, title: string) => showNameForms({ headline: "عرض ريسل دريم 17.10.2026 مترجم", title, programName: prog, eventDate: "2026-10-17", aliases: [], isShow: true, archive: false });
  const aew = forms("AEW WrestleDream", "AEW WrestleDream (2026)");
  assert.ok(!aew.some((n: string) => /^wwe /i.test(n)));
  assert.ok(aew.includes("AEW WrestleDream 2026"));
  const wwe = forms("WWE Money in the Bank", "WWE Money in the Bank (2026)");
  assert.ok(wwe.includes("wwe Money in the Bank 2026 مترجم"));
});

// INCIDENTS #704: the names the page already carries are not repeated by showNameForms (alternateName had ~25 duplicates).
test("showNameForms does not repeat the aliases it is given", async () => {
  const { showNameForms } = await import("../lib/show-seo.cjs");
  const aliases = ["عرض سماك داون", "سماك داون الأخير"];
  const forms = showNameForms({ headline: "عرض سماك داون 16.10.2026", title: "WWE Smackdown 16.10.2026", programName: "WWE Smackdown", eventDate: "2026-10-16", aliases, isShow: true });
  assert.ok(forms.length > 5);
  assert.equal(forms.length, new Set(forms).size);
  for (const a of aliases) assert.ok(!forms.includes(a));
});

// INCIDENTS #710: «عرض aew dynamite الأخير» (position 10) — «عرض» in front of the English program name.
test("a weekly show with an English name carries «عرض <name> الأخير» forms", () => {
  const forms = showNameForms({ headline: "عرض ايه اي دبليو دايناميت 14.10.2026 مترجم", title: "AEW Dynamite 14.10.2026", programName: "AEW Dynamite", eventDate: "2026-10-14", aliases: ["عرض ايه اي دبليو دايناميت"], isShow: true, archive: false });
  for (const f of ["عرض AEW Dynamite الاخير", "عرض AEW Dynamite مترجم"]) assert.ok(forms.some((n: string) => n.toLowerCase() === f.toLowerCase()), f);
  assert.ok(forms.some((n: string) => /^عرض aew dynamite الأخير$/i.test(n)));
});
