import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { checkArticle, BLOCKING_QA_CODES } from "../scripts/news-qa.ts";

const has = (body: string) => checkArticle("نتائج عرض WWE NXT Live (7 نوفمبر 2026): فوز شايلو هيل", body, []).some(i => i.code === "mixed_verb_gender");

// INCIDENTS #1150: «واستطاع إي كي بروسبر حسم المواجهة لصالحها» about a man.
test("a masculine verb with «لصالحها» for the same winner is blocked", () => {
  assert.ok(BLOCKING_QA_CODES.includes("mixed_verb_gender"));
  assert.ok(has("تواجه إي كي بروسبر مع كام هيندريكس واستطاع إي كي بروسبر حسم المواجهة لصالحها."));
  assert.ok(has("ونجح الثنائي في إنهاء النزال لصالحها بسرعة."));
  assert.ok(has("ونجحت زاريا في حسم المواجهة لصالحه."));
});

test("right agreement passes", () => {
  assert.ok(!has("واجه إي كي بروسبر منافسه كام هيندريكس واستطاع حسم المواجهة لصالحه."));
  assert.ok(!has("ونجح الثنائي في إنهاء النزال لصالحه بسرعة."));
  assert.ok(!has("واستطاعت زاريا حسم المواجهة لصالحها."));
  assert.ok(!has("نجح في الهجوم، وحسمت هي المواجهة لصالحها."));
});

test("no published Arabic story has the mismatch", () => {
  const bad: string[] = [];
  for (const f of fs.readdirSync("content/news")) {
    const t = fs.readFileSync(`content/news/${f}`, "utf8").split(/^---$/m).slice(2).join("---");
    if (t.includes("لصالح") && has(t)) bad.push(f);
  }
  assert.deepEqual(bad, []);
});
