import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { checkArticle, BLOCKING_QA_CODES, RETRYABLE_QA_CODES, fixElijahAsIlya, applyCorrections } from "../scripts/news-qa";
import { showResultsKey, findSameShowResults } from "../scripts/fightful-watcher";

test("#1274: «TNA Thursday Night Impact» (Wrestling Inc) and «TNA iMPACT!» (Fightful) are the same show", () => {
  const wi = showResultsKey("TNA Thursday Night Impact Results 11/12/26 W/ Live Updates: Elijah Vs. Nic Nemeth");
  const ff = showResultsKey("TNA iMPACT! Results (11/12): Nic Nemeth, Elijah, Moose Compete");
  assert.deepEqual(wi, ff);
  assert.equal(showResultsKey("WWE Friday Night SmackDown Results 11/13").name, showResultsKey("WWE SmackDown Results (11/13)").name);
  assert.equal(showResultsKey("WWE Monday Night Raw Results 11/9").name, showResultsKey("WWE Raw Results (11/9)").name);
  // «Saturday Night's Main Event» stays apart from the weekly «Main Event»
  assert.notEqual(showResultsKey("WWE Saturday Night's Main Event Results 11/1").name, showResultsKey("WWE Main Event Results 11/1").name);
});

test("#1274: the Fightful report finds the Wrestling Inc report already published", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "news-"));
  const date = new Date(Date.now() - 3600_000).toISOString();
  fs.writeFileSync(path.join(dir, "20261113020000-x.md"), `---\ntitle: "x"\ndate: ${date}\nsource_title: "TNA Thursday Night Impact Results 11/12/26 W/ Live Updates: Elijah Vs. Nic Nemeth"\n---\nbody\n`);
  assert.equal(findSameShowResults("TNA iMPACT! Results (11/12): Nic Nemeth, Elijah, Moose Compete", 30, dir).isDuplicate, true);
});

test("#1274: the same match block twice blocks publishing, even when it is short", () => {
  const body = [
    "بث اتحاد TNA أحدث عرض.",
    "**المواجهة الثالثة: نزال فردي**", "", "فاز موس على صامويل شو بالاستبعاد.", "", "🏆 **الفائز:** موس (بالاستبعاد)", "",
    "**المواجهة الرابعة: نزال فردي**", "", "فاز موس على صامويل شو بالاستبعاد.", "", "🏆 **الفائز:** موس (بالاستبعاد)", "",
    "**المواجهة الخامسة: نزال فردي**", "", "تغلب مصطفى علي على فرانكي كازاريان.", "", "🏆 **الفائز:** مصطفى علي",
  ].join("\n");
  const issues = checkArticle("نتائج عرض TNA iMPACT (12 نوفمبر 2026): فوز نيك نيميث", body, []);
  assert.ok(issues.some(i => i.code === "duplicate_match"));
  assert.ok(BLOCKING_QA_CODES.includes("duplicate_match") && RETRYABLE_QA_CODES.includes("duplicate_match"));
  const clean = body.replace(/\*\*المواجهة الرابعة[\s\S]*?(?=\*\*المواجهة الخامسة)/, "");
  assert.ok(!checkArticle("نتائج عرض TNA iMPACT (12 نوفمبر 2026): فوز نيك نيميث", clean, []).some(i => i.code === "duplicate_match"));
});

test("#1274: Elijah is «إلياس», not «إيليا»; Ilja Dragunov keeps «إيليا»", () => {
  assert.equal(fixElijahAsIlya("واجه نيك نيميث خصمه إيليا في نزال قوي", "Elijah Vs. Nic Nemeth"), "واجه نيك نيميث خصمه إلياس في نزال قوي");
  assert.equal(fixElijahAsIlya("وإيليا دراغونوف", "Elijah and Ilja Dragunov"), "وإيليا دراغونوف");
  assert.equal(fixElijahAsIlya("خصمه إيليا", "Ilja Dragunov wins"), "خصمه إيليا");
  assert.equal(fixElijahAsIlya("إيليا هوليفيلد", "Elijah Holyfield"), "إيليا هوليفيلد");
  assert.equal(applyCorrections("من صالة دوتان سيفيك سنتر"), "من صالة دوثان سيفيك سنتر");
});

test("#1274: no published story repeats a match block", () => {
  for (const dir of ["content/news"]) {
    for (const f of fs.readdirSync(dir).filter(f => /^20261113/.test(f))) {
      const s = fs.readFileSync(path.join(dir, f), "utf-8");
      const body = s.split(/^---$/m).slice(2).join("---");
      assert.ok(!checkArticle("", body, []).some(i => i.code === "duplicate_match"), f);
    }
  }
});
