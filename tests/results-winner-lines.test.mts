import test from "node:test";
import assert from "node:assert/strict";
import { winnerlessMatchSections } from "../scripts/fightful-watcher.ts";

// AEW Fright Night Dynamite 28/10: a live update kept six match headings and one «🏆 الفائز» line (INCIDENTS #956)
test("a results report whose match sections mostly lack a winner line is caught", () => {
  const sec = (h: string, w = "") => `**${h}**\n\nنص النزال.\n\n${w ? `🏆 **الفائز:** ${w}\n\n` : ""}`;
  const bad = sec("المواجهة الأولى: نزال فرق") + sec("المواجهة الثانية: نزال فردي") + sec("المواجهة الثالثة: نزال فرق") + sec("الحدث الرئيسي: نزال على بطولة TBS", "كوين أميناتا");
  assert.equal(winnerlessMatchSections(bad), true);
  const good = sec("المواجهة الأولى", "جاي وايت") + sec("المواجهة الثانية", "كايل فليتشر") + sec("الحدث الرئيسي", "كوين أميناتا");
  assert.equal(winnerlessMatchSections(good), false);
  // a short card with two sections is left alone
  assert.equal(winnerlessMatchSections(sec("المواجهة الأولى") + sec("المواجهة الثانية")), false);
});
