import test from "node:test";
import assert from "node:assert/strict";
import { fixCountDuals, applyCorrections, checkArticle } from "../scripts/news-qa.ts";

// INCIDENTS #1234: Mercedes Moné's sister «left behind two young children» → «طفلين صغيرين» was refused every retry
test("indefinite dual people nouns become «اثنين من …»", () => {
  assert.equal(fixCountDuals("تركت خلفها طفلين صغيرين."), "تركت خلفها اثنين من الأطفال الصغار.");
  assert.equal(fixCountDuals("ولديها طفلان"), "ولديها اثنان من الأطفال");
  assert.equal(fixCountDuals("مع نجمين آخرين"), "مع اثنين من النجوم الآخرين");
  assert.equal(fixCountDuals("وطفلين"), "واثنين من الأطفال");
  assert.equal(fixCountDuals("الطفلين"), "الطفلين");
  assert.equal(fixCountDuals("طفليها"), "طفليها");
  const once = fixCountDuals("تركت طفلين صغيرين");
  assert.equal(fixCountDuals(once), once);
});

test("the corrected story passes the dual_noun check", () => {
  const body = applyCorrections("قالت ميرسيدس موني إن شقيقتها تركت خلفها طفلين صغيرين.");
  const issues = checkArticle("ميرسيدس موني تتذكر شقيقتها", body, []);
  assert.ok(!issues.some((i) => i.code === "dual_noun"), JSON.stringify(issues));
});
