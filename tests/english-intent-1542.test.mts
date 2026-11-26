import { test } from "node:test";
import assert from "node:assert/strict";

// INCIDENTS #1542: «aew full gear 2026 watch online» (11.6) and «wwe crown jewel 2026 full show download» (19.5) land on the
// Arabic page since the English edition left, and a yearly show's structured data carried only the bare English name.
test("a yearly show's names carry the English watch/download forms; weekly episodes and archives don't (INCIDENTS #1542)", async () => {
  const { showNameForms } = await import("../lib/show-seo.cjs");
  const fg = showNameForms({ headline: "عرض AEW فول جير 2026 مترجم", title: "AEW Full Gear (2026)", programName: "AEW Full Gear", eventDate: "2026-11-14", isShow: true });
  for (const q of ["AEW Full Gear 2026 watch online", "AEW Full Gear 2026 full show", "AEW Full Gear 2026 full show download", "AEW Full Gear 2026 download"]) assert.ok(fg.includes(q), q);
  const cj = showNameForms({ headline: "عرض كراون جول 2026 مترجم", title: "WWE Crown Jewel (2026)", programName: "WWE Crown Jewel", eventDate: "2026-11-01", isShow: true });
  assert.ok(cj.includes("WWE Crown Jewel 2026 full show download"));
  const raw = showNameForms({ headline: "عرض الرو 23.11.2026 مترجم", title: "WWE RAW 23.11.2026", programName: "WWE RAW", eventDate: "2026-11-23", isShow: true });
  assert.equal(raw.filter((n) => /watch online|full show/.test(n)).length, 0);
  const old = showNameForms({ headline: "عرض كراون جول 2018 مترجم", title: "WWE Crown Jewel (2018)", programName: "WWE Crown Jewel", eventDate: "2018-11-02", isShow: true, archive: true });
  assert.equal(old.filter((n) => /watch online|full show/.test(n)).length, 0);
});
