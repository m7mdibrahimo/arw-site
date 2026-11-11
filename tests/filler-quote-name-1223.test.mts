import { test } from "node:test";
import assert from "node:assert/strict";
import { applyCorrections, autoFix, dropFillerOpeners, splitGluedBlocks } from "../scripts/news-qa.ts";

test("#1223: filler phrases opening a sentence are removed", () => {
  assert.equal(dropFillerOpeners("تستعد ريو للعودة. وفي سياق متصل، نشر اتحاد WWE القائمة."), "تستعد ريو للعودة. نشر اتحاد WWE القائمة.");
  assert.equal(dropFillerOpeners("على صعيد آخر، يلتقي كول رادريك مع خصمه."), "يلتقي كول رادريك مع خصمه.");
  assert.equal(dropFillerOpeners("أول فقرة.\n\nوعلى صعيد آخر، كشف رولينز التفاصيل."), "أول فقرة.\n\nكشف رولينز التفاصيل.");
  assert.equal(autoFix("قال رولينز ذلك. ومن جهة أخرى، رد بانك."), "قال رولينز ذلك. رد بانك.");
});

test("#1223: the same words inside a sentence stay", () => {
  const s = "قال إن ما يحدث على صعيد آخر، يختلف تماما عن خططه.";
  assert.equal(dropFillerOpeners(s), s);
});

test("#1223: narration under a quote line is its own paragraph, quote lines stay together", () => {
  assert.equal(splitGluedBlocks('> "She\'s healthy."\nVaquer competed at three events.'), '> "She\'s healthy."\n\nVaquer competed at three events.');
  const two = '> "One."\n> "Two."\n\nNext paragraph.';
  assert.equal(splitGluedBlocks(two), two);
});

test("#1223: «بال/لال ايه نايت» keep the name readable", () => {
  assert.equal(applyCorrections("تشبيه جوش ألين بال ايه نايت"), "تشبيه جوش ألين بالمصارع ال ايه نايت");
  assert.equal(applyCorrections("دعم لال ايه نايت"), "دعم للمصارع ال ايه نايت");
  assert.equal(applyCorrections("رولينز وال ايه نايت"), "رولينز وال ايه نايت");
});
