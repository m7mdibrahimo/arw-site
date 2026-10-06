// Every watch server on recent show, recap and nostalgia pages is played for real in Chrome, inside the live
// page, the way a viewer does it: open the page, pick the server, press play, and look at what the player
// fetches and says. A link that can't play twice in a row is hidden from the page until it plays again, and
// listed in _data/videoLinks.json for the owner to replace (INCIDENTS #304).
// Why: the host-level check (check-video-hosts.ts) only sees whether a host answers. On 2026-10-06 vidtube
// answered fine, but the Raw 05.10.2026 file sat on a stream server (serv-stream-cdn44.cdn-video.xyz) that
// sent no CORS header, so its player showed «This video file cannot be played (Error Code: 232011)» while
// vidtube files on other stream servers played.
//   npx tsx scripts/check-playback.ts                 (pages from the last 7 days)
//   npx tsx scripts/check-playback.ts --days 2
//   npx tsx scripts/check-playback.ts --page https://arab-wrestling.com/shows/wwe-raw-05-10-2026/
import fs from "fs";
import path from "path";
import { spawn } from "child_process";

const ORIGIN = "https://arab-wrestling.com";
const OUT = path.join(process.cwd(), "_data", "videoLinks.json");
const CHROMES = [process.env.CHROME_PATH || "", "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", "/usr/bin/google-chrome", "/usr/bin/google-chrome-stable", "/usr/bin/chromium", "/usr/bin/chromium-browser"];
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

export interface Evidence {
  mediaOk: string[];      // stream requests that came back 2xx
  mediaFail: string[];    // stream requests that failed (CORS, 4xx/5xx, network)
  playerErrors: string[]; // «JW Player Error …» and the like
  frameText: string;      // what the player shows
  progressed: boolean;    // the <video> moved forward
}

const MEDIA = /\.m3u8|\.ts(\?|$)|\.mp4(\?|$)|\.m4s|master\.txt|index-[^/]*\.txt|\/seg-|\/hls\d?\/|vkuser\.net\/expires|\/videoplayback|\/expires\/\d+/i;
const NOT_MEDIA = /videoPreview|get_slides|\.(jpe?g|png|webp|gif|svg|css|js|woff2?)(\?|$)/i;
export const isMedia = (u: string) => MEDIA.test(u) && !NOT_MEDIA.test(u);
const DEAD = /cannot be played|file (was |has been )?(deleted|removed)|file (is )?not found|video (not found|is not available|has been (removed|deleted)|unavailable)|no longer available|embeds? disabled|has been deleted|does not exist|غير متوفر|تم حذف/i;
const CHALLENGE = /just a moment|attention required|checking your browser|verify you are human|cf-chl/i;

/** ok: the stream really came; broken: the player or the stream says no; unknown: can't tell (never hides anything). */
export function classify(ev: Evidence): { status: "ok" | "broken" | "unknown"; reason: string } {
  if (CHALLENGE.test(ev.frameText)) return { status: "unknown", reason: "bot check on the host" };
  if (DEAD.test(ev.frameText)) return { status: "broken", reason: `the player says: ${ev.frameText.replace(/\s+/g, " ").match(DEAD)![0]}` };
  if (ev.playerErrors.length) return { status: "broken", reason: ev.playerErrors[0] };
  if (ev.progressed) return { status: "ok", reason: "the video plays" };
  if (ev.mediaFail.length && !ev.mediaOk.length) return { status: "broken", reason: `the stream is refused: ${ev.mediaFail[0]}` };
  if (ev.mediaOk.length) return { status: "ok", reason: "the stream arrives" };
  return { status: "unknown", reason: "no stream seen" };
}

export interface LinkState { page: string; status: string; reason: string; strikes: number; since?: string; lastOk?: string; checked: string }
export interface State { checkedAt?: string; links: Record<string, LinkState>; broken: string[] }

/** Two broken checks in a row hide a link; one good check brings it back. A run where most links fail is the
 *  checker's own trouble (network, a blocked runner), so it changes nothing. */
export function nextState(prev: State, results: { url: string; page: string; status: string; reason: string }[], now = new Date().toISOString()): State {
  const links: Record<string, LinkState> = JSON.parse(JSON.stringify(prev.links || {}));
  const decided = results.filter(r => r.status !== "unknown");
  const failing = decided.filter(r => r.status === "broken").length;
  const trustworthy = decided.length < 4 || failing / decided.length <= 0.6;
  for (const r of results) {
    const was = links[r.url];
    const strikes = r.status === "broken" ? (trustworthy ? Math.min(2, (was?.strikes || 0) + 1) : was?.strikes || 0) : r.status === "ok" ? 0 : was?.strikes || 0;
    links[r.url] = {
      page: r.page, status: r.status, reason: r.reason, strikes, checked: now,
      since: strikes >= 2 ? was?.since || now : undefined,
      lastOk: r.status === "ok" ? now : was?.lastOk,
    };
  }
  const broken = Object.keys(links).filter(u => links[u].strikes >= 2).sort();
  return { checkedAt: now, links, broken };
}

const deobfuscate = (s: string) => { try { return Buffer.from(s.split("").reverse().join(""), "base64").toString("utf-8"); } catch { return ""; } };
const obfuscate = (s: string) => Buffer.from(s, "utf-8").toString("base64").split("").reverse().join("");

/** The servers a page shows, in order (the page hides a broken one, so those come from the state). */
export function pageServers(html: string): string[] {
  const rows = [...html.matchAll(/class="srv-row[^"]*"[^>]*data-srv="([^"]+)"/g)].map(m => deobfuscate(m[1]));
  if (rows.length) return rows;
  const init = html.match(/data-init-srv="([^"]+)"/);
  return init ? [deobfuscate(init[1])] : [];
}

async function recentPages(days: number): Promise<string[]> {
  const xml = await (await fetch(`${ORIGIN}/sitemap.xml`, { signal: AbortSignal.timeout(60000) })).text();
  const cut = Date.now() - days * 86400_000;
  const out: string[] = [];
  for (const m of xml.matchAll(/<url>([\s\S]*?)<\/url>/g)) {
    const loc = (m[1].match(/<loc>\s*([^<\s]+)\s*<\/loc>/) || [])[1] || "";
    const lastmod = (m[1].match(/<lastmod>\s*([^<\s]+)\s*<\/lastmod>/) || [])[1] || "";
    if (/^https:\/\/arab-wrestling\.com\/(shows|recaps|nostalgia)\/[^/]+\/$/.test(loc) && lastmod && Date.parse(lastmod) >= cut) out.push(loc);
  }
  return out;
}

class Browser {
  ws!: WebSocket; id = 0; pend = new Map<number, (m: any) => void>(); proc: any;
  root = new Map<string, string>();            // any session → the tab it belongs to
  frames = new Map<string, string[]>();        // tab → its iframe sessions
  evidence = new Map<string, Evidence>();      // tab → what we saw
  reqs = new Map<string, string>();
  async start() {
    const bin = CHROMES.find(p => p && fs.existsSync(p));
    if (!bin) throw new Error("no Chrome found (set CHROME_PATH)");
    const port = 9400 + Math.floor(Math.random() * 500);
    const prof = fs.mkdtempSync(path.join(require("os").tmpdir(), "arw-play-"));
    this.proc = spawn(bin, [process.env.HEADLESS_ARG || "--headless", `--remote-debugging-port=${port}`, `--user-data-dir=${prof}`, "--no-first-run", "--no-default-browser-check", "--autoplay-policy=no-user-gesture-required", "--mute-audio", "--window-size=1280,900", "--no-sandbox", "about:blank"], { stdio: "ignore" });
    for (let k = 0; k < 60; k++) { await sleep(500); try { await fetch(`http://127.0.0.1:${port}/json`); break; } catch {} }
    const ver: any = await (await fetch(`http://127.0.0.1:${port}/json/version`)).json();
    this.ws = new WebSocket(ver.webSocketDebuggerUrl);
    this.ws.onmessage = (e: any) => this.onMessage(JSON.parse(String(e.data)));
    await new Promise(r => (this.ws.onopen = r));
  }
  send(method: string, params: any = {}, sessionId?: string): Promise<any> {
    return new Promise(r => { const i = ++this.id; this.pend.set(i, r); this.ws.send(JSON.stringify({ id: i, method, params, ...(sessionId ? { sessionId } : {}) })); });
  }
  async onMessage(m: any) {
    if (m.id && this.pend.has(m.id)) { this.pend.get(m.id)!(m); this.pend.delete(m.id); return; }
    const tab = this.root.get(m.sessionId) || m.sessionId;
    const ev = tab ? this.evidence.get(tab) : undefined;
    if (m.method === "Target.attachedToTarget") {
      const sid = m.params.sessionId;
      this.root.set(sid, tab);
      if (m.params.targetInfo.type === "iframe") this.frames.get(tab)?.push(sid);
      await this.send("Network.enable", {}, sid); await this.send("Runtime.enable", {}, sid);
      await this.send("Target.setAutoAttach", { autoAttach: true, waitForDebuggerOnStart: false, flatten: true }, sid);
      await this.send("Runtime.runIfWaitingForDebugger", {}, sid);
      return;
    }
    if (!ev) return;
    if (m.method === "Network.requestWillBeSent") this.reqs.set(m.params.requestId, m.params.request.url);
    if (m.method === "Network.responseReceived") {
      const u = m.params.response.url, st = m.params.response.status;
      if (isMedia(u)) (st < 400 ? ev.mediaOk : ev.mediaFail).push(`${st} ${u.split("?")[0].slice(0, 120)}`);
    }
    if (m.method === "Network.loadingFailed") {
      const u = this.reqs.get(m.params.requestId) || "";
      if (isMedia(u) && m.params.errorText !== "net::ERR_ABORTED") ev.mediaFail.push(`${m.params.corsErrorStatus?.corsError || m.params.errorText} ${u.split("?")[0].slice(0, 120)}`);
    }
    if (m.method === "Runtime.consoleAPICalled") {
      const t = m.params.args.map((a: any) => a.value ?? "").join(" ");
      if (/JW Player Error \d+|MEDIA_ERR|Video\.js.*error|PLAYER_ERROR/i.test(t)) ev.playerErrors.push(t.replace(/\. For more information.*$/, "").slice(0, 120));
    }
  }
  /** Play one link inside the live page; returns what was seen. */
  async play(page: string, url: string, isOnPage: number): Promise<Evidence> {
    const { result: { targetId } } = await this.send("Target.createTarget", { url: "about:blank" });
    const { result: { sessionId } } = await this.send("Target.attachToTarget", { targetId, flatten: true });
    const ev: Evidence = { mediaOk: [], mediaFail: [], playerErrors: [], frameText: "", progressed: false };
    this.evidence.set(sessionId, ev); this.frames.set(sessionId, []); this.root.set(sessionId, sessionId);
    try {
      await this.send("Target.setAutoAttach", { autoAttach: true, waitForDebuggerOnStart: false, flatten: true }, sessionId);
      await this.send("Network.enable", {}, sessionId); await this.send("Runtime.enable", {}, sessionId); await this.send("Page.enable", {}, sessionId);
      await this.send("Page.navigate", { url: page }, sessionId);
      await sleep(5000);
      // the server's own button when the page shows it; a hidden (broken) link is put on the first button
      await this.send("Runtime.evaluate", { expression: `(()=>{const rows=[...document.querySelectorAll('.srv-row')]; const box=document.getElementById('videoEmbedBox');
        if(${isOnPage}>=0&&rows[${isOnPage}]){rows[${isOnPage}].click();return}
        if(rows[0]){rows[0].dataset.srv=${JSON.stringify(obfuscate(url))};rows[0].click();return}
        if(box){box.dataset.initSrv=${JSON.stringify(obfuscate(url))};document.getElementById('wdPoster').click()}})()` }, sessionId);
      await sleep(7000);
      // a real click in the middle of the player (some players ignore script clicks), then play muted
      const r = await this.send("Runtime.evaluate", { expression: `(()=>{const f=document.getElementById('videoFrame'); if(!f) return ''; f.scrollIntoView({block:'center'}); const b=f.getBoundingClientRect(); return JSON.stringify({x:b.left+b.width/2,y:b.top+b.height/2})})()`, returnByValue: true }, sessionId);
      if (r.result?.result?.value) {
        const { x, y } = JSON.parse(r.result.result.value);
        for (const type of ["mouseMoved", "mousePressed", "mouseReleased"]) await this.send("Input.dispatchMouseEvent", { type, x, y, button: "left", clickCount: 1 }, sessionId);
      }
      await sleep(2500);
      // JW players (vidtube, vidmoly…), OK.ru's own play button, else the page's <video>
      const PLAY = `(()=>{try{ if(window.jwplayer&&jwplayer().play){jwplayer().setMute(true);jwplayer().play();return} }catch(e){}
        const ok=document.querySelector('.vid_play,.one-video-player_display-w'); if(ok&&/ok\\.ru$/.test(location.host)){ok.click()}
        const v=document.querySelector('video'); if(v){v.muted=true; v.play().catch(()=>{})} })()`;
      for (const f of this.frames.get(sessionId) || []) await this.send("Runtime.evaluate", { expression: PLAY }, f);
      const STATE = `JSON.stringify({t:(document.body&&document.body.innerText||'').slice(0,400), v:(()=>{const v=document.querySelector('video'); return v?v.currentTime:0})()})`;
      const before: Record<string, number> = {};
      for (const f of this.frames.get(sessionId) || []) { const s = await this.send("Runtime.evaluate", { expression: STATE, returnByValue: true }, f); try { before[f] = JSON.parse(s.result.result.value).v; } catch {} }
      await sleep(9000);
      for (const f of this.frames.get(sessionId) || []) {
        const s = await this.send("Runtime.evaluate", { expression: STATE, returnByValue: true }, f);
        try { const o = JSON.parse(s.result.result.value); ev.frameText += " " + o.t; if (o.v > 0.5 && o.v > (before[f] || 0)) ev.progressed = true; } catch {}
      }
    } finally {
      await this.send("Target.closeTarget", { targetId });
      this.evidence.delete(sessionId);
    }
    return ev;
  }
  stop() { try { this.proc.kill(); } catch {} }
}

async function main() {
  const args = process.argv.slice(2);
  const pagesArg = args.flatMap((a, i) => (a === "--page" ? [args[i + 1]] : []));
  const days = Number(args[args.indexOf("--days") + 1]) || 7;
  let prev: State = { links: {}, broken: [] };
  try { prev = JSON.parse(fs.readFileSync(OUT, "utf-8")); } catch {}
  prev.links = prev.links || {};
  const pages = pagesArg.length ? pagesArg : await recentPages(days);
  const b = new Browser(); await b.start();
  const results: { url: string; page: string; status: string; reason: string }[] = [];
  try {
    const jobs: { page: string; url: string; index: number }[] = [];
    for (const page of pages) {
      const html = await (await fetch(page + `?t=${Date.now()}`, { signal: AbortSignal.timeout(60000) })).text().catch(() => "");
      const shown = pageServers(html);
      const hidden = Object.entries(prev.links).filter(([u, l]) => l.page === page && l.strikes >= 2 && !shown.includes(u)).map(([u]) => u);
      for (const url of [...shown, ...hidden]) jobs.push({ page, url, index: shown.indexOf(url) });
    }
    // a few players at once, each in its own tab
    const workers = Math.max(1, Number(args[args.indexOf("--parallel") + 1]) || 4);
    let next = 0;
    await Promise.all(Array.from({ length: workers }, async () => {
      while (next < jobs.length) {
        const { page, url, index } = jobs[next++];
        const ev = await b.play(page, url, index).catch((e: Error) => ({ mediaOk: [], mediaFail: [], playerErrors: [], frameText: `checker error ${e.message}`, progressed: false }));
        const c = classify(ev);
        results.push({ url, page, ...c });
        console.log(`[Play] ${c.status.padEnd(7)} ${decodeURI(page.replace(ORIGIN, ""))} ${url} — ${c.reason}`);
      }
    }));
  } finally { b.stop(); }
  const next = nextState(prev, results);
  const changed = JSON.stringify(prev.broken || []) !== JSON.stringify(next.broken)
    || results.some(r => (prev.links[r.url]?.strikes || 0) !== next.links[r.url].strikes);
  if (changed) fs.writeFileSync(OUT, JSON.stringify(next, null, 1) + "\n");
  const summary = [`# Playback check ${next.checkedAt}`, ``, `${results.length} links on ${pages.length} pages: ${results.filter(r => r.status === "ok").length} play, ${results.filter(r => r.status === "broken").length} broken, ${results.filter(r => r.status === "unknown").length} unknown`, ``, `Hidden from the site (broken twice in a row):`, ...(next.broken.length ? next.broken.map(u => `- ${u} on ${decodeURI(next.links[u].page.replace(ORIGIN, ""))} — ${next.links[u].reason}`) : ["- none"])].join("\n");
  console.log("\n" + summary);
  if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, summary + "\n");
}

if (require.main === module) main().catch(e => { console.error("[Play]", e.message); process.exit(1); });
