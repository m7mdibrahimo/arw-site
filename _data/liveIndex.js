// «بث مباشر»: the shows' live pages now on the site (content/live/*.md, written and removed by arw-site-bot), for the
// sitemap — read straight from the folder, since those pages stay out of every collection.
const fs = require("fs");
const path = require("path");
module.exports = () => {
  const dir = path.join(__dirname, "..", "content", "live");
  let files = [];
  try { files = fs.readdirSync(dir).filter((f) => f.endsWith(".md")); } catch { return []; }
  const out = [];
  for (const f of files) {
    const text = fs.readFileSync(path.join(dir, f), "utf8");
    const fm = (text.match(/^---\n([\s\S]*?)\n---/) || [])[1] || "";
    const get = (k) => { const m = fm.match(new RegExp(`^${k}:\\s*(.*)$`, "m")); if (!m) return ""; try { return JSON.parse(m[1]); } catch { return m[1].trim(); } };
    const key = get("live_key");
    if (!key) continue;
    out.push({ key, title: get("title"), start: get("start"), end: get("end"), image: get("image") });
  }
  return out.sort((a, b) => String(b.start).localeCompare(String(a.start)));
};
