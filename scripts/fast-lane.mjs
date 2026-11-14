// «النشر السريع» (INCIDENTS #1296), the two GitHub steps around the render (.github/workflows/fast-lane.yml):
//   node scripts/fast-lane.mjs plan  → which saved pages to render: every show/story changed since the live build
//   node scripts/fast-lane.mjs send  → the rendered pages to arw-site-bot (worker/src/fast-lane.ts), signed by GitHub
// A page whose scripts or styles the live deployment doesn't have yet (they changed in the same push) is not sent:
// it waits for the full build like before, never a page with a missing style.
import fs from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";

const SITE = process.env.ARW_LIVE_ORIGIN || "https://arab-wrestling.com";
const BOT = process.env.ARW_BOT_ORIGIN || "https://arw-site-bot.m7mdibrahimpc.workers.dev";
const AUDIENCE = "arw-fast-lane";
const MAX_INPUTS = 30;
const CONTENT = /^content\/(shows|news)\/[^/]+\.md$/;

const t0 = Date.now();
const log = (...a) => console.log(`[fast-lane +${((Date.now() - t0) / 1000).toFixed(1)}s]`, ...a);
const git = (cmd) => execSync(`git ${cmd}`, { encoding: "utf8" }).trim();
const out = (k, v) => { if (process.env.GITHUB_OUTPUT) fs.appendFileSync(process.env.GITHUB_OUTPUT, `${k}<<__EOF__\n${v}\n__EOF__\n`); };

async function liveBuild() {
  const r = await fetch(`${SITE}/build.json?fl=${Date.now()}`, { headers: { "Cache-Control": "no-cache" } });
  return r.ok ? r.json() : null;
}

/** The changed show/story files in a push event (added or modified, still there) */
export function eventFiles(event) {
  const files = [];
  for (const c of (event && event.commits) || []) for (const f of [...(c.added || []), ...(c.modified || [])]) files.push(f);
  for (const c of (event && event.commits) || []) for (const f of c.removed || []) { const i = files.indexOf(f); if (i > -1) files.splice(i, 1); }
  return files;
}

/** Which inputs to render: the newest first, only show/story files that exist, at most MAX_INPUTS */
export function pickInputs(lists, exists = (f) => fs.existsSync(f), max = MAX_INPUTS) {
  const seen = new Set(), picked = [];
  for (const list of lists) for (const f of list) {
    if (!CONTENT.test(f) || seen.has(f)) continue;
    seen.add(f);
    if (exists(f)) picked.push(f);
  }
  return picked.slice(0, max);
}

async function plan() {
  const sha = git("rev-parse HEAD"), at = Number(git("log -1 --format=%ct HEAD"));
  const live = await liveBuild().catch(() => null);
  if (live && ((live.recent || []).includes(sha) || Number(live.commitTime) >= at)) {
    log(`the live site already has ${sha.slice(0, 7)}: nothing to do`);
    out("skip", "1");
    return;
  }
  let event = null;
  try { event = JSON.parse(fs.readFileSync(process.env.GITHUB_EVENT_PATH || "", "utf8")); } catch {}
  const fromEvent = eventFiles(event);
  // everything changed since the live build, so a run that replaced a cancelled one still carries its pages
  let sinceLive = [];
  if (live && live.commit && process.env.GITHUB_REPOSITORY) {
    try {
      const r = await fetch(`https://api.github.com/repos/${process.env.GITHUB_REPOSITORY}/compare/${live.commit}...${sha}`, { headers: { Accept: "application/vnd.github+json", ...(process.env.GH_TOKEN ? { Authorization: `Bearer ${process.env.GH_TOKEN}` } : {}) } });
      if (r.ok) sinceLive = ((await r.json()).files || []).filter((f) => f.status !== "removed").map((f) => f.filename).reverse();
      else log(`compare ${r.status}: the push's own files only`);
    } catch (e) { log(`compare failed (${e.message}): the push's own files only`); }
  }
  const inputs = pickInputs([fromEvent, sinceLive]);
  log(`live ${live ? String(live.commit).slice(0, 7) : "?"}, this ${sha.slice(0, 7)}: ${inputs.length} pages to render`, inputs);
  // after a news bot's run with no new story (bookkeeping only): nothing to show sooner. A push always renders, a
  // deletion too (the listings without it).
  if (!inputs.length && process.env.GITHUB_EVENT_NAME === "workflow_run") { log("a bot run with no new show or story"); out("skip", "1"); return; }
  out("skip", "0");
  out("inputs", inputs.join(","));
}

const HASHED = /(?:src|href)=["'](\/(?:en\/)?assets\/[^"'?#\s]+?\.[0-9a-f]{10}\.(?:css|js))["']/g;
/** The content-named scripts and styles a page links to (lib/asset-names.cjs) */
export function hashedAssets(html) {
  return [...new Set([...String(html).matchAll(HASHED)].map((m) => m[1]))];
}

async function oidcToken() {
  const url = process.env.ACTIONS_ID_TOKEN_REQUEST_URL, bearer = process.env.ACTIONS_ID_TOKEN_REQUEST_TOKEN;
  if (!url || !bearer) throw new Error("no OIDC token (the workflow needs permissions: id-token: write)");
  const r = await fetch(`${url}&audience=${AUDIENCE}`, { headers: { Authorization: `bearer ${bearer}` } });
  if (!r.ok) throw new Error(`OIDC ${r.status}`);
  return (await r.json()).value;
}

async function send() {
  const site = "_site";
  const manifest = JSON.parse(fs.readFileSync(path.join(site, "fast-lane.json"), "utf8"));
  const live = await liveBuild().catch(() => null);
  const at = Number(git("log -1 --format=%ct HEAD"));
  if (live && Number(live.commitTime) >= at) { log("the full build is already live: nothing to send"); return; }
  const pages = manifest.pages.map((p) => ({ url: p.url, input: p.input, html: fs.readFileSync(path.join(site, p.file), "utf8") }));
  const assets = [...new Set(pages.flatMap((p) => hashedAssets(p.html)))];
  const have = new Map(await Promise.all(assets.map(async (a) => [a, await fetch(SITE + a, { method: "HEAD" }).then((r) => r.ok).catch(() => false)])));
  const ready = pages.filter((p) => {
    const missing = hashedAssets(p.html).filter((a) => !have.get(a));
    if (missing.length) log(`${p.url}: waits for the full build, the live site has no ${missing.join(", ")}`);
    return !missing.length;
  });
  if (!ready.length) { log("nothing to send"); return; }
  const token = await oidcToken();
  const r = await fetch(`${BOT}/fast-lane/pages`, { method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: JSON.stringify({ commitTime: at, pages: ready }) });
  const body = await r.text();
  log(`sent ${ready.length} pages (${Math.round(ready.reduce((n, p) => n + p.html.length, 0) / 1024)} KB): ${r.status} ${body.slice(0, 300)}`, ready.map((p) => p.url));
  if (!r.ok) process.exit(1);
}

const cmd = process.argv[2];
if (cmd === "plan") await plan();
else if (cmd === "send") await send();
