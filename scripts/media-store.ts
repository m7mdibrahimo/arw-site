// The site's pictures (content/images) and reels (dist/videos/*.mp4) live in R2, served by the arw-media worker
// at /content/images/* and /videos/* — not in the repo, which would outgrow GitHub's free limits in about a year
// (owner, 2026-10-07; INCIDENTS #313). The bots still write a new file where they always did; this puts it in R2.
//   npx tsx scripts/media-store.ts sync       new local pictures and reels → R2 (GITHUB_TOKEN of the Action)
//   npx tsx scripts/media-store.ts delete <repo path>
//   npx tsx scripts/media-store.ts prune-reels   reels already posted leave R2
// A file R2 refuses after retries is committed to the repo instead («git add -f»), where arw-media finds it too:
// an article never goes out without its picture.
import fs from "fs";
import path from "path";
import { execSync } from "child_process";

export const MEDIA_API = process.env.ARW_MEDIA_API || "https://arw-media.m7mdibrahimpc.workers.dev";
export const SITE = process.env.ARW_SITE || "https://arab-wrestling.com";
const TYPES: Record<string, string> = { jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", webp: "image/webp", gif: "image/gif", avif: "image/avif", mp4: "video/mp4" };

/** «content/images/a.jpg» → «/content/images/a.jpg», «dist/videos/r.mp4» → «/videos/r.mp4». */
export function publicPath(repoPath: string): string | null {
  const p = repoPath.replace(/^\.?\//, "");
  if (/^content\/images\/[^/].*/.test(p)) return "/" + p;
  const v = p.match(/^dist\/videos\/([^/]+\.mp4)$/);
  return v ? "/videos/" + v[1] : null;
}
const encodePath = (p: string) => p.split("/").map(encodeURIComponent).join("/");

/** Media files on disk that the repo doesn't hold: what this run made. */
export function newLocalMedia(root = process.cwd()): string[] {
  const out = (cmd: string) => { try { return execSync(cmd, { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }); } catch { return ""; } };
  const list = out("git ls-files -z --others --exclude-standard -- content/images dist/videos") + out("git ls-files -z --others --ignored --exclude-standard -- content/images dist/videos");
  return [...new Set(list.split("\0").filter(f => f && publicPath(f)))];
}

async function call(method: "PUT" | "DELETE", repoPath: string, body?: Buffer): Promise<boolean> {
  const pub = publicPath(repoPath);
  const token = process.env.GITHUB_TOKEN;
  if (!pub || !token) return false;
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      const r = await fetch(`${MEDIA_API}/upload${encodePath(pub)}`, {
        method, body: body ? new Uint8Array(body) : undefined, signal: AbortSignal.timeout(120_000),
        headers: { Authorization: `Bearer ${token}`, "Content-Type": TYPES[(pub.split(".").pop() || "").toLowerCase()] || "application/octet-stream" },
      });
      const j: any = await r.json().catch(() => ({}));
      if (r.ok && j.ok) return true;
      if (r.status === 400 || r.status === 403) return false;
    } catch {}
    await new Promise(res => setTimeout(res, 1500 * (attempt + 1)));
  }
  return false;
}
export const uploadMedia = (repoPath: string, root = process.cwd()) => call("PUT", repoPath, fs.readFileSync(path.join(root, repoPath)));
export const deleteMedia = (repoPath: string) => call("DELETE", repoPath);

/** A picture a script needs on disk (a reel's background) that this checkout doesn't have: fetched from the site. */
export async function ensureLocal(repoPath: string, root = process.cwd()): Promise<boolean> {
  const file = path.join(root, repoPath);
  if (fs.existsSync(file)) return true;
  const pub = publicPath(repoPath);
  if (!pub) return false;
  try {
    const r = await fetch(SITE + encodePath(pub), { signal: AbortSignal.timeout(60_000) });
    if (!r.ok) return false;
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, Buffer.from(await r.arrayBuffer()));
    return true;
  } catch { return false; }
}

async function sync(root = process.cwd()) {
  const files = newLocalMedia(root);
  let stored = 0;
  const kept: string[] = [];
  for (const f of files) {
    if (await uploadMedia(f, root)) stored++;
    else kept.push(f);
  }
  // the safety net: in the repo, arw-media serves it from there
  for (const f of kept) { try { execSync(`git add -f -- ${JSON.stringify(f)}`, { cwd: root, stdio: "ignore" }); } catch {} }
  console.log(`[media] ${stored} new file(s) stored in R2${kept.length ? `, ${kept.length} kept in the repo: ${kept.join(", ")}` : ""}`);
}

/** Reels not needed any more (owner, 2026-10-07: a posted reel is never needed again): every reel in the manifest
 *  whose show is posted on all four Facebook/Instagram slots, and every other reel (news) older than six hours.
 *  A show reel still being posted stays. */
export function reelsToRemove(manifest: any[], state: Record<string, any>, now = Date.now()): string[] {
  const posted = (e: any) => !!e && ['facebook_reel', 'facebook_story', 'instagram_reel', 'instagram_story'].every(p => e[p]);
  const out: string[] = [];
  for (const m of Array.isArray(manifest) ? manifest : []) {
    const f = m && m.filename;
    if (!f || !/\.mp4$/.test(f)) continue;
    const slug = Object.keys(state).find(k => f === `reel-${k}.mp4` || f === `reel-${k.slice(0, 45)}.mp4`);
    if (slug) { if (posted(state[slug])) out.push(f); continue; }
    if (now - Number(m.mtime || 0) > 6 * 3600_000) out.push(f);
  }
  return out;
}
async function pruneReels(root = process.cwd()) {
  const read = (f: string) => { try { return JSON.parse(fs.readFileSync(path.join(root, f), "utf8")); } catch { return null; } };
  const list = reelsToRemove(read("dist/videos/manifest.json") || [], read("_data/show-reel-state.json") || {});
  let gone = 0;
  for (const f of list) if (await deleteMedia(`dist/videos/${f}`)) gone++;
  console.log(`[media] ${gone}/${list.length} posted reels removed from R2`);
}

if (require.main === module) {
  const [cmd, arg] = process.argv.slice(2);
  const run = cmd === "sync" ? sync() : cmd === "prune-reels" ? pruneReels() : cmd === "delete" && arg ? deleteMedia(arg).then(ok => console.log(`[media] delete ${arg}: ${ok}`)) : Promise.resolve(console.log("usage: media-store.ts sync | delete <repo path>"));
  run.catch(e => { console.error("[media]", e.message); process.exitCode = 0; });
}
