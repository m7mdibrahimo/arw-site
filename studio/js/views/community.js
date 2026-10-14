// «مجتمع المصارعة» in the panel (owner 2026-10-14): the rooms (who's in them now, how much was said today), what the
// members reported, the latest messages of any room (delete, stop the writer), and who can't write now.
// The rooms themselves: worker/src/chat.ts.
import { api } from '../api.js';
import { html, raw, mount, $, $$, icon, toast, dialog, timeAgo, num } from '../ui.js';

const ROOMS = {
  general: ['الساحة العامة', 177, 'ARW'], wwe: ['WWE', 4, 'WWE'], aew: ['AEW', 42, 'AEW'], njpw: ['NJPW', 212, 'NJPW'], tna: ['TNA', 262, 'TNA'],
  roh: ['ROH', 218, 'ROH'], mma: ['UFC والفنون القتالية', 24, 'UFC'], indie: ['الاتحادات المستقلة', 166, 'INDIE'], nostalgia: ['نوستالجيا', 330, '90s'],
};
const KIND = { image: '📷 صورة', voice: '🎤 رسالة صوتية', file: '📎 ملف', video: '🎬 فيديو' };
const AV = (import.meta.url.match(/\/admin\/([^/]+)\/js\//) || [])[1] || '';
const picSrc = (pic) => { pic = String(pic || ''); return pic === 'official' ? '/assets/brand-logo.png' : /^w:[a-z0-9-]+$/.test(pic) ? `/avatars/${pic.slice(2)}.webp${AV ? `?v=${AV}` : ''}` : /^https:\/\//.test(pic) ? pic : ''; };
const COLORS = ['#0e9594', '#ff5a36', '#d98b12', '#7c6ee8', '#2b8fd6', '#c73b2c', '#2f9e5b'];
const colorOf = (name) => { let h = 0; for (const ch of String(name)) h = (h * 31 + ch.charCodeAt(0)) >>> 0; return COLORS[h % COLORS.length]; };
const initial = (name) => (String(name).trim().replace(/^ال(?=\S{2})/, '').match(/\S/) || ['؟'])[0].toUpperCase();
const av = (m) => html`<span class="cm-av" style="--c:${colorOf(m.name)}" aria-hidden="true">${picSrc(m.pic) ? html`<img src="${picSrc(m.pic)}" alt="" loading="lazy">` : initial(m.name)}</span>`;
const mark = (id) => html`<span class="cy-mark" style="--h:${ROOMS[id][1]}">${id === 'general' ? html`<img src="/assets/brand-logo.png" alt="">` : ROOMS[id][2]}</span>`;
const what = (m) => (m.del ? 'رسالة محذوفة' : [m.att ? KIND[m.att.kind] || '📎' : '', m.text].filter(Boolean).join(' · '));
const state = { room: 'general' };

async function mute(uid, name) {
  const pick = await dialog({
    title: `إيقاف ${name} عن الكتابة`,
    body: html`<p class="muted small">مش هيقدر يكتب في أي غرفة لحد ما المدة تخلص. يقدر يقرا عادي.</p>
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
  const online = rooms.reduce((s, r) => s + (r.online || 0), 0);
  const today = rooms.reduce((s, r) => s + (r.today || 0), 0);
  mount(page, html`
    <div class="wrap page-in">
      <div class="page-title">
        <div><h1>المجتمع</h1>
          <p class="muted">غرف الدردشة على الموقع · الأعضاء بس اللي بيكتبوا · تقدر تمسح أي رسالة وتوقف أي حد عن الكتابة. ولو دخلت بحسابك الرسمي على الموقع تقدر تثبّت رسالة وتمسح من جوه الغرفة.</p></div>
        <a class="btn" href="/community/" target="_blank" rel="noopener">${icon('globe')}افتح المجتمع</a>
      </div>
      <div class="cm-stats">
        <div class="${online ? 'is-new' : ''}"><small>متصلين دلوقتي</small><b>${num(online)}</b></div>
        <div><small>رسائل آخر 24 ساعة</small><b>${num(today)}</b></div>
        <div class="${(d.reports || []).length ? 'is-alert' : ''}"><small>بلاغات مستنية</small><b>${num((d.reports || []).length)}</b></div>
        <div><small>موقوفين عن الكتابة</small><b>${num((d.muted || []).length)}</b></div>
      </div>
      <div class="cy-rooms">${rooms.map(r => html`<button class="cy-room ${state.room === r.id ? 'is-on' : ''}" data-room="${r.id}">
        ${mark(r.id)}<span class="cy-room-tx"><b>${ROOMS[r.id][0]}</b><small>${r.last ? `${r.last.name}: ${r.last.spoiler ? 'حرق نتائج' : r.last.text || KIND[r.last.kind] || ''}` : 'لسه مفيش رسائل'}</small></span>
        <span class="cy-room-n">${r.online ? html`<em>${num(r.online)} متصل</em>` : ''}${r.today ? html`<i>${num(r.today)} النهارده</i>` : ''}</span></button>`)}</div>

      ${(d.reports || []).length ? html`<section class="panel cy-sec"><h2>${icon('alert')} البلاغات (${num(d.reports.length)})</h2>
        <div class="cy-list">${d.reports.map(r => html`<article class="cy-item is-report" data-report="${r.id}">
          <div class="cy-item-main"><div class="cm-meta"><b>${r.name}</b><span class="muted small">في ${ROOMS[r.room] ? ROOMS[r.room][0] : r.room} · ${timeAgo(r.at)}</span></div>
            <p>${r.text || KIND[r.kind] || ''}</p>
            <small class="muted">بلّغ عنها ${r.reporter_name}${r.why ? ` · السبب: ${r.why}` : ''}</small></div>
          <div class="cm-actions">
            <button class="btn btn-sm btn-danger-soft" data-del="${r.room}:${r.msg}" data-rep="${r.id}">امسح الرسالة</button>
            <button class="btn btn-sm" data-mute="${r.uid}" data-name="${r.name}">أوقفه عن الكتابة</button>
            <button class="btn btn-sm btn-ghost" data-dismiss="${r.id}">تجاهل</button>
          </div></article>`)}</div></section>` : ''}

      <section class="panel cy-sec"><h2>${mark(state.room)} آخر رسائل ${ROOMS[state.room][0]}</h2><div class="cy-list" id="cy-msgs"><div class="spinner"></div></div></section>

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
      const msgs = (r.msgs || []).slice().reverse();
      mount(box, msgs.length ? html`${msgs.map(m => html`<article class="cy-item ${m.del ? 'is-del' : ''}">
        ${av(m)}
        <div class="cy-item-main"><div class="cm-meta"><b>${m.name}</b>${m.badge === 'gold' ? html`<em class="mb-gold-tag">الحساب الرسمي</em>` : ''}<span class="muted small">${timeAgo(m.at)}</span>${m.spoiler ? html`<em class="mb-wait">حرق نتائج</em>` : ''}</div>
          <p>${what(m)}</p>${m.att && m.att.kind === 'image' && !m.del ? html`<a href="${m.att.url}" target="_blank" rel="noopener"><img class="cy-img" src="${m.att.url}" alt="" loading="lazy"></a>` : ''}</div>
        ${m.del ? '' : html`<div class="cm-actions">
          <button class="btn btn-sm btn-danger-soft" data-del="${state.room}:${m.id}">امسح</button>
          ${m.badge === 'gold' ? '' : html`<button class="btn btn-sm" data-mute="${m.uid}" data-name="${m.name}">أوقفه</button><a class="btn btn-sm btn-ghost" href="#/site-members/${m.uid}">صفحته</a>`}
        </div>`}</article>`)}` : html`<p class="muted">لسه مفيش رسائل في الغرفة دي.</p>`);
    } catch (e) { mount(box, html`<p class="muted">${e.message}</p>`); }
  };
  loadRoom();

  page.onclick = async (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    if (b.dataset.room) { state.room = b.dataset.room; renderCommunity(page); return; }
    if (b.dataset.del) {
      const [room, id] = b.dataset.del.split(':');
      const ok = await dialog({ title: 'مسح الرسالة', body: html`<p class="muted small">هتختفي عند كل اللي في الغرفة على طول.</p>`, confirm: 'امسحها', danger: true });
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
