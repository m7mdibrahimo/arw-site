// «البث المباشر» (INCIDENTS #1537, owner 2026-11-25: «تحكم كامل في القسم في اللوحة لو حبيت أضيف حاجة يدوي أو أعدل
// حاجة … كل الصلاحيات معايا كاملة»): every show of /live/, what the sources found and what the owner changed — name,
// time, picture, a note on the page, the full show's page, servers added / hidden / reordered, a show added by hand,
// a show hidden, the whole section off, and a source's new domain when the bot couldn't follow it. (worker/src/live.ts)
import { tools, api } from '../api.js';
import { prepareImage } from '../image.js';
import { html, mount, $, $$, icon, toast, dialog, esc, timeAgo, num } from '../ui.js';
import { viewsOf } from './list.js';

const SITE = 'https://arab-wrestling.com';
const ST = { soon: ['قادم', 'tag-auto'], live: ['مباشر دلوقتي', 'tag-live'], ended: ['خلص', 'tag-off'] };
const SRC = { '1max': '1max', wwre: 'watchwrestling.re', wwae: 'watchwrestling.ae', wwtv: 'watchwrestlingtv' };
const header = (title, text, actions = '') => html`<div class="page-title"><div><a href="#/" class="back">${icon('arrowRight')} الرئيسية</a><h1>${title}</h1><p class="muted">${text}</p></div>${actions ? html`<div class="page-actions">${actions}</div>` : ''}</div>`;
const pad = (n) => String(n).padStart(2, '0');
/** epoch → the value a datetime-local field takes (this device's own time) */
const toLocal = (ms) => { if (!ms) return ''; const d = new Date(ms); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`; };
const fromLocal = (v) => (v ? new Date(v).getTime() : null);
const when = (ms) => new Date(ms).toLocaleString('ar-EG', { weekday: 'long', day: 'numeric', month: 'long', hour: 'numeric', minute: '2-digit', numberingSystem: 'latn' });
/** the show's US date (the key the sources use): its start in New York */
const usDate = (ms) => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(ms));

export async function renderLiveTool(page) {
  mount(page, html`<div class="loading-page"><div class="spinner"></div></div>`);
  let data, open = '';
  try { data = await tools.live(); } catch (e) { return mount(page, html`<div class="empty"><h2>مقدرتش أجيب البث المباشر</h2><p class="muted">${e.message}</p></div>`); }
  // each show page's real views, like every list of the panel (owner 2026-11-26: «توريني عدد المشاهدات في اللوحة للعروض
  // البث المباشر زي باقي المواضيع»): the site's own counter, people only; never holds the page back
  let views = null, viewsSince = '';
  api.pageViews().then((d) => {
    if (!d || !d.views) return;
    views = d.views;
    viewsSince = d.since ? new Date(`${d.since}T12:00:00Z`).toLocaleDateString('ar-EG-u-nu-latn', { day: 'numeric', month: 'long', year: 'numeric' }) : '';
    draw();
  }).catch(() => {});

  const act = async (body, btn, okMsg) => {
    if (btn) btn.classList.add('loading');
    try {
      data = await tools.liveAct(body);
      if (data.pageErr) toast(`اتحفظ، بس صفحة العرض على الموقع متحدثتش: ${data.pageErr}`, 'warn', 7000);
      else if (okMsg) toast(okMsg);
      draw();
      return true;
    } catch (e) { toast(e.message, 'error', 6000); return false; }
    finally { if (btn) btn.classList.remove('loading'); }
  };

  function draw() {
    mount(page, html`<div class="wrap page-in lv-admin">
      ${header('البث المباشر', 'كل عروض قسم «بث مباشر» على الموقع: اللي المصادر جابته لوحدها واللي إنت ضفته أو عدّلته. أي تغيير هنا بيظهر على الموقع خلال دقيقة.',
        html`<a class="btn btn-ghost" href="${SITE}/live/" target="_blank">${icon('eye')} القسم على الموقع</a>
          <button class="btn ${data.off ? 'btn-teal' : 'btn-ghost'}" id="lv-off">${data.off ? html`${icon('check')} رجّع القسم` : html`${icon('eyeOff')} اقفل القسم مؤقتًا`}</button>
          <button class="btn btn-primary" id="lv-new">${icon('plus')} ضيف عرض بإيدك</button>`)}
      ${data.off ? html`<div class="lv-a-warn">${icon('alert')} القسم مقفول دلوقتي: الزوار مش شايفين أي عرض. دوس «رجّع القسم» عشان يرجع.</div>` : ''}
      <section class="panel"><header class="panel-head"><h2>${icon('show')} العروض <span class="count-pill">${data.shows.length}</span></h2></header>
        <div class="rows">${data.shows.length ? data.shows.map(row) : html`<p class="empty-sm">مفيش عروض في القسم دلوقتي — أول ما أي مصدر ينزل عرض هيظهر هنا، أو ضيف واحد بإيدك.</p>`}</div></section>
      <section class="panel"><header class="panel-head"><h2>${icon('globe')} المصادر</h2></header>
        <div class="rows">${data.sources.map(s => html`<div class="row lv-a-src">
          <span class="row-main"><b>${SRC[s.id] || s.id}</b><small><bdi dir="ltr">${s.host}</bdi>${s.movedFrom ? html` · نقل من <bdi dir="ltr">${s.movedFrom}</bdi>` : ''} · ${s.fails ? html`<span class="lv-a-bad">مش بيرد من ${s.fails} دقيقة${s.err ? ` (${s.err})` : ''}</span>` : html`<span class="lv-a-ok">شغال</span>`}${s.okAt ? ` · آخر رد ${timeAgo(s.okAt)}` : ''}</small></span>
          <span class="row-actions"><button class="btn btn-sm" data-host="${s.id}">${icon('edit')} غيّر الدومين</button></span></div>`)}</div></section>
    </div>`);
    bind();
  }

  function row(s) {
    const [stl, stc] = ST[s.st] || ['', ''];
    const isOpen = open === s.key;
    return html`<div class="lv-a-show ${isOpen ? 'is-open' : ''} ${s.hide ? 'is-hidden' : ''}">
      <div class="row">
        <span class="row-img">${s.img ? html`<img src="${s.img.startsWith('/') ? SITE + s.img : s.img}" alt="">` : ''}</span>
        <span class="row-main"><b>${s.t}</b><small><bdi dir="ltr">${s.name}</bdi> · ${when(s.start)} (بتوقيت جهازك)</small>
          <span class="lv-a-tags"><span class="tag ${stc}">${stl}</span>${s.hide ? html`<span class="tag tag-off">مخفي</span>` : ''}${s.own ? html`<span class="tag">مضاف بإيدك</span>` : s.edited ? html`<span class="tag">معدّل</span>` : ''}<span class="tag">${s.servers} سيرفر</span>${s.how === 'usual' ? html`<span class="tag" title="المصادر لسه مقالتش الميعاد بالظبط">ميعاد العرض المعتاد</span>` : ''}</span></span>
        <span class="row-actions">
          ${views ? html`<span class="views-pill" title="${`مشاهدات حقيقية من الناس بس (من غير محركات البحث والروبوتات)${viewsSince ? ` من ${viewsSince}` : ''}`}">${icon('chart')}<b>${num(viewsOf(views, `/live/${s.slug}/`))}</b><small>مشاهدة</small></span>` : ''}
          <a class="btn btn-sm btn-ghost" href="${SITE}/live/${s.slug}/" target="_blank" title="صفحة العرض">${icon('eye')}</a>
          <button class="btn btn-sm" data-open="${s.key}">${icon('edit')} ${isOpen ? 'اقفل' : 'تحكم'}</button></span>
      </div>
      ${isOpen ? editor(s) : ''}
    </div>`;
  }

  // the servers exactly as visitors see them, each once and in order (owner 2026-11-26: no duplicates, nothing that opens
  // outside the site): the number, quality, where it came from, the address it plays; then what the owner hid
  const shortUrl = (u) => { try { const x = new URL(u); return x.hostname.replace(/^www\./, '') + (x.pathname + x.search).replace(/\/$/, ''); } catch { return u; } };
  // what the check found (every ten minutes around a show, .github/workflows/live-check.yml): the fastest playing first,
  // one that answered «not found» last
  const chkLine = (v) => v.x ? '' : v.chk ? (v.chk.ok
    ? html`<span class="lv-a-st ok">شغال · الصورة بتظهر في ${(v.chk.ms / 1000).toFixed(1)} ثانية · اتفحص ${timeAgo(v.chk.at)}</span>`
    : html`<span class="lv-a-st bad">مردّش في الفحص · اتفحص ${timeAgo(v.chk.at)}</span>`)
    : html`<span class="lv-a-st">لسه متفحصش — الفحص بيشتغل قبل العرض بـ3 ساعات</span>`;
  function servList(s) {
    const mine = s.add.map(a => a.u);
    const left = [s.dup ? `${s.dup} ${s.dup === 1 ? 'رابط مكرر' : 'روابط مكررة'} لنفس القناة` : '', s.out ? `${s.out} ${s.out === 1 ? 'رابط بيفتح' : 'روابط مبتشتغلش'} جوه الموقع` : ''].filter(Boolean);
    return html`<div class="lv-a-svs">
      ${s.sv.length ? s.sv.map(v => { const i = mine.indexOf(v.raw); return html`<div class="lv-a-sv ${v.x ? 'is-ext' : ''} ${v.m ? 'is-own' : ''} ${v.d ? 'is-dead' : ''}">
        <span class="lv-a-n">${v.d ? '–' : v.n}</span>
        <span class="lv-a-svm"><b>${v.d ? 'واقف' : `سيرفر ${v.n}`}${v.q ? html`<span class="lv-a-qb">${v.q}</span>` : ''}<span class="lv-a-from">${v.m ? 'سيرفرك' : (SRC[v.src] || v.src || 'مصدر')}</span>${v.x ? html`<span class="tag tag-off">بيفتح في صفحة تانية</span>` : ''}</b>
          <small dir="ltr" title="${v.u}">${shortUrl(v.u)}</small>${chkLine(v)}</span>
        <span class="lv-a-sva">
          <a class="icon-btn sm" href="${v.u}" target="_blank" rel="noopener" title="جرّبه">${icon('eye')}</a>
          ${v.m ? html`<button class="icon-btn sm" data-mv="up" data-u="${v.raw}" ${i > 0 ? '' : 'disabled'} title="لفوق">▲</button><button class="icon-btn sm" data-mv="down" data-u="${v.raw}" ${i > -1 && i < mine.length - 1 ? '' : 'disabled'} title="لتحت">▼</button><button class="icon-btn sm danger" data-rm="${v.raw}" title="امسحه">${icon('x')}</button>`
            : html`<button class="btn btn-sm btn-ghost" data-rm="${v.u}" title="اخفيه عن الزوار">${icon('eyeOff')}<span>اخفيه</span></button>`}
        </span></div>`; }) : html`<p class="empty-sm">مفيش سيرفرات لسه — المصادر بتنزلها قبل العرض بشوية، أو ضيف سيرفر بإيدك.</p>`}
    </div>
    ${s.hidden.length ? html`<h4 class="lv-a-h2">مخفية عن الزوار <span class="count-pill">${s.hidden.length}</span></h4>
      <div class="lv-a-svs is-off">${s.hidden.map(v => html`<div class="lv-a-sv"><span class="lv-a-n">–</span>
        <span class="lv-a-svm"><b>${v.q ? html`<span class="lv-a-qb">${v.q}</span>` : ''}<span class="lv-a-from">${SRC[v.src] || v.src || 'مصدر'}</span></b><small dir="ltr" title="${v.u}">${shortUrl(v.u)}</small></span>
        <span class="lv-a-sva"><button class="btn btn-sm" data-restore="${v.u}" title="رجّعه للزوار">${icon('eye')}<span>رجّعه</span></button></span></div>`)}</div>` : ''}
    ${left.length ? html`<p class="muted lv-a-foot">اتشال لوحده ومش بيظهر للزوار: ${left.join(' · ')}.</p>` : ''}`;
  }

  function editor(s) {
    const q = (v) => html`<select class="input lv-a-q" name="q"><option value="">الجودة</option>${['FHD', 'HD', 'SD', 'LQ'].map(x => html`<option ${v === x ? 'selected' : ''}>${x}</option>`)}</select>`;
    return html`<div class="lv-a-ed" data-key="${s.key}">
      <div class="lv-a-grid">
        <label class="field"><span>الاسم على الموقع</span><input class="input" name="t" value="${s.t}" maxlength="80"></label>
        <label class="field"><span>البداية <small class="muted">بتوقيت جهازك</small></span><input class="input" type="datetime-local" name="start" value="${toLocal(s.start)}"></label>
        <label class="field"><span>النهاية</span><input class="input" type="datetime-local" name="end" value="${toLocal(s.end)}"></label>
        <label class="field"><span>رابط العرض الكامل على الموقع <small class="muted">بيتربط لوحده لما العرض ينزل؛ اكتبه لو عايز تحدده بنفسك</small></span><input class="input" name="vod" dir="ltr" value="${s.vod}" placeholder="/shows/…"></label>
        <label class="field lv-a-wide"><span>ملاحظة تظهر للزوار فوق السيرفرات <small class="muted">(اختياري)</small></span><input class="input" name="note" value="${s.note}" maxlength="300" placeholder="مثلًا: السيرفر 1 أفضل جودة الليلة"></label>
      </div>
      ${s.auto ? html`<p class="muted lv-a-auto">من المصادر: «${s.auto.t}» · ${when(s.auto.start)}</p>` : ''}
      <div class="lv-a-img">
        <span class="row-img">${s.img ? html`<img src="${s.img.startsWith('/') ? SITE + s.img : s.img}" alt="">` : ''}</span>
        <input class="input" name="imgurl" dir="ltr" placeholder="رابط صورة جديدة…">
        <button class="btn btn-sm" data-imgurl>${icon('link')} من الرابط</button>
        <label class="btn btn-sm">${icon('upload')} من جهازك<input type="file" accept="image/*" data-imgfile hidden></label>
      </div>
      <div class="lv-a-acts">
        <button class="btn btn-primary" data-save>${icon('check')} احفظ</button>
        <button class="btn btn-ghost" data-refresh title="يقرا صفحات المصادر للعرض ده تاني خلال دقيقة">${icon('refresh')} حدّث من المصادر</button>
        ${s.st === 'live' ? html`<button class="btn btn-ghost" data-announce title="منشور «بدأ الآن البث المباشر» على تليجرام وفيسبوك وإنستجرام وإكس — بينزل لوحده أول ما العرض يبدأ، مرة واحدة بس">${icon('send')} انشر إن البث شغال</button>` : ''}
        <button class="btn btn-ghost" data-hide>${s.hide ? html`${icon('eye')} أظهره` : html`${icon('eyeOff')} اخفيه`}</button>
        ${s.edited && !s.own ? html`<button class="btn btn-ghost" data-reset>رجّعه زي المصادر</button>` : ''}
        ${s.own ? html`<button class="btn btn-danger" data-del>${icon('trash')} امسحه</button>` : ''}
      </div>
      <h3 class="lv-a-h">${icon('link')} السيرفرات اللي الزوار شايفينها <span class="count-pill">${s.sv.filter(v => !v.d).length}</span></h3>
      <form class="lv-a-add" data-add>
        <input class="input" name="u" dir="ltr" placeholder="رابط سيرفر (embed) أو صفحة بث…" required>
        ${q('')}
        <label class="lv-a-chk"><input type="checkbox" name="x"> بيفتح في صفحة تانية</label>
        <button class="btn btn-sm btn-teal">${icon('plus')} ضيف</button>
      </form>
      ${servList(s)}
    </div>`;
  }

  function bind() {
    $('#lv-off').onclick = async (e) => {
      if (!data.off && !(await dialog({ title: 'تقفل القسم؟', body: 'الزوار مش هيشوفوا أي عرض في «بث مباشر» لحد ما ترجّعه. الصفحات نفسها هتفضل موجودة.', confirm: 'اقفله', danger: true }))) return;
      act({ action: data.off ? 'on' : 'off' }, e.currentTarget, data.off ? 'القسم رجع' : 'القسم اتقفل');
    };
    $('#lv-new').onclick = addShow;
    $$('[data-open]').forEach(b => b.onclick = () => { open = open === b.dataset.open ? '' : b.dataset.open; draw(); });
    $$('[data-host]').forEach(b => b.onclick = async () => {
      const v = await dialog({ title: `الدومين الجديد لـ ${SRC[b.dataset.host] || b.dataset.host}`, body: 'اكتب الدومين بس (زي watchwrestling.to). البوت بيدوّر لوحده لما مصدر ينقل، استخدم ده لو ملقاهوش.', input: { placeholder: 'example.to' }, confirm: 'احفظ' });
      if (v) act({ action: 'host', src: b.dataset.host, host: v }, b, 'الدومين اتغير');
    });
    const ed = $('.lv-a-ed');
    if (!ed) return;
    const key = ed.dataset.key;
    const val = (n) => $(`[name="${n}"]`, ed).value;
    $('[data-save]', ed).onclick = (e) => act({ action: 'save', key, t: val('t'), start: fromLocal(val('start')), end: fromLocal(val('end')), note: val('note'), vod: val('vod') }, e.currentTarget, 'اتحفظ — بيظهر على الموقع خلال دقيقة');
    $('[data-refresh]', ed).onclick = (e) => act({ action: 'refresh', key }, e.currentTarget, 'هيتقري من المصادر تاني خلال دقيقة');
    const ann = $('[data-announce]', ed);
    if (ann) ann.onclick = async (e) => {
      const btn = e.currentTarget;
      if (!(await dialog({ title: 'انشر إن البث شغال؟', body: 'هينزل منشور «بدأ الآن البث المباشر» بصورة العرض ورابط صفحته على تليجرام وفيسبوك وإنستجرام وإكس. بينزل مرة واحدة بس للعرض.', confirm: 'انشر' }))) return;
      btn.classList.add('loading');
      try { const r = await tools.liveAct({ action: 'announce', key }); data = r; toast(r.msg || 'اتنشر'); draw(); }
      catch (err) { toast(err.message, 'error', 6000); }
      finally { btn.classList.remove('loading'); }
    };
    $('[data-hide]', ed).onclick = (e) => { const s = data.shows.find(x => x.key === key); act({ action: s.hide ? 'unhide' : 'hide', key }, e.currentTarget, s.hide ? 'العرض رجع للقسم' : 'العرض اتخفى من القسم'); };
    const reset = $('[data-reset]', ed); if (reset) reset.onclick = async (e) => { const b = e.currentTarget; if (await dialog({ title: 'ترجّع العرض زي المصادر؟', body: 'كل تعديلاتك على العرض ده (الاسم، الميعاد، الصورة، السيرفرات اللي ضفتها أو خبيتها) هتتشال.', confirm: 'رجّعه', danger: true })) act({ action: 'reset', key }, b, 'رجع زي المصادر'); };
    const del = $('[data-del]', ed); if (del) del.onclick = async (e) => { const b = e.currentTarget; if (await dialog({ title: 'تمسح العرض ده؟', body: 'هيتشال من القسم وصفحته هتتمسح من الموقع.', confirm: 'امسحه', danger: true })) { open = ''; act({ action: 'delete', key }, b, 'اتمسح'); } };
    $('[data-imgurl]', ed).onclick = (e) => { const u = val('imgurl').trim(); if (u) act({ action: 'image', key, url: u }, e.currentTarget, 'الصورة اتغيرت'); };
    $('[data-imgfile]', ed).onchange = async (e) => {
      const f = e.target.files[0]; if (!f) return;
      try { const p = await prepareImage(f); act({ action: 'image', key, base64: p.base64 }, null, 'الصورة اتغيرت'); }
      catch (err) { toast(err.message, 'error'); }
    };
    $('[data-add]', ed).onsubmit = (e) => { e.preventDefault(); const f = e.currentTarget; act({ action: 'link-add', key, u: f.u.value.trim(), q: f.q.value, x: f.x.checked }, f.querySelector('button'), 'السيرفر اتضاف'); };
    $$('[data-rm]', ed).forEach(b => b.onclick = () => act({ action: 'link-del', key, u: b.dataset.rm }, b, 'اتشال'));
    $$('[data-restore]', ed).forEach(b => b.onclick = () => act({ action: 'link-restore', key, u: b.dataset.restore }, b, 'رجع'));
    $$('[data-mv]', ed).forEach(b => b.onclick = () => act({ action: 'link-move', key, u: b.dataset.u, dir: b.dataset.mv }, b));
  }

  async function addShow() {
    const progs = data.programs;
    const ok = await dialog({
      title: 'ضيف عرض للبث المباشر بإيدك',
      confirm: 'ضيفه',
      body: html`<div class="lv-a-new">
        <label class="field"><span>البرنامج</span><select class="input" id="n-prog">${progs.map(p => html`<option value="${p.key}">${p.ar} — ${p.fed}</option>`)}<option value="">عرض تاني…</option></select></label>
        <div id="n-other" hidden>
          <label class="field"><span>اسمه بالإنجليزي</span><input class="input" id="n-name" dir="ltr" placeholder="NJPW Wrestle Kingdom 20"></label>
          <label class="field"><span>الاتحاد</span><input class="input" id="n-fed" dir="ltr" placeholder="NJPW" maxlength="12"></label>
        </div>
        <label class="field"><span>الاسم على الموقع</span><input class="input" id="n-ar" maxlength="80"></label>
        <label class="field"><span>البداية <small class="muted">بتوقيت جهازك</small></span><input class="input" type="datetime-local" id="n-start"></label>
        <label class="field"><span>المدة بالساعات</span><input class="input" type="number" id="n-hours" min="0.5" max="14" step="0.5"></label>
        <label class="field"><span>رابط صورة <small class="muted">(اختياري — تقدر تغيرها بعدين)</small></span><input class="input" id="n-img" dir="ltr"></label>
        <p class="muted">لو المصادر نزلت نفس العرض بعدين، سيرفراتها بتتجمع مع العرض ده لوحدها.</p></div>`,
      onOpen: (w) => {
        const sel = w.querySelector('#n-prog'), other = w.querySelector('#n-other'), ar = w.querySelector('#n-ar'), hrs = w.querySelector('#n-hours');
        const fill = () => { const p = progs.find(x => x.key === sel.value); other.hidden = !!p; if (p) { ar.value = p.ar; hrs.value = Math.round((p.dur + 30) / 30) / 2; } else { ar.value = ''; hrs.value = 3; } };
        sel.onchange = fill; fill();
        const st = w.querySelector('#n-start'); const d = new Date(); d.setHours(d.getHours() + 2, 0, 0, 0); st.value = toLocal(d.getTime());
        w.querySelector('[data-ok]').addEventListener('click', () => {
          const p = sel.value, start = fromLocal(st.value), h = Number(hrs.value) || 3;
          const name = w.querySelector('#n-name').value.trim();
          addShow.body = { action: 'add-show', prog: p || name.toLowerCase().replace(/[^a-z0-9]+/g, '-'), name: p ? '' : name, fed: p ? '' : w.querySelector('#n-fed').value, ar: ar.value, start, end: start ? start + h * 3600000 : null, date: start ? usDate(start) : '', img: w.querySelector('#n-img').value.trim() };
        }, true);
      },
    });
    if (ok && addShow.body) { const b = addShow.body; addShow.body = null; if (await act(b, null, 'العرض اتضاف — صفحته على الموقع خلال دقيقة')) { open = `${b.prog}-${b.date}`; draw(); } }
  }

  draw();
}
