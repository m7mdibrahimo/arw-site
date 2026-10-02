// Content lists: filters, search, cards/rows, quick actions.
import { content, siteData, pendingSaves, dropSiteCache, trackLive, getUser } from '../api.js';
import { notify } from '../notify.js';
import { COLLECTIONS, FEDERATIONS } from '../schema.js';
import { html, mount, $, $$, icon, toast, dialog, timeAgo, num, normalizeArabic, debounce, can, sectionOf } from '../ui.js';

const PAGE = 15; // the owner's choice: numbered pages of 15, each its own address (#/list/shows/2)
const state = {}; // per collection: { q, fed, page, filter }

function slugFromPath(p) { const m = String(p || '').match(/\/([^/]+)\.md$/); return m ? m[1] : ''; }
function folderOf(p) { const m = String(p || '').match(/content\/([^/]+)\//); return m ? m[1] : ''; }

async function loadItems(collection) {
  const folder = COLLECTIONS[collection].folder.split('/')[1];
  const [index, data] = await Promise.all([siteData('search-index.json'), siteData('studio-data.json')]);
  let items;
  if (collection === 'news') {
    items = index.filter(i => folderOf(i.inputPath) === 'news').map(i => ({
      slug: slugFromPath(i.inputPath), title: i.title, image: i.image, date: i.date, url: i.url, federation: i.federation,
      auto: !!i.source_id, held: !!i.single_match_result, tags: i.tags || [],
    }));
  } else {
    items = data.filter(d => d.collection === collection).map(d => ({ ...d, title: d.headline || d.title, sub: d.headline ? d.title : '' }));
  }
  // Saved here but not built yet
  for (const p of pendingSaves().filter(p => p.collection === collection)) {
    if (!items.some(i => i.slug === p.slug)) items.push({ slug: p.slug, title: p.title, image: p.image, date: new Date(p.at).toISOString(), pending: true, federation: p.federation });
  }
  items.forEach(i => { i.key = normalizeArabic(`${i.title} ${i.sub || ''} ${(i.tags || []).join(' ')} ${i.program_name || ''}`); });
  return items.sort((a, b) => Date.parse(b.date) - Date.parse(a.date));
}

export async function renderList(page, collection, pageNum = 1) {
  const def = COLLECTIONS[collection];
  const st = state[collection] || (state[collection] = { q: '', fed: '', page: 1, filter: '' });
  st.page = Math.max(1, pageNum);
  if (pageNum > 1) window.scrollTo(0, 0);
  mount(page, html`
    <div class="wrap page-in">
      <div class="page-title">
        <div><h1>${def.label}</h1><p class="muted" id="count">جاري التحميل…</p></div>
        <div class="page-actions">
          ${collection === 'nostalgia' ? html`<a class="btn" href="#/list/nostalgia_series">${icon('folder')} السلاسل</a>` : ''}
          ${collection === 'nostalgia_series' ? html`<a class="btn" href="#/list/nostalgia">${icon('nostalgia')} الحلقات</a>` : ''}
          ${can(getUser(), `${sectionOf(collection)}.create`) ? html`<a class="btn btn-primary" href="#/new/${collection}">${icon('plus')} ${def.singular} جديد</a>` : ''}
        </div>
      </div>
      <div class="filterbar">
        <div class="search search-wide">${icon('search')}<input id="q" placeholder="ابحث في ${def.label}…" value="${st.q}"></div>
        ${collection === 'nostalgia' || collection === 'nostalgia_series' ? '' : html`<div class="chips" id="feds">
          <button class="chip ${!st.fed ? 'active' : ''}" data-fed="">الكل</button>
          ${FEDERATIONS.map(f => html`<button class="chip ${st.fed === f ? 'active' : ''}" data-fed="${f}">${f}</button>`)}
        </div>`}
        ${collection === 'news' ? html`<div class="chips" id="filters">
          <button class="chip ${!st.filter ? 'active' : ''}" data-f="">كل الأنواع</button>
          <button class="chip ${st.filter === 'manual' ? 'active' : ''}" data-f="manual">يدوي</button>
          <button class="chip ${st.filter === 'auto' ? 'active' : ''}" data-f="auto">تلقائي</button>
          <button class="chip ${st.filter === 'held' ? 'active' : ''}" data-f="held">محجوب</button>
        </div>` : html`<div class="chips" id="filters">
          <button class="chip ${!st.filter ? 'active' : ''}" data-f="">الكل</button>
          <button class="chip ${st.filter === 'missing' ? 'active' : ''}" data-f="missing">ناقص حاجة</button>
          <button class="chip ${st.filter === 'scheduled' ? 'active' : ''}" data-f="scheduled">مجدول</button>
        </div>`}
      </div>
      <div id="items" class="panel rows"><div class="skel-lines"></div></div>
      <div class="more" id="more"></div>
    </div>
  `);

  let items = await loadItems(collection);
  const now = Date.now();
  const missing = (i) => collection !== 'news' && (!i.image || (['shows', 'recaps', 'nostalgia'].includes(collection) && !i.servers) || (['shows', 'nostalgia'].includes(collection) && !(i.downloads || []).some(Boolean)) || (collection !== 'nostalgia_series' && !i.sub && collection !== 'nostalgia'));

  function filtered() {
    const words = normalizeArabic(st.q).split(/\s+/).filter(Boolean);
    return items.filter(i =>
      (!st.fed || i.federation === st.fed) &&
      words.every(w => i.key.includes(w)) &&
      (!st.filter || (st.filter === 'auto' && i.auto) || (st.filter === 'manual' && !i.auto) || (st.filter === 'held' && i.held) ||
        (st.filter === 'missing' && missing(i)) || (st.filter === 'scheduled' && Date.parse(i.date) > now)));
  }

  // A new search or filter starts again at page 1 (the address follows without reloading the list)
  const firstPage = () => { if (location.hash !== `#/list/${collection}`) history.replaceState(null, '', `#/list/${collection}`); };

  function draw() {
    const list = filtered();
    const pages = Math.max(1, Math.ceil(list.length / PAGE));
    if (st.page > pages) st.page = pages;
    const shown = list.slice((st.page - 1) * PAGE, st.page * PAGE);
    $('#count').textContent = `${num(list.length)} ${list.length === items.length ? '' : `من ${num(items.length)} `}موضوع${pages > 1 ? ` · صفحة ${num(st.page)} من ${num(pages)}` : ''}`;
    const box = $('#items');
    if (!list.length) { mount(box, html`<div class="empty"><h3>مفيش نتايج</h3><p class="muted">جرّب كلمة تانية أو شيل الفلاتر.</p></div>`); $('#more').innerHTML = ''; return; }
    const editUrl = (i) => `#/edit/${collection}/${encodeURIComponent(i.slug)}`;
    // One compact row layout for every section (owner's choice: the news list look)
    const canNext = ['shows', 'recaps', 'nostalgia'].includes(collection);
    const future = (i) => Date.parse(i.date) > Date.now();
    const meta = (i) => collection === 'news'
      ? [timeAgo(i.date), i.federation, i.pending ? 'جاري النشر' : i.auto ? 'تلقائي' : 'يدوي', i.held ? 'محجوب عن المنصات' : '']
      : [timeAgo(i.date), i.federation, i.sub, i.pending ? 'جاري النشر' : future(i) ? 'مجدول' : '', i.maintenance ? 'تحت التعديل' : '', missing(i) ? '⚠ ناقص حاجة' : ''];
    mount(box, html`${shown.map(i => html`<div class="row">
      <a class="row-img" href="${editUrl(i)}">${i.image ? html`<img src="${i.image}" alt="" loading="lazy">` : ''}</a>
      <a class="row-main" href="${editUrl(i)}"><b>${i.title}</b><small>${meta(i).filter(Boolean).join(' · ')}</small></a>
      <span class="row-actions">
        ${i.url ? html`<a class="icon-btn sm" href="${i.url}" target="_blank" title="فتح على الموقع">${icon('eye')}</a>` : ''}
        ${canNext && can(getUser(), `${sectionOf(collection)}.create`) ? html`<a class="icon-btn sm" href="#/new/${collection}/${encodeURIComponent(i.slug)}" title="حلقة جديدة بنفس البيانات">${icon('copy')}</a>` : ''}
        <a class="icon-btn sm" href="${editUrl(i)}" title="تعديل">${icon('edit')}</a>
        ${can(getUser(), `${sectionOf(collection)}.delete`) ? html`<button class="icon-btn sm danger" data-del="${i.slug}" title="حذف">${icon('trash')}</button>` : ''}
      </span></div>`)}`);
    // Numbered pages: 1 … around the current one … last. Each is its own address in the panel.
    const at = (n) => `#/list/${collection}${n > 1 ? `/${n}` : ''}`;
    const nums = [...new Set([1, pages, st.page - 2, st.page - 1, st.page, st.page + 1, st.page + 2])].filter(n => n >= 1 && n <= pages).sort((a, b) => a - b);
    const links = [];
    nums.forEach((n, i) => {
      if (i && n - nums[i - 1] > 1) links.push('<span class="pager-gap">…</span>');
      links.push(n === st.page ? `<span class="pager-num on" aria-current="page">${num(n)}</span>` : `<a class="pager-num" href="${at(n)}">${num(n)}</a>`);
    });
    $('#more').innerHTML = pages > 1 ? `<nav class="pager" aria-label="الصفحات">
      ${st.page > 1 ? `<a class="pager-step" href="${at(st.page - 1)}">→ السابقة</a>` : '<span class="pager-step off">→ السابقة</span>'}
      ${links.join('')}
      ${st.page < pages ? `<a class="pager-step" href="${at(st.page + 1)}">التالية ←</a>` : '<span class="pager-step off">التالية ←</span>'}
    </nav>` : '';
    $$('[data-del]', box).forEach(b => b.onclick = () => del(b.dataset.del));
  }

  async function del(slug) {
    const item = items.find(i => i.slug === slug);
    const ok = await dialog({
      title: `حذف ${def.singular} نهائيا`,
      body: html`<p>«${item ? item.title : slug}» هيتشال من الموقع. الحذف مش بيترجع من هنا.</p><p class="muted small">للتأكيد اكتب كلمة <b>حذف</b>:</p>`,
      confirm: 'حذف نهائي', danger: true, input: { placeholder: 'حذف', match: 'حذف' },
    });
    if (!ok) return;
    try {
      const r = await content.remove(collection, slug);
      trackLive({ commit: r.commit, committedAt: r.committedAt, title: item ? item.title : slug, slug, removed: true });
      notify({ type: 'delete', collection, slug, title: item ? item.title : slug, commit: r.commit });
      items = items.filter(i => i.slug !== slug);
      toast('اتحذف. هقولك أول ما يختفي من الموقع.');
      draw();
    } catch (e) { toast(e.message, 'error'); }
  }

  $('#q').addEventListener('input', debounce(e => { st.q = e.target.value; st.page = 1; firstPage(); draw(); }, 120));
  $$('#feds .chip').forEach(b => b.onclick = () => { st.fed = b.dataset.fed; st.page = 1; firstPage(); $$('#feds .chip').forEach(x => x.classList.toggle('active', x === b)); draw(); });
  $$('#filters .chip').forEach(b => b.onclick = () => { st.filter = b.dataset.f; st.page = 1; firstPage(); $$('#filters .chip').forEach(x => x.classList.toggle('active', x === b)); draw(); });
  draw();
}
