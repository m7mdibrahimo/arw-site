import type { DeliveryResult } from './delivery';
export interface VideoResult extends DeliveryResult { result?: any; message?: string }
const API = 'https://graph.facebook.com/v21.0';
const pause = (ms: number) => new Promise(r => setTimeout(r, ms));

// Distinguish a confirmed rejection from a lost acknowledgement at the publish boundary.
export async function finishPublication(url: string, body: object): Promise<VideoResult> {
  try {
    const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const data: any = await r.json();
    if (r.ok && (data.id || data.post_id || data.success === true)) {
      return { ok: true, id: String(data.id || data.post_id || ''), result: data };
    }
    return { ok: false, ambiguous: r.status >= 500 || !data.error,
      error: data.error?.message || `لم يؤكد الخادم نتيجة النشر (${r.status})`, result: data };
  } catch { return { ok: false, ambiguous: true, error: 'انقطع الاتصال عند تأكيد النشر؛ راجع المنصة قبل إعادة المحاولة.' }; }
}

export async function publishFacebookVideo(options: {
  pageId: string; token: string; videoUrl: string; caption?: string; story: boolean;
}): Promise<VideoResult> {
  const { pageId, token, videoUrl, caption, story } = options;
  if (!pageId || !token) return { ok: false, error: 'بيانات حساب فيسبوك غير مكتملة.' };
  const endpoint = `${API}/${pageId}/${story ? 'video_stories' : 'video_reels'}`;
  try {
    const init = await fetch(endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ upload_phase: 'start', access_token: token }) });
    const session: any = await init.json();
    if (!init.ok || !session.video_id || !session.upload_url) return { ok: false, error: session.error?.message || 'فشل بدء رفع الفيديو.' };
    // Stream the asset instead of retaining entire MP4s in the Worker's limited memory.
    const video = await fetch(videoUrl);
    if (!video.ok || !video.body) return { ok: false, error: `تعذر تحميل الفيديو (${video.status}).` };
    const size = video.headers.get('content-length');
    if (!size || !Number.isSafeInteger(Number(size)) || Number(size) <= 0) {
      await video.body.cancel();
      return { ok: false, error: 'خادم الفيديو لا يوفر حجم الملف المطلوب للرفع.' };
    }
    const upload = await fetch(session.upload_url, { method: 'POST', headers: {
      Authorization: `OAuth ${token}`, offset: '0', file_size: size, 'Content-Type': 'application/octet-stream',
    }, body: video.body });
    const uploaded: any = await upload.json();
    if (!upload.ok || uploaded.success !== true || uploaded.error) return { ok: false, error: uploaded.error?.message || 'لم يكتمل رفع الفيديو.' };
    const result = await finishPublication(endpoint, {
      upload_phase: 'finish', video_id: session.video_id, access_token: token,
      ...(!story ? { video_state: 'PUBLISHED', description: caption } : {}),
    });
    if (!result.ok) return result;
    if (story) return { ...result, id: String(session.video_id) };
    // Reels finish can acknowledge processing before the video is actually published.
    for (let i = 0; i < 10; i++) {
      await pause(3000);
      const response = await fetch(`${API}/${session.video_id}?fields=status&access_token=${encodeURIComponent(token)}`);
      const data: any = await response.json();
      if (data.status?.publishing_phase?.status === 'complete' || data.status?.video_status === 'ready') {
        return { ok: true, id: String(session.video_id) };
      }
      if (data.status?.publishing_phase?.status === 'error') return { ok: false, error: 'فشلت معالجة الريل بعد الرفع.' };
    }
    return { ok: false, ambiguous: true, id: String(session.video_id), error: 'تم قبول الفيديو ولم يتأكد ظهوره بعد؛ راجع فيسبوك.' };
  } catch { return { ok: false, ambiguous: true, error: 'تعذر تأكيد حالة فيديو فيسبوك؛ راجع المنصة.' }; }
}

export async function publishInstagramVideo(options: {
  accountId: string; token: string; videoUrl: string; caption?: string; story: boolean; kv: KVNamespace;
}): Promise<VideoResult> {
  const { accountId, token, videoUrl, caption, story, kv } = options;
  if (!accountId || !token) return { ok: false, error: 'بيانات حساب إنستجرام غير مكتملة.' };
  const cacheKey = `video-container:${story ? 'story' : 'reel'}:${videoUrl}`;
  let publishing = false;
  try {
    const cached = await kv.get(cacheKey);
    let container = cached ? JSON.parse(cached) : undefined;
    if (!container || Date.now() - container.createdAt > 23 * 60 * 60_000) {
      const response = await fetch(`${API}/${accountId}/media`, { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ media_type: story ? 'STORIES' : 'REELS', video_url: videoUrl, access_token: token,
          ...(!story ? { caption, share_to_feed: true } : {}) }) });
      const data: any = await response.json();
      if (!response.ok || !data.id) return { ok: false, error: data.error?.message || 'تعذر إنشاء حاوية إنستجرام.', result: data };
      container = { id: data.id, createdAt: Date.now() };
      await kv.put(cacheKey, JSON.stringify(container), { expirationTtl: 86400 });
    }
    for (let i = 0; i < 12; i++) {
      const response = await fetch(`${API}/${container.id}?fields=status_code,status&access_token=${encodeURIComponent(token)}`);
      const data: any = await response.json();
      if (data.status_code === 'PUBLISHED') return { ok: true, id: container.id };
      if (data.status_code === 'ERROR' || data.status_code === 'EXPIRED') {
        await kv.delete(cacheKey);
        return { ok: false, error: data.status || 'فشلت معالجة حاوية إنستجرام.' };
      }
      if (data.status_code === 'FINISHED') {
        publishing = true;
        const result = await finishPublication(`${API}/${accountId}/media_publish`, { creation_id: container.id, access_token: token });
        // Keep the container after success too: it is a second recovery reference.
        return result;
      }
      if (data.error) return { ok: false, error: data.error.message, result: data };
      await pause(3000);
    }
    return { ok: false, status: 'processing', error: 'الفيديو ما زال قيد المعالجة؛ ستُستكمل نفس الحاوية لاحقًا.' };
  } catch { return { ok: false, ambiguous: publishing, error: 'تعذر إكمال الاتصال بإنستجرام.' }; }
}

// Pending and unverified show videos must survive platform cooldowns.
export function mustRetainVideo(filename: string, state: Record<string, any>): boolean {
  const prefix = filename.match(/^reel-(\d{14})-/)?.[1];
  if (!prefix || prefix < '20260921002200') return false;
  const entry = Object.entries(state).find(([slug]) => filename === `reel-${slug}.mp4` || filename === `reel-${slug.slice(0, 45)}.mp4`)?.[1];
  return !entry || entry.needsReview || ['facebook_reel', 'facebook_story', 'instagram_reel', 'instagram_story'].some(p => entry[p] !== true);
}
