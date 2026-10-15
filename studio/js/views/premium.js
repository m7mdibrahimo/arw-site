// «العضوية المميزة» in the panel (owner 2026-10-14): who's subscribed and until when, what was paid, and the members'
// translation requests (answered here, with a link to the show when it's up). The worker: worker/src/premium.ts.
import { api } from '../api.js';
import { html, mount, $, $$, icon, toast, dialog, timeAgo, num } from '../ui.js';

const KINDS = { nostalgia: 'نوستالجيا', series: 'سلسلة', show: 'عرض قديم', other: 'طلب تاني' };
const STATES = [['new', 'جديد'], ['working', 'بنترجمه'], ['done', 'خلص'], ['declined', 'اتعذّر']];
const AV = (import.meta.url.match(/\/admin\/([^/]+)\/js\//) || [])[1] || '';
const picSrc = (pic) => { pic = String(pic || ''); return /^w:[a-z0-9-]+$/.test(pic) ? `/avatars/${pic.slice(2)}.webp${AV ? `?v=${AV}` : ''}` : /^https:\/\//.test(pic) ? pic : ''; };
const initial = (name) => (String(name).trim().replace(/^ال(?=\S{2})/, '').match(/\S/) || ['؟'])[0].toUpperCase();
const av = (m) => html`<span class="cm-av" style="--c:#e09a12" aria-hidden="true">${picSrc(m.pic) ? html`<img src="${picSrc(m.pic)}" alt="" loading="lazy">` : initial(m.display || m.username || '؟')}</span>`;
const date = (ms) => new Date(ms).toLocaleDateString('ar-EG-u-nu-latn', { day: 'numeric', month: 'long', year: 'numeric' });
const left = (ms) => Math.max(0, Math.ceil((ms - Date.now()) / 864e5));
const money = (n, c) => (c === 'USD' ? `$${num(n)}` : `${num(n)} ج.م`);

export async function renderPremium(page) {
  mount(page, html`<div class="loading-page"><div class="spinner"></div></div>`);
  let d;
  try { d = await api.premium(); } catch (e) { mount(page, html`<div class="empty"><h2>مش متاح دلوقتي</h2><p class="muted">${e.message}</p></div>`); return; }
  const open = (d.requests || []).filter(r => r.status === 'new' || r.status === 'working');
  const month = Object.fromEntries((d.month || []).map(x => [x.currency, x]));
  mount(page, html`
    <div class="wrap page-in">
      <div class="page-title">
        <div><h1>العضوية المميزة</h1>
          <p class="muted">50 جنيه أو 1 دولار في الشهر · بتتفعّل لوحدها أول ما المتابع يدفع على فواتيرك · كل تجديد بيزوّد شهر</p></div>
        <a class="btn" href="/premium/" target="_blank" rel="noopener">${icon('globe')}افتح صفحة العضوية</a>
      </div>
      ${d.live ? '' : html`<div class="alert pr-alert">${icon('alert')}<div><b>الدفع التلقائي لسه مش متوصّل.</b> لحد ما تحط مفتاح فواتيرك في كلاودفلير، زرار الاشتراك بيفتح لينكات الدفع الثابتة، وإنت بتفعّل العضوية بإيدك من صفحة العضو (الأعضاء ← العضو ← «ادّيله شهر مميز»).</div></div>`}
      <div class="cm-stats">
        <div class="${(d.members || []).length ? 'is-new' : ''}"><small>مشتركين دلوقتي</small><b>${num((d.members || []).length)}</b></div>
        <div><small>دخل آخر 30 يوم (جنيه)</small><b>${money(month.EGP ? month.EGP.total : 0, 'EGP')}</b></div>
        <div><small>دخل آخر 30 يوم (دولار)</small><b>${money(month.USD ? month.USD.total : 0, 'USD')}</b></div>
        <div class="${open.length ? 'is-alert' : ''}"><small>طلبات مستنية</small><b>${num(open.length)}</b></div>
      </div>

      <section class="panel cy-sec"><h2>${icon('film')} طلبات الترجمة (${num((d.requests || []).length)})</h2>
        ${(d.requests || []).length ? html`<div class="cy-list">${d.requests.map(r => html`<article class="cy-item pr-req is-${r.status}" data-req="${r.id}">
          ${av(r)}
          <div class="cy-item-main">
            <div class="cm-meta"><b>${r.display || r.username}</b><span class="muted small">${KINDS[r.kind] || ''} · ${timeAgo(r.created)}</span>${r.official ? html`<em class="pr-official">الحساب الرسمي</em>` : r.premium_until > Date.now() ? '' : html`<em class="mb-wait">العضوية خلصت</em>`}</div>
            <textarea class="input pr-req-text" data-f="text" rows="2" dir="auto" aria-label="نص الطلب">${r.text}</textarea>
            <div class="pr-states">${STATES.map(([k, l]) => html`<label><input type="radio" name="st-${r.id}" value="${k}" ${r.status === k ? 'checked' : ''}><span>${l}</span></label>`)}</div>
            <div class="pr-req-edit">
              <input class="input" data-f="reply" placeholder="ردك على المتابع (اختياري)" value="${r.reply || ''}" dir="auto">
              <input class="input" data-f="link" placeholder="لينك العرض لما ينزل: /nostalgia/..." value="${r.link || ''}" dir="ltr">
              <button class="btn btn-sm btn-primary" data-save="${r.id}">احفظ</button>
              <button class="btn btn-sm btn-danger-soft" data-del="${r.id}" title="امسح الطلب">${icon('trash')}امسح</button>
            </div>
          </div>
          <a class="btn btn-sm btn-ghost" href="#/site-members/${r.member}">صفحته</a>
        </article>`)}</div>` : html`<p class="muted">لسه مفيش طلبات. المشتركين بيطلبوا من صفحة العضوية.</p>`}
      </section>

      <section class="panel cy-sec"><h2>${icon('users')} المشتركين (${num((d.members || []).length)})</h2>
        ${(d.members || []).length ? html`<div class="cy-list">${d.members.map(m => html`<article class="cy-item">
          ${av(m)}
          <div class="cy-item-main"><div class="cm-meta"><b>${m.display || m.username}</b><span class="muted small"><bdi dir="ltr">@${m.username}</bdi></span></div>
            <small class="muted">لحد ${date(m.premium_until)} · فاضل ${num(left(m.premium_until))} يوم${m.premium_since ? ` · مشترك من ${date(m.premium_since)}` : ''}</small></div>
          <a class="btn btn-sm btn-ghost" href="#/site-members/${m.id}">صفحته</a></article>`)}</div>` : html`<p class="muted">لسه محدش اشترك.</p>`}
      </section>

      <section class="panel cy-sec"><h2>${icon('check')} المدفوعات</h2>
        ${(d.payments || []).length ? html`<div class="cy-list">${d.payments.map(p => html`<article class="cy-item pr-pay">
          <div class="cy-item-main"><div class="cm-meta"><b>${p.display || p.username || `عضو ${p.member}`}</b><span class="muted small">${timeAgo(p.paid_at)}</span></div>
            <small class="muted">${p.granted_by === 'trial' ? `تجربة مجانية · ${num(p.days)} أيام` : p.granted_by ? `اتفعّلت بإيد ${p.granted_by} · ${num(p.days)} يوم` : `${money(p.amount, p.currency)}${p.method ? ` · ${p.method}` : ''}${p.reference ? ` · رقم العملية ${p.reference}` : ''}`}</small></div>
          <span class="pr-amt">${p.granted_by === 'trial' ? 'تجربة' : p.granted_by ? 'يدوي' : money(p.amount, p.currency)}</span></article>`)}</div>` : html`<p class="muted">لسه مفيش مدفوعات.</p>`}
      </section>
    </div>`);

  page.onclick = async (e) => {
    const del = e.target.closest('[data-del]');
    if (del) {
      const ok = await dialog({ title: 'مسح الطلب', body: html`<p class="muted small">الطلب هيتمسح خالص، ومش هيظهر للمشترك تاني.</p>`, confirm: 'امسحه', danger: true });
      if (!ok) return;
      try { await api.premiumRequest({ id: Number(del.dataset.del), delete: true }); toast('اتمسح ✓'); renderPremium(page); }
      catch (err) { toast(err.message, 'error'); }
      return;
    }
    const b = e.target.closest('[data-save]');
    if (!b) return;
    const card = b.closest('[data-req]');
    const id = b.dataset.save;
    const status = (card.querySelector(`input[name="st-${id}"]:checked`) || {}).value || 'working';
    b.disabled = true;
    try {
      await api.premiumRequest({ id: Number(id), status, text: $('[data-f="text"]', card).value, reply: $('[data-f="reply"]', card).value, link: $('[data-f="link"]', card).value.trim() });
      toast('اتحفظ ✓'); renderPremium(page);
    } catch (err) { toast(err.message, 'error'); b.disabled = false; }
  };
}
