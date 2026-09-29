// The bell next to the theme button (owner, 2026-09-29: «زر اشعارات لاي حاجة»).
// Two kinds of news in one list, newest first:
//  • what happened on the site (worker: /api/studio/notifications) — a story or show went live,
//    where it was posted, what the spoiler shield held or released, a post that needs a check,
//    a show reel that went out;
//  • what the panel told you on this device — saved, published, appeared on the site, errors
//    (every toast is kept here, so a message that faded away can still be read).
import { html, mount, $, icon, timeAgo } from './ui.js';
import { notifications } from './api.js';

const LOCAL_KEY = 'arw_notif_local';
const SEEN_KEY = 'arw_notif_seen';
const POLL_MS = 60_000;
const KEEP_MS = 48 * 3600_000;

const read = (k, d) => { try { const v = JSON.parse(localStorage.getItem(k) || 'null'); return v ?? d; } catch { return d; } };
const write = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} };

let serverItems = [];
let timer = null;

function localItems() {
  return read(LOCAL_KEY, []).filter(n => n && Date.now() - n.at < KEEP_MS);
}
function addLocal(message, kind) {
  if (!message) return;
  const list = localItems();
  // the same message twice within a few seconds is one event
  if (list[0] && list[0].text === message && Date.now() - list[0].at < 5000) return;
  write(LOCAL_KEY, [{ id: `local:${Date.now()}`, type: 'local', kind, text: message, at: Date.now() }, ...list].slice(0, 60));
  refresh();
}

const PLATFORM = { telegram: 'تيليجرام', facebook: 'فيسبوك', instagram: 'إنستغرام', x: 'إكس' };
const REEL = { facebook_reel: 'ريل فيسبوك', instagram_reel: 'ريل إنستغرام', facebook_story: 'ستوري فيسبوك', instagram_story: 'ستوري إنستغرام' };
const HELD = { result: 'فيه نتيجة', return: 'فيه عودة أو ظهور أول', show: 'حاجة حصلت في عرض لسه متذاع' };
const KIND = { show: 'عرض', recap: 'ملخص', news: 'خبر', nostalgia: 'نوستالجيا' };

/** One notification in the panel's words: an icon, a colour, a line and where a click goes. */
export function describe(n) {
  const t = `«${n.title || ''}»`;
  const edit = n.collection && n.slug ? `#/edit/${n.collection}/${encodeURIComponent(n.slug)}` : '';
  switch (n.type) {
    case 'site': return { ico: n.kind === 'show' ? 'show' : n.kind === 'recap' ? 'recap' : 'news', tone: 'teal', text: `${KIND[n.kind] || 'موضوع'} جديد على الموقع: ${t}${n.platforms && n.platforms.length ? ` — واتنشر على ${n.platforms.map(p => PLATFORM[p] || p).join(' و')}` : ''}`, href: edit };
    case 'social': return { ico: 'send', tone: 'sky', text: `${t} اتنشر على ${n.platforms.map(p => PLATFORM[p] || p).join(' و')}`, href: edit };
    case 'held': return { ico: 'shield', tone: 'yellow', text: `${t} اتحجب عن السوشيال: ${HELD[n.reason] || 'حرق'}`, href: '#/' };
    case 'released': return { ico: 'check', tone: 'teal', text: `${t} اتفك حجبه${n.by ? ` (${n.by})` : ''} وبيتنشر على السوشيال`, href: '#/' };
    case 'review': return { ico: 'alert', tone: 'coral', text: `النشر على ${PLATFORM[n.platform] || n.platform} محتاج مراجعة: ${t}`, href: '#/tools/social' };
    case 'reel': return { ico: 'show', tone: 'coral', text: `ريل ${t} اتنشر: ${n.done.map(d => REEL[d] || d).join('، ')}`, href: '#/tools/reels' };
    default: return { ico: n.kind === 'error' ? 'alert' : n.kind === 'info' ? 'clock' : 'check', tone: n.kind === 'error' ? 'coral' : 'ink', text: n.text || '', href: '' };
  }
}

function allItems() {
  return [...serverItems, ...localItems()].sort((a, b) => b.at - a.at).slice(0, 120);
}
function unread() {
  const seen = Number(read(SEEN_KEY, 0)) || 0;
  return allItems().filter(n => n.at > seen).length;
}

function renderBadge() {
  const b = $('#bell-count');
  if (!b) return;
  const n = unread();
  b.textContent = n > 99 ? '99+' : String(n);
  b.hidden = n === 0;
}

function renderList() {
  const box = $('#bell-list');
  if (!box) return;
  const seen = Number(read(SEEN_KEY, 0)) || 0;
  const items = allItems();
  if (!items.length) {
    mount(box, html`<div class="bell-empty">${icon('bell')}<p>مفيش إشعارات في آخر يومين</p></div>`);
    return;
  }
  mount(box, html`${items.map(n => {
    const d = describe(n);
    const inner = html`<i class="bell-ico tone-${d.tone}">${icon(d.ico)}</i><span class="bell-text"><b>${d.text}</b><small>${timeAgo(n.at)}</small></span>${n.at > seen ? html`<em class="bell-dot"></em>` : ''}`;
    return d.href ? html`<a class="bell-item" href="${d.href}">${inner}</a>` : html`<div class="bell-item">${inner}</div>`;
  })}`);
}

function refresh() { renderBadge(); if ($('#bell-pop') && !$('#bell-pop').hidden) renderList(); }

async function load() {
  try {
    const r = await notifications();
    serverItems = Array.isArray(r.items) ? r.items : [];
  } catch { /* offline: keep what we had */ }
  refresh();
}

/** Wire the bell into the top bar (called after the shell renders). */
export function setupBell() {
  const btn = $('#bell-btn'), pop = $('#bell-pop');
  if (!btn || !pop) return;
  // First time on this device: only the last hour counts as new (not «99+» of two days' history)
  if (read(SEEN_KEY, null) == null) write(SEEN_KEY, Date.now() - 3600_000);
  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    const open = pop.hidden;
    document.querySelectorAll('.menu-pop').forEach(p => { p.hidden = true; });
    pop.hidden = !open;
    if (open) { renderList(); load(); }
  });
  pop.addEventListener('click', (e) => e.stopPropagation());
  $('#bell-read').onclick = () => { write(SEEN_KEY, Date.now()); renderBadge(); renderList(); };
  pop.addEventListener('click', (e) => { if (e.target.closest('a.bell-item')) { pop.hidden = true; } });
  if (timer) clearInterval(timer);
  timer = setInterval(() => { if (!document.hidden) load(); }, POLL_MS);
  load();
}

window.addEventListener('studio:toast', (e) => addLocal(e.detail.message, e.detail.kind));
