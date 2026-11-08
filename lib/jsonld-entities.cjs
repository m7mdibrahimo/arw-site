// The structured data (<script type="application/ld+json">) is written by the templates with Nunjucks' HTML
// «escape» filter, but a <script> is raw text: the browser and Google never decode entities there, so
// «AEW Dynamite Blood & Guts» reached Google as «Blood &amp; Guts» in the VideoObject's name, alternateName,
// keywords and description (INCIDENTS #1135). Every built page's JSON-LD gets the entities back as the real
// characters, written the JSON way («"» → \", «<» → < so «</script>» can never appear), and a block whose
// result is not valid JSON is left as it was.
const BLOCK = /(<script\s+type="application\/ld\+json"[^>]*>)([\s\S]*?)(<\/script>)/gi;
function decodeJsonLd(json) {
  return json
    .replace(/&quot;/g, '\\"')
    .replace(/&#39;|&#x27;|&apos;/g, "'")
    .replace(/&lt;/g, "\\u003c")
    .replace(/&gt;/g, "\\u003e")
    .replace(/&amp;/g, "&");
}
function fixJsonLdEntities(html) {
  if (typeof html !== "string" || !html.includes("application/ld+json") || !html.includes("&")) return html;
  return html.replace(BLOCK, (all, open, body, close) => {
    if (!/&(?:quot|#39|#x27|apos|lt|gt|amp);/.test(body)) return all;
    const fixed = decodeJsonLd(body);
    try { JSON.parse(fixed); } catch { return all; }
    return open + fixed + close;
  });
}
module.exports = { fixJsonLdEntities, decodeJsonLd };
