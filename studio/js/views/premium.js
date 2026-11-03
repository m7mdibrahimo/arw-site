// «العضوية المميزة» in the panel (owner 2026-10-14): who's subscribed and until when, what was paid, and the members'
// translation requests (answered here, with a link to the show when it's up). The worker: worker/src/premium.ts.
import { api, getUser } from '../api.js';
import { html, raw, mount, $, $$, icon, toast, dialog, timeAgo, num } from '../ui.js';

const KINDS = { nostalgia: 'نوستالجيا', series: 'سلسلة', show: 'عرض قديم', other: 'طلب تاني' };
const STATES = [['new', 'جديد'], ['working', 'بنترجمه'], ['done', 'خلص'], ['declined', 'اتعذّر']];
const AV = (import.meta.url.match(/\/admin\/([^/]+)\/js\//) || [])[1] || '';
const picSrc = (pic) => { pic = String(pic || ''); return /^w:[a-z0-9-]+$/.test(pic) ? `/avatars/${pic.slice(2)}.webp${AV ? `?v=${AV}` : ''}` : /^https:\/\//.test(pic) ? pic : ''; };
const initial = (name) => (String(name).trim().replace(/^ال(?=\S{2})/, '').match(/\S/) || ['؟'])[0].toUpperCase();
const av = (m) => html`<span class="cm-av" style="--c:#e09a12" aria-hidden="true">${picSrc(m.pic) ? html`<img src="${picSrc(m.pic)}" alt="" loading="lazy">` : initial(m.display || m.username || '؟')}</span>`;
const date = (ms) => new Date(ms).toLocaleDateString('ar-EG-u-nu-latn', { day: 'numeric', month: 'long', year: 'numeric' });
const left = (ms) => Math.max(0, Math.ceil((ms - Date.now()) / 864e5));
const money = (n, c) => (c === 'USD' ? `$${num(n)}` : `${num(n)} ج.م`);
const CROWN = '<svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor" aria-hidden="true"><path d="M3 8.5 7.5 12 12 5l4.5 7L21 8.5 19 18H5z"/><rect x="5" y="19.5" width="14" height="2" rx="1"/></svg>';
const DAY = 864e5;
/** What turned a membership on (owner 2026-10-15: «تجربة 3 ايام … ولا هدية من الموقع … ولا دافع»): the last one counted.
 *  «paid:<who>»: paid the owner directly and turned on by hand (owner 2026-10-16: «يكون في تفريق بين اني مديله العضوية …
 *  هدية من الموقع وبين ان هو دافع») — worker/src/premium.ts handPaid */
const handPaid = (by) => /^paid:/.test(String(by || ''));
const handBy = (by) => String(by || '').replace(/^paid:/, '');
export const premiumKind = (by) => (by == null ? '' : by === 'trial' ? 'تجربة مجانية' : !by || handPaid(by) ? 'مدفوع' : 'هدية من الموقع');
const KIND_CLS = { 'تجربة مجانية': 'is-trial', 'هدية من الموقع': 'is-gift', 'مدفوع': 'is-paid' };
export const kindTag = (by) => { const k = premiumKind(by); return k ? html`<em class="pg-kind ${KIND_CLS[k]}">${k}</em>` : ''; };
/** A member's history: each payment, trial and gift, and invoices opened and not paid */
export function payHistory(list) {
  if (!list || !list.length) return html`<p class="muted">مفيش أي اشتراك أو دفع لحد دلوقتي.</p>`;
  return html`<div class="pg-hist">${list.map(p => {
    const when = p.status === 'paid' ? p.paid_at : p.created;
    const what = p.status !== 'paid' ? html`<b class="pg-wait">فتح فاتورة ${money(p.amount, p.currency)} ولسه مدفعش</b>`
      : p.granted_by === 'trial' ? html`<b>${kindTag('trial')} ${num(p.days)} أيام</b>`
      : handPaid(p.granted_by) ? html`<b>${kindTag(p.granted_by)} ${p.amount ? html`${money(p.amount, p.currency)} · ` : ''}${num(p.days)} يوم</b><small class="muted">دفع مباشر${p.method ? ` · ${p.method}` : ''}${p.reference ? ` · رقم العملية ${p.reference}` : ''} · فعّلها ${handBy(p.granted_by)} <button type="button" class="pg-swap" data-pay="${p.id}" data-to="gift">كانت هدية؟</button></small>`
      : p.granted_by ? html`<b>${kindTag(p.granted_by)} ${num(p.days)} يوم</b><small class="muted">فعّلها ${p.granted_by} <button type="button" class="pg-swap" data-pay="${p.id}" data-to="paid">كان دافع؟</button></small>`
      : html`<b>${kindTag('')} ${money(p.amount, p.currency)} · ${num(p.days)} يوم</b><small class="muted">${p.method ? `${p.method}` : 'فواتيرك'}${p.reference ? ` · رقم العملية ${p.reference}` : ''}${p.invoice_id ? ` · فاتورة ${p.invoice_id}` : ''}</small>`;
    // «تعديل المدة» on any paid or given membership (not a trial): the owner corrects a month that should have been a year
    const fix = p.status === 'paid' && p.granted_by !== 'trial' ? html`<button type="button" class="pg-swap pg-days" data-pay="${p.id}" data-days="${p.days}">تعديل المدة</button>` : '';
    return html`<div class="pg-hist-row ${p.status !== 'paid' ? 'is-wait' : ''}"><span class="pg-hist-date">${date(when)}<small class="muted">${timeAgo(when)}</small></span><span class="pg-hist-what">${what}</span>${fix}</div>`;
  })}</div>`;
}

// The owner turns a membership on by hand, for as long as they like (owner 2026-10-15: «انا ال افعل الاشتراك ب ايديا …
// وعايزك تديني الصلاحية الكاملة اني ادي الفترة ال انا عايزه للمتابع»): a ready period, any number of days, weeks, months
// or years, or up to a day picked on the calendar. Added to what's left when they're already subscribed.
const PERIODS = [[1, 'يوم'], [3, '3 أيام'], [7, 'أسبوع'], [30, 'شهر'], [90, '3 شهور'], [180, '6 شهور'], [365, 'سنة']];
const UNITS = [[1, 'يوم'], [7, 'أسبوع'], [30, 'شهر'], [365, 'سنة']];
const ymd = (ms) => { const d = new Date(ms); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
export function premiumPicker(box, m, onDone) {
  const name = m.display || m.username;
  const active = Number(m.premium_until) > Date.now();
  const base = () => Math.max(Date.now(), Number(m.premium_until) || 0);
  let days = 30, kind = '';
  mount(box, html`<div class="pg">
    <p class="pg-now">${active ? html`${raw(CROWN)} مشترك ${kindTag(m.premium_by)} لحد <b>${date(m.premium_until)}</b> · فاضل ${num(left(m.premium_until))} يوم` : 'مش مشترك دلوقتي'}</p>
    <div class="chips pg-chips">${PERIODS.map(([d, l]) => html`<button type="button" class="chip ${d === 30 ? 'active' : ''}" data-d="${d}">${l}</button>`)}</div>
    <div class="pg-custom">
      <label><span>أو مدة تانية</span><span class="pg-row"><input class="input" type="number" min="1" max="3650" inputmode="numeric" data-pg="n" placeholder="العدد"><select class="input" data-pg="u">${UNITS.map(([d, l]) => html`<option value="${d}">${l}</option>`)}</select></span></label>
      <label><span>أو لحد يوم معيّن</span><input class="input" type="date" data-pg="date" min="${ymd(base() + DAY)}"></label>
    </div>
    <div class="pg-kindpick">
      <span class="pg-lbl">نوع الاشتراك</span>
      <div class="chips pg-kinds"><button type="button" class="chip" data-kind="paid">دفع</button><button type="button" class="chip" data-kind="gift">هدية من الموقع</button></div>
      <div class="pg-pay" data-pg="pay" hidden>
        <label><span>المبلغ</span><span class="pg-row"><input class="input" type="number" min="0" step="any" inputmode="decimal" data-pg="amount" placeholder="مثلا 50"><select class="input" data-pg="cur"><option value="EGP">جنيه</option><option value="USD">دولار</option></select></span></label>
        <label><span>دفع إزاي</span><input class="input" data-pg="method" maxlength="40" placeholder="فودافون كاش، إنستاباي…" list="pg-methods"><datalist id="pg-methods"><option value="فودافون كاش"><option value="إنستاباي"><option value="تحويل بنكي"><option value="اتصالات كاش"><option value="أورنج كاش"></datalist></label>
        <label><span>رقم العملية (لو موجود)</span><input class="input" data-pg="ref" maxlength="60" dir="ltr"></label>
      </div>
      <p class="muted small pg-kind-note" data-pg="kindnote">المشترك بيشوف في صفحة اشتراكه «اشتراك مدفوع» لو دفع، و«هدية من الموقع» لو هدية بس.</p>
    </div>
    <p class="pg-sum" data-pg="sum"></p>
    <div class="pg-acts"><button type="button" class="btn pr-btn" data-pg="go">${raw(CROWN)}${active ? 'زوّد الاشتراك' : 'فعّل الاشتراك'}</button>${active ? html`<button type="button" class="btn btn-ghost" data-pg="off">شيل الاشتراك</button>` : ''}</div>
  </div>`);
  const q = (k) => $(`[data-pg="${k}"]`, box);
  const sum = () => {
    const ok = days >= 1 && days <= 3650;
    q('go').disabled = !ok || !kind;
    q('sum').innerHTML = '';
    mount(q('sum'), ok ? html`هيبقى مشترك لحد <b>${date(base() + days * DAY)}</b> · ${num(days)} يوم${active ? ' زيادة على اللي فاضله' : ''}`
      : html`<span class="pg-bad">${days > 3650 ? 'أقصى مدة 10 سنين.' : 'اختار مدة أو يوم بعد آخر يوم في اشتراكه.'}</span>`);
  };
  const kinds = $$('.pg-kinds .chip', box);
  kinds.forEach(c => c.onclick = () => { kind = c.dataset.kind; kinds.forEach(x => x.classList.toggle('active', x === c)); q('pay').hidden = kind !== 'paid'; sum(); });
  const pay = () => (kind === 'paid' ? { kind, amount: Number(q('amount').value) || 0, currency: q('cur').value, method: q('method').value.trim(), reference: q('ref').value.trim() } : { kind: 'gift' });
  const chips = $$('.pg-chips .chip', box);
  chips.forEach(c => c.onclick = () => { days = Number(c.dataset.d); chips.forEach(x => x.classList.toggle('active', x === c)); q('n').value = ''; q('date').value = ''; sum(); });
  const custom = () => { const n = Math.round(Number(q('n').value) || 0); if (!n) return; days = n * Number(q('u').value); chips.forEach(x => x.classList.remove('active')); q('date').value = ''; sum(); };
  q('n').oninput = custom; q('u').onchange = custom;
  q('date').onchange = () => {
    if (!q('date').value) return;
    const [y, mo, d] = q('date').value.split('-').map(Number);
    const end = new Date(y, mo - 1, d, 23, 59).getTime();
    days = Math.ceil((end - base()) / DAY);
    chips.forEach(x => x.classList.remove('active')); q('n').value = '';
    sum();
  };
  q('go').onclick = async () => {
    const until = base() + days * DAY;
    const p = pay();
    const ok = await dialog({ title: `العضوية المميزة لـ ${name}`, body: html`<p>هيبقى مشترك لحد <b>${date(until)}</b> (${num(days)} يوم${active ? ' زيادة على اللي فاضله' : ''}).</p><p>${p.kind === 'paid' ? html`<b>اشتراك مدفوع</b>${p.amount ? ` · ${money(p.amount, p.currency)}` : ''}${p.method ? ` · ${p.method}` : ''}` : html`<b>هدية من الموقع</b>`}</p><p class="muted small">بياخد كل مميزات العضوية على طول، والعلامة الزرقاء، وبيوصله إشعار قبل ما تخلص.</p>`, confirm: 'فعّل' });
    if (!ok) return;
    q('go').disabled = true;
    try { const r = await api.premiumGrant(m.id, days, p); toast(`اتفعّل لـ ${name} لحد ${date(r.until || until)} ✓`); onDone && onDone(); }
    catch (e) { toast(e.message, 'error'); q('go').disabled = false; }
  };
  if (q('off')) q('off').onclick = async () => {
    const ok = await dialog({ title: `شيل العضوية المميزة من ${name}`, body: html`<p class="muted small">العضوية هتخلص دلوقتي.</p>`, confirm: 'شيلها', danger: true });
    if (!ok) return;
    try { await api.premiumGrant(m.id, 0); toast('اتشالت ✓'); onDone && onDone(); } catch (e) { toast(e.message, 'error'); }
  };
  sum();
}

/** «كان دافع؟ / كانت هدية؟» on a membership turned on by hand: told again, for the member's page too */
export function wirePayHistory(root, onDone) {
  // «تعديل المدة» (owner 2026-10-25): the payment's days, and the member's end date moves by the difference
  $$('.pg-days', root).forEach(b => b.onclick = async () => {
    const was = Number(b.dataset.days) || 30;
    const ok = await dialog({ title: 'تعديل مدة الاشتراك', body: html`<p class="muted small">كانت ${num(was)} يوم. اختار المدة الصح، وآخر يوم في اشتراكه هيتغير بالفرق.</p>
      <div class="chips pg-chips" id="pgd-chips">${PERIODS.filter(([d]) => d >= 7).map(([d, l]) => html`<button type="button" class="chip ${d === was ? 'active' : ''}" data-d="${d}">${l}</button>`)}</div>
      <label class="pg-pay"><span>أو عدد الأيام</span><input class="input" type="number" min="1" max="3650" inputmode="numeric" id="pgd-n" value="${was}"></label>`, confirm: 'احفظ',
      onOpen: () => $$('#pgd-chips .chip').forEach(c => c.onclick = () => { $$('#pgd-chips .chip').forEach(x => x.classList.toggle('active', x === c)); $('#pgd-n').value = c.dataset.d; }) });
    if (!ok) return;
    const days = Math.round(Number(($('#pgd-n') || {}).value) || 0);
    if (!days || days === was) return;
    b.disabled = true;
    try { const r = await api.premiumDays(b.dataset.pay, days); toast(r.until ? `اتعدّلت ✓ اشتراكه لحد ${date(r.until)}` : 'اتعدّلت ✓'); onDone && onDone(); }
    catch (e) { toast(e.message, 'error'); b.disabled = false; }
  });
  // only the «كان دافع؟ / كانت هدية؟» buttons: «تعديل المدة» shares their look (.pg-swap) and opened «كانت هدية من الموقع»
  // instead of its own window (owner 2026-10-25)
  $$('.pg-swap[data-to]', root).forEach(b => b.onclick = async () => {
    const toPaid = b.dataset.to === 'paid';
    let p = { kind: 'gift' };
    if (toPaid) {
      const ok = await dialog({ title: 'كان اشتراك مدفوع', body: html`<div class="pg-pay"><label><span>المبلغ</span><span class="pg-row"><input class="input" type="number" min="0" step="any" inputmode="decimal" id="pgs-amount" placeholder="مثلا 50"><select class="input" id="pgs-cur"><option value="EGP">جنيه</option><option value="USD">دولار</option></select></span></label><label><span>دفع إزاي</span><input class="input" id="pgs-method" maxlength="40" placeholder="فودافون كاش، إنستاباي…"></label></div><p class="muted small">المشترك هيشوفه «اشتراك مدفوع» بدل «هدية من الموقع».</p>`, confirm: 'احفظ' });
      if (!ok) return;
      p = { kind: 'paid', amount: Number(($('#pgs-amount') || {}).value) || 0, currency: ($('#pgs-cur') || {}).value || 'EGP', method: (($('#pgs-method') || {}).value || '').trim() };
    } else {
      const ok = await dialog({ title: 'كانت هدية من الموقع', body: html`<p class="muted small">المشترك هيشوفه «هدية من الموقع» بدل «اشتراك مدفوع».</p>`, confirm: 'احفظ' });
      if (!ok) return;
    }
    b.disabled = true;
    try { await api.premiumKind(b.dataset.pay, p); toast('اتعدّل ✓'); onDone && onDone(); } catch (e) { toast(e.message, 'error'); b.disabled = false; }
  });
}

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
          <p class="muted">50 جنيه أو 1 دولار في الشهر · ${d.live ? 'بتتفعّل لوحدها أول ما فواتيرك تأكد إن المتابع دفع' : 'إنت اللي بتفعّلها بإيدك بعد ما المتابع يدفع'} · كل تجديد بيزوّد على اللي فاضل</p></div>
        <a class="btn" href="/premium/" target="_blank" rel="noopener">${icon('globe')}افتح صفحة العضوية</a>
      </div>
      ${d.live ? '' : html`<div class="alert pr-alert">${icon('alert')}<div><b>التفعيل يدوي، بإيدك إنت بس.</b> زرار الاشتراك في الموقع بيفتح لينكات الدفع بتاعتك على فواتيرك (شهر، 3 شهور، سنة)، والمتابع بيبعتلك سكرين شوت الدفع والإيميل بتاعه على فيسبوك أو إنستجرام، وإنت بتفعّله من هنا تحت بعد ما تتأكد إن الفلوس وصلت. مفيش تجربة مجانية.</div></div>`}
      ${getUser()?.role === 'owner' ? html`<section class="panel cy-sec pg-card"><h2>${raw(CROWN)} فعّل الاشتراك لمتابع بإيدك</h2>
        <p class="muted small">لما المتابع يدفع ويبعتلك على فيسبوك أو إنستجرام، اكتب الإيميل اللي عامل بيه حسابه على الموقع (أو اسم المستخدم بتاعه)، واختار المدة اللي إنت عايزها.</p>
        <form class="pg-find" id="pg-find"><input class="input" id="pg-q" dir="ltr" placeholder="example@gmail.com" autocomplete="off" spellcheck="false" aria-label="إيميل المتابع أو اسم المستخدم"><button class="btn btn-primary">${icon('search')}دوّر</button></form>
        <div id="pg-found"></div></section>` : ''}
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
          <div class="cy-item-main"><div class="cm-meta"><b>${m.display || m.username}</b><span class="muted small"><bdi dir="ltr">@${m.username}</bdi></span>${kindTag(m.premium_by)}</div>
            <small class="muted">لحد ${date(m.premium_until)} · فاضل ${num(left(m.premium_until))} يوم${m.premium_since ? ` · مشترك من ${date(m.premium_since)}` : ''}</small></div>
          <a class="btn btn-sm btn-ghost" href="#/site-members/${m.id}">صفحته</a></article>`)}</div>` : html`<p class="muted">لسه محدش اشترك.</p>`}
      </section>

      <section class="panel cy-sec"><h2>${icon('check')} المدفوعات</h2>
        ${(d.payments || []).length ? html`<div class="cy-list">${d.payments.map(p => html`<article class="cy-item pr-pay">
          <div class="cy-item-main"><div class="cm-meta"><b>${p.display || p.username || `عضو ${p.member}`}</b><span class="muted small">${timeAgo(p.paid_at)}</span></div>
            <small class="muted">${p.granted_by === 'trial' ? `تجربة مجانية · ${num(p.days)} أيام` : handPaid(p.granted_by) ? `دفع مباشر${p.method ? ` · ${p.method}` : ''} · فعّلها ${handBy(p.granted_by)} · ${num(p.days)} يوم` : p.granted_by ? `هدية من ${p.granted_by} · ${num(p.days)} يوم` : `${money(p.amount, p.currency)}${p.method ? ` · ${p.method}` : ''}${p.reference ? ` · رقم العملية ${p.reference}` : ''}`}</small></div>
          <span class="pr-amt">${p.granted_by === 'trial' ? 'تجربة' : handPaid(p.granted_by) ? (p.amount ? money(p.amount, p.currency) : 'مدفوع') : p.granted_by ? 'هدية' : money(p.amount, p.currency)}</span></article>`)}</div>` : html`<p class="muted">لسه مفيش مدفوعات.</p>`}
      </section>
    </div>`);

  const find = $('#pg-find', page);
  if (find) find.onsubmit = async (e) => {
    e.preventDefault();
    const box = $('#pg-found', page), btn = $('button', find);
    btn.disabled = true;
    try {
      const { member: m } = await api.premiumFind($('#pg-q', page).value);
      mount(box, html`<div class="pg-who">
        ${av(m)}
        <div><div class="cm-meta"><b>${m.display || m.username}</b><span class="muted small"><bdi dir="ltr">@${m.username}</bdi></span>${m.banned ? html`<em class="mb-flag">موقوف</em>` : ''}${m.official ? html`<em class="pr-official">الحساب الرسمي</em>` : ''}</div>
          <small class="muted"><bdi dir="ltr">${m.email}</bdi></small></div>
        <a class="btn btn-sm btn-ghost" href="#/site-members/${m.id}">صفحته</a></div><div class="pg-box"></div>`);
      if (m.official) mount($('.pg-box', box), html`<p class="muted">الحساب الرسمي ليه كل المميزات على طول.</p>`);
      else premiumPicker($('.pg-box', box), m, () => renderPremium(page));
    } catch (err) { mount(box, html`<p class="pg-bad">${err.message}</p>`); }
    btn.disabled = false;
  };
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
