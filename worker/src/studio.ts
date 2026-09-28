// ── Studio: the site's own admin panel (/studio/) ─────────────────────────
// Login with a username or e-mail and a password (no GitHub account needed day to day),
// and content reads/writes committed to the repo exactly like Decap CMS does — same
// folders, same file names, same front matter — so the site build, the automatic news
// and the social publishing see no difference between the two panels.
//
// Security model
// - One owner account, stored in KV as a PBKDF2-SHA256 hash (never the password).
// - The account can only be created or reset by someone holding a GitHub token with
//   write access to the repo (the same proof the old panel uses).
// - Sessions are random 256-bit tokens; KV keeps only their SHA-256, with a TTL
//   (12 hours, or 30 days with «تذكرني»).
// - Wrong passwords never lock the owner out (owner's choice, 2026-09-28). Every wrong
//   attempt is only slowed by a second and written to the login log shown in settings.
// - Writes are limited to the content folders and content/images.
import { authorizeAdmin } from './delivery';

export interface StudioEnv {
  GITHUB_OWNER: string; GITHUB_REPO: string; GITHUB_BRANCH: string; GITHUB_TOKEN: string;
  PUSH_KV: KVNamespace;
  /** Only in worker/.dev.vars for `wrangler dev` on this computer — never in wrangler.toml. */
  STUDIO_DEV?: string;
}

export const STUDIO_TOKEN_PREFIX = 'st_';
const ACCOUNT_KEY = 'studio:account';
const SESSION_INDEX_KEY = 'studio:sessions';
const LOGIN_LOG_KEY = 'studio:loginlog';
const PBKDF2_ITERATIONS = 100_000; // the Workers runtime maximum
const SESSION_TTL_SHORT = 12 * 3600;
const SESSION_TTL_LONG = 30 * 86400;
const WRONG_PASSWORD_DELAY_MS = 1000; // slows password guessing without ever locking anyone out

export const COLLECTION_FOLDERS: Record<string, string> = {
  shows: 'content/shows',
  recaps: 'content/recaps',
  news: 'content/news',
  nostalgia: 'content/nostalgia',
  nostalgia_series: 'content/nostalgia-series',
};

interface Account {
  username: string; email: string; displayName?: string; salt: string; hash: string; iterations: number;
  createdAt: number; updatedAt: number;
}
interface SessionRecord { id: string; createdAt: number; lastSeen: number; expiresAt: number; remember: boolean; ua: string; ip: string; place: string; }

// ── Crypto helpers ─────────────────────────────────────────────────────────
const enc = new TextEncoder();
function b64(bytes: ArrayBuffer | Uint8Array): string {
  const arr = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let s = '';
  for (const b of arr) s += String.fromCharCode(b);
  return btoa(s);
}
function b64url(bytes: Uint8Array): string { return b64(bytes).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); }
function unb64(s: string): Uint8Array { return Uint8Array.from(atob(s), c => c.charCodeAt(0)); }
async function sha256hex(s: string): Promise<string> {
  const d = await crypto.subtle.digest('SHA-256', enc.encode(s));
  return Array.from(new Uint8Array(d)).map(b => b.toString(16).padStart(2, '0')).join('');
}
export async function hashPassword(password: string, salt?: Uint8Array, iterations = PBKDF2_ITERATIONS): Promise<{ salt: string; hash: string; iterations: number }> {
  const s = salt || crypto.getRandomValues(new Uint8Array(16));
  const key = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: s, iterations }, key, 256);
  return { salt: b64(s), hash: b64(bits), iterations };
}
function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
export async function verifyPassword(password: string, account: Pick<Account, 'salt' | 'hash' | 'iterations'>): Promise<boolean> {
  const { hash } = await hashPassword(password, unb64(account.salt), account.iterations);
  return timingSafeEqual(hash, account.hash);
}
export function passwordProblem(p: string): string | null {
  if (typeof p !== 'string' || p.length < 8) return 'كلمة السر لازم تكون 8 حروف أو أكتر.';
  if (p.length > 200) return 'كلمة السر طويلة جدا.';
  if (!/[A-Za-z؀-ۿ]/.test(p) || !/\d/.test(p)) return 'كلمة السر لازم يكون فيها حروف وأرقام.';
  return null;
}
function cleanUsername(u: unknown): string { return String(u || '').trim().toLowerCase(); }

// ── Sessions ───────────────────────────────────────────────────────────────
function clientInfo(request: Request) {
  const cf: any = (request as any).cf || {};
  return {
    ip: request.headers.get('CF-Connecting-IP') || request.headers.get('X-Forwarded-For') || 'local',
    ua: (request.headers.get('User-Agent') || '').slice(0, 180),
    place: [cf.city, cf.country].filter(Boolean).join('، '),
  };
}
function bearer(request: Request): string {
  const h = request.headers.get('Authorization') || '';
  return h.startsWith('Bearer ') ? h.slice(7).trim() : '';
}
async function readIndex(env: StudioEnv): Promise<SessionRecord[]> {
  const list = (await env.PUSH_KV.get(SESSION_INDEX_KEY, 'json')) as SessionRecord[] | null;
  return (list || []).filter(s => s.expiresAt > Date.now());
}
async function createSession(env: StudioEnv, request: Request, remember: boolean) {
  const token = STUDIO_TOKEN_PREFIX + b64url(crypto.getRandomValues(new Uint8Array(32)));
  const id = await sha256hex(token);
  const ttl = remember ? SESSION_TTL_LONG : SESSION_TTL_SHORT;
  const now = Date.now();
  const info = clientInfo(request);
  const rec: SessionRecord = { id: id.slice(0, 16), createdAt: now, lastSeen: now, expiresAt: now + ttl * 1000, remember, ...info };
  await env.PUSH_KV.put(`studio:session:${id}`, JSON.stringify(rec), { expirationTtl: ttl });
  const index = (await readIndex(env)).filter(s => s.id !== rec.id);
  index.unshift(rec);
  await env.PUSH_KV.put(SESSION_INDEX_KEY, JSON.stringify(index.slice(0, 30)));
  return { token, expiresAt: rec.expiresAt };
}
export async function studioSession(request: Request, env: StudioEnv): Promise<SessionRecord | null> {
  const token = bearer(request);
  if (!token.startsWith(STUDIO_TOKEN_PREFIX) || token.length < 30) return null;
  const id = await sha256hex(token);
  const rec = (await env.PUSH_KV.get(`studio:session:${id}`, 'json')) as SessionRecord | null;
  if (!rec || rec.expiresAt < Date.now()) return null;
  return rec;
}
async function endSession(env: StudioEnv, request: Request) {
  const token = bearer(request);
  const id = await sha256hex(token);
  await env.PUSH_KV.delete(`studio:session:${id}`);
  const index = (await readIndex(env)).filter(s => s.id !== id.slice(0, 16));
  await env.PUSH_KV.put(SESSION_INDEX_KEY, JSON.stringify(index));
}
async function endAllSessions(env: StudioEnv) {
  // KV can't list by the hashed ids we index (only a prefix of the hash is kept), so sessions
  // are invalidated through a generation stamp every session is checked against.
  await env.PUSH_KV.put('studio:generation', String(Date.now()));
  await env.PUSH_KV.put(SESSION_INDEX_KEY, JSON.stringify([]));
}
async function sessionAlive(env: StudioEnv, rec: SessionRecord): Promise<boolean> {
  const gen = Number(await env.PUSH_KV.get('studio:generation')) || 0;
  return rec.createdAt >= gen;
}
/** A valid studio session also unlocks the existing admin endpoints (publish, watcher, reels). */
export async function studioAuthorized(request: Request, env: StudioEnv): Promise<boolean> {
  const rec = await studioSession(request, env);
  return !!rec && (await sessionAlive(env, rec));
}

async function logLogin(env: StudioEnv, entry: Record<string, unknown>) {
  const log = ((await env.PUSH_KV.get(LOGIN_LOG_KEY, 'json')) as any[] | null) || [];
  log.unshift({ at: Date.now(), ...entry });
  await env.PUSH_KV.put(LOGIN_LOG_KEY, JSON.stringify(log.slice(0, 40)));
}

// ── GitHub (Git Data API: several files in one commit) ─────────────────────
async function gh(env: StudioEnv, path: string, init: RequestInit = {}): Promise<Response> {
  return fetch(`https://api.github.com/repos/${env.GITHUB_OWNER}/${env.GITHUB_REPO}${path}`, {
    ...init,
    headers: {
      // No token (the local copy of the worker): public reads still work
      ...(env.GITHUB_TOKEN ? { Authorization: `Bearer ${env.GITHUB_TOKEN}` } : {}),
      Accept: 'application/vnd.github+json',
      'User-Agent': 'arw-site-bot',
      ...(init.body ? { 'Content-Type': 'application/json' } : {}),
      ...(init.headers || {}),
    },
  });
}
async function ghJson(env: StudioEnv, path: string, init: RequestInit = {}): Promise<any> {
  const r = await gh(env, path, init);
  if (!r.ok) throw Object.assign(new Error(`GitHub ${r.status}: ${(await r.text()).slice(0, 200)}`), { status: r.status });
  return r.json();
}
function utf8FromB64(s: string): string { return new TextDecoder().decode(unb64(s.replace(/\n/g, ''))); }

export async function readRepoFile(env: StudioEnv, path: string): Promise<{ content: string; sha: string } | null> {
  const r = await gh(env, `/contents/${path.split('/').map(encodeURIComponent).join('/')}?ref=${env.GITHUB_BRANCH}`);
  if (r.status === 404) return null;
  if (!r.ok) throw new Error(`GitHub ${r.status}`);
  const d: any = await r.json();
  if (d.content) return { content: utf8FromB64(d.content), sha: d.sha };
  const blob = await ghJson(env, `/git/blobs/${d.sha}`);
  return { content: utf8FromB64(blob.content), sha: d.sha };
}

export interface FileChange { path: string; text?: string; base64?: string; remove?: boolean }
export async function commitFiles(env: StudioEnv, changes: FileChange[], message: string): Promise<string> {
  // Blobs don't depend on the branch head, so they are uploaded once.
  const entries: any[] = [];
  for (const c of changes) {
    if (c.remove) { entries.push({ path: c.path, mode: '100644', type: 'blob', sha: null }); continue; }
    const blob = await ghJson(env, '/git/blobs', {
      method: 'POST',
      body: JSON.stringify(c.base64 != null ? { content: c.base64, encoding: 'base64' } : { content: c.text ?? '', encoding: 'utf-8' }),
    });
    entries.push({ path: c.path, mode: '100644', type: 'blob', sha: blob.sha });
  }
  // The bots commit to main every few minutes: build on the current head and retry if it moved.
  for (let attempt = 0; attempt < 6; attempt++) {
    const ref = await ghJson(env, `/git/ref/heads/${env.GITHUB_BRANCH}`);
    const head = ref.object.sha;
    const headCommit = await ghJson(env, `/git/commits/${head}`);
    const tree = await ghJson(env, '/git/trees', { method: 'POST', body: JSON.stringify({ base_tree: headCommit.tree.sha, tree: entries }) });
    const commit = await ghJson(env, '/git/commits', { method: 'POST', body: JSON.stringify({ message, tree: tree.sha, parents: [head] }) });
    const upd = await gh(env, `/git/refs/heads/${env.GITHUB_BRANCH}`, { method: 'PATCH', body: JSON.stringify({ sha: commit.sha, force: false }) });
    if (upd.ok) return commit.sha;
    if (upd.status !== 422 && upd.status !== 409) throw new Error(`GitHub ${upd.status}: ${(await upd.text()).slice(0, 200)}`);
    await new Promise(r => setTimeout(r, 400 * (attempt + 1)));
  }
  throw new Error('الموقع مشغول بتحديثات تلقائية كتير في نفس اللحظة. جرّب الحفظ تاني بعد ثواني.');
}

// ── Validation ─────────────────────────────────────────────────────────────
export function entryPath(collection: string, slug: string): string | null {
  const folder = COLLECTION_FOLDERS[collection];
  if (!folder || typeof slug !== 'string') return null;
  if (!slug || slug.length > 240 || /[\/\\\0]|\.\./.test(slug) || /^\./.test(slug)) return null;
  return `${folder}/${slug}.md`;
}
export function imagePathOk(p: string): boolean {
  return /^content\/images\/[a-z0-9_-]{6,64}\.(?:jpg|jpeg|png|webp|gif)$/.test(p);
}
const MAX_IMAGE_BYTES = 6 * 1024 * 1024;

// ── Cloudflare analytics ───────────────────────────────────────────────────
const SITE_ZONE = 'arab-wrestling.com';
const ANALYTICS_KEY = 'studio:analytics:config';
const ANALYTICS_CACHE_KEY = 'studio:analytics:cache';
const day = (d: Date) => d.toISOString().slice(0, 10);
async function cfGraphql(token: string, query: string, variables: Record<string, unknown>): Promise<any> {
  const r = await fetch('https://api.cloudflare.com/client/v4/graphql', {
    method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query, variables }),
  });
  const d: any = await r.json().catch(() => ({}));
  if (!r.ok || d.errors?.length) throw new Error(d.errors?.[0]?.message || `HTTP ${r.status}`);
  return d.data;
}
/** Daily visitors / page views for `days` days, the last 24 hours by hour, top countries and pages. */
export async function cfAnalytics(token: string, zoneId: string, days: number) {
  const now = new Date();
  const since = new Date(now.getTime() - (days - 1) * 86400_000);
  const since24 = new Date(now.getTime() - 24 * 3600_000);
  const main = await cfGraphql(token, `query($zone: String!, $since: Date!, $until: Date!, $s24: Time!, $u24: Time!) {
    viewer { zones(filter: { zoneTag: $zone }) {
      days: httpRequests1dGroups(limit: 40, filter: { date_geq: $since, date_leq: $until }, orderBy: [date_ASC]) {
        dimensions { date } sum { requests pageViews countryMap { clientCountryName requests } } uniq { uniques } }
      hours: httpRequests1hGroups(limit: 30, filter: { datetime_geq: $s24, datetime_lt: $u24 }, orderBy: [datetime_ASC]) {
        dimensions { datetime } sum { pageViews } uniq { uniques } }
    } } }`, { zone: zoneId, since: day(since), until: day(now), s24: since24.toISOString(), u24: now.toISOString() });
  const zone = main?.viewer?.zones?.[0] || {};
  const daily = (zone.days || []).map((d: any) => ({ date: d.dimensions.date, visitors: d.uniq.uniques, views: d.sum.pageViews, requests: d.sum.requests }));
  const hourly = (zone.hours || []).map((h: any) => ({ at: h.dimensions.datetime, visitors: h.uniq.uniques, views: h.sum.pageViews }));
  const countries: Record<string, number> = {};
  for (const d of (zone.days || []).slice(-7)) for (const c of d.sum.countryMap || []) countries[c.clientCountryName] = (countries[c.clientCountryName] || 0) + c.requests;
  const topCountries = Object.entries(countries).sort((a, b) => b[1] - a[1]).slice(0, 8).map(([code, requests]) => ({ code, requests }));
  // Most viewed pages (not available on every plan — left empty when Cloudflare refuses it)
  let topPages: { path: string; views: number }[] = [];
  try {
    const p = await cfGraphql(token, `query($zone: String!, $s24: Time!, $u24: Time!) { viewer { zones(filter: { zoneTag: $zone }) {
      pages: httpRequestsAdaptiveGroups(limit: 12, filter: { datetime_geq: $s24, datetime_lt: $u24, requestSource: "eyeball", edgeResponseContentTypeName: "html", edgeResponseStatus: 200 }, orderBy: [count_DESC]) {
        count dimensions { clientRequestPath } } } } }`, { zone: zoneId, s24: since24.toISOString(), u24: now.toISOString() });
    topPages = (p?.viewer?.zones?.[0]?.pages || []).map((x: any) => ({ path: x.dimensions.clientRequestPath, views: x.count }))
      .filter((x: any) => !/^\/(?:admin|studio|api|assets|img)\//.test(x.path));
  } catch { /* plan without adaptive analytics */ }
  return { daily, hourly, topCountries, topPages, updatedAt: Date.now() };
}

// ── Router ─────────────────────────────────────────────────────────────────
type J = (body: unknown, status?: number) => Response;

export async function handleStudio(request: Request, env: StudioEnv, path: string, json: J): Promise<Response | null> {
  if (!path.startsWith('/api/studio/')) return null;
  const route = path.slice('/api/studio/'.length);
  const body: any = request.method === 'POST' ? await request.json().catch(() => ({})) : {};

  // Public: is the account set up yet?
  if (route === 'status' && request.method === 'GET') {
    const account = await env.PUSH_KV.get(ACCOUNT_KEY);
    return json({ success: true, configured: !!account });
  }

  // Create or reset the account — only with a GitHub token that can write to the repo.
  if (route === 'setup' && request.method === 'POST') {
    const gh = String(body.githubToken || '');
    const proof = new Request(request.url, { headers: { Authorization: `Bearer ${gh}` } });
    const devSetup = env.STUDIO_DEV === '1' && /^(localhost|127\.0\.0\.1|192\.168\.\d+\.\d+)$/.test(new URL(request.url).hostname);
    if (!devSetup && (!gh || !(await authorizeAdmin(proof, env)))) return json({ success: false, error: 'لازم تأكيد الملكية بحساب جيت هب اللي عنده صلاحية تعديل الموقع.' }, 403);
    const username = cleanUsername(body.username);
    const email = String(body.email || '').trim().toLowerCase();
    if (!/^[a-z0-9_.-]{3,32}$/.test(username)) return json({ success: false, error: 'اسم المستخدم من 3 لـ 32 حرف إنجليزي أو رقم (مسموح . و _ و -).' }, 400);
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return json({ success: false, error: 'اكتب إيميل صحيح.' }, 400);
    const problem = passwordProblem(body.password);
    if (problem) return json({ success: false, error: problem }, 400);
    const existing = (await env.PUSH_KV.get(ACCOUNT_KEY, 'json')) as Account | null;
    const h = await hashPassword(body.password);
    const now = Date.now();
    const displayName = String(body.displayName || existing?.displayName || '').trim().slice(0, 40);
    await env.PUSH_KV.put(ACCOUNT_KEY, JSON.stringify({ username, email, displayName, ...h, createdAt: existing?.createdAt || now, updatedAt: now }));
    await endAllSessions(env);
    await logLogin(env, { event: existing ? 'reset' : 'setup', ...clientInfo(request) });
    return json({ success: true });
  }

  if (route === 'login' && request.method === 'POST') {
    const info = clientInfo(request);
    const account = (await env.PUSH_KV.get(ACCOUNT_KEY, 'json')) as Account | null;
    if (!account) return json({ success: false, needsSetup: true, error: 'لسه مفيش حساب. اعمل الحساب الأول.' }, 409);
    const login = cleanUsername(body.login);
    const matches = login === account.username || login === account.email;
    const ok = matches && (await verifyPassword(String(body.password || ''), account));
    if (!ok) {
      await logLogin(env, { event: 'failed', ...info });
      await new Promise(r => setTimeout(r, WRONG_PASSWORD_DELAY_MS));
      return json({ success: false, error: 'اسم المستخدم أو كلمة السر غلط.' }, 401);
    }
    const session = await createSession(env, request, !!body.remember);
    await logLogin(env, { event: 'login', remember: !!body.remember, ...info });
    return json({ success: true, ...session, user: { username: account.username, email: account.email, displayName: account.displayName || '' } });
  }

  // Everything below needs a live session.
  const session = await studioSession(request, env);
  if (!session || !(await sessionAlive(env, session))) return json({ success: false, auth: false, error: 'انتهت الجلسة. سجّل الدخول من جديد.' }, 401);

  // ── Visitor statistics (Cloudflare's own analytics for the site's zone) ──
  if (route === 'analytics/config' && request.method === 'POST') {
    const token = String(body.token || '').trim();
    if (token.length < 20) return json({ success: false, error: 'الصق مفتاح القراءة كامل.' }, 400);
    let zoneId = String(body.zoneId || '').trim();
    if (!zoneId) {
      const z: any = await fetch(`https://api.cloudflare.com/client/v4/zones?name=${encodeURIComponent(SITE_ZONE)}`, { headers: { Authorization: `Bearer ${token}` } }).then(r => r.json()).catch(() => null);
      zoneId = z?.result?.[0]?.id || '';
      if (!zoneId) return json({ success: false, needZone: true, error: 'المفتاح مش بيقدر يشوف بيانات الموقع. اتأكد إنك اخترت الصلاحيات الصح، أو اكتب «رقم الموقع» (Zone ID) كمان.' }, 400);
    }
    const test = await cfAnalytics(token, zoneId, 1).catch((e: any) => ({ error: e.message }));
    if ((test as any).error) return json({ success: false, error: `المفتاح مش شغال: ${(test as any).error}` }, 400);
    await env.PUSH_KV.put(ANALYTICS_KEY, JSON.stringify({ token, zoneId, at: Date.now() }));
    await env.PUSH_KV.delete(ANALYTICS_CACHE_KEY);
    return json({ success: true });
  }
  if (route === 'analytics/config' && request.method === 'DELETE') {
    await env.PUSH_KV.delete(ANALYTICS_KEY); await env.PUSH_KV.delete(ANALYTICS_CACHE_KEY);
    return json({ success: true });
  }
  if (route === 'analytics' && request.method === 'GET') {
    const cfg = (await env.PUSH_KV.get(ANALYTICS_KEY, 'json')) as { token: string; zoneId: string } | null;
    if (!cfg) return json({ success: true, configured: false });
    const cached = (await env.PUSH_KV.get(ANALYTICS_CACHE_KEY, 'json')) as any;
    if (cached && Date.now() - cached.at < 10 * 60_000) return json({ success: true, configured: true, ...cached.data });
    try {
      const data = await cfAnalytics(cfg.token, cfg.zoneId, 30);
      await env.PUSH_KV.put(ANALYTICS_CACHE_KEY, JSON.stringify({ at: Date.now(), data }), { expirationTtl: 3600 });
      return json({ success: true, configured: true, ...data });
    } catch (e: any) {
      if (cached) return json({ success: true, configured: true, stale: true, ...cached.data });
      return json({ success: false, configured: true, error: `تعذر جلب الإحصائيات: ${e.message}` }, 502);
    }
  }

  if (route === 'me' && request.method === 'GET') {
    const account = (await env.PUSH_KV.get(ACCOUNT_KEY, 'json')) as Account | null;
    return json({ success: true, user: account ? { username: account.username, email: account.email, displayName: account.displayName || '' } : null, session });
  }
  // The name shown in «أهلا يا …» (the username stays for signing in)
  if (route === 'profile' && request.method === 'POST') {
    const account = (await env.PUSH_KV.get(ACCOUNT_KEY, 'json')) as Account | null;
    if (!account) return json({ success: false, error: 'الحساب غير موجود.' }, 404);
    const displayName = String(body.displayName || '').trim().slice(0, 40);
    await env.PUSH_KV.put(ACCOUNT_KEY, JSON.stringify({ ...account, displayName, updatedAt: Date.now() }));
    return json({ success: true, user: { username: account.username, email: account.email, displayName } });
  }
  if (route === 'logout' && request.method === 'POST') { await endSession(env, request); return json({ success: true }); }
  if (route === 'logout-all' && request.method === 'POST') { await endAllSessions(env); return json({ success: true }); }
  if (route === 'sessions' && request.method === 'GET') {
    const log = ((await env.PUSH_KV.get(LOGIN_LOG_KEY, 'json')) as any[] | null) || [];
    return json({ success: true, current: session.id, sessions: await readIndex(env), log: log.slice(0, 20) });
  }
  if (route === 'password' && request.method === 'POST') {
    const account = (await env.PUSH_KV.get(ACCOUNT_KEY, 'json')) as Account | null;
    if (!account || !(await verifyPassword(String(body.current || ''), account))) return json({ success: false, error: 'كلمة السر الحالية غلط.' }, 400);
    const problem = passwordProblem(body.next);
    if (problem) return json({ success: false, error: problem }, 400);
    const h = await hashPassword(body.next);
    await env.PUSH_KV.put(ACCOUNT_KEY, JSON.stringify({ ...account, ...h, updatedAt: Date.now() }));
    await endAllSessions(env);
    const fresh = await createSession(env, request, session.remember);
    return json({ success: true, ...fresh });
  }

  // ── Content ─────────────────────────────────────────────────────────────
  if (route === 'list' && request.method === 'GET') {
    const folder = COLLECTION_FOLDERS[new URL(request.url).searchParams.get('collection') || ''];
    if (!folder) return json({ success: false, error: 'قسم غير معروف' }, 400);
    const tree = await ghJson(env, `/git/trees/${encodeURIComponent(`${env.GITHUB_BRANCH}:${folder}`)}`);
    const files = (tree.tree || []).filter((e: any) => e.type === 'blob' && e.path.endsWith('.md')).map((e: any) => ({ slug: e.path.replace(/\.md$/, ''), sha: e.sha }));
    return json({ success: true, files });
  }
  if (route === 'entry' && request.method === 'GET') {
    const q = new URL(request.url).searchParams;
    const p = entryPath(q.get('collection') || '', q.get('slug') || '');
    if (!p) return json({ success: false, error: 'مسار غير صالح' }, 400);
    const file = await readRepoFile(env, p);
    if (!file) return json({ success: false, error: 'الموضوع غير موجود' }, 404);
    return json({ success: true, ...file });
  }
  if (route === 'save' && request.method === 'POST') {
    const p = entryPath(String(body.collection || ''), String(body.slug || ''));
    if (!p) return json({ success: false, error: 'مسار غير صالح' }, 400);
    if (typeof body.content !== 'string' || !body.content.startsWith('---') || body.content.length > 400_000) return json({ success: false, error: 'محتوى غير صالح' }, 400);
    const existing = await readRepoFile(env, p);
    if (body.create && existing) return json({ success: false, error: 'في موضوع بنفس الاسم بالفعل.' }, 409);
    // Opened version ≠ current version: someone (usually the automatic fixes) changed it meanwhile.
    if (!body.create && body.sha && existing && existing.sha !== body.sha && !body.force) {
      return json({ success: false, conflict: true, current: existing, error: 'الموضوع اتعدّل من مكان تاني بعد ما فتحته.' }, 409);
    }
    const changes: FileChange[] = [{ path: p, text: body.content }];
    for (const img of Array.isArray(body.images) ? body.images : []) {
      if (!imagePathOk(String(img.path || '')) || typeof img.base64 !== 'string') return json({ success: false, error: 'صورة غير صالحة' }, 400);
      if (img.base64.length * 0.75 > MAX_IMAGE_BYTES) return json({ success: false, error: 'الصورة أكبر من 6 ميجا.' }, 400);
      changes.push({ path: img.path, base64: img.base64 });
    }
    const label = { shows: 'عرض', recaps: 'ملخص', news: 'خبر', nostalgia: 'عرض / حلقة نوستالجيا', nostalgia_series: 'سلسلة نوستالجيا' }[String(body.collection)] || 'موضوع';
    const sha = await commitFiles(env, changes, `${existing ? 'Update' : 'Create'} ${label} “${body.slug}” (لوحة التحكم)`);
    const saved = await readRepoFile(env, p).catch(() => null);
    return json({ success: true, commit: sha, sha: saved?.sha || null });
  }
  if (route === 'delete' && request.method === 'POST') {
    const p = entryPath(String(body.collection || ''), String(body.slug || ''));
    if (!p) return json({ success: false, error: 'مسار غير صالح' }, 400);
    if (body.confirm !== body.slug) return json({ success: false, error: 'تأكيد الحذف غير مطابق.' }, 400);
    const existing = await readRepoFile(env, p);
    if (!existing) return json({ success: false, error: 'الموضوع غير موجود' }, 404);
    const sha = await commitFiles(env, [{ path: p, remove: true }], `Delete ${body.collection} “${body.slug}” (لوحة التحكم)`);
    return json({ success: true, commit: sha });
  }

  return json({ success: false, error: 'طلب غير معروف' }, 404);
}
