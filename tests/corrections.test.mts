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

// INCIDENTS #679: «بطولة العالم للثلاثي», «برودي كيغ», «بايج وستريكلاند» and an announced AAA card written with «def.».
test("Trios title wording, Brody King and Hangman Page are corrected (INCIDENTS #679)", async () => {
  const { applyCorrections } = await import("../scripts/news-qa");
  assert.equal(applyCorrections("ويحصد بطولة العالم للثلاثي"), "ويحصد بطولة العالم للفرق الثلاثية");
  assert.equal(applyCorrections("حركة من برودي كيغ"), "حركة من برودي كينج");
  assert.equal(applyCorrections("بين بايج وستريكلاند"), "بين بيدج وستريكلاند");
  assert.equal(applyCorrections("بعد أن باتت مصارعة في السوق"), "بعد أن أصبحت مصارعة حرة");
  const glossary = JSON.parse(fs.readFileSync("scripts/wrestler-names.json", "utf-8")) as Record<string, string>;
  assert.ok(!Object.values(glossary).includes("بطولة العالم للثلاثي"));
  const bad = fs.readdirSync("content/news").filter(f => f.endsWith(".md") && /بطولة العالم للثلاثي|برودي كيغ/.test(fs.readFileSync(`content/news/${f}`, "utf-8").replace(/^(permalink|social_\w+):.*$/mg, "")));
  assert.deepEqual(bad, []);
});

test("English: an announced card must not be written as «def.» results (INCIDENTS #679)", async () => {
  const { checkEnglish } = await import("../scripts/english-edition.ts");
  const body = "Lucha Libre AAA revealed the full match card for the upcoming event during the October 17 episode of AAA on Fox. The show is scheduled for October 24.\n\nPerros Del Mal def. La Parka, Mr. Iguana, & Nino Hamburguesa\nEl Grande Americano def. Dominik Mysterio\n\nMarisela Pena will be inducted into the AAA Hall of Fame as part of the night.";
  const input = { sourceText: "AAA announced the card: Perros del Mal defends against La Parka. The show is set for Oct 24.", sourceUrl: "https://www.fightful.com/x", arabicTitle: "x", arabicBody: "x" } as any;
  assert.ok(checkEnglish({ title: "Full Lineup Announced for AAA Heroes Inmortales", body, tags: [] } as any, input).some(x => x.includes("def.")));
  assert.ok(!checkEnglish({ title: "Full Lineup Announced for AAA Heroes Inmortales", body: body.replace(/ def\. /g, " vs. "), tags: [] } as any, input).some(x => x.includes("def.")));
});

// INCIDENTS #684: «لم يتعافى بعد» (the verb after «لم» must lose its last letter).
test("defective verbs after «لم» are jussive and no published story keeps the wrong form", async () => {
  const { applyCorrections } = await import("../scripts/news-qa");
  assert.equal(applyCorrections("لم يتعافى بعد بالكامل"), "لم يتعاف بعد بالكامل");
  assert.equal(applyCorrections("لكنه لم يأتي"), "لكنه لم يأت");
  const bad = fs.readdirSync("content/news").filter(f => f.endsWith(".md") && /لم (?:يتعافى|يبقى|يأتي|يلقى|يسعى|ينسى|يرضى|يخشى|يعطي|يمضي|يبدو|يستطيع)(?![ء-ي])/.test(fs.readFileSync(`content/news/${f}`, "utf-8").replace(/^permalink:.*$/m, "")));
  assert.deepEqual(bad, []);
});

// INCIDENTS #686: «تتويجا ناججا» (typo) in the NXT Live results and «لاسي إيوانف» + «لتلك الدور» in a CJ Perry story.
test("typos «ناججا» «إيوانف» «لتلك الدور» are corrected and gone from stories", async () => {
  const { applyCorrections } = await import("../scripts/news-qa");
  assert.equal(applyCorrections("دفاعا ناججا عن اللقب"), "دفاعا ناجحا عن اللقب");
  assert.equal(applyCorrections("دخلت لاسي إيوانف في قصة"), "دخلت لاسي إيفانز في قصة");
  assert.equal(applyCorrections("الخيار الأنسب لتلك الدور"), "الخيار الأنسب لذلك الدور");
  const bad = fs.readdirSync("content/news").filter(f => f.endsWith(".md") && /ناجج|إيوانف|لتلك الدور/.test(fs.readFileSync(`content/news/${f}`, "utf-8").replace(/^(permalink|source_url|image|slug):.*$/gm, "")));
  assert.deepEqual(bad, []);
});

// INCIDENTS #688: «متهم إياه» (a hal, must be accusative).
test("«متهم إياه» becomes «متهما إياه»", async () => {
  const { applyCorrections } = await import("../scripts/news-qa");
  assert.equal(applyCorrections("بالغش، متهم إياه بأنه فاز"), "بالغش، متهما إياه بأنه فاز");
});

// INCIDENTS #690: PRODUCE Volume 5 results — «1 Called Manders توماس شاير» (no «و») and a stray «وخالدة» in the headline/body.
test("names joined with «&» get «و» and the PRODUCE results story is clean (INCIDENTS #690)", async () => {
  const { applyCorrections } = await import("../scripts/news-qa");
  assert.equal(applyCorrections("فريق Cowboy Way المكون من 1 Called Manders توماس شاير"), "فريق Cowboy Way المكون من 1 Called Manders وتوماس شاير");
  const f = fs.readdirSync("content/news").find(n => n.startsWith("20261018191951-"))!;
  const text = fs.readFileSync(`content/news/${f}`, "utf-8").replace(/^permalink:.*$/m, "");
  assert.ok(!/وخالدة|Manders توماس/.test(text));
});

// INCIDENTS #690: the Arabic Ciampa story said «القارية» (source: AEW TNT Championship) and the Dreamer story named
// Scott D'Amore as the man he agreed the exit with (source: Carlos Silva).
test("Ciampa TNT title and Dreamer's exit agreement match the sources (INCIDENTS #690)", () => {
  const read = (p: string) => fs.readFileSync(`content/news/${fs.readdirSync("content/news").find(n => n.startsWith(p))!}`, "utf-8");
  assert.ok(!/AEW القارية/.test(read("20261018203000-")) && /بطولة TNT/.test(read("20261018203000-")));
  assert.ok(/كارلوس سيلفا/.test(read("20261018195538-")) && !/اتفاق ودي مع سكوت دي أمور/.test(read("20261018195538-")));
});

// INCIDENTS #691: Hornswoggle was written three ways («هورن سواغل» / «هورنسوغل» / «هورنسواغل»).
test("Hornswoggle has one spelling in the glossary, corrections and stories", async () => {
  const { applyCorrections } = await import("../scripts/news-qa");
  const glossary = JSON.parse(fs.readFileSync("scripts/wrestler-names.json", "utf-8")) as Record<string, string>;
  assert.equal(glossary["Hornswoggle"], "هورنسواغل");
  assert.equal(applyCorrections("تقيأ عليه هورن سواغل ثم هورنسوغل"), "تقيأ عليه هورنسواغل ثم هورنسواغل");
  const bad = fs.readdirSync("content/news").filter(f => f.endsWith(".md") && /هورن سواغل|هورنسوغل/.test(fs.readFileSync(`content/news/${f}`, "utf-8").replace(/^permalink:.*$/m, "")));
  assert.deepEqual(bad, []);
});

// INCIDENTS #692: «برودي كينغ» (with ghain) was in 21 stories; the glossary spelling is «برودي كينج».
test("Brody King is always spelled with jeem (INCIDENTS #692)", async () => {
  const { applyCorrections } = await import("../scripts/news-qa");
  assert.equal(applyCorrections("ضد برودي كينغ"), "ضد برودي كينج");
  const bad = fs.readdirSync("content/news").filter(f => f.endsWith(".md") && /برودي كينغ/.test(fs.readFileSync(`content/news/${f}`, "utf-8").replace(/^(permalink|social_\w+):.*$/mg, "")));
  assert.deepEqual(bad, []);
});

test("Gillberg is spelled غيلبيرج in the glossary and every story (INCIDENTS #694)", async () => {
  const { applyCorrections } = await import("../scripts/news-qa");
  assert.equal(applyCorrections("قال غيلبيرغ"), "قال غيلبيرج");
  const names = JSON.parse(fs.readFileSync("scripts/wrestler-names.json", "utf-8"));
  assert.equal(names["Gillberg"], "غيلبيرج");
  const bad = fs.readdirSync("content/news").filter(f => f.endsWith(".md") && /غيلبيرغ/.test(fs.readFileSync(`content/news/${f}`, "utf-8").replace(/^(permalink|social_\w+):.*$/mg, "")));
  assert.deepEqual(bad, []);
});

test("Gallus is spelled جالوس everywhere, never غالوس (INCIDENTS #695)", async () => {
  const { applyCorrections } = await import("../scripts/news-qa");
  assert.equal(applyCorrections("فريق غالوس"), "فريق جالوس");
  const bad = fs.readdirSync("content/news").filter(f => f.endsWith(".md") && /غالوس/.test(fs.readFileSync(`content/news/${f}`, "utf-8").replace(/^(permalink|social_\w+):.*$/mg, "")));
  assert.deepEqual(bad, []);
});

test("General Manager is «المدير العام», never «مدير العرض» (INCIDENTS #696)", async () => {
  const { applyCorrections } = await import("../scripts/news-qa");
  assert.equal(applyCorrections("أعلن مدير العرض آدم بيرس"), "أعلن المدير العام آدم بيرس");
  assert.equal(applyCorrections("اضطر مدير العرض العام آدم"), "اضطر المدير العام آدم");
  const bad = fs.readdirSync("content/news").filter(f => f.endsWith(".md") && /مدير العرض/.test(fs.readFileSync(`content/news/${f}`, "utf-8").replace(/^(permalink|social_\w+):.*$/mg, "")));
  assert.deepEqual(bad, []);
});

// INCIDENTS #697: «للدعم والدعم المعنوي» (same word around «و») and «طرد بري» reached stories.
test("a definite word repeated around «و» is blocked and «طرد بري» is corrected", async () => {
  const { checkArticle, applyCorrections } = await import("../scripts/news-qa");
  assert.equal(applyCorrections("وصل طرد بري إلى المكتب"), "وصل طرد بريدي إلى المكتب");
  const issues = checkArticle("عنوان واضح للتجربة", "شكرت المصارعة والدتها للدعم والدعم المعنوي طوال مشوارها.");
  assert.ok(issues.some(i => i.code === "repeated_word_waw"));
  const bad = fs.readdirSync("content/news").filter(f => f.endsWith(".md") && /(?<![ء-ي])(?:لل|ال|بال|كال)(?!كثير|نهائي|قمصان)([ء-ي]{3,})\s+وال\1(?![ء-ي])/.test(fs.readFileSync(`content/news/${f}`, "utf-8").replace(/^---[\s\S]*?\n---/, "")));
  assert.deepEqual(bad, []);
});

// INCIDENTS #699: Gemini wrote Fuerza Poblana as «فويرسا دوبلانا».
test("Fuerza Poblana is corrected and in the glossary", async () => {
  const { applyCorrections } = await import("../scripts/news-qa");
  assert.equal(applyCorrections("فاز فريق فويرسا دوبلانا"), "فاز فريق فويرزا بوبلانا");
  assert.ok(JSON.parse(fs.readFileSync("scripts/wrestler-names.json", "utf-8"))["Fuerza Poblana"]);
  const bad = fs.readdirSync("content/news").filter(f => f.endsWith(".md") && fs.readFileSync(`content/news/${f}`, "utf-8").includes("فويرسا دوبلانا"));
  assert.deepEqual(bad, []);
});

test("English edition: «Entrances Themes» becomes «Entrance Themes» (INCIDENTS #700)", async () => {
  const { fixEnglishNames } = await import("../scripts/english-edition.ts");
  assert.equal(fixEnglishNames("Joe Hendry Reveals Favorite WWE Entrances Themes From Past & Present"), "Joe Hendry Reveals Favorite WWE Entrance Themes From Past & Present");
  assert.equal(fixEnglishNames("Entrances Music"), "Entrance Music");
});

test("bikini is «بيكيني», never «بيسيني» (INCIDENTS #703)", async () => {
  const { applyCorrections } = await import("../scripts/news-qa");
  assert.equal(applyCorrections("صور ببيسيني أسود"), "صور ببيكيني أسود");
  assert.equal(applyCorrections("استغللت رحلتها"), "استغلت رحلتها");
  const bad = fs.readdirSync("content/news").filter(f => f.endsWith(".md") && /بيسيني/.test(fs.readFileSync(`content/news/${f}`, "utf-8").replace(/^(permalink|social_\w+):.*$/mg, "")));
  assert.deepEqual(bad, []);
});

// INCIDENTS #704: «التي سمعاها» (dual verb) slipped past dual_form; «ايريكا» lost its hamza.
test("dual verbs with object pronoun are blocked and «ايريكا» is corrected (INCIDENTS #704)", async () => {
  const { checkArticle, applyCorrections } = await import("../scripts/news-qa");
  const issues = checkArticle("عنوان واضح للتجربة", "تحدثت نيكي وبري عن أغرب العبارات التي سمعاها طوال مسيرتهن في الفندق.");
  assert.ok(issues.some(i => i.code === "dual_form"));
  assert.equal(applyCorrections("مواجهتها ضد ايريكا ديما"), "مواجهتها ضد إيريكا ديما");
  const bad = fs.readdirSync("content/news").filter(f => f.endsWith(".md") && /ايريكا|سمعاها/.test(fs.readFileSync(`content/news/${f}`, "utf-8").replace(/^(permalink|social_\w+):.*$/mg, "")));
  assert.deepEqual(bad, []);
});

// INCIDENTS #705: «يذكر أن خاض الثنائي» (verb before subject) and a clipped «قم النصوص» reached stories.
test("the broken Drew McIntyre phrasings are corrected", async () => {
  const { applyCorrections } = await import("../scripts/news-qa");
  assert.equal(applyCorrections("يذكر أن خاض الثنائي صراعا"), "يذكر أن الثنائي خاض صراعا");
  assert.equal(applyCorrections("لكنه يرفض قم النصوص الحرفية"), "لكنه يرفض التقيد بالنصوص الحرفية");
  const bad = fs.readdirSync("content/news").filter(f => f.endsWith(".md") && /يذكر أن خاض الثنائي|يرفض قم النصوص/.test(fs.readFileSync(`content/news/${f}`, "utf-8")));
  assert.deepEqual(bad, []);
});

// INCIDENTS #706: «Bad Blood العام الماضي» (the event was 2024) and «القفص الحديدي» for Hell in a Cell.
test("the Bad Blood «last year» phrasing is corrected", async () => {
  const { applyCorrections } = await import("../scripts/news-qa");
  assert.equal(applyCorrections("داخل القفص الحديدي في عرض WWE Bad Blood العام الماضي"), "داخل قفص Hell in a Cell في عرض WWE Bad Blood 2024");
  const bad = fs.readdirSync("content/news").filter(f => f.endsWith(".md") && /Bad Blood العام الماضي/.test(fs.readFileSync(`content/news/${f}`, "utf-8")));
  assert.deepEqual(bad, []);
});

test("«لم يشتري» and «منطقة الجذر» are corrected and gone from stories (INCIDENTS #707)", async () => {
  const { applyCorrections } = await import("../scripts/news-qa");
  assert.equal(applyCorrections("لم يشتري اتحاد AEW"), "لم يشتر اتحاد AEW");
  assert.equal(applyCorrections("تمارين منطقة الجذر"), "تمارين عضلات الجذع");
  const bad = fs.readdirSync("content/news").filter(f => f.endsWith(".md") && /لم يشتري|منطقة الجذر/.test(fs.readFileSync(`content/news/${f}`, "utf-8").replace(/^(permalink|social_\w+):.*$/mg, "")));
  assert.deepEqual(bad, []);
});

test("«رفع المصارعات» is corrected and «كانا» is a blocked dual form (INCIDENTS #708)", async () => {
  const { applyCorrections } = await import("../scripts/news-qa");
  assert.equal(applyCorrections("صعوبة في رفع المصارعات"), "صعوبة في رفع الخصوم");
  const { checkArticle } = await import("../scripts/news-qa");
  const issues = checkArticle("عنوان", "قال إنهم كانا في قمة اللطف مع الجميع.");
  assert.ok(JSON.stringify(issues).includes("dual_form"));
});
