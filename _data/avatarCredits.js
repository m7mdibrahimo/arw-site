// Who took the stars' pictures visitors pick for a comment (assets/avatars/credits.json, made by scripts/avatars/):
// free photos from Wikimedia Commons whose licences ask for their authors to be named. Named on the DMCA page
// (pages/dmca.njk), not under the comment form (owner 2026-10-14: «حقوق الصور دي شيلها»). One line per author and
// licence, the stars' names in English (the same on the Arabic and English pages).
const fs = require("fs");
const path = require("path");

module.exports = function () {
  let list = [];
  try { list = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "assets", "avatars", "credits.json"), "utf8")); } catch (e) { return []; }
  const groups = new Map();
  for (const w of list) {
    const owner = String(w.owner || "Wikimedia Commons").trim();
    const key = `${owner}|${w.license || ""}`;
    if (!groups.has(key)) groups.set(key, { owner, license: w.license || "", stars: [] });
    groups.get(key).stars.push(w.en);
  }
  return [...groups.values()].sort((a, b) => b.stars.length - a.stars.length);
};
