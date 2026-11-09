import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

// INCIDENTS #1144: «NJPW G1 Climax 36 - Final (2016)» for a show of 16.08.2026 — the year typed in the title became
// the page address (/shows/njpw-g1-climax-36-final-2016/), and Google never took that page in three months.
// A show or recap whose title carries a year must carry its own event year.
test("every show/recap title year matches its event_date year", () => {
  const bad: string[] = [];
  for (const section of ["shows", "recaps"]) {
    const dir = path.join("content", section);
    if (!fs.existsSync(dir)) continue;
    for (const f of fs.readdirSync(dir).filter((x) => x.endsWith(".md"))) {
      const text = fs.readFileSync(path.join(dir, f), "utf-8");
      const fm = text.split(/^---\s*$/m)[1] || "";
      const title = (fm.match(/^title:\s*["']?(.+?)["']?\s*$/m) || [])[1] || "";
      const year = (fm.match(/^event_date:\s*["']?(\d{4})-/m) || [])[1];
      if (!year) continue;
      const years = [...new Set(title.match(/\b(?:19|20)\d{2}\b/g) || [])];
      if (years.some((y) => y !== year)) bad.push(`${section}/${f}: «${title}» (event ${year})`);
    }
  }
  assert.deepEqual(bad, []);
});
