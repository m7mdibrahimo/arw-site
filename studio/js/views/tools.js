// Publishing tools — what the old /admin/ pages did, inside the panel:
// social posting, news sources, the home slider's pinned items and show reels.
import { tools, siteData, trackLive } from '../api.js';
import { html, raw, mount, $, $$, icon, toast, dialog, timeAgo, num, normalizeArabic, debounce, esc } from '../ui.js';

const SITE = 'https://arab-wrestling.com';
const PLATFORMS = [
  { key: 'telegram', name: 'تيليجرام', icon: 'telegram', color: '#24a1de' },
  { key: 'facebook', name: 'فيسبوك', icon: 'facebook', color: '#1877f2' },
  { key: 'instagram', name: 'إنستجرام', icon: 'instagram', color: '#e1306c' },
  { key: 'x', name: 'إكس', icon: 'send', color: '#141414' },
];
const KIND = { show: 'عرض', recap: 'ملخص', news: 'خبر', nostalgia: 'نوستالجيا' };
const RESULT = {
  sent: ['ok', 'اتنشر ✓'], already_sent: ['skip', 'كان متنشر قبل كده (اتخطى عشان ميتكررش)'], not_configured: ['skip', 'مش متوصلة على الخادم'],
  uncertain: ['warn', 'مش متأكد اتنشر ولا لأ — بص على الحساب نفسه قبل ما تعيد'], failed: ['bad', 'فشل'], deferred: ['warn', 'اتأجل، هيتحاول تاني تلقائي'],
};
const img = (i) => (i ? (i.startsWith('http') || i.startsWith('/') ? i : `/${i}`) : '');
const header = (title, text, actions = '') => html`<div class="page-title"><div><a href="#/" class="back">${icon('arrowRight')} الرئيسية</a><h1>${title}</h1><p class="muted">${text}</p></div>${actions ? html`<div class="page-actions">${actions}</div>` : ''}</div>`;

// ── Social: post any site item to the platforms by hand ─────────────────────
export async function renderSocialTool(page) {
  mount(page, html`<div class="loading-page"><div class="spinner"></div></div>`);
  const index = await siteData('search-index.json').catch(() => []);
  const items = index.filter(i => i.url && ['show', 'recap', 'news', 'nostalgia'].includes(i.kind))
    .sort((a, b) => Date.parse(b.date) - Date.parse(a.date)).slice(0, 80);
  let status = {}, automatic = {}, filter = 'all', q = '';
  const selected = new Set();
  mount(page, html`<div class="wrap page-in">
    ${header('النشر على المنصات', 'انشر أي عرض أو ملخص أو خبر على تيليجرام وفيسبوك وإنستجرام وإكس بإيدك. النشر التلقائي شغال لوحده؛ دي للحالات اللي انت عايز تتحكم فيها.')}
    <div class="filterbar">
      <div class="search search-wide">${icon('search')}<input id="q" placeholder="ابحث في آخر ٨٠ موضوع…"></div>
      <div class="seg" id="filters">${[['all', 'الكل'], ['unsent', 'لسه متنشرش كامل'], ['show', 'عروض'], ['recap', 'ملخصات'], ['news', 'أخبار']].map(([k, l], n) => html`<button type="button" data-f="${k}" class="${n ? '' : 'on'}">${l}</button>`)}</div>
    </div>
    <div class="batchbar" id="batch" hidden><b id="batch-count"></b><button class="btn btn-primary btn-sm" id="batch-go">${icon('send')} انشر المحدد</button><button class="btn btn-ghost btn-sm" id="batch-clear">إلغاء التحديد</button></div>
    <div class="rows" id="list"></div>
  </div>`);

  const done = (u) => { const s = status[u]; return s && !s.held && s.telegram && s.facebook && s.instagram; };
  const visible = () => items.filter(i => (filter === 'all' || (filter === 'unsent' ? !done(i.url) : i.kind === filter))
    && (!q || normalizeArabic(`${i.title} ${i.headline || ''}`).includes(q)));
  const dots = (u) => { const s = status[u]; return html`<span class="plat-dots">${PLATFORMS.map(p => html`<i class="${s && s[p.key] && !s.held ? 'on' : ''}" style="--c:${p.color}" title="${p.name}: ${!s ? '…' : s.held ? 'محجوب' : s[p.key] ? `اتنشر ${timeAgo(s[p.key])}` : 'لسه'}">${icon(p.icon)}</i>`)}</span>`; };
  const draw = () => {
    const list = visible();
    mount($('#list'), list.length ? html`${list.map(i => html`<div class="row tool-row ${selected.has(i.url) ? 'is-sel' : ''}">
      <label class="row-check"><input type="checkbox" data-sel="${i.url}" ${selected.has(i.url) ? 'checked' : ''}></label>
      <a class="row-img" href="${i.url}" target="_blank">${i.image ? html`<img src="${img(i.image)}" alt="" loading="lazy">` : ''}</a>
      <a class="row-main" href="${i.url}" target="_blank"><b>${i.headline || i.title}</b>
        <small>${KIND[i.kind] || ''} · ${timeAgo(i.date)}${status[i.url]?.held ? ' · محجوب عن المنصات (حرق)' : ''}</small></a>
      <span class="row-actions">${dots(i.url)}<button class="btn btn-sm" data-pub="${i.url}">${icon('send')} نشر</button></span>
    </div>`)}` : html`<p class="empty-sm">مفيش مواضيع هنا.</p>`);
    $$('[data-sel]').forEach(c => c.onchange = () => { c.checked ? selected.add(c.dataset.sel) : selected.delete(c.dataset.sel); draw(); });
    $$('[data-pub]').forEach(b => b.onclick = () => publish([items.find(i => i.url === b.dataset.pub)]));
    $('#batch').hidden = !selected.size;
    $('#batch-count').textContent = `${num(selected.size)} محدد`;
  };
  const refresh = async (urls = items.map(i => i.url)) => {
    try { const r = await tools.socialStatus(urls); Object.assign(status, r.items); automatic = r.automatic || {}; } catch (e) { toast(e.message, 'error'); }
    draw();
  };

  async function publish(list) {
    const one = list.length === 1 ? list[0] : null;
    const s = one ? status[one.url] || {} : {};
    const ok = await dialog({
      title: one ? 'نشر على المنصات' : `نشر ${num(list.length)} موضوع على المنصات`,
      body: html`${one ? html`<p>«${one.headline || one.title}»</p>` : ''}
        ${one && s.held ? html`<div class="alert alert-info">الموضوع ده اتحجب تلقائي عشان شكله فيه حرق. متأكد إنه مفيهوش؟</div>` : ''}
        <div class="plat-pick">${PLATFORMS.map(p => html`<label class="check"><input type="checkbox" class="pick" value="${p.key}" ${(one ? !s[p.key] || s.held : true) && (p.key !== 'x' || automatic.x) ? 'checked' : ''}><span>${p.name}${one && s[p.key] && !s.held ? ' (اتنشر قبل كده)' : ''}${p.key === 'x' && !automatic.x ? ' (متوقف)' : ''}</span></label>`)}</div>
        <label class="check"><input type="checkbox" id="force"><span>انشره تاني حتى لو كان اتنشر قبل كده</span></label>`,
      confirm: 'انشر',
    });
    const picked = $$('.pick').filter(c => c.checked).map(c => c.value);
    const force = !!($('#force') && $('#force').checked);
    if (!ok) return;
    if (!picked.length) return toast('اختار منصة واحدة على الأقل.', 'error');
    const log = [];
    const box = document.createElement('div');
    box.className = 'pub-progress';
    document.body.appendChild(box);
    const paint = (cur) => { box.innerHTML = `<b>${esc(cur)}</b>${log.slice(-6).map(l => `<small class="r-${l[0]}">${esc(l[1])}</small>`).join('')}`; };
    for (const [n, item] of list.entries()) {
      for (const p of picked) {
        const pname = PLATFORMS.find(x => x.key === p).name;
        paint(`(${n + 1}/${list.length}) ${pname}: ${(item.headline || item.title).slice(0, 60)}`);
        try {
          const r = await tools.publish(item, p, force);
          const st = r.results ? r.results[p] : r.code === 'CONTENT_NOT_ELIGIBLE' ? 'old' : 'failed';
          const [k, text] = st === 'old' ? ['skip', 'قديم، مستبعد من النشر'] : RESULT[st] || ['bad', r.error || st];
          log.push([k, `${pname}: ${text}`]);
        } catch (e) { log.push(['bad', `${pname}: ${e.message}`]); }
      }
    }
    paint('خلص ✓');
    setTimeout(() => box.remove(), 9000);
    box.onclick = () => box.remove();
    const bad = log.filter(l => l[0] === 'bad').length;
    toast(bad ? `خلص، بس ${num(bad)} محاولة فشلت — التفاصيل تحت.` : 'خلص النشر ✓', bad ? 'error' : 'ok', 6000);
    selected.clear();
    refresh(list.map(i => i.url));
  }

  $('#q').oninput = debounce((e) => { q = normalizeArabic(e.target.value.trim()); draw(); }, 200);
  $$('#filters button').forEach(b => b.onclick = () => { filter = b.dataset.f; $$('#filters button').forEach(x => x.classList.toggle('on', x === b)); draw(); });
  $('#batch-go').onclick = () => publish(items.filter(i => selected.has(i.url)));
  $('#batch-clear').onclick = () => { selected.clear(); draw(); };
  draw();
  refresh();
}

// ── News sources: the three bots, their latest posts, pause and manual add ──
export async function renderSourcesTool(page) {
  mount(page, html`<div class="loading-page"><div class="spinner"></div></div>`);
  let data;
  try { data = await tools.sources(); } catch (e) { return mount(page, html`<div class="empty"><h2>مقدرتش أجيب المصادر</h2><p class="muted">${e.message}</p></div>`); }
  const picked = new Set();
  const STATUS = { site: ['tag-auto', 'نزل على الموقع'], skipped: ['tag', 'اتخطى'], waiting: ['tag-sched', 'لسه'] };
  mount(page, html`<div class="wrap page-in">
    ${header('مصادر الأخبار', 'البوتات بتفحص فايتفول ورسلينغ إنك ورينغسايد نيوز لوحدها كل ١٠–٢٠ دقيقة وتكتب الأخبار بالعربي.',
      html`<button class="btn" id="check-now">${icon('refresh')} افحص دلوقتي</button>
        <button class="btn ${data.paused ? 'btn-primary' : 'btn-danger'}" id="pause">${data.paused ? html`${icon('check')} شغّل سحب الأخبار` : 'إيقاف سحب الأخبار'}</button>`)}
    ${data.paused ? html`<div class="alert alert-error">سحب الأخبار متوقف دلوقتي — مفيش أخبار جديدة هتنزل لحد ما تشغّله.</div>` : ''}
    <form class="add-link" id="add-form"><input class="input" id="add-url" dir="ltr" placeholder="الصق رابط خبر من فايتفول أو رسلينغ إنك أو رينغسايد نيوز…"><button class="btn btn-primary">${icon('plus')} ضيفه للموقع</button></form>
    <div class="batchbar" id="batch" hidden><b id="batch-count"></b><button class="btn btn-primary btn-sm" id="batch-go">${icon('plus')} ضيف المحدد للموقع</button></div>
    ${data.sources.map(s => html`<section class="panel src-panel">
      <header class="panel-head"><h2>${icon('bolt')} ${s.name}</h2>
        <span class="muted small">آخر فحص ${s.lastChecked ? timeAgo(s.lastChecked) : '—'} · ${num(s.posts.filter(p => p.status === 'site').length)} من آخر ${num(s.posts.length)} نزلوا${s.apiCallsToday != null ? ` · ${num(s.apiCallsToday)} طلب كتابة النهارده` : ''}</span></header>
      <div class="rows">${s.posts.map(p => html`<div class="row src-row">
        <label class="row-check">${p.status !== 'site' ? html`<input type="checkbox" data-pick="${p.link}">` : ''}</label>
        <a class="row-img" href="${p.link}" target="_blank" rel="noopener">${p.image ? html`<img src="${p.image}" alt="" loading="lazy" referrerpolicy="no-referrer">` : ''}</a>
        <a class="row-main" href="${p.link}" target="_blank" rel="noopener" dir="ltr"><b>${p.title}</b>
          <small dir="rtl"><span class="tag ${STATUS[p.status][0]}">${STATUS[p.status][1]}</span> · ${timeAgo(p.date)}${p.skipReason ? ` · ${p.skipReason}` : ''}</small></a>
        <span class="row-actions">${p.site ? html`<a class="btn btn-sm" href="${p.site.url}" target="_blank" title="${p.site.title}">${icon('eye')} خبرنا</a>` : ''}</span>
      </div>`)}</div></section>`)}
    <p class="muted small center">«لسه» يعني البوت لسه مكتبهوش (هيتكتب في الفحص الجاي أو اتأخر). «اتخطى» يعني مكرر أو ملوش لازمة للموقع.</p>
  </div>`);

  const add = async (urls) => {
    try { const r = await tools.addNews(urls); toast(`${r.message || 'اتبعت'} — الخبر بيظهر بعد ٣–٥ دقايق.`, 'ok', 7000); }
    catch (e) { toast(e.message, 'error'); }
  };
  $$('[data-pick]').forEach(c => c.onchange = () => {
    c.checked ? picked.add(c.dataset.pick) : picked.delete(c.dataset.pick);
    $('#batch').hidden = !picked.size;
    $('#batch-count').textContent = `${num(picked.size)} محدد`;
  });
  $('#batch-go').onclick = async () => { await add([...picked]); picked.clear(); $$('[data-pick]').forEach(c => { c.checked = false; }); $('#batch').hidden = true; };
  $('#add-form').onsubmit = async (e) => {
    e.preventDefault();
    const u = $('#add-url').value.trim();
    if (!/^https?:\/\/(www\.)?(fightful|wrestlinginc|ringsidenews)\.com\//i.test(u)) return toast('الرابط لازم يكون من فايتفول أو رسلينغ إنك أو رينغسايد نيوز.', 'error');
    await add([u]);
    $('#add-url').value = '';
  };
  $('#check-now').onclick = async () => { try { await tools.checkAll(); toast('البوت بيفحص دلوقتي — الجديد بيظهر خلال دقايق.'); } catch (e) { toast(e.message, 'error'); } };
  $('#pause').onclick = async () => {
    if (!data.paused && !(await dialog({ title: 'إيقاف سحب الأخبار', body: 'البوتات التلاتة هتوقف كتابة أخبار جديدة لحد ما ترجع تشغّلها. النشر على المنصات والموقع نفسه شغالين عادي.', confirm: 'إيقاف', danger: true }))) return;
    try { await tools.pause(!data.paused); toast(data.paused ? 'رجع سحب الأخبار ✓' : 'اتوقف سحب الأخبار.'); renderSourcesTool(page); } catch (e) { toast(e.message, 'error'); }
  };
}

// ── Pinned: the home page slider ────────────────────────────────────────────
export async function renderPinnedTool(page) {
  mount(page, html`<div class="loading-page"><div class="spinner"></div></div>`);
  let items, sha;
  try { const r = await tools.pinned(); items = r.items || []; sha = r.sha; } catch (e) { return mount(page, html`<div class="empty"><h2>مقدرتش أجيب المثبت</h2><p class="muted">${e.message}</p></div>`); }
  const index = (await siteData('search-index.json').catch(() => [])).filter(i => i.url && i.title).sort((a, b) => Date.parse(b.date) - Date.parse(a.date));
  let dirty = false, q = '', kind = '';
  mount(page, html`<div class="wrap page-in">
    ${header('المثبت في الرئيسية', 'المواضيع اللي بتظهر في الشريط الكبير أول الصفحة الرئيسية للموقع، بالترتيب.', html`<button class="btn btn-primary" id="save" disabled>${icon('check')} حفظ ونشر</button>`)}
    <section class="panel"><header class="panel-head"><h2>${icon('pin')} المثبت دلوقتي <span class="count-pill" id="count"></span></h2></header><div class="rows" id="pinned"></div></section>
    <section class="panel"><header class="panel-head"><h2>${icon('plus')} ثبّت موضوع</h2></header>
      <div class="filterbar pin-filters">
        <div class="seg" id="kinds">${[['', 'الكل'], ['show', 'عروض'], ['recap', 'ملخصات'], ['news', 'أخبار'], ['nostalgia', 'نوستالجيا']].map(([k, l]) => html`<button type="button" data-kind="${k}" class="${k ? '' : 'on'}">${l}</button>`)}</div>
        <div class="search search-wide">${icon('search')}<input id="q" placeholder="ابحث في مواضيع الموقع…"></div>
      </div><div class="rows" id="avail"></div></section>
  </div>`);
  const mark = () => { dirty = true; $('#save').disabled = false; };
  const drawPinned = () => {
    $('#count').textContent = num(items.length);
    mount($('#pinned'), items.length ? html`${items.map((it, n) => html`<div class="row pin-row" data-row="${n}">
      <span class="pin-rank drag-handle" data-drag="${n}" title="اسحب لفوق أو لتحت">${num(n + 1)}</span>
      <span class="row-img">${it.image ? html`<img src="${img(it.image)}" alt="">` : ''}</span>
      <span class="row-main"><b>${it.title}</b><small><bdi dir="ltr">${it.subtitle || ''}</bdi> · ${it.federation || ''} · ${it.kindLabel || KIND[it.kind] || ''}</small>
        <label class="pin-badge">الشارة <input class="input" data-badge="${n}" value="${it.badge || ''}" maxlength="30"></label></span>
      <span class="row-actions">
        <button class="icon-btn sm" data-up="${n}" title="لفوق" ${n ? '' : 'disabled'}>▲</button>
        <button class="icon-btn sm" data-down="${n}" title="لتحت" ${n < items.length - 1 ? '' : 'disabled'}>▼</button>
        <button class="icon-btn sm danger" data-rm="${n}" title="شيله">${icon('x')}</button></span>
    </div>`)}` : html`<p class="empty-sm">مفيش حاجة مثبتة — الشريط هيعرض أحدث المواضيع.</p>`);
    $$('[data-up]').forEach(b => b.onclick = () => { const n = +b.dataset.up; [items[n - 1], items[n]] = [items[n], items[n - 1]]; mark(); drawPinned(); });
    $$('[data-down]').forEach(b => b.onclick = () => { const n = +b.dataset.down; [items[n + 1], items[n]] = [items[n], items[n + 1]]; mark(); drawPinned(); });
    $$('[data-rm]').forEach(b => b.onclick = () => { items.splice(+b.dataset.rm, 1); mark(); drawPinned(); drawAvail(); });
    $$('[data-badge]').forEach(i => i.oninput = () => { items[+i.dataset.badge].badge = i.value; mark(); });
    // Drag a row by its number to a new place (mouse, finger or pen). The dragged row itself
    // never moves in the page — its neighbours move around it — so the browser keeps following
    // the pointer (moving the row that holds the pointer made it drop the drag half-way).
    $$('[data-drag]').forEach(h => h.onpointerdown = (e) => {
      e.preventDefault();
      const box = $('#pinned'), row = h.closest('.pin-row');
      row.classList.add('dragging');
      try { h.setPointerCapture(e.pointerId); } catch {}
      const move = (ev) => {
        const over = document.elementFromPoint(ev.clientX, ev.clientY)?.closest('.pin-row');
        if (!over || over === row || over.parentNode !== box) return;
        const rows = $$('.pin-row', box);
        if (rows.indexOf(over) > rows.indexOf(row)) box.insertBefore(over, row);
        else box.insertBefore(over, row.nextSibling);
      };
      const end = () => {
        window.removeEventListener('pointermove', move);
        window.removeEventListener('pointerup', end);
        window.removeEventListener('pointercancel', end);
        row.classList.remove('dragging');
        const order = $$('.pin-row', box).map(r => +r.dataset.row);
        if (order.some((v, i) => v !== i)) { items = order.map(i => items[i]); mark(); }
        drawPinned();
      };
      window.addEventListener('pointermove', move);
      window.addEventListener('pointerup', end);
      window.addEventListener('pointercancel', end);
    });
  };
  const drawAvail = () => {
    const have = new Set(items.map(i => i.url));
    const list = index.filter(i => (!kind || i.kind === kind) && (!q || normalizeArabic(`${i.headline || ''} ${i.title}`).includes(q))).slice(0, 15);
    mount($('#avail'), html`${list.map(i => html`<div class="row">
      <span class="row-img">${i.image ? html`<img src="${img(i.image)}" alt="" loading="lazy">` : ''}</span>
      <span class="row-main"><b>${i.headline || i.title}</b><small>${KIND[i.kind] || ''} · ${i.federation || ''} · ${timeAgo(i.date)}</small></span>
      <span class="row-actions">${have.has(i.url) ? html`<span class="tag tag-auto">مثبت</span>` : html`<button class="btn btn-sm" data-pin="${i.url}">${icon('pin')} ثبّت</button>`}</span>
    </div>`)}`);
    $$('[data-pin]').forEach(b => b.onclick = () => {
      const it = index.find(x => x.url === b.dataset.pin);
      const news = it.kind === 'news';
      items.push({ url: it.url, title: it.headline || it.title, subtitle: it.headline && it.title !== it.headline ? it.title : '', image: it.image, federation: it.federation || 'WWE',
        kind: it.kind || 'show', kindLabel: it.kindLabel || KIND[it.kind] || 'عرض', badge: news ? 'عاجل' : 'حصري ومترجم', description: it.description || '' });
      mark(); drawPinned(); drawAvail();
    });
  };
  $('#q').oninput = debounce((e) => { q = normalizeArabic(e.target.value.trim()); drawAvail(); }, 200);
  $$('#kinds button').forEach(b => b.onclick = () => { kind = b.dataset.kind; $$('#kinds button').forEach(x => x.classList.toggle('on', x === b)); drawAvail(); });
  $('#save').onclick = async () => {
    const b = $('#save'); b.disabled = true; b.classList.add('loading');
    try {
      const r = await tools.savePinned(items, sha);
      trackLive({ commit: r.commit, committedAt: r.committedAt, title: 'المثبت في الرئيسية' });
      dirty = false;
      toast('اتحفظ ✓ هيتغير في الرئيسية خلال دقيقتين، وهقولك أول ما يظهر.', 'ok', 6000);
      const f = await tools.pinned(); sha = f.sha;
    } catch (e) { toast(e.message, 'error', 7000); b.disabled = false; }
    finally { b.classList.remove('loading'); }
  };
  window.onbeforeunload = () => (dirty ? true : undefined);
  drawPinned(); drawAvail();
}

// ── Reels: show videos, their posting, and making new ones ──────────────────
const REEL_PLATFORMS = [
  { key: 'facebook_reel', name: 'ريلز فيسبوك', color: '#1877f2', icon: 'facebook' },
  { key: 'facebook_story', name: 'ستوري فيسبوك', color: '#1877f2', icon: 'facebook' },
  { key: 'instagram_reel', name: 'ريلز إنستجرام', color: '#e1306c', icon: 'instagram' },
  { key: 'instagram_story', name: 'ستوري إنستجرام', color: '#e1306c', icon: 'instagram' },
];
export async function renderReelsTool(page) {
  mount(page, html`<div class="loading-page"><div class="spinner"></div></div>`);
  let data;
  try { data = await tools.reels(); } catch (e) { return mount(page, html`<div class="empty"><h2>مقدرتش أجيب الريلز</h2><p class="muted">${e.message}</p></div>`); }
  const shows = (await siteData('studio-data.json').catch(() => [])).filter(d => d.collection === 'shows');
  const videos = (data.videos || []).slice().sort((a, b) => (b.mtime || 0) - (a.mtime || 0));
  const plats = data.tiktok ? [...REEL_PLATFORMS, { key: 'tiktok', name: 'تيك توك', color: '#141414', icon: 'film' }] : REEL_PLATFORMS;
  // A reel's name is the show's file name cut to 45 letters (older ones without the date prefix)
  const bare = (s) => String(s).replace(/^\d{12,14}-/, '');
  const fits = (show, v) => { const c = String(v.cleanSlug || ''); return !!c && (show.slug === c || show.slug.startsWith(c) || bare(show.slug) === c || bare(show.slug).startsWith(c)); };
  const showOf = new Map(videos.map(v => [v, shows.find(s => fits(s, v))]));
  const bySlug = { get: (c) => showOf.get(videos.find(v => v.cleanSlug === c)) };
  const stateOf = (v) => { const s = showOf.get(v); return (s && (data.state[s.slug] || data.state[bare(s.slug)])) || data.state[v.cleanSlug] || data.state[bare(v.cleanSlug)] || {}; };
  const missing = shows.filter(s => !videos.some(v => fits(s, v)) && Date.now() - Date.parse(s.date) < 10 * 86400_000)
    .sort((a, b) => Date.parse(b.date) - Date.parse(a.date)).slice(0, 8);
  let shown = 20;

  mount(page, html`<div class="wrap page-in">
    ${header('الريلز', 'فيديوهات العروض القصيرة: بتتعمل وتتنشر تلقائي لكل عرض جديد. من هنا تشوفها وتنشرها أو تعمل واحد جديد.')}
    ${missing.length ? html`<section class="panel"><header class="panel-head"><h2>${icon('film')} عروض لسه ملهاش ريل</h2></header>
      <div class="rows">${missing.map(s => html`<div class="row">
        <span class="row-img">${s.image ? html`<img src="${img(s.image)}" alt="" loading="lazy">` : ''}</span>
        <span class="row-main"><b>${s.headline || s.title}</b><small>${s.federation} · ${timeAgo(s.date)}</small></span>
        <span class="row-actions" id="mk-${s.slug}"><button class="btn btn-sm btn-primary" data-make="${s.slug}">${icon('film')} اعمل ريل</button></span>
      </div>`)}</div></section>` : ''}
    <section class="panel"><header class="panel-head"><h2>${icon('film')} كل الريلز <span class="count-pill">${num(videos.length)}</span></h2></header><div class="rows" id="vids"></div></section>
  </div>`);

  const draw = () => {
    mount($('#vids'), html`${videos.slice(0, shown).map((v, n) => {
      const st = stateOf(v), show = bySlug.get(v.cleanSlug);
      return html`<div class="row reel-row">
        <button class="row-img reel-thumb" data-play="${n}" title="تشغيل">${show && show.image ? html`<img src="${img(show.image)}" alt="" loading="lazy">` : ''}<i>${icon('film')}</i></button>
        <span class="row-main"><b>${(show && (show.headline || show.title)) || st.title || v.cleanSlug}</b>
          <small>${timeAgo(v.mtime)} · ${num(Math.round((v.size || 0) / 1048576))} ميجا${st.needsReview ? ' · محتاج مراجعة' : ''}</small></span>
        <span class="row-actions"><span class="plat-dots">${plats.map(p => html`<i class="${st[p.key] ? 'on' : ''}" style="--c:${p.color}" title="${p.name}: ${st[p.key] ? 'اتنشر' : 'لسه'}">${icon(p.icon)}</i>`)}</span>
          <button class="btn btn-sm" data-pub="${n}">${icon('send')} نشر</button>
          <button class="icon-btn sm danger" data-del="${n}" title="حذف">${icon('trash')}</button></span>
      </div>`;
    })}${videos.length > shown ? html`<button class="btn btn-ghost btn-sm" id="more">عرض ${num(Math.min(20, videos.length - shown))} كمان</button>` : ''}`);
    $$('[data-play]').forEach(b => b.onclick = () => {
      const v = videos[+b.dataset.play];
      dialog({ title: 'معاينة', body: raw(`<video src="${esc(SITE + v.videoUrl)}" controls autoplay playsinline style="width:100%;max-height:70vh;border-radius:16px;background:#000"></video>`), confirm: 'قفل', cancel: '' });
    });
    $$('[data-pub]').forEach(b => b.onclick = () => publishReel(videos[+b.dataset.pub]));
    $$('[data-del]').forEach(b => b.onclick = async () => {
      const v = videos[+b.dataset.del];
      if (!(await dialog({ title: 'حذف الريل', body: 'الفيديو هيتمسح من الموقع. لو اتنشر على المنصات هيفضل هناك.', confirm: 'حذف', danger: true }))) return;
      try { await tools.deleteReel(v.filename); videos.splice(+b.dataset.del, 1); toast('اتحذف ✓'); draw(); } catch (e) { toast(e.message, 'error'); }
    });
    const more = $('#more'); if (more) more.onclick = () => { shown += 20; draw(); };
  };

  async function publishReel(v) {
    const st = stateOf(v), show = bySlug.get(v.cleanSlug);
    const ok = await dialog({
      title: 'نشر الريل',
      body: html`<div class="plat-pick">${plats.map(p => html`<label class="check"><input type="checkbox" class="rpick" value="${p.key}" ${st[p.key] ? '' : 'checked'}><span>${p.name}${st[p.key] ? ' (اتنشر قبل كده)' : ''}</span></label>`)}</div>`,
      confirm: 'انشر',
    });
    const picked = $$('.rpick').filter(c => c.checked).map(c => c.value);
    if (!ok || !picked.length) return;
    let bad = 0;
    for (const p of picked) {
      const name = plats.find(x => x.key === p).name;
      toast(`${name}…`, 'info', 2500);
      try {
        const r = await tools.publishReel(v, p, show ? SITE + show.url : '', show ? show.headline || show.title : '');
        const res = r.results ? r.results[p] : null;
        if (res && res.ok) toast(`${name}: اتنشر ✓`);
        else { bad++; toast(`${name}: ${(res && res.error) || r.error || 'فشل'}`, 'error', 7000); }
      } catch (e) { bad++; toast(`${name}: ${e.message}`, 'error', 7000); }
    }
    if (!bad) toast('خلص نشر الريل ✓');
    data = await tools.reels().catch(() => data);
    draw();
  }

  $$('[data-make]').forEach(b => b.onclick = async () => {
    const slug = b.dataset.make, box = $(`#mk-${CSS.escape(slug)}`);
    try {
      await tools.makeReel(slug);
      mount(box, html`<span class="tag tag-sched">${icon('clock')} بيتعمل… (٥–١٠ دقايق)</span>`);
      const started = Date.now();
      const poll = async () => {
        const r = await tools.reelCheck(slug).catch(() => ({}));
        if (r.exists) { mount(box, html`<span class="tag tag-auto">جاهز ✓</span>`); toast('الريل جاهز ✓ ونشره التلقائي هيبدأ لوحده.'); return; }
        if (r.runStatus === 'completed' && r.runConclusion && r.runConclusion !== 'success') { mount(box, html`<span class="tag tag-warn">فشل</span>`); return; }
        if (Date.now() - started < 20 * 60_000) setTimeout(poll, 20_000);
      };
      setTimeout(poll, 30_000);
    } catch (e) { toast(e.message, 'error'); }
  });
  draw();
}
