// «بث مباشر» (INCIDENTS #1537): a standing page for each program — /live/raw/, /live/smackdown/ … — always at the same
// address, showing the program's next (or current) show from /live/data. A show's own page lives a few days; these stay,
// so the search engines keep one address for «بث مباشر الرو» week after week. Keys are the bot's own (worker/src/live.ts).
module.exports = [
  { key: "raw", fed: "WWE", ar: "الرو", en: "WWE Raw", when: "كل اثنين" },
  { key: "smackdown", fed: "WWE", ar: "سماك داون", en: "WWE SmackDown", when: "كل جمعة" },
  { key: "nxt", fed: "NXT", ar: "ان اكس تي", en: "WWE NXT", when: "كل ثلاثاء" },
  { key: "dynamite", fed: "AEW", ar: "داينامايت", en: "AEW Dynamite", when: "كل أربعاء" },
  { key: "collision", fed: "AEW", ar: "كوليجن", en: "AEW Collision", when: "كل سبت" },
  { key: "tna", fed: "TNA", ar: "تي ان ايه", en: "TNA iMPACT", when: "كل خميس" },
  { key: "roh", fed: "ROH", ar: "ار او اتش", en: "ROH Wrestling", when: "" },
  { key: "royal-rumble", fed: "WWE", ar: "رويال رامبل", en: "WWE Royal Rumble", when: "" },
  { key: "wrestlemania", fed: "WWE", ar: "راسلمانيا", en: "WWE WrestleMania", when: "" },
  { key: "summerslam", fed: "WWE", ar: "سمرسلام", en: "WWE SummerSlam", when: "" },
  { key: "survivor-series", fed: "WWE", ar: "سيرفايفر سيريس", en: "WWE Survivor Series", when: "" },
  { key: "elimination-chamber", fed: "WWE", ar: "إليمنيشن تشامبر", en: "WWE Elimination Chamber", when: "" },
  { key: "money-in-the-bank", fed: "WWE", ar: "موني إن ذا بانك", en: "WWE Money in the Bank", when: "" },
  { key: "crown-jewel", fed: "WWE", ar: "كراون جول", en: "WWE Crown Jewel", when: "" },
  { key: "full-gear", fed: "AEW", ar: "فول جير", en: "AEW Full Gear", when: "" },
  { key: "all-in", fed: "AEW", ar: "أول إن", en: "AEW All In", when: "" },
  { key: "double-or-nothing", fed: "AEW", ar: "دبل أور ناثينج", en: "AEW Double or Nothing", when: "" },
  { key: "worlds-end", fed: "AEW", ar: "ويرلدز إند", en: "AEW Worlds End", when: "" },
  { key: "forbidden-door", fed: "AEW", ar: "فوربيدن دور", en: "AEW x NJPW Forbidden Door", when: "" },
];
