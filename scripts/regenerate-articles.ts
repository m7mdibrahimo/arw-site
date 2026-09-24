// Rewrites already-published articles from their FULL source text, in place:
// same file, same URL, same publish date, no redirect, no social re-post
// (processPost's keepUrl mode). Built for the Wrestling Inc articles that were
// written from a one-line RSS teaser, but works for any source URL whose page
// text can be fetched.
//   npx tsx scripts/regenerate-articles.ts --source wrestlinginc [--dry-run]
//   npx tsx scripts/regenerate-articles.ts --files a.md,b.md
import fs from "fs";
import path from "path";
import matter from "gray-matter";
import { processPost } from "./fightful-watcher";
import { extractWrestlingIncArticle } from "./wrestlinginc-watcher";

const NEWS_DIR = path.join(process.cwd(), "content", "news");
const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126 Safari/537.36";

const decode = (s: string) => s.replace(/&amp;/g, "&").replace(/&#0?39;|&#x27;|&apos;/g, "'").replace(/&quot;/g, '"').replace(/&#8217;/g, "'").replace(/&#8216;/g, "'");

async function fetchSource(url: string): Promise<{ title: string; html: string; image: string } | null> {
  const res = await fetch(url, { signal: AbortSignal.timeout(20000), headers: { "User-Agent": UA } });
  if (!res.ok) return null;
  const page = await res.text();
  const meta = (prop: string) => page.match(new RegExp(`<meta[^>]+property=["']${prop}["'][^>]+content=["']([^"']+)`, "i"))?.[1] || "";
  const title = decode(meta("og:title"));
  const html = /wrestlinginc\.com/.test(url) ? extractWrestlingIncArticle(page) : null;
  if (!title || !html) return null;
  return { title, html, image: meta("og:image") };
}

async function main() {
  const args = process.argv.slice(2);
  const arg = (n: string) => { const i = args.indexOf(n); return i === -1 ? undefined : args[i + 1]; };
  const dryRun = args.includes("--dry-run");
  let files = fs.readdirSync(NEWS_DIR).filter(f => f.endsWith(".md"));
  if (arg("--files")) files = arg("--files")!.split(",").map(f => path.basename(f.trim())).filter(Boolean);
  const source = arg("--source");

  let ok = 0, failed = 0;
  for (const file of files.sort()) {
    const filePath = path.join(NEWS_DIR, file);
    if (!fs.existsSync(filePath)) continue;
    const { data } = matter(fs.readFileSync(filePath, "utf-8"));
    const url = String(data.source_url || "");
    if (!url || (source && !url.includes(source))) continue;
    const src = await fetchSource(url).catch(() => null);
    if (!src) { console.warn(`⚠️  no full text for ${file}`); failed++; continue; }
    console.log(`\n♻️  ${file}\n    source: ${src.title} (${src.html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").length} chars)`);
    if (dryRun) continue;

    const oldImage = String(data.image || "");
    const post = {
      id: Number(data.source_id),
      title: { rendered: src.title },
      content: { rendered: src.html + (src.image ? `<img src="${src.image}">` : "") },
      link: url,
      date_gmt: new Date(data.date).toISOString(),
      date: new Date(data.date).toISOString(),
    };
    const done = await processPost(post, new Date(data.date).toISOString(), false, { manual: true, keepUrl: true });
    if (!done) { console.error(`❌ regeneration refused/failed: ${file}`); failed++; continue; }
    ok++;
    // The rewrite downloads a fresh copy of the image; drop the old one if nothing else uses it.
    const newImage = String(matter(fs.readFileSync(filePath, "utf-8")).data.image || "");
    if (oldImage && oldImage !== newImage && oldImage.startsWith("/content/images/")) {
      const stillUsed = fs.readdirSync(NEWS_DIR).some(f => fs.readFileSync(path.join(NEWS_DIR, f), "utf-8").includes(oldImage));
      const oldPath = path.join(process.cwd(), oldImage);
      if (!stillUsed && fs.existsSync(oldPath)) fs.unlinkSync(oldPath);
    }
    await new Promise(r => setTimeout(r, 3000));
  }
  console.log(`\nDone: ${ok} regenerated, ${failed} failed.`);
}

main().catch(e => { console.error(e); process.exit(1); });
