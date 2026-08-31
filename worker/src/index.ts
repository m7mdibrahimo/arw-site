/**
 * arw-site-bot — Cloudflare Worker
 * ─────────────────────────────────────────────────────────────────────────
 * Replaces the Render/Express bot (server.ts). Ported feature-for-feature:
 *   - Site watcher: polls search-index.json, verifies each item is really
 *     live (page + image), then publishes to Telegram, then cross-posts to
 *     Facebook + Instagram.
 *   - Same GitHub-backed atomic claim/dedup system as before
 *     (claimSend/releaseSendClaim), so publishing can never duplicate a
 *     post unless "force" is explicitly requested by a human.
 *   - Manual publish endpoints for the admin dashboard button.
 *   - Web Push (subscribe/unsubscribe/send) using Workers KV instead of
 *     local JSON files (which Render wiped on every restart anyway).
 *
 * Why this runs on a schedule reliably (unlike Render's free tier):
 * Cloudflare invokes the `scheduled` handler itself, on the cron clock —
 * there is no "sleep after 15 minutes of no traffic" here. The watcher
 * runs every minute whether or not anyone is visiting the site or the
 * admin panel.
 *
 * Design notes vs. the old server.ts:
 *   - No local filesystem. Instagram's cropped image no longer needs to be
 *     generated with `sharp` and re-hosted — https://wsrv.nl (a free,
 *     unlimited public image resizing proxy) builds the cropped image URL
 *     on the fly, and Instagram's Graph API fetches it directly from there.
 *   - No long-lived in-memory maps (telegramSentMap, etc.) — every poll
 *     re-reads the small publish-state.json from GitHub. It's cheap and
 *     it's the same source of truth Render used, just read fresh instead
 *     of cached in memory (Workers isolates aren't guaranteed to persist
 *     between invocations anyway, so caching in memory would be unsafe).
 */

import { buildPushPayload, type PushSubscription } from "@block65/webcrypto-web-push";

export interface Env {
  // Secrets — set with `wrangler secret put <NAME>`
  TELEGRAM_BOT_TOKEN: string;
  FACEBOOK_PAGE_ACCESS_TOKEN: string;
  GITHUB_TOKEN: string;
  VAPID_PUBLIC_KEY: string;
  VAPID_PRIVATE_KEY: string;

  // Plain vars — set in wrangler.toml [vars]
  TELEGRAM_CHAT_ID: string;
  FACEBOOK_PAGE_ID: string;
  INSTAGRAM_BUSINESS_ACCOUNT_ID: string;
  GITHUB_OWNER: string;
  GITHUB_REPO: string;
  GITHUB_BRANCH: string;
  GITHUB_STATE_PATH: string;
  SITE_ORIGIN: string;
  VAPID_SUBJECT: string;
  WATCHER_MIN_DATE: string;

  // KV binding
  PUSH_KV: KVNamespace;
}

const GRAPH_API_VERSION = "v21.0";
const SOCIAL_FOLLOW_LINE =
  "\n\nلمتابعة التفاصيل كاملة وكل جديد في عالم المصارعة، ابحثوا عن \"عرب راسلنج\" على جوجل أو زوروا موقعنا: arab-wrestling.com";

// ─────────────────────────────────────────────────────────────────────────
// Small helpers (ported as-is from server.ts)
// ─────────────────────────────────────────────────────────────────────────

function sanitizeKey(str: string): string {
  if (!str) return "";
  return str.toLowerCase().replace(/[^a-z0-9\u0600-\u06FF_-]/g, "");
}

function normalizeArticleUrl(urlStr: string | undefined): string {
  if (!urlStr) return "https://arab-wrestling.com";
  try {
    const parsed = new URL(urlStr);
    parsed.pathname = parsed.pathname.replace(/[A-Z]+/g, (m) => m.toLowerCase());
    return decodeURIComponent(parsed.toString());
  } catch (e) {
    return urlStr;
  }
}

function escapeTelegramHtml(str: string): string {
  if (!str) return "";
  return str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function isValidImageBuffer(buffer: ArrayBuffer): boolean {
  if (!buffer || buffer.byteLength < 100) return false;
  const buf = new Uint8Array(buffer.slice(0, 12));
  const hex = Array.from(buf.slice(0, 8)).map((b) => b.toString(16).padStart(2, "0")).join("");
  if (hex.startsWith("ffd8")) return true; // JPG
  if (hex.startsWith("89504e47")) return true; // PNG
  const asString = new TextDecoder().decode(buf);
  if (asString.startsWith("RIFF") && asString.slice(8, 12) === "WEBP") return true;
  if (hex.startsWith("47494638")) return true; // GIF
  return false;
}

function cacheBust(url: string): string {
  return url + (url.includes("?") ? "&" : "?") + "_cb=" + Date.now();
}

function extractSnippetFromHtml(html: string, maxLen = 220): string {
  const startMarker = 'class="post-body';
  const markerIdx = html.indexOf(startMarker);
  if (markerIdx === -1) return "";
  const startIdx = html.indexOf(">", markerIdx) + 1;
  if (startIdx <= 0) return "";
  const endIdx = html.indexOf('class="post-tags', startIdx);
  const raw = endIdx !== -1 ? html.slice(startIdx, endIdx) : html.slice(startIdx, startIdx + 4000);

  let text = raw
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/\s+/g, " ")
    .trim();

  if (text.length > maxLen) text = text.slice(0, maxLen).trim() + "…";
  if (text.length < 15 || text.startsWith("<")) return "";
  return text;
}

// Builds a 1080x1080 center-cropped JPEG URL via wsrv.nl (free, no signup,
// no rate limit for this scale). Replaces the old sharp()-based crop that
// needed a local filesystem + a server to re-host the result from.
function instagramSafeImageUrl(imageUrl: string): string {
  const clean = imageUrl.replace(/^https?:\/\//, "");
  return `https://wsrv.nl/?url=${encodeURIComponent(clean)}&w=1080&h=1080&fit=cover&output=jpg&q=90`;
}

// ─────────────────────────────────────────────────────────────────────────
// GitHub-backed publish state (identical logic to server.ts)
// ─────────────────────────────────────────────────────────────────────────

type PublishState = {
  telegram: Record<string, number>;
  facebook: Record<string, number>;
  instagram: Record<string, number>;
};

function emptyPublishState(): PublishState {
  return { telegram: {}, facebook: {}, instagram: {} };
}

function githubContentsUrl(env: Env): string {
  return `https://api.github.com/repos/${env.GITHUB_OWNER}/${env.GITHUB_REPO}/contents/${env.GITHUB_STATE_PATH}`;
}

async function githubReadState(env: Env): Promise<{ sha: string | null; state: PublishState }> {
  const res = await fetch(`${githubContentsUrl(env)}?ref=${env.GITHUB_BRANCH}`, {
    headers: { Authorization: `Bearer ${env.GITHUB_TOKEN}`, Accept: "application/vnd.github+json" },
  });
  if (res.status === 404) return { sha: null, state: emptyPublishState() };
  if (!res.ok) {
    const errBody = await res.text().catch(() => "");
    throw new Error(`GitHub read failed: ${res.status} ${errBody}`);
  }
  const data: any = await res.json();
  let state: PublishState;
  try {
    state = JSON.parse(atob(data.content.replace(/\n/g, "")));
  } catch (e) {
    state = emptyPublishState();
  }
  state.telegram = state.telegram || {};
  state.facebook = state.facebook || {};
  state.instagram = state.instagram || {};
  return { sha: data.sha, state };
}

function base64EncodeUtf8(str: string): string {
  const bytes = new TextEncoder().encode(str);
  let binary = "";
  bytes.forEach((b) => (binary += String.fromCharCode(b)));
  return btoa(binary);
}

async function githubWriteState(
  env: Env,
  state: PublishState,
  sha: string | null,
  message: string
): Promise<{ ok: boolean; conflict?: boolean }> {
  const body: any = {
    message,
    content: base64EncodeUtf8(JSON.stringify(state, null, 2)),
    branch: env.GITHUB_BRANCH,
  };
  if (sha) body.sha = sha;
  const res = await fetch(githubContentsUrl(env), {
    method: "PUT",
    headers: {
      Authorization: `Bearer ${env.GITHUB_TOKEN}`,
      Accept: "application/vnd.github+json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  if (res.status === 409 || res.status === 422) return { ok: false, conflict: true };
  if (!res.ok) return { ok: false };
  return { ok: true };
}

type Platform = "telegram" | "facebook" | "instagram";

async function claimSend(env: Env, platform: Platform, key: string): Promise<boolean> {
  if (!key) return true;
  for (let attempt = 0; attempt < 5; attempt++) {
    let sha: string | null;
    let state: PublishState;
    try {
      ({ sha, state } = await githubReadState(env));
    } catch (e) {
      return false;
    }
    if (state[platform][key]) return false; // already claimed/sent

    state[platform][key] = Date.now();
    const write = await githubWriteState(env, state, sha, `chore(publish): mark ${platform} sent — ${key}`);
    if (write.ok) return true;
    if (write.conflict) {
      await new Promise((r) => setTimeout(r, 400 + Math.random() * 400));
      continue;
    }
    return false;
  }
  return false;
}

async function releaseSendClaim(env: Env, platform: Platform, key: string): Promise<void> {
  if (!key) return;
  for (let attempt = 0; attempt < 5; attempt++) {
    let sha: string | null;
    let state: PublishState;
    try {
      ({ sha, state } = await githubReadState(env));
    } catch (e) {
      return;
    }
    if (!state[platform][key]) return;
    delete state[platform][key];
    const write = await githubWriteState(env, state, sha, `chore(publish): release ${platform} claim — ${key} (send failed)`);
    if (write.ok) return;
    if (write.conflict) {
      await new Promise((r) => setTimeout(r, 400 + Math.random() * 400));
      continue;
    }
    return;
  }
}

// ─────────────────────────────────────────────────────────────────────────
// Live-site verification (identical logic to server.ts)
// ─────────────────────────────────────────────────────────────────────────

async function verifyLiveOnSite(
  env: Env,
  item: { url?: string; image?: string }
): Promise<{ ok: boolean; imageBuffer?: ArrayBuffer; imageContentType?: string; bodySnippet?: string; fullBody?: string }> {
  const pageUrl = env.SITE_ORIGIN + (item.url || "");
  let bodySnippet = "";
  let fullBody = "";

  try {
    const pageRes = await fetch(cacheBust(pageUrl), { headers: { "Cache-Control": "no-cache" } });
    if (!pageRes.ok) return { ok: false };
    const html = await pageRes.text();
    bodySnippet = extractSnippetFromHtml(html);
    fullBody = extractSnippetFromHtml(html, 2000);
  } catch (e) {
    return { ok: false };
  }

  if (!item.image) return { ok: true, bodySnippet, fullBody };

  const imageUrl = item.image.startsWith("http") ? item.image : env.SITE_ORIGIN + item.image;
  try {
    const imgRes = await fetch(cacheBust(imageUrl), { headers: { "Cache-Control": "no-cache" } });
    if (!imgRes.ok) return { ok: false, bodySnippet, fullBody };
    const contentType = imgRes.headers.get("content-type") || "";
    if (!contentType.startsWith("image/")) return { ok: false, bodySnippet, fullBody };
    const buf = await imgRes.arrayBuffer();
    if (!isValidImageBuffer(buf)) return { ok: false, bodySnippet, fullBody };
    return { ok: true, imageBuffer: buf, imageContentType: contentType, bodySnippet, fullBody };
  } catch (e) {
    return { ok: false, bodySnippet, fullBody };
  }
}

// ─────────────────────────────────────────────────────────────────────────
// Telegram
// ─────────────────────────────────────────────────────────────────────────

async function sendVerifiedTelegramPost(
  env: Env,
  data: { title: string; text?: string; url: string },
  imageBuffer?: ArrayBuffer,
  imageContentType?: string
): Promise<{ ok: boolean; [k: string]: any }> {
  const safeTitle = escapeTelegramHtml(data.title || "");
  const safeText = escapeTelegramHtml(data.text || "");
  const safeUrl = escapeTelegramHtml(normalizeArticleUrl(data.url || env.SITE_ORIGIN));
  const bodyBlock = safeText ? `\n\n<blockquote expandable>${safeText}</blockquote>` : "";
  const messageHtml = `<b>${safeTitle}</b>${bodyBlock}\n\n🔗 <a href="${safeUrl}"><b>تابع المحتوى على موقع عرب راسلنج</b></a>`;

  if (imageBuffer) {
    try {
      const blob = new Blob([imageBuffer], { type: imageContentType || "image/jpeg" });
      const formData = new FormData();
      formData.append("chat_id", env.TELEGRAM_CHAT_ID);
      formData.append("photo", blob, "photo.jpg");
      formData.append("caption", messageHtml);
      formData.append("parse_mode", "HTML");
      const tgRes = await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendPhoto`, {
        method: "POST",
        body: formData,
      });
      const result: any = await tgRes.json().catch(() => ({ ok: false }));
      if (result.ok) return result;
    } catch (e) {
      // fall through to text-only
    }
  }

  const payload = { chat_id: env.TELEGRAM_CHAT_ID, text: messageHtml, parse_mode: "HTML", disable_web_page_preview: false };
  const tgRes = await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const result = await tgRes.json().catch(() => ({ ok: false }));
  return result as { ok: boolean; [k: string]: any };
}

// ─────────────────────────────────────────────────────────────────────────
// Facebook + Instagram
// ─────────────────────────────────────────────────────────────────────────

let cachedPageToken: { token: string; at: number } | null = null;
const PAGE_TOKEN_CACHE_MS = 60 * 60 * 1000;

async function getPageAccessToken(env: Env): Promise<string> {
  if (!env.FACEBOOK_PAGE_ACCESS_TOKEN || !env.FACEBOOK_PAGE_ID) return env.FACEBOOK_PAGE_ACCESS_TOKEN;
  const now = Date.now();
  if (cachedPageToken && now - cachedPageToken.at < PAGE_TOKEN_CACHE_MS) return cachedPageToken.token;

  try {
    const res = await fetch(
      `https://graph.facebook.com/${GRAPH_API_VERSION}/${env.FACEBOOK_PAGE_ID}?fields=access_token&access_token=${env.FACEBOOK_PAGE_ACCESS_TOKEN}`
    );
    const result: any = await res.json().catch(() => ({}));
    if (result.access_token) {
      cachedPageToken = { token: result.access_token, at: now };
      return cachedPageToken.token;
    }
    return env.FACEBOOK_PAGE_ACCESS_TOKEN;
  } catch (e) {
    return env.FACEBOOK_PAGE_ACCESS_TOKEN;
  }
}

async function refreshFacebookLinkPreview(url: string, pageToken: string): Promise<void> {
  try {
    await fetch(`https://graph.facebook.com/${GRAPH_API_VERSION}/`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: url, scrape: true, access_token: pageToken }),
    });
  } catch (e) {
    // best-effort only
  }
}

async function postToFacebook(
  env: Env,
  data: { title: string; text?: string; url: string; kind?: string }
): Promise<{ ok: boolean; result?: any; skipped?: boolean }> {
  if (!env.FACEBOOK_PAGE_ID || !env.FACEBOOK_PAGE_ACCESS_TOKEN) return { ok: false, skipped: true };
  const caption = `${data.title}\n\n${data.text || ""}`.trim() + SOCIAL_FOLLOW_LINE;

  try {
    const pageToken = await getPageAccessToken(env);
    await refreshFacebookLinkPreview(data.url, pageToken);

    const res = await fetch(`https://graph.facebook.com/${GRAPH_API_VERSION}/${env.FACEBOOK_PAGE_ID}/feed`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message: caption, link: data.url, access_token: pageToken }),
    });
    const result: any = await res.json().catch(() => ({}));
    if (result.id) return { ok: true, result };
    return { ok: false, result };
  } catch (e) {
    return { ok: false };
  }
}

async function postToInstagram(
  env: Env,
  data: { title: string; text?: string; url: string; imageUrl?: string }
): Promise<{ ok: boolean; result?: any; skipped?: boolean }> {
  if (!env.INSTAGRAM_BUSINESS_ACCOUNT_ID || !env.FACEBOOK_PAGE_ACCESS_TOKEN) return { ok: false, skipped: true };
  if (!data.imageUrl) return { ok: false, skipped: true };

  const safeImageUrl = instagramSafeImageUrl(data.imageUrl);
  const caption = `${data.title}\n\n${data.text || ""}`.trim() + SOCIAL_FOLLOW_LINE;

  try {
    const pageToken = await getPageAccessToken(env);
    const createRes = await fetch(
      `https://graph.facebook.com/${GRAPH_API_VERSION}/${env.INSTAGRAM_BUSINESS_ACCOUNT_ID}/media`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ image_url: safeImageUrl, caption, access_token: pageToken }),
      }
    );
    const createResult: any = await createRes.json().catch(() => ({}));
    if (!createResult.id) return { ok: false, result: createResult };

    // Poll until Instagram finishes processing the image (fewer/shorter
    // attempts than the original — waiting doesn't cost Workers CPU time,
    // but this keeps a single invocation comfortably short; if it's still
    // not ready, the claim is released below and the next minute's poll
    // just tries again from scratch).
    let ready = false;
    for (let attempt = 0; attempt < 6; attempt++) {
      await new Promise((r) => setTimeout(r, 2500));
      const statusRes = await fetch(
        `https://graph.facebook.com/${GRAPH_API_VERSION}/${createResult.id}?fields=status_code&access_token=${pageToken}`
      );
      const statusResult: any = await statusRes.json().catch(() => ({}));
      if (statusResult.status_code === "FINISHED") {
        ready = true;
        break;
      }
      if (statusResult.status_code === "ERROR") return { ok: false, result: statusResult };
    }
    if (!ready) return { ok: false };

    const publishRes = await fetch(
      `https://graph.facebook.com/${GRAPH_API_VERSION}/${env.INSTAGRAM_BUSINESS_ACCOUNT_ID}/media_publish`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ creation_id: createResult.id, access_token: pageToken }),
      }
    );
    const publishResult: any = await publishRes.json().catch(() => ({}));
    if (publishResult.id) return { ok: true, result: publishResult };
    return { ok: false, result: publishResult };
  } catch (e) {
    return { ok: false };
  }
}

// ─────────────────────────────────────────────────────────────────────────
// Publish-to-one-platform orchestration, shared by the watcher and the
// manual-publish endpoint. `force=true` bypasses an existing claim (used
// only by the admin "force re-publish" checkbox).
// ─────────────────────────────────────────────────────────────────────────

async function publishToPlatform(
  env: Env,
  platform: Platform,
  key: string,
  item: { title: string; text?: string; url: string; image?: string; kind?: string },
  verified: { imageBuffer?: ArrayBuffer; imageContentType?: string },
  force: boolean
): Promise<string> {
  if (force) await releaseSendClaim(env, platform, key);
  if (!(await claimSend(env, platform, key))) return "already_sent";

  let ok = false;
  let skipped = false;

  if (platform === "telegram") {
    const r = await sendVerifiedTelegramPost(env, item, verified.imageBuffer, verified.imageContentType);
    ok = !!(r && r.ok);
  } else if (platform === "facebook") {
    const r = await postToFacebook(env, item);
    ok = r.ok;
    skipped = !!r.skipped;
  } else {
    const imageUrl = item.image ? (item.image.startsWith("http") ? item.image : env.SITE_ORIGIN + item.image) : undefined;
    const r = await postToInstagram(env, { ...item, imageUrl });
    ok = r.ok;
    skipped = !!r.skipped;
  }

  if (ok) return "sent";
  await releaseSendClaim(env, platform, key);
  return skipped ? "not_configured" : "failed";
}

// ─────────────────────────────────────────────────────────────────────────
// Watcher — runs on the cron trigger, once a minute.
// ─────────────────────────────────────────────────────────────────────────

async function runWatcherPoll(env: Env): Promise<void> {
  let items: any[] = [];
  try {
    const res = await fetch(cacheBust(`${env.SITE_ORIGIN}/search-index.json`), {
      headers: { "Cache-Control": "no-cache" },
    });
    if (!res.ok) return;
    const data = await res.json();
    items = Array.isArray(data) ? data : [];
  } catch (e) {
    return;
  }
  if (!items.length) return;

  const minDate = env.WATCHER_MIN_DATE ? new Date(env.WATCHER_MIN_DATE).getTime() : 0;

  // One read of the publish-state up front to cheaply skip anything already
  // fully published on every platform, without spending a subrequest per
  // item just to find out.
  let state: PublishState;
  try {
    ({ state } = await githubReadState(env));
  } catch (e) {
    return;
  }

  for (const item of items) {
    const ts = item.date ? new Date(item.date).getTime() : 0;
    if (minDate && ts && ts < minDate) continue; // pre-cutover content — never auto-published

    const key = sanitizeKey(normalizeArticleUrl(env.SITE_ORIGIN + (item.url || "")));
    if (!key) continue;

    const fullyDone = state.telegram[key] && state.facebook[key] && state.instagram[key];
    if (fullyDone) continue;

    // Only spend the verify+publish subrequests on items that actually
    // still need something. Every new item still goes through Telegram
    // first (as before) since Facebook/Instagram captions reuse its body.
    if (!state.telegram[key]) {
      const verify = await verifyLiveOnSite(env, { url: item.url, image: item.image });
      if (!verify.ok) continue; // not fully live yet — try again next minute

      const collection = item.kind === "show" ? "shows" : item.kind === "recap" ? "recaps" : "news";
      const payload = {
        title: item.title,
        text: item.headline || item.description || verify.bodySnippet || "",
        url: env.SITE_ORIGIN + (item.url || ""),
      };

      const tgStatus = await publishToPlatform(env, "telegram", key, payload, verify, false);
      if (tgStatus !== "sent") continue; // failed or already handled — Facebook/Instagram wait for a confirmed Telegram post like before

      if (collection === "shows" || collection === "recaps") {
        await sendPushToAllSubscribers(env, { ...payload, image: item.image, collection, kind: item.kind }).catch(() => {});
      }

      await publishToPlatform(env, "facebook", key, { ...payload, image: item.image, kind: item.kind }, {}, false);
      await publishToPlatform(env, "instagram", key, { ...payload, image: item.image }, {}, false);
    } else {
      // Telegram already sent on an earlier tick — just catch up any
      // platform that's still missing (e.g. Instagram failed processing
      // last time and its claim was released).
      const payload = { title: item.title, text: item.headline || item.description || "", url: env.SITE_ORIGIN + (item.url || "") };
      if (!state.facebook[key]) await publishToPlatform(env, "facebook", key, { ...payload, image: item.image, kind: item.kind }, {}, false);
      if (!state.instagram[key]) await publishToPlatform(env, "instagram", key, { ...payload, image: item.image }, {}, false);
    }

    // Keep each cron tick bounded — handle at most one item needing real
    // publish work per minute. Anything else waits for the next tick;
    // nothing is lost, dedup state already lives in GitHub.
    break;
  }
}

// ─────────────────────────────────────────────────────────────────────────
// Web Push (Workers KV instead of local JSON files)
// ─────────────────────────────────────────────────────────────────────────

async function getSubscriptions(env: Env): Promise<PushSubscription[]> {
  const raw = await env.PUSH_KV.get("push:subscriptions");
  if (!raw) return [];
  try {
    return JSON.parse(raw);
  } catch (e) {
    return [];
  }
}

async function saveSubscriptions(env: Env, subs: PushSubscription[]): Promise<void> {
  await env.PUSH_KV.put("push:subscriptions", JSON.stringify(subs));
}

async function sendPushToAllSubscribers(
  env: Env,
  data: { title: string; text?: string; headline?: string; url: string; image?: string; collection?: string; kind?: string }
): Promise<{ success: boolean; sentCount?: number; totalSubs?: number; reason?: string }> {
  const { title, text, headline, url, image, collection, kind } = data;

  const isNews = collection === "news" || kind === "news" || (url && url.includes("/news/"));
  if (isNews) return { success: false, reason: "News disabled" };

  const isShow = kind === "show" || collection === "shows" || (url && url.includes("/shows/"));
  const label = isShow ? "عرض جديد" : "ملخص جديد";

  const message = {
    data: JSON.stringify({
      title: `عرب راسلنج 🔔 | ${label}: ${title || ""}`,
      body: headline || text || "تم إضافة عرض/ملخص جديد على الموقع. اضغط للمشاهدة الآن.",
      url: url || "/",
      image: image || "/favicon.png",
      kind: isShow ? "show" : "recap",
    }),
    options: { ttl: 86400, urgency: "high" as const },
  };

  const vapid = { subject: env.VAPID_SUBJECT, publicKey: env.VAPID_PUBLIC_KEY, privateKey: env.VAPID_PRIVATE_KEY };
  const subs = await getSubscriptions(env);
  const validSubs: PushSubscription[] = [];
  let sentCount = 0;

  await Promise.all(
    subs.map(async (sub) => {
      try {
        const payload = await buildPushPayload(message, sub, vapid);
        const res = await fetch(sub.endpoint, payload);
        if (res.status === 404 || res.status === 410) return; // expired — drop it
        sentCount++;
        validSubs.push(sub);
      } catch (e) {
        validSubs.push(sub); // transient error — keep the subscription, don't punish it
      }
    })
  );

  await saveSubscriptions(env, validSubs);
  return { success: true, sentCount, totalSubs: subs.length };
}

// ─────────────────────────────────────────────────────────────────────────
// HTTP router
// ─────────────────────────────────────────────────────────────────────────

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...CORS_HEADERS },
  });
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS_HEADERS });

    const url = new URL(request.url);
    const path = url.pathname;

    try {
      // ── Telegram/Facebook/Instagram config sanity checks ──
      if (path === "/api/telegram/status" && request.method === "GET") {
        const res = await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/getMe`);
        const data = await res.json();
        return json({ success: true, bot: data, channel: env.TELEGRAM_CHAT_ID });
      }

      if (path === "/api/facebook/status" && request.method === "GET") {
        if (!env.FACEBOOK_PAGE_ID || !env.FACEBOOK_PAGE_ACCESS_TOKEN) {
          return json({ success: false, configured: false, message: "FACEBOOK_PAGE_ID / FACEBOOK_PAGE_ACCESS_TOKEN not set" });
        }
        const res = await fetch(
          `https://graph.facebook.com/${GRAPH_API_VERSION}/${env.FACEBOOK_PAGE_ID}?fields=id,name&access_token=${env.FACEBOOK_PAGE_ACCESS_TOKEN}`
        );
        const data: any = await res.json();
        return json({ success: !data.error, configured: true, page: data });
      }

      if (path === "/api/instagram/status" && request.method === "GET") {
        if (!env.INSTAGRAM_BUSINESS_ACCOUNT_ID || !env.FACEBOOK_PAGE_ACCESS_TOKEN) {
          return json({ success: false, configured: false, message: "INSTAGRAM_BUSINESS_ACCOUNT_ID / FACEBOOK_PAGE_ACCESS_TOKEN not set" });
        }
        const res = await fetch(
          `https://graph.facebook.com/${GRAPH_API_VERSION}/${env.INSTAGRAM_BUSINESS_ACCOUNT_ID}?fields=id,username&access_token=${env.FACEBOOK_PAGE_ACCESS_TOKEN}`
        );
        const data: any = await res.json();
        return json({ success: !data.error, configured: true, account: data });
      }

      // ── Manual publish dashboard (used by admin/publish.html) ──
      if (path === "/api/social/status" && request.method === "GET") {
        const itemUrl = url.searchParams.get("url") || "";
        if (!itemUrl) return json({ success: false, error: "url مطلوب" }, 400);
        const key = sanitizeKey(normalizeArticleUrl(itemUrl));
        const { state } = await githubReadState(env);
        return json({
          success: true,
          key,
          telegram: !!state.telegram[key],
          facebook: !!state.facebook[key],
          instagram: !!state.instagram[key],
        });
      }

      if (path === "/api/social/manual-publish" && request.method === "POST") {
        const body: any = await request.json().catch(() => ({}));
        const { title, text, url: itemUrl, image, kind, platforms, force } = body || {};
        if (!title || !itemUrl) return json({ success: false, error: "title و url مطلوبين" }, 400);

        const key = sanitizeKey(normalizeArticleUrl(itemUrl));
        const wanted: Platform[] = Array.isArray(platforms) && platforms.length ? platforms : ["telegram", "facebook", "instagram"];
        let pagePath = itemUrl;
        try {
          pagePath = new URL(itemUrl).pathname;
        } catch (e) {
          /* keep as-is */
        }

        const results: Record<string, string> = {};
        const payload = { title, text, url: itemUrl, image, kind };

        if (wanted.includes("telegram")) {
          const verify = await verifyLiveOnSite(env, { url: pagePath, image });
          results.telegram = await publishToPlatform(env, "telegram", key, payload, verify, !!force);
        }
        if (wanted.includes("facebook")) {
          results.facebook = await publishToPlatform(env, "facebook", key, payload, {}, !!force);
        }
        if (wanted.includes("instagram")) {
          results.instagram = await publishToPlatform(env, "instagram", key, payload, {}, !!force);
        }

        return json({ success: true, key, results });
      }

      // ── Web Push ──
      if (path === "/api/push/public-key" && request.method === "GET") {
        return json({ success: true, publicKey: env.VAPID_PUBLIC_KEY });
      }

      if (path === "/api/push/subscribe" && request.method === "POST") {
        const body: any = await request.json().catch(() => ({}));
        const { subscription } = body || {};
        if (!subscription || !subscription.endpoint) return json({ success: false, error: "Invalid subscription" }, 400);
        const subs = await getSubscriptions(env);
        if (!subs.some((s) => s.endpoint === subscription.endpoint)) {
          subs.push(subscription);
          await saveSubscriptions(env, subs);
        }
        return json({ success: true, message: "تم الاشتراك في الإشعارات بنجاح!" });
      }

      if (path === "/api/push/unsubscribe" && request.method === "POST") {
        const body: any = await request.json().catch(() => ({}));
        const { endpoint } = body || {};
        if (!endpoint) return json({ success: true });
        const subs = await getSubscriptions(env);
        await saveSubscriptions(env, subs.filter((s) => s.endpoint !== endpoint));
        return json({ success: true });
      }

      if (path === "/api/push/send" && request.method === "POST") {
        const body: any = await request.json().catch(() => ({}));
        const result = await sendPushToAllSubscribers(env, body || {});
        return json(result);
      }

      // ── Legacy endpoint kept for compatibility with the admin panel's
      //    existing extractTelegramPayload() call — no longer sends
      //    anything itself, the watcher (cron) owns all real publishing.
      //    Kept only so old cached admin/index.html versions don't error.
      if (path === "/api/telegram/post" && request.method === "POST") {
        return json({
          success: true,
          queued: true,
          message: "النشر التلقائي بيحصل عن طريق الـ watcher (كل دقيقة) — مفيش حاجة تانية تتعمل هنا.",
        });
      }

      return json({ success: false, error: "Not found" }, 404);
    } catch (error: any) {
      return json({ success: false, error: error.message || "خطأ في السيرفر" }, 500);
    }
  },

  async scheduled(_controller: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
    ctx.waitUntil(runWatcherPoll(env));
  },
} satisfies ExportedHandler<Env>;
