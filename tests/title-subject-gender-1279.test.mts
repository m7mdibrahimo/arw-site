import { test } from "node:test";
import assert from "node:assert/strict";
import { fixTitleSubjectGender, autoFix, applyCorrections } from "../scripts/news-qa.ts";

// INCIDENTS #1279: «بروس بريتشارد تطالب الجماهير…» went live while the body spoke of him with masculine verbs.
test("a man's name opening the title gets a masculine verb", () => {
  const body = "أعرب بروس بريتشارد، المسؤول التنفيذي المخضرم في اتحاد WWE، عن استيائه. وقال بريتشارد في رسالته: «اهدأوا».";
  assert.equal(fixTitleSubjectGender("بروس بريتشارد تطالب الجماهير بالهدوء", body), "بروس بريتشارد يطالب الجماهير بالهدوء");
  assert.equal(fixTitleSubjectGender("كودي رودز تتحدث عن رومان رينز", "قال كودي رودز إن…"), "كودي رودز يتحدث عن رومان رينز");
});

test("a woman's title verb and ambiguous verbs stay", () => {
  assert.equal(fixTitleSubjectGender("أليكسا بليس تكشف تفاصيل اللحظة", "تحدثت المصارعة أليكسا بليس عن موقف عصيب"), "أليكسا بليس تكشف تفاصيل اللحظة");
  assert.equal(fixTitleSubjectGender("أليكسا بليس تكشف تفاصيل اللحظة", "أوضحت أليكسا أن ابنتها…"), "أليكسا بليس تكشف تفاصيل اللحظة");
  // «تحدث» can be a masculine past tense: never touched
  assert.equal(fixTitleSubjectGender("كودي رودز تحدث عن رينز", "قال كودي رودز"), "كودي رودز تحدث عن رينز");
  // no evidence about the subject in the body: left alone
  assert.equal(fixTitleSubjectGender("ريا ريبلي تطالب بفرصة", "في عرض RAW الأخير"), "ريا ريبلي تطالب بفرصة");
});

test("«أهتال» is pounds, a decimal degree count is «درجة», a trio is masculine", () => {
  assert.match(applyCorrections("التخلص من ثمانية أهتال من السوائل"), /ثمانية أرطال/);
  assert.match(autoFix("حمى وصلت إلى نحو 103.7 درجات"), /103\.7 درجة/);
  assert.match(applyCorrections("التقت ثلاثي شارلوت فلير"), /التقى ثلاثي/);
});

test("a surname that looks like a verb is never changed («جاسبر تروي يكشف»)", () => {
  assert.equal(fixTitleSubjectGender("جاسبر تروي يكشف تفاصيل إحباطه", "كشف جاسبر تروي عن إحباطه"), "جاسبر تروي يكشف تفاصيل إحباطه");
});
