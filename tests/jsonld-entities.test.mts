import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { fixJsonLdEntities } = require('../lib/jsonld-entities.cjs');

const page = (json: string) => `<html><head><script type="application/ld+json">${json}</script></head><body><p>Blood &amp; Guts</p></body></html>`;
const ld = (html: string) => JSON.parse(html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/)![1]);

test("JSON-LD names carry «&», not «&amp;» (INCIDENTS #1135)", () => {
  const out = fixJsonLdEntities(page('{"@type":"VideoObject","name":"AEW Dynamite Blood &amp; Guts","alternateName":["Rock &#39;n&#39; Roll","He said &quot;yes&quot;","a &lt;/script&gt; b","&amp;quot; stays text"]}'));
  const d = ld(out);
  assert.equal(d.name, "AEW Dynamite Blood & Guts");
  assert.deepEqual(d.alternateName, ["Rock 'n' Roll", 'He said "yes"', "a </script> b", "&quot; stays text"]);
  assert.ok(!out.includes("a </script> b"), "a «</script>» never appears inside the block");
  assert.ok(out.includes("<p>Blood &amp; Guts</p>"), "the visible page is untouched");
});

test("a JSON-LD block that would stop being valid JSON is left as it was", () => {
  const html = page('{"name":"x"} &amp;');
  assert.equal(fixJsonLdEntities(html), html);
});

test("a meta description made from the rendered story has «&», not «&amp;» (INCIDENTS #1135)", () => {
  const { metaDescription } = require('../lib/meta-description.cjs');
  const d = metaDescription("يعود AEW للبث على Twitch قبل انطلاق Blood &amp; Guts، ونشر WWE قائمة بأبرز عشر لقطات من عروضه &#8220;اليوم&#8221;.");
  assert.ok(d.includes("Blood & Guts"), d);
  assert.ok(!/&(amp|#\d+);/.test(d), d);
});
