// Account & security: password, signed-in devices, login history.
import { api, saveSession, clearSession, getUser, updateUser, IS_LOCAL } from '../api.js';
import { html, mount, $, icon, toast, dialog, timeAgo, fmtDate, avatarInner } from '../ui.js';
import { avatarDataUrl } from '../image.js';

function device(ua = '') {
  const os = /iPhone|iPad/.test(ua) ? 'آيفون' : /Android/.test(ua) ? 'أندرويد' : /Mac OS/.test(ua) ? 'ماك' : /Windows/.test(ua) ? 'ويندوز' : /Linux/.test(ua) ? 'لينكس' : 'جهاز';
  const br = /Edg\//.test(ua) ? 'إيدج' : /Chrome\//.test(ua) ? 'كروم' : /Safari\//.test(ua) ? 'سفاري' : /Firefox\//.test(ua) ? 'فايرفوكس' : '';
  return [os, br].filter(Boolean).join(' · ');
}
const EVENTS = { login: 'دخول ناجح', failed: 'محاولة فاشلة', setup: 'إنشاء الحساب', reset: 'تغيير كلمة السر' };

export async function renderSettings(page) {
  const user = getUser() || {};
  mount(page, html`
    <div class="wrap page-in">
    <div class="page-title"><div><h1>الإعدادات والأمان</h1><p class="muted">حسابك والأجهزة اللي داخلة بيه.</p></div></div>
    <div class="grid-2">
      <section class="card"><header class="card-head"><h2>${icon('user')} الحساب</h2></header>
        <div class="card-body"><div class="acct"><span class="avatar avatar-lg" id="acct-avatar">${avatarInner(user)}</span><div><b>${user.displayName || user.username || ''}</b><small class="muted">${user.email || ''}</small></div></div>
        <div class="avatar-actions">
          <label class="btn btn-sm">${icon('image')} ${user.avatar ? 'تغيير الصورة' : 'إضافة صورة'}<input type="file" accept="image/*" id="avatar-file" hidden></label>
          ${user.avatar ? html`<button type="button" class="btn btn-sm btn-danger" id="avatar-remove">${icon('trash')} إزالة</button>` : ''}
        </div>
        <p class="muted small">تقدر تدخل باسم المستخدم أو بالإيميل.</p>
        <form id="name-form" class="name-form">
          <label class="field"><span>اسمك <em>بيظهر في «أهلا يا …»</em></span><input class="input" id="display-name" maxlength="40" dir="auto" placeholder="مثال: محمد" value="${user.displayName || ''}"></label>
          <button class="btn btn-primary" id="name-btn">حفظ الاسم</button>
        </form></div></section>
      <section class="card"><header class="card-head"><h2>${icon('lock')} تغيير كلمة السر</h2></header>
        <form class="card-body" id="pw-form">
          <label class="field"><span>كلمة السر الحالية</span><input class="input" type="password" id="pw-cur" autocomplete="current-password" dir="ltr"></label>
          <label class="field"><span>كلمة السر الجديدة</span><input class="input" type="password" id="pw-new" autocomplete="new-password" dir="ltr"></label>
          <label class="field"><span>أكّد الجديدة</span><input class="input" type="password" id="pw-new2" autocomplete="new-password" dir="ltr"></label>
          <button class="btn btn-primary" id="pw-btn">حفظ كلمة السر</button>
          <p class="muted small">بعد التغيير كل الأجهزة التانية هيتعمل لها خروج.</p>
        </form></section>
    </div>
    <section class="card"><header class="card-head"><h2>${icon('shield')} الأجهزة الداخلة</h2><button class="btn btn-danger btn-sm" id="out-all">${icon('logout')} خروج من كل الأجهزة</button></header>
      <div class="card-body" id="sessions"><div class="skel-lines"></div></div></section>
    <section class="card"><header class="card-head"><h2>${icon('clock')} سجل الدخول</h2></header><div class="card-body" id="log"><div class="skel-lines"></div></div></section>
    </div>
  `);

  const setUser = (u) => { updateUser(u); window.dispatchEvent(new CustomEvent('studio:user', { detail: u })); renderSettings(page); };
  $('#avatar-file').onchange = async (e) => {
    const f = e.target.files[0]; if (!f) return;
    try {
      const r = await api.saveAvatar(await avatarDataUrl(f));
      setUser(r.user); toast('اتحفظت الصورة ✓');
    } catch (ex) { toast(ex.message, 'error'); }
  };
  const rm = $('#avatar-remove');
  if (rm) rm.onclick = async () => {
    try { const r = await api.saveAvatar(''); setUser(r.user); toast('اتشالت الصورة'); } catch (ex) { toast(ex.message, 'error'); }
  };
  $('#name-form').onsubmit = async (e) => {
    e.preventDefault();
    const btn = $('#name-btn'); btn.disabled = true;
    try {
      const r = await api.saveProfile({ displayName: $('#display-name').value });
      updateUser(r.user);
      window.dispatchEvent(new CustomEvent('studio:user', { detail: r.user }));
      toast('اتحفظ الاسم ✓');
    } catch (ex) { toast(ex.message, 'error'); } finally { btn.disabled = false; }
  };
  $('#pw-form').onsubmit = async (e) => {
    e.preventDefault();
    if ($('#pw-new').value !== $('#pw-new2').value) return toast('كلمتين السر الجديدة مش زي بعض.', 'error');
    const btn = $('#pw-btn'); btn.disabled = true;
    try {
      const r = await api.changePassword({ current: $('#pw-cur').value, next: $('#pw-new').value });
      let remember = false;
      try { remember = !!localStorage.getItem('arw_studio_token'); } catch {}
      saveSession({ token: r.token, user, remember });
      toast('اتغيرت كلمة السر، والأجهزة التانية اتعمل لها خروج.');
      e.target.reset();
      load();
    } catch (ex) { toast(ex.message, 'error'); } finally { btn.disabled = false; }
  };
  $('#out-all').onclick = async () => {
    const ok = await dialog({ title: 'خروج من كل الأجهزة', body: 'كل الأجهزة، بما فيها الجهاز ده، هتحتاج تسجيل دخول من جديد.', confirm: 'خروج من الكل', danger: true });
    if (!ok) return;
    try { await api.logoutAll(); } catch {}
    clearSession();
    location.reload();
  };

  async function load() {
    try {
      const r = await api.sessions();
      mount($('#sessions'), r.sessions.length ? html`<div class="sess-list">${r.sessions.map(s => html`<div class="sess ${s.id === r.current ? 'current' : ''}">
        <i>${icon(/iPhone|Android/.test(s.ua) ? 'user' : 'globe')}</i>
        <div><b>${device(s.ua)} ${s.id === r.current ? html`<span class="tag tag-auto">الجهاز ده</span>` : ''}</b>
        <small class="muted">${s.place || 'مكان غير معروف'} · دخل ${timeAgo(s.createdAt)} · ${s.remember ? `فاكره لحد ${fmtDate(s.expiresAt)}` : 'جلسة مؤقتة'}</small></div></div>`)}</div>`
        : html`<p class="muted">مفيش أجهزة.</p>`);
      mount($('#log'), r.log.length ? html`<div class="log-list">${r.log.map(l => html`<div class="log ${l.event === 'failed' ? 'bad' : ''}"><span>${EVENTS[l.event] || l.event}</span><small class="muted">${device(l.ua)} · ${l.place || ''} · ${timeAgo(l.at)}</small></div>`)}</div>`
        : html`<p class="muted">السجل فاضي.</p>`);
    } catch (e) {
      mount($('#sessions'), html`<p class="muted">${e.message}</p>`);
      mount($('#log'), html``);
    }
  }
  load();
  if (IS_LOCAL) toast('النسخة التجريبية: الحساب ده على جهازك بس، منفصل عن حساب الموقع.', 'info', 5000);
}
