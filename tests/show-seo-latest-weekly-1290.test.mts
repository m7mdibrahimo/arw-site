import { test } from "node:test";
import assert from "node:assert/strict";
import showSeo from "../lib/show-seo.cjs";
const { showSeoText } = showSeo as any;

// INCIDENTS #1290: «آخر عرض <date>» reached only WWE (#1279); every program's newest weekly episode says it now.
test("the newest TNA / ROH / AEW weekly episode's description says «آخر عرض»", () => {
  const tna = { headline: "عرض تي ان ايه امباكت 12.11.2026 مترجم", title: "TNA iMPACT 12.11.2026", programName: "TNA iMPACT", eventDate: new Date("2026-11-12"), day: "12 نوفمبر 2026", description: "عرض تي ان ايه امباكت مترجم بالكامل مع جميع النزالات والأحداث." };
  assert.match(showSeoText({ ...tna, isLatest: true }).description, /وبجودة عالية، آخر عرض 12 نوفمبر 2026 \(TNA iMPACT November 12, 2026\)/);
  assert.match(showSeoText({ ...tna, isLatest: false }).description, /موعد العرض 12 نوفمبر 2026/);
  const roh = { ...tna, headline: "عرض ار او اتش اون اونر كلوب 12.11.2026 مترجم", title: "ROH on HonorClub 12.11.2026", programName: "ROH on HonorClub", description: "" };
  assert.match(showSeoText({ ...roh, isLatest: true }).description, /آخر عرض 12 نوفمبر 2026/);
});
