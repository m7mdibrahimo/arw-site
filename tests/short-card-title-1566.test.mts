import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

test("#1566 the title prompt caps a match-list headline at 100 letters", () => {
  const src = fs.readFileSync(new URL("../scripts/fightful-watcher.ts", import.meta.url), "utf-8");
  assert.match(src, /استثناء قوائم النزالات \(عنوان قصير حتى 100 حرف\)/);
});

test("#1566 the fixed AEW story keeps its old address and a short title", () => {
  const dir = new URL("../content/news/", import.meta.url);
  const f = fs.readdirSync(dir).find((n) => n.startsWith("20261127074027-"));
  if (!f) return; // stories are deleted after 30 days
  const s = fs.readFileSync(new URL(f, dir), "utf-8");
  const title = s.match(/^title: "(.*)"$/m)![1];
  assert.ok(title.length <= 100, title);
  assert.ok(s.includes(`permalink: "/news/${f.slice(15, -3)}/index.html"`));
});
