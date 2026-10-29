import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import matter from "gray-matter";
import { metaDescription } from "../lib/meta-description.cjs";

test("a meta description never ends with «…» or mid-word (INCIDENTS #862)", () => {
  const lead = "Sami Zayn spoke about his gradual transition to a heel persona during an appearance on Chris Van Vliet's Insight podcast. Zayn explained that the process started after he lost to Drew McIntyre at WWE Royal Rumble.";
  const d = metaDescription(lead);
  assert.ok(d.length <= 158, `${d.length}: ${d}`);
  assert.ok(!d.endsWith("…") && !d.endsWith("..."), d);
  assert.match(d, /[.!?]$/);
  assert.ok(!/\b(?:in|on|at|to|for|with|and|of|the)\.$/.test(d), d);
});

test("a very short first sentence is joined by the next one, not left alone", () => {
  const d = metaDescription("Yota Tsuji is set to appear for MLW. The promotion has been teasing the arrival of the current IWGP Heavyweight Champion, and his appearance has now been confirmed.");
  assert.ok(d.length >= 70, d);
  assert.match(d, /^Yota Tsuji is set to appear for MLW\. The promotion/);
});

test("Arabic descriptions end at a sentence or clause, never mid-word", () => {
  const d = metaDescription("تحدث المصارع سامي زين عن نزاله التاريخي ضد جوني نوكسفيل في عرض WrestleMania 38، مشيرا إلى أن المواجهة اعتمدت بالكامل على حركات وحيل برنامج Jackass بدلا من تقنيات المصارعة التقليدية.");
  assert.ok(!d.endsWith("...") && !d.endsWith("…"), d);
  assert.ok(d.length <= 158, `${d.length}`);
  assert.match(d, /[.!؟]$/);
});

test("no published English story keeps a description cut with «…»", () => {
  const dir = path.join(process.cwd(), "content", "news-en");
  const bad: string[] = [];
  for (const f of fs.readdirSync(dir).filter((x) => x.endsWith(".md"))) {
    const d = String(matter(fs.readFileSync(path.join(dir, f), "utf-8")).data.description || "");
    if (!d) continue;
    // a complete sentence may run to ~185 letters rather than stop in a four-word fragment (live 2026-10-27)
    if (d.endsWith("…") || d.length > 185 || d.length < 40) bad.push(`${f}: ${d.slice(-40)}`);
  }
  assert.deepEqual(bad, []);
});

test("a cut never leaves a verb hanging after its preposition (INCIDENTS #868)", () => {  // The live description of the Bobby Lashley story ended «…with a Tesla Cybertruck by sharing.» — a
  // sentence that stops on a gerund is unreadable under the title in Google.
  const lead = "Bobby Lashley has a new ride and a specific reason for buying it. The AEW star joined the growing list of wrestlers with a Tesla Cybertruck by sharing a video on Instagram. The clip started with the question, \"Why would you even get a Tesla?\"";
  const d = metaDescription(lead);
  assert.ok(!/\b(?:by|of|for|about|from|with|into|on|at|to|against|over|under|between|via)\s+\w+ing\.?$/.test(d), d);
  assert.match(d, /it\.$/, d);
});

test("a cut never stops on an abbreviation that ends with a full stop (INCIDENTS #869)", () => {
  // The live Chris Jericho description ended «…during a recent concert. The performance took place
  // on Oct.» because «Oct.» was read as the end of a sentence. Eleven live descriptions were cut the
  // same way («…and Nov.», «…U.S.», «…according to Wrestling Inc.», «…and Mr.», «…vs.»).
  const lead = "AEW star Chris Jericho joined musician Teddy Swims on stage for a lighthearted moment during a recent concert. The performance took place on Oct. 25 at the Benchmark International Arena in Tampa, Florida, where Jericho made a surprise appearance to help Swims launch hot dogs into the audience.";
  const d = metaDescription(lead);
  assert.ok(!/(?:Oct|Nov|Dec|Sept|Inc|Mr|vs|U\.S)\.$/.test(d), d);
  assert.match(d, /recent concert\.$/, d);
  const judge = metaDescription("A federal judge has rejected the latest attempt by WWE, TKO, Vince McMahon, and Linda McMahon to dismiss the long-standing ring boy lawsuit. U.S. District Judge Timothy Corrigan ruled on the motion this week, keeping the case alive.");
  assert.ok(!/U\.S\.$/.test(judge), judge);
  const coachman = metaDescription("Jonathan Coachman says he was told WWE's plans for WrestleMania include Cody Rhodes vs. CM Punk and Oba Femi vs. Jacob Fatu. Coachman shared the news on his podcast this week.");
  assert.ok(!/\bvs\.$/.test(coachman), coachman);
});

test("a cut never stops on a phrase opened by a subordinating word (INCIDENTS #868)", () => {
  // The live Samoa Joe description ended «…showcase their full capabilities following years spent.» —
  // the lead's first sentence is longer than the limit and has no comma, so the word cut left half a clause.
  const lead = "Samoa Joe asserted that the move to AEW will grant Austin Creed and Kofi a genuine opportunity to showcase their full capabilities following years spent in WWE. Joe, who achieved major success in Tony Khan's promotion, noted that fans will witness unprecedented style variety.";
  const d = metaDescription(lead);
  assert.ok(d.length <= 158, `${d.length}: ${d}`);
  assert.ok(!/\b(?:following|including|during|after|before|despite)\s+\w+(?:\s+\w+)?\.?$/.test(d), d);
  assert.match(d, /capabilities\.$/, d);
});

test("a cut never stops inside a multi-word name (live 2026-10-27)", () => {
  // The live Chris Bey description ended «…the severe neck injury and paralysis he suffered at a post-TNA
  // Bound.» — «Bound for Glory» lost its rest and the snippet read as if the injury happened «at a post-TNA
  // Bound». The word cut now goes back to the last preposition before the half name.
  const lead = "Chris Bey recently took to social media to reflect on the two-year anniversary of the severe neck injury and paralysis he suffered at a post-TNA Bound for Glory television taping.";
  const d = metaDescription(lead);
  assert.ok(!/\bBound\.$/.test(d), d);
  assert.ok(!/\b(?:for|of|in|at|to)$/.test(d.replace(/\.$/, "")), d);
  assert.match(d, /suffered\.$/, d);
});

test("a description never ends on a quantifier whose noun was cut away (live 2026-10-27)", () => {
  // «…using a bag of sweets to poke fun at several.» — «several» needs «prominent wrestling figures» after it.
  const d = metaDescription("Comedian Kyle Fields released a new parody video on Instagram titled \"Bret Hart Reviews Halloween Candy,\" using a bag of sweets to poke fun at several prominent wrestling figures through his impression of the Hall of Famer. In the video, Fields turns various classic candies into punchlines targeting Shawn Michaels, Vince McMahon, Bill Goldberg, and Eric Bischoff.");
  assert.ok(!/\b(?:several|many|some|most|each|every|these|those|such|various|numerous|few|another)\.$/.test(d), d);
  assert.match(d, /[.!?]$/);
});

test("no published English description ends on a quantifier", () => {
  const dir = path.join(process.cwd(), "content", "news-en");
  const DANGLING = /\b(?:several|many|some|most|each|every|these|those|such|various|numerous|few|another)\.$/;
  const bad: string[] = [];
  for (const f of fs.readdirSync(dir).filter((x) => x.endsWith(".md"))) {
    const d = String(matter(fs.readFileSync(path.join(dir, f), "utf-8")).data.description || "");
    if (DANGLING.test(d)) bad.push(`${f}: ${d}`);
  }
  assert.deepEqual(bad, []);
});

test("a description never ends on a bare time phrase (live 2026-10-27)", () => {
  // «Monica Monroe recently reflected on a viral moment involving Booker T. Back in July 2025.» — «T.» was
  // read as an initial, so the two sentences joined, the cut fell on the comma after the date and the
  // snippet under the title said nothing.
  const monica = metaDescription("Monica Monroe recently reflected on a viral moment involving Booker T. Back in July 2025, Booker T accidentally referred to Blake Monroe as Monica Monroe during an episode of WWE NXT. The mistake quickly gained traction online.");
  assert.equal(monica, "Monica Monroe recently reflected on a viral moment involving Booker T.");
  // «Bandido has set a major milestone in Ring of Honor history. On October 14.»
  const bandido = metaDescription("Bandido has set a major milestone in Ring of Honor history. On October 14, he officially surpassed Jay Lethal to claim the record for the most overall days as the ROH World Champion, reaching over 710 days across two reigns.");
  assert.equal(bandido, "Bandido has set a major milestone in Ring of Honor history.");
  // a real sentence that opens with a date keeps its verb and stays
  const kept = metaDescription("On October 14, Bandido broke the record for the most overall days as ROH World Champion, passing Jay Lethal after three years at the top of the division.");
  assert.match(kept, /On October 14, Bandido broke the record/);
});

test("no published description ends on a bare time phrase", () => {
  const dir = path.join(process.cwd(), "content", "news-en");
  const TIME_ONLY = /\. (?:Back in|In|On|At|During|Since|Earlier|Later|Meanwhile) (?:the )?(?:January|February|March|April|May|June|July|August|September|October|November|December|\d{4}|\d{1,2})\.$/;
  const bad: string[] = [];
  for (const f of fs.readdirSync(dir).filter((x) => x.endsWith(".md"))) {
    const d = String(matter(fs.readFileSync(path.join(dir, f), "utf-8")).data.description || "");
    if (TIME_ONLY.test(d)) bad.push(`${f}: ${d}`);
  }
  assert.deepEqual(bad, []);
});

// Live 2026-10-27 (Elio LeFleur, /en/news/elio-lefleur-returns-to-in-ring-action/): the cut left a second sentence
// with only a subordinate clause — «…has made his return to the ring. Prior to the October 27th episode of WWE NXT
// on The CW.» — so the line under the title said nothing. The clause is now completed or dropped.
test("a description never ends on a subordinate clause whose main clause was cut", () => {
  const elio = metaDescription("Elio LeFleur has made his return to the ring. Prior to the October 27th episode of WWE NXT on The CW, dark matches were held for the fans in attendance at the Performance Center. One of these bouts featured the in-ring return of the former Men's Speed Champion.");
  assert.equal(elio, "Elio LeFleur has made his return to the ring. Prior to the October 27th episode of WWE NXT on The CW, dark matches were held for the fans in attendance at the Performance Center.");
  // a subordinate clause that cannot be completed inside the limit goes, and the sentence before it ends the line
  const arabic = metaDescription("عاد المصارع إيليو ليفلور إلى الحلبة مجددا. وقبل انطلاق عرض WWE NXT على قناة The CW، أقيمت نزالات غير مذاعة للجماهير الحاضرة في مركز الأداء التابع لاتحاد WWE.");
  assert.ok(!/\.\s*(?:وقبل|قبل|بعد)$/.test(arabic), arabic);
  // a real sentence that opens with a subordinator and has its main clause after the comma is not touched
  const kept = metaDescription("After the match ended, Rhodes said the crowd in Chicago was the loudest he had heard in years, and he thanked them for staying to the end of the night.");
  assert.match(kept, /^After the match ended, Rhodes said/);
});

test("no published description ends on a lone subordinate clause", () => {
  const dirs = [path.join(process.cwd(), "content", "news-en")];
  const FRAGMENT = /\. (?:Prior to|Before|After|While|When|As|During|Following|Despite|Because|Since|If|Although|Though|According to) [^,.]*\.$/;
  const bad: string[] = [];
  for (const dir of dirs) for (const f of fs.readdirSync(dir).filter((x) => x.endsWith(".md"))) {
    const d = String(matter(fs.readFileSync(path.join(dir, f), "utf-8")).data.description || "");
    if (FRAGMENT.test(d)) bad.push(`${f}: ${d}`);
  }
  assert.deepEqual(bad, []);
});

test("a corporate abbreviation «Bros.» is not the end of a sentence (live 2026-10-28)", () => {
  // «Tony Khan remains enthusiastic about the future of AEW. Following the acquisition of Warner Bros.» —
  // «Bros.» counted as a sentence end, so the line under the title stopped half-way through the sentence.
  const khan = metaDescription("Tony Khan remains enthusiastic about the future of AEW. Following the acquisition of Warner Bros. Discovery by Paramount, which resulted in the formation of Skydance, Khan has been engaging with the new leadership.");
  assert.equal(khan, "Tony Khan remains enthusiastic about the future of AEW.");
  // a real sentence that simply mentions the company keeps its words
  const creed = metaDescription("Austin Creed has expressed complete confidence in his and Kofi's ability to quickly adjust to AEW following a 16-year run in WWE, according to Wrestling Inc.");
  assert.ok(creed.endsWith("Wrestling Inc."), creed);
});

test("a word cut never ends on a superlative without its noun (INCIDENTS #935)", () => {
  // The live Sami Zayn description ended «…credited Sexxxy Eddy with providing the biggest.» — «the biggest
  // break of his career» lost its noun. The cut goes back to the last «and» instead.
  const lead = "During an interview on Insight with Chris Van Vliet, Sami Zayn reflected on his career and credited Canadian wrestler Sexxxy Eddy with providing the biggest break of his career. Zayn explained that back in his early years, getting booked had nothing to do with him.";
  const d = metaDescription(lead);
  assert.ok(!/\bthe\s+\w+est\.?$/.test(d), d);
  assert.equal(d, "During an interview on Insight with Chris Van Vliet, Sami Zayn reflected on his career.");
});

// A participle phrase cut at its comma: «…first gold in WWE. Continuing their recent success.» (INCIDENTS #959)
test("a description never ends with an -ing phrase cut at its comma (INCIDENTS #959)", () => {
  const d = metaDescription("Michin and B-Fab have officially claimed their first gold in WWE. Continuing their recent success, the duo defeated Alexa Bliss and Tatum Paxley to win the WWE Women's Tag Team Championships on the October 23 episode of WWE SmackDown. Speaking with Complex Graps, Michin shared");
  assert.equal(d, "Michin and B-Fab have officially claimed their first gold in WWE.");
});
