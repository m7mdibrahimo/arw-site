// The site's own promo videos (owner 2026-10-15: «ارفعه وضيفه علي كل المنصات بتاعتي … ولو تثبتها»): a wide video of
// any length, posted once to the Facebook page (as a page video: Reels take only upright videos up to 90 seconds),
// Instagram (a reel, shared to the feed) and the Telegram channel, then pinned where the platform lets a page pin.
// The show reels keep their own path (/api/videos/publish-social); this one takes only a file from /videos/.
import type { VideoResult } from './video-publishing';

const API = 'https://graph.facebook.com/v21.0';
const VIDEO_API = 'https://graph-video.facebook.com/v21.0';
const pause = (ms: number) => new Promise(r => setTimeout(r, ms));

/** A promo file name: plain, lower-case, an MP4 */
export const PROMO_FILE = /^[a-z0-9][a-z0-9-]{2,60}\.mp4$/;
export const PROMO_PLATFORMS = ['facebook', 'instagram', 'telegram'] as const;
export type PromoPlatform = typeof PROMO_PLATFORMS[number];

/** The caption as the owner wrote it: no control characters, at most what Telegram takes under a video */
export function promoCaption(text: unknown, max = 1024): string {
  return String(text ?? '').replace(/\r\n?/g, '\n').replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, '').trim().slice(0, max);
}

/** A page video on Facebook (any shape, any length). The post shows once Facebook has processed it; its post id is
 *  what a pin needs, so it is waited for (and a video Facebook accepted counts as sent even if that wait runs out). */
export async function promoFacebook(o: { pageId: string; token: string; videoUrl: string; title: string; caption: string }): Promise<VideoResult & { postId?: string }> {
  if (!o.pageId || !o.token) return { ok: false, error: 'بيانات صفحة فيسبوك غير مكتملة.' };
  let videoId = '';
  try {
    const r = await fetch(`${VIDEO_API}/${o.pageId}/videos`, { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ file_url: o.videoUrl, title: o.title, description: o.caption, published: true, access_token: o.token }) });
    const d: any = await r.json().catch(() => ({}));
    if (!r.ok || !d.id) return { ok: false, ambiguous: r.status >= 500, error: d.error?.message || `فيسبوك رفض الفيديو (${r.status}).`, result: d };
    videoId = String(d.id);
  } catch { return { ok: false, ambiguous: true, error: 'انقطع الاتصال أثناء رفع الفيديو لفيسبوك؛ راجع الصفحة قبل إعادة المحاولة.' }; }
  for (let i = 0; i < 40; i++) {
    await pause(4000);
    try {
      const r = await fetch(`${API}/${videoId}?fields=status,post_id,permalink_url&access_token=${encodeURIComponent(o.token)}`);
      const d: any = await r.json().catch(() => ({}));
      if (d.status?.video_status === 'error') return { ok: false, error: 'فشلت معالجة الفيديو على فيسبوك.', result: d };
      if (d.post_id && (d.status?.video_status === 'ready' || d.status?.publishing_phase?.status === 'complete')) {
        const postId = String(d.post_id).includes('_') ? String(d.post_id) : `${o.pageId}_${d.post_id}`;
        return { ok: true, id: postId, postId, result: { videoId, permalink: d.permalink_url } };
      }
    } catch {}
  }
  return { ok: true, id: videoId, result: { videoId, processing: true } };
}

/** The post's id from its video (when the publish step ran out of time before Facebook finished) */
export async function facebookPostOf(videoOrPostId: string, pageId: string, token: string): Promise<string> {
  if (videoOrPostId.includes('_')) return videoOrPostId;
  try {
    const r = await fetch(`${API}/${videoOrPostId}?fields=post_id&access_token=${encodeURIComponent(token)}`);
    const d: any = await r.json().catch(() => ({}));
    return d.post_id ? (String(d.post_id).includes('_') ? String(d.post_id) : `${pageId}_${d.post_id}`) : '';
  } catch { return ''; }
}

/** Pin a page post to the top of the page */
export async function pinFacebook(o: { postId: string; token: string }): Promise<VideoResult> {
  try {
    const r = await fetch(`${API}/${o.postId}`, { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ is_pinned: true, access_token: o.token }) });
    const d: any = await r.json().catch(() => ({}));
    if (r.ok && d.success !== false && !d.error) return { ok: true, id: o.postId };
    return { ok: false, error: d.error?.message || `فيسبوك رفض التثبيت (${r.status}).`, result: d };
  } catch { return { ok: false, error: 'انقطع الاتصال أثناء التثبيت على فيسبوك.' }; }
}

/** The video itself to the Telegram channel (a link is fetched by Telegram only up to 20 MB, a bot uploads up to 50) */
export async function promoTelegram(o: { botToken: string; chatId: string; videoUrl: string; caption: string; width?: number; height?: number; duration?: number }): Promise<VideoResult> {
  if (!o.botToken || !o.chatId) return { ok: false, error: 'بيانات تليجرام غير مكتملة.' };
  try {
    const v = await fetch(o.videoUrl);
    if (!v.ok) return { ok: false, error: `تعذر تحميل الفيديو (${v.status}).` };
    const blob = await v.blob();
    if (blob.size > 50 * 1024 * 1024) return { ok: false, error: 'الفيديو أكبر من 50 ميجا، وده الحد اللي تليجرام بيقبله من البوت.' };
    const form = new FormData();
    form.append('chat_id', o.chatId);
    form.append('video', blob, 'arab-wrestling.mp4');
    form.append('caption', o.caption);
    form.append('supports_streaming', 'true');
    if (o.width) form.append('width', String(o.width));
    if (o.height) form.append('height', String(o.height));
    if (o.duration) form.append('duration', String(Math.round(o.duration)));
    const r = await fetch(`https://api.telegram.org/bot${o.botToken}/sendVideo`, { method: 'POST', body: form });
    const d: any = await r.json().catch(() => ({}));
    if (d.ok && d.result?.message_id) return { ok: true, id: String(d.result.message_id), result: { messageId: d.result.message_id } };
    return { ok: false, ambiguous: r.status >= 500, error: d.description || `تليجرام رفض الفيديو (${r.status}).`, result: d };
  } catch { return { ok: false, ambiguous: true, error: 'انقطع الاتصال أثناء رفع الفيديو لتليجرام؛ راجع القناة قبل إعادة المحاولة.' }; }
}

export async function pinTelegram(o: { botToken: string; chatId: string; messageId: string }): Promise<VideoResult> {
  try {
    const r = await fetch(`https://api.telegram.org/bot${o.botToken}/pinChatMessage`, { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: o.chatId, message_id: Number(o.messageId), disable_notification: false }) });
    const d: any = await r.json().catch(() => ({}));
    if (d.ok) return { ok: true, id: o.messageId };
    return { ok: false, error: d.description || `تليجرام رفض التثبيت (${r.status}).`, result: d };
  } catch { return { ok: false, error: 'انقطع الاتصال أثناء التثبيت على تليجرام.' }; }
}
