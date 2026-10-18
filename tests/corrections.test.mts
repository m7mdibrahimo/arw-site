import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

// INCIDENTS #566: «موجو بروكس» / «سيكوند موسمه» (English «second» transliterated) reached a story.
test("Mojo Brookzz is in the glossary and the transliterated «second» is corrected", () => {
  const glossary = JSON.parse(fs.readFileSync("scripts/wrestler-names.json", "utf-8")) as Record<string, string>;
  assert.equal(glossary["Mojo Brookzz"], "موجو بروكز");
  const corrections = JSON.parse(fs.readFileSync("editorial/corrections.json", "utf-8")).corrections as { wrong: string; right: string }[];
  assert.ok(corrections.some(c => c.wrong === "موجو بروكس" && c.right === "موجو بروكز"));
  assert.ok(corrections.some(c => c.wrong === "سيكوند موسمه الأخير"));
  const bad = fs.readdirSync("content/news").filter(f => f.endsWith(".md") && /موجو بروكس|سيكوند موسم/.test(fs.readFileSync(`content/news/${f}`, "utf-8").replace(/^permalink:.*$/m, "")));
  assert.deepEqual(bad, []);
});

// INCIDENTS #581: «كايتلين» vs «كيتلين» (Kaitlyn) and a doubled «لـ لعرض» reached stories.
test("Kaitlyn spelling and the doubled «لـ» are corrected", async () => {
  const { applyCorrections } = await import("../scripts/news-qa");
  const glossary = JSON.parse(fs.readFileSync("scripts/wrestler-names.json", "utf-8")) as Record<string, string>;
  assert.equal(glossary["Kaitlyn"], "كيتلين");
  assert.equal(applyCorrections("عودة كايتلين استعدادا لـ لعرض Destination X"), "عودة كيتلين استعدادا لعرض Destination X");
  const bad = fs.readdirSync("content/news").filter(f => f.endsWith(".md") && /كايتلين|لـ لعرض/.test(fs.readFileSync(`content/news/${f}`, "utf-8").replace(/^permalink:.*$/m, "")));
  assert.deepEqual(bad.filter(f => f.startsWith("2026101")), []);
});

test("Street Fight movie → Street Fighter in Arabic and English (INCIDENTS #589)", async () => {
  const { applyCorrections } = await import("../scripts/news-qa");
  assert.equal(applyCorrections("بطولة فيلم Street Fight الجديد"), "بطولة فيلم Street Fighter الجديد");
  const { fixEnglishNames } = await import("../scripts/english-edition.ts");
  assert.equal(fixEnglishNames("the new Street Fight movie"), "the new Street Fighter movie");
  assert.equal(fixEnglishNames("Street Fighter movie"), "Street Fighter movie");
});

test("the faction is «The 946» in English after a preposition (INCIDENTS #598)", async () => {
  const { fixEnglishNames } = await import("../scripts/english-edition.ts");
  assert.equal(fixEnglishNames("rivalry between 946 and The Bloodline"), "rivalry between The 946 and The Bloodline");
  assert.equal(fixEnglishNames("Carmelo Hayes join 946"), "Carmelo Hayes join The 946");
  assert.equal(fixEnglishNames("with The 946 now"), "with The 946 now");
  const bad = fs.readdirSync("content/news-en").filter(f => /\b(joining|join|joined|joins|between|with|of|and|by|from|against) 946\b/i.test(fs.readFileSync(`content/news-en/${f}`, "utf-8")));
  assert.deepEqual(bad, []);
});

// INCIDENTS #599: «اربعة» (hamza dropped) and «الجمعة الخامس عشر من أكتوبر» (a Friday that is a Thursday) reached the Street Fighter story.
test("number words get their hamza and spelled-out dates are weekday-checked", async () => {
  const { applyCorrections, weekdayNotOnDate } = await import("../scripts/news-qa");
  assert.equal(applyCorrections("بلغ اربعة وثلاثين بالمئة"), "بلغ أربعة وثلاثين بالمئة");
  assert.equal(weekdayNotOnDate("يوم الجمعة الخامس عشر من أكتوبر", 2026), "الجمعة الخامس عشر من أكتوبر");
  assert.equal(weekdayNotOnDate("يوم الجمعة السادس عشر من أكتوبر", 2026), null);
  const bad = fs.readdirSync("content/news").filter(f => f.endsWith(".md") && /(?<![ء-ي])ا(?:ربعة|ربعين)(?![ء-ي])/.test(fs.readFileSync(`content/news/${f}`, "utf-8").replace(/^permalink:.*$/m, "")));
  assert.deepEqual(bad, []);
});

// INCIDENTS #609: Trump was called «الرئيس السابق» (he is the sitting president) in the Jim Cornette story.
test("Trump is never «the former president» in Arabic stories (INCIDENTS #609)", async () => {
  const { applyCorrections } = await import("../scripts/news-qa");
  assert.equal(applyCorrections("انتقادات للرئيس السابق دونالد ترامب"), "انتقادات للرئيس دونالد ترامب");
  assert.equal(applyCorrections("قال الرئيس السابق دونالد ترامب"), "قال الرئيس دونالد ترامب");
  const guide = fs.readFileSync("editorial/style-guide.md", "utf-8");
  assert.ok(guide.includes("الرئيس الحالي لأمريكا"));
  const bad = fs.readdirSync("content/news").filter(f => f.endsWith(".md") && /الرئيس (الأمريكي )?السابق (دونالد )?ترامب/.test(fs.readFileSync(`content/news/${f}`, "utf-8").replace(/^permalink:.*$/m, "")));
  assert.deepEqual(bad, []);
});

// INCIDENTS #568: «فقرة كوميدية غير موفق فيها» — the adjective must agree with its feminine noun.
test("«غير موفق فيها» is corrected and no story keeps it", () => {
  const corrections = JSON.parse(fs.readFileSync("editorial/corrections.json", "utf-8")).corrections as { wrong: string; right: string }[];
  assert.ok(corrections.some(c => c.wrong === "غير موفق فيها" && c.right === "غير موفقة"));
  const bad = fs.readdirSync("content/news").filter(f => f.endsWith(".md") && fs.readFileSync(`content/news/${f}`, "utf-8").includes("غير موفق فيها"));
  assert.deepEqual(bad, []);
});

// INCIDENTS #627: a single dropped hamza («الاصابة»، «اساسيا») slipped past hamza_dropped (needs 3), and «lives inside his own head» became «داخل عقده».
test("single dropped hamzas and the «head» mistranslation are corrected", async () => {
  const { applyCorrections } = await import("../scripts/news-qa");
  assert.equal(applyCorrections("تلك الاصابة جزءا اساسيا من الاصابات"), "تلك الإصابة جزءا أساسيا من الإصابات");
  assert.equal(applyCorrections("يعيش داخل عقده الخاص دون"), "يعيش داخل رأسه دون");
  const bad = fs.readdirSync("content/news").filter(f => f.endsWith(".md") && /(?<![ء-ي])[وفبلك]?(?:ال)?(?:اصابة|اصابات|اساسي|اساسيا|اساسية)(?![ء-ي])|يعيش داخل عقده/.test(fs.readFileSync(`content/news/${f}`, "utf-8").replace(/^permalink:.*$/m, "")));
  assert.deepEqual(bad, []);
});

// INCIDENTS #629: «أديائها» (extra letter) reached the Drew McIntyre feet story.
test("«أداء» typo «أدياء» is corrected and absent from published stories", async () => {
  const { applyCorrections } = await import("../scripts/news-qa");
  assert.equal(applyCorrections("توقف عن أديائها سابقا"), "توقف عن أدائها سابقا");
  const bad = fs.readdirSync("content/news").filter(f => f.endsWith(".md") && /أدياء/.test(fs.readFileSync(`content/news/${f}`, "utf-8").replace(/^permalink:.*$/m, "")));
  assert.deepEqual(bad, []);
});

// INCIDENTS #631: «براد غيلمور» was split into «غيل مور» in the Jericho DeLorean story.
test("«غيلمور» is never split into «غيل مور»", async () => {
  const { applyCorrections } = await import("../scripts/news-qa");
  assert.equal(applyCorrections("ليذكر غيل مور أن"), "ليذكر غيلمور أن");
  const bad = fs.readdirSync("content/news").filter(f => f.endsWith(".md") && /غيل مور/.test(fs.readFileSync(`content/news/${f}`, "utf-8").replace(/^permalink:.*$/m, "")));
  assert.deepEqual(bad, []);
});

// INCIDENTS #640: «إحدى عروض عرض WWE RAW» (wrong gender + doubled «عرض») reached the Naomi story.
test("«إحدى عروض عرض» is corrected and absent from published stories", async () => {
  const { applyCorrections } = await import("../scripts/news-qa");
  assert.equal(applyCorrections("خلال إحدى عروض عرض WWE RAW في أغسطس"), "خلال أحد عروض WWE RAW في أغسطس");
  assert.equal(applyCorrections("في إحدى عروض Collision"), "في أحد عروض Collision");
  const bad = fs.readdirSync("content/news").filter(f => f.endsWith(".md") && /إحدى\s+عروض|عروض\s+عرض/.test(fs.readFileSync(`content/news/${f}`, "utf-8").replace(/^permalink:.*$/m, "")));
  assert.deepEqual(bad, []);
});

// INCIDENTS #643: «تريبل إتش عرض الاستمرار في دفع أجري» — «عرض» (offered) reads as the show.
test("«عرض الاستمرار» (offered to keep) is corrected to «اقترح الاستمرار»", async () => {
  const { applyCorrections } = await import("../scripts/news-qa");
  assert.equal(applyCorrections("تريبل إتش عرض الاستمرار في دفع أجري"), "تريبل إتش اقترح الاستمرار في دفع أجري");
  assert.ok(fs.readFileSync("editorial/style-guide.md", "utf-8").includes("«عرض» فعلا ممنوعة في العنوان"));
});

test("Nikkito Lyons → Nikkita Lyons in English stories", async () => {
  const { fixEnglishNames } = await import("../scripts/english-edition.ts");
  assert.equal(fixEnglishNames("Nikkito Lyons retained the title"), "Nikkita Lyons retained the title");
});

test("«Twitter» becomes «X» in English stories, except inside a quote", async () => {
  const { fixEnglishNames } = await import("../scripts/english-edition.ts");
  assert.equal(fixEnglishNames("Cage posted a video on Twitter today."), "Cage posted a video on X today.");
  assert.equal(fixEnglishNames("Hayes Blacks Out Twitter Profile Picture"), "Hayes Blacks Out X Profile Picture");
  assert.equal(fixEnglishNames('He said "stay off Twitter" today.'), 'He said "stay off Twitter" today.');
  assert.equal(fixEnglishNames("> \"Don't be on Twitter.\""), "> \"Don't be on Twitter.\"");
  for (const f of fs.readdirSync("content/news-en").filter((x) => x.endsWith(".md"))) {
    const head = fs.readFileSync(`content/news-en/${f}`, "utf-8").split("\n").slice(0, 20).filter((l) => /^(title|description):|^  - /.test(l)).join("\n");
    assert.ok(!/\bTwitter\b/.test(head), `Twitter in the head of ${f}`);
  }
});

// INCIDENTS #652: «Close Up with Renee Paquette مع رينيه باكيت» (name twice) and «نافيا الواقعة بالقول» (meaningless).
test("duplicated program+host name and the meaningless «نافيا الواقعة» are corrected", async () => {
  const { applyCorrections } = await import("../scripts/news-qa");
  assert.equal(applyCorrections("في برنامج Close Up with Renee Paquette مع رينيه باكيت، تحدث"), "في برنامج Close Up مع رينيه باكيت، تحدث");
  assert.equal(applyCorrections("كتب سينتس عبر منصة إكس نافيا الواقعة بالقول إنه لم يتعمد"), "كتب سينتس عبر منصة إكس إنه لم يتعمد");
});

// INCIDENTS #662: «تتراوح بين منتصف الثلاثين مليون دولار» (literal «mid-$30 million range») reached the Street Fighter story.
test("«تتراوح بين منتصف الثلاثين مليون» is corrected and gone from stories", async () => {
  const { applyCorrections } = await import("../scripts/news-qa");
  assert.equal(applyCorrections("إيرادات تتراوح بين منتصف الثلاثين مليون دولار"), "إيرادات في حدود 35 مليون دولار");
  const bad = fs.readdirSync("content/news").filter(f => f.endsWith(".md") && /منتصف الثلاثين مليون/.test(fs.readFileSync(`content/news/${f}`, "utf-8")));
  assert.deepEqual(bad, []);
});

// INCIDENTS #663: «اسماء المصارعين» (title) and a whole paragraph without hamzas («امريكا»، «اثارة»، «ابرزها») reached stories.
test("dropped hamzas are corrected and counted by the hamza_dropped check", async () => {
  const { applyCorrections, checkArticle } = await import("../scripts/news-qa");
  assert.equal(applyCorrections("اسماء المصارعين في امريكا"), "أسماء المصارعين في أمريكا");
  const issues = checkArticle("بيلي في جولة ناجحة", "شهدت الجولة اثارة كبرى، ابرزها تتويج فاكير، اضافة إلى مواجهات ضد اسماء بارزة في امريكا الجنوبية.");
  assert.ok(issues.some((i: any) => i.code === "hamza_dropped"));
  const bad = fs.readdirSync("content/news").filter(f => f.endsWith(".md") && /(?<![ء-ي])(?:اسماء|امريكا|ابرزها|اسقاطها)(?![ء-ي])/.test(fs.readFileSync(`content/news/${f}`, "utf-8").replace(/^(permalink|source_url|image|slug):.*$/gm, "")));
  assert.deepEqual(bad, []);
});

// INCIDENTS #663: the English edition said «WrestleMania 23 is set for Saudi Arabia» (it is 43, in 2027).
test("English fixes turn WrestleMania 23 in Saudi Arabia into 43", async () => {
  const { fixEnglishNames } = await import("../scripts/english-edition");
  assert.equal(fixEnglishNames("While WrestleMania 23 is set for Saudi Arabia, nothing is planned."), "While WrestleMania 43 is set for Saudi Arabia, nothing is planned.");
  assert.equal(fixEnglishNames("He won at WrestleMania 23 in Detroit."), "He won at WrestleMania 23 in Detroit.");
});

test("corrections keep team names in English", () => {
  const corrections = JSON.parse(fs.readFileSync("editorial/corrections.json", "utf-8")).corrections as { wrong: string; right: string }[];
  assert.ok(corrections.some(c => c.wrong === "فريق بيتر توجيذر" && c.right === "فريق Better Together"));
});

test("«بييج» (ياء زيادة في Page/Paige) بتتصلح لـ«بيج»", () => {
  const corrections = JSON.parse(fs.readFileSync("editorial/corrections.json", "utf-8")).corrections as { wrong: string; right: string }[];
  assert.ok(corrections.some(c => c.wrong === "بييج" && c.right === "بيج"));
});

test("«وحقيقه» typo is corrected and gone from stories (INCIDENTS #667)", async () => {
  const { applyCorrections } = await import("../scripts/news-qa");
  assert.equal(applyCorrections("تفوق ياسودا وحقيقه الفوز"), "تفوق ياسودا وحقق الفوز");
  const bad = fs.readdirSync("content/news").filter(f => f.endsWith(".md") && /وحقيقه/.test(fs.readFileSync(`content/news/${f}`, "utf-8")));
  assert.deepEqual(bad, []);
});

// INCIDENTS #675: «داينائل غارسيا» / «أبيض نيجرو» / «مسرع إيقاع» reached stories.
test("Daniel Garcia, Abismo Negro and metronome are corrected (INCIDENTS #675)", async () => {
  const { applyCorrections } = await import("../scripts/news-qa");
  assert.equal(applyCorrections("داينائل غارسيا"), "دانيال غارسيا");
  assert.equal(applyCorrections("خصمه أبيض نيجرو"), "خصمه أبيسمو نيجرو");
  assert.equal(applyCorrections("أبيسمو نيغرو"), "أبيسمو نيجرو");
  assert.equal(applyCorrections("ومسرع إيقاع"), "وجهاز ضبط الإيقاع");
  const bad = fs.readdirSync("content/news").filter(f => f.endsWith(".md") && /داينائل|أبيض نيجرو|مسرع إيقاع/.test(fs.readFileSync(`content/news/${f}`, "utf-8").replace(/^permalink:.*$/m, "")));
  assert.deepEqual(bad, []);
});

// INCIDENTS #676: Niño Hamburguesa was written 5 different ways and «بايج» for Page.
test("Niño Hamburguesa has one spelling and Page is «بيدج» (INCIDENTS #676)", async () => {
  const { applyCorrections } = await import("../scripts/news-qa");
  const glossary = JSON.parse(fs.readFileSync("scripts/wrestler-names.json", "utf-8")) as Record<string, string>;
  assert.equal(glossary["Niño Hamburguesa"], "نينيو هامبورغيسا");
  assert.equal(applyCorrections("نينو هامبورغويسا ونينيو هامبورغسا"), "نينيو هامبورغيسا ونينيو هامبورغيسا");
  assert.equal(applyCorrections("تمكن بايج وكينج"), "تمكن بيدج وكينج");
  const bad = fs.readdirSync("content/news").filter(f => f.endsWith(".md") && /نين[يو]{1,2} هامبورغ(?:سا|ويسا|يزا)/.test(fs.readFileSync(`content/news/${f}`, "utf-8")));
  assert.deepEqual(bad, []);
});
