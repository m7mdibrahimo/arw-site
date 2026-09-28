// Stories the spoiler shield kept off social (results, returns, debuts): the owner reads each
// one and either publishes it to the platforms or keeps it off. The site itself always has them.
import { api, IS_LOCAL } from '../api.js';
import { html, mount, $$, icon, toast, dialog, timeAgo } from '../ui.js';

const REASON = { result: 'نتيجة أو حرق', return: 'عودة أو ظهور أول' };
const FIRST = 6;
const PLATFORMS = [['telegram', 'تيليجرام', '#24a1de'], ['facebook', 'فيسبوك', '#1877f2'], ['instagram', 'إنستجرام', '#e1306c']];

export async function renderHeld(el, { all = false } = {}) {
  if (!el) return;
  let items;
  try { items = (await api.held()).items || []; }
  catch (e) { return mount(el, IS_LOCAL ? '' : html`<section class="panel"><header class="panel-head"><h2>أخبار محجوبة عن السوشيال</h2></header><p class="muted panel-pad">${e.message}</p></section>`); }
  const waiting = items.filter(i => !i.releasedAt && !i.dismissedAt);
  const decided = items.filter(i => i.releasedAt || i.dismissedAt).slice(0, 8);
  if (!items.length) return mount(el, '');

  const row = (i) => {
    const state = i.releasedAt
      ? (i.sent && (i.sent.telegram || i.sent.facebook)
          ? html`<span class="plat-dots">${PLATFORMS.map(([k, n, c]) => html`<i class="${i.sent[k] ? 'on' : ''}" style="--c:${c}" title="${n}">${icon(k)}</i>`)}</span>`
          : html`<span class="tag tag-sched">${icon('clock')} بيتنشر دلوقتي</span>`)
      : i.dismissedAt ? html`<span class="tag">مش هيتنشر</span>` : '';
    return html`<div class="row held-row ${i.releasedAt || i.dismissedAt ? 'is-done' : ''}">
      <a class="row-img" href="${i.url}" target="_blank">${i.image ? html`<img src="${i.image}" alt="" loading="lazy">` : ''}</a>
      <a class="row-main" href="${i.url}" target="_blank" title="افتح الخبر على الموقع"><b>${i.title}</b>
        <small><span class="tag tag-held">${REASON[i.reason] || 'حرق'}</span> · اتحجب ${timeAgo(i.at)}${i.releasedAt ? ` · نشرته ${timeAgo(i.releasedAt)}${i.by ? ` (${i.by})` : ''}` : i.dismissedAt ? ` · سبته ${timeAgo(i.dismissedAt)}${i.by ? ` (${i.by})` : ''}` : ''}</small></a>
      <span class="row-actions">${state}
        ${!i.releasedAt ? html`<button class="btn btn-sm btn-primary" data-publish="${i.key}">${icon('send')} انشره</button>` : ''}
        ${!i.releasedAt && !i.dismissedAt ? html`<button class="btn btn-sm btn-ghost" data-keep="${i.key}">سيبه</button>` : ''}
      </span></div>`;
  };

  mount(el, html`<section class="panel held">
    <header class="panel-head"><h2>${icon('shield')} أخبار محجوبة عن السوشيال ${waiting.length ? html`<span class="count-pill">${waiting.length}</span>` : ''}</h2>
      <span class="muted small">اتحجبت تلقائي عشان شكلها فيها حرق. هي موجودة على الموقع عادي؛ انت اللي بتقرر تتنشر على المنصات ولا لأ.</span></header>
    ${waiting.length ? html`<div class="rows">${(all ? waiting : waiting.slice(0, FIRST)).map(row)}</div>
      ${!all && waiting.length > FIRST ? html`<button class="btn btn-ghost btn-sm held-more" id="held-more">عرض الباقي (${waiting.length - FIRST})</button>` : ''}` : html`<p class="muted small">مفيش أخبار مستنية قرارك دلوقتي.</p>`}
    ${decided.length ? html`<details class="held-done"><summary class="muted small">اللي اتقرر قبل كده (${decided.length})</summary><div class="rows">${decided.map(row)}</div></details>` : ''}
  </section>`);

  const more = el.querySelector('#held-more');
  if (more) more.onclick = () => renderHeld(el, { all: true });
  const find = (key) => items.find(i => i.key === key);
  $$('[data-publish]', el).forEach(b => b.onclick = async () => {
    const i = find(b.dataset.publish);
    const ok = await dialog({
      title: 'نشر الخبر على السوشيال',
      body: html`<p>«${i.title}»</p><p class="muted small">هيتنشر على تيليجرام وفيسبوك وإنستجرام خلال دقايق، ومش هينفع يترجع بعدها. متأكد إن مفيهوش حرق؟</p>`,
      confirm: 'أيوه، انشره',
    });
    if (!ok) return;
    b.disabled = true;
    try { await api.heldAction('publish', i); toast('تمام ✓ هيتنشر على المنصات خلال دقايق.'); renderHeld(el, { all }); }
    catch (e) { toast(e.message, 'error'); b.disabled = false; }
  });
  $$('[data-keep]', el).forEach(b => b.onclick = async () => {
    const i = find(b.dataset.keep);
    b.disabled = true;
    try { await api.heldAction('keep', i); toast('تمام، مش هيتنشر على المنصات.'); renderHeld(el, { all }); }
    catch (e) { toast(e.message, 'error'); b.disabled = false; }
  });
}
