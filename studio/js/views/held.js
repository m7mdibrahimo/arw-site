// Stories the spoiler shield kept off social (results, returns, debuts): the owner reads each
// one and either publishes it to the platforms or keeps it off. The site itself always has them.
// Shown on the home page under the latest shows and news, in the same compact rows.
import { api } from '../api.js';
import { notify } from '../notify.js';
import { html, mount, $$, icon, toast, dialog, timeAgo, num } from '../ui.js';

const REASON = { result: 'نتيجة أو حرق', return: 'عودة أو ظهور أول', show: 'حاجة حصلت في عرض لسه متذاع' };
const PLATFORMS = [['telegram', 'تيليجرام', '#24a1de'], ['facebook', 'فيسبوك', '#1877f2'], ['instagram', 'إنستجرام', '#e1306c']];
const FIRST = 7;
// Why the shield held it: the title, the opening that goes out with it, or (older stories)
// only the writer's broad flag — those show nothing on social.
const why = (i) => i.why === 'flag' ? 'مفيهوش حرق ظاهر' : i.why === 'old' ? 'حدث قديم، مفيهوش حرق' : `${REASON[i.reason] || 'حرق'} ${i.why === 'lead' ? 'في أول الخبر' : i.why === 'ai' ? 'في معنى الخبر' : 'في العنوان'}`;

export async function renderHeld(el, { all = false } = {}) {
  if (!el) return;
  let items;
  try { items = (await api.held()).items || []; } catch { el.hidden = true; return; }
  const waiting = items.filter(i => !i.releasedAt && !i.dismissedAt);
  const decided = items.filter(i => i.releasedAt || i.dismissedAt).slice(0, 7);
  if (!items.length) { el.hidden = true; return; }
  el.hidden = false;

  const row = (i) => html`<div class="row held-row ${i.releasedAt || i.dismissedAt ? 'is-done' : ''}">
    <a class="row-img" href="${i.url}" target="_blank">${i.image ? html`<img src="${i.image}" alt="" loading="lazy">` : ''}</a>
    <a class="row-main" href="${i.url}" target="_blank" title="افتح الخبر على الموقع"><b>${i.title}</b>
      <small>${i.why === 'flag' || i.why === 'old' ? html`<span class="clean-tag">${why(i)}</span>` : why(i)} · ${i.releasedAt ? `نشرته ${timeAgo(i.releasedAt)}` : i.dismissedAt ? `سبته ${timeAgo(i.dismissedAt)}` : `${timeAgo(i.at)} · هيتنشر لوحده بعد ${Math.max(1, Math.ceil((24 * 3600_000 - (Date.now() - i.at)) / 3600_000))} ساعة`}</small></a>
    <span class="row-actions">${i.releasedAt
      ? (i.sent && (i.sent.telegram || i.sent.facebook)
          ? html`<span class="plat-dots">${PLATFORMS.map(([k, n, c]) => html`<i class="${i.sent[k] ? 'on' : ''}" style="--c:${c}" title="${n}">${icon(k)}</i>`)}</span>`
          : html`<span class="icon-btn sm" title="بيتنشر دلوقتي">${icon('clock')}</span>`)
      : html`<button class="icon-btn sm held-pub" data-publish="${i.key}" title="انشره على المنصات">${icon('send')}</button>
        ${i.dismissedAt ? '' : html`<button class="icon-btn sm" data-keep="${i.key}" title="سيبه من غير نشر">${icon('x')}</button>`}`}
    </span></div>`;

  mount(el, html`
    <header class="panel-head"><h2>محجوبة عن السوشيال ${waiting.length ? html`<span class="count-pill">${num(waiting.length)}</span>` : ''}</h2>
      ${waiting.length > FIRST ? html`<a class="link" href="#" id="held-all">${all ? 'أقل' : 'الكل'}</a>` : ''}</header>
    ${waiting.length ? html`<div class="rows">${(all ? waiting : waiting.slice(0, FIRST)).map(row)}</div>` : html`<p class="muted small">مفيش أخبار محجوبة مستنية قرارك في آخر ٢٤ ساعة.</p>`}
    ${decided.length ? html`<details class="held-done"><summary class="muted small">اللي اتقرر قبل كده (${num(decided.length)})</summary><div class="rows">${decided.map(row)}</div></details>` : ''}`);

  const allLink = el.querySelector('#held-all');
  if (allLink) allLink.onclick = (e) => { e.preventDefault(); renderHeld(el, { all: !all }); };
  const find = (key) => items.find(i => i.key === key);
  $$('[data-publish]', el).forEach(b => b.onclick = async () => {
    const i = find(b.dataset.publish);
    const ok = await dialog({
      title: 'نشر الخبر على السوشيال',
      body: html`<p class="muted small">ده اللي هيتنشر (${why(i)}):</p>
        <div class="post-preview"><b>${i.title}</b>${i.lead ? html`<p>${i.lead}…</p>` : ''}</div>
        ${i.note ? html`<p class="small">سبب الحجب: ${i.note}</p>` : ''}
        <p class="muted small">هيتنشر على تيليجرام وفيسبوك وإنستجرام خلال دقايق، ومش هينفع يترجع.</p>`,
      confirm: 'أيوه، انشره',
    });
    if (!ok) return;
    b.disabled = true;
    try { await api.heldAction('publish', i); toast('تمام ✓ هيتنشر على المنصات خلال دقايق.'); notify({ type: 'held-publish', title: i.title }); renderHeld(el, { all }); }
    catch (e) { toast(e.message, 'error'); b.disabled = false; }
  });
  $$('[data-keep]', el).forEach(b => b.onclick = async () => {
    const i = find(b.dataset.keep);
    b.disabled = true;
    try { await api.heldAction('keep', i); toast('تمام، مش هيتنشر على المنصات.'); notify({ type: 'held-keep', title: i.title }); renderHeld(el, { all }); }
    catch (e) { toast(e.message, 'error'); b.disabled = false; }
  });
}
