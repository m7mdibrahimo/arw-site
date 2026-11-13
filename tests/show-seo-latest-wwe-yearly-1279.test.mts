import { test } from "node:test";
import assert from "node:assert/strict";
import showSeo from "../lib/show-seo.cjs";
const { showSeoText } = showSeo as any;

// INCIDENTS #1279: «اخر عرض الرو» 5.2 / «اخر عرض سماك داون» 9.4 — the newest WWE weekly episode says «آخر عرض <date>»;
// an older one keeps «موعد العرض».
test("the newest WWE weekly episode's description says «آخر عرض»", () => {
  const raw = { headline: "عرض الرو 09.11.2026 مترجم", title: "WWE RAW 09.11.2026", programName: "WWE RAW", eventDate: new Date("2026-11-09"), day: "9 نوفمبر 2026", description: "عرض الرو مترجم بالكامل مع جميع النزالات والأحداث." };
  assert.match(showSeoText({ ...raw, isLatest: true }).description, /أونلاين، آخر عرض 9 نوفمبر 2026 \(دبليو دبليو إي راو/);
  assert.match(showSeoText({ ...raw, isLatest: false }).description, /موعد العرض 9 نوفمبر 2026/);
});

// «كراون جول 2026» 11.0: a WWE yearly event names the federation in Arabic letters in its description, like the weekly pages.
test("a WWE yearly event's description carries «دبليو دبليو إي <event>»", () => {
  const cj = { headline: "عرض كراون جول 07.11.2026 مترجم", title: "WWE Crown Jewel (2026)", programName: "WWE Crown Jewel", eventDate: new Date("2026-11-07"), day: "7 نوفمبر 2026", description: "عرض كراون جول مترجم بالكامل مع جميع النزالات والأحداث.", isLatest: true };
  const d = showSeoText(cj).description;
  assert.match(d, /دبليو دبليو إي كراون جول 2026/);
  assert.match(d, /WWE Crown Jewel November 7, 2026/);
  assert.doesNotMatch(d, /مع روابط المشاهدة والتحميل/);
  assert.ok(d.length < 230, `${d.length}`);
});
