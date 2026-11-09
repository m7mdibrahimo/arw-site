import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const glossary = JSON.parse(fs.readFileSync("scripts/wrestler-names.json", "utf-8")) as Record<string, string>;

// INCIDENTS #1176: «يملك مصارع WWE مات كاردونا…» — the source tied WWE only to his wife Chelsea Green.
test("a promotion label glued to a wrestler must come from the source near that wrestler", async () => {
  const { promotionLabelNotInSource } = await import("../scripts/news-qa");
  const source = "Matt Cardona has built an impressive wrestling and pop culture collection, revealing his five most valuable trading cards. " +
    "For number four, he featured a card of his wife, Chelsea Green, worth $1,098. Chelsea Green has been a fixture on WWE television for years now. " +
    "Topping the list is a 1999 Topps WCW Macho Man Randy Savage autograph card worth $15,082.";
  assert.deepEqual(promotionLabelNotInSource("يملك مصارع WWE مات كاردونا مجموعة ضخمة", source, glossary), ["WWE مات كاردونا"]);
  assert.deepEqual(promotionLabelNotInSource("يملك المصارع مات كاردونا مجموعة ضخمة", source, glossary), []);
  // a label the source does give stays allowed
  const src2 = "WWE star Cody Rhodes was announced for the event alongside many others from the main roster and NXT, according to a release on Monday. ".repeat(2);
  assert.deepEqual(promotionLabelNotInSource("أعلن مصارع WWE كودي رودز", src2, glossary), []);
});

test("#1176 names and corrections are in place", () => {
  assert.equal(glossary["Mick McManus"], "ميك ماكمانوس");
  const corrections = JSON.parse(fs.readFileSync("editorial/corrections.json", "utf-8")).corrections as { wrong: string; right: string }[];
  assert.ok(corrections.some(c => c.wrong === "ميك مكمان" && c.right === "ميك ماكمانوس"));
  assert.ok(corrections.some(c => c.wrong === "نزاهرين"));
});

// INCIDENTS #1177: «نزاعين رباعيين» (dispute, not match), «لم تحدد موعد», «نزالات العرض الأربع», «عرض جون سينا الكلاسيكية».
test("#1177 wording mistakes are corrected automatically", async () => {
  const { applyCorrections } = await import("../scripts/news-qa");
  assert.equal(applyCorrections("البطولة التي تشهد إقامة نزاعين رباعيين"), "البطولة التي تشهد إقامة نزالات رباعية");
  assert.equal(applyCorrections("لم تحدد موعد رسمي جديد"), "لم يحدد موعد رسمي جديد");
  assert.equal(applyCorrections("الاكتفاء بنزالات العرض الأربع."), "الاكتفاء بنزالات العرض الأربعة.");
  assert.equal(applyCorrections("يهدف عرض جون سينا الكلاسيكية إلى"), "يهدف بطولة جون سينا الكلاسيكية إلى");
  // «النزالات الخمس نجوم» (five-star matches) must stay as it is
  assert.equal(applyCorrections("المهووس بالنزالات الخمس نجوم"), "المهووس بالنزالات الخمس نجوم");
  const bad = fs.readdirSync("content/news").filter(f => f.endsWith(".md") &&
    /نزاعين رباعيين|عرض جون سينا الكلاسيكية|لم تحدد موعد /.test(fs.readFileSync(`content/news/${f}`, "utf-8")));
  assert.deepEqual(bad, []);
});

// INCIDENTS #1178: UFC Fight Night 293 was described as «من عروض المصارعة الحرة» and never named by its number.
test("an MMA card names its own category and its number in the head", async () => {
  const { showSeoText, showNameForms } = await import("../lib/show-seo.cjs");
  const args = { headline: "عرض يو اف سي فايت نايت 07.11.2026 مترجم", title: "UFC Fight Night 293: Cortes Acosta vs Walker",
    programName: "UFC Fight Night", eventDate: "2026-11-07", day: "7 نوفمبر 2026", isLatest: true,
    description: "عرض يو اف سي فايت نايت مترجم بالكامل مع جميع النزالات والأحداث." };
  const seo = showSeoText(args);
  assert.ok(!/المصارعة الحرة/.test(seo.description), seo.description);
  assert.match(seo.description, /الفنون القتالية المختلطة/);
  const forms = showNameForms({ ...args, aliases: ["عرض يو اف سي فايت نايت"], isShow: true });
  for (const f of ["UFC Fight Night 293", "يو اف سي فايت نايت 293", "عرض يو اف سي فايت نايت 293 مترجم"]) assert.ok(forms.includes(f), f);
  // a wrestling show keeps its category
  const raw = showSeoText({ headline: "عرض داينامايت 04.11.2026 مترجم", title: "AEW Dynamite 04.11.2026", programName: "AEW Dynamite",
    eventDate: "2026-11-04", day: "4 نوفمبر 2026", isLatest: false, description: "" });
  assert.match(raw.description, /من عروض المصارعة الحرة المترجمة/);
});
