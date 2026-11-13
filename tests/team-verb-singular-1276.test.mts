import { test } from "node:test";
import assert from "node:assert/strict";
import { autoFix, teamVerbSingular } from "../scripts/news-qa.ts";

test("«فريق X قد حققوا» → «حقق» (INCIDENTS #1276)", () => {
  assert.equal(teamVerbSingular("يذكر أن فريق بوم آند دوم (Boom & Doom) قد حققوا الفوز على فريق آر بي جي فايس"),
    "يذكر أن فريق بوم آند دوم (Boom & Doom) قد حقق الفوز على فريق آر بي جي فايس");
  assert.equal(teamVerbSingular("وكان فريق ذا نيو ليفل قد نجحوا في الوصول"), "وكان فريق ذا نيو ليفل قد نجح في الوصول");
  assert.match(autoFix("فريق ذا ريفايفال فازوا بالألقاب."), /فريق ذا ريفايفال فاز بالألقاب/);
});

test("plural subjects keep the plural verb", () => {
  for (const s of [
    "أعضاء فريق ذا جادجمنت داي فازوا بالنزال",
    "فريق ذا ريفايفال وزميلهم داش فازوا بالنزال",
    "فريق ذا ريفايفال مع آدم كول فازوا",
    "الفريق قد حققوا الفوز",
  ]) assert.equal(teamVerbSingular(s), s);
});
