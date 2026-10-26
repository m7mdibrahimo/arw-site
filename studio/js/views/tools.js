// Publishing tools — what the old /admin/ pages did, inside the panel:
// social posting, news sources, the home slider's pinned items and show reels.
import { tools, siteData, trackLive, mini } from '../api.js';
import { notify } from '../notify.js';
import { html, raw, mount, $, $$, icon, toast, dialog, timeAgo, num, normalizeArabic, debounce, esc, pager } from '../ui.js';

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
      <a class="row-img" href="${i.url}" target="_blank">${i.image ? html`<img src="${img(mini(i))}" alt="" loading="lazy">` : ''}</a>
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
          <small dir="rtl"><span class="tag ${STATUS[p.status][0]}">${STATUS[p.status][1]}</span> · ${timeAgo(p.date)}</small>
          <small dir="rtl" class="src-reason">${p.reason || ''}</small></a>
        <span class="row-actions">${p.site ? html`<a class="btn btn-sm" href="${p.site.url}" target="_blank" title="${p.site.title}">${icon('eye')} خبرنا</a>`
          : p.match ? html`<a class="btn btn-sm" href="${p.match.url}" target="_blank" title="${p.match.title}">${icon('eye')} الخبر الأصلي عندنا</a>` : ''}</span>
      </div>`)}</div></section>`)}
    <p class="muted small center">تحت كل خبر مكتوب حصله إيه وليه. «لسه» يعني البوت هيحاول تاني لوحده. «اتخطى» يعني مش هينزل، وتقدر تضيفه بنفسك من المربع جنبه.</p>
  </div>`);

  const add = async (urls) => {
    try { const r = await tools.addNews(urls); toast(`${r.message || 'اتبعت'} — الخبر بيظهر بعد ٣–٥ دقايق.`, 'ok', 7000); notify({ type: 'news-request' }); }
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
      <span class="pin-rank">${num(n + 1)}</span>
      <span class="row-img">${it.image ? html`<img src="${img(mini(it))}" alt="">` : ''}</span>
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
    // Pick a row up from anywhere on it and carry it: a copy of the card follows the pointer
    // over the whole page, the other rows slide aside to show where it will land, the page
    // scrolls on its own near the top/bottom edge, and on release the card glides into place.
    // Mouse: press and move. Finger: press and hold a moment, then move (a quick swipe scrolls).
    $$('.pin-row', $('#pinned')).forEach(row => row.onpointerdown = (e) => {
      if (e.button > 0 || e.target.closest('button, input, a, label')) return;
      const box = $('#pinned');
      const startX = e.clientX, startY = e.clientY;
      let px = startX, py = startY, dragging = false, ghost = null, offX = 0, offY = 0, raf = 0, holdTimer = 0;
      const touch = e.pointerType === 'touch';
      const cleanup = () => {
        clearTimeout(holdTimer); cancelAnimationFrame(raf);
        window.removeEventListener('pointermove', onMove);
        window.removeEventListener('pointerup', onUp);
        window.removeEventListener('pointercancel', onUp);
        document.removeEventListener('touchmove', blockScroll);
      };
      const blockScroll = (ev) => { if (dragging) ev.preventDefault(); };
      // Slide the rows between their old and new places (FLIP)
      const slide = (change) => {
        const rows = $$('.pin-row', box).filter(r => r !== row);
        const before = new Map(rows.map(r => [r, r.getBoundingClientRect().top]));
        change();
        for (const r of rows) {
          const dy = before.get(r) - r.getBoundingClientRect().top;
          if (!dy) continue;
          r.style.transition = 'none'; r.style.transform = `translateY(${dy}px)`;
          requestAnimationFrame(() => { r.style.transition = 'transform .22s cubic-bezier(.2,.8,.2,1)'; r.style.transform = ''; });
        }
      };
      const start = () => {
        dragging = true;
        const r = row.getBoundingClientRect();
        offX = px - r.left; offY = py - r.top;
        ghost = row.cloneNode(true);
        ghost.classList.add('pin-ghost');
        Object.assign(ghost.style, { width: `${r.width}px`, left: `${r.left}px`, top: `${r.top}px` });
        document.body.appendChild(ghost);
        row.classList.add('pin-slot');
        document.body.classList.add('pin-carrying');
        if (navigator.vibrate) try { navigator.vibrate(12); } catch {}
        const tick = () => {
          ghost.style.left = `${px - offX}px`; ghost.style.top = `${py - offY}px`;
          // Where would it land? Between the rows whose middles the pointer lies between.
          const others = $$('.pin-row', box).filter(x => x !== row);
          const after = others.find(x => { const b = x.getBoundingClientRect(); return py < b.top + b.height / 2; });
          if ((after || null) !== row.nextElementSibling || (!after && box.lastElementChild !== row)) {
            slide(() => (after ? box.insertBefore(row, after) : box.appendChild(row)));
          }
          // Near the edge of the window: scroll along
          const edge = 80, vh = window.innerHeight;
          if (py < edge) window.scrollBy(0, -Math.ceil((edge - py) / 6));
          else if (py > vh - edge) window.scrollBy(0, Math.ceil((py - (vh - edge)) / 6));
          raf = requestAnimationFrame(tick);
        };
        raf = requestAnimationFrame(tick);
      };
      const onMove = (ev) => {
        px = ev.clientX; py = ev.clientY;
        if (dragging) return;
        const far = Math.hypot(px - startX, py - startY) > 6;
        if (touch) { if (far) cleanup(); } // moved before the hold: the finger wants to scroll
        else if (far) start();
      };
      const onUp = () => {
        cleanup();
        if (!dragging) return;
        dragging = false;
        document.body.classList.remove('pin-carrying');
        // Glide the card into its new slot, then put the list in that order
        const target = row.getBoundingClientRect();
        ghost.style.transition = 'left .2s ease, top .2s ease, transform .2s ease, box-shadow .2s ease';
        ghost.classList.add('landing');
        ghost.style.left = `${target.left}px`; ghost.style.top = `${target.top}px`;
        setTimeout(() => {
          ghost.remove();
          row.classList.remove('pin-slot');
          const order = $$('.pin-row', box).map(r => +r.dataset.row);
          if (order.some((v, i) => v !== i)) { items = order.map(i => items[i]); mark(); }
          drawPinned();
        }, 210);
      };
      window.addEventListener('pointermove', onMove);
      window.addEventListener('pointerup', onUp);
      window.addEventListener('pointercancel', onUp);
      document.addEventListener('touchmove', blockScroll, { passive: false });
      if (touch) holdTimer = setTimeout(start, 280);
    });
  };
  const drawAvail = () => {
    const have = new Set(items.map(i => i.url));
    const list = index.filter(i => (!kind || i.kind === kind) && (!q || normalizeArabic(`${i.headline || ''} ${i.title}`).includes(q))).slice(0, 15);
    mount($('#avail'), html`${list.map(i => html`<div class="row">
      <span class="row-img">${i.image ? html`<img src="${img(mini(i))}" alt="" loading="lazy">` : ''}</span>
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
      notify({ type: 'pinned', count: items.length, commit: r.commit });
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
        <span class="row-img">${s.image ? html`<img src="${img(mini(s))}" alt="" loading="lazy">` : ''}</span>
        <span class="row-main"><b>${s.headline || s.title}</b><small>${s.federation} · ${timeAgo(s.date)}</small></span>
        <span class="row-actions" id="mk-${s.slug}"><button class="btn btn-sm btn-primary" data-make="${s.slug}">${icon('film')} اعمل ريل</button></span>
      </div>`)}</div></section>` : ''}
    <section class="panel"><header class="panel-head"><h2>${icon('film')} كل الريلز <span class="count-pill">${num(videos.length)}</span></h2></header><div class="rows" id="vids"></div></section>
  </div>`);

  const draw = () => {
    mount($('#vids'), html`${videos.slice(0, shown).map((v, n) => {
      const st = stateOf(v), show = bySlug.get(v.cleanSlug);
      return html`<div class="row reel-row">
        <button class="row-img reel-thumb" data-play="${n}" title="تشغيل">${show && show.image ? html`<img src="${img(mini(show))}" alt="" loading="lazy">` : ''}<i>${icon('film')}</i></button>
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
    if (picked.length > bad) notify({ type: 'reel', title: show ? show.headline || show.title : v.filename, detail: bad ? `${picked.length - bad} من ${picked.length} منصات` : picked.map(p => plats.find(x => x.key === p).name).join(' · ') });
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

// ── «سيرفر التفريغ»: the owner's rented machine that writes the English subtitles and merges the 4 qualities
// (reports/سيرفر-التفريغ). Everything from here, start to end: paste a show's link with its audio language, take the
// English subtitles in one tap, upload the Arabic ones with the logo position and the merge starts, then open the
// finished show on Drive. The machine sends a heartbeat every 30 seconds (and takes the page's requests with it);
// this page reads it every 10 seconds, so it also says when the machine is off, and «افتح ملفات السيرفر» always has
// the machine's current link (it changes on every start).
const STEP_NAME = { subs: 'تفريغ', merge: 'دمج', download: 'تحميل', upload: 'رفع' };
const STEP_NOW = { subs: 'بيفرّغ دلوقتي', merge: 'بيدمج دلوقتي', download: 'بيحمّل دلوقتي', upload: 'بيرفع دلوقتي' };
const QUALS = [{ key: 'all', name: '٤ جودات (٣٦٠ لـ ١٠٨٠)' }, { key: '720', name: '٧٢٠ بس' }];
// download pages with a "are you human" box the machine can't tick by itself: they open in the server's browser
const BROWSER_PAGE = /^https?:\/\/(?:www\.)?(?:vik1ngfile\.site|vikingfile\.com|vik1ngfile\.[a-z]+)\/f\//i;
const LANGS = [{ key: 'en', name: 'إنجليزي' }, { key: 'enja', name: 'إنجليزي + ياباني' }, { key: 'enes', name: 'إنجليزي + مكسيكي' }, { key: 'es', name: 'مكسيكي (إسباني)' }, { key: 'ja', name: 'ياباني' }];
const LANG_NAME = Object.fromEntries(LANGS.map(l => [l.key, l.name]));
const POSITIONS = [{ pos: 1, name: 'فوق شمال', css: 'tl' }, { pos: 2, name: 'فوق يمين', css: 'tr' }, { pos: 3, name: 'تحت يمين', css: 'br' }];
const clock = (ms) => new Date(ms).toLocaleTimeString('ar-EG', { hour: 'numeric', minute: '2-digit', timeZone: 'Africa/Cairo' });
const dayClock = (ms) => {
  const d = new Date(ms), today = new Date();
  const same = d.toLocaleDateString('en-CA', { timeZone: 'Africa/Cairo' }) === today.toLocaleDateString('en-CA', { timeZone: 'Africa/Cairo' });
  return same ? clock(ms) : `${d.toLocaleDateString('ar-EG', { day: 'numeric', month: 'long', timeZone: 'Africa/Cairo' })} ${clock(ms)}`;
};
const span = (ms) => {
  const m = Math.max(0, Math.round(ms / 60000));
  if (m < 1) return 'أقل من دقيقة';
  if (m < 60) return `${num(m)} دقيقة`;
  const h = Math.floor(m / 60), r = m % 60;
  return `${num(h)} ساعة${r ? ` و${num(r)} دقيقة` : ''}`;
};
const leftText = (s) => { // "H:MM:SS" or "MM:SS" → words
  if (!s) return '…';
  const p = String(s).split(':').map(Number);
  const sec = p.length === 3 ? p[0] * 3600 + p[1] * 60 + p[2] : p[0] * 60 + (p[1] || 0);
  return isFinite(sec) ? span(sec * 1000) : '…';
};
const saveText = (name, text) => {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([text], { type: 'application/x-subrip;charset=utf-8' }));
  a.download = name; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
};

export async function renderServerTool(page) {
  mount(page, html`<div class="wrap page-in">
    ${header('سيرفر التفريغ', 'من هنا كل حاجة: تحط رابط العرض، وتاخد الترجمة الإنجليزي، وترفع العربي وتختار مكان اللوجو، وتلاقي العرض جاهز على درايف.')}
    <div id="srv"><div class="loading-page"><div class="spinner"></div></div></div>
    <section class="panel srv-new">
      <header class="panel-head"><h2>${icon('plus')} عرض جديد</h2></header>
      <p class="muted">لكل عرض: الزق رابط التحميل نفسه (أو رابط التورنت)، واختار لغة الصوت وعدد الجودات. تقدر تضيف كذا عرض مرة واحدة، والسيرفر هيعملهم ورا بعض.</p>
      <div id="srv-rows"></div>
      <button class="btn btn-ghost btn-sm" id="srv-add">${icon('plus')} عرض كمان</button>
      <p class="muted srv-note">لغة الصوت = الصوت اللي هيتفرّغ ويتحط في العرض. لو الملف فيه صوت إنجليزي، السيرفر بياخده من جوه الملف. لو المعلقين إنجليزي والمصارعين بيتكلموا ياباني أو مكسيكي، اختار «إنجليزي + ياباني» أو «إنجليزي + مكسيكي»: كلام المعلقين بيتكتب زي ما هو، وكلام المصارعين بيتترجم لإنجليزي. «مكسيكي» أو «ياباني» لوحدهم بس لو مفيش صوت إنجليزي خالص.</p>
      <button class="btn btn-primary" id="srv-go">${icon('download')} ابدأ</button>
    </section>
    <section class="panel"><header class="panel-head"><h2>${icon('film')} العروض</h2></header><div id="srv-shows"></div></section>
    <section class="panel"><header class="panel-head"><h2>${icon('check')} اللي خلص</h2></header><div id="srv-jobs"></div></section>
    <section class="panel" id="srv-key-box"><header class="panel-head"><h2>${icon('bolt')} زرار التشغيل</h2></header><div id="srv-key"></div></section>
  </div>`);
  const box = $('#srv');
  let last = null, chosen = {}, chosenQ = {}; // the logo position / qualities picked for the Arabic file about to go up
  const pickedAr = {}; // name → { file, text, lines }: the Arabic subtitle picked, shown until «ابدأ الدمج»
  // pause / go on / stop the running step (from the status card or the show's card)
  const controls = (st, name) => {
    const paused = st && st.paused;
    return html`<span class="srv-ctl">
      ${paused ? html`<button class="btn btn-sm btn-primary" data-ctl="resume" data-n="${name}">${icon('bolt')} كمّل</button>`
        : html`<button class="btn btn-sm" data-ctl="pause" data-n="${name}">${icon('clock')} إيقاف مؤقت</button>`}
      <button class="btn btn-sm btn-ghost danger" data-ctl="cancel" data-n="${name}">${icon('x')} إلغاء</button></span>`;
  };
  const wireControls = (root) => $$('[data-ctl]', root).forEach(b => b.onclick = async () => {
    const what = b.dataset.ctl, name = b.dataset.n;
    if (what === 'cancel') {
      const ok = await dialog({ title: 'تلغي الشغل ده؟', body: `هيقف «${name.slice(0, 60)}» خالص. تقدر تبدأه تاني بعدين من كارت العرض.`, confirm: 'إلغاء الشغل', cancel: 'رجوع', danger: true });
      if (!ok) return;
    }
    send({ kind: what, name }, what === 'pause' ? 'اتوقف مؤقتًا' : what === 'resume' ? 'بيكمّل' : 'اتلغى');
  });

  const send = async (body, okText) => {
    try {
      const r = await tools.serverCmd(body);
      if (r && r.success === false) throw new Error(r.error || 'حصلت مشكلة');
      toast(okText);
      setTimeout(tick, 1500);
      return true;
    } catch (e) { toast(e.message || 'حصلت مشكلة', 'error'); return false; }
  };

  // one row per show: its link, its audio language, its qualities
  const addRow = () => {
    const row = document.createElement('div');
    row.className = 'srv-row';
    mount(row, html`<input class="input srv-url" type="text" inputmode="url" name="srv-show-link-${Date.now()}" autocomplete="off" autocorrect="off" autocapitalize="off" spellcheck="false" data-lpignore="true" data-1p-ignore dir="ltr" placeholder="الزق رابط العرض هنا">
      <select class="input srv-lang">${LANGS.map(l => html`<option value="${l.key}">${l.name}</option>`)}</select>
      <select class="input srv-qual">${QUALS.map(q => html`<option value="${q.key}">${q.name}</option>`)}</select>
      <button class="icon-btn sm" title="شيل" type="button">${icon('x')}</button>`);
    row.querySelector('button').onclick = () => { if ($$('.srv-row').length > 1) row.remove(); else row.querySelector('.srv-url').value = ''; };
    $('#srv-rows').appendChild(row);
    return row;
  };
  addRow();
  $('#srv-add').onclick = () => addRow().querySelector('.srv-url').focus();

  $('#srv-go').onclick = async () => {
    // a page link opens in the server's browser: open its window now, inside the click, so it isn't blocked
    const pages = $$('.srv-row .srv-url').some(i => BROWSER_PAGE.test(i.value.trim()));
    const browserUrl = last && last.status && last.status.browser;
    const win = pages && browserUrl ? window.open('about:blank', '_blank') : null;
    const rows = $$('.srv-row').map(r => ({ r, url: r.querySelector('.srv-url').value.trim(), lang: r.querySelector('.srv-lang').value, qual: r.querySelector('.srv-qual').value })).filter(x => x.url);
    if (!rows.length) return toast('الزق رابط العرض الأول', 'error');
    const bad = rows.filter(x => !/^(https?:\/\/|magnet:\?)/i.test(x.url));
    if (bad.length) return toast(`فيه ${num(bad.length)} خانة مش رابط`, 'error');
    let ok = 0;
    for (const x of rows) {
      const kind = BROWSER_PAGE.test(x.url) ? 'browse' : 'link';
      try { const r = await tools.serverCmd({ kind, url: x.url, lang: x.lang, qual: x.qual }); if (r && r.success !== false) { ok++; x.r.remove(); } } catch {}
    }
    if (!$$('.srv-row').length) addRow();
    if (pages) {
      if (win) win.location = browserUrl;
      dialog({ title: 'كمّل من متصفح السيرفر', cancel: '', confirm: 'تمام',
        body: html`<p>الموقع ده فيه مربع «تحقق إنك إنسان»، فالرابط هيتفتح في متصفح السيرفر${win ? ' (فتحتهولك في صفحة جديدة)' : ''}:</p>
          <ol class="srv-steps"><li>استنى ثواني لحد ما الصفحة تفتح جوه المتصفح.</li><li>دوس على مربع التحقق، وبعدين زرار التحميل.</li><li>خلاص — العرض هينزل على السيرفر ويتفرّغ لوحده باللغة والجودات اللي اخترتها.</li></ol>
          ${win ? '' : browserUrl ? html`<p><a class="btn btn-primary" href="${browserUrl}" target="_blank" rel="noopener">${icon('globe')} افتح متصفح السيرفر</a></p>`
            : html`<p class="srv-err">${icon('alert')} متصفح السيرفر لسه بيجهز. استنى دقيقة، وحدّث الصفحة، ودوس «متصفح السيرفر» فوق.</p>`}` });
    }
    if (ok) { if (!pages) toast(ok === 1 ? 'تمام — السيرفر هياخد العرض خلال ثواني' : `تمام — ${num(ok)} عروض، هيتعملوا ورا بعض`); setTimeout(tick, 1500); }
    if (ok < rows.length) toast(`${num(rows.length - ok)} عرض متبعتش — جرّب تاني`, 'error');
  };

  const power = async (which) => {
    const b = $(which === 'start' ? '#srv-start' : '#srv-stop');
    if (b) { b.disabled = true; b.textContent = which === 'start' ? 'بيشغّل…' : 'بيقفل…'; }
    try {
      const r = await tools.serverPower(which);
      if (r && r.noSame) {
        // no A4000 like his is free: he decides — wait, or take the closest machine for now
        const ok = await dialog({ title: 'الجهاز بتاعك مش فاضي دلوقتي', body: r.error, confirm: 'خد أقرب جهاز ليه', cancel: 'هستنى' });
        if (ok) {
          const r2 = await tools.serverPower('start', { any: true });
          if (r2 && r2.success === false) throw new Error(r2.error || 'حصلت مشكلة');
          toast(r2.message || 'تمام', 'ok', 8000);
        }
      } else if (r && r.success === false) throw new Error(r.error || 'حصلت مشكلة');
      else toast(r.message || 'تمام', 'ok', 8000);
    } catch (e) { toast(e.message || 'حصلت مشكلة', 'error', 8000); }
    setTimeout(tick, 4000);
  };
  const drawKey = (has) => {
    mount($('#srv-key'), html`<p class="muted">${has ? 'المفتاح متحط ✓ — زرار «شغّل السيرفر» شغال. لو عايز تغيّره حط الجديد هنا.' : 'مرة واحدة بس، عشان «شغّل السيرفر» يشتغل من هنا:'}</p>
      <ol class="srv-steps"><li>افتح <a href="https://cloud.vast.ai/manage-keys/" target="_blank" rel="noopener">صفحة المفاتيح في موقع التأجير</a>.</li><li>اعمل مفتاح جديد وانسخه.</li><li>الزقه هنا ودوس «احفظ». (متبعتهوش لحد.)</li></ol>
      <div class="srv-keyrow"><input class="input srv-masked" id="srv-vk" type="text" name="srv-rental-key" autocomplete="off" autocorrect="off" autocapitalize="off" spellcheck="false" data-lpignore="true" data-1p-ignore dir="ltr" placeholder="${has ? 'متحط ✓' : 'مفتاح موقع التأجير'}"><button class="btn btn-primary btn-sm" id="srv-vk-save">${icon('check')} احفظ</button></div>`);
    $('#srv-vk-save').onclick = async () => {
      const key = $('#srv-vk').value.trim();
      if (!key) return toast('الزق المفتاح الأول', 'error');
      try { const r = await tools.serverVastKey(key); if (r && r.success === false) throw new Error(r.error); toast('اتحفظ — زرار التشغيل جاهز'); drawKey(true); tick(); }
      catch (e) { toast(e.message || 'مقدرتش أحفظه', 'error'); }
    };
  };
  let keyDrawn = null;

  const drawStatus = (d) => {
    const st = d.status, now = d.now || Date.now();
    const alive = st && st.state === 'on' && now - st.at < 90_000;
    const job = alive ? st.job : null;
    const q = (st && st.queue) || {};
    mount(box, html`<section class="panel srv-card">
      <div class="srv-top">
        <div class="srv-state"><i class="srv-dot ${alive ? 'on' : ''}"></i><b>${alive ? 'السيرفر شغال' : 'السيرفر مقفول'}</b></div>
        ${alive ? (job ? '' : html`<button class="btn btn-sm btn-ghost" id="srv-stop">${icon('x')} اقفل السيرفر</button>`)
          : d.vastKey ? html`<button class="btn btn-primary" id="srv-start">${icon('bolt')} شغّل السيرفر</button>`
          : html`<a class="btn btn-primary" href="#srv-key-box">${icon('bolt')} جهّز زرار التشغيل</a>`}
      </div>
      ${alive ? html`<div class="srv-tools">
          ${st.uploadPage ? html`<a class="btn btn-sm" href="${st.uploadPage}" target="_blank" rel="noopener">${icon('upload')} ارفع من جهازك</a>` : ''}
          ${st.browser ? html`<a class="btn btn-sm" href="${st.browser}" target="_blank" rel="noopener">${icon('globe')} متصفح السيرفر</a>` : ''}
          ${st.jupyter ? html`<a class="btn btn-sm btn-ghost" href="${st.jupyter}" target="_blank" rel="noopener">${icon('folder')} ملفات السيرفر</a>` : ''}
        </div>
        <details class="srv-help"><summary>إزاي أرفع من جهازي أو أستخدم متصفح السيرفر؟</summary>
          <p><b>ارفع من جهازك:</b> هيفتح فولدر الفيديوهات على السيرفر. دوس زرار الرفع فوق، واختار الفيديوهات أو ملفات التورنت (تقدر تختار كذا ملف مرة واحدة)، ودوس الزرار الأزرق جنب كل ملف. أول ما الرفع يخلص، العرض هيظهر هنا تحت «العروض»، واختار لغة صوته من هناك.</p>
          <p><b>متصفح السيرفر:</b> متصفح شغال على السيرفر نفسه. افتح منه موقع التورنت أو موقع التحميل ونزّل الملف عادي، وهينزل لوحده في فولدر الفيديوهات ويبدأ. ده الحل لموقع التورنت اللي لازم التحميل يكون من نفس الجهاز اللي نزّل ملف التورنت.</p>
        </details>` : ''}
      <p class="muted srv-sub">${alive ? `آخر إشارة منه: ${timeAgo(st.at)} — اشتغل الساعة ${dayClock(st.boot)}`
        : st ? `مقفول من ${dayClock(st.at)}` : 'لسه مبعتش أي إشارة'}</p>
      ${!alive ? html`<p class="muted srv-note">${d.vastKey ? 'دوس «شغّل السيرفر» وخلاص: لو جهازك موجود هيشتغل خلال دقيقة. ولو اتمسح (بيتمسح لوحده بعد ١٢ ساعة مقفول عشان متدفعش مساحة) أو كارته اتاخد، هيأجّر جهاز زيه بالظبط (نفس الكارت ونت رخيص) ويركّب نفسه في حوالي ١٠ دقايق، وبعدها دوس «وصّل درايف». اللي طلبته وهو مقفول هيتعمل أول ما يشتغل.' : 'عشان تشغّله بضغطة واحدة من هنا، حط مفتاح موقع التأجير مرة واحدة في «زرار التشغيل» تحت.'}</p>` : ''}
      ${job ? html`<div class="srv-job">
          <b>${st.paused ? 'متوقف مؤقتًا' : (STEP_NOW[job.step] || 'شغال على')}: ${job.name}</b>
          <div class="srv-ctl-row">${controls(st, job.name)}</div>
          ${job.pct != null ? html`<div class="srv-bar"><div style="width:${Math.min(100, job.pct)}%"></div></div>` : ''}
          <div class="srv-kpis">
            ${job.pct != null ? html`<div><small>خلص</small><b>${num(job.pct)}٪</b></div>` : ''}
            <div><small>بدأ الساعة</small><b>${clock(job.started)}</b></div>
            <div><small>عدّى</small><b>${span(now - job.started)}</b></div>
            ${job.pct != null ? html`<div><small>فاضل</small><b>${leftText(job.left)}</b></div>` : ''}
          </div>
        </div>` : alive && !(st.downloads || []).length ? html`<div class="srv-job"><b>مفيش شغل دلوقتي</b><p class="muted">مستني عرض جديد أو ترجمة عربي. هيقفل نفسه لوحده بعد ${num(st.idleLeft || 0)} دقيقة لو مفيش شغل.</p></div>` : ''}
      ${alive && (st.downloads || []).length ? html`<div class="srv-dls"><b>${icon('download')} بيتحمّل دلوقتي (${num(st.downloads.length)})</b>
          ${st.downloads.map(x => html`<div class="srv-dl"><div class="srv-dl-head"><span dir="ltr">${x.name}</span><b>${x.pct != null ? `${num(x.pct)}٪` : 'بيبدأ…'}</b></div>
            <div class="srv-bar srv-bar-sm"><div style="width:${Math.min(100, x.pct || 0)}%"></div></div>
            ${x.left != null ? html`<small class="muted">فاضل ${span(x.left * 1000)}</small>` : ''}</div>`)}
          <p class="muted small">تقدر تفتح عرض تاني في متصفح السيرفر وتحمّله دلوقتي، هيتحمّل جنبهم.</p></div>` : ''}
      ${alive && (q.links || q.subs || q.merge) ? html`<p class="muted">مستني بعده: ${[q.links ? `${num(q.links)} رابط للتحميل` : '', q.subs ? `${num(q.subs)} فيديو للتفريغ` : '', q.merge ? `${num(q.merge)} ترجمة عربي للدمج` : ''].filter(Boolean).join(' — ')}</p>` : ''}
      ${d.pending && d.pending.length ? html`<p class="srv-wait">${icon('clock')} ${num(d.pending.length)} طلب مستني السيرفر ياخده${alive ? ' (خلال ثواني)' : ' (أول ما يشتغل)'}</p>` : ''}
      ${alive && st.drive ? html`<div class="srv-drive-opt"><label class="srv-host-on"><input type="checkbox" id="srv-drive-ready" ${st.driveReady !== false ? 'checked' : ''}> ارفع العروض الجاهزة على جوجل درايف</label>
          <span class="muted small">${st.driveReady !== false ? 'كل عرض جاهز بيترفع على درايف لوحده.' : 'مقفول: نزّل العروض الجاهزة بنفسك من «ملفات السيرفر» ← «4-الجاهز». الترجمات بس اللي بتترفع على درايف.'}</span></div>` : ''}
      ${st && st.drive === false && alive ? html`<div class="srv-drive"><p class="srv-err">${icon('alert')} السيرفر ده مش متوصل بجوجل درايف لسه (أول مرة على كل جهاز جديد).</p>
          <button class="btn btn-primary btn-sm" id="srv-drive-go">${icon('link')} وصّل درايف</button>
          <p class="muted small">هيفتحلك متصفح السيرفر على صفحة جوجل: ادخل بحسابك ودوس «سماح». مرة واحدة بس للجهاز ده.</p></div>` : ''}
      ${alive && st.errors && st.errors.length ? html`<div class="srv-err">${icon('alert')} ${st.errors[st.errors.length - 1]}</div>` : ''}
    </section>`);
  };

  const stageOf = (s, job) => {
    if (job && job.name === s.name) return { text: `${last && last.status && last.status.paused ? 'متوقف مؤقتًا' : (STEP_NOW[job.step] || 'شغال عليه')}${job.pct != null ? ` — ${num(job.pct)}٪` : ''}`, tone: last && last.status && last.status.paused ? 'wait' : 'run' };
    if (s.stopped) return { text: s.stopped === 'merge' ? 'الدمج اتلغى' : 'التفريغ اتلغى', tone: 'bad' };
    if (s.merged && !s.drive && last && last.status && last.status.driveReady !== false) return { text: 'بيترفع على درايف', tone: 'run' };
    if (s.merged) return { text: 'جاهز ✓', tone: 'ok' };
    if (s.mergeFailed) return { text: 'الدمج فشل', tone: 'bad' };
    if (s.ar && s.noVideo) return { text: 'مستني الفيديو', tone: 'bad' };
    if (s.ar) return { text: 'مستني الدمج', tone: 'wait' };
    if (s.en) return { text: 'الترجمة الإنجليزي جاهزة', tone: 'ok' };
    if (s.subsFailed) return { text: 'التفريغ فشل', tone: 'bad' };
    if (s.video) return { text: 'مستني التفريغ', tone: 'wait' };
    return { text: '', tone: '' };
  };

  const drawShows = (d) => {
    const st = d.status, alive = st && st.state === 'on' && (d.now - st.at) < 90_000;
    const list = (st && st.shows) || [];
    if (!list.length) return mount($('#srv-shows'), html`<p class="muted">مفيش عروض على السيرفر دلوقتي. حط رابط عرض فوق ودوس «ابدأ».</p>`);
    mount($('#srv-shows'), html`${list.map((s, n) => {
      const stg = stageOf(s, alive ? st.job : null);
      const busy = alive && st.job && st.job.name === s.name; // being downloaded/subtitled/merged/uploaded right now
      return html`<div class="srv-show">
        <div class="srv-show-head"><b class="srv-name">${s.name}</b><span class="srv-tag ${stg.tone}">${stg.text}</span></div>
        ${busy ? html`<div class="srv-ctl-row">${controls(st, s.name)}</div>` : ''}
        ${s.merged && !s.drive && st && st.driveReady !== false ? html`<div class="srv-arinfo">${icon('upload')} بيترفع على جوجل درايف${st && st.driveUp ? html`<b>— ${num(st.driveUp.pct)}٪</b><span class="muted">فاضل ${st.driveUp.eta.replace('h', ' ساعة ').replace('m', ' دقيقة ').replace(/\d+s$/, '').trim() || 'أقل من دقيقة'}</span>` : html`<span class="muted">— زرار درايف هيظهر أول ما يخلص</span>`}</div>
          ${st && st.driveUp ? html`<div class="srv-bar srv-bar-sm"><div style="width:${Math.min(100, st.driveUp.pct)}%"></div></div>` : ''}` : ''}
        ${s.stopped === 'merge' || (s.mergeFailed && s.ar && !busy) ? html`<div class="srv-actions"><button class="btn btn-sm btn-primary" data-remerge="${n}">${icon('refresh')} ابدأ الدمج تاني</button></div>` : ''}
        ${busy && st.job.pct != null ? html`<div class="srv-bar srv-bar-sm"><div style="width:${Math.min(100, st.job.pct)}%"></div></div><small class="muted">فاضل ${leftText(st.job.left)}</small><br>` : ''}
        ${s.ar && s.noVideo && !s.merged ? html`<p class="srv-wait">${icon('alert')} فيديو العرض ده مش على السيرفر. ارفعه من «ارفع من جهازك» (لفولدر «1-الفيديوهات») أو حط رابطه فوق، والدمج هيبدأ لوحده أول ما يوصل.</p>` : ''}
        ${s.ar && !s.merged ? html`<div class="srv-arinfo">${icon('check')} الترجمة العربي: <b dir="ltr">${s.arFile || 'ملف الترجمة'}</b>${s.arLines ? html`<span class="muted"> — ${num(s.arLines)} جملة</span>` : ''}${!busy && alive && st.job && st.job.step === 'merge' ? html`<span class="muted"> — هيتدمج بعد «${st.job.name.slice(0, 40)}»</span>` : ''}</div>` : ''}
        <small class="muted">لغة الصوت: ${LANG_NAME[s.lang] || 'إنجليزي'} — ${s.qual === '720' ? '٧٢٠ بس' : '٤ جودات'}${s.ar ? ` — اللوجو: ${(POSITIONS.find(p => p.pos === s.ar) || POSITIONS[0]).name}` : ''}</small>
        <div class="srv-actions">
          ${s.en ? html`<button class="btn btn-sm" data-en="${n}">${icon('download')} نزّل الترجمة الإنجليزي</button>` : ''}
          ${s.merged && s.drive ? html`<a class="btn btn-sm btn-primary" href="${s.drive}" target="_blank" rel="noopener">${icon('folder')} افتح العرض على درايف</a>` : ''}
          ${!busy && (s.subsFailed || s.stopped === 'subs' || (s.en && !s.ar && !s.merged)) ? html`<button class="btn btn-sm ${s.stopped === 'subs' ? 'btn-primary' : 'btn-ghost'}" data-resub="${n}">${icon('refresh')} ${s.stopped === 'subs' ? 'ابدأ التفريغ تاني' : 'فرّغ تاني'}</button>` : ''}
          ${!busy && s.ar && !s.merged ? html`<button class="btn btn-sm" data-unqueue="${n}">${icon('x')} إلغاء الدمج</button>` : ''}
          ${busy ? '' : html`<button class="btn btn-sm btn-ghost danger" data-clean="${n}">${icon('trash')} امسحه من السيرفر</button>`}
        </div>
        ${s.video && !s.en && !(alive && st.job && st.job.step === 'subs' && st.job.name === s.name) ? html`<div class="srv-langs srv-lang-pick"><span class="muted">لغة الصوت:</span>${LANGS.map(l => html`<button class="srv-q ${(s.lang || 'en') === l.key ? 'on' : ''}" data-setlang="${n}:${l.key}">${l.name}</button>`)}</div>` : ''}
        ${!busy && !s.merged ? html`<div class="srv-langs srv-lang-pick"><span class="muted">الجودات:</span>${QUALS.map(q => html`<button class="srv-q ${(chosenQ[s.name] || s.qual || 'all') === q.key ? 'on' : ''}" data-setq="${n}:${q.key}">${q.name}</button>`)}</div>` : ''}
        ${!busy && (s.en || s.ar || s.merged) ? html`<${s.ar || s.merged ? 'details' : 'div'} class="srv-ar">
          ${s.ar || s.merged ? html`<summary class="srv-ar-title">غيّر الترجمة العربي أو مكان اللوجو أو الجودات</summary>` : html`<div class="srv-ar-title">ارفع الترجمة العربي — واختار مكان اللوجو قبلها (والجودات فوق):</div>`}
          ${s.merged ? html`<div class="srv-langs">${QUALS.map(q => html`<button class="srv-q ${(chosenQ[s.name] || s.qual || 'all') === q.key ? 'on' : ''}" data-q="${n}:${q.key}">${q.name}</button>`)}</div>` : ''}
          <div class="srv-pos">${POSITIONS.map(p => html`<button class="srv-pos-btn ${(chosen[s.name] || s.ar || 1) === p.pos ? 'on' : ''}" data-pos="${n}:${p.pos}" title="${p.name}"><span class="srv-screen"><i class="${p.css}">لوجو</i></span>${p.name}</button>`)}</div>
          ${pickedAr[s.name] ? html`<div class="srv-picked">${icon('check')} <b dir="ltr">${pickedAr[s.name].file}</b> <span class="muted">— ${num(pickedAr[s.name].lines)} جملة</span>
              <button class="btn btn-sm btn-ghost" data-unpick="${n}">${icon('x')} شيل</button></div>
            <button class="btn btn-primary srv-go" data-armerge="${n}">${icon('bolt')} ابدأ الدمج</button>`
            : html`<label class="btn btn-sm srv-file">${icon('upload')} اختار ملف الترجمة العربي<input type="file" accept=".srt" data-ar="${n}" hidden></label>`}
        </${s.ar || s.merged ? 'details' : 'div'}>` : ''}
      </div>`;
    })}`);
    $$('[data-en]').forEach(b => b.onclick = async () => {
      const s = list[+b.dataset.en];
      try { const r = await tools.serverEn(s.name); saveText(`${s.name}.srt`, r.text); } catch (e) { toast(e.message || 'مقدرتش أجيب الترجمة', 'error'); }
    });
    $$('[data-pos]').forEach(b => b.onclick = () => {
      const [n, pos] = b.dataset.pos.split(':').map(Number);
      chosen[list[n].name] = pos;
      drawShows(last);
    });
    $$('[data-setq]').forEach(b => b.onclick = () => {
      const [n, q] = b.dataset.setq.split(':'); const s = list[+n];
      chosenQ[s.name] = q; drawShows(last);
      send({ kind: 'setqual', name: s.name, qual: q }, `«${s.name.slice(0, 40)}»: ${q === '720' ? '٧٢٠ بس' : '٤ جودات'}`);
    });
    $$('[data-setlang]').forEach(b => b.onclick = () => { const [n, l] = b.dataset.setlang.split(':'); send({ kind: 'resub', name: list[+n].name, lang: l }, `لغة الصوت: ${LANG_NAME[l]}`); });
    $$('[data-q]').forEach(b => b.onclick = () => { const [n, q] = b.dataset.q.split(':'); chosenQ[list[+n].name] = q; drawShows(last); });
    $$('[data-ar]').forEach(inp => inp.onchange = async () => {
      const s = list[+inp.dataset.ar], file = inp.files && inp.files[0];
      if (!file) return;
      const text = await file.text();
      if (!/-->/.test(text)) return toast('ده مش ملف ترجمة', 'error');
      pickedAr[s.name] = { file: file.name, text, lines: (text.match(/-->/g) || []).length };
      drawShows(last);
    });
    $$('[data-unpick]').forEach(b => b.onclick = () => { delete pickedAr[list[+b.dataset.unpick].name]; drawShows(last); });
    $$('[data-armerge]').forEach(b => b.onclick = async () => {
      const s = list[+b.dataset.armerge], p = pickedAr[s.name];
      if (!p) return;
      const pos = chosen[s.name] || s.ar || 1, qual = chosenQ[s.name] || s.qual || 'all';
      b.disabled = true;
      if (await send({ kind: 'arabic', name: s.name, pos, qual, text: p.text, file: p.file }, `الدمج بدأ (${qual === '720' ? '٧٢٠ بس' : '٤ جودات'}) واللوجو ${(POSITIONS.find(x => x.pos === pos) || POSITIONS[0]).name}`)) delete pickedAr[s.name];
      else b.disabled = false;
    });
    $$('[data-unqueue]').forEach(b => b.onclick = async () => {
      const s = list[+b.dataset.unqueue];
      const ok = await dialog({ title: 'تلغي الدمج؟', body: `ملف الترجمة العربي اللي اترفع لـ«${s.name.slice(0, 60)}» هيتشال، والعرض هيرجع «الترجمة الإنجليزي جاهزة». بعدها اختار الملف الجديد ودوس «ابدأ الدمج».`, confirm: 'إلغاء الدمج', cancel: 'رجوع' });
      if (ok) send({ kind: 'unqueue', name: s.name }, 'اتلغى — اختار ملف الترجمة الجديد');
    });
    $$('[data-remerge]').forEach(b => b.onclick = () => send({ kind: 'remerge', name: list[+b.dataset.remerge].name }, 'الدمج هيبدأ تاني'));
    wireControls($('#srv-shows'));
    $$('[data-resub]').forEach(b => b.onclick = async () => {
      const s = list[+b.dataset.resub];
      let pick = s.lang || 'en';
      const ok = await dialog({ title: 'تفريغ تاني', confirm: 'فرّغ تاني',
        body: html`<p>لغة الصوت في العرض ده:</p><div class="srv-langs">${LANGS.map(l => html`<label class="srv-chip"><input type="radio" name="srv-relang" value="${l.key}" ${l.key === pick ? 'checked' : ''}><span>${l.name}</span></label>`)}</div>`,
        onOpen: (w) => w.querySelectorAll('input[name=srv-relang]').forEach(x => x.onchange = () => { pick = x.value; }) });
      if (ok) send({ kind: 'resub', name: s.name, lang: pick }, 'تمام — هيفرّغه تاني');
    });
    $$('[data-clean]').forEach(b => b.onclick = async () => {
      const s = list[+b.dataset.clean];
      const body = s.merged ? `«${s.name}» هيتمسح من السيرفر عشان المساحة. نسخته على درايف هتفضل موجودة.`
        : s.en ? `«${s.name}» هيتمسح من السيرفر (الفيديو والترجمة). الترجمة الإنجليزي بتاعته فاضلة على درايف، بس العرض نفسه لسه متدمجش.`
        : `«${s.name}» هيتمسح من السيرفر. لسه متفرّغش، فلو عايزه تاني هتحط رابطه من الأول.`;
      const ok = await dialog({ title: 'تمسحه من السيرفر؟', body, confirm: 'امسح', danger: true });
      if (ok) send({ kind: 'clean', name: s.name }, 'هيتمسح من السيرفر');
    });
  };

  // «اللي خلص»: 10 a page, newest first (the worker keeps the last 30 days)
  let jobsPage = 1;
  const drawJobs = (d) => {
    const all = d.jobs || [];
    const pages = Math.max(1, Math.ceil(all.length / 10));
    jobsPage = Math.min(Math.max(1, jobsPage), pages);
    const jobs = all.slice((jobsPage - 1) * 10, jobsPage * 10);
    mount($('#srv-jobs'), all.length ? html`<div class="srv-table"><table>
      <thead><tr><th>العرض</th><th>الخطوة</th><th>بدأ</th><th>خلص</th><th>خد</th></tr></thead>
      <tbody>${jobs.map(j => html`<tr>
        <td class="srv-name">${j.name}</td>
        <td class="${j.ok ? 'ok' : 'bad'}">${STEP_NAME[j.step] || j.step} ${j.ok ? '✓' : '✗'}</td>
        <td>${dayClock(j.started)}</td><td>${dayClock(j.finished)}</td><td>${span(j.finished - j.started)}</td>
      </tr>`)}</tbody></table></div>${pager(jobsPage, pages)}<p class="muted small">بيتشال من هنا لوحده اللي عدّى عليه أكتر من ٣٠ يوم.</p>` : html`<p class="muted">لسه مفيش حاجة خلصت من ساعة ما الصفحة دي اتعملت.</p>`);
    $$('[data-page]', $('#srv-jobs')).forEach(b => b.onclick = () => { jobsPage = Number(b.dataset.page); drawJobs(last); });
  };


  let stopped = false, timer = 0;
  const tick = async () => {
    clearTimeout(timer);
    if (stopped) return;
    if (!document.body.contains(box)) { stopped = true; return; }
    try {
      last = await tools.server();
      drawStatus(last);
      wireControls(box);
      if ($('#srv-drive-ready')) $('#srv-drive-ready').onchange = (e) => send({ kind: 'drive-ready', on: e.target.checked }, e.target.checked ? 'العروض الجاهزة هتترفع على درايف' : 'العروض الجاهزة مش هتترفع على درايف');
      if ($('#srv-drive-go')) $('#srv-drive-go').onclick = async () => {
        const w = last.status && last.status.browser ? window.open('about:blank', '_blank') : null;
        await send({ kind: 'drive-connect' }, 'صفحة جوجل بتتفتح في متصفح السيرفر');
        if (w) setTimeout(() => { w.location = last.status.browser; }, 4000);
      };
      if ($('#srv-start')) $('#srv-start').onclick = () => power('start');
      if ($('#srv-stop')) $('#srv-stop').onclick = () => power('stop');
      if (keyDrawn !== !!last.vastKey) { keyDrawn = !!last.vastKey; drawKey(keyDrawn); }
      // don't redraw the shows while a file picker is open or a position was just picked mid-upload
      if (!document.activeElement || !document.activeElement.matches('input[type=file]')) drawShows(last);
      drawJobs(last);
    } catch (e) { if (!box.querySelector('.srv-card')) mount(box, html`<div class="empty"><h2>مقدرتش أجيب حالة السيرفر</h2><p class="muted">${e.message}</p></div>`); }
    timer = setTimeout(tick, 10_000);
  };
  tick();
}
