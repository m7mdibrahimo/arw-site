import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { applyCorrections, checkArticle, BLOCKING_QA_CODES } from "../scripts/news-qa.ts";

// INCIDENTS #1322: «ونزال أناركي في الأ، مرورا» (Anarchy in the Arena cut), «فريق النيو ليفل», «شخصية موقعة», «لم تسبب لها أضرار بالغة»
test("a word cut after «ال» + one letter blocks the story", () => {
  const issues = checkArticle("عنوان عن عرض AEW Full Gear", "بدءا من نزال Texas Death ونزال أناركي في الأ، مرورا بتتويج بطلات جدد. ".repeat(3));
  const hit = issues.find(i => i.code === "truncated_word" && /ال/.test(i.message));
  assert.ok(hit, "truncated «الأ» not caught");
  assert.ok(BLOCKING_QA_CODES.includes("truncated_word"));
  const clean = checkArticle("عنوان عن عرض AEW Full Gear", "بدءا من نزال أناركي إن ذا أرينا، وألف مشجع والـ 20 دقيقة. ".repeat(3));
  assert.ok(!clean.some(i => i.code === "truncated_word" && /«ال»/.test(i.message)));
});

test("corrections fix the cut match name, the team name and the calques", () => {
  assert.equal(applyCorrections("ونزال أناركي في الأ، مرورا"), "ونزال أناركي إن ذا أرينا، مرورا");
  assert.equal(applyCorrections("وأناركي في الأرينا في نفس الليلة"), "وأناركي إن ذا أرينا في نفس الليلة");
  assert.equal(applyCorrections("ونزال أناركي إن ذا أرينا"), "ونزال أناركي إن ذا أرينا");
  assert.equal(applyCorrections("قدم فريق النيو ليفل نزالا"), "قدم فريق ذا نيو ليفل نزالا");
  assert.equal(applyCorrections("يسعدني أن أقول إن بيرسيفوني شخصية موقعة مع AEW"), "يسعدني أن أقول إن بيرسيفوني موقعة مع AEW");
  assert.equal(applyCorrections("الضربة لم تسبب لها أضرار بالغة"), "الضربة لم تسبب لها أضرارا بالغة");
});

test("no published story has the cut word or the calques", () => {
  const dir = path.join(import.meta.dirname, "..", "content", "news");
  for (const f of fs.readdirSync(dir).filter(n => n.endsWith(".md"))) {
    const body = fs.readFileSync(path.join(dir, f), "utf8").split(/^---$/m).slice(2).join("---");
    assert.ok(!/أناركي في الأ(?![ء-ي])|النيو ليفل|شخصية موقعة/.test(body), f);
  }
});
