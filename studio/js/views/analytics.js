// Visitor statistics at the top of the home page — people only, from the site's own counter (INCIDENTS #457).
// Days before the counter started (12 Oct 2026) show «—»: Cloudflare counted pages the browser fetched ahead of a
// click as views, 5–6 times the real number, so nothing from it is shown as a measurement.
import { api, siteData, getUser } from '../api.js';
import { html, mount, $, $$, icon, toast, num, esc } from '../ui.js';

const countryName = (() => {
  let dn = null;
  try { dn = new Intl.DisplayNames(['ar'], { type: 'region' }); } catch {}
  return (code) => { try { return (dn && code && code.length === 2 && dn.of(code)) || code || 'غير معروف'; } catch { return code; } };
})();
const SECTION_PAGES = {
  '/': 'الصفحة الرئيسية', '/shows/': 'صفحة كل العروض', '/news/': 'صفحة الأخبار', '/recaps/': 'صفحة الملخصات',
  '/nostalgia/': 'صفحة النوستالجيا', '/library/': 'مكتبة العروض', '/federations/': 'صفحة الاتحادات', '/tags/': 'صفحة الوسوم',
  '/search/': 'صفحة البحث', '/about/': 'من نحن', '/contact/': 'اتصل بنا', '/privacy/': 'سياسة الخصوصية',
  '/terms/': 'شروط الاستخدام', '/dmca/': 'حقوق النشر', '/apps/': 'صفحة التطبيقات',
};
const FEDERATION_PAGES = { wwe: 'صفحة اتحاد WWE', aew: 'صفحة اتحاد AEW', tna: 'صفحة اتحاد TNA', roh: 'صفحة اتحاد ROH', mma: 'صفحة رياضات القتال (MMA)', indie: 'صفحة الاتحادات المستقلة' };
/** Every page of the site in words («federation/wwe» showed as it is — the owner, 2026-09-29).
 *  Stories and shows get their real title from the search index afterwards. */
export function pageLabel(path) {
  const p = decodeURIComponent(path || '/').replace(/\/?$/, '/');
  if (SECTION_PAGES[p]) return SECTION_PAGES[p];
  let m;
  if ((m = p.match(/^\/(shows|news|recaps|federations)\/(\d+)\/$/))) return `${SECTION_PAGES[`/${m[1]}/`]} (صفحة ${m[2]})`;
  if ((m = p.match(/^\/federation\/([^/]+)\/(?:(\d+)\/)?$/))) return `${FEDERATION_PAGES[m[1]] || `صفحة اتحاد ${m[1].toUpperCase()}`}${m[2] ? ` (صفحة ${m[2]})` : ''}`;
  if ((m = p.match(/^\/tag\/([^/]+)\/(?:(\d+)\/)?$/))) return `وسم «${m[1].replace(/-/g, ' ')}»${m[2] ? ` (صفحة ${m[2]})` : ''}`;
  if ((m = p.match(/^\/library\/([^/]+)\/$/))) return `مكتبة: ${m[1].replace(/-/g, ' ')}`;
  if ((m = p.match(/^\/nostalgia\/([^/]+)\/$/))) return `سلسلة نوستالجيا: ${m[1].replace(/-/g, ' ')}`;
  // a story or show not in the index (renamed long ago or deleted): never its English address (the owner, 2026-10-09)
  if ((m = p.match(/^\/(news|shows|recaps)\/([^/]+)\/$/))) return /[\u0600-\u06FF]/.test(m[2]) ? m[2].replace(/-/g, ' ') : { news: 'صفحة خبر قديمة', shows: 'صفحة عرض قديمة', recaps: 'صفحة ملخص قديمة' }[m[1]];
  return p.replace(/^\/|\/$/g, '');
}
const slashed = (u) => { let x = String(u || '/'); try { x = decodeURIComponent(x); } catch {} return x.replace(/\/?$/, '/'); };
/** The site's pages by address — and by their old address too: a renamed show moves to a new one (its URL comes from
 *  the title) while readers keep arriving at the old one, the file name's slug («aew dynamite 06 10 2026» showed in
 *  English after «AEW Dynamite» became «AEW Dynamite Grand Slam France», the owner 2026-10-09). */
function pageFinder(index) {
  const byUrl = new Map(), byFile = new Map();
  for (const i of index || []) {
    if (!i.url) continue;
    byUrl.set(slashed(i.url), i);
    const f = String(i.inputPath || '').match(/content\/(shows|recaps|news)\/(?:[^/]+\/)*([^/]+)\.md$/);
    if (f) byFile.set(slashed(`/${f[1]}/${f[2].replace(/^\d{14}-/, '').replace(/^\d{4}-\d{2}-\d{2}-/, '')}/`), i);
  }
  return (path) => byUrl.get(slashed(path)) || byFile.get(slashed(path)) || null;
}
/** Top pages with the views of a page's old and new address added together, each under its Arabic title. */
function mergeTopPages(pages, find) {
  const rows = new Map();
  for (const p of pages || []) {
    const item = find(p.path);
    const key = item ? slashed(item.url) : slashed(p.path);
    const row = rows.get(key) || { path: item ? item.url : p.path, views: 0, title: item ? (item.headline || item.title) : pageLabel(p.path) };
    row.views += Number(p.views) || 0;
    rows.set(key, row);
  }
  return [...rows.values()].sort((a, b) => b.views - a.views);
}
const topRows = (rows) => rows.slice(0, 6).map((p, i) => html`<a class="row row-rank" href="${p.path}" target="_blank"><span class="rank">${i + 1}</span><span class="row-main"><b>${p.title}</b></span><span class="muted">${num(p.views)} مشاهدة</span></a>`);
const pct = (a, b) => (!b ? null : Math.round(((a - b) / b) * 100));
const shortDay = (d) => new Date(`${d}T12:00:00Z`).toLocaleDateString('ar-EG-u-nu-latn', { day: 'numeric', month: 'short' });

function chart(daily, key) {
  const W = 1000, H = 200;
  const vals = daily.map(d => d[key] || 0);
  const max = Math.max(1, ...vals);
  const bw = W / Math.max(1, daily.length);
  return `<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" role="img" aria-label="رسم بياني">` + daily.map((d, i) => {
    if (d[key] == null) return ''; // not measured that day: no bar rather than a made-up one
    const h = Math.max(4, Math.round(((d[key] || 0) / max) * (H - 4)));
    const x = W - (i + 1) * bw + bw * 0.18; // newest on the left, reading right to left
    return `<rect class="${i === daily.length - 1 ? 'now' : ''}" x="${x.toFixed(1)}" y="${H - h}" width="${(bw * 0.64).toFixed(1)}" height="${h}" rx="6"><title>${esc(shortDay(d.date))}: ${num(d[key])}</title></rect>`;
  }).join('') + '</svg>';
}

// Both sets of numbers, each in its own place (owner 2026-10-12: «عايز اشوف الارقام كلها قديم وجديد وكل حاجة في مكانها
// وبيتحدث علطول»): the real ones on top (people only, the site's own counter), Cloudflare's below in the layout the owner
// knows, with all its history, marked as counting every request. Both refresh every minute while the panel is open.
const REFRESH_MS = 60_000;
const boards = { real: { range: 30, metric: 'visitors' }, cf: { range: 30, metric: 'visitors' } };
let refreshTimer = null;

export async function renderAnalytics(el) {
  mount(el, html`<div class="skel-lines" style="height:260px"></div>`);
  const [real, cf] = await Promise.all([api.analytics().catch(e => ({ error: e.message })), api.cloudflareAnalytics().catch(e => ({ error: e.message }))]);
  if (real.error && cf.error) {
    mount(el, html`<div class="panel"><div class="panel-head"><h2>${icon('chart')} إحصائيات الموقع</h2></div><p class="panel-pad muted">${real.error}</p></div>`);
    return;
  }
  mount(el, html`<div id="a-real"></div><div id="a-cf"></div>`);
  if (!real.error) board($('#a-real', el), real, 'real');
  if (cf.configured === false) {
    if ((getUser() || {}).role === 'owner') renderSetup($('#a-cf', el), () => renderAnalytics(el));
  } else if (!cf.error) board($('#a-cf', el), cf, 'cf');
  if (refreshTimer) clearInterval(refreshTimer);
  refreshTimer = setInterval(async () => {
    if (!el.isConnected) { clearInterval(refreshTimer); refreshTimer = null; return; }
    if (document.hidden) return;
    const [r, c] = await Promise.all([api.analytics().catch(() => null), api.cloudflareAnalytics().catch(() => null)]);
    if (r && !r.error && $('#a-real', el)) board($('#a-real', el), r, 'real');
    if (c && c.configured !== false && !c.error && $('#a-cf', el)) board($('#a-cf', el), c, 'cf');
  }, REFRESH_MS);
}

function board(box, data, kind) {
  const st = boards[kind];
  const isReal = kind === 'real';
  const q = (sel) => box.querySelector(sel);
  const all = data.daily || [];
  // the whole history starts at the first day with any number (Cloudflare keeps the site from 8 August 2026)
  const first = all.findIndex(d => (d.views || 0) > 0 || (d.visitors || 0) > 0);
  const daily = first > 0 ? all.slice(first) : all;
  const today = daily[daily.length - 1] || { visitors: 0, views: 0 };
  const yesterday = daily[daily.length - 2] || { visitors: 0, views: 0 };
  const last7 = daily.slice(-7), prev7 = daily.slice(-14, -7);
  const sum = (arr, k) => arr.reduce((a, d) => a + (d[k] || 0), 0);
  const measured = (arr, k) => arr.length > 0 && arr.every(d => d[k] != null);
  const since = data.since ? shortDay(data.since) : '';
  const k = (n) => n == null ? '—' : n >= 100000 ? `${(n / 1000).toFixed(0)}K` : n >= 10000 ? `${(n / 1000).toFixed(1)}K` : num(n);
  const delta = (d, note) => d == null ? html`<em>${note}</em>` : html`<em>${d >= 0 ? '▲' : '▼'} ${Math.abs(d)}% ${note}</em>`;
  const weekDelta = measured(last7, 'visitors') && measured(prev7, 'visitors') ? pct(sum(last7, 'visitors'), sum(prev7, 'visitors')) : null;
  const was = (v, f) => v == null ? '— (لسه ماكانش بيتعد)' : f(v);
  const tot = (data.topCountries || []).reduce((a, c) => a + c.requests, 0) || 1;
  const top = (data.topCountries || []).slice(0, 4);
  const pagesId = `a-pages-rows-${kind}`;
  mount(box, html`<header class="a-board-head ${isReal ? 'is-real' : 'is-cf'}">
      <h2>${isReal ? 'الأرقام الحقيقية' : 'أرقام كلاودفلير'}</h2>
      <span class="pill">${isReal ? `ناس بس${since ? ` · من ${since}` : ''}` : 'كل الطلبات · تقريبية'}</span>
      <small class="muted">${isReal ? 'محركات البحث وبرامج الذكاء الاصطناعي وروبوتات الموقع والصفحات اللي المتصفح بيجهّزها لوحده مش محسوبة.' : 'بتعد البرامج الآلية والصفحات اللي المتصفح بيجهّزها من غير ما حد يفتحها، فهي أعلى من الحقيقة.'}</small>
    </header>
    <section class="a-grid">
    <div class="blk blk-teal a-main">
      <div class="a-main-head"><small><span class="a-metric-label">${st.metric === 'visitors' ? 'زوار' : 'مشاهدات'}</span> <span class="a-range-label"></span></small>
        <div class="a-toggles"><span class="mini-seg a-metric"><button type="button" class="${st.metric === 'visitors' ? 'on' : ''}" data-v="visitors">زوار</button><button type="button" class="${st.metric === 'views' ? 'on' : ''}" data-v="views">مشاهدات</button></span>
        <span class="mini-seg a-range">${[7, 14, 30, 0].map(n => html`<button type="button" class="${st.range === n ? 'on' : ''}" data-v="${n}">${n ? n : 'الكل'}</button>`)}</span></div></div>
      <b class="a-total"></b>
      <em class="a-peak"></em>
      <div class="a-svg"></div>
    </div>
    <div class="blk blk-yellow"><small>زوار النهارده لحد دلوقتي</small><b>${k(today.visitors)}</b><em>امبارح كله: ${was(yesterday.visitors, num)}</em></div>
    <div class="blk blk-coral"><small>مشاهدات النهارده لحد دلوقتي</small><b>${k(today.views)}</b><em>امبارح كله: ${was(yesterday.views, k)}</em></div>
    <div class="blk blk-ink"><small>زوار آخر 7 أيام</small><b>${k(sum(last7, 'visitors'))}</b>${measured(last7, 'visitors') ? delta(weekDelta, 'عن الأسبوع اللي فات') : html`<em>من ${since} بس (بداية العدّ الحقيقي)</em>`}</div>
    <div class="blk blk-cream"><small>أكتر الدول${isReal ? ' (مشاهدات آخر 7 أيام)' : ''}</small>
      ${top.length ? html`<b class="b-sm">${countryName(top[0].code)} ${Math.round(top[0].requests / tot * 100)}%</b><em>${top.slice(1).map(c => `${countryName(c.code)} ${Math.round(c.requests / tot * 100)}%`).join(' · ')}</em>` : html`<b class="b-sm">—</b>`}
    </div>
  </section>
  ${(data.topPages || []).length ? html`<section class="panel a-pages"><header class="panel-head"><h2>أكتر الصفحات مشاهدة في آخر 24 ساعة</h2><span class="muted small">${data.stale ? 'آخر بيانات متاحة' : 'بتتحدّث كل دقيقة'}</span></header>
    <div class="rows" id="${pagesId}">${topRows(mergeTopPages(data.topPages, () => null))}</div></section>` : ''}`);
  // Each page under its Arabic title (from the site's own index), old and new addresses of a renamed show as one row
  if ((data.topPages || []).length) {
    siteData('search-index.json').then(index => {
      const rows = q(`#${pagesId}`);
      if (rows) mount(rows, html`${topRows(mergeTopPages(data.topPages, pageFinder(index)))}`);
    }).catch(() => {});
  }
  const draw = () => {
    const slice = st.range ? daily.slice(-st.range) : daily;
    q('.a-svg').innerHTML = chart(slice, st.metric);
    q('.a-range-label').textContent = st.range ? `آخر ${num(st.range)} يوم` : `من ${shortDay(daily[0] ? daily[0].date : '')} (${num(daily.length)} يوم)`;
    q('.a-metric-label').textContent = st.metric === 'visitors' ? 'زوار' : 'مشاهدات';
    q('.a-total').textContent = k(sum(slice, st.metric));
    const peak = slice.reduce((m, d) => (d[st.metric] != null && d[st.metric] > (m ? m[st.metric] : -1) ? d : m), null);
    const partial = !measured(slice, st.metric) && since ? ` · العدّ الحقيقي بدأ ${since}` : '';
    q('.a-peak').textContent = (peak ? `أعلى يوم: ${num(peak[st.metric])} (${shortDay(peak.date)})` : '') + partial;
  };
  draw();
  box.querySelectorAll('.a-range button').forEach(b => b.onclick = () => { st.range = +b.dataset.v; box.querySelectorAll('.a-range button').forEach(x => x.classList.toggle('on', x === b)); draw(); });
  box.querySelectorAll('.a-metric button').forEach(b => b.onclick = () => { st.metric = b.dataset.v; box.querySelectorAll('.a-metric button').forEach(x => x.classList.toggle('on', x === b)); draw(); });
}

function renderSetup(el, done) {
  mount(el, html`<section class="blk blk-cream analytics-setup">
    <header class="setup-head"><h2>إحصائيات الموقع</h2><span class="pill">محتاجة ربط مرة واحدة</span></header>
    <div class="setup-grid">
      <ol class="steps">
        <li>افتح <a class="link" href="https://dash.cloudflare.com/profile/api-tokens" target="_blank" rel="noopener">صفحة مفاتيح كلاود فلير</a> ودوس <b>Create Token</b>.</li>
        <li>اختار <b>Create Custom Token</b> وسمّيه مثلا «إحصائيات اللوحة».</li>
        <li>في <b>Permissions</b> ضيف سطرين: <b>Zone → Analytics → Read</b> و <b>Zone → Zone → Read</b>.</li>
        <li>في <b>Zone Resources</b> اختار <b>Specific zone → arab-wrestling.com</b>.</li>
        <li>دوس <b>Continue to summary</b> ثم <b>Create Token</b>، وانسخ المفتاح والصقه هنا.</li>
      </ol>
      <form class="setup-form" id="a-form">
        <label class="field"><span>مفتاح القراءة</span><input class="input mono" id="a-token" dir="ltr" autocomplete="off" placeholder="الصق المفتاح هنا"></label>
        <label class="field hidden" id="a-zone-row"><span>رقم الموقع (Zone ID)</span><input class="input mono" id="a-zone" dir="ltr" autocomplete="off" placeholder="موجود في صفحة الموقع على كلاود فلير يمين تحت"></label>
        <button class="btn btn-primary" id="a-save" type="submit">${icon('check')} ربط الإحصائيات</button>
        <p class="muted small">المفتاح ده للقراءة بس: بيشوف أرقام الزيارات ومبيقدرش يغيّر أي حاجة في الموقع. بيتحفظ في خادم اللوحة ومش بيظهر تاني.</p>
      </form>
    </div>
  </section>`);
  $('#a-form').onsubmit = async (e) => {
    e.preventDefault();
    const btn = $('#a-save'); btn.disabled = true; btn.classList.add('loading');
    try {
      await api.connectAnalytics({ token: $('#a-token').value.trim(), zoneId: $('#a-zone').value.trim() });
      toast('اتربطت الإحصائيات ✓');
      done ? done() : renderAnalytics(el);
    } catch (ex) {
      toast(ex.message, 'error', 6000);
      if (ex.data && ex.data.needZone) $('#a-zone-row').classList.remove('hidden');
    } finally { btn.disabled = false; btn.classList.remove('loading'); }
  };
}
