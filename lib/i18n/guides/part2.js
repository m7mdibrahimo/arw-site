// English federation guides, part 2 (mlp … row). Mirrors the structure of _data/federationGuides.js exactly.

module.exports = {
  mlp: {
    tagline: "A new Canadian promotion that launched in 2024 to revive wrestling in Canada. It has a working relationship with AEW.",
    intro: "MLP stands for Maple Leaf Pro Wrestling, named after the maple leaf, the symbol of Canada. It was founded by a former president of TNA and brings Canadian talent together with stars from AEW and other promotions.",
    facts: [
      ["Founded", "2024"],
      ["Headquarters", "Ontario, Canada"],
      ["Format", "One weekly show, plus major events during the year"],
      ["Biggest event", "Northern Rising"],
    ],
    rhythm: "weekly",
    how: [
      "Its weekly show, MLP Mayhem, debuted in July 2026. It airs on TSN2 in Canada and on MyAEW worldwide, and its first season runs twelve weeks.",
      "The promotion also holds major events, the biggest of which is Northern Rising.",
      "Stars from AEW and other promotions appear alongside the Canadian talent.",
    ],
    week: [
      { day: "", show: "MLP Mayhem", program: "MLP Mayhem", role: "Weekly show", time: "Weekly during the season", mecca: "", length: "", channel: "TSN2 and MyAEW" },
    ],
    weekNote: "",
    year: [
      { name: "Northern Rising", big: true, text: "The promotion's biggest event. The 2026 edition was held in Toronto." },
    ],
    yearNote: "",
    titles: [
      { group: "Championships", items: [
        ["MLP Canadian Championship", "The promotion's top title. The first champion was crowned in a 20-man match.", "MLP Canadian Championship"],
        ["MLP Canadian Tag Team Championship", "", "MLP Canadian Tag Team Championship"],
      ] },
    ],
    titlesNote: "",
    terms: [],
    history: [
      ["2024", "The promotion was founded and held its first show in October."],
      ["2025", "The first Northern Rising took place, and the first Canadian Champion was crowned."],
      ["2026", "MLP Mayhem launched as a weekly show."],
    ],
    start: [
      "Follow MLP Mayhem during its season.",
      "Watch Northern Rising, the promotion's biggest night.",
    ],
  },

  ajpw: {
    tagline: "Japan's second-oldest promotion, founded in 1972. It is famous for hard-hitting heavyweight wrestling and the Triple Crown.",
    intro: "AJPW is a Japanese promotion with a rich history. In the 1990s it was home to the most celebrated heavyweight matches in the world. Like other Japanese promotions, it runs on a touring schedule.",
    facts: [
      ["Founded", "1972"],
      ["Headquarters", "Tokyo, Japan"],
      ["Format", "Tours of live events, plus two major seasonal tournaments"],
      ["Signature event", "Champion Carnival"],
    ],
    rhythm: "tours",
    how: [
      "The promotion runs tours and live events rather than weekly TV shows.",
      "The two biggest events of the year are the Champion Carnival, a singles league held in the spring, and the Real World Tag League, a tag team league held at the end of the year.",
      "The Champion Carnival winner usually earns a shot at the Triple Crown, the promotion's top title.",
    ],
    week: [],
    weekNote: "Shows usually take place in the afternoon or evening Japan time, which is morning or midday Makkah time.",
    year: [
      { name: "Champion Carnival", months: [4, 5], big: true, text: "An annual singles league held since 1973." },
      { name: "Real World Tag League", months: [11, 12], big: true, text: "An annual tag team league at the end of the year." },
    ],
    yearNote: "",
    titles: [
      { group: "Championships", items: [
        ["Triple Crown Heavyweight Championship", "The promotion's top title, created in 1989 by unifying three championships into one.", "Triple Crown Heavyweight Championship"],
        ["World Tag Team Championship", "", "World Tag Team Championship"],
        ["World Junior Heavyweight Championship", "", "World Junior Heavyweight Championship"],
        ["All Asia Tag Team Championship", "One of the oldest tag team titles in the world, dating back to 1955.", "All Asia Tag Team Championship"],
      ] },
    ],
    titlesNote: "",
    terms: [
      ["Triple Crown", "A single title made up of three older championships, which is why the champion carries three belts."],
    ],
    history: [
      ["1972", "Legendary wrestler Giant Baba founded the promotion."],
      ["1989", "Three titles were unified into the Triple Crown."],
      ["2000", "Most of the roster left and founded NOAH."],
    ],
    start: [
      "Follow the Champion Carnival in the spring to get to know the promotion's stars.",
      "Watch Triple Crown title matches, the pinnacle of what the promotion has to offer.",
    ],
  },

  noah: {
    tagline: "A Japanese promotion founded in 2000, known for hard-hitting heavyweight wrestling and its GHC championships.",
    intro: "NOAH is a Japanese promotion that grew out of AJPW and offers serious, hard-hitting heavyweight wrestling. It runs on a touring schedule, and its shows stream on WRESTLE UNIVERSE.",
    facts: [
      ["Founded", "2000"],
      ["Headquarters", "Tokyo, Japan"],
      ["Parent company", "CyberFight, which also owns DDT and TJPW"],
      ["Format", "Tours of live events, plus a major annual league"],
      ["Signature event", "N-1 Victory"],
    ],
    rhythm: "tours",
    how: [
      "Like other Japanese promotions, NOAH runs tours and live events, and its shows stream on WRESTLE UNIVERSE.",
      "GHC stands for Global Honored Crown, the name carried by NOAH's championships.",
      "N-1 Victory is an annual heavyweight league, and the winner earns a shot at the GHC Heavyweight Championship.",
      "The promotion usually opens the year with a major show in early January.",
    ],
    week: [],
    weekNote: "Shows usually take place in the afternoon or evening Japan time, which is morning or midday Makkah time.",
    year: [
      { name: "New Year's show", months: [1], text: "A major show that kicks off the promotion's year." },
      { name: "N-1 Victory", months: [8, 9], big: true, text: "The annual heavyweight league." },
    ],
    yearNote: "",
    titles: [
      { group: "Championships", items: [
        ["GHC Heavyweight Championship", "The promotion's top title.", "GHC Heavyweight Championship"],
        ["GHC Junior Heavyweight Championship", "", "GHC Junior Heavyweight Championship"],
        ["GHC Tag Team Championship", "", "GHC Tag Team Championship"],
        ["GHC Junior Heavyweight Tag Team Championship", "", "GHC Junior Heavyweight Tag Team Championship"],
      ] },
    ],
    titlesNote: "",
    terms: [
      ["GHC", "Short for Global Honored Crown, the name of NOAH's championships."],
      ["N-1 Victory", "The annual heavyweight league."],
    ],
    history: [
      ["2000", "Mitsuharu Misawa founded the promotion after leaving AJPW with most of its roster."],
      ["2020", "The promotion became part of CyberFight."],
    ],
    start: [
      "Follow the N-1 Victory to get to know the promotion's stars.",
      "Watch GHC Heavyweight Championship matches.",
    ],
  },

  stardom: {
    tagline: "The biggest women's wrestling promotion in Japan and the world. Founded in 2010, it has the same owner as NJPW.",
    intro: "Stardom is a Japanese all-women promotion that blends hard-hitting wrestling with colorful presentation. Its wrestlers are split into factions, each with its own identity, and it runs seasonal tournaments throughout the year.",
    facts: [
      ["Founded", "2010"],
      ["Headquarters", "Tokyo, Japan"],
      ["Parent company", "Bushiroad (since 2019), which also owns NJPW"],
      ["Format", "A steady stream of live events, plus seasonal tournaments"],
      ["Biggest events", "All Star Grand Queendom and Dream Queendom"],
    ],
    rhythm: "tours",
    how: [
      "The roster is made up entirely of women, divided into factions called units. Each unit has its own leader, identity and rivals.",
      "Shows stream on the promotion's own platform, Stardom World.",
      "The two top titles are the Red Belt (World of Stardom), the highest honor, and the White Belt (Wonder of Stardom).",
      "The 5★Star Grand Prix is a points-based summer league, and the winner usually earns a shot at the Red Belt.",
    ],
    week: [],
    weekNote: "Shows usually take place in the afternoon or evening Japan time, which is morning or midday Makkah time.",
    year: [
      { name: "Cinderella Tournament", months: [3], text: "A single-elimination tournament in the spring." },
      { name: "All Star Grand Queendom", months: [4], big: true, text: "The biggest show of the spring, held at Yokohama Arena." },
      { name: "5★Star Grand Prix", months: [7, 8], big: true, text: "The big summer league." },
      { name: "Goddesses of Stardom Tag League", months: [10, 11], text: "A tag team league in the fall." },
      { name: "Dream Queendom", months: [12], big: true, text: "The year-end show, held on December 29." },
    ],
    yearNote: "",
    titles: [
      { group: "Championships", items: [
        ["World of Stardom Championship", "The Red Belt, the promotion's top title.", "World of Stardom Championship"],
        ["Wonder of Stardom Championship", "The White Belt, the second-highest title.", "Wonder of Stardom Championship"],
        ["Goddesses of Stardom Championship", "The tag team title.", "Goddesses of Stardom Championship"],
        ["Artist of Stardom Championship", "The trios title.", "Artist of Stardom Championship"],
        ["High Speed Championship", "The title for fast-paced matches.", "High Speed Championship"],
        ["Future of Stardom Championship", "The title for young talent.", "Future of Stardom Championship"],
        ["IWGP Women's Championship", "A title shared with NJPW.", "IWGP Women's Championship"],
      ] },
    ],
    titlesNote: "",
    terms: [
      ["Unit", "A group of wrestlers who work together under a shared name and identity."],
      ["Red Belt and White Belt", "The promotion's two top titles."],
    ],
    history: [
      ["2010", "Rossy Ogawa founded the promotion, which held its first show in January 2011."],
      ["2019", "Bushiroad bought the promotion."],
      ["2022", "The IWGP Women's Championship was created in partnership with NJPW."],
      ["2024", "Founder Rossy Ogawa left and started Marigold."],
    ],
    start: [
      "Start with All Star Grand Queendom or Dream Queendom.",
      "Follow the 5★Star Grand Prix in the summer to get to know the whole roster.",
    ],
  },

  marigold: {
    tagline: "A Japanese women's promotion launched in 2024 by the man who founded Stardom.",
    intro: "Marigold is a young all-women promotion that launched with a group of wrestlers who had left Stardom. It runs live events and an annual league that decides the next challenger for its world title.",
    facts: [
      ["Founded", "2024"],
      ["Headquarters", "Tokyo, Japan"],
      ["Founder", "Rossy Ogawa, founder of Stardom"],
      ["Format", "Live events, plus an annual league"],
      ["Signature event", "Dream Star Grand Prix"],
    ],
    rhythm: "tours",
    how: [
      "Like other Japanese promotions, it runs tours and live events.",
      "The Dream Star Grand Prix is an annual league, and the winner earns a shot at the Marigold World Championship.",
    ],
    week: [],
    weekNote: "Shows usually take place in the afternoon or evening Japan time, which is morning or midday Makkah time.",
    year: [
      { name: "Dream Star Grand Prix", big: true, text: "The annual league that decides the next challenger for the world title." },
    ],
    yearNote: "",
    titles: [
      { group: "Championships", items: [
        ["Marigold World Championship", "The promotion's top title.", "Marigold World Championship"],
        ["Marigold United National Championship", "The second-highest title.", "Marigold United National Championship"],
        ["Marigold Super Fly Championship", "The title for lighter wrestlers.", "Marigold Super Fly Championship"],
        ["Marigold Twin Star Championship", "The tag team title.", "Marigold Twin Star Championship"],
        ["Marigold 3D Trios Championship", "The trios title.", "Marigold 3D Trios Championship"],
      ] },
    ],
    titlesNote: "",
    terms: [],
    history: [
      ["2024", "Rossy Ogawa founded the promotion after leaving Stardom, and it held its first show in May."],
    ],
    start: [
      "Follow the Dream Star Grand Prix to get to know the roster.",
      "Watch Marigold World Championship matches.",
    ],
  },

  tjpw: {
    tagline: "A Japanese women's promotion founded in 2013, with a fun atmosphere and colorful characters. It is a friendly introduction to Japanese wrestling.",
    intro: "TJPW stands for Tokyo Joshi Pro-Wrestling, meaning Tokyo women's pro wrestling. It mixes athletics with fun and lighthearted characters, yet it still delivers hard-hitting matches at its big shows.",
    facts: [
      ["Founded", "2013"],
      ["Headquarters", "Tokyo, Japan"],
      ["Parent company", "CyberFight, which also owns DDT and NOAH"],
      ["Format", "Live events, a summer tournament and two major shows"],
      ["Biggest event", "Wrestle Princess"],
    ],
    rhythm: "tours",
    how: [
      "The promotion runs live events, and its shows stream on WRESTLE UNIVERSE.",
      "The Tokyo Princess Cup is a single-elimination summer tournament, and the winner faces the champion at Wrestle Princess.",
      "The two biggest shows of the year are Grand Princess in the spring and Wrestle Princess in the fall.",
    ],
    week: [],
    weekNote: "Shows usually take place around midday or in the evening Japan time, which is morning or midday Makkah time.",
    year: [
      { name: "Grand Princess", months: [3, 4], big: true, text: "The big spring show." },
      { name: "Tokyo Princess Cup", months: [7, 8], text: "The single-elimination summer tournament." },
      { name: "Wrestle Princess", months: [10, 11], big: true, text: "The biggest show of the year." },
    ],
    yearNote: "",
    titles: [
      { group: "Championships", items: [
        ["Princess of Princess Championship", "The promotion's top title.", "Princess of Princess Championship"],
        ["International Princess Championship", "The second-highest title.", "International Princess Championship"],
        ["Princess Tag Team Championship", "The tag team title.", "Princess Tag Team Championship"],
      ] },
    ],
    titlesNote: "",
    terms: [],
    history: [
      ["2013", "The promotion was founded."],
      ["2020", "It became part of CyberFight."],
    ],
    start: [
      "Start with Wrestle Princess or Grand Princess.",
      "Follow the Tokyo Princess Cup in the summer to get to know the roster.",
    ],
  },

  revpro: {
    tagline: "A London-based British promotion founded in 2012. It delivers top-level athletic wrestling and brings in stars from Japan and the US.",
    intro: "RevPro stands for Revolution Pro Wrestling and is one of Britain's most important promotions. It runs numbered monthly shows in London and often features stars from NJPW and other promotions.",
    facts: [
      ["Founded", "2012"],
      ["Headquarters", "London, United Kingdom"],
      ["Format", "A numbered monthly show in London, plus major events"],
      ["Biggest event", "The anniversary show in August"],
    ],
    rhythm: "events",
    how: [
      "Its best-known series is Live in London, a run of shows held roughly once a month and numbered in sequence, such as Live in London 112.",
      "There is no TV show. Events stream on the promotion's own platform, RevPro On Demand.",
      "All of the promotion's titles are billed as “Undisputed” because they are Britain's unified championships.",
    ],
    week: [],
    weekNote: "Shows take place in the evening London time, which is late at night Makkah time.",
    year: [
      { name: "High Stakes", months: [1, 3], text: "A major show early in the year." },
      { name: "Anniversary Show", months: [8], big: true, text: "The biggest show of the year." },
      { name: "Uprising", months: [12], text: "The year-end show." },
    ],
    yearNote: "",
    titles: [
      { group: "Championships", items: [
        ["Undisputed British Heavyweight Championship", "The promotion's top title.", "Undisputed British Heavyweight Championship"],
        ["Undisputed British Cruiserweight Championship", "", "Undisputed British Cruiserweight Championship"],
        ["Undisputed British Women's Championship", "", "Undisputed British Women's Championship"],
        ["Undisputed British Tag Team Championship", "", "Undisputed British Tag Team Championship"],
      ] },
    ],
    titlesNote: "",
    terms: [
      ["Live in London", "The numbered monthly series of shows in London."],
    ],
    history: [
      ["2012", "The promotion was founded in London."],
      ["2020s", "It established itself as one of Britain's most important promotions through its monthly shows and its partnerships with Japanese promotions."],
    ],
    start: [
      "Follow the monthly Live in London shows in order.",
      "Watch the anniversary show in August.",
    ],
  },

  progress: {
    tagline: "A London-based British promotion founded in 2011. Its shows are billed as numbered Chapters, and it is famous for its passionate crowd.",
    intro: "PROGRESS is one of Britain's best-known independent promotions, and its shows are known for the electric atmosphere its fans create. Every main show is called a Chapter and carries a sequential number.",
    facts: [
      ["Founded", "2011"],
      ["Headquarters", "London, United Kingdom"],
      ["Signature venue", "Electric Ballroom in Camden"],
      ["Format", "Numbered shows (Chapters), plus an annual tournament"],
      ["Signature event", "Super Strong Style 16"],
    ],
    rhythm: "events",
    how: [
      "Every main show is called a Chapter and carries a sequential number, so the stories unfold chapter by chapter.",
      "Super Strong Style 16 is an annual single-elimination tournament for 16 wrestlers, held in May. Since 2026 there has also been a women's edition. The winner earns a shot at the top title.",
    ],
    week: [],
    weekNote: "Shows take place in the evening London time, which is late at night Makkah time.",
    year: [
      { name: "Super Strong Style 16", months: [5], big: true, text: "The promotion's best-known annual tournament." },
    ],
    yearNote: "",
    titles: [
      { group: "Championships", items: [
        ["PROGRESS World Championship", "The top men's title.", "PROGRESS World Championship"],
        ["PROGRESS Women's World Championship", "The top women's title.", "PROGRESS Women's World Championship"],
        ["PROGRESS Atlas Championship", "A title for heavyweight wrestlers.", "PROGRESS Atlas Championship"],
        ["PROGRESS Tag Team Championship", "", "PROGRESS Tag Team Championship"],
      ] },
    ],
    titlesNote: "",
    terms: [
      ["Chapter", "The name for a main PROGRESS show."],
    ],
    history: [
      ["2011", "The promotion was founded in London and held its first show in 2012."],
      ["2026", "A women's edition of Super Strong Style 16 was introduced."],
    ],
    start: [
      "Follow the numbered shows in order.",
      "Watch Super Strong Style 16 in May.",
    ],
  },

  hog: {
    tagline: "An independent promotion from New York, founded in 2012. It is known for its shows in Queens and its wrestling school.",
    intro: "HOG stands for House of Glory. It is a promotion and wrestling school in New York that runs live events featuring its own talent alongside well-known stars.",
    facts: [
      ["Founded", "2012"],
      ["Headquarters", "New York, United States"],
      ["Signature venue", "NYC Arena in Jamaica, Queens"],
      ["Format", "Live events every few weeks"],
      ["Best-known shows", "The High Intensity series"],
    ],
    rhythm: "events",
    how: [
      "There is no regular weekly show. The promotion runs live events every few weeks, and the best known is the High Intensity series.",
      "It often brings in well-known stars from the major promotions to work alongside its own talent.",
    ],
    week: [],
    weekNote: "Shows take place in the evening New York time, which is early morning Makkah time.",
    year: [
      { name: "High Intensity", big: true, text: "The promotion's best-known series of shows." },
    ],
    yearNote: "",
    titles: [
      { group: "Championships", items: [
        ["HOG Heavyweight Championship", "The promotion's top title.", "HOG Heavyweight Championship"],
        ["HOG Crown Jewel Championship", "", "HOG Crown Jewel Championship"],
        ["HOG Cruiserweight Championship", "", "HOG Cruiserweight Championship"],
        ["HOG Women's Championship", "", "HOG Women's Championship"],
        ["HOG Tag Team Championship", "", "HOG Tag Team Championship"],
      ] },
    ],
    titlesNote: "",
    terms: [],
    history: [
      ["2012", "Amazing Red founded the promotion in New York."],
    ],
    start: [
      "Watch the latest High Intensity show.",
    ],
  },

  wow: {
    tagline: "An American all-women promotion with superhero-style characters, presented in TV seasons.",
    intro: "WOW stands for Women of Wrestling. It presents women's wrestling as entertainment, and every wrestler plays a fictional character in the mold of a comic book hero.",
    facts: [
      ["Founded", "2000, relaunched in 2022"],
      ["Headquarters", "Los Angeles, United States"],
      ["Owners", "Jeanie Buss, president of the Los Angeles Lakers, and David McLane"],
      ["Format", "TV seasons of weekly shows"],
    ],
    rhythm: "seasons",
    how: [
      "The promotion airs in seasons, and each season is a run of weekly shows.",
      "In the US it airs on local stations on weekends and on platforms such as Pluto TV.",
      "Starting with Season 5, the promotion is moving to live broadcasts after four seasons of taped shows.",
    ],
    week: [],
    weekNote: "",
    year: [],
    yearNote: "",
    titles: [
      { group: "Championships", items: [
        ["WOW World Championship", "The promotion's top title.", "WOW World Championship"],
        ["WOW World Tag Team Championship", "", "WOW World Tag Team Championship"],
      ] },
    ],
    titlesNote: "",
    terms: [],
    history: [
      ["2000", "David McLane founded the promotion."],
      ["2022", "It was relaunched under Jeanie Buss and David McLane, with weekly shows on American television."],
    ],
    start: [
      "Watch each season from the beginning and in order, since the storylines are connected.",
    ],
  },

  row: {
    tagline: "A promotion and wrestling school in Texas, founded in 2005 by wrestling legend Booker T to build a new generation of wrestlers.",
    intro: "ROW stands for Reality of Wrestling. It is a small promotion and training school with a weekly show on YouTube, taped at its monthly live events.",
    facts: [
      ["Founded", "2005, as Pro Wrestling Alliance"],
      ["Headquarters", "Texas City, near Houston, Texas"],
      ["Founder", "Booker T"],
      ["Format", "A weekly YouTube show, taped at a live event each month"],
    ],
    rhythm: "weekly",
    how: [
      "Shows are taped once a month in front of a live crowd, then released week by week on the promotion's YouTube channel.",
      "The promotion's women's division is called the Diamonds Division.",
      "The promotion's main goal is to train young talent and prepare them for the major promotions.",
    ],
    week: [
      { day: "", show: "Reality of Wrestling", program: "Reality of Wrestling", role: "Weekly show", time: "Weekly on YouTube", mecca: "", length: "", channel: "YouTube" },
    ],
    weekNote: "",
    year: [],
    yearNote: "",
    titles: [],
    titlesNote: "",
    terms: [
      ["Diamonds Division", "The name of the promotion's women's division."],
    ],
    history: [
      ["2005", "Booker T founded the promotion in Texas as Pro Wrestling Alliance."],
      ["2026", "The promotion announced new YouTube programming alongside its weekly show."],
    ],
    start: [
      "Follow the weekly YouTube show in order.",
    ],
  },
};
