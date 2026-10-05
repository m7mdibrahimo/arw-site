/**
 * Obfuscates video embed and download URLs so they do not appear as plain text in static HTML.
 * Uses reversible base64 + reverse string manipulation.
 */
function obfuscateUrl(url) {
  if (!url || typeof url !== "string") return "";
  const trimmed = url.trim();
  if (!trimmed) return "";
  try {
    const b64 = Buffer.from(trimmed, "utf-8").toString("base64");
    return b64.split("").reverse().join("");
  } catch (e) {
    return "";
  }
}

module.exports = { obfuscateUrl };
