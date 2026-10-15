// «مجتمع المصارعة» (owner 2026-10-14): the chat room (a Durable Object), the tickets, the uploads and the panel's tools.
// The room runs here on a real SQLite (node:sqlite) standing in for the Durable Object's, with sockets that only
// record what they're sent.
import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { createRequire } from 'node:module';
import { ChatRoom, ROOMS, cleanAtt, cleanChatText, handleChat, type Who } from '../worker/src/chat';
import { handleMembers } from '../worker/src/members';

const require = createRequire(import.meta.url);

function room(env: any = {}) {
  const db = new DatabaseSync(':memory:');
  const socks: any[] = [];
  const state = {
    storage: { sql: { exec(q: string, ...args: any[]) { const st = db.prepare(q); if (/^\s*select|returning/i.test(q)) { const rows = st.all(...args); return { toArray: () => rows }; } st.run(...args); return { toArray: () => [] }; } } },
    acceptWebSocket(ws: any) { socks.push(ws); },
    getWebSockets() { return socks.filter(s => !s.closed); },
  };
  const r = new ChatRoom(state, env);
  state.storage.sql.exec("INSERT INTO meta (k, v) VALUES ('room', 'wwe')");
  const join = (who: Partial<Who>) => {
    const me: Who = { uid: 1, user: 'kareem_10', name: 'كريم', pic: '', badge: 'blue', mod: false, mute: 0, ...who };
    const ws: any = { got: [] as any[], readyState: 1, att: me, send(s: string) { this.got.push(s === 'pong' ? s : JSON.parse(s)); }, serializeAttachment(v: any) { this.att = v; }, deserializeAttachment() { return this.att; }, close() { this.closed = true; } };
    socks.push(ws);
    return { ws, say: (b: any) => r.webSocketMessage(ws, typeof b === 'string' ? b : JSON.stringify(b)), last: (t: string) => [...ws.got].reverse().find((x: any) => x.t === t) };
  };
  return { r, join, db };
}

test('the rooms: one per promotion the site covers, and the same list on the page', () => {
  const page = require('../_data/communityRooms.js');
  assert.deepEqual(page.map((x: any) => x.id), [...ROOMS]);
  for (const x of page) { assert.ok(x.name && x.about && x.mark, x.id); }
});

test('a message reaches everyone in the room at once, with a quote of what it answers', async () => {
  const { join } = room();
  const a = join({ uid: 1, name: 'كريم' });
  const b = join({ uid: 2, name: 'سارة', user: 'sara22' });
  await a.say({ t: 'send', text: '  رو الليلة نار 🔥  ', nonce: 'n1' });
  const m1 = b.last('msg');
  assert.equal(m1.m.text, 'رو الليلة نار 🔥');
  assert.equal(m1.m.name, 'كريم');
  assert.equal(a.last('msg').nonce, 'n1');
  await b.say({ t: 'send', text: 'أكيد، المين إيفنت هيبقى تاريخي', reply: m1.m.id, spoiler: true });
  const m2 = a.last('msg').m;
  assert.deepEqual(m2.reply, { id: m1.m.id, name: 'كريم', text: 'رو الليلة نار 🔥', kind: 'text' });
  assert.equal(m2.spoiler, true);
  // nothing to send / too fast
  await a.say({ t: 'send', text: '   ' });
  assert.equal(a.last('error').code, 'empty');
  for (let i = 0; i < 6; i++) await a.say({ t: 'send', text: `رسالة ${i}` });
  assert.equal(a.last('error').code, 'slow');
});

test('reactions as Messenger: one a person, the same again takes it back, another replaces it', async () => {
  const { join } = room();
  const a = join({ uid: 1 });
  const b = join({ uid: 2, name: 'سارة' });
  await a.say({ t: 'send', text: 'مين بطل العالم الجاي؟' });
  const id = a.last('msg').m.id;
  await b.say({ t: 'react', id, e: '❤️' });
  assert.deepEqual(a.last('react').reacts, { '❤️': [2] });
  await a.say({ t: 'react', id, e: '❤️' });
  assert.deepEqual(a.last('react').reacts, { '❤️': [2, 1] });
  await b.say({ t: 'react', id, e: '😂' });
  assert.deepEqual(a.last('react').reacts, { '❤️': [1], '😂': [2] });
  await b.say({ t: 'react', id, e: '😂' });
  assert.deepEqual(a.last('react').reacts, { '❤️': [1] });
  // only emoji
  const before = a.ws.got.length;
  await b.say({ t: 'react', id, e: '<b>x</b>' });
  assert.equal(a.ws.got.length, before);
  await b.say({ t: 'react', id, e: '👍🏽' });
  assert.deepEqual(a.last('react').reacts, { '❤️': [1], '👍🏽': [2] });
});

test('deleting: your own message, or any message by the site\'s account; pinning is the site\'s account\'s', async () => {
  const { join } = room();
  const a = join({ uid: 1 });
  const b = join({ uid: 2, name: 'سارة' });
  const mod = join({ uid: 9, name: 'عرب راسلنج', badge: 'gold', mod: true, pic: 'official' });
  await a.say({ t: 'send', text: 'رسالة كريم' });
  const id = a.last('msg').m.id;
  await b.say({ t: 'del', id });
  assert.equal(a.last('del'), undefined);
  await b.say({ t: 'pin', id });
  assert.equal(a.last('pin'), undefined);
  await mod.say({ t: 'pin', id });
  assert.equal(a.last('pin').m.id, id);
  await mod.say({ t: 'del', id });
  assert.equal(b.last('del').id, id);
  // a deleted pinned message is unpinned
  assert.equal(b.last('pin').m, null);
  await b.say({ t: 'more', before: 999 });
  const shown = b.last('more').msgs.find((m: any) => m.id === id);
  assert.equal(shown.del, true);
  assert.equal(shown.text, '');
  await b.say({ t: 'send', text: 'رسالة سارة' });
  await b.say({ t: 'del', id: b.last('msg').m.id });
  assert.equal(a.last('del').id, b.last('msg').m.id);
});

test('typing, presence and history pages', async () => {
  const { r, join } = room();
  const a = join({ uid: 1 });
  const b = join({ uid: 2, name: 'سارة' });
  join({ uid: 2, name: 'سارة' }); // the same member on a second device counts once
  assert.equal(r.people().length, 2);
  await a.say({ t: 'typing' });
  assert.equal(b.last('typing').name, 'كريم');
  assert.equal(a.last('typing'), undefined);
  for (let i = 0; i < 70; i++) { (r as any).recent.clear(); await a.say({ t: 'send', text: `رقم ${i}` }); }
  await b.say({ t: 'more', before: 0 });
  await b.say({ t: 'more', before: 11 });
  assert.equal(b.last('more').msgs.length, 10);
  assert.equal(b.last('more').done, true);
  await a.say('ping');
  assert.equal(a.ws.got.at(-1), 'pong');
});

test('a muted member can\'t write; the panel mutes and the room tells them', async () => {
  const { r, join } = room();
  const a = join({ uid: 1 });
  await r.admin({ op: 'mute', uid: 1, until: Date.now() + 3600e3 });
  assert.ok(a.last('muted').until > Date.now());
  await a.say({ t: 'send', text: 'هل أستطيع الكتابة؟' });
  assert.equal(a.last('error').code, 'muted');
  await r.admin({ op: 'mute', uid: 1, until: 0 });
  await a.say({ t: 'send', text: 'رجعت' });
  assert.equal(a.last('msg').m.text, 'رجعت');
  await r.admin({ op: 'kick', uid: 1 });
  assert.equal(a.ws.closed, true);
});

test('what may be sent: plain text, and only files uploaded to this room', () => {
  assert.equal(cleanChatText('أ\n\n\n\n\nب‮'), 'أ\n\nب');
  assert.equal(cleanChatText('x'.repeat(3000)).length, 2000);
  const own = 'https://arw-site-bot.m7mdibrahimpc.workers.dev/chat/media/chat/wwe/202610/0123456789abcdef01234567.webp';
  assert.deepEqual(cleanAtt({ kind: 'image', url: own, w: 800, h: 600, size: 1000 }, 'wwe'), { kind: 'image', url: own, size: 1000, w: 800, h: 600 });
  assert.equal(cleanAtt({ kind: 'image', url: own }, 'aew'), null);
  assert.equal(cleanAtt({ kind: 'image', url: 'https://evil.example/x.webp' }, 'wwe'), null);
  assert.equal(cleanAtt({ kind: 'script', url: own }, 'wwe'), null);
  const v = cleanAtt({ kind: 'voice', url: own.replace('.webp', '.webm'), dur: 12, wave: [10, 200, -5, 'x'] }, 'wwe')!;
  assert.deepEqual(v.wave, [10, 100, 0, 0]);
});

// ── the worker's side: tickets and uploads ──
function memberEnv() {
  const db = new DatabaseSync(':memory:');
  const stmt = (sql: string, args: unknown[] = []): any => ({
    sql, args, bind: (...a: unknown[]) => stmt(sql, a),
    all: async () => ({ results: db.prepare(sql).all(...(args as any[])) }),
    first: async () => db.prepare(sql).get(...(args as any[])) ?? null,
    run: async () => { const r = db.prepare(sql).run(...(args as any[])); return { meta: { changes: Number(r.changes) } }; },
  });
  const kv = new Map<string, string>();
  const r2 = new Map<string, any>();
  return {
    ANALYTICS: { prepare: (sql: string) => stmt(sql), batch: async (l: any[]) => { const o = []; for (const s of l) o.push(/^\s*select/i.test(s.sql) ? await s.all() : await s.run()); return o; } },
    PUSH_KV: { m: kv, get: async (k: string) => kv.get(k) ?? null, put: async (k: string, v: string) => { kv.set(k, v); }, delete: async (k: string) => { kv.delete(k); } },
    MEDIA: { r2, put: async (k: string, body: any, o: any) => { r2.set(k, { body, ...o }); }, get: async (k: string) => { const o = r2.get(k); return o ? { body: o.body, size: o.body.length, httpMetadata: o.httpMetadata, customMetadata: o.customMetadata, etag: 'e1' } : null; }, delete: async () => {} },
  } as any;
}
async function member(e: any) {
  const capR = await handleMembers(new Request('https://w/members/captcha'), e, new URL('https://w/members/captcha'));
  const cap: any = await capR.json();
  const answer = e.PUSH_KV.m.get(`members:cap:${cap.id}`);
  const r = await handleMembers(new Request('https://w/members/signup', { method: 'POST', body: JSON.stringify({ username: 'kareem_10', email: 'k@example.com', password: 'raw2026night', captcha: { id: cap.id, answer } }), headers: { 'Content-Type': 'application/json', 'CF-Connecting-IP': '1.2.3.4' } }), e, new URL('https://w/members/signup'));
  return ((await r.json()) as any).token as string;
}
const chat = (e: any, path: string, init: RequestInit = {}) => handleChat(new Request(`https://w${path}`, init), e, new URL(`https://w${path}`));

test('members only: a ticket needs a session; the socket needs a fresh ticket from the site', async () => {
  const e = memberEnv();
  assert.equal((await chat(e, '/chat/ticket', { method: 'POST' })).status, 401);
  const token = await member(e);
  const t: any = await (await chat(e, '/chat/ticket', { method: 'POST', headers: { Authorization: `Bearer ${token}` } })).json();
  assert.match(t.ticket, /^[a-f0-9]{48}$/);
  assert.equal(t.me.badge, ''); // a new member has no blue badge until the owner gives it
  const who = JSON.parse(e.PUSH_KV.m.get(`chat:t:${t.ticket}`));
  assert.equal(who.user, 'kareem_10');
  // no room binding here: the socket can't open, but the checks before it run
  assert.equal((await chat(e, '/chat/ws/nowhere?ticket=' + t.ticket, { headers: { Upgrade: 'websocket' } })).status, 404);
  const rooms: any = await (await chat(e, '/chat/rooms')).json();
  assert.equal(rooms.rooms.length, ROOMS.length);
});

test('uploads: pictures, voice and allowed files only, kept in the room\'s folder; files download, pictures show', async () => {
  const e = memberEnv();
  const token = await member(e);
  const up = (q: string, type: string, body: Uint8Array, name = '') => chat(e, `/chat/upload?${q}`, { method: 'POST', body, headers: { Authorization: `Bearer ${token}`, 'Content-Type': type, 'X-File-Name': encodeURIComponent(name) } });
  const img: any = await (await up('room=wwe&kind=image', 'image/webp', new Uint8Array(500))).json();
  assert.equal(img.ok, true);
  assert.match(img.att.url, /\/chat\/media\/chat\/wwe\/\d{6}\/[a-f0-9]{24}\.webp$/);
  assert.equal((await up('room=wwe&kind=file', 'application/x-msdownload', new Uint8Array(10), 'game.exe')).status, 415);
  assert.equal((await up('room=wwe&kind=image', 'image/svg+xml', new Uint8Array(10))).status, 415);
  assert.equal((await up('room=nowhere&kind=image', 'image/webp', new Uint8Array(10))).status, 400);
  const pdf: any = await (await up('room=aew&kind=file', 'application/pdf', new Uint8Array(900), 'جدول العروض.pdf')).json();
  assert.equal(pdf.att.name, 'جدول العروض.pdf');
  const got = await chat(e, new URL(pdf.att.url).pathname);
  assert.equal(got.status, 200);
  assert.match(got.headers.get('Content-Disposition')!, /^attachment; filename\*=UTF-8''/);
  assert.equal(got.headers.get('X-Content-Type-Options'), 'nosniff');
  const pic = await chat(e, new URL(img.att.url).pathname);
  assert.match(pic.headers.get('Content-Disposition')!, /^inline/);
  const vid: any = await (await up('room=aew&kind=file', 'video/mp4', new Uint8Array(900), 'clip.mp4')).json();
  assert.equal(vid.att.kind, 'video');
});

test('the owner\'s rooms: added, renamed, hidden and closed from the panel; the page\'s list follows; a closed room is read only', async () => {
  const { studioChatRooms } = await import('../worker/src/chat');
  const e = memberEnv();
  const now = await studioChatRooms(e);
  assert.deepEqual(now.rooms.map((r: any) => r.id), [...ROOMS]);
  const list = now.rooms.map((r: any) => r.id === 'wwe' ? { ...r, name: 'دبليو دبليو إي' } : r.id === 'roh' ? { ...r, hidden: true } : r.id === 'njpw' ? { ...r, closed: true } : r);
  list.splice(1, 0, { id: 'aaa2', name: 'AAA والمكسيك', about: 'لوتشا ليبري', mark: 'AAA', hue: 120 });
  assert.equal((await studioChatRooms(e, { rooms: [...list, { id: 'Bad Id', name: 'x' }] })).success, false);
  assert.equal((await studioChatRooms(e, { rooms: [list[0], list[0]] })).success, false);
  assert.equal((await studioChatRooms(e, { rooms: list.map((r: any) => ({ ...r, hidden: true })) })).success, false);
  assert.equal((await studioChatRooms(e, { rooms: list })).success, true);
  const pub: any = await (await chat(e, '/chat/rooms')).json();
  const ids = pub.rooms.map((r: any) => r.id);
  assert.equal(ids[1], 'aaa2');
  assert.ok(!ids.includes('roh'));
  assert.equal(pub.rooms.find((r: any) => r.id === 'wwe').name, 'دبليو دبليو إي');
  assert.equal(pub.rooms.find((r: any) => r.id === 'njpw').closed, true);
  // read only: a member can't write there, the site's account can
  const { join } = room();
  const a = join({ uid: 1, ro: true });
  await a.say({ t: 'send', text: 'رسالة', nonce: 'n1' });
  assert.equal(a.last('error').code, 'readonly');
  const o = join({ uid: 9, name: 'عرب راسلنج', badge: 'gold', mod: true });
  await o.say({ t: 'send', text: 'إعلان', nonce: 'n2' });
  assert.ok(o.last('msg') || o.last('sent') || !o.last('error'));
});
