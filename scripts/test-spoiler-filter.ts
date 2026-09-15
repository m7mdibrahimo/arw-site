import { isSingleMatchResultArticle } from "./fightful-watcher";

// Comprehensive test suite of 100+ headlines across all wrestling promotions, styles, and edge cases.
export const testCases: Array<{ title: string; expectedFiltered: boolean; category: string }> = [
  // =========================================================================
  // CATEGORY 1: SINGLE MATCH LIVE RESULTS (MUST BE FILTERED / BLOCKED = TRUE)
  // =========================================================================
  {
    title: "Roman Reigns Defeats Penta To Retain World Heavyweight Championship On 9/14 WWE Raw",
    expectedFiltered: true,
    category: "WWE Raw Live Match Result"
  },
  {
    title: "Je'Von Evans Qualifies For Men's Money In The Bank Match On WWE Raw",
    expectedFiltered: true,
    category: "WWE Raw Qualifier"
  },
  {
    title: "Lola Vice Qualifies For Women's Money In The Bank Match On 9/14 WWE Raw",
    expectedFiltered: true,
    category: "WWE Raw Qualifier"
  },
  {
    title: "Chad Gable Retains Intercontinental Championship Against Dragon Lee And Dr. Wagner Jr On 9/14 WWE Raw",
    expectedFiltered: true,
    category: "WWE Raw Title Defense"
  },
  {
    title: "Rey Fenix Defeats El Fiscal To Advance In WWE World Heavyweight Title Tournament On 9/14 WWE Raw",
    expectedFiltered: true,
    category: "WWE Raw Tournament Advance"
  },
  {
    title: "Dragon Lee Defeats Dr. Wagner Jr. To Advance In WWE World Title Contender Tournament On 9/14 WWE Raw",
    expectedFiltered: true,
    category: "WWE Raw Tournament Advance"
  },
  {
    title: "Cody Rhodes Defeats Solo Sikoa In Steel Cage Match On WWE SmackDown",
    expectedFiltered: true,
    category: "WWE SmackDown Live Result"
  },
  {
    title: "Carmelo Hayes Defeats Andrade In Part 7 On 9/13 WWE SmackDown",
    expectedFiltered: true,
    category: "WWE SmackDown Live Result"
  },
  {
    title: "LA Knight Retains WWE United States Title Against Andrade On SmackDown",
    expectedFiltered: true,
    category: "WWE SmackDown Title Retain"
  },
  {
    title: "Nia Jax Defeats Michin In Street Fight To Retain WWE Women's Title On SmackDown",
    expectedFiltered: true,
    category: "WWE SmackDown Title Defense"
  },
  {
    title: "Trick Williams Defeats Ethan Page To Win NXT Championship At NXT CW Premiere",
    expectedFiltered: true,
    category: "NXT Title Win"
  },
  {
    title: "Roxanne Perez Defeats Giulia To Retain NXT Women's Championship On NXT",
    expectedFiltered: true,
    category: "NXT Title Retain"
  },
  {
    title: "Fraxiom Defeats The Street Profits To Retain WWE Tag Team Titles On SmackDown",
    expectedFiltered: true,
    category: "WWE Tag Defense"
  },
  {
    title: "Oba Femi Defeats Tony D'Angelo To Retain NXT North American Title",
    expectedFiltered: true,
    category: "NXT Title Defense"
  },
  {
    title: "Lyra Valkyria Qualifies For Women's Money In The Bank Match On WWE Raw",
    expectedFiltered: true,
    category: "WWE Raw Qualifier"
  },
  {
    title: "Drew McIntyre Defeats Jey Uso On WWE Raw",
    expectedFiltered: true,
    category: "WWE Raw Single Result"
  },
  {
    title: "Seth Rollins Defeats Finn Balor On WWE Raw",
    expectedFiltered: true,
    category: "WWE Raw Single Result"
  },
  {
    title: "Sami Zayn Defeats Ludwig Kaiser On 9/9 WWE Raw",
    expectedFiltered: true,
    category: "WWE Raw Single Result"
  },
  {
    title: "Dominik Mysterio Defeats Dragon Lee On WWE Raw",
    expectedFiltered: true,
    category: "WWE Raw Single Result"
  },
  {
    title: "Braun Strowman Defeats Bronson Reed In Last Monster Standing Match On Raw",
    expectedFiltered: true,
    category: "WWE Raw Gimmick Match"
  },
  {
    title: "The Wagner Brothers Answer The War Raiders Open Challenge At AAA Triplemania 34, Win AAA World Tag Team Titles",
    expectedFiltered: true,
    category: "AAA Triplemania Title Win"
  },
  {
    title: "Stephanie Vaquer Wins WWE Women's Title In Santiago Chile Live Event",
    expectedFiltered: true,
    category: "WWE Live Title Change"
  },
  {
    title: "Jon Moxley Defeats Darby Allin To Earn AEW World Title Shot At Grand Slam",
    expectedFiltered: true,
    category: "AEW Grand Slam Contender"
  },
  {
    title: "Will Ospreay Retains AEW International Championship Against Pac At All Out",
    expectedFiltered: true,
    category: "AEW All Out Title Retain"
  },
  {
    title: "Kazuchika Okada Defeats Mark Briscoe To Retain Continental Crown On Collision",
    expectedFiltered: true,
    category: "AEW Collision Title Defense"
  },
  {
    title: "Bryan Danielson Defeats Jack Perry To Retain AEW World Championship At All Out",
    expectedFiltered: true,
    category: "AEW PPV Title Defense"
  },
  {
    title: "Mercedes Mone Defeats Hikaru Shida To Retain TBS Championship At All Out",
    expectedFiltered: true,
    category: "AEW PPV Title Defense"
  },
  {
    title: "Orange Cassidy Defeats Jay Lethal On 9/13 AEW Collision",
    expectedFiltered: true,
    category: "AEW Collision Match Result"
  },
  {
    title: "Konosuke Takeshita Defeats Action Andretti On AEW Dynamite",
    expectedFiltered: true,
    category: "AEW Dynamite Result"
  },
  {
    title: "Ricochet Defeats Sammy Guevara In Semi-Finals On AEW Dynamite",
    expectedFiltered: true,
    category: "AEW Tournament Semifinals"
  },
  {
    title: "Hook Defeats Roderick Strong To Retain FTW Title On Dynamite",
    expectedFiltered: true,
    category: "AEW Dynamite Title Defense"
  },
  {
    title: "Mariah May Defeats Nyla Rose To Retain AEW Women's World Championship On Collision",
    expectedFiltered: true,
    category: "AEW Collision Title Defense"
  },
  {
    title: "Daniel Garcia Captures AEW TNT Championship On Dynamite",
    expectedFiltered: true,
    category: "AEW Title Win"
  },
  {
    title: "Claudio Castagnoli Defeats Nigel McGuinness At Grand Slam",
    expectedFiltered: true,
    category: "AEW Grand Slam Match"
  },
  {
    title: "Mistico Defeats Mike Bailey In 2-Out-Of-3 Falls Match At CMLL 91st Aniversario",
    expectedFiltered: true,
    category: "CMLL Aniversario Match"
  },
  {
    title: "Austin Aries Crowned New MLW World Heavyweight Champion At Fightland",
    expectedFiltered: true,
    category: "MLW Title Crown"
  },
  {
    title: "Masha Slamovich Captures MLW Women's Title At Fightland",
    expectedFiltered: true,
    category: "MLW Title Capture"
  },
  {
    title: "Nic Nemeth Defeats Josh Alexander To Retain TNA World Title At Emergence",
    expectedFiltered: true,
    category: "TNA Title Retain"
  },
  {
    title: "Jordynne Grace Defeats Ash By Elegance To Retain TNA Knockouts Title",
    expectedFiltered: true,
    category: "TNA Knockouts Retain"
  },
  {
    title: "Matt Cardona Defeats PCO In Monster's Ball Match At TNA iMPACT",
    expectedFiltered: true,
    category: "TNA iMPACT Match Result"
  },
  {
    title: "Joe Hendry Defeats Frankie Kazarian In No. 1 Contenders Match On TNA iMPACT",
    expectedFiltered: true,
    category: "TNA Contender Match"
  },
  {
    title: "Zack Sabre Jr. Defeats Shingo Takagi In G1 Climax Finals",
    expectedFiltered: true,
    category: "NJPW G1 Finals"
  },
  {
    title: "Tetsuya Naito Retains IWGP World Heavyweight Title Against Great-O-Khan",
    expectedFiltered: true,
    category: "NJPW Title Defense"
  },
  {
    title: "Gunther Defeats Randy Orton To Retain World Heavyweight Title At Bash In Berlin",
    expectedFiltered: true,
    category: "WWE PLE Title Defense"
  },
  {
    title: "Damian Priest Defeats Finn Balor In Street Fight At Bad Blood",
    expectedFiltered: true,
    category: "WWE PLE Match Result"
  },
  {
    title: "CM Punk Defeats Drew McIntyre In Hell In A Cell At Bad Blood",
    expectedFiltered: true,
    category: "WWE PLE Gimmick Result"
  },
  {
    title: "Jey Uso Defeats Bron Breakker To Win Intercontinental Championship On Raw",
    expectedFiltered: true,
    category: "WWE Raw Title Win"
  },
  {
    title: "Tiffany Stratton Pins Bayley On WWE SmackDown",
    expectedFiltered: true,
    category: "WWE SmackDown Pinfall Result"
  },
  {
    title: "Bianca Belair & Jade Cargill Defeat The Unholy Union To Retain WWE Women's Tag Titles",
    expectedFiltered: true,
    category: "WWE Tag Title Defense"
  },
  {
    title: "Penta Defeats Rey Fenix In Brother Vs Brother Match On Dynamite",
    expectedFiltered: true,
    category: "AEW Dynamite Match Result"
  },
  {
    title: "Katsuyori Shibata Submits Trent Beretta On ROH TV",
    expectedFiltered: true,
    category: "ROH Submission Result"
  },

  // =========================================================================
  // CATEGORY 2: FULL SHOW RESULTS REPORTS (MUST BE KEPT = FALSE)
  // =========================================================================
  {
    title: "WWE Raw Mexico City Results (9/14/2026): Roman Reigns vs. Penta, Two MITB Qualifiers, More",
    expectedFiltered: false,
    category: "Full Show Results Post"
  },
  {
    title: "ACTION WRESTLING & PRODUCE DEAN~!!! Sunday School Results (9/13)",
    expectedFiltered: false,
    category: "Full Show Results Post"
  },
  {
    title: "WWE SmackDown Results (9/12/2026): Cody Rhodes vs Solo Sikoa, Tag Titles On The Line",
    expectedFiltered: false,
    category: "Full Show Results Post"
  },
  {
    title: "AEW Dynamite Results (9/17): Grand Slam Fallout, Continental Classic Update",
    expectedFiltered: false,
    category: "Full Show Results Post"
  },
  {
    title: "AEW Collision Results (9/13/2026): Continental Title Match, Bryan Danielson Speaks",
    expectedFiltered: false,
    category: "Full Show Results Post"
  },
  {
    title: "WWE NXT Results (9/16/2026): CW Premiere Build, Heritage Cup Defense",
    expectedFiltered: false,
    category: "Full Show Results Post"
  },
  {
    title: "TNA iMPACT Results (9/11/2026): Josh Alexander vs Joe Hendry, Knockouts Action",
    expectedFiltered: false,
    category: "Full Show Results Post"
  },
  {
    title: "CMLL Sabado De Coliseo Results (9/13/2026): Averno vs TMDK Headlines",
    expectedFiltered: false,
    category: "Full Show Results Post"
  },
  {
    title: "GCW No Signal In The Hills Part 5 Results (9/12): Joey Janela In Action",
    expectedFiltered: false,
    category: "Full Show Results Post"
  },
  {
    title: "MLW Fightland Spoilers Taped On 9/12: New Champion Crowned",
    expectedFiltered: false,
    category: "Taped Spoilers Results Post"
  },
  {
    title: "ROH TV Results (9/11): Athena Defends Women's Title, Pure Rules Bout",
    expectedFiltered: false,
    category: "Full Show Results Post"
  },
  {
    title: "NJPW Destruction In Kobe Results (9/29): Naito vs Great-O-Khan",
    expectedFiltered: false,
    category: "Full Show Results Post"
  },

  // =========================================================================
  // CATEGORY 3: UPCOMING MATCH ANNOUNCEMENTS & PREVIEWS (MUST BE KEPT = FALSE)
  // =========================================================================
  {
    title: "Money In The Bank Qualifying Matches Set For 9/21 WWE Raw",
    expectedFiltered: false,
    category: "Match Announcement / Preview"
  },
  {
    title: "Steven Borden And Garrett Borden To Team At RWA",
    expectedFiltered: false,
    category: "Match Announcement / Preview"
  },
  {
    title: "Andrade Match, Tag Team Title Bout Set For MLP Northern Rising",
    expectedFiltered: false,
    category: "Match Announcement / Preview"
  },
  {
    title: "Roman Reigns To Defend World Heavyweight Title Against Penta On 9/14 WWE Raw",
    expectedFiltered: false,
    category: "Match Announcement / Preview"
  },
  {
    title: "Cody Rhodes vs. Kevin Owens Official For WWE Bad Blood",
    expectedFiltered: false,
    category: "Match Announcement / Preview"
  },
  {
    title: "AEW Continental Classic To Begin On 11/18 AEW Dynamite",
    expectedFiltered: false,
    category: "Tournament Announcement"
  },
  {
    title: "Matches Announced For Next Week's 9/22 WWE SmackDown",
    expectedFiltered: false,
    category: "Show Preview / Card"
  },
  {
    title: "Lineup For 9/15 WWE Raw: MITB Qualifiers, IC Title Match",
    expectedFiltered: false,
    category: "Show Lineup"
  },
  {
    title: "Full Match Card For AEW All Out 2026",
    expectedFiltered: false,
    category: "PPV Card"
  },
  {
    title: "Rey Mysterio Scheduled To Face Dominik Mysterio At Triplemania 34",
    expectedFiltered: false,
    category: "Scheduled Match"
  },
  {
    title: "The Butcher Battle Royal Added To 9/12 AEW Collision",
    expectedFiltered: false,
    category: "Match Added"
  },

  // =========================================================================
  // CATEGORY 4: SURPRISE RETURNS, DEBUTS, SIGNINGS & CONTRACTS (MUST BE KEPT = FALSE)
  // =========================================================================
  {
    title: "El Grande Americano Returns To WWE Raw, Teams With Stephanie Vaquer In Mixed Tag Action",
    expectedFiltered: false,
    category: "Wrestler Return"
  },
  {
    title: "'Pitbull' Gary Wolfe To Make GCW Debut In October",
    expectedFiltered: false,
    category: "Wrestler Debut"
  },
  {
    title: "Ilja Dragunov Coming To AEW Following WWE Contract Expiry",
    expectedFiltered: false,
    category: "Contract / Signing"
  },
  {
    title: "AJ Lee Returns To WWE At SmackDown In Surprise Appearance",
    expectedFiltered: false,
    category: "Surprise Return"
  },
  {
    title: "Motor City Machine Guns Debut On WWE SmackDown, Attack Bloodline",
    expectedFiltered: false,
    category: "Faction Debut"
  },
  {
    title: "Rey Fenix Signs Long-Term Contract With WWE",
    expectedFiltered: false,
    category: "Signing News"
  },
  {
    title: "Michael Venom Page Departs UFC, Becomes Free Agent",
    expectedFiltered: false,
    category: "Departure / Free Agent"
  },
  {
    title: "Penta Leaves AEW As Contract Officially Expires",
    expectedFiltered: false,
    category: "Departure"
  },
  {
    title: "Hikuleo Signs Multi-Year Contract With WWE, Assigned To NXT",
    expectedFiltered: false,
    category: "Signing"
  },

  // =========================================================================
  // CATEGORY 5: INJURIES, SURGERIES, MEDICAL & REAL NEWS (MUST BE KEPT = FALSE)
  // =========================================================================
  {
    title: "Stephen Wolf Announces He Will Be Out Of The Ring Indefinitely Due To A Neck Injury",
    expectedFiltered: false,
    category: "Injury Announcement"
  },
  {
    title: "Mercedes Martinez Set For ACL Surgery On 10/15, GoFundMe Still Open",
    expectedFiltered: false,
    category: "Surgery News"
  },
  {
    title: "Tom Aspinall Vacates UFC Heavyweight Title Due To Eye Injury",
    expectedFiltered: false,
    category: "Title Vacated / Medical"
  },
  {
    title: "Pro Wrestling NOAH Pulls AMAKUSA From Action After Abnormality Detected In Medical Checkup",
    expectedFiltered: false,
    category: "Medical Checkup"
  },
  {
    title: "Scott Coker Announces Ki MMA, Set To Launch In 2027",
    expectedFiltered: false,
    category: "Business News"
  },
  {
    title: "The Rock Details Losing 50 Pounds For 'Lizard Music,' Injuries From 'Smashing Machine'",
    expectedFiltered: false,
    category: "Actor / Movie / Injuries"
  },
  {
    title: "Liv Morgan Featured In First Japanese Trailer For 'Bad Lieutenant: Tokyo', WWE Raw Preview, More | Fight Size",
    expectedFiltered: false,
    category: "Movie Trailer / Fight Size"
  },
  {
    title: "WWE Legend Solar II Passes Away At Age 66",
    expectedFiltered: false,
    category: "Obituary"
  },

  // =========================================================================
  // CATEGORY 6: INTERVIEWS, QUOTES, REACTIONS & OPINIONS (MUST BE KEPT = FALSE)
  // =========================================================================
  {
    title: "Nattie Says Undertaker Loves 'Aggression, Intensity, And Selling' As A Booker",
    expectedFiltered: false,
    category: "Interview Quote"
  },
  {
    title: "Sam Adonis Backstage At WWE Raw",
    expectedFiltered: false,
    category: "Backstage Report"
  },
  {
    title: "Roxanne Perez Really Does Love Her Current WWE Theme, Believes It Fits Her Aesthetic",
    expectedFiltered: false,
    category: "Interview Quote"
  },
  {
    title: "Roxanne Perez On If She Will One Day Outgrow 'The Prodigy' Nickname",
    expectedFiltered: false,
    category: "Interview Quote"
  },
  {
    title: "Bayley Reflects On WWE's South America Live Tour: 'Some Of The Favorite Moments Of My Career'",
    expectedFiltered: false,
    category: "Interview Quote"
  },
  {
    title: "Stephanie Vaquer Comments After Winning WWE Women's World Championship In Chile",
    expectedFiltered: false,
    category: "Post-Match Interview"
  },
  {
    title: "Sami Zayn: 'Ride Or Dies Rejoice, Justice At Last! Two Time WWE Champion!'",
    expectedFiltered: false,
    category: "Social Media Reaction"
  },
  {
    title: "Danhausen And Liv Morgan Name The Wrestling Storylines They Wish They Could Have Been A Part Of",
    expectedFiltered: false,
    category: "Podcast Interview"
  },
  {
    title: "Dominik Mysterio Tells Sherilyn Guerrero To Hit Him Up Regarding Her Wrestling Training",
    expectedFiltered: false,
    category: "Social Media Interaction"
  },
  {
    title: "Brian Cage: AEW PPVs Smash WWE PPVs Every Time",
    expectedFiltered: false,
    category: "Interview Quote"
  },
  {
    title: "Brad Williams Wants To Face Hornswoggle: 'That's Rock vs Hogan'",
    expectedFiltered: false,
    category: "Interview Quote"
  },
  {
    title: "Omos: 'I Am The Greatest Working Living Giant In This Business'",
    expectedFiltered: false,
    category: "Interview Quote"
  },
  {
    title: "Rikishi Explains The Origins Of The Stink Face In WWE",
    expectedFiltered: false,
    category: "Historical Interview"
  },
  {
    title: "Rhino Details The Origins Of The Gore, Recalls Not Wanting To Use It Because Goldberg Got It Over",
    expectedFiltered: false,
    category: "Historical Interview"
  },
  {
    title: "Mick Foley On WWE Burning Out His Passion And Finding Life Again In AEW",
    expectedFiltered: false,
    category: "Interview Quote"
  },
  {
    title: "Will Ospreay Recalls CM Punk And Jack Perry Brawl At All In Wembley: 'I Thought They Were Doing A Promo'",
    expectedFiltered: false,
    category: "Backstage Retrospective"
  },
  {
    title: "Will Ospreay: My Neck Surgery Cost Over $420,000 And Tony Khan Paid Every Cent",
    expectedFiltered: false,
    category: "Interview Quote"
  },
  {
    title: "Pete Dunne Producing Dominik Mysterio vs. El Grande Americano At AAA Triplemania 34",
    expectedFiltered: false,
    category: "Backstage Producer News"
  },
  {
    title: "Dax Harwood Slams Ex-WWE Stars Who Only Come To AEW For The Money",
    expectedFiltered: false,
    category: "Podcast Quote"
  },
  {
    title: "Adam Copeland Praises Mexican Fans Reaction At Grand Slam Mexico: 'Felt Like 2020 Royal Rumble'",
    expectedFiltered: false,
    category: "Interview Quote"
  }
];

export function runSuite() {
  console.log(`\n🧪 Running Ironclad Spoiler Filter Test Suite (${testCases.length} Test Cases)...\n`);
  let passed = 0;
  let failed = 0;

  for (let i = 0; i < testCases.length; i++) {
    const tc = testCases[i];
    const actual = isSingleMatchResultArticle(tc.title);
    const success = actual === tc.expectedFiltered;

    if (success) {
      passed++;
    } else {
      failed++;
      console.error(`❌ FAILED Test Case #${i + 1} [${tc.category}]:`);
      console.error(`   Title:    "${tc.title}"`);
      console.error(`   Expected: ${tc.expectedFiltered ? "FILTERED (SKIP)" : "KEPT (ALLOW)"}`);
      console.error(`   Actual:   ${actual ? "FILTERED (SKIP)" : "KEPT (ALLOW)"}\n`);
    }
  }

  console.log(`--------------------------------------------------`);
  console.log(`📊 Suite Results: ${passed}/${testCases.length} Passed (${((passed / testCases.length) * 100).toFixed(1)}%).`);
  if (failed === 0) {
    console.log(`✅ 100% SUCCESS: ALL 100+ CASES PASSED FLAWLESSLY!\n`);
  } else {
    console.error(`⚠️ ${failed} tests failed! Review implementation.\n`);
    process.exit(1);
  }
}

if (require.main === module) {
  runSuite();
}
