// Small DOM helpers, icons, toasts and dialogs for the studio.

export function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
/** html`...` — escapes interpolated values unless wrapped with raw(). */
export function raw(s) { return { __raw: String(s) }; }
export function html(strings, ...values) {
  let out = '';
  strings.forEach((s, i) => {
    out += s;
    if (i < values.length) {
      const v = values[i];
      if (v == null || v === false) return;
      if (Array.isArray(v)) out += v.map(x => (x && x.__raw != null ? x.__raw : esc(x))).join('');
      else out += v && v.__raw != null ? v.__raw : esc(v);
    }
  });
  return raw(out);
}
// A page that finished loading after the user moved on has nothing to fill: skip quietly.
export function mount(el, content) { if (!el) return el; el.innerHTML = content && content.__raw != null ? content.__raw : String(content || ''); return el; }
export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

const P = (d) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;
export const ICONS = {
  home: P('<path d="m3 11 9-7 9 7"/><path d="M5 10v10h14V10"/>'),
  show: P('<rect x="2" y="5" width="20" height="14" rx="3"/><path d="M10 9.5v5l4.5-2.5z" fill="currentColor"/>'),
  news: P('<path d="M4 5h13a2 2 0 0 1 2 2v12H6a2 2 0 0 1-2-2z"/><path d="M19 9h1a1 1 0 0 1 1 1v8a1 1 0 0 1-2 0"/><path d="M8 9h7M8 13h7M8 17h4"/>'),
  recap: P('<path d="M13 2 4 14h7l-1 8 9-12h-7z"/>'),
  nostalgia: P('<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>'),
  folder: P('<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>'),
  plus: P('<path d="M12 5v14M5 12h14"/>'),
  search: P('<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>'),
  edit: P('<path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/>'),
  eye: P('<path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>'),
  eyeOff: P('<path d="M3 3l18 18"/><path d="M10.6 5.1A10.8 10.8 0 0 1 12 5c6.5 0 10 7 10 7a17.6 17.6 0 0 1-3.1 4.1M6.6 6.6C3.9 8.4 2 12 2 12s3.5 7 10 7a9.7 9.7 0 0 0 5.4-1.6"/><path d="M9.9 9.9a3 3 0 0 0 4.2 4.2"/>'),
  trash: P('<path d="M3 6h18"/><path d="M8 6V4h8v2"/><path d="M6 6l1 14h10l1-14"/>'),
  copy: P('<rect x="9" y="9" width="12" height="12" rx="2"/><path d="M5 15V5a2 2 0 0 1 2-2h10"/>'),
  check: P('<path d="m5 12 5 5L20 7"/>'),
  bell: P('<path d="M6 8a6 6 0 1 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.9 1.9 0 0 0 3.4 0"/>'),
  x: P('<path d="M18 6 6 18M6 6l12 12"/>'),
  alert: P('<path d="M12 9v4M12 17h.01"/><path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z"/>'),
  image: P('<rect x="3" y="3" width="18" height="18" rx="3"/><circle cx="9" cy="9" r="2"/><path d="m21 15-5-5L5 21"/>'),
  upload: P('<path d="M12 16V4M7 9l5-5 5 5"/><path d="M4 16v3a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-3"/>'),
  link: P('<path d="M10 13a5 5 0 0 0 7.5.5l3-3a5 5 0 0 0-7-7l-1.7 1.7"/><path d="M14 11a5 5 0 0 0-7.5-.5l-3 3a5 5 0 0 0 7 7l1.7-1.7"/>'),
  tools: P('<rect x="3" y="3" width="7" height="7" rx="2"/><rect x="14" y="3" width="7" height="7" rx="2"/><rect x="3" y="14" width="7" height="7" rx="2"/><rect x="14" y="14" width="7" height="7" rx="2"/>'),
  settings: P('<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 0 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 0 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 0 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 0 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/>'),
  logout: P('<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><path d="m16 17 5-5-5-5M21 12H9"/>'),
  moon: P('<path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"/>'),
  sun: P('<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>'),
  menu: P('<path d="M4 6h16M4 12h16M4 18h16"/>'),
  send: P('<path d="m22 2-7 20-4-9-9-4z"/><path d="M22 2 11 13"/>'),
  bolt: P('<path d="M13 2 4 14h7l-1 8 9-12h-7z"/>'),
  pin: P('<path d="M12 17v5"/><path d="M9 3h6l-1 7 4 3v2H6v-2l4-3z"/>'),
  film: P('<rect x="3" y="3" width="18" height="18" rx="2"/><path d="M7 3v18M17 3v18M3 8h4M3 16h4M17 8h4M17 16h4"/>'),
  globe: P('<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18"/>'),
  clock: P('<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>'),
  shield: P('<path d="M12 3 4 6v6c0 5 3.5 8 8 9 4.5-1 8-4 8-9V6z"/>'),
  lock: P('<rect x="4" y="11" width="16" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/>'),
  user: P('<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/>'),
  arrowLeft: P('<path d="M19 12H5M11 18l-6-6 6-6"/>'),
  arrowRight: P('<path d="M5 12h14M13 6l6 6-6 6"/>'),
  grip: P('<circle cx="9" cy="6" r="1"/><circle cx="15" cy="6" r="1"/><circle cx="9" cy="12" r="1"/><circle cx="15" cy="12" r="1"/><circle cx="9" cy="18" r="1"/><circle cx="15" cy="18" r="1"/>'),
  wand: P('<path d="m15 4 5 5L9 20H4v-5z"/><path d="M13 6l5 5"/>'),
  chart: P('<path d="M3 3v18h18"/><path d="m7 15 4-4 3 3 5-6"/>'),
  telegram: P('<path d="m21 4-18 7 6 2 2 6 3-4 5 4z"/>'),
  facebook: P('<path d="M15 3h-3a4 4 0 0 0-4 4v3H5v4h3v7h4v-7h3l1-4h-4V7a1 1 0 0 1 1-1h3z"/>'),
  instagram: P('<rect x="3" y="3" width="18" height="18" rx="5"/><circle cx="12" cy="12" r="4"/><circle cx="17.5" cy="6.5" r=".8" fill="currentColor"/>'),
  refresh: P('<path d="M21 12a9 9 0 1 1-2.6-6.4L21 8"/><path d="M21 3v5h-5"/>'),
};
export const icon = (name) => raw(ICONS[name] || '');

// ── Toasts ────────────────────────────────────────────────────────────────
export function toast(message, kind = 'ok', ms = 3800) {
  let box = document.getElementById('toasts');
  if (!box) { box = document.createElement('div'); box.id = 'toasts'; document.body.appendChild(box); }
  const t = document.createElement('div');
  t.className = `toast toast-${kind}`;
  t.innerHTML = `<span class="toast-ico">${ICONS[kind === 'error' ? 'alert' : kind === 'info' ? 'clock' : 'check']}</span><span>${esc(message)}</span>`;
  box.appendChild(t);
  requestAnimationFrame(() => t.classList.add('in'));
  setTimeout(() => { t.classList.remove('in'); setTimeout(() => t.remove(), 300); }, ms);
}

// ── Dialogs ───────────────────────────────────────────────────────────────
export function dialog({ title, body = '', confirm = 'تأكيد', cancel = 'إلغاء', danger = false, input = null }) {
  return new Promise(resolve => {
    const wrap = document.createElement('div');
    wrap.className = 'modal-wrap';
    wrap.innerHTML = `<div class="modal" role="dialog" aria-modal="true">
      <h3>${esc(title)}</h3>
      <div class="modal-body">${body && body.__raw != null ? body.__raw : esc(body)}</div>
      ${input ? `<input class="input" id="modal-input" placeholder="${esc(input.placeholder || '')}" autocomplete="off">` : ''}
      <div class="modal-actions">
        <button class="btn ${danger ? 'btn-danger' : 'btn-primary'}" data-ok>${esc(confirm)}</button>
        ${cancel ? `<button class="btn btn-ghost" data-cancel>${esc(cancel)}</button>` : ''}
      </div></div>`;
    document.body.appendChild(wrap);
    requestAnimationFrame(() => wrap.classList.add('in'));
    const inp = wrap.querySelector('#modal-input');
    const okBtn = wrap.querySelector('[data-ok]');
    if (inp && input.match) {
      okBtn.disabled = true;
      inp.addEventListener('input', () => { okBtn.disabled = inp.value.trim() !== input.match; });
    }
    const close = (v) => { wrap.classList.remove('in'); setTimeout(() => wrap.remove(), 200); resolve(v); };
    okBtn.onclick = () => close(inp ? inp.value : true);
    const c = wrap.querySelector('[data-cancel]');
    if (c) c.onclick = () => close(false);
    wrap.addEventListener('click', e => { if (e.target === wrap) close(false); });
    document.addEventListener('keydown', function onKey(e) { if (e.key === 'Escape') { document.removeEventListener('keydown', onKey); close(false); } });
    (inp || okBtn).focus();
  });
}

// ── Formatting ────────────────────────────────────────────────────────────
export function timeAgo(v) {
  const t = v instanceof Date ? v.getTime() : typeof v === 'number' ? v : Date.parse(v);
  if (!t) return '';
  const diff = Date.now() - t;
  if (diff < 0) {
    const m = Math.round(-diff / 60000);
    if (m < 60) return `بعد ${m} دقيقة`;
    const h = Math.round(m / 60);
    return h < 24 ? `بعد ${h} ساعة` : `يوم ${fmtDate(t)}`;
  }
  const min = Math.round(diff / 60000);
  if (min < 1) return 'الآن';
  if (min < 60) return `منذ ${min} دقيقة`;
  const h = Math.round(min / 60);
  if (h < 24) return `منذ ${h} ساعة`;
  const d = Math.round(h / 24);
  if (d < 30) return d === 1 ? 'منذ يوم' : `منذ ${d} أيام`;
  return fmtDate(t);
}
export function fmtDate(v, withTime = false) {
  const d = v instanceof Date ? v : new Date(v);
  if (isNaN(d)) return '';
  return d.toLocaleDateString('ar-EG-u-nu-latn', { day: 'numeric', month: 'long', year: 'numeric', ...(withTime ? { hour: 'numeric', minute: '2-digit' } : {}) });
}
export const num = (n) => Number(n || 0).toLocaleString('en-US');
export function debounce(fn, ms = 250) { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; }
export function normalizeArabic(t) {
  return String(t || '').toLowerCase().replace(/[ً-ٰٟ]/g, '').replace(/[إأآا]/g, 'ا').replace(/ة/g, 'ه').replace(/ى/g, 'ي').trim();
}

/** The account circle: the picture if there is one, else the first letter of the name. */
export function avatarInner(user) {
  if (user && user.avatar) return raw(`<img src="${esc(user.avatar)}" alt="">`);
  return ((user && (user.displayName || user.username)) || 'م')[0].toUpperCase();
}

/** Client-side mirror of the server's permission check (for hiding buttons; the server decides). */
export function can(user, perm) {
  return !!user && (user.role === 'owner' || (Array.isArray(user.perms) && user.perms.includes(perm)));
}
export const sectionOf = (collection) => (collection === 'nostalgia_series' ? 'nostalgia' : collection);
