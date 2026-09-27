// One URL per show, even when two shows share a title (INCIDENTS #83): a new show saved
// with an existing show's title («Lucha Libre AAA 19.09.2026», later renamed to 26.09)
// produced the same permalink, and Eleventy then refused the WHOLE build — nothing new
// reached the site until the title was changed. The oldest file keeps the plain slug;
// later ones get "-2", "-3"… Used by the site (content/shows/shows.11tydata.js) and by
// the show-reel monitor, so both always agree on the URL.
const fs = require("fs");
const path = require("path");
const matter = require("gray-matter");
const { arabicSlug } = require("./slug.cjs");

const SHOWS_DIR = path.join(__dirname, "..", "content", "shows");
let cache = null;

function slugOf(file, dir) {
  try { return arabicSlug(matter(fs.readFileSync(path.join(dir, file), "utf8")).data.title || file.replace(/\.md$/, "")); }
  catch { return arabicSlug(file.replace(/\.md$/, "")); }
}

function groups(dir = SHOWS_DIR, fresh = false) {
  if (cache && !fresh && cache.dir === dir) return cache.map;
  const map = {};
  for (const f of fs.readdirSync(dir).filter(x => x.endsWith(".md")).sort()) (map[slugOf(f, dir)] ||= []).push(f);
  cache = { dir, map };
  return map;
}

/** "/shows/<slug>/" for this show file. */
function showPath(fileName, title, dir = SHOWS_DIR, fresh = false) {
  const slug = arabicSlug(title || fileName.replace(/\.md$/, ""));
  const same = groups(dir, fresh)[slug] || [];
  const i = same.indexOf(fileName);
  return `/shows/${i > 0 ? `${slug}-${i + 1}` : slug}/`;
}

module.exports = { showPath };
