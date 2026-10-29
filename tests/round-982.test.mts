import { test } from "node:test";
import assert from "node:assert/strict";
import { checkArticle, applyCorrections, titleChampionsWithoutName, BLOCKING_QA_CODES } from "../scripts/news-qa.ts";

// INCIDENTS #982 — «أبطال AEW العالمي للفرق: …» named the speakers by their title only.
test("a headline that names the speaker only by his title is blocked", () => {
  assert.ok(titleChampionsWithoutName("أبطال AEW العالمي للفرق: توني خان لا ينال ما يكفي من الثناء"));
  assert.ok(titleChampionsWithoutName("بطلة WWE للسيدات: أنا جاهزة"));
  assert.equal(titleChampionsWithoutName("ذا يانغ باكس: توني خان لا ينال ما يكفي من الثناء"), null);
  assert.equal(titleChampionsWithoutName("بطل WWE كودي رودز: أنا جاهز"), null);
  assert.equal(titleChampionsWithoutName("نتائج عرض WWE RAW (26 أكتوبر 2026): مواجهة نارية"), null);
  const issues = checkArticle("أبطال AEW العالمي للفرق: توني خان لا ينال ما يكفي من الثناء", "نص الخبر.");
  assert.ok(issues.some(i => i.code === "title_champions_no_name"));
  assert.ok(BLOCKING_QA_CODES.includes("title_champions_no_name"));
});

// INCIDENTS #982 — «تغلبت الفريق المكون من…» and Stardom names written wrong.
test("feminine verb before «الفريق» and the Stardom names are corrected", () => {
  assert.equal(applyCorrections("تغلبت الفريق المكون من ساوري أنو"), "تغلب الفريق المكون من ساوري أنو");
  assert.equal(applyCorrections("وفازت الثنائي على"), "وفاز الثنائي على");
  assert.equal(applyCorrections("تغلبت على فريق God's Eye"), "تغلبت على فريق God's Eye");
  assert.equal(applyCorrections("تغلبت سوزو سوزوكي"), "تغلبت سوزو سوزوكي");
  assert.equal(applyCorrections("سايا كورارا وأومي صوهري ويون ميزوموري"), "ساياكا كورارا وآمي سوهري ويونا ميزوموري");
});

// INCIDENTS #982 — the owner deleted an Arabic story from the panel; its English pair answered 404.
test("an English story whose Arabic story was deleted redirects to the English news page", async () => {
  const fs = await import("node:fs");
  const os = await import("node:os");
  const path = await import("node:path");
  const { createRequire } = await import("node:module");
  const { orphanEnglishRedirects } = createRequire(import.meta.url)("../lib/redirects.cjs");
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "orphan-"));
  fs.mkdirSync(path.join(root, "news")); fs.mkdirSync(path.join(root, "news-en"));
  fs.writeFileSync(path.join(root, "news", "a.md"), "---\nsource_id: 1\n---\n");
  fs.writeFileSync(path.join(root, "news-en", "a.md"), "---\nslug: \"kept\"\nsource_id: 1\n---\n");
  fs.writeFileSync(path.join(root, "news-en", "b.md"), "---\nslug: \"gone\"\nsource_id: 2\n---\n");
  assert.deepEqual(orphanEnglishRedirects(root, path.join(root, "_site"), path.join(root, "_redirects")), [["/en/news/gone/", "/en/news/"]]);
  assert.match(fs.readFileSync("eleventy.config.js", "utf-8"), /orphanEnglishRedirects\(\)/);
});
