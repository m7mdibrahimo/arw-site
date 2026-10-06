// arw-media: serves the site's original pictures (/content/images/*) and show reels (/videos/*) at their usual
// addresses, so the Pages build no longer carries ~800 MB of them (INCIDENTS #312). A file comes from R2; the first
// request for a file R2 doesn't have yet takes it from the repo (the bots and the panel keep committing there) and
// stores it in R2 for every request after.
export interface Env { MEDIA?: R2Bucket; REPO_RAW: string; GITHUB_OWNER: string; GITHUB_REPO: string }

const TYPES: Record<string, string> = {
  jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", webp: "image/webp", gif: "image/gif", avif: "image/avif", svg: "image/svg+xml",
  mp4: "video/mp4", webm: "video/webm", mov: "video/quicktime", json: "application/json",
};
const CACHE = "public, max-age=86400, stale-while-revalidate=3600";

/** «/content/images/a.jpg» → «content/images/a.jpg», «/videos/r.mp4» → «dist/videos/r.mp4»; anything else → null. */
export function repoPathOf(pathname: string): string | null {
  let p: string;
  try { p = decodeURIComponent(pathname); } catch { return null; }
  if (p.includes("..") || p.includes("\\")) return null;
  const m = p.match(/^\/(content\/images|videos)\/(.+)$/);
  if (!m || !m[2] || m[2].endsWith("/")) return null;
  return (m[1] === "videos" ? "dist/videos/" : "content/images/") + m[2];
}

const typeOf = (key: string) => TYPES[(key.split(".").pop() || "").toLowerCase()] || "application/octet-stream";

function headersFor(key: string, extra: Record<string, string> = {}): Headers {
  const h = new Headers({ "Content-Type": typeOf(key), "Cache-Control": CACHE, "Accept-Ranges": "bytes", "X-Content-Type-Options": "nosniff", "Access-Control-Allow-Origin": "*", "X-Served-By": "arw-media", ...extra });
  return h;
}

/** A GitHub token that can write to the repo: GitHub Actions' own token (the bots) or the panel's. The collaborators
 *  list answers only to write access, public repo or not (the same check as worker/src/delivery.ts authorizeAdmin). */
async function canWriteRepo(auth: string | null, env: Env): Promise<boolean> {
  if (!auth?.startsWith("Bearer ") || auth.length < 15) return false;
  for (let attempt = 0; attempt < 3; attempt++) {
    const r = await fetch(`https://api.github.com/repos/${env.GITHUB_OWNER}/${env.GITHUB_REPO}/collaborators?per_page=1`, {
      headers: { Authorization: auth, Accept: "application/vnd.github+json", "User-Agent": "arw-media" },
    }).catch(() => null);
    if (r?.ok) return true;
    if (r && r.status < 500 && r.status !== 429) return false;
    await new Promise(res => setTimeout(res, 500 * (attempt + 1)));
  }
  return false;
}

/** PUT /upload/content/images/<name> or /upload/videos/<name> — the bots and the panel store a new file in R2.
 *  DELETE the same path removes one. A file is never overwritten unless «?replace=1». */
async function upload(req: Request, env: Env): Promise<Response> {
  const json = (o: unknown, status = 200) => new Response(JSON.stringify(o), { status, headers: { "Content-Type": "application/json" } });
  if (!env.MEDIA) return json({ ok: false, error: "no R2 binding" }, 500);
  const url = new URL(req.url);
  const key = repoPathOf(url.pathname.replace(/^\/upload/, ""));
  if (!key) return json({ ok: false, error: "bad path" }, 400);
  if (!(await canWriteRepo(req.headers.get("Authorization"), env))) return json({ ok: false, error: "forbidden" }, 403);
  if (req.method === "DELETE") { await env.MEDIA.delete(key); return json({ ok: true, key, deleted: true }); }
  const body = await req.arrayBuffer();
  if (!body.byteLength || body.byteLength > 95 * 1024 * 1024) return json({ ok: false, error: "empty or too big" }, 400);
  if (url.searchParams.get("replace") !== "1" && (await env.MEDIA.head(key))) return json({ ok: true, key, existed: true });
  await env.MEDIA.put(key, body, { httpMetadata: { contentType: typeOf(key), cacheControl: CACHE } });
  return json({ ok: true, key, bytes: body.byteLength });
}

/** Reels are needed only while they're posted to the social networks (which keep their own copy): R2 keeps them
 *  30 days, so the bucket stays inside its free 10 GB for good (pictures grow ~2 GB a year, reels ~5 GB). */
export const REEL_DAYS = 30;
async function pruneReels(env: Env): Promise<number> {
  if (!env.MEDIA) return 0;
  const cut = Date.now() - REEL_DAYS * 86400_000;
  let cursor: string | undefined, gone = 0;
  do {
    const page = await env.MEDIA.list({ prefix: "dist/videos/", cursor, limit: 1000 });
    const old = page.objects.filter(o => o.key.endsWith(".mp4") && o.uploaded.getTime() < cut).map(o => o.key);
    if (old.length) { await env.MEDIA.delete(old); gone += old.length; }
    cursor = page.truncated ? page.cursor : undefined;
  } while (cursor);
  return gone;
}

export default {
  async scheduled(_event: ScheduledEvent, env: Env, ctx: ExecutionContext) {
    ctx.waitUntil(pruneReels(env).then(n => console.log(`[media] ${n} old reels removed`)));
  },
  async fetch(req: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    if (new URL(req.url).pathname.startsWith("/upload/")) {
      if (req.method !== "PUT" && req.method !== "DELETE") return new Response("Method not allowed", { status: 405 });
      return upload(req, env);
    }
    if (req.method !== "GET" && req.method !== "HEAD") return new Response("Method not allowed", { status: 405 });
    const key = repoPathOf(new URL(req.url).pathname);
    if (!key) return new Response("Not found", { status: 404 });

    // 0. the edge cache: a file once served stays near the visitor for a day, so R2 is read rarely (its free tier
    // is 10 M reads a month)
    const range = req.headers.get("range");
    const cache = (globalThis as any).caches?.default as Cache | undefined;
    const cacheKey = new Request(new URL(req.url).origin + new URL(req.url).pathname, { method: "GET" });
    if (cache && req.method === "GET" && !range) {
      const hit = await cache.match(cacheKey);
      if (hit) return hit;
    }
    const remember = (res: Response) => { if (cache && req.method === "GET" && !range && res.status === 200) ctx.waitUntil(cache.put(cacheKey, res.clone())); return res; };

    // 1. R2 (ranges for video seeking)
    if (env.MEDIA) {
      const obj = await env.MEDIA.get(key, range ? { range: req.headers } : {});
      if (obj) {
        const h = headersFor(key, { ETag: obj.httpEtag });
        if (obj.httpMetadata?.contentType) h.set("Content-Type", obj.httpMetadata.contentType);
        const r = (obj as R2ObjectBody).range as { offset?: number; length?: number } | undefined;
        if (range && r && typeof r.offset === "number") {
          const len = r.length ?? obj.size - r.offset;
          h.set("Content-Range", `bytes ${r.offset}-${r.offset + len - 1}/${obj.size}`);
          h.set("Content-Length", String(len));
          return new Response(req.method === "HEAD" ? null : (obj as R2ObjectBody).body, { status: 206, headers: h });
        }
        h.set("Content-Length", String(obj.size));
        return remember(new Response(req.method === "HEAD" ? null : (obj as R2ObjectBody).body, { status: 200, headers: h }));
      }
    }

    // 2. the repo, copied into R2 for next time
    const src = `${env.REPO_RAW.replace(/\/$/, "")}/${key.split("/").map(encodeURIComponent).join("/")}`;
    // cached at the edge for a day: until R2 is on, this is the only source (names are unique per upload)
    const res = await fetch(src, { cf: { cacheTtl: 86400, cacheEverything: true } });
    if (!res.ok) return new Response("Not found", { status: 404, headers: { "Cache-Control": "public, max-age=60" } });
    const buf = await res.arrayBuffer();
    if (env.MEDIA) ctx.waitUntil(env.MEDIA.put(key, buf, { httpMetadata: { contentType: typeOf(key), cacheControl: CACHE } }));
    return remember(new Response(req.method === "HEAD" ? null : buf, { status: 200, headers: headersFor(key, { "Content-Length": String(buf.byteLength) }) }));
  },
};
