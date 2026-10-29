import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { checkArticle, BLOCKING_QA_CODES, RETRYABLE_QA_CODES } from "../scripts/news-qa.ts";

const title = "بول هايمن يعترف بحاجته إلى العلاج النفسي لكنه يؤكد أن مشاكله الشخصية صنعت نجاحه";
const rest = "\n\nخلال حواره مع غراهام بينسينغر، سئل هايمن عما إذا كان قد تعامل مع مشاكله الشخصية عبر العلاج، فكانت إجابته بالنفي، مؤكدا أن تلك المشاكل ساعدته في بناء مسيرته داخل WWE.";

test("«لكن لا يتوقع أحد أن…» (don't expect him to…) is blocked (Heyman story, INCIDENTS #986)", () => {
  const bad = checkArticle(title, "يعترف بول هايمن بأنه بحاجة إلى العلاج النفسي، لكن لا يتوقع أحد أن يزور طبيبا قريبا." + rest);
  assert.ok(bad.some((i) => i.code === "dont_expect_literal"));
  const ok = checkArticle(title, "يعترف بول هايمن بأنه بحاجة إلى العلاج النفسي، لكنه لا ينوي زيارة طبيب نفسي في وقت قريب." + rest);
  assert.ok(!ok.some((i) => i.code === "dont_expect_literal"));
  assert.ok(BLOCKING_QA_CODES.includes("dont_expect_literal") && RETRYABLE_QA_CODES.includes("dont_expect_literal"));
  assert.match(fs.readFileSync("editorial/style-guide.md", "utf8"), /«الرجل الحكيم» \(The Wise Man\)/);
});

test("no published Arabic story keeps «لكن لا يتوقع أحد أن»", () => {
  const bad = fs.readdirSync("content/news").filter((f) => f.endsWith(".md") && /لكن(?:ه)?\s+لا\s+(?:يتوقع|تتوقع|ينتظر)\s+أحد\s+أن/.test(fs.readFileSync(`content/news/${f}`, "utf8")));
  assert.deepEqual(bad, []);
});
