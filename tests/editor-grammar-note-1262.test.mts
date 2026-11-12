import { test } from "node:test";
import assert from "node:assert/strict";
import { checkArticle } from "../scripts/news-qa.ts";
import { editIsAnImprovement } from "../scripts/editorial.ts";
import { applyCorrections } from "../scripts/news-qa.ts";

const pad = " نص عربي إضافي للفحص فقط.".repeat(20);
const codes = (title: string, body: string) => checkArticle(title, body + pad, []).map(i => i.code);

test("#1262: a grammar note written into the story blocks publishing", () => {
  const body = "قاطعتها ليرا فالكيريا مؤكدة أنها لا تحب مصارعات مثل سول روكا أو لولا فايس اللاتي يحصلن على الفرص بسهولة أو تكرار الاسم حسب قواعد جمع المؤنث والمثنى بحسب وصفها.";
  assert.ok(codes("ليرا فالكيريا تهاجم سول روكا في الكواليس", body).includes("editor_note"));
});

test("#1262: the copy editor may not add a grammar note to a sentence", () => {
  assert.equal(editIsAnImprovement("اللتين تحصلان على الفرص بسهولة", "اللتي يحصلن على الفرص بسهولة أو تكرار الاسم حسب قواعد جمع المؤنث والمثنى"), false);
});

test("#1262: normal stories are not flagged", () => {
  const body = "ردت سول روكا بأنها مرت بأوقات صعبة أيضا دون أن تلقي اللوم على الآخرين، ثم تحدت فالكيريا لحسم الخلاف داخل الحلبة. وتجمع المصارعات في عرض RAW حسب جدول الاتحاد.";
  assert.ok(!codes("سول روكا تتحدى ليرا فالكيريا", body).includes("editor_note"));
});

test("#1262: «اللتي» is corrected to «اللاتي»", () => {
  assert.match(applyCorrections("مصارعات اللتي يحصلن على الفرص"), /اللاتي يحصلن/);
});

test("#1262: «بيداي» after a preposition is corrected to «بيدي»", () => {
  assert.match(applyCorrections("وأنا ألوح بيداي للجمهور"), /ألوح بيدي/);
});
