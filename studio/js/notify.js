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
  if (ev.commit && !settleTimer) settleTimer = setTimeout(settlePending, 15_000);
}
/** A commit reached the live site: its event becomes «… وظهر على الموقع» and counts as new again — only when it went
 *  live while the panel was watching. A save found live hours later (the panel was closed meanwhile) keeps its own
 *  time and stays read: before, a 3 a.m. edit showed up at 1 p.m. as a new «منذ 1 دقيقة» notification (INCIDENTS #417). */
export const FRESH_MS = 30 * 60_000;
export function settleItem(n, now = Date.now()) {
  n.status = 'live';
  if (now - n.at < FRESH_MS) n.at = now;
  return n;
}
function markLive(commit) {
  const list = localItems();
  let changed = false;
  for (const n of list) if (n.commit === commit && n.status === 'pending') { settleItem(n); changed = true; }
  if (changed) { saveLocal(list.sort((a, b) => b.at - a.at)); refresh(); }
}
window.addEventListener('studio:live', (e) => { for (const d of e.detail || []) if (d.commit) markLive(d.commit); });

const PLATFORM = { telegram: 'تيليجرام', facebook: 'فيسبوك', instagram: 'إنستغرام', x: 'إكس' };
const REEL = { facebook_reel: 'ريل فيسبوك', instagram_reel: 'ريل إنستغرام', facebook_story: 'ستوري فيسبوك', instagram_story: 'ستوري إنستغرام' };
const HELD = { result: 'فيه نتيجة نزال', return: 'فيه عودة أو ظهور أول', show: 'حاجة حصلت في عرض لسه متذاع' };
const ENC = {
  download: { ico: 'check', tone: 'teal', ok: 'خلص تحميل العرض', fail: 'فشل تحميل العرض', named: true },
  subs: { ico: 'film', tone: 'teal', ok: 'الترجمة الإنجليزي جاهزة للعرض', fail: 'فشل تفريغ العرض', named: true, detail: 'نزّلها من «سيرفر التفريغ» وترجمها' },
  merge: { ico: 'show', tone: 'teal', ok: 'خلص دمج العرض', fail: 'فشل دمج العرض', named: true },
  upload: { ico: 'send', tone: 'teal', ok: 'اترفع العرض', fail: 'فشل رفع العرض', named: true },
  'subs-start': { ico: 'film', tone: 'sky', ok: 'بدأ تفريغ العرض', named: true },
  'merge-start': { ico: 'show', tone: 'sky', ok: 'بدأ دمج العرض', named: true },
  novideo: { ico: 'alert', tone: 'coral', ok: 'الترجمة العربي وصلت بس فيديو العرض مش على السيرفر:', named: true, detail: 'ارفع الفيديو من «سيرفر التفريغ» والدمج هيبدأ لوحده' },
  cancelled: { ico: 'shield', tone: 'ink', ok: 'وقفت العرض', named: true, detail: 'بقرار منك' },
  drive: { ico: 'folder', tone: 'sky', ok: 'العرض وصل على جوجل درايف', named: true },
  waiting: { ico: 'clock', tone: 'yellow', ok: 'جهاز التفريغ مشغول مع حد تاني', detail: 'بحاول عليه كل دقيقتين، وأول ما يفضى هيشتغل لوحده' },
  freed: { ico: 'check', tone: 'teal', ok: 'جهاز التفريغ فضي وبيشتغل دلوقتي', detail: 'خلال دقيقة هيبان «شغال»' },
  'wait-timeout': { ico: 'alert', tone: 'coral', ok: 'جهاز التفريغ فضل مشغول يوم كامل', detail: 'بطّلت أستنى — شغّله تاني أو خد أقرب جهاز' },
  online: { ico: 'check', tone: 'teal', ok: 'سيرفر التفريغ اشتغل', detail: 'جاهز للشغل' },
  start: { ico: 'check', tone: 'sky', ok: 'طلبت تشغيل سيرفر التفريغ', detail: 'هيبان «شغال» خلال دقيقة' },
  rented: { ico: 'alert', tone: 'yellow', ok: 'اتأجر جهاز تفريغ جديد', named: true, detail: 'الكارت القديم كان متاخد — هيركّب نفسه في حوالي ١٠ دقايق' },
  stop: { ico: 'shield', tone: 'ink', ok: 'طلبت قفل سيرفر التفريغ', detail: 'مش هيتحسب غير تمن المساحة' },
  idle: { ico: 'shield', tone: 'ink', ok: 'سيرفر التفريغ خلّص كل الشغل وهيقفل نفسه', detail: 'بعد ساعة من غير شغل' },
  offline: { ico: 'alert', tone: 'yellow', ok: 'سيرفر التفريغ اتقفل', detail: 'مبقاش بيرد على اللوحة' },
  deleted: { ico: 'trash', tone: 'coral', ok: 'اتمسح جهاز التفريغ بعد ١٢ ساعة وهو مقفول', detail: 'شغلك على درايف — «شغّل السيرفر» هيأجر جهاز جديد' },
  other: { ico: 'check', tone: 'ink', ok: 'سيرفر التفريغ', fail: 'مشكلة في سيرفر التفريغ', named: true },
};
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
    case 'held': return { ico: 'shield', tone: 'yellow', title: `تم حجب ${q(n.title)} عن السوشيال`, detail: `السبب: ${HELD[n.reason] || 'حرق'} · بيتنشر لوحده بعد ١٢ ساعة`, chip: null, href: '#/' };
    case 'released': return { ico: 'check', tone: 'teal', title: `تم فك حجب ${q(n.title)}`, detail: n.by ? `بواسطة ${n.by}` : 'بعد ١٢ ساعة من الحجب', chip: null, href: '#/' };
    case 'review': return { ico: 'alert', tone: 'coral', title: `النشر على ${PLATFORM[n.platform] || n.platform} محتاج مراجعة`, detail: q(n.title), chip: null, href: '#/tools/social' };
    // a visitor's comment (worker: /api/studio/notifications): on the site already
    case 'comment': return { ico: 'comment', tone: 'teal', title: `تعليق جديد من ${n.name || 'زائر'} على ${q(n.title)}`, detail: String(n.text || '').length > 110 ? `${String(n.text).slice(0, 110)}…` : String(n.text || ''), chip: null, href: '#/comments' };
    // «العضوية المميزة» (worker/src/premium.ts): a new subscriber, a translation request
    case 'premium-pay': if (n.by === 'trial') return { ico: 'crown', tone: 'yellow', title: `${n.name || 'عضو'} بدأ التجربة المجانية للعضوية المميزة`, detail: `${n.days} أيام مجانا`, chip: null, href: '#/premium' };
      if (/^paid:/.test(n.by || '')) return { ico: 'crown', tone: 'yellow', title: `${n.by.slice(5)} فعّل العضوية المميزة لـ${n.name || 'عضو'}`, detail: `اشتراك مدفوع${n.amount ? ` · ${n.currency === 'USD' ? `$${n.amount}` : `${n.amount} جنيه`}` : ''} · ${n.days} يوم`, chip: null, href: '#/premium' };
      return { ico: 'crown', tone: 'yellow', title: n.by ? `${n.by} فعّل العضوية المميزة لـ${n.name || 'عضو'}` : `مشترك جديد في العضوية المميزة: ${n.name || 'عضو'}`, detail: n.by ? `هدية · ${n.days} يوم` : `دفع ${n.currency === 'USD' ? `$${n.amount}` : `${n.amount} جنيه`} · اتفعّلت لوحدها`, chip: n.by ? null : { text: 'فلوس وصلت', tone: 'teal' }, href: '#/premium' };
    case 'premium-req': return { ico: 'film', tone: 'sky', title: `طلب ترجمة من ${n.name || 'عضو مميز'}`, detail: String(n.text || '').length > 110 ? `${String(n.text).slice(0, 110)}…` : String(n.text || ''), chip: { text: 'مستني ردك', tone: 'yellow' }, href: '#/premium' };
    // «سيرفر التفريغ» (worker: enc_jobs + enc_events)
    case 'enc': { const e = ENC[n.step] || ENC.other; const name = n.name ? ` ${q(n.name)}` : '';
      return n.ok ? { ico: e.ico, tone: e.tone, title: `${e.ok}${e.named ? name : ''}`, detail: e.detail || '', chip: null, href: '#/tools/server' }
        : { ico: 'alert', tone: 'coral', title: `${e.fail}${name}`, detail: 'افتح «سيرفر التفريغ» وجرّب تاني', chip: { text: 'محتاج تدخل', tone: 'coral' }, href: '#/tools/server' }; }
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
// A notification still «جاري الظهور على الموقع» is settled from /build.json itself, whatever the save tracking
// remembers: the live build is of a commit made after the save, so the save is in it (INCIDENTS #367). Checked when
// the panel opens and every 15 seconds while one is waiting.
// It also runs whenever the bell is opened and whenever the panel comes back to the screen, and it reads the site's
// address in full: «تم تحديث المثبت في الرئيسية» stayed «جاري الظهور على الموقع…» for three hours (owner 2026-10-18)
// because nothing asked again once the waiting timer had stopped. A save still unconfirmed after STALE_MS isn't
// waiting for anything any more: it loses the chip instead of saying «جاري» for good.
const BUILD_URL = /(^|\.)arab-wrestling\.com$/.test(location.hostname) ? '/build.json' : 'https://arab-wrestling.com/build.json';
export const STALE_MS = 2 * 3600_000;
let settleTimer = null;
/** Has the live build `b` this save `n` in it? (its commit, or a build of a later commit, or built after it) */
export function inBuild(b, n) {
  if (!b || !n) return false;
  return (b.recent || []).includes(n.commit) || b.commit === n.commit || !!(b.commitTime && b.commitTime * 1000 > n.at + 5000)
    || !!(b.builtAt && Date.parse(b.builtAt) > n.at + 60_000);
}
async function settlePending() {
  if (settleTimer) { clearTimeout(settleTimer); settleTimer = null; }
  const waiting = localItems().filter(n => n.status === 'pending' && n.commit);
  if (!waiting.length) return;
  try {
    const b = await fetch(`${BUILD_URL}?_=${Date.now()}`, { cache: 'no-store' }).then(r => (r.ok ? r.json() : null));
    if (b) for (const n of waiting.filter(n => inBuild(b, n))) markLive(n.commit);
  } catch {}
  // nothing settled it in two hours: no more «جاري…»
  const list = localItems();
  let stale = false;
  for (const n of list) if (n.status === 'pending' && Date.now() - n.at > STALE_MS) { n.status = 'done'; stale = true; }
  if (stale) { saveLocal(list); refresh(); }
  if (localItems().some(n => n.status === 'pending' && n.commit)) settleTimer = setTimeout(settlePending, 15_000);
}

export function setupBell() {
  const btn = $('#bell-btn'), pop = $('#bell-pop');
  if (!btn || !pop) return;
  if (!settleTimer) settlePending();
  // First time on this device: only the last hour counts as new
  if (read(SEEN_KEY, null) == null) write(SEEN_KEY, Date.now() - 3600_000);
  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    const open = pop.hidden;
    document.querySelectorAll('.menu-pop').forEach(p => { p.hidden = true; });
    pop.hidden = !open;
    if (open) { renderList(); load(); settlePending(); }
  });
  pop.addEventListener('click', (e) => { e.stopPropagation(); if (e.target.closest('a.bell-item')) pop.hidden = true; });
  $('#bell-read').onclick = () => { write(SEEN_KEY, Date.now()); renderBadge(); renderList(); };
  if (timer) clearInterval(timer);
  timer = setInterval(() => { if (!document.hidden) load(); }, POLL_MS);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) settlePending(); });
  load();
}
