import { test } from "node:test";
import assert from "node:assert/strict";
import { checkArticle, applyCorrections } from "../scripts/news-qa.ts";
import { duplicateTitleDateSuffix, sourceShowMonthDay } from "../scripts/fightful-watcher.ts";

const filler = " وتفاصيل كثيرة عن العرض والنجوم المشاركين فيه.".repeat(12);

test("#1203: a duplicate weekly title gets the show's date from the source, not the publish day", () => {
  const src = "https://www.wrestlinginc.com/2311791/wwe-raw-november-9-2026-hated-loved-opinion-review/ WWE RAW 11/9/2026: 3 Things We Hated & 3 Things We Loved";
  assert.equal(duplicateTitleDateSuffix(src, "شهد عرض WWE RAW بتاريخ 9 نوفمبر 2026", "2026-11-10T06:41:16.406Z"), "9 نوفمبر");
  // no date in the source: the body's date, then the publish day
  assert.equal(duplicateTitleDateSuffix("https://x.com/a WWE RAW review", "عرض يوم 9 نوفمبر الماضي", "2026-11-10T06:41:16.406Z"), "9 نوفمبر");
  assert.equal(duplicateTitleDateSuffix("https://x.com/a WWE RAW review", "بلا تاريخ", "2026-11-10T06:41:16.406Z"), "10 نوفمبر");
  assert.deepEqual(sourceShowMonthDay("WWE RAW 11/9/2026: things", true), { m: 10, d: 9 });
  assert.equal(sourceShowMonthDay("WWE RAW 11/9/2026: things"), null);
});

test("#1204: «فريقيهما» and «الزميلان» are blocked as dual forms; common ones are corrected", () => {
  for (const s of ["رفض رودز وميستيريو انضمام دومينيك ميستيريو إلى فريقيهما", "ليتواجه الزميلان الجديدان يوم 28 نوفمبر", "خلاف بين الزميلين"]) {
    const codes = checkArticle("بينتا وجيفون إيفانز في عرض WWE Survivor Series", s + "." + filler, []).map(i => i.code);
    assert.ok(codes.includes("dual_form"), s);
  }
  const ok = checkArticle("بينتا وجيفون إيفانز في عرض WWE Survivor Series", "ليتواجه بينتا وإيفانز وجها لوجه يوم 28 نوفمبر." + filler, []).map(i => i.code);
  assert.ok(!ok.includes("dual_form"));
  assert.equal(applyCorrections("دافع الفريق عن لقبيهما بنجاح"), "دافع الفريق عن لقبهم بنجاح");
});
