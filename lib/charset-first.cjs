// «<meta charset>» must sit in a page's first 1024 bytes: browsers look for it only there. Pages
// served without a charset (Cloudflare sends plain «text/html») and with the theme/ads/language
// scripts ahead of it had it at ~4 KB, so a browser could start in Windows-1252 and decode the
// script files it already asked for that way: «✓ شاهدته» showed as «âœ“ Ø´Ø§Ù‡Ø¯Øª» on cards
// (owner 2026-11-05). Every built page gets it first in <head>.
const META = /<meta\s+charset\s*=\s*["']?utf-8["']?\s*\/?>\s*/i;
function charsetFirst(html) {
  if (typeof html !== "string" || !/<head\b/i.test(html)) return html;
  const head = html.match(/<head\b[^>]*>/i);
  const at = head.index + head[0].length;
  if (/^\s*<meta\s+charset\s*=\s*["']?utf-8["']?\s*\/?>/i.test(html.slice(at))) return html;
  const without = html.slice(0, at) + html.slice(at).replace(META, "");
  return without.slice(0, at) + '<meta charset="UTF-8">' + without.slice(at);
}
module.exports = { charsetFirst };
