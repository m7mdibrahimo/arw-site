import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

test("#1557 a live page never declares a VideoObject (no contentUrl/embedUrl before the show)", () => {
  const lay = fs.readFileSync("_includes/live-layout.njk", "utf8");
  const ld = lay.slice(lay.indexOf('<script type="application/ld+json">'), lay.indexOf("</script>", lay.indexOf('<script type="application/ld+json">')));
  assert.ok(!/"@type":"VideoObject"/.test(ld), "no VideoObject in the live page's structured data");
  assert.match(ld, /"@type":"SportsEvent"/);
  assert.match(ld, /"@type":"BroadcastEvent","isLiveBroadcast":true/);
});

test("#1557 every VideoObject on show pages carries an embedUrl", () => {
  const post = fs.readFileSync("_includes/post-layout.njk", "utf8");
  const i = post.indexOf('"@type": "VideoObject"');
  assert.ok(i > 0);
  assert.match(post.slice(i - 600, i), /\{% if ldEmbed and/);
  assert.match(post.slice(i, i + 400), /"embedUrl": \{\{ ldEmbed/);
});
