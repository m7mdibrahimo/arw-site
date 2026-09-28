// Home, in the site's own layout: hero, quick numbers, then simple sections.
import { api, siteData, pendingSaves, getUser, IS_LOCAL } from '../api.js';
import { COLLECTIONS } from '../schema.js';
import { html, mount, $, icon, timeAgo, fmtDate, num, can } from '../ui.js';
import { renderAnalytics } from './analytics.js';
import { renderHeld } from './held.js';

const PLATFORMS = [
  { key: 'telegram', name: 'تيليجرام', icon: 'telegram', color: '#24a1de' },
  { key: 'facebook', name: 'فيسبوك', icon: 'facebook', color: '#1877f2' },
  { key: 'instagram', name: 'إنستجرام', icon: 'instagram', color: '#e1306c' },
];
const sameDay = (a, b = new Date()) => a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
function editHref(item) {
  const map = { news: 'news', shows: 'shows', recaps: 'recaps', nostalgia: 'nostalgia', 'nostalgia-series': 'nostalgia_series' };
  const m = String(item.inputPath || '').match(/content\/([^/]+)\/(.+)\.md$/);
  return m && map[m[1]] ? `#/edit/${map[m[1]]}/${encodeURIComponent(m[2])}` : null;
}

export function showCard(s, collection = 'shows') {
  const edit = `#/edit/${collection}/${encodeURIComponent(s.slug)}`;
  const future = Date.parse(s.date) > Date.now();
  return html`<article class="tile ${s.pending ? 'is-pending' : ''}">
    <a class="tile-img" href="${edit}">${s.image ? html`<img src="${s.image}" alt="" loading="lazy">` : html`<span>${icon('image')}</span>`}
      ${s.pending ? html`<em class="flag flag-sky">جاري النشر</em>` : future ? html`<em class="flag flag-sky">مجدول</em>` : s.maintenance ? html`<em class="flag flag-gold">تحت التعديل</em>` : ''}</a>
    <div class="tile-body">
      <a href="${edit}" class="tile-title">${s.title}</a>
      <small class="muted">${[s.federation, s.sub].filter(Boolean).join(' · ')}</small>
      <div class="tile-foot"><span class="muted small">${timeAgo(s.date)}</span>
        <span class="tile-actions">
          ${s.url ? html`<a class="icon-btn sm" href="${s.url}" target="_blank" title="فتح على الموقع">${icon('eye')}</a>` : ''}
          ${['shows', 'recaps', 'nostalgia'].includes(collection) && !s.pending ? html`<a class="icon-btn sm" href="#/new/${collection}/${encodeURIComponent(s.slug)}" title="حلقة جديدة بنفس البيانات">${icon('copy')}</a>` : ''}
          <a class="icon-btn sm" href="${edit}" title="تعديل">${icon('edit')}</a>
        </span></div>
    </div>
  </article>`;
}

export async function renderDashboard(page) {
  const user = getUser();
  const hour = new Date().getHours();
  const greet = hour < 12 ? 'صباح الخير' : 'مساء الخير';
  mount(page, html`<div class="loading-page"><div class="spinner"></div></div>`);

  const [index, data] = await Promise.all([siteData('search-index.json'), siteData('studio-data.json')]);
  const byDate = (a, b) => Date.parse(b.date) - Date.parse(a.date);
  const now = new Date();
  const news = index.filter(i => i.kind === 'news').sort(byDate);
  const shows = data.filter(d => d.collection === 'shows').sort(byDate);
  const recaps = data.filter(d => d.collection === 'recaps');
  const nostalgia = data.filter(d => d.collection === 'nostalgia');
  const todayNews = news.filter(n => sameDay(new Date(n.date)));
  const todayShows = shows.filter(s => sameDay(new Date(s.date)));
  const pending = pendingSaves().filter(p => !index.some(i => String(i.inputPath || '').endsWith(`/${p.slug}.md`)) && !data.some(d => d.slug === p.slug));
  const heroImg = shows[0] && shows[0].image ? `url('${shows[0].image}')` : '';

  // What needs the owner — only shown when there is something
  const attention = [];
  for (const s of shows.slice(0, 40)) {
    const miss = [];
    if (!s.servers) miss.push('سيرفرات المشاهدة');
    if (!s.downloads.some(Boolean)) miss.push('روابط التحميل');
    if (!s.image) miss.push('الصورة');
    if (!s.headline) miss.push('العنوان العربي');
    if (miss.length) attention.push({ href: `#/edit/shows/${encodeURIComponent(s.slug)}`, title: s.headline || s.title, text: `ناقص: ${miss.join('، ')}`, kind: 'warn' });
    if (s.maintenance) attention.push({ href: `#/edit/shows/${encodeURIComponent(s.slug)}`, title: s.headline || s.title, text: 'رسالة «العرض تحت التعديل» ظاهرة للزوار', kind: 'info' });
  }
  for (const s of data.filter(d => new Date(d.date) > now)) attention.push({ href: `#/edit/${s.collection}/${encodeURIComponent(s.slug)}`, title: s.headline || s.title, text: `مجدول — هيظهر ${timeAgo(s.date)}`, kind: 'sched' });
  for (const p of pending) attention.push({ href: `#/edit/${p.collection}/${encodeURIComponent(p.slug)}`, title: p.title, text: 'اتحفظ — بيتجهز على الموقع دلوقتي', kind: 'sched' });

  const mayEdit = (href) => { const m = href.match(/#\/edit\/([a-z_]+)/); return !m || can(user, `${m[1] === 'nostalgia_series' ? 'nostalgia' : m[1]}.edit`); };
  for (let i = attention.length - 1; i >= 0; i--) if (!mayEdit(attention[i].href)) attention.splice(i, 1);

  const summary = [
    todayShows.length ? `${num(todayShows.length)} عرض` : '',
    todayNews.length ? `${num(todayNews.length)} خبر` : '',
  ].filter(Boolean).join(' و');

  mount(page, html`
    <div class="wrap page-in">
      <div class="page-title hello">
        <div><h1>أهلا يا <span>${user ? (user.displayName || user.username) : ''}</span>،<br>${summary ? `النهارده نزل ${summary}.` : 'لسه مفيش جديد النهارده.'}</h1>
          <p class="muted">${greet} · ${fmtDate(now)}</p></div>
        <div class="page-actions">
          ${can(user, 'shows.create') ? html`<a class="btn btn-primary" href="#/new/shows">${icon('plus')} عرض جديد</a>` : ''}
          ${can(user, 'recaps.create') ? html`<a class="btn" href="#/new/recaps">${icon('recap')} ملخص</a>` : ''}
          ${can(user, 'news.create') ? html`<a class="btn" href="#/new/news">${icon('news')} خبر</a>` : ''}
        </div>
      </div>

      ${can(user, 'tools') ? html`<div id="held"></div>` : ''}
      ${can(user, 'stats') ? html`<div id="analytics"></div>` : ''}

      ${attention.length ? html`<details class="notice">
        <summary>${icon('alert')}<b>في ${num(attention.length)} حاجة محتاجة انتباهك</b><span class="muted">عرض التفاصيل</span></summary>
        <div class="notice-list">${attention.slice(0, 10).map(a => html`
          <a class="notice-row" href="${a.href}"><span class="dot ${a.kind === 'warn' ? 'warn' : a.kind === 'info' ? 'bad' : 'ok'}"></span><b>${a.title}</b><small>${a.text}</small></a>`)}</div>
      </details>` : ''}

      <div class="stats">
        ${[['shows', 'العروض', shows.length, `${num(shows.filter(s => now - new Date(s.date) < 7 * 864e5).length)} في آخر أسبوع`],
           ['recaps', 'الملخصات', recaps.length, ''],
           ['news', 'الأخبار', news.length, `${num(todayNews.length)} النهارده`],
           ['nostalgia', 'نوستالجيا', nostalgia.length, '']].filter(([c]) => can(user, `${c}.view`)).map(([c, label, n, sub]) => html`
          <a class="stat" href="#/list/${c}" style="--c:${COLLECTIONS[c].color}">
            <i>${icon(COLLECTIONS[c].icon)}</i><span><small>${label}</small><b>${num(n)}</b>${sub ? html`<em>${sub}</em>` : ''}</span>
          </a>`)}
      </div>

      <div class="cols">
        ${can(user, 'shows.view') ? html`<section class="panel">
          <header class="panel-head"><h2>آخر العروض</h2><a class="link" href="#/list/shows">الكل</a></header>
          <div class="rows">${shows.slice(0, 7).map(s => html`
            <a class="row" href="#/edit/shows/${encodeURIComponent(s.slug)}">
              <span class="row-img">${s.image ? html`<img src="${s.image}" alt="" loading="lazy">` : ''}</span>
              <span class="row-main"><b>${s.headline || s.title}</b><small>${s.federation} · ${timeAgo(s.date)}${Date.parse(s.date) > Date.now() ? ' · مجدول' : ''}</small></span>
              <span class="row-go">${icon('edit')}</span>
            </a>`)}</div>
        </section>` : ''}
        ${can(user, 'news.view') ? html`<section class="panel">
          <header class="panel-head"><h2>آخر الأخبار</h2><a class="link" href="#/list/news">الكل</a></header>
          <div class="rows" id="latest-news"></div>
        </section>` : ''}
      </div>

      ${can(user, 'status') ? html`<section class="panel">
        <header class="panel-head"><h2>حالة الموقع</h2><span class="muted small">النشر على المنصات ومصادر الأخبار</span></header>
        <div class="health" id="status"><div class="skel-lines" style="height:70px"></div></div>
      </section>` : ''}
    </div>
  `);

  if ($('#held')) renderHeld($('#held'));
  if ($('#analytics')) renderAnalytics($('#analytics'));
  const latest = news.slice(0, 6);
  const drawNews = (items = {}) => $('#latest-news') && mount($('#latest-news'), html`${latest.map(n => {
    const st = items[n.url] || {};
    const edit = editHref(n) || n.url;
    return html`<a class="row" href="${edit}">
      <span class="row-img">${n.image ? html`<img src="${n.image}" alt="" loading="lazy">` : ''}</span>
      <span class="row-main"><b>${n.title}</b><small>${timeAgo(n.date)} · ${n.source_id ? 'تلقائي' : 'يدوي'}${n.single_match_result ? ' · محجوب عن المنصات' : ''}</small></span>
      <span class="plat-dots">${PLATFORMS.map(p => html`<i class="${st[p.key] ? 'on' : ''}" style="--c:${p.color}" title="${p.name}">${icon(p.icon)}</i>`)}</span>
    </a>`;
  })}`);
  drawNews();
  if (!$('#status')) return;

  try {
    const ov = await api.overview(latest.map(n => n.url));
    drawNews(ov.items || {});
    const ig = ov.instagram;
    mount($('#status'), html`
      ${PLATFORMS.map(p => {
        const s = ov.platforms[p.key] || {};
        return html`<div class="h-item" style="--c:${p.color}"><i>${icon(p.icon)}</i><span><b>${p.name}</b><small>${num(s.last24h)} منشور في 24 ساعة · ${s.last ? `آخر نشر ${timeAgo(s.last)}` : 'مفيش نشر'}</small></span></div>`;
      })}
      ${ov.sources.map(s => {
        const t = s.lastChecked ? Date.parse(s.lastChecked) : 0;
        const fresh = t && Date.now() - t < 45 * 60000;
        return html`<div class="h-item" style="--c:#0e9594"><i>${icon('bolt')}</i><span><b>${s.name} <span class="dot ${fresh ? 'ok' : t ? 'warn' : 'bad'}"></span></b><small>${t ? `آخر فحص ${timeAgo(t)}` : 'مفيش بيانات'}</small></span></div>`;
      })}
      ${ig && ig.quota ? html`<div class="h-item" style="--c:#e1306c"><i>${icon('chart')}</i><span><b>حصة إنستجرام</b><small>${num(ig.used24h)} من ${num(ig.cap)} في آخر 24 ساعة</small></span></div>` : ''}`);
  } catch (e) {
    mount($('#status'), html`<p class="muted center">${IS_LOCAL ? 'حالة النشر بتظهر لما اللوحة تشتغل على الموقع.' : e.message}</p>`);
  }
}
