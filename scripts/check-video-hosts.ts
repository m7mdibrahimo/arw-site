// Which watch-server hosts still play inside the site. For every host used in a show, recap or
// nostalgia episode, one recent embed link is opened:
//   - no DNS / no connection twice in a row → «dead» (turbovidhls.com, Oct 2026: 180 dead tabs)
//   - X-Frame-Options DENY/SAMEORIGIN or a frame-ancestors that excludes us → «noEmbed»
// The site hides those hosts' server tabs (lib/embed.cjs playableServers); the show files keep the
// links, so a host that comes back is shown again on the next run (INCIDENTS #276).
//   npx tsx scripts/check-video-hosts.ts
import fs from "fs";
import path from "path";
const { toEmbedUrl, hostOf } = require("../lib/embed.cjs");

const OUT = path.join(process.cwd(), "_data", "videoHosts.json");
const DIRS = ["content/shows", "content/recaps", "content/nostalgia"];
const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126 Safari/537.36";

/** One recent embed link per host (newest files first). */
export function samplePerHost(root = process.cwd()): Map<string, string[]> {
  const out = new Map<string, string[]>();
  for (const dir of DIRS) {
    const abs = path.join(root, dir);
    if (!fs.existsSync(abs)) continue;
    for (const f of fs.readdirSync(abs).filter(x => x.endsWith(".md")).sort().reverse()) {
      const text = fs.readFileSync(path.join(abs, f), "utf-8");
      for (const m of text.matchAll(/^\s*-\s*url:\s*(\S+)/gm)) {
        const embed = toEmbedUrl(m[1]);
        const host = hostOf(embed);
        if (!host) continue;
        const list = out.get(host) || [];
        if (list.length < 2) list.push(embed);
        out.set(host, list);
      }
    }
  }
  return out;
}

/** Frame headers that keep the page out of another site's iframe. */
export function refusesEmbedding(xfo: string, csp: string): boolean {
  if (/\b(deny|sameorigin)\b/i.test(xfo || "") && !/allowall/i.test(xfo || "")) return true;
  const fa = (csp || "").match(/frame-ancestors([^;]*)/i);
  if (fa && !/\*|arab-wrestling\.com/i.test(fa[1])) return true;
  return false;
}

async function probe(url: string): Promise<"ok" | "dead" | "noEmbed"> {
  try {
    const res = await fetch(url, { redirect: "follow", headers: { "User-Agent": UA, Referer: "https://arab-wrestling.com/" }, signal: AbortSignal.timeout(25000) });
    await res.arrayBuffer().catch(() => null);
    // A bot challenge (Cloudflare) answers our script, not a viewer's browser: it says nothing about the host
    if (res.headers.get("cf-mitigated") === "challenge" || (res.status === 403 && /cloudflare/i.test(res.headers.get("server") || ""))) return "ok";
    if (refusesEmbedding(res.headers.get("x-frame-options") || "", res.headers.get("content-security-policy") || "")) return "noEmbed";
    return "ok"; // a 403/404 on one link is that file, not the host
  } catch {
    return "dead";
  }
}

async function main() {
  let prev: any = {};
  try { prev = JSON.parse(fs.readFileSync(OUT, "utf-8")); } catch {}
  const strikes: Record<string, number> = prev.strikes || {};
  const dead: string[] = [], noEmbed: string[] = [];
  for (const [host, urls] of samplePerHost()) {
    const results = [];
    for (const u of urls) results.push(await probe(u));
    if (results.every(r => r === "dead")) strikes[host] = (strikes[host] || 0) + 1; else delete strikes[host];
    if ((strikes[host] || 0) >= 2) dead.push(host);
    if (results.includes("noEmbed")) noEmbed.push(host);
    console.log(`[Hosts] ${host}: ${results.join(", ")}${strikes[host] ? ` (strike ${strikes[host]})` : ""}`);
  }
  const next = { checkedAt: new Date().toISOString(), dead: dead.sort(), noEmbed: noEmbed.sort(), strikes };
  const changed = JSON.stringify([prev.dead, prev.noEmbed, prev.strikes]) !== JSON.stringify([next.dead, next.noEmbed, next.strikes]);
  if (changed) fs.writeFileSync(OUT, JSON.stringify(next, null, 2) + "\n");
  console.log(`[Hosts] dead: ${dead.join(", ") || "none"} — noEmbed: ${noEmbed.join(", ") || "none"}${changed ? "" : " (unchanged)"}`);
}

if (require.main === module) main().catch(e => { console.error("[Hosts]", e.message); process.exit(1); });
