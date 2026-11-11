import test from "node:test";
import assert from "node:assert/strict";
import { metaDescription } from "../lib/meta-description.cjs";
import { applyCorrections } from "../scripts/news-qa.ts";
import { ENGLISH_FIXES } from "../scripts/english-edition.ts";

const en = (s: string) => ENGLISH_FIXES.reduce((t, [re, to]) => t.replace(re, to), s);

test("a team named «Fly Def» is not turned into «Defeats» (INCIDENTS #1229)", () => {
  assert.equal(en("Royal Prestige def. Fly Def. Adrian Thomas won the match."), "Royal Prestige def. Fly Def. Adrian Thomas won the match.");
  assert.equal(en("Kaia McKenna Def. Corinne Joy"), "Kaia McKenna Defeats Corinne Joy");
});

test("a description never stops on «def.» (INCIDENTS #1229)", () => {
  const d = metaDescription("Pro Wrestling Symphony held its Heroes & Villains Vol. 2 show on November 7 at Station Camp High School in Gallatin, Tennessee. Colby Carter def. Jamesen Shook in the opening match of the night and then much more happened on the card.");
  assert.ok(!/\bdef\.$/.test(d), d);
});

test("a description keeps both names of a pair (INCIDENTS #1229)", () => {
  const d = metaDescription('Brad Baylor and Ricky Smokes of Vanity Project successfully defended their Tag Team Championship against Hank Walker and Tank Ledger during the latest episode of "WWE NXT." Hank and Tank were named as the replacement challengers.');
  assert.match(d, /Hank Walker and Tank Ledger/);
});

test("a description is not only the scene of the show (INCIDENTS #1229)", () => {
  const d = metaDescription("On the November 10, 2026, episode of WWE NXT, live from the WWE Performance Center in Orlando, Florida, the show opened with Grayson Waller discussing his recent victory over CM Punk. Shiloh Hill interrupted him.");
  assert.match(d, /the show opened with Grayson Waller/);
});

test("Arabic wording of #1229 is corrected", () => {
  assert.equal(applyCorrections("في مدرسة ستيشن كامب العالية بمدينة غالاتين"), "في مدرسة ستيشن كامب الثانوية بمدينة غالاتين");
  assert.equal(applyCorrections("أمام متحدين مفاجئين"), "أمام منافسين مفاجئين");
  assert.equal(applyCorrections("ضغط المتحدون"), "ضغط المنافسون");
  assert.equal(applyCorrections("ببطولة جيريكو كروز أوشيانيك"), "ببطولة Jericho Cruise Oceanic");
  assert.equal(applyCorrections("نزال غاونتلي للمنافسة"), "نزال Gauntlet للمنافسة");
  assert.equal(applyCorrections("نزال كازينو غاونتليت"), "نزال Casino Gauntlet");
  assert.equal(applyCorrections("الولايات المتحدة"), "الولايات المتحدة");
});
