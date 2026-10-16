// «التوقعات» in the panel (owner 2026-10-15): a big show's card (its matches and who can win each), open for the
// members' picks until the show starts, then the results, which rank them and tell each one their score.
// The worker: worker/src/predict.ts. The page: /predictions/.
import { api } from '../api.js';
import { html, mount, $, $$, icon, toast, dialog, num } from '../ui.js';

const STATES = { draft: 'مسودة (مش ظاهرة)', open: 'مفتوحة للتوقع', done: 'خلصت (النتائج ظاهرة)' };
const fmt = (ms) => new Date(ms).toLocaleString('ar-EG-u-nu-latn', { day: 'numeric', month: 'long', year: 'numeric', hour: 'numeric', minute: '2-digit' });
// <input type="datetime-local"> speaks the device's own time
const toLocal = (ms) => { const d = new Date(ms - new Date(ms).getTimezoneOffset() * 60000); return d.toISOString().slice(0, 16); };

export async function renderPredictions(page) {
  mount(page, html`<div class="loading-page"><div class="spinner"></div></div>`);
  let d;
  try { d = await api.predict(); } catch (e) { mount(page, html`<div class="empty"><h2>مش متاح دلوقتي</h2><p class="muted">${e.message}</p></div>`); return; }
  const events = d.events || [];
  mount(page, html`
    <div class="wrap page-in">
      <div class="page-title">
        <div><h1>التوقعات</h1>
          <p class="muted">قبل كل عرض كبير ضيف نزالاته · الأعضاء بيتوقعوا الفايز لحد ما العرض يبدأ · بعد العرض حط النتائج، والترتيب بيتحسب ويوصل لكل واحد إشعار بنتيجته</p></div>
        <div class="mb-head-btns"><a class="btn" href="/predictions/" target="_blank" rel="noopener">${icon('globe')}افتح صفحة التوقعات</a><button class="btn btn-primary" id="pd-new">${icon('plus')}عرض جديد</button></div>
      </div>
      ${events.length ? html`<div class="pd-list">${events.map(e => html`<article class="panel pd-card is-${e.status}" data-ev="${e.id}">
        <div class="pd-card-head">
          <div><h2>${e.title}</h2><p class="muted small">${fmt(e.starts)} · ${STATES[e.status] || e.status} · ${num(e.matches.length)} نزال · ${num(e.players)} عضو اتوقع</p></div>
          <div class="pd-card-acts">
            <button class="btn ${e.players ? 'btn-primary' : 'btn-ghost'}" data-who="${e.id}" ${e.players ? '' : 'disabled'}>${icon('users')}مين توقع إيه (${num(e.players)})</button>
            <button class="btn btn-ghost" data-edit="${e.id}">${icon('edit')}تعديل</button>
            <button class="btn ${e.status === 'done' ? 'btn-ghost' : 'pr-btn'}" data-result="${e.id}">${icon('trophy')}${e.status === 'done' ? 'عدّل النتائج' : 'النتائج'}</button>
            <button class="btn btn-danger-soft" data-del="${e.id}">${icon('trash')}</button>
          </div>
        </div>
        ${e.status === 'done' ? prizeRow(e, d.prizeDays || 30) : ''}
        <ol class="pd-card-ms">${e.matches.map(m => html`<li>${m.image ? html`<img class="pd-card-mimg" src="${m.image}" alt="" loading="lazy">` : ''}<b>${m.title}</b>${m.note ? html`<span class="muted small">${m.note}</span>` : ''}<span class="muted small">${m.options.join(' · ')}${m.points > 1 ? ` · ${m.points} نقط` : ''} · ${num(m.picks)} توقع</span>${m.winner ? html`<span class="pd-win">🏆 ${m.winner}</span>` : ''}</li>`)}</ol>
      </article>`)}</div>` : html`<div class="empty"><h2>لسه مفيش توقعات</h2><p class="muted">دوس «عرض جديد» وضيف نزالات أول عرض كبير جاي.</p></div>`}
    </div>`);
  $('#pd-new').onclick = () => editor(page, null);
  $$('[data-edit]', page).forEach(b => b.onclick = () => editor(page, events.find(e => String(e.id) === b.dataset.edit)));
  $$('[data-result]', page).forEach(b => b.onclick = () => results(page, events.find(e => String(e.id) === b.dataset.result)));
  $$('[data-who]', page).forEach(b => b.onclick = () => whoPicked(page, b.dataset.who));
  // the show's prize (paid membership): given by the owner's own tap, once (the worker refuses anyone else)
  $$('[data-prize]', page).forEach(b => b.onclick = async () => {
    const e = events.find(x => String(x.id) === b.dataset.prize), c = e.champion;
    const ok = await dialog({ title: `جايزة «${e.title}»`, body: html`<p class="muted small">هيتفعل لـ <b>${c.name}</b> (@${c.user}) شهر في العضوية المميزة (${num(d.prizeDays || 30)} يوم)، ويوصله إشعار بالمبروك. ده بيحصل مرة واحدة بس للعرض ده.</p>`, confirm: 'فعّل الجايزة' });
    if (!ok) return;
    b.disabled = true;
    try { await api.predictPrize(e.id); toast(`اتفعلت ✓ ${c.name} بقى مميز لمدة شهر`); renderPredictions(page); } catch (err) { toast(err.message, 'error'); b.disabled = false; }
  });
  $$('[data-del]', page).forEach(b => b.onclick = async () => {
    const e = events.find(x => String(x.id) === b.dataset.del);
    const ok = await dialog({ title: `مسح «${e.title}»`, body: html`<p class="muted small">التوقعات دي هتتمسح هي وكل توقعات الأعضاء فيها، ونقطها هتخرج من الترتيب.</p>`, confirm: 'امسحها', danger: true });
    if (!ok) return;
    try { await api.predictDelete(e.id); toast('اتمسحت ✓'); renderPredictions(page); } catch (err) { toast(err.message, 'error'); }
  });
}

// who picked what in one show (owner 2026-10-17: «اديني الصلاحية دي كاملة بتاعت التوقعات»): by match — each option with
// the members who picked it — or by member — each one's whole card and score
const AV = (import.meta.url.match(/\/admin\/([^/]+)\/js\//) || [])[1] || '';
const picSrc = (pic) => { pic = String(pic || ''); return pic === 'official' ? '/assets/brand-logo.png' : /^w:[a-z0-9-]+$/.test(pic) ? `/avatars/${pic.slice(2)}.webp${AV ? `?v=${AV}` : ''}` : /^https:\/\//.test(pic) ? pic : ''; };
const initial = (name) => (String(name).trim().replace(/^ال(?=\S{2})/, '').match(/\S/) || ['؟'])[0].toUpperCase();
const person = (p) => html`<a class="pd-who-p ${p.prem ? 'is-prem' : ''}" href="#/site-members/${p.member}" title="@${p.user}"><span class="pd-who-av">${picSrc(p.pic) ? html`<img src="${picSrc(p.pic)}" alt="" loading="lazy">` : initial(p.name)}</span><span>${p.name}</span></a>`;
async function whoPicked(page, id) {
  mount(page, html`<div class="loading-page"><div class="spinner"></div></div>`);
  let d;
  try { d = await api.predictPicks(id); } catch (e) { toast(e.message, 'error'); renderPredictions(page); return; }
  const done = d.event.status === 'done';
  let view = 'match';
  const draw = () => {
    mount(page, html`<div class="wrap page-in pd-who">
      <div class="page-title"><div><h1>مين توقع إيه · ${d.event.title}</h1><p class="muted">${num(d.members.length)} عضو اتوقع · ${fmt(d.event.starts)}${done ? ' · النتائج اتعلنت' : ''}</p></div>
        <div class="mb-head-btns"><button class="btn btn-ghost" id="pd-back">${icon('arrowRight')}رجوع</button></div></div>
      <div class="chips pd-who-tabs"><button type="button" class="chip ${view === 'match' ? 'active' : ''}" data-view="match">حسب النزال</button><button type="button" class="chip ${view === 'member' ? 'active' : ''}" data-view="member">حسب العضو</button></div>
      ${view === 'match' ? html`<div class="pd-who-ms">${d.matches.map((m, k) => {
        const total = Object.values(m.by).reduce((t, l) => t + l.length, 0);
        return html`<section class="panel pd-who-m"><h2><span class="muted">${k + 1}.</span> ${m.title} <span class="muted small">${num(total)} توقع</span></h2>
          ${m.options.map(o => { const list = m.by[o] || [], p = total ? Math.round(list.length * 100 / total) : 0;
            return html`<div class="pd-who-o ${m.winner === o ? 'is-win' : m.winner ? 'is-lose' : ''}"><div class="pd-who-oh"><b>${m.winner === o ? '🏆 ' : ''}${o}</b><span class="muted small">${num(list.length)} · ${p}%</span></div>
              <div class="pd-who-bar"><i style="width:${p}%"></i></div>
              ${list.length ? html`<div class="pd-who-ps">${list.map(person)}</div>` : html`<p class="muted small">محدش اختاره.</p>`}</div>`; })}
        </section>`; })}</div>`
      : html`<section class="panel"><div class="pd-who-tbl" role="table">
          <div class="pd-who-tr is-head" role="row"><span role="columnheader">العضو</span>${done ? html`<span role="columnheader">النقط</span>` : ''}${d.matches.map((m, k) => html`<span role="columnheader" title="${m.title}">${k + 1}</span>`)}</div>
          ${d.members.map((p, i) => html`<div class="pd-who-tr" role="row"><span role="cell">${done ? html`<em class="pd-who-rank">${i + 1}</em>` : ''}${person(p)}</span>${done ? html`<span role="cell"><b>${num(p.points)}</b><small class="muted"> · ${num(p.right)} صح</small></span>` : ''}${d.matches.map(m => { const o = p.picks[m.id]; return html`<span role="cell" class="${o && m.winner ? (o === m.winner ? 'is-ok' : 'is-no') : ''}">${o || '—'}</span>`; })}</div>`)}
        </div><p class="muted small">الأرقام فوق هي أرقام النزالات بالترتيب. ${done ? 'الأخضر توقع صح، والأحمر غلط.' : 'النقط بتظهر بعد ما تعلن النتائج.'}</p></section>`}
    </div>`);
    $('#pd-back').onclick = () => renderPredictions(page);
    $$('[data-view]', page).forEach(b => b.onclick = () => { view = b.dataset.view; draw(); });
  };
  draw();
}

// who won the show's prize, and whether it's been given
function prizeRow(e, days) {
  const c = e.champion;
  if (!c) return html`<div class="pd-prize-row is-none">${icon('trophy')}<span class="muted small">جايزة العرض: مفيش فايز (محدش جاب نقط)</span></div>`;
  return html`<div class="pd-prize-row ${c.granted ? 'is-given' : ''}">${icon('trophy')}
    <span><b>الفايز بالجايزة: ${c.name}</b> <span class="muted small">@${c.user} · ${num(c.points)} نقطة · أصاب ${num(c.right)}</span></span>
    ${c.granted ? html`<span class="pd-prize-done">✓ اتفعل له شهر مميز${c.at ? ` · ${fmt(c.at)}` : ''}</span>`
      : html`<button class="btn btn-primary" data-prize="${e.id}">${icon('check')}فعّل له شهر مميز (${num(days)} يوم)</button>`}
  </div>`;
}

function editor(page, ev) {
  const e = ev ? JSON.parse(JSON.stringify(ev)) : { title: '', title_en: '', starts: Date.now() + 2 * 864e5, image: '', status: 'open', matches: [{ title: '', note: '', image: '', options: ['', ''], points: 1 }] };
  const draw = () => {
    mount(page, html`<div class="wrap page-in pd-ed">
      <div class="page-title"><div><h1>${ev ? 'تعديل التوقعات' : 'توقعات عرض جديد'}</h1><p class="muted">كل نزال ليه اسم، واختيارات للفايز (اتنين أو أكتر)، ونقط للتوقع الصح.</p></div>
        <div class="mb-head-btns"><button class="btn btn-ghost" id="pd-back">${icon('arrowRight')}رجوع</button><button class="btn btn-primary" id="pd-save">${icon('check')}احفظ</button></div></div>
      <section class="panel pd-ed-main">
        <label class="field"><span>اسم العرض</span><input class="input" data-k="title" value="${e.title}" placeholder="مثلا: رسلمانيا 43" maxlength="120"></label>
        <label class="field"><span>الاسم بالإنجليزي (للنسخة الإنجليزي)</span><input class="input" dir="ltr" data-k="title_en" value="${e.title_en || ''}" placeholder="WrestleMania 43" maxlength="120"></label>
        <label class="field"><span>ميعاد بداية العرض (التوقعات بتتقفل ساعتها، بتوقيت جهازك)</span><input class="input" type="datetime-local" data-k="starts" value="${toLocal(e.starts)}"></label>
        <label class="field"><span>صورة (رابط، اختياري)</span><input class="input" dir="ltr" data-k="image" value="${e.image || ''}" placeholder="https://… أو /content/images/…"></label>
        <label class="field"><span>الحالة</span><select class="input" data-k="status">${['draft', 'open'].map(s => html`<option value="${s}" ${(e.status === s || (e.status === 'done' && s === 'open')) ? 'selected' : ''}>${STATES[s]}</option>`)}</select></label>
      </section>
      <section class="panel"><h2>${icon('trophy')} النزالات</h2>
        <div class="pd-ed-ms">${e.matches.map((m, i) => html`<article class="pd-ed-m" data-i="${i}">
          <div class="pd-ed-m-top"><b>${i + 1}</b><input class="input" data-m="title" value="${m.title}" placeholder="مثلا: كودي رودز ضد جون سينا (بطولة WWE)" maxlength="160">
            <select class="input pd-pts" data-m="points" title="نقط التوقع الصح">${[1, 2, 3].map(p => html`<option value="${p}" ${Number(m.points) === p ? 'selected' : ''}>${p} ${p === 1 ? 'نقطة' : 'نقط'}</option>`)}</select>
            <button class="btn btn-ghost" data-mdel="${i}" title="شيل النزال">${icon('trash')}</button></div>
          <input class="input" data-m="note" value="${m.note || ''}" placeholder="سطر تحته (اختياري): مثلا «على بطولة WWE · كودي البطل»" maxlength="160">
          <textarea class="input" data-m="options" rows="2" placeholder="الاختيارات: كل اسم في سطر">${m.options.join('\n')}</textarea>
          <input class="input" dir="ltr" data-m="image" value="${m.image || ''}" placeholder="صورة النزال (رابط، اختياري): https://… أو /assets/…">
        </article>`)}</div>
        <button class="btn" id="pd-addm">${icon('plus')}ضيف نزال</button>
      </section>
    </div>`);
    $('#pd-back').onclick = () => renderPredictions(page);
    $('#pd-addm').onclick = () => { read(); e.matches.push({ title: '', note: '', image: '', options: ['', ''], points: 1 }); draw(); };
    $$('[data-mdel]', page).forEach(b => b.onclick = () => { read(); e.matches.splice(Number(b.dataset.mdel), 1); draw(); });
    $('#pd-save').onclick = async (ev2) => {
      read();
      const btn = ev2.currentTarget; btn.disabled = true;
      try { await api.predictSave({ ...e, matches: e.matches.map(m => ({ id: m.id || 0, title: m.title, note: m.note || '', image: m.image || '', options: m.options.filter(Boolean), points: m.points })) }); toast('اتحفظت ✓ هتظهر على الموقع حالا'); renderPredictions(page); }
      catch (err) { toast(err.message, 'error'); btn.disabled = false; }
    };
  };
  const read = () => {
    $$('[data-k]', page).forEach(inp => { const k = inp.dataset.k; e[k] = k === 'starts' ? (new Date(inp.value).getTime() || e.starts) : inp.value.trim(); });
    $$('.pd-ed-m', page).forEach(el => {
      const m = e.matches[Number(el.dataset.i)];
      m.title = $('[data-m="title"]', el).value.trim();
      m.points = Number($('[data-m="points"]', el).value) || 1;
      m.options = $('[data-m="options"]', el).value.split(/\n|،|,/).map(x => x.trim()).filter(Boolean);
      m.note = $('[data-m="note"]', el).value.trim();
      m.image = $('[data-m="image"]', el).value.trim();
    });
  };
  draw();
}

function results(page, ev) {
  const winners = Object.fromEntries(ev.matches.map(m => [m.id, m.winner || '']));
  mount(page, html`<div class="wrap page-in pd-ed">
    <div class="page-title"><div><h1>نتائج ${ev.title}</h1><p class="muted">اختار الفايز في كل نزال. «حفظ» بس بيحفظ، و«أعلن النتائج» بيحسب النقط ويظهر الترتيب ويبعت لكل عضو اتوقع إشعار بنتيجته (مرة واحدة).</p></div>
      <div class="mb-head-btns"><button class="btn btn-ghost" id="pd-back">${icon('arrowRight')}رجوع</button><button class="btn" id="pd-save">${icon('check')}حفظ</button><button class="btn btn-primary" id="pd-finish">${icon('trophy')}${ev.status === 'done' ? 'حفظ النتائج' : 'أعلن النتائج'}</button></div></div>
    <section class="panel"><ol class="pd-res">${ev.matches.map(m => html`<li><b>${m.title}</b><span class="muted small">${num(m.picks)} توقع</span>
      <div class="pd-res-opts" data-match="${m.id}">${m.options.map(o => html`<button type="button" class="chip ${winners[m.id] === o ? 'active' : ''}" data-o="${o}">${o}</button>`)}<button type="button" class="chip ${winners[m.id] ? '' : 'active'}" data-o="">ولا حد لسه</button></div></li>`)}</ol></section>
  </div>`);
  $$('.pd-res-opts', page).forEach(g => $$('[data-o]', g).forEach(b => b.onclick = () => { winners[g.dataset.match] = b.dataset.o; $$('[data-o]', g).forEach(x => x.classList.toggle('active', x === b)); }));
  $('#pd-back').onclick = () => renderPredictions(page);
  const save = async (finish, btn) => {
    if (finish && ev.status !== 'done') {
      const missing = ev.matches.filter(m => !winners[m.id]).length;
      const ok = await dialog({ title: 'إعلان النتائج', body: html`<p class="muted small">${missing ? `فيه ${missing} نزال من غير فايز، ومش هيتحسبوا. ` : ''}هيتحسب الترتيب ويوصل إشعار لكل عضو اتوقع.</p>`, confirm: 'أعلن النتائج' });
      if (!ok) return;
    }
    btn.disabled = true;
    try { const r = await api.predictResult(ev.id, winners, finish); toast(finish && r.told ? `اتعلنت ✓ وصل إشعار لـ ${num(r.told)} عضو` : 'اتحفظت ✓'); renderPredictions(page); }
    catch (err) { toast(err.message, 'error'); btn.disabled = false; }
  };
  $('#pd-save').onclick = (e2) => save(ev.status === 'done', e2.currentTarget);
  $('#pd-finish').onclick = (e2) => save(true, e2.currentTarget);
}
