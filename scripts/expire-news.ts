// A story lives one month on the site (owner 2026-11-22: «خلي ان الاخبار تتمسح بعد شهر من اضافتها في الموقع عشان الاستهلاك
// والمساحة»; INCIDENTS #1481). Every day: each story published more than 30 days ago is deleted, and its pictures are
// removed from R2 when no page left on the site uses them. The old address sends visitors and Google to the news page
// (site-worker/fast.js goneTarget). The R2 backup bucket keeps its copies, as it keeps everything (INCIDENTS #483).
import fs from "node:fs";
import path from "node:path";
import { deleteMedia } from "./media-store";

export const KEEP_DAYS = 30;
const NEWS_DIR = "content/news";
const PICTURE = /\/content\/images\/([A-Za-z0-9._-]+\.(?:jpe?g|png|webp|gif|avif))/gi;

/** When a story reached the site: «published_at», else its «date». */
export function publishedAt(text: string): number {
  const head = text.startsWith("---") ? text.slice(3, text.indexOf("\n---", 3)) : "";
  const get = (k: string) => (head.match(new RegExp(`^${k}:\\s*"?([^"\\n]+)"?\\s*$`, "m")) || [])[1];
  const t = Date.parse(get("published_at") || get("date") || "");
  return Number.isFinite(t) ? t : NaN;
}

export function expired(text: string, now: number, days = KEEP_DAYS): boolean {
  const t = publishedAt(text);
  return Number.isFinite(t) && now - t > days * 86_400_000;
}

export function picturesIn(text: string): string[] {
  return [...new Set([...text.matchAll(PICTURE)].map((m) => m[1]))];
}

function walk(dir: string, out: string[] = []): string[] {
  if (!fs.existsSync(dir)) return out;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) { if (e.name !== "node_modules" && !e.name.startsWith(".")) walk(p, out); }
    else if (/\.(md|json|njk|html|js|cjs|yml|yaml)$/.test(e.name)) out.push(p);
  }
  return out;
}

/** Deletes the expired stories; returns the pictures only they used (removed from R2 later, once the deletion is pushed). */
export function expireNews(now = Date.now(), opts: { dryRun?: boolean; maxPictures?: number } = {}) {
  const gone: string[] = [];
  const pictures = new Set<string>();
  for (const f of fs.readdirSync(NEWS_DIR)) {
    if (!f.endsWith(".md")) continue;
    const file = path.join(NEWS_DIR, f);
    const text = fs.readFileSync(file, "utf8");
    if (!expired(text, now)) continue;
    gone.push(file);
    for (const p of picturesIn(text)) pictures.add(p);
  }
  if (!opts.dryRun) for (const f of gone) fs.unlinkSync(f);
  // a picture still used anywhere else on the site (another story, a show, a page, the data files) stays
  const goneSet = new Set(gone);
  const used = new Set<string>();
  for (const f of [...walk("content"), ...walk("_data"), ...walk("pages"), ...walk("_includes"), "index.njk"]) {
    if (goneSet.has(f) || !fs.existsSync(f)) continue;
    for (const p of picturesIn(fs.readFileSync(f, "utf8"))) used.add(p);
  }
  const drop = [...pictures].filter((p) => !used.has(p)).slice(0, opts.maxPictures ?? 3000);
  return { stories: gone.length, pictures: drop };
}

export async function dropPictures(names: string[]): Promise<number> {
  let removed = 0;
  for (const p of names) if (await deleteMedia(`content/images/${p}`).catch(() => false)) removed++;
  return removed;
}

// npx tsx scripts/expire-news.ts [--dry-run] [--out pictures.json]   — deletes the stories, lists their pictures
// npx tsx scripts/expire-news.ts --drop-pictures pictures.json       — after the push: removes those pictures from R2
if (process.argv[1] && /expire-news\.ts$/.test(process.argv[1])) {
  const arg = (k: string) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : undefined; };
  const dropFile = arg("--drop-pictures");
  if (dropFile) {
    const names: string[] = fs.existsSync(dropFile) ? JSON.parse(fs.readFileSync(dropFile, "utf8")) : [];
    dropPictures(names).then((n) => console.log(`[expire-news] ${n}/${names.length} pictures removed from R2`)).catch((e) => { console.error(e); process.exit(1); });
  } else {
    const r = expireNews(Date.now(), { dryRun: process.argv.includes("--dry-run") });
    const out = arg("--out");
    if (out) fs.writeFileSync(out, JSON.stringify(r.pictures));
    console.log(`[expire-news] ${r.stories} stories older than ${KEEP_DAYS} days${process.argv.includes("--dry-run") ? " (dry run, nothing deleted)" : " deleted"}; ${r.pictures.length} pictures only they used`);
  }
}
