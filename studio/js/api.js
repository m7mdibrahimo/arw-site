// Talks to the site's worker (login, saving to the repo, publishing status).
// On this computer (localhost) nothing reaches the live site: login and the dashboard
// talk to a local copy of the worker, and saving writes the files on disk through
// the local CMS server — the same way the old panel's local mode works.
import { COLLECTIONS } from './schema.js';

const LOCAL = /^(localhost|127\.0\.0\.1|\[::1\]|192\.168\.\d+\.\d+|.*\.local)$/.test(location.hostname);
export const IS_LOCAL = LOCAL;
const WORKER = LOCAL ? `http://${location.hostname === 'localhost' ? 'localhost' : location.hostname}:8787` : 'https://arw-site-bot.m7mdibrahimpc.workers.dev';
const LOCAL_FS = `http://${location.hostname}:8081/api/v1`;
const TOKEN_KEY = 'arw_studio_token';
const USER_KEY = 'arw_studio_user';

export function getToken() {
  try { return localStorage.getItem(TOKEN_KEY) || sessionStorage.getItem(TOKEN_KEY) || ''; } catch { return ''; }
}
export function getUser() {
  try { return JSON.parse(localStorage.getItem(USER_KEY) || sessionStorage.getItem(USER_KEY) || 'null'); } catch { return null; }
}
export function saveSession({ token, user, remember }) {
  try {
    const store = remember ? localStorage : sessionStorage;
    (remember ? sessionStorage : localStorage).removeItem(TOKEN_KEY);
    store.setItem(TOKEN_KEY, token);
    if (user) store.setItem(USER_KEY, JSON.stringify(user));
  } catch {}
}
export function updateUser(user) {
  try { for (const s of [localStorage, sessionStorage]) if (s.getItem(TOKEN_KEY)) s.setItem(USER_KEY, JSON.stringify(user)); } catch {}
}
export function clearSession() {
  try { for (const s of [localStorage, sessionStorage]) { s.removeItem(TOKEN_KEY); s.removeItem(USER_KEY); } } catch {}
}

export class ApiError extends Error {
  constructor(message, status, data) { super(message); this.status = status; this.data = data; }
}

async function call(path, { method = 'GET', body, auth = true } = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (auth && getToken()) headers.Authorization = `Bearer ${getToken()}`;
  let res;
  try {
    res = await fetch(`${WORKER}${path}`, { method, headers, body: body ? JSON.stringify(body) : undefined });
  } catch (e) {
    throw new ApiError(LOCAL ? 'الخادم المحلي للّوحة مش شغال.' : 'مفيش اتصال بالإنترنت أو الخادم مش بيرد.', 0);
  }
  const data = await res.json().catch(() => ({}));
  if (res.status === 401 && data.auth === false) {
    clearSession();
    window.dispatchEvent(new CustomEvent('studio:logout', { detail: data.error }));
  }
  if (!res.ok || data.success === false) throw new ApiError(data.error || `خطأ ${res.status}`, res.status, data);
  return data;
}

// ── Account ────────────────────────────────────────────────────────────────
export const api = {
  status: () => call('/api/studio/status', { auth: false }),
  setup: (b) => call('/api/studio/setup', { method: 'POST', body: b, auth: false }),
  login: (b) => call('/api/studio/login', { method: 'POST', body: b, auth: false }),
  me: () => call('/api/studio/me'),
  logout: () => call('/api/studio/logout', { method: 'POST', body: {} }),
  logoutAll: () => call('/api/studio/logout-all', { method: 'POST', body: {} }),
  sessions: () => call('/api/studio/sessions'),
  changePassword: (b) => call('/api/studio/password', { method: 'POST', body: b }),
  saveProfile: (b) => call('/api/studio/profile', { method: 'POST', body: b }),
  saveAvatar: (image) => call('/api/studio/avatar', { method: 'POST', body: { image } }),
  overview: (urls) => call('/api/studio/overview', { method: 'POST', body: { urls } }),
  analytics: () => call('/api/studio/analytics'),
  connectAnalytics: (b) => call('/api/studio/analytics/config', { method: 'POST', body: b }),
  disconnectAnalytics: () => call('/api/studio/analytics/config', { method: 'DELETE' }),
};

// ── Content ────────────────────────────────────────────────────────────────
async function localFs(action, params) {
  const res = await fetch(LOCAL_FS, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action, params: { branch: 'main', ...params } }) });
  if (!res.ok) throw new ApiError('الخادم المحلي للملفات مش شغال.', res.status);
  return res.json();
}

export const content = {
  async list(collection) {
    if (LOCAL) {
      const entries = await localFs('entriesByFolder', { folder: COLLECTIONS[collection].folder, extension: 'md', depth: 1 });
      return entries.map(e => ({ slug: e.file.path.split('/').pop().replace(/\.md$/, '') }));
    }
    return (await call(`/api/studio/list?collection=${collection}`)).files;
  },
  async get(collection, slug) {
    const path = `${COLLECTIONS[collection].folder}/${slug}.md`;
    if (LOCAL) {
      const e = await localFs('getEntry', { path });
      if (!e || typeof e.data !== 'string') throw new ApiError('الموضوع غير موجود', 404);
      return { content: e.data, sha: await sha1(e.data) };
    }
    return call(`/api/studio/entry?collection=${collection}&slug=${encodeURIComponent(slug)}`);
  },
  async save({ collection, slug, content: text, sha, create, images = [], force = false }) {
    const path = `${COLLECTIONS[collection].folder}/${slug}.md`;
    if (LOCAL) {
      if (!create && sha && !force) {
        const cur = await localFs('getEntry', { path }).catch(() => null);
        if (cur && typeof cur.data === 'string' && (await sha1(cur.data)) !== sha) {
          throw new ApiError('الموضوع اتعدّل من مكان تاني بعد ما فتحته.', 409, { conflict: true, current: { content: cur.data, sha: await sha1(cur.data) } });
        }
      }
      await localFs('persistEntry', {
        dataFiles: [{ slug, path, raw: text }],
        assets: images.map(i => ({ path: i.path, content: i.base64, encoding: 'base64' })), options: { collectionName: collection, status: 'published', commitMessage: `Studio ${slug}`, useWorkflow: false },
      });
      return { success: true, sha: await sha1(text) };
    }
    return call('/api/studio/save', { method: 'POST', body: { collection, slug, content: text, sha, create, images, force } });
  },
  async remove(collection, slug) {
    if (LOCAL) { await localFs('deleteFile', { path: `${COLLECTIONS[collection].folder}/${slug}.md`, options: { commitMessage: `Studio delete ${slug}` } }); return { success: true }; }
    return call('/api/studio/delete', { method: 'POST', body: { collection, slug, confirm: slug } });
  },
};

async function sha1(text) {
  const d = await crypto.subtle.digest('SHA-1', new TextEncoder().encode(text));
  return Array.from(new Uint8Array(d)).map(b => b.toString(16).padStart(2, '0')).join('');
}

// ── Public site data (built with the site) ─────────────────────────────────
let cache = {};
export async function siteData(name, maxAgeMs = 60_000) {
  const hit = cache[name];
  if (hit && Date.now() - hit.at < maxAgeMs) return hit.data;
  const res = await fetch(`/${name}?t=${Date.now()}`, { cache: 'no-store' });
  const data = res.ok ? await res.json() : [];
  cache[name] = { at: Date.now(), data };
  return data;
}
export function dropSiteCache() { cache = {}; }

// Saved here but not built into the site yet — shown as «جاري النشر» until the build catches up.
const PENDING_KEY = 'arw_studio_pending';
export function pendingSaves() {
  try { return JSON.parse(localStorage.getItem(PENDING_KEY) || '[]').filter(p => Date.now() - p.at < 30 * 60_000); } catch { return []; }
}
export function addPending(item) {
  try {
    const list = pendingSaves().filter(p => !(p.collection === item.collection && p.slug === item.slug));
    list.unshift({ ...item, at: Date.now() });
    localStorage.setItem(PENDING_KEY, JSON.stringify(list.slice(0, 20)));
  } catch {}
}
