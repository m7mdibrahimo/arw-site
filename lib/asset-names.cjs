// Every script and stylesheet a page links to goes out under a name made of its own content too:
// /assets/features.css?v=… → /assets/features.3f2a9c1b7e.css (INCIDENTS #617).
//
// /assets/* is cached for a year (_headers). With a version in the query, two things served old files under new
// addresses: a file changed without its hand-written ?v= being raised (features.css, INCIDENTS #616), and, while
// Cloudflare Pages swaps deployments, the first ask for a new ?v= reaching the old one, which ignores the query and
// answers with the old file, cached then for a year (INCIDENTS #612). A name of the file's own bytes can't be either:
// a changed file is a new name whatever the page says, and the old deployment has no such file (a 404, never cached).
// The plain files stay too, for pages cached before and for what scripts load by themselves.
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const REF = /((?:src|href)=["'])(\/(?:en\/)?assets\/[^"'?#\s]+?\.(?:css|js))(?:\?v=[^"'#\s]*)?(["'])/g;
const HASHED = /\.[0-9a-f]{10}\.(?:css|js)$/;

/** The address of a site file's content-named copy (written beside it once), or null when there's no such file */
function hashedName(site, url, made) {
  if (HASHED.test(url)) return url;
  if (made.has(url)) return made.get(url);
  const file = path.resolve(site, "." + url);
  let out = null;
  if (file.startsWith(path.resolve(site) + path.sep)) {
    try {
      const bytes = fs.readFileSync(file);
      const hash = crypto.createHash("md5").update(bytes).digest("hex").slice(0, 10);
      out = url.replace(/\.(css|js)$/, `.${hash}.$1`);
      const copy = path.join(site, out);
      if (!fs.existsSync(copy)) fs.writeFileSync(copy, bytes);
    } catch { out = null; }
  }
  made.set(url, out);
  return out;
}

/** Points every page's script and stylesheet links at the content-named copies. Returns how many pages and files. */
function nameAssetsByContent(site) {
  const made = new Map();
  let pages = 0;
  const walk = (dir) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) { walk(p); continue; }
      if (!e.name.endsWith(".html")) continue;
      const html = fs.readFileSync(p, "utf8");
      if (!html.includes("/assets/")) continue;
      const out = html.replace(REF, (all, open, url, close) => {
        const named = hashedName(site, url, made);
        return named ? open + named + close : all;
      });
      if (out !== html) { fs.writeFileSync(p, out); pages++; }
    }
  };
  walk(site);
  return { pages, files: [...made.values()].filter(Boolean).length };
}

module.exports = { nameAssetsByContent, hashedName };
