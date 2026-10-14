// The site's members (owner 2026-10-14: «نظام التسجيل للمتابعيين»), in the panel: who signed up, when, from where,
// how much they comment; a member can be stopped (signed out, can't sign in or comment) and brought back. The
// accounts themselves: worker/src/members.ts.
import { api } from '../api.js';
import { html, mount, $, $$, icon, toast, dialog, timeAgo, num, normalizeArabic, debounce } from '../ui.js';

const COLORS = ['#0e9594', '#ff5a36', '#d98b12', '#7c6ee8', '#2b8fd6', '#c73b2c', '#2f9e5b'];
const colorOf = (name) => { let h = 0; for (const ch of String(name)) h = (h * 31 + ch.charCodeAt(0)) >>> 0; return COLORS[h % COLORS.length]; };
const initial = (name) => (String(name).trim().replace(/^ال(?=\S{2})/, '').match(/\S/) || ['؟'])[0].toUpperCase();
const AV = (import.meta.url.match(/\/admin\/([^/]+)\/js\//) || [])[1] || '';
const picSrc = (pic) => { pic = String(pic || ''); return /^w:[a-z0-9-]+$/.test(pic) ? `/avatars/${pic.slice(2)}.webp${AV ? `?v=${AV}` : ''}` : /^https:\/\//.test(pic) ? pic : ''; };
const flagOf = (cc) => (/^[A-Z]{2}$/.test(cc || '') ? String.fromCodePoint(...[...cc].map(ch => 0x1f1e6 + ch.charCodeAt(0) - 65)) : '');
const date = (ms) => new Date(ms).toLocaleDateString('ar-EG-u-nu-latn', { day: 'numeric', month: 'long', year: 'numeric' });

const FILTERS = [['all', 'الكل'], ['week', 'الجداد'], ['active', 'نشطين'], ['banned', 'موقوفين']];
const state = { q: '', filter: 'all' };

function row(m) {
  return html`<article class="mb-row ${m.banned ? 'is-banned' : ''}" data-id="${m.id}">
    <span class="cm-av" style="--c:${colorOf(m.display || m.username)}" aria-hidden="true">${picSrc(m.pic) ? html`<img src="${picSrc(m.pic)}" alt="" loading="lazy">` : initial(m.display || m.username)}</span>
    <div class="mb-main">
      <div class="cm-meta"><b>${m.display || m.username}</b><span class="mb-user" dir="ltr">@${m.username}</span>${m.banned ? html`<em class="mb-flag">موقوف</em>` : ''}${m.verified ? html`<em class="mb-ok" title="البريد متأكد">${icon('check')}البريد</em>` : ''}</div>
      <div class="mb-facts">
        <span dir="ltr">${m.email}</span>
        <span>انضم ${date(m.created)}</span>
        <span>آخر ظهور ${m.last_seen ? timeAgo(m.last_seen) : '—'}</span>
        <span>${num(m.comments || 0)} تعليق</span>
        ${m.country ? html`<span>${flagOf(m.country)} <span dir="ltr">${m.ip || ''}</span></span>` : ''}
      </div>
    </div>
    <div class="cm-actions">
      <button class="btn btn-sm ${m.banned ? '' : 'btn-danger-soft'}" data-ban="${m.id}" data-on="${m.banned ? '0' : '1'}">${m.banned ? 'رجّعه' : 'وقّفه'}</button>
    </div>
  </article>`;
}

export async function renderSiteMembers(page) {
  mount(page, html`<div class="loading-page"><div class="spinner"></div></div>`);
  const data = await api.siteMembers();
  const items = data.items || [];
  const counts = data.counts || {};
  const week = Date.now() - 7 * 86400e3;
  mount(page, html`
    <div class="wrap page-in">
      <div class="page-title">
        <div><h1>الأعضاء</h1>
          <p class="muted">كل اللي عملوا حساب على الموقع · العضو بيعلّق باسمه وصورته وجنبه «عضو»</p></div>
      </div>
      <div class="cm-stats">
        <div><small>كل الأعضاء</small><b>${num(counts.total || items.length)}</b></div>
        <div class="${counts.week ? 'is-new' : ''}"><small>جداد آخر 7 أيام</small><b>${num(counts.week || 0)}</b></div>
        <div><small>نشطين آخر 7 أيام</small><b>${num(counts.active || 0)}</b></div>
        <div><small>موقوفين</small><b>${num(items.filter(m => m.banned).length)}</b></div>
      </div>
      <div class="filterbar">
        <div class="search search-wide">${icon('search')}<input id="mb-q" placeholder="ابحث بالاسم أو اسم المستخدم أو البريد…" value="${state.q}"></div>
        <div class="chips" id="mb-filters">${FILTERS.map(([k, l]) => html`<button class="chip ${state.filter === k ? 'active' : ''}" data-f="${k}">${l}</button>`)}</div>
      </div>
      <div class="cm-list" id="mb-list"></div>
    </div>`);

  const draw = () => {
    const q = normalizeArabic(state.q);
    const shown = items.filter(m => {
      if (state.filter === 'week' && !(m.created > week)) return false;
      if (state.filter === 'active' && !(m.last_seen > week)) return false;
      if (state.filter === 'banned' && !m.banned) return false;
      return !q || normalizeArabic(`${m.display} ${m.username} ${m.email}`).includes(q);
    });
    mount($('#mb-list'), shown.length ? html`${shown.map(row)}`
      : html`<div class="empty"><p class="muted">${items.length ? 'مفيش أعضاء بالشكل ده.' : 'لسه محدش عمل حساب على الموقع.'}</p></div>`);
    $$('[data-ban]', $('#mb-list')).forEach(b => b.onclick = async () => {
      const m = items.find(x => String(x.id) === b.dataset.ban);
      const on = b.dataset.on === '1';
      const ok = await dialog({
        title: on ? `توقيف ${m.display || m.username}` : `رجوع ${m.display || m.username}`,
        body: html`<p class="muted small">${on ? 'هيخرج من حسابه على كل الأجهزة، ومش هيقدر يدخل ولا يعلّق باسمه لحد ما ترجّعه.' : 'هيقدر يدخل حسابه ويعلّق تاني.'}</p>`,
        confirm: on ? 'وقّفه' : 'رجّعه', danger: on,
      });
      if (!ok) return;
      b.disabled = true;
      try { await api.siteMemberBan(m.id, on); m.banned = on ? 1 : 0; toast(on ? 'اتوقف ✓' : 'رجع ✓'); draw(); }
      catch (e) { toast(e.message, 'error'); b.disabled = false; }
    });
  };
  draw();
  $('#mb-q').oninput = debounce((e) => { state.q = e.target.value; draw(); }, 150);
  $$('#mb-filters .chip').forEach(c => c.onclick = () => { state.filter = c.dataset.f; $$('#mb-filters .chip').forEach(x => x.classList.toggle('active', x === c)); draw(); });
}
