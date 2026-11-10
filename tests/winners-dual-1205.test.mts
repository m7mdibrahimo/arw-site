import { test } from "node:test";
import assert from "node:assert/strict";
import { applyCorrections } from "../scripts/news-qa.ts";

test("#1205: «🏆 الفائزان/الفائزتان» become plural, in the winner line and in prose", () => {
  assert.equal(applyCorrections("🏆 **الفائزان:** سيلاس ماسون وأليكس تايلور"), "🏆 **الفائزون:** سيلاس ماسون وأليكس تايلور");
  assert.equal(applyCorrections("🏆 **الفائزتان:** سول روكا وآيو سكاي"), "🏆 **الفائزات:** سول روكا وآيو سكاي");
  assert.equal(applyCorrections("بعد النزال، وضع الفائزان كرسيا حول رقبته"), "بعد النزال، وضع الفائزون كرسيا حول رقبته");
  // whole words only
  assert.equal(applyCorrections("🏆 **الفائز:** MZRY"), "🏆 **الفائز:** MZRY");
});

test("#1205: an MMA card's structured-data names never call it wrestling", async () => {
  const { showNameForms } = await import("../lib/show-seo.cjs");
  const forms = showNameForms({ headline: "عرض يو اف سي فايت نايت 07.11.2026 مترجم", title: "UFC Fight Night 293: Cortes Acosta vs Walker", programName: "UFC Fight Night", eventDate: "2026-11-07", isShow: true });
  assert.ok(forms.length > 20);
  assert.deepEqual(forms.filter((f: string) => /مصارع/.test(f)), []);
  assert.ok(forms.includes("نزالات MMA مترجمة"));
  // wrestling shows keep their category forms
  const raw = showNameForms({ headline: "عرض الرو 09.11.2026 مترجم", programName: "WWE Raw", eventDate: "2026-11-09", isShow: true });
  assert.ok(raw.some((f: string) => /مصارعة حرة/.test(f)));
});
