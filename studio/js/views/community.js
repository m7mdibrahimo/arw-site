// «مجتمع المصارعة» in the panel (owner 2026-10-14): the rooms (who's in them now, how much was said today), what the
// members reported, the latest messages of any room (delete, stop the writer), and who can't write now.
// The rooms themselves: worker/src/chat.ts.
import { api, getUser } from '../api.js';
import { html, raw, mount, $, $$, icon, toast, dialog, timeAgo, num, pager } from '../ui.js';
import { siteJpeg, kb } from '../image.js';

// the rooms as the worker has them now (the owner names, colours, hides and closes them below: «الغرف»)
let ROOMS = {};
const nameOf = (id) => (ROOMS[id] ? ROOMS[id][0] : id);
const KIND = { image: '📷 صورة', voice: '🎤 رسالة صوتية', file: '📎 ملف', video: '🎬 فيديو', sticker: '🌟 ملصق', gif: '🎞️ GIF' };
const AV = (import.meta.url.match(/\/admin\/([^/]+)\/js\//) || [])[1] || '';
const picSrc = (pic) => { pic = String(pic || ''); return pic === 'official' ? '/assets/brand-logo.png' : /^w:[a-z0-9-]+$/.test(pic) ? `/avatars/${pic.slice(2)}.webp${AV ? `?v=${AV}` : ''}` : /^https:\/\//.test(pic) ? pic : ''; };
const COLORS = ['#0e9594', '#ff5a36', '#d98b12', '#7c6ee8', '#2b8fd6', '#c73b2c', '#2f9e5b'];
const colorOf = (name) => { let h = 0; for (const ch of String(name)) h = (h * 31 + ch.charCodeAt(0)) >>> 0; return COLORS[h % COLORS.length]; };
const initial = (name) => (String(name).trim().replace(/^ال(?=\S{2})/, '').match(/\S/) || ['؟'])[0].toUpperCase();
const av = (m) => html`<span class="cm-av" style="--c:${colorOf(m.name)}" aria-hidden="true">${picSrc(m.pic) ? html`<img src="${picSrc(m.pic)}" alt="" loading="lazy">` : initial(m.name)}</span>`;
const mark = (id) => html`<span class="cy-mark" style="--h:${ROOMS[id] ? ROOMS[id][1] : 177}">${id === 'general' ? html`<img src="/assets/brand-logo.png" alt="">` : ROOMS[id] ? ROOMS[id][2] : id.slice(0, 4).toUpperCase()}</span>`;
const what = (m) => (m.del ? 'رسالة محذوفة' : [m.att ? KIND[m.att.kind] || '📎' : '', m.text].filter(Boolean).join(' · '));
const state = { room: 'general' };

async function mute(uid, name) {
  const pick = await dialog({
    title: `إيقاف ${name} عن الكتابة`,
    body: html`<p class="muted small">مش هيقدر يكتب في أي مجموعة لحد ما المدة تخلص. يقدر يقرا عادي.</p>
      <div class="cy-mute-opts">${[[1, 'ساعة'], [24, 'يوم'], [24 * 7, 'أسبوع'], [24 * 30, 'شهر'], [24 * 365, 'سنة']].map(([h, l], i) => html`<label><input type="radio" name="cy-h" value="${h}" ${i === 1 ? 'checked' : ''}> ${l}</label>`)}</div>`,
    confirm: 'أوقفه', danger: true,
  });
  if (!pick) return false;
  const h = Number((document.querySelector('input[name="cy-h"]:checked') || {}).value || 24);
  try { await api.chatMute(uid, h); toast('اتوقف عن الكتابة ✓'); return true; } catch (e) { toast(e.message, 'error'); return false; }
}

export async function renderCommunity(page) {
  mount(page, html`<div class="loading-page"><div class="spinner"></div></div>`);
  let d;
  try { d = await api.chat(); } catch (e) { mount(page, html`<div class="empty"><h2>المجتمع مش متاح دلوقتي</h2><p class="muted">${e.message}</p></div>`); return; }
  const rooms = d.rooms || [];
  ROOMS = Object.fromEntries(rooms.map(r => [r.id, [r.name, r.hue, r.mark]]));
  if (!ROOMS[state.room] && rooms[0]) state.room = rooms[0].id;
  const online = rooms.reduce((s, r) => s + (r.online || 0), 0);
  const today = rooms.reduce((s, r) => s + (r.today || 0), 0);
  mount(page, html`
    <div class="wrap page-in">
      <div class="page-title">
        <div><h1>المجتمع</h1>
          <p class="muted">مجموعات الدردشة على الموقع · الأعضاء بس اللي بيكتبوا · تقدر تمسح أي رسالة وتوقف أي حد عن الكتابة. ولو دخلت بحسابك الرسمي على الموقع تقدر تثبّت رسالة وتمسح من جوه المجموعة.</p></div>
        <div class="cy-head-acts">${getUser()?.role === 'owner' ? html`<button class="btn" id="cy-edit-rooms">${icon('edit')}المجموعات</button>` : ''}<a class="btn" href="/community/" target="_blank" rel="noopener">${icon('globe')}افتح المجتمع</a></div>
      </div>
      <div class="cm-stats">
        <div class="${online ? 'is-new' : ''}"><small>متصلين دلوقتي</small><b>${num(online)}</b></div>
        <div><small>رسائل آخر 24 ساعة</small><b>${num(today)}</b></div>
        <div class="${(d.reports || []).length ? 'is-alert' : ''}"><small>بلاغات مستنية</small><b>${num((d.reports || []).length)}</b></div>
        <div><small>موقوفين عن الكتابة</small><b>${num((d.muted || []).length)}</b></div>
      </div>
      <div class="cy-rooms">${rooms.map(r => html`<button class="cy-room ${state.room === r.id ? 'is-on' : ''}" data-room="${r.id}">
        ${mark(r.id)}<span class="cy-room-tx"><b>${r.name}${r.hidden ? html` <em class="cy-flag">مخفية</em>` : ''}${r.closed ? html` <em class="cy-flag">للقراءة فقط</em>` : ''}</b><small>${r.last ? `${r.last.name}: ${r.last.spoiler ? 'حرق نتائج' : r.last.text || KIND[r.last.kind] || ''}` : 'لسه مفيش رسائل'}</small></span>
        <span class="cy-room-n">${r.online ? html`<em>${num(r.online)} متصل</em>` : ''}${r.today ? html`<i>${num(r.today)} النهارده</i>` : ''}</span></button>`)}</div>

      ${(d.reports || []).length ? html`<section class="panel cy-sec"><h2>${icon('alert')} البلاغات (${num(d.reports.length)})</h2>
        <div class="cy-list">${d.reports.map(r => html`<article class="cy-item is-report" data-report="${r.id}">
          <div class="cy-item-main"><div class="cm-meta"><b>${r.name}</b><span class="muted small">في ${nameOf(r.room)} · ${timeAgo(r.at)}</span></div>
            <p>${r.text || KIND[r.kind] || ''}</p>
            <small class="muted">بلّغ عنها ${r.reporter_name}${r.why ? ` · السبب: ${r.why}` : ''}</small></div>
          <div class="cm-actions">
            <button class="btn btn-sm btn-danger-soft" data-del="${r.room}:${r.msg}" data-rep="${r.id}">امسح الرسالة</button>
            <button class="btn btn-sm" data-mute="${r.uid}" data-name="${r.name}">أوقفه عن الكتابة</button>
            <button class="btn btn-sm btn-ghost" data-dismiss="${r.id}">تجاهل</button>
          </div></article>`)}</div></section>` : ''}

      <section class="panel cy-sec"><h2>${mark(state.room)} آخر رسائل ${nameOf(state.room)}</h2>
        ${getUser()?.role === 'owner' ? html`<div class="cy-clear"><button class="btn btn-sm btn-danger-soft" data-clear="${state.room}">${icon('trash')} امسح كل رسايل ${nameOf(state.room)}</button><button class="btn btn-sm btn-danger-soft" data-clear="all">${icon('trash')} امسح كل الرسايل في كل المجموعات</button></div>` : ''}
        <div class="cy-list" id="cy-msgs"><div class="spinner"></div></div><div id="cy-pager"></div></section>

      ${(d.muted || []).length ? html`<section class="panel cy-sec"><h2>${icon('lock')} موقوفين عن الكتابة</h2>
        <div class="cy-list">${d.muted.map(m => html`<article class="cy-item">
          ${av({ name: m.display || m.username, pic: m.pic })}
          <div class="cy-item-main"><div class="cm-meta"><b>${m.display || m.username}</b><span class="muted small"><bdi dir="ltr">@${m.username}</bdi></span></div><small class="muted">لحد ${new Date(m.chat_mute).toLocaleString('ar-EG-u-nu-latn', { day: 'numeric', month: 'long', hour: 'numeric', minute: '2-digit' })}</small></div>
          <div class="cm-actions"><a class="btn btn-sm btn-ghost" href="#/site-members/${m.id}">صفحته</a><button class="btn btn-sm" data-unmute="${m.id}">رجّعه يكتب</button></div></article>`)}</div></section>` : ''}
    </div>`);

  const loadRoom = async () => {
    const box = $('#cy-msgs');
    try {
      const r = await api.chatRoom(state.room);
      const all = (r.msgs || []).slice().reverse();
      // 20 messages a page (owner 2026-10-25), newest first
      const pages = Math.max(1, Math.ceil(all.length / 20));
      state.msgPage = Math.min(Math.max(1, state.msgPage || 1), pages);
      const msgs = all.slice((state.msgPage - 1) * 20, state.msgPage * 20);
      mount($('#cy-pager'), pager(state.msgPage, pages));
      $$('[data-page]', $('#cy-pager')).forEach(b => b.onclick = () => { state.msgPage = Number(b.dataset.page); loadRoom(); box.scrollIntoView({ behavior: 'smooth', block: 'start' }); });
      mount(box, msgs.length ? html`${msgs.map(m => html`<article class="cy-item ${m.del ? 'is-del' : ''}">
        ${av(m)}
        <div class="cy-item-main"><div class="cm-meta"><b>${m.name}</b>${m.badge === 'gold' ? html`<em class="mb-gold-tag">الحساب الرسمي</em>` : ''}<span class="muted small">${timeAgo(m.at)}</span>${m.spoiler ? html`<em class="mb-wait">حرق نتائج</em>` : ''}</div>
          <p>${what(m)}</p>${m.att && m.att.kind === 'image' && !m.del ? html`<a href="${m.att.url}" target="_blank" rel="noopener"><img class="cy-img" src="${m.att.url}" alt="" loading="lazy"></a>` : ''}</div>
        ${m.del ? '' : html`<div class="cm-actions">
          <button class="btn btn-sm btn-danger-soft" data-del="${state.room}:${m.id}">امسح</button>
          ${m.badge === 'gold' ? '' : html`<button class="btn btn-sm" data-mute="${m.uid}" data-name="${m.name}">أوقفه</button><a class="btn btn-sm btn-ghost" href="#/site-members/${m.uid}">صفحته</a>`}
        </div>`}</article>`)}` : html`<p class="muted">لسه مفيش رسائل في المجموعة دي.</p>`);
    } catch (e) { mount(box, html`<p class="muted">${e.message}</p>`); }
  };
  loadRoom();

  if ($('#cy-edit-rooms')) $('#cy-edit-rooms').onclick = () => renderRoomsEditor(page);
  page.onclick = async (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    // wiping a room (or all of them) — the owner presses it himself and types «امسح»; it can't be undone
    if (b.dataset.clear) {
      const all = b.dataset.clear === 'all';
      const ok = await dialog({ title: all ? 'تمسح كل الرسايل في كل المجموعات؟' : `تمسح كل رسايل ${nameOf(b.dataset.clear)}؟`, danger: true, confirm: 'امسح نهائي',
        body: 'كل الرسايل هتتمسح نهائي، رسايل الأعضاء ورسايلك، بالصور والرسايل الصوتية، ومش هتقدر ترجّعها. اكتب «امسح» عشان تأكد.',
        input: { placeholder: 'اكتب: امسح', match: 'امسح' } });
      if (!ok) return;
      b.disabled = true;
      try { const r = await api.chatClear(b.dataset.clear); toast(`اتمسحت ${num(r.deleted || 0)} رسالة ✓`); renderCommunity(page); }
      catch (err) { toast(err.message, 'error'); b.disabled = false; }
      return;
    }
    if (b.dataset.room) { state.room = b.dataset.room; state.msgPage = 1; renderCommunity(page); return; }
    if (b.dataset.del) {
      const [room, id] = b.dataset.del.split(':');
      const ok = await dialog({ title: 'مسح الرسالة', body: html`<p class="muted small">هتختفي عند كل اللي في المجموعة على طول.</p>`, confirm: 'امسحها', danger: true });
      if (!ok) return;
      b.disabled = true;
      try { await api.chatDelete(room, id); toast('اتمسحت ✓'); renderCommunity(page); } catch (err) { toast(err.message, 'error'); b.disabled = false; }
      return;
    }
    if (b.dataset.mute) { if (await mute(b.dataset.mute, b.dataset.name)) renderCommunity(page); return; }
    if (b.dataset.unmute) { b.disabled = true; try { await api.chatMute(b.dataset.unmute, 0); toast('رجع يكتب ✓'); renderCommunity(page); } catch (err) { toast(err.message, 'error'); b.disabled = false; } return; }
    if (b.dataset.dismiss) { b.disabled = true; try { await api.chatDismiss(b.dataset.dismiss); renderCommunity(page); } catch (err) { toast(err.message, 'error'); b.disabled = false; } }
  };
}

// A room's background (owner 2026-10-15: «اضيف خلفية في الشات … ضبابية … كل غرفة منفصلة»): the picture, how blurred and
// how veiled, and a preview of messages over it in the site's light and dark colours
function bgBlock(r, i) {
  const blur = r.bgBlur ?? 12, dim = r.bgDim ?? 50;
  return html`<div class="ry-bg ${r.bg ? 'has-bg' : ''}">
    <div class="ry-bg-prev" style="${r.bg ? `--bgurl:url('${r.bg}');` : ''}--blur:${blur}px;--dim:${dim / 100}">
      <span class="ry-bg-msg is-in">أهلا بيكم في الغرفة 👋</span><span class="ry-bg-msg is-out">نورتوا 🔥</span>
      ${r.bg ? '' : html`<span class="ry-bg-empty">${icon('image')}من غير خلفية</span>`}
    </div>
    <div class="ry-bg-ctl">
      <span class="ry-bg-t">خلفية المجموعة</span>
      <div class="ry-bg-btns">
        <label class="btn btn-sm">${icon('upload')}${r.bg ? 'غيّر الصورة' : 'ضيف صورة'}<input type="file" accept="image/*" data-bg-file="${i}" hidden></label>
        ${r.bg ? html`<button type="button" class="btn btn-sm btn-ghost" data-bg-off="${i}">${icon('trash')}شيلها</button>` : ''}
      </div>
      ${r.bg ? html`<label class="ry-bg-range"><span>الضبابية <output>${blur}</output></span><input type="range" min="0" max="30" data-k="bgBlur" value="${blur}"></label>
      <label class="ry-bg-range"><span>التعتيم <output>${dim}%</output></span><input type="range" min="0" max="90" data-k="bgDim" value="${dim}"></label>` : html`<small class="muted">أي صورة بأي صيغة ومقاس: بتتحول JPG وبتصغر لحد 1280×720 زي صور الموقع، وبتتقص على مقاس الشات في الموبايل والكمبيوتر، وبتبان ضبابية ورا الرسايل في الوضعين.</small>`}
    </div>
  </div>`;
}
// Who sees a room (owner 2026-10-15: «تظهر ليا انا بس ولا لناس معينة ولا للكل»): everyone; some members, picked by name or
// email (a secret room: nobody else sees it, its link refused to them, one taken out leaves at once); or the owner alone
const visOf = (r) => (r.hidden ? 'me' : r.secret ? ((r.members || []).length ? 'some' : 'me') : 'all');
const VIS = [['all', 'الكل'], ['some', 'ناس معينة'], ['me', 'أنا بس']];
function toSave({ isNew, online, today, lastId, last, vis, hidden, secret, members, ...x }) {
  if (vis === 'some') return { ...x, secret: true, members: members || [] };
  if (vis === 'me') return { ...x, secret: true, members: [] };
  return x;
}
function visBlock(r, i) {
  const vis = r.vis || 'all';
  return html`<div class="ry-vis">
    <div class="ry-vis-head"><span class="ry-bg-t">مين يشوفها ويدخلها</span>
      <span class="mb-badge-seg is-sm" role="group" aria-label="مين يشوفها">${VIS.map(([k, l]) => html`<button type="button" class="${vis === k ? 'is-on' : ''}" data-vis="${k}" data-i="${i}">${k === 'all' ? icon('globe') : k === 'some' ? icon('users') : icon('lock')}${l}</button>`)}</span></div>
    ${vis === 'all' ? html`<small class="muted">ظاهرة لكل المتابعين.</small>`
      : vis === 'me' ? html`<small class="muted">سرية: مش ظاهرة لأي حد غيرك (بحسابك الرسمي على الموقع)، ولو حد عرف رابطها مش هيقدر يفتحها.</small>`
      : html`<small class="muted">سرية: بتظهر ليك وللأعضاء اللي هتضيفهم بس. اللي تشيله وهو جوه بيخرج على طول. ${r.closed ? 'وهي «للقراءة بس»: إنت بس اللي بتكتب فيها.' : 'وعلّم «للقراءة بس» تحت لو عايز تكون إنت بس اللي بيكتب.'}</small>
        <div class="ry-people">${(r.members || []).map(id => html`<span class="ry-person" data-id="${id}"><b data-name="${id}">#${id}</b><button type="button" data-unadd="${id}" data-i="${i}" aria-label="شيله">×</button></span>`)}${(r.members || []).length ? '' : html`<small class="muted">لسه مفيش حد. ضيف من تحت، أو سيبها كده (هتبقى ليك بس).</small>`}</div>
        <div class="ry-find"><input class="input" data-i="${i}" placeholder="ضيف عضو: اكتب اسمه أو اسم المستخدم أو الإيميل" autocomplete="off" dir="auto"><div class="ry-find-res" hidden></div></div>`}
  </div>`;
}

// «الغرف» (owner 2026-10-15: «اضيف ساحة او كروب او اعدل في اسماء ال موجود»): every room's name, words, short mark and
// colour, its place in the list, hidden from the site, or closed for writing (only the site's account writes there).
// Saved as one list (worker/src/chat.ts studioChatRooms); the site follows it within a minute.
async function renderRoomsEditor(page) {
  mount(page, html`<div class="loading-page"><div class="spinner"></div></div>`);
  let list;
  try { list = (await api.chatRooms()).rooms || []; } catch (e) { toast(e.message, 'error'); renderCommunity(page); return; }
  list = list.map(r => ({ ...r, isNew: false, vis: visOf(r) }));
  // the members, to add to a secret room (by name, username or email)
  let people = [];
  api.siteMembers().then(d => { people = (d.items || []).filter(m => !m.official && !m.banned); }).catch(() => {});
  const draw = () => {
    mount(page, html`
      <div class="wrap page-in">
        <div class="page-title">
          <div><h1>مجموعات المجتمع</h1><p class="muted">غيّر الاسم والوصف والعلامة واللون، ورتّب المجموعات، أو ضيف مجموعة جديدة. «مخفية» = مش بتظهر على الموقع. «للقراءة بس» = الأعضاء يقروا وإنت بس اللي تكتب.</p></div>
          <div class="cy-head-acts"><button class="btn btn-ghost" id="ry-back">${icon('arrowRight')}رجوع</button><button class="btn btn-primary" id="ry-save">${icon('check')}احفظ المجموعات</button></div>
        </div>
        <div class="ry-list">${list.map((r, i) => html`<article class="ry-room ${r.hidden ? 'is-hidden' : ''}" data-i="${i}">
          <div class="ry-mark" style="--h:${r.hue}">${r.id === 'general' ? html`<img src="/assets/brand-logo.png" alt="">` : r.mark}</div>
          <div class="ry-fields">
            <div class="ry-row">
              <label class="ry-f ry-name"><span>الاسم</span><input class="input" data-k="name" value="${r.name}" maxlength="40" dir="auto"></label>
              <label class="ry-f ry-markf"><span>العلامة</span><input class="input" data-k="mark" value="${r.mark}" maxlength="6" dir="ltr"></label>
              <label class="ry-f ry-id"><span>الرابط</span><input class="input mono" data-k="id" value="${r.id}" maxlength="24" dir="ltr" ${r.isNew ? '' : 'readonly'} title="${r.isNew ? 'حروف إنجليزي صغيرة وأرقام' : 'رابط المجموعة مايتغيرش بعد ما تتعمل'}"></label>
            </div>
            <label class="ry-f"><span>الوصف</span><input class="input" data-k="about" value="${r.about}" maxlength="90" dir="auto"></label>
            ${r.id === 'general' ? '' : visBlock(r, i)}
            ${bgBlock(r, i)}
            <div class="ry-row ry-opts">
              <label class="ry-hue"><span>اللون</span><input type="range" min="0" max="360" data-k="hue" value="${r.hue}"></label>
              <label class="ry-tog"><input type="checkbox" data-k="closed" ${r.closed ? 'checked' : ''}><span>للقراءة بس</span></label>
            </div>
          </div>
          <div class="ry-acts">
            <button class="btn btn-sm btn-ghost" data-up="${i}" ${i === 0 ? 'disabled' : ''} title="لفوق">▲</button>
            <button class="btn btn-sm btn-ghost" data-down="${i}" ${i === list.length - 1 ? 'disabled' : ''} title="لتحت">▼</button>
            ${r.id === 'general' ? '' : html`<button class="btn btn-sm btn-danger-soft" data-remove="${i}" title="امسح المجموعة">${icon('trash')}</button>`}
          </div>
        </article>`)}</div>
        <button class="btn ry-add" id="ry-add">${icon('plus')}ضيف مجموعة جديدة</button>
      </div>`);
    const read = () => $$('.ry-room', page).forEach(el => {
      const r = list[Number(el.dataset.i)];
      $$('[data-k]', el).forEach(inp => { const k = inp.dataset.k; r[k] = inp.type === 'checkbox' ? inp.checked : k === 'hue' || k === 'bgBlur' || k === 'bgDim' ? Number(inp.value) : inp.value.trim(); });
    });
    $$('[data-k="hue"], [data-k="mark"]', page).forEach(inp => inp.oninput = () => {
      const el = inp.closest('.ry-room'), m = $('.ry-mark', el);
      if (inp.dataset.k === 'hue') m.style.setProperty('--h', inp.value); else if (!m.querySelector('img')) m.textContent = inp.value;
    });
    // the background: blur and veil seen at once on the preview; a picture made lighter here, then uploaded
    $$('[data-k="bgBlur"], [data-k="bgDim"]', page).forEach(inp => inp.oninput = () => {
      const pv = $('.ry-bg-prev', inp.closest('.ry-room'));
      if (inp.dataset.k === 'bgBlur') pv.style.setProperty('--blur', inp.value + 'px'); else pv.style.setProperty('--dim', inp.value / 100);
      const out = inp.closest('label').querySelector('output'); if (out) out.textContent = inp.dataset.k === 'bgBlur' ? inp.value : inp.value + '%';
    });
    $$('[data-bg-file]', page).forEach(inp => inp.onchange = async () => {
      const f = inp.files && inp.files[0]; if (!f) return;
      read();
      const i = Number(inp.dataset.bgFile), r = list[i], box = inp.closest('.ry-bg');
      box.classList.add('is-busy');
      try {
        // the site's own standard for pictures (studio/js/image.js): any kind, inside 1280×720, JPEG, lighter
        const { blob, w, h } = await siteJpeg(f);
        const { url } = await api.chatBg(r.id, blob);
        r.bg = url; if (r.bgBlur == null) r.bgBlur = 12; if (r.bgDim == null) r.bgDim = 50;
        toast(`اترفعت الخلفية ✓ (${w}×${h} · ${kb(blob.size)}) دوس «احفظ المجموعات» عشان تظهر للمتابعين`);
        draw();
      } catch (err) { toast(err.message, 'error'); box.classList.remove('is-busy'); inp.value = ''; }
    });
    $$('[data-bg-off]', page).forEach(b => b.onclick = () => { read(); const r = list[Number(b.dataset.bgOff)]; delete r.bg; delete r.bgBlur; delete r.bgDim; draw(); });
    // who sees it: everyone, some members (picked here), or the owner alone
    $$('[data-vis]', page).forEach(b => b.onclick = () => { read(); const r = list[Number(b.dataset.i)]; r.vis = b.dataset.vis; if (r.vis === 'some' && !r.members) r.members = []; draw(); });
    $$('[data-unadd]', page).forEach(b => b.onclick = () => { read(); const r = list[Number(b.dataset.i)]; r.members = (r.members || []).filter(id => id !== Number(b.dataset.unadd)); draw(); });
    $$('.ry-find input', page).forEach(inp => {
      const i = Number(inp.dataset.i), r = list[i], box = inp.closest('.ry-find'), res = $('.ry-find-res', box);
      const show = () => {
        const q = inp.value.trim().toLowerCase().replace(/^@/, '');
        if (q.length < 2) { res.hidden = true; return; }
        const have = new Set(r.members || []);
        const hits = people.filter(m => !have.has(m.id) && [m.display, m.username, m.email].some(x => String(x || '').toLowerCase().includes(q))).slice(0, 6);
        mount(res, hits.length ? html`${hits.map(m => html`<button type="button" class="ry-find-hit" data-add="${m.id}"><b>${m.display || m.username}</b><small dir="ltr">@${m.username} · ${m.email}</small></button>`)}` : html`<p class="muted small">${people.length ? 'مفيش عضو بالاسم ده.' : 'جار تحميل الأعضاء…'}</p>`);
        res.hidden = false;
        $$('[data-add]', res).forEach(b => b.onmousedown = (e) => { e.preventDefault(); read(); r.members = [...(r.members || []), Number(b.dataset.add)]; draw(); const again = $(`.ry-find input[data-i="${i}"]`, page); if (again) again.focus(); });
      };
      inp.oninput = show; inp.onfocus = show; inp.onblur = () => setTimeout(() => { res.hidden = true; }, 150);
    });
    const names = () => $$('[data-name]', page).forEach(b => { const m = people.find(x => x.id === Number(b.dataset.name)); if (m) { b.textContent = m.display || m.username; b.title = `@${m.username} · ${m.email}`; } });
    names(); if (!people.length) setTimeout(names, 1200);
    $('#ry-back').onclick = () => renderCommunity(page);
    $('#ry-add').onclick = () => { read(); let n = list.length + 1; while (list.some(x => x.id === `room${n}`)) n++; list.push({ id: `room${n}`, name: '', about: '', mark: 'NEW', hue: Math.floor(Math.random() * 360), isNew: true }); draw(); const last = $$('.ry-room', page).pop(); last.scrollIntoView({ behavior: 'smooth', block: 'center' }); $('[data-k="name"]', last).focus(); };
    page.onclick = async (e) => {
      const b = e.target.closest('[data-up],[data-down],[data-remove]');
      if (!b) return;
      read();
      if (b.dataset.up) { const i = Number(b.dataset.up); [list[i - 1], list[i]] = [list[i], list[i - 1]]; }
      else if (b.dataset.down) { const i = Number(b.dataset.down); [list[i + 1], list[i]] = [list[i], list[i + 1]]; }
      else {
        const r = list[Number(b.dataset.remove)];
        const ok = await dialog({ title: `مسح «${r.name || r.id}»`, body: html`<p class="muted small">المجموعة هتختفي من الموقع. لو حبيت ترجّعها بعدين ضيفها بنفس الرابط (${r.id}) ورسايلها هترجع. لو عايز تخفيها بس، علّم «مخفية» بدل المسح.</p>`, confirm: 'امسحها', danger: true });
        if (!ok) return;
        list.splice(Number(b.dataset.remove), 1);
      }
      draw();
    };
    $('#ry-save').onclick = async (e) => {
      read();
      const btn = e.currentTarget;
      btn.disabled = true;
      try { const r = await api.chatRoomsSave(list.map(toSave)); list = r.rooms.map(x => ({ ...x, isNew: false, vis: visOf(x) })); toast('اتحفظت المجموعات ✓ هتظهر على الموقع خلال دقيقة'); draw(); }
      catch (err) { toast(err.message, 'error'); btn.disabled = false; }
    };
  };
  draw();
}
