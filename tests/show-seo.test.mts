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

// INCIDENTS #733: «عروض مصارعة مترجم» (6.2) and «wwe مترجم» (8.1) — the category and federation spellings of a weekly show.
test("a weekly show carries the short category and federation forms", () => {
  const forms = showNameForms({ headline: "عرض الرو 12.10.2026 مترجم", title: "WWE Raw 12.10.2026", programName: "WWE Raw", eventDate: "2026-10-12", aliases: ["عرض الرو"], isShow: true });
  for (const f of ["عروض مصارعة مترجم", "عروض المصارعة مترجم", "عروض WWE مترجم", "عروض المصارعة", "مصارعه مترجم", "عروض المصارعه مترجم"]) assert.ok(forms.some((n: string) => n.toLowerCase() === f.toLowerCase()), f);
});

// INCIDENTS #748: «ملخص/نتائج عرض سماك داون الاخير مترجم» (5–8) — a weekly episode is also searched as its recap/results.
test("a weekly show carries the recap and results forms", () => {
  const forms = showNameForms({ headline: "عرض سماك داون 16.10.2026", title: "WWE Smackdown 16.10.2026", programName: "WWE Smackdown", eventDate: "2026-10-16", aliases: ["عرض سماك داون"], isShow: true });
  for (const f of ["ملخص عرض سماك داون الاخير مترجم", "نتائج عرض سماك داون الاخير مترجم"]) assert.ok(forms.includes(f), f);
});

// INCIDENTS #754: a weekly show of a non-WWE program is also searched with «مشاهدة/تحميل/اون لاين» and the year in front of its English name.
test("a weekly episode carries watch/download/year forms of its full English name", () => {
  const forms = showNameForms({ headline: "عرض ايه اي دبليو دايناميت 14.10.2026 مترجم", title: "AEW Dynamite 14.10.2026", programName: "AEW Dynamite", eventDate: "2026-10-14", aliases: ["عرض ايه اي دبليو دايناميت"], isShow: true, archive: false });
  for (const f of ["مشاهدة AEW Dynamite", "تحميل AEW Dynamite", "AEW Dynamite 2026 مترجم", "AEW Dynamite اون لاين"]) assert.ok(forms.some((n: string) => n.toLowerCase() === f.toLowerCase()), f);
});

// INCIDENTS #776: «aew مترجم» (7.5) — a yearly show also carries its federation's search names.
test("a yearly AEW show carries «aew مترجم»", () => {
  const f = showNameForms({ headline: "عرض ريسل دريم 17.10.2026 مترجم", title: "AEW WrestleDream (2026)", programName: "AEW WrestleDream", eventDate: "2026-10-17", aliases: [], isShow: true, archive: false });
  assert.ok(f.includes("aew مترجم") || f.includes("AEW مترجم"));
});

// INCIDENTS #778: «الرو» / «رو» / «عرض الرو» alone sat at 9 in Search Console.
test("a weekly episode carries its bare program name", () => {
  const forms = showNameForms({ headline: "عرض الرو 19.10.2026 مترجم", title: "WWE Raw 19.10.2026", programName: "WWE Raw", eventDate: "2026-10-19", aliases: [], isShow: true, archive: false });
  for (const f of ["الرو", "رو", "عرض الرو", "الرو 19.10.2026"]) assert.ok(forms.includes(f), f);
  assert.equal(forms.length, new Set(forms).size);
});

// INCIDENTS #785: «عرض موني ان ذا بانك 2026 مباشر» sat outside the first 3 in Search Console.
test("a yearly show carries the «مباشر» forms", () => {
  const f = showNameForms({ headline: "عرض موني ان ذا بانك 2026 مترجم", title: "WWE Money in the Bank (2026)", programName: "WWE Money in the Bank", eventDate: "2026-06-06", aliases: ["عرض موني ان ذا بانك 2026"], isShow: true, archive: false });
  assert.ok(f.some((n: string) => /^عرض موني ان ذا بانك 2026 مباشر$/.test(n)), JSON.stringify(f.slice(0, 40)));
});

// INCIDENTS #787: «عروض المصارعة الحرة» (8.9) and «اخر عرض الرو» (7.1) outside the first 3 for the 19.10 episode.
test("a weekly show carries «عروض المصارعة الحرة» and «اخر عرض …»", () => {
  const forms = showNameForms({ headline: "عرض الرو 19.10.2026 مترجم", title: "WWE Raw 19.10.2026", programName: "WWE Raw", eventDate: "2026-10-19", aliases: ["عرض الرو"], isShow: true });
  for (const f of ["عروض المصارعة الحرة", "اخر عرض الرو", "آخر عرض الرو", "اخر عرض الرو مترجم"]) assert.ok(forms.includes(f), f);
});

// INCIDENTS #796: a yearly show's recap is also searched «مشاهدة عرض … 2026» / «تحميل عرض … 2026» — structured data only.
test("a yearly recap's name forms carry «مشاهدة / تحميل عرض … 2026»", () => {
  const f = showNameForms({ headline: "ملخص عرض موني ان ذا بانك 10.10.2026", title: "WWE Money in the Bank Highlights (2026)", programName: "WWE Money in the Bank Highlights", eventDate: "2026-10-10", aliases: [], isShow: false, archive: false });
  assert.ok(f.includes("مشاهدة عرض موني ان ذا بانك 2026"));
  assert.ok(f.includes("تحميل عرض موني ان ذا بانك 2026"));
  assert.ok(f.includes("Money in the Bank 2026 كامل مترجم"));
});

// INCIDENTS #800: «تحميل عروض مصارعة» and «tailgate مترجم» sat outside the first 3 for the AEW WrestleDream pages.
test("a yearly show carries the wrestling-shows category and its sub-event word", () => {
  const f = showNameForms({ headline: "عرض ريسل دريم تيلجيت برول 17.10.2026 مترجم", title: "AEW WrestleDream Tailgate Brawl (2026)", programName: "AEW WrestleDream", eventDate: "2026-10-17", aliases: [], isShow: true, archive: false });
  for (const n of ["تحميل عروض مصارعة", "عروض المصارعة الحرة مترجم", "Tailgate مترجم", "Tailgate Brawl مترجم"]) assert.ok(f.includes(n), n);
});

// INCIDENTS #818: «wwe مشاهدة» (8.3) — the federation alone with «مشاهدة/تحميل» in front or behind.
test("a weekly show carries the federation with watch/download words", () => {
  const forms = showNameForms({ headline: "عرض سماك داون 16.10.2026", title: "WWE Smackdown 16.10.2026", programName: "WWE Smackdown", eventDate: "2026-10-16", aliases: ["عرض سماك داون"], isShow: true });
  for (const f of ["wwe مشاهدة", "مشاهدة wwe", "wwe تحميل", "تحميل wwe"]) assert.ok(forms.some((n: string) => n.toLowerCase() === f), f);
});
