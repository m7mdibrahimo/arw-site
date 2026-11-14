// When a Cloudflare build of the «site» branch steps aside (INCIDENTS #1183, #1285, #1286).
//
// Cloudflare builds one «site» version at a time; each takes 3-5 minutes, sometimes 9. Three rules keep a show saved
// from the panel quick to appear without ever leaving the site behind:
//
//   1. A build never deploys over a NEWER live version (the live /build.json says which main commit is out).
//   2. A queued build that starts after «site» already moved on steps aside: the newer one right behind it has
//      everything it has. Unless the live site is more than START_SLACK behind it: then it builds (no starvation).
//   3. Mid-build, a build of the bots' news only steps aside for a save from the panel or a device («panel-save: yes»
//      on the newer «site» commit, written by site-branch.yml): the save's build carries the news too, and the save
//      no longer waits for the news build to finish first (#1286: SmackDown waited 9.6 minutes). A build that
//      carries a save is never stopped mid-build, so saves can't stop each other and nothing starves (#1285: stopping
//      every build whenever «site» moved left the site 23 minutes behind on a busy night).
//
// Whatever can't be read (GitHub, the live build.json) never stops a build: going out is always the safe side.
// Only a build of a «site» commit (its message carries «site-of: <main commit> <time>») is checked; a local build, a
// test or a build of main never is.
const { execFile, execFileSync } = require("child_process");

const PUBLIC_REPO = "https://github.com/m7mdibrahimo/arw-site.git";
const LIVE = "https://arab-wrestling.com/build.json";
const SHA = /^[0-9a-f]{40}$/;
const START_SLACK = 480;
const PANEL = /^panel-save: yes$/m;

function git(args) {
  try { return execFileSync("git", args, { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], timeout: 20000 }).trim(); } catch { return ""; }
}

/** What a «site» commit message says: the main commit's time and whether it carries a save from the panel. */
function parseSiteMessage(msg) {
  const m = String(msg || "").match(/^site-of: [0-9a-f]{40}(?: (\d+))?\b/m);
  return m ? { time: Number(m[1]) || 0, panel: PANEL.test(msg) } : null;
}

/** This build's own «site» commit: {sha, time, panel}, or null when this is not a «site» build. */
function ownSite(read = git) {
  const info = parseSiteMessage(read(["log", "-1", "--format=%B"]));
  if (!info) return null;
  const sha = read(["rev-parse", "HEAD"]);
  return SHA.test(sha) ? { sha, ...info } : null;
}
/** Kept for older callers and tests: the «site» commit alone. */
const ownSiteCommit = (read = git) => (ownSite(read) || { sha: "" }).sha;

/** The commit «site» points at on GitHub now ("" when it can't be read). */
function parseLsRemote(out) {
  const m = String(out || "").match(/^([0-9a-f]{40})\s+refs\/heads\/site$/m);
  return m ? m[1] : "";
}
function remoteSiteSync() {
  for (const remote of ["origin", PUBLIC_REPO]) {
    const sha = parseLsRemote(git(["ls-remote", remote, "refs/heads/site"]));
    if (sha) return sha;
  }
  return "";
}
function remoteSite(cb) {
  const tryRemote = (i) => {
    const remote = ["origin", PUBLIC_REPO][i];
    if (!remote) return cb("");
    execFile("git", ["ls-remote", remote, "refs/heads/site"], { encoding: "utf8", timeout: 20000 }, (err, out) => {
      const sha = err ? "" : parseLsRemote(out);
      sha ? cb(sha) : tryRemote(i + 1);
    });
  };
  tryRemote(0);
}
/** Whether another «site» commit carries a save from the panel (false when it can't be read). Fetches that one commit
 *  object only, without its files (under a second; with them it took 20). */
function carriesPanelSave(sha) {
  for (const remote of ["origin", PUBLIC_REPO]) {
    git(["fetch", "-q", "--depth=1", "--filter=tree:0", "--no-tags", remote, sha]);
    if (git(["cat-file", "-t", sha]) !== "commit") continue;
    const info = parseSiteMessage(git(["log", "-1", "--format=%B", sha]));
    if (info) return info.panel;
  }
  return false;
}

/** The time of the main commit the live site was built from (0 when it can't be read). */
function parseLive(body) {
  try { return Number(JSON.parse(String(body || "")).commitTime) || 0; } catch { return 0; }
}
const CURL = () => ["-fsS", "--max-time", "15", "-H", "Cache-Control: no-cache", `${LIVE}?b=${Date.now()}`];
function liveTimeSync() {
  try { return parseLive(execFileSync("curl", CURL(), { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], timeout: 20000 })); } catch { return 0; }
}
function liveTime(cb) {
  execFile("curl", CURL(), { encoding: "utf8", timeout: 20000 }, (err, out) => cb(err ? 0 : parseLive(out)));
}

/** true when «site» on GitHub is a different commit than this build's. */
const superseded = (mine, now) => Boolean(mine && SHA.test(now) && now !== mine);

/**
 * Whether this build stops: "" to go on, or the reason. phase: "start" (before any page is made), "run" or "end".
 * mine = {sha, time, panel}; siteNow = «site» on GitHub ("" unknown); live = commit time of the live site (0 unknown);
 * newerPanel = the newer «site» commit carries a save from the panel.
 */
function decide(phase, mine, siteNow, live, newerPanel = false) {
  if (!mine || !mine.time) return "";
  if (live && live > mine.time) return "the live site already has a newer version";
  if (!superseded(mine.sha, siteNow)) return "";
  if (phase === "start" && live && mine.time - live <= START_SLACK) {
    return `«site» moved on and the live site is under ${START_SLACK / 60} minutes behind this version`;
  }
  if (phase === "run" && newerPanel && !mine.panel) {
    return "a save from the panel is waiting and its build has all of this one too";
  }
  return "";
}

function stop(mine, why) {
  console.log(`[superseded] ${mine.sha.slice(0, 10)} stops: ${why}`);
  process.exit(75);
}

/** Decides once at the start, then every `everyMs` while the build runs. */
function watch(everyMs = 10000) {
  const mine = ownSite();
  if (!mine) return null;
  const why = decide("start", mine, remoteSiteSync(), liveTimeSync());
  if (why) stop(mine, why);
  console.log(`[superseded] ${mine.sha.slice(0, 10)} builds${mine.panel ? " (a save from the panel: never stopped mid-build)" : ""}`);
  const panelOf = new Map();
  let busy = false;
  const t = setInterval(() => {
    if (busy) return;
    busy = true;
    remoteSite((now) => {
      if (superseded(mine.sha, now) && !panelOf.has(now)) panelOf.set(now, mine.panel ? false : carriesPanelSave(now));
      liveTime((live) => {
        busy = false;
        const w = decide("run", mine, now, live, panelOf.get(now) || false);
        if (w) stop(mine, w);
      });
    });
  }, everyMs);
  t.unref();
  return mine.sha;
}

/** The last check, right before the build ends and Cloudflare deploys it. */
function finalCheck() {
  const mine = ownSite();
  if (!mine) return;
  const why = decide("end", mine, "", liveTimeSync());
  if (why) stop(mine, why);
}

module.exports = { watch, finalCheck, ownSite, ownSiteCommit, parseSiteMessage, parseLsRemote, parseLive, superseded, decide, START_SLACK };
