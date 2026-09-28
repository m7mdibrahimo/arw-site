// Visitor statistics at the top of the home page (Cloudflare's analytics for the site).
import { api, siteData } from '../api.js';
import { html, mount, $, $$, icon, toast, num, esc } from '../ui.js';

const countryName = (() => {
  let dn = null;
  try { dn = new Intl.DisplayNames(['ar'], { type: 'region' }); } catch {}
  return (code) => { try { return (dn && code && code.length === 2 && dn.of(code)) || code || 'غير معروف'; } catch { return code; } };
})();
const SECTION_PAGES = { '/': 'الصفحة الرئيسية', '/shows/': 'صفحة كل العروض', '/news/': 'صفحة الأخبار', '/recaps/': 'صفحة الملخصات', '/nostalgia/': 'صفحة النوستالجيا', '/library/': 'مكتبة العروض' };
function pageLabel(path) {
  const p = decodeURIComponent(path || '/').replace(/\/?$/, '/');
  return SECTION_PAGES[p] || p.replace(/^\/|\/$/g, '');
}
const pct = (a, b) => (!b ? null : Math.round(((a - b) / b) * 100));
const shortDay = (d) => new Date(`${d}T12:00:00Z`).toLocaleDateString('ar-EG-u-nu-latn', { day: 'numeric', month: 'short' });

function chart(daily, key) {
  const W = 1000, H = 200;
  const vals = daily.map(d => d[key] || 0);
  const max = Math.max(1, ...vals);
  const bw = W / Math.max(1, daily.length);
  return `<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" role="img" aria-label="رسم بياني">` + daily.map((d, i) => {
    const h = Math.max(4, Math.round(((d[key] || 0) / max) * (H - 4)));
    const x = W - (i + 1) * bw + bw * 0.18; // newest on the left, reading right to left
    return `<rect class="${i === daily.length - 1 ? 'now' : ''}" x="${x.toFixed(1)}" y="${H - h}" width="${(bw * 0.64).toFixed(1)}" height="${h}" rx="6"><title>${esc(shortDay(d.date))}: ${num(d[key])}</title></rect>`;
  }).join('') + '</svg>';
}

export async function renderAnalytics(el) {
  mount(el, html`<div class="skel-lines" style="height:260px"></div>`);
  let data;
  try { data = await api.analytics(); } catch (e) {
    mount(el, html`<div class="panel"><div class="panel-head"><h2>${icon('chart')} إحصائيات الموقع</h2></div><p class="panel-pad muted">${e.message}</p></div>`);
    return;
  }
  if (!data.configured) return renderSetup(el);

  const daily = data.daily || [];
  const today = daily[daily.length - 1] || { visitors: 0, views: 0 };
  const yesterday = daily[daily.length - 2] || { visitors: 0, views: 0 };
  const last7 = daily.slice(-7), prev7 = daily.slice(-14, -7);
  const sum = (arr, k) => arr.reduce((a, d) => a + (d[k] || 0), 0);
  const kpis = [
    { label: 'زوار النهارده', value: today.visitors, delta: pct(today.visitors, yesterday.visitors), note: 'مقارنة بامبارح' },
    { label: 'مشاهدات النهارده', value: today.views, delta: pct(today.views, yesterday.views), note: 'مقارنة بامبارح' },
    { label: 'زوار آخر 7 أيام', value: sum(last7, 'visitors'), delta: pct(sum(last7, 'visitors'), sum(prev7, 'visitors')), note: 'مقارنة بالأسبوع اللي قبله' },
    { label: 'مشاهدات آخر 30 يوم', value: sum(daily, 'views'), delta: null, note: `${num(sum(daily, 'visitors'))} زائر` },
  ];
  let range = 30, metric = 'visitors';
  const k = (n) => n >= 100000 ? `${(n / 1000).toFixed(0)}K` : n >= 10000 ? `${(n / 1000).toFixed(1)}K` : num(n);
  const delta = (d, note) => d == null ? html`<em>${note}</em>` : html`<em>${d >= 0 ? '▲' : '▼'} ${Math.abs(d)}% ${note}</em>`;
  const tot = (data.topCountries || []).reduce((a, c) => a + c.requests, 0) || 1;
  const top = (data.topCountries || []).slice(0, 4);
  mount(el, html`<section class="a-grid">
    <div class="blk blk-teal a-main">
      <div class="a-main-head"><small>${metric === 'visitors' ? 'زوار' : 'مشاهدات'} آخر <span id="a-range-label">30</span> يوم</small>
        <div class="a-toggles"><span class="mini-seg" id="a-metric"><button type="button" class="on" data-v="visitors">زوار</button><button type="button" data-v="views">مشاهدات</button></span>
        <span class="mini-seg" id="a-range"><button type="button" data-v="7">7</button><button type="button" data-v="14">14</button><button type="button" class="on" data-v="30">30</button></span></div></div>
      <b id="a-total">${k(sum(daily, 'visitors'))}</b>
      <em id="a-peak"></em>
      <div id="a-svg" class="a-svg"></div>
    </div>
    <div class="blk blk-yellow"><small>زوار النهارده لحد دلوقتي</small><b>${num(today.visitors)}</b><em>امبارح كله: ${num(yesterday.visitors)}</em></div>
    <div class="blk blk-coral"><small>مشاهدات النهارده لحد دلوقتي</small><b>${k(today.views)}</b><em>امبارح كله: ${k(yesterday.views)}</em></div>
    <div class="blk blk-ink"><small>زوار آخر 7 أيام</small><b>${k(sum(last7, 'visitors'))}</b>${delta(kpis[2].delta, 'عن الأسبوع اللي فات')}</div>
    <div class="blk blk-cream"><small>أكتر الدول</small>
      ${top.length ? html`<b class="b-sm">${countryName(top[0].code)} ${Math.round(top[0].requests / tot * 100)}%</b><em>${top.slice(1).map(c => `${countryName(c.code)} ${Math.round(c.requests / tot * 100)}%`).join(' · ')}</em>` : html`<b class="b-sm">—</b>`}
    </div>
  </section>
  ${(data.topPages || []).length ? html`<section class="panel" id="a-pages"><header class="panel-head"><h2>أكتر الصفحات مشاهدة في آخر 24 ساعة</h2><span class="muted small">${data.stale ? 'آخر بيانات متاحة' : 'بتتحدّث كل 10 دقايق'}</span></header>
    <div class="rows">${data.topPages.slice(0, 6).map((p, i) => html`<a class="row row-rank" href="${p.path}" target="_blank"><span class="rank">${i + 1}</span><span class="row-main"><b data-path="${p.path}">${pageLabel(p.path)}</b></span><span class="muted">${num(p.views)} مشاهدة</span></a>`)}</div></section>` : ''}`);
  // Show each page's title instead of its address (from the site's own index)
  if ((data.topPages || []).length) {
    siteData('search-index.json').then(index => {
      const byUrl = new Map(index.map(i => [decodeURIComponent(i.url || '').replace(/\/?$/, '/'), i.headline || i.title]));
      document.querySelectorAll('#a-pages [data-path]').forEach(b => {
        const key = decodeURIComponent(b.dataset.path).replace(/\/?$/, '/');
        if (byUrl.get(key)) b.textContent = byUrl.get(key);
      });
    }).catch(() => {});
  }
  const draw = () => {
    const slice = daily.slice(-range);
    $('#a-svg').innerHTML = chart(slice, metric);
    $('#a-range-label').textContent = String(range);
    $('#a-total').textContent = k(sum(slice, metric));
    const peak = slice.reduce((m, d) => (d[metric] > (m ? m[metric] : -1) ? d : m), null);
    $('#a-peak').textContent = peak ? `أعلى يوم: ${num(peak[metric])} (${shortDay(peak.date)})` : '';
  };
  draw();
  $$('#a-range button').forEach(b => b.onclick = () => { range = +b.dataset.v; $$('#a-range button').forEach(x => x.classList.toggle('on', x === b)); draw(); });
  $$('#a-metric button').forEach(b => b.onclick = () => { metric = b.dataset.v; $$('#a-metric button').forEach(x => x.classList.toggle('on', x === b)); draw(); });
}

function renderSetup(el) {
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
      renderAnalytics(el);
    } catch (ex) {
      toast(ex.message, 'error', 6000);
      if (ex.data && ex.data.needZone) $('#a-zone-row').classList.remove('hidden');
    } finally { btn.disabled = false; btn.classList.remove('loading'); }
  };
}
