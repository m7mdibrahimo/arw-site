// «مجتمع المصارعة»'s rooms, as the page shows them (pages/community.njk, assets/community.js).
// The worker's list (worker/src/chat.ts ROOMS) is the same ids in the same order: tests/chat.test.mts checks it.
// hue: the room's colour, from the promotions' own on the home page (index.njk .fed-*).
module.exports = [
  { id: "general", name: "الساحة العامة", about: "كل محبي المصارعة في مكان واحد", mark: "ARW", hue: 177 },
  { id: "wwe", name: "WWE", about: "رو وسماك داون وNXT والعروض الكبرى", mark: "WWE", hue: 4, fed: "wwe" },
  { id: "aew", name: "AEW", about: "داينامايت وكوليجن والعروض الكبرى", mark: "AEW", hue: 42, fed: "aew" },
  { id: "njpw", name: "NJPW", about: "نيو جابان: ريسل كينغدم والجي وان كلايمكس", mark: "NJPW", hue: 212, fed: "njpw" },
  { id: "tna", name: "TNA", about: "إمباكت والعروض الكبرى", mark: "TNA", hue: 262, fed: "tna" },
  { id: "roh", name: "ROH", about: "رينغ أوف أونر وعروضها", mark: "ROH", hue: 218, fed: "roh" },
  { id: "mma", name: "UFC والفنون القتالية", about: "النزالات والأحزمة وكل جديد القتال", mark: "UFC", hue: 24, fed: "mma" },
  { id: "indie", name: "الاتحادات المستقلة", about: "MLP وMLW وCMLL وغيرها", mark: "INDIE", hue: 166, fed: "indie" },
  { id: "nostalgia", name: "نوستالجيا", about: "ذكريات المصارعة القديمة وأجمل أيامها", mark: "90s", hue: 330 },
];
