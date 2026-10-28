import test from "node:test";
import assert from "node:assert/strict";
import { checkArticle, applyCorrections, autoFix, BLOCKING_QA_CODES } from "../scripts/news-qa.ts";

test("a long number spelled in words in the TITLE is blocked (INCIDENTS #520: «ألف وثلاثمائة وستة عشر يوما»)", () => {
  const issues = checkArticle("رومان رينز يكشف صعوبة تصديق نهاية فترة احتفاظه بلقبه لمدة ألف وثلاثمائة وستة عشر يوما", "نص الخبر هنا.");
  assert.ok(issues.some((i) => i.code === "spelled_number" && i.field === "title"));
  assert.ok(!checkArticle("رومان رينز يحتفظ بلقبه لمدة 1316 يوما", "نص.").some((i) => i.code === "spelled_number"));
});

test("a sentence ending on «وقال.» and the duals «الاثنتين» / «ليلتا» are blocked (INCIDENTS #535)", () => {
  const body = "تحدث رويس كيز عن انضمام هايز، مشيرا إلى أن هايز يمتلك جانبا عدوانيا لم يره الجمهور بعد، وقال.\n\nنص آخر طويل بما يكفي.";
  assert.ok(checkArticle("رويس كيز يتحدث عن هايز", body).some((i) => i.code === "dangling_speech"));
  assert.ok(!checkArticle("رويس كيز يتحدث عن هايز", "وقال كيز إن الفريق قوي جدا.").some((i) => i.code === "dangling_speech"));
  // a colon before a blockquote is a normal way to introduce a quote, not a lost quote
  assert.ok(!checkArticle("رويس كيز يتحدث عن هايز", "وفي مقابلة، سئل رينز عن المخرج، حيث قال:\n\n> لا أعرف حقا.\n\nنص آخر.").some((i) => i.code === "dangling_speech"));
  assert.ok(checkArticle("رويس كيز يتحدث عن هايز", "وفي مقابلة، سئل رينز عن المخرج، حيث قال:\n\nنص آخر طويل.").some((i) => i.code === "dangling_speech"));
  assert.ok(checkArticle("عنوان", "المواجهة بين الاثنتين مهمة.").some((i) => i.code === "dual_noun"));
  assert.ok(checkArticle("عنوان", "ليلتا العرض كانتا ممتازتين.").some((i) => i.code === "dual_noun"));
  assert.ok(!checkArticle("عنوان", "في يوم الاثنين أقيم العرض.").some((i) => i.code === "dual_noun"));
  assert.ok(checkArticle("عنوان", "بينما كان طفلان يقفان بجانبها وتواصل والد الطفلين معها.").some((i) => i.code === "dual_noun"));
  assert.ok(checkArticle("عنوان", "اثنان من الأطفال يقفون بجانبها وتواصل والد الأطفال معها.").every((i) => i.code !== "dual_noun"));
});

test("dual verbs «يعرفان / الاثنان» and a bold heading line opening the story are blocked (INCIDENTS #558)", () => {
  const t = "جيفون إيفانز يتحدث عن علاقته بجاكوب فاتو";
  assert.ok(checkArticle(t, "بدأ الاثنان مسيرتهم في الاتحادات المستقلة ويعرفان حجم التعب المطلوب للوصول إلى القمة.").some((i) => i.code === "dual_form"));
  assert.ok(!checkArticle(t, "بدأ كل منهم مسيرته في الاتحادات المستقلة ويعرف حجم التعب المطلوب للوصول إلى القمة.").some((i) => i.code === "dual_form"));
  assert.ok(checkArticle(t, "**المواجهة الأولى: نزال فرق للسيدات**\n\nأعلن اتحاد AEW عن نزال جديد.").some((i) => i.code === "stray_heading"));
  assert.ok(!checkArticle(t, "أعلن اتحاد AEW عن نزال جديد في **عرض كبير** قريبا.").some((i) => i.code === "stray_heading"));
});

test("the names glossary has no dual-form champion titles (INCIDENTS #559)", async () => {
  const fs = await import("node:fs");
  const names = JSON.parse(fs.readFileSync(new URL("../scripts/wrestler-names.json", import.meta.url), "utf8")) as Record<string, string>;
  const dual = Object.entries(names).filter(([, v]) => /(?:بطلتا|بطلا|العالميتان|العالميان)(?![ء-ي])/.test(String(v)));
  assert.deepEqual(dual, []);
});

test("a tatweel before an ARABIC name is removed and blocked (INCIDENTS #564)", async () => {
  const { autoFix } = await import("../scripts/news-qa.ts");
  assert.equal(autoFix("إعلان ضخم لـبيكي لينش ورد بـتايتشي"), "إعلان ضخم لبيكي لينش ورد بتايتشي");
  const t = "ساتوشي كوجيما مطالب بتحقيق شرط الوزن لمواجهة يوه في عرض NJPW الخاص بـتايتشي";
  assert.ok(checkArticle(t, "نص الخبر هنا طويل بما يكفي.").some((i) => i.code === "tatweel_before_arabic" && i.field === "title"));
  assert.ok(!checkArticle(t.replace("بـتايتشي", "بتايتشي"), "نص الخبر هنا.").some((i) => i.code === "tatweel_before_arabic"));
});

test("a tatweel followed by a space before an Arabic name is fixed and blocked", async () => {
  const { autoFix } = await import("../scripts/news-qa.ts");
  assert.equal(autoFix("أطاحت بها وبـ إيجنت زيرو"), "أطاحت بها وبإيجنت زيرو");
  assert.ok(checkArticle("عنوان", "نص الخبر وبـ إيجنت زيرو طويل بما يكفي.").some((i) => i.code === "tatweel_before_arabic"));
  assert.ok(!checkArticle("عنوان", "نص الخبر لـ ذا روك طويل بما يكفي.").some((i) => i.code === "tatweel_before_arabic"));
});

test("no published Arabic story has a tatweel before an Arabic letter (INCIDENTS #564)", async () => {
  const fs = await import("node:fs");
  const dir = new URL("../content/news/", import.meta.url);
  const bad = fs.readdirSync(dir).filter((f) => f.endsWith(".md") && /\u0640(?=[\u0621-\u064A])/.test(fs.readFileSync(new URL(f, dir), "utf8").replace(/^permalink:.*$/m, "")));
  assert.deepEqual(bad, []);
});

test("dual_form: «تزوجا» is blocked, but the name «بي جي فازا» (PJ Vasa) is not a dual verb (INCIDENTS #570)", () => {
  const codes = (b: string) => checkArticle("عنوان واضح للاختبار", b, []).map((i) => i.code);
  assert.ok(codes("تمت خطبة الثنائي ثم تزوجا رسميا في جامايكا خلال يونيو 2026 وسط حضور كبير من الأصدقاء والعائلة.").includes("dual_form"));
  assert.ok(!codes("وطلب بي جي فازا منها أن تجرب ذلك معه في الأسبوع القادم بعد انتهاء النزال الرئيسي في العرض.").includes("dual_form"));
});

test("«ى» for «ي» in nisba words and a dropped show name are blocked (INCIDENTS #594)", () => {
  const codes = (b: string) => checkArticle("عنوان واضح للاختبار", b, []).map((i) => i.code);
  assert.ok(codes("سيناقش الثنائى مسيرتهم العالمية وماضي ومستقبل المصارعة مع تلقي أسئلة الجماهير المتابعة.").includes("alif_maqsura_ya"));
  assert.ok(codes("عن نزالهم التاريخى السابق في الاتحاد وكواليس تروى لأول مرة للجمهور المتابع.").includes("alif_maqsura_ya"));
  assert.ok(!codes("سيناقش الثنائي مسيرتهم العالمية وأعلى مستوى وصلوا إليه في الاتحاد.").includes("alif_maqsura_ya"));
  assert.ok(codes("أوضحت كيتلين خلال استضافتها في برنامج أن المخطط الأصلي كان يقضي بخروجها مبكرا من النزال.").includes("dropped_show_name"));
  assert.ok(!codes("أوضحت كيتلين خلال استضافتها في برنامج Insight مع كريس فان فليت أن المخطط الأصلي كان خروجها مبكرا.").includes("dropped_show_name"));
});

test("a wrestler teaming with himself is blocked (INCIDENTS #602: «فليتشر … سيتعاون مع كايل فليتشر»)", () => {
  const bad = "ويستعد فليتشر لخوض تحد جديد في عرض WrestleDream، حيث سيتعاون مع كايل فليتشر لمواجهة فريق ذا يانغ باكس.";
  assert.ok(checkArticle("عنوان واضح للخبر هنا", bad).some((i) => i.code === "self_partner"));
  const ok = "ويستعد فليتشر لخوض تحد جديد في عرض WrestleDream، حيث سيتعاون مع مارك ديفيس لمواجهة فريق ذا يانغ باكس.";
  assert.ok(!checkArticle("عنوان واضح للخبر هنا", ok).some((i) => i.code === "self_partner"));
  assert.ok(!checkArticle("عنوان واضح للخبر هنا", "يتعاون كوفي كينغستون مع أوستن كريد في الحلبة.").some((i) => i.code === "self_partner"));
});

test("«الحدف» is corrected to «الهدف» (INCIDENTS #602)", async () => {
  const { applyCorrections } = await import("../scripts/news-qa.ts");
  assert.equal(applyCorrections("لتحقيق هذا الحدف"), "لتحقيق هذا الهدف");
});

test("a relative with the same surname is not a self-partner (INCIDENTS #602)", () => {
  assert.ok(!checkArticle("عنوان واضح للخبر هنا", "ويدافع نيك نيميث عن لقبه، قبل أن يتحد مع شقيقه رايان نيميث في النزال القادم.").some((i) => i.code === "self_partner"));
});

test("an English quote left untranslated in the Arabic story blocks publishing (INCIDENTS #614: John Cena's blockquote)", async () => {
  const { BLOCKING_QA_CODES } = await import("../scripts/news-qa.ts");
  const body = "تحدث سينا عن اعتزاله.\n\n> When I retired from WWE, everybody's like, 'Man, you're doing it on your own terms.' I want to do it forever.\n\nنص آخر.";
  assert.ok(checkArticle("جون سينا يتحدث عن اعتزاله", body).some((i) => i.code === "english_quote"));
  assert.ok(BLOCKING_QA_CODES.includes("english_quote"));
});

test("«العدواة» and the broken «ريكي سكر وصا» are corrected (INCIDENTS #622)", async () => {
  const { applyCorrections } = await import("../scripts/news-qa.ts");
  assert.equal(applyCorrections("العدواة المشتعلة"), "العداوة المشتعلة");
  assert.equal(applyCorrections("ريكي سكر وصا وإلياس"), "ريكي سوسا وإلياس");
});

test("a draw / no-contest is never a «🏆 الفائز» line (INCIDENTS #635: «الفائز: انتهى النزال بالتعادل»)", async () => {
  const { noWinnerLines } = await import("../scripts/news-qa.ts");
  const bad = "**الحدث الرئيسي**\n\nنزال.\n\n🏆 **الفائز:** انتهى النزال بالتعادل لانتهاء الوقت\n\n🏆 **الفائز:** لا يوجد (تعادل بالعد خارج الحلبة)\n\n🏆 **الفائز:** ديونا بورازو\n";
  assert.ok(checkArticle("نتائج عرض ROH TV", bad + "x".repeat(300)).some((i) => i.code === "draw_as_winner"));
  const fixed = noWinnerLines(bad);
  assert.match(fixed, /🤝 \*\*النتيجة:\*\* انتهى النزال بالتعادل لانتهاء الوقت/);
  assert.match(fixed, /🤝 \*\*النتيجة:\*\* تعادل بالعد خارج الحلبة/);
  assert.match(fixed, /🏆 \*\*الفائز:\*\* ديونا بورازو/);
  assert.ok(!checkArticle("نتائج عرض ROH TV", fixed + "x".repeat(300)).some((i) => i.code === "draw_as_winner"));
  const { readdirSync, readFileSync } = await import("node:fs");
  const left = readdirSync("content/news").filter((f) => f.endsWith(".md") && noWinnerLines(readFileSync(`content/news/${f}`, "utf-8")) !== readFileSync(`content/news/${f}`, "utf-8"));
  assert.deepEqual(left, []);
});

test("«المصارعيم» and «حمل للقلب» are corrected (INCIDENTS #635)", async () => {
  const { applyCorrections } = await import("../scripts/news-qa.ts");
  assert.equal(applyCorrections("أكثر المصارعيم على فترتي حمل للقلب"), "أكثر المصارعين على فترتي حمل اللقب");
});

test("a finished match told in the present tense («تواجه ار تروث وداميان بريست») is blocked in results, not in previews (INCIDENTS #645)", () => {
  const result = "نتائج عرض.\n\n**المواجهة الثالثة: نزال فردي**\n\nتواجه ار تروث وداميان بريست في نزال فردي، وانتهى النزال بتوقف المواجهة.\n\n🏆 **الفائز:** داميان بريست";
  assert.ok(checkArticle("نتائج عرض WWE SmackDown", result).some((i) => i.code === "result_present_tense"));
  const fixed = result.replace("تواجه ار تروث وداميان بريست", "واجه ار تروث داميان بريست");
  assert.ok(!checkArticle("نتائج عرض WWE SmackDown", fixed).some((i) => i.code === "result_present_tense"));
  const preview = "يعلن الاتحاد عن العرض القادم.\n\nتواجه ار تروث وداميان بريست في نزال فردي في العرض القادم.";
  assert.ok(!checkArticle("نزال قادم", preview).some((i) => i.code === "result_present_tense"));
});

test("«الركلة القاضية / الركلة المباشرة» for a Punt Kick is blocked, «ركلة البانت» passes (INCIDENTS #646)", () => {
  const t = "كودي رودز يوجه ركلة البانت إلى بارون كوربين";
  assert.ok(checkArticle("كودي رودز يسحق بارون كوربين بالركلة القاضية", "نص طويل بما يكفي للخبر.").some((i) => i.code === "punt_kick_wording"));
  assert.ok(checkArticle(t, "وجه كودي رودز ضربة قاضية باستخدام الركلة المباشرة إلى بارون كوربين.").some((i) => i.code === "punt_kick_wording"));
  assert.ok(checkArticle(t, "أطاح كودي رودز بخصمه بركلة البانت القاضية في ختام العرض.").some((i) => i.code === "punt_kick_wording"));
  assert.ok(!checkArticle(t, "أنهى كودي رودز العرض بتوجيه ركلة البانت إلى بارون كوربين.").some((i) => i.code === "punt_kick_wording"));
});

test("«Lighting Match» (source typo) becomes «Lightning Match» (INCIDENTS #648)", async () => {
  const { applyCorrections } = await import("../scripts/news-qa.ts");
  assert.equal(applyCorrections("**المواجهة الثانية: نزال سريع (Lighting Match)**"), "**المواجهة الثانية: نزال سريع (Lightning Match)**");
  assert.equal(applyCorrections("Lightning Match"), "Lightning Match");
});

test("«نزال فردي» above a «الفائز: فريق …» line is blocked (INCIDENTS #672)", () => {
  const bad = "نتائج عرض.\n\n**المواجهة الرابعة: نزال فردي**\n\nحقق فريق موتور سيتي ماشين غانز الفوز على فريق إف تي آر.\n\n🏆 **الفائز:** فريق موتور سيتي ماشين غانز";
  assert.ok(checkArticle("نتائج عرض AEW WrestleDream", bad).some((i) => i.code === "singles_label_team_winner"));
  assert.ok(!checkArticle("نتائج عرض AEW WrestleDream", bad.replace("نزال فردي", "نزال فرق")).some((i) => i.code === "singles_label_team_winner"));
  assert.ok(!checkArticle("نتائج عرض AEW WrestleDream", bad.replace("فريق موتور", "إدي إدواردز").replace("**الفائز:** فريق", "**الفائز:**")).some((i) => i.code === "singles_label_team_winner"));
});

// INCIDENTS #673: «بفوز فريقي ديث رايدرز وذا دوجز» (dual construct of «فريق») reached the site.
test('«فريقي X وY» is a blocked dual noun', () => {
  const body = 'وانتهى النزال بفوز فريقي ديث رايدرز وذا دوجز في عرض AEW. '.repeat(8);
  assert.ok(checkArticle('عنوان عربي كامل للخبر هنا', body, []).some(i => i.code === 'dual_noun'));
});

test("«نزال فرق سداسي» with four winners is blocked (INCIDENTS #689)", () => {
  const bad = "نتائج عرض.\n\n**الحدث الرئيسي (Main Event): نزال فرق سداسي**\n\nفاز الفريق الأول.\n\n🏆 **الفائز:** كيفن أوينز وتوني دي أنجيلو وشايلو هيل وكيندال غراي";
  assert.ok(checkArticle("نتائج عرض WWE NXT Live", bad).some((i) => i.code === "team_size_label"));
  assert.ok(!checkArticle("نتائج عرض WWE NXT Live", bad.replace("سداسي", "ثماني")).some((i) => i.code === "team_size_label"));
  assert.ok(!checkArticle("نتائج عرض WWE NXT Live", bad.replace("وكيندال غراي", "").replace("وشايلو هيل", "")).some((i) => i.code === "team_size_label"));
});

test("«نزال فرق سداسي» with four indie winners under «الفائزون» is blocked (INCIDENTS #938)", () => {
  const bad = "نتائج عرض.\n\n**المواجهة الرابعة: نزال فرق سداسي**\n\nفاز فريق كريستون كريد وهازاردوس وجوني تاب ومارك أندروز على فريق مات غاتلين.\n\n🏆 **الفائزون:** كريستون كريد وهازاردوس وجوني تاب ومارك أندروز";
  assert.ok(checkArticle("نتائج عرض ATTACK! Goosebumps 11", bad).some((i) => i.code === "team_size_label"));
  assert.ok(!checkArticle("نتائج عرض ATTACK! Goosebumps 11", bad.replace("سداسي", "ثماني")).some((i) => i.code === "team_size_label"));
  assert.ok(!checkArticle("نتائج عرض ATTACK! Goosebumps 11", bad.replace(" ومارك أندروز", "").replace(" ومارك أندروز", "")).some((i) => i.code === "team_size_label"));
});

test("Becky/ATTACK/Maclin wording fixes are applied to every story (INCIDENTS #938)", () => {
  assert.equal(applyCorrections("نجح البطل درو باركر في الدفاع عن لقبه بنجاح ضد كريس برونسون"), "نجح البطل درو باركر في الدفاع عن لقبه ضد كريس برونسون");
  assert.equal(applyCorrections("حركة مانهادل سلام"), "حركة مانهاندل سلام");
  assert.equal(applyCorrections("في صالة لوكو كلاب بمدينة برستل"), "في صالة لوكو كلوب بمدينة بريستول");
  assert.equal(applyCorrections("كان النزال رسالة حب لطفولتهم"), "كان النزال تحية لطفولتهم");
  assert.equal(applyCorrections("يتابعون ظهروه التلفزيوني"), "يتابعون ظهوره التلفزيوني");
});

test("Austin/Flair/Stone wording fixes are applied to every story (INCIDENTS #940)", () => {
  assert.equal(applyCorrections("موسمه الأول في سباقات الطرق الوعيرة"), "موسمه الأول في سباقات الطرق الوعرة");
  assert.equal(applyCorrections("نقله إلى مستشفى تاما جنرال هوسبيتال"), "نقله إلى مستشفى تامبا جنرال هوسبيتال");
  assert.equal(applyCorrections("الفترة الأهم والأكثر مكافأة في مشواره"), "الفترة الأهم والأكثر إرضاء في مشواره");
  assert.equal(applyCorrections("كانت الأكثر متعة ومكافأة"), "كانت الأكثر متعة وإرضاء");
  assert.equal(applyCorrections("المصارع تاما تونغا"), "المصارع تاما تونغا");
});

test("a stray «وة» fragment («هانك وة تانك») is blocked as a broken word (INCIDENTS #725)", () => {
  assert.ok(checkArticle("عنوان", "نزال بين فريق ذا كريد برذرز وفريق هانك وة تانك في ربع النهائي.").some((i) => i.code === "broken_word"));
  assert.ok(!checkArticle("عنوان", "نزال بين فريق ذا كريد برذرز وفريق هانك وتانك في ربع النهائي.").some((i) => i.code === "broken_word"));
});

// INCIDENTS #777: «2 عرض متتاليين» (a dual in disguise) and a sportsbook advert («odds courtesy of MyBookie») reached the site.
test('masked duals (2 عرض / متتاليين) and betting-site adverts are blocked', async () => {
  const { checkArticle, BLOCKING_QA_CODES } = await import('../scripts/news-qa');
  const a = checkArticle('عنوان', 'سيشهد ذلك اليوم إقامة 2 عرض متتاليين في الصالة.').map(i => i.code);
  assert.ok(a.includes('dual_noun'));
  assert.ok(!checkArticle('عنوان', 'يقام العرض يوم 2 نوفمبر القادم في بروكلين.').some(i => i.code === 'dual_noun'));
  const b = checkArticle('جدول نزالات UFC 333 برعاية MyBookie', 'الاحتمالات من MyBookie.').map(i => i.code);
  assert.ok(b.includes('betting_promo') && BLOCKING_QA_CODES.includes('betting_promo'));
});

test("a raw «المواجهة …:» result line left at the end of a story is blocked (INCIDENTS #826)", () => {
  const body = "توج لويس مانتي بلقب بطولة GHC الوطنية بعد فوزه.\n\nالمواجهة الثانية: نزال على بطولة GHC الوطنية\nلويس مانتي يهزم ناوميتشي ماروفوجي";
  assert.ok(checkArticle("لويس مانتي يتوج ببطولة GHC", body).some((i) => i.code === "stray_result_block"));
  assert.ok(!checkArticle("لويس مانتي يتوج ببطولة GHC", "**المواجهة الأولى: نزال فرق**\n\nفاز فريق أ.").some((i) => i.code === "stray_result_block"));
});

// INCIDENTS #836: an image caption in English («In 2019, Kofi defeated …») stayed as its own line in an Arabic story.
test('a whole English caption line inside an Arabic story is blocked', () => {
  const body = 'تحدث كوفي كينغستون عن فترته في WWE.\n\nIn 2019, Kofi defeated Bryan Danielson at WrestleMania 35 to become WWE Champion\n\nوأضاف أنها كانت حلم طفولة.';
  assert.ok(checkArticle('عنوان', body).some((i) => i.code === 'english_caption_line'));
  assert.ok(!checkArticle('عنوان', 'تحدث كوفي كينغستون عن فترته في WWE.\n\n> "I really believed it was my time to win the title that night"\n\nوأضاف أنها حلم.').some((i) => i.code === 'english_caption_line'));
  assert.ok(!checkArticle('عنوان', 'عرض AEW Dynamite الليلة\n\nWWE Raw').some((i) => i.code === 'english_caption_line'));
});

test("dual adjective «مقيدتين» is blocked as a dual form (INCIDENTS #853)", () => {
  assert.ok(checkArticle("عنوان", "بعد أن كانت يداه مقيدتين مع شركته السابقة عاد للتألق.").some((i) => i.code === "dual_noun"));
  assert.ok(!checkArticle("عنوان", "بعد أن كان مقيدا مع شركته السابقة عاد للتألق.").some((i) => i.code === "dual_noun"));
});

test("the story must not talk about «the source» (INCIDENTS #854: «بلا نتيجة محددة في المصدر»)", () => {
  const t = "نتائج عرض تجريبي كامل";
  assert.ok(checkArticle(t, "انتهى النزال بلا نتيجة محددة في المصدر.\n\nنص آخر طويل بما يكفي.").some((i) => i.code === "source_meta"));
  assert.ok(checkArticle(t, "خاض الفريق مواجهة، ولم يذكر المصدر نتيجة النزال.").some((i) => i.code === "source_meta"));
  assert.ok(!checkArticle(t, "ولم يتم الإعلان عن نتيجة النزال. وقال مصدر مطلع إن الصفقة قريبة.").some((i) => i.code === "source_meta"));
});

test("a lone letter from a split name («إ جي كليري») is blocking and retryable, and the correction fixes it (INCIDENTS #855)", async () => {
  const { BLOCKING_QA_CODES, RETRYABLE_QA_CODES, applyCorrections } = await import("../scripts/news-qa.ts");
  assert.ok(BLOCKING_QA_CODES.includes("truncated_word") && RETRYABLE_QA_CODES.includes("truncated_word"));
  assert.ok(checkArticle("عنوان تجريبي", "هزم أوستن لوك البطل إ جي كليري بالاستبعاد.\n\nنص آخر طويل بما يكفي.").some((i) => i.code === "truncated_word"));
  assert.equal(applyCorrections("هزم أوستن لوك البطل إ جي كليري"), "هزم أوستن لوك البطل إل جيه كليري");
});

test("«ديقاز» and «إكسبرودير» are corrected automatically (INCIDENTS #857)", async () => {
  const { applyCorrections } = await import("../scripts/news-qa.ts");
  assert.equal(applyCorrections("بطلة WWE للديقاز السابقة"), "بطلة WWE للديفاز السابقة");
  assert.equal(applyCorrections("ونفذ حركة إكسبرودير"), "ونفذ حركة إكسبلودر");
});

test("dual verb «يتحديان» and dual noun «كمالكين» are blocked (INCIDENTS #858)", () => {
  assert.ok(checkArticle("بينتا وجيفون إيفانز يتحديان على بطولة WWE للفرق", "نص خبر طويل بما يكفي ليمر الفحص الأساسي بدون مشاكل أخرى.").some((i) => i.code === "dual_form"));
  assert.ok(checkArticle("عنوان", "انضم مارشال كمالكين جزئيين جدد للنادي مع شريكه في العمل.").some((i) => i.code === "dual_form"));
  assert.ok(!checkArticle("بينتا وجيفون إيفانز ضد ذا فيجن على بطولة WWE للفرق", "نص خبر طويل بما يكفي ليمر الفحص الأساسي بدون مشاكل أخرى.").some((i) => i.code === "dual_form"));
});

test("applyCorrections fixes the doubled «عرضا جديدا من عرض» opener", () => {
  assert.equal(applyCorrections("بث اتحاد NWA عرضا جديدا من عرض NWA Powerrr يوم 24 أكتوبر"), "بث اتحاد NWA عرض NWA Powerrr يوم 24 أكتوبر");
});

test("dual verbs «ليهزما / ويتوجا» and «تخلي + اسم بضمير» are blocked (INCIDENTS #862)", async () => {
  const { BLOCKING_QA_CODES } = await import("../scripts/news-qa.ts");
  const t = "سامي زين يتحدث عن عرض WWE Elimination Chamber 2023";
  assert.ok(BLOCKING_QA_CODES.includes("tarakki_without_an"));
  assert.ok(checkArticle(t, "حيث تحالف مع كيفن أوينز ليهزما فريق ذا أوسوز ويتوجا ببطولة WWE للفرق.\n\nنص آخر طويل بما يكفي.").some((i) => i.code === "dual_form"));
  assert.ok(!checkArticle(t, "حيث تحالف مع كيفن أوينز وهزم فريق ذا أوسوز وتوج معه ببطولة WWE للفرق.\n\nنص آخر طويل بما يكفي.").some((i) => i.code === "dual_form"));
  assert.ok(checkArticle(t, "وذلك قبل تخلي قناعه الذي اشتهر به.\n\nنص آخر طويل بما يكفي.").some((i) => i.code === "tarakki_without_an"));
  // «التخلي عن» و«التخلي تماما عن» و«التخلي وإلغاء» عربي سليم
  for (const ok of ["وذلك قبل التخلي عن قناعه.", "قرر التخلي تماما عن دوره.", "وجاء قرار التخلي وإلغاء اللقب."])
    assert.ok(!checkArticle(t, ok + "\n\nنص آخر طويل بما يكفي.").some((i) => i.code === "tarakki_without_an"), ok);
});

test("لقب المصارع «رامبيج» بين علامتين مش اسم عرض (INCIDENTS #862)", () => {
  const t = "الإفراج عن راجا جاكسون";
  assert.ok(!checkArticle(t, "نجل الأسطورة كوينتون «رامبيج» جاكسون خرج من السجن بعد قضاء فترة العقوبة كاملة.\n\nنص آخر طويل بما يكفي.").some((i) => i.code === "known_wrong" || i.code === "transliterated_show"));
  assert.ok(checkArticle(t, "شاهد عرض رامبيج الليلة على القناة.\n\nنص آخر طويل بما يكفي.").some((i) => i.code === "transliterated_show"));
  assert.equal(applyCorrections("نجم UFC السابق كوينتون «رامبيج» جاكسون"), "نجم UFC السابق كوينتون «رامبيج» جاكسون");
  assert.equal(applyCorrections("شاهد عرض رامبيج الليلة"), "شاهد عرض AEW Rampage الليلة");
});

test("«تقارير صحفية» never becomes the interviewer, and the glossary knows Jimmy House (INCIDENTS #869)", async () => {
  const { applyNamesGlossary } = await import("../scripts/fightful-watcher.ts");
  const t = "داستن رودس: جيمي هاوس سيكون إضافة رائعة لغرفة ملابس AEW";
  const bad = "وجاء هذا التفاعل بعد مقابلة صحفية أجراها تقارير صحفية مطلعة مع الموهبة السابقة في برنامج WWE I.D.";
  assert.ok(checkArticle(t, bad).some((i) => i.code === "scrubbed_reporter_interviewer"));
  const ok = "وجاء هذا التفاعل بعد تقرير صحفي عن الموهبة السابقة في برنامج WWE I.D.";
  assert.ok(!checkArticle(t, bad.replace("مقابلة صحفية أجراها تقارير صحفية مطلعة مع", "تقرير صحفي عن")).some((i) => i.code === "scrubbed_reporter_interviewer"));
  assert.ok(!applyCorrections(bad).includes("تقارير صحفية"));
  assert.equal(applyCorrections(bad), ok);
  // the English name left in the Arabic text is transliterated like every other wrestler
  assert.equal(applyNamesGlossary("أبدى رودس حماسه لانضمام House إلى اتحاد AEW"), "أبدى رودس حماسه لانضمام هاوس إلى اتحاد AEW");
  // …while the stable and the show names keep their own glossary entries
  assert.equal(applyNamesGlossary("فاز فريق House of Torture في الحدث الرئيسي"), "فاز فريق هاوس أوف تورتشر في الحدث الرئيسي");
});

test("«للمشجعين/بحضور مشجعين» جمع سليم مش مثنى — المثنى «مشجعان» بس (جولة مراقبة ٢٧-١٠)", () => {
  const t = "كودي رودز يتحدث عن المصارعة";
  const body = "أكد كودي رودز أن المصارعة مميزة بالنسبة للمشجعين، وأن الحضور الجماهيري كان كبيرا.\n\nنص آخر طويل بما يكفي.";
  assert.ok(!checkArticle(t, body).some((i) => i.code === "dual_noun"));
  assert.ok(!checkArticle(t, "حضر مشجعين كثيرون إلى الصالة لمشاهدة العرض.\n\nنص آخر طويل بما يكفي.").some((i) => i.code === "dual_noun"));
  assert.ok(checkArticle(t, "حضر مشجعان اثنان فقط إلى الصالة.\n\nنص آخر طويل بما يكفي.").some((i) => i.code === "dual_noun"));
});

test("«كبث» تتصلح لـ«بث»، واسم Steven Borden مش «أبناء الأسطورة ستينج» (INCIDENTS #872)", () => {
  assert.equal(applyCorrections("وفي كبث مسجل لعرض Barclays Center"), "وفي بث مسجل لعرض Barclays Center");
  assert.equal(applyCorrections("رغم تدخل داربي ألين وأبناء الأسطورة ستينج لإنقاذ الموقف"), "رغم تدخل داربي ألين وستيفن بوردن لإنقاذ الموقف");
  // «أبناء الأسطورة ستينج» عن الابنَين الاتنين عربي سليم ومش بيتلمس
  assert.equal(applyCorrections("تعرف الجمهور على أبناء الأسطورة ستينج خلال النزال"), "تعرف الجمهور على أبناء الأسطورة ستينج خلال النزال");
});

test("«بايج بوم إيه جي» بتتصلح، ومفيش حروف أجنبية في أي خبر (INCIDENTS #872)", async () => {
  assert.equal(applyCorrections("وتحالفوا مع بايج بوم إيه جي وكيو تي مارشال"), "وتحالفوا مع بيج بوم إيه جي وكيو تي مارشال");
  const fs = await import("node:fs");
  const foreign = /[\u0370-\u03FF\u0400-\u058F\u0590-\u05FF\u0900-\u0DFF\u0E00-\u0E7F\u1000-\u109F\u10A0-\u10FF\u1200-\u137F\u3040-\u30FF\u3400-\u9FFF\uAC00-\uD7AF]/;
  const bad: string[] = [];
  for (const dir of ["content/news", "content/news-en"]) {
    for (const f of fs.readdirSync(dir).filter((x) => x.endsWith(".md"))) {
      if (foreign.test(fs.readFileSync(`${dir}/${f}`, "utf8"))) bad.push(`${dir}/${f}`);
    }
  }
  assert.deepEqual(bad, []);
});

test("عنوان «مرور عام» ونص بيقول عامين/24 شهرا بيتمنع (INCIDENTS #874)", () => {
  const title = "كريس باي يتذكر إصابته التي غيرت مجرى حياته بعد مرور عام";
  const body = "تذكر المصارع كريس باي مرور 24 شهرا على إصابته القوية في الرقبة، مؤكدا أن العامين الماضيين كانا الأصعب في مسيرته.\n\nنص آخر طويل بما يكفي لاجتياز حد الطول.";
  assert.ok(checkArticle(title, body).some((i) => i.code === "title_period_mismatch"));
  // العنوان والنص متفقين على عامين: مفيش مشكلة
  assert.ok(!checkArticle("كريس باي يتذكر إصابته بعد عامين", body).some((i) => i.code === "title_period_mismatch"));
  // «العام الثاني» في جملة مالهاش علاقة بذكرى الإصابة مش سبب للرفض
  const other = "وقع كريس باي عقدا جديدا يمتد إلى العام الثاني من مسيرته مع الاتحاد، وقال إنه سعيد.\n\nنص آخر طويل بما يكفي لاجتياز حد الطول.";
  assert.ok(!checkArticle(title, other).some((i) => i.code === "title_period_mismatch"));
});

test("«قبل أن تنصرف انتباه الجماهير» is blocked — «انتباه» is masculine (INCIDENTS #895)", () => {
  const codes = (b: string) => checkArticle("لوغان بول يوضح سبب رفضه الرد على الجدل", b, []).map((i) => i.code);
  assert.ok(codes("موضحا أن موجات الأخبار السلبية تستمر 36 ساعة فقط قبل أن تنصرف انتباه الجماهير إلى أمر آخر.").includes("attention_verb"));
  assert.ok(!codes("موضحا أن موجات الأخبار السلبية تستمر 36 ساعة فقط قبل أن ينصرف انتباه الجماهير إلى أمر آخر.").includes("attention_verb"));
  assert.equal(applyCorrections("قبل أن تنصرف انتباه الجماهير إلى أمر آخر"), "قبل أن ينصرف انتباه الجماهير إلى أمر آخر");
});

test("a headline that names the wrestler after «نجم WWE» is not vague (live 2026-10-28)", () => {
  const body = "نص الخبر الطويل هنا بما يكفي لتجاوز الحد الأدنى لطول النص المطلوب في الفحص التلقائي للأخبار المنشورة على الموقع.";
  // the real names are in the headline: nothing to block
  assert.ok(!checkArticle("نجم WWE السابق جيمس إلسورث يؤكد انفتاحه على العودة بعد غياب ثماني سنوات", body).some((i) => i.code === "vague_title_subject"));
  assert.ok(!checkArticle("بطلة WWE NXT كيلاني جوردان تواجه صعوبة في جانب واحد من تدريبات المصارعة", body).some((i) => i.code === "vague_title_subject"));
  // the stand-in with a verb straight after the promotion is still vague (INCIDENTS #904)
  assert.ok(checkArticle("نجم TNA يجذب اهتمام أطراف خارجية مع اقتراب نهاية عقده", body).some((i) => i.code === "vague_title_subject"));
  assert.ok(checkArticle("أسطورة WWE يعلن اعتزاله المصارعة نهائيا", body).some((i) => i.code === "vague_title_subject"));
  assert.ok(checkArticle("بطل WWE السابق يريد العودة إلى الحلبة", body).some((i) => i.code === "vague_title_subject"));
});

test("a headline that says a match type was set must name it (INCIDENTS #922)", async () => {
  const { checkArticle, BLOCKING_QA_CODES, RETRYABLE_QA_CODES } = await import("../scripts/news-qa.ts");
  const body = "اشتعلت العداوة بين تافيون هايتس ومايلز بورن خلال عرض WWE NXT الأخير، واستقرت العجلة على نزال Weapons Wild الذي يسمح باستخدام الأسلحة داخل الحلبة.";
  const has = (t: string) => checkArticle(t, body, []).some((i: any) => i.code === "hidden_stipulation_title");
  assert.ok(has("تافيون هايتس ومايلز بورن يحددان نوع مواجهتهم في عرض WWE NXT Halloween Havoc"));
  assert.ok(has("الكشف عن شرط النزال بين هايتس وبورن"));
  assert.ok(!has("نزال Weapons Wild بين تافيون هايتس ومايلز بورن في عرض WWE NXT Halloween Havoc"));
  assert.ok(BLOCKING_QA_CODES.includes("hidden_stipulation_title") && RETRYABLE_QA_CODES.includes("hidden_stipulation_title"));
});

test("an announced or advertised match must be named in the headline (INCIDENTS #930)", async () => {
  const { checkArticle, BLOCKING_QA_CODES, RETRYABLE_QA_CODES, applyCorrections } = await import("../scripts/news-qa.ts");
  const body = "ظهرت إعلانات محلية تجمع بين غونتر وفين بالور على المواد الترويجية عند أحد مداخل ملعب الرياض سيزون، ورغم عدم صدور إعلان رسمي حتى الآن من إدارة WWE فإن النزال قريب.";
  const has = (t: string) => checkArticle(t, body, []).some((i: any) => i.code === "hidden_match_title");
  assert.ok(has("إشارة محتملة لمواجهة جديدة أخرى في عرض WWE Crown Jewel 2026"));
  assert.ok(has("الإعلان عن نزال جديد في عرض AEW Grand Slam France"));
  assert.ok(!has("إعلانات محلية تشير إلى نزال غونتر ضد فين بالور في عرض WWE Crown Jewel 2026"));
  assert.ok(!has("إيه جيه ستايلز يكشف عن الشرط الوحيد الذي قد يعيده من الاعتزال لخوض مواجهة جديدة"));
  assert.ok(BLOCKING_QA_CODES.includes("hidden_match_title") && RETRYABLE_QA_CODES.includes("hidden_match_title"));
  assert.equal(applyCorrections("رغم عدم صدور إعلان رسمى ترك اتحاد WWE NXT في موقف صعب"), "رغم عدم صدور إعلان رسمي ترك عرض WWE NXT في موقف صعب");
});

// Round 2026-10-28: «مصارعو AEW يعتقدون أن NJPW بطولة سهلة» — the source said NJPW is an easy *in* and the headline
// turned a federation into a championship. The check blocks it and the writer retries with a correct headline.
test("a federation is not a championship in a headline (round 2026-10-28)", async () => {
  const { checkArticle, BLOCKING_QA_CODES, RETRYABLE_QA_CODES } = await import("../scripts/news-qa.ts");
  const body = "أعرب كالوم نيومان عن استيائه من مصارعي AEW الذين يعتبرون الوصول إلى NJPW سهلا، وأكد أن التدريبات في الدوجو لا تقارن بحضور نزال واحد في عرض كبير قبل يوم واحد فقط من المواجهة.";
  const has = (t: string) => checkArticle(t, body, []).some((i: any) => i.code === "federation_as_championship");
  assert.ok(has("كالوم نيومان: مصارعو AEW يعتقدون أن NJPW بطولة سهلة والأمر ليس كذلك"));
  assert.ok(has("مصارعو AEW يعتقدون أن AEW بطولة سهلة"));
  assert.ok(!has("كالوم نيومان: مصارعو AEW يعتقدون أن الوصول إلى NJPW سهل والأمر ليس كذلك"));
  // a real championship keeps its promotion: «بطولة AEW العالمية» is fine
  assert.ok(!has("سي ام بانك يدافع عن بطولة AEW العالمية في عرض AEW Dynamite"));
  assert.ok(BLOCKING_QA_CODES.includes("federation_as_championship") && RETRYABLE_QA_CODES.includes("federation_as_championship"));
});

test("a name half in Arabic, half in English and a letter typed three times are fixed and blocked (INCIDENTS #935)", () => {
  const body = "واسترجع كاسيدي ترددداته في البداية، موضحا أن مارك Briscoe هو من دفعه للتسجيل في النزال.";
  const codes = checkArticle("أورانج كاسيدي يقدم نصيحة للمشاركين في نزال AEW Blood and Guts", body).map((i) => i.code);
  assert.ok(codes.includes("half_english_name"));
  assert.ok(codes.includes("tripled_letter"));
  assert.ok(BLOCKING_QA_CODES.includes("half_english_name") && BLOCKING_QA_CODES.includes("tripled_letter"));
  const fixed = autoFix(body);
  assert.ok(fixed.includes("تردداته") && fixed.includes("مارك بريسكو") && !fixed.includes("Briscoe"));
  assert.equal(autoFix("ومارك بريسكو"), "ومارك بريسكو");
  assert.equal(autoFix("التمهيد لللعودة المرتقبة"), "التمهيد للعودة المرتقبة");
  // real words with three in a row stay: «ووودز» (و + وودز), «شتتت» (a verb), laughter
  for (const ok of ["كوفي ووودز", "شتتت انتباهه", "ههههه"]) assert.equal(autoFix(ok), ok);
  assert.ok(!checkArticle("عنوان خبر عن المصارعة الحرة", "حدثت في جامعة يوتا فالي في سبتمبر الماضي.").some((i) => i.code === "missing_hamza"));
});

test("no published story has a half-English glossary name or a tripled letter (INCIDENTS #935)", async () => {
  const fs = await import("node:fs");
  const bad = fs.readdirSync("content/news").filter((f) => f.endsWith(".md")).filter((f) => {
    const t = fs.readFileSync(`content/news/${f}`, "utf-8");
    return autoFix(t.replace(/^---[\s\S]*?---/, "")).includes("بريسكو") && /مارك Briscoe/.test(t) || /(?:ددد|للل)/.test(t);
  });
  assert.deepEqual(bad, []);
});

test("the duals «يساعدان» / «ضيفين» / «وهما» are blocked, the plural rewrite passes (INCIDENTS #942)", () => {
  const body = "نص خبر طويل بما يكفي ليمر الفحص الأساسي بدون مشاكل أخرى في المتن.";
  assert.ok(checkArticle("بابا شانغو وذا بوغيمان يساعدان دانهاوزن في إصلاح مات كاردونا", body).some((i) => i.code === "dual_form"));
  assert.ok(checkArticle("دانهاوزن يستضيف عرض الهالوين", "وشهد العرض حضور ضيفين مميزين من تاريخ WWE، وهما بابا شانغو وذا بوغيمان.\n\n" + body).some((i) => i.code === "dual_form"));
  assert.ok(BLOCKING_QA_CODES.includes("dual_form"));
  const ok = checkArticle("دانهاوزن يستعين ببابا شانغو وذا بوغيمان لعلاج مات كاردونا في عرض الهالوين", "وشهد العرض ظهور بابا شانغو وذا بوغيمان، من أبرز الشخصيات المرعبة في تاريخ WWE، وهم يحاولون المساعدة.\n\n" + body);
  assert.ok(!ok.some((i) => i.code === "dual_form"));
});
