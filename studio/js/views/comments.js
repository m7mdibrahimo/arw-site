// Visitors' comments (owner 2026-10-14): every comment left under a show, a recap or a story. A new one waits here until
// the owner publishes it to the site or deletes it. A page of its own (#/comments) and a box on the panel's home page.
import { api, siteData, mini } from '../api.js';
import { html, mount, $, $$, icon, toast, dialog, timeAgo, num, normalizeArabic, debounce } from '../ui.js';

const KIND = { news: ['خبر', '#ff5a36'], shows: ['عرض', '#0e9594'], recaps: ['ملخص', '#d98b12'], nostalgia: ['نوستالجيا', '#2b8fd6'] };
const COLORS = ['#0e9594', '#ff5a36', '#d98b12', '#7c6ee8', '#2b8fd6', '#c73b2c', '#2f9e5b'];
const colorOf = (name) => { let h = 0; for (const ch of String(name)) h = (h * 31 + ch.charCodeAt(0)) >>> 0; return COLORS[h % COLORS.length]; };
const initial = (name) => (String(name).trim().replace(/^ال(?=\S{2})/, '').match(/\S/) || ['؟'])[0].toUpperCase();
const pathKey = (u) => { let p = String(u || ''); try { p = decodeURIComponent(p); } catch {} p = p.split(/[?#]/)[0].normalize('NFC'); return p.endsWith('/') ? p : `${p}/`; };

/** Which show or story each comment is under: its title, kind and picture from the site's own index */
async function topics() {
  const index = await siteData('search-index.json').catch(() => []);
  const map = new Map();
  for (const i of index) {
    const m = String(i.inputPath || '').match(/content\/([^/]+)\//);
    map.set(pathKey(i.url), { title: i.headline || i.title, kind: m ? m[1] : '', image: i.image, thumb: i.thumb, url: i.url });
  }
  return map;
}
const topicOf = (map, path) => map.get(pathKey(path)) || { title: pathKey(path), kind: '', url: path };

function avatar(name) { return html`<span class="cm-av" style="--c:${colorOf(name)}" aria-hidden="true">${initial(name)}</span>`; }

function row(c, t, { compact = false } = {}) {
  const kind = KIND[t.kind];
  return html`<article class="cm-row ${c.status === 'pending' ? 'is-pending' : ''} ${compact ? 'is-compact' : ''}" data-id="${c.id}">
    ${avatar(c.name)}
    <div class="cm-main">
      <div class="cm-meta"><b>${c.name}</b><span class="muted">${timeAgo(c.at)}</span>${c.status === 'pending' ? html`<em class="cm-flag">مستني مراجعتك</em>` : ''}</div>
      <p class="cm-text">${c.text}</p>
      <a class="cm-topic" href="${t.url}#comments" target="_blank" rel="noopener" title="افتح الموضوع على الموقع">
        ${kind ? html`<i style="--c:${kind[1]}">${kind[0]}</i>` : ''}<span>${t.title}</span></a>
    </div>
    <div class="cm-actions">
      ${c.status === 'pending' ? html`<button class="btn btn-sm cm-ok" data-approve="${c.id}" title="انشره على الموقع">${icon('check')}<span>نشر</span></button>` : ''}
      <button class="icon-btn sm cm-del" data-delete="${c.id}" title="احذف التعليق">${icon('trash')}</button>
    </div>
  </article>`;
}

/** The number of waiting comments on the «التعليقات» tab in the top bar */
export function showWaiting(n) {
  const el = document.getElementById('cm-count');
  if (!el) return;
  el.hidden = !n;
  el.textContent = n ? num(n) : '';
}
export async function refreshWaiting() {
  try { showWaiting(((await api.comments('pending')).counts || {}).pending || 0); } catch {}
}

/** approve / delete buttons inside `el`; `again()` draws the page or the box afresh */
function wire(el, items, again) {
  const find = (id) => items.find(c => String(c.id) === String(id));
  $$('[data-approve]', el).forEach(b => b.onclick = async () => {
    b.disabled = true;
    try { await api.commentAction('approve', [b.dataset.approve]); toast('اتنشر على الموقع ✓'); again(); }
    catch (e) { toast(e.message, 'error'); b.disabled = false; }
  });
  $$('[data-delete]', el).forEach(b => b.onclick = async () => {
    const c = find(b.dataset.delete);
    const ok = await dialog({
      title: 'حذف التعليق',
      body: html`<div class="post-preview"><b>${c.name}</b><p>${c.text.length > 220 ? `${c.text.slice(0, 220)}…` : c.text}</p></div>
        <p class="muted small">${c.status === 'pending' ? 'التعليق مش هيظهر على الموقع خالص.' : 'التعليق هيختفي من الموقع.'} ومش هينفع يرجع.</p>`,
      confirm: 'احذفه', danger: true,
    });
    if (!ok) return;
    b.disabled = true;
    try { await api.commentAction('delete', [c.id]); toast('اتحذف ✓'); again(); }
    catch (e) { toast(e.message, 'error'); b.disabled = false; }
  });
}

const state = { tab: 'pending', q: '' };

export async function renderComments(page) {
  mount(page, html`<div class="loading-page"><div class="spinner"></div></div>`);
  const [data, map] = await Promise.all([api.comments('all'), topics()]);
  const items = data.items || [];
  const counts = data.counts || {};
  const pending = items.filter(c => c.status === 'pending');
  showWaiting(pending.length);
  if (state.tab === 'pending' && !pending.length) state.tab = 'all';

  mount(page, html`
    <div class="wrap page-in">
      <div class="page-title">
        <div><h1>التعليقات</h1>
          <p class="muted">${pending.length ? `${num(pending.length)} تعليق مستني مراجعتك` : 'مفيش تعليقات مستنية مراجعتك'} · ${num(counts.published || 0)} منشور على الموقع</p></div>
        <div class="page-actions">
          ${pending.length > 1 ? html`<button class="btn btn-primary" id="approve-all">${icon('check')} انشر الكل (${num(pending.length)})</button>` : ''}
        </div>
      </div>
      <div class="cm-stats">
        <div><small>مستني المراجعة</small><b>${num(counts.pending || 0)}</b></div>
        <div><small>النهارده</small><b>${num(counts.today || 0)}</b></div>
        <div><small>آخر 7 أيام</small><b>${num(counts.week || 0)}</b></div>
        <div><small>كل التعليقات</small><b>${num(counts.total || 0)}</b></div>
      </div>
      <div class="filterbar">
        <div class="search search-wide">${icon('search')}<input id="cm-q" placeholder="ابحث بالاسم أو الكلام أو الموضوع…" value="${state.q}"></div>
        <div class="chips" id="cm-tabs">
          <button class="chip ${state.tab === 'pending' ? 'active' : ''}" data-tab="pending">مستني المراجعة${pending.length ? ` (${num(pending.length)})` : ''}</button>
          <button class="chip ${state.tab === 'published' ? 'active' : ''}" data-tab="published">المنشورة</button>
          <button class="chip ${state.tab === 'all' ? 'active' : ''}" data-tab="all">الكل</button>
        </div>
      </div>
      <div class="cm-list" id="cm-list"></div>
    </div>`);

  const draw = () => {
    const q = normalizeArabic(state.q);
    const shown = items.filter(c => (state.tab === 'all' || c.status === state.tab)
      && (!q || normalizeArabic(`${c.name} ${c.text} ${topicOf(map, c.path).title}`).includes(q)));
    mount($('#cm-list'), shown.length ? html`${shown.map(c => row(c, topicOf(map, c.path)))}`
      : html`<div class="empty-sm cm-empty">${icon('comment')}<span>${state.q ? 'مفيش تعليقات بالكلام ده' : state.tab === 'pending' ? 'مفيش تعليقات مستنية مراجعتك' : 'لسه مفيش تعليقات'}</span></div>`);
    wire($('#cm-list'), items, () => renderComments(page));
  };
  draw();
  $$('#cm-tabs [data-tab]').forEach(b => b.onclick = () => { state.tab = b.dataset.tab; $$('#cm-tabs .chip').forEach(x => x.classList.toggle('active', x === b)); draw(); });
  $('#cm-q').addEventListener('input', debounce((e) => { state.q = e.target.value; draw(); }, 150));
  const all = $('#approve-all');
  if (all) all.onclick = async () => {
    const ok = await dialog({ title: 'نشر كل التعليقات المستنية', body: html`<p class="muted small">${num(pending.length)} تعليق هيظهروا على الموقع دلوقتي.</p>`, confirm: 'انشرهم' });
    if (!ok) return;
    all.disabled = true;
    try { await api.commentAction('approve', pending.map(c => c.id)); toast('اتنشروا على الموقع ✓'); renderComments(page); }
    catch (e) { toast(e.message, 'error'); all.disabled = false; }
  };
}

/** The box on the panel's home page: the numbers and the latest comments, the waiting ones first */
export async function renderCommentsBox(el) {
  if (!el) return;
  let data, map;
  try { [data, map] = await Promise.all([api.comments('all'), topics()]); } catch { el.hidden = true; return; }
  const items = data.items || [];
  const counts = data.counts || {};
  showWaiting(counts.pending || 0);
  const latest = [...items.filter(c => c.status === 'pending'), ...items.filter(c => c.status !== 'pending')].slice(0, 4);
  el.hidden = false;
  mount(el, html`
    <header class="panel-head"><h2>${icon('comment')}تعليقات الزوار ${counts.pending ? html`<span class="count-pill">${num(counts.pending)}</span>` : ''}</h2>
      <div class="cm-mini">
        <span class="${counts.pending ? 'is-waiting' : ''}"><b>${num(counts.pending || 0)}</b><small>مستني المراجعة</small></span>
        <span><b>${num(counts.today || 0)}</b><small>النهارده</small></span>
        <span><b>${num(counts.total || 0)}</b><small>الإجمالي</small></span>
        <a class="link" href="#/comments">الكل</a>
      </div></header>
    ${latest.length ? html`<div class="rows">${latest.map(c => row(c, topicOf(map, c.path), { compact: true }))}</div>`
      : html`<p class="muted small">لسه محدش علّق. أول تعليق هيظهر هنا.</p>`}`);
  wire(el, items, () => renderCommentsBox(el));
}
