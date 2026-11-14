// arw-site-static's own script (wrangler.static.jsonc): «النشر السريع» (fast lane, INCIDENTS #1296).
//
// It runs only for the three listings «/», «/shows/», «/news/», the show and story pages (run_worker_first), and any
// address with no file; every other file is served straight from the deployment's assets without it. On those it shows
// the fast copy that a save made (worker/src/fast-lane.ts, through the FAST service binding) ONLY when it is of a
// newer main commit than this deployment's own /build.json: a new page before its full build, or a saved edit of a
// page. A deployment's /build.json never changes, so the moment the full build with that save is out, its copies are
// never shown again. Anything that goes wrong here (the bot down, slow, an odd answer) is the plain asset.
const LISTINGS = new Set(["/", "/shows/", "/news/"]);
const CONTENT = /^\/(shows|news)\/[^/]+\/$/;
const INDEX_FRESH_MS = 4000;
const WAIT_MS = 1500; // a page body
const INDEX_WAIT_MS = 3000; // the list (D1 behind a cold bot can take over a second)
const RETRY_MS = 1000; // a failed list is asked again this soon, not after INDEX_FRESH_MS

let build = null; // this deployment's /build.json: { commitTime, recent:Set }
let index = { at: 0, pages: new Map(), loading: null, failed: false };
const bodies = new Map(); // url → { commit, html }: a fast copy never changes for its commit

const withTimeout = (p, ms) => Promise.race([p, new Promise((_, no) => setTimeout(() => no(new Error("timeout")), ms))]);

/** The bot's answers kept a few seconds in this data centre's cache, so a fresh isolate rarely waits for D1 */
async function viaEdge(ctx, key, ttl, load) {
  const cache = typeof caches !== "undefined" && caches.default ? caches.default : null;
  const req = new Request(key);
  if (cache) { try { const hit = await cache.match(req); if (hit) return hit; } catch {} }
  const r = await load();
  if (cache && r.ok) {
    try {
      const copy = new Response(r.clone().body, r);
      copy.headers.set("Cache-Control", `max-age=${ttl}`);
      ctx.waitUntil(cache.put(req, copy).catch(() => {}));
    } catch {}
  }
  return r;
}

async function buildInfo(env) {
  if (build) return build;
  try {
    const r = await env.ASSETS.fetch("https://assets.local/build.json");
    const b = r.ok ? await r.json() : null;
    // no readable build.json: never a fast copy (the deployment can't say how new it is)
    build = b && Number(b.commitTime) > 0 ? { commitTime: Number(b.commitTime), recent: new Set([b.commit, ...(Array.isArray(b.recent) ? b.recent : [])]) } : { commitTime: Infinity, recent: new Set() };
  } catch { return { commitTime: Infinity, recent: new Set() }; }
  return build;
}

function loadIndex(env, ctx, origin) {
  if (!index.loading) {
    index.loading = withTimeout(viaEdge(ctx, origin + "/__fast-lane/index", 4, () => env.FAST.fetch("https://arw-site-bot/fast-lane/index")), INDEX_WAIT_MS)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((d) => {
        const pages = new Map();
        for (const p of (d && d.pages) || []) if (p && typeof p.url === "string") pages.set(p.url, { commit: String(p.commit), commitTime: Number(p.commitTime) });
        index = { at: Date.now(), pages, loading: null, failed: false };
        for (const u of bodies.keys()) if (!pages.has(u)) bodies.delete(u);
      })
      .catch(() => { index = { ...index, at: Date.now() - INDEX_FRESH_MS + RETRY_MS, loading: null, failed: true }; });
  }
  return index.loading;
}

/** The fast copies there are: refreshed in the background every few seconds, waited for only the first time */
async function fastPages(env, ctx, origin) {
  if (Date.now() - index.at < INDEX_FRESH_MS) return index.pages;
  const loading = loadIndex(env, ctx, origin);
  if (index.at === 0) await loading;
  else ctx.waitUntil(loading);
  return index.pages;
}

/** A fast copy is shown only when this deployment doesn't have its commit yet */
export function newer(entry, b) {
  return !!entry && Number.isFinite(entry.commitTime) && entry.commitTime > b.commitTime && !b.recent.has(entry.commit);
}

async function fastBody(env, ctx, origin, url, entry) {
  const hit = bodies.get(url);
  if (hit && hit.commit === entry.commit) return hit.html;
  const ask = "https://arw-site-bot/fast-lane/page?url=" + encodeURIComponent(url);
  const r = await withTimeout(viaEdge(ctx, origin + "/__fast-lane/page/" + entry.commit + "?url=" + encodeURIComponent(url), 300, () => env.FAST.fetch(ask)), WAIT_MS);
  if (!r.ok || r.headers.get("X-Fast-Commit") !== entry.commit) return null;
  const html = await r.text();
  bodies.set(url, { commit: entry.commit, html });
  return html;
}

/** The fast copy with the headers the asset would have had (_headers' /* rules, its cache rule) */
function respond(request, html, like, cacheControl) {
  const h = new Headers(like ? like.headers : undefined);
  for (const k of ["content-length", "etag", "last-modified", "content-encoding", "cf-cache-status", "age"]) h.delete(k);
  h.set("Content-Type", (like && like.headers.get("content-type")) || "text/html");
  if (cacheControl) h.set("Cache-Control", cacheControl);
  return new Response(request.method === "HEAD" ? null : html, { status: 200, headers: h });
}

/** What not_found_handling «404-page» did before this script (it is «none» now, or the script never ran for a missing
 *  address): the nearest 404.html up the folders (/en/… → /en/404.html), status 404, the request's own _headers rules */
export async function notFound(request, env) {
  const bare = await env.ASSETS.fetch(request);
  if (bare.status !== 404) return bare;
  const u = new URL(request.url);
  const segs = u.pathname.split("/").filter(Boolean);
  if (!u.pathname.endsWith("/")) segs.pop();
  for (let i = Math.min(segs.length, 8); i >= 0; i--) {
    const dir = "/" + segs.slice(0, i).map((s) => s + "/").join("");
    const page = await env.ASSETS.fetch(new Request(u.origin + dir + "404", { method: "GET" }));
    if (page.status !== 200) continue;
    const h = new Headers(bare.headers);
    h.set("Content-Type", page.headers.get("content-type") || "text/html");
    if (!h.has("Cache-Control")) h.set("Cache-Control", "public, max-age=0, must-revalidate");
    return new Response(request.method === "HEAD" ? null : page.body, { status: 404, headers: h });
  }
  return bare;
}

function decoded(pathname) {
  try { return decodeURIComponent(pathname); } catch { return pathname; }
}

/** The whole script: arw-site-static's fetch */
export async function handle(request, env, ctx) {
  const u = new URL(request.url);
  if (request.method !== "GET" && request.method !== "HEAD") return env.ASSETS.fetch(request);
  const path = decoded(u.pathname);
  const slash = path.endsWith("/") ? path : path + "/";
  const key = LISTINGS.has(u.pathname) ? u.pathname : CONTENT.test(slash) ? slash : null;
  if (!key || !env.FAST) return notFound(request, env); // (the asset itself whenever there is one)
  try {
    const b = await buildInfo(env);
    // a listing waits for the list of fast copies the first time; a show or story page never does: a fresh isolate
    // serves the real file while it asks, and only an address with no file waits (below)
    let pages;
    if (LISTINGS.has(key) || index.at) pages = await fastPages(env, ctx, u.origin);
    else ctx.waitUntil(loadIndex(env, ctx, u.origin));
    let entry = pages && pages.get(key);
    if (!newer(entry, b)) {
      const asset = await notFound(request, env);
      if (asset.status !== 404 || LISTINGS.has(key)) return asset;
      entry = (await fastPages(env, ctx, u.origin)).get(key);
      // the list didn't come (a cold bot, a slow D1): a new page asks once more rather than a 404
      if (!entry && index.failed) { await loadIndex(env, ctx, u.origin); entry = index.pages.get(key); }
      if (!newer(entry, b)) return asset;
    }
    // «/shows/x» → «/shows/x/», as the assets' own trailing-slash rule does for a real page
    if (key !== u.pathname && !path.endsWith("/")) return new Response(null, { status: 307, headers: { Location: u.pathname + "/" + u.search } });
    const html = await fastBody(env, ctx, u.origin, key, entry);
    if (!html) return notFound(request, env);
    // the real file's headers from an unconditional ask (a browser's «If-None-Match» would get a 304 for its old copy);
    // a page with no file yet: the headers a real page at this address gets (_headers' rules, the default cache rule)
    const plain = new Request(u.toString(), { method: "GET" });
    const like = await env.ASSETS.fetch(plain);
    if (like.status === 200) return respond(request, html, like, null);
    return respond(request, html, await notFound(plain, env), "public, max-age=0, must-revalidate");
  } catch {
    return notFound(request, env);
  }
}

/** For the tests: a fresh isolate */
export function _reset() {
  build = null;
  index = { at: 0, pages: new Map(), loading: null, failed: false };
  bodies.clear();
}
