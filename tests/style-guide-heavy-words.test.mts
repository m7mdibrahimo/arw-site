import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

test("style guide bans heavy headline words that reached the site (INCIDENTS #578)", () => {
  const guide = fs.readFileSync("editorial/style-guide.md", "utf-8");
  assert.ok(guide.includes("يسترجع"));
  assert.ok(guide.includes("تصنع"));
});

test("«الظفر/يظفر» becomes «الفوز/يفوز» in every story, title and text (owner 2026-10-16, INCIDENTS #623)", async () => {
  // «درو ماكنتاير يلمح إلى خططه للظفر ببطولة العالم…» — «مش مفهوم خالص زي كلمة للظفر»
  const { applyCorrections } = await import("../scripts/news-qa.ts");
  assert.equal(applyCorrections("خطته للظفر بلقب العالم"), "خطته للفوز بلقب العالم");
  assert.equal(applyCorrections("يهزم تاكيشيتا ليظفر ببطولة NJPW"), "يهزم تاكيشيتا ليفوز ببطولة NJPW");
  assert.equal(applyCorrections("استغل خبرته ليظفر بالفوز"), "استغل خبرته ليحقق الفوز");
  assert.equal(applyCorrections("حسم النزال والظفر بالبطولة"), "حسم النزال والفوز بالبطولة");
  assert.equal(applyCorrections("حيث ستظفر المنتصرة بفرصة"), "حيث ستفوز المنتصرة بفرصة");
  assert.ok(fs.readFileSync("editorial/style-guide.md", "utf-8").includes("«الظفر/يظفر» ممنوعة"));
  for (const f of fs.readdirSync("content/news").filter(f => f.endsWith(".md"))) {
    const s = fs.readFileSync(`content/news/${f}`, "utf-8").replace(/^permalink: .*$/m, "");
    assert.doesNotMatch(s, /(?<![ء-ي])(?:[وفبلك]|ال|لل|س)?[يت]?ظفر/, f);
  }
});

test("results reports name every team member and the pinned wrestler, not a pronoun (RAW 19-10-2026 story)", () => {
  const guide = fs.readFileSync("editorial/style-guide.md", "utf-8");
  assert.ok(guide.includes("اذكر كل أعضاء الفريقين"));
  assert.ok(guide.includes("اسم المثبَّت بدل الضمير"));
});

test("style guide: «الماضي» only when the source says «last <day>» (INCIDENTS #734)", () => {
  const guide = fs.readFileSync("editorial/style-guide.md", "utf-8");
  assert.ok(guide.includes("يوم الثلاثاء الماضي"));
  assert.ok(guide.includes("last Tuesday"));
});

test("«iestرجع» becomes «يتذكر/يكشف» in every story (INCIDENTS #871)", async () => {
  const { applyCorrections } = await import("../scripts/news-qa.ts");
  assert.equal(applyCorrections("بينتا يسترجع ذكريات مواجهة رومان"), "بينتا يتذكر مواجهة رومان");
  assert.equal(applyCorrections("ويل أوسبراي يسترجع كواليس شجار"), "ويل أوسبراي يكشف كواليس شجار");
  assert.equal(applyCorrections("ديفيد فينلي يسترجع طموحاته السابقة"), "ديفيد فينلي يتذكر طموحاته السابقة");
  for (const f of fs.readdirSync("content/news").filter(f => f.endsWith(".md"))) {
    // social_spoiler_note is the bot's internal note for the social scheduler (never shown, never edited): only the story counts (INCIDENTS #938)
    const s = fs.readFileSync(`content/news/${f}`, "utf-8").replace(/^permalink: .*$/m, "").replace(/^social_[a-z_]+: .*$/gm, "");
    assert.doesNotMatch(s, /يسترجع/, f);
  }
});

test("two things never take the plural pronoun «هم» (INCIDENTS #875: «أغنيتين … وأحبهم بنفس القدر»)", () => {
  const guide = fs.readFileSync("editorial/style-guide.md", "utf-8");
  const prompt = fs.readFileSync("scripts/fightful-watcher.ts", "utf-8");
  assert.ok(guide.includes("متجمعش الضمير «هم/هن»"));
  assert.ok(prompt.includes("متجمعش الضمير «هم/هن»"));
  for (const f of fs.readdirSync("content/news").filter(f => f.endsWith(".md"))) {
    const s = fs.readFileSync(`content/news/${f}`, "utf-8").replace(/^permalink: .*$/m, "");
    assert.doesNotMatch(s, /(?:أغنيتين|نزالين|فيديوين)[^.\n]{0,40}أ?حبهم/, f);
    assert.doesNotMatch(s, /كلتا الأغنيتين/, f);
  }
});
