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

// INCIDENTS #709: «وددون» / «لهالان» / «زملائه» after «خان» reached stories.
test("typos from the 19-10 stories are corrected and gone from the content", async () => {
  const { applyCorrections } = await import("../scripts/news-qa");
  assert.equal(applyCorrections("بموافقة وددون إذن"), "بموافقة ودون إذن");
  assert.equal(applyCorrections("لهالان في نقل"), "لهوجان في نقل");
  assert.equal(applyCorrections("خان سيث رولينز زملائه في الفريق"), "خان سيث رولينز زملاءه في الفريق");
  const bad = fs.readdirSync("content/news").filter(f => f.endsWith(".md") && /وددون|لهالان|خان سيث رولينز زملائه/.test(fs.readFileSync(`content/news/${f}`, "utf-8").replace(/^permalink:.*$/m, "")));
  assert.deepEqual(bad, []);
});

// INCIDENTS #710: «الانفساخ» / «ولطرف الآخر» / «ممثلتين» / «يطمئنان» / «صديقين» reached Eva Marie and CMLL stories.
test("Eva Marie / CMLL slips are corrected and dual forms blocked (INCIDENTS #710)", async () => {
  const { applyCorrections, checkArticle } = await import("../scripts/news-qa");
  assert.equal(applyCorrections("أدت إلى الانفساخ ولها ولطرف الآخر"), "أدت إلى الانفصال ولها وللطرف الآخر");
  const body = "كانت شوتزي وماشا ممثلتين لاتحاد MLW، وهم أصدقاء مقربين يطمئنان على بعضهم وبقاء صديقين";
  const codes = (checkArticle("عنوان واضح عن مصارعة", body) as any[]).map(i => i.code);
  assert.ok(codes.includes("dual_noun"));
  assert.ok(codes.includes("dual_form"));
  const bad = fs.readdirSync("content/news").filter(f => f.endsWith(".md") && /الانفساخ|ولطرف الآخر/.test(fs.readFileSync(`content/news/${f}`, "utf-8")));
  assert.deepEqual(bad, []);
});

test("«لا تعلى عليها» تتصحح لـ«لا مثيل لها» (INCIDENTS #711)", () => {
  const corrections = JSON.parse(fs.readFileSync("editorial/corrections.json", "utf-8")).corrections as { wrong: string; right: string }[];
  assert.ok(corrections.some(c => c.wrong === "لا تعلى عليها" && c.right === "لا مثيل لها"));
});

test("«طاقم المخاطرين» تتصحح لـ«طاقم المشاهد الخطرة» (INCIDENTS #712)", () => {
  const corrections = JSON.parse(fs.readFileSync("editorial/corrections.json", "utf-8")).corrections as { wrong: string; right: string }[];
  assert.ok(corrections.some(c => c.wrong === "طاقم المخاطرين" && c.right === "طاقم المشاهد الخطرة"));
});

test("«مايك بايلي» تتصحح لـ«مايك بيلي» وتتشال من الأخبار (INCIDENTS #714)", async () => {
  const { applyCorrections } = await import("../scripts/news-qa");
  assert.equal(applyCorrections("قال سبيدبول مايك بايلي"), "قال سبيدبول مايك بيلي");
  const bad = fs.readdirSync("content/news").filter(f => f.endsWith(".md") && /مايك بايلي/.test(fs.readFileSync(`content/news/${f}`, "utf-8").replace(/^permalink:.*$/m, "")));
  assert.deepEqual(bad, []);
});

test("fanbase «لا تقدر» (appreciate) isn't left ambiguous in any story", () => {
  const corrections = JSON.parse(fs.readFileSync("editorial/corrections.json", "utf-8")).corrections as { wrong: string; right: string }[];
  assert.ok(corrections.some(c => c.wrong === "قاعدة جماهيرية لا تقدر"));
  for (const f of fs.readdirSync("content/news")) {
    if (!f.endsWith(".md")) continue;
    assert.ok(!fs.readFileSync(`content/news/${f}`, "utf-8").includes("قاعدة جماهيرية لا تقدر"), f);
  }
});

// INCIDENTS #716: «دعوى قضائية رفعه حارس أمن» (مونتيز فورد) — «دعوى» مؤنثة.
test("feminine «دعوى قضائية» takes «رفعها» (INCIDENTS #716)", async () => {
  const { applyCorrections } = await import("../scripts/news-qa");
  assert.equal(applyCorrections("وسط دعوى قضائية رفعه حارس أمن"), "وسط دعوى قضائية رفعها حارس أمن");
  const bad = fs.readdirSync("content/news").filter(f => f.endsWith(".md") && /دعوى قضائية رفعه(?![\u0627-\u064a])/.test(fs.readFileSync(`content/news/${f}`, "utf-8")));
  assert.deepEqual(bad, []);
});

test("style guide: «بعضهم البعض» agrees with the wrestlers' gender, never the dual (INCIDENTS #717)", () => {
  assert.ok(fs.readFileSync("editorial/style-guide.md", "utf-8").includes("«بعضهم البعض» بتتطابق مع النوع والعدد"));
});

// INCIDENTS #722: «جاي أوسو» vs the glossary's «جي أوسو» (Jey Uso) split across stories.
test("Jey Uso is always «جي أوسو» in story bodies and titles", async () => {
  const { applyCorrections } = await import("../scripts/news-qa");
  assert.equal(applyCorrections("عودة جاي أوسو و جاي اوسو"), "عودة جي أوسو و جي أوسو");
  const bad = fs.readdirSync("content/news").filter(f => f.endsWith(".md") && /جاي\s*[أا]وسو/.test(fs.readFileSync(`content/news/${f}`, "utf-8").split("\n").filter(l => !/^(permalink:|  - |source_)/.test(l)).join("\n")));
  assert.deepEqual(bad, []);
});

// INCIDENTS #726: odd/misspelled words that reached stories must be corrected automatically.
test("هدات / التورناي / وما هيرام are corrected", async () => {
  const { applyCorrections } = await import("../scripts/news-qa");
  assert.equal(applyCorrections("الأمور هدات لاحقا"), "الأمور هدأت لاحقا");
  assert.equal(applyCorrections("ويشهد التورناي مشاركة"), "ويشهد البطولة مشاركة");
  assert.equal(applyCorrections("داني غارسي وما هيرام غارسي"), "داني غارسي وهيرام غارسي");
});

// INCIDENTS #728: «مكتب الطبي الشرعي» (missing باء) reached three Buck stories.
test("«الطبيب الشرعي» spelling is corrected", async () => {
  const { applyCorrections } = await import("../scripts/news-qa");
  assert.equal(applyCorrections("أكد مكتب الطبي الشرعي في مقاطعة كوك"), "أكد مكتب الطبيب الشرعي في مقاطعة كوك");
  const bad = fs.readdirSync("content/news").filter(f => f.endsWith(".md") && /الطبي الشرعي/.test(fs.readFileSync(`content/news/${f}`, "utf-8").replace(/^permalink:.*$/m, "")));
  assert.deepEqual(bad, []);
});

// INCIDENTS #729: «مكفول إيجابي» (meaningless word) reached a Jarrett story.
test("«مكفول إيجابي» is corrected", async () => {
  const { applyCorrections } = await import("../scripts/news-qa");
  assert.equal(applyCorrections("دون أي مكفول إيجابي"), "دون أي مكسب إيجابي");
  const bad = fs.readdirSync("content/news").filter(f => f.endsWith(".md") && /مكفول إيجابي/.test(fs.readFileSync(`content/news/${f}`, "utf-8")));
  assert.deepEqual(bad, []);
});

// INCIDENTS #730: «لم يراها» (wrong jussive) and two odd phrases reached stories.
test("jussive «لم يرها» and odd phrases are corrected", async () => {
  const { applyCorrections } = await import("../scripts/news-qa");
  assert.equal(applyCorrections("لم يراها الجمهور"), "لم يرها الجمهور");
  assert.equal(applyCorrections("سأبرحه ضربا"), "سأضربه ضربا مبرحا");
  const bad = fs.readdirSync("content/news").filter(f => f.endsWith(".md") && /لم (ي|ت)را(ها|هم|نا)\b/.test(fs.readFileSync(`content/news/${f}`, "utf-8").replace(/^permalink:.*$/m, "")));
  assert.deepEqual(bad, []);
});

// INCIDENTS #731: «وان كل التفاصيل» (dropped hamza after و) and «بطولة AEW الوطنية» inside an ACW results story.
test("«وان كل» is corrected and a story about ACW can't name AEW titles", async () => {
  const { applyCorrections, checkArticle } = await import("../scripts/news-qa");
  assert.equal(applyCorrections("كان رائعا وان كل التفاصيل جاءت ممتازة"), "كان رائعا وأن كل التفاصيل جاءت ممتازة");
  assert.equal(applyCorrections("المصارع وان مان غانغ"), "المصارع وان مان غانغ");
  const body = "أقام الاتحاد العرض. ".repeat(20) + "دافع البطل عن بطولة AEW الوطنية بنجاح.";
  assert.ok(checkArticle("نتائج عرض ACW Mischief Night 2", body).some((i: any) => i.code === "federation_mismatch"));
  assert.ok(!checkArticle("نتائج عرض AEW Dynamite", body).some((i: any) => i.code === "federation_mismatch"));
  const bad = fs.readdirSync("content/news").filter(f => f.endsWith(".md") && / وان (?:كل|هذا|هذه|ذلك|الجميع)/.test(fs.readFileSync(`content/news/${f}`, "utf-8").replace(/^permalink:.*$/m, "")));
  assert.deepEqual(bad, []);
});

// INCIDENTS #732: «قرارا متخذ» (missing alef) in the Dragunov story.
test("«قرارا متخذ» is corrected and gone from stories", async () => {
  const { applyCorrections } = await import("../scripts/news-qa");
  assert.equal(applyCorrections("لم يكن قرارا متخذ قبل أشهر"), "لم يكن قرارا متخذا قبل أشهر");
  const bad = fs.readdirSync("content/news").filter(f => f.endsWith(".md") && /قرارا متخذ(?!ا)/.test(fs.readFileSync(`content/news/${f}`, "utf-8")));
  assert.deepEqual(bad, []);
});

// INCIDENTS #735: split word «لت سيهل» and doubled «كواليس ما جرى خلف الكواليس».
test("split «لتسهيل» and doubled «كواليس» are corrected and gone from stories", async () => {
  const { applyCorrections } = await import("../scripts/news-qa");
  assert.equal(applyCorrections("قاد الجهود لت سيهل الأمر"), "قاد الجهود لتسهيل الأمر");
  assert.equal(applyCorrections("مشاهدة كواليس ما جرى خلف الكواليس"), "مشاهدة ما جرى خلف الكواليس");
  const bad = fs.readdirSync("content/news").filter(f => f.endsWith(".md") && /لت سيهل|كواليس ما جرى خلف الكواليس/.test(fs.readFileSync(`content/news/${f}`, "utf-8")));
  assert.deepEqual(bad, []);
});

// INCIDENTS #739: Syko Stu was «سايكو كلو» in the body (title «سايكو ستو») and «Rampage» Jackson became «عرض AEW Rampage».
test("Syko Stu and Quinton «Rampage» Jackson are corrected (INCIDENTS #739)", async () => {
  const { applyCorrections } = await import("../scripts/news-qa");
  const glossary = JSON.parse(fs.readFileSync("scripts/wrestler-names.json", "utf-8")) as Record<string, string>;
  assert.equal(glossary["Syko Stu"], "سايكو ستو");
  assert.equal(applyCorrections("تحدث سايكو كلو عن كوينتون عرض AEW Rampage جاكسون"), "تحدث سايكو ستو عن كوينتون «رامبيج» جاكسون");
});

// INCIDENTS #741: «El Hijo del Dr. Wagner Jr.» became «دي در. فاغنر» and Romeo Moreno «روميرو».
test("«دي در. فاغنر» and «روميرو مورينو» are corrected and gone from stories (INCIDENTS #741)", async () => {
  const { applyCorrections } = await import("../scripts/news-qa");
  assert.equal(applyCorrections("غاليون وإل هيخو دي در. فاغنر جونيور"), "غاليون وإل هيخو دي دكتور فاغنر جونيور");
  assert.equal(applyCorrections("مع روميرو مورينو"), "مع روميو مورينو");
  const bad = fs.readdirSync("content/news").filter(f => f.endsWith(".md") && /دي در\.? فاغنر|روميرو مورينو/.test(fs.readFileSync(`content/news/${f}`, "utf-8")));
  assert.deepEqual(bad, []);
});

// INCIDENTS #743: Dion Lennox was «دينو لينوكس» in the NXT 20 October review.
test("«دينو لينوكس» is corrected and gone from stories (INCIDENTS #743)", async () => {
  const { applyCorrections } = await import("../scripts/news-qa");
  assert.equal(applyCorrections("كروز مونتانا ودينو لينوكس"), "كروز مونتانا وديون لينوكس");
  const bad = fs.readdirSync("content/news").filter(f => f.endsWith(".md") && /دينو لينوكس/.test(fs.readFileSync(`content/news/${f}`, "utf-8")));
  assert.deepEqual(bad, []);
});

// INCIDENTS #747: El Hijo del Dr. Wagner Jr. was written half English («El Hijo de دكتور فاغنر جونيور.») and with odd spellings.
test("El Hijo del Dr. Wagner Jr. has one Arabic spelling and is gone from stories (INCIDENTS #747)", async () => {
  const { applyCorrections } = await import("../scripts/news-qa");
  assert.equal(applyCorrections("ضد El Hijo de دكتور فاغنر جونيور. ضد La Parka"), "ضد إل هيخو دي دكتور فاغنر جونيور ضد La Parka");
  assert.equal(applyCorrections("ضد إيل خيتو دي الدكتور فاغنر جونيور"), "ضد إل هيخو دي دكتور فاغنر جونيور");
  const bad = fs.readdirSync("content/news").filter(f => f.endsWith(".md") && /El Hijo de دكتور|إل خيجو دي دكتور|إيل خيتو دي/.test(fs.readFileSync(`content/news/${f}`, "utf-8")));
  assert.deepEqual(bad, []);
});

test("corrections: dual verb «عملا فيه معا» and «تواجه معهم» are fixed (INCIDENTS #749)", () => {
  const corrections = JSON.parse(fs.readFileSync("editorial/corrections.json", "utf-8")).corrections as { wrong: string; right: string }[];
  assert.ok(corrections.some(c => c.wrong === "أول يوم عملا فيه معا" && c.right === "أول يوم عملوا فيه معا"));
  assert.ok(corrections.some(c => c.wrong === "الذين تواجه معهم" && c.right === "الذين واجههم"));
});

test("«الثنائي سيتحالفون» is corrected to a singular verb (INCIDENTS #752)", async () => {
  const { applyCorrections } = await import("../scripts/news-qa");
  assert.equal(applyCorrections("يذكر أن الثنائي سيتحالفون معا"), "يذكر أن الثنائي سيتحالف معا");
});

test("«هناك فرق كبيرا» and dual «تبادلا قمصان» are corrected (INCIDENTS #753)", async () => {
  const { applyCorrections } = await import("../scripts/news-qa");
  assert.equal(applyCorrections("أن هناك فرق كبيرا بين"), "أن هناك فرقا كبيرا بين");
  assert.equal(applyCorrections("كيف تبادلا قمصان الأندية"), "كيف تبادل معه قمصان الأندية");
  const bad = fs.readdirSync("content/news").filter(f => f.endsWith(".md") && /هناك فرق كبيرا|تبادلا قمصان/.test(fs.readFileSync(`content/news/${f}`, "utf-8")));
  assert.deepEqual(bad, []);
});

test("corrections fix feminine participle with masculine subject, «مشابها الأمر» and «يستخدموني»", () => {
  const corrections = JSON.parse(fs.readFileSync("editorial/corrections.json", "utf-8")).corrections as { wrong: string; right: string }[];
  assert.ok(corrections.some(c => c.wrong === "مشيرة مازحا" && c.right === "مشيرا مازحا"));
  assert.ok(corrections.some(c => c.wrong === "مشابها الأمر" && c.right === "مشبها الأمر"));
  assert.ok(corrections.some(c => c.wrong === "كان دائما يستخدموني" && c.right === "كان دائما يستخدمني"));
});

test("«باتت ملاحظة للفرق» is corrected and gone from the news (INCIDENTS #756)", async () => {
  const { applyCorrections } = await import("../scripts/news-qa");
  assert.equal(applyCorrections("الجماهير باتت ملاحظة للفرق في مظهره"), "الجماهير باتت تلاحظ الفرق في مظهره");
  const bad = fs.readdirSync("content/news").filter(f => f.endsWith(".md") && fs.readFileSync(`content/news/${f}`, "utf-8").includes("باتت ملاحظة للفرق"));
  assert.deepEqual(bad, []);
});

test("«ص» alone and «أنها لست» are corrected, blocked and gone from the news (INCIDENTS #757)", async () => {
  const { applyCorrections, checkArticle, BLOCKING_QA_CODES } = await import("../scripts/news-qa");
  assert.equal(applyCorrections("الذي نشر فيه ص من منشأة طبية"), "الذي نشر فيه صورة من منشأة طبية");
  assert.equal(applyCorrections("مؤكدة أنها لست متأكدة من استمرارها"), "مؤكدة أنها ليست متأكدة من استمرارها");
  assert.ok(BLOCKING_QA_CODES.includes("broken_word"));
  const body = "نشر ص من منشأة طبية. ".repeat(12);
  assert.ok(checkArticle("عنوان", body).some(i => i.code === "broken_word"));
  assert.ok(checkArticle("عنوان", "قالت إنها لست راضية عن النتيجة. ".repeat(12)).some(i => i.code === "broken_word"));
  assert.ok(!checkArticle("عنوان", "استثناء آدم بيدج، لست متأكدا من ذلك. ".repeat(12)).some(i => i.code === "broken_word"));
  const bad = fs.readdirSync("content/news").filter(f => f.endsWith(".md") && /فيه ص من|أنها لست/.test(fs.readFileSync(`content/news/${f}`, "utf-8")));
  assert.deepEqual(bad, []);
});

test("«وضح» becomes «أوضح» and Jey Uso keeps his name in English (INCIDENTS #758)", async () => {
  const { applyCorrections } = await import("../scripts/news-qa");
  assert.equal(applyCorrections("وضح المصارع داميان بريست أسباب هجومه"), "أوضح المصارع داميان بريست أسباب هجومه");
  const { fixEnglishNames } = await import("../scripts/english-edition.ts");
  assert.equal(fixEnglishNames("took chops from Jey Dragunov on SmackDown"), "took chops from Jey Uso on SmackDown");
  assert.equal(fixEnglishNames("Swerve Strickland defeated Tome Filip."), "Swerve Strickland defeated Tom Filip.");
});

test("«نزالهم» for two wrestlers becomes «النزال» (INCIDENTS #759)", async () => {
  const { applyCorrections } = await import("../scripts/news-qa");
  assert.equal(applyCorrections("إلى إيقاف نزالهم في العرض"), "إلى إيقاف النزال في العرض");
});

test("«سلسلة النزالات الخمسة» becomes «سلسلة من خمسة نزالات» (INCIDENTS #765)", async () => {
  const { applyCorrections } = await import("../scripts/news-qa");
  assert.equal(applyCorrections("استكمال سلسلة النزالات الخمسة بين"), "استكمال سلسلة من خمسة نزالات بين");
});

test("«كين ديكسون» becomes «كيل ديكسون» (INCIDENTS #766)", async () => {
  const { applyCorrections } = await import("../scripts/news-qa");
  assert.equal(applyCorrections("فاز كين ديكسون على آرون رورك"), "فاز كيل ديكسون على آرون رورك");
  assert.deepEqual(fs.readdirSync("content/news").filter(f => f.endsWith(".md") && fs.readFileSync(`content/news/${f}`, "utf-8").includes("كين ديكسون")), []);
});

test("«ضربة البنط» becomes «ركلة البانت» (INCIDENTS #768)", async () => {
  const { applyCorrections } = await import("../scripts/news-qa");
  assert.equal(applyCorrections("استخدم ضربة البنط في النزال"), "استخدم ركلة البانت في النزال");
});

// INCIDENTS #772: «ضربة استبدال الحقيبة» (cash in) and «هددت بالاعتزال من» (threatened to quit) reached stories.
test("cash-in and quit wording is corrected (INCIDENTS #772)", async () => {
  const { applyCorrections } = await import("../scripts/news-qa");
  assert.equal(applyCorrections("سينتظر اللحظة لتنفيذ ضربة استبدال الحقيبة واستهداف اللقب"), "سينتظر اللحظة لاستخدام الحقيبة واستهداف اللقب");
  assert.equal(applyCorrections("روزي هددت بالاعتزال من WWE"), "روزي هددت بترك WWE");
  const bad = fs.readdirSync("content/news").filter(f => f.endsWith(".md") && /ضربة استبدال الحقيبة|هددت بالاعتزال من/.test(fs.readFileSync(`content/news/${f}`, "utf-8").replace(/^permalink:.*$/m, "")));
  assert.deepEqual(bad, []);
});

// INCIDENTS #774: «لا اعتزال» (should be «لاعتزال») and «امر بي» (MVP) reached stories.
test("لا اعتزال and MVP spelling are corrected (INCIDENTS #774)", async () => {
  const { applyCorrections } = await import("../scripts/news-qa");
  assert.equal(applyCorrections("خططا محتملة لا اعتزال المصارع"), "خططا محتملة لاعتزال المصارع");
  assert.equal(applyCorrections("لاشلي وبنجامين وامر بي"), "لاشلي وبنجامين وام في بي");
});

test("style guide tells Gemini how to write dark match", () => {
  const guide = fs.readFileSync("editorial/style-guide.md", "utf-8");
  assert.ok(guide.includes("dark match ← «نزال غير مذاع»"));
});

// INCIDENTS #782: «أفقرت» (choked out) and a verbless opening sentence in a results story.
test("choke wording is corrected and guide covers it (INCIDENTS #782)", async () => {
  const { applyCorrections } = await import("../scripts/news-qa");
  assert.equal(applyCorrections("نفذت باسلر حركة إخضاع أفقرت بها البطلة"), "نفذت باسلر حركة خنق أسقطت بها البطلة");
  assert.ok(fs.readFileSync("editorial/style-guide.md", "utf-8").includes("choked out ← «خنق»"));
  const bad = fs.readdirSync("content/news").filter(f => f.endsWith(".md") && /أفقرت بها/.test(fs.readFileSync(`content/news/${f}`, "utf-8")));
  assert.deepEqual(bad, []);
});

// INCIDENTS #783: the verbless opener «عرض اتحاد X أحدث عرض من…» came back in an ROH TV results story.
test("verbless results opening is blocked (INCIDENTS #783)", async () => {
  const { checkArticle, BLOCKING_QA_CODES } = await import("../scripts/news-qa");
  const body = "عرض اتحاد رينغ أوف هونر أحدث عرض من ROH TV يوم 22 أكتوبر، وبثت الفعاليات عبر منصة أونر كلوب.\n\nهزم بيشوب كاون خصمه أورو.";
  assert.ok(checkArticle("نتائج عرض ROH TV", body).some(i => i.code === "verbless_opening"));
  assert.ok(BLOCKING_QA_CODES.includes("verbless_opening"));
  assert.ok(!checkArticle("نتائج عرض ROH TV", "قدم اتحاد رينغ أوف هونر أحدث حلقة من ROH TV يوم 22 أكتوبر.\n\nهزم بيشوب كاون خصمه أورو.").some(i => i.code === "verbless_opening"));
});

test("Avery Styles / Joe Alonzo / Kiera Hogan spellings follow the glossary (INCIDENTS #784)", () => {
  const corrections = JSON.parse(fs.readFileSync("editorial/corrections.json", "utf-8")).corrections as { wrong: string; right: string }[];
  for (const [w, r] of [["أيفري ستايلز", "إيفري ستايلز"], ["لم يكن ألونزو", "لم يكن ألونسو"], ["جو ألونزو", "جو ألونسو"], ["كيرا هودجان", "كيرا هوجان"], ["وألقى شين تايلور كلمة", "ألقى شين تايلور كلمة"]]) {
    assert.ok(corrections.some(c => c.wrong === w && c.right === r), w);
  }
  for (const f of fs.readdirSync("content/news")) {
    const t = fs.readFileSync(`content/news/${f}`, "utf-8");
    assert.ok(!/أيفري ستايلز|جو ألونزو|لم يكن ألونزو|كيرا هودجان/.test(t), f);
  }
});

// INCIDENTS #787: a tag like «MLP عرض MLP Northern Rising» (the show named twice with «عرض» between) must not come back.
test("no story tag repeats a Latin name around «عرض»", async () => {
  const { readdirSync, readFileSync } = await import("node:fs");
  const bad: string[] = [];
  for (const f of readdirSync("content/news").filter((n) => n.endsWith(".md"))) {
    for (const m of readFileSync(`content/news/${f}`, "utf8").matchAll(/^  - (\S+) عرض \1\b.*$/gm)) bad.push(`${f}: ${m[0]}`);
  }
  assert.deepEqual(bad, []);
});

// INCIDENTS #788: «بزواجه رسمي» and «أدافهم» typos must be corrected and never come back.
test("typos بزواجه رسمي / أدافهم are corrected everywhere (INCIDENTS #788)", () => {
  const corrections = JSON.parse(fs.readFileSync("editorial/corrections.json", "utf-8")).corrections as { wrong: string; right: string }[];
  for (const [w, r] of [["بزواجه رسمي", "بزواجه رسميا"], ["أدافهم", "أهدافهم"]]) {
    assert.ok(corrections.some(c => c.wrong === w && c.right === r), w);
  }
  for (const f of fs.readdirSync("content/news")) {
    const t = fs.readFileSync(`content/news/${f}`, "utf-8");
    assert.ok(!/بزواجه رسمي |أدافهم/.test(t), f);
  }
});

// INCIDENTS #789: the auto-learned rule «رسميا»→«رسمي» turned every «أعلن رسميا» into «أعلن رسمي».
test("«رسميا» is never rewritten, and the learner refuses words the site uses everywhere", async () => {
  const { applyCorrections } = await import("../scripts/news-qa");
  const { usesInPublishedNews } = await import("../scripts/learn-corrections");
  assert.equal(applyCorrections("أعلن الاتحاد رسميا عن النزال واحتفل بزواجه رسميا"), "أعلن الاتحاد رسميا عن النزال واحتفل بزواجه رسميا");
  assert.ok(usesInPublishedNews("رسميا") >= 10);
  const corrections = JSON.parse(fs.readFileSync("editorial/corrections.json", "utf-8")).corrections as { wrong: string }[];
  assert.ok(!corrections.some(c => c.wrong === "رسميا"));
  assert.ok(!fs.readFileSync("content/news/ويل-أوسبري-يرحب-بالظهور-المشترك-مع-زوجته-أليكس-ويندسور-على-شاشات-المصارعة.md", "utf-8").includes("تمت رسمي في"));
});

// INCIDENTS #792: «OTM» became «أوني كيم ووسيط كرم» and «فوتوغرافيات» (with a wrong number) reached stories.
test("OTM stays English and «فوتوغرافيات» becomes «صور» (INCIDENTS #792)", async () => {
  const { applyCorrections } = await import("../scripts/news-qa");
  const glossary = JSON.parse(fs.readFileSync("scripts/wrestler-names.json", "utf-8")) as Record<string, string>;
  assert.equal(glossary["OTM"], "OTM");
  assert.equal(applyCorrections("رويس كيز وفريق أوني كيم ووسيط كرم"), "رويس كيز وثنائي OTM وكارميلو هايز");
  assert.equal(applyCorrections("أربعة فوتوغرافيات توثق الإصابات"), "أربع صور توثق الإصابات");
  const bad = fs.readdirSync("content/news").filter(f => f.endsWith(".md") && /وسيط كرم|فوتوغرافيات/.test(fs.readFileSync(`content/news/${f}`, "utf-8").replace(/^permalink:.*$/m, "")));
  assert.deepEqual(bad, []);
});

test("corrections: «بايج» لآدم بيدج و«احتفالات عرض مسيرة» بتتصلح (INCIDENTS #793)", () => {
  const corrections = JSON.parse(fs.readFileSync("editorial/corrections.json", "utf-8")).corrections as { wrong: string; right: string }[];
  assert.ok(corrections.some(c => c.wrong === "لكن بايج رفض" && c.right === "لكن بيدج رفض"));
  assert.ok(corrections.some(c => c.wrong === "احتفالات عرض مسيرة" && c.right === "احتفالات بمسيرة"));
});

test("«fallen in view of» becomes «fallen in love with» (INCIDENTS #794)", async () => {
  const { fixEnglishNames } = await import("../scripts/english-edition.ts");
  assert.equal(fixEnglishNames("she has fallen in view of watching young athletes grow"), "she has fallen in love with watching young athletes grow");
});

test("«شاينا باسلر» بتتصلح لـ«شينا باسلر» وكل الأخبار بالاسم الصح (INCIDENTS #795)", async () => {
  const { applyCorrections } = await import("../scripts/news-qa");
  assert.equal(applyCorrections("أكدت شاينا باسلر أن الأبواب مفتوحة"), "أكدت شينا باسلر أن الأبواب مفتوحة");
  const bad = fs.readdirSync("content/news").filter(f => f.endsWith(".md") && fs.readFileSync(`content/news/${f}`, "utf-8").includes("شاينا باسلر"));
  assert.deepEqual(bad, []);
});

test("«شون ليجاسي» بتتصلح و«free agent» لمذيعة مش بتتحول لـ«مصارعة» (INCIDENTS #797)", async () => {
  const { applyCorrections } = await import("../scripts/news-qa");
  assert.equal(applyCorrections("ثنائي شون ليجاسي ودوريان"), "ثنائي شون ليغاسي ودوريان");
  const bad = fs.readdirSync("content/news").filter(f => f.endsWith(".md") && /شون ليجاسي|سامانثا إيرفين تستعد لتصبح مصارعة/.test(fs.readFileSync(`content/news/${f}`, "utf-8").replace(/^permalink:.*$/m, "")));
  assert.deepEqual(bad, []);
  assert.match(fs.readFileSync("editorial/style-guide.md", "utf-8"), /free agent.*مش مصارع/);
});

test("شعار شانتل مونرو بيتصلح ومفيش خبر فيه «اقتراب انعكاس المثالية» (INCIDENTS #798)", async () => {
  const { applyCorrections } = await import("../scripts/news-qa");
  assert.ok(!applyCorrections("ووجهت رسالة تؤكد فيها اقتراب انعكاس المثالية نحوهم").includes("اقتراب انعكاس"));
  const bad = fs.readdirSync("content/news").filter(f => f.endsWith(".md") && fs.readFileSync(`content/news/${f}`, "utf-8").includes("اقتراب انعكاس المثالية"));
  assert.deepEqual(bad, []);
});

test("Gargano is جارجانو, Michin is ميتشين, Ricky Saints is ريكي سينتس everywhere (INCIDENTS #800)", async () => {
  const { applyCorrections } = await import("../scripts/news-qa");
  assert.equal(applyCorrections("جوني غارغانو وجوني غارجانو"), "جوني جارجانو وجوني جارجانو");
  assert.equal(applyCorrections("ضد ميشين وبي فاب"), "ضد ميتشين وبي فاب");
  assert.equal(applyCorrections("ريكي سانتس"), "ريكي سينتس");
  const names = JSON.parse(fs.readFileSync("scripts/wrestler-names.json", "utf-8"));
  assert.equal(names["Ricky Saints"], "ريكي سينتس");
  const bad = fs.readdirSync("content/news").filter(f => f.endsWith(".md") && /غارجانو|غارغانو|(?<![؀-ۿ])ميشين(?![؀-ۿ])/.test(fs.readFileSync(`content/news/${f}`, "utf-8").replace(/^(permalink|social_\w+):.*$/mg, "")));
  assert.deepEqual(bad, []);
});

test("«ميجان باين» و«البطولة» بشكلهم الصح في كل الأخبار (INCIDENTS #802)", async () => {
  const { applyCorrections } = await import("../scripts/news-qa");
  assert.equal(applyCorrections("ميغان باين تفوز بالبطوله"), "ميجان باين تفوز بالبطولة");
  const bad = fs.readdirSync("content/news").filter(f => f.endsWith(".md") && /ميغان باين|البطوله|سانتس/.test(fs.readFileSync(`content/news/${f}`, "utf-8").replace(/^(permalink|social_\w+):.*$/mg, "")));
  assert.deepEqual(bad, []);
});

test("«لسماع اسم البطلة» و«صورة متحركة تعبر عن الخجل» بيتصلحوا (INCIDENTS #804)", async () => {
  const { applyCorrections } = await import("../scripts/news-qa");
  assert.equal(applyCorrections("للاستعداد لسماع لقب البطلة الجديدة"), "للاستعداد لسماع اسم البطلة الجديدة");
  assert.equal(applyCorrections("مع صورة متحركة لخجول"), "مع صورة متحركة تعبر عن الخجل");
  const bad = fs.readdirSync("content/news").filter(f => f.endsWith(".md") && /لسماع لقب البطلة|صورة متحركة لخجول/.test(fs.readFileSync(`content/news/${f}`, "utf-8")));
  assert.deepEqual(bad, []);
});

test("«ليفيسك» و«فعل الاثنين معا» بيتصلحوا (INCIDENTS #805)", async () => {
  const { applyCorrections } = await import("../scripts/news-qa");
  assert.equal(applyCorrections("بول 'تريبل إتش' ليفيك"), "بول 'تريبل إتش' ليفيسك");
  assert.equal(applyCorrections("لم أجرب فعلهم معا"), "لم أجرب فعل الاثنين معا");
  const bad = fs.readdirSync("content/news").filter(f => f.endsWith(".md") && /ليفيك|فعلهم معا/.test(fs.readFileSync(`content/news/${f}`, "utf-8")));
  assert.deepEqual(bad, []);
});

test("«هامس» بدل «هايز» بتتصلح (INCIDENTS #806)", async () => {
  const { applyCorrections } = await import("../scripts/news-qa");
  assert.equal(applyCorrections("أوضح هامس أنه شعر بالامتنان"), "أوضح هايز أنه شعر بالامتنان");
  const bad = fs.readdirSync("content/news").filter(f => f.endsWith(".md") && /(^|[\s«"'،.])هامس([\s»"'،.]|$)/m.test(fs.readFileSync(`content/news/${f}`, "utf-8")));
  assert.deepEqual(bad, []);
});

// INCIDENTS #807: the odd form «خصمتها» (her opponent) was in 30 stories; «منافستها» is simpler.
test("«خصمتها» is corrected to «منافستها» (INCIDENTS #807)", async () => {
  const { applyCorrections } = await import("../scripts/news-qa");
  assert.equal(applyCorrections("ضد خصمتها وبخصمتها"), "ضد منافستها وبمنافستها");
  const bad = fs.readdirSync("content/news").filter(f => f.endsWith(".md") && /خصمتها/.test(fs.readFileSync(`content/news/${f}`, "utf-8").replace(/^permalink:.*$/m, "")));
  assert.deepEqual(bad, []);
});

// INCIDENTS #808: football score wording «بهدف لصفر» for a wrestling series.
test("«التأخر بهدف لصفر» is corrected (INCIDENTS #808)", async () => {
  const { applyCorrections } = await import("../scripts/news-qa");
  assert.equal(applyCorrections("إن التأخر بهدف لصفر ليس بداية"), "إن التأخر بنتيجة 1-0 ليس بداية");
  const bad = fs.readdirSync("content/news").filter(f => f.endsWith(".md") && /بهدف لصفر/.test(fs.readFileSync(`content/news/${f}`, "utf-8")));
  assert.deepEqual(bad, []);
});

// INCIDENTS #811: «لججون», «للقسم X» and «تصريحات أدلى بها تقارير» in the Slater / MVP stories.
test("broken Slater/MVP phrases are corrected (INCIDENTS #811)", async () => {
  const { applyCorrections } = await import("../scripts/news-qa");
  assert.equal(applyCorrections("الأخير لججون سينا"), "الأخير لجون سينا");
  assert.equal(applyCorrections("على بطولة TNA للقسم X وكبطل للقسم X"), "على بطولة TNA X Division وكبطل X Division");
  assert.equal(applyCorrections("بعد تصريحات أدلى بها تقارير صحفية"), "بعد تقارير صحفية");
  const bad = fs.readdirSync("content/news").filter(f => f.endsWith(".md") && /لججون|للقسم X/.test(fs.readFileSync(`content/news/${f}`, "utf-8")));
  assert.deepEqual(bad, []);
});

// INCIDENTS #812: glued dual verbs («يقدمانته») and an unclosed " quote block reached stories.
test("glued dual verbs and unclosed straight quotes are blocked, and no story keeps them", async () => {
  const { checkArticle } = await import("../scripts/news-qa");
  const title = "عنوان تجريبي طويل بما يكفي للفحص هنا";
  const pad = " كلام عادي".repeat(80);
  assert.ok(checkArticle(title, "أعجب المسؤولون بما يقدمانه" + pad).some(i => i.code === "dual_form"));
  assert.ok(checkArticle(title, "ثم انتقدا مجريات النزال" + pad).some(i => i.code === "dual_form"));
  assert.ok(checkArticle(title, '> "بعض الناس يرثون الممتلكات والبعض يتمسك بالذكريات.\n\n' + pad).some(i => i.code === "unclosed_straight_quote"));
  assert.ok(!checkArticle(title, '> "بعض الناس يرثون الممتلكات."\n\n' + pad).some(i => i.code === "unclosed_straight_quote"));
  const bad = fs.readdirSync("content/news").filter(f => f.endsWith(".md") && /يقدمانها|يخوضانه|وانتقدا|يخططان لها/.test(fs.readFileSync(`content/news/${f}`, "utf-8").split("\n").filter(l => !l.startsWith("permalink:")).join("\n")));
  assert.deepEqual(bad, []);
});
