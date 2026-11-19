import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

// INCIDENTS #1419: «باسترعاء بطولة» (Recapturing a title) and «ذا دنجرس ذا نيو ليفل» reached a story.
test("«استرعاء» before a title becomes «استعادة»; «استرعاء الاهتمام» stays", async () => {
  const { applyCorrections } = await import("../scripts/news-qa");
  assert.equal(applyCorrections("للاحتفال باسترعاء بطولة العالم للفرق الثلاثية"), "للاحتفال باستعادة بطولة العالم للفرق الثلاثية");
  assert.equal(applyCorrections("واسترعاء فكرة تغيير المظهر لاهتمامه"), "واسترعاء فكرة تغيير المظهر لاهتمامه");
  assert.equal(applyCorrections("سيعرفون باسم ذا دنجرس ذا نيو ليفل"), "سيعرفون باسم ذا دينجرس نيو ليفل");
  const bad = fs.readdirSync("content/news").filter(f => f.endsWith(".md") && /استرعاء\s+(?:بطولة|البطولة|لقب|اللقب)|دنجرس ذا نيو/.test(fs.readFileSync(`content/news/${f}`, "utf-8")));
  assert.deepEqual(bad, []);
});
