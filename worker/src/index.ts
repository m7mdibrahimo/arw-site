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
import { handleStudio, studioAuthorized, studioUser, readRepoFile, commitFiles, audit as studioAudit } from "./studio";
import { publishFacebookVideo, publishInstagramVideo, publishTikTokVideo, mustRetainVideo } from "./video-publishing";
import { runSiteHealthCheck, siteHealth } from "./health";
import { top10Response } from "./top10";
import { buildPushPayload, type PushSubscription } from "@block65/webcrypto-web-push";

export interface Env {
  // Secrets — set with `wrangler secret put <NAME>`
  TELEGRAM_BOT_TOKEN: string;
  // Optional: a personal Telegram chat id (not the public channel) that
  // gets a direct message if publishing appears stalled. Get your chat id
  // by messaging the bot once and checking
  // https://api.telegram.org/bot<TOKEN>/getUpdates, then:
  //   npx wrangler secret put ADMIN_TELEGRAM_CHAT_ID
  // Alerting is silently skipped if this isn't set.
  ADMIN_TELEGRAM_CHAT_ID?: string;
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
  // TikTok's Content Posting API (video.publish scope). Unlike Facebook/Instagram's
  // long-lived page token, TikTok issues a per-user access_token that expires every
  // 24h alongside a refresh_token (365-day life) — see getTikTokAccessToken, which
  // refreshes and persists the rotating pair through the same GitHub-backed state
  // store as everything else here rather than a Cloudflare secret (a secret can't be
  // rewritten from inside the Worker itself). These two ARE the static app-level
  // credentials (set once via wrangler secret, never rotate on their own).
  TIKTOK_CLIENT_KEY?: string;
  TIKTOK_CLIENT_SECRET?: string;
  // "true" only after TikTok approves the app in Production; until then posts stay SELF_ONLY.
  TIKTOK_APP_AUDITED?: string;

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
  X_AUTO_ENABLED?: string;
  TIKTOK_AUTO_ENABLED?: string;
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
  // Stories the spoiler shield kept off social, for the owner to review in the panel
  // (the four platform stamps above are set too, so nothing else tries to post them).
  held?: Record<string, HeldEntry>;
  // The owner decided a held story may go out: the stamps were cleared and this time
  // counts as its «fresh» moment, so it is posted in the next minutes whatever its age.
  released?: Record<string, number>;
  // Content file → the URL key it was first posted under. A story's URL comes from its title, so
  // fixing a word in a published title gave it a new URL — a «new» story — and it was posted a
  // second time (CMLL 28 Sep, INCIDENTS #127). The file never changes.
  byFile?: Record<string, string>;
  lastStoryAt?: number;
  videoCooldowns?: Partial<Record<"facebook" | "instagram" | "tiktok", number>>;
  // Buffer's own RateLimit response header, read proactively so a post is
  // skipped before it would be rejected rather than after — see
  // recordBufferQuota/hasBufferQuota. X and Facebook share this because
  // both go through the same Buffer API key (one client, one quota).
  bufferQuota?: { remaining: number; resetAt: number; window: string; updatedAt: number }[];
  // Legacy: where the TikTok token pair used to be stored. This file is public, so
  // tokens now live in KV; loadTikTokToken revokes and removes any found here.
  tiktokToken?: TikTokToken;
};

type HeldEntry = { at: number; title: string; url: string; image?: string; reason: "result" | "return" | "show"; why?: "title" | "lead" | "ai" | "flag" | "old"; lead?: string; note?: string; releasedAt?: number; dismissedAt?: number; by?: string };

/** The content file behind a feed item («./content/news/2026…-x.md» → «2026…-x»): its lasting identity. */
export function contentFileId(item: { inputPath?: string } | null | undefined): string {
  const p = String(item?.inputPath || "");
  const m = p.match(/([^/\\]+)\.md$/);
  return m ? m[1] : "";
}

// Why the shield held a story, in the panel's words: a return/debut, or a match outcome.
function spoilerReason(title: string = ""): "result" | "return" {
  return /(?<![\u0600-\u06FF\w])(?:و|ف)?(?:يعود|تعود|يعودان|يعودون|عودة|عودته|عودتها|عودتهم|العودة|العائد|العائدة|الظهور الأول|ظهوره الأول|ظهورها الأول|أول ظهور|ظهور مفاجئ|ظهورا مفاجئا|يظهر لأول مرة|تظهر لأول مرة)|\b(?:returns?|returned|comeback|debuts?|debuted|surprise (?:appearance|return))\b/i.test(title) ? "return" : "result";
}

function emptyPublishState(): PublishState {
  return { telegram: {}, facebook: {}, instagram: {}, x: {}, cooldowns: {}, lastStoryAt: 0 };
}

function githubContentsUrl(env: Env): string {
  return `https://api.github.com/repos/${env.GITHUB_OWNER}/${env.GITHUB_REPO}/contents/${env.GITHUB_STATE_PATH}`;
}

// This repo's own architecture has ~13 independent call sites for
// githubReadState — runWatcherPoll, publishToPlatform, markSendSuccess,
// deferPublication, and others each fetch and fully re-parse the state
// file on their own. A single tick that publishes to even 2 platforms can
// trigger 4-6+ of these in a few milliseconds, each repeating: a network
// round-trip, a manual byte-by-byte base64 decode (see base64DecodeUtf8),
// and a full JSON.parse — all against the same ~1-2MB file that hasn't
// changed since the first read. That redundant cost, compounding with
// everything else fixed today, is exactly what's been intermittently
// tipping ticks over the CPU limit. Rather than thread state through 13
// call sites (a much larger, riskier change), a short-TTL cache here
// gives every one of them the benefit transparently. structuredClone on
// each cache hit keeps callers isolated from each other's in-flight
// mutations — cheap relative to what it replaces (network + base64 decode
// + JSON.parse), and still correct even if it weren't, since every writer
// already goes through githubWriteState's sha-conflict retry.
let publishStateCache: { sha: string | null; state: PublishState; ts: number; url: string } | null = null;
const PUBLISH_STATE_CACHE_TTL_MS = 5000; // well under the 60s tick interval

async function githubReadState(env: Env): Promise<{ sha: string | null; state: PublishState }> {
  if (publishStateCache && publishStateCache.url === githubContentsUrl(env) && Date.now() - publishStateCache.ts < PUBLISH_STATE_CACHE_TTL_MS) {
    return { sha: publishStateCache.sha, state: structuredClone(publishStateCache.state) };
  }
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
  publishStateCache = { sha: data.sha, state, ts: Date.now(), url: githubContentsUrl(env) };
  return { sha: data.sha, state: structuredClone(state) };
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
  if (res.status === 409 || res.status === 422) {
    // Someone else's write landed first — our cached copy (if any) is now
    // stale either way, so drop it rather than let a subsequent read within
    // the TTL window hand back data that's already been superseded.
    publishStateCache = null;
    return { ok: false, conflict: true };
  }
  if (!res.ok) return { ok: false };
  // The file just changed under us; simplest correct thing is to drop the
  // cache rather than try to reconstruct the new sha from this response —
  // the next read (by us or anyone else this tick) just fetches fresh.
  publishStateCache = null;
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

async function githubTriggerWorkflowByFile(env: Env, workflowFile: string): Promise<{ ok: boolean; status: number; error?: string }> {
  const url = `https://api.github.com/repos/${env.GITHUB_OWNER}/${env.GITHUB_REPO}/actions/workflows/${workflowFile}/dispatches`;
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

async function markSendSuccess(env: Env, platform: Platform, key: string, file = ""): Promise<void> {
  if (!key) return;
  const lockKey = `lock:${platform}:${key}`;
  const failKey = `fail:${platform}:${key}`;
  try {
    await env.PUSH_KV.delete(lockKey);
    await env.PUSH_KV.delete(failKey);
  } catch (e) {}
  // Cheap O(1) heartbeat the stall watchdog reads — never scans the
  // ever-growing publish-state itself to figure out "when did anything last
  // actually go out."
  try {
    await env.PUSH_KV.put("last_successful_publish_ts", String(Date.now()));
  } catch (e) {}

  for (let attempt = 0; attempt < 5; attempt++) {
    let sha: string | null;
    let state: PublishState;
    try {
      ({ sha, state } = await githubReadState(env));
    } catch (e: any) {
      return;
    }
    if (state[platform]?.[key] && (!file || state.byFile?.[file])) return; // already marked

    state[platform][key] = state[platform][key] || Date.now();
    if (file) { state.byFile = state.byFile || {}; if (!state.byFile[file]) state.byFile[file] = key; }
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
  if (/(?<![\u0600-\u06FF])(?:مترجم|كامل|ملخص|تغطية|مشاهدة عرض)(?![\u0600-\u06FF])/.test(title)) return true;
  if (/^(?:عاجل|رسمياً|مفاجأة|صدمة|تتويج|تاريخي)(?![\u0600-\u06FF])/.test(title)) return true;
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

async function setVideoCooldown(env: Env, platform: "facebook" | "instagram" | "tiktok") {
  for (let i = 0; i < 5; i++) {
    const { sha, state } = await githubReadState(env);
    // Same account-level restriction as regular posts, so the same pause as
    // setPlatformDailyLimitCooldown: a flat 24h here kept show reels/stories
    // blocked for ~18 hours after Instagram posts had already resumed.
    const pauseMs = platform === "facebook" ? 2 * 60 * 60_000 : platform === "instagram" ? 6 * 60 * 60_000 : 24 * 60 * 60_000;
    state.videoCooldowns = { ...state.videoCooldowns, [platform]: Date.now() + pauseMs };
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

// ── TikTok OAuth token management ──────────────────────────────────────────
// TikTok's user access_token expires every 24h (unlike Facebook's effectively
// permanent page token), paired with a refresh_token that itself expires after
// 365 days and — per TikTok's own docs — "may be different" on every refresh,
// so the old one must be treated as dead the moment a new one is issued. Both
// live in KV (not a Cloudflare secret, which the Worker can't rewrite) and never
// in the GitHub state file: the repo is public, so anything written there can
// be read — and used to post to the account — by anyone.
type TikTokToken = { accessToken: string; refreshToken: string; expiresAt: number; openId?: string };
const TIKTOK_TOKEN_KEY = "tiktok-token";

async function revokeTikTokToken(env: Env, token: string) {
  if (!env.TIKTOK_CLIENT_KEY || !env.TIKTOK_CLIENT_SECRET) return;
  await fetch("https://open.tiktokapis.com/v2/oauth/revoke/", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_key: env.TIKTOK_CLIENT_KEY, client_secret: env.TIKTOK_CLIENT_SECRET, token }).toString(),
  }).catch(() => {});
}

// A token still found in the GitHub state (where it used to be stored) was
// already exposed publicly: revoke it and drop it, so the account has to be
// reconnected via /api/tiktok/oauth/start and the fresh token lands in KV only.
async function loadTikTokToken(env: Env): Promise<TikTokToken | null> {
  const stored = await env.PUSH_KV.get(TIKTOK_TOKEN_KEY);
  if (stored) return JSON.parse(stored);
  for (let i = 0; i < 5; i++) {
    const { sha, state } = await githubReadState(env);
    if (!state.tiktokToken) return null;
    await revokeTikTokToken(env, state.tiktokToken.accessToken);
    delete state.tiktokToken;
    const result = await githubWriteState(env, state, sha, "chore(tiktok): remove exposed token from public state");
    if (result.ok || !result.conflict) return null;
  }
  return null;
}

async function exchangeTikTokToken(env: Env, params: Record<string, string>): Promise<TikTokToken | null> {
  if (!env.TIKTOK_CLIENT_KEY || !env.TIKTOK_CLIENT_SECRET) return null;
  const body = new URLSearchParams({ client_key: env.TIKTOK_CLIENT_KEY, client_secret: env.TIKTOK_CLIENT_SECRET, ...params });
  try {
    const res = await fetch("https://open.tiktokapis.com/v2/oauth/token/", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
      body: body.toString(),
    });
    const data: any = await res.json().catch(() => ({}));
    if (!res.ok || !data.access_token || !data.refresh_token) return null;
    return {
      accessToken: data.access_token,
      refreshToken: data.refresh_token,
      expiresAt: Date.now() + (Number(data.expires_in) || 86400) * 1000,
      openId: data.open_id,
    };
  } catch (e) {
    return null;
  }
}

async function saveTikTokToken(env: Env, token: TikTokToken): Promise<boolean> {
  try {
    await env.PUSH_KV.put(TIKTOK_TOKEN_KEY, JSON.stringify(token));
    return true;
  } catch {
    return false;
  }
}

// Returns a currently-valid access token, refreshing and persisting a new one
// first if the stored token is missing, unconfigured, or close to expiring.
// Returns null if TikTok has never been connected via the OAuth flow yet
// (see /api/tiktok/oauth/start) or the refresh itself failed — callers must
// treat that as "not configured", not retry it like a transient error.
async function getTikTokAccessToken(env: Env): Promise<string | null> {
  if (!env.TIKTOK_CLIENT_KEY || !env.TIKTOK_CLIENT_SECRET) return null;
  const current = await loadTikTokToken(env);
  if (!current) return null;
  if (current.expiresAt - Date.now() > 5 * 60_000) return current.accessToken;
  const refreshed = await exchangeTikTokToken(env, { grant_type: "refresh_token", refresh_token: current.refreshToken });
  if (!refreshed) return null;
  await saveTikTokToken(env, refreshed);
  return refreshed.accessToken;
}

async function postVideoToTikTok(env: Env, data: { videoUrl: string; title: string; postUrl?: string }) {
  return publishTikTokVideo({ accessToken: await getTikTokAccessToken(env),
    videoUrl: data.videoUrl, caption: buildReelCaption(data.title, data.postUrl), kv: env.PUSH_KV,
    audited: env.TIKTOK_APP_AUDITED === "true" });
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

// ── Instagram pacing ─────────────────────────────────────────────
// Instagram answers bursts with "User is performing too many actions" and then
// blocks the account for hours (2026-09-25: 4 news posts in 3 minutes at 09:08
// UTC, then a show reel at 09:52 was refused and Instagram paused until 15:12 —
// INCIDENTS #47). Every Instagram action (news post, reel, story) now keeps at
// least IG_MIN_GAP_MS from the previous one, shared through KV.
const IG_MIN_GAP_MS = 10 * 60_000;
async function instagramSpacingWait(env: Env): Promise<number> {
  const last = Number((await env.PUSH_KV?.get("ig_last_action_ts").catch(() => null)) || 0);
  return Math.max(0, last + IG_MIN_GAP_MS - Date.now());
}
async function markInstagramAction(env: Env, kind: "post" | "video" = "post"): Promise<void> {
  await env.PUSH_KV?.put("ig_last_action_ts", String(Date.now())).catch(() => {});
  await env.PUSH_KV?.put("ig_last_action_kind", kind).catch(() => {});
  const recent = await instagramActionsLast24h(env);
  recent.push(Date.now());
  await env.PUSH_KV?.put("ig_actions_24h", JSON.stringify(recent)).catch(() => {});
}
// Instagram caps API publishing at 50-100 posts per rolling 24h (reels and stories
// included). The site publishes more news than that, so trying to post all of it
// ended in "too many actions" blocks (INCIDENTS #47, #51). Stay under IG_DAILY_CAP
// and keep IG_VIDEO_RESERVE of it for show reels/stories.
const IG_DAILY_CAP = 45;          // fallback when Instagram's own limit can't be read
const IG_VIDEO_RESERVE = 12;
const IG_QUOTA_MARGIN = 10;       // stay this far under Instagram's real limit
// The account's real limit is 100/24h (content_publishing_limit, checked 2026-09-27);
// a fixed 45 left half of it unused. Read it from Instagram (cached 10 min) and count
// with whichever is higher: our own log or Instagram's quota_usage.
let igQuotaCache: { at: number; total: number; usage: number } | null = null;
async function instagramQuota(env: Env): Promise<{ total: number; usage: number } | null> {
  if (igQuotaCache && Date.now() - igQuotaCache.at < 10 * 60_000) return igQuotaCache;
  try {
    const res = await fetch(`https://graph.facebook.com/${GRAPH_API_VERSION}/${env.INSTAGRAM_BUSINESS_ACCOUNT_ID}/content_publishing_limit?fields=config,quota_usage&access_token=${await getPageAccessToken(env)}`);
    const row: any = ((await res.json()) as any)?.data?.[0];
    const total = Number(row?.config?.quota_total), usage = Number(row?.quota_usage);
    if (Number.isFinite(total) && total > 0 && Number.isFinite(usage)) igQuotaCache = { at: Date.now(), total, usage };
  } catch {}
  return igQuotaCache;
}
/** Is there room for one more Instagram action, keeping `reserve` for show reels/stories? */
async function instagramRoomLeft(env: Env, reserve: number): Promise<boolean> {
  const q = await instagramQuota(env);
  const cap = q ? Math.max(IG_DAILY_CAP, q.total - IG_QUOTA_MARGIN) : IG_DAILY_CAP;
  const used = Math.max((await instagramActionsLast24h(env)).length, q?.usage ?? 0);
  return used < cap - reserve;
}
// Instagram takes ~90 posts a day and the site writes more news than that, so the day's posts go
// to what matters most (the owner, 2026-09-30). The writer rates each story high/normal/low
// (social_priority); high may use the whole news budget, normal leaves IG_HIGH_RESERVE of it for
// the day's big stories, low goes only while less than half of it is used (INCIDENTS #162).
const IG_HIGH_RESERVE = 15;
async function instagramBudget(env: Env): Promise<{ used: number; cap: number }> {
  const q = await instagramQuota(env);
  const cap = q ? Math.max(IG_DAILY_CAP, q.total - IG_QUOTA_MARGIN) : IG_DAILY_CAP;
  return { used: Math.max((await instagramActionsLast24h(env)).length, q?.usage ?? 0), cap };
}
/** May a story of this priority take an Instagram slot, with `used` of `cap` gone in 24h? */
export function instagramAllowedFor(priority: unknown, used: number, cap: number): boolean {
  const news = cap - IG_VIDEO_RESERVE;
  if (priority === "high") return used < news;
  if (priority === "low") return used < news / 2;
  return used < news - IG_HIGH_RESERVE;
}
async function instagramActionsLast24h(env: Env): Promise<number[]> {
  try {
    const list = JSON.parse((await env.PUSH_KV?.get("ig_actions_24h")) || "[]");
    return Array.isArray(list) ? list.filter((t: number) => Date.now() - t < 24 * 3600_000) : [];
  } catch { return []; }
}
// Reels/stories come from the show-reel monitor (~every 15 min) while news polls
// every minute, so news took every free Instagram slot and a show's reels waited
// for hours (2026-09-25). A waiting video reserves the next slot.
async function markInstagramVideoWaiting(env: Env, waiting: boolean): Promise<void> {
  if (waiting) await env.PUSH_KV?.put("ig_video_waiting", String(Date.now())).catch(() => {});
  else await env.PUSH_KV?.delete("ig_video_waiting").catch(() => {});
}
async function instagramVideoWaiting(env: Env): Promise<boolean> {
  const at = Number((await env.PUSH_KV?.get("ig_video_waiting").catch(() => null)) || 0);
  if (!(at > 0 && Date.now() - at < 30 * 60_000)) return false;
  // Alternate: right after a video went out, the next slot belongs to news. With six shows
  // queued (a reel + a story each) a video was always waiting, and news got no Instagram
  // slot for two hours (INCIDENTS #86).
  const lastKind = await env.PUSH_KV?.get("ig_last_action_kind").catch(() => null);
  return lastKind !== "video";
}

async function publishToPlatform(
  env: Env, platform: Platform, key: string,
  item: { title: string; text?: string; url: string; image?: string; kind?: string; file?: string },
  verified: { imageBuffer?: ArrayBuffer; imageContentType?: string }, force: boolean,
): Promise<{ status: string; raw?: any }> {
  // Fail closed if state cannot be read; absence of a read is not permission to resend.
  const { state } = await githubReadState(env);
  if (!force && state[platform]?.[key]) return { status: "already_sent" };
  if (!force && platform !== "telegram" && (state.cooldowns?.[platform] || 0) > Date.now()) return { status: "rate_limited" };
  const result = await deliverOnce(env, `post:${platform}:${key}`, async () => {
    const r = await sendToPlatform(env, platform, key, item, verified, force);
    return { ok: r.status === "sent", status: r.status, ambiguous: r.status === "uncertain",
      error: r.status !== "sent"
        // Telegram says why in «description» («Bad Request: …»): keep it, a bare «failed» told nobody anything
        ? String(r.raw?.error?.message || r.raw?.result?.error?.message || (r.raw?.description ? `${r.raw.error_code || ""} ${r.raw.description}`.trim() : "") || r.status).slice(0, 300)
        : undefined };
  }, { force });
  if (result.ok) {
    await markSendSuccess(env, platform, key, item.file || "");
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

/**
 * A results report's title on social: the show and its date only. On the site the title
 * names the main event's winner on purpose (INCIDENTS #80, for search), and the word
 * replacements below never knew «فوز X في الحدث الرئيسي» — every report from 27 Sep went to
 * Telegram, Facebook and Instagram with the winner in it (INCIDENTS #106). Whatever the
 * subtitle says, it doesn't go out.
 */
export function socialResultsTitle(title: string): string {
  const t = String(title || "").trim();
  const dated = t.match(/^((?:نتائج|تسريبات)\s+(?:عرض|تسريبات|تسجيلات)[^()]*\([^)]*\))/);
  if (dated) return dated[1].trim();
  const named = t.match(/^((?:نتائج|تسريبات)\s+(?:عرض|تسريبات|تسجيلات)[^:：]*?)\s*[:：]/);
  return named ? named[1].trim() : t;
}

function sanitizeResultsTitleSpoilers(title: string): string {
  if (!title) return title;
  let clean = socialResultsTitle(title);
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

// «\b» only knows ASCII word characters: next to Arabic letters it never matches, so this returned
// false for every Arabic results report and they all went to social with the full title — the
// winners — and the report's opening instead of the fixed text (CMLL 28 Sep, INCIDENTS #127).
export function isResultsArticle(title: string = ""): boolean {
  // «نتائج تسجيلات عرض ROH TV» (TV tapings) is a results report too (INCIDENTS #137)
  // «تسريبات عرض WWE X AAA Worlds Collide…» is one too: it goes out like any report — the show's
  // name and the fixed line, never a result — and brings readers to the site (the owner, INCIDENTS #168).
  return /(?<![؀-ۿ])نتائج\s+(?:عرض|تسريبات|تسجيلات)(?![؀-ۿ])/.test(title) || /^تسريبات\s+(?:عرض|تسجيلات)(?![؀-ۿ])/.test(title.trim()) ||
         /\b(?:Full Show Results|Show Results|Live Coverage)\b/i.test(title);
}

/**
 * Would today's rules still hold this story? A rule fixed after a false hold used to leave that
 * hold in place for its full wait: «اتحاد MLW يعود إلى نظام الدفع…» and Bully Ray on Jaida Parker's
 * RAW debut stayed off social for hours after #159 (INCIDENTS #174). A title/lead hold is re-read
 * with the current word rules; an AI hold stands until the story itself says it isn't a spoiler.
 */
export function stillSpoiler(h: { why?: string; title?: string; lead?: string }, item?: any): boolean {
  if (item?.social_spoiler === true) return true; // the meaning check still says spoiler
  // The meaning check now says the event is old (an edit, or the age fix in #223): the words don't hold it
  if (item?.social_spoiler === false && item?.social_spoiler_age === "old") return false;
  if (h.why === "title") return isSingleMatchSpoiler(String(h.title || ""), "");
  if (h.why === "lead") return isSingleMatchSpoiler(String(h.title || ""), "") || isSingleMatchSpoiler(String(h.lead || ""), "");
  if (h.why === "ai") return !item || item.social_spoiler !== false || isSingleMatchSpoiler(String(item.title || ""), "");
  return true;
}

export function isSingleMatchSpoiler(rawTitle: string = "", plainText: string = ""): boolean {
  const title = (rawTitle || "").trim();
  if (!title) return false;
  // JS «\b» only knows ASCII word characters, so «/\bيهزم\b/» never matched an Arabic
  // title — every Arabic rule below was dead until 2026-09-27 (INCIDENTS #68).
  const ar = (alts: string) => new RegExp(`(?<![\\u0600-\\u06FF\\w])(?:${alts})`, "i");

  // Full show results go to social; leaked results of a taped show («نتائج تسريبات…») do not.
  if (/^نتائج\s+عرض(?![\u0600-\u06FF])/.test(title) || /\b(?:Full Show Results|Live Results|Show Results)\b/i.test(title)) {
    return false;
  }

  // A revealed/leaked outcome is a spoiler whatever else the title says («كشف نتيجة
  // نزال التأهيل…» from Ringside's "Spoiler: … Outcome Revealed" — INCIDENTS #56).
  if (/(?:^|[\s«])(?:كشف|الكشف عن|تسريب|حرق|يكشف|تكشف)\s+(?:عن\s+)?(?:نتيجة|الفائز|هوية الفائز|الفائزة)|نتيجة\s+(?:نزال|مواجهة)\s+(?:التأهل|التأهيل|تصفيات)/.test(title) ||
      /\bspoiler\b[^\n]*\b(?:outcome|result|winner|wins?|qualif)/i.test(title)) {
    return true;
  }

  // Returns, debuts and surprise appearances never go to social — the owner's rule
  // (2026-09-27: «ساموا جو يعود في عرض AEW All Out» reached Telegram and Facebook).
  // A return that hasn't happened is not a spoiler: «كوري غريفز… لا يستبعد العودة إلى المصارعة»,
  // «أنتوني هنري لا يعرف ما إذا كان سيعود» (injury/clearance stories — INCIDENTS #95).
  // «منذ ظهوره الأول في أبريل» is a debut months ago told as history, not tonight's (INCIDENTS #154).
  // «كايري ساني تعود إلى التدريبات داخل الحلبة» is back in training, not back on a show (INCIDENTS #155).
  const notYetReturn = ar("(?:ي|ت)?عود(?:ة|ته|تها|تهم)?\\s+(?:إلى|الى|ل)\\s*(?:ال)?(?:تدريبات|تدريب|تمارين|تمرين|صالة)|(?:لا\\s+)?(?:يستبعد|تستبعد|يأمل|تأمل|يتمنى|تتمنى|يفكر|تفكر|يخطط|تخطط|يقترب|تقترب|يستعد|تستعد|ينتظر|تنتظر|يلمح|تلمح|يتطلع|تتطلع|يرغب|ترغب|يريد|تريد)(?:\\s+(?:في|إلى|الى|من|ل))?\\s+(?:ال)?عود(?:ة|ته|تها|تهم)|(?:موعد|توقيت|تفاصيل|خطط|احتمال|إمكانية|فرص)\\s+(?:ال)?عود(?:ة|ته|تها|تهم)|(?:ما\\s+)?إذا\\s+كان(?:ت)?\\s+(?:س|ست)?(?:يعود|تعود)|هل\\s+(?:س)?(?:يعود|تعود)|قد\\s+(?:يعود|تعود)|لن\\s+(?:يعود|تعود)|(?:كان|كانت)\\s+(?:من\\s+)?(?:المفترض|المقرر|مقررا|مخططا|يفترض)\\s+(?:أن|ان)\\s+\\S+\\s+(?:ظهور(?:ه|ها|هم)?\\s+الأول|عود(?:ة|ته|تها|تهم))|(?:موعد|خطط|خطة|تفاصيل)\\s+(?:ال)?ظهور(?:ه|ها|هم)?\\s+الأول|منذ\\s+(?:ظهور(?:ه|ها|هم)?\\s+الأول|أول\\s+ظهور\\s+ل\\S+|عود(?:ته|تها|تهم))");
  // A promotion or a format coming back is not a wrestler's return: «اتحاد MLW يعود إلى نظام الدفع
  // مقابل المشاهدة» was held as a spoiler (INCIDENTS #159).
  const formatReturn = ar("(?:ي|ت)?عود(?:ة|ته|تها)?\\s+(?:إلى|الى|ل)\\s*(?:ال)?(?:نظام|الدفع\\s+مقابل\\s+المشاهدة|البث|قناة|منصة|التلفزيون|تلفزيون)|^(?:اتحاد|شركة|منظمة|عرض|عروض)\\s+\\S+(?:\\s+\\S+)?\\s+(?:يعود|تعود)|^عودة\\s+(?:اتحاد|شركة|منظمة|عرض|عروض)(?![\\u0600-\\u06FF])");
  // An announced return on a show still to come is a match card, not a spoiler: «عودة فريق ذا إيليت
  // ونزال مرتقب… ضمن عرض AEW Dynamite» — Tony Khan's announcement for that night (INCIDENTS #171).
  const announced = ar("مرتقب|مرتقبة|المرتقب|المرتقبة|سيشهد|ستشهد|يستعد|تستعد|القادم|القادمة|المقبل|المقبلة|الليلة").test(title) && !ar("يعود في|تعود في|عاد|عادت|يسجل عودته|تسجل عودتها|بعد عودته|بعد عودتها").test(title);
  // News ABOUT a return still to come: «آخر التطورات حول عودة نايومي إلى WWE» — she hasn't been
  // back yet, the story says her name isn't even in creative talks (INCIDENTS #204).
  const pendingReturn = ar("(?:آخر\\s+)?(?:التطورات|تطورات|المستجدات|مستجدات|تحديث|تحديثات|تقارير|موعد|توقيت|خطط|أنباء|شائعات|تفاصيل)\\s+(?:جديدة\\s+|الكواليس\\s+|كواليس\\s+)?(?:حول|بشأن|عن)\\s+(?:ال)?عودة");
  // «عند عودته» / «حين عودتها» is a return still to come: Bronson Reed's lead «…بشكل أفضل عند عودته
  // إلى عروض WWE» — he's out with a torn biceps (INCIDENTS #212).
  const whenReturn = ar("(?:عند|لدى|حين|حال|فور|قبل|بمجرد|قرب|اقتراب)\\s+(?:موعد\\s+)?(?:عودته|عودتها|عودتهم|عودتهما|العودة)");
  // Talking ABOUT a return that is history: «نيكي بيلا تقول إن التغيرات… جعلت عودتها إلى WWE أكثر صعوبة»
  // — she came back in 2025 (INCIDENTS #228). The return is the subject of the talk, not tonight's news.
  const aboutReturn = ar("(?:جعلت|جعل|صعوبة|صعوبات|تحديات|ذكريات|أسرار|كواليس|تفاصيل)\\s+(?:ال)?(?:عودته|عودتها|عودتهم|عودة)");
  const returnTitle = announced || pendingReturn.test(title) ? "" : title.replace(new RegExp(notYetReturn.source, "gi"), " ").replace(new RegExp(formatReturn.source, "gi"), " ").replace(new RegExp(whenReturn.source, "gi"), " ").replace(new RegExp(aboutReturn.source, "gi"), " ");
  if (ar("(?:و|ف)?(?:يعود|تعود|يعودان|يعودون|عودة|عودته|عودتها|عودتهم|العودة|العائد|العائدة|يسجل عودته|تسجل عودتها|الظهور الأول|ظهوره الأول|ظهورها الأول|ظهورهم الأول|أول ظهور|ظهور مفاجئ|ظهورا مفاجئا|يظهر لأول مرة|تظهر لأول مرة|ظهوره المفاجئ|ظهورها المفاجئ)").test(returnTitle) ||
      /\b(?:returns?|returned|returning|comeback|debuts?|debuted|debuting|surprise (?:appearance|return|entrant)|makes? (?:\w+ )?appearance|shows? up|reappears?)\b/i.test(title)) {
    return true;
  }

  // An Arabic title that states a result is a spoiler whatever else it says
  // («… يهزم … ويكشف …» used to fall into the «يكشف» interview safeguard below).
  const hasArabicDefeat = ar("يهزم|يهزمان|يهزمن|يسقط|يتفوق على|ينتصر على|يتغلب على|يحسم مواجهة لصالح").test(title);
  const hasArabicQualifier = ar("يتأهل لـ|يتأهل لمواجهة|يتأهل في تصفيات|يحسم تأهله|يقصي|يخرج من تصفيات").test(title);
  const hasArabicRetain = ar("يحتفظ بـ|يحتفظ بلقب|يحتفظ ببطولة|يحافظ على لقب|يحافظ على بطولة|احتفاظ باللقب|احتفاظ بالبطولة").test(title);
  const hasArabicWin = ar("يتوج بلقب|يتوج ببطولة|يخطف لقب|يقتنص بطولة|يفوز بلقب|يفوز ببطولة|ينتزع لقب|ينتزع بطولة|يصبح المنافس الأول").test(title);
  if (hasArabicDefeat || hasArabicQualifier || hasArabicRetain || hasArabicWin) return true;
  // A win someone is aiming for is not a result: «كاسي لي: الفوز ببطولة AEW… هو هدفي الأبرز» (INCIDENTS #155).
  const goalTitle = ar("(?:يطمح|تطمح|يسعى|تسعى|يحلم|تحلم|يريد|تريد|يرغب|ترغب|يتمنى|تتمنى|يأمل|تأمل|هدف(?:ه|ها|ي|هم)?|حلم(?:ه|ها|ي|هم)?|طموح(?:ه|ها|ي|هم)?)(?![\\u0600-\\u06FF])").test(title)
    ? title.replace(new RegExp(ar("(?:ب|ل|إلى\\s+|الى\\s+|في\\s+)?(?:ال)?فوز\\s+(?:ب|بـ)").source, "gi"), " ")
    : title;
  // Betting odds before a card are a preview, not a result: «الكشف عن ترشيحات ونسب الفوز لمواجهات
  // UFC 332» was held (INCIDENTS #216).
  // Not needing / not chasing wins is not a result: «جيريكو يؤكد أنه لا يحتاج لتحقيق أي انتصار آخر» (INCIDENTS #237)
  const noNeed = ar("(?:لا|لم\\s+يعد|لن)\\s+(?:يحتاج|تحتاج|يهتم|تهتم|يسعى|تسعى|يريد|تريد|يبحث|تبحث)").test(title)
    ? goalTitle.replace(new RegExp(ar("(?:ل|إلى\\s+)?(?:تحقيق\\s+)?(?:أي\\s+)?(?:ال)?(?:انتصار|انتصارات|فوز)(?:\\s+آخر|\\s+أخرى)?").source, "gi"), " ")
    : goalTitle;
  // A prediction is not a result: «بولي راي يتكهن بتحالف ال ايه نايت مع 946 وهزيمة رومان رينز» (INCIDENTS #246)
  const speculation = ar("يتكهن|تتكهن|يتوقع|تتوقع|يتنبأ|تتنبأ|يرشح|ترشح|يقترح|تقترح|يطالب|تطالب|يتمنى|تتمنى|تكهنات|توقعات").test(title);
  const oddsFree = (speculation ? "" : noNeed).replace(new RegExp(ar("(?:و|ف)?(?:نسب|احتمالات|حظوظ|فرص|ترشيحات)\\s+(?:ال)?فوز").source, "gi"), " ");
  // Any win/loss wording at all. Verb lists always missed a phrasing («فريق Sisters Of Sin
  // يحقق الفوز في عرض AEW All Out» reached Telegram and Facebook — INCIDENTS #71), and the
  // owner's rule is absolute: no match outcome on social, only full results reports.
  if (ar("(?:و|ف)?(?:ال)?(?:فوز|فوزا|فوزًا|فوزه|فوزها|فوزهم|فوزهما|تجاوز|يتجاوز|تتجاوز|تجاوزه|تجاوزها|تخطى|يتخطى|تتخطى|تخطت|تخطيه|يفوز|تفوز|يفوزان|تفوزان|يفوزون|فاز|فازت|انتصار|انتصاره|انتصارها|انتصارا|ينتصر|تنتصر|انتصر|انتصرت|تغلب|يتغلب|تتغلب|يتغلبان|تغلبت|يهزم|تهزم|يهزمان|هزم|هزمت|هزيمة|الهزيمة|يسقط|تسقط|أسقط|أسقطت|يطيح|تطيح|أطاح|أطاحت|يحتفظ|تحتفظ|يحتفظان|احتفظ|احتفظت|احتفاظ|يتوج|تتوج|يتوجان|توج|تتويج|يخسر|تخسر|خسر|خسرت|خسارة|خسارته|خسارتها|يتأهل|تتأهل|يتأهلان|تأهل|تأهلت|يقصي|تقصي|أقصى|إقصاء|ينتزع|تنتزع|انتزع|انتزعت|يخطف|تخطف|خطف|يحسم|تحسم|حسم|يكتسح|تكتسح|يسحق|تسحق|يثبت|تثبت|تثبيت|يستسلم|تستسلم|إخضاع|يخضع|تخضع|ينجو|تنجو|يبطل|يجرد|تجرد)(?![\\u0600-\\u06FF])").test(oddsFree)) return true;
  // A match that ended without a normal finish is an outcome too («إيقاف نزال ستيفن بوردن… بعد
  // اصطدام في الرأس» reached Instagram — INCIDENTS #75).
  if (ar("إيقاف\\s+(?:ال)?(?:نزال|مواجهة|مباراة)|توقف\\s+(?:ال)?(?:نزال|مواجهة)|(?:ينتهي|انتهى|انتهاء|نهاية)\\s+(?:ال)?(?:نزال|مواجهة|مباراة)|إلغاء\\s+(?:ال)?نزال\\s+(?:بعد|خلال|أثناء)|بدون\\s+نتيجة|بلا\\s+نتيجة|بالتعادل|تعادل").test(title)) return true;

  // Preserved content safeguards
  if (ar("الإعلان عن|تحديد موعد|نزال مرتقب|مواجهة مرتقبة|نزالات التصفية|قائمة نزالات|بطاقة عرض|سيواجه|يواجه|يتحالف مع").test(title) ||
      /\b(?:set for|announced for|added to|scheduled for|card for|match card|lineup for|line-up for|official for|will face|to face|to battle|to clash|to meet|to team|to challenge|to defend|to appear)\b/i.test(title)) {
    return false;
  }

  if (ar("يوقع مع|تجديد عقد|يغادر|رحيل|فسخ عقد|انتقال|يظهر في|يشارك في").test(title) ||
      /\b(?:returns? to|makes? (?:surprise )?return|debuts? (?:on|at|in)|makes? debut|signs? with|signed with|contract|free agent|re-signs?|departs?|leaves?|released by|makes? (?:surprise )?appearance|shows? up at)\b/i.test(title)) {
    return false;
  }

  if (ar("كواليس|خلف كواليس|تصريحات|يعلق على|يرد على|يوضح|يكشف|يتحدث عن|يشيد بـ|يهاجم|ينتقد|شائعات|تقارير تصف|حديث|حوار").test(title) ||
      /\b(?:comments on|comments after|reacts to|reflects on|explains|discusses|reveals|details|opens up|recalls|speaks on|addresses|says|tells|praises|blasts|slams|shuts down|teases|advocates|pitches|names|backstage at|loves|remembers|unhappy with|frustrated with)\b/i.test(title) ||
      /^[A-Za-z0-9'\s\.\-]+?\s*:\s*['"“]/i.test(title)) {
    return false;
  }

  if (ar("إصابة|جراحة|الرباط الصليبي|كسر|ابتعاد|غياب|وعكة صحية|مستشفى|وفاة|قاعة المشاهير|نسب مشاهدة|تقييمات|مبيعات تذاكر").test(title) ||
      /\b(?:injury|injured|surgery|torn acl|neck injury|pulled from|medical|health|hospital|out indefinitely|gofundme|trailer|movie|film|podcast|hall of fame|funeral|passes away|passed away|dies at|death of|historic gate|ticket sales|viewership|ratings)\b/i.test(title)) {
    return false;
  }


  const hasEnglishDefeat = /\b(?:defeats?|defeated|defeating|def\.|beats?|beaten|pins?|pinned|submits?|submitted|triumphs? over|victorious over)\b/i.test(title);
  const hasEnglishQualifier = /\b(?:qualifies? for|qualified for|advances? (?:to|in)|advanced (?:to|in)|eliminates?|eliminated from)\b/i.test(title);
  const hasEnglishRetain = /\b(?:retains?|retained)\s+(?:the\s+)?(?:.*?\s+)?(?:championships?|titles?|champions?|gold|belts?|crowns?)|retains? against\b/i.test(title);
  const hasEnglishWin = /\b(?:wins?|won|captures?|captured|crowned(?: new)?|becomes(?: new)?)\s+(?:the\s+)?(?:.*?\s+)?(?:championships?|titles?|champions?|gold|belts?|crowns?|ladder match(?:es)?|battle royals?|eliminators?)\b/i.test(title) ||
                        /\bbecomes (?:the\s+)?no\.?\s*1 contender\b/i.test(title) ||
                        /\bearns (?:a\s+)?(?:.*?\s+)?title shot\b/i.test(title);
  const hasEnglishSurvive = /\bsurvives?.*to retain\b/i.test(title);

  // Live in-show angles/attacks/segments from weekly shows
  const hasArabicLiveShow = ar("(?:في عرض|خلال عرض|عبر عرض|بعرض)\\s+(?:WWE\\s+|AEW\\s+)?(?:RAW|SmackDown|NXT|الرو|سماك\\s*داون|إمباكت|Dynamite|Collision|داينمايت|كوليجن)").test(title);
  const hasArabicLiveAngle = ar("يهاجم|تهاجم|يعتدي على|تعتدي على|يغدر بـ|تغدر بـ|يصدم|يواجه|تواجه|يصفع|تصفع|يقتحم|تقتحم|يشعل|يشعلان|تظهر في|يظهر في|يفاجئ|تفاجئ|يقاطع|تقاطع").test(title);
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

// Same date cutoff as eligiblePublication, but resolved independently for show
// reel videos: a show whose air date is before the cutoff must still be able to
// finish publishing to platforms it hasn't reached yet if it was already
// accepted into the pipeline before (i.e. it already has a show-reel-state.json
// entry — proof, read directly from GitHub rather than trusted from the caller,
// that this isn't an old show being newly/accidentally republished). Mirrors
// shouldProcessShow() in scripts/show-reel-monitor.ts, which had the same bug:
// without this, a show that aired just before WATCHER_MIN_DATE and got Instagram
// published but not Facebook could never complete Facebook, forever.
async function hasTrackedShowProgress(env: Env, videoFilename: string): Promise<boolean> {
  try {
    const response = await fetch(cacheBust(`https://raw.githubusercontent.com/${env.GITHUB_OWNER}/${env.GITHUB_REPO}/${env.GITHUB_BRANCH}/_data/show-reel-state.json`));
    if (!response.ok) return false;
    const state: Record<string, any> = await response.json();
    return Object.keys(state).some(slug => videoFilename === `reel-${slug}.mp4` || videoFilename === `reel-${slug.slice(0, 45)}.mp4`);
  } catch { return false; }
}

// A parsed watcher-recent-content.json is only trustworthy if it actually
// looks like the site's own content feed and not, say, a SPA-fallback HTML
// page that happened to parse-as-JSON-shaped, or some other feed entirely.
function looksLikeContentFeed(data: any): data is any[] {
  return Array.isArray(data) && data.length > 0 && typeof data[0]?.title === "string" && typeof data[0]?.url === "string";
}

// Independent safety net, deliberately separate from the CPU-limit fixes
// above: those close off the specific failure modes already seen, but this
// is the fallback for "something nobody anticipated yet." If nothing has
// actually gone out on any platform in 20+ minutes while genuinely fresh
// (unpublished) content exists, the admin gets a direct Telegram message —
// so the very next stall, whatever eventually causes it, is noticed within
// minutes instead of being found by chance while browsing the site.
async function checkPublishingStalled(env: Env, items: any[]): Promise<void> {
  if (!env.PUSH_KV || !env.ADMIN_TELEGRAM_CHAT_ID) return;
  try {
    const now = Date.now();
    const STALL_THRESHOLD_MS = 20 * 60 * 1000;

    const lastSuccess = Number(await env.PUSH_KV.get("last_successful_publish_ts")) || 0;
    if (!lastSuccess) return; // no baseline yet (e.g. right after this feature was deployed)
    if (now - lastSuccess < STALL_THRESHOLD_MS) return;

    // Don't alert on a quiet news day with nothing new to post — only when
    // there's demonstrably fresh work that should have gone out by now.
    const hasFreshWork = items.some((it) => {
      const ts = it?.date ? new Date(it.date).getTime() : 0;
      return ts > 0 && now - ts < STALL_THRESHOLD_MS;
    });
    if (!hasFreshWork) return;

    const ALERT_THROTTLE_MS = 30 * 60 * 1000;
    const lastAlert = Number(await env.PUSH_KV.get("last_stall_alert_ts")) || 0;
    if (now - lastAlert < ALERT_THROTTLE_MS) return;

    const minutesSinceSuccess = Math.round((now - lastSuccess) / 60000);
    const text = `⚠️ تنبيه: النشر التلقائي متوقف منذ ${minutesSinceSuccess} دقيقة رغم وجود أخبار جديدة تنتظر النشر على المنصات. راجع لوحة الواتشر أو تحقق من الـ Worker.`;

    await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: env.ADMIN_TELEGRAM_CHAT_ID, text }),
    }).catch(() => {});

    await env.PUSH_KV.put("last_stall_alert_ts", String(now));
  } catch (e) {
    // A broken watchdog must never break the watcher itself.
  }
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
    const data = res.ok ? await res.json().catch(() => null) : null;
    if (looksLikeContentFeed(data)) {
      items = data;
    } else {
      // Fall back to the full index if the lightweight feed is ever missing,
      // stale-deployed, or serves something unexpected — slower, but this is
      // the one feed that has never gone unavailable, so publishing degrades
      // instead of silently doing nothing for hours.
      console.warn("[Watcher] watcher-recent-content.json unavailable or invalid, falling back to search-index.json");
      const fallbackRes = await fetch(cacheBust(`${env.SITE_ORIGIN}/search-index.json`), {
        headers: { "Cache-Control": "no-cache" },
      });
      if (!fallbackRes.ok) return;
      const fallbackData = await fallbackRes.json();
      items = Array.isArray(fallbackData) ? fallbackData : [];
    }
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
  // Briefly raised to 3 after the paid-plan upgrade to fix Instagram
  // catch-up starving on regular news — that fix caused a worse regression
  // (tripling per-tick work reintroduced "Exceeded CPU Limit" on
  // essentially every tick, confirmed live via wrangler tail) and was
  // reverted back to 1. The actual fix for starvation is the alternating
  // priority below, which doesn't cost any extra CPU.
  const MAX_PER_TICK = 1;
  let platformAttempts = 0;
  const MAX_PLATFORM_ACTIONS_PER_TICK = MAX_PER_TICK * 2;
  const takeSlot = () => platformAttempts < MAX_PLATFORM_ACTIONS_PER_TICK ? (++platformAttempts, true) : false;
  let bufferXAttemptedInTick = 0;
  // Buffer's own rate limit is shared across everything that uses it —
  // deliberately not scaled with MAX_PER_TICK.
  const MAX_BUFFER_PER_TICK = 1;

  // Two-pass scan. A single fixed item-count cap on the *whole* scan
  // (tried first) turned out to just move the problem: once the backlog of
  // still-incomplete articles within the 18h window grew past that cap,
  // anything beyond it (however old) became permanently invisible to every
  // future tick — observed live, an article sat untouched for 16+ hours
  // while everything ahead of it in the scan order kept it buried. So the
  // *cheap* part of the scan (date/window checks, key lookup, the four
  // done-flags) now runs across the entire 18h window uncapped — none of
  // that involves regex or I/O, and it's what lets an old backlog item be
  // found at all. Only the *expensive* per-item work (the regex-heavy
  // spoiler check, verifyLiveOnSite, actual publish attempts) is bounded to
  // a small number of the oldest candidates — the exact cost that was
  // blowing the CPU limit before, now capped independently of backlog size.
  const WINDOW_MS = 3 * 60 * 60 * 1000;
  // The owner's rule (2026-09-29): a result or a return is a spoiler for 24 hours only. A story
  // held for it goes out on its own — since 2026-09-30, 12 hours after the hold (the owner:
  // «خلي اي حاجة اتحجزت تتنشر بعد 12 ساعة») — unless the owner chose «سيبه». Only holds from
  // the last 36 hours: older ones aren't dug back up.
  {
    const nowMs = Date.now();
    const byKey = new Map(items.map((it: any) => [sanitizeKey(normalizeArticleUrl(env.SITE_ORIGIN + (it.url || ""))), it]));
    const due = Object.entries(state.held || {}).filter(([k, h]) => h && !h.releasedAt && !h.dismissedAt
      && nowMs - h.at < 36 * 3600_000 && (nowMs - h.at >= HOLD_RELEASE_MS || !stillSpoiler(h, byKey.get(k))));
    if (due.length) {
      state.released = state.released || {};
      for (const [k, h] of due) {
        state.released[k] = nowMs;
        for (const p of ["telegram", "facebook", "instagram", "x"] as const) delete state[p][k];
        for (const d of Object.keys(state.deferrals || {})) if (d.endsWith(`:${k}`)) delete state.deferrals![d];
        h.releasedAt = nowMs;
        h.by = nowMs - h.at >= HOLD_RELEASE_MS ? "تلقائي بعد ١٢ ساعة" : "تلقائي: القاعدة اللي حجزته اتصلحت";
      }
      const w = await githubWriteState(env, state, currentSha, `social shield: release ${due.length} held stor${due.length === 1 ? "y" : "ies"} after 12 hours`).catch(() => ({ ok: false }));
      if (!w.ok) return; // someone else wrote first: next minute reads the fresh state
      ({ sha: currentSha, state } = await githubReadState(env));
    }
  }
  const recentReleases = new Set(Object.entries((state as any).released || {}).filter(([, t]) => Date.now() - Number(t) < WINDOW_MS).map(([k]) => k));
  const candidates: { item: any; ts: number; freshFrom: number; key: string; tgDone: boolean; fbDone: boolean; igDone: boolean; xDone: boolean }[] = [];
  const igBudget = await instagramBudget(env).catch(() => ({ used: 0, cap: IG_DAILY_CAP }));
  const fileBackfill: Record<string, string> = {};
  for (const item of items) {
    const ts = item.date ? new Date(item.date).getTime() : 0;
    if (!Number.isFinite(ts) || !ts || ts > Date.now() || (minDate && ts < minDate)) continue;
    // once we hit one older than the window, everything after it is older
    // too — stop scanning instead of continuing to burn CPU on the rest.
    // Deliberately short (was 18h): with 3 active sources and today's
    // repeated stalls, the backlog of still-incomplete-but-old articles
    // kept growing deep enough to either blow the CPU limit or starve
    // brand-new articles behind it. Per the site owner: don't chase down
    // old backlog on social media at all — only genuinely fresh content is
    // worth the server load of trying. Articles past this window simply
    // never get attempted on social (the site itself is unaffected).
    //
    // The 3h window is measured from when the article REACHED THE SITE
    // (published_at), not from the source's own date: on 2026-09-24 a Gemini
    // quota outage delayed 9 articles by 3-5h, they appeared on the site with
    // source dates already outside the window and were never posted anywhere
    // (INCIDENTS #36). The feed is sorted by source date, so a delayed article
    // can sit below older-dated ones — only stop scanning past the watchers'
    // own 24h source-age limit (+2h slack), skip the rest individually.
    // Past the scan limit only a story the owner just released from the spoiler hold is still wanted.
    const tooOld = !!ts && (Date.now() - ts) > 26 * 60 * 60 * 1000;
    if (tooOld && !recentReleases.size) break;
    const key = sanitizeKey(normalizeArticleUrl(env.SITE_ORIGIN + (item.url || "")));
    if (!key || (tooOld && !recentReleases.has(key))) continue;
    const reachedSiteAt = item.published_at ? new Date(item.published_at).getTime() : ts;
    const releasedAt = Number((state as any).released?.[key]) || 0;
    const freshFrom = Math.max(Number.isFinite(reachedSiteAt) && reachedSiteAt > 0 ? reachedSiteAt : ts, releasedAt);
    let tgDone = !!state.telegram[key];
    let fbDone = !!state.facebook[key];
    let igDone = !!state.instagram[key];
    // Not important enough for today's remaining Instagram posts: Telegram and Facebook only (#162)
    if (!igDone && item.kind !== "show" && !instagramAllowedFor(item.social_priority, igBudget.used, igBudget.cap)) igDone = true;
    let xDone = !!state.x[key];
    // Same file under an earlier URL (its title was edited): it already went out — never again.
    const file = contentFileId(item);
    const firstKey = file ? state.byFile?.[file] : "";
    if (firstKey && firstKey !== key) continue;
    if (file && !firstKey && (tgDone || fbDone || igDone || xDone)) fileBackfill[file] = key;
    if (tgDone && fbDone && igDone && xDone) continue;
    // A show (a full episode) keeps a 12h window: on a day with six shows, their Instagram
    // posts queued behind the shows' own reels/stories and the news, ran past 3h and would
    // never have been posted (INCIDENTS #87).
    const windowMs = item.kind === "show" ? 12 * 60 * 60 * 1000 : WINDOW_MS;
    if ((Date.now() - freshFrom) > windowMs) {
      // Past its window. A platform that was paused (rate-limit cooldown) while
      // the article was fresh gets WINDOW_MS after the pause ends — only that
      // platform, only for articles under 12h old at that point. Otherwise a
      // long Instagram pause silently cost every article in it its Instagram
      // post (2026-09-24: 16 articles, INCIDENTS #44).
      const catchUp = (platform: "facebook" | "instagram", done: boolean) => {
        const pauseEnd = state.cooldowns?.[platform] || 0;
        return !done && pauseEnd > freshFrom && pauseEnd <= Date.now()
          // 6h after the pause: with 10 minutes between Instagram posts (#47)
          // a long pause's backlog needs more than the normal 3h to drain.
          && Date.now() - pauseEnd < 2 * WINDOW_MS && pauseEnd - freshFrom < 12 * 60 * 60 * 1000;
      };
      // Telegram is never paused, so it has no catch-up.
      const fbCatch = catchUp("facebook", fbDone), igCatch = catchUp("instagram", igDone);
      if (!fbCatch && !igCatch) continue;
      tgDone = true; fbDone = fbDone || !fbCatch; igDone = igDone || !igCatch; xDone = true;
    }
    candidates.push({ item, ts, freshFrom, key, tgDone, fbDone, igDone, xDone });
  }
  // Stories that went out before files were recorded: remember their file now (one write a tick)
  if (Object.keys(fileBackfill).length) {
    try {
      const { sha, state: fresh } = await githubReadState(env);
      fresh.byFile = fresh.byFile || {};
      let added = 0;
      for (const [f, k] of Object.entries(fileBackfill)) if (!fresh.byFile[f]) { fresh.byFile[f] = k; added++; }
      const entries = Object.entries(fresh.byFile);
      if (entries.length > 3000) fresh.byFile = Object.fromEntries(entries.slice(-2000));
      if (added) { const w = await githubWriteState(env, fresh, sha, "chore(publish): remember which file each posted story is"); if (w.ok) state.byFile = fresh.byFile; }
    } catch { /* next tick */ }
  }

  // Oldest-incomplete-first within each group, so a steady stream of newer
  // arrivals (3 active sources) can't keep jumping the queue and starve an
  // older article indefinitely. Capped to the oldest 40 candidates for the
  // expensive path.
  //
  // Split into "never posted anywhere yet" vs "only needs catch-up on
  // remaining platforms" (a partially-done article can sit re-deferring on
  // one stubborn platform, each retry consuming the tick's one slot without
  // ever finishing). With MAX_PER_TICK back down to 1, giving either group
  // *permanent* priority starves the other whenever it's non-empty — first
  // tried notStarted-always-first, which starved catch-up so completely
  // that Instagram went silent on regular news for 2+ hours straight while
  // a continuous stream of new articles kept arriving. Alternating which
  // group goes first by tick minute bounds each group's worst-case wait to
  // about 2 minutes instead of "indefinitely, if the other group is never
  // empty" — at zero extra CPU cost, unlike raising MAX_PER_TICK (tried,
  // reverted: tripled per-tick work and reintroduced the CPU-limit failure
  // this whole split exists to avoid).
  let igSpacingOk = (await instagramSpacingWait(env)) === 0 && !(await instagramVideoWaiting(env))
    && (await instagramRoomLeft(env, IG_VIDEO_RESERVE));
  const MAX_EXPENSIVE_PER_TICK = 40;
  const notStarted = candidates.filter((c) => !c.tgDone).reverse();
  // Articles still missing Facebook: oldest first (as before). Articles missing only
  // Instagram: NEWEST first — Instagram can't take every article (daily cap), so a
  // fresh story beats one from hours ago.
  const catchUpOnly = [
    ...candidates.filter((c) => c.tgDone && !c.fbDone).reverse(),
    // Missing only Instagram: shows first (a full episode matters more than any one story).
    ...candidates.filter((c) => c.tgDone && c.fbDone && c.item.kind === "show"),
    // then the most important stories first, newest first within each (#162)
    ...candidates.filter((c) => c.tgDone && c.fbDone && c.item.kind !== "show")
      .map((c, i) => ({ c, i, r: c.item.social_priority === "high" ? 0 : c.item.social_priority === "low" ? 2 : 1 }))
      .sort((a, b) => a.r - b.r || a.i - b.i).map(x => x.c),
  ];
  const preferNotStarted = new Date().getUTCMinutes() % 2 === 0;
  const toProcess = (preferNotStarted ? [...notStarted, ...catchUpOnly] : [...catchUpOnly, ...notStarted])
    .slice(0, MAX_EXPENSIVE_PER_TICK);

  for (const { item, freshFrom, key, tgDone, fbDone, igDone, xDone } of toProcess) {
    if (processedInThisTick >= MAX_PER_TICK || platformAttempts >= MAX_PLATFORM_ACTIONS_PER_TICK) break;

    const now = Date.now();

    // Social Media Spoiler Shield:
    // Block individual match result stubs from social feeds.
    // General news (injuries, signings, returns, announcements) and full show results are published!
    const collection = item.kind === "show" ? "shows" : item.kind === "recap" ? "recaps" : "news";

    // Only worth checking before the first (telegram) post ever goes out —
    // once telegram is sent the item already cleared this gate, and
    // re-running the regex-heavy check on every tick for the whole
    // still-catching-up backlog was itself a real CPU cost contributing to
    // hitting the Worker's per-invocation limit.
    // Checked before EVERY platform, not only before Telegram: an item already on
    // Telegram could still reach Instagram later (INCIDENTS #68). The check is a few
    // regexes on the title and toProcess is capped per tick, so the cost stays small.
    // state.released[key]: an item the owner cleared after a false spoiler hit. Read from the
    // publish state itself, so a release doesn't wait for the site's feed to rebuild — the
    // Harley Cameron and Paige stories were re-blocked by the stale feed flag (INCIDENTS #89).
    if (collection === "news" && !(tgDone && fbDone && igDone && xDone) && !(state as any).released?.[key]) {
      // What goes out on social is the title and the start of the story (headline, description
      // or the first ~220 letters of the page). The writer's flag marks any story about a show
      // that just aired, even when only a later paragraph mentions a result — on its own it kept
      // clean stories (a tribute, a medical clearance, a match announcement) off social
      // (INCIDENTS #104). A flagged story is held only when that opening gives something away.
      let why: HeldEntry["why"] | "" = isSingleMatchSpoiler(item.title, "") ? "title" : "";
      // The title's words say «result» but the meaning check read the finished text and found the
      // event is over a week old («… when he won the AEW title» — last April): not a spoiler.
      // Only this exact, stated reason overrules the words (INCIDENTS #107).
      const statedOld = item.social_spoiler === false && item.social_spoiler_age === "old";
      if (statedOld) why = "";
      let lead = "";
      // Second opinion written with the story: an AI read of the finished title + opening for
      // what they mean (word lists always miss a phrasing). Either one saying «spoils» holds it.
      if (!why && item.social_spoiler === true) why = "ai";
      if (!why && !statedOld && item.single_match_result === true) {
        lead = String(item.headline || item.description || "");
        if (!lead) {
          try { const r = await fetch(cacheBust(env.SITE_ORIGIN + (item.url || "")), { headers: { "Cache-Control": "no-cache" } }); if (r.ok) lead = extractSnippetFromHtml(await r.text()); } catch { /* next minute */ }
        }
        if (!lead) continue; // the page isn't readable yet: decide on the next tick
        if (isSingleMatchSpoiler(lead, "")) why = "lead";
      }
      if (why) {
        // «Reached a platform» is read from the stamps themselves: igDone is also true for a story
        // today's Instagram ration skips (#162), which left two holds unrecorded (INCIDENTS #185).
        const reachedAny = !!(state.telegram[key] || state.facebook[key] || state.instagram[key]);
        state.telegram[key] = now;
        state.facebook[key] = now;
        state.instagram[key] = now;
        state.x[key] = now;
        state.held = state.held || {};
        // Only a story that reached no platform yet is «held»; one already out (a title edited
        // into a spoiler later) is just stopped from going further.
        if (!reachedAny) state.held[key] = { at: now, title: String(item.title || "").slice(0, 240), url: String(item.url || ""), image: item.image || "", reason: why === "ai" ? (item.social_spoiler_kind === "return" ? "return" : item.social_spoiler_kind === "show" ? "show" : "result") : spoilerReason(why === "title" ? item.title : lead), why, ...(lead ? { lead: lead.slice(0, 240) } : {}), ...(item.social_spoiler_note ? { note: String(item.social_spoiler_note).slice(0, 200) } : {}) };
        for (const [k, h] of Object.entries(state.held)) if (now - (h?.at || 0) > 7 * 86400_000) delete state.held[k];
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
    const canDoIg = env.INSTAGRAM_AUTO_ENABLED !== "false" && !igDone && !igCooldown && !deferred("instagram") && igSpacingOk;
    // Facebook publishes news and shows normally as posts
    const canDoFb = !fbDone && !fbCooldown && !deferred("facebook");
    const canDoX = env.X_AUTO_ENABLED !== "false" && !xDone && !xCooldown && !deferred("x") && bufferXAttemptedInTick < MAX_BUFFER_PER_TICK;

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
        file: contentFileId(item),
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
      if (canDoIg && takeSlot()) {
        await publishToPlatform(env, "instagram", key, { ...payload, image: item.image, kind: item.kind }, {}, false);
        await markInstagramAction(env);
        igSpacingOk = false;
      }
      if (canDoX && takeSlot()) {
        bufferXAttemptedInTick++;
        await publishToPlatform(env, "x", key, { ...payload, image: item.image }, {}, false);
      }
    } else {
      // Telegram already sent — only catch up missing platforms if the article
      // reached the site under 12 hours ago (published_at, not the source date:
      // articles recovered hours after their source date were never caught up
      // on Instagram — INCIDENTS #46). Never publish old historical articles!
      const isFresh = freshFrom > 0 && (now - freshFrom) < 12 * 60 * 60 * 1000;
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
      const payload = { title: cleanTitle, text: catchUpText, url: env.SITE_ORIGIN + (item.url || ""), file: contentFileId(item) };
      if (canDoFb && takeSlot()) {
        await publishToPlatform(env, "facebook", key, { ...payload, image: item.image, kind: item.kind }, {}, false);
        didWork = true;
      }
      if (canDoIg && takeSlot()) {
        await publishToPlatform(env, "instagram", key, { ...payload, image: item.image, kind: item.kind }, {}, false);
        await markInstagramAction(env);
        igSpacingOk = false;
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

  await checkPublishingStalled(env, items);
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

// ── Studio dashboard: social publishing, Instagram room and the news sources, in one call ──
async function studioOverview(env: Env, body: any) {
  // Read through the studio helper so the local copy of the worker (no token) works too
  const stateFile = await readRepoFile(env, env.GITHUB_STATE_PATH);
  const state: any = stateFile ? JSON.parse(stateFile.content) : {};
  const now = Date.now();
  const platforms: Record<string, { last24h: number; last: number }> = {};
  for (const p of ["telegram", "facebook", "instagram", "x"] as const) {
    const times = Object.values((state as any)[p] || {}).map(Number).filter(Boolean);
    platforms[p] = { last24h: times.filter(t => now - t < 86400_000).length, last: times.length ? Math.max(...times) : 0 };
  }
  const urls: string[] = Array.isArray(body?.urls) ? body.urls.slice(0, 40).map(String) : [];
  const items: Record<string, any> = {};
  for (const u of urls) {
    const key = sanitizeKey(normalizeArticleUrl(new URL(u, env.SITE_ORIGIN).href));
    items[u] = {
      telegram: (state as any).telegram?.[key] || 0, facebook: (state as any).facebook?.[key] || 0,
      instagram: (state as any).instagram?.[key] || 0, released: !!(state as any).released?.[key],
      deferred: !!(state as any).deferrals?.[key],
    };
  }
  const sources: any[] = [];
  for (const [name, file] of [["فايتفول", "watcher-state.json"], ["رسلينغ إنك", "wrestlinginc-state.json"], ["رينغسايد نيوز", "ringsidenews-state.json"]]) {
    try {
      const f = await readRepoFile(env, file);
      const d = f ? JSON.parse(f.content) : {};
      sources.push({ name, lastChecked: d.lastChecked || null, enabled: d.enabled !== false, processed: (d.processedIds || []).length });
    } catch { sources.push({ name, lastChecked: null, enabled: null, processed: 0 }); }
  }
  let instagram: any = null;
  try {
    const q = await instagramQuota(env);
    instagram = { used24h: (await instagramActionsLast24h(env)).length, cap: q ? Math.max(IG_DAILY_CAP, q.total - IG_QUOTA_MARGIN) : IG_DAILY_CAP, quota: q };
  } catch { /* the dashboard shows «غير متاح» */ }
  return { success: true, platforms, items, sources, instagram, deferrals: Object.keys((state as any).deferrals || {}).length,
    automatic: { instagram: env.INSTAGRAM_AUTO_ENABLED !== "false", x: env.X_AUTO_ENABLED !== "false" } };
}

// ── Studio: stories the spoiler shield kept off social, for the owner to publish or keep ──
// The owner wants only the last day's held stories in the list (older ones aren't worth posting)
const HELD_WINDOW_MS = 24 * 3600_000;
/** The owner: a hold lasts 12 hours (back to 12 on 2 Oct after a few hours at 6 — INCIDENTS #215, #230). */
const HOLD_RELEASE_MS = 12 * 3600_000;
async function studioHeld(env: Env) {
  const stateFile = await readRepoFile(env, env.GITHUB_STATE_PATH);
  const state: any = stateFile ? JSON.parse(stateFile.content) : {};
  // Recorded by the shield when it holds a story (older ones were filled in once from its commits)
  const held: Record<string, HeldEntry> = { ...(state.held || {}) };
  const now = Date.now();
  const items = Object.entries(held)
    .filter(([, h]) => h && now - (h.releasedAt || h.dismissedAt || h.at) < HELD_WINDOW_MS)
    .map(([key, h]) => {
      const after = (p: string) => (h.releasedAt && Number(state[p]?.[key]) > h.releasedAt ? Number(state[p][key]) : 0);
      return { ...h, key, sent: h.releasedAt ? { telegram: after("telegram"), facebook: after("facebook"), instagram: after("instagram") } : null };
    })
    .sort((a, b) => (b.at || 0) - (a.at || 0));
  return { success: true, items };
}

/**
 * The panel's bell (owner, 2026-09-29: «زر اشعارات لاي حاجة»): what happened on the site in the
 * last 12 hours, newest first. Stories and shows that went live (bots or the panel); with the
 * «tools» permission also where each one was posted, what the spoiler shield held or released,
 * posts that need a human check, and show reels. Messages are worded in the panel.
 */
const NOTIFY_WINDOW_MS = 12 * 3600_000; // the owner: only the last 12 hours
export async function studioNotifications(env: Env, withSocial: boolean) {
  const now = Date.now();
  const recent = (t: number) => t > 0 && now - t < NOTIFY_WINDOW_MS && t <= now + 60_000;
  const feed: any[] = await fetch(cacheBust(`${env.SITE_ORIGIN}/watcher-recent-content.json`)).then((r): Promise<any> => (r.ok ? r.json() : Promise.resolve([]))).catch(() => []);
  const items: any[] = [];
  const byKey = new Map<string, any>();
  for (const it of Array.isArray(feed) ? feed : []) {
    const at = Date.parse(it.published_at || it.date || "") || 0;
    const key = sanitizeKey(normalizeArticleUrl(env.SITE_ORIGIN + (it.url || "")));
    const m = String(it.inputPath || "").match(/content\/([^/]+)\/(.+)\.md$/);
    const ref = { title: String(it.headline || it.title || "").slice(0, 200), url: it.url || "", image: it.image || "", kind: it.kind || "news", collection: m ? m[1] : "", slug: m ? m[2] : "" };
    byKey.set(key, { ...ref, pub: at });
    if (recent(at)) items.push({ id: `site:${key}`, type: "site", at, ...ref });
  }
  if (withSocial) {
    let state: any = {};
    try { state = (await githubReadState(env)).state; } catch { /* the site items still show */ }
    const held = state.held || {};
    for (const [key, ref] of byKey) {
      const h = held[key];
      const blocked = h && !h.releasedAt;
      const after = h?.releasedAt || 0;
      const sent = (["telegram", "facebook", "instagram"] as const).filter(p => { const t = Number(state[p]?.[key]) || 0; return recent(t) && !blocked && t >= after; });
      // Posted where the story itself is listed: one line per story, not one per step
      const siteItem = items.find(i => i.id === `site:${key}`);
      if (sent.length && siteItem) siteItem.platforms = sent;
      else if (sent.length) { const { pub: _pub, ...plain } = ref; items.push({ id: `social:${key}:${sent.join(",")}`, type: "social", at: Math.max(...sent.map(p => Number(state[p][key]))), platforms: sent, ...plain }); }
      for (const p of ["telegram", "facebook", "instagram", "x"]) {
        if (recent(ref.pub) && Number(state.deferrals?.[`${p}:${key}`]) === 8640000000000000) { const { pub, ...r } = ref; items.push({ id: `review:${p}:${key}`, type: "review", at: pub || now, platform: p, ...r }); }
      }
    }
    for (const [key, h] of Object.entries(held) as [string, any][]) {
      if (recent(h.at)) items.push({ id: `held:${key}`, type: "held", at: h.at, reason: h.reason, why: h.why, title: h.title, url: h.url, image: h.image || "" });
      if (recent(h.releasedAt)) items.push({ id: `released:${key}`, type: "released", at: h.releasedAt, by: h.by || "", title: h.title, url: h.url, image: h.image || "" });
    }
    try {
      const reels = await readRepoFile(env, "_data/show-reel-state.json");
      for (const [slug, r] of Object.entries(reels ? JSON.parse(reels.content) : {}) as [string, any][]) {
        const at = Number(r?.lastAttempt || r?.publishedAt) || 0;
        const done = ["facebook_reel", "instagram_reel", "facebook_story", "instagram_story"].filter(k => r?.[k] === true);
        if (recent(at) && done.length) items.push({ id: `reel:${slug}:${done.join(",")}`, type: "reel", at, done, title: String(r.title || slug).slice(0, 200), slug });
      }
    } catch { /* no reels file */ }
  }
  // Open problems the site's watchdog found stay in the bell until they're fixed (INCIDENTS #158)
  try {
    for (const p of (await siteHealth(env)).problems) items.push({ id: `health:${p.key}`, type: "health", at: p.since, code: p.code, title: p.title, detail: p.detail });
  } catch { /* no watchdog record yet */ }
  items.sort((a, b) => b.at - a.at);
  return { success: true, items: items.slice(0, 120), now };
}

/**
 * The pinned list as it is NOW. _data/pinned.json keeps a copy of each item taken when it was pinned;
 * the site's slider already reads the live page (freshPinned in eleventy.config.js), but the panel showed
 * the copy — «AEW All Out Tailgate Brawl» still read «عرض اول اوت …» days after its headline was fixed,
 * and saving the list wrote the old copy back (INCIDENTS #120). Same rules as freshPinned: a show's
 * title is its Arabic headline, its subtitle the English title. The copy is only a fallback.
 */
export async function freshPinnedItems(env: Pick<Env, "SITE_ORIGIN">, items: any[]): Promise<any[]> {
  if (!Array.isArray(items) || !items.length) return Array.isArray(items) ? items : [];
  const index: any[] = await fetch(cacheBust(`${env.SITE_ORIGIN}/search-index.json`)).then((r): Promise<any> => (r.ok ? r.json() : Promise.resolve([]))).catch(() => []);
  const norm = (u: any) => { let x = String(u || ""); try { x = decodeURIComponent(x); } catch { /* keep */ } return x.replace(/index\.html$/, "").replace(/\/?$/, "/"); };
  const byUrl = new Map((Array.isArray(index) ? index : []).map((p: any) => [norm(p.url), p]));
  return items.map((item) => {
    const page: any = byUrl.get(norm(item.url));
    if (!page) return item;
    const isShow = item.kind === "show" || item.kind === "recap" || /^\/(shows|recaps|nostalgia)\//.test(norm(page.url));
    return {
      ...item,
      title: (isShow ? page.headline || page.title : page.title) || item.title,
      subtitle: isShow ? page.title || item.subtitle : item.subtitle,
      image: page.image || item.image,
      description: page.description || item.description,
      federation: page.federation || item.federation,
    };
  });
}

async function studioHeldAction(env: Env, request: Request, action: "publish" | "keep") {
  const who = await studioUser(request, env as any);
  const body: any = await request.json().catch(() => ({}));
  const url = String(body.url || "");
  if (!url.startsWith("/news/")) return json({ success: false, error: "رابط غير صالح." }, 400);
  const key = sanitizeKey(normalizeArticleUrl(env.SITE_ORIGIN + url));
  const by = who ? who.user.displayName || who.user.username : "";
  for (let attempt = 0; attempt < 4; attempt++) {
    const { sha, state } = await githubReadState(env);
    const now = Date.now();
    state.held = state.held || {};
    const h: HeldEntry = state.held[key] || { at: Number(state.telegram[key]) || now, title: String(body.title || "").slice(0, 240), url, image: String(body.image || ""), reason: spoilerReason(body.title) };
    if (action === "publish") {
      if (h.releasedAt) return json({ success: true, already: true });
      state.released = state.released || {};
      state.released[key] = now;
      for (const p of ["telegram", "facebook", "instagram", "x"] as const) delete state[p][key];
      for (const k of Object.keys(state.deferrals || {})) if (k.endsWith(`:${key}`)) delete state.deferrals![k];
      h.releasedAt = now;
      delete h.dismissedAt;
    } else {
      if (h.releasedAt) return json({ success: false, error: "الخبر ده اتبعت للنشر خلاص." }, 400);
      h.dismissedAt = now;
    }
    h.by = by;
    state.held[key] = h;
    const r = await githubWriteState(env, state, sha, `studio: ${action === "publish" ? "release held story for social" : "keep story off social"} ${key}`);
    if (r.ok) {
      if (who) await studioAudit(env as any, who.user, action === "publish" ? "social.release" : "social.keep", { title: h.title, url }).catch(() => {});
      return json({ success: true });
    }
    if (!r.conflict) break;
  }
  return json({ success: false, error: "مقدرتش أحفظ القرار دلوقتي، جرّب تاني." }, 503);
}

// ── Studio tools (the old /admin/ pages, now inside the panel) ──────────────
// Platform status of many site items in one call (the old page asked once per item).
async function studioSocialStatus(env: Env, body: any) {
  const stateFile = await readRepoFile(env, env.GITHUB_STATE_PATH);
  const state: any = stateFile ? JSON.parse(stateFile.content) : {};
  const urls: string[] = Array.isArray(body?.urls) ? body.urls.slice(0, 80).map(String) : [];
  const items: Record<string, any> = {};
  for (const u of urls) {
    const key = sanitizeKey(normalizeArticleUrl(new URL(u, env.SITE_ORIGIN).href));
    const h = state.held?.[key];
    items[u] = {
      telegram: Number(state.telegram?.[key]) || 0, facebook: Number(state.facebook?.[key]) || 0,
      instagram: Number(state.instagram?.[key]) || 0, x: Number(state.x?.[key]) || 0,
      // Held by the spoiler shield: the stamps above mean «kept off», not «posted»
      held: !!(h && !h.releasedAt), released: Number(state.released?.[key]) || 0,
    };
  }
  return { success: true, items, automatic: { instagram: env.INSTAGRAM_AUTO_ENABLED !== "false", x: env.X_AUTO_ENABLED !== "false" } };
}

const NEWS_SOURCES = [
  { id: "fightful", name: "فايتفول", state: "watcher-state.json", feed: "watcher-feed.json" },
  { id: "wrestlinginc", name: "رسلينغ إنك", state: "wrestlinginc-state.json", feed: "watcher-feed-wrestlinginc.json" },
  { id: "ringsidenews", name: "رينغسايد نيوز", state: "ringsidenews-state.json", feed: "watcher-feed-ringsidenews.json" },
];
// Each source's latest posts and what became of them — read from the repo, so it is as fresh
// as the bots' last run (the copies on the site only change with a site build).
async function studioSources(env: Env) {
  const readJson = async (p: string) => { try { const f = await readRepoFile(env, p); return f ? JSON.parse(f.content) : null; } catch { return null; } };
  // The whole index (not only the latest 200) so an older story that did become an article is found
  const [skips, outcomes, index, stateFile]: any[] = await Promise.all([
    readJson("_data/duplicate-skips.json"),
    readJson("watcher-outcomes.json"),
    fetch(cacheBust(`${env.SITE_ORIGIN}/search-index.json`)).then(r => (r.ok ? r.json() : [])).catch(() => []),
    readJson(env.GITHUB_STATE_PATH),
  ]);
  const onSite = new Map<string, any>();
  const byFile = new Map<string, any>();
  for (const i of Array.isArray(index) ? index : []) {
    if (i?.source_id) onSite.set(String(i.source_id), i);
    const f = String(i?.inputPath || "").split("/").pop();
    if (f) byFile.set(f, i);
  }
  const publish: any = stateFile || {};
  // What happened on the platforms to a story that reached the site
  const socialOf = (url: string) => {
    const key = sanitizeKey(normalizeArticleUrl(env.SITE_ORIGIN + url));
    const h = publish.held?.[key];
    if (h && !h.releasedAt) return h.dismissedAt ? "ومش هيتنشر على المنصات (قرارك)" : "ومحجوب عن السوشيال لأن فيه حرق";
    const done = ["telegram", "facebook", "instagram"].filter(p => publish[p]?.[key]);
    if (!done.length) return "ولسه بيتنشر على المنصات";
    const names: Record<string, string> = { telegram: "تيليجرام", facebook: "فيسبوك", instagram: "إنستغرام" };
    return done.length === 3 ? "واتنشر على المنصات التلاتة" : `واتنشر على ${done.map(p => names[p]).join(" و")}`;
  };
  const fightful: any = await readJson("watcher-state.json");
  const sources = [];
  for (const s of NEWS_SOURCES) {
    const [st, feed]: any[] = await Promise.all([readJson(s.state), readJson(s.feed)]);
    const done = new Set((st?.processedIds || []).map(String));
    const posts = (Array.isArray(feed) ? feed : []).slice(0, 30).map((p: any) => {
      const id = String(p.id);
      const link = String(p.link || "");
      const site = onSite.get(id);
      const title = String(p.title?.rendered ?? p.title ?? "").replace(/<[^>]+>/g, "")
        .replace(/&#(\d+);/g, (_m: string, n: string) => String.fromCharCode(Number(n))).replace(/&amp;/g, "&").replace(/&quot;/g, '"');
      // Fightful's date_gmt has no «Z»; read as local time it was hours off.
      const gmt = String(p.date_gmt || "");
      const date = gmt ? (/[zZ]|[+-]\d\d:?\d\d$/.test(gmt) ? gmt : `${gmt}Z`) : String(p.date || "");
      const dup = skips?.[link] || skips?.[link.replace(/\/+$/, "")];
      const note = outcomes?.[link.replace(/\/+$/, "")];
      const ageH = (Date.now() - Date.parse(date)) / 3600_000;
      // One status and a plain reason for every story (the owner asked why each one did or didn't go up)
      let status: "site" | "skipped" | "waiting", reason: string, match: { url: string; title: string } | null = null;
      if (site) {
        status = "site"; reason = `نزل على الموقع ${socialOf(site.url)}`;
      } else if (dup) {
        status = "skipped";
        const m = byFile.get(String(dup.matchedFile || ""));
        match = m ? { url: m.url, title: m.title } : null;
        reason = `مكرر: نفس خبر نزل قبل كده${dup.reason ? ` (${dup.reason})` : ""}`;
      } else if (note) {
        status = note.retry && ageH < 24 ? "waiting" : "skipped";
        reason = note.reason;
      } else if (done.has(id)) {
        status = "skipped"; reason = "اتقرر إنه مينزلش (مكرر أو ملوش لازمة للموقع)";
      } else if (ageH > 24) {
        status = "skipped"; reason = "أقدم من ٢٤ ساعة، والبوت مبينزلش أخبار قديمة";
      } else {
        status = "waiting"; reason = "هيتكتب في الفحص الجاي";
      }
      return {
        id, link, title, date,
        // The source's own picture, as it is on the source (only http(s) links)
        image: /^https?:\/\//.test(String(p.featured_image || "")) ? String(p.featured_image) : "",
        status, reason, match,
        site: site ? { url: site.url, title: site.title } : null,
      };
    });
    sources.push({ id: s.id, name: s.name, lastChecked: st?.lastChecked || null, processed: (st?.processedIds || []).length,
      apiCallsToday: s.id === "fightful" ? Number(st?.apiCallsToday) || 0 : undefined, posts });
  }
  return { success: true, paused: fightful?.enabled === false, sources };
}

async function studioReels(env: Env) {
  const [videos, stateFile] = await Promise.all([
    githubGetVideosManifest(env).catch(() => []),
    readRepoFile(env, "_data/show-reel-state.json").catch(() => null),
  ]);
  const state: any = stateFile ? JSON.parse(stateFile.content) : {};
  return { success: true, videos, state, tiktok: env.TIKTOK_AUTO_ENABLED === "true" };
}

// ─────────────────────────────────────────────────────────────────────────
// HTTP router
// ─────────────────────────────────────────────────────────────────────────

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
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
      // The owner's panel (/admin/): its own login and sessions, checked inside handleStudio.
      if (path === "/api/studio/overview" && request.method === "POST") {
        if (!(await studioAuthorized(request, env, "status"))) return json({ success: false, denied: true, error: "مش مسموحلك تشوف حالة الموقع." }, 403);
        return json(await studioOverview(env, await request.json().catch(() => ({}))));
      }
      // What the watchdog found — problem titles only, nothing private (INCIDENTS #158)
      // «الأكثر مشاهدة» for the home page (INCIDENTS #180)
      if (path === "/top10" && request.method === "GET") return top10Response(env, url.searchParams.get("range") || "day");
      if (path === "/health" && request.method === "GET") {
        const h = await siteHealth(env);
        return json({ ok: !h.problems.length, checkedAt: h.checkedAt ? new Date(h.checkedAt).toISOString() : null, problems: h.problems.map(p => ({ title: p.title, detail: p.detail, since: new Date(p.since).toISOString() })) });
      }
      if (path === "/api/studio/notifications" && request.method === "GET") {
        if (!(await studioUser(request, env as any))) return json({ success: false, auth: false, error: "انتهت الجلسة. سجّل الدخول من جديد." }, 401);
        return json(await studioNotifications(env, await studioAuthorized(request, env, "tools")));
      }
      if (path === "/api/studio/held" && request.method === "GET") {
        if (!(await studioAuthorized(request, env, "tools"))) return json({ success: false, denied: true, error: "مش مسموحلك تتحكم في النشر على المنصات." }, 403);
        return json(await studioHeld(env));
      }
      if ((path === "/api/studio/held/publish" || path === "/api/studio/held/keep") && request.method === "POST") {
        if (!(await studioAuthorized(request, env, "tools"))) return json({ success: false, denied: true, error: "مش مسموحلك تتحكم في النشر على المنصات." }, 403);
        return await studioHeldAction(env, request, path.endsWith("/publish") ? "publish" : "keep");
      }
      if (path.startsWith("/api/studio/tools/")) {
        if (!(await studioAuthorized(request, env, "tools"))) return json({ success: false, denied: true, error: "مش مسموحلك تستخدم أدوات النشر." }, 403);
        if (path === "/api/studio/tools/social" && request.method === "POST") return json(await studioSocialStatus(env, await request.json().catch(() => ({}))));
        if (path === "/api/studio/tools/sources" && request.method === "GET") return json(await studioSources(env));
        if (path === "/api/studio/tools/reels" && request.method === "GET") return json(await studioReels(env));
        if (path === "/api/studio/tools/pinned" && request.method === "GET") {
          const f = await readRepoFile(env, "_data/pinned.json");
          return json({ success: true, items: await freshPinnedItems(env, f ? JSON.parse(f.content) : []), sha: f?.sha || null });
        }
        if (path === "/api/studio/tools/pinned" && request.method === "POST") {
          const body: any = await request.json().catch(() => ({}));
          const clean = (v: any, n = 300) => String(v ?? "").slice(0, n);
          const items = (Array.isArray(body.items) ? body.items : []).slice(0, 30)
            .filter((i: any) => i && typeof i.url === "string" && /^\/(?:shows|recaps|news|nostalgia)\//.test(i.url))
            .map((i: any) => ({ url: clean(i.url), title: clean(i.title), subtitle: clean(i.subtitle), image: clean(i.image), federation: clean(i.federation, 40) || "WWE",
              kind: ["show", "recap", "news", "nostalgia"].includes(i.kind) ? i.kind : "show", kindLabel: clean(i.kindLabel, 40), badge: clean(i.badge, 40), description: clean(i.description, 600) }));
          const current = await readRepoFile(env, "_data/pinned.json");
          if (body.sha && current && current.sha !== body.sha) return json({ success: false, conflict: true, error: "المثبت اتعدّل من مكان تاني بعد ما فتحته. حدّث الصفحة وجرّب تاني." }, 409);
          const who = await studioUser(request, env as any);
          const by = who ? who.user.displayName || who.user.username : "";
          const sha = await commitFiles(env as any, [{ path: "_data/pinned.json", text: JSON.stringify(items, null, 2) + "\n" }], `Update pinned home slider (لوحة التحكم — ${by})`);
          if (who) await studioAudit(env as any, who.user, "pinned.update", { count: items.length }).catch(() => {});
          return json({ success: true, commit: sha, committedAt: Date.now() });
        }
        return json({ success: false, error: "مش موجود" }, 404);
      }
      const studio = await handleStudio(request, env, path, json);
      if (studio) return studio;

      const publicMutations = new Set(["/api/push/subscribe", "/api/push/unsubscribe"]);
      if (!["GET", "HEAD"].includes(request.method) && !publicMutations.has(path)) {
        // A GitHub token from the old panel, or a session from the panel (/admin/) with the «tools» permission
        if (!(await authorizeAdmin(request, env)) && !(await studioAuthorized(request, env, "tools"))) return json({ success: false, error: "سجّل الدخول من لوحة التحكم (/admin/) بحساب معاه صلاحية «أدوات النشر»." }, 401);
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
        // Instagram's own API publishing limit for this account (quota_total per 24h, quota_usage so far).
        const limitRes = await fetch(
          `https://graph.facebook.com/${GRAPH_API_VERSION}/${env.INSTAGRAM_BUSINESS_ACCOUNT_ID}/content_publishing_limit?fields=config,quota_usage&access_token=${await getPageAccessToken(env)}`
        ).then(r => r.json()).catch((e: any) => ({ error: String(e) })) as any;
        return json({ success: !data.error, configured: true, account: data, publishingLimit: limitRes?.data?.[0] || limitRes, internalCap: (await instagramQuota(env)) ? Math.max(IG_DAILY_CAP, igQuotaCache!.total - IG_QUOTA_MARGIN) : IG_DAILY_CAP, newsRoomLeft: await instagramRoomLeft(env, IG_VIDEO_RESERVE), internalUsedLast24h: (await instagramActionsLast24h(env)).length });
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

      if (path === "/api/tiktok/status" && request.method === "GET") {
        if (!env.TIKTOK_CLIENT_KEY || !env.TIKTOK_CLIENT_SECRET) {
          return json({ success: false, configured: false, connected: false, message: "TIKTOK_CLIENT_KEY / TIKTOK_CLIENT_SECRET not set" });
        }
        const token = await loadTikTokToken(env);
        // Read-only: which privacy levels TikTok currently allows this app/account to
        // post with — PUBLIC_TO_EVERYONE is missing until Direct Post is audited.
        let privacyLevelOptions: string[] | undefined;
        const accessToken = token ? await getTikTokAccessToken(env) : null;
        if (accessToken) {
          const info: any = await fetch("https://open.tiktokapis.com/v2/post/publish/creator_info/query/", {
            method: "POST", headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json; charset=UTF-8" },
          }).then(r => r.json()).catch(() => null);
          privacyLevelOptions = info?.data?.privacy_level_options;
        }
        return json({ success: true, configured: true, connected: !!token,
          openId: token?.openId, tokenExpiresAt: token?.expiresAt, privacyLevelOptions,
          autoEnabled: env.TIKTOK_AUTO_ENABLED === "true" });
      }

      // One-time manual setup: the site owner visits this link once, logged into the
      // TikTok account arab-wrestling.com should post as, and approves access. Not
      // something automation ever calls — TikTok itself only supports this as a real
      // browser redirect through its own consent screen, there is no server-to-server
      // equivalent. A short-lived state nonce in KV guards against a stale/replayed
      // callback; it does not gate who may *start* the flow, since anyone who starts
      // it just gets asked to log into their own TikTok account by TikTok itself, and
      // whoever approves becomes the connected account — this link is only ever meant
      // to be opened by the site owner.
      if (path === "/api/tiktok/oauth/start" && request.method === "GET") {
        if (!env.TIKTOK_CLIENT_KEY) return json({ success: false, error: "TIKTOK_CLIENT_KEY not set" }, 500);
        const nonce = crypto.randomUUID();
        await env.PUSH_KV.put(`tiktok-oauth-state:${nonce}`, "1", { expirationTtl: 600 });
        const redirectUri = `${url.origin}/api/tiktok/oauth/callback`;
        const authorizeUrl = new URL("https://www.tiktok.com/v2/auth/authorize/");
        authorizeUrl.searchParams.set("client_key", env.TIKTOK_CLIENT_KEY);
        authorizeUrl.searchParams.set("scope", "video.publish");
        authorizeUrl.searchParams.set("response_type", "code");
        authorizeUrl.searchParams.set("redirect_uri", redirectUri);
        authorizeUrl.searchParams.set("state", nonce);
        return Response.redirect(authorizeUrl.toString(), 302);
      }

      if (path === "/api/tiktok/oauth/callback" && request.method === "GET") {
        const code = url.searchParams.get("code");
        const state = url.searchParams.get("state");
        const error = url.searchParams.get("error");
        if (error) return json({ success: false, error: `رفض TikTok الطلب: ${error}` }, 400);
        if (!code || !state) return json({ success: false, error: "رابط الرجوع من TikTok غير مكتمل (code/state مفقودان)." }, 400);
        const nonceKey = `tiktok-oauth-state:${state}`;
        const validNonce = await env.PUSH_KV.get(nonceKey);
        if (!validNonce) return json({ success: false, error: "انتهت صلاحية رابط الربط أو استُخدم من قبل؛ ابدأ العملية من جديد عبر /api/tiktok/oauth/start." }, 400);
        await env.PUSH_KV.delete(nonceKey);
        const redirectUri = `${url.origin}/api/tiktok/oauth/callback`;
        const token = await exchangeTikTokToken(env, { grant_type: "authorization_code", code, redirect_uri: redirectUri });
        if (!token) return json({ success: false, error: "فشل تبادل رمز التفويض مع TikTok — تحقق من TIKTOK_CLIENT_KEY/SECRET وأن redirect_uri مطابق تمامًا للمسجل في إعدادات التطبيق." }, 502);
        const saved = await saveTikTokToken(env, token);
        if (!saved) return json({ success: false, error: "تم الحصول على التوكن لكن تعذر حفظه في حالة الموقع." }, 500);
        return new Response(
          `<!DOCTYPE html><html lang="ar" dir="rtl"><meta charset="UTF-8"><body style="font-family:sans-serif;text-align:center;padding:60px;"><h1>✅ تم ربط حساب TikTok بنجاح</h1><p>معرّف الحساب: ${token.openId || "غير متاح"}</p><p>ينتهي الوصول الحالي خلال 24 ساعة ويتجدد تلقائيًا؛ لا حاجة لإعادة هذه الخطوة إلا لو أُلغي الربط من داخل TikTok نفسه.</p></body></html>`,
          { headers: { "Content-Type": "text/html; charset=UTF-8" } }
        );
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
          xAutomatic: env.X_AUTO_ENABLED !== "false",
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
          return json({ success: false, error: "أرسل منصة واحدة في كل طلب نشر؛ حدّث صفحة لوحة التحكم." }, 400);
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
          const allowed = new Set(["facebook_reel", "facebook_story", "instagram_reel", "instagram_story", "tiktok"]);
          if (requestedPlatforms.length !== 1 || requestedPlatforms.some(p => !allowed.has(p))) {
            return json({ success: false, error: "أرسل منصة فيديو واحدة في كل طلب؛ الأداة مخصصة لفيسبوك وإنستجرام وTikTok." }, 400);
          }
          const videoHost = new URL(fullVideoUrl);
          if (!videoHost.pathname.endsWith(".mp4")) return json({ success: false, error: "ملف الفيديو يجب أن يكون MP4." }, 400);
          const sourceAllowed = videoHost.origin === new URL(env.SITE_ORIGIN).origin && videoHost.pathname.startsWith("/videos/")
            || videoHost.origin === "https://raw.githubusercontent.com" && videoHost.pathname.startsWith(`/${env.GITHUB_OWNER}/${env.GITHUB_REPO}/${env.GITHUB_BRANCH}/dist/videos/`);
          if (!sourceAllowed) return json({ success: false, error: "يجب استخدام فيديو من مكتبة الموقع." }, 400);

          const videoFilename = decodeURIComponent(videoHost.pathname.split("/").pop() || "");
          if (!body.postUrl || (!await eligiblePublication(env, String(body.postUrl)) && !await hasTrackedShowProgress(env, videoFilename))) {
            return json({ success: false, code: "CONTENT_NOT_ELIGIBLE", error: "النشر متاح للمحتوى الجديد فقط من وقت بدء التشغيل؛ المحتوى القديم أو غير المؤكد مستبعد." }, 409);
          }

          // Reliability check: if fullVideoUrl returns 404 on site origin, fallback to direct GitHub raw CDN
          try {
            const headCheck = await fetch(fullVideoUrl, { method: "HEAD" });
            if (!headCheck.ok && headCheck.status === 404) {
              // TikTok only pulls from the domain verified in its developer portal and
              // always rejects raw GitHub URLs — wait for the site deploy instead.
              if (requestedPlatforms.includes("tiktok")) {
                return json({ success: false, results: { tiktok: { ok: false, status: "processing", error: "الفيديو لم يظهر على الموقع بعد؛ سيُعاد إرساله إلى TikTok بعد النشر." } } });
              }
              const filename = fullVideoUrl.split("/").pop();
              if (filename && filename.endsWith(".mp4")) {
                fullVideoUrl = `https://raw.githubusercontent.com/${env.GITHUB_OWNER}/${env.GITHUB_REPO}/${env.GITHUB_BRANCH || "main"}/dist/videos/${encodeURIComponent(decodeURIComponent(filename))}`;
              }
            }
          } catch (_) {}

          const title = String(body.title || "").trim();
          const postUrl = body.postUrl ? String(body.postUrl).trim() : undefined;


          const results: Record<string, any> = {};
          for (const platform of [...new Set(requestedPlatforms)]) {
            const network: "facebook" | "instagram" | "tiktok" = platform.startsWith("facebook") ? "facebook" : platform === "tiktok" ? "tiktok" : "instagram";
            if (platform === "tiktok" && env.TIKTOK_AUTO_ENABLED !== "true") {
              results[platform] = { ok: false, skipped: true, error: "نشر TikTok غير مفعّل بعد (TIKTOK_AUTO_ENABLED)." };
              continue;
            }
            const { state: currentState } = await githubReadState(env);
            const retryAt = currentState.videoCooldowns?.[network] || 0;
            if (retryAt > Date.now()) {
              results[platform] = { ok: false, status: "rate_limited", retryAt, error: "المنصة قيّدت نشر الفيديو مؤقتًا؛ ستتم إعادة المحاولة بعد انتهاء فترة الانتظار." };
              continue;
            }
            if (network === "instagram") {
              if (!(await instagramRoomLeft(env, 0))) {
                results[platform] = { ok: false, status: "processing", spacing: true, error: "تم بلوغ الحد اليومي لمنشورات إنستجرام؛ ستتم إعادة المحاولة تلقائيًا." };
                continue;
              }
              const wait = await instagramSpacingWait(env);
              if (wait > 0) {
                // "processing" = not a failure; the show-reel monitor retries in 10 min (not 45).
                await markInstagramVideoWaiting(env, true);
                results[platform] = { ok: false, status: "processing", spacing: true, retryAt: Date.now() + wait, error: "فاصل زمني إلزامي بين منشورات إنستجرام؛ ستتم إعادة المحاولة تلقائيًا." };
                continue;
              }
              await markInstagramAction(env, "video");
              await markInstagramVideoWaiting(env, false);
            }
            const send = () => platform === "facebook_reel" ? postVideoToFacebookReel(env, { videoUrl: fullVideoUrl, title, postUrl })
              : platform === "facebook_story" ? postVideoToFacebookStory(env, { videoUrl: fullVideoUrl })
              : platform === "instagram_reel" ? postVideoToInstagramReel(env, { videoUrl: fullVideoUrl, title, postUrl })
              : platform === "tiktok" ? postVideoToTikTok(env, { videoUrl: fullVideoUrl, title, postUrl })
              : postVideoToInstagramStory(env, { videoUrl: fullVideoUrl });
            try {
              results[platform] = await deliverOnce(env, `video:${platform}:${videoFilename}`, async () => {
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
    const minute = new Date(_controller.scheduledTime).getUTCMinutes();
    ctx.waitUntil(Promise.all([
      minute === 15 ? runVideoRetentionCleanup(env) : minute === 45 ? runPublishStateCleanup(env) : runWatcherPoll(env),
      runNewsWatcherCron(env),
      runScheduleBackstopCron(env),
      // The site's own watchdog: pages, bots, freshness and platforms (INCIDENTS #158)
      runSiteHealthCheck(env, minute, (it: any) => sanitizeKey(normalizeArticleUrl(env.SITE_ORIGIN + (it.url || ""))), () => githubReadState(env).then(r => r.state),
        async () => { const b = await instagramBudget(env); return (p: unknown) => instagramAllowedFor(p, b.used, b.cap); },
        (it: any) => contentFileId(it)),
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
// Actions load — this repo runs several frequent scheduled workflows
// competing for the account's runner slots. show-reel-monitor.yml (every 15
// min), wrestlinginc-watcher.yml and ringsidenews-watcher.yml (every 20 min)
// have all been observed going fully silent for hours — the two source
// watchers, in particular, each ran exactly once the day they were added and
// never fired again on their own — despite every individual run completing
// in seconds once it does fire. This gives each one a second, independent
// trigger path through the Worker's own cron (proven reliable — it fires
// every single minute), so a missed native schedule tick self-heals within
// one throttle window instead of stalling that source indefinitely.
async function runScheduleBackstopCron(env: Env): Promise<void> {
  if (!env.PUSH_KV) return;
  const jobs: { workflow: string; kvKey: string; throttleMs: number }[] = [
    { workflow: "show-reel-monitor.yml", kvKey: "last_reel_monitor_trigger_ts", throttleMs: 14 * 60 * 1000 },
    { workflow: "wrestlinginc-watcher.yml", kvKey: "last_wrestlinginc_trigger_ts", throttleMs: 19 * 60 * 1000 },
    { workflow: "ringsidenews-watcher.yml", kvKey: "last_ringsidenews_trigger_ts", throttleMs: 19 * 60 * 1000 },
  ];
  const now = Date.now();
  for (const job of jobs) {
    try {
      const last = Number((await env.PUSH_KV.get(job.kvKey)) || 0) || 0;
      if (now - last < job.throttleMs) continue;
      const res = await githubTriggerWorkflowByFile(env, job.workflow);
      if (res.ok) {
        await env.PUSH_KV.put(job.kvKey, String(now));
      }
    } catch (err: any) {
      console.error(`[Worker] Error triggering backstop for ${job.workflow}:`, err.message);
    }
  }
}

// _data/publish-state.json only ever grows — every article ever published
// leaves a permanent entry in all four platform maps, forever, with nothing
// that ever removes one. It reached ~2MB / ~1900 entries per platform today,
// and githubReadState() parses the whole thing on essentially every Worker
// action (every publish attempt, every defer, every success). That parse
// cost is now large enough to intermittently tip runWatcherPoll over its
// CPU limit on its own — the exact same "ever-growing data structure fully
// processed every tick" failure class already fixed for the content feed,
// just for the *state* file instead of the *content* file this time.
// watcher-recent-content.json only ever holds the newest 200 articles, so
// nothing published before that window can ever be looked up by the
// watcher again — any state entry older than that is pure dead weight.
// That 200-item window currently spans ~3 days at this site's publishing
// volume; 7 days is a healthy multiple of margin past it (and the reason
// this needed to be checked empirically rather than picking a round
// number like 30 days, which turned out to prune nothing at all — every
// entry in the file today was already within 30 days).
function pruneStaleStateEntries(state: PublishState, now: number): number {
  const MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
  let removed = 0;
  for (const platform of ["telegram", "facebook", "instagram", "x"] as const) {
    const map = state[platform];
    for (const key of Object.keys(map)) {
      if (now - map[key] > MAX_AGE_MS) { delete map[key]; removed++; }
    }
  }
  if (state.deferrals) {
    for (const key of Object.keys(state.deferrals)) {
      // Deferral values are "retry after" timestamps, not publish times —
      // one that expired 30+ days ago is definitely stale either way (the
      // article succeeded on a later attempt, or aged out of the window).
      if (now - state.deferrals[key] > MAX_AGE_MS) { delete state.deferrals[key]; removed++; }
    }
  }
  return removed;
}

async function runPublishStateCleanup(env: Env): Promise<void> {
  try {
    const now = new Date();
    // Once an hour, around minute 45 (minute 15 is already runVideoRetentionCleanup's slot).
    if (now.getMinutes() !== 45) return;
    const { sha, state } = await githubReadState(env);
    const removed = pruneStaleStateEntries(state, now.getTime());
    if (removed > 0) {
      await githubWriteState(env, state, sha, `chore(publish): prune ${removed} stale publish-state entries older than 30 days`);
    }
  } catch (e) {
    // Never let cleanup itself become a new failure mode.
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
