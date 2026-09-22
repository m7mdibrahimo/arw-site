/**
 * arw-site-bot — Cloudflare Worker
 * ─────────────────────────────────────────────────────────────────────────
 * Replaces the Render/Express bot (server.ts). Ported feature-for-feature:
 *   - Site watcher: polls search-index.json, verifies each item is really
 *     live (page + image), then publishes to Telegram, then cross-posts to
 *     Facebook + Instagram.
 *   - GitHub SHA-based per-publication claims and durable acknowledgements.
 *     Unknown outcomes remain blocked until checked on the destination.
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

import { deliverOnce, authorizeAdmin } from "./delivery";
import { publishFacebookVideo, publishInstagramVideo, mustRetainVideo } from "./video-publishing";
import { buildPushPayload, type PushSubscription } from "@block65/webcrypto-web-push";

export interface Env {
  // Secrets — set with `wrangler secret put <NAME>`
  TELEGRAM_BOT_TOKEN: string;
  FACEBOOK_PAGE_ACCESS_TOKEN: string;
  GITHUB_TOKEN: string;
  VAPID_PUBLIC_KEY: string;
  VAPID_PRIVATE_KEY: string;
  // X (Twitter) cross-posting goes through Buffer instead of X's own API —
  // X's official API no longer has a usable free tier (pay-per-use only,
  // $0.20/post if it contains a link), while Buffer already has its own
  // paid API relationship with X and a free Buffer account can queue posts
  // to a connected X channel at no extra cost.
  BUFFER_API_KEY: string;

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
  INSTAGRAM_AUTO_ENABLED?: string;
  AUTO_IMAGE_STORIES?: string;
  BUFFER_X_CHANNEL_ID: string;
  BUFFER_FACEBOOK_CHANNEL_ID: string;

  // KV binding
  PUSH_KV: KVNamespace;
}

const GRAPH_API_VERSION = "v21.0";
const SOCIAL_FOLLOW_LINE =
  "\n\nلمتابعة التفاصيل كاملة وكل جديد في عالم المصارعة، ابحثوا عن \"عرب راسلنج\" على جوجل أو زوروا موقعنا: arab-wrestling.com";

function generateSocialHashtags(title: string, text?: string): string {
  const content = `${title} ${text || ""}`.toLowerCase();
  const tags = ["#عرب_راسلنج"];

  if (content.includes("wwe") || content.includes("رو") || content.includes("سماكداون") || content.includes("nxt") || content.includes("رينز") || content.includes("بانك") || content.includes("كودي")) {
    tags.push("#WWE");
  } else if (content.includes("aew") || content.includes("داينامايت") || content.includes("كوليجن") || content.includes("أوسبري") || content.includes("موكسلي") || content.includes("ستريكلاند")) {
    tags.push("#AEW");
  } else if (content.includes("tna") || content.includes("إمباكت") || content.includes("امباكت")) {
    tags.push("#TNA");
  }

  if (content.includes("عرض") || content.includes("نتائج") || content.includes("ملخص") || content.includes("مواجهات")) {
    tags.push("#عروض_المصارعة");
  } else {
    tags.push("#مصارعة_المحترفين");
  }

  return tags.join(" ");
}

function buildFacebookCaption(title: string, text?: string, kind?: string): string {
  const cleanTitle = title.trim();
  const cleanText = (text || "").trim();
  const hashtags = generateSocialHashtags(title, text);

  const header = `« ${cleanTitle} »`;
  const snippet = cleanText;
  const websiteCta = `🌐 للتغطية الكاملة: ابحث في جوجل عن "عرب راسلنج" (arab-wrestling.com)`;

  const parts = [header];
  if (snippet) parts.push(snippet);
  parts.push(websiteCta);
  if (hashtags) parts.push(hashtags);
  return parts.join("\n\u2800\n");
}

function buildInstagramCaption(title: string, text?: string, kind?: string): string {
  const cleanTitle = title.trim();
  const cleanText = (text || "").trim();
  const hashtags = generateSocialHashtags(title, text);

  const header = `« ${cleanTitle} »`;
  const snippet = cleanText;
  const websiteCta = `🌐 للتغطية الكاملة: ابحث في جوجل عن "عرب راسلنج" أو تفضل بزيارة الرابط في البايو\n(arab-wrestling.com)`;

  const parts = [header];
  if (snippet) parts.push(snippet);
  parts.push(websiteCta);
  if (hashtags) parts.push(hashtags);
  return parts.join("\n\u2800\n");
}

function buildDividedCaption(title: string, text?: string, kind?: string): string {
  return buildFacebookCaption(title, text, kind);
}



// X's real character-counting algorithm (twitter-text v3) weights most
// Latin/Arabic-range characters (U+0000–U+10FF) and a few punctuation
// ranges as 1, but weights everything else — including the "─" box-drawing
// characters used in the divider above and the "…" ellipsis — as 2. A
// naive `.length` check treats every character as weight 1, so a caption
// that measured exactly 280 by `.length` (because it ended in a divider or
// an ellipsis) could still be rejected by X as over the real 280-weighted
// limit. That mismatch — not the title being too long — is what was
// causing "X posts cannot exceed 280 characters" even on captions that
// looked short enough.
function isXLowWeightCodePoint(cp: number): boolean {
  return (
    (cp >= 0 && cp <= 4351) ||
    (cp >= 8192 && cp <= 8205) ||
    (cp >= 8208 && cp <= 8223) ||
    (cp >= 8242 && cp <= 8247)
  );
}

function xWeightedLength(str: string): number {
  let weight = 0;
  for (const ch of str) weight += isXLowWeightCodePoint(ch.codePointAt(0)!) ? 1 : 2;
  return weight;
}

function truncateForX(str: string, maxWeighted = 280): string {
  if (xWeightedLength(str) <= maxWeighted) return str;
  const ellipsis = "…";
  const ellipsisWeight = xWeightedLength(ellipsis);
  let weight = 0;
  let out = "";
  for (const ch of str) {
    const w = isXLowWeightCodePoint(ch.codePointAt(0)!) ? 1 : 2;
    if (weight + w + ellipsisWeight > maxWeighted) break;
    out += ch;
    weight += w;
  }
  return out.trim() + ellipsis;
}

// Builds the X caption as just the title and an article snippet, divided
// by a line — no "follow us" line. The title is treated as fixed — never
// shortened or dropped — and only the article snippet gets trimmed (or,
// if there's no room left at all, omitted) to fit the real 280-weighted
// limit.
function buildXCaption(title: string, text?: string): string {
  const DIVIDER = "\n\n────────\n\n";
  const titleTrimmed = title.trim();
  // X's documented limit is 280, but a caption landing exactly on that
  // boundary was still getting rejected in practice (confirmed against a
  // real failing post) — X's real enforcement appears stricter than the
  // "≤ 280" the public algorithm implies. A small safety margin avoids
  // that boundary entirely instead of chasing the exact off-by-one.
  const maxWeighted = 270;

  if (!text || !text.trim()) {
    return xWeightedLength(titleTrimmed) <= maxWeighted
      ? titleTrimmed
      : truncateForX(titleTrimmed, maxWeighted);
  }

  const remaining = maxWeighted - xWeightedLength(titleTrimmed) - xWeightedLength(DIVIDER);
  if (remaining <= 0) {
    return xWeightedLength(titleTrimmed) <= maxWeighted ? titleTrimmed : truncateForX(titleTrimmed, maxWeighted);
  }

  const snippet = truncateForX(text.trim(), remaining);
  return titleTrimmed + DIVIDER + snippet;
}

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
  x: Record<string, number>;
  // Per-platform "don't attempt again until" timestamp (ms), used when
  // Buffer reports its own daily posting-limit-for-this-channel error.
  // Deliberately stored here (GitHub-backed, strongly consistent via the
  // existing sha-based read-modify-write) instead of Workers KV — KV is
  // only *eventually* consistent (writes can take up to ~60s to reach
  // every edge location), which is exactly as long as the watcher's cron
  // interval, so a cooldown written in KV on one tick could still read as
  // "not set" on the very next tick and get silently ignored.
  cooldowns: Partial<Record<"facebook" | "instagram" | "x", number>>;
  deferrals?: Record<string, number>;
  lastStoryAt?: number;
  videoCooldowns?: Partial<Record<"facebook" | "instagram", number>>;
  // Buffer's own RateLimit response header, read proactively so a post is
  // skipped before it would be rejected rather than after — see
  // recordBufferQuota/hasBufferQuota. X and Facebook share this because
  // both go through the same Buffer API key (one client, one quota).
  bufferQuota?: { remaining: number; resetAt: number; window: string; updatedAt: number }[];
};

function emptyPublishState(): PublishState {
  return { telegram: {}, facebook: {}, instagram: {}, x: {}, cooldowns: {}, lastStoryAt: 0 };
}

function githubContentsUrl(env: Env): string {
  return `https://api.github.com/repos/${env.GITHUB_OWNER}/${env.GITHUB_REPO}/contents/${env.GITHUB_STATE_PATH}`;
}

async function githubReadState(env: Env): Promise<{ sha: string | null; state: PublishState }> {
  const res = await fetch(`${githubContentsUrl(env)}?ref=${env.GITHUB_BRANCH}`, {
    headers: {
      Authorization: `Bearer ${env.GITHUB_TOKEN}`,
      Accept: "application/vnd.github+json",
      "User-Agent": "arw-site-bot",
    },
  });
  if (res.status === 404) return { sha: null, state: emptyPublishState() };
  if (!res.ok) {
    const errBody = await res.text().catch(() => "");
    throw new Error(`GitHub read failed: ${res.status} ${errBody}`);
  }
  const data: any = await res.json();
  let state: PublishState;
  let rawStr = data.content ? base64DecodeUtf8(data.content.replace(/\n/g, "")) : "";
  if (!rawStr && data.git_url) {
    const blobRes = await fetch(data.git_url, {
      headers: {
        Authorization: `Bearer ${env.GITHUB_TOKEN}`,
        Accept: "application/vnd.github+json",
        "User-Agent": "arw-site-bot",
      },
    });
    if (blobRes.ok) {
      const blobData: any = await blobRes.json();
      if (blobData.content) {
        rawStr = base64DecodeUtf8(blobData.content.replace(/\n/g, ""));
      }
    }
  }
  state = JSON.parse(rawStr);
  state.telegram = state.telegram || {};
  state.facebook = state.facebook || {};
  state.instagram = state.instagram || {};
  state.x = state.x || {};
  state.cooldowns = state.cooldowns || {};
  return { sha: data.sha, state };
}

function base64EncodeUtf8(str: string): string {
  const bytes = new TextEncoder().encode(str);
  let binary = "";
  bytes.forEach((b) => (binary += String.fromCharCode(b)));
  return btoa(binary);
}

// Counterpart to base64EncodeUtf8: atob() alone only gives back a raw
// "binary string" (one JS char per byte), NOT decoded UTF-8 text. Passing
// that straight into JSON.parse() is what corrupted every Arabic key in
// publish-state.json into mojibake (e.g. "ÃÂÃÂ...") on every read — each
// multi-byte Arabic character got split into 2-3 garbage Latin-1 chars.
// This decodes the raw bytes as UTF-8 properly before parsing.
function base64DecodeUtf8(b64: string): string {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new TextDecoder("utf-8").decode(bytes);
}

async function githubWriteState(
  env: Env,
  state: PublishState,
  sha: string | null,
  message: string
): Promise<{ ok: boolean; conflict?: boolean }> {
  const commitMessage = message.includes("[skip ci]") ? message : `${message} [skip ci]`;
  const body: any = {
    message: commitMessage,
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
      "User-Agent": "arw-site-bot",
    },
    body: JSON.stringify(body),
  });
  if (res.status === 409 || res.status === 422) return { ok: false, conflict: true };
  if (!res.ok) return { ok: false };
  return { ok: true };
}

async function githubReadWatcherState(env: Env): Promise<{ sha: string | null; state: { enabled: boolean; processedIds: number[]; lastChecked: string; apiCallsToday?: number; apiCallDate?: string } }> {
  const url = `https://api.github.com/repos/${env.GITHUB_OWNER}/${env.GITHUB_REPO}/contents/watcher-state.json?ref=${env.GITHUB_BRANCH}`;
  const res = await fetch(url, {
    headers: {
      Authorization: `Bearer ${env.GITHUB_TOKEN}`,
      Accept: "application/vnd.github+json",
      "User-Agent": "arw-site-bot",
    },
  });
  if (res.status === 404) return { sha: null, state: { enabled: true, processedIds: [], lastChecked: new Date().toISOString(), apiCallsToday: 0, apiCallDate: new Date().toISOString().slice(0, 10) } };
  if (!res.ok) {
    try {
      const fallbackRes = await fetch(`${env.SITE_ORIGIN}/watcher-state.json?_cb=${Date.now()}`);
      if (fallbackRes.ok) {
        const fallbackData: any = await fallbackRes.json();
        return {
          sha: null,
          state: {
            enabled: fallbackData.enabled !== false,
            processedIds: Array.isArray(fallbackData.processedIds) ? fallbackData.processedIds : [],
            lastChecked: fallbackData.lastChecked || new Date().toISOString(),
            apiCallsToday: typeof fallbackData.apiCallsToday === "number" ? fallbackData.apiCallsToday : 0,
            apiCallDate: fallbackData.apiCallDate || "",
          },
        };
      }
    } catch (e) {}
    const errBody = await res.text().catch(() => "");
    throw new Error(`GitHub read watcher-state failed: ${res.status} ${errBody}`);
  }
  const data: any = await res.json();
  const state = JSON.parse(base64DecodeUtf8(data.content.replace(/\n/g, "")));
  return {
    sha: data.sha,
    state: {
      enabled: state.enabled !== false,
      processedIds: Array.isArray(state.processedIds) ? state.processedIds : [],
      lastChecked: state.lastChecked || new Date().toISOString(),
      apiCallsToday: typeof state.apiCallsToday === "number" ? state.apiCallsToday : 0,
      apiCallDate: state.apiCallDate || "",
    },
  };
}

async function githubWriteWatcherState(
  env: Env,
  state: any,
  sha: string | null,
  message: string
): Promise<{ ok: boolean }> {
  const commitMessage = message.includes("[skip ci]") ? message : `${message} [skip ci]`;
  const url = `https://api.github.com/repos/${env.GITHUB_OWNER}/${env.GITHUB_REPO}/contents/watcher-state.json`;
  const body: any = {
    message: commitMessage,
    content: base64EncodeUtf8(JSON.stringify(state, null, 2)),
    branch: env.GITHUB_BRANCH,
  };
  if (sha) body.sha = sha;
  const res = await fetch(url, {
    method: "PUT",
    headers: {
      Authorization: `Bearer ${env.GITHUB_TOKEN}`,
      Accept: "application/vnd.github+json",
      "Content-Type": "application/json",
      "User-Agent": "arw-site-bot",
    },
    body: JSON.stringify(body),
  });
  return { ok: res.ok };
}

async function githubTriggerWatcherWorkflow(env: Env, postUrl?: string): Promise<{ ok: boolean; status: number; error?: string }> {
  const url = `https://api.github.com/repos/${env.GITHUB_OWNER}/${env.GITHUB_REPO}/actions/workflows/fightful-watcher.yml/dispatches`;
  const body: any = {
    ref: env.GITHUB_BRANCH || "main",
    inputs: postUrl ? { post_url: postUrl } : {},
  };
  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.GITHUB_TOKEN}`,
      Accept: "application/vnd.github+json",
      "Content-Type": "application/json",
      "User-Agent": "arw-site-bot",
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const txt = await res.text().catch(() => "");
    return { ok: false, status: res.status, error: txt };
  }
  return { ok: true, status: res.status };
}

async function githubTriggerReelMonitorWorkflow(env: Env): Promise<{ ok: boolean; status: number; error?: string }> {
  const url = `https://api.github.com/repos/${env.GITHUB_OWNER}/${env.GITHUB_REPO}/actions/workflows/show-reel-monitor.yml/dispatches`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.GITHUB_TOKEN}`,
      Accept: "application/vnd.github+json",
      "Content-Type": "application/json",
      "User-Agent": "arw-site-bot",
    },
    body: JSON.stringify({ ref: env.GITHUB_BRANCH || "main" }),
  });
  if (!res.ok) {
    const txt = await res.text().catch(() => "");
    return { ok: false, status: res.status, error: txt };
  }
  return { ok: true, status: res.status };
}

async function githubTriggerVideoWorkflow(env: Env, slug: string): Promise<{ ok: boolean; status: number; error?: string }> {
  const url = `https://api.github.com/repos/${env.GITHUB_OWNER}/${env.GITHUB_REPO}/actions/workflows/generate-reel.yml/dispatches`;
  const body: any = {
    ref: env.GITHUB_BRANCH || "main",
    inputs: { slug: slug || "latest" },
  };
  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.GITHUB_TOKEN}`,
      Accept: "application/vnd.github+json",
      "Content-Type": "application/json",
      "User-Agent": "arw-site-bot",
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const txt = await res.text().catch(() => "");
    return { ok: false, status: res.status, error: txt };
  }
  return { ok: true, status: res.status };
}

async function githubGetVideosManifest(env: Env): Promise<any[]> {
  try {
    const res = await fetch(
      `https://api.github.com/repos/${env.GITHUB_OWNER}/${env.GITHUB_REPO}/contents/dist/videos/manifest.json?ref=${env.GITHUB_BRANCH || "main"}&_t=${Date.now()}`,
      {
        headers: {
          Authorization: `Bearer ${env.GITHUB_TOKEN}`,
          Accept: "application/vnd.github+json",
          "User-Agent": "arw-site-bot",
        },
      }
    );
    if (!res.ok) return [];
    const data: any = await res.json();
    if (!data.content) return [];
    const content = base64DecodeUtf8(data.content.replace(/\n/g, ""));
    return JSON.parse(content);
  } catch (e) {
    return [];
  }
}

async function githubDeleteVideoFile(env: Env, filename: string): Promise<{ ok: boolean; error?: string }> {
  try {
    const cleanName = filename.split("/").pop() || "";
    if (!cleanName || !cleanName.endsWith(".mp4")) {
      return { ok: false, error: "اسم ملف الفيديو غير صالح" };
    }

    // 1. Get the file SHA from GitHub
    const fileRes = await fetch(
      `https://api.github.com/repos/${env.GITHUB_OWNER}/${env.GITHUB_REPO}/contents/dist/videos/${encodeURIComponent(cleanName)}?ref=${env.GITHUB_BRANCH || "main"}`,
      {
        headers: {
          Authorization: `Bearer ${env.GITHUB_TOKEN}`,
          Accept: "application/vnd.github+json",
          "User-Agent": "arw-site-bot",
        },
      }
    );

    let fileSha: string | null = null;
    if (fileRes.ok) {
      const fileData: any = await fileRes.json();
      fileSha = fileData.sha || null;
    }

    // 2. Delete the file if found
    if (fileSha) {
      const delRes = await fetch(
        `https://api.github.com/repos/${env.GITHUB_OWNER}/${env.GITHUB_REPO}/contents/dist/videos/${encodeURIComponent(cleanName)}`,
        {
          method: "DELETE",
          headers: {
            Authorization: `Bearer ${env.GITHUB_TOKEN}`,
            Accept: "application/vnd.github+json",
            "Content-Type": "application/json",
            "User-Agent": "arw-site-bot",
          },
          body: JSON.stringify({
            message: `chore(video): auto-cleanup published reel ${cleanName} [skip ci]`,
            sha: fileSha,
            branch: env.GITHUB_BRANCH || "main",
          }),
        }
      );
      if (!delRes.ok) {
        const errTxt = await delRes.text().catch(() => "");
        console.warn(`[Video Cleanup] Delete ${cleanName} failed: ${delRes.status} ${errTxt}`);
      }
    }

    // 3. Update manifest.json on GitHub
    const manifestRes = await fetch(
      `https://api.github.com/repos/${env.GITHUB_OWNER}/${env.GITHUB_REPO}/contents/dist/videos/manifest.json?ref=${env.GITHUB_BRANCH || "main"}&_t=${Date.now()}`,
      {
        headers: {
          Authorization: `Bearer ${env.GITHUB_TOKEN}`,
          Accept: "application/vnd.github+json",
          "User-Agent": "arw-site-bot",
        },
      }
    );

    if (manifestRes.ok) {
      const manifestData: any = await manifestRes.json();
      if (manifestData.content && manifestData.sha) {
        let manifest: any[] = [];
        try {
          manifest = JSON.parse(base64DecodeUtf8(manifestData.content.replace(/\n/g, "")));
        } catch (_) {}
        const filtered = manifest.filter((v: any) => v.filename !== cleanName);
        if (filtered.length !== manifest.length) {
          await fetch(
            `https://api.github.com/repos/${env.GITHUB_OWNER}/${env.GITHUB_REPO}/contents/dist/videos/manifest.json`,
            {
              method: "PUT",
              headers: {
                Authorization: `Bearer ${env.GITHUB_TOKEN}`,
                Accept: "application/vnd.github+json",
                "Content-Type": "application/json",
                "User-Agent": "arw-site-bot",
              },
              body: JSON.stringify({
                message: `chore(video): remove ${cleanName} from manifest after cleanup [skip ci]`,
                content: base64EncodeUtf8(JSON.stringify(filtered, null, 2)),
                sha: manifestData.sha,
                branch: env.GITHUB_BRANCH || "main",
              }),
            }
          );
        }
      }
    }

    return { ok: true };
  } catch (err: any) {
    return { ok: false, error: err.message };
  }
}

type Platform = "telegram" | "facebook" | "instagram" | "x";

async function markSendSuccess(env: Env, platform: Platform, key: string): Promise<void> {
  if (!key) return;
  const lockKey = `lock:${platform}:${key}`;
  const failKey = `fail:${platform}:${key}`;
  try {
    await env.PUSH_KV.delete(lockKey);
    await env.PUSH_KV.delete(failKey);
  } catch (e) {}

  for (let attempt = 0; attempt < 5; attempt++) {
    let sha: string | null;
    let state: PublishState;
    try {
      ({ sha, state } = await githubReadState(env));
    } catch (e: any) {
      return;
    }
    if (state[platform]?.[key]) return; // already marked

    state[platform][key] = Date.now();
    if (state.deferrals) delete state.deferrals[`${platform}:${key}`];
    const write = await githubWriteState(env, state, sha, `chore(publish): mark ${platform} sent — ${key}`);
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
      const result: any = await tgRes.json().catch(() => ({ ok: false, ambiguous: true }));
      if (result.ok || result.ambiguous || tgRes.status >= 500) return { ...result, ambiguous: !result.ok };
    } catch (e) {
      return { ok: false, ambiguous: true };
    }
  }

  const payload = { chat_id: env.TELEGRAM_CHAT_ID, text: messageHtml, parse_mode: "HTML", disable_web_page_preview: false };
  const tgRes = await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const result: any = await tgRes.json().catch(() => ({ ok: false, ambiguous: true }));
  if (tgRes.status >= 500) result.ambiguous = true;
  return result as { ok: boolean; [k: string]: any };
}

// ─────────────────────────────────────────────────────────────────────────
// Buffer daily-posting-limit cooldown (Facebook / X only — Buffer enforces
// this per-channel, not per-post).
//
// Without this, hitting Buffer's daily cap meant: the claim gets released,
// so the very next watcher tick (a minute later) tries again — creating a
// BRAND NEW Buffer post that fails the exact same way, every minute, for
// the rest of the day. That's ~1,400 wasted Buffer API calls/day per
// channel and a queue full of duplicate failed posts on Buffer's side, for
// zero benefit (Buffer's own limit doesn't reset any faster for it).
//
// Once this specific error is seen, the affected channel is put in a
// cooldown stored in KV until the next UTC day (+ a little random jitter
// so multiple queued items don't all retry in the same instant). While in
// cooldown, publishToPlatform skips the platform entirely — no GitHub
// claim, no Buffer call — so the item is picked back up and *actually
// posted* automatically once the cooldown ends, without spamming anything
// in the meantime.
// ─────────────────────────────────────────────────────────────────────────

const DAILY_LIMIT_ERROR_RE = /daily posting limit/i;

function isDailyLimitMessage(msg: unknown): boolean {
  return typeof msg === "string" && DAILY_LIMIT_ERROR_RE.test(msg);
}

function detectBufferRateLimit(result: any): boolean {
  if (!result) return false;
  if (typeof result === "string") {
    return /daily posting limit|rate limit|too many requests|rate_limit_exceeded/i.test(result);
  }
  if (Array.isArray(result.errors)) {
    for (const err of result.errors) {
      if (err?.extensions?.code === "RATE_LIMIT_EXCEEDED") return true;
      if (typeof err?.message === "string" && /too many requests|rate limit|daily posting limit/i.test(err.message)) return true;
    }
  }
  const createPostMsg = result?.data?.createPost?.message;
  if (typeof createPostMsg === "string" && /daily posting limit|rate limit|too many requests/i.test(createPostMsg)) {
    return true;
  }
  const errorMsg = result?.error?.message;
  if (typeof errorMsg === "string" && /daily posting limit|rate limit|too many requests/i.test(errorMsg)) {
    return true;
  }
  return false;
}

function extractBufferRateLimitDuration(result: any): number {
  if (Array.isArray(result?.errors)) {
    for (const err of result.errors) {
      if (err?.extensions?.window === "24h") return 24 * 60 * 60 * 1000;
      if (err?.extensions?.window === "12h") return 12 * 60 * 60 * 1000;
      if (err?.extensions?.window === "1h") return 60 * 60 * 1000;
    }
  }
  return 24 * 60 * 60 * 1000;
}

async function getPlatformCooldownUntil(env: Env, platform: "facebook" | "instagram" | "x"): Promise<number> {
  try {
    const { state } = await githubReadState(env);
    return state.cooldowns?.[platform] || 0;
  } catch (e) {
    return 0;
  }
}

async function setPlatformCooldown(env: Env, platform: "facebook" | "instagram" | "x", durationMs: number): Promise<void> {
  const now = Date.now();
  const until = now + durationMs;

  for (let attempt = 0; attempt < 5; attempt++) {
    let sha: string | null;
    let state: PublishState;
    try {
      ({ sha, state } = await githubReadState(env));
    } catch (e) {
      return;
    }
    const existing = state.cooldowns?.[platform] || 0;
    if (existing >= until - 60_000) return;

    state.cooldowns = {
      ...state.cooldowns,
      [platform]: Math.max(existing, until),
    };
    const write = await githubWriteState(
      env,
      state,
      sha,
      `chore(publish): pause ${platform} until ${new Date(until).toISOString()} (rate limit cooldown)`
    );
    if (write.ok) {
      console.log(`[Publish] paused ${platform} until ${new Date(until).toISOString()}`);
      return;
    }
    if (write.conflict) {
      await new Promise((r) => setTimeout(r, 400 + Math.random() * 400));
      continue;
    }
    return;
  }
}

async function setPlatformDailyLimitCooldown(env: Env, platform: "facebook" | "instagram" | "x"): Promise<void> {
  const durationMs = platform === "facebook" ? 2 * 60 * 60 * 1000 : (platform === "instagram" ? 6 * 60 * 60 * 1000 : 24 * 60 * 60 * 1000);
  await setPlatformCooldown(env, platform, durationMs);
}

async function setBufferRateLimitCooldown(env: Env, durationMs: number = 24 * 60 * 60 * 1000): Promise<void> {
  await setPlatformCooldown(env, "x", durationMs);
}

// Buffer sends its live quota on every authenticated response as a
// RateLimit header — one entry per window (15-minute, 24-hour, 30-day on
// the Free plan), e.g.:
//   RateLimit: "100-in-15min";r=98;t=897, "250-in-1day";r=248;t=86397, "3000-in-30days";r=2969;t=696980
// r = requests remaining in that window, t = seconds until it resets.
// Reading this after every call and checking it before the next one lets a
// post be skipped before Buffer would reject it, instead of only finding
// out from an error message after the fact (see Buffer's own guidance:
// https://developers.buffer.com/guides/api-limits.html).
function parseBufferRateLimitHeader(headerValue: string | null): { remaining: number; resetAt: number; window: string }[] {
  if (!headerValue) return [];
  const now = Date.now();
  const entries: { remaining: number; resetAt: number; window: string }[] = [];
  // fetch() joins repeated headers with ", " — split back into each quoted policy.
  for (const part of headerValue.split(/,\s*(?=")/)) {
    const windowMatch = part.match(/^"([^"]+)"/);
    const rMatch = part.match(/[;\s]r=(\d+)/);
    const tMatch = part.match(/[;\s]t=(\d+)/);
    if (!windowMatch || !rMatch || !tMatch) continue;
    entries.push({ window: windowMatch[1], remaining: Number(rMatch[1]), resetAt: now + Number(tMatch[1]) * 1000 });
  }
  return entries;
}

async function recordBufferQuota(env: Env, res: Response): Promise<void> {
  const entries = parseBufferRateLimitHeader(res.headers.get("ratelimit"));
  if (!entries.length) return;
  const withTimestamp = entries.map((e) => ({ ...e, updatedAt: Date.now() }));

  // Best-effort only: a missed quota reading just means the next call's
  // reading is used instead. It must never throw — this runs inline in
  // every Buffer post attempt, and an uncaught error here would abort
  // that article's publish for every remaining platform this tick.
  try {
    for (let attempt = 0; attempt < 3; attempt++) {
      let sha: string | null;
      let state: PublishState;
      try {
        ({ sha, state } = await githubReadState(env));
      } catch (e) {
        return;
      }
      const write = await githubWriteState(env, { ...state, bufferQuota: withTimestamp }, sha, "chore(publish): record Buffer API quota [skip ci]");
      if (write.ok) return;
      if (write.conflict) {
        await new Promise((r) => setTimeout(r, 300 + Math.random() * 300));
        continue;
      }
      return;
    }
  } catch (e) {
    console.error("[Buffer] Failed to record API quota (non-fatal):", e);
  }
}

// A window only counts against the safety margin while its reset time is
// still in the future — a stale, long-since-reset reading must never block
// a post indefinitely just because it was never overwritten.
async function hasBufferQuota(env: Env, safetyMargin: number = 5): Promise<boolean> {
  try {
    const { state } = await githubReadState(env);
    const entries = state.bufferQuota;
    if (!entries || !entries.length) return true; // no reading yet — don't block on nothing
    const now = Date.now();
    return entries.every((e) => e.resetAt < now || e.remaining > safetyMargin);
  } catch (e) {
    return true; // can't check — fail open rather than blocking all publishing
  }
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

// Buffer's createPost mutation with mode: shareNow returns as soon as the
// post is ACCEPTED AND QUEUED on Buffer's side — not once it's actually
// been sent to the destination network. The real send happens
// asynchronously afterwards, and can fail silently on Buffer's end (a
// channel set to "Requires Approval", a rate limit, a disconnected/expired
// connection to Facebook or X, etc). Trusting the createPost response alone
// is what let this code mark posts "sent" in publish-state.json when
// nothing had actually gone out.
//
// This polls the post's real status (Post.sentAt / Post.error) the same
// way postToInstagram polls Meta's own container status before trusting a
// publish. Three outcomes:
//   - sentAt appears  -> genuinely published, ok: true
//   - error appears   -> Buffer itself reports the send failed, ok: false
//   - neither, after the polling window -> still unresolved. Rather than
//     guess, this is reported ambiguous (matches postToInstagram's
//     "Action is blocked" handling) so the caller leaves the claim in
//     place instead of releasing it and risking a duplicate post on retry.
async function pollBufferPostUntilResolved(
  env: Env,
  postId: string
): Promise<{ resolved: boolean; ok?: boolean; raw?: any }> {
  const query = `query GetPost($id: PostId!) {
    post(input: { id: $id }) {
      id
      status
      sentAt
      error { message }
    }
  }`;
  for (let attempt = 0; attempt < 2; attempt++) {
    await new Promise((r) => setTimeout(r, 4000));
    try {
      const res = await fetch("https://api.buffer.com", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${env.BUFFER_API_KEY}` },
        body: JSON.stringify({ query, variables: { id: postId } }),
      });
      await recordBufferQuota(env, res);
      const result: any = await res.json().catch(() => ({}));
      const post = result?.data?.post;
      if (post?.sentAt) return { resolved: true, ok: true, raw: post };
      if (post?.error) return { resolved: true, ok: false, raw: post };
    } catch (e) {
      // network hiccup on this attempt — try again next loop iteration
    }
  }
  return { resolved: false };
}

// Posts to Facebook via Buffer — reverted from the brief direct-Graph-API
// experiment. Direct posting worked technically (Graph API accepted the
// posts, they appeared on the Page) but stayed invisible to the public
// Posts to Facebook directly via Meta Graph API (photo post without outbound link for maximum organic reach and SEO brand authority)
async function postToFacebookDirect(
  env: Env,
  key: string,
  data: { title: string; text?: string; image?: string; url?: string; kind?: string }
): Promise<{ ok: boolean; result?: any; skipped?: boolean; ambiguous?: boolean }> {
  if (!env.FACEBOOK_PAGE_ACCESS_TOKEN || !env.FACEBOOK_PAGE_ID) return { ok: false, skipped: true };

  const caption = buildFacebookCaption(data.title, data.text, data.kind);

  try {
    const pageToken = await getPageAccessToken(env);
    const imageUrl = data.image ? (data.image.startsWith("http") ? data.image : env.SITE_ORIGIN + data.image) : undefined;

    // Per the site owner: post the article's own image natively, not a
    // link-preview card. /photos with a remote url has Facebook fetch and
    // host the image itself (no outbound link attached to the post at all).
    // Falls back to a plain link post only on the rare article with no image.
    const endpoint = imageUrl
      ? `https://graph.facebook.com/${GRAPH_API_VERSION}/${env.FACEBOOK_PAGE_ID}/photos`
      : `https://graph.facebook.com/${GRAPH_API_VERSION}/${env.FACEBOOK_PAGE_ID}/feed`;
    const body = imageUrl
      ? { caption, url: imageUrl, access_token: pageToken }
      : { message: caption, link: data.url, access_token: pageToken };

    let res: Response;
    try {
      res = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
    } catch (e) {
      return { ok: false, ambiguous: true };
    }

    const result: any = await res.json().catch(() => ({ __unparsed: true }));
    if (result.id || result.post_id) {
      return { ok: true, result };
    }

    const errCode = result?.error?.code;
    const errSubcode = result?.error?.error_subcode;
    const isThrottled = [4, 17, 32, 613].includes(errCode) || errSubcode === 2207051;
    if (isThrottled) await setPlatformDailyLimitCooldown(env, "facebook");
    if (result.__unparsed) return { ok: false, result, ambiguous: true };

    return { ok: false, result };
  } catch (e) {
    return { ok: false };
  }
}

async function postToInstagram(
  env: Env,
  key: string,
  data: { title: string; text?: string; url: string; imageUrl?: string; kind?: string }
): Promise<{ ok: boolean; result?: any; skipped?: boolean; ambiguous?: boolean }> {
if (!env.INSTAGRAM_BUSINESS_ACCOUNT_ID || !env.FACEBOOK_PAGE_ACCESS_TOKEN) {
  return { ok: false, skipped: true };
}
if (!data.imageUrl) return { ok: false, skipped: true };

const safeImageUrl = instagramSafeImageUrl(data.imageUrl);

const caption = buildInstagramCaption(data.title, data.text, data.kind);
const kvKey = `ig-pending:${key}`;

  try {
    const pageToken = await getPageAccessToken(env);

    // Reuse an in-progress media container from an earlier attempt instead
    // of creating a brand new one every retry. In practice Instagram's own
    // processing was routinely taking longer than any short polling window
    // this function used, so nearly every attempt gave up, discarded the
    // container it had just started, and tried again a minute later from
    // zero — which both wasted the processing time already spent AND
    // uploaded the same image to Meta's API again and again, every single
    // minute, for as long as 15+ minutes on some posts. That volume of
    // repeated requests for identical content is very likely what tripped
    // Meta's own automated abuse detection ("Action is blocked"). Caching
    // the container id lets a retry pick up exactly where the last attempt
    // left off.
    let containerId: string | null = null;
    try {
      const cached = await env.PUSH_KV.get(kvKey);
      if (cached) {
        const parsed = JSON.parse(cached);
        if (parsed.imageUrl === safeImageUrl && Date.now() - parsed.createdAt < 20 * 60 * 1000) {
          containerId = parsed.id;
        }
      }
    } catch (e) {}

    if (!containerId) {
      const createRes = await fetch(
        `https://graph.facebook.com/${GRAPH_API_VERSION}/${env.INSTAGRAM_BUSINESS_ACCOUNT_ID}/media`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ image_url: safeImageUrl, caption, access_token: pageToken }),
        }
      );
      const createResult: any = await createRes.json().catch(() => ({}));
      if (!createResult.id) {
        const errCode = createResult?.error?.code;
        const errSubcode = createResult?.error?.error_subcode;
        const isThrottled = [4, 9, 17, 32, 613].includes(errCode) || errSubcode === 2207069 || errSubcode === 2207051;
        if (isThrottled) {
          await setPlatformDailyLimitCooldown(env, "instagram");
        }
        return { ok: false, result: createResult };
      }
      containerId = createResult.id;
      try {
        await env.PUSH_KV.put(
          kvKey,
          JSON.stringify({ id: containerId, imageUrl: safeImageUrl, createdAt: Date.now() }),
          { expirationTtl: 3600 }
        );
      } catch (e) {}
    }

    // Poll for a while within this single invocation; if it's still not
    // ready when this gives up, the cached container id above means next
    // minute's retry resumes polling the SAME container instead of
    // starting a new upload.
    let ready = false;
    for (let attempt = 0; attempt < 10; attempt++) {
      await new Promise((r) => setTimeout(r, 3000));
      const statusRes = await fetch(
        // `status` (in addition to `status_code`) gives Meta's human-readable
        // reason when processing fails — plain `status_code` alone only says
        // "ERROR" with no way to tell why, which made every past failure a
        // dead end to debug.
        `https://graph.facebook.com/${GRAPH_API_VERSION}/${containerId}?fields=status_code,status&access_token=${pageToken}`
      );
      const statusResult: any = await statusRes.json().catch(() => ({}));
      if (statusResult.status_code === "FINISHED") {
        ready = true;
        break;
      }
      if (statusResult.status_code === "ERROR") {
        try { await env.PUSH_KV.delete(kvKey); } catch (e) {}
        return { ok: false, result: statusResult };
      }
    }
    if (!ready) return { ok: false }; // container id stays cached — next tick resumes it, doesn't restart

    // This call is the actual point of no return — once Meta receives it,
    // the post may already be live even if the response never makes it
    // back to us (a Workers network hiccup, a timeout, etc). If that
    // happens, the caller must NOT release the claim and retry, or the
    // same image gets posted again next minute — which is exactly what
    // was causing Instagram to publish the same photo repeatedly.
    let publishRes: Response;
    try {
      publishRes = await fetch(
        `https://graph.facebook.com/${GRAPH_API_VERSION}/${env.INSTAGRAM_BUSINESS_ACCOUNT_ID}/media_publish`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ creation_id: containerId, access_token: pageToken }),
        }
      );
    } catch (e) {
      return { ok: false, ambiguous: true };
    }
    const publishResult: any = await publishRes.json().catch(() => ({ __unparsed: true }));
    if (publishResult.id) {
      try { await env.PUSH_KV.delete(kvKey); } catch (e) {}
      return { ok: true, result: publishResult };
    }

    // "Action is blocked" (error code 4 / subcode 2207051) is Meta's
    // automated spam-prevention throttle, not a normal per-post rejection.
    // Releasing the claim and letting the watcher hammer the endpoint
    // again a minute later only adds to the activity Meta is already
    // flagging, and risks a duplicate if the post actually went through
    // before the restriction kicked in. Treat it as needing a human to
    // check the account instead of an automatic retry.
    const errCode = publishResult?.error?.code;
    const errSubcode = publishResult?.error?.error_subcode;
    const isBlocked = [4, 9, 17, 32, 613].includes(errCode) || errSubcode === 2207051 || errSubcode === 2207069;
    if (isBlocked) {
      await setPlatformDailyLimitCooldown(env, "instagram");
      return { ok: false, result: publishResult, ambiguous: true };
    }
    if (publishResult.__unparsed) return { ok: false, result: publishResult, ambiguous: true };

    // A clean rejection of the container itself (not a throttle) — it's
    // genuinely invalid, so clear the cache rather than let a retry poll
    // the same doomed container forever.
    try { await env.PUSH_KV.delete(kvKey); } catch (e) {}
    return { ok: false, result: publishResult };
  } catch (e) {
    return { ok: false };
  }
}

// ─────────────────────────────────────────────────────────────────────────
// Curated Stories: Instagram & Facebook Stories (9:16 Vertical Ratio)
// ─────────────────────────────────────────────────────────────────────────

function storyImageUrl(imageUrl: string): string {
  const clean = imageUrl.replace(/^https?:\/\//, "");
  return `https://wsrv.nl/?url=${encodeURIComponent(clean)}&w=1080&h=1920&fit=contain&bg=0f1115&output=jpg&q=90`;
}

function isStoryWorthy(item: { title: string; kind?: string }): boolean {
  if (item.kind === "show" || item.kind === "recap") return true;
  const title = (item.title || "").trim();
  if (isResultsArticle(title)) return true;
  if (/\b(?:مترجم|كامل|ملخص|تغطية|مشاهدة عرض)\b/i.test(title)) return true;
  if (/^(?:عاجل|رسمياً|مفاجأة|صدمة|تتويج|تاريخي)\b/i.test(title)) return true;
  return false;
}

async function postToInstagramStory(
  env: Env,
  data: { imageUrl?: string }
): Promise<{ ok: boolean; result?: any }> {
  if (!env.INSTAGRAM_BUSINESS_ACCOUNT_ID || !env.FACEBOOK_PAGE_ACCESS_TOKEN) return { ok: false };
  if (!data.imageUrl) return { ok: false };

  const sUrl = storyImageUrl(data.imageUrl);

  try {
    const pageToken = await getPageAccessToken(env);
    const createRes = await fetch(
      `https://graph.facebook.com/${GRAPH_API_VERSION}/${env.INSTAGRAM_BUSINESS_ACCOUNT_ID}/media`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          image_url: sUrl,
          media_type: "STORIES",
          access_token: pageToken,
        }),
      }
    );
    const createResult: any = await createRes.json().catch(() => ({}));
    if (!createResult.id) return { ok: false, result: createResult };

    const containerId = createResult.id;

    for (let i = 0; i < 3; i++) {
      await new Promise((r) => setTimeout(r, 3000));
      const statusRes = await fetch(
        `https://graph.facebook.com/${GRAPH_API_VERSION}/${containerId}?fields=status_code,status&access_token=${pageToken}`
      );
      const statusData: any = await statusRes.json().catch(() => ({}));
      if (statusData.status_code === "FINISHED") break;
      if (statusData.status_code === "ERROR") return { ok: false, result: statusData };
    }

    const pubRes = await fetch(
      `https://graph.facebook.com/${GRAPH_API_VERSION}/${env.INSTAGRAM_BUSINESS_ACCOUNT_ID}/media_publish`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          creation_id: containerId,
          access_token: pageToken,
        }),
      }
    );
    const pubResult: any = await pubRes.json().catch(() => ({}));
    if (pubResult.id) return { ok: true, result: pubResult };
    return { ok: false, result: pubResult };
  } catch (e) {
    return { ok: false };
  }
}

async function postToFacebookStory(
  env: Env,
  data: { imageUrl?: string }
): Promise<{ ok: boolean; result?: any }> {
  if (!env.FACEBOOK_PAGE_ACCESS_TOKEN || !env.FACEBOOK_PAGE_ID) return { ok: false };
  if (!data.imageUrl) return { ok: false };

  const sUrl = storyImageUrl(data.imageUrl);

  try {
    const pageToken = await getPageAccessToken(env);

    const uploadRes = await fetch(
      `https://graph.facebook.com/${GRAPH_API_VERSION}/${env.FACEBOOK_PAGE_ID}/photos`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          url: sUrl,
          published: false,
          access_token: pageToken,
        }),
      }
    );
    const uploadResult: any = await uploadRes.json().catch(() => ({}));
    if (!uploadResult.id) return { ok: false, result: uploadResult };

    const storyRes = await fetch(
      `https://graph.facebook.com/${GRAPH_API_VERSION}/${env.FACEBOOK_PAGE_ID}/photo_stories`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          photo_id: uploadResult.id,
          access_token: pageToken,
        }),
      }
    );
    const storyResult: any = await storyRes.json().catch(() => ({}));
    if (storyResult.id || storyResult.post_id) return { ok: true, result: storyResult };
    return { ok: false, result: storyResult };
  } catch (e) {
    return { ok: false };
  }
}

// ─────────────────────────────────────────────────────────────────────────
// On-Demand Manual Video Publishing: Telegram, Facebook Reels/Story, Instagram Reels/Story
// ─────────────────────────────────────────────────────────────────────────

function buildReelCaption(title: string, postUrl?: string): string {
  const cleanTitle = (title || "").trim();
  const linkText = postUrl ? `\n\n🔗 التفاصيل والتحليلات الكاملة على موقع عرب راسلنج` : "";
  const hashtags = "\n\n#مصارعة_المحترفين #عرب_راسلنج #wwe #wrestling #مصارعة #أخبار_المصارعة";
  return `${cleanTitle}${linkText}${hashtags}`;
}

function buildTelegramVideoCaption(title: string, postUrl?: string): string {
  const safeTitle = escapeTelegramHtml((title || "").trim());
  const siteUrl = postUrl ? normalizeArticleUrl(postUrl) : "https://arab-wrestling.com";
  const safeUrl = escapeTelegramHtml(siteUrl);
  return `🎬 <b>${safeTitle}</b>\n\n🔗 <a href="${safeUrl}"><b>اقرأ التغطية والتحليل الكامل على عرب راسلنج</b></a>\n\n#عرب_راسلنج #WWE #المصارعة`;
}

async function postVideoToTelegram(
  env: Env,
  data: { videoUrl: string; title: string; postUrl?: string }
): Promise<{ ok: boolean; result?: any; error?: string }> {
  if (!env.TELEGRAM_BOT_TOKEN || !env.TELEGRAM_CHAT_ID) {
    return { ok: false, error: "Telegram credentials missing in Worker" };
  }

  const caption = buildTelegramVideoCaption(data.title, data.postUrl);

  try {
    // 1. Try URL-based submission first
    const payload = {
      chat_id: env.TELEGRAM_CHAT_ID,
      video: data.videoUrl,
      caption,
      parse_mode: "HTML",
      supports_streaming: true,
    };
    const res = await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendVideo`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const result: any = await res.json().catch(() => ({}));
    if (result.ok) return { ok: true, result };

    // 2. Fallback: Download and send as multipart FormData
    const videoRes = await fetch(data.videoUrl);
    if (videoRes.ok) {
      const blob = await videoRes.blob();
      const formData = new FormData();
      formData.append("chat_id", env.TELEGRAM_CHAT_ID);
      formData.append("video", blob, "reel.mp4");
      formData.append("caption", caption);
      formData.append("parse_mode", "HTML");
      formData.append("supports_streaming", "true");

      const formRes = await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendVideo`, {
        method: "POST",
        body: formData,
      });
      const formResult: any = await formRes.json().catch(() => ({}));
      if (formResult.ok) return { ok: true, result: formResult };
      return { ok: false, result: formResult, error: formResult.description || "فشل رفع الفيديو لتليجرام" };
    }

    return { ok: false, result, error: result.description || "فشل إرسال الفيديو لتليجرام" };
  } catch (e: any) {
    return { ok: false, error: e.message || "خطأ أثناء الاتصال بتليجرام" };
  }
}

async function setVideoCooldown(env: Env, platform: "facebook" | "instagram") {
  for (let i = 0; i < 5; i++) {
    const { sha, state } = await githubReadState(env);
    state.videoCooldowns = { ...state.videoCooldowns, [platform]: Date.now() + 24 * 60 * 60_000 };
    const result = await githubWriteState(env, state, sha, `chore(publish): pause ${platform} videos after platform restriction`);
    if (result.ok) return;
    if (!result.conflict) throw new Error("Could not save video platform cooldown");
  }
  throw new Error("Could not save video platform cooldown after conflicts");
}

async function postVideoToFacebookReel(env: Env, data: { videoUrl: string; title: string; postUrl?: string }) {
  return publishFacebookVideo({ pageId: env.FACEBOOK_PAGE_ID, token: await getPageAccessToken(env),
    videoUrl: data.videoUrl, caption: buildReelCaption(data.title, data.postUrl), story: false });
}
async function postVideoToFacebookStory(env: Env, data: { videoUrl: string; imageUrl?: string }) {
  return publishFacebookVideo({ pageId: env.FACEBOOK_PAGE_ID, token: await getPageAccessToken(env), videoUrl: data.videoUrl, story: true });
}
async function postVideoToInstagramReel(env: Env, data: { videoUrl: string; title: string; postUrl?: string }) {
  return publishInstagramVideo({ accountId: env.INSTAGRAM_BUSINESS_ACCOUNT_ID, token: await getPageAccessToken(env),
    videoUrl: data.videoUrl, caption: buildReelCaption(data.title, data.postUrl), story: false, kv: env.PUSH_KV });
}
async function postVideoToInstagramStory(env: Env, data: { videoUrl: string; imageUrl?: string }) {
  return publishInstagramVideo({ accountId: env.INSTAGRAM_BUSINESS_ACCOUNT_ID, token: await getPageAccessToken(env),
    videoUrl: data.videoUrl, story: true, kv: env.PUSH_KV });
}

// Posts to X (Twitter) via Buffer's GraphQL API instead of X's own API —
// see the BUFFER_API_KEY comment on Env for why. "mode: shareNow" publishes
// immediately instead of dropping into Buffer's queue for a scheduled slot
// (which is what "addToQueue" does, and why an earlier version of this
// looked like it "worked" — Buffer accepted it — but nothing appeared on
// X until the next queued time slot).
async function postToXViaBuffer(
  env: Env,
  key: string,
  data: { title: string; text?: string; image?: string }
): Promise<{ ok: boolean; result?: any; skipped?: boolean; ambiguous?: boolean }> {
  if (!env.BUFFER_API_KEY || !env.BUFFER_X_CHANNEL_ID) return { ok: false, skipped: true };
  if (!(await hasBufferQuota(env))) return { ok: false, skipped: true, result: { skippedReason: "buffer_quota_exhausted" } };

  const kvKey = `buffer-pending:x:${key}`;

  let postId: string | null = null;
  try {
    const cached = await env.PUSH_KV.get(kvKey);
    if (cached) {
      const parsed = JSON.parse(cached);
      if (Date.now() - parsed.createdAt < 30 * 60 * 1000) postId = parsed.id;
    }
  } catch (e) {}

  if (!postId) {
    // The title is always kept in full; only the article snippet gets
    // shortened (or dropped) to fit X's real 280 character limit. X's own
    // link-unfurl preview triggers the same kind of reach suppression
    // Facebook does for outbound links, so the URL is dropped entirely
    // rather than routed around it.
    const tweetText = buildXCaption(data.title, data.text);
    const imageUrl = data.image ? (data.image.startsWith("http") ? data.image : env.SITE_ORIGIN + data.image) : undefined;

    try {
      const query = imageUrl
        ? `mutation PostToX($text: String!, $channelId: ChannelId!, $imageUrl: String!) {
            createPost(input: { text: $text, channelId: $channelId, schedulingType: automatic, mode: shareNow, assets: [{ image: { url: $imageUrl } }] }) {
              ... on PostActionSuccess { post { id } }
              ... on MutationError { message }
            }
          }`
        : `mutation PostToX($text: String!, $channelId: ChannelId!) {
            createPost(input: { text: $text, channelId: $channelId, schedulingType: automatic, mode: shareNow }) {
              ... on PostActionSuccess { post { id } }
              ... on MutationError { message }
            }
          }`;
      const variables = imageUrl
        ? { text: tweetText, channelId: env.BUFFER_X_CHANNEL_ID, imageUrl }
        : { text: tweetText, channelId: env.BUFFER_X_CHANNEL_ID };

      const res = await fetch("https://api.buffer.com", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${env.BUFFER_API_KEY}` },
        body: JSON.stringify({ query, variables }),
      });
      await recordBufferQuota(env, res);
      const result: any = await res.json().catch(() => ({}));
      postId = result?.data?.createPost?.post?.id;
      if (!postId) {
        if (detectBufferRateLimit(result)) {
          const dur = extractBufferRateLimitDuration(result);
          await setBufferRateLimitCooldown(env, dur);
        }
        return { ok: false, result };
      }
      try {
        await env.PUSH_KV.put(kvKey, JSON.stringify({ id: postId, createdAt: Date.now() }), { expirationTtl: 3600 });
      } catch (e) {}
    } catch (e) {
      return { ok: false };
    }
  }

  const outcome = await pollBufferPostUntilResolved(env, postId);
  if (!outcome.resolved) return { ok: false, ambiguous: true }; // keep cached id, keep claim — resume next tick
  try {
    await env.PUSH_KV.delete(kvKey);
  } catch (e) {}
  if (!outcome.ok && detectBufferRateLimit(outcome.raw)) {
    const dur = extractBufferRateLimitDuration(outcome.raw);
    await setBufferRateLimitCooldown(env, dur);
  }
  return { ok: !!outcome.ok, result: outcome.raw };
}

// ─────────────────────────────────────────────────────────────────────────
// Publish-to-one-platform orchestration, shared by the watcher and the
// manual-publish endpoint. `force=true` bypasses an existing claim (used
// only by the admin "force re-publish" checkbox).
// ─────────────────────────────────────────────────────────────────────────

async function deferPublication(env: Env, platform: Platform, key: string, uncertain: boolean) {
  for (let i = 0; i < 3; i++) {
    const { sha, state } = await githubReadState(env);
    // Unknown sends need a human check. Definite failures are eligible again in five minutes.
    state.deferrals = { ...state.deferrals, [`${platform}:${key}`]: uncertain ? 8640000000000000 : Date.now() + 5 * 60_000 };
    const result = await githubWriteState(env, state, sha, `chore(publish): defer ${platform} delivery`);
    if (result.ok) return;
    if (!result.conflict) throw new Error("Could not save publication retry delay");
  }
  throw new Error("Could not save publication retry delay");
}

async function publishToPlatform(
  env: Env, platform: Platform, key: string,
  item: { title: string; text?: string; url: string; image?: string; kind?: string },
  verified: { imageBuffer?: ArrayBuffer; imageContentType?: string }, force: boolean,
): Promise<{ status: string; raw?: any }> {
  // Fail closed if state cannot be read; absence of a read is not permission to resend.
  const { state } = await githubReadState(env);
  if (!force && state[platform]?.[key]) return { status: "already_sent" };
  if (!force && platform !== "telegram" && (state.cooldowns?.[platform] || 0) > Date.now()) return { status: "rate_limited" };
  const result = await deliverOnce(env, `post:${platform}:${key}`, async () => {
    const r = await sendToPlatform(env, platform, key, item, verified, force);
    return { ok: r.status === "sent", status: r.status, ambiguous: r.status === "uncertain",
      error: r.status !== "sent" ? (r.raw?.error?.message || r.raw?.result?.error?.message || r.status) : undefined };
  }, { force });
  if (result.ok) {
    await markSendSuccess(env, platform, key);
    return { status: result.status === "already_sent" ? "already_sent" : "sent" };
  }
  // deferPublication can throw after exhausting its retries on a persistent
  // GitHub write conflict. Left uncaught, that exception propagates out of
  // the whole watcher tick and aborts every other article queued behind
  // this one — one stuck item then silently starves all publishing, every
  // tick, since the loop re-picks the same oldest not-yet-done item each
  // time. Never let a failed defer turn into a failure to publish anything.
  try {
    await deferPublication(env, platform, key, !!result.ambiguous);
  } catch (e) {
    console.error(`[Publish] Failed to save retry delay for ${platform}:${key}:`, e);
  }
  return { status: result.ambiguous ? "uncertain" : result.status || "failed", raw: { error: { message: result.error } } };
}

async function sendToPlatform(
  env: Env,
  platform: Platform,
  key: string,
  item: { title: string; text?: string; url: string; image?: string; kind?: string },
  verified: { imageBuffer?: ArrayBuffer; imageContentType?: string },
  force: boolean
): Promise<{ status: string; raw?: any }> {
  let ok = false;
  let skipped = false;
  let ambiguous = false;
  let raw: any;

  if (platform === "telegram") {
    const r = await sendVerifiedTelegramPost(env, item, verified.imageBuffer, verified.imageContentType);
    ok = !!(r && r.ok);
    ambiguous = !!r?.ambiguous;
    raw = r;
  } else if (platform === "facebook") {
    // Direct Meta Graph API only — free, unlimited, instant, 100% public.
    // No Buffer fallback: Buffer's quota is shared with X (one API key for
    // both), so any Facebook traffic through it eats into X's budget too.
    // Per the site owner: Buffer is for X only, full stop.
    const directR = await postToFacebookDirect(env, key, item);
    ok = directR.ok;
    ambiguous = !!directR.ambiguous;
    raw = directR.result;
  } else if (platform === "instagram") {
    const imageUrl = item.image ? (item.image.startsWith("http") ? item.image : env.SITE_ORIGIN + item.image) : undefined;
    const r = await postToInstagram(env, key, { ...item, imageUrl });
    ok = r.ok;
    skipped = !!r.skipped;
    ambiguous = !!(r as any).ambiguous;
    raw = r.result;
  } else {
    const r = await postToXViaBuffer(env, key, item);
    ok = r.ok;
    skipped = !!r.skipped;
    ambiguous = !!r.ambiguous;
    raw = r.result;
  }

  if (ok) {
    return { status: "sent" };
  }

  // An ambiguous outcome means we genuinely don't know whether the post
  // went live on the platform's side (network error right at the publish
  // call, or an account-level throttle). Releasing the claim here would
  // let the next watcher tick retry and risk posting the same content
  // again — so this is left claimed and reported as "uncertain" instead,
  // for a human to check and clear manually if it really did fail.
  if (ambiguous) return { status: "uncertain", raw };

  return { status: skipped ? "not_configured" : "failed", raw };
}

// ─────────────────────────────────────────────────────────────────────────
// Watcher — runs on the cron trigger, once a minute.
// ─────────────────────────────────────────────────────────────────────────

function sanitizeResultsTitleSpoilers(title: string): string {
  if (!title) return title;
  let clean = title;
  clean = clean.replace(/([^\s:،()]+(?:\s+[^\s:،()]+){0,3})\s+(?:يهزم|يهزمان|يهزمن|يسقط|يتفوق على|ينتصر على|يتغلب على)\s+([^\s:،()]+(?:\s+[^\s:،()]+){0,3})/g, "مواجهة نارية بين $1 و$2");
  clean = clean.replace(/فوز\s+(?:مثير|كبير|مستحق|صادم|تاريخي)?\s*لـ?([^\s:،()]+(?:\s+[^\s:،()]+){0,3})\s+(?:على|أمام)\s+([^\s:،()]+(?:\s+[^\s:،()]+){0,3})/g, "مواجهة قوية بين $1 و$2");
  clean = clean.replace(/فوز\s+(?:مثير|كبير|مستحق|صادم|تاريخي)\s*لـ?/g, "نزال ناري لـ");
  clean = clean.replace(/و?(?:يحتفظ|يحافظ)\s+(?:بلقبه|باللقب|ببطولة|على لقبه|على اللقب|على بطولة)\s*/g, "وصراع مشتعل على لقب ");
  clean = clean.replace(/و?(?:يتوج|يتوجان)\s+(?:بلقب|ببطولة)\s*/g, "ونزال تاريخي على بطولة ");
  clean = clean.replace(/و?(?:يتأهل|تأهل)\s+(?:لـ|لمواجهة|في تصفيات)\s*/g, "وصراع مشتعل للتأهل لـ");
  return clean.replace(/\s+/g, " ").trim();
}

function sanitizePublishedHeadline(title: string): string {
  if (!title) return title;
  const arBoundL = "(?<![\\u0600-\\u06FF])";
  const arBoundR = "(?![\\u0600-\\u06FF])";
  const arWord = (pattern: string, flags = "g") => new RegExp(arBoundL + "(?:" + pattern + ")" + arBoundR, flags);

  return title
    .replace(/(?:Road\s+to|Road\s+To)\s+ديستركشن/gi, "Road To Destruction")
    .replace(/ديستركشن\s+in\s+Kobe/gi, "Destruction in Kobe")
    .replace(arWord("ديستركشن"), "Destruction")
    .replace(arWord("يستذكر"), "يتذكر")
    .replace(arWord("تستذكر"), "تتذكر")
    .replace(arWord("استذكار"), "تذكر")
    .replace(/(يتذكر|تتذكر)\s+لقائه(?![\\u0600-\\u06FF])/g, "$1 لقاءه")
    .replace(arWord("بإشهر"), "بإشهار");
}

function isResultsArticle(title: string = ""): boolean {
  return /^نتائج\s+عرض\b/i.test(title) ||
         /^نتائج\s+تسريبات\b/i.test(title) ||
         /\bنتائج\s+عرض\b/i.test(title) ||
         /\b(?:Full Show Results|Show Results|Live Coverage)\b/i.test(title);
}

function isSingleMatchSpoiler(rawTitle: string = "", plainText: string = ""): boolean {
  const title = (rawTitle || "").trim();
  if (!title) return false;

  if (/^نتائج\s+عرض\b/i.test(title) || /\b(?:Full Show Results|Live Results|Show Results)\b/i.test(title)) {
    return false;
  }

  // Preserved content safeguards
  if (/\b(?:الإعلان عن|تحديد موعد|نزال مرتقب|مواجهة مرتقبة|نزالات التصفية|قائمة نزالات|بطاقة عرض|سيواجه|يواجه|يتحالف مع)\b/i.test(title) ||
      /\b(?:set for|announced for|added to|scheduled for|card for|match card|lineup for|line-up for|official for|will face|to face|to battle|to clash|to meet|to team|to challenge|to defend|to appear)\b/i.test(title)) {
    return false;
  }

  if (/\b(?:يعود إلى|تسجيل ظهوره الأول|ظهوره الأول|ظهور مفاجئ|يوقع مع|تجديد عقد|يغادر|رحيل|فسخ عقد|انتقال|يظهر في|يشارك في)\b/i.test(title) ||
      /\b(?:returns? to|makes? (?:surprise )?return|debuts? (?:on|at|in)|makes? debut|signs? with|signed with|contract|free agent|re-signs?|departs?|leaves?|released by|makes? (?:surprise )?appearance|shows? up at)\b/i.test(title)) {
    return false;
  }

  if (/\b(?:كواليس|خلف كواليس|تصريحات|يعلق على|يرد على|يوضح|يكشف|يتحدث عن|يشيد بـ|يهاجم|ينتقد|شائعات|تقارير تصف|حديث|حوار)\b/i.test(title) ||
      /\b(?:comments on|comments after|reacts to|reflects on|explains|discusses|reveals|details|opens up|recalls|speaks on|addresses|says|tells|praises|blasts|slams|shuts down|teases|advocates|pitches|names|backstage at|loves|remembers|unhappy with|frustrated with)\b/i.test(title) ||
      /^[A-Za-z0-9'\s\.\-]+?\s*:\s*['"“]/i.test(title)) {
    return false;
  }

  if (/\b(?:إصابة|جراحة|الرباط الصليبي|كسر|ابتعاد|غياب|وعكة صحية|مستشفى|وفاة|قاعة المشاهير|نسب مشاهدة|تقييمات|مبيعات تذاكر)\b/i.test(title) ||
      /\b(?:injury|injured|surgery|torn acl|neck injury|pulled from|medical|health|hospital|out indefinitely|gofundme|trailer|movie|film|podcast|hall of fame|funeral|passes away|passed away|dies at|death of|historic gate|ticket sales|viewership|ratings)\b/i.test(title)) {
    return false;
  }

  const hasArabicDefeat = /\b(?:يهزم|يهزمان|يهزمن|يسقط|يتفوق على|ينتصر على|يتغلب على|يحسم مواجهة لصالح)\b/i.test(title);
  const hasArabicQualifier = /\b(?:يتأهل لـ|يتأهل لمواجهة|يتأهل في تصفيات|يحسم تأهله|يقصي|يخرج من تصفيات)\b/i.test(title);
  const hasArabicRetain = /\b(?:يحتفظ بـ|يحتفظ بلقب|يحتفظ ببطولة|يحافظ على لقب|يحافظ على بطولة|احتفاظ باللقب|احتفاظ بالبطولة)\b/i.test(title);
  const hasArabicWin = /\b(?:يتوج بلقب|يتوج ببطولة|يخطف لقب|يقتنص بطولة|يفوز بلقب|يفوز ببطولة|ينتزع لقب|ينتزع بطولة|يصبح المنافس الأول)\b/i.test(title);

  const hasEnglishDefeat = /\b(?:defeats?|defeated|defeating|def\.|beats?|beaten|pins?|pinned|submits?|submitted|triumphs? over|victorious over)\b/i.test(title);
  const hasEnglishQualifier = /\b(?:qualifies? for|qualified for|advances? (?:to|in)|advanced (?:to|in)|eliminates?|eliminated from)\b/i.test(title);
  const hasEnglishRetain = /\b(?:retains?|retained)\s+(?:the\s+)?(?:.*?\s+)?(?:championships?|titles?|champions?|gold|belts?|crowns?)|retains? against\b/i.test(title);
  const hasEnglishWin = /\b(?:wins?|won|captures?|captured|crowned(?: new)?|becomes(?: new)?)\s+(?:the\s+)?(?:.*?\s+)?(?:championships?|titles?|champions?|gold|belts?|crowns?|ladder match(?:es)?|battle royals?|eliminators?)\b/i.test(title) ||
                        /\bbecomes (?:the\s+)?no\.?\s*1 contender\b/i.test(title) ||
                        /\bearns (?:a\s+)?(?:.*?\s+)?title shot\b/i.test(title);
  const hasEnglishSurvive = /\bsurvives?.*to retain\b/i.test(title);

  // Live in-show angles/attacks/segments from weekly shows
  const hasArabicLiveShow = /\b(?:في عرض|خلال عرض|عبر عرض|بعرض)\s+(?:WWE\s+)?(?:RAW|SmackDown|NXT|الرو|سماك\s*داون|إمباكت)|\b(?:في عرض|خلال عرض|عبر عرض|بعرض)\s+(?:AEW\s+)?(?:Dynamite|Collision|داينمايت|كوليجن)\b/i.test(title);
  const hasArabicLiveAngle = /\b(?:يهاجم|تهاجم|يعتدي على|تعتدي على|يغدر بـ|تغدر بـ|يصدم|يواجه|تواجه|يصفع|تصفع|يقتحم|تقتحم|يشعل|يشعلان|تظهر في|يظهر في|يفاجئ|تفاجئ|يقاطع|تقاطع)\b/i.test(title);
  const hasEnglishLiveShow = /\b(?:on\s+(?:\d+[-\/]\d+\s+)?(?:WWE\s+)?(?:RAW|SmackDown|NXT)|on\s+(?:AEW\s+)?(?:Dynamite|Collision))\b/i.test(title);
  const hasEnglishLiveAngle = /\b(?:attacks?|ambushes?|turns on|brawls with|appears on|shows up on|confronts?|cost\b|interferes?)\b/i.test(title);

  return (hasArabicDefeat || hasArabicQualifier || hasArabicRetain || hasArabicWin || (hasArabicLiveShow && hasArabicLiveAngle) ||
          hasEnglishDefeat || hasEnglishQualifier || hasEnglishRetain || hasEnglishWin || hasEnglishSurvive || (hasEnglishLiveShow && hasEnglishLiveAngle));
}

// Resolve original article dates on the server; rendering or retrying cannot renew eligibility.
async function eligiblePublication(env: Env, articleUrl: string): Promise<boolean> {
  try {
    const target = new URL(articleUrl, env.SITE_ORIGIN);
    if (target.origin !== new URL(env.SITE_ORIGIN).origin) return false;
    const response = await fetch(cacheBust(`${env.SITE_ORIGIN}/search-index.json`));
    if (!response.ok) return false;
    const items: any = await response.json();
    const item = Array.isArray(items) && items.find((entry: any) =>
      normalizeArticleUrl(new URL(entry.url, env.SITE_ORIGIN).href) === normalizeArticleUrl(target.href));
    const date = item?.date ? new Date(item.date).getTime() : NaN;
    return Number.isFinite(date) && date >= Date.parse(env.WATCHER_MIN_DATE || '2026-09-21T19:13:59Z') && date <= Date.now();
  } catch { return false; }
}

export async function runWatcherPoll(env: Env): Promise<void> {
  let items: any[] = [];
  try {
    // watcher-recent-content.json is a small, fixed-size (~200 item) tail of the newest
    // content, unlike search-index.json which dumps the site's entire history
    // (1500+ items and growing forever). Parsing the full index here used to
    // blow the Worker's per-invocation CPU budget on every single tick, which
    // silently killed the run before any platform was ever posted to.
    const res = await fetch(cacheBust(`${env.SITE_ORIGIN}/watcher-recent-content.json`), {
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

  let state: PublishState;
  let currentSha: string | null = null;
  try {
    ({ sha: currentSha, state } = await githubReadState(env));
  } catch (e) {
    return;
  }

  let processedInThisTick = 0;
  // Bound external requests to remain compatible with Workers' free-tier budget.
  const MAX_PER_TICK = 1;
  let platformAttempts = 0;
  const takeSlot = () => platformAttempts < 2 ? (++platformAttempts, true) : false;
  let bufferXAttemptedInTick = 0;
  const MAX_BUFFER_PER_TICK = 1;

  for (const item of items) {
    if (processedInThisTick >= MAX_PER_TICK || platformAttempts >= 2) break;

    const ts = item.date ? new Date(item.date).getTime() : 0;
    if (!Number.isFinite(ts) || !ts || ts > Date.now() || (minDate && ts < minDate)) continue;
    // items are sorted newest-first, so once we hit one older than the
    // window, everything after it is older too — stop scanning instead of
    // continuing to burn CPU on the rest of the feed.
    if (ts && (Date.now() - ts) > 18 * 60 * 60 * 1000) break;

    const key = sanitizeKey(normalizeArticleUrl(env.SITE_ORIGIN + (item.url || "")));
    if (!key) continue;

    const tgDone = !!state.telegram[key];
    const fbDone = !!state.facebook[key];
    const igDone = !!state.instagram[key];
    const xDone = !!state.x[key];

    if (tgDone && fbDone && igDone && xDone) continue;

    const now = Date.now();

    // Social Media Spoiler Shield:
    // Block individual match result stubs from social feeds.
    // General news (injuries, signings, returns, announcements) and full show results are published!
    const collection = item.kind === "show" ? "shows" : item.kind === "recap" ? "recaps" : "news";

    if (collection === "news") {
      const isSpoiler = item.single_match_result === true || isSingleMatchSpoiler(item.title, item.headline || item.description || "");
      if (isSpoiler) {
        state.telegram[key] = now;
        state.facebook[key] = now;
        state.instagram[key] = now;
        state.x[key] = now;
        await githubWriteState(env, state, currentSha, `social shield: skip single-match spoiler ${key}`).catch(() => {});
        continue;
      }
    }

    const xCooldown = (state.cooldowns?.x || 0) > now;
    const igCooldown = (state.cooldowns?.instagram || 0) > now;
    const fbCooldown = (state.cooldowns?.facebook || 0) > now;

    // Determine what can actually be attempted right now
    const deferred = (platform: Platform) => (state.deferrals?.[`${platform}:${key}`] || 0) > now;
    const canDoTg = !tgDone && !deferred("telegram");
    // Resume automatically after the persisted platform cooldown expires.
    const canDoIg = env.INSTAGRAM_AUTO_ENABLED !== "false" && !igDone && !igCooldown && !deferred("instagram");
    // Facebook publishes news and shows normally as posts
    const canDoFb = !fbDone && !fbCooldown && !deferred("facebook");
    const canDoX = !xDone && !xCooldown && !deferred("x") && bufferXAttemptedInTick < MAX_BUFFER_PER_TICK;

    // If nothing actionable can be done for this item, skip it
    if (!canDoTg && !canDoIg && !canDoFb && !canDoX) {
      continue;
    }

    let didWork = false;

    if (canDoTg && takeSlot()) {
      const verify = await verifyLiveOnSite(env, { url: item.url, image: item.image });
      if (!verify.ok) continue; // not fully live yet — try again next minute

      const collection = item.kind === "show" ? "shows" : item.kind === "recap" ? "recaps" : "news";
      const isShowResults = isResultsArticle(item.title);
      const cleanTitle = sanitizePublishedHeadline(isShowResults ? sanitizeResultsTitleSpoilers(item.title) : item.title);
      const cleanSnippet = isShowResults
        ? "تابعوا التغطية الشاملة والنتائج الكاملة لكافة مواجهات وأحداث العرض بالتفصيل وبشكل حصري عبر موقعنا الرسمي."
        : (item.headline || item.description || verify.bodySnippet || "");

      const payload = {
        title: cleanTitle,
        text: cleanSnippet,
        url: env.SITE_ORIGIN + (item.url || ""),
      };

      const tgResult = await publishToPlatform(env, "telegram", key, payload, verify, false);
      didWork = true;

      if (tgResult.status === "sent" && (collection === "shows" || collection === "recaps")) {
        await sendPushToAllSubscribers(env, { ...payload, image: item.image, collection, kind: item.kind }).catch(() => {});
      }

      if (canDoFb && takeSlot()) {
        const fbText = isShowResults
          ? "إليكم التغطية الشاملة والنتائج الكاملة لكافة مواجهات وأحداث العرض بالتفصيل وبشكل حصري."
          : payload.text;
        await publishToPlatform(env, "facebook", key, { ...payload, text: fbText, image: item.image, kind: item.kind }, {}, false);
      }
      if (canDoIg && takeSlot()) await publishToPlatform(env, "instagram", key, { ...payload, image: item.image, kind: item.kind }, {}, false);
      if (canDoX && takeSlot()) {
        bufferXAttemptedInTick++;
        await publishToPlatform(env, "x", key, { ...payload, image: item.image }, {}, false);
      }
    } else {
      // Telegram already sent — only catch up missing platforms if article is fresh (under 12 hours old).
      // Never publish old historical articles!
      const isFresh = ts > 0 && (now - ts) < 12 * 60 * 60 * 1000;
      if (!isFresh) {
        continue;
      }
      const isShowResults = isResultsArticle(item.title);
      const cleanTitle = sanitizePublishedHeadline(isShowResults ? sanitizeResultsTitleSpoilers(item.title) : item.title);
      let catchUpText = isShowResults
        ? "تابعوا التغطية الشاملة والنتائج الكاملة لكافة مواجهات وأحداث العرض بالتفصيل وبشكل حصري عبر موقعنا الرسمي."
        : (item.headline || item.description || "");
      if (!catchUpText) {
        const v = await verifyLiveOnSite(env, { url: item.url, image: item.image });
        catchUpText = v.bodySnippet || "";
      }
      const payload = { title: cleanTitle, text: catchUpText, url: env.SITE_ORIGIN + (item.url || "") };
      if (canDoFb && takeSlot()) {
        await publishToPlatform(env, "facebook", key, { ...payload, image: item.image, kind: item.kind }, {}, false);
        didWork = true;
      }
      if (canDoIg && takeSlot()) {
        await publishToPlatform(env, "instagram", key, { ...payload, image: item.image, kind: item.kind }, {}, false);
        didWork = true;
      }
      if (canDoX && takeSlot()) {
        bufferXAttemptedInTick++;
        await publishToPlatform(env, "x", key, { ...payload, image: item.image }, {}, false);
        didWork = true;
      }
    }

    if (didWork) {
      processedInThisTick++;

      // Curated Story Publisher:
      // Publishes flagship show results and major breaking events as vertical 9:16 Stories
      // to Instagram and Facebook, spaced by at least 3 hours to prevent algorithmic story-spam.
      if (env.AUTO_IMAGE_STORIES === "true" && item.image && isStoryWorthy(item)) {
        const lastStory = state.lastStoryAt || 0;
        const isMajorShow = item.kind === "show" || item.kind === "recap";
        const STORY_COOLDOWN_MS = isMajorShow ? 30 * 60 * 1000 : 3 * 60 * 60 * 1000;
        if (now - lastStory >= STORY_COOLDOWN_MS) {
          try {
            const igStoryPromise = postToInstagramStory(env, { imageUrl: item.image }).catch(() => ({ ok: false }));
            const fbStoryPromise = postToFacebookStory(env, { imageUrl: item.image }).catch(() => ({ ok: false }));
            const [igStoryRes, fbStoryRes] = await Promise.all([igStoryPromise, fbStoryPromise]);
            if (igStoryRes?.ok || fbStoryRes?.ok) {
              state.lastStoryAt = now;
              await githubWriteState(env, state, currentSha, `chore(publish): publish story for ${key}`).catch(() => {});
            }
          } catch (storyErr) {
            console.warn("[Stories] Story publish skipped or failed:", storyErr);
          }
        }
      }
    }
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
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
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
      const publicMutations = new Set(["/api/push/subscribe", "/api/push/unsubscribe"]);
      if (!["GET", "HEAD"].includes(request.method) && !publicMutations.has(path)) {
        if (!(await authorizeAdmin(request, env))) return json({ success: false, error: "سجّل الدخول من لوحة الإدارة بحساب GitHub لديه صلاحية تعديل الموقع." }, 401);
      }
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

      if (path === "/api/x/status" && request.method === "GET") {
        if (!env.BUFFER_API_KEY || !env.BUFFER_X_CHANNEL_ID) {
          return json({ success: false, configured: false, message: "BUFFER_API_KEY / BUFFER_X_CHANNEL_ID not set" });
        }
        const res = await fetch("https://api.buffer.com", {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${env.BUFFER_API_KEY}` },
          body: JSON.stringify({ query: `query { channel(input: { id: "${env.BUFFER_X_CHANNEL_ID}" }) { id name service } }` }),
        });
        const data: any = await res.json();
        return json({ success: !data.errors, configured: true, channel: data?.data?.channel || data });
      }

      if (path === "/api/facebook-buffer/status" && request.method === "GET") {
        if (!env.BUFFER_API_KEY || !env.BUFFER_FACEBOOK_CHANNEL_ID) {
          return json({ success: false, configured: false, message: "BUFFER_API_KEY / BUFFER_FACEBOOK_CHANNEL_ID not set" });
        }
        const res = await fetch("https://api.buffer.com", {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${env.BUFFER_API_KEY}` },
          body: JSON.stringify({ query: `query { channel(input: { id: "${env.BUFFER_FACEBOOK_CHANNEL_ID}" }) { id name service } }` }),
        });
        const data: any = await res.json();
        return json({ success: !data.errors, configured: true, channel: data?.data?.channel || data });
      }



      if (path === "/api/publishing/status" && request.method === "GET") {
        const { state } = await githubReadState(env);
        return json({ success: true, instagramAutomatic: env.INSTAGRAM_AUTO_ENABLED !== "false",
          publicationCutoff: env.WATCHER_MIN_DATE, imageStoriesAutomatic: env.AUTO_IMAGE_STORIES === "true", newsCooldowns: state.cooldowns,
          videoCooldowns: state.videoCooldowns || {} });
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
          x: !!state.x[key],
        });
      }

      if (path === "/api/social/manual-publish" && request.method === "POST") {
        const body: any = await request.json().catch(() => ({}));
        const { title, text, url: itemUrl, image, kind, platforms, force } = body || {};
        if (!title || !itemUrl) return json({ success: false, error: "title و url مطلوبين" }, 400);

        const key = sanitizeKey(normalizeArticleUrl(itemUrl));
        const wanted: Platform[] = Array.isArray(platforms) && platforms.length ? platforms : ["telegram", "facebook", "instagram", "x"];
        if (wanted.length !== 1 || !["telegram", "facebook", "instagram", "x"].includes(wanted[0])) {
          return json({ success: false, error: "أرسل منصة واحدة في كل طلب نشر؛ حدّث لوحة الإدارة إلى أحدث نسخة." }, 400);
        }
        if (!await eligiblePublication(env, String(itemUrl))) {
          return json({ success: false, code: "CONTENT_NOT_ELIGIBLE", error: "المحتوى القديم أو غير المؤكد مستبعد من النشر." }, 409);
        }
        let pagePath = itemUrl;
        try {
          pagePath = new URL(itemUrl).pathname;
        } catch (e) {
          /* keep as-is */
        }

        const results: Record<string, string> = {};
        const debug: Record<string, any> = {};

        // If the dashboard didn't send a snippet (older items often have no
        // headline/description saved), scrape the live page for one — same
        // fallback the automatic watcher already uses via verifyLiveOnSite.
        // Doing this once up front means Facebook/Instagram/X get a real
        // snippet on manual publish too, not just Telegram.
        let resolvedText = text || "";
        let verify: { imageBuffer?: ArrayBuffer; imageContentType?: string } = {};
        if (wanted.includes("telegram") || !resolvedText) {
          const v = await verifyLiveOnSite(env, { url: pagePath, image });
          verify = v;
          if (!resolvedText) resolvedText = v.bodySnippet || "";
        }
        const payload = { title, text: resolvedText, url: itemUrl, image, kind };

        if (wanted.includes("telegram")) {
          const r = await publishToPlatform(env, "telegram", key, payload, verify, !!force);
          results.telegram = r.status;
          if (r.raw !== undefined) debug.telegram = r.raw;
        }
        if (wanted.includes("facebook")) {
          const r = await publishToPlatform(env, "facebook", key, payload, {}, !!force);
          results.facebook = r.status;
          if (r.raw !== undefined) debug.facebook = r.raw;
        }
        if (wanted.includes("instagram")) {
          const r = await publishToPlatform(env, "instagram", key, payload, {}, !!force);
          results.instagram = r.status;
          if (r.raw !== undefined) debug.instagram = r.raw;
        }
        if (wanted.includes("x")) {
          const r = await publishToPlatform(env, "x", key, payload, {}, !!force);
          results.x = r.status;
          if (r.raw !== undefined) debug.x = r.raw;
        }

        const values = Object.values(results);
        const success = values.length > 0 && values.every(value => value === "sent" || value === "already_sent");
        return json({ success, partial: !success && values.some(value => value === "sent" || value === "already_sent"), key, results, debug });
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
      // ── News Watcher management (used by admin/watcher.html) ──
      if (path === "/api/watcher/feed" && request.method === "GET") {
        const limit = Math.min(Number(url.searchParams.get("limit")) || 30, 50);
        const feedUrl = `https://www.fightful.com/wp-json/wp/v2/posts?_embed=1&per_page=${limit}`;
        const res = await fetch(feedUrl, {
          headers: { "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)" },
        });
        if (!res.ok) {
          return json({ success: false, error: `Failed to fetch source API: HTTP ${res.status}` }, 502);
        }
        const data = await res.json();
        return json({ success: true, count: Array.isArray(data) ? data.length : 0, posts: data });
      }

      if (path === "/api/watcher/status" && request.method === "GET") {
        try {
          const { state } = await githubReadWatcherState(env);
          return json({
            success: true,
            enabled: state.enabled,
            lastChecked: state.lastChecked,
            processedCount: state.processedIds.length,
            processedIds: state.processedIds,
            apiCallsToday: state.apiCallsToday || 0,
            apiCallDate: state.apiCallDate || "",
          });
        } catch (e: any) {
          return json({ success: false, error: e.message }, 500);
        }
      }

      if (path === "/api/watcher/toggle" && request.method === "POST") {
        try {
          const { sha, state } = await githubReadWatcherState(env);
          const body: any = await request.json().catch(() => ({}));
          const newEnabled = typeof body.enabled === "boolean" ? body.enabled : !state.enabled;
          state.enabled = newEnabled;
          const res = await githubWriteWatcherState(
            env,
            state,
            sha,
            `chore(watcher): ${newEnabled ? "resume" : "pause"} automated news watcher`
          );
          if (!res.ok) throw new Error("Failed to write watcher-state.json to GitHub");
          return json({
            success: true,
            enabled: state.enabled,
            message: state.enabled ? "تم استئناف تشغيل الواتشر بنجاح" : "تم إيقاف الواتشر مؤقتاً بنجاح",
          });
        } catch (e: any) {
          return json({ success: false, error: e.message }, 500);
        }
      }

      if (path === "/api/watcher/dispatch" && request.method === "POST") {
        try {
          const body: any = await request.json().catch(() => ({}));
          const postUrl = body.post_url ? String(body.post_url).trim() : undefined;
          const urls: string[] = Array.isArray(body.urls)
            ? body.urls.map((u: any) => String(u).trim()).filter(Boolean)
            : (postUrl ? [postUrl] : []);

          const dispatchPayload = urls.length > 0 ? urls.join(",") : undefined;
          const res = await githubTriggerWatcherWorkflow(env, dispatchPayload);
          if (!res.ok) throw new Error(`GitHub dispatch failed: ${res.status} ${res.error || ""}`);
          return json({
            success: true,
            count: urls.length,
            message: urls.length > 1
              ? `تم إرسال أمر نشر ${urls.length} أخبار فوراً في نفس الوقت بنجاح!`
              : (urls.length === 1
                  ? "تم إرسال أمر إضافة الخبر إلى GitHub Actions للبدء في معالجته ونشره فوراً!"
                  : "تم تشغيل دورة فحص الأخبار بالكامل على السيرفر بنجاح!"),
          });
        } catch (e: any) {
          return json({ success: false, error: e.message }, 500);
        }
      }

      if (path === "/api/videos/list" && request.method === "GET") {
        try {
          const videos = await githubGetVideosManifest(env);
          return json({ success: true, videos });
        } catch (e: any) {
          return json({ success: false, error: e.message, videos: [] }, 500);
        }
      }

      if (path === "/api/videos/check" && request.method === "GET") {
        try {
          const rawSlug = decodeURIComponent(url.searchParams.get("slug") || "").toLowerCase().trim();
          const clean = rawSlug.replace(/^(?:https?:\/\/[^\/]+)?\/?(?:news|shows|recaps|nostalgia)\//, "").replace(/\.html$/, "").replace(/^\/+/, "").slice(0, 45);

          const manifest = await githubGetVideosManifest(env);
          const matched = manifest.find((v: any) => {
            const f = (v.filename || "").toLowerCase();
            const s = (v.cleanSlug || "").toLowerCase();
            return (rawSlug && (f.includes(rawSlug) || s.includes(rawSlug) || rawSlug.includes(s))) ||
                   (clean && (f.includes(clean) || clean.includes(s) || s.includes(clean)));
          });

          if (matched) {
            let videoUrl = matched.videoUrl;
            if (!videoUrl.startsWith("http")) {
              videoUrl = `${env.SITE_ORIGIN}${videoUrl.startsWith("/") ? "" : "/"}${videoUrl}`;
            }
            return json({
              exists: true,
              filename: matched.filename,
              videoUrl,
              size: matched.size,
              mtime: matched.mtime,
              cleanSlug: matched.cleanSlug,
            });
          }

          // Check if GitHub Actions is currently running generate-reel.yml
          let runStatus = "unknown";
          let runConclusion: string | null = null;
          try {
            const runsRes = await fetch(
              `https://api.github.com/repos/${env.GITHUB_OWNER}/${env.GITHUB_REPO}/actions/workflows/generate-reel.yml/runs?per_page=1`,
              {
                headers: {
                  Authorization: `Bearer ${env.GITHUB_TOKEN}`,
                  Accept: "application/vnd.github+json",
                  "User-Agent": "arw-site-bot",
                },
              }
            );
            if (runsRes.ok) {
              const runsData: any = await runsRes.json();
              if (runsData.workflow_runs && runsData.workflow_runs.length > 0) {
                const latestRun = runsData.workflow_runs[0];
                runStatus = latestRun.status; // queued, in_progress, completed
                runConclusion = latestRun.conclusion;
              }
            }
          } catch (_) {}

          return json({
            exists: false,
            runStatus,
            runConclusion,
          });
        } catch (e: any) {
          return json({ exists: false, error: e.message }, 500);
        }
      }

      if (path === "/api/videos/raw" && request.method === "GET") {
        try {
          const file = decodeURIComponent(url.searchParams.get("file") || "").trim();
          if (!file || !file.endsWith(".mp4")) return json({ error: "Invalid filename" }, 400);
          const safeName = file.split("/").pop() || "";
          const ghRes = await fetch(
            `https://api.github.com/repos/${env.GITHUB_OWNER}/${env.GITHUB_REPO}/contents/dist/videos/${encodeURIComponent(safeName)}?ref=${env.GITHUB_BRANCH || "main"}`,
            {
              headers: {
                Authorization: `Bearer ${env.GITHUB_TOKEN}`,
                Accept: "application/vnd.github.raw+json",
                "User-Agent": "arw-site-bot",
              },
            }
          );
          if (!ghRes.ok) return json({ error: "Video not found in repository" }, 404);
          const contentLength = ghRes.headers.get("content-length");
          const headers: Record<string, string> = {
            "Content-Type": "video/mp4",
            "Access-Control-Allow-Origin": "*",
            "Cache-Control": "public, max-age=86400",
            "Accept-Ranges": "bytes",
          };
          if (contentLength) headers["Content-Length"] = contentLength;
          return new Response(ghRes.body, { headers });
        } catch (e: any) {
          return json({ error: e.message }, 500);
        }
      }

      if (path === "/api/videos/delete" && request.method === "POST") {
        try {
          const body: any = await request.json().catch(() => ({}));
          const filename = String(body.filename || "").trim();
          const slug = String(body.slug || "").trim();

          let targetFile = filename;
          if (!targetFile && slug) {
            const manifest = await githubGetVideosManifest(env);
            const found = manifest.find((v: any) => {
              const f = (v.filename || "").toLowerCase();
              const s = (v.cleanSlug || "").toLowerCase();
              return f.includes(slug.toLowerCase()) || s.includes(slug.toLowerCase());
            });
            if (found) targetFile = found.filename;
            else targetFile = `reel-${slug}.mp4`;
          }

          if (!targetFile) {
            return json({ success: false, error: "filename or slug is required" }, 400);
          }

          const res = await githubDeleteVideoFile(env, targetFile);
          return json({
            success: res.ok,
            message: res.ok ? `تم حذف ملف الفيديو ${targetFile} وتنظيف السيرفر بنجاح!` : (res.error || "فشل حذف الفيديو"),
          });
        } catch (e: any) {
          return json({ success: false, error: e.message }, 500);
        }
      }

      if (path === "/api/videos/dispatch" && request.method === "POST") {
        try {
          const body: any = await request.json().catch(() => ({}));
          const slug = body.slug ? String(body.slug).trim() : "latest";
          const res = await githubTriggerVideoWorkflow(env, slug);
          if (!res.ok) throw new Error(`GitHub video dispatch failed: ${res.status} ${res.error || ""}`);
          return json({
            success: true,
            message: "تم إرسال أمر توليد الفيديو إلى خوادم GitHub Actions السحابية بنجاح! سيتم تصييره ورفعه للموقع تلقائياً.",
          });
        } catch (e: any) {
          return json({ success: false, error: e.message }, 500);
        }
      }

      if (path === "/api/videos/publish-social" && request.method === "POST") {
        try {
          const body: any = await request.json().catch(() => ({}));
          const rawVideoUrl = String(body.videoUrl || "").trim();
          if (!rawVideoUrl) {
            return json({ success: false, error: "رابط الفيديو مطلوب (videoUrl is required)" }, 400);
          }
          let fullVideoUrl = rawVideoUrl.startsWith("http")
            ? rawVideoUrl
            : `${env.SITE_ORIGIN}${rawVideoUrl.startsWith("/") ? "" : "/"}${rawVideoUrl}`;
          try {
            fullVideoUrl = encodeURI(decodeURI(fullVideoUrl));
          } catch (e) {
            fullVideoUrl = encodeURI(fullVideoUrl);
          }

          const requestedPlatforms: string[] = Array.isArray(body.platforms) && body.platforms.length > 0
            ? body.platforms
            : ["facebook_reel", "facebook_story", "instagram_reel", "instagram_story"];
          const allowed = new Set(["facebook_reel", "facebook_story", "instagram_reel", "instagram_story"]);
          if (requestedPlatforms.length !== 1 || requestedPlatforms.some(p => !allowed.has(p))) {
            return json({ success: false, error: "أرسل منصة فيديو واحدة في كل طلب؛ الأداة مخصصة لفيسبوك وإنستجرام." }, 400);
          }
          const videoHost = new URL(fullVideoUrl);
          if (!videoHost.pathname.endsWith(".mp4")) return json({ success: false, error: "ملف الفيديو يجب أن يكون MP4." }, 400);
          const sourceAllowed = videoHost.origin === new URL(env.SITE_ORIGIN).origin && videoHost.pathname.startsWith("/videos/")
            || videoHost.origin === "https://raw.githubusercontent.com" && videoHost.pathname.startsWith(`/${env.GITHUB_OWNER}/${env.GITHUB_REPO}/${env.GITHUB_BRANCH}/dist/videos/`);
          if (!sourceAllowed) return json({ success: false, error: "يجب استخدام فيديو من مكتبة الموقع." }, 400);

          if (!body.postUrl || !await eligiblePublication(env, String(body.postUrl))) {
            return json({ success: false, code: "CONTENT_NOT_ELIGIBLE", error: "النشر متاح للمحتوى الجديد فقط من وقت بدء التشغيل؛ المحتوى القديم أو غير المؤكد مستبعد." }, 409);
          }

          // Reliability check: if fullVideoUrl returns 404 on site origin, fallback to direct GitHub raw CDN
          try {
            const headCheck = await fetch(fullVideoUrl, { method: "HEAD" });
            if (!headCheck.ok && headCheck.status === 404) {
              const filename = fullVideoUrl.split("/").pop();
              if (filename && filename.endsWith(".mp4")) {
                fullVideoUrl = `https://raw.githubusercontent.com/${env.GITHUB_OWNER}/${env.GITHUB_REPO}/${env.GITHUB_BRANCH || "main"}/dist/videos/${encodeURIComponent(decodeURIComponent(filename))}`;
              }
            }
          } catch (_) {}

          const title = String(body.title || "").trim();
          const postUrl = body.postUrl ? String(body.postUrl).trim() : undefined;


          const results: Record<string, any> = {};
          const asset = decodeURIComponent(videoHost.pathname.split("/").pop() || "");
          for (const platform of [...new Set(requestedPlatforms)]) {
            const network = platform.startsWith("facebook") ? "facebook" : "instagram";
            const { state: currentState } = await githubReadState(env);
            const retryAt = currentState.videoCooldowns?.[network] || 0;
            if (retryAt > Date.now()) {
              results[platform] = { ok: false, status: "rate_limited", retryAt, error: "المنصة قيّدت نشر الفيديو مؤقتًا؛ ستتم إعادة المحاولة بعد انتهاء فترة الانتظار." };
              continue;
            }
            const send = () => platform === "facebook_reel" ? postVideoToFacebookReel(env, { videoUrl: fullVideoUrl, title, postUrl })
              : platform === "facebook_story" ? postVideoToFacebookStory(env, { videoUrl: fullVideoUrl })
              : platform === "instagram_reel" ? postVideoToInstagramReel(env, { videoUrl: fullVideoUrl, title, postUrl })
              : postVideoToInstagramStory(env, { videoUrl: fullVideoUrl });
            try {
              results[platform] = await deliverOnce(env, `video:${platform}:${asset}`, async () => {
                const result = await send();
                if (!result.ok && (/limit how often|spam|quota|rate.limit|too many|temporarily blocked/i.test(result.error || "")
                  || [4, 17, 32, 368, 613].includes(result.result?.error?.code))) {
                  await setVideoCooldown(env, network);
                }
                return result;
              }, { retryMs: 45 * 60_000 });
            } catch (e: any) {
              results[platform] = { ok: false, status: "uncertain", error: e.message };
            }
          }
          const values = Object.values(results);
          const allSuccess = values.length > 0 && values.every(r => r.ok);
          return json({ success: allSuccess, partial: !allSuccess && values.some(r => r.ok), results, videoUrl: fullVideoUrl });
        } catch (e: any) {
          return json({ success: false, error: e.message }, 500);
        }
      }

      if (path === "/api/admin/clean-duplicate-social" && request.method === "POST") {
        try {
          const report: any = { telegram: [], facebook: [] };
          const pageToken = await getPageAccessToken(env);

          // 1. Fetch recent Facebook posts & photos (last 100 posts)
          if (pageToken && env.FACEBOOK_PAGE_ID) {
            const fbRes = await fetch(
              `https://graph.facebook.com/${GRAPH_API_VERSION}/${env.FACEBOOK_PAGE_ID}/published_posts?fields=id,message,created_time&limit=100&access_token=${pageToken}`
            );
            const fbData: any = await fbRes.json().catch(() => ({}));
            const posts: any[] = fbData.data || [];
            report.total_fetched = posts.length;

            // Extract title words for semantic similarity
            const parsedPosts = posts.map(p => {
              const msg = (p.message || "").trim();
              const firstLine = msg.split("\n")[0].trim();
              const words = firstLine
                .replace(/[«»"'\(\)\[\]،.\-:]/g, " ")
                .split(/\s+/)
                .filter((w: string) => w.length > 2 && !/^[0-9]+$/.test(w));
              return {
                id: p.id,
                message: msg,
                firstLine,
                created_time: p.created_time,
                time: new Date(p.created_time).getTime(),
                words: new Set(words)
              };
            }).filter(p => p.firstLine.length >= 8);

            const deletedIds = new Set<string>();

            // Compare each pair of posts
            for (let i = 0; i < parsedPosts.length; i++) {
              const p1 = parsedPosts[i];
              if (deletedIds.has(p1.id)) continue;

              for (let j = i + 1; j < parsedPosts.length; j++) {
                const p2 = parsedPosts[j];
                if (deletedIds.has(p2.id)) continue;

                // Check word intersection
                const common: string[] = [];
                for (const w of Array.from(p1.words)) {
                  if (p2.words.has(w as string)) common.push(w as string);
                }

                // Check if they discuss the exact same subject
                // Condition 1: 4 or more common keywords
                // Condition 2: specific topic match (e.g. "غريس", "الأجسام" or "شيباتا", "بيري" or "Tailgate" or "سيلويتا" or "إغوانا")
                const isTopicDuplicate =
                  common.length >= 4 ||
                  (common.includes("غريس") && (common.includes("الأجسام") || common.includes("كمال"))) ||
                  (common.includes("سيلويتا") && common.includes("السيدات")) ||
                  ((common.includes("Tailgate") || common.includes("brawl") || common.includes("تيلغيت")) && (common.includes("AEW") || common.includes("All"))) ||
                  (common.includes("هيناري") && common.includes("خان")) ||
                  (common.includes("أووينز") && common.includes("زين")) ||
                  (common.includes("ستيفسون") && common.includes("شاراف"));

                if (isTopicDuplicate) {
                  // Keep newer post, delete older post
                  const older = p1.time < p2.time ? p1 : p2;
                  const newer = p1.time < p2.time ? p2 : p1;

                  try {
                    const delRes = await fetch(`https://graph.facebook.com/${GRAPH_API_VERSION}/${older.id}?access_token=${pageToken}`, {
                      method: "DELETE",
                    });
                    const delData: any = await delRes.json().catch(() => ({}));
                    deletedIds.add(older.id);
                    report.facebook.push({
                      deleted_id: older.id,
                      deleted_title: older.firstLine,
                      kept_title: newer.firstLine,
                      matched_keywords: common,
                      success: delData.success || false
                    });
                  } catch (err: any) {
                    report.facebook.push({ error: err.message, id: older.id });
                  }
                }
              }
            }
          }

          return json({ success: true, report });
        } catch (e: any) {
          return json({ success: false, error: e.message }, 500);
        }
      }

      return json({ success: false, error: "Not found" }, 404);
    } catch (error: any) {
      return json({ success: false, error: error.message || "خطأ في السيرفر" }, 500);
    }
  },

  async scheduled(_controller: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
    ctx.waitUntil(Promise.all([
      new Date(_controller.scheduledTime).getUTCMinutes() === 15 ? runVideoRetentionCleanup(env) : runWatcherPoll(env),
      runNewsWatcherCron(env),
      runReelMonitorCron(env),
    ]));
  },
} satisfies ExportedHandler<Env>;

// Ultra-responsive Fightful watcher trigger:
// Cloudflare crons fire every minute with 100% uptime.
// Every minute, we poll Fightful WP REST API for the latest post ID.
// The MOMENT Fightful publishes a new post, we trigger GitHub Actions immediately!
async function runNewsWatcherCron(env: Env): Promise<void> {
  try {
    const KV_SEEN_KEY = "last_seen_fightful_post_id";
    const KV_TRIGGER_TS_KEY = "last_news_watcher_trigger_ts";

    let lastSeenId = "";
    let lastTriggerTs = 0;
    if (env.PUSH_KV) {
      lastSeenId = (await env.PUSH_KV.get(KV_SEEN_KEY)) || "";
      const val = await env.PUSH_KV.get(KV_TRIGGER_TS_KEY);
      if (val) lastTriggerTs = Number(val) || 0;
    }

    const now = Date.now();
    const FALLBACK_INTERVAL_MS = 10 * 60 * 1000; // ~10 min fallback
    const isDueByTime = (now - lastTriggerTs) >= FALLBACK_INTERVAL_MS;

    // 1-minute fast check: query Fightful's latest post
    let hasNewPost = false;
    let latestPostId = "";
    try {
      const res = await fetch("https://www.fightful.com/wp-json/wp/v2/posts?per_page=3", {
        headers: {
          "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko)",
          "Accept": "application/json",
        },
      });
      if (res.ok) {
        const posts: any = await res.json();
        if (Array.isArray(posts) && posts.length > 0 && posts[0]?.id) {
          latestPostId = String(posts[0].id);
          if (lastSeenId && latestPostId !== lastSeenId) {
            hasNewPost = true;
          }
        }
      }
    } catch (fetchErr) {
      // Non-fatal network glitch — will retry next minute
    }

    if (hasNewPost || isDueByTime) {
      // Throttle: don't trigger workflow runs faster than every 2 minutes
      if (now - lastTriggerTs < 2 * 60 * 1000) {
        return;
      }

      let isEnabled = true;
      try {
        const { state } = await githubReadWatcherState(env);
        if (state && state.enabled === false) {
          isEnabled = false;
        }
      } catch (e) {}

      if (isEnabled) {
        console.log(`[Worker] ${hasNewPost ? `⚡ New Fightful post detected (${latestPostId})!` : "Periodic check"} Triggering news watcher workflow...`);
        const res = await githubTriggerWatcherWorkflow(env);
        if (res.ok) {
          if (env.PUSH_KV) {
            await env.PUSH_KV.put(KV_TRIGGER_TS_KEY, String(now));
            if (latestPostId) {
              await env.PUSH_KV.put(KV_SEEN_KEY, latestPostId);
            }
          }
        }
      }
    }
  } catch (err: any) {
    console.error("[Worker] Error in news watcher trigger:", err.message);
  }
}

// GitHub's native `schedule:` cron trigger is documented as best-effort and
// can silently skip ticks for a workflow when the account has heavy overall
// Actions load — this repo's other watchers fire every 10-20 minutes, so
// show-reel-monitor.yml (cron: every 15 min) has been observed going silent
// for many hours at a time despite each individual run completing in
// seconds. This gives it a second, independent trigger path through the
// Worker's own cron (proven reliable — it fires every single minute), so a
// missed native schedule tick self-heals within one throttle window instead
// of stalling reel publishing for hours.
async function runReelMonitorCron(env: Env): Promise<void> {
  try {
    if (!env.PUSH_KV) return;
    const KV_KEY = "last_reel_monitor_trigger_ts";
    const THROTTLE_MS = 14 * 60 * 1000; // just under the native 15-min cron
    const now = Date.now();
    const last = Number((await env.PUSH_KV.get(KV_KEY)) || 0) || 0;
    if (now - last < THROTTLE_MS) return;
    const res = await githubTriggerReelMonitorWorkflow(env);
    if (res.ok) {
      await env.PUSH_KV.put(KV_KEY, String(now));
    }
  } catch (err: any) {
    console.error("[Worker] Error in reel monitor trigger:", err.message);
  }
}

// Automatically prune videos older than 3 days from GitHub to save storage
// while guaranteeing social media platforms have finished ingesting them
async function runVideoRetentionCleanup(env: Env): Promise<void> {
  try {
    const now = new Date();
    // Run once an hour around minute 15
    if (now.getMinutes() !== 15) return;
    const manifest = await githubGetVideosManifest(env);
    if (!manifest || !manifest.length) return;
    const response = await fetch(`https://api.github.com/repos/${env.GITHUB_OWNER}/${env.GITHUB_REPO}/contents/_data/show-reel-state.json?ref=${env.GITHUB_BRANCH}`, {
      headers: { Authorization: `Bearer ${env.GITHUB_TOKEN}`, Accept: "application/vnd.github+json", "User-Agent": "arw-site-bot" },
    });
    if (!response.ok) return; // Fail closed: do not prune when publishing state is unavailable.
    const data: any = await response.json();
    const showState = JSON.parse(base64DecodeUtf8(data.content.replace(/\n/g, "")));
    const maxAgeMs = 3 * 24 * 60 * 60 * 1000; // Completed videos only.
    const nowMs = Date.now();
    let pruned = 0;
    for (const v of manifest) {
      if (pruned >= 2) break;
      if (v.mtime && (nowMs - v.mtime > maxAgeMs) && v.filename && !mustRetainVideo(v.filename, showState)) {
        console.log(`[Video Retention] Pruning old reel video: ${v.filename}`);
        await githubDeleteVideoFile(env, v.filename);
        pruned++;
      }
    }
  } catch (err) {
    console.warn("[Video Retention] Check failed:", err);
  }
}
