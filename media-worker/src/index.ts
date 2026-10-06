// arw-media: serves the site's original pictures (/content/images/*) and show reels (/videos/*) at their usual
// addresses, so the Pages build no longer carries ~800 MB of them (INCIDENTS #312). A file comes from R2; the first
// request for a file R2 doesn't have yet takes it from the repo (the bots and the panel keep committing there) and
// stores it in R2 for every request after.
export interface Env { MEDIA?: R2Bucket; REPO_RAW: string }

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

export default {
  async fetch(req: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    if (req.method !== "GET" && req.method !== "HEAD") return new Response("Method not allowed", { status: 405 });
    const key = repoPathOf(new URL(req.url).pathname);
    if (!key) return new Response("Not found", { status: 404 });

    // 1. R2 (ranges for video seeking)
    if (env.MEDIA) {
      const range = req.headers.get("range");
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
        return new Response(req.method === "HEAD" ? null : (obj as R2ObjectBody).body, { status: 200, headers: h });
      }
    }

    // 2. the repo, copied into R2 for next time
    const src = `${env.REPO_RAW.replace(/\/$/, "")}/${key.split("/").map(encodeURIComponent).join("/")}`;
    // cached at the edge for a day: until R2 is on, this is the only source (names are unique per upload)
    const res = await fetch(src, { cf: { cacheTtl: 86400, cacheEverything: true } });
    if (!res.ok) return new Response("Not found", { status: 404, headers: { "Cache-Control": "public, max-age=60" } });
    const buf = await res.arrayBuffer();
    if (env.MEDIA) ctx.waitUntil(env.MEDIA.put(key, buf, { httpMetadata: { contentType: typeOf(key), cacheControl: CACHE } }));
    return new Response(req.method === "HEAD" ? null : buf, { status: 200, headers: headersFor(key, { "Content-Length": String(buf.byteLength) }) });
  },
};
