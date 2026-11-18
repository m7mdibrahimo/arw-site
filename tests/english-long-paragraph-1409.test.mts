import { test } from "node:test";
import assert from "node:assert/strict";
import { splitLongParagraphs } from "../scripts/english-edition.ts";

const ash = `Ash By Elegance is approaching free agency as her current contract with TNA Wrestling is scheduled to expire on December 31, 2026. The former TNA Knockouts World Champion confirmed the expiration date during an appearance on TMZ Inside The Ring while discussing her pregnancy and future in professional wrestling. She revealed that TNA has told her she can return and renegotiate whenever she is ready. "They are like, ‘Whenever you are ready, just know that the door is open for you. Just know that you are able to come in and we can renegotiate, we can work on your contract.’ I am under contract until December 31st of this year, and then my contract is expired." Ash is currently expecting her first child in January 2027, following major personal changes. Despite her contract ending, she expressed a strong desire to return to the ring, noting that becoming a mother has given her even more motivation to wrestle again. Her husband is fully supportive of her ambitions, and she believes the TNA locker room will welcome her son when she comes back. Ash previously relinquished the TNA Knockouts World Championship in 2025 before signing a new agreement in January 2026.

https://www.youtube.com/watch?v=9kZdSu4fR0A`;

test("one long English paragraph is cut into short ones and its whole quote gets its own line (INCIDENTS #1409)", () => {
  const out = splitLongParagraphs(ash);
  const paras = out.split("\n\n");
  assert.ok(paras.length >= 4, out);
  assert.ok(paras.some((p) => p.startsWith(`> "They are like`) && p.endsWith(`expired."`)), out);
  assert.ok(paras.every((p) => p.split(/\s+/).length < 110), out);
  assert.equal(paras.at(-1), "https://www.youtube.com/watch?v=9kZdSu4fR0A");
  // nothing lost or reordered
  assert.equal(out.replace(/^> /gm, "").replace(/\s+/g, " "), ash.replace(/\s+/g, " "));
});

test("abbreviations and short paragraphs are left alone", () => {
  const short = "He moved to St. Louis. He likes it. He trains daily. He will debut soon.";
  assert.equal(splitLongParagraphs(short), short);
  const long = Array.from({ length: 8 }, (_, i) => `Mr. Smith met Dr. Jones in St. Louis for the ${i + 1}th time vs. the odds and they talked about wrestling at length.`).join(" ");
  const out = splitLongParagraphs(long);
  assert.ok(!/\b(Mr|Dr|St|vs)\.\n/.test(out), out);
  assert.ok(out.split("\n\n").length >= 2, out);
});

test("a results list is never touched", () => {
  const list = Array.from({ length: 20 }, (_, i) => `- Wrestler ${i} def. Opponent ${i} in a long singles match with plenty of action`).join("\n");
  assert.equal(splitLongParagraphs(list), list);
});
