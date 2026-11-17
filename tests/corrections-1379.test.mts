import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

// INCIDENTS #1379: «وأضاف أنغل مازحا إنه», «حركة الأنسلوك», «إليميشن تشامبر», «انتقل إلى المحترفين» reached stories.
test("«أضاف … مازحا إنه», Ankle Lock, Elimination Chamber and «انتقل إلى المحترفين» are corrected", async () => {
  const { applyCorrections } = await import("../scripts/news-qa");
  assert.equal(applyCorrections("وأضاف أنغل مازحا إنه يريد ذلك"), "وأضاف أنغل مازحا أنه يريد ذلك");
  assert.equal(applyCorrections("ليضيف مازحا إنه يراه"), "ليضيف مازحا أنه يراه");
  assert.equal(applyCorrections("قال مازحا إنه لا يعتقد"), "قال مازحا إنه لا يعتقد");
  assert.equal(applyCorrections("تطبيق حركة الأنسلوك عليها"), "تطبيق حركة Ankle Lock عليها");
  assert.equal(applyCorrections("فهناك إليميشن تشامبر"), "فهناك Elimination Chamber");
  assert.equal(applyCorrections("منذ أن انتقل إلى المحترفين عام 2014"), "منذ أن انتقل إلى المصارعة عام 2014");
  const bad = fs.readdirSync("content/news").filter(f => f.endsWith(".md") &&
    /(?:أضاف|يضيف)\S*\s+(?:\S+\s+){0,3}?مازح(?:ا|ة)\s+إن|الأنسلوك|إليميشن تشامبر|انتقل إلى المحترفين/.test(fs.readFileSync(`content/news/${f}`, "utf-8")));
  assert.deepEqual(bad, []);
});
