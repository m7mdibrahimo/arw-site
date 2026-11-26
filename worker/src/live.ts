// «بث مباشر» (INCIDENTS #1535): wrestling shows streamed live, gathered from four sites that post each show's page with a
// countdown before it starts and its live stream links while it is on. Owner 2026-11-25: «أي عرض ينزل على أي موقع منهم
// يظهر عندنا فورًا بكل روابطه، ولو على أكتر من موقع تتجمع الروابط في عرض واحد» — live only, never the full show or
// clips they post afterwards (the shows' own publishing covers those).
//
// How it runs (the bot's every-minute cron, so it costs no extra Worker request):
//   1. each source's newest posts through WordPress's own API: ~1.5 KB of JSON, one request a minute a source
//   2. a post's page is read only when it changed, or every few minutes while its show is about to start or on
//   3. the posts of one show (same program, same date) from every source become ONE show with all their links
//   4. the merged list is kept in D1 (live_state), written only when it changed; /live/data serves it, edge-cached
//   5. a show seen for the first time gets its page on the site (content/live/<slug>.md, one commit, fast lane);
//      a show three days after its end has its page removed
// A source that moves to a new domain is followed: the redirect, the old domain's landing page, its known mirrors,
// and at last a sweep of the same name under other domain endings, checked against the site's own WordPress name.
// Cost (budget.ts): CPU ~0.3 ms per listing, ~2 ms per page read; no KV writes.

export interface LiveEnv {
  ANALYTICS?: D1Database;
  MEDIA_SVC?: Fetcher;
  GITHUB_TOKEN?: string;
}

// ── Sources ────────────────────────────────────────────────────────────────
export interface SourceDef { id: string; host: string; base: string; mirrors: string[]; rank: number }
export const SOURCES: SourceDef[] = [
  { id: "1max", host: "1max.top", base: "1max", mirrors: ["watchwrestlingup.org", "watchwrestlingup.com", "watchwrestlingup.net"], rank: 1 },
  // only 1max (owner 2026-11-26: «خليك في الموقع ده وبس بلاش 4 مواقع») — its links are the sawlive channels themselves;
  // the other three gave the same channels behind ad pages or wrappers
];
/** Domain endings tried when a source vanished and nothing points to its new home */
export const SWEEP_TLDS = ["to", "ae", "re", "se", "ch", "sx", "bz", "io", "co", "cc", "tv", "top", "one", "is", "ws", "la", "li", "me", "nz", "uno", "lol", "pro", "net", "org", "xyz", "su", "lc", "vc", "ac", "sh", "st", "ms", "gg", "fm", "im", "cx", "mx", "eu", "live", "site", "online", "club", "info", "biz", "us", "in", "pk", "ru", "fun", "icu", "win", "lat", "tw", "ink", "ec", "nu", "tf", "pw", "cam", "zone"];

const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

// ── Programs ───────────────────────────────────────────────────────────────
export interface Program { key: string; fed: string; ar: string; dur: number; dow?: number; ple?: boolean }
// premium live events first: «NXT Deadline» is the event, not the weekly NXT
const PLE: [RegExp, string, string, string][] = [
  [/survivor series/i, "survivor-series", "WWE", "سيرفايفر سيريس"], [/royal rumble/i, "royal-rumble", "WWE", "رويال رامبل"],
  [/wrestle\s*mania/i, "wrestlemania", "WWE", "راسلمانيا"], [/summer\s*slam/i, "summerslam", "WWE", "سمرسلام"],
  [/crown jewel/i, "crown-jewel", "WWE", "كراون جول"], [/saturday night'?s main event/i, "snme", "WWE", "ساترداي نايتس مين إيفنت"],
  [/elimination chamber/i, "elimination-chamber", "WWE", "إليمنيشن تشامبر"], [/money in the bank/i, "money-in-the-bank", "WWE", "موني إن ذا بانك"],
  [/night of champions/i, "night-of-champions", "WWE", "نايت أوف تشامبيونز"], [/backlash/i, "backlash", "WWE", "باكلاش"],
  [/bad blood/i, "bad-blood", "WWE", "باد بلود"], [/wrestlepalooza/i, "wrestlepalooza", "WWE", "راسلبالوزا"], [/clash in /i, "clash", "WWE", "كلاش"],
  [/evolution/i, "evolution", "WWE", "إيفولوشن"],
  [/deadline/i, "nxt-deadline", "NXT", "ان اكس تي ديدلاين"], [/stand (?:&|and|&amp;) deliver/i, "stand-deliver", "NXT", "ستاند آند ديليفر"],
  [/battleground/i, "nxt-battleground", "NXT", "باتلجراوند"], [/heat\s*wave/i, "nxt-heatwave", "NXT", "هيت ويف"], [/no mercy/i, "nxt-no-mercy", "NXT", "نو ميرسي"],
  [/halloween havoc/i, "halloween-havoc", "NXT", "هالوين هافوك"], [/vengeance day/i, "vengeance-day", "NXT", "فينجنس داي"], [/\btlc\b/i, "nxt-tlc", "NXT", "تي إل سي"],
  [/full gear/i, "full-gear", "AEW", "فول جير"], [/worlds? end/i, "worlds-end", "AEW", "ويرلدز إند"], [/revolution/i, "revolution", "AEW", "ريفوليوشن"],
  [/dynasty/i, "dynasty", "AEW", "ديناستي"], [/double or nothing/i, "double-or-nothing", "AEW", "دبل أور ناثينج"], [/all in\b/i, "all-in", "AEW", "أول إن"],
  [/all out\b/i, "all-out", "AEW", "أول أوت"], [/wrestle\s*dream/i, "wrestledream", "AEW", "راسل دريم"], [/forbidden door/i, "forbidden-door", "AEW", "فوربيدن دور"],
  [/grand slam/i, "grand-slam", "AEW", "جراند سلام"],
  [/bound for glory/i, "bound-for-glory", "TNA", "باوند فور جلوري"], [/destination x/i, "destination-x", "TNA", "ديستنيشن إكس"], [/final resolution/i, "final-resolution", "TNA", "فاينال ريزولوشن"],
  [/hard to kill/i, "hard-to-kill", "TNA", "هارد تو كيل"], [/slammiversary/i, "slammiversary", "TNA", "سلاميفرسري"], [/rebellion/i, "rebellion", "TNA", "ريبيليون"],
  [/final battle/i, "final-battle", "ROH", "فاينال باتل"], [/supercard of honor/i, "supercard-of-honor", "ROH", "سوبركارد أوف أونر"], [/death before dishonor/i, "death-before-dishonor", "ROH", "ديث بيفور ديشونر"],
];
const WEEKLY: [RegExp, Program][] = [
  [/smack\s*down/i, { key: "smackdown", fed: "WWE", ar: "سماك داون", dur: 150, dow: 5 }],
  [/\braw\b/i, { key: "raw", fed: "WWE", ar: "الرو", dur: 180, dow: 1 }],
  [/\bnxt\b/i, { key: "nxt", fed: "NXT", ar: "ان اكس تي", dur: 120, dow: 2 }],
  [/dynamite/i, { key: "dynamite", fed: "AEW", ar: "داينامايت", dur: 120, dow: 3 }],
  [/collision/i, { key: "collision", fed: "AEW", ar: "كوليجن", dur: 120, dow: 6 }],
  [/rampage/i, { key: "rampage", fed: "AEW", ar: "رامبيج", dur: 60 }],
  [/\btna\b|\bimpact\b/i, { key: "tna", fed: "TNA", ar: "تي ان ايه", dur: 120, dow: 4 }],
  [/\broh\b|ring of honor/i, { key: "roh", fed: "ROH", ar: "ار او اتش", dur: 75 }],
];
const NOT_WRESTLING = /\b(?:ufc|bellator|boxing|mma|pfl|one championship|one fight night|bkfc|ksi|misfits|nfl|nba)\b/i;
const NOT_LIVE_POST = /\b(?:highlights?|results?|press conference|recap|review|predictions?|post[- ]show|kick[- ]?off only|main event)\b/i;
const FED = /\b(wwe|aew|nxt|tna|impact|roh|njpw|stardom|mlw|nwa|gcw)\b/i;

const MONTHS = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"];

export function decodeEntities(s: string): string {
  return String(s || "")
    .replace(/&#0*38;|&amp;/g, "&").replace(/&#8211;|&#8212;|&ndash;|&mdash;/g, "–").replace(/&#8217;|&#039;|&#39;|&rsquo;/g, "'")
    .replace(/&quot;|&#8220;|&#8221;/g, '"').replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&nbsp;|&#160;/g, " ")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)));
}
const stripTags = (s: string) => decodeEntities(String(s || "").replace(/<[^>]*>/g, " ")).replace(/\s+/g, " ").trim();

/** The show's date (its US date, as the sources write it) from a post title: «11/25/26», «November 25th 2026», «25th November 2026» */
export function titleDate(title: string): string | null {
  const t = decodeEntities(title);
  let m = t.match(/\b(\d{1,2})\/(\d{1,2})\/(\d{2,4})\b/);
  if (m) {
    const y = m[3].length === 2 ? 2000 + Number(m[3]) : Number(m[3]);
    return iso(y, Number(m[1]), Number(m[2]));
  }
  const mon = MONTHS.join("|");
  m = t.match(new RegExp(`\\b(${mon})\\s+(\\d{1,2})(?:st|nd|rd|th)?,?\\s+(\\d{4})`, "i"));
  if (m) return iso(Number(m[3]), MONTHS.indexOf(m[1].toLowerCase()) + 1, Number(m[2]));
  m = t.match(new RegExp(`\\b(\\d{1,2})(?:st|nd|rd|th)?\\s+(${mon}),?\\s+(\\d{4})`, "i"));
  if (m) return iso(Number(m[3]), MONTHS.indexOf(m[2].toLowerCase()) + 1, Number(m[1]));
  m = t.match(/\b(20\d\d)[ .-](\d{2})[ .-](\d{2})\b/);
  if (m) return iso(Number(m[1]), Number(m[2]), Number(m[3]));
  return null;
}
function iso(y: number, mo: number, d: number): string | null {
  if (!(y >= 2020 && y < 2100 && mo >= 1 && mo <= 12 && d >= 1 && d <= 31)) return null;
  return `${y}-${String(mo).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

export interface ShowId { key: string; date: string; program: Program; name: string }
/** Which show a post is about, or null when it isn't a wrestling show (UFC, highlights, a results story…) */
export function identify(title: string): ShowId | null {
  const t = decodeEntities(title);
  if (NOT_WRESTLING.test(t) || NOT_LIVE_POST.test(t)) return null;
  const date = titleDate(t);
  if (!date) return null;
  let program: Program | null = null;
  for (const [re, key, fed, ar] of PLE) if (re.test(t)) { program = { key, fed, ar, dur: 240, ple: true }; break; }
  if (!program) for (const [re, p] of WEEKLY) if (re.test(t)) { program = p; break; }
  if (!program) {
    // another wrestling event: its own words make its key
    const fed = (t.match(FED) || [])[1];
    if (!fed) return null;
    const words = t.toLowerCase().replace(/\b\d{1,2}\/\d{1,2}\/\d{2,4}\b/g, " ")
      .replace(new RegExp(`\\b(?:${MONTHS.join("|")})\\b`, "g"), " ").replace(/\b\d+(?:st|nd|rd|th)?\b/g, " ")
      .replace(/\b(?:watch|live|stream|online|full|show|free|ppv|pay per view|hd|fhd|replay|20\d\d|the|and|of|in|–)\b/g, " ")
      .replace(/[^a-z]+/g, " ").trim().split(/\s+/).filter((w) => w.length > 1).slice(0, 6);
    if (words.length < 2) return null;
    program = { key: words.join("-"), fed: fed.toUpperCase() === "IMPACT" ? "TNA" : fed.toUpperCase(), ar: "", dur: 180, ple: true };
  }
  // the show's own name: what comes before its date («AEW Dynamite Live 11/25/26 November 25th 2026» → «AEW Dynamite»)
  const cut = t.search(new RegExp(`\\s[–-]\\s*\\d|\\b\\d{1,2}/\\d{1,2}/\\d{2,4}\\b|\\b\\d{1,2}(?:st|nd|rd|th)\\b|\\b20\\d{2}\\b|\\b(?:${MONTHS.join("|")})\\b`, "i"));
  const name = (cut > 0 ? t.slice(0, cut) : t).replace(/\b(?:watch|live|online|full show|free|stream(?:ing)?)\b/gi, "").replace(/\s+/g, " ").trim() || t;
  return { key: `${program.key}-${date}`, date, program, name };
}

// ── Time ───────────────────────────────────────────────────────────────────
const TZ: Record<string, string> = {
  et: "America/New_York", est: "America/New_York", edt: "America/New_York", eastern: "America/New_York",
  pt: "America/Los_Angeles", pst: "America/Los_Angeles", pdt: "America/Los_Angeles", pacific: "America/Los_Angeles",
  ct: "America/Chicago", cst: "America/Chicago", cdt: "America/Chicago", central: "America/Chicago",
  gmt: "UTC", utc: "UTC", uk: "Europe/London", bst: "Europe/London", jst: "Asia/Tokyo",
};
/** Milliseconds a zone is ahead of UTC at a moment */
export function tzOffset(ts: number, zone: string): number {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: zone, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" }).formatToParts(new Date(ts));
  const g = (t: string) => Number((parts.find((p) => p.type === t) || { value: "0" }).value);
  return Date.UTC(g("year"), g("month") - 1, g("day"), g("hour") % 24, g("minute"), g("second")) - Math.floor(ts / 1000) * 1000;
}
/** A wall-clock time in a zone → UTC milliseconds */
export function zoned(y: number, mo: number, d: number, h: number, mi: number, zone: string): number {
  const guess = Date.UTC(y, mo - 1, d, h, mi);
  let ts = guess - tzOffset(guess, zone);
  ts = guess - tzOffset(ts, zone);
  return ts;
}

export interface StartGuess { at: number; how: "countdown" | "text" | "usual" }
/** When a show starts, from its page: the countdown the sources embed (habman / timeanddate), or «8PM ET» in its text */
export function findStart(html: string, date: string | null): StartGuess | null {
  const h = decodeEntities(html).replace(/%20/g, " ");
  // habman.com/mfl/countdown.php?m=11&d=25&y=2026&h=20&min=00&timezon e=eastern
  const hab = h.match(/habman\.com\/mfl\/countdown\.php\?([^'"]+)/i);
  if (hab) {
    const q = hab[1];
    const p = (k: string) => { const m = q.match(new RegExp(`(?:^|[?&;])${k}=([^&'"]*)`, "i")); return m ? m[1].trim() : ""; };
    const zone = TZ[(q.match(/timezon\s*e=([a-z]+)/i) || [])[1]?.toLowerCase() || "eastern"] || "America/New_York";
    const y = Number(p("y")), mo = Number(p("m")), d = Number(p("d")), hh = Number(p("h")), mi = Number(p("min") || 0);
    if (y > 2020 && mo && d && hh >= 0 && hh < 24) return { at: zoned(y, mo, d, hh, mi, zone), how: "countdown" };
  }
  // timeanddate.com/countdown/generic?iso=20261125T20&p0=263 (263 = New York)
  const tad = h.match(/timeanddate\.com\/countdown\/[a-z]+\?iso=(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})?[^'"]*?p0=(\d+)/i);
  if (tad && tad[6] === "263") return { at: zoned(Number(tad[1]), Number(tad[2]), Number(tad[3]), Number(tad[4]), Number(tad[5] || 0), "America/New_York"), how: "countdown" };
  if (!date) return null;
  const text = stripTags(h.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, " "));
  const m = text.match(/\b(\d{1,2})(?::(\d{2}))?\s*([ap])\.?\s*m\.?\s*(ET|EST|EDT|Eastern|PT|PST|PDT|Pacific|CT|CST|CDT|Central|GMT|UTC|UK|BST|JST)\b/i);
  if (m) {
    let hh = Number(m[1]) % 12; if (m[3].toLowerCase() === "p") hh += 12;
    const [y, mo, d] = date.split("-").map(Number);
    return { at: zoned(y, mo, d, hh, Number(m[2] || 0), TZ[m[4].toLowerCase()]), how: "text" };
  }
  return null;
}
/** The usual start of a weekly US show (8 PM Eastern on its date) when no page says it */
export function usualStart(p: Program, date: string): StartGuess | null {
  if (p.ple || p.dow == null) return null;
  const [y, mo, d] = date.split("-").map(Number);
  return { at: zoned(y, mo, d, 20, 0, "America/New_York"), how: "usual" };
}

// ── Links ──────────────────────────────────────────────────────────────────
export interface RawLink { url: string; label: string; group: string; q: string; embed: boolean }
const BAD_HOST = /(?:^|\.)(?:timeanddate\.com|habman\.com|google\.[a-z.]+|googlesyndication\.com|doubleclick\.net|facebook\.com|twitter\.com|x\.com|t\.me|telegram\.me|discord\.gg|discord\.com|instagram\.com|whatsapp\.com|reddit\.com|pinterest\.com|gmpg\.org|wordpress\.org|wp\.com|gravatar\.com|addtoany\.com|disqus\.com|youtube\.com|youtu\.be)$/i;
const LIVE_WORDS = /\blive\b|\bstream|catch\s*up|\bch(?:annel)?\s*\d|\bserver\b/i;
const NOT_LIVE_WORDS = /\bparts?\b|full\s*show|fullshow|replay|download|highlight|preview|countdown|match\s*card|matchcard|back to|request|telegram|discord|join|whatsapp|comment|login|register|\bv2\b|1hr/i;

export function quality(s: string): string {
  if (/\bFHD\b|1080/i.test(s)) return "FHD";
  if (/\bHD\b|720/i.test(s)) return "HD";
  if (/\bSD\b|480/i.test(s)) return "SD";
  if (/\bLQ\b|\bLD\b|360|240/i.test(s)) return "LQ";
  return "";
}
function absUrl(u: string): string | null {
  u = decodeEntities(u).trim();
  if (u.startsWith("//")) u = "https:" + u;
  if (!/^https?:\/\//i.test(u)) return null;
  try { return new URL(u).toString(); } catch { return null; }
}
/** A link hidden as base64 (twice, sometimes thrice) in data-src (watchwrestling.re) */
export function unhide(v: string): string | null {
  let x = v.trim();
  for (let i = 0; i < 4; i++) {
    if (/^(?:https?:)?\/\//i.test(x)) return absUrl(x);
    if (!/^[A-Za-z0-9+/=_-]{12,}$/.test(x)) return null;
    try { x = atob(x.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - (x.length % 4)) % 4)); } catch { return null; }
  }
  return /^(?:https?:)?\/\//i.test(x) ? absUrl(x) : null;
}

/** The post's own body: its article, plus the box a script writes into it after load (watchwrestling.ae) */
export function postBody(html: string): string {
  const s = String(html || "");
  let i = s.search(/class=["'][^"']*\bentry-content\b/);
  if (i < 0) i = s.search(/<article\b/);
  let body = i < 0 ? s : s.slice(i);
  const end = body.search(/end \.entry-content|id=["'](?:extras|post-extra-info|respond|comments)["']|<footer\b|class=["'][^"']*\brelated-posts\b/);
  if (end > 0) body = body.slice(0, end);
  const boxes = [...s.matchAll(/append\(\s*"(<textarea[\s\S]*?<\/textarea>)"\s*\)/g)].map((m) => m[1].replace(/\\"/g, '"').replace(/\\\//g, "/"));
  return body + boxes.join("\n");
}

/** Every live stream link of a post, in page order, with the heading it sits under */
export function extractLinks(html: string, sourceHost: string): RawLink[] {
  const body = postBody(html);
  const out: RawLink[] = [];
  const seen = new Set<string>();
  let group = "";
  const re = /<(h[1-6]|span|strong|b)\b[^>]*>([\s\S]{1,300}?)<\/\1>|<a\b([^>]*)>([\s\S]*?)<\/a>|<iframe\b([^>]*)>/gi;
  for (const m of body.matchAll(re)) {
    if (m[1]) {
      const t = stripTags(m[2]);
      if (t && t.length <= 90 && /[a-z]/i.test(t) && !/<a\b/i.test(m[2])) group = t;
      continue;
    }
    const attrs = m[3] ?? m[5] ?? "";
    const attr = (k: string) => (attrs.match(new RegExp(`\\b${k}\\s*=\\s*(["'])([\\s\\S]*?)\\1`, "i")) || [])[2] || "";
    const isFrame = m[5] != null;
    const label = isFrame ? "" : stripTags(m[4] || "");
    const raw = isFrame ? (attr("data-litespeed-src") || attr("data-src") || attr("data-lazy-src") || attr("src")) : (attr("href") || "");
    let url = raw && !raw.startsWith("#") && !/^javascript:/i.test(raw) ? absUrl(raw) : null;
    if (!url && !isFrame) { const hidden = attr("data-src") || attr("data-href") || attr("data-url"); if (hidden) url = unhide(hidden); }
    if (!url) continue;
    let host = "";
    try { host = new URL(url).hostname.replace(/^www\./, ""); } catch { continue; }
    if (BAD_HOST.test(host) || host === sourceHost || host.endsWith("." + sourceHost)) continue;
    if (/\.(?:jpe?g|png|gif|webp|svg|css|js)(?:\?|$)/i.test(url)) continue;
    const ctx = `${group} ${label}`;
    if (!LIVE_WORDS.test(ctx) || NOT_LIVE_WORDS.test(ctx)) continue;
    if (seen.has(url)) continue;
    seen.add(url);
    out.push({ url, label, group, q: quality(label) || quality(group), embed: isFrame });
  }
  return out;
}

export function ogImage(html: string): string | null {
  const m = String(html).match(/<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i) || String(html).match(/<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:image["']/i);
  return m ? absUrl(m[1]) : null;
}

// ── State ──────────────────────────────────────────────────────────────────
export interface SourceState { id: string; host: string; okAt?: number; fails?: number; err?: string; movedFrom?: string; movedAt?: number; fp?: { name: string; desc: string }; fpAt?: number; sweepAt?: number; sweepIdx?: number }
export interface PostState { src: string; id: number; url: string; title: string; mod: string; key: string; date: string; seenAt: number; readAt?: number; start?: StartGuess | null; links?: RawLink[]; img?: string | null }
export interface PubLink { u: string; q: string; s: number; n: number; e?: 1; at: number }
export interface Show {
  key: string; slug: string; date: string; fed: string; prog: string; ar: string; name: string; ple?: boolean;
  start: number; how: string; end: number; img?: string | null; srcImg?: string | null; srcs: string[]; links: PubLink[];
  firstAt: number; page?: "pending" | "done" | "gone"; pageAt?: number; pageRev?: number; pageV?: number;
}
export interface LiveState { sources: Record<string, SourceState>; posts: Record<string, PostState>; shows: Record<string, Show>; manual: Manual; health?: Health }
/** Each server as the check found it (.github/workflows/live-check.yml opens it like a visitor, every ten minutes around
 *  a show): playing or not, how long until the picture came, and the picture's real height */
export type Health = Record<string, { ok: 0 | 1; ms: number; h?: number; at: number }>;
const HEALTH_FRESH = 40 * 60_000;

const ENDED_KEEP = 3 * 86_400_000;      // an ended show's page stays three days, then goes
const HORIZON = 8 * 86_400_000;         // shows further away than this are not listed yet
const GRACE = 30 * 60_000;              // a show stays «live» this long after its usual length

/** The posts of each show merged into one show: the most trusted start, every link of every source, deduplicated */
export function mergeShows(posts: PostState[], prev: Record<string, Show>, now: number): Record<string, Show> {
  const by = new Map<string, PostState[]>();
  for (const p of posts) { if (!by.has(p.key)) by.set(p.key, []); by.get(p.key)!.push(p); }
  const out: Record<string, Show> = {};
  for (const [key, ps] of by) {
    const id = identify(ps[0].title);
    if (!id) continue;
    const old = prev[key];
    const rankOf = (src: string) => (SOURCES.find((s) => s.id === src) || { rank: 9 }).rank;
    ps.sort((a, b) => rankOf(a.src) - rankOf(b.src));
    // start: a countdown beats a «8 PM ET» in the text beats the usual time; among equals, what most sources say
    const weight = { countdown: 3, text: 2, usual: 1 } as const;
    const starts = ps.map((p) => p.start).filter(Boolean) as StartGuess[];
    const fallback = usualStart(id.program, id.date);
    if (fallback) starts.push(fallback);
    if (!starts.length) continue;
    const best = Math.max(...starts.map((s) => weight[s.how]));
    const votes = new Map<number, number>();
    for (const s of starts) if (weight[s.how] === best) votes.set(s.at, (votes.get(s.at) || 0) + 1);
    const start = [...votes.entries()].sort((a, b) => b[1] - a[1] || a[0] - b[0])[0][0];
    const how = starts.find((s) => s.at === start && weight[s.how] === best)!.how;
    const end = start + id.program.dur * 60_000 + GRACE;
    // links: each source numbered by when it first had links, each link keeps when it first appeared
    const srcs = old ? [...old.srcs] : [];
    const links: PubLink[] = [];
    const known = new Map((old?.links || []).map((l) => [l.u, l] as const));
    const per = new Map<number, number>();
    for (const p of ps) {
      if (!p.links || !p.links.length) continue;
      if (!srcs.includes(p.src)) srcs.push(p.src);
    }
    const ordered = [...ps].sort((a, b) => srcs.indexOf(a.src) - srcs.indexOf(b.src));
    const seenUrl = new Set<string>();
    for (const p of ordered) {
      const s = srcs.indexOf(p.src) + 1;
      if (!s) continue;
      for (const l of p.links || []) {
        if (seenUrl.has(l.url)) continue;
        seenUrl.add(l.url);
        const n = (per.get(s) || 0) + 1; per.set(s, n);
        links.push({ u: l.url, q: l.q, s, n, ...(l.embed ? { e: 1 as const } : {}), at: known.get(l.url)?.at || now });
      }
    }
    // the picture: one made for this episode (an upload of this month) before a program's standing one
    const ym = id.date.slice(0, 7).replace("-", "/");
    const imgs = ps.map((p) => p.img).filter(Boolean) as string[];
    const srcImg = imgs.find((u) => u.includes(`/uploads/${ym}/`)) || imgs[0] || null;
    out[key] = {
      key, slug: slugOf(id), date: id.date, fed: id.program.fed, prog: id.program.key, ar: id.program.ar || "", name: id.name,
      ...(id.program.ple ? { ple: true } : {}),
      start, how, end, srcImg, img: old?.img || null, srcs,
      links, firstAt: old?.firstAt || now, ...(old?.page ? { page: old.page, pageAt: old.pageAt, ...(old.pageRev ? { pageRev: old.pageRev } : {}), ...(old.pageV ? { pageV: old.pageV } : {}) } : {}),
    };
  }
  // a show whose posts left the sources' first page stays until its end (and its page's three days)
  for (const [key, s] of Object.entries(prev)) if (!out[key] && now < s.end + ENDED_KEEP) out[key] = s;
  return out;
}

/** The page address of a show: «dynamite-25-11-2026» like the shows' own pages */
export function slugOf(id: ShowId): string {
  const [y, m, d] = id.date.split("-");
  return `${id.program.key}-${d}-${m}-${y}`.replace(/[^a-z0-9-]+/g, "-").replace(/-+/g, "-");
}

/** The Arabic name the site shows: «عرض داينامايت» (the owner, 2026-11-25: «عرض» before the name); a name the owner wrote
 *  that already starts with it is kept as he wrote it */
export function arabicTitle(s: Pick<Show, "ar" | "name" | "fed"> & { ownT?: 1 }): string {
  if (!s.ar) return s.name;
  if (s.ownT) return s.ar;
  return /^عرض\s/.test(s.ar) ? s.ar : `عرض ${s.ar}`;
}

export type Status = "soon" | "live" | "ended";
export function statusOf(s: Pick<Show, "start" | "end">, now: number): Status {
  return now >= s.end ? "ended" : now >= s.start ? "live" : "soon";
}

// ── Playing on the site ─────────────────────────────────────────────────────
/** The address that plays a stream link inside our own page, or null when it plays only on its own site.
 *  Checked in a browser 2026-11-25: sawlivenow.com's embed plays framed on any site (the sources' own pages only frame
 *  it, with ads around); dailypudding's «alpha.php?live=chNN_Q» is that embed wrapped in ads; techfunlife's
 *  «line=1080NN_Q» is the same channel behind a human check and refuses framing; blog.djt2.com short links open an ad
 *  page and refuses framing (X-Frame-Options SAMEORIGIN, 2026-11-26) — its player sits behind the ad wall, which is
 *  never gone around; dramavideo.se allows framing. */
export function playable(u: string): string | null {
  let url: URL;
  try { url = new URL(u); } catch { return null; }
  if (url.protocol !== "https:" && url.protocol !== "http:") return null;
  const host = url.hostname.replace(/^www\./, "").toLowerCase();
  const ch = (v: string | null | undefined) => (v && /^ch\d{1,4}_[A-Z]{2,3}$/.test(v) ? `https://www.sawlivenow.com/embed/${v}/` : null);
  if (host === "sawlivenow.com") return ch((url.pathname.match(/^\/embed\/([^/]+)\/?$/) || [])[1]);
  const live = url.searchParams.get("live");
  if (live) return ch(live);
  // afiyukent.one's «watch.php?id=ch87_SD&host=sawlive» (watchwrestlingtv, 2026-11-26) names the same embed in its address
  if (/^sawlive/i.test(url.searchParams.get("host") || "")) return ch(url.searchParams.get("id"));
  if (host === "dramavideo.se" || host.endsWith(".dramavideo.se")) return "https://" + url.host + url.pathname + url.search;
  return null;
}

/** The one server that opens outside: 1max's own links page (/busy/<show>.php). Its «CatchUp» buttons work only when clicked
 *  there — techfunlife's player sends anyone coming from another site to dailypudding's «Go To WatchWrestlingUP.org»
 *  (its script writes nothing else for «minify=gloria»; owner 2026-11-26: «عايزك تتاكد 100٪ من السيرفرات الخاريجية …
 *  وخليها متتكررش تاني ابدا»). So no «CatchUp» link is ever shown, and the page holding them is shown once. */
export function outerLink(u: string): string | null {
  let url: URL;
  try { url = new URL(u); } catch { return null; }
  if (url.protocol !== "https:" || url.search || !/^\/busy\/[a-z0-9_-]{1,40}\.php$/i.test(url.pathname)) return null;
  return url.toString();
}

/** A server as /live/data gives it: «u» plays in our player, or (x) opens on its own site */
export interface PubServer { u: string; q: string; s: number; n: number; at: number; x?: 1; m?: 1; d?: 1; ms?: number; p?: 1 }
/** The quality from the picture's real height (the check's measure beats a source's label: «83 FHD» played 960×540) */
export function qualityOf(h: number): string { return h >= 1000 ? "FHD" : h >= 700 ? "HD" : h >= 450 ? "SD" : h > 0 ? "LQ" : ""; }
// HD, SD, LQ, then FHD: 1max's own word on its channels («87 PipFree & Most Stable | 83 FHD but can buffer»), and the list
// reads in even steps — 87 and 86 in pairs, the heavy one last (owner 2026-11-26: «مرتبين ومنظمين»)
const QORDER: Record<string, number> = { HD: 0, SD: 1, LQ: 2, FHD: 3 };
/** A show's servers: the owner's own first, then every source's in the order they came, the best quality first;
 *  duplicates (the same channel under two pages) once. Only what plays inside our page (owner 2026-11-26: «مش رابط خارجي
 *  مش عايز الناس تطلع من الموقع»): a source link that opens only on its own site is never shown — the one exception is a
 *  link the owner himself adds in the panel marked «بيفتح في صفحة تانية». */
export function servers(s: Pick<EffShow, "links" | "add" | "block">, health: Health = {}, now = Date.now()): PubServer[] {
  const block = new Set(s.block || []);
  const play: PubServer[] = [], own: PubServer[] = [], seen = new Set<string>();
  for (const a of s.add || []) {
    if (block.has(a.u)) continue;
    const u = a.x ? a.u : playable(a.u) || a.u;
    if (seen.has(u)) continue;
    seen.add(u);
    (a.x ? own : play).push({ u, q: a.q || "", s: 0, n: 0, at: a.at, m: 1, ...(a.x ? { x: 1 as const } : {}) });
  }
  const auto: PubServer[] = [];
  const outer: PubServer[] = [];
  for (const l of s.links || []) {
    const u = l.e ? l.u : playable(l.u);
    // hidden by the owner under the source's address or the one that plays (the same channel from another source too)
    if (block.has(l.u) || (u && block.has(u))) continue;
    if (!u) {
      const o = outerLink(l.u);
      if (o && !seen.has(o)) { seen.add(o); outer.push({ u: o, q: "", s: l.s, n: 0, at: l.at, x: 1, p: 1 }); }
      continue;
    }
    if (seen.has(u)) continue;
    seen.add(u);
    auto.push({ u, q: l.q, s: l.s, n: 0, at: l.at });
  }
  auto.sort((a, b) => a.s - b.s || (QORDER[a.q] ?? 4) - (QORDER[b.q] ?? 4));
  const base = play.concat(auto, own, outer);
  // the check (owner 2026-11-26: «خلي اول سيرفر دايما هو اسرع سيرفر… اتاكد منهم انهم شغاليين دايما»): the ones playing
  // first, fastest first; then the rest in the usual order. One that answered «not found» is not moved down: the check runs
  // in the US (a stream «not found» there played from Egypt the same night), and moving it scrambled the list («عشوائي»)
  const fresh = (u: string) => { const h = health[u]; return h && now - h.at < HEALTH_FRESH ? h : null; };
  for (const v of base) { const h = fresh(v.u); if (h?.ok && h.h) v.q = qualityOf(h.h); if (h?.ok) v.ms = h.ms; }
  const alive = base.filter((v) => !v.x && fresh(v.u)?.ok).sort((a, b) => (a.ms || 0) - (b.ms || 0));
  const late: PubServer[] = [];
  // what opens on another site always last, after every server that plays here: the owner's own, then the source's page
  const inPage = alive.concat(base.filter((v) => !v.x && !alive.includes(v) && !late.includes(v)), late);
  const ext = base.filter((v) => v.x);
  const out = inPage.concat(ext);
  out.forEach((v, i) => { v.n = i + 1; });
  return out;
}

// ── The owner's hand (panel «البث المباشر») ────────────────────────────────
/** A link the owner added: plays here unless marked as opening on its own site */
export interface ManualLink { u: string; q?: string; x?: 1; at: number }
/** What the owner changed on a show, or a show he added himself (def) */
export interface ManualShow {
  hide?: 1; t?: string; start?: number; end?: number; img?: string; note?: string; vod?: string;
  add?: ManualLink[]; block?: string[];
  def?: { name: string; fed: string; prog: string; date: string; ar: string; ple?: 1 };
  rev?: number; page?: Show["page"]; pageAt?: number; pageRev?: number; pageV?: number;
}
export interface Manual { shows: Record<string, ManualShow>; off?: 1 }
export type EffShow = Show & { ownT?: 1; hide?: 1; note?: string; vod?: string; add?: ManualLink[]; block?: string[]; manual?: 1; rev?: number };

/** The shows as the site shows them: the sources' merge with the owner's changes on top */
export function applyManual(auto: Record<string, Show>, m: Manual | null | undefined): Record<string, EffShow> {
  const out: Record<string, EffShow> = {};
  for (const [k, s] of Object.entries(auto)) out[k] = { ...s };
  for (const [k, o] of Object.entries(m?.shows || {})) {
    let s = out[k];
    if (!s && o.def && o.start) {
      const d = o.def;
      const [y, mo, da] = d.date.split("-");
      s = out[k] = {
        key: k, slug: `${d.prog}-${da}-${mo}-${y}`.replace(/[^a-z0-9-]+/g, "-").replace(/-+/g, "-"), date: d.date, fed: d.fed, prog: d.prog, ar: d.ar, name: d.name,
        ...(d.ple ? { ple: true } : {}), start: o.start, how: "manual", end: o.end || o.start + 3 * 3_600_000, img: o.img || null, srcs: [], links: [],
        firstAt: 0, manual: 1, ...(o.page ? { page: o.page, pageAt: o.pageAt, pageRev: o.pageRev, pageV: o.pageV } : {}),
      } as EffShow;
    }
    if (!s) continue;
    if (o.t) { s.ar = o.t; s.ownT = 1; }   // the owner's name, word for word
    if (o.start && o.start !== s.start) { s.end = o.end || s.end - s.start + o.start; s.start = o.start; s.how = "manual"; }
    else if (o.end) s.end = o.end;
    if (o.img) s.img = o.img;
    if (o.hide) s.hide = 1;
    if (o.note) s.note = o.note;
    if (o.vod) s.vod = o.vod;
    if (o.add?.length) s.add = o.add;
    if (o.block?.length) s.block = o.block;
    if (o.rev) s.rev = o.rev;
  }
  return out;
}

/** What /live/data says: the shows of the section with their servers, shown from the moment a source has them
 *  (owner 2026-11-25: «خلي الروابط تظهر عادي مش مخفية لحد ما يشتغل العرض») until the show ends */
export function publicData(shows: Record<string, EffShow>, now: number, off = false, health: Health = {}) {
  const list = off ? [] : Object.values(shows)
    .filter((s) => !s.hide && now < s.end + 6 * 3_600_000 && s.start - now < HORIZON)
    .sort((a, b) => a.start - b.start)
    .map((s) => {
      const st = statusOf(s, now);
      const sv = st === "ended" ? [] : servers(s, health, now);
      const shown = sv.filter((v) => !v.d);
      return {
        k: s.slug, t: arabicTitle(s), en: s.name, fed: s.fed, ple: s.ple ? 1 : 0, d: s.date, p: s.prog, start: s.start, end: s.end, how: s.how, st,
        img: s.img || null, srcs: new Set(shown.filter((v) => v.s).map((v) => v.s)).size + (shown.some((v) => v.m) ? 1 : 0), n: shown.length,
        ...(s.note ? { note: s.note } : {}), ...(s.vod ? { vod: s.vod } : {}),
        sv,
      };
    });
  return { now, shows: list };
}

// ── Fetching, and following a source to its new domain ──────────────────────
async function get(url: string, ms = 8000): Promise<Response | null> {
  try {
    return await fetch(url, { headers: { "User-Agent": UA, Accept: "text/html,application/json;q=0.9,*/*;q=0.8", "Accept-Language": "en-US,en;q=0.9" }, redirect: "follow", signal: AbortSignal.timeout(ms), cf: { cacheTtl: 0 } } as any);
  } catch { return null; }
}
const hostOf = (u: string) => { try { return new URL(u).hostname.replace(/^www\./, "").toLowerCase(); } catch { return ""; } };

export interface WpPost { id: number; link: string; title: string; modified: string }
async function wpList(host: string, now: number): Promise<{ posts: WpPost[]; host: string } | null> {
  const r = await get(`https://${host}/wp-json/wp/v2/posts?per_page=10&_fields=id,link,title,modified_gmt&_=${Math.floor(now / 60_000)}`);
  if (!r || !r.ok) return null;
  const finalHost = hostOf(r.url) || host;
  const data: any = await r.json().catch(() => null);
  if (!Array.isArray(data)) return null;
  return { host: finalHost, posts: data.filter((p) => p && p.id && p.link).map((p) => ({ id: Number(p.id), link: String(p.link), title: decodeEntities(p.title?.rendered || ""), modified: String(p.modified_gmt || "") })) };
}
async function wpName(host: string): Promise<{ name: string; desc: string } | null> {
  const r = await get(`https://${host}/wp-json/?_fields=name,description`, 6000);
  if (!r || !r.ok) return null;
  const d: any = await r.json().catch(() => null);
  return d && typeof d.name === "string" ? { name: d.name.trim(), desc: String(d.description || "").trim() } : null;
}
/** Whether a candidate domain is this source: the same WordPress site name (and tagline, when it has one) */
export function sameSite(fp: SourceState["fp"], cand: { name: string; desc: string } | null): boolean {
  if (!fp || !cand) return false;
  const n = (s: string) => s.toLowerCase().replace(/\s+/g, " ").trim();
  if (n(fp.name) !== n(cand.name)) return false;
  return !fp.desc || !cand.desc || n(fp.desc) === n(cand.desc);
}
/** Domains the old one's landing page points to: a meta refresh, a script redirect, a «we moved» link */
export function movedHints(html: string, base: string): string[] {
  const s = String(html || "");
  const out = new Set<string>();
  const add = (u: string) => { const h = hostOf(absUrl(u) || ""); if (h && h.includes(base)) out.add(h); };
  for (const m of s.matchAll(/http-equiv=["']?refresh["']?[^>]*content=["'][^"']*url=([^"'>\s]+)/gi)) add(m[1]);
  for (const m of s.matchAll(/(?:location(?:\.href)?\s*=|location\.replace\()\s*["']([^"']+)["']/gi)) add(m[1]);
  for (const m of s.matchAll(/href=["']((?:https?:)?\/\/[^"']+)["']/gi)) add(m[1]);
  return [...out];
}

interface Fetched { src: SourceDef; st: SourceState; posts: WpPost[] }
/** A source's newest posts, following it to its new domain when the old one stops answering */
export async function listSource(src: SourceDef, st: SourceState, now: number, taken: Set<string>): Promise<Fetched> {
  const adopt = (host: string) => { if (host !== st.host) { st.movedFrom = st.host; st.movedAt = now; st.host = host; st.fp = undefined; } };
  let got = await wpList(st.host, now);
  if (got && got.host !== st.host && !taken.has(got.host)) adopt(got.host);
  if (!got) {
    st.fails = (st.fails || 0) + 1;
    // the old domain's landing page: a redirect the API didn't follow, or a link to the new home
    const home = await get(`https://${st.host}/`, 8000);
    const cands: string[] = [];
    if (home) {
      const h = hostOf(home.url);
      if (h && h !== st.host) cands.push(h);
      if (home.ok) cands.push(...movedHints(await home.text().catch(() => ""), src.base));
    }
    cands.push(...src.mirrors);
    for (const c of [...new Set(cands)].filter((c) => c !== st.host && !taken.has(c)).slice(0, 4)) {
      const t = await wpList(c, now);
      if (t && !taken.has(t.host) && (!st.fp || sameSite(st.fp, await wpName(t.host)))) { adopt(t.host); got = t; break; }
    }
    // nothing points anywhere: the same name under other domain endings, a few a minute, at most every 6 hours a round
    if (!got && (st.fails || 0) >= 5 && st.fp && (!st.sweepAt || now - st.sweepAt > 6 * 3_600_000 || (st.sweepIdx || 0) > 0)) {
      const i = st.sweepIdx || 0;
      const batch = SWEEP_TLDS.slice(i, i + 6).map((t) => `${src.base}.${t}`).filter((c) => c !== st.host && !taken.has(c));
      const found = await Promise.all(batch.map(async (c) => (sameSite(st.fp, await wpName(c)) ? c : null)));
      const hit = found.find(Boolean);
      st.sweepIdx = i + 6 >= SWEEP_TLDS.length ? 0 : i + 6;
      if (!st.sweepIdx) st.sweepAt = now;
      if (hit) { const t = await wpList(hit, now); if (t) { adopt(t.host); got = t; st.sweepIdx = 0; st.sweepAt = now; } }
    }
  }
  if (got) {
    st.okAt = now; st.fails = 0; st.err = undefined;
    if (!st.fp || !st.fpAt || now - st.fpAt > 86_400_000) { const fp = await wpName(st.host); if (fp) { st.fp = fp; st.fpAt = now; } }
    return { src, st, posts: got.posts };
  }
  st.err = `no answer from ${st.host}`;
  return { src, st, posts: [] };
}

// ── The minute ─────────────────────────────────────────────────────────────
let tablesReady = false;
async function ensureTable(db: D1Database) {
  if (tablesReady) return;
  await db.prepare("CREATE TABLE IF NOT EXISTS live_state (k TEXT PRIMARY KEY, v TEXT NOT NULL, at INTEGER NOT NULL)").run();
  tablesReady = true;
}
export async function loadState(db: D1Database): Promise<LiveState> {
  await ensureTable(db);
  const rows = (await db.prepare("SELECT k, v FROM live_state").all<{ k: string; v: string }>()).results || [];
  const get = (k: string) => { const r = rows.find((x) => x.k === k); try { return r ? JSON.parse(r.v) : {}; } catch { return {}; } };
  const manual = get("manual");
  return { sources: get("sources"), posts: get("posts"), shows: get("shows"), manual: { shows: manual.shows || {}, ...(manual.off ? { off: 1 as const } : {}) }, health: get("health") };
}
async function saveParts(db: D1Database, parts: [string, unknown][], now: number) {
  if (!parts.length) return;
  await db.batch(parts.map(([k, v]) => db.prepare("INSERT INTO live_state (k, v, at) VALUES (?1, ?2, ?3) ON CONFLICT(k) DO UPDATE SET v = ?2, at = ?3").bind(k, JSON.stringify(v), now)));
}

/** Whether a post's page should be read this minute */
export function wantsRead(p: PostState, show: Show | undefined, now: number, changed: boolean): boolean {
  if (changed) return true;
  if (show && now >= show.end) return false;
  if (!p.readAt) return true;
  const age = now - p.readAt;
  if (!show) return age > 20 * 60_000;
  if (now >= show.start - 45 * 60_000) return age >= 2 * 60_000;   // about to start or on: every two minutes
  if (show.start - now < 6 * 3_600_000) return age >= 10 * 60_000;   // today: every ten
  return age >= 30 * 60_000;
}

export interface LiveDeps { commit?: (changes: { path: string; text?: string; remove?: boolean }[], message: string) => Promise<string>; uploadImage?: (path: string, bytes: ArrayBuffer, type: string) => Promise<boolean>; announce?: (a: Announce) => Promise<string> }

/** A show whose live just started, for the post on social (owner 2026-11-26: «لما يبدا البث لاي عرض تنزل اعلان بوست ان
 *  نزل دلوقتي البث المباشر للعرض علي الموقع») */
export interface Announce { slug: string; url: string; title: string; text: string; img?: string | null }
const ANNOUNCE_WINDOW = 60 * 60_000;   // a show found live later than this after its start is not announced
export function toAnnounce(shows: Record<string, EffShow>, now: number, off = false, health: Health = {}): Announce[] {
  if (off) return [];
  return Object.values(shows)
    .filter((s) => !s.hide && s.page === "done" && statusOf(s, now) === "live" && now - s.start < ANNOUNCE_WINDOW)
    .filter((s) => servers(s, health, now).some((v) => !v.d && !v.x))
    .map(announceOf);
}
export function announceOf(s: EffShow): Announce {
  const t = arabicTitle(s);
  return { slug: s.slug, url: `/live/${s.slug}/`, img: s.img || null, title: `بدأ الآن البث المباشر ل${t}`,
    text: `شاهدوا ${t} مباشرةً الآن على موقع عرب راسلنج، بأكثر من سيرفر وبجودات مختلفة، من داخل الموقع.` };
}

export async function runLive(env: LiveEnv, now: number, deps: LiveDeps = {}): Promise<{ changed: boolean; shows: number }> {
  const db = env.ANALYTICS;
  if (!db) return { changed: false, shows: 0 };
  const state = await loadState(db);
  const before = { sources: JSON.stringify(state.sources), posts: JSON.stringify(state.posts), shows: JSON.stringify(state.shows) };
  for (const s of SOURCES) if (!state.sources[s.id]) state.sources[s.id] = { id: s.id, host: s.host };
  for (const id of Object.keys(state.sources)) if (!SOURCES.some((d) => d.id === id)) delete state.sources[id];
  const taken = new Set(Object.values(state.sources).map((s) => s.host));
  const lists = await Promise.all(SOURCES.map((s) => { const own = new Set(taken); own.delete(state.sources[s.id].host); return listSource(s, state.sources[s.id], now, own); }));

  // which posts are shows, and which of them to read now
  const toRead: { p: PostState; host: string }[] = [];
  const minDate = new Date(now - 2 * 86_400_000).toISOString().slice(0, 10), maxDate = new Date(now + HORIZON).toISOString().slice(0, 10);
  for (const { src, st, posts } of lists) {
    for (const wp of posts) {
      const id = identify(wp.title);
      if (!id || id.date < minDate || id.date > maxDate) continue;
      const k = `${src.id}:${wp.id}`;
      const old = state.posts[k];
      const changed = !old || old.mod !== wp.modified || old.url !== wp.link;
      const p: PostState = old ? { ...old, url: wp.link, title: wp.title, mod: wp.modified, key: id.key, date: id.date } : { src: src.id, id: wp.id, url: wp.link, title: wp.title, mod: wp.modified, key: id.key, date: id.date, seenAt: now };
      state.posts[k] = p;
      if (wantsRead(p, state.shows[id.key], now, changed)) toRead.push({ p, host: st.host });
    }
  }
  // the most urgent first, a dozen a minute at most
  toRead.sort((a, b) => (state.shows[a.p.key]?.start || Infinity) - (state.shows[b.p.key]?.start || Infinity));
  await Promise.all(toRead.slice(0, 12).map(async ({ p, host }) => {
    const r = await get(p.url, 10000);
    if (!r || !r.ok) return;
    const html = await r.text().catch(() => "");
    if (!html) return;
    const pageHost = hostOf(r.url) || host;
    p.readAt = now;
    p.start = findStart(postBody(html), p.date) || p.start || null;
    p.links = extractLinks(html, pageHost);
    // 1max keeps the stream buttons on its own links page («If links doesnt load, Go Here» → /busy/aew.php), not in the
    // post (2026-11-26): read from there when the post has none
    if (!p.links.length) {
      const esc = pageHost.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const busy = (html.match(new RegExp(`(?:https?:)?//(?:www\\.)?${esc}/busy/[a-z0-9_-]{1,40}\\.php`, "i")) || [])[0];
      if (busy) {
        const b = await get(busy.startsWith("//") ? "https:" + busy : busy, 10000);
        const bh = b && b.ok ? await b.text().catch(() => "") : "";
        // its «CatchUp» buttons play only when clicked from that page: their player sends anyone coming from elsewhere to
        // «Go To WatchWrestlingUP.org» (owner 2026-11-26, opened from our page). So the page itself is the one server
        // that opens outside, and every other «CatchUp» stays out (outerLink)
        if (bh) p.links = extractLinks(bh, pageHost).concat([{ url: busy.startsWith("//") ? "https:" + busy : busy, label: "", group: "", q: "", embed: false }]);
      }
    }
    p.img = ogImage(html) || p.img || null;
  }));
  // posts of shows long gone are forgotten, and those of a source no longer followed (owner 2026-11-26: 1max only)
  for (const [k, p] of Object.entries(state.posts)) if (!SOURCES.some((d) => d.id === p.src)) delete state.posts[k];
  for (const [k, p] of Object.entries(state.posts)) if (p.date < minDate && !(state.shows[p.key] && now < state.shows[p.key].end + ENDED_KEEP)) delete state.posts[k];

  state.shows = mergeShows(Object.values(state.posts), state.shows, now);
  const marks = await pages(applyManual(state.shows, state.manual), now, deps).catch((e) => { console.log("[live] pages:", e?.message || e); return [] as PageMark[]; });
  for (const mk of marks) if (state.shows[mk.key]) Object.assign(state.shows[mk.key], mk.set);
  const manualMarks = marks.filter((mk) => !state.shows[mk.key]);
  if (manualMarks.length) await markManualPages(db, manualMarks, now);
  // the post «the live started» on social, once per show (the deps keep which went)
  if (deps.announce) {
    for (const a of toAnnounce(applyManual(state.shows, state.manual), now, !!state.manual.off, state.health)) {
      await deps.announce(a).catch((e) => console.log("[live] announce:", e?.message || e));
    }
  }

  const parts: [string, unknown][] = [];
  if (JSON.stringify(state.sources) !== before.sources) parts.push(["sources", state.sources]);
  if (JSON.stringify(state.posts) !== before.posts) parts.push(["posts", state.posts]);
  const showsChanged = JSON.stringify(state.shows) !== before.shows;
  if (showsChanged) parts.push(["shows", state.shows]);
  await saveParts(db, parts, now);
  if (showsChanged || manualMarks.length) await purgeData().catch(() => {});
  return { changed: showsChanged, shows: Object.keys(state.shows).length };
}

// ── The shows' pages on the site ───────────────────────────────────────────
/** The page file of a show: front matter only; the page fills itself from /live/data */
export function pageFile(s: Show): string {
  const q = (v: string) => JSON.stringify(v);
  const title = `بث مباشر ${arabicTitle(s)}`;
  return [
    "---",
    `title: ${q(title)}`,
    `live_key: ${q(s.slug)}`,
    `program_en: ${q(s.name)}`,
    `federation: ${q(s.fed)}`,
    `event_date: ${s.date}`,
    `start: ${q(new Date(s.start).toISOString())}`,
    `end: ${q(new Date(s.end).toISOString())}`,
    ...(s.img ? [`image: ${q(s.img)}`] : []),
    "---",
    "",
  ].join("\n");
}
/** The page file's format: a page written by an older one is written again (INCIDENTS #1537: the program's name without
 *  its date, for the page's title in the search results) */
export const PAGE_V = 3;
interface PageMark { key: string; set: Partial<Pick<Show, "page" | "pageAt" | "pageRev" | "pageV" | "img">> }
/** Pages to write: a new show's, an edited show's again (the owner's change of name, time or picture), and a hidden
 *  or old show's away. Returns what changed on each show, for the caller to keep. */
async function pages(shows0: Record<string, EffShow>, now: number, deps: LiveDeps): Promise<PageMark[]> {
  if (!deps.commit) return [];
  const shows = Object.values(shows0);
  const create = shows.filter((s) => !s.hide && (!s.page || s.page === "gone") && now < s.end && s.start - now < HORIZON);
  const update = shows.filter((s) => !s.hide && s.page === "done" && ((s.rev || 0) !== (s.pageRev || 0) || (s.pageV || 1) !== PAGE_V) && now < s.end + ENDED_KEEP);
  const remove = shows.filter((s) => s.page === "done" && (now > s.end + ENDED_KEEP || s.hide));
  if (!create.length && !update.length && !remove.length) return [];
  // a show's picture: the source's, kept on the site's own picture store (sources change domains, hotlinks break)
  const uploaded = new Map<string, string>();
  for (const s of create) {
    if (s.srcImg && !s.img && deps.uploadImage) {
      const r = await get(s.srcImg, 10000);
      const type = r?.headers.get("content-type") || "";
      if (r && r.ok && /^image\//.test(type)) {
        const ext = /png/.test(type) ? "png" : /webp/.test(type) ? "webp" : "jpg";
        const path = `content/images/live-${s.slug}.${ext}`;
        if (await deps.uploadImage(path, await r.arrayBuffer(), type).catch(() => false)) { s.img = "/" + path; uploaded.set(s.key, s.img); }
      }
    }
  }
  const changes = [
    ...create.concat(update).map((s) => ({ path: `content/live/${s.slug}.md`, text: pageFile(s) })),
    ...remove.map((s) => ({ path: `content/live/${s.slug}.md`, remove: true })),
  ];
  const names = create.concat(update).map((s) => s.slug).concat(remove.map((s) => `-${s.slug}`)).join("، ");
  const verb = create.length ? "Create" : update.length ? "Update" : "Delete";
  await deps.commit(changes, `${verb} بث مباشر “${names}” (لوحة التحكم — البث المباشر)`);
  const marks: PageMark[] = [];
  // the picture uploaded for a new show is the show's own from now on
  for (const s of create.concat(update)) marks.push({ key: s.key, set: { page: "done", pageAt: now, pageRev: s.rev || 0, pageV: PAGE_V, ...(uploaded.has(s.key) ? { img: uploaded.get(s.key) } : {}) } });
  for (const s of remove) marks.push({ key: s.key, set: { page: "gone", pageAt: now } });
  return marks;
}
/** The page state of the owner's own shows, written onto the latest «manual» row (the panel may have saved meanwhile) */
async function markManualPages(db: D1Database, marks: PageMark[], now: number) {
  const row = await db.prepare("SELECT v FROM live_state WHERE k = 'manual'").first<{ v: string }>();
  let m: Manual = { shows: {} };
  try { m = row ? JSON.parse(row.v) : m; } catch {}
  m.shows = m.shows || {};
  for (const mk of marks) if (m.shows[mk.key]) Object.assign(m.shows[mk.key], mk.set);
  await saveParts(db, [["manual", m]], now);
}

// ── /live/data ─────────────────────────────────────────────────────────────
const DATA_URL = "https://arw-site-bot.m7mdibrahimpc.workers.dev/live/data";
async function purgeData() { await (caches as any).default.delete(new Request(DATA_URL)); }

/** /live/data: the section's shows (edge copy of 20 s), with the visitor's own country and time zone (from the request,
 *  never cached) and the exact time of this answer — a countdown right to the second in the visitor's own time
 *  (owner 2026-11-25: «أي حد بيدخل من بلد مختلفة يظهرله الوقت بتوقيت بلده علي حسب الـ IP ويتكتب اسم الدولة») */
export async function liveDataResponse(env: LiveEnv, cors: Record<string, string>, request?: Request, now = Date.now()): Promise<Response> {
  const cache = (caches as any).default as Cache;
  const key = new Request(DATA_URL);
  let body = "";
  const hit = await cache.match(key);
  if (hit) body = await hit.text();
  else {
    let shows: Record<string, Show> = {}, manual: Manual = { shows: {} }, health: Health = {};
    if (env.ANALYTICS) {
      await ensureTable(env.ANALYTICS);
      const rows = (await env.ANALYTICS.prepare("SELECT k, v FROM live_state WHERE k IN ('shows', 'manual', 'health')").all<{ k: string; v: string }>()).results || [];
      for (const r of rows) { try { if (r.k === "shows") shows = JSON.parse(r.v); else if (r.k === "health") health = JSON.parse(r.v); else manual = JSON.parse(r.v); } catch {} }
    }
    body = JSON.stringify(publicData(applyManual(shows, manual), now, !!manual.off, health));
    // 20 s at the edge: a crowd at the start of a show costs one database read per 20 s, and a new link shows within it
    await cache.put(key, new Response(body, { headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "public, max-age=20" } }));
  }
  const cf: any = (request as any)?.cf || {};
  const geo = { c: /^[A-Z]{2}$/.test(String(cf.country || "")) ? cf.country : "", tz: /^[A-Za-z_]+(?:\/[A-Za-z0-9_+-]+){0,2}$/.test(String(cf.timezone || "")) ? cf.timezone : "" };
  const out = `{"geo":${JSON.stringify(geo)},"t":${Date.now()},` + body.slice(1);
  return new Response(out, { headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "private, no-store", ...cors } });
}

/** The check's answer (POST /api/live/health from .github/workflows/live-check.yml): kept for the servers it names, the
 *  old ones dropped after a day; /live/data shows it within its 20 s edge copy */
export async function saveHealth(env: LiveEnv, checks: any[], now = Date.now()): Promise<{ saved: number }> {
  const db = env.ANALYTICS; if (!db) return { saved: 0 };
  await ensureTable(db);
  const row = await db.prepare("SELECT v FROM live_state WHERE k = 'health'").first<{ v: string }>();
  let h: Health = {}; try { h = row ? JSON.parse(row.v) : {}; } catch { h = {}; }
  for (const k of Object.keys(h)) if (now - h[k].at > 86_400_000) delete h[k];
  let saved = 0;
  for (const c of (Array.isArray(checks) ? checks : []).slice(0, 60)) {
    const u = typeof c?.u === "string" && /^https:\/\/[^\s"'<>]{4,400}$/.test(c.u) ? c.u : ""; if (!u) continue;
    if (c.unknown) { delete h[u]; saved++; continue; }   // not known either way: neither first nor hidden
    h[u] = { ok: c.ok ? 1 : 0, ms: Math.max(0, Math.min(120_000, Math.round(+c.ms || 0))), ...(+c.h > 0 ? { h: Math.min(4320, Math.round(+c.h)) } : {}), at: now };
    saved++;
  }
  await saveParts(db, [["health", h]], now);
  await purgeData().catch(() => {});
  return { saved };
}

/** /live/status: each source's domain and health, for the panel and the watchdog (no links) */
export async function liveStatus(env: LiveEnv): Promise<unknown> {
  if (!env.ANALYTICS) return { sources: {} };
  const st = await loadState(env.ANALYTICS);
  return {
    sources: Object.fromEntries(Object.values(st.sources).map((s) => [s.id, { host: s.host, okAt: s.okAt, fails: s.fails || 0, err: s.err, movedFrom: s.movedFrom, movedAt: s.movedAt }])),
    shows: Object.values(st.shows).map((s) => ({ key: s.key, slug: s.slug, start: s.start, end: s.end, how: s.how, srcs: s.srcs, links: s.links.length, page: s.page })),
  };
}

// ── The panel: «الأدوات ← البث المباشر» (owner 2026-11-25: «تحكم كامل في القسم في اللوحة لو حبيت أضيف حاجة يدوي أو
//    أعدل حاجة … كل الصلاحيات معايا كاملة») ─────────────────────────────────────────────────────────────────
const PROGRAMS = (): { key: string; fed: string; ar: string; dur: number; ple?: 1 }[] => [
  ...WEEKLY.map(([, p]) => ({ key: p.key, fed: p.fed, ar: p.ar, dur: p.dur })),
  ...PLE.map(([, key, fed, ar]) => ({ key, fed, ar, dur: 240, ple: 1 as const })),
];
const clean = (v: unknown, max: number) => String(v ?? "").replace(/[\u0000-\u001f\u007f<>]/g, " ").replace(/\s+/g, " ").trim().slice(0, max);
const httpsUrl = (v: unknown) => { const u = String(v ?? "").trim(); if (u.length > 1500) return null; try { const x = new URL(u); return x.protocol === "https:" || x.protocol === "http:" ? x.toString() : null; } catch { return null; } };
const QUAL = new Set(["FHD", "HD", "SD", "LQ", ""]);

/** Patch the sources' own shows row with page marks (the panel's write, the cron may have saved meanwhile) */
async function markAutoPages(db: D1Database, marks: PageMark[], now: number) {
  if (!marks.length) return;
  const row = await db.prepare("SELECT v FROM live_state WHERE k = 'shows'").first<{ v: string }>();
  let shows: Record<string, Show> = {};
  try { shows = row ? JSON.parse(row.v) : {}; } catch {}
  for (const mk of marks) if (shows[mk.key]) Object.assign(shows[mk.key], mk.set);
  await saveParts(db, [["shows", shows]], now);
}

/** After the owner's change: the site's pages follow at once (a new show's page, a hidden one's gone, an edit rewritten) */
async function syncPages(db: D1Database, now: number, deps: LiveDeps) {
  const st = await loadState(db);
  const marks = await pages(applyManual(st.shows, st.manual), now, deps);
  await markAutoPages(db, marks.filter((m) => st.shows[m.key]), now);
  const own = marks.filter((m) => !st.shows[m.key]);
  if (own.length) await markManualPages(db, own, now);
}

/** The servers as the panel shows them (owner 2026-11-26: no duplicates, nothing that sends people away): «sv» exactly what
 *  visitors see, in order, each once; «hidden» what the owner hid, each once; «dup» / «out» how many source links were left
 *  out as copies of a server already shown / as pages that open only on their own site */
export function panelServers(s: EffShow, srcName: (i: number, s: EffShow) => string, health: Health = {}, now = Date.now()) {
  const block = new Set(s.block || []);
  // an owner's own server keeps the address he typed (raw), which the panel moves or removes it by
  const rawOf = (u: string) => (s.add || []).find((a) => (a.x ? a.u : playable(a.u) || a.u) === u)?.u || u;
  const chk = (u: string) => { const h = health[u]; return h && now - h.at < HEALTH_FRESH ? { ok: h.ok, ms: h.ms, at: h.at } : null; };
  const sv = servers(s, health, now).map((v) => ({ u: v.u, raw: v.m ? rawOf(v.u) : v.u, q: v.q, n: v.n, src: v.m ? "" : srcName(v.s, s), m: v.m ? 1 : 0, x: v.x ? 1 : 0, d: v.d ? 1 : 0, chk: chk(v.u) }));
  const shown = new Set(sv.map((v) => v.u)), hidden: { u: string; q: string; src: string }[] = [], hid = new Set<string>();
  let copies = 0, out = 0;
  for (const l of s.links || []) {
    const u = l.e ? l.u : playable(l.u) || outerLink(l.u);
    if (!u) { out++; continue; }
    if (block.has(l.u) || block.has(u)) { if (!hid.has(u) && !shown.has(u)) { hid.add(u); hidden.push({ u, q: l.q, src: srcName(l.s, s) }); } continue; }
    if (shown.has(u)) copies++;
  }
  // every link that plays a shown server, less the one it is shown as: a copy
  return { sv, hidden, dup: Math.max(0, copies - sv.filter((v) => !v.m).length), out };
}

function adminView(st: LiveState, now: number) {
  const eff = applyManual(st.shows, st.manual);
  const list = Object.values(eff).filter((s) => now < s.end + ENDED_KEEP || st.manual.shows[s.key]?.def && now < s.end + ENDED_KEEP);
  list.sort((a, b) => { const A = now >= a.end ? 1 : 0, B = now >= b.end ? 1 : 0; return A - B || (A ? b.start - a.start : a.start - b.start); });
  const srcName = (i: number, s: EffShow) => s.srcs[i - 1] || "";
  return {
    now, off: !!st.manual.off,
    sources: SOURCES.map((d) => { const x = st.sources[d.id] || { id: d.id, host: d.host }; return { id: d.id, home: d.host, host: x.host, okAt: x.okAt || 0, fails: x.fails || 0, err: x.err || "", movedFrom: x.movedFrom || "", movedAt: x.movedAt || 0 }; }),
    programs: PROGRAMS(),
    shows: list.map((s) => {
      const auto = st.shows[s.key];
      const o = st.manual.shows[s.key] || {};
      return {
        key: s.key, slug: s.slug, t: arabicTitle(s), name: s.name, fed: s.fed, prog: s.prog, date: s.date, start: s.start, end: s.end, how: s.how,
        st: statusOf(s, now), img: s.img || null, hide: !!s.hide, note: s.note || "", vod: s.vod || "", own: !auto, page: s.page || "", edited: !!st.manual.shows[s.key],
        auto: auto ? { t: arabicTitle(auto), start: auto.start, end: auto.end, img: auto.img || null, how: auto.how } : null,
        ...panelServers(s, srcName, st.health || {}, now),
        add: o.add || [],
        servers: servers(s, st.health || {}, now).filter((v) => !v.d).length,
      };
    }),
  };
}

export async function liveAdmin(env: LiveEnv, request: Request, deps: LiveDeps, now = Date.now()): Promise<{ status?: number; body: any }> {
  const db = env.ANALYTICS;
  if (!db) return { status: 500, body: { success: false, error: "قاعدة البيانات مش متوصلة" } };
  const st = await loadState(db);
  if (request.method === "GET") return { body: { success: true, ...adminView(st, now) } };
  const b: any = await request.json().catch(() => ({}));
  const fail = (error: string) => ({ status: 400, body: { success: false, error } });
  const eff = applyManual(st.shows, st.manual);
  const m = st.manual;
  const entry = (k: string) => (m.shows[k] = m.shows[k] || {});
  const bump = (k: string) => { const e = entry(k); e.rev = (e.rev || 0) + 1; };
  const parts: [string, unknown][] = [];
  let pagesToo = false;
  const key = String(b.key || "");
  const show = eff[key];
  const needShow = () => (show ? null : fail("العرض ده مش موجود (يمكن اتشال)."));
  const time = (v: unknown) => { const n = Number(v); return Number.isFinite(n) && n > now - 30 * 86_400_000 && n < now + 90 * 86_400_000 ? Math.round(n) : null; };

  switch (b.action) {
    case "save": {                     // name, time, end, picture, a note on the page, the full show's page
      const bad = needShow(); if (bad) return bad;
      const e = entry(key);
      // the name as the sources give it («عرض داينامايت») is no change of the owner's
      if ("t" in b) { const t = clean(b.t, 80); const src = st.shows[key]; if (t && !(src && t === arabicTitle(src))) e.t = t; else delete e.t; }
      if ("start" in b) { if (b.start === null || b.start === "") delete e.start; else { const t = time(b.start); if (!t) return fail("وقت البداية مش صحيح"); e.start = t; } }
      if ("end" in b) { if (b.end === null || b.end === "") delete e.end; else { const t = time(b.end); if (!t) return fail("وقت النهاية مش صحيح"); e.end = t; } }
      const s0 = e.start || show!.start, e0 = e.end || (e.start ? show!.end - show!.start + e.start : show!.end);
      if (e0 <= s0 || e0 - s0 > 14 * 3_600_000) return fail("النهاية لازم تبقى بعد البداية وبحد أقصى 14 ساعة");
      if ("img" in b) { const v = String(b.img || "").trim(); if (!v) delete e.img; else if (/^\/content\/images\/[\w.-]+$/.test(v) || httpsUrl(v)) e.img = v; else return fail("رابط الصورة مش صحيح"); }
      if ("note" in b) { const n = clean(b.note, 300); if (n) e.note = n; else delete e.note; }
      if ("vod" in b) {
        const v = String(b.vod || "").trim().replace(/^https?:\/\/(?:www\.)?arab-wrestling\.com/i, "");
        if (!v) delete e.vod; else if (/^\/[^\s<>"']{2,300}$/.test(v)) e.vod = v; else return fail("رابط العرض الكامل لازم يكون صفحة من الموقع");
      }
      bump(key); pagesToo = true; break;
    }
    case "hide": case "unhide": {
      const bad = needShow(); if (bad) return bad;
      if (b.action === "hide") entry(key).hide = 1; else delete entry(key).hide;
      bump(key); pagesToo = true; break;
    }
    case "link-add": {
      const bad = needShow(); if (bad) return bad;
      const u = httpsUrl(b.u); if (!u) return fail("الرابط مش صحيح");
      const q = QUAL.has(String(b.q || "")) ? String(b.q || "") : "";
      const e = entry(key); e.add = e.add || [];
      if (e.add.length >= 40) return fail("وصلت لأقصى عدد روابط يدوية للعرض (40)");
      if (e.add.some((a) => a.u === u)) return fail("الرابط ده مضاف قبل كده");
      e.add.unshift({ u, q, ...(b.x ? { x: 1 as const } : {}), at: now });
      if (e.block) e.block = e.block.filter((x) => x !== u);
      break;
    }
    case "link-move": {                 // the owner's own servers: up or down
      const e = entry(key); const i = (e.add || []).findIndex((a) => a.u === b.u); const j = i + (b.dir === "up" ? -1 : 1);
      if (i < 0 || j < 0 || j >= e.add!.length) return fail("مينفعش");
      [e.add![i], e.add![j]] = [e.add![j], e.add![i]]; break;
    }
    case "link-del": {                  // the owner's link goes; a source's link is hidden (and comes back with «link-restore»)
      const bad = needShow(); if (bad) return bad;
      const u = String(b.u || ""); const e = entry(key);
      if (e.add?.some((a) => a.u === u)) e.add = e.add.filter((a) => a.u !== u);
      else { e.block = Array.from(new Set([...(e.block || []), u])).slice(-200); }
      break;
    }
    case "link-restore": {             // back under every address it was hidden by (the source's or the one that plays)
      const u = String(b.u || ""); const e = entry(key);
      e.block = (e.block || []).filter((x) => x !== u && playable(x) !== u); break;
    }
    case "add-show": {                  // a show the owner adds by hand: it merges with the sources' when they post it
      const prog = String(b.prog || "").toLowerCase().replace(/[^a-z0-9-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40);
      const date = String(b.date || "");
      if (prog.length < 2) return fail("اختار البرنامج أو اكتب اسمه بالإنجليزي");
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return fail("التاريخ مش صحيح");
      const start = time(b.start); if (!start) return fail("وقت البداية مش صحيح");
      const end = b.end ? time(b.end) : null;
      if (end && (end <= start || end - start > 14 * 3_600_000)) return fail("النهاية لازم تبقى بعد البداية وبحد أقصى 14 ساعة");
      const k = `${prog}-${date}`;
      if (eff[k] && !eff[k].hide) return fail("العرض ده موجود بالفعل في القسم — عدّله من القائمة");
      const known = PROGRAMS().find((p) => p.key === prog);
      const name = clean(b.name, 80) || (known ? `${known.fed} ${prog.replace(/-/g, " ")}` : prog.replace(/-/g, " "));
      const ar = clean(b.ar, 80) || known?.ar || "";
      const fed = clean(b.fed, 12).toUpperCase() || known?.fed || "WWE";
      const old = m.shows[k] || {};
      m.shows[k] = { ...old, def: { name, fed, prog, date, ar, ...(known?.ple ? { ple: 1 as const } : {}) }, start, ...(end ? { end } : old.end ? {} : { end: start + (known?.dur || 180) * 60_000 + GRACE }), rev: (old.rev || 0) + 1 };
      delete m.shows[k].hide;
      const img = String(b.img || "").trim();
      if (img && (/^\/content\/images\/[\w.-]+$/.test(img) || httpsUrl(img))) m.shows[k].img = img;
      pagesToo = true; break;
    }
    case "delete": {                    // the owner's own show goes for good; a sources' show is hidden
      const bad = needShow(); if (bad) return bad;
      if (st.shows[key]) { entry(key).hide = 1; bump(key); }
      else { m.shows[key] = { ...m.shows[key], hide: 1 }; bump(key); }
      pagesToo = true; break;
    }
    case "reset": {                     // back to what the sources say
      if (!m.shows[key]) return fail("مفيش تعديلات على العرض ده");
      if (!st.shows[key]) return fail("ده عرض مضاف يدوي — امسحه بدل ما ترجّعه");
      const keep = m.shows[key];
      m.shows[key] = { rev: (keep.rev || 0) + 1, ...(keep.pageRev ? { pageRev: keep.pageRev } : {}) };
      pagesToo = true; break;
    }
    case "image": {                     // a picture from the owner's device (the panel's own resize), or from a link
      const bad = needShow(); if (bad) return bad;
      if (!deps.uploadImage) return fail("رفع الصور مش متاح");
      let bytes: ArrayBuffer | null = null, type = "image/jpeg";
      if (b.base64) { try { const bin = atob(String(b.base64)); const a = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) a[i] = bin.charCodeAt(i); bytes = a.buffer; } catch { return fail("الصورة بايظة"); } }
      else if (b.url) {
        const u = httpsUrl(b.url); if (!u) return fail("رابط الصورة مش صحيح");
        const r = await get(u, 12000); type = r?.headers.get("content-type") || "";
        if (!r || !r.ok || !/^image\//.test(type)) return fail("مقدرتش أجيب الصورة من الرابط ده");
        bytes = await r.arrayBuffer();
      }
      if (!bytes || bytes.byteLength < 200 || bytes.byteLength > 8 * 1024 * 1024) return fail("الصورة فاضية أو أكبر من 8 ميجا");
      const ext = /png/.test(type) ? "png" : /webp/.test(type) ? "webp" : "jpg";
      const e = entry(key); const path = `content/images/live-${show!.slug}-${(e.rev || 0) + 1}.${ext}`;
      if (!(await deps.uploadImage(path, bytes, type).catch(() => false))) return fail("رفع الصورة فشل، جرّب تاني");
      e.img = "/" + path; bump(key); pagesToo = true; break;
    }
    case "refresh": {                   // read the sources' pages of this show again within the minute
      const bad = needShow(); if (bad) return bad;
      let n = 0;
      for (const p of Object.values(st.posts)) if (p.key === key) { delete p.readAt; n++; }
      if (!n) return fail("مفيش صفحات مصادر للعرض ده لسه");
      parts.push(["posts", st.posts]); break;
    }
    case "announce": {                  // the post «the live started» by hand (owner 2026-11-26: «انشر بقا عرض دايناميت انه لايف»)
      const bad = needShow(); if (bad) return bad;
      if (statusOf(show, now) !== "live" || show.page !== "done" || m.off || show.hide) return fail("العرض لازم يكون مباشر دلوقتي وصفحته على الموقع.");
      if (!deps.announce) return fail("النشر مش متوصل");
      const r = await deps.announce(announceOf(show));
      const msg: Record<string, string> = { sent: "اتنشر", already: "اتنشر قبل كده للعرض ده", paused: "النشر على السوشيال متوقف من اللوحة", page: "صفحة العرض لسه مش ظاهرة على الموقع، جرب كمان دقيقة", failed: "تليجرام مردش، جرب تاني" };
      return r === "sent" || r === "already" ? { body: { success: true, posted: r, msg: msg[r], ...adminView(st, now) } } : fail(msg[r] || r);
    }
    case "off": case "on": { if (b.action === "off") m.off = 1; else delete m.off; break; }
    case "host": {                      // a source moved and the bot didn't find it: its new domain by hand
      const src = SOURCES.find((s) => s.id === b.src); if (!src) return fail("المصدر مش معروف");
      const h = String(b.host || "").trim().toLowerCase().replace(/^https?:\/\//, "").replace(/\/.*$/, "").replace(/^www\./, "");
      if (!/^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(h)) return fail("اكتب الدومين بس، زي watchwrestling.to");
      const x = st.sources[src.id] || { id: src.id, host: src.host };
      st.sources[src.id] = { ...x, movedFrom: x.host, movedAt: now, host: h, fails: 0, err: "" };
      parts.push(["sources", st.sources]); break;
    }
    default: return fail("طلب مش معروف");
  }
  parts.push(["manual", m]);
  await saveParts(db, parts, now);
  await purgeData().catch(() => {});
  let pageErr = "";
  if (pagesToo) await syncPages(db, now, deps).catch((e) => { pageErr = String(e?.message || e); });
  const fresh = await loadState(db);
  return { body: { success: true, ...(pageErr ? { pageErr } : {}), ...adminView(fresh, now) } };
}
