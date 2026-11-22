import test from "node:test";
import assert from "node:assert/strict";

// Round 2026-11-22 04:15 UTC: «Kiana James is preparing to join AAA. During the November 21 episode of AAA on FOX.» —
// the clause cut left a «During…» opener as the description's last sentence, without its subject and verb.
test("a «During…» opener as the second sentence of a clause cut is never the end of the description", async () => {
  const { metaDescription } = await import("../lib/meta-description.cjs");
  const d = metaDescription(`Kiana James is preparing to join AAA. During the November 21 episode of AAA on FOX, a promotional vignette aired for James featuring the caption "Coming Soon."`);
  assert.doesNotMatch(d, /on FOX\.$/);
  assert.match(d, /Coming Soon/);
});

test("«Guilia» is written Giulia in the English edition", async () => {
  const { fixEnglishNames } = await import("../scripts/english-edition.ts");
  assert.equal(fixEnglishNames("Nia Jax def. Guilia."), "Nia Jax def. Giulia.");
});

test("«I.D.» is not a sentence end in a description (Laynie Luck story)", async () => {
  const { metaDescription } = await import("../lib/meta-description.cjs");
  const d = metaDescription("Laynie Luck has spoken out regarding the decision not to renew her WWE I.D. contract. Following her loss of the WWE I.D. Women's Championship, it was confirmed that she would return to free agency. Luck held the title for more than 300 days.");
  assert.doesNotMatch(d, /WWE I\.D\.$/);
});
