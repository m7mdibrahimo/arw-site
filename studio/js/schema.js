// Content model of the site — the same folders, file names, field names and order as
// admin/config.yml, so a file saved here is byte-for-byte what the old panel would save.
import { parse as parseYaml, stringify as stringifyYaml } from '../vendor/yaml/index.js';

export const FEDERATIONS = ['WWE', 'AEW', 'TNA', 'ROH', 'MMA', 'INDIE'];

// Field order = config.yml order (the order Decap writes keys in).
export const COLLECTIONS = {
  shows: {
    label: 'العروض', singular: 'عرض', icon: 'show', color: '#7c6cf2', folder: 'content/shows', urlBase: '/shows/',
    order: ['show_type', 'federation', 'title', 'headline', 'program_name', 'season_number', 'episode_number', 'is_annual', 'maintenance', 'maintenance_note', 'description', 'event_date', 'date', 'duration', 'tags', 'image', 'servers', 'downloads_low', 'downloads_medium', 'downloads_high', 'body', 'layout'],
    defaults: { show_type: 'عرض', layout: 'post-layout.njk' },
    required: ['federation', 'title', 'duration', 'image'],
  },
  recaps: {
    label: 'الملخصات', singular: 'ملخص', icon: 'recap', color: '#f5a524', folder: 'content/recaps', urlBase: '/recaps/',
    order: ['federation', 'title', 'program_name', 'is_annual', 'event_date', 'date', 'headline', 'description', 'tags', 'image', 'servers', 'body', 'layout'],
    defaults: { layout: 'post-layout.njk' },
    required: ['federation', 'title', 'headline', 'description', 'image'],
  },
  news: {
    label: 'الأخبار', singular: 'خبر', icon: 'news', color: '#14b8b3', folder: 'content/news', urlBase: '/news/',
    order: ['federation', 'title', 'date', 'tags', 'image', 'body', 'layout'],
    defaults: { layout: 'post-layout.njk' },
    required: ['federation', 'title', 'image'],
  },
  nostalgia: {
    label: 'حلقات النوستالجيا', singular: 'حلقة نوستالجيا', icon: 'nostalgia', color: '#38bdf8', folder: 'content/nostalgia', urlBase: '/nostalgia/',
    order: ['nostalgia_series', 'series_type', 'nostalgia_order', 'nostalgia_main', 'title', 'headline', 'tags', 'image', 'event_date', 'date', 'duration', 'servers', 'downloads_low', 'downloads_medium', 'downloads_high', 'body', 'layout'],
    defaults: { layout: 'post-layout.njk', tags: ['WWE', 'نوستالجيا'], nostalgia_order: 1 },
    required: ['nostalgia_series', 'title', 'image'],
  },
  nostalgia_series: {
    label: 'سلاسل النوستالجيا', singular: 'سلسلة', icon: 'folder', color: '#38bdf8', folder: 'content/nostalgia-series', urlBase: '/nostalgia/',
    order: ['title', 'series_type', 'federation', 'year', 'tags', 'image', 'description'],
    defaults: { series_type: 'shows', federation: 'WWE', tags: ['WWE', 'نوستالجيا'] },
    required: ['title', 'year', 'image'],
  },
};

// ── File names (same as the Decap «slug» settings) ─────────────────────────
export function slugify(text) {
  return String(text || '')
    .normalize('NFD').replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 150);
}
const pad = (n) => String(n).padStart(2, '0');
export function newFileSlug(collection, data, now = new Date()) {
  const base = slugify(data.title) || 'بدون-عنوان';
  if (collection === 'nostalgia_series') return `${now.getFullYear()}-${base}`;
  const stamp = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
  return `${stamp}-${base}`;
}

// ── Dates in the site's format ─────────────────────────────────────────────
// «2026-09-27T19:02:00.000+03:00», as the old panel writes them
export function isoLocal(d = new Date()) {
  const off = -d.getTimezoneOffset();
  const sign = off >= 0 ? '+' : '-';
  const hh = pad(Math.floor(Math.abs(off) / 60)), mm = pad(Math.abs(off) % 60);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}.000${sign}${hh}:${mm}`;
}
export function dateOnly(d = new Date()) { return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; }
export function toDate(v) {
  if (!v) return null;
  if (v instanceof Date) return v;
  const d = new Date(String(v));
  return isNaN(d) ? null : d;
}

// ── Front matter ───────────────────────────────────────────────────────────
export function parseFile(raw) {
  const text = String(raw || '').replace(/^﻿/, '');
  const m = text.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (!m) return { data: {}, body: text, keys: [], gap: true };
  // Dates stay strings (YAML 1.2), exactly as written — they are written back unchanged.
  const data = parseYaml(m[1]) || {};
  return { data, body: m[2].replace(/^\r?\n/, ''), keys: Object.keys(data), gap: /^\r?\n/.test(m[2]), eol: /\n$/.test(text) };
}

const EMPTY = (v) => v === undefined || v === null || v === '' || (Array.isArray(v) && v.length === 0);

export function serializeFile(collection, data, body, originalKeys = [], gap = true, eol = true) {
  const def = COLLECTIONS[collection];
  const out = {};
  // Keys the file already had keep their place (source_id, permalink, published_at, …).
  const keys = [...originalKeys];
  for (const k of def.order) if (k !== 'body' && !keys.includes(k)) keys.push(k);
  for (const k of Object.keys(data)) if (k !== 'body' && !keys.includes(k)) keys.push(k);
  for (const k of keys) {
    if (k === 'body') continue;
    const v = data[k];
    if (EMPTY(v) && !originalKeys.includes(k)) continue; // don't add empty optional fields
    if (v === undefined) continue;
    out[k] = v;
  }
  const yaml = stringifyYaml(out, { lineWidth: 0, minContentWidth: 0 }).trimEnd();
  const text = String(body || '').trim();
  return `---\n${yaml}\n---\n${text ? `${gap ? '\n' : ''}${text}${eol ? '\n' : ''}` : ''}`;
}

// ── Helpers for the forms ──────────────────────────────────────────────────
export function extractUrls(text) {
  const found = String(text || '').match(/https?:\/\/[^\s"'<>]+/g) || [];
  return [...new Set(found.map(u => u.replace(/[),.;]+$/, '')))];
}
/** Pasted download links split by quality: 480/720/1080 in the link, else the chosen default. */
export function splitDownloadsByQuality(text, fallback = 'downloads_medium') {
  const out = { downloads_low: [], downloads_medium: [], downloads_high: [] };
  for (const url of extractUrls(text)) {
    const u = url.toLowerCase();
    if (/(?:^|[^0-9])(?:1080p?|fhd|fullhd)(?:[^0-9]|$)/.test(u)) out.downloads_high.push(url);
    else if (/(?:^|[^0-9])(?:720p?|hd)(?:[^0-9]|$)/.test(u)) out.downloads_medium.push(url);
    else if (/(?:^|[^0-9])(?:480p?|360p?|sd)(?:[^0-9]|$)/.test(u)) out.downloads_low.push(url);
    else out[fallback].push(url);
  }
  return out;
}
export const linesToText = (arr) => arr.join('\n');
export const textToLines = (t) => String(t || '').split(/\n+/).map(s => s.trim()).filter(Boolean);

/** «عرض الرو 21.09.2026 مترجم» for the next episode: the last headline with the new date. */
export function nextHeadline(previousHeadline, eventDate) {
  if (!previousHeadline || !eventDate) return '';
  const d = toDate(eventDate);
  if (!d) return '';
  const dd = `${pad(d.getDate())}.${pad(d.getMonth() + 1)}.${d.getFullYear()}`;
  const replaced = previousHeadline.replace(/\d{1,2}[./-]\d{1,2}[./-]\d{4}/, dd);
  return replaced !== previousHeadline ? replaced : '';
}
export function descriptionFromHeadline(headline) {
  const h = String(headline || '').replace(/\s*\d{1,2}[./-]\d{1,2}[./-]\d{4}\s*/, ' ').replace(/\s+/g, ' ').trim();
  if (!h) return '';
  return /مترجم/.test(h) ? `${h.replace(/\s*مترجم$/, '')} مترجم بالكامل مع جميع النزالات والأحداث.` : `${h} بالكامل مع جميع النزالات والأحداث.`;
}
export function hostName(url) { try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return url; } }

/** What a finished item still misses (shown as warnings, never blocking a save unless required). */
export function checklist(collection, data) {
  const def = COLLECTIONS[collection];
  const items = [];
  const has = (k) => !EMPTY(data[k]);
  const need = (k, label) => items.push({ ok: has(k), label, required: def.required.includes(k) });
  if (def.required.includes('federation') || 'federation' in (data || {})) need('federation', 'الاتحاد');
  need('title', collection === 'news' ? 'عنوان الخبر' : 'الاسم');
  if (collection !== 'news' && collection !== 'nostalgia_series') need('headline', 'العنوان العربي');
  need('image', 'صورة الغلاف');
  if (['shows', 'recaps', 'nostalgia'].includes(collection)) {
    items.push({ ok: Array.isArray(data.servers) && data.servers.some(s => s && s.url), label: 'سيرفر مشاهدة واحد على الأقل', required: false });
  }
  if (['shows', 'nostalgia'].includes(collection)) {
    need('duration', 'مدة العرض');
    items.push({ ok: ['downloads_low', 'downloads_medium', 'downloads_high'].some(k => has(k)), label: 'روابط تحميل', required: false });
  }
  if (collection === 'news') items.push({ ok: String(data.body || '').trim().length > 40, label: 'نص الخبر', required: false });
  return items;
}
