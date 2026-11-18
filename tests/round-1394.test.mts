import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { checkArticle, applyCorrections } from "../scripts/news-qa.ts";

const body = "أعلن اتحاد WWE رسميا عن ثلاثة نزالات لعرض WWE NXT يوم 24 نوفمبر، تتضمن نزالا على بطولة أمريكا الشمالية للسيدات بين زاريا وإيزي دايم.";

test("a headline ending on a bare «على بطولة» is blocked (INCIDENTS #1394)", () => {
  const bad = "اتحاد WWE يعلن عن ثلاثة نزالات لعرض WWE NXT يوم 24 نوفمبر يتضمن نزالا على بطولة";
  assert.ok(checkArticle(bad, body).some((i) => i.code === "title_vague_topic"));
  const good = "اتحاد WWE يعلن عن ثلاثة نزالات لعرض WWE NXT يوم 24 نوفمبر بينها نزال على بطولة أمريكا الشمالية للسيدات";
  assert.ok(!checkArticle(good, body).some((i) => i.code === "title_vague_topic"));
});

test("«non-title match» written «نزال بدون عنوان» is corrected (INCIDENTS #1394)", () => {
  const out = applyCorrections("وكانت دايم قد تغلبت على زاريا في نزال بدون عنوان في عرض Halloween Havoc.");
  assert.match(out, /في نزال ليس على اللقب في عرض/);
  assert.ok(JSON.parse(readFileSync("editorial/corrections.json", "utf8")).corrections.length > 0);
});
