// «العرض قبل الجميع» (owner 2026-10-29: «يتنشر عادي في الموقع ولكن السيرفرات المشاهدة والتحميل متكنش شغالة الا للعضو
// المشترك … لحد ما يخلص الوقت وبعدها يظهر للعامة»). The show is published at once and listed like any other show; its
// front matter says when everyone gets it (early_until). Until then its watch servers and download links are never in
// the repo (it is public on GitHub), the page or any JSON:
//   save from the panel (worker/src/studio.ts)  the servers/downloads_* blocks move to D1 (early_media); the file keeps
//                                               «early_servers: N» and «early_downloads: N» in their place
//   open in the panel                           the blocks are put back, so the editor shows the whole show
//   GET /premium/early?k=…                      the links: a premium member now, anyone once the time has come
//   every minute (worker/src/index.ts)          a window that ended: the blocks go back into the file, the site rebuilds
// The page: _includes/post-layout.njk (the lock and its countdown), assets/post-player.js (the links, asked for).
// Its OK.ru videos are turned friends-only on OK.ru meanwhile, so its profile doesn't give the show away (worker/src/okru.ts).
import { okWantHidden, okWantPublic, okHold } from "./okru";

/** Top-level front matter keys that hold watch servers or download links */
export const GATED = /^(servers|downloads(_\w+)?)$/;
const TOP = /^([A-Za-z_][\w-]*):(?:\s|$)/;
/** A window shorter than this isn't one: the links stay in the file */
export const MIN_WINDOW = 60_000;

function frontMatter(text: string) {
  const m = String(text).match(/^(---\r?\n)([\s\S]*?)(\r?\n---)/);
  if (!m) return null;
  const eol = m[0].includes("\r\n") ? "\r\n" : "\n";
  return { head: m[1], body: m[2], tail: text.slice(m[1].length + m[2].length), eol };
}
/** The front matter as top-level blocks: a key's line and the indented lines (or list items) under it */
function blocks(body: string): { key: string; lines: string[] }[] {
  const out: { key: string; lines: string[] }[] = [];
  for (const line of body.split(/\r?\n/)) {
    const top = line.match(TOP);
    if (top || !out.length) out.push({ key: top ? top[1] : "", lines: [line] });
    else out[out.length - 1].lines.push(line);
  }
  return out;
}
const value = (body: string, key: string) => {
  const m = body.match(new RegExp(`^${key}:[ \\t]*(.*)$`, "m"));
  return m ? m[1].trim().replace(/^['"]|['"]$/g, "") : "";
};

/** When everyone gets the show (ms), or 0 */
export function earlyUntil(text: string): number {
  const fm = frontMatter(text);
  return fm ? Date.parse(value(fm.body, "early_until")) || 0 : 0;
}
/** The file has its links in D1 (its «early_servers» line stands in for them) */
export const isVaulted = (text: string) => { const fm = frontMatter(text); return !!fm && /^early_servers:/m.test(fm.body); };

export type Groups = { light: string[]; low: string[]; medium: string[]; high: string[]; multi: string[]; other: string[] };
const urlsIn = (s: string) => (s.match(/https?:\/\/[^\s'"<>]+/g) || []);
/** The watch servers and the download links (by quality) in a front matter, or in its blocks alone */
export function linksOf(text: string): { servers: string[]; groups: Groups } {
  const fm = frontMatter(text);
  const body = fm ? fm.body : String(text);
  const servers: string[] = [];
  const groups: Groups = { light: [], low: [], medium: [], high: [], multi: [], other: [] };
  for (const b of blocks(body)) {
    if (b.key === "servers") for (const l of b.lines) { const m = l.match(/url:\s*['"]?(https?:\/\/[^'"\s]+)/); if (m) servers.push(m[1]); }
    else if (GATED.test(b.key)) {
      const tier = (b.key.split("_")[1] || "other") as keyof Groups;
      (groups[tier] || groups.other).push(...urlsIn(b.lines.join("\n")));
    }
  }
  return { servers: servers.slice(0, 30), groups };
}
export const allDownloads = (g: Groups) => [...g.multi, ...g.light, ...g.low, ...g.medium, ...g.high, ...g.other];

/** The file without its links, and the links' own lines: null when it has none */
export function splitEarly(text: string): { text: string; vault: string; servers: number; downloads: number } | null {
  const fm = frontMatter(text);
  if (!fm) return null;
  const all = blocks(fm.body);
  const gone = all.filter(b => GATED.test(b.key));
  if (!gone.length) return null;
  const vault = gone.map(b => b.lines.join(fm.eol)).join(fm.eol);
  const l = linksOf(vault);
  const n = { servers: l.servers.length, downloads: allDownloads(l.groups).length };
  const kept: string[] = [];
  let placed = false;
  for (const b of all) {
    if (b.key === "early_servers" || b.key === "early_downloads") continue;
    if (!GATED.test(b.key)) { kept.push(...b.lines); continue; }
    if (!placed) { kept.push(`early_servers: ${n.servers}`, `early_downloads: ${n.downloads}`); placed = true; }
  }
  return { text: fm.head + kept.join(fm.eol) + fm.tail, vault, ...n };
}
/** The links' lines put back where «early_servers» stands (the file unchanged when it has no such line) */
export function joinEarly(text: string, vault: string): string {
  const fm = frontMatter(text);
  if (!fm || !isVaulted(text)) return text;
  const all = blocks(fm.body);
  // links written into the file meanwhile (by hand): those are the show's links now, never two «servers:» keys
  const own = all.some(b => GATED.test(b.key));
  const out: string[] = [];
  for (const b of all) {
    if (b.key === "early_downloads") continue;
    if (b.key === "early_servers") { if (vault && !own) out.push(vault); continue; }
    out.push(...b.lines);
  }
  return fm.head + out.join(fm.eol) + fm.tail;
}

/** «03:12:09», or the days past two days — the page's countdown (assets/post-player.js) says the same */
export function timeLeft(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000)), h = Math.floor(s / 3600), d = Math.floor(s / 86400);
  const pad = (n: number) => (n < 10 ? "0" : "") + n;
  if (h >= 48) return d + (d <= 10 ? " أيام" : " يوما");
  return `${pad(h)}:${pad(Math.floor(s % 3600 / 60))}:${pad(s % 60)}`;
}
/** Who may open a show's links now: a premium member during its window, anyone after it */
export const earlyOpen = (until: number, premium: boolean, now = Date.now()) => premium || !until || until <= now;

// ── D1 ──────────────────────────────────────────────────────────────────────
const ready = new WeakSet<D1Database>();
export async function ensureEarly(db: D1Database) {
  if (ready.has(db)) return;
  await db.prepare("CREATE TABLE IF NOT EXISTS early_media (k TEXT PRIMARY KEY, until INTEGER NOT NULL, vault TEXT NOT NULL, updated INTEGER NOT NULL)").run();
  ready.add(db);
}
async function row(db: D1Database, k: string): Promise<{ until: number; vault: string } | null> {
  await ensureEarly(db);
  const r: any = await db.prepare("SELECT until, vault FROM early_media WHERE k = ?1").bind(k).first();
  return r ? { until: Number(r.until), vault: String(r.vault) } : null;
}

/** A file as the panel opens it: whole, its links back in their place */
export async function earlyOnRead(db: D1Database | undefined, k: string, text: string): Promise<string> {
  if (!db || !k || !isVaulted(text)) return text;
  const r = await row(db, k);
  return r ? joinEarly(text, r.vault) : text;
}

/** A file the panel saves: during its window, without its links (they go to D1 first). `after` runs once the file is
 *  committed: a window that ended or was taken off drops its D1 row only then, so a failed commit loses nothing. */
export async function earlyOnSave(db: D1Database | undefined, k: string, text: string, now = Date.now()): Promise<{ text: string; until: number; after: () => Promise<void> }> {
  const none = async () => {};
  if (!db || !k) return { text, until: 0, after: none };
  const r = await row(db, k); // a window taken off in the panel: its row too
  const whole = r ? joinEarly(text, r.vault) : text;
  const until = earlyUntil(whole);
  if (until > now + MIN_WINDOW) {
    const s = splitEarly(whole);
    if (s) {
      await db.prepare("INSERT INTO early_media (k, until, vault, updated) VALUES (?1, ?2, ?3, ?4) ON CONFLICT(k) DO UPDATE SET until = ?2, vault = ?3, updated = ?4")
        .bind(k, until, s.vault, now).run();
      await okWantHidden(db, k, linksOf(s.vault).servers, now);
      return { text: s.text, until, after: none };
    }
  }
  return { text: whole, until: 0, after: r ? async () => { await okWantPublic(db, k, now); await db.prepare("DELETE FROM early_media WHERE k = ?1").bind(k).run(); } : none };
}

/** A show's links while they're in D1 (its window, and the minute after it until they're back in the file) */
export async function earlyLinks(db: D1Database | undefined, k: string) {
  if (!db || !k) return null;
  const r = await row(db, k);
  if (!r) return null;
  return { until: r.until, ...linksOf(r.vault) };
}

/** Every minute: the shows whose window ended get their links back in their files (one commit each, «لوحة التحكم» in
 *  its message so the site builds at once: .github/workflows/site-branch.yml). Until then the page asks the worker. */
export async function releaseEarly(db: D1Database | undefined, io: {
  read: (path: string) => Promise<{ content: string } | null>;
  commit: (path: string, text: string, message: string) => Promise<unknown>;
}, now = Date.now()): Promise<string[]> {
  if (!db) return [];
  await ensureEarly(db);
  const due = ((await db.prepare("SELECT k, vault FROM early_media WHERE until <= ?1 ORDER BY until LIMIT 5").bind(now).all<any>()).results || []);
  const done: string[] = [];
  for (const d of due) {
    const path = `content/${d.k}.md`;
    try {
      const file = await io.read(path);
      // an OK.ru video still friends-only: its server stays out until it's public (worker/src/okru.ts)
      const vault = await okHold(db, d.k, d.vault, now);
      if (file && isVaulted(file.content)) {
        const label = d.k.startsWith("recaps/") ? "ملخص" : d.k.startsWith("nostalgia/") ? "عرض / حلقة نوستالجيا" : "عرض";
        await io.commit(path, joinEarly(file.content, vault), `Update ${label} “${d.k.split("/")[1]}” (لوحة التحكم — العرض قبل الجميع: متاح للجميع)`);
      }
      await okWantPublic(db, d.k, now);
      await db.prepare("DELETE FROM early_media WHERE k = ?1 AND until <= ?2").bind(d.k, now).run();
      done.push(d.k);
    } catch (e: any) { console.log(`[early] ${d.k}: ${e?.message || e}`); } // the next minute tries again
  }
  return done;
}
