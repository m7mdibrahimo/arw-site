// Studio shell: session check, sidebar, top bar, global search and routing.
import { api, getToken, getUser, clearSession, updateUser, siteData, IS_LOCAL } from './api.js';
import { COLLECTIONS } from './schema.js';
import { html, mount, $, $$, icon, toast, dialog, esc, normalizeArabic, debounce } from './ui.js';
import { renderLogin } from './views/auth.js';
import { renderDashboard } from './views/dashboard.js';
import { renderList } from './views/list.js';
import { renderEditor, hasUnsavedChanges, closeEditor } from './views/editor.js';
import { renderSettings } from './views/settings.js';

const root = document.getElementById('app');
const TOOLS = [
  { href: '/admin/publish.html', icon: 'send', title: 'النشر اليدوي', text: 'انشر عرضا أو خبرا على المنصات' },
  { href: '/admin/watcher.html', icon: 'bolt', title: 'سحب الأخبار', text: 'الأخبار التلقائية ومصادرها' },
  { href: '/admin/pinned.html', icon: 'pin', title: 'المواضيع المثبتة', text: 'شريط العروض في الرئيسية' },
  { href: '/admin/reels.html', icon: 'film', title: 'استوديو الريلز', text: 'فيديوهات العروض القصيرة' },
];
export { TOOLS };

// ── Theme (light by default, like the site) ────────────────────────────────
function applyTheme(t) {
  document.documentElement.dataset.theme = t;
  try { localStorage.setItem('arw_studio_theme', t); } catch {}
}
applyTheme((() => { try { return localStorage.getItem('arw_studio_theme') || 'light'; } catch { return 'light'; } })());

// ── Shell: the site's header ───────────────────────────────────────────────
function renderShell(user) {
  mount(root, html`
    ${IS_LOCAL ? html`<div class="local-strip">نسخة تجريبية على جهازك — أي حفظ هنا مش بيوصل للموقع</div>` : ''}
    <header class="topbar">
      <div class="topbar-in">
        <button class="icon-btn only-mobile" id="menu-btn" aria-label="القائمة">${icon('menu')}</button>
        <a class="brand" href="#/"><img src="/assets/brand-logo.png?v=2" alt=""><span><b>لوحة التحكم</b><small>عرب راسلنج</small></span></a>
        <nav class="tabs" id="nav">
          <a class="tab" href="#/" data-nav="#/">${icon('home')}الرئيسية</a>
          <a class="tab" href="#/list/shows" data-nav="#/list/shows">${icon('show')}العروض</a>
          <a class="tab" href="#/list/recaps" data-nav="#/list/recaps">${icon('recap')}الملخصات</a>
          <a class="tab" href="#/list/news" data-nav="#/list/news">${icon('news')}الأخبار</a>
          <a class="tab" href="#/list/nostalgia" data-nav="#/list/nostalgia">${icon('nostalgia')}نوستالجيا</a>
          <div class="menu" id="tools-menu">
            <button class="tab" type="button">${icon('tools')}الأدوات</button>
            <div class="menu-pop" hidden>
              ${TOOLS.map(t => html`<a href="${t.href}" target="_blank">${icon(t.icon)}${t.title}</a>`)}
              <a href="/" target="_blank">${icon('globe')}فتح الموقع</a>
            </div>
          </div>
        </nav>
        <div class="top-actions">
          <div class="search" id="search">
            ${icon('search')}
            <input id="search-input" placeholder="بحث…" autocomplete="off">
            <div class="search-results" id="search-results" hidden></div>
          </div>
          <div class="menu" id="new-menu">
            <button class="btn btn-primary" id="new-btn">${icon('plus')}<span>جديد</span></button>
            <div class="menu-pop end" hidden>
              ${['shows', 'recaps', 'news', 'nostalgia'].map(c => html`<a href="#/new/${c}"><i style="--c:${COLLECTIONS[c].color}">${icon(COLLECTIONS[c].icon)}</i>${COLLECTIONS[c].singular} جديد</a>`)}
            </div>
          </div>
          <button class="icon-btn" id="theme-btn" aria-label="تغيير المظهر">${icon('moon')}</button>
          <div class="menu" id="user-menu">
            <button class="avatar" id="user-btn" aria-label="الحساب">${((user && (user.displayName || user.username)) || 'م')[0].toUpperCase()}</button>
            <div class="menu-pop end" hidden>
              <div class="menu-head"><b>${user ? (user.displayName || user.username) : ''}</b><small>${user ? user.email : ''}</small></div>
              <a href="#/settings">${icon('settings')}الإعدادات والأمان</a>
              <button id="logout-btn" class="danger">${icon('logout')}تسجيل الخروج</button>
            </div>
          </div>
        </div>
      </div>
    </header>
    <main class="page" id="page"></main>`);

  $$('.menu').forEach(m => {
    const btn = m.querySelector('button');
    const pop = m.querySelector('.menu-pop');
    btn.addEventListener('click', (e) => { e.stopPropagation(); const open = pop.hidden; $$('.menu-pop').forEach(p => p.hidden = true); pop.hidden = !open; });
  });
  document.addEventListener('click', () => $$('.menu-pop').forEach(p => p.hidden = true));
  const setThemeIcon = () => { $('#theme-btn').innerHTML = icon(document.documentElement.dataset.theme === 'dark' ? 'sun' : 'moon').__raw; };
  $('#theme-btn').onclick = () => { applyTheme(document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark'); setThemeIcon(); };
  setThemeIcon();
  $('#logout-btn').onclick = async () => {
    try { await api.logout(); } catch {}
    clearSession();
    start('تم تسجيل الخروج.');
  };
  $('#menu-btn').onclick = (e) => { e.stopPropagation(); document.body.classList.toggle('nav-open'); };
  setupSearch();
}

// ── Global search (all content from the site's index + studio data) ───────
let searchPool = null;
async function loadSearchPool() {
  if (searchPool) return searchPool;
  const [index, extra] = await Promise.all([siteData('search-index.json', 300000), siteData('studio-data.json', 300000)]);
  const map = { news: 'news', shows: 'shows', recaps: 'recaps', nostalgia: 'nostalgia', 'nostalgia-series': 'nostalgia_series' };
  const items = [];
  for (const i of index) {
    const m = String(i.inputPath || '').match(/content\/([^/]+)\/(.+)\.md$/);
    if (!m || !map[m[1]]) continue;
    items.push({ collection: map[m[1]], slug: m[2], title: i.headline || i.title, sub: i.headline ? i.title : '', image: i.image, date: i.date, url: i.url });
  }
  for (const s of extra) if (s.collection === 'nostalgia_series') items.push({ collection: 'nostalgia_series', slug: s.slug, title: s.title, sub: s.year, image: s.image, date: s.date, url: s.url });
  items.forEach(it => { it.key = normalizeArabic(`${it.title} ${it.sub}`); });
  searchPool = items;
  return items;
}
function setupSearch() {
  const input = $('#search-input'), box = $('#search-results');
  let sel = -1, results = [];
  const draw = () => {
    if (!results.length) { box.innerHTML = `<div class="empty-sm">مفيش نتايج</div>`; return; }
    box.innerHTML = results.map((r, i) => `<a href="#/edit/${r.collection}/${encodeURIComponent(r.slug)}" class="sr ${i === sel ? 'active' : ''}">
      ${r.image ? `<img src="${esc(r.image)}" alt="" loading="lazy">` : `<span class="sr-noimg"></span>`}
      <span><b>${esc(r.title)}</b><small><i style="--c:${COLLECTIONS[r.collection].color}">${esc(COLLECTIONS[r.collection].singular)}</i> ${esc(r.sub || '')}</small></span></a>`).join('');
  };
  const run = debounce(async () => {
    const q = normalizeArabic(input.value);
    if (!q) { box.hidden = true; return; }
    const pool = await loadSearchPool();
    const words = q.split(/\s+/).filter(Boolean);
    results = pool.filter(p => words.every(w => p.key.includes(w))).sort((a, b) => Date.parse(b.date) - Date.parse(a.date)).slice(0, 12);
    sel = -1; draw(); box.hidden = false;
  }, 150);
  input.addEventListener('input', run);
  input.addEventListener('focus', () => { if (input.value) box.hidden = false; loadSearchPool(); });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown') { sel = Math.min(results.length - 1, sel + 1); draw(); e.preventDefault(); }
    else if (e.key === 'ArrowUp') { sel = Math.max(0, sel - 1); draw(); e.preventDefault(); }
    else if (e.key === 'Enter' && results[Math.max(0, sel)]) { const r = results[Math.max(0, sel)]; location.hash = `#/edit/${r.collection}/${encodeURIComponent(r.slug)}`; box.hidden = true; input.blur(); }
    else if (e.key === 'Escape') { box.hidden = true; input.blur(); }
  });
  box.addEventListener('click', () => { box.hidden = true; input.value = ''; });
  document.addEventListener('click', (e) => { if (!$('#search')?.contains(e.target)) box.hidden = true; });
  document.addEventListener('keydown', (e) => {
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); input.focus(); input.select(); }
  });
}

// ── Router ────────────────────────────────────────────────────────────────
let lastHash = location.hash;
let routeSeq = 0;
async function route() {
  const seq = ++routeSeq;
  const page = $('#page');
  if (!page) return;
  const hash = location.hash || '#/';
  document.body.classList.remove('nav-open');
  $$('.tab[data-nav]').forEach(a => {
    const n = a.dataset.nav;
    a.classList.toggle('active', n === '#/' ? hash === '#/' || hash === '' : hash.startsWith(n) || (n.startsWith('#/list/') && (hash.startsWith(n.replace('#/list/', '#/edit/')) || hash.startsWith(n.replace('#/list/', '#/new/')))));
  });
  window.scrollTo(0, 0);
  const parts = hash.replace(/^#\/?/, '').split('/').map(decodeURIComponent);
  if (!['new', 'edit'].includes(parts[0])) closeEditor();
  try {
    if (!parts[0]) return await renderDashboard(page);
    if (parts[0] === 'list' && COLLECTIONS[parts[1]]) return await renderList(page, parts[1]);
    if (parts[0] === 'new' && COLLECTIONS[parts[1]]) return await renderEditor(page, parts[1], null, { from: parts[2] || null });
    if (parts[0] === 'edit' && COLLECTIONS[parts[1]] && parts[2]) return await renderEditor(page, parts[1], parts.slice(2).join('/'));
    if (parts[0] === 'settings') return await renderSettings(page);
    mount(page, html`<div class="empty"><h2>الصفحة مش موجودة</h2><a class="btn" href="#/">الرئيسية</a></div>`);
  } catch (e) {
    if (seq !== routeSeq) return; // the user already opened another page
    console.error(e);
    mount(page, html`<div class="empty"><h2>حصلت مشكلة</h2><p class="muted">${e.message || e}</p><button class="btn" onclick="location.reload()">تحديث</button></div>`);
  }
}
window.addEventListener('hashchange', async (e) => {
  if (hasUnsavedChanges()) {
    const ok = await dialog({ title: 'في تعديلات لم تحفظ', body: 'لو خرجت دلوقتي التعديلات هتضيع.', confirm: 'اخرج من غير حفظ', danger: true });
    if (!ok) { history.replaceState(null, '', lastHash); return; }
    closeEditor();
  }
  lastHash = location.hash;
  route();
});
window.addEventListener('beforeunload', (e) => { if (hasUnsavedChanges()) { e.preventDefault(); e.returnValue = ''; } });
window.addEventListener('studio:logout', (e) => { toast(e.detail || 'انتهت الجلسة.', 'error'); start(e.detail); });

// ── Start ─────────────────────────────────────────────────────────────────
async function start(reason) {
  document.body.classList.remove('in-app');
  if (!getToken()) return renderLogin(root, { onDone: enter, reason });
  try {
    const me = await api.me();
    if (me.user) updateUser(me.user);
    enter(me.user);
  } catch (e) {
    if (e.status === 401) { clearSession(); return renderLogin(root, { onDone: enter, reason: 'انتهت الجلسة. سجّل الدخول من جديد.' }); }
    // Offline or server down: still open the shell with the saved user
    enter(getUser());
    toast(e.message, 'error', 6000);
  }
}
function enter(user) {
  document.body.classList.add('in-app');
  renderShell(user);
  route();
}
start();
