// Visitors' comments (owner 2026-10-14): every comment left under a show, a recap or a story. A comment is on the site
// the moment it is sent (owner: «عايزها تتنشر علطول»); here the owner reads them all and deletes what shouldn't stay.
// The comments since the owner last looked are marked «جديد» and counted on the tab; each new one also reaches the bell.
// The owner answers as the site itself («عرب راسلنج», its logo, the blue badge): «رد» under a comment, published at once.
import { api, siteData } from '../api.js';
import { html, raw, mount, $, $$, icon, toast, dialog, timeAgo, num, normalizeArabic, debounce } from '../ui.js';

const KIND = { news: ['خبر', '#ff5a36'], shows: ['عرض', '#0e9594'], recaps: ['ملخص', '#d98b12'], nostalgia: ['نوستالجيا', '#2b8fd6'] };
const COLORS = ['#0e9594', '#ff5a36', '#d98b12', '#7c6ee8', '#2b8fd6', '#c73b2c', '#2f9e5b'];
const colorOf = (name) => { let h = 0; for (const ch of String(name)) h = (h * 31 + ch.charCodeAt(0)) >>> 0; return COLORS[h % COLORS.length]; };
const initial = (name) => (String(name).trim().replace(/^ال(?=\S{2})/, '').match(/\S/) || ['؟'])[0].toUpperCase();
// a comment's picture: «w:<slug>» a wrestler's from the site, or the address of the visitor's own
// a star's picture: with the panel's version (its folder, /admin/<build>/), so a new set of pictures shows after a deploy
const AV = (import.meta.url.match(/\/admin\/([^/]+)\/js\//) || [])[1] || '';
const picSrc = (pic) => { pic = String(pic || ''); return /^w:[a-z0-9-]+$/.test(pic) ? `/avatars/${pic.slice(2)}.webp${AV ? `?v=${AV}` : ''}` : /^https:\/\//.test(pic) ? pic : ''; };
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

const BADGE = '<svg viewBox="0 0 24 24" width="15" height="15" aria-hidden="true" style="width:15px;height:15px"><path fill="#1d9bf0" d="M22.5 12.5c0-1.58-.88-2.95-2.15-3.6.15-.44.23-.92.23-1.4 0-2.21-1.71-4-3.82-4-.47 0-.92.08-1.34.25C14.79 2.5 13.47 1.5 12 1.5s-2.79 1-3.42 2.25c-.42-.17-.87-.25-1.34-.25-2.11 0-3.82 1.79-3.82 4 0 .48.08.96.23 1.4-1.27.65-2.15 2.02-2.15 3.6 0 1.5.8 2.8 1.98 3.47-.03.17-.04.35-.04.53 0 2.21 1.71 4 3.82 4 .47 0 .92-.09 1.34-.25.63 1.25 1.95 2.25 3.42 2.25s2.79-1 3.42-2.25c.42.16.87.25 1.34.25 2.11 0 3.82-1.79 3.82-4 0-.18-.01-.36-.04-.53 1.18-.67 1.98-1.97 1.98-3.47z"/><path fill="#fff" d="M10.54 16.4 6.8 12.66l1.41-1.42 2.33 2.33 5.25-5.25 1.42 1.41z"/></svg>';

// The site's heart on a comment, as YouTube's: an empty heart to give it, the site's picture with a small red heart once given
const HEART_O = '<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round" d="M12 20.3 4.6 13a4.7 4.7 0 0 1 6.6-6.7l.8.8.8-.8a4.7 4.7 0 0 1 6.6 6.7z"/></svg>';
const HEART = '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="#e8264b" stroke="#fff" stroke-width="2.4" stroke-linejoin="round" d="M12 20.3 4.6 13a4.7 4.7 0 0 1 6.6-6.7l.8.8.8-.8a4.7 4.7 0 0 1 6.6 6.7z"/></svg>';
const heartFace = (on) => on
  ? html`<span class="cm-hearted"><img src="/assets/brand-logo.png?v=2" alt="">${raw(HEART)}</span>`
  : raw(HEART_O);
const heartTitle = (on) => (on ? 'شيل القلب' : 'اعمل قلب: هيظهر للمتابع إن عرب راسلنج عجبه تعليقه');

// Where a comment came from (the panel only): the country's flag and name, and the visitor's address, copied on a click
const REGION = (() => { try { return new Intl.DisplayNames(['ar'], { type: 'region' }); } catch { return null; } })();
const flagOf = (cc) => (/^[A-Z]{2}$/.test(cc) ? String.fromCodePoint(...[...cc].map(ch => 0x1f1e6 + ch.charCodeAt(0) - 65)) : '');
const countryName = (cc) => { try { return (REGION && /^[A-Z]{2}$/.test(cc) && REGION.of(cc)) || ''; } catch { return ''; } };
function whereFrom(c) {
  if (!c.ip && !c.country) return '';
  const name = countryName(c.country);
  return html`<span class="cm-where" title="${name ? `${name} · ` : ''}${c.ip ? 'اضغط لنسخ عنوان IP' : 'عنوان IP بيتسجّل للتعليقات الجديدة بس'}">
    ${flagOf(c.country) ? html`<i aria-hidden="true">${flagOf(c.country)}</i>` : ''}${c.ip ? html`<button type="button" class="cm-ip" data-ip="${c.ip}" dir="ltr">${c.ip}</button>` : html`<span>${name}</span>`}</span>`;
}

/** A reply under a comment, as it shows on the site: the site's own (logo, name, badge) or a visitor's */
function replyRow(r) {
  const own = !!r.official;
  return html`<div class="cm-reply ${own ? '' : 'is-visitor'}">
    ${own ? html`<span class="cm-av cm-av-sm" aria-hidden="true"><img src="/assets/brand-logo.png?v=2" alt=""></span>`
      : html`<span class="cm-av cm-av-sm" style="--c:${colorOf(r.name)}" aria-hidden="true">${picSrc(r.pic) ? html`<img src="${picSrc(r.pic)}" alt="" loading="lazy" data-i="${initial(r.name)}">` : initial(r.name)}</span>`}
    <div class="cm-main">
      <div class="cm-meta">${own ? html`<b>عرب راسلنج</b><span class="cm-badge" title="الحساب الرسمي الموثّق">${raw(BADGE)}</span>` : html`<b>${r.name}</b>`}<span class="muted">${timeAgo(r.at)}</span>${own ? '' : whereFrom(r)}</div>
      <p class="cm-text">${r.text}</p>
    </div>
    ${own ? '' : html`<button class="icon-btn sm cm-heart ${r.hearted ? 'is-on' : ''}" data-heart="${r.id}" aria-pressed="${r.hearted ? 'true' : 'false'}" title="${heartTitle(r.hearted)}">${heartFace(r.hearted)}</button>`}
    <button class="icon-btn sm cm-del" data-delete="${r.id}" title="${own ? 'احذف الرد' : 'احذف رد المتابع'}">${icon('trash')}</button>
  </div>`;
}

function row(c, t, seen, replies = [], { compact = false } = {}) {
  const kind = KIND[t.kind];
  const fresh = c.at > seen;
  return html`<article class="cm-row ${fresh ? 'is-new' : ''} ${compact ? 'is-compact' : ''}" data-id="${c.id}">
    <span class="cm-av" style="--c:${colorOf(c.name)}" aria-hidden="true">${picSrc(c.pic) ? html`<img src="${picSrc(c.pic)}" alt="" loading="lazy" data-i="${initial(c.name)}">` : initial(c.name)}</span>
    <div class="cm-main">
      <div class="cm-meta"><b>${c.name}</b><span class="muted">${timeAgo(c.at)}</span>${fresh ? html`<em class="cm-flag">جديد</em>` : ''}${replies.some(r => r.official) ? html`<em class="cm-answered">${icon('check')}رديت</em>` : ''}${whereFrom(c)}</div>
      <p class="cm-text">${c.text}</p>
      <a class="cm-topic" href="${t.url}#comments" target="_blank" rel="noopener" title="افتح التعليق على الموقع">
        ${kind ? html`<i style="--c:${kind[1]}">${kind[0]}</i>` : ''}<span>${t.title}</span></a>
      ${compact ? '' : html`${replies.map(replyRow)}
      <form class="cm-reply-form" data-reply-form="${c.id}" hidden>
        <span class="cm-av cm-av-sm" aria-hidden="true"><img src="/assets/brand-logo.png?v=2" alt=""></span>
        <textarea rows="2" maxlength="1000" placeholder="اكتب ردك باسم عرب راسلنج…"></textarea>
        <div class="cm-reply-actions"><button class="btn btn-sm btn-primary" type="submit">${icon('send')}انشر الرد</button><button class="btn btn-sm" type="button" data-cancel>إلغاء</button></div>
      </form>`}
    </div>
    <div class="cm-actions">
      <button class="icon-btn sm cm-heart ${c.hearted ? 'is-on' : ''}" data-heart="${c.id}" aria-pressed="${c.hearted ? 'true' : 'false'}" title="${heartTitle(c.hearted)}">${heartFace(c.hearted)}</button>
      <button class="btn btn-sm cm-reply-btn" data-reply="${c.id}" title="رد باسم عرب راسلنج">${icon('comment')}<span>رد</span></button>
      <a class="icon-btn sm" href="${t.url}#comments" target="_blank" rel="noopener" title="افتح على الموقع">${icon('eye')}</a>
      <button class="icon-btn sm cm-del" data-delete="${c.id}" title="احذف التعليق من الموقع">${icon('trash')}</button>
    </div>
  </article>`;
}

/** The delete and reply buttons inside `el`; `again()` draws the page or the box afresh */
function wire(el, items, again) {
  // a picture that's gone (a star taken off the list, a deleted upload): the name's first letter, as on the site
  $$('.cm-av img[data-i]', el).forEach(img => {
    const fall = () => img.replaceWith(document.createTextNode(img.dataset.i));
    if (img.complete && !img.naturalWidth) fall(); else img.addEventListener('error', fall, { once: true });
  });
  $$('[data-delete]', el).forEach(b => b.onclick = async () => {
    const c = items.find(x => String(x.id) === b.dataset.delete);
    const own = !!c.official, isReply = !!c.parent;
    const ok = await dialog({
      title: own || isReply ? 'حذف الرد' : 'حذف التعليق',
      body: html`<div class="post-preview"><b>${own ? 'عرب راسلنج' : c.name}</b><p>${c.text.length > 220 ? `${c.text.slice(0, 220)}…` : c.text}</p></div>
        <p class="muted small">${own || isReply ? 'الرد هيختفي من الموقع على طول.' : 'التعليق هيختفي من الموقع على طول، ومعاه الردود اللي تحته. ومش هينفع يرجع.'}</p>`,
      confirm: 'احذف', danger: true,
    });
    if (!ok) return;
    b.disabled = true;
    try { await api.commentAction('delete', [c.id]); toast('اتحذف من الموقع ✓'); again(); }
    catch (e) { toast(e.message, 'error'); b.disabled = false; }
  });
  $$('[data-ip]', el).forEach(b => b.onclick = async () => {
    try { await navigator.clipboard.writeText(b.dataset.ip); toast('اتنسخ عنوان IP ✓'); } catch { toast(b.dataset.ip); }
  });
  // the heart: on or off at once on the button, then kept by the worker (back as it was if that fails)
  $$('[data-heart]', el).forEach(b => b.onclick = async () => {
    const c = items.find(x => String(x.id) === b.dataset.heart);
    const on = !c.hearted;
    const show = (v) => { c.hearted = v; b.classList.toggle('is-on', v); b.setAttribute('aria-pressed', String(v)); b.title = heartTitle(v); mount(b, heartFace(v)); };
    show(on);
    b.disabled = true;
    try { await api.commentHeart(c.id, on); if (on) toast('اتعمل قلب على التعليق ❤'); }
    catch (e) { show(!on); toast(e.message, 'error'); }
    finally { b.disabled = false; }
  });
  $$('[data-reply]', el).forEach(b => b.onclick = () => {
    const form = $(`[data-reply-form="${b.dataset.reply}"]`, el);
    if (!form) { location.hash = '#/comments'; return; } // the home page's box: answer on the comments page
    form.hidden = !form.hidden;
    if (!form.hidden) form.querySelector('textarea').focus();
  });
  $$('[data-reply-form]', el).forEach(form => {
    form.querySelector('[data-cancel]').onclick = () => { form.hidden = true; };
    form.onsubmit = async (e) => {
      e.preventDefault();
      const ta = form.querySelector('textarea'), btn = form.querySelector('[type=submit]');
      if (!ta.value.trim()) { ta.focus(); return; }
      btn.disabled = true;
      try { await api.commentReply(form.dataset.replyForm, ta.value); toast('ردك اتنشر على الموقع ✓'); again(); }
      catch (err) { toast(err.message, 'error'); btn.disabled = false; }
    };
  });
}

/** The visitors' comments, each with the site's replies to it */
function thread(items) {
  const tops = items.filter(c => !c.parent && !c.official);
  const replies = new Map();
  for (const r of items.filter(c => c.parent).sort((a, b) => a.at - b.at)) {
    if (!replies.has(r.parent)) replies.set(r.parent, []);
    replies.get(r.parent).push(r);
  }
  return { tops, replies };
}

/** The number of new comments on the «التعليقات» tab in the top bar */
export function showNew(n) {
  const el = document.getElementById('cm-count');
  if (!el) return;
  el.hidden = !n;
  el.textContent = n ? (n > 99 ? '99+' : num(n)) : '';
}
export async function refreshNew() {
  try { const seen = seenAt(); showNew(((await api.comments()).items || []).filter(c => !c.official && c.at > seen).length); } catch {}
}

const FILTERS = [['', 'الكل'], ['new', 'الجديدة'], ['news', 'على الأخبار'], ['shows', 'على العروض والملخصات']];
const state = { filter: '', q: '' };

export async function renderComments(page) {
  mount(page, html`<div class="loading-page"><div class="spinner"></div></div>`);
  const [data, map] = await Promise.all([api.comments(), topics()]);
  const items = data.items || [];
  const counts = data.counts || {};
  const seen = seenAt();
  const { tops, replies } = thread(items);
  const fresh = tops.filter(c => c.at > seen).length;
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
        <div><small>كل التعليقات</small><b>${num(counts.total || tops.length)}</b></div>
      </div>
      <div class="filterbar">
        <div class="search search-wide">${icon('search')}<input id="cm-q" placeholder="ابحث بالاسم أو الكلام أو الموضوع…" value="${state.q}"></div>
        <div class="chips" id="cm-filters">${FILTERS.map(([k, l]) => html`<button class="chip ${state.filter === k ? 'active' : ''}" data-f="${k}">${l}${k === 'new' && fresh ? ` (${num(fresh)})` : ''}</button>`)}</div>
      </div>
      <div class="cm-list" id="cm-list"></div>
    </div>`);

  const draw = () => {
    const q = normalizeArabic(state.q);
    const shown = tops.filter(c => {
      const t = topicOf(map, c);
      if (state.filter === 'new' && !(c.at > seen)) return false;
      if (state.filter === 'news' && t.kind !== 'news') return false;
      if (state.filter === 'shows' && !['shows', 'recaps', 'nostalgia'].includes(t.kind)) return false;
      return !q || normalizeArabic(`${c.name} ${c.text} ${t.title}`).includes(q);
    });
    mount($('#cm-list'), shown.length ? html`${shown.map(c => row(c, topicOf(map, c), seen, replies.get(c.id) || []))}`
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
  const { tops, replies } = thread(items);
  const fresh = tops.filter(c => c.at > seen).length;
  showNew(fresh);
  el.hidden = false;
  mount(el, html`
    <header class="panel-head"><h2>${icon('comment')}تعليقات الزوار ${fresh ? html`<span class="count-pill">${num(fresh)}</span>` : ''}</h2>
      <div class="cm-mini">
        <span class="${fresh ? 'is-new' : ''}"><b>${num(fresh)}</b><small>جديدة</small></span>
        <span><b>${num(counts.today || 0)}</b><small>النهارده</small></span>
        <span><b>${num(counts.total || tops.length)}</b><small>الإجمالي</small></span>
        <a class="link" href="#/comments">الكل</a>
      </div></header>
    ${tops.length ? html`<div class="rows">${tops.slice(0, 4).map(c => row(c, topicOf(map, c), seen, replies.get(c.id) || [], { compact: true }))}</div>`
      : html`<p class="muted small">لسه محدش علّق. أول تعليق هيظهر هنا وفي الإشعارات.</p>`}`);
  wire(el, items, () => renderCommentsBox(el));
}
