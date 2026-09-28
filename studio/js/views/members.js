// Members & permissions (owner only) and the activity log.
// Everything here is enforced again by the server; hiding a button is only for comfort.
import { api, getUser } from '../api.js';
import { html, raw, esc, mount, $, $$, icon, toast, dialog, timeAgo, fmtDate, num, avatarInner } from '../ui.js';

const SECTIONS = [
  { id: 'shows', label: 'العروض' },
  { id: 'recaps', label: 'الملخصات' },
  { id: 'news', label: 'الأخبار' },
  { id: 'nostalgia', label: 'نوستالجيا' },
];
const ACTIONS = [
  { id: 'view', label: 'يشوف' },
  { id: 'create', label: 'يضيف' },
  { id: 'edit', label: 'يعدّل' },
  { id: 'delete', label: 'يحذف' },
];
const EXTRAS = [
  { id: 'stats', label: 'إحصائيات الزوار', text: 'الأرقام والصفحات الأكثر زيارة في الرئيسية' },
  { id: 'status', label: 'حالة الموقع', text: 'النشر على المنصات ومصادر الأخبار' },
  { id: 'tools', label: 'أدوات النشر', text: 'النشر اليدوي على المنصات، سحب الأخبار، المثبت، الريلز', risky: true },
];
const all = (acts) => SECTIONS.flatMap(s => acts.map(a => `${s.id}.${a}`));
const PRESETS = [
  { id: 'news', label: 'كاتب أخبار', perms: ['news.view', 'news.create', 'news.edit'] },
  { id: 'shows', label: 'رافع عروض', perms: ['shows.view', 'shows.create', 'shows.edit', 'recaps.view', 'recaps.create', 'recaps.edit', 'nostalgia.view', 'nostalgia.create', 'nostalgia.edit'] },
  { id: 'editor', label: 'محرر كامل', perms: [...all(['view', 'create', 'edit']), 'stats'] },
  { id: 'viewer', label: 'مشاهدة بس', perms: [...all(['view']), 'stats', 'status'] },
];
const ACTION_TEXT = {
  'member.create': 'أضاف عضو', 'member.update': 'عدّل صلاحيات', 'member.password': 'عمل كلمة سر مؤقتة لـ',
  'member.disable': 'وقّف', 'member.enable': 'رجّع', 'member.logout': 'عمل خروج لأجهزة', 'member.delete': 'حذف العضو',
  'content.create': 'أضاف', 'content.update': 'عدّل', 'content.delete': 'حذف',
  password: 'غيّر كلمة السر بتاعته', 'analytics.connect': 'ربط الإحصائيات', 'analytics.disconnect': 'فصل الإحصائيات',
};
const COLL_TEXT = { shows: 'عرض', recaps: 'ملخص', news: 'خبر', nostalgia: 'حلقة نوستالجيا', nostalgia_series: 'سلسلة نوستالجيا' };

/** A strong temporary password the owner hands over once. */
function tempPassword() {
  const abc = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const b = crypto.getRandomValues(new Uint8Array(14));
  let p = Array.from(b, x => abc[x % abc.length]).join('');
  return `${p.slice(0, 5)}-${p.slice(5, 10)}-${p.slice(10)}7`;
}
function permSummary(m) {
  if (m.role === 'owner') return 'كل الصلاحيات';
  const p = new Set(m.perms || []);
  const parts = SECTIONS.map(s => {
    const acts = ACTIONS.filter(a => p.has(`${s.id}.${a.id}`));
    if (!acts.length) return '';
    return acts.length === 4 ? `${s.label} (كامل)` : acts.length === 1 ? `${s.label} (مشاهدة)` : `${s.label} (${acts.map(a => a.label).join('، ')})`;
  }).filter(Boolean);
  for (const e of EXTRAS) if (p.has(e.id)) parts.push(e.label);
  return parts.length ? parts.join(' · ') : 'من غير صلاحيات';
}
async function showSecret(title, username, password) {
  await dialog({
    title,
    body: html`<p>ابعت البيانات دي للعضو بنفسك. كلمة السر دي <b>مش هتظهر تاني</b>، وأول ما يدخل هيتطلب منه يغيّرها.</p>
      <div class="secret"><span>اسم المستخدم</span><code dir="ltr">${username}</code><span>كلمة السر المؤقتة</span><code dir="ltr" id="secret-pass">${password}</code></div>
      <button type="button" class="btn btn-sm" id="copy-secret">${icon('copy')} نسخ البيانات</button>`,
    confirm: 'تمام، خدتها', cancel: '',
  });
}
document.addEventListener('click', (e) => {
  const b = e.target.closest && e.target.closest('#copy-secret');
  if (!b) return;
  const box = b.previousElementSibling;
  const codes = box ? Array.from(box.querySelectorAll('code'), c => c.textContent) : [];
  navigator.clipboard.writeText(`لوحة التحكم: ${location.origin}/studio/\nاسم المستخدم: ${codes[0]}\nكلمة السر المؤقتة: ${codes[1]}`).then(() => toast('اتنسخت ✓'), () => toast('مقدرتش أنسخ، انسخها بإيدك.', 'error'));
});

export async function renderMembers(page, sub = null) {
  if (sub) return renderMember(page, sub);
  mount(page, html`<div class="loading-page"><div class="spinner"></div></div>`);
  let r;
  try { r = await api.members(); } catch (e) { return mount(page, html`<div class="empty"><h2>مقدرتش أجيب الأعضاء</h2><p class="muted">${e.message}</p></div>`); }
  const members = r.members.sort((a, b) => (a.role === 'owner' ? -1 : b.role === 'owner' ? 1 : b.createdAt - a.createdAt));
  const active = members.filter(m => m.role !== 'owner' && !m.disabled).length;
  mount(page, html`
    <div class="wrap page-in">
      <div class="page-title">
        <div><h1>الأعضاء والصلاحيات</h1><p class="muted">${members.length > 1 ? `${num(members.length - 1)} عضو · ${num(active)} شغالين` : 'لسه مفيش أعضاء غيرك.'}</p></div>
        <div class="page-actions">
          <a class="btn" href="#/activity">${icon('clock')} سجل النشاط</a>
          <a class="btn btn-primary" href="#/members/new">${icon('plus')} عضو جديد</a>
        </div>
      </div>
      <div class="rows">${members.map(m => html`
        <div class="row member ${m.disabled ? 'is-off' : ''}">
          <a class="row-img avatar-cell" href="${m.role === 'owner' ? '#/settings' : `#/members/${m.id}`}">${avatarInner(m)}</a>
          <a class="row-main" href="${m.role === 'owner' ? '#/settings' : `#/members/${m.id}`}">
            <b>${m.displayName || m.username}
              ${m.role === 'owner' ? html`<span class="tag tag-manual">${icon('shield')} صاحب الموقع</span>` : ''}
              ${m.disabled ? html`<span class="tag tag-warn">موقوف</span>` : ''}
              ${m.mustChange && !m.disabled ? html`<span class="tag tag-sched">لسه مدخلش</span>` : ''}</b>
            <small><bdi dir="ltr">@${m.username}</bdi> · <bdi dir="ltr">${m.email}</bdi></small>
            <small>${permSummary(m)}</small>
            <small>${m.lastLogin ? `آخر دخول ${timeAgo(m.lastLogin)}` : 'مدخلش لسه'}</small>
          </a>
          <span class="row-actions">${m.role === 'owner' ? '' : html`<a class="icon-btn sm" href="#/members/${m.id}" title="تعديل الصلاحيات">${icon('edit')}</a>`}</span>
        </div>`)}</div>
      <p class="muted small center">كل عضو بيشوف ويعمل اللي إنت اديته صلاحيته بس، والخادم بيتأكد من ده في كل طلب. أي تعديل بيعمله بيتسجل باسمه في سجل النشاط.</p>
    </div>`);
}

async function renderMember(page, id) {
  const isNew = id === 'new';
  let m = { username: '', email: '', displayName: '', perms: [], disabled: false };
  if (!isNew) {
    mount(page, html`<div class="loading-page"><div class="spinner"></div></div>`);
    try { m = (await api.members()).members.find(x => x.id === id); } catch (e) { return toast(e.message, 'error'); }
    if (!m || m.role === 'owner') { location.hash = '#/members'; return; }
  }
  const has = new Set(m.perms || []);
  mount(page, html`
    <div class="wrap page-in narrow">
      <div class="page-title">
        <div><a href="#/members" class="back">${icon('arrowRight')} الأعضاء</a>
          <h1>${isNew ? 'عضو جديد' : m.displayName || m.username}</h1>
          ${!isNew ? html`<p class="muted"><bdi dir="ltr">@${m.username}</bdi> · اتضاف ${fmtDate(m.createdAt)} · ${m.lastLogin ? `آخر دخول ${timeAgo(m.lastLogin)}` : 'مدخلش لسه'}</p>` : html`<p class="muted">هتدّيه كلمة سر مؤقتة، وهو يغيّرها أول ما يدخل.</p>`}</div>
      </div>
      <form id="m-form" novalidate>
        <section class="card"><header class="card-head"><h2>${icon('user')} البيانات</h2></header>
          <div class="card-body fields">
            <div class="row-2">
              <label class="field"><span>اسم المستخدم <em>بيدخل بيه</em></span><input class="input" id="m-user" dir="ltr" autocapitalize="off" spellcheck="false" placeholder="مثال: ahmed" value="${m.username}" ${isNew ? '' : 'disabled'}></label>
              <label class="field"><span>الاسم <em>بيظهر في الترحيب والسجل</em></span><input class="input" id="m-name" dir="auto" maxlength="40" placeholder="مثال: أحمد" value="${m.displayName || ''}"></label>
            </div>
            <label class="field"><span>الإيميل</span><input class="input" id="m-mail" type="email" dir="ltr" placeholder="name@example.com" value="${m.email}"></label>
            ${isNew ? html`<label class="field"><span>كلمة السر المؤقتة</span>
              <div class="input-ico">${icon('lock')}<input class="input" id="m-pass" dir="ltr" autocomplete="off" value="${tempPassword()}"><button type="button" class="input-btn" id="m-gen" title="توليد واحدة تانية">${icon('refresh')}</button></div>
              <small class="muted">اتعملت عشوائية وقوية. هتظهرلك تاني بعد الحفظ عشان تبعتها.</small></label>` : ''}
          </div></section>

        <section class="card"><header class="card-head"><h2>${icon('shield')} الصلاحيات</h2></header>
          <div class="card-body">
            <div class="presets"><span class="muted small">جاهزة:</span>${PRESETS.map(p => html`<button type="button" class="pill" data-preset="${p.id}">${p.label}</button>`)}<button type="button" class="pill" data-preset="none">ولا حاجة</button></div>
            <div class="perm-grid" role="table">
              <div class="perm-head" role="row"><span></span>${ACTIONS.map(a => html`<span role="columnheader">${a.label}</span>`)}</div>
              ${SECTIONS.map(s => html`<div class="perm-row" role="row"><b role="rowheader">${s.label}</b>${ACTIONS.map(a => html`
                <label class="perm-cell ${a.id === 'delete' ? 'risky' : ''}"><input type="checkbox" data-perm="${s.id}.${a.id}" ${has.has(`${s.id}.${a.id}`) ? 'checked' : ''} aria-label="${s.label}: ${a.label}"><i>${icon('check')}</i></label>`)}</div>`)}
            </div>
            <div class="perm-extras">${EXTRAS.map(e => html`
              <label class="perm-extra ${e.risky ? 'risky' : ''}"><input type="checkbox" data-perm="${e.id}" ${has.has(e.id) ? 'checked' : ''}><i>${icon('check')}</i><span><b>${e.label}</b><small>${e.text}</small></span></label>`)}</div>
            <p class="muted small">الإضافة والتعديل والحذف بتشمل المشاهدة. الأعضاء مش بيقدروا أبدا يشوفوا الأعضاء التانيين، أو يغيّروا صلاحياتهم، أو يلمسوا حسابك أو مفتاح الإحصائيات.</p>
          </div></section>

        <div class="form-actions"><button class="btn btn-primary btn-lg" id="m-save" type="submit">${icon('check')} ${isNew ? 'إضافة العضو' : 'حفظ التعديلات'}</button><a class="btn btn-ghost" href="#/members">إلغاء</a></div>
      </form>

      ${!isNew ? html`<section class="card danger-zone"><header class="card-head"><h2>${icon('lock')} الأمان</h2></header>
        <div class="card-body sec-actions">
          <div><b>كلمة سر مؤقتة جديدة</b><small class="muted">لو نسي كلمة السر. كل أجهزته هتخرج، وهيغيّرها أول ما يدخل.</small><button type="button" class="btn btn-sm" data-act="password">${icon('refresh')} عمل كلمة سر جديدة</button></div>
          <div><b>خروج من كل أجهزته</b><small class="muted">يسجّل دخول من جديد بنفس كلمة السر.</small><button type="button" class="btn btn-sm" data-act="logout">${icon('logout')} خروج من أجهزته</button></div>
          <div><b>${m.disabled ? 'الحساب موقوف' : 'إيقاف الحساب'}</b><small class="muted">${m.disabled ? 'مش هيقدر يدخل لحد ما ترجّعه.' : 'يمنعه من الدخول فورا من غير ما تمسح حسابه.'}</small>
            <button type="button" class="btn btn-sm ${m.disabled ? '' : 'btn-danger'}" data-act="${m.disabled ? 'enable' : 'disable'}">${m.disabled ? 'رجّع الحساب' : 'إيقاف'}</button></div>
          <div><b>حذف العضو</b><small class="muted">الحساب هيتمسح نهائيا. المواضيع اللي نزّلها هتفضل زي ما هي.</small><button type="button" class="btn btn-sm btn-danger" data-act="delete">${icon('trash')} حذف نهائي</button></div>
        </div></section>` : ''}
    </div>`);

  const boxes = () => $$('[data-perm]');
  const selected = () => boxes().filter(b => b.checked).map(b => b.dataset.perm);
  // Anything beyond «view» implies view; removing view removes the rest of that section.
  boxes().forEach(b => b.onchange = () => {
    const [sec, act] = b.dataset.perm.split('.');
    if (!act) return;
    const box = (a) => $(`[data-perm="${sec}.${a}"]`);
    if (b.checked && act !== 'view') box('view').checked = true;
    if (!b.checked && act === 'view') ACTIONS.forEach(a => { box(a.id).checked = false; });
  });
  $$('[data-preset]').forEach(p => p.onclick = () => {
    const set = new Set((PRESETS.find(x => x.id === p.dataset.preset) || { perms: [] }).perms);
    boxes().forEach(b => { b.checked = set.has(b.dataset.perm); });
  });
  const gen = $('#m-gen');
  if (gen) gen.onclick = () => { $('#m-pass').value = tempPassword(); };

  $('#m-form').onsubmit = async (e) => {
    e.preventDefault();
    const perms = selected();
    if (!perms.length && !(await dialog({ title: 'من غير صلاحيات؟', body: 'العضو ده مش هيقدر يعمل أي حاجة غير إنه يدخل. تحفظ كده؟', confirm: 'احفظ' }))) return;
    if (perms.some(p => p.endsWith('.delete') || p === 'tools')) {
      const risky = [...perms.filter(p => p.endsWith('.delete')).map(p => `حذف ${SECTIONS.find(s => s.id === p.split('.')[0]).label}`), ...(perms.includes('tools') ? ['أدوات النشر على المنصات'] : [])];
      const ok = await dialog({ title: 'صلاحيات حساسة', body: html`<p>إنت مدّيه: <b>${risky.join('، ')}</b>.</p><p class="muted small">دي حاجات بتأثر على الموقع والمنصات مباشرة. متأكد؟</p>`, confirm: 'أيوه، متأكد', danger: true });
      if (!ok) return;
    }
    const btn = $('#m-save'); btn.disabled = true; btn.classList.add('loading');
    try {
      const body = { email: $('#m-mail').value.trim(), displayName: $('#m-name').value.trim(), perms };
      if (isNew) {
        const password = $('#m-pass').value;
        const r = await api.createMember({ ...body, username: $('#m-user').value.trim(), password });
        await showSecret('العضو اتضاف ✓', r.member.username, password);
        location.hash = '#/members';
      } else {
        await api.memberAction(m.id, 'update', body);
        toast('اتحفظت الصلاحيات ✓ وبتشتغل من الطلب الجاي.');
        location.hash = '#/members';
      }
    } catch (ex) { toast(ex.message, 'error', 6000); } finally { btn.disabled = false; btn.classList.remove('loading'); }
  };

  $$('[data-act]').forEach(b => b.onclick = async () => {
    const act = b.dataset.act, who = m.displayName || m.username;
    try {
      if (act === 'password') {
        if (!(await dialog({ title: 'كلمة سر مؤقتة جديدة', body: `كلمة السر القديمة بتاعة ${who} هتبطل، وكل أجهزته هتخرج.`, confirm: 'اعمل واحدة جديدة' }))) return;
        const password = tempPassword();
        await api.memberAction(m.id, 'password', { password });
        await showSecret('كلمة السر الجديدة', m.username, password);
      } else if (act === 'logout') {
        await api.memberAction(m.id, 'logout');
        toast(`اتعمل خروج لكل أجهزة ${who}.`);
      } else if (act === 'disable') {
        if (!(await dialog({ title: `إيقاف ${who}`, body: 'هيخرج من كل الأجهزة فورا ومش هيقدر يدخل لحد ما ترجّعه.', confirm: 'إيقاف', danger: true }))) return;
        await api.memberAction(m.id, 'disable');
        toast('اتوقف الحساب.');
      } else if (act === 'enable') {
        await api.memberAction(m.id, 'enable');
        toast('رجع الحساب يشتغل.');
      } else if (act === 'delete') {
        const typed = await dialog({ title: `حذف ${who} نهائيا`, body: html`<p>الحساب هيتمسح ومش هيرجع.</p><p class="muted small">للتأكيد اكتب اسم المستخدم: <b dir="ltr">${m.username}</b></p>`, confirm: 'حذف نهائي', danger: true, input: { placeholder: m.username, match: m.username } });
        if (!typed) return;
        await api.memberAction(m.id, 'delete', { confirm: typed.trim() });
        toast('اتحذف العضو.');
        location.hash = '#/members';
        return;
      }
      renderMember(page, id);
    } catch (ex) { toast(ex.message, 'error'); }
  });
}

export async function renderActivity(page) {
  mount(page, html`<div class="loading-page"><div class="spinner"></div></div>`);
  let entries = [], members = [];
  try { [entries, members] = await Promise.all([api.audit().then(r => r.entries), api.members().then(r => r.members)]); }
  catch (e) { return mount(page, html`<div class="empty"><h2>مقدرتش أجيب السجل</h2><p class="muted">${e.message}</p></div>`); }
  const byId = Object.fromEntries(members.map(m => [m.id, m]));
  const me = getUser() || {};
  mount(page, html`
    <div class="wrap page-in">
      <div class="page-title">
        <div><h1>سجل النشاط</h1><p class="muted">آخر ${num(entries.length)} حاجة اتعملت من اللوحة، مين عملها وإمتى.</p></div>
        <div class="page-actions"><select class="input" id="who"><option value="">كل الناس</option>${members.map(m => html`<option value="${m.id}">${m.displayName || m.username}</option>`)}</select></div>
      </div>
      <div class="rows" id="act-list"></div>
    </div>`);
  const draw = () => {
    const who = $('#who').value;
    const list = entries.filter(x => !who || x.userId === who);
    mount($('#act-list'), list.length ? html`${list.map(x => {
      const u = byId[x.userId] || { displayName: x.user, username: x.user };
      const verb = ACTION_TEXT[x.action] || x.action;
      const what = x.action.startsWith('content.') ? `${COLL_TEXT[x.collection] || ''} «${x.title || x.slug}»` : x.target ? raw(`<bdi dir="ltr">@${esc(x.target)}</bdi>`) : '';
      return html`<div class="row act ${x.action.endsWith('delete') ? 'bad' : ''}">
        <span class="row-img avatar-cell">${avatarInner(u)}</span>
        <span class="row-main"><b>${x.userId === me.id ? 'إنت' : x.user} ${verb} ${what}</b>
          <small>${timeAgo(x.at)} · ${fmtDate(x.at)}${x.action === 'member.update' || x.action === 'member.create' ? ` · ${permSummary({ perms: x.perms })}` : ''}</small></span>
      </div>`;
    })}` : html`<p class="empty-sm">مفيش نشاط لسه.</p>`);
  };
  $('#who').onchange = draw;
  draw();
}
