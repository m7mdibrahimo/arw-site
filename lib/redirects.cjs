// Converts the repo's _redirects (written in Netlify syntax: `301!`, domain-level
// sources) into rules Cloudflare Pages actually honours.
//
// Pages rejects every line whose status isn't a bare number, so `301!` made the
// ENTIRE file a no-op — every renamed/merged article or tag URL 404'd. Pages also
// ignores domain-level sources and caps splat rules at 100, so a `/old/* /new/:splat`
// rule stays a splat only when its target actually has sub-pages (tag pagination,
// section indexes); otherwise it becomes static rules for the URLs the page has
// (/old/, /old, /old/index.html). Arabic paths match both raw and encoded as-is.
// Order matters: Pages counts every rule from the first splat onward toward the
// 100-rule dynamic cap (verified on a preview deploy — with one splat on line 5,
// rules past line 100 silently stopped working), so all static rules go first.
const fs = require("fs");
const path = require("path");

const PAGES_STATIC_LIMIT = 2000;
const PAGES_DYNAMIC_LIMIT = 100;

function hasSubPages(siteDir, dest) {
  try {
    const dir = path.join(siteDir, decodeURI(dest));
    return fs.readdirSync(dir, { withFileTypes: true }).some(e => e.isDirectory());
  } catch {
    return false;
  }
}

function toPagesRedirects(text, siteDir = "_site") {
  const staticRules = [];
  const dynamicRules = [];
  const seen = new Set();
  const add = (from, to, code, isDynamic = false) => {
    if (seen.has(from)) return;
    seen.add(from);
    (isDynamic ? dynamicRules : staticRules).push(`${from} ${to} ${code}`);
  };
  for (const raw of text.split("\n")) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const [from, to, rawCode = "301"] = line.split(/\s+/);
    if (!from || !to || !from.startsWith("/")) continue; // domain-level: unsupported on Pages
    const code = rawCode.replace(/!$/, "");
    if (from.endsWith("/*") && to.endsWith("/:splat")) {
      const base = from.slice(0, -1);
      const dest = to.slice(0, -":splat".length);
      if (dynamicRules.length < PAGES_DYNAMIC_LIMIT && hasSubPages(siteDir, dest)) {
        add(from, to, code, true);
      } else {
        add(base, dest, code);
        add(base.slice(0, -1), dest, code);
        add(`${base}index.html`, dest, code);
      }
    } else {
      add(from, to, code, from.includes("*") || from.includes(":"));
    }
  }
  if (staticRules.length > PAGES_STATIC_LIMIT || dynamicRules.length > PAGES_DYNAMIC_LIMIT) {
    throw new Error(`_redirects exceeds Cloudflare Pages limits (${staticRules.length}/${PAGES_STATIC_LIMIT} static, ${dynamicRules.length}/${PAGES_DYNAMIC_LIMIT} dynamic)`);
  }
  return [...staticRules, ...dynamicRules].join("\n") + "\n";
}

module.exports = { toPagesRedirects };
