import test from "node:test";
import assert from "node:assert/strict";

// INCIDENTS #1179: #1177 turned «عرض جون سينا الكلاسيكية» into «بطولة…» but left the masculine verb after it.
test("verbs after «بطولة جون سينا الكلاسيكية» agree with the feminine name", async () => {
  const { applyCorrections } = await import("../scripts/news-qa");
  assert.equal(applyCorrections("أوضح سينا أن عرض جون سينا الكلاسيكية يهدف إلى إبراز الجيل القادم"), "أوضح سينا أن بطولة جون سينا الكلاسيكية تهدف إلى إبراز الجيل القادم");
  assert.equal(applyCorrections("يذكر أن بطولة جون سينا الكلاسيكية سيقام يوم 14 ديسمبر"), "يذكر أن بطولة جون سينا الكلاسيكية ستقام يوم 14 ديسمبر");
  assert.equal(applyCorrections("بطولة جون سينا الكلاسيكية الذي يقام في أورلاندو"), "بطولة جون سينا الكلاسيكية التي يقام في أورلاندو");
  // already right stays as it is
  assert.equal(applyCorrections("بطولة جون سينا الكلاسيكية ستقام"), "بطولة جون سينا الكلاسيكية ستقام");
});

test("a three-hour Dynamite/Collision is the joint show, not «الثلاثي»", async () => {
  const { applyCorrections } = await import("../scripts/news-qa");
  assert.equal(applyCorrections("ضمن عرض AEW Dynamite وAEW Collision الثلاثي"), "ضمن عرض AEW Dynamite وAEW Collision المشترك");
  // the trios title is untouched
  assert.equal(applyCorrections("بطولة AEW للفرق الثلاثية"), "بطولة AEW للفرق الثلاثية");
  assert.equal(applyCorrections("أن تكون دماء الآخرين أكثر من دماء نفسي"), "أن تكون دماء الآخرين أكثر من دمائي");
});

test("«Will Ospersay» is fixed to Will Ospreay in the English edition", async () => {
  const { fixEnglishNames } = await import("../scripts/english-edition");
  assert.equal(fixEnglishNames("by threatening Will Ospersay with a screwdriver"), "by threatening Will Ospreay with a screwdriver");
  assert.equal(fixEnglishNames("Will Osprey and Will Ospreay"), "Will Ospreay and Will Ospreay");
});
