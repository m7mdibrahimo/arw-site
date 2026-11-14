// «النشر السريع» (fast lane, INCIDENTS #1296): a page saved from the panel is on the live site in about a minute, not
// after the whole ~4-minute Cloudflare rebuild.
//
//   panel save → main ─┬─ the full build (unchanged) ───────────────────────────────→ arw-site-static's assets
//                      └─ .github/workflows/fast-lane.yml renders only the saved pages and «/», «/shows/», «/news/»
//                         with the real templates (lib/fast-lane-render.cjs) → POST /fast-lane/pages (here) → D1
//   a visitor → arw-site-static (site-worker/index.js): an address with no file yet, or one of the three listings →
//               asks /fast-lane/index and /fast-lane/page here (a service binding) and shows the fast copy ONLY when it
//               is of a newer main commit than the deployment's own /build.json. Once the full build is out, never.
//
// Who may send pages: only this repo's own fast-lane workflow on main, proved by GitHub's signed OIDC token (no secret
// anywhere: the repo is public, a fork's token names the fork). The commit is the token's own «sha» claim.
export interface FastEnv {
  ANALYTICS?: D1Database;
  GITHUB_OWNER: string;
  GITHUB_REPO: string;
  SITE_ORIGIN: string;
}

export const AUDIENCE = "arw-fast-lane";
const ISSUER = "https://token.actions.githubusercontent.com";
const WORKFLOW = ".github/workflows/fast-lane.yml";
const MAX_PAGES = 40;
const MAX_PAGE_BYTES = 1_500_000; // under D1's 2 MB row
/** A fast copy that is still here a day later is gone whatever happened (the full build is ~4 minutes) */
const KEEP_MS = 24 * 3600_000;

/** Only the site's own content pages and the three listings can be sent (decoded addresses, as Eleventy writes them) */
export function allowedUrl(url: string): boolean {
  if (url === "/" || url === "/shows/" || url === "/news/") return true;
  return /^\/(shows|news)\/[^/?#\s]+\/$/.test(url) && !/^\/(shows|news)\/\d+\/$/.test(url) && url.length < 400;
}

async function ensure(db: D1Database) {
  await db.prepare("CREATE TABLE IF NOT EXISTS fast_pages (url TEXT PRIMARY KEY, commit_sha TEXT NOT NULL, commit_time INTEGER NOT NULL, html TEXT NOT NULL, stored INTEGER NOT NULL, input TEXT NOT NULL DEFAULT '')").run();
}

// ── GitHub's OIDC token ──────────────────────────────────────────────────────
const b64url = (s: string) => Uint8Array.from(atob(s.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((s.length + 3) % 4)), (c) => c.charCodeAt(0));
let jwks: { at: number; keys: any[] } | null = null;
async function githubKeys(fetcher: typeof fetch, fresh = false): Promise<any[]> {
  if (!fresh && jwks && Date.now() - jwks.at < 3600_000) return jwks.keys;
  const r = await fetcher(`${ISSUER}/.well-known/jwks`);
  if (!r.ok) throw new Error(`jwks ${r.status}`);
  jwks = { at: Date.now(), keys: ((await r.json()) as any).keys || [] };
  return jwks.keys;
}

/** The token's claims when GitHub signed it for this repo's fast-lane workflow on main; otherwise null */
export async function verifyActionsToken(token: string, env: Pick<FastEnv, "GITHUB_OWNER" | "GITHUB_REPO">, opts: { now?: number; fetcher?: typeof fetch } = {}): Promise<any | null> {
  const parts = String(token || "").split(".");
  if (parts.length !== 3) return null;
  let header: any, claims: any;
  try { header = JSON.parse(new TextDecoder().decode(b64url(parts[0]))); claims = JSON.parse(new TextDecoder().decode(b64url(parts[1]))); } catch { return null; }
  if (header.alg !== "RS256" || !header.kid) return null;
  const fetcher = opts.fetcher || fetch;
  let key = (await githubKeys(fetcher)).find((k) => k.kid === header.kid);
  if (!key) key = (await githubKeys(fetcher, true)).find((k) => k.kid === header.kid);
  if (!key) return null;
  const pub = await crypto.subtle.importKey("jwk", { kty: key.kty, n: key.n, e: key.e, alg: "RS256", ext: true }, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["verify"]);
  const ok = await crypto.subtle.verify("RSASSA-PKCS1-v1_5", pub, b64url(parts[2]), new TextEncoder().encode(`${parts[0]}.${parts[1]}`));
  if (!ok) return null;
  const now = Math.floor((opts.now ?? Date.now()) / 1000);
  const repo = `${env.GITHUB_OWNER}/${env.GITHUB_REPO}`;
  const aud = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
  if (claims.iss !== ISSUER || !aud.includes(AUDIENCE)) return null;
  if (!(claims.exp > now) || (claims.nbf && claims.nbf > now + 60)) return null;
  if (claims.repository !== repo || claims.ref !== "refs/heads/main") return null;
  if (!String(claims.workflow_ref || "").startsWith(`${repo}/${WORKFLOW}@refs/heads/main`)) return null;
  if (!/^[0-9a-f]{40}$/.test(String(claims.sha || ""))) return null;
  return claims;
}

/** Stores the pages of one commit: a page is replaced only by a newer commit's copy */
export async function storePages(db: D1Database, sha: string, commitTime: number, pages: { url: string; html: string; input?: string }[], now = Date.now()) {
  await ensure(db);
  const ok = pages.filter((p) => p && typeof p.url === "string" && typeof p.html === "string" && allowedUrl(p.url) && p.html.length > 200 && p.html.length < MAX_PAGE_BYTES && /<html[\s>]/i.test(p.html)).slice(0, MAX_PAGES);
  if (!ok.length) return 0;
  await db.batch(ok.map((p) => db.prepare(
    "INSERT INTO fast_pages (url, commit_sha, commit_time, html, stored, input) VALUES (?1, ?2, ?3, ?4, ?5, ?6) ON CONFLICT(url) DO UPDATE SET commit_sha = excluded.commit_sha, commit_time = excluded.commit_time, html = excluded.html, stored = excluded.stored, input = excluded.input WHERE excluded.commit_time > fast_pages.commit_time OR (excluded.commit_time = fast_pages.commit_time AND excluded.commit_sha = fast_pages.commit_sha)"
  ).bind(p.url, sha, commitTime, p.html, now, typeof p.input === "string" && /^content\/(shows|news)\/[^/]+\.md$/.test(p.input) ? p.input : "")));
  return ok.length;
}

/** The fast copies there are (no pages): what arw-site-static checks before asking for one */
export async function listPages(db: D1Database) {
  await ensure(db);
  const { results } = await db.prepare("SELECT url, commit_sha, commit_time, input FROM fast_pages").all<any>();
  return (results || []).map((r) => ({ url: r.url, commit: r.commit_sha, commitTime: r.commit_time, input: r.input || "" }));
}

/** The copies the live site already has, and anything a day old, go (the site never shows them anyway) */
export async function prunePages(db: D1Database, liveCommitTime: number, liveRecent: string[], now = Date.now()) {
  await ensure(db);
  const recent = liveRecent.filter((s) => /^[0-9a-f]{40}$/.test(s)).slice(0, 80);
  const inRecent = recent.length ? ` OR commit_sha IN (${recent.map((_, i) => `?${i + 3}`).join(",")})` : "";
  const r = await db.prepare(`DELETE FROM fast_pages WHERE commit_time <= ?1 OR stored < ?2${inRecent}`).bind(liveCommitTime, now - KEEP_MS, ...recent).run();
  return r.meta?.changes || 0;
}

const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" } });

/** /fast-lane/* — null for any other address */
export async function handleFastLane(request: Request, env: FastEnv, path: string, url: URL): Promise<Response | null> {
  if (!path.startsWith("/fast-lane/")) return null;
  const db = env.ANALYTICS;
  if (!db) return json({ ok: false }, 503);
  // (read by arw-site-static, and by the panel's bell: a new show already on the site through here is «ظهر على الموقع»)
  if (path === "/fast-lane/index" && request.method === "GET") {
    const r = json({ pages: await listPages(db) });
    r.headers.set("Access-Control-Allow-Origin", "*");
    return r;
  }
  if (path === "/fast-lane/page" && request.method === "GET") {
    const u = url.searchParams.get("url") || "";
    if (!allowedUrl(u)) return new Response("not found", { status: 404 });
    await ensure(db);
    const row = await db.prepare("SELECT commit_sha, commit_time, html FROM fast_pages WHERE url = ?1").bind(u).first<any>();
    if (!row) return new Response("not found", { status: 404 });
    return new Response(row.html, { headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store", "X-Fast-Commit": row.commit_sha, "X-Fast-Commit-Time": String(row.commit_time) } });
  }
  if (path === "/fast-lane/pages" && request.method === "POST") {
    const claims = await verifyActionsToken((request.headers.get("Authorization") || "").replace(/^Bearer\s+/i, ""), env);
    if (!claims) return json({ ok: false, error: "not this repo's fast-lane workflow on main" }, 403);
    const body: any = await request.json().catch(() => null);
    const commitTime = Number(body?.commitTime);
    // the token's run started after its commit, and a commit time far in the future would outrank the next real build
    if (!body || !Array.isArray(body.pages) || !Number.isFinite(commitTime) || commitTime <= 0 || commitTime > Math.floor(Date.now() / 1000) + 120 || (claims.iat && commitTime > claims.iat + 120)) return json({ ok: false, error: "bad body" }, 400);
    const stored = await storePages(db, claims.sha, Math.floor(commitTime), body.pages);
    return json({ ok: true, stored, commit: claims.sha });
  }
  return new Response("not found", { status: 404 });
}

/** Each minute (worker cron): fast copies the live site now has go. Quiet and cheap when there are none. */
export async function fastLaneCleanup(env: FastEnv, fetcher: typeof fetch = fetch) {
  const db = env.ANALYTICS;
  if (!db) return 0;
  await ensure(db);
  const n = await db.prepare("SELECT COUNT(*) AS n FROM fast_pages").first<any>();
  if (!n || !n.n) return 0;
  const b: any = await fetcher(`${env.SITE_ORIGIN}/build.json?fl=${Date.now()}`, { headers: { "Cache-Control": "no-cache" } }).then((r) => (r.ok ? r.json() : null)).catch(() => null);
  if (!b || !b.commitTime) return 0;
  return prunePages(db, Number(b.commitTime), Array.isArray(b.recent) ? b.recent : []);
}
