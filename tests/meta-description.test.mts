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
    if (d.endsWith("…") || d.length > 160 || d.length < 40) bad.push(`${f}: ${d.slice(-40)}`);
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

test("a cut never stops on a phrase opened by a subordinating word (INCIDENTS #868)", () => {
  // The live Samoa Joe description ended «…showcase their full capabilities following years spent.» —
  // the lead's first sentence is longer than the limit and has no comma, so the word cut left half a clause.
  const lead = "Samoa Joe asserted that the move to AEW will grant Austin Creed and Kofi a genuine opportunity to showcase their full capabilities following years spent in WWE. Joe, who achieved major success in Tony Khan's promotion, noted that fans will witness unprecedented style variety.";
  const d = metaDescription(lead);
  assert.ok(d.length <= 158, `${d.length}: ${d}`);
  assert.ok(!/\b(?:following|including|during|after|before|despite)\s+\w+(?:\s+\w+)?\.?$/.test(d), d);
  assert.match(d, /capabilities\.$/, d);
});
