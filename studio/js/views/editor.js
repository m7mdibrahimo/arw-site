// Add / edit any content: sectioned form, live preview, checklist, smart helpers.
import { content, siteData, addPending, trackLive, IS_LOCAL, getUser } from '../api.js';
import { notify } from '../notify.js';
import {
  COLLECTIONS, FEDERATIONS, parseFile, serializeFile, newFileSlug, isoLocal, dateOnly, toDate,
  extractUrls, splitDownloadsByQuality, textToLines, nextHeadline, descriptionFromHeadline, hostName, checklist, syncEpisodeCode, dropStaleTemplateTags,
} from '../schema.js';
import { prepareImage, prepareImageFromUrl, kb } from '../image.js';
import { html, raw, mount, $, $$, icon, toast, dialog, timeAgo, fmtDate, esc, can, sectionOf } from '../ui.js';
import { marked } from '../../vendor/marked.esm.js';

let S = null; // the open editor's state
const localPreviews = {}; // image path → preview of a just-uploaded cover (the site shows it after the next build)
export function hasUnsavedChanges() { return !!(S && S.dirty); }
export function closeEditor() { S = null; document.onpaste = null; }

// ── Section layout per collection ──────────────────────────────────────────
const SECTIONS = {
  shows: [
    { id: 'basics', title: 'البيانات الأساسية', icon: 'show', fields: ['program', 'federation', 'title', 'event_date', 'headline', 'show_type', 'numbering'] },
    { id: 'watch', title: 'سيرفرات المشاهدة', icon: 'eye', fields: ['servers'] },
    { id: 'downloads', title: 'روابط التحميل', icon: 'upload', fields: ['downloads'] },
    { id: 'cover', title: 'الغلاف والتفاصيل', icon: 'image', fields: ['image', 'description', 'tags', 'duration', 'date', 'maintenance', 'body'] },
  ],
  recaps: [
    { id: 'basics', title: 'البيانات الأساسية', icon: 'recap', fields: ['program', 'federation', 'title', 'event_date', 'headline', 'is_annual'] },
    { id: 'watch', title: 'سيرفرات المشاهدة', icon: 'eye', fields: ['servers'] },
    { id: 'cover', title: 'الغلاف والتفاصيل', icon: 'image', fields: ['image', 'description', 'tags', 'date', 'body'] },
  ],
  news: [
    { id: 'basics', title: 'الخبر', icon: 'news', fields: ['federation', 'title', 'image', 'body'] },
    { id: 'meta', title: 'النشر والوسوم', icon: 'send', fields: ['tags', 'date', 'social'] },
  ],
  nostalgia: [
    { id: 'basics', title: 'السلسلة والترتيب', icon: 'folder', fields: ['nostalgia_series', 'series_type', 'nostalgia_order', 'nostalgia_main'] },
    { id: 'info', title: 'بيانات الحلقة', icon: 'nostalgia', fields: ['title', 'headline', 'event_date', 'duration'] },
    { id: 'watch', title: 'سيرفرات المشاهدة', icon: 'eye', fields: ['servers'] },
    { id: 'downloads', title: 'روابط التحميل', icon: 'upload', fields: ['downloads'] },
    { id: 'cover', title: 'الغلاف والتفاصيل', icon: 'image', fields: ['image', 'tags', 'date', 'body'] },
  ],
  nostalgia_series: [
    { id: 'basics', title: 'بيانات السلسلة', icon: 'folder', fields: ['title', 'series_type_series', 'federation', 'year', 'image', 'tags', 'description'] },
  ],
};

// ── Field renderers ────────────────────────────────────────────────────────
const F = {
  program: () => html`<div class="field">
    <label for="f-program">اسم البرنامج <em>اختياري — بيربط الحلقات ببعض</em></label>
    <div class="combo"><input class="input" id="f-program" data-k="program_name" list="programs" dir="auto" placeholder="مثال: WWE RAW" value="${S.data.program_name || ''}">
    <button type="button" class="btn btn-soft" id="fill-last">${icon('wand')} املأ من آخر حلقة</button></div>
    <datalist id="programs">${S.programs.map(p => html`<option value="${p}">`)}</datalist>
    <small class="hint">اختار البرنامج ودوس «املأ من آخر حلقة»: الاتحاد والوسوم والوصف والعنوان هيتملوا لوحدهم.</small></div>`,
  federation: () => html`<div class="field"><label>الاتحاد ${req('federation')}</label>
    <div class="seg" data-seg="federation">${FEDERATIONS.map(f => html`<button type="button" class="${S.data.federation === f ? 'on' : ''}" data-v="${f}">${f}</button>`)}</div></div>`,
  title: () => html`<div class="field"><label for="f-title">${S.collection === 'news' ? 'عنوان الخبر' : S.collection === 'nostalgia_series' ? 'اسم السلسلة بالعربي' : 'اسم العرض / الحلقة'} ${req('title')}</label>
    <input class="input input-lg" id="f-title" data-k="title" dir="auto" value="${S.data.title || ''}" placeholder="${S.collection === 'news' ? 'اكتب عنوان واضح ومباشر' : S.collection === 'shows' ? 'مثال: RAW 21.09.2026' : ''}">
    ${S.collection === 'news' ? html`<small class="hint" id="title-hint"></small>` : ''}
    ${!S.slug && S.collection !== 'news' ? html`<small class="hint">اسم الملف ورابط الصفحة بيتعملوا من الاسم ده.</small>` : ''}</div>`,
  event_date: () => html`<div class="field field-half"><label for="f-event">تاريخ العرض</label>
    <input class="input" type="date" id="f-event" data-k="event_date" value="${String(S.data.event_date || '').slice(0, 10)}"></div>`,
  headline: () => html`<div class="field"><label for="f-headline">العنوان العربي ${req('headline')} <em>اللي بيظهر للزوار</em></label>
    <div class="combo"><input class="input" id="f-headline" data-k="headline" dir="auto" value="${S.data.headline || ''}" placeholder="مثال: عرض الرو 21.09.2026 مترجم">
    <button type="button" class="btn btn-soft" id="suggest-headline" title="اقتراح من آخر حلقة">${icon('wand')}</button></div></div>`,
  show_type: () => html`<div class="field field-half"><label>نوع المحتوى</label>
    <div class="seg" data-seg="show_type">${['عرض', 'برنامج'].map(v => html`<button type="button" class="${(S.data.show_type || 'عرض') === v ? 'on' : ''}" data-v="${v}">${v}</button>`)}</div></div>`,
  is_annual: () => toggle('is_annual', 'فعالية سنوية', 'زي All In: كل نسخة باسمها كامل ومن غير مواسم'),
  numbering: () => html`<details class="field fold" ${S.data.season_number || S.data.episode_number || S.data.is_annual ? 'open' : ''}>
    <summary>خيارات الترقيم ${icon('arrowLeft')}</summary>
    <div class="fold-body">
      ${toggle('is_annual', 'فعالية سنوية', 'زي All In: كل نسخة باسمها كامل ومن غير مواسم')}
      <div class="row-2">
        <div class="field"><label for="f-season">رقم الموسم</label><input class="input" type="number" min="1" id="f-season" data-k="season_number" data-type="int" value="${S.data.season_number ?? ''}"></div>
        <div class="field"><label for="f-episode">رقم / عنوان الحلقة</label><input class="input" id="f-episode" data-k="episode_number" dir="auto" value="${S.data.episode_number ?? ''}"></div>
      </div>
      <small class="hint">للبرامج المرقّمة بس (زي WWE LFG). العروض الأسبوعية سيبها فاضية والموقع هيستخدم التاريخ.</small>
    </div></details>`,
  servers: () => html`<div class="field">
    <div class="list-head"><label>روابط المشاهدة (الإمبيد) <em>${(S.data.servers || []).length} سيرفر</em></label></div>
    <div class="servers" id="servers">${(S.data.servers || []).map((s, i) => serverRow(s.url, i))}</div>
    <div class="paste-box"><textarea class="input" id="servers-paste" rows="2" dir="ltr" placeholder="الصق رابط أو أكتر هنا (كل رابط في سطر) وهيتضافوا لوحدهم"></textarea></div>
    <small class="hint">اسم كل سيرفر بيتكتب لوحده على الموقع (سيرفر ١، سيرفر ٢…). رتّبهم بالأسهم.</small></div>`,
  downloads: () => {
    const qs = [['downloads_low', 'منخفضة 480p'], ['downloads_medium', 'متوسطة 720p'], ['downloads_high', 'عالية 1080p']];
    return html`<div class="field">
      <div class="paste-box smart"><label for="dl-paste">${icon('wand')} لصق ذكي</label>
        <textarea class="input" id="dl-paste" rows="3" dir="ltr" placeholder="الصق كل روابط التحميل مرة واحدة — الروابط اللي فيها 480 أو 720 أو 1080 هتروح للجودة بتاعتها، والباقي للجودة المختارة تحت"></textarea>
        <div class="paste-foot"><span class="muted small">الروابط اللي من غير جودة تروح لـ:</span>
          <div class="seg seg-sm" id="dl-default">${qs.map(([k, l], i) => html`<button type="button" data-v="${k}" class="${i === 1 ? 'on' : ''}">${l.split(' ')[0]}</button>`)}</div>
          <button type="button" class="btn btn-soft btn-sm" id="dl-apply">وزّع الروابط</button></div></div>
      <div class="dl-grid">${qs.map(([k, l]) => html`<div class="dl-col"><label for="f-${k}">${l} <em id="cnt-${k}">${textToLines(S.data[k]).length} رابط</em></label>
        <textarea class="input mono" id="f-${k}" data-k="${k}" rows="6" dir="ltr">${S.data[k] || ''}</textarea></div>`)}</div>
      ${S.data.downloads ? html`<div class="field"><label for="f-downloads">روابط بالنظام القديم</label><textarea class="input mono" id="f-downloads" data-k="downloads" rows="4" dir="ltr">${S.data.downloads}</textarea></div>` : ''}
    </div>`;
  },
  image: () => html`<div class="field"><label>صورة الغلاف ${req('image')}</label>
    <div class="drop ${S.data.image ? 'has' : ''}" id="drop" tabindex="0">
      ${coverSrc() ? html`<img src="${coverSrc()}" alt="" id="cover-img">` : ''}
      <div class="drop-empty">${icon('upload')}<b>اسحب الصورة هنا أو دوس للاختيار</b><small>أو الصقها (Ctrl+V) — هتتصغّر وتتضغط لوحدها</small></div>
      <div class="drop-actions"><button type="button" class="btn btn-sm btn-glass" id="img-change">${icon('image')} تغيير</button><button type="button" class="btn btn-sm btn-glass" id="img-url">${icon('link')} من رابط</button></div>
      <input type="file" accept="image/*" id="img-file" hidden>
    </div><small class="hint" id="img-info">${S.images.length ? `صورة جديدة: ${kb(S.images[0].bytes)} بدل ${kb(S.images[0].originalBytes)}` : S.data.image || ''}</small></div>`,
  description: () => html`<div class="field"><label for="f-desc">وصف قصير ${req('description')}</label>
    <div class="combo combo-top"><textarea class="input" id="f-desc" data-k="description" rows="2" dir="auto">${S.data.description || ''}</textarea>
    ${S.collection !== 'nostalgia_series' ? html`<button type="button" class="btn btn-soft" id="suggest-desc" title="اقتراح من العنوان">${icon('wand')}</button>` : ''}</div></div>`,
  tags: () => html`<div class="field"><label>الوسوم <em>Enter بعد كل وسم</em></label>
    <div class="tags" id="tags">${(S.data.tags || []).map((t, i) => html`<span class="tagchip">${t}<button type="button" data-rm="${i}" aria-label="حذف">${icon('x')}</button></span>`)}
    <input id="tag-input" list="tag-list" dir="auto" placeholder="${(S.data.tags || []).length ? '' : 'مثال: WWE, رومان رينز'}"></div>
    <datalist id="tag-list">${S.tagSuggestions.map(t => html`<option value="${t}">`)}</datalist></div>`,
  duration: () => html`<div class="field field-half"><label for="f-duration">مدة العرض ${req('duration')}</label>
    <input class="input mono" id="f-duration" data-k="duration" dir="ltr" placeholder="02:37:11" value="${S.data.duration || ''}"></div>`,
  date: () => {
    const d = toDate(S.data.date) || new Date();
    const local = new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
    return html`<div class="field field-half"><label for="f-date">وقت النشر</label>
      <div class="combo"><input class="input" type="datetime-local" id="f-date" value="${local}"><button type="button" class="btn btn-soft" id="date-now">الآن</button></div>
      <small class="hint" id="date-hint"></small></div>`;
  },
  maintenance: () => html`${toggle('maintenance', '🛠️ العرض تحت التعديل', 'بتظهر للزوار رسالة إن العرض بيتحدّث — اقفلها لما تخلص')}
    <div class="field ${S.data.maintenance ? '' : 'hidden'}" id="mnote"><label for="f-mnote">نص الرسالة <em>اختياري</em></label><textarea class="input" id="f-mnote" data-k="maintenance_note" rows="2" dir="auto">${S.data.maintenance_note || ''}</textarea></div>`,
  body: () => html`<details class="field fold" ${S.collection === 'news' || S.body ? 'open' : ''}>
    <summary>${S.collection === 'news' ? 'نص الخبر' : 'نص إضافي (اختياري)'} ${icon('arrowLeft')}</summary>
    <div class="md">
      <div class="md-bar">
        <button type="button" data-md="bold" title="عريض"><b>B</b></button>
        <button type="button" data-md="h" title="عنوان فرعي">H</button>
        <button type="button" data-md="list" title="قائمة">•</button>
        <button type="button" data-md="quote" title="اقتباس">❝</button>
        <button type="button" data-md="link" title="رابط">${icon('link')}</button>
        <button type="button" data-md="embed" title="فيديو أو تغريدة">${icon('film')}</button>
        <span class="md-spacer"></span>
        <div class="seg seg-sm" id="md-mode"><button type="button" class="on" data-v="write">كتابة</button><button type="button" data-v="preview">معاينة</button></div>
      </div>
      <textarea class="input md-text" id="f-body" rows="${S.collection === 'news' ? 14 : 6}" dir="auto">${S.body || ''}</textarea>
      <div class="md-preview prose" id="md-preview" hidden></div>
      <small class="hint" id="body-count"></small>
    </div></details>`,
  social: () => html`${toggle('single_match_result', 'منع النشر على المنصات', 'فعّلها لو الخبر فيه نتيجة نزال أو عودة أو ظهور أول — هيفضل على الموقع بس')}
    ${S.data.source_url ? html`<div class="source-box">${icon('link')}<span>مصدر الخبر: <a href="${S.data.source_url}" target="_blank" rel="noopener" dir="ltr">${hostName(S.data.source_url)}</a></span></div>` : ''}`,
  nostalgia_series: () => html`<div class="field"><label for="f-series">السلسلة ${req('nostalgia_series')}</label>
    <select class="input" id="f-series" data-k="nostalgia_series"><option value="">اختار السلسلة…</option>
    ${S.series.map(s => html`<option value="${s.slug}" ${S.data.nostalgia_series === s.slug ? 'selected' : ''}>${s.title} (${s.year})</option>`)}</select>
    <small class="hint">مش موجودة؟ <a href="#/new/nostalgia_series" class="link">أضف سلسلة جديدة</a></small></div>`,
  series_type: () => html`<div class="field field-half"><label>النوع</label>
    <div class="seg" data-seg="series_type">${[['', 'تلقائي'], ['shows', 'عرض'], ['program', 'حلقة برنامج']].map(([v, l]) => html`<button type="button" class="${(S.data.series_type || '') === v ? 'on' : ''}" data-v="${v}">${l}</button>`)}</div></div>`,
  series_type_series: () => html`<div class="field"><label>نوع السلسلة</label>
    <div class="seg" data-seg="series_type">${[['shows', 'سلسلة عروض (طريق لعرض شهري)'], ['program', 'برنامج بمواسم وحلقات']].map(([v, l]) => html`<button type="button" class="${(S.data.series_type || 'shows') === v ? 'on' : ''}" data-v="${v}">${l}</button>`)}</div></div>`,
  nostalgia_order: () => html`<div class="field field-half"><label for="f-order">الترتيب في السلسلة</label><input class="input" type="number" min="1" id="f-order" data-k="nostalgia_order" data-type="int" value="${S.data.nostalgia_order ?? 1}"></div>`,
  nostalgia_main: () => toggle('nostalgia_main', 'العرض الرئيسي / الحلقة الختامية', 'للعرض الكبير اللي السلسلة بتوصل له'),
  year: () => html`<div class="field field-half"><label for="f-year">سنة السلسلة ${req('year')}</label><input class="input" id="f-year" data-k="year" dir="ltr" placeholder="2012" value="${S.data.year || ''}"></div>`,
};
function req(k) { return COLLECTIONS[S.collection].required.includes(k) ? raw('<i class="req">*</i>') : ''; }
function toggle(k, label, hint) {
  return html`<label class="toggle-row"><span><b>${label}</b>${hint ? html`<small>${hint}</small>` : ''}</span>
    <input type="checkbox" class="switch" data-k="${k}" data-type="bool" ${S.data[k] ? 'checked' : ''}></label>`;
}
function serverRow(url, i) {
  return html`<div class="server" data-i="${i}"><span class="server-n">${i + 1}</span><span class="host">${hostName(url)}</span>
    <input class="input mono" dir="ltr" value="${url}" data-srv="${i}">
    <button type="button" class="icon-btn" data-up="${i}" title="لفوق">▲</button><button type="button" class="icon-btn" data-down="${i}" title="لتحت">▼</button>
    <button type="button" class="icon-btn danger" data-rm-srv="${i}" title="حذف">${icon('x')}</button></div>`;
}
function coverSrc() { return S.images.length ? S.images[0].previewUrl : localPreviews[S.data.image] || S.data.image || ''; }

// ── Render ─────────────────────────────────────────────────────────────────
export async function renderEditor(page, collection, slug, { from = null } = {}) {
  const def = COLLECTIONS[collection];
  mount(page, html`<div class="loading-page"><div class="spinner"></div><p class="muted">جاري الفتح…</p></div>`);
  const studioData = await siteData('studio-data.json').catch(() => []);
  const index = await siteData('search-index.json').catch(() => []);

  S = {
    collection, slug, data: {}, body: '', keys: [], gap: true, eol: true, sha: null, images: [], dirty: false,
    auto: { headline: !slug, title: !slug, description: !slug }, template: null,
    programs: [...new Set(studioData.filter(d => d.collection === collection && d.program_name).map(d => d.program_name))].sort(),
    series: studioData.filter(d => d.collection === 'nostalgia_series'),
    tagSuggestions: [...new Set(studioData.flatMap(d => d.tags || []).concat(index.slice(0, 400).flatMap(i => i.tags || [])))].slice(0, 400),
    url: null,
  };

  if (slug) {
    const file = await content.get(collection, slug);
    const p = parseFile(file.content);
    Object.assign(S, { data: p.data, body: p.body, keys: p.keys, gap: p.gap, eol: p.eol, sha: file.sha });
    const known = studioData.find(d => d.collection === collection && d.slug === slug) || index.find(i => String(i.inputPath || '').endsWith(`/${slug}.md`));
    S.url = known ? known.url : null;
  } else {
    S.data = JSON.parse(JSON.stringify(def.defaults || {}));
    if (collection !== 'nostalgia_series') S.data.date = isoLocal();
    if (from) {
      // «التالي»: a new episode with the same programme data
      const src = studioData.find(d => d.collection === collection && d.slug === from);
      if (src) applyTemplate(src, { keepTitle: false });
    }
    const draft = loadDraft(collection);
    if (draft && !from) {
      const ok = await dialog({ title: 'في مسودة محفوظة', body: `لقيت ${def.singular} كنت بتكتبه ومحفظتوش (${timeAgo(draft.at)}). تحب تكمل فيه؟`, confirm: 'كمّل المسودة', cancel: 'ابدأ من جديد' });
      if (ok) { S.data = draft.data; S.body = draft.body || ''; S.dirty = true; } else clearDraft(collection);
    }
  }

  const sections = SECTIONS[collection];
  const isNew = !slug;
  // What this account may do here (the server checks the same thing on every save)
  const me = getUser(), sec = sectionOf(collection);
  const mayCreate = can(me, `${sec}.create`), mayDelete = can(me, `${sec}.delete`);
  const maySave = isNew ? mayCreate : can(me, `${sec}.edit`);
  S.maySave = maySave; // bindAll() runs outside this function and needs it too
  mount(page, html`
    <div class="editor">
      <header class="editor-head">
        <a href="#/list/${collection}" class="back">${icon('arrowRight')} ${def.label}</a>
        <div class="editor-title"><h1 id="ed-title">${S.data.headline || S.data.title || `${def.singular} جديد`}</h1>
          <span class="status" id="ed-status"></span></div>
        <div class="editor-actions">
          ${S.url ? html`<a class="btn btn-ghost" href="${S.url}" target="_blank">${icon('eye')}<span class="hide-sm">على الموقع</span></a>` : ''}
          <div class="menu" id="more-menu"><button class="icon-btn" type="button" aria-label="المزيد">⋯</button>
            <div class="menu-pop" hidden>
              ${!isNew && mayCreate && ['shows', 'recaps', 'nostalgia'].includes(collection) ? html`<a href="#/new/${collection}/${encodeURIComponent(slug)}">${icon('copy')}حلقة جديدة بنفس البيانات</a>` : ''}
              ${maySave && mayCreate ? html`<button type="button" id="save-new">${icon('plus')}حفظ وإضافة ${def.singular} جديد</button>` : ''}
              ${!isNew && mayDelete ? html`<button type="button" id="del" class="danger">${icon('trash')}حذف نهائي</button>` : ''}
            </div></div>
          ${maySave ? html`<button class="btn btn-primary btn-lg" id="save" type="button">${icon('check')} ${isNew ? 'نشر' : 'حفظ'}</button>` : html`<span class="tag">${icon('eye')} عرض بس</span>`}
        </div>
      </header>
      <nav class="sec-nav" id="sec-nav">${sections.map((s, i) => html`<a href="#sec-${s.id}" data-sec="${s.id}" class="${i === 0 ? 'on' : ''}">${icon(s.icon)}${s.title}</a>`)}</nav>
      <div class="editor-grid">
        <form class="editor-main" id="ed-form" autocomplete="off" onsubmit="return false">
          ${sections.map(s => html`<section class="card ed-sec" id="sec-${s.id}"><header class="card-head"><h2>${icon(s.icon)} ${s.title}</h2></header>
            <div class="card-body fields">${s.fields.map(f => F[f] ? F[f]() : '')}</div></section>`)}
        </form>
        <aside class="editor-side">
          <div class="card preview-card" id="preview"></div>
          <div class="card"><header class="card-head"><h2>${icon('check')} قبل النشر</h2></header><div class="card-body" id="checks"></div></div>
          ${IS_LOCAL ? html`<div class="note">${icon('shield')} النسخة التجريبية: الحفظ بيكتب على ملفات جهازك بس.</div>` : ''}
          <div class="note muted small">${icon('clock')} بعد الحفظ الموقع بيتحدّث لوحده في حوالي دقيقتين، واللوحة بتقولك أول ما يظهر. النشر على المنصات بيحصل تلقائي زي دلوقتي.</div>
        </aside>
      </div>
    </div>`);

  bindAll();
  refreshSide();
  // Focus the first field on a computer only (on a phone it would pop the keyboard over the page)
  if (isNew && matchMedia('(min-width: 900px)').matches && $('#f-title')) setTimeout(() => ($('#f-program') || $('#f-title')).focus(), 50);
}

// ── Template («املأ من آخر حلقة» / «التالي») ───────────────────────────────
function applyTemplate(src, { keepTitle = true } = {}) {
  // Not the description: it names that episode («عرض بروجرس ذا اوديسي تور برمنجهام…» landed on
  // Chapter 198 — INCIDENTS #123). It follows the new headline instead.
  for (const k of ['federation', 'program_name', 'show_type', 'is_annual', 'season_number', 'nostalgia_series', 'series_type']) {
    if (src[k] !== undefined && src[k] !== '' && src[k] !== false && src[k] !== null) S.data[k] = src[k];
  }
  S.data.description = ''; S.auto.description = true;
  if (src.collection === 'nostalgia' && src.nostalgia_order) S.data.nostalgia_order = Number(src.nostalgia_order) + 1;
  // Year-specific tags («AEW All Out 2026») belong to that edition only
  if (Array.isArray(src.tags) && src.tags.length) S.data.tags = src.tags.filter(tg => !/(?:^|\D)(?:19|20)\d{2}(?:\D|$)/.test(tg));
  S.template = { headline: src.headline, title: src.title, program: src.program_name, tags: [...(S.data.tags || [])] };
  S.auto.headline = true; S.auto.title = !keepTitle || !S.data.title;
  updateFromDate();
}
/** The event date drives the headline and title while they still follow the template. */
function updateFromDate() {
  const ev = S.data.event_date;
  if (!S.template || !ev) return;
  if (S.auto.headline) { const h = nextHeadline(S.template.headline, ev); if (h) S.data.headline = h; }
  if (S.auto.title) { const t = nextHeadline(S.template.title, ev); if (t) S.data.title = t; }
  if (S.auto.description && S.data.headline) S.data.description = descriptionFromHeadline(S.data.headline);
}

// ── Binding ────────────────────────────────────────────────────────────────
function markDirty() {
  S.dirty = true;
  if (!S.slug) saveDraft();
  refreshSide();
}
function setVal(id, v) { const el = $(id); if (el && el.value !== v) el.value = v || ''; }

function bindAll() {
  const form = $('#ed-form');
  // Plain inputs
  form.addEventListener('input', (e) => {
    const el = e.target;
    const k = el.dataset.k;
    if (!k) return;
    let v = el.dataset.type === 'bool' ? el.checked : el.value;
    if (el.dataset.type === 'int') v = el.value === '' ? undefined : parseInt(el.value, 10);
    if (v === '' && !S.keys.includes(k)) v = undefined;
    if (k === 'headline') S.auto.headline = false;
    if (k === 'title') { S.auto.title = false; }
    if (k === 'description') S.auto.description = false;
    if (k === 'duration') v = formatDuration(v);
    S.data[k] = v;
    if (k === 'event_date') { updateFromDate(); setVal('#f-headline', S.data.headline); setVal('#f-title', S.data.title); setVal('#f-desc', S.data.description); }
    // The episode code in both titles follows the season/episode fields (INCIDENTS #166)
    if (k === 'episode_number' || k === 'season_number') {
      S.data.title = syncEpisodeCode(S.data.title, S.data.season_number, S.data.episode_number);
      S.data.headline = syncEpisodeCode(S.data.headline, S.data.season_number, S.data.episode_number);
      if (S.auto.description && S.data.headline) S.data.description = descriptionFromHeadline(S.data.headline);
      setVal('#f-title', S.data.title); setVal('#f-headline', S.data.headline); setVal('#f-desc', S.data.description);
    }
    // Until the description is typed by hand it follows the Arabic headline
    if (k === 'headline' && S.auto.description) { S.data.description = descriptionFromHeadline(v); setVal('#f-desc', S.data.description); }
    if (k === 'maintenance') $('#mnote') && $('#mnote').classList.toggle('hidden', !v);
    if (/^downloads_/.test(k)) { const c = $(`#cnt-${k}`); if (c) c.textContent = `${textToLines(v).length} رابط`; }
    if (k === 'title' && S.collection === 'news') titleHint();
    markDirty();
  });
  form.addEventListener('change', (e) => { if (e.target.dataset.type === 'bool') e.target.dispatchEvent(new Event('input', { bubbles: true })); });
  const dur = $('#f-duration');
  if (dur) dur.addEventListener('blur', () => { dur.value = S.data.duration || ''; });

  // Segmented choices
  $$('[data-seg]', form).forEach(seg => seg.addEventListener('click', (e) => {
    const b = e.target.closest('button[data-v]');
    if (!b) return;
    S.data[seg.dataset.seg] = b.dataset.v;
    $$('button', seg).forEach(x => x.classList.toggle('on', x === b));
    markDirty();
  }));

  bindHelpers();
  bindServers(); bindDownloads(); bindImage(); bindTags(); bindDate(); bindBody();
  if (S.collection === 'news') titleHint();

  // Section nav highlight
  const obs = new IntersectionObserver((entries) => {
    for (const en of entries) if (en.isIntersecting) $$('#sec-nav a').forEach(a => a.classList.toggle('on', a.dataset.sec === en.target.id.replace('sec-', '')));
  }, { rootMargin: '-40% 0px -55% 0px' });
  $$('.ed-sec').forEach(s => obs.observe(s));
  $$('#sec-nav a').forEach(a => a.onclick = (e) => { e.preventDefault(); $(`#sec-${a.dataset.sec}`).scrollIntoView({ behavior: 'smooth', block: 'start' }); });

  // Actions
  if (S.maySave) $('#save').onclick = () => save();
  else $$('#ed-form input, #ed-form textarea, #ed-form select, #ed-form button').forEach(x => { x.disabled = true; });
  const sn = $('#save-new');
  if (sn) sn.onclick = () => save({ thenNew: true });
  const del = $('#del');
  if (del) del.onclick = () => remove();
  $$('.menu', $('.editor-head')).forEach(m => {
    const btn = m.querySelector('button'), pop = m.querySelector('.menu-pop');
    btn.addEventListener('click', (e) => { e.stopPropagation(); pop.hidden = !pop.hidden; });
  });
  document.onkeydown = (e) => {
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 's' && S) { e.preventDefault(); if (S.maySave) save(); }
  };
}

function bindHelpers() {
  // Programme → fill from the last episode
  const fill = $('#fill-last');
  if (fill) fill.onclick = async () => {
    const prog = S.data.program_name;
    const all = await siteData('studio-data.json');
    const last = all.filter(d => d.collection === S.collection && (!prog || d.program_name === prog)).sort((a, b) => Date.parse(b.date) - Date.parse(a.date))[0];
    if (!last) return toast(prog ? 'مفيش حلقات سابقة للبرنامج ده.' : 'اكتب اسم البرنامج الأول.', 'error');
    applyTemplate(last, { keepTitle: false });
    rerenderSection('basics'); rerenderSection('cover');
    toast(`اتملت البيانات من «${last.headline || last.title}». اختار تاريخ العرض والعنوان هيتظبط لوحده.`, 'ok', 5000);
    markDirty();
  };
  const sh = $('#suggest-headline');
  if (sh) sh.onclick = async () => {
    if (!S.template) {
      const all = await siteData('studio-data.json');
      const last = all.filter(d => d.collection === S.collection && (!S.data.program_name || d.program_name === S.data.program_name) && d.headline).sort((a, b) => Date.parse(b.date) - Date.parse(a.date))[0];
      if (last) S.template = { headline: last.headline, title: last.title };
    }
    const h = S.template && nextHeadline(S.template.headline, S.data.event_date || dateOnly());
    if (!h) return toast('اختار البرنامج وتاريخ العرض الأول عشان أقدر أقترح.', 'error');
    S.data.headline = h; S.auto.headline = true; setVal('#f-headline', h); markDirty();
  };
  const sd = $('#suggest-desc');
  if (sd) sd.onclick = () => {
    const d = descriptionFromHeadline(S.data.headline || S.data.title);
    if (!d) return toast('اكتب العنوان العربي الأول.', 'error');
    S.data.description = d; setVal('#f-desc', d); markDirty();
  };

}

function rerenderSection(id) {
  const sec = SECTIONS[S.collection].find(s => s.id === id);
  const el = $(`#sec-${id} .fields`);
  if (!sec || !el) return;
  mount(el, html`${sec.fields.map(f => F[f] ? F[f]() : '')}`);
  // Re-bind the widgets that live in this section
  const form = $('#ed-form');
  $$('[data-seg]', el).forEach(seg => seg.addEventListener('click', (e) => {
    const b = e.target.closest('button[data-v]'); if (!b) return;
    S.data[seg.dataset.seg] = b.dataset.v; $$('button', seg).forEach(x => x.classList.toggle('on', x === b)); markDirty();
  }));
  bindHelpers();
  bindServers(); bindDownloads(); bindImage(); bindTags(); bindDate(); bindBody();
  refreshSide();
}

function formatDuration(v) {
  const d = String(v || '').replace(/[^\d:]/g, '');
  if (/^\d{5,6}$/.test(d)) { const p = d.padStart(6, '0'); return `${p.slice(0, 2)}:${p.slice(2, 4)}:${p.slice(4, 6)}`; }
  return d;
}

function titleHint() {
  const el = $('#title-hint'); if (!el) return;
  const t = String(S.data.title || '');
  const warn = [];
  if (t.length > 110) warn.push('العنوان طويل — الأفضل أقل من ١١٠ حرف');
  if (/(^|\s)([3-9]|10)\s+[؀-ۿ]/.test(t)) warn.push('اكتب الأعداد بالحروف (ثلاثة أمور مش 3 أمور) عشان متتعكسش');
  el.textContent = warn.length ? `⚠️ ${warn.join(' · ')}` : `${t.length} حرف`;
  el.classList.toggle('warn', !!warn.length);
}

// Servers
function bindServers() {
  const box = $('#servers'); if (!box) return;
  const redraw = () => { mount(box, html`${(S.data.servers || []).map((s, i) => serverRow(s.url, i))}`); const l = $('#sec-watch .list-head em'); if (l) l.textContent = `${(S.data.servers || []).length} سيرفر`; markDirty(); };
  box.oninput = (e) => { const i = e.target.dataset.srv; if (i == null) return; S.data.servers[i] = { url: e.target.value.trim() }; e.target.previousElementSibling.textContent = hostName(e.target.value); markDirty(); };
  box.onclick = (e) => {
    const b = e.target.closest('button'); if (!b) return;
    const list = S.data.servers || [];
    if (b.dataset.rmSrv != null) list.splice(+b.dataset.rmSrv, 1);
    else if (b.dataset.up != null && +b.dataset.up > 0) { const i = +b.dataset.up; [list[i - 1], list[i]] = [list[i], list[i - 1]]; }
    else if (b.dataset.down != null && +b.dataset.down < list.length - 1) { const i = +b.dataset.down; [list[i + 1], list[i]] = [list[i], list[i + 1]]; }
    else return;
    S.data.servers = list; redraw();
  };
  const paste = $('#servers-paste');
  if (!paste) return;
  // Added on paste, Enter or leaving the box — never while a link is still being typed
  const take = () => {
    const urls = extractUrls(paste.value);
    if (!urls.length) return;
    const have = new Set((S.data.servers || []).map(s => s.url));
    const added = urls.filter(u => !have.has(u));
    S.data.servers = [...(S.data.servers || []), ...added.map(url => ({ url }))];
    paste.value = '';
    redraw();
    toast(added.length ? `اتضاف ${added.length} سيرفر` : 'الروابط دي موجودة بالفعل', added.length ? 'ok' : 'info', 2200);
  };
  paste.onpaste = () => setTimeout(take, 0);
  paste.onblur = take;
  paste.onkeydown = (e) => { if (e.key === 'Enter') { e.preventDefault(); take(); } };
}

// Downloads
function bindDownloads() {
  const apply = $('#dl-apply'); if (!apply) return;
  let fallback = 'downloads_medium';
  $$('#dl-default button').forEach(b => b.onclick = () => { fallback = b.dataset.v; $$('#dl-default button').forEach(x => x.classList.toggle('on', x === b)); });
  apply.onclick = () => {
    const text = $('#dl-paste').value;
    const split = splitDownloadsByQuality(text, fallback);
    let total = 0;
    for (const [k, urls] of Object.entries(split)) {
      if (!urls.length) continue;
      const cur = textToLines(S.data[k]);
      const merged = [...cur, ...urls.filter(u => !cur.includes(u))];
      total += merged.length - cur.length;
      S.data[k] = merged.join('\n');
      setVal(`#f-${k}`, S.data[k]);
      $(`#cnt-${k}`).textContent = `${merged.length} رابط`;
    }
    $('#dl-paste').value = '';
    toast(total ? `اتوزّع ${total} رابط على الجودات` : 'مفيش روابط جديدة', total ? 'ok' : 'info');
    markDirty();
  };
}

// Cover image
function bindImage() {
  const drop = $('#drop'); if (!drop) return;
  const file = $('#img-file');
  const take = async (f) => {
    try {
      drop.classList.add('busy');
      const img = typeof f === 'string' ? await prepareImageFromUrl(f) : await prepareImage(f);
      S.images = [img];
      S.data.image = img.publicPath;
      rerenderSection(SECTIONS[S.collection].find(s => s.fields.includes('image')).id);
      toast(`الصورة اتجهزت (${kb(img.bytes)})`);
      markDirty();
    } catch (e) { toast(e.message, 'error'); } finally { drop.classList.remove('busy'); }
  };
  drop.onclick = (e) => { if (e.target.closest('#img-url')) return; file.click(); };
  file.onchange = () => file.files[0] && take(file.files[0]);
  drop.ondragover = (e) => { e.preventDefault(); drop.classList.add('over'); };
  drop.ondragleave = () => drop.classList.remove('over');
  drop.ondrop = (e) => { e.preventDefault(); drop.classList.remove('over'); const f = e.dataTransfer.files[0]; if (f) take(f); };
  $('#img-url').onclick = async (e) => {
    e.stopPropagation();
    const link = await dialog({ title: 'صورة من رابط', body: 'الصق رابط الصورة:', confirm: 'استخدم الرابط', input: { placeholder: 'https://…' } });
    if (link) take(link.trim());
  };
  document.onpaste = (e) => {
    if (!S || !$('#drop')) return;
    const item = [...(e.clipboardData?.items || [])].find(i => i.type.startsWith('image/'));
    if (item) { e.preventDefault(); take(item.getAsFile()); }
  };
}

// Tags
function bindTags() {
  const box = $('#tags'); if (!box) return;
  const input = $('#tag-input');
  const add = (t) => {
    const tags = S.data.tags || [];
    for (const one of String(t).split(/[,،]/).map(s => s.trim()).filter(Boolean)) if (!tags.includes(one)) tags.push(one);
    S.data.tags = tags; redraw();
  };
  const redraw = () => {
    $$('.tagchip', box).forEach(c => c.remove());
    (S.data.tags || []).forEach((t, i) => input.insertAdjacentHTML('beforebegin', `<span class="tagchip">${esc(t)}<button type="button" data-rm="${i}" aria-label="حذف">${icon('x').__raw}</button></span>`));
    input.placeholder = (S.data.tags || []).length ? '' : 'مثال: WWE, رومان رينز';
    markDirty();
  };
  input.onkeydown = (e) => {
    if ((e.key === 'Enter' || e.key === ',' || e.key === '،') && input.value.trim()) { e.preventDefault(); add(input.value); input.value = ''; }
    else if (e.key === 'Backspace' && !input.value && (S.data.tags || []).length) { S.data.tags.pop(); redraw(); }
  };
  input.onchange = () => { if (input.value.trim()) { add(input.value); input.value = ''; } };
  box.onclick = (e) => { const b = e.target.closest('[data-rm]'); if (b) { S.data.tags.splice(+b.dataset.rm, 1); redraw(); } else input.focus(); };
}

// Publish date / scheduling
function bindDate() {
  const d = $('#f-date'); if (!d) return;
  const hint = () => {
    const t = new Date(d.value);
    const h = $('#date-hint');
    if (!h) return;
    if (t > new Date(Date.now() + 60000)) { h.innerHTML = `${icon('clock').__raw} مجدول: هيظهر على الموقع ${esc(fmtDate(t, true))}`; h.className = 'hint sched'; }
    else { h.textContent = ''; h.className = 'hint'; }
  };
  d.oninput = () => { const t = new Date(d.value); if (!isNaN(t)) { S.data.date = isoLocal(t); hint(); markDirty(); } };
  $('#date-now').onclick = () => { const n = new Date(); d.value = new Date(n.getTime() - n.getTimezoneOffset() * 60000).toISOString().slice(0, 16); d.dispatchEvent(new Event('input')); };
  hint();
}

// Markdown body
function bindBody() {
  const ta = $('#f-body'); if (!ta) return;
  const count = () => { const c = $('#body-count'); if (c) c.textContent = `${ta.value.trim().split(/\s+/).filter(Boolean).length} كلمة`; };
  ta.oninput = () => { S.body = ta.value; count(); markDirty(); };
  count();
  const wrap = (before, after = before, ph = '') => {
    const s = ta.selectionStart, e = ta.selectionEnd;
    const sel = ta.value.slice(s, e) || ph;
    ta.setRangeText(before + sel + after, s, e, 'end');
    ta.focus(); ta.dispatchEvent(new Event('input'));
  };
  const linePrefix = (p) => {
    const s = ta.selectionStart;
    const start = ta.value.lastIndexOf('\n', s - 1) + 1;
    ta.setRangeText(p, start, start, 'end'); ta.focus(); ta.dispatchEvent(new Event('input'));
  };
  $$('[data-md]').forEach(b => b.onclick = async () => {
    const a = b.dataset.md;
    if (a === 'bold') wrap('**', '**', 'نص عريض');
    else if (a === 'h') linePrefix('**'), wrap('', '**');
    else if (a === 'list') linePrefix('- ');
    else if (a === 'quote') linePrefix('> ');
    else if (a === 'link') { const u = await dialog({ title: 'إضافة رابط', body: 'الصق الرابط:', input: { placeholder: 'https://…' }, confirm: 'إضافة' }); if (u) wrap('[', `](${u.trim()})`, 'النص'); }
    else if (a === 'embed') { const u = await dialog({ title: 'فيديو أو تغريدة', body: 'الصق رابط يوتيوب أو إكس — هيتعرض جوه الخبر:', input: { placeholder: 'https://…' }, confirm: 'إضافة' }); if (u) { ta.setRangeText(`\n\n${u.trim()}\n`, ta.selectionEnd, ta.selectionEnd, 'end'); ta.dispatchEvent(new Event('input')); } }
  });
  $$('#md-mode button').forEach(b => b.onclick = () => {
    const prev = b.dataset.v === 'preview';
    $$('#md-mode button').forEach(x => x.classList.toggle('on', x === b));
    ta.hidden = prev;
    const pv = $('#md-preview');
    pv.hidden = !prev;
    if (prev) pv.innerHTML = marked.parse(ta.value.replace(/^(https?:\/\/\S+)$/gm, '<p class="embed-ph">🎬 $1</p>'));
  });
}

// ── Side panel ─────────────────────────────────────────────────────────────
function refreshSide() {
  if (!S) return;
  const def = COLLECTIONS[S.collection];
  const t = $('#ed-title'); if (t) t.textContent = S.data.headline || S.data.title || `${def.singular} جديد`;
  const st = $('#ed-status');
  if (st) {
    const future = toDate(S.data.date) > new Date();
    st.className = `status ${S.dirty ? 'st-dirty' : !S.slug ? 'st-new' : future ? 'st-sched' : 'st-live'}`;
    st.textContent = S.dirty ? 'تعديلات لم تحفظ' : !S.slug ? 'جديد' : future ? 'مجدول' : 'منشور';
  }
  const pv = $('#preview');
  if (pv) mount(pv, html`<div class="pv-img">${coverSrc() ? html`<img src="${coverSrc()}" alt="">` : html`<span>${icon('image')}</span>`}
      ${S.data.federation ? html`<span class="fed">${S.data.federation}</span>` : ''}</div>
    <div class="pv-body"><small class="muted">معاينة على الموقع</small><b>${S.data.headline || S.data.title || 'العنوان هيظهر هنا'}</b>
      ${S.data.headline && S.data.title ? html`<small class="muted" dir="auto">${S.data.title}</small>` : ''}
      ${S.data.description ? html`<p>${S.data.description}</p>` : ''}
      <div class="pv-meta">${S.data.duration ? html`<span>${icon('clock')} ${S.data.duration}</span>` : ''}${(S.data.servers || []).length ? html`<span>${icon('eye')} ${(S.data.servers || []).length} سيرفر</span>` : ''}</div></div>`);
  const ch = $('#checks');
  if (ch) {
    const list = checklist(S.collection, { ...S.data, body: S.body });
    mount(ch, html`<ul class="checks">${list.map(c => html`<li class="${c.ok ? 'ok' : c.required ? 'bad' : 'warn'}">${icon(c.ok ? 'check' : c.required ? 'x' : 'alert')}<span>${c.label}</span>${!c.ok && c.required ? html`<em>مطلوب</em>` : ''}</li>`)}</ul>`);
  }
}

// ── Drafts (new items only) ────────────────────────────────────────────────
const draftKey = (c) => `arw_draft_${c}`;
function saveDraft() { try { localStorage.setItem(draftKey(S.collection), JSON.stringify({ at: Date.now(), data: S.data, body: S.body })); } catch {} }
function loadDraft(c) { try { const d = JSON.parse(localStorage.getItem(draftKey(c)) || 'null'); return d && Date.now() - d.at < 7 * 864e5 ? d : null; } catch { return null; } }
function clearDraft(c) { try { localStorage.removeItem(draftKey(c)); } catch {} }

// ── Save / delete ──────────────────────────────────────────────────────────
function validate() {
  const def = COLLECTIONS[S.collection];
  const missing = def.required.filter(k => {
    const v = S.data[k];
    return v === undefined || v === null || v === '' || (Array.isArray(v) && !v.length);
  });
  const labels = { federation: 'الاتحاد', title: 'الاسم', headline: 'العنوان العربي', description: 'الوصف', image: 'صورة الغلاف', duration: 'مدة العرض', year: 'السنة', nostalgia_series: 'السلسلة' };
  if (S.data.duration && !/^\d{1,2}:\d{2}(:\d{2})?$/.test(String(S.data.duration))) return 'مدة العرض لازم تكون بالشكل ده: 02:37:11';
  const badServer = (S.data.servers || []).find(s => s.url && !/^https?:\/\//.test(s.url));
  if (badServer) return `رابط سيرفر غير صحيح: ${badServer.url}`;
  return missing.length ? `ناقص: ${missing.map(k => labels[k] || k).join('، ')}` : null;
}

async function save({ thenNew = false, force = false } = {}) {
  if (!S) return;
  const problem = validate();
  if (problem) { toast(problem, 'error', 5000); refreshSide(); return; }
  const btn = $('#save');
  btn.disabled = true; btn.classList.add('loading');
  const create = !S.slug;
  // Saved titles never carry another episode's code, whatever was typed (INCIDENTS #166)
  if (S.data.episode_number !== undefined && S.data.episode_number !== '') {
    for (const k of ['title', 'headline']) if (S.data[k]) S.data[k] = syncEpisodeCode(S.data[k], S.data.season_number, S.data.episode_number);
  }
  // Another programme than the one filled from: its tags go (INCIDENTS #192)
  if (S.template && S.data.tags) S.data.tags = dropStaleTemplateTags(S.data.tags, S.template, S.data);
  const slug = S.slug || newFileSlug(S.collection, S.data);
  // Servers: drop empty rows
  if (Array.isArray(S.data.servers)) S.data.servers = S.data.servers.filter(s => s && s.url);
  const text = serializeFile(S.collection, S.data, S.body, S.keys, S.gap, S.eol);
  try {
    const r = await content.save({ collection: S.collection, slug, content: text, sha: S.sha, create, images: S.images.map(i => ({ path: i.path, base64: i.base64 })), force });
    S.sha = r.sha || S.sha;
    for (const i of S.images) localPreviews[i.publicPath] = i.previewUrl;
    S.images = [];
    S.dirty = false;
    addPending({ collection: S.collection, slug, title: S.data.headline || S.data.title, image: S.data.image, federation: S.data.federation });
    trackLive({ commit: r.commit, committedAt: r.committedAt, title: S.data.headline || S.data.title || slug, slug });
    notify({ type: create ? 'create' : 'edit', collection: S.collection, slug, title: S.data.headline || S.data.title || slug, commit: r.commit });
    if (create) clearDraft(S.collection);
    toast(IS_LOCAL ? 'اتحفظ ✓' : create ? 'اتنشر ✓ بيتجهز على الموقع دلوقتي، وهقولك أول ما يظهر.' : 'اتحفظ ✓ التعديل بيتجهز على الموقع، وهقولك أول ما يظهر.', 'ok', 5000);
    if (thenNew) { location.hash = `#/new/${S.collection}`; return; }
    if (create) {
      // Reopen as an existing item (delete, «حلقة جديدة بنفس البيانات», …)
      history.replaceState(null, '', `#/edit/${S.collection}/${encodeURIComponent(slug)}`);
      return renderEditor(document.getElementById('page'), S.collection, slug);
    }
    refreshSide();
  } catch (e) {
    if (e.status === 409 && e.data && e.data.conflict) {
      const choice = await dialog({
        title: 'الموضوع اتعدّل من مكان تاني',
        body: 'بعد ما فتحته، اتعدّل (غالبا تصحيح تلقائي من نظام الأخبار). تحب تحفظ نسختك فوقه، ولا تفتح النسخة الجديدة؟',
        confirm: 'احفظ نسختي', cancel: 'افتح الجديدة', danger: true,
      });
      if (choice) return save({ thenNew, force: true });
      S.dirty = false;
      location.reload();
      return;
    }
    toast(e.message, 'error', 6000);
    notify({ type: 'error', title: `تعذّر حفظ ${COLLECTIONS[S.collection].singular} «${S.data.headline || S.data.title || slug}»`, detail: e.message, collection: create ? '' : S.collection, slug: create ? '' : slug });
  } finally { btn.disabled = false; btn.classList.remove('loading'); }
}

async function remove() {
  const def = COLLECTIONS[S.collection];
  const ok = await dialog({
    title: `حذف ${def.singular} نهائيا`,
    body: html`<p>«${S.data.headline || S.data.title}» هيتشال من الموقع.</p><p class="muted small">للتأكيد اكتب كلمة <b>حذف</b>:</p>`,
    confirm: 'حذف نهائي', danger: true, input: { placeholder: 'حذف', match: 'حذف' },
  });
  if (!ok) return;
  try {
    const r = await content.remove(S.collection, S.slug);
    trackLive({ commit: r.commit, committedAt: r.committedAt, title: S.data.headline || S.data.title || S.slug, slug: S.slug, removed: true });
    notify({ type: 'delete', collection: S.collection, slug: S.slug, title: S.data.headline || S.data.title || S.slug, commit: r.commit });
    S.dirty = false;
    toast('اتحذف. هقولك أول ما يختفي من الموقع.');
    location.hash = `#/list/${S.collection}`;
  } catch (e) { toast(e.message, 'error'); }
}
