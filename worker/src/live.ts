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
  { id: "wwre", host: "watchwrestling.re", base: "watchwrestling", mirrors: [], rank: 2 },
  { id: "wwae", host: "watchwrestling.ae", base: "watchwrestling", mirrors: [], rank: 3 },
  { id: "wwtv", host: "watchwrestlingtv.se", base: "watchwrestlingtv", mirrors: [], rank: 4 },
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
  const name = t.replace(/\s*[–-]\s*\d.*$/, "").replace(/\b(?:watch|live|online|full show|free)\b/gi, "").replace(/\s+/g, " ").trim();
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
  firstAt: number; page?: "pending" | "done" | "gone"; pageAt?: number;
}
export interface LiveState { sources: Record<string, SourceState>; posts: Record<string, PostState>; shows: Record<string, Show> }

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
      links, firstAt: old?.firstAt || now, ...(old?.page ? { page: old.page, pageAt: old.pageAt } : {}),
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

/** The Arabic name the site shows: «بث مباشر داينامايت» */
export function arabicTitle(s: Pick<Show, "ar" | "name" | "fed">): string {
  return s.ar ? `${s.ar}` : s.name;
}

export type Status = "soon" | "live" | "ended";
export function statusOf(s: Pick<Show, "start" | "end">, now: number): Status {
  return now >= s.end ? "ended" : now >= s.start ? "live" : "soon";
}

/** What /live/data says: the shows of the section, links only from ten minutes before the start */
export function publicData(shows: Record<string, Show>, now: number) {
  const list = Object.values(shows)
    .filter((s) => now < s.end + 6 * 3_600_000 && s.start - now < HORIZON)
    .sort((a, b) => a.start - b.start)
    .map((s) => {
      const st = statusOf(s, now);
      const open = now >= s.start - 10 * 60_000 && st !== "ended";
      return {
        k: s.slug, t: arabicTitle(s), en: s.name, fed: s.fed, ple: s.ple ? 1 : 0, start: s.start, end: s.end, how: s.how, st,
        img: s.img || null, srcs: new Set(s.links.map((l) => l.s)).size, n: s.links.length,
        links: open ? s.links.map((l) => ({ u: l.u, q: l.q, s: l.s, n: l.n, ...(l.e ? { e: 1 } : {}), at: l.at })) : [],
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
  return { sources: get("sources"), posts: get("posts"), shows: get("shows") };
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

export interface LiveDeps { commit?: (changes: { path: string; text?: string; remove?: boolean }[], message: string) => Promise<string>; uploadImage?: (path: string, bytes: ArrayBuffer, type: string) => Promise<boolean> }

export async function runLive(env: LiveEnv, now: number, deps: LiveDeps = {}): Promise<{ changed: boolean; shows: number }> {
  const db = env.ANALYTICS;
  if (!db) return { changed: false, shows: 0 };
  const state = await loadState(db);
  const before = { sources: JSON.stringify(state.sources), posts: JSON.stringify(state.posts), shows: JSON.stringify(state.shows) };
  for (const s of SOURCES) if (!state.sources[s.id]) state.sources[s.id] = { id: s.id, host: s.host };
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
    p.img = ogImage(html) || p.img || null;
  }));
  // posts of shows long gone are forgotten
  for (const [k, p] of Object.entries(state.posts)) if (p.date < minDate && !(state.shows[p.key] && now < state.shows[p.key].end + ENDED_KEEP)) delete state.posts[k];

  state.shows = mergeShows(Object.values(state.posts), state.shows, now);
  await pages(state, now, deps).catch((e) => console.log("[live] pages:", e?.message || e));

  const parts: [string, unknown][] = [];
  if (JSON.stringify(state.sources) !== before.sources) parts.push(["sources", state.sources]);
  if (JSON.stringify(state.posts) !== before.posts) parts.push(["posts", state.posts]);
  const showsChanged = JSON.stringify(state.shows) !== before.shows;
  if (showsChanged) parts.push(["shows", state.shows]);
  await saveParts(db, parts, now);
  if (showsChanged) await purgeData().catch(() => {});
  return { changed: showsChanged, shows: Object.keys(state.shows).length };
}

// ── The shows' pages on the site ───────────────────────────────────────────
/** The page file of a show: front matter only; the page fills itself from /live/data */
export function pageFile(s: Show): string {
  const q = (v: string) => JSON.stringify(v);
  const title = s.ar ? `بث مباشر ${s.ar}` : `بث مباشر ${s.name}`;
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
async function pages(state: LiveState, now: number, deps: LiveDeps) {
  if (!deps.commit) return;
  const shows = Object.values(state.shows);
  const create = shows.filter((s) => !s.page && now < s.end && s.start - now < HORIZON);
  const remove = shows.filter((s) => s.page === "done" && now > s.end + ENDED_KEEP);
  if (!create.length && !remove.length) return;
  // a show's picture: the source's, kept on the site's own picture store (sources change domains, hotlinks break)
  for (const s of create) {
    if (s.srcImg && !s.img && deps.uploadImage) {
      const r = await get(s.srcImg, 10000);
      const type = r?.headers.get("content-type") || "";
      if (r && r.ok && /^image\//.test(type)) {
        const ext = /png/.test(type) ? "png" : /webp/.test(type) ? "webp" : "jpg";
        const path = `content/images/live-${s.slug}.${ext}`;
        if (await deps.uploadImage(path, await r.arrayBuffer(), type).catch(() => false)) s.img = "/" + path;
      }
    }
  }
  const changes = [
    ...create.map((s) => ({ path: `content/live/${s.slug}.md`, text: pageFile(s) })),
    ...remove.map((s) => ({ path: `content/live/${s.slug}.md`, remove: true })),
  ];
  const names = create.map((s) => s.slug).concat(remove.map((s) => `-${s.slug}`)).join("، ");
  await deps.commit(changes, `${create.length ? "Create" : "Delete"} بث مباشر “${names}” (لوحة التحكم — البث المباشر)`);
  for (const s of create) { s.page = "done"; s.pageAt = now; }
  for (const s of remove) { s.page = "gone"; s.pageAt = now; }
}

// ── /live/data ─────────────────────────────────────────────────────────────
const DATA_URL = "https://arw-site-bot.m7mdibrahimpc.workers.dev/live/data";
async function purgeData() { await (caches as any).default.delete(new Request(DATA_URL)); }

export async function liveDataResponse(env: LiveEnv, cors: Record<string, string>, now = Date.now()): Promise<Response> {
  const cache = (caches as any).default as Cache;
  const key = new Request(DATA_URL);
  const hit = await cache.match(key);
  if (hit) { const r = new Response(hit.body, hit); for (const [k, v] of Object.entries(cors)) r.headers.set(k, v); return r; }
  if (!env.ANALYTICS) return new Response(JSON.stringify({ now, shows: [] }), { headers: { "Content-Type": "application/json; charset=utf-8", ...cors } });
  await ensureTable(env.ANALYTICS);
  const row = await env.ANALYTICS.prepare("SELECT v FROM live_state WHERE k = 'shows'").first<{ v: string }>();
  let shows: Record<string, Show> = {};
  try { shows = row ? JSON.parse(row.v) : {}; } catch {}
  const body = JSON.stringify(publicData(shows, now));
  // 20 s at the edge: a crowd at the start of a show costs one database read per 20 s, and a new link shows within it
  const res = new Response(body, { headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "public, max-age=20" } });
  await cache.put(key, res.clone());
  const out = new Response(body, res);
  for (const [k, v] of Object.entries(cors)) out.headers.set(k, v);
  return out;
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
