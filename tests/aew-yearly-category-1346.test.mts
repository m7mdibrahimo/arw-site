import { test } from "node:test";
import assert from "node:assert/strict";
import showSeo from "../lib/show-seo.cjs";
const { showSeoText } = showSeo as any;

// INCIDENTS #1346: an AEW yearly event names «عروض AEW» in its description the way the AEW weekly pages do (#1230).
test("an AEW yearly event's description names «عروض AEW»; a non-AEW special keeps its closing", () => {
  const fg = { headline: "عرض فول جير 2026 مترجم", title: "AEW Full Gear 2026", programName: "AEW Full Gear", eventDate: new Date("2026-11-14"), day: "14 نوفمبر 2026", description: "", isLatest: true };
  const d = showSeoText(fg).description;
  assert.match(d, /من عروض المصارعة الحرة المترجمة وعروض AEW\.$/);
  assert.doesNotMatch(d, /روابط المشاهدة/);
  const gcw = { ...fg, headline: "عرض جي سي دبليو ذا سكور 2026 مترجم", title: "GCW The Score 2026", programName: "GCW The Score" };
  assert.match(showSeoText(gcw).description, /من عروض المصارعة الحرة المترجمة مع روابط المشاهدة والتحميل\.$/);
});
