// The site's members (owner 2026-10-14: «نظام التسجيل للمتابعيين»), in the panel: who signed up, when, from where,
// how much they comment; a member can be stopped (signed out, can't sign in or comment) and brought back. The
// accounts themselves: worker/src/members.ts.
import { api, getUser } from '../api.js';
import { html, raw, mount, $, $$, icon, toast, dialog, timeAgo, num, normalizeArabic, debounce } from '../ui.js';
import { premiumPicker, kindTag, payHistory, wirePayHistory } from './premium.js';
import { memberSquare } from '../image.js';

const COLORS = ['#0e9594', '#ff5a36', '#d98b12', '#7c6ee8', '#2b8fd6', '#c73b2c', '#2f9e5b'];
const colorOf = (name) => { let h = 0; for (const ch of String(name)) h = (h * 31 + ch.charCodeAt(0)) >>> 0; return COLORS[h % COLORS.length]; };
const initial = (name) => (String(name).trim().replace(/^ال(?=\S{2})/, '').match(/\S/) || ['؟'])[0].toUpperCase();
const AV = (import.meta.url.match(/\/admin\/([^/]+)\/js\//) || [])[1] || '';
const picSrc = (pic) => { pic = String(pic || ''); return pic === 'official' ? '/assets/brand-logo.png' : /^w:[a-z0-9-]+$/.test(pic) ? `/avatars/${pic.slice(2)}.webp${AV ? `?v=${AV}` : ''}` : /^https:\/\//.test(pic) ? pic : ''; };
const flagOf = (cc) => (/^[A-Z]{2}$/.test(cc || '') ? String.fromCodePoint(...[...cc].map(ch => 0x1f1e6 + ch.charCodeAt(0) - 65)) : '');
const date = (ms) => new Date(ms).toLocaleDateString('ar-EG-u-nu-latn', { day: 'numeric', month: 'long', year: 'numeric' });

const BLUE = '<svg class="mb-blue" viewBox="0 0 24 24" width="15" height="15" aria-hidden="true"><path fill="#1d9bf0" d="M22.5 12.5c0-1.58-.88-2.95-2.15-3.6.15-.44.23-.92.23-1.4 0-2.21-1.71-4-3.82-4-.47 0-.92.08-1.34.25C14.79 2.5 13.47 1.5 12 1.5s-2.79 1-3.42 2.25c-.42-.17-.87-.25-1.34-.25-2.11 0-3.82 1.79-3.82 4 0 .48.08.96.23 1.4-1.27.65-2.15 2.02-2.15 3.6 0 1.5.8 2.8 1.98 3.47-.03.17-.04.35-.04.53 0 2.21 1.71 4 3.82 4 .47 0 .92-.09 1.34-.25.63 1.25 1.95 2.25 3.42 2.25s2.79-1 3.42-2.25c.42.16.87.25 1.34.25 2.11 0 3.82-1.79 3.82-4 0-.18-.01-.36-.04-.53 1.18-.67 1.98-1.97 1.98-3.47z"/><path fill="#fff" d="M10.54 16.4 6.8 12.66l1.41-1.42 2.33 2.33 5.25-5.25 1.42 1.41z"/></svg>';
const GOLD = '<svg class="mb-blue mb-gold" viewBox="0 0 24 24" width="15" height="15" aria-hidden="true"><defs><linearGradient id="arwGoldM" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#ffd25a"/><stop offset="1" stop-color="#e09a12"/></linearGradient></defs><path fill="url(#arwGoldM)" d="M22.5 12.5c0-1.58-.88-2.95-2.15-3.6.15-.44.23-.92.23-1.4 0-2.21-1.71-4-3.82-4-.47 0-.92.08-1.34.25C14.79 2.5 13.47 1.5 12 1.5s-2.79 1-3.42 2.25c-.42-.17-.87-.25-1.34-.25-2.11 0-3.82 1.79-3.82 4 0 .48.08.96.23 1.4-1.27.65-2.15 2.02-2.15 3.6 0 1.5.8 2.8 1.98 3.47-.03.17-.04.35-.04.53 0 2.21 1.71 4 3.82 4 .47 0 .92-.09 1.34-.25.63 1.25 1.95 2.25 3.42 2.25s2.79-1 3.42-2.25c.42.16.87.25 1.34.25 2.11 0 3.82-1.79 3.82-4 0-.18-.01-.36-.04-.53 1.18-.67 1.98-1.97 1.98-3.47z"/><path fill="#fff" d="M10.54 16.4 6.8 12.66l1.41-1.42 2.33 2.33 5.25-5.25 1.42 1.41z"/></svg>';
const OFFICIAL_NAME = 'عرب راسلنج';
const CROWN = '<svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor" aria-hidden="true"><path d="M3 8.5 7.5 12 12 5l4.5 7L21 8.5 19 18H5z"/><rect x="5" y="19.5" width="14" height="2" rx="1"/></svg>';
const isPrem = (m) => Number(m.premium_until) > Date.now();
/** A member as the site shows them: the site's own account is «عرب راسلنج», its logo and the gold badge */
const shownName = (m) => (m.official ? OFFICIAL_NAME : m.display || m.username);
const badgeOf = (m) => raw(m.official || m.badge === 2 ? GOLD : m.badge === 0 ? '' : BLUE);
const isOwner = () => getUser()?.role === 'owner';
/** The owner gives the verification badge or takes it away (owner 2026-10-14: «ادي العلامة الزرقاء التوثيق لاي حد او اشيله») */
// …and the gold one too, for anyone (owner 2026-10-15: «احط علامة توثيق ذهبي كمان او اشيلها لاي حد»): three choices
const BADGES = [[0, 'من غير', ''], [1, 'أزرق', BLUE], [2, 'ذهبي', GOLD]];
const badgeBtn = (m, cls = 'btn-sm') => (isOwner() && !m.official ? html`<span class="mb-badge-seg ${cls === 'btn-sm' ? 'is-sm' : ''}" role="group" aria-label="التوثيق">${BADGES.map(([lv, label, ic]) => html`<button type="button" class="${(m.badge ?? 1) === lv ? 'is-on' : ''}" data-badge="${m.id}" data-level="${lv}" title="${lv === 0 ? 'من غير توثيق' : `توثيق ${label}`}">${ic ? raw(ic) : ''}${label}</button>`)}</span>` : '');
const BADGE_DONE = ['اتشال التوثيق ✓', 'خد التوثيق الأزرق ✓', 'خد التوثيق الذهبي ✓'];
const FED_NAME = { WWE: 'WWE', AEW: 'AEW', NJPW: 'NJPW', TNA: 'TNA', ROH: 'ROH', MLP: 'MLP', CMLL: 'CMLL', UFC: 'UFC' };
const REGION = (() => { try { return new Intl.DisplayNames(['ar'], { type: 'region' }); } catch { return null; } })();
const countryName = (cc) => { try { return (REGION && /^[A-Z]{2}$/.test(cc || '') && REGION.of(cc)) || ''; } catch { return ''; } };
const dateTime = (ms) => new Date(ms).toLocaleString('ar-EG-u-nu-latn', { day: 'numeric', month: 'long', year: 'numeric', hour: 'numeric', minute: '2-digit' });
/** A device in plain words, from its browser's signature */
function device(ua) {
  ua = String(ua || '');
  const os = /iPhone/.test(ua) ? 'آيفون' : /iPad/.test(ua) ? 'آيباد' : /Android/.test(ua) ? 'أندرويد' : /Windows/.test(ua) ? 'ويندوز' : /Mac OS X/.test(ua) ? 'ماك' : /Linux/.test(ua) ? 'لينكس' : 'جهاز';
  const br = /Edg\//.test(ua) ? 'Edge' : /OPR\//.test(ua) ? 'Opera' : /SamsungBrowser/.test(ua) ? 'Samsung Internet' : /Chrome\//.test(ua) ? 'Chrome' : /Firefox\//.test(ua) ? 'Firefox' : /Safari\//.test(ua) ? 'Safari' : '';
  return br ? `${os} · ${br}` : os;
}
/** Every member in a file Excel opens (UTF-8 with its mark, so Arabic reads right) */
function exportCsv(items) {
  const cols = [['id', 'رقم'], ['username', 'اسم المستخدم'], ['display', 'الاسم الظاهر'], ['email', 'البريد'], ['verified', 'متفعّل'], ['created', 'تاريخ التسجيل'], ['last_seen', 'آخر ظهور'], ['comments', 'التعليقات'], ['country', 'البلد'], ['ip', 'IP'], ['banned', 'موقوف']];
  // a name that starts like a formula stays text in Excel
  const cell = (v) => { const s = String(v ?? ''); return `"${(/^[=+\-@\t\r]/.test(s) ? "'" + s : s).replace(/"/g, '""')}"`; };
  const rows = items.map(m => cols.map(([k]) => cell(k === 'created' || k === 'last_seen' ? (m[k] ? new Date(m[k]).toISOString().replace('T', ' ').slice(0, 16) : '') : k === 'verified' || k === 'banned' ? (m[k] ? 'نعم' : 'لا') : m[k])).join(','));
  const csv = '\ufeff' + [cols.map(([, l]) => cell(l)).join(','), ...rows].join('\r\n');
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
  a.download = `أعضاء-عرب-راسلنج-${new Date().toISOString().slice(0, 10)}.csv`;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}

const FILTERS = [['all', 'الكل'], ['week', 'الجداد'], ['active', 'نشطين'], ['banned', 'موقوفين']];
const state = { q: '', filter: 'all' };

function row(m) {
  const pic = m.official ? 'official' : m.pic;
  return html`<article class="mb-row ${m.banned ? 'is-banned' : ''} ${m.official ? 'is-official' : ''}" data-id="${m.id}">
    <a class="mb-open" href="#/site-members/${m.id}" aria-label="تفاصيل ${shownName(m)}"></a>
    <span class="cm-av" style="--c:${colorOf(shownName(m))}" aria-hidden="true">${picSrc(pic) ? html`<img src="${picSrc(pic)}" alt="" loading="lazy">` : initial(shownName(m))}</span>
    <div class="mb-main">
      <div class="cm-meta"><b>${shownName(m)}</b>${badgeOf(m)}<span class="mb-user" dir="ltr">@${m.username}</span>${m.banned ? html`<em class="mb-flag">موقوف</em>` : ''}${isPrem(m) ? html`<em class="mb-gold-tag pr-tag" title="${`لحد ${dateTime(m.premium_until)}`}">${raw(CROWN)}مميز</em>${kindTag(m.premium_by)}<em class="pg-until">لحد ${date(m.premium_until)}</em>` : ''}${m.official ? '' : m.verified ? html`<em class="mb-ok" title="فعّل حسابه من بريده">${icon('check')}متفعّل</em>` : html`<em class="mb-wait" title="لسه مضغطش رابط التفعيل اللي في بريده">مش متفعّل</em>`}</div>
      <div class="mb-facts">
        ${realName(m) && realName(m) !== shownName(m) ? html`<span>${realName(m)}</span>` : ''}
        <span dir="ltr">${m.email}</span>
        <span>انضم ${date(m.created)}</span>
        <span>آخر ظهور ${m.last_seen ? timeAgo(m.last_seen) : '—'}</span>
        <span>${num(m.comments || 0)} تعليق</span>
        ${m.country ? html`<span>${flagOf(m.country)} <span dir="ltr">${m.ip || ''}</span></span>` : ''}
      </div>
    </div>
    <div class="cm-actions">
      ${m.official ? html`<em class="mb-gold-tag">حسابك الرسمي</em>` : html`${badgeBtn(m)}<button class="btn btn-sm ${m.banned ? '' : 'btn-danger-soft'}" data-ban="${m.id}" data-on="${m.banned ? '0' : '1'}">${m.banned ? 'رجّعه' : 'وقّفه'}</button>`}
    </div>
  </article>`;
}

// the member's real name, asked first at sign-up since 2026-10-18 (worker/src/members.ts cleanPersonName)
const realName = (m) => `${m.first_name || ''} ${m.last_name || ''}`.trim();
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
          <p class="muted">كل اللي عملوا حساب على الموقع · العضو بيعلّق باسمه وصورته · علامة التوثيق إنت اللي بتديها · دوس على أي عضو تشوف كل تفاصيله</p></div>
        <div class="mb-head-btns"><a class="btn pr-btn" href="#/premium">${raw(CROWN)}العضوية المميزة</a><button class="btn" id="mb-export">${icon('download')}تصدير Excel</button></div>
      </div>
      ${getUser()?.role === 'owner' ? html`<section class="card mb-off" id="mb-off"></section>` : ''}
      <div class="cm-stats">
        <div><small>كل الأعضاء</small><b>${num(counts.total || items.length)}</b></div>
        <div class="${counts.week ? 'is-new' : ''}"><small>جداد آخر 7 أيام</small><b>${num(counts.week || 0)}</b></div>
        <div><small>نشطين آخر 7 أيام</small><b>${num(counts.active || 0)}</b></div>
        <div><small>موقوفين</small><b id="mb-banned-n">${num(items.filter(m => m.banned).length)}</b></div>
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
      return !q || normalizeArabic(`${m.display} ${m.first_name || ''} ${m.last_name || ''} ${m.username} ${m.email}`).includes(q);
    });
    if ($('#mb-banned-n')) $('#mb-banned-n').textContent = num(items.filter(m => m.banned).length);
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
  $('#mb-list').addEventListener('click', async (e) => {
    const b = e.target.closest('[data-badge]');
    if (!b) return;
    const m = items.find(x => String(x.id) === b.dataset.badge);
    const lv = Number(b.dataset.level);
    if (lv === m.badge) return;
    b.disabled = true;
    try { await api.siteMemberBadge(m.id, lv > 0, lv); m.badge = lv; toast(BADGE_DONE[lv]); draw(); }
    catch (err) { toast(err.message, 'error'); b.disabled = false; }
  });
  draw();
  if ($('#mb-off')) officialCard($('#mb-off'));
  $('#mb-export').onclick = () => exportCsv(items);
  $('#mb-q').oninput = debounce((e) => { state.q = e.target.value; draw(); }, 150);
  $$('#mb-filters .chip').forEach(c => c.onclick = () => { state.filter = c.dataset.f; $$('#mb-filters .chip').forEach(x => x.classList.toggle('active', x === c)); draw(); });
}

/** One member: everything about them (studio #/site-members/<id>) */
export async function renderSiteMember(page, id) {
  mount(page, html`<div class="loading-page"><div class="spinner"></div></div>`);
  let d;
  try { d = await api.siteMember(id); } catch (e) { mount(page, html`<div class="empty"><h2>العضو ده مش موجود</h2><a class="btn" href="#/site-members">كل الأعضاء</a></div>`); return; }
  const m = d.member;
  const name = shownName(m);
  if (m.official) m.pic = 'official';
  const fact = (label, value, extra = '') => html`<div class="mb-fact"><small>${label}</small><b ${extra}>${value || '—'}</b></div>`;
  mount(page, html`
    <div class="wrap page-in">
      <a href="#/site-members" class="back mb-back">${icon('arrowRight')} الأعضاء</a>
      <section class="mb-card">
        <span class="cm-av mb-av" style="--c:${colorOf(name)}" aria-hidden="true">${picSrc(m.pic) ? html`<img src="${picSrc(m.pic)}" alt="">` : initial(name)}</span>
        <div class="mb-card-tx">
          <h1>${name} ${badgeOf(m)}</h1>
          <p class="muted"><span dir="ltr">@${m.username}</span></p>
          <p>${m.official ? html`<em class="mb-gold-tag">الحساب الرسمي للموقع</em>` : m.banned ? html`<em class="mb-flag">موقوف</em>` : html`<em class="mb-ok">${icon('check')}حساب شغال</em>`}</p>
        </div>
        ${m.official ? '' : html`<div class="mb-card-acts">${isOwner() ? html`<a class="btn pr-btn" href="#mb-prem" id="mb-prem-go">${raw(CROWN)}${isPrem(m) ? 'زوّد الاشتراك' : 'فعّل الاشتراك'}</a>` : ''}${badgeBtn(m, '')}${isOwner() ? html`<button class="btn btn-ghost" id="mb-edit">${icon('edit')}عدّل بياناته</button>` : ''}<button class="btn ${m.banned ? '' : 'btn-danger-soft'}" id="mb-ban">${m.banned ? 'رجّعه' : 'وقّفه'}</button></div>`}
      </section>
      <div class="mb-facts-grid">
        ${fact('الاسم', realName(m) || html`<span class="muted">اتسجل قبل ما الاسم يتطلب</span>`)}
        ${fact('البريد', html`<span dir="ltr">${m.email}</span>`)}
        ${fact('الحساب متفعّل؟', m.verified ? 'أيوه، من بريده' : html`<span class="mb-wait">لسه</span> <button class="btn btn-sm" id="mb-verify">فعّله بإيدك</button>`)}
        ${fact('اتسجل', dateTime(m.created))}
        ${fact('آخر ظهور', m.last_seen ? `${timeAgo(m.last_seen)} · ${dateTime(m.last_seen)}` : '')}
        ${fact('البلد', m.country ? `${flagOf(m.country)} ${countryName(m.country)}` : '')}
        ${fact('IP وقت التسجيل', m.ip, 'dir="ltr"')}
        ${fact('الاتحاد المفضل', FED_NAME[m.fav_fed] || '')}
        ${fact('النجم المفضل', m.fav_star)}
        ${fact('التعليقات', num(d.comments.filter(c => !c.deleted).length))}
        ${fact('قلوب من الموقع', num(d.hearts || 0))}
        ${m.official ? '' : fact('العضوية المميزة', isPrem(m) ? html`${kindTag(m.premium_by)} لحد ${dateTime(m.premium_until)}` : 'مش مشترك')}
      </div>
      ${!m.official ? html`<section class="panel mb-sec" id="mb-prem"><h2>${raw(CROWN)} العضوية المميزة</h2>
        ${isOwner() ? html`<div id="mb-prem-box"></div>` : html`<p class="pg-now">${isPrem(m) ? html`مشترك ${kindTag(m.premium_by)} لحد <b>${dateTime(m.premium_until)}</b>` : 'مش مشترك دلوقتي'}</p>`}
        <h3 class="pg-h3">سجل الاشتراك والدفع</h3>${payHistory(d.payments)}</section>` : ''}
      ${m.bio ? html`<section class="panel mb-sec"><h2>النبذة</h2><p>${m.bio}</p></section>` : ''}
      <section class="panel mb-sec"><h2>الأجهزة اللي داخل منها (${num(d.sessions.length)})</h2>
        ${d.sessions.length ? html`<ul class="mb-devices">${d.sessions.map(s => html`<li><b>${device(s.ua)}</b><span class="muted">من ${dateTime(s.created)}</span></li>`)}</ul>` : html`<p class="muted">مش داخل من أي جهاز دلوقتي.</p>`}
      </section>
      <section class="panel mb-sec"><h2>تعليقاته (${num(d.comments.length)})</h2>
        ${d.comments.length ? html`<div class="mb-comments">${d.comments.map(c => html`<a class="mb-comment ${c.deleted ? 'is-deleted' : ''}" href="${c.path}#c-${c.id}" target="_blank" rel="noopener">
          <p>${c.text}</p><small class="muted">${c.parent ? 'رد · ' : ''}${c.title || c.path} · ${timeAgo(c.at)}${c.deleted ? ' · اتحذف' : ''}${c.hearted ? ' · ❤' : ''}</small></a>`)}</div>`
          : html`<p class="muted">لسه ماعلّقش.</p>`}
      </section>
    </div>`);
  // any period the owner likes (views/premium.js)
  if ($('#mb-prem-box', page)) premiumPicker($('#mb-prem-box', page), m, () => renderSiteMember(page, id));
  if (isOwner() && $('#mb-prem', page)) wirePayHistory($('#mb-prem', page), () => renderSiteMember(page, id));
  const pg = $('#mb-prem-go', page);
  if (pg) pg.onclick = (e) => { e.preventDefault(); $('#mb-prem', page).scrollIntoView({ behavior: 'smooth', block: 'center' }); };
  const vb = $('#mb-verify', page);
  if (vb) vb.onclick = async () => {
    const ok = await dialog({ title: `تفعيل حساب ${name}`, body: html`<p class="muted small">الحساب هيتفتح من غير ما يضغط رابط التفعيل اللي في بريده. استخدمها لو الرسالة موصلتلوش.</p>`, confirm: 'فعّله' });
    if (!ok) return;
    try { await api.siteMemberVerify(m.id); toast('اتفعّل ✓'); renderSiteMember(page, id); }
    catch (e) { toast(e.message, 'error'); }
  };
  $$('[data-badge]', page).forEach(bb => bb.onclick = async () => {
    const lv = Number(bb.dataset.level);
    if (lv === m.badge) return;
    bb.disabled = true;
    try { await api.siteMemberBadge(m.id, lv > 0, lv); toast(BADGE_DONE[lv]); renderSiteMember(page, id); }
    catch (e) { toast(e.message, 'error'); bb.disabled = false; }
  });
  // everything of a member, by the owner only (owner 2026-10-15: «اعدل اي حاجة للاعضاء المتابعين اسمه صورته اي حاجة
  // ايميله باورده»): the shown name, the username, the e-mail, a new password, the picture, the about, the favourites
  if ($('#mb-edit')) $('#mb-edit').onclick = async () => {
    const box = html`<div class="mb-edit">
      <div class="mb-edit-pic-row">
        <span class="cm-av mb-edit-av" id="me-av" style="--c:${colorOf(name)}">${picSrc(m.pic) ? html`<img src="${picSrc(m.pic)}" alt="">` : initial(name)}</span>
        <div class="mb-edit-pic-acts">
          <label class="btn btn-sm">${icon('image')}ارفع صورة<input type="file" accept="image/*" id="me-file" hidden></label>
          <button type="button" class="btn btn-sm btn-ghost" id="me-nopic" ${m.pic ? '' : 'hidden'}>شيل الصورة</button>
          <small class="muted" id="me-pic-note"></small>
        </div>
      </div>
      <label class="field"><span>الاسم الظاهر</span><input class="input" id="me-display" maxlength="30" value="${m.display || m.username}" dir="auto"></label>
      <label class="field"><span>اسم المستخدم</span><input class="input" id="me-user" maxlength="20" value="${m.username}" dir="ltr" autocomplete="off"><small class="muted">حروف وأرقام، يبدأ بحرف، ومسموح بـ _ و . — رابط صفحته بيتغير معاه.</small></label>
      <label class="field"><span>البريد</span><input class="input" id="me-email" type="email" maxlength="254" value="${m.email || ''}" dir="ltr" autocomplete="off"><small class="muted">بيتغير على طول ويتحسب متأكد منه.</small></label>
      <label class="field"><span>كلمة سر جديدة</span><div class="mb-edit-pw"><input class="input" id="me-pass" type="text" maxlength="200" dir="ltr" autocomplete="new-password" placeholder="سيبها فاضية لو مش هتغيرها"><button type="button" class="btn btn-sm btn-ghost" id="me-gen">اعمل واحدة</button></div><small class="muted">8 حروف على الأقل فيها حروف وأرقام. هيخرج من كل أجهزته ويدخل بيها.</small></label>
      <label class="field"><span>النبذة</span><textarea class="input" id="me-bio" rows="2" maxlength="160" dir="auto">${m.bio || ''}</textarea></label>
      <label class="field"><span>الاتحاد المفضل</span><select class="input" id="me-fed"><option value="">—</option>${Object.keys(FED_NAME).map(k => html`<option value="${k}" ${m.fav_fed === k ? 'selected' : ''}>${FED_NAME[k]}</option>`)}</select></label>
      <label class="field"><span>النجم المفضل</span><input class="input" id="me-star" maxlength="40" value="${m.fav_star || ''}" dir="auto"></label>
      <label class="mb-edit-pic"><input type="checkbox" id="me-out"> اخرجه من كل الأجهزة</label>
    </div>`;
    let image = '', nopic = false;
    const asked = dialog({ title: `تعديل بيانات ${name}`, body: box, confirm: 'احفظ' });
    // the dialog is on the page now: its picture buttons
    const file = $('#me-file'), note = $('#me-pic-note'), av = $('#me-av'), np = $('#me-nopic');
    file.onchange = async () => {
      const f = file.files[0]; file.value = '';
      if (!f) return;
      note.textContent = 'لحظة…';
      try {
        image = await memberSquare(f); nopic = false;
        av.innerHTML = ''; const im = document.createElement('img'); im.src = image; im.alt = ''; av.appendChild(im);
        note.textContent = 'هتتحفظ لما تدوس احفظ'; np.hidden = false;
      } catch (e) { note.textContent = e.message; }
    };
    np.onclick = () => { image = ''; nopic = true; av.textContent = initial(name); note.textContent = 'الصورة هتتشال لما تدوس احفظ'; np.hidden = true; };
    $('#me-gen').onclick = () => { $('#me-pass').value = newPassword(); };
    const vals = () => ({ display: $('#me-display').value, username: $('#me-user').value.trim(), email: $('#me-email').value.trim(), password: $('#me-pass').value, bio: $('#me-bio').value, fav_fed: $('#me-fed').value, fav_star: $('#me-star').value, signout: $('#me-out').checked });
    // what was typed is read as the dialog closes (it leaves the page a moment later)
    if (!(await asked)) return;
    const body = vals();
    if (!body.password) delete body.password;
    if (image) body.image = image; else if (nopic) body.pic = '';
    try {
      const r = await api.siteMemberEdit(m.id, body);
      toast('اتحفظ ✓');
      if (body.password) await dialog({ title: 'كلمة السر الجديدة', body: html`<p class="muted small">ابعتهاله عشان يدخل بيها (خرج من كل أجهزته):</p><p class="mb-newpass" dir="ltr">${body.password}</p>`, confirm: 'تمام', cancel: '' });
      else if (r && r.changed && r.changed.email) toast('البريد اتغير، وخرج من أجهزته عشان يدخل تاني');
      renderSiteMember(page, id);
    } catch (e) { toast(e.message, 'error'); }
  };
  if ($('#mb-ban')) $('#mb-ban').onclick = async () => {
    const on = !m.banned;
    const ok = await dialog({ title: on ? `توقيف ${name}` : `رجوع ${name}`, body: html`<p class="muted small">${on ? 'هيخرج من حسابه على كل الأجهزة، ومش هيقدر يدخل ولا يعلّق باسمه لحد ما ترجّعه.' : 'هيقدر يدخل حسابه ويعلّق تاني.'}</p>`, confirm: on ? 'وقّفه' : 'رجّعه', danger: on });
    if (!ok) return;
    try { await api.siteMemberBan(m.id, on); toast(on ? 'اتوقف ✓' : 'رجع ✓'); renderSiteMember(page, id); }
    catch (e) { toast(e.message, 'error'); }
  };
}

/** A strong password to start with (letters and digits that can't be mistaken) */
function newPassword() {
  const A = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const b = crypto.getRandomValues(new Uint8Array(14));
  let p = Array.from(b, x => A[x % A.length]).join('');
  if (!/\d/.test(p)) p = p.slice(0, -1) + '7';
  return p;
}
/** «حسابك الرسمي على الموقع» (owner 2026-10-14: «اعملي عضوية بتاعتي بتاعت الموقع اقدر افتحه في الموقع موثقة العلامة
 *  الذهبي باسمي زي ال انت عاملهالي في اللوحة بالظبط»): the owner signs in on the site with it and comments as «عرب راسلنج»,
 *  with the logo and the gold badge, exactly as the replies written here. Only the owner sees and changes it. */
async function officialCard(box, opened = false, done = null) {
  let acc = null;
  try { acc = (await api.siteOfficial()).account; } catch (e) { mount(box, html`<div class="card-body"><p class="muted">${e.message}</p></div>`); return; }
  const head = html`<header class="card-head"><h2><img class="mb-off-logo" src="/assets/brand-logo.png" alt=""> حسابك الرسمي على الموقع ${raw(GOLD)}</h2></header>`;
  if (!opened) {
    mount(box, html`${head}<div class="card-body mb-off-body">
      ${acc ? html`<div class="mb-off-tx">
          <p>بتدخل بيه من <b>arab-wrestling.com/account</b> وتعلّق وترد على المتابعين باسم <b>«عرب راسلنج»</b> وجنبه العلامة الذهبية، بالظبط زي ردودك من هنا.</p>
          <p class="muted small"><bdi dir="ltr">@${acc.username}</bdi> · <bdi dir="ltr">${acc.email}</bdi> · ${acc.last_seen ? `آخر دخول ${timeAgo(acc.last_seen)}` : 'لسه مدخلتش بيه'}</p>
          ${done ? html`<div class="mb-off-done">${icon('check')} <span>اتحفظ. ادخل بيه على الموقع باسم المستخدم <bdi dir="ltr"><b>${acc.username}</b></bdi> أو الإيميل${done.password ? html`، وكلمة السر: <bdi dir="ltr"><code>${done.password}</code></bdi> <button type="button" class="btn btn-sm" id="mb-off-copy">${icon('copy')}انسخها</button>` : ''}</span></div>` : ''}
        </div>
        <div class="mb-off-actions"><a class="btn" href="/account/" target="_blank" rel="noopener">${icon('globe')}افتح صفحة الحساب</a><button class="btn" id="mb-off-edit">${icon('edit')}غيّر البيانات أو كلمة السر</button></div>`
      : html`<div class="mb-off-tx">
          <p>اعمل حساب تدخل بيه على الموقع نفسه، وتعلّق وترد على المتابعين باسم <b>«عرب راسلنج»</b> وصورة اللوجو وجنبه <b>العلامة الذهبية</b>، بالظبط زي ردودك من هنا.</p>
          <p class="muted small">الحساب ده بتاعك لوحدك، ومحدش من الأعضاء يقدر ياخد الاسم ده.</p>
        </div>
        <div class="mb-off-actions"><button class="btn btn-primary" id="mb-off-edit">${icon('plus')}اعمل الحساب</button></div>`}
    </div>`);
    $('#mb-off-edit', box).onclick = () => officialCard(box, true);
    const cp = $('#mb-off-copy', box);
    if (cp) cp.onclick = () => navigator.clipboard.writeText(done.password).then(() => toast('اتنسخت ✓')).catch(() => {});
    return;
  }
  const pass = acc ? '' : newPassword();
  mount(box, html`${head}<form class="card-body fields" id="mb-off-form" novalidate>
    <div class="row-2">
      <label class="field"><span>اسم المستخدم <em>بتدخل بيه</em></span><input class="input" name="username" dir="ltr" autocapitalize="off" spellcheck="false" value="${acc ? acc.username : 'ArabWrestling'}"></label>
      <label class="field"><span>الإيميل <em>بتدخل بيه برضه</em></span><input class="input" name="email" type="email" dir="ltr" value="${acc ? acc.email : 'contact@arab-wrestling.com'}"></label>
    </div>
    <label class="field"><span>كلمة السر ${acc ? html`<em>سيبها فاضية لو مش عايز تغيّرها</em>` : html`<em>اتعملت قوية، وتقدر تكتب غيرها</em>`}</span>
      <div class="input-ico">${icon('lock')}<input class="input" name="password" dir="ltr" autocomplete="new-password" value="${pass}"><button type="button" class="input-btn" id="mb-off-gen" title="واحدة جديدة">${icon('refresh')}</button></div>
      <small class="muted">٨ حروف على الأقل، فيها حروف وأرقام.${acc ? ' لو غيّرتها هتخرج من الحساب على كل الأجهزة.' : ''}</small></label>
    <p class="mb-off-err" id="mb-off-err" hidden></p>
    <div class="mb-off-actions"><button class="btn btn-primary" type="submit">${acc ? 'احفظ' : 'اعمل الحساب'}</button><button class="btn btn-ghost" type="button" id="mb-off-cancel">إلغاء</button></div>
  </form>`);
  const f = $('#mb-off-form', box);
  $('#mb-off-gen', box).onclick = () => { f.elements.password.value = newPassword(); };
  $('#mb-off-cancel', box).onclick = () => officialCard(box);
  f.onsubmit = async (e) => {
    e.preventDefault();
    const body = { username: f.elements.username.value.trim(), email: f.elements.email.value.trim() };
    const password = f.elements.password.value.trim();
    if (password) body.password = password;
    const btn = f.querySelector('[type=submit]');
    btn.disabled = true;
    try {
      await api.siteOfficialSave(body);
      toast(acc ? 'اتحفظ ✓' : 'حسابك الرسمي اتعمل ✓');
      officialCard(box, false, { password });
    } catch (err) {
      const el = $('#mb-off-err', box);
      el.textContent = err.message; el.hidden = false;
      btn.disabled = false;
    }
  };
}
