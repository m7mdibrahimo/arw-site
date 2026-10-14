// Visitors' comments (owner 2026-10-14): every comment left under a show, a recap or a story. A comment is on the site
// the moment it is sent (owner: «عايزها تتنشر علطول»); here the owner reads them all and deletes what shouldn't stay.
// The comments since the owner last looked are marked «جديد» and counted on the tab; each new one also reaches the bell.
import { api, siteData } from '../api.js';
import { html, mount, $, $$, icon, toast, dialog, timeAgo, num, normalizeArabic, debounce } from '../ui.js';

const KIND = { news: ['خبر', '#ff5a36'], shows: ['عرض', '#0e9594'], recaps: ['ملخص', '#d98b12'], nostalgia: ['نوستالجيا', '#2b8fd6'] };
const COLORS = ['#0e9594', '#ff5a36', '#d98b12', '#7c6ee8', '#2b8fd6', '#c73b2c', '#2f9e5b'];
const colorOf = (name) => { let h = 0; for (const ch of String(name)) h = (h * 31 + ch.charCodeAt(0)) >>> 0; return COLORS[h % COLORS.length]; };
const initial = (name) => (String(name).trim().replace(/^ال(?=\S{2})/, '').match(/\S/) || ['؟'])[0].toUpperCase();
// a comment's picture: «w:<slug>» a wrestler's from the site, or the address of the visitor's own
const picSrc = (pic) => { pic = String(pic || ''); return /^w:[a-z0-9-]+$/.test(pic) ? `/assets/avatars/${pic.slice(2)}.webp` : /^https:\/\//.test(pic) ? pic : ''; };
const pathKey = (u) => { let p = String(u || ''); try { p = decodeURIComponent(p); } catch {} p = p.split(/[?#]/)[0].normalize('NFC'); return p.endsWith('/') ? p : `${p}/`; };

// When the owner last opened the comments page on this device: what came after is «جديد»
const SEEN_KEY = 'arw_comments_seen';
const seenAt = () => { try { return Number(localStorage.getItem(SEEN_KEY)) || 0; } catch { return 0; } };
const markSeen = () => { try { localStorage.setItem(SEEN_KEY, String(Date.now())); } catch {} };

/** Which show or story each comment is under: its title and kind from the site's own index */
async function topics() {
  const index = await siteData('search-index.json').catch(() => []);
  const map = new Map();
  for (const i of index) {
    const m = String(i.inputPath || '').match(/content\/([^/]+)\//);
    map.set(pathKey(i.url), { title: i.headline || i.title, kind: m ? m[1] : '', url: i.url });
  }
  return map;
}
const topicOf = (map, c) => map.get(pathKey(c.path)) || { title: c.title || pathKey(c.path), kind: /^\/news\//.test(c.path) ? 'news' : '', url: c.path };

function row(c, t, seen, { compact = false } = {}) {
  const kind = KIND[t.kind];
  const fresh = c.at > seen;
  return html`<article class="cm-row ${fresh ? 'is-new' : ''} ${compact ? 'is-compact' : ''}" data-id="${c.id}">
    <span class="cm-av" style="--c:${colorOf(c.name)}" aria-hidden="true">${picSrc(c.pic) ? html`<img src="${picSrc(c.pic)}" alt="" loading="lazy">` : initial(c.name)}</span>
    <div class="cm-main">
      <div class="cm-meta"><b>${c.name}</b><span class="muted">${timeAgo(c.at)}</span>${fresh ? html`<em class="cm-flag">جديد</em>` : ''}</div>
      <p class="cm-text">${c.text}</p>
      <a class="cm-topic" href="${t.url}#comments" target="_blank" rel="noopener" title="افتح التعليق على الموقع">
        ${kind ? html`<i style="--c:${kind[1]}">${kind[0]}</i>` : ''}<span>${t.title}</span></a>
    </div>
    <div class="cm-actions">
      <a class="icon-btn sm" href="${t.url}#comments" target="_blank" rel="noopener" title="افتح على الموقع">${icon('eye')}</a>
      <button class="icon-btn sm cm-del" data-delete="${c.id}" title="احذف التعليق من الموقع">${icon('trash')}</button>
    </div>
  </article>`;
}

/** The delete buttons inside `el`; `again()` draws the page or the box afresh */
function wire(el, items, again) {
  $$('[data-delete]', el).forEach(b => b.onclick = async () => {
    const c = items.find(x => String(x.id) === b.dataset.delete);
    const ok = await dialog({
      title: 'حذف التعليق',
      body: html`<div class="post-preview"><b>${c.name}</b><p>${c.text.length > 220 ? `${c.text.slice(0, 220)}…` : c.text}</p></div>
        <p class="muted small">التعليق هيختفي من الموقع على طول، ومش هينفع يرجع.</p>`,
      confirm: 'احذفه', danger: true,
    });
    if (!ok) return;
    b.disabled = true;
    try { await api.commentAction('delete', [c.id]); toast('اتحذف من الموقع ✓'); again(); }
    catch (e) { toast(e.message, 'error'); b.disabled = false; }
  });
}

/** The number of new comments on the «التعليقات» tab in the top bar */
export function showNew(n) {
  const el = document.getElementById('cm-count');
  if (!el) return;
  el.hidden = !n;
  el.textContent = n ? (n > 99 ? '99+' : num(n)) : '';
}
export async function refreshNew() {
  try { const seen = seenAt(); showNew(((await api.comments()).items || []).filter(c => c.at > seen).length); } catch {}
}

const FILTERS = [['', 'الكل'], ['new', 'الجديدة'], ['news', 'على الأخبار'], ['shows', 'على العروض والملخصات']];
const state = { filter: '', q: '' };

export async function renderComments(page) {
  mount(page, html`<div class="loading-page"><div class="spinner"></div></div>`);
  const [data, map] = await Promise.all([api.comments(), topics()]);
  const items = data.items || [];
  const counts = data.counts || {};
  const seen = seenAt();
  const fresh = items.filter(c => c.at > seen).length;
  // opened: these are seen now (they stay marked «جديد» on this visit)
  markSeen();
  showNew(0);

  mount(page, html`
    <div class="wrap page-in">
      <div class="page-title">
        <div><h1>التعليقات</h1>
          <p class="muted">${fresh ? `${num(fresh)} تعليق جديد من آخر مرة فتحت الصفحة دي` : 'مفيش تعليقات جديدة من آخر مرة فتحت الصفحة دي'} · كل تعليق بيظهر على الموقع أول ما يتكتب</p></div>
      </div>
      <div class="cm-stats">
        <div class="${fresh ? 'is-new' : ''}"><small>جديدة</small><b>${num(fresh)}</b></div>
        <div><small>النهارده</small><b>${num(counts.today || 0)}</b></div>
        <div><small>آخر 7 أيام</small><b>${num(counts.week || 0)}</b></div>
        <div><small>كل التعليقات</small><b>${num(counts.total || items.length)}</b></div>
      </div>
      <div class="filterbar">
        <div class="search search-wide">${icon('search')}<input id="cm-q" placeholder="ابحث بالاسم أو الكلام أو الموضوع…" value="${state.q}"></div>
        <div class="chips" id="cm-filters">${FILTERS.map(([k, l]) => html`<button class="chip ${state.filter === k ? 'active' : ''}" data-f="${k}">${l}${k === 'new' && fresh ? ` (${num(fresh)})` : ''}</button>`)}</div>
      </div>
      <div class="cm-list" id="cm-list"></div>
    </div>`);

  const draw = () => {
    const q = normalizeArabic(state.q);
    const shown = items.filter(c => {
      const t = topicOf(map, c);
      if (state.filter === 'new' && !(c.at > seen)) return false;
      if (state.filter === 'news' && t.kind !== 'news') return false;
      if (state.filter === 'shows' && !['shows', 'recaps', 'nostalgia'].includes(t.kind)) return false;
      return !q || normalizeArabic(`${c.name} ${c.text} ${t.title}`).includes(q);
    });
    mount($('#cm-list'), shown.length ? html`${shown.map(c => row(c, topicOf(map, c), seen))}`
      : html`<div class="empty-sm cm-empty">${icon('comment')}<span>${state.q ? 'مفيش تعليقات بالكلام ده' : state.filter === 'new' ? 'مفيش تعليقات جديدة' : 'لسه محدش علّق'}</span></div>`);
    wire($('#cm-list'), items, () => renderComments(page));
  };
  draw();
  $$('#cm-filters [data-f]').forEach(b => b.onclick = () => { state.filter = b.dataset.f; $$('#cm-filters .chip').forEach(x => x.classList.toggle('active', x === b)); draw(); });
  $('#cm-q').addEventListener('input', debounce((e) => { state.q = e.target.value; draw(); }, 150));
}

/** The box on the panel's home page: the numbers and the latest comments */
export async function renderCommentsBox(el) {
  if (!el) return;
  let data, map;
  try { [data, map] = await Promise.all([api.comments(), topics()]); } catch { el.hidden = true; return; }
  const items = data.items || [];
  const counts = data.counts || {};
  const seen = seenAt();
  const fresh = items.filter(c => c.at > seen).length;
  showNew(fresh);
  el.hidden = false;
  mount(el, html`
    <header class="panel-head"><h2>${icon('comment')}تعليقات الزوار ${fresh ? html`<span class="count-pill">${num(fresh)}</span>` : ''}</h2>
      <div class="cm-mini">
        <span class="${fresh ? 'is-new' : ''}"><b>${num(fresh)}</b><small>جديدة</small></span>
        <span><b>${num(counts.today || 0)}</b><small>النهارده</small></span>
        <span><b>${num(counts.total || items.length)}</b><small>الإجمالي</small></span>
        <a class="link" href="#/comments">الكل</a>
      </div></header>
    ${items.length ? html`<div class="rows">${items.slice(0, 4).map(c => row(c, topicOf(map, c), seen, { compact: true }))}</div>`
      : html`<p class="muted small">لسه محدش علّق. أول تعليق هيظهر هنا وفي الإشعارات.</p>`}`);
  wire(el, items, () => renderCommentsBox(el));
}
