// arw-media: serves the site's original pictures (/content/images/*) and show reels (/videos/*) at their usual
// addresses, so the Pages build no longer carries ~800 MB of them (INCIDENTS #312). A file comes from R2; the first
// request for a file R2 doesn't have yet takes it from the repo (the bots and the panel keep committing there) and
// stores it in R2 for every request after.
import { widthFor } from "./sizes";
import LEGACY from "./legacy-img.json";
export interface Env { MEDIA?: R2Bucket; REPO_RAW: string; GITHUB_OWNER: string; GITHUB_REPO: string }

// The resized copies the build used to make (/img/<hash>-<width>.<ext>, INCIDENTS #369): Google, shares and old pages
// still ask for them. Each name → its original and width, so they are served by the same resizing as «?w=».
const LEGACY_IMG = LEGACY as unknown as Record<string, [string, number]>;
const RESIZED_CACHE = "public, max-age=2592000, stale-while-revalidate=86400";

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
  let body = await req.arrayBuffer();
  if (!body.byteLength || body.byteLength > 95 * 1024 * 1024) return json({ ok: false, error: "empty or too big" }, 400);
  if (url.searchParams.get("replace") !== "1" && (await env.MEDIA.head(key))) return json({ ok: true, key, existed: true });
  // a big picture is stored small, whoever sends it (INCIDENTS #372)
  let contentType = typeOf(key);
  const before = body.byteLength;
  if (isPicture(key)) {
    try {
      const { compressOriginal } = await import("./resize");
      const small = await compressOriginal(body, contentType);
      if (small) { body = small; contentType = "image/jpeg"; }
    } catch (e: any) { console.log(`[media] compress ${key}: ${e?.message || e}`); }
  }
  await env.MEDIA.put(key, body, { httpMetadata: { contentType, cacheControl: CACHE }, customMetadata: { checked: "1" } });
  return json({ ok: true, key, bytes: body.byteLength, ...(before !== body.byteLength ? { compressedFrom: before } : {}) });
}

/** Reels are needed only while they're posted to the social networks (which keep their own copy): R2 keeps them
 *  30 days, so the bucket stays inside its free 10 GB for good (pictures grow ~2 GB a year, reels ~5 GB). */
// (not exported: the Workers runtime refuses a module whose exports aren't handlers or functions — INCIDENTS #369)
const REEL_DAYS = 30;
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

/** The original, from R2 or (first time) the repo — the same two places as a plain request */
async function original(key: string, env: Env, ctx: ExecutionContext): Promise<{ buf: ArrayBuffer; type: string } | null> {
  if (env.MEDIA) {
    const obj = await env.MEDIA.get(key);
    if (obj) return { buf: await obj.arrayBuffer(), type: obj.httpMetadata?.contentType || typeOf(key) };
  }
  const res = await fetch(`${env.REPO_RAW.replace(/\/$/, "")}/${key.split("/").map(encodeURIComponent).join("/")}`, { cache: "no-store" });
  if (!res.ok) return null;
  const buf = await res.arrayBuffer();
  if (env.MEDIA) ctx.waitUntil(env.MEDIA.put(key, buf, { httpMetadata: { contentType: typeOf(key), cacheControl: CACHE } }));
  return { buf, type: typeOf(key) };
}

/** One picture at one width, as WebP, kept in the edge cache (never in R2). If resizing fails the original is sent,
 *  so a picture is never missing. */
async function serveSized(req: Request, env: Env, ctx: ExecutionContext, key: string, width: number): Promise<Response> {
  const cache = (globalThis as any).caches?.default as Cache | undefined;
  const cacheKey = new Request(`${new URL(req.url).origin}/${key}?w=${width}`, { method: "GET" });
  if (cache) {
    const hit = await cache.match(cacheKey);
    if (hit) return req.method === "HEAD" ? new Response(null, hit) : hit;
  }
  const src = await original(key, env, ctx);
  if (!src) return new Response("Not found", { status: 404, headers: { "Cache-Control": "public, max-age=60" } });
  let res: Response;
  try {
    // (loaded only when a size is asked for: the codecs are WebAssembly, and the module stays importable in tests)
    const { resizedWebp } = await import("./resize");
    const webp = await resizedWebp(src.buf, src.type, width);
    res = new Response(webp, { status: 200, headers: headersFor(key, { "Content-Type": "image/webp", "Cache-Control": RESIZED_CACHE, "Content-Length": String(webp.byteLength), "X-Resized": String(width) }) });
  } catch (e: any) {
    console.log(`[media] resize ${key} @${width}: ${e?.message || e}`);
    return new Response(req.method === "HEAD" ? null : src.buf, { status: 200, headers: headersFor(key, { "Content-Type": src.type, "Cache-Control": "public, max-age=3600", "X-Resized": "failed" }) });
  }
  if (cache) ctx.waitUntil(cache.put(cacheKey, res.clone()));
  return req.method === "HEAD" ? new Response(null, res) : res;
}

const isPicture = (key: string) => /^content\/images\/.+\.(jpe?g|png|webp)$/i.test(key);

/** The pictures stored before uploads were compressed (INCIDENTS #372): each hour a few of the big ones are made small
 *  in place — same address, so nothing on the site changes — and every picture checked is marked so it is never read
 *  twice. A few per hour keeps each run well inside the Worker's CPU time. */
const COMPRESS_PER_RUN = 3;
const BIG_PICTURE_BYTES = 300 * 1024; // the same line as ORIGINAL_MAX_BYTES in resize.ts
async function compressStored(env: Env): Promise<number> {
  if (!env.MEDIA) return 0;
  let cursor: string | undefined, done = 0;
  do {
    const page = await env.MEDIA.list({ prefix: "content/images/", cursor, limit: 1000, include: ["customMetadata"] } as R2ListOptions);
    for (const o of page.objects) {
      if (done >= COMPRESS_PER_RUN) return done;
      // only the big ones, each once (a small one is never read or rewritten)
      if (!isPicture(o.key) || o.size <= BIG_PICTURE_BYTES || o.customMetadata?.checked === "1") continue;
      const obj = await env.MEDIA.get(o.key);
      if (!obj) continue;
      const buf = await obj.arrayBuffer();
      const type = obj.httpMetadata?.contentType || typeOf(o.key);
      let small: ArrayBuffer | null = null;
      try { const { compressOriginal } = await import("./resize"); small = await compressOriginal(buf, type); }
      catch (e: any) { console.log(`[media] compress ${o.key}: ${e?.message || e}`); }
      await env.MEDIA.put(o.key, small || buf, { httpMetadata: { contentType: small ? "image/jpeg" : type, cacheControl: CACHE }, customMetadata: { checked: "1" } });
      done++;
      if (small) console.log(`[media] ${o.key}: ${buf.byteLength} → ${small.byteLength} bytes`);
    }
    cursor = page.truncated ? page.cursor : undefined;
  } while (cursor);
  return done;
}

export default {
  async scheduled(event: ScheduledEvent, env: Env, ctx: ExecutionContext) {
    // hourly: a few big stored pictures made small; once a day (03:17 UTC): reels older than 30 days removed
    ctx.waitUntil(compressStored(env).then(n => n && console.log(`[media] ${n} stored pictures made smaller`)));
    if (new Date(event.scheduledTime).getUTCHours() === 3) ctx.waitUntil(pruneReels(env).then(n => console.log(`[media] ${n} old reels removed`)));
  },
  async fetch(req: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    if (new URL(req.url).pathname.startsWith("/upload/")) {
      if (req.method !== "PUT" && req.method !== "DELETE") return new Response("Method not allowed", { status: 405 });
      return upload(req, env);
    }
    if (req.method !== "GET" && req.method !== "HEAD") return new Response("Method not allowed", { status: 405 });
    const url = new URL(req.url);
    // a picture at a size: «/content/images/a.jpg?w=480», or an old «/img/<name>» copy
    let sized: { key: string; width: number } | null = null;
    if (url.pathname.startsWith("/img/")) {
      let name = url.pathname.slice(5);
      try { name = decodeURIComponent(name); } catch {}
      const hit = LEGACY_IMG[name];
      const k = hit && repoPathOf(hit[0]);
      // a name this list doesn't know: whatever the site itself has at that address (Pages, behind this route)
      if (!k) return fetch(req);
      sized = { key: k, width: widthFor(String(hit[1]))! };
    } else {
      const w = widthFor(url.searchParams.get("w"));
      const k = repoPathOf(url.pathname);
      if (w && k && k.startsWith("content/images/") && /\.(jpe?g|png|webp)$/i.test(k)) sized = { key: k, width: w };
    }
    if (sized) return serveSized(req, env, ctx, sized.key, sized.width);
    const key = repoPathOf(url.pathname);
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
    // never kept at the edge: the repo holds only what R2 refused (INCIDENTS #313), and a day-long copy of a reel the
    // repo no longer had put every deleted reel back into R2 the next time anyone opened it
    const res = await fetch(src, { cache: "no-store" });
    if (!res.ok) return new Response("Not found", { status: 404, headers: { "Cache-Control": "public, max-age=60" } });
    const buf = await res.arrayBuffer();
    if (env.MEDIA) ctx.waitUntil(env.MEDIA.put(key, buf, { httpMetadata: { contentType: typeOf(key), cacheControl: CACHE } }));
    return remember(new Response(req.method === "HEAD" ? null : buf, { status: 200, headers: headersFor(key, { "Content-Length": String(buf.byteLength) }) }));
  },
};
