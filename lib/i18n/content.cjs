// The English words of the site's own content, for lib/i18n/mirror.cjs: an Arabic string a page shows → its English.
//   - a show / recap / nostalgia episode: its Arabic headline → its English title, its description → an English one
//   - a library section: its Arabic name and page title → its English name
//   - a federation guide: every Arabic string → the same place in lib/i18n/guides (same shape, see zip)
// The news are left out on purpose: they stay Arabic on the English site (owner, 2026-10-07).
const fs = require("fs");
const path = require("path");
const matter = require("gray-matter");
const AR = /[؀-ۿ]/;

const clean = (s) => String(s || "").replace(/\s+/g, " ").trim();
const put = (map, ar, en) => { ar = clean(ar); en = clean(en); if (ar && en && AR.test(ar) && !AR.test(en) && !map[ar]) map[ar] = en; };

/** «WWE Smackdown» → «WWE SmackDown» and friends: the names as the promotions write them. */
function proper(name) {
  return clean(name)
    .replace(/\bSmackdown\b/g, "SmackDown").replace(/\bRaw\b/g, "RAW").replace(/\bNxt\b/g, "NXT")
    .replace(/\bAew\b/g, "AEW").replace(/\bWwe\b/g, "WWE").replace(/\bTna\b/g, "TNA").replace(/\bImpact\b/g, "iMPACT");
}

// One Arabic text can belong to several shows or programs (the same description on every Dynamite, «عرض ام ال بي»
// for two MLP programs): candidates are gathered first, and a text with more than one English gets a general one
function fromItems(map, root = ".") {
  const cand = new Map(); // ar → { kind, en: Set, general }
  const offer = (ar, en, general) => { ar = clean(ar); if (!ar || !AR.test(ar) || !en) return; if (!cand.has(ar)) cand.set(ar, { en: new Set(), general }); cand.get(ar).en.add(clean(en)); };
  for (const [dir, kind] of [["content/shows", "show"], ["content/recaps", "recap"], ["content/nostalgia", "nostalgia"]]) {
    const abs = path.join(root, dir);
    if (!fs.existsSync(abs)) continue;
    for (const f of fs.readdirSync(abs).filter((x) => x.endsWith(".md"))) {
      let d;
      try { d = matter(fs.readFileSync(path.join(abs, f), "utf8")).data; } catch { continue; }
      const title = proper(d.title);
      if (!title || AR.test(title)) continue;
      // the program, never one show's date (a program_name sometimes carries it: «ROH 01.10.2026»)
      const prog = proper(String(d.program_name && !AR.test(d.program_name) ? d.program_name : title).replace(/\s*\d{1,2}[.\/-]\d{1,2}[.\/-]\d{2,4}.*$/, "").replace(/\s+S\d+E\d+.*$/i, "")) || title;
      offer(d.headline, title, null);
      // the show's name without its date: «عرض الرو 28.09.2026 مترجم» → «عرض الرو» → «WWE RAW»
      const base = clean(String(d.headline || "").replace(/\(.*?\)/g, " ").replace(/\d{1,2}[.\/-]\d{1,2}[.\/-]\d{2,4}/g, " ").replace(/\s*مترجم[ةه]?\s*$/, ""));
      if (kind === "recap") offer(base, `${prog} Highlights`, null); else offer(base, prog, null);
      // a description is often the same for every show of a program («عرض ديناميت مترجم بالكامل…»): never one show's
      // name in it, or every Dynamite card would carry the first Dynamite's date
      if (kind === "recap") offer(d.description, `Highlights and the biggest moments from ${prog}.`, "Highlights and the biggest moments from the show.");
      else if (kind === "nostalgia") offer(d.description, `The complete ${prog} episode, with every match and moment.`, "The complete episode, with every match and moment.");
      else offer(d.description, `The complete ${prog} show, with every match and moment.`, "The complete show, with every match and moment.");
      // a nostalgia series' Arabic program name: «حلقات برنامج دبليو دبليو اف تف انف الموسم الثاني» → «WWF Tough Enough Season 2»
      if (d.program_name && AR.test(d.program_name)) {
        const s = /\bS(\d+)E\d+/i.exec(title);
        offer(d.program_name, s ? `${prog} Season ${Number(s[1])}` : prog, null);
      }
    }
  }
  // one English: it; several: the general text, or nothing (a name with two meanings is better left to the page's own data)
  for (const [ar, c] of cand) {
    if (c.en.size === 1) put(map, ar, [...c.en][0]);
    else if (c.general) put(map, ar, c.general);
  }
}

/** The library's sections (eleventy.config.js buildLibrary): Arabic name and page title → the English name. */
function fromLibrary(map, library) {
  for (const p of library || []) {
    const name = proper(p.name);
    put(map, p.arName, name);
    put(map, p.arLibTitle, `${name} shows`);
  }
}

/** Two structures of the same shape (Arabic, English): every Arabic string → the English at the same place. */
function zip(map, ar, en) {
  if (typeof ar === "string") { if (typeof en === "string") put(map, ar, en); return; }
  if (Array.isArray(ar)) { if (Array.isArray(en)) ar.forEach((x, i) => zip(map, x, en[i])); return; }
  if (ar && typeof ar === "object" && en && typeof en === "object") for (const k of Object.keys(ar)) zip(map, ar[k], en[k]);
}
function guidesEn(root = ".") {
  const dir = path.join(root, "lib/i18n/guides");
  const out = {};
  if (fs.existsSync(dir)) for (const f of fs.readdirSync(dir).filter((x) => x.endsWith(".js")).sort()) Object.assign(out, require(path.resolve(dir, f)));
  return out;
}

function buildContentMap({ root = ".", library = [], guides = null } = {}) {
  const map = {};
  fromLibrary(map, library); // a library section's own name first: it's exact
  fromItems(map, root);
  for (const [a, e] of Object.entries(require("./series-en.cjs"))) put(map, a, e);
  // the home slider's pinned items carry their English name as «subtitle» (_data/pinned.json)
  try {
    for (const p of JSON.parse(fs.readFileSync(path.join(root, "_data/pinned.json"), "utf8"))) {
      const en = proper(p.subtitle);
      if (!en || AR.test(en)) continue;
      put(map, p.title, en);
      const prog = en.replace(/\s*\d{1,2}[.\/-]\d{1,2}[.\/-]\d{2,4}.*$/, "") || en; // a description is the program's, never one date's
      put(map, p.description, p.kind === "recap" ? `Highlights and the biggest moments from ${prog}.` : `The complete ${prog} show, with every match and moment.`);
    }
  } catch (e) {}
  const ar = guides || require(path.resolve(root, "_data/federationGuides.js"));
  zip(map, ar, guidesEn(root));
  return map;
}

/** url → { title, description } in English: a show's, a recap's, an episode's, a library section's pages. */
function buildPageMap({ items = [], library = [] } = {}) {
  const out = {};
  const day = (d) => { const t = d ? new Date(d) : null; return t && !isNaN(t) ? t.toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric", timeZone: "UTC" }) : ""; };
  for (const it of items) {
    const d = it.data || {};
    const title = proper(d.title);
    if (!it.url || !title || AR.test(title)) continue;
    const when = day(d.event_date);
    const recap = /content\/recaps\//.test(it.inputPath || "");
    const nost = /content\/nostalgia\//.test(it.inputPath || "");
    out[it.url] = {
      title: recap ? title : title,
      description: recap
        ? `${title}: the results and the biggest moments${when ? ` from ${when}` : ""}, on Arab Wrestling.`
        : nost
          ? `Watch ${title}${when ? ` (originally aired ${when})` : ""}, the complete episode, on Arab Wrestling.`
          : `Watch ${title}${when ? ` (${when})` : ""}, the complete show with every match, in high quality with download links, on Arab Wrestling.`,
    };
  }
  for (const p of library) {
    const name = proper(p.name);
    const pages = Math.max(1, Math.ceil((p.count || 0) / 20));
    for (let n = 1; n <= pages; n++) {
      out[`/library/${p.slug}/${n > 1 ? n + "/" : ""}`] = {
        title: `${name} Shows${n > 1 ? `, page ${n}` : ""}`,
        description: `Watch every ${name} show on Arab Wrestling, newest first${p.latest && p.latest.eventDate ? `. Latest: ${day(p.latest.eventDate)}` : ""}.`,
      };
    }
  }
  return out;
}

module.exports = { buildContentMap, buildPageMap, guidesEn, zip, proper };
