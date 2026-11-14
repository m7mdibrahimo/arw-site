import { test } from "node:test";
import assert from "node:assert/strict";
import { checkArticle, applyCorrections, BLOCKING_QA_CODES, RETRYABLE_QA_CODES } from "../scripts/news-qa.ts";

const BODY = "أعلن ري ميستيريو رسميا عن انضمام ري فينيكس إلى فريق المكسيك للمشاركة في العرض المرتقب في نهاية الشهر.";
const codes = (t: string, b = BODY) => checkArticle(t, b, []).map((i) => i.code);

test("a team member joining a team «لمواجهة» a show is blocked (INCIDENTS #1290)", () => {
  assert.ok(codes("ري فينيكس ينضم إلى فريق المكسيك لمواجهة WWE Survivor Series").includes("team_faces_show"));
  assert.ok(!codes("ري فينيكس ينضم إلى فريق المكسيك في عرض WWE Survivor Series").includes("team_faces_show"));
  // a show scheduled against a rival show is a real «مواجهة»
  assert.ok(!codes("سبب استعانة WWE بجون سينا في عرض WWE NXT لمواجهة عرض AEW Blood & Guts").includes("team_faces_show"));
  assert.ok(BLOCKING_QA_CODES.includes("team_faces_show") && RETRYABLE_QA_CODES.includes("team_faces_show"));
});

test("«مقعدان/مقعدين/مكانين» are dual nouns (INCIDENTS #1290)", () => {
  assert.ok(codes("ري فينيكس ينضم إلى فريق المكسيك", BODY + " لتتبقى مقعدان شاغران في قائمة كل فريق.").includes("dual_noun"));
  assert.ok(codes("حسم التأهل", BODY + " وحسم أول مقعدين في المربع الذهبي.").includes("dual_noun"));
  assert.ok(!codes("ري فينيكس ينضم إلى فريق المكسيك", BODY + " ليبقى في كل فريق مكان لاثنين آخرين.").includes("dual_noun"));
});

test("«يطالب الجماهير» stays masculine when a man is the subject (INCIDENTS #1279, #1290)", () => {
  assert.equal(applyCorrections("بروس بريتشارد يطالب الجماهير بالهدوء"), "بروس بريتشارد يطالب الجماهير بالهدوء");
  assert.equal(applyCorrections("وقال إن الأمر صعب. يطالب الجماهير بعودته"), "وقال إن الأمر صعب. تطالب الجماهير بعودته");
  assert.equal(applyCorrections("ويطالب الجماهير بعودته"), "وتطالب الجماهير بعودته");
  assert.equal(applyCorrections("وأوضح الباحث الصحفي برايان ألفاريز"), "وأوضح الصحفي برايان ألفاريز");
});
