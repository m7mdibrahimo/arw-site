// The owner's panel (/studio/): login, sessions, lockout and the write guards.
import test from 'node:test';
import assert from 'node:assert/strict';
import { handleStudio, hashPassword, verifyPassword, passwordProblem, entryPath, imagePathOk, studioAuthorized } from '../worker/src/studio';

function memoryKV() {
  const m = new Map<string, { v: string; exp?: number }>();
  return {
    async get(k: string, type?: string) {
      const e = m.get(k);
      if (!e || (e.exp && e.exp < Date.now())) return null;
      return type === 'json' ? JSON.parse(e.v) : e.v;
    },
    async put(k: string, v: string, o?: { expirationTtl?: number }) { m.set(k, { v, exp: o?.expirationTtl ? Date.now() + o.expirationTtl * 1000 : undefined }); },
    async delete(k: string) { m.delete(k); },
    _map: m,
  } as any;
}
const env = () => ({ GITHUB_OWNER: 'o', GITHUB_REPO: 'r', GITHUB_BRANCH: 'main', GITHUB_TOKEN: 'x', PUSH_KV: memoryKV() });
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
const call = async (e: any, route: string, init: { method?: string; body?: any; token?: string; ip?: string } = {}) => {
  const req = new Request(`https://w.dev/api/studio/${route}`, {
    method: init.method || (init.body ? 'POST' : 'GET'),
    headers: { 'Content-Type': 'application/json', 'CF-Connecting-IP': init.ip || '1.1.1.1', ...(init.token ? { Authorization: `Bearer ${init.token}` } : {}) },
    body: init.body ? JSON.stringify(init.body) : undefined,
  });
  const res = await handleStudio(req, e, `/api/studio/${route.split('?')[0]}`, json); // like url.pathname
  return { status: res!.status, data: await res!.json() as any, req };
};
// GitHub answers «has write access» only for the token 'good'
const realFetch = globalThis.fetch;
function mockGitHub() {
  globalThis.fetch = (async (input: any, init: any) => {
    const url = String(input instanceof Request ? input.url : input);
    const auth = (init?.headers?.Authorization) || (input instanceof Request ? input.headers.get('Authorization') : '');
    if (url.includes('/collaborators')) return new Response('[]', { status: auth === 'Bearer good-token-123456' ? 200 : 401 });
    return new Response('{}', { status: 404 });
  }) as any;
}

test('passwords are hashed with a salt and checked in constant time', async () => {
  const h = await hashPassword('Secret123');
  assert.notEqual(h.hash, 'Secret123');
  assert.equal(await verifyPassword('Secret123', h), true);
  assert.equal(await verifyPassword('secret123', h), false);
  const h2 = await hashPassword('Secret123');
  assert.notEqual(h.hash, h2.hash, 'a new salt every time');
  assert.ok(passwordProblem('short1'));
  assert.ok(passwordProblem('onlyletters'));
  assert.equal(passwordProblem('Wrestling2026'), null);
});

test('the account can only be created with a GitHub token that can write to the repo', async () => {
  mockGitHub();
  try {
    const e = env();
    assert.equal((await call(e, 'status')).data.configured, false);
    const bad = await call(e, 'setup', { body: { githubToken: 'nope', username: 'owner', email: 'o@x.com', password: 'Wrestling2026' } });
    assert.equal(bad.status, 403);
    const ok = await call(e, 'setup', { body: { githubToken: 'good-token-123456', username: 'Owner', email: 'O@X.com', password: 'Wrestling2026' } });
    assert.equal(ok.status, 200);
    assert.equal((await call(e, 'status')).data.configured, true);
    const stored = JSON.parse(e.PUSH_KV._map.get('studio:users').v)[0];
    assert.equal(stored.username, 'owner');
    assert.ok(!JSON.stringify(stored).includes('Wrestling2026'), 'the password itself is never stored');
  } finally { globalThis.fetch = realFetch; }
});

test('login works with the username or the e-mail, sessions end on logout, and wrong passwords never lock the owner out', async () => {
  mockGitHub();
  try {
    const e = env();
    await call(e, 'setup', { body: { githubToken: 'good-token-123456', username: 'owner', email: 'o@x.com', password: 'Wrestling2026' } });
    const byName = await call(e, 'login', { body: { login: 'OWNER', password: 'Wrestling2026', remember: true } });
    assert.equal(byName.status, 200);
    assert.ok(byName.data.token.startsWith('st_'));
    assert.ok(byName.data.expiresAt - Date.now() > 29 * 86400_000, 'remember me = 30 days');
    const byMail = await call(e, 'login', { body: { login: 'o@x.com', password: 'Wrestling2026' } });
    assert.ok(byMail.data.expiresAt - Date.now() < 13 * 3600_000, 'without remember me = 12 hours');
    assert.ok(![...e.PUSH_KV._map.keys()].some((k: string) => k.includes(byName.data.token)), 'KV keeps only a hash of the token');

    const me = await call(e, 'me', { token: byName.data.token });
    assert.equal(me.data.user.username, 'owner');
    assert.equal(await studioAuthorized(me.req, e), true);
    assert.equal((await call(e, 'me', { token: 'st_forged_token_value_0000000000' })).status, 401);

    await call(e, 'logout', { token: byName.data.token, body: {} });
    assert.equal((await call(e, 'me', { token: byName.data.token })).status, 401);
    assert.equal((await call(e, 'me', { token: byMail.data.token })).status, 200, 'other devices stay signed in');
    await call(e, 'logout-all', { token: byMail.data.token, body: {} });
    assert.equal((await call(e, 'me', { token: byMail.data.token })).status, 401);

    // Wrong passwords never lock the owner out (owner's choice): the right one still works after many misses
    for (let i = 0; i < 7; i++) assert.equal((await call(e, 'login', { ip: '9.9.9.9', body: { login: 'owner', password: 'wrong' } })).status, 401);
    assert.equal((await call(e, 'login', { ip: '9.9.9.9', body: { login: 'owner', password: 'Wrestling2026' } })).status, 200);
  } finally { globalThis.fetch = realFetch; }
});

test('writes stay inside the content folders', () => {
  assert.equal(entryPath('shows', '20260927104500-aew-all-out-2026'), 'content/shows/20260927104500-aew-all-out-2026.md');
  assert.equal(entryPath('nostalgia_series', '2026-باد-بلود-1997'), 'content/nostalgia-series/2026-باد-بلود-1997.md');
  assert.equal(entryPath('news', '../../worker/src/index'), null);
  assert.equal(entryPath('news', 'a/b'), null);
  assert.equal(entryPath('pages', 'x'), null);
  assert.equal(imagePathOk('content/images/ab12cd34ef.jpg'), true);
  assert.equal(imagePathOk('content/images/../x.jpg'), false);
  assert.equal(imagePathOk('assets/x.jpg'), false);
});

test('content routes refuse requests without a session', async () => {
  const e = env();
  for (const r of ['list?collection=news', 'entry?collection=news&slug=x', 'sessions']) assert.equal((await call(e, r)).status, 401);
  assert.equal((await call(e, 'save', { body: { collection: 'news', slug: 'x', content: '---\n---' } })).status, 401);
});

test('a save is one commit on top of the current head, retried when the bots moved main meanwhile', async () => {
  const { commitFiles } = await import('../worker/src/studio');
  const calls: string[] = [];
  let head = 'h1', refUpdates = 0;
  globalThis.fetch = (async (input: any, init: any = {}) => {
    const url = String(input), method = init.method || 'GET';
    calls.push(`${method} ${url.replace('https://api.github.com/repos/o/r', '')}`);
    const ok = (b: any) => new Response(JSON.stringify(b), { status: 200 });
    if (url.endsWith('/git/blobs') && method === 'POST') return ok({ sha: `blob${calls.length}` });
    if (url.endsWith('/git/ref/heads/main')) return ok({ object: { sha: head } });
    if (url.includes('/git/commits/') && method === 'GET') return ok({ tree: { sha: `tree-${head}` } });
    if (url.endsWith('/git/trees') && method === 'POST') return ok({ sha: 'newtree' });
    if (url.endsWith('/git/commits') && method === 'POST') return ok({ sha: `c-on-${JSON.parse(init.body).parents[0]}` });
    if (url.endsWith('/git/refs/heads/main') && method === 'PATCH') {
      refUpdates++;
      if (refUpdates === 1) { head = 'h2'; return new Response('{"message":"Update is not a fast forward"}', { status: 422 }); }
      return ok({});
    }
    return new Response('{}', { status: 404 });
  }) as any;
  try {
    const sha = await commitFiles(env() as any, [{ path: 'content/news/x.md', text: '---\ntitle: x\n---\n' }, { path: 'content/images/abcdef12.jpg', base64: 'AAAA' }], 'Create خبر');
    assert.equal(sha, 'c-on-h2', 'rebuilt on the new head after the 422');
    assert.equal(calls.filter(c => c.startsWith('POST /git/blobs')).length, 2, 'blobs uploaded once');
    assert.equal(refUpdates, 2);
    assert.ok(!calls.some(c => c.includes('force')), 'never a force push');
  } finally { globalThis.fetch = realFetch; }
});

test('the local-only setup switch can never be enabled from wrangler.toml', async () => {
  const fs = await import('node:fs');
  assert.ok(!fs.readFileSync(new URL('../worker/wrangler.toml', import.meta.url), 'utf8').includes('STUDIO_DEV'));
});

test('the display name is saved and returned, and signing in still uses the username', async () => {
  mockGitHub();
  try {
    const e = env();
    await call(e, 'setup', { body: { githubToken: 'good-token-123456', username: 'owner', email: 'o@x.com', password: 'Wrestling2026' } });
    const s = await call(e, 'login', { body: { login: 'owner', password: 'Wrestling2026' } });
    const r = await call(e, 'profile', { token: s.data.token, body: { displayName: 'محمد' } });
    assert.equal(r.data.user.displayName, 'محمد');
    assert.equal((await call(e, 'me', { token: s.data.token })).data.user.displayName, 'محمد');
    assert.equal((await call(e, 'login', { body: { login: 'owner', password: 'Wrestling2026' } })).data.user.displayName, 'محمد');
  } finally { globalThis.fetch = realFetch; }
});

test('the account picture is saved, returned with the user, size-checked and removable', async () => {
  mockGitHub();
  try {
    const e = env();
    await call(e, 'setup', { body: { githubToken: 'good-token-123456', username: 'owner', email: 'o@x.com', password: 'Wrestling2026' } });
    const s = await call(e, 'login', { body: { login: 'owner', password: 'Wrestling2026' } });
    const img = 'data:image/jpeg;base64,' + 'A'.repeat(2000);
    assert.equal((await call(e, 'avatar', { token: s.data.token, body: { image: img } })).data.user.avatar, img);
    assert.equal((await call(e, 'me', { token: s.data.token })).data.user.avatar, img);
    assert.equal((await call(e, 'avatar', { token: s.data.token, body: { image: 'javascript:alert(1)' } })).status, 400);
    assert.equal((await call(e, 'avatar', { token: s.data.token, body: { image: 'data:image/jpeg;base64,' + 'A'.repeat(130000) } })).status, 400);
    assert.equal((await call(e, 'avatar', { token: s.data.token, body: { image: '' } })).data.user.avatar, '');
    assert.equal((await call(e, 'avatar', { body: { image: img } })).status, 401, 'needs a session');
  } finally { globalThis.fetch = realFetch; }
});


// ── Members & permissions ──────────────────────────────────────────────────
async function ownerAndMember(perms: string[]) {
  const e = env();
  await call(e, 'setup', { body: { githubToken: 'good-token-123456', username: 'owner', email: 'o@x.com', password: 'Wrestling2026' } });
  const owner = (await call(e, 'login', { body: { login: 'owner', password: 'Wrestling2026' } })).data.token;
  const created = await call(e, 'members/create', { token: owner, body: { username: 'editor', email: 'ed@x.com', displayName: 'أحمد', password: 'Temp12345', perms } });
  return { e, owner, created };
}

test('the owner adds a member who must replace the temporary password before doing anything', async () => {
  mockGitHub();
  try {
    const { e, created } = await ownerAndMember(['news.create']);
    assert.equal(created.status, 200);
    assert.deepEqual(created.data.member.perms, ['news.view', 'news.create'], 'creating implies viewing; unknown permissions dropped');
    const m = await call(e, 'login', { body: { login: 'editor', password: 'Temp12345' } });
    assert.equal(m.data.user.mustChange, true);
    assert.equal((await call(e, 'list?collection=news', { token: m.data.token })).status, 403, 'blocked until the password is changed');
    const changed = await call(e, 'password', { token: m.data.token, body: { current: 'Temp12345', next: 'MyOwn2026' } });
    assert.equal(changed.status, 200);
    assert.equal(changed.data.user.mustChange, false);
    assert.equal((await call(e, 'me', { token: m.data.token })).status, 401, 'the old session ends with the password change');
    assert.equal((await call(e, 'me', { token: changed.data.token })).status, 200);
  } finally { globalThis.fetch = realFetch; }
});

test('permissions are enforced on the server for every section and action', async () => {
  mockGitHub();
  try {
    const { e } = await ownerAndMember(['news.view', 'news.create']);
    const t0 = (await call(e, 'login', { body: { login: 'editor', password: 'Temp12345' } })).data.token;
    const t = (await call(e, 'password', { token: t0, body: { current: 'Temp12345', next: 'MyOwn2026' } })).data.token;
    assert.equal((await call(e, 'entry?collection=shows&slug=x', { token: t })).status, 403, 'no shows.view');
    assert.equal((await call(e, 'delete', { token: t, body: { collection: 'news', slug: 'x', confirm: 'x' } })).status, 403, 'no news.delete');
    assert.equal((await call(e, 'analytics', { token: t })).status, 403, 'no stats');
    assert.equal((await call(e, 'members', { token: t })).status, 403, 'members are owner-only');
    assert.equal((await call(e, 'members/create', { token: t, body: { username: 'x2', email: 'x2@x.com', password: 'Abcdefg12', perms: ['news.delete'] } })).status, 403, 'no self-promotion');
    assert.equal((await call(e, 'audit', { token: t })).status, 403);
    const req = new Request('https://w.dev/api/admin/x', { method: 'POST', headers: { Authorization: `Bearer ${t}` } });
    assert.equal(await studioAuthorized(req, e, 'tools'), false, 'no tools permission → old admin endpoints stay closed');
  } finally { globalThis.fetch = realFetch; }
});

test('the owner can disable, sign out, reset and delete a member — never the owner account', async () => {
  mockGitHub();
  try {
    const { e, owner, created } = await ownerAndMember(['news.view']);
    const id = created.data.member.id;
    const m = (await call(e, 'login', { body: { login: 'editor', password: 'Temp12345' } })).data.token;
    await call(e, `members/${id}/disable`, { token: owner, body: {} });
    assert.equal((await call(e, 'me', { token: m })).status, 401, 'disabled → signed out');
    assert.equal((await call(e, 'login', { body: { login: 'editor', password: 'Temp12345' } })).status, 401, 'disabled → cannot sign in');
    await call(e, `members/${id}/enable`, { token: owner, body: {} });
    await call(e, `members/${id}/password`, { token: owner, body: { password: 'NewTemp999' } });
    assert.equal((await call(e, 'login', { body: { login: 'editor', password: 'NewTemp999' } })).data.user.mustChange, true);
    const members = (await call(e, 'members', { token: owner })).data.members;
    assert.ok(!JSON.stringify(members).includes('hash'), 'password hashes never leave the server');
    assert.equal((await call(e, 'members/owner/delete', { token: owner, body: { confirm: 'owner' } })).status, 404, 'the owner id is not a member route');
    assert.equal((await call(e, `members/${id}/delete`, { token: owner, body: { confirm: 'wrong' } })).status, 400);
    assert.equal((await call(e, `members/${id}/delete`, { token: owner, body: { confirm: 'editor' } })).status, 200);
    assert.equal((await call(e, 'login', { body: { login: 'editor', password: 'NewTemp999' } })).status, 401);
    const log = (await call(e, 'audit', { token: owner })).data.entries.map((x: any) => x.action);
    assert.ok(log.includes('member.create') && log.includes('member.delete'));
  } finally { globalThis.fetch = realFetch; }
});

test('the single-owner account moves to the new system with its password and sessions', async () => {
  const e = env();
  const h = await hashPassword('Wrestling2026');
  await e.PUSH_KV.put('studio:account', JSON.stringify({ username: 'owner', email: 'o@x.com', ...h, createdAt: 1, updatedAt: 1 }));
  const r = await call(e, 'login', { body: { login: 'owner', password: 'Wrestling2026' } });
  assert.equal(r.status, 200);
  assert.equal(r.data.user.role, 'owner');
});

test('the old /admin/ panel is gone and every one of its jobs lives in the panel', async () => {
  const fs = await import('node:fs');
  assert.ok(!fs.existsSync('admin'), 'no old panel files');
  const redirects = fs.readFileSync('_redirects', 'utf8');
  for (const [from, to] of [['/admin/publish.html', '/studio/#/tools/social'], ['/admin/watcher.html', '/studio/#/tools/sources'], ['/admin/pinned.html', '/studio/#/tools/pinned'], ['/admin/reels.html', '/studio/#/tools/reels'], ['/admin', '/studio/'], ['/admin/*', '/studio/']]) {
    assert.ok(redirects.includes(`${from} ${to} 301`), `${from} → ${to}`);
  }
  const app = fs.readFileSync('studio/js/app.js', 'utf8');
  for (const tool of ['social', 'sources', 'pinned', 'reels']) assert.match(app, new RegExp(`#/tools/${tool}`));
  const worker = fs.readFileSync('worker/src/index.ts', 'utf8');
  for (const route of ['/api/studio/tools/social', '/api/studio/tools/sources', '/api/studio/tools/pinned', '/api/studio/tools/reels']) assert.ok(worker.includes(route), route);
  assert.ok(!fs.readFileSync('eleventy.config.js', 'utf8').includes('addPassthroughCopy("admin/'));
});
