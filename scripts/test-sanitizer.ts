import { sanitizeWrestlingTerms } from "./fightful-watcher";

interface TestCase {
  input: string;
  expectedContains: string;
  forbidden?: string[];
  description: string;
}

const testCases: TestCase[] = [
  // 1. Swerve Strickland test cases
  {
    description: "Swerve Strickland from English",
    input: "Swerve Strickland wins the match",
    expectedContains: "سويرف ستريكلاند",
    forbidden: ["سوير ستريكلاند", "سوري ستركلند", "Strickland"],
  },
  {
    description: "Swerve Strickland typo missing faa (سوير ستريكلاند)",
    input: "سوير ستريكلاند يكشف تفاصيل طلب النصيحة",
    expectedContains: "سويرف ستريكلاند",
    forbidden: ["سوير ستريكلاند"],
  },
  {
    description: "Swerve Strickland terrible corruption (سوري ستركلند)",
    input: "سوري ستركلند يؤكد خوضه النزالات بتمزق في الغضروف",
    expectedContains: "سويرف ستريكلاند",
    forbidden: ["سوري ستركلند", "ستركلند"],
  },
  {
    description: "Swerve Strickland missing yaa (سويرف ستركلند)",
    input: "عاجل: سويرف ستركلند يجتمع بتوني خان",
    expectedContains: "سويرف ستريكلاند",
    forbidden: ["ستركلند"],
  },
  {
    description: "Swerve Strickland double typo (سوير ستركلند)",
    input: "مواجهة نارية بين سوير ستركلند وجاك بيري",
    expectedContains: "سويرف ستريكلاند",
    forbidden: ["سوير ستركلند", "ستركلند"],
  },
  {
    description: "Swerve alone in wrestler context",
    input: "انتصار أوسبري وسوير في نزال ناري",
    expectedContains: "أوسبري وسويرف في",
    forbidden: ["وسوير في"],
  },
  {
    description: "English Swerve alone",
    input: "Swerve celebrates his title defense",
    expectedContains: "سويرف",
  },

  // 2. Adam Copeland test cases
  {
    description: "Adam Copeland English",
    input: "Adam Copeland gives advice to young talent",
    expectedContains: "آدم كوبلاند",
    forbidden: ["Copeland"],
  },
  {
    description: "Adam Copeland typo (أدم كوبلند)",
    input: "تصريحات أدم كوبلند الأخيرة",
    expectedContains: "آدم كوبلاند",
    forbidden: ["أدم", "كوبلند"],
  },
  {
    description: "Adam Copeland typo (ادم كوبلاند)",
    input: "رسالة من ادم كوبلاند للجماهير",
    expectedContains: "آدم كوبلاند",
  },
  {
    description: "Copeland alone typo (كوبلند)",
    input: "شراكة كوبلند وفليتشر",
    expectedContains: "كوبلاند",
    forbidden: ["كوبلند"],
  },

  // 3. Lil Yachty test cases
  {
    description: "Lil Yachty English",
    input: "Lil Yachty reflects on his in-ring debut",
    expectedContains: "ليل ياتي",
    forbidden: ["Lil Yachty", "ياشتي"],
  },
  {
    description: "Lil Yachty typo (ليل ياشتي)",
    input: "ليل ياشتي يستعرض كواليس نزاله الأول",
    expectedContains: "ليل ياتي",
    forbidden: ["ياشتي"],
  },
  {
    description: "Lil Yachty typo (ليلت ياشتي)",
    input: "ليلت ياشتي يكشف عن تلقيه عرضا رسميا",
    expectedContains: "ليل ياتي",
    forbidden: ["ليلت", "ياشتي"],
  },
  {
    description: "Lil Yachty typo (ليلت ياتي)",
    input: "صمود ليلت ياتي أمام بارون كوربين",
    expectedContains: "ليل ياتي",
    forbidden: ["ليلت"],
  },
  {
    description: "Lil Yachty corruption (ياتشي / ياختي)",
    input: "مشاركة ليل ياتشي في العرض",
    expectedContains: "ليل ياتي",
  },

  // 4. Money In The Bank test cases
  {
    description: "Money In The Bank English",
    input: "Qualifying matches for Money In The Bank match",
    expectedContains: "موني إن ذا بانك",
    forbidden: ["Money In The Bank"],
  },
  {
    description: "MITB acronym",
    input: "Two MITB qualifiers announced",
    expectedContains: "موني إن ذا بانك",
    forbidden: ["MITB"],
  },
  {
    description: "MITB typo (موني إن دي بانك)",
    input: "نزالات التصفية لحقيبة موني إن دي بانك في الرو",
    expectedContains: "موني إن ذا بانك",
    forbidden: ["إن دي"],
  },
  {
    description: "MITB typo (ماني إن دي زي)",
    input: "تصفيات حقيبة ماني إن دي زي للسيدات",
    expectedContains: "موني إن ذا بانك",
    forbidden: ["ماني"],
  },
  {
    description: "MITB typo (ماني إن ذا بانك)",
    input: "المنافسة على حقيبة ماني إن ذا بانك",
    expectedContains: "موني إن ذا بانك",
    forbidden: ["ماني"],
  },

  // 5. Medical Terms
  {
    description: "Torn Meniscus",
    input: "Wrestling with a Torn Meniscus since 2019",
    expectedContains: "تمزق في الغضروف الهلالي",
    forbidden: ["Meniscus"],
  },
  {
    description: "Meniscus alone",
    input: "Surgery on his Meniscus was successful",
    expectedContains: "الغضروف الهلالي",
  },

  // 6. Seth Rollins
  {
    description: "Seth Rollins English",
    input: "Seth Rollins returns to action",
    expectedContains: "سيث رولينز",
    forbidden: ["Seth Rollins"],
  },
  {
    description: "Seth Freakin Rollins",
    input: "Seth Freakin Rollins hits the stomp",
    expectedContains: "سيث رولينز",
  },
  {
    description: "Seth Rollins typo (ستيف رولينز)",
    input: "رقصة ستيف رولينز وسولو سيكوا",
    expectedContains: "سيث رولينز",
    forbidden: ["ستيف رولينز"],
  },
  {
    description: "Seth Rollins typo (سيث رولنز)",
    input: "مواجهة سيث رولنز ضد سي ام بانك",
    expectedContains: "سيث رولينز",
  },

  // 7. Paul Heyman
  {
    description: "Paul Heyman English",
    input: "Paul Heyman returns with Roman Reigns",
    expectedContains: "بول هيمان",
    forbidden: ["Paul Heyman"],
  },
  {
    description: "Paul Heyman typo (بول هيمن)",
    input: "مستشار خاص بول هيمن يؤكد الخطة",
    expectedContains: "بول هيمان",
    forbidden: ["بول هيمن"],
  },
  {
    description: "Paul Heyman typo (سبيشل بول هيمن)",
    input: "ظهور سبيشل بول هيمن في الكواليس",
    expectedContains: "بول هيمان",
    forbidden: ["سبيشل بول هيمن", "هيمن"],
  },

  // 8. LA Knight
  {
    description: "LA Knight English",
    input: "LA Knight challenges for the title",
    expectedContains: "ال ايه نايت",
    forbidden: ["LA Knight"],
  },
  {
    description: "LA Knight typo (إل إيه نايت)",
    input: "هتاف الجماهير لـ إل إيه نايت",
    expectedContains: "ال ايه نايت",
  },

  // 9. AJ Lee & AJ Styles
  {
    description: "AJ Lee English",
    input: "AJ Lee comments on women division",
    expectedContains: "إيه جيه لي",
  },
  {
    description: "AJ Lee typo (اي لي)",
    input: "تصريحات اي لي حول عودتها",
    expectedContains: "إيه جيه لي",
    forbidden: ["اي لي"],
  },
  {
    description: "AJ Lee typo (إي لي)",
    input: "مقابلة إي لي الخاصة",
    expectedContains: "إيه جيه لي",
  },
  {
    description: "AJ Styles English",
    input: "AJ Styles signs new contract",
    expectedContains: "إيه جيه ستايلز",
  },
  {
    description: "AJ Styles typo (اي ستايلز)",
    input: "نجل اي ستايلز ينضم لـ TNA",
    expectedContains: "إيه جيه ستايلز",
    forbidden: ["اي ستايلز"],
  },

  // 10. Andrade El Idolo
  {
    description: "Andrade English",
    input: "Andrade El Idolo defeats his opponent",
    expectedContains: "أندرادي إل إيدولو",
  },
  {
    description: "Andrade typo (انقرادي)",
    input: "فوز انقرادي بلقب البطولة",
    expectedContains: "أندرادي",
    forbidden: ["انقرادي"],
  },

  // 11. El Grande Americano
  {
    description: "El Grande Americano English",
    input: "El Grande Americano returns to WWE RAW",
    expectedContains: "إل غراندي أمريكانو",
  },
  {
    description: "El Grande Americano bad literal translation (الأمركنو الكبير)",
    input: "الأمركنو الكبير يسجل ظهوره الأول",
    expectedContains: "إل غراندي أمريكانو",
    forbidden: ["الأمركنو"],
  },

  // 12. R-Truth & CM Punk
  {
    description: "R-Truth English",
    input: "R-Truth teams up with Priest",
    expectedContains: "ار تروث",
    forbidden: ["R-Truth"],
  },
  {
    description: "CM Punk English",
    input: "CM Punk addresses the fans",
    expectedContains: "سي ام بانك",
    forbidden: ["CM Punk"],
  },

  // 13. Rey & Dominik Mysterio
  {
    description: "Rey Mysterio English",
    input: "Rey Mysterio talks about his family",
    expectedContains: "ري ميستيريو",
  },
  {
    description: "Rey Mysterio typo (راي ميستيريو)",
    input: "قناع راي ميستيريو الشهير",
    expectedContains: "ري ميستيريو",
    forbidden: ["راي ميستيريو"],
  },
  {
    description: "Dominik Mysterio English",
    input: "Dominik Mysterio defends his title",
    expectedContains: "دومينيك ميستيريو",
  },

  // 14. Liv Morgan & Stephanie Vaquer
  {
    description: "Liv Morgan English",
    input: "Liv Morgan stars in new movie",
    expectedContains: "ليف مورغان",
  },
  {
    description: "Liv Morgan typo (ليف مورجان)",
    input: "تصريحات ليف مورجان الأخيرة",
    expectedContains: "ليف مورغان",
    forbidden: ["مورجان"],
  },
  {
    description: "Stephanie Vaquer English",
    input: "Stephanie Vaquer wins the championship",
    expectedContains: "ستيفاني فاكير",
  },
  {
    description: "Stephanie Vaquer typo (ستيفاني بايكر)",
    input: "تتويج ستيفاني بايكر بالذهب",
    expectedContains: "ستيفاني فاكير",
    forbidden: ["بايكر"],
  },

  // 15. Gunther & Randy Orton
  {
    description: "Gunther English",
    input: "Gunther chops his opponent",
    expectedContains: "غونتر",
  },
  {
    description: "Gunther typo (جونثر)",
    input: "جونثر يهيمن على الحلبة",
    expectedContains: "غونتر",
    forbidden: ["جونثر"],
  },

  // 16. Kevin Owens & Drew McIntyre
  {
    description: "Kevin Owens English",
    input: "Kevin Owens fights back",
    expectedContains: "كيفين أوينز",
  },
  {
    description: "Drew McIntyre English",
    input: "Drew McIntyre swings his sword",
    expectedContains: "درو ماكنتاير",
  },

  // 17. Mercedes Mone & Orange Cassidy
  {
    description: "Mercedes Mone English",
    input: "Mercedes Mone retains TBS title",
    expectedContains: "مرسيدس موني",
  },
  {
    description: "Mercedes Mone typo (مرسيدس مونيه)",
    input: "احتفال مرسيدس مونيه في ويمبلي",
    expectedContains: "مرسيدس موني",
    forbidden: ["مونيه"],
  },
  {
    description: "Orange Cassidy English",
    input: "Orange Cassidy puts hands in pockets",
    expectedContains: "أورانج كاسيدي",
  },

  // 18. Tag Teams & Factions
  {
    description: "The Bloodline English to Arabic",
    input: "The Bloodline attacks the champion",
    expectedContains: "ذا بلودلاين",
    forbidden: ["The Bloodline"],
  },
  {
    description: "The Judgment Day English to Arabic",
    input: "The Judgment Day interferes in the match",
    expectedContains: "ذا جادجمنت داي",
    forbidden: ["Judgment Day"],
  },
  {
    description: "The New Day English to Arabic",
    input: "The New Day celebrates 10 years",
    expectedContains: "ذا نيو داي",
    forbidden: ["New Day"],
  },
  {
    description: "War Raiders English to Arabic",
    input: "War Raiders capture tag titles",
    expectedContains: "وار رايدرز",
    forbidden: ["War Raiders"],
  },
  {
    description: "Wagner Brothers English to Arabic",
    input: "The Wagner Brothers win the gold",
    expectedContains: "الإخوة فاغنر",
    forbidden: ["Wagner Brothers"],
  },

  // 19. Championships
  {
    description: "World Heavyweight Championship",
    input: "Match for the World Heavyweight Championship",
    expectedContains: "بطولة العالم للوزن الثقيل",
    forbidden: ["World Heavyweight"],
  },
  {
    description: "Tag Team Championship",
    input: "Defending the World Tag Team Championship",
    expectedContains: "بطولة العالم للزوجي",
  },
  {
    description: "Intercontinental Championship",
    input: "Intercontinental Championship on the line",
    expectedContains: "بطولة القارات",
  },

  // 20. Promotions (Must stay in English)
  {
    description: "WWE Arabic to English",
    input: "اتحاد دبليو دبليو إي يوقع عقدا جديدا",
    expectedContains: "WWE",
    forbidden: ["دبليو دبليو إي"],
  },
  {
    description: "AEW Arabic to English",
    input: "اتحاد إيه إي دبليو يعلن عن مهرجان",
    expectedContains: "AEW",
    forbidden: ["إيه إي دبليو"],
  },

  // 21. Shows (English with Mandatory Promotion Prefix)
  {
    description: "Raw to WWE RAW",
    input: "في عرض الرو القادم",
    expectedContains: "عرض WWE RAW",
    forbidden: ["عرض الرو"],
  },
  {
    description: "SmackDown to WWE SmackDown",
    input: "أحداث عرض سماكداون الأخيرة",
    expectedContains: "عرض WWE SmackDown",
    forbidden: ["سماكداون"],
  },

  // 22. Terminology: Episode / Festival to Show
  {
    description: "Replace halaqah with ard",
    input: "حلقة الرو الماضية",
    expectedContains: "عرض WWE RAW",
    forbidden: ["حلقة"],
  },
  {
    description: "Replace mahrajan with ard",
    input: "مهرجانات المصارعة الكبرى",
    expectedContains: "عروض المصارعة الكبرى",
    forbidden: ["مهرجانات"],
  },

  // 23. Archaic Dual Forms
  {
    description: "Ban dual forms (ابنا ستينغ)",
    input: "ظهور ابنا ستينغ في الحلبة",
    expectedContains: "أبناء ستينغ",
    forbidden: ["ابنا ستينغ"],
  },

  // 24. Foreign Journalists & Source Scrubbing
  {
    description: "Scrub Sean Ross Sapp",
    input: "وفق ما ذكره Sean Ross Sapp في تقريره",
    expectedContains: "مصادر صحفية مطلعة",
    forbidden: ["Sean Ross Sapp", "Sean Ross"],
  },
  {
    description: "Scrub Fightful",
    input: "أكد موقع Fightful في تسريباته",
    expectedContains: "مصادر صحفية خاصة",
    forbidden: ["Fightful"],
  },

  // 25. Complete Zero-Tashkeel Rule
  {
    description: "Remove all tashkeel diacritics",
    input: "سُوَيْرْف سْتْرِيكْلَانْد يَفُوزُ بِالبُطُولَةِ",
    expectedContains: "سويرف ستريكلاند يفوز بالبطولة",
    forbidden: ["ُ", "َ", "ِ", "ْ", "ّ", "ً", "ٌ", "ٍ"],
  },
];

console.log(`\n======================================================`);
console.log(`🚀 RUNNING SANITIZER TESTS (${testCases.length} Test Cases)...`);
console.log(`======================================================\n`);

let passed = 0;
let failed = 0;

for (let i = 0; i < testCases.length; i++) {
  const tc = testCases[i];
  const result = sanitizeWrestlingTerms(tc.input);

  const hasExpected = result.includes(tc.expectedContains);
  let hasForbidden = false;
  let forbiddenFound = "";

  if (tc.forbidden) {
    for (const f of tc.forbidden) {
      if (result.includes(f)) {
        hasForbidden = true;
        forbiddenFound = f;
        break;
      }
    }
  }

  if (hasExpected && !hasForbidden) {
    passed++;
    console.log(`✅ [PASS ${i + 1}/${testCases.length}] ${tc.description}`);
  } else {
    failed++;
    console.error(`❌ [FAIL ${i + 1}/${testCases.length}] ${tc.description}`);
    console.error(`   Input:    "${tc.input}"`);
    console.error(`   Output:   "${result}"`);
    if (!hasExpected) {
      console.error(`   Expected: contains "${tc.expectedContains}"`);
    }
    if (hasForbidden) {
      console.error(`   Forbidden: found "${forbiddenFound}"`);
    }
  }
}

console.log(`\n======================================================`);
console.log(`TEST SUMMARY: ${passed} PASSED, ${failed} FAILED (Total: ${testCases.length})`);
console.log(`======================================================\n`);

if (failed > 0) {
  process.exit(1);
} else {
  console.log("🎉 ALL TESTS PASSED WITH 100% SUCCESS RATE!\n");
}

// Additional 30 tests to exceed 100+ tests
const extraTests: TestCase[] = [
  { description: "Roman Reigns English", input: "Roman Reigns spears his opponent", expectedContains: "رومان رينز" },
  { description: "Cody Rhodes English", input: "Cody Rhodes delivers the Cross Rhodes", expectedContains: "كودي رودز" },
  { description: "Rhea Ripley English", input: "Rhea Ripley dominates the ring", expectedContains: "ريا ريبلي" },
  { description: "Becky Lynch English", input: "Becky Lynch locks the dis-arm-her", expectedContains: "بيكي لينش" },
  { description: "Jey Uso English", input: "Jey Uso hits the splash", expectedContains: "جاي أوسو" },
  { description: "Jey Uso typo (جاي اوسو)", input: "هتاف الجماهير لـ جاي اوسو", expectedContains: "جاي أوسو" },
  { description: "Jimmy Uso English", input: "Jimmy Uso superkicks", expectedContains: "جيمي أوسو" },
  { description: "Solo Sikoa English", input: "Solo Sikoa orders the attack", expectedContains: "سولو سيكوا" },
  { description: "Jacob Fatu English", input: "Jacob Fatu wreaks havoc", expectedContains: "جاكوب فاتو" },
  { description: "Zilla Fatu English", input: "Zilla Fatu makes his NXT debut", expectedContains: "زيلا فاتو" },
  { description: "Trick Williams English", input: "Trick Williams wins US title", expectedContains: "تريك ويليامز" },
  { description: "Oba Femi English", input: "Oba Femi tosses Bronson Reed", expectedContains: "أوبا فيمي" },
  { description: "Je'Von Evans English", input: "Je'Von Evans qualifies for ladder match", expectedContains: "جيفون إيفانز" },
  { description: "Tiffany Stratton English", input: "Tiffany Stratton hits Prettiest Moonsault", expectedContains: "تيفاني ستراتون" },
  { description: "Roxanne Perez English", input: "Roxanne Perez defends against challenger", expectedContains: "روكسان بيريز" },
  { description: "Giulia English", input: "Giulia strikes hard", expectedContains: "جوليا" },
  { description: "Kenny Omega English", input: "Kenny Omega returns with cleaner gimmick", expectedContains: "كيني أوميغا" },
  { description: "Kenny Omega typo (كيني اوميغا)", input: "تصريحات كيني اوميغا الأخيرة", expectedContains: "كيني أوميغا" },
  { description: "Will Ospreay English", input: "Will Ospreay hits the hidden blade", expectedContains: "ويل أوسبري" },
  { description: "Will Ospreay typo (ويل اوسبري)", input: "فوز ويل اوسبري في ويمبلي", expectedContains: "ويل أوسبري" },
  { description: "Jon Moxley English", input: "Jon Moxley chokes out challenger", expectedContains: "جون موكسلي" },
  { description: "Bryan Danielson English", input: "Bryan Danielson locks the lebell lock", expectedContains: "برايان دانيلسون" },
  { description: "Hangman Page English", input: "Hangman Page hits buckshot lariat", expectedContains: "هانغمان بيج" },
  { description: "Darby Allin English", input: "Darby Allin jumps off the ladder", expectedContains: "داربي ألين" },
  { description: "Chris Jericho English", input: "Chris Jericho starts the learning tree", expectedContains: "كريس جيريكو" },
  { description: "Malakai Black English", input: "Malakai Black hits black mass", expectedContains: "مالاكاي بلاك" },
  { description: "Penta English", input: "Penta zero miedo", expectedContains: "بينتا" },
  { description: "Rey Fenix English", input: "Rey Fenix flies from the ropes", expectedContains: "ري فينيكس" },
  { description: "Tessa Blanchard English", input: "Tessa Blanchard signs contract", expectedContains: "تيسا بلانشارد" },
  { description: "Jordynne Grace English", input: "Jordynne Grace lifts opponent", expectedContains: "جوردين غريس" },
  { description: "Deonna Purrazzo English", input: "Deonna Purrazzo speaks on Vendetta faction", expectedContains: "ديونا بوراتزو", forbidden: ["بوراكزو", "بورازو"] },
  { description: "Deonna Purrazzo typo بوراكزو", input: "ديونا بوراكزو تكشف كواليس انضمام جيزيل شو", expectedContains: "ديونا بوراتزو", forbidden: ["بوراكزو"] },
  { description: "Deonna Purrazzo typo بوراكزو standalone", input: "أكدت بوراكزو أن المشروع كان يمتلك مقومات النجاح", expectedContains: "بوراتزو", forbidden: ["بوراكزو"] },
  { description: "Deonna Purrazzo typo بورازو", input: "تصريحات ديونا بورازو في العرض", expectedContains: "ديونا بوراتزو", forbidden: ["بورازو"] },
];

for (let j = 0; j < extraTests.length; j++) {
  const tc = extraTests[j];
  const result = sanitizeWrestlingTerms(tc.input);
  const hasExpected = result.includes(tc.expectedContains);
  let hasForbidden = false;
  let forbiddenFound = "";
  if (tc.forbidden) {
    for (const f of tc.forbidden) {
      if (result.includes(f)) {
        hasForbidden = true;
        forbiddenFound = f;
        break;
      }
    }
  }
  if (hasExpected && !hasForbidden) {
    console.log(`✅ [PASS ${testCases.length + j + 1}/${testCases.length + extraTests.length}] ${tc.description}`);
  } else {
    console.error(`❌ [FAIL ${testCases.length + j + 1}/${testCases.length + extraTests.length}] ${tc.description}`);
    process.exit(1);
  }
}
console.log(`\n🎉 ALL ${testCases.length + extraTests.length} TEST CASES PASSED WITH 100% SUCCESS RATE!\n`);
