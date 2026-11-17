import { test } from "node:test";
import assert from "node:assert/strict";
import { applyCorrections } from "../scripts/news-qa.ts";

// INCIDENTS #1386: the reporter's name is scrubbed to «تقارير صحفية», leaving
// «أوضح تقارير صحفية مطلعة عبر حسابه أن» — a masculine verb and «his account».
test("scrubbed reporter keeps a sound sentence; انتهى spelled right", () => {
  assert.equal(
    applyCorrections("وفي هذا السياق، أوضح تقارير صحفية مطلعة عبر حسابه أن مصدرا في AEW أكد"),
    "وفي هذا السياق، أفادت تقارير صحفية مطلعة بأن مصدرا في AEW أكد",
  );
  assert.equal(applyCorrections("وأكد تقارير صحفية عبر حسابه على منصة إكس بأن الخبر صحيح"), "وأفادت تقارير صحفية مطلعة بأن الخبر صحيح");
  assert.equal(applyCorrections("وانتهي الأمر بتقديم أول نزال"), "وانتهى الأمر بتقديم أول نزال");
  assert.equal(applyCorrections("أوضح سيث رولينز عبر حسابه أن"), "أوضح سيث رولينز عبر حسابه أن");
});
