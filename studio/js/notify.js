// The bell next to the theme button (owner, 2026-09-29): a professional record of the last
// 12 hours — what you did in the panel and what happened on the site.
//
//  • Panel actions are structured events (notify()), not copies of toasts. A save is ONE
//    notification that follows it to the end: «تمت إضافة العرض «…»» + «جاري الظهور على الموقع…»,
//    then — when /build.json shows it live — «تمت إضافة العرض «…» وظهر على الموقع».
//    Edits and deletions the same way. Input hints («اختار منصة…») never reach the bell.
//  • Site events come from the worker (/api/studio/notifications): a story or show that went
//    live (with the platforms it reached), the spoiler shield, posts needing a check, reels.
//    A story you published yourself is shown once — as your event, with its platforms.
import { html, mount, $, icon, timeAgo } from './ui.js';
import { notifications } from './api.js';
import { COLLECTIONS } from './schema.js';

const LOCAL_KEY = 'arw_notif_events';
const SEEN_KEY = 'arw_notif_seen';
const POLL_MS = 60_000;
export const WINDOW_MS = 12 * 3600_000;

const read = (k, d) => { try { const v = JSON.parse(localStorage.getItem(k) || 'null'); return v ?? d; } catch { return d; } };
const write = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} };

let serverItems = [];
let timer = null;

function localItems() { return read(LOCAL_KEY, []).filter(n => n && Date.now() - n.at < WINDOW_MS); }
function saveLocal(list) { write(LOCAL_KEY, list.filter(n => Date.now() - n.at < WINDOW_MS).slice(0, 80)); }

/**
 * Record a panel event. `type`: create | edit | delete | pinned | held-publish | held-keep |
 * reel | news-request | error. Content events carry `collection`, `slug`, `title` and, when a
 * save produced a commit, `commit` — the bell then shows it as waiting until it is live.
 */
export function notify(ev) {
  const at = Date.now();
  const id = ev.commit ? `c:${ev.commit}` : `e:${at}:${Math.random().toString(36).slice(2, 7)}`;
  saveLocal([{ ...ev, id, at, status: ev.commit ? 'pending' : 'done' }, ...localItems().filter(n => n.id !== id)]);
  refresh();
}
/** A commit reached the live site: its event becomes «… وظهر على الموقع» and counts as new again. */
function markLive(commit) {
  const list = localItems();
  let changed = false;
  for (const n of list) if (n.commit === commit && n.status === 'pending') { n.status = 'live'; n.at = Date.now(); changed = true; }
  if (changed) { saveLocal(list.sort((a, b) => b.at - a.at)); refresh(); }
}
window.addEventListener('studio:live', (e) => { for (const d of e.detail || []) if (d.commit) markLive(d.commit); });

const PLATFORM = { telegram: 'تيليجرام', facebook: 'فيسبوك', instagram: 'إنستغرام', x: 'إكس' };
const REEL = { facebook_reel: 'ريل فيسبوك', instagram_reel: 'ريل إنستغرام', facebook_story: 'ستوري فيسبوك', instagram_story: 'ستوري إنستغرام' };
const HELD = { result: 'فيه نتيجة نزال', return: 'فيه عودة أو ظهور أول', show: 'حاجة حصلت في عرض لسه متذاع' };
const KIND_ICON = { show: 'show', shows: 'show', recap: 'recap', recaps: 'recap', news: 'news', nostalgia: 'nostalgia', nostalgia_series: 'folder' };
const NAME = { shows: 'العرض', show: 'العرض', recaps: 'الملخص', recap: 'الملخص', news: 'الخبر', nostalgia: 'حلقة النوستالجيا', nostalgia_series: 'سلسلة النوستالجيا' };
const singular = (c) => (COLLECTIONS[c] && COLLECTIONS[c].singular) || ({ show: 'عرض', recap: 'ملخص', news: 'خبر' }[c]) || 'موضوع';
const the = (c) => NAME[c] || 'الموضوع';
const q = (t) => `«${t || ''}»`;
const platforms = (list) => (list || []).map(p => PLATFORM[p] || p).join(' · ');

/**
 * One notification in the panel's words: icon, colour, main line, detail line, state chip, link.
 */
export function describe(n) {
  const editHref = n.collection && n.slug ? `#/edit/${n.collection}/${encodeURIComponent(n.slug)}` : '';
  const live = n.status === 'live', pending = n.status === 'pending';
  const chip = pending ? { text: 'جاري الظهور على الموقع…', tone: 'yellow' } : live ? { text: 'ظهر على الموقع', tone: 'teal' } : null;
  switch (n.type) {
    // ── panel ──
    case 'create': return { ico: KIND_ICON[n.collection] || 'plus', tone: 'teal', title: `تمت إضافة ${the(n.collection)} ${q(n.title)}${live ? ' وظهر على الموقع' : ''}`, detail: n.platforms && n.platforms.length ? `اتنشر على ${platforms(n.platforms)}` : '', chip, href: editHref };
    case 'edit': return { ico: 'edit', tone: 'sky', title: `تم تعديل ${the(n.collection)} ${q(n.title)}${live ? ' وظهر التعديل على الموقع' : ''}`, detail: '', chip, href: editHref };
    case 'delete': return { ico: 'trash', tone: 'coral', title: `تم حذف ${the(n.collection)} ${q(n.title)}${live ? ' واختفى من الموقع' : ''}`, detail: '', chip: pending ? { text: 'جاري الحذف من الموقع…', tone: 'yellow' } : live ? { text: 'اختفى من الموقع', tone: 'coral' } : null, href: '' };
    case 'pinned': return { ico: 'pin', tone: 'yellow', title: `تم تحديث المثبت في الرئيسية${live ? ' وظهر على الموقع' : ''}`, detail: n.count ? `${n.count} موضوع مثبت` : '', chip, href: '#/tools/pinned' };
    case 'held-publish': return { ico: 'send', tone: 'teal', title: `تم فك حجب ${q(n.title)}`, detail: 'بيتنشر على تيليجرام وفيسبوك وإنستغرام خلال دقايق', chip: null, href: '#/' };
    case 'held-keep': return { ico: 'shield', tone: 'ink', title: `${q(n.title)} هيفضل بعيد عن السوشيال`, detail: 'بقرار منك', chip: null, href: '#/' };
    case 'reel': return { ico: 'show', tone: 'coral', title: `تم نشر ريل ${q(n.title)}`, detail: n.detail || '', chip: null, href: '#/tools/reels' };
    case 'news-request': return { ico: 'news', tone: 'sky', title: 'تم إرسال الخبر للبوت', detail: 'بيظهر على الموقع خلال ٣ لـ٥ دقايق', chip: null, href: '#/tools/sources' };
    case 'health': return { ico: 'alert', tone: 'coral', title: `حارس الموقع: ${n.title}`, detail: n.detail && !/^https?:/.test(n.detail) ? n.detail : 'مفتوحة لحد ما تتصلح', chip: { text: 'مشكلة مفتوحة', tone: 'coral' }, href: '' };
    case 'error': return { ico: 'alert', tone: 'coral', title: n.title || 'حصلت مشكلة', detail: n.detail || '', chip: null, href: editHref };
    // ── site ──
    case 'site': return { ico: KIND_ICON[n.kind] || 'news', tone: 'teal', title: `${singular(n.kind)} جديد على الموقع: ${q(n.title)}`, detail: n.platforms && n.platforms.length ? `اتنشر على ${platforms(n.platforms)}` : '', chip: null, href: editHref };
    case 'social': return { ico: 'send', tone: 'sky', title: `${q(n.title)} اتنشر على السوشيال`, detail: platforms(n.platforms), chip: null, href: editHref };
    case 'held': return { ico: 'shield', tone: 'yellow', title: `تم حجب ${q(n.title)} عن السوشيال`, detail: `السبب: ${HELD[n.reason] || 'حرق'} · بيتنشر لوحده بعد ٦ ساعات`, chip: null, href: '#/' };
    case 'released': return { ico: 'check', tone: 'teal', title: `تم فك حجب ${q(n.title)}`, detail: n.by ? `بواسطة ${n.by}` : 'بعد ٦ ساعات من الحجب', chip: null, href: '#/' };
    case 'review': return { ico: 'alert', tone: 'coral', title: `النشر على ${PLATFORM[n.platform] || n.platform} محتاج مراجعة`, detail: q(n.title), chip: null, href: '#/tools/social' };
    case 'reel-site': return { ico: 'show', tone: 'coral', title: `تم نشر ريل ${q(n.title)}`, detail: (n.done || []).map(d => REEL[d] || d).join(' · '), chip: null, href: '#/tools/reels' };
    default: return { ico: 'check', tone: 'ink', title: n.title || '', detail: n.detail || '', chip: null, href: '' };
  }
}

/** Newest first; a story you published yourself shows once (your event, with its platforms). */
export function mergeItems(server, local) {
  const out = local.map(n => ({ ...n }));
  const mine = new Map(out.filter(n => n.slug).map(n => [`${n.collection}/${n.slug}`, n]));
  for (const s of server) {
    const item = { ...s, type: s.type === 'reel' ? 'reel-site' : s.type };
    const own = item.slug && mine.get(`${item.collection}/${item.slug}`);
    if (own && item.type === 'site') { if (item.platforms) own.platforms = item.platforms; continue; }
    out.push(item);
  }
  return out.filter(n => n.type === 'health' || Date.now() - n.at < WINDOW_MS).sort((a, b) => b.at - a.at).slice(0, 100);
}

function allItems() { return mergeItems(serverItems, localItems()); }
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

const dayLabel = (t) => {
  const d = new Date(t), today = new Date();
  const y = new Date(); y.setDate(today.getDate() - 1);
  if (d.toDateString() === today.toDateString()) return 'اليوم';
  if (d.toDateString() === y.toDateString()) return 'أمس';
  return d.toLocaleDateString('ar-EG', { day: 'numeric', month: 'long' });
};

function renderList() {
  const box = $('#bell-list');
  if (!box) return;
  const seen = Number(read(SEEN_KEY, 0)) || 0;
  const items = allItems();
  if (!items.length) {
    mount(box, html`<div class="bell-empty">${icon('bell')}<p>مفيش إشعارات في آخر ١٢ ساعة</p></div>`);
    return;
  }
  const groups = [];
  for (const n of items) { const l = dayLabel(n.at); if (!groups.length || groups[groups.length - 1].label !== l) groups.push({ label: l, items: [] }); groups[groups.length - 1].items.push(n); }
  mount(box, html`${groups.map(g => html`<div class="bell-day">${g.label}</div>${g.items.map(n => {
    const d = describe(n);
    const unreadCls = n.at > seen ? ' unread' : '';
    const inner = html`<i class="bell-ico tone-${d.tone}">${icon(d.ico)}</i>
      <span class="bell-text"><b>${d.title}</b>${d.detail ? html`<span class="bell-detail">${d.detail}</span>` : ''}
        <span class="bell-meta">${d.chip ? html`<em class="bell-chip tone-${d.chip.tone}">${d.chip.text}</em>` : ''}<small>${timeAgo(n.at)}</small></span></span>
      ${n.at > seen ? html`<span class="bell-dot" aria-label="جديد"></span>` : ''}`;
    return d.href ? html`<a class="bell-item${unreadCls}" href="${d.href}">${inner}</a>` : html`<div class="bell-item${unreadCls}">${inner}</div>`;
  })}`)}`);
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
  // First time on this device: only the last hour counts as new
  if (read(SEEN_KEY, null) == null) write(SEEN_KEY, Date.now() - 3600_000);
  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    const open = pop.hidden;
    document.querySelectorAll('.menu-pop').forEach(p => { p.hidden = true; });
    pop.hidden = !open;
    if (open) { renderList(); load(); }
  });
  pop.addEventListener('click', (e) => { e.stopPropagation(); if (e.target.closest('a.bell-item')) pop.hidden = true; });
  $('#bell-read').onclick = () => { write(SEEN_KEY, Date.now()); renderBadge(); renderList(); };
  if (timer) clearInterval(timer);
  timer = setInterval(() => { if (!document.hidden) load(); }, POLL_MS);
  load();
}
