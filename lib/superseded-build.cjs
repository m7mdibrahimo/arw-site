// A Cloudflare build of the «site» branch skips itself only when that can never leave the site behind
// (INCIDENTS #1183, #1285).
//
// #1183 made a panel save move «site» at once, and the build that was running stopped itself the moment «site» moved.
// On a busy night that starved the site: the bots' news and the owner's saves moved «site» every 2-3 minutes, a build
// takes 3-5, so every build was stopped by the next one and nothing went out for 23 minutes while the owner added five
// shows (#1285). Each stopped build also counted as «done» for the bots' wait in site-branch.yml, so the bots' next
// batch went out right away and stopped the following build too.
//
// Now a build goes on and deploys unless one of these holds:
//   - at its start, «site» has already moved on AND the live site is at most START_SLACK seconds older than this
//     version: the newer build has everything this one has and the site is barely behind, so this one steps aside;
//   - at any point (and at its very end), the live site is already NEWER than this version: going out would put an
//     older version over a newer one.
// Whatever can't be read (GitHub, the live build.json) never stops a build: going out is always the safe side.
//
// Only a build of a «site» commit (its message carries «site-of: <main commit> <time>») is checked; a local build, a
// test or a build of main never is.
const { execFile, execFileSync } = require("child_process");

const PUBLIC_REPO = "https://github.com/m7mdibrahimo/arw-site.git";
const LIVE = "https://arab-wrestling.com/build.json";
const SHA = /^[0-9a-f]{40}$/;
const START_SLACK = 240;

function git(args) {
  try { return execFileSync("git", args, { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], timeout: 20000 }).trim(); } catch { return ""; }
}

/** This build's own «site» commit and the time of the main commit it carries, or null when this is not a «site» build. */
function ownSite(read = git) {
  const m = read(["log", "-1", "--format=%B"]).match(/^site-of: [0-9a-f]{40}(?: (\d+))?\b/m);
  if (!m) return null;
  const sha = read(["rev-parse", "HEAD"]);
  return SHA.test(sha) ? { sha, time: Number(m[1]) || 0 } : null;
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

/** The time of the main commit the live site was built from (0 when it can't be read). */
function parseLive(body) {
  try { return Number(JSON.parse(String(body || "")).commitTime) || 0; } catch { return 0; }
}
function liveTimeSync() {
  try {
    return parseLive(execFileSync("curl", ["-fsS", "--max-time", "15", "-H", "Cache-Control: no-cache", `${LIVE}?b=${Date.now()}`], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], timeout: 20000 }));
  } catch { return 0; }
}
function liveTime(cb) {
  execFile("curl", ["-fsS", "--max-time", "15", "-H", "Cache-Control: no-cache", `${LIVE}?b=${Date.now()}`], { encoding: "utf8", timeout: 20000 }, (err, out) => cb(err ? 0 : parseLive(out)));
}

/** true when «site» on GitHub is a different commit than this build's. */
const superseded = (mine, now) => Boolean(mine && SHA.test(now) && now !== mine);

/**
 * Whether this build stops. `phase` is "start" (before any page is made) or "run"/"end".
 * mine = {sha, time}; siteNow = «site» on GitHub ("" unknown); live = commit time of the live site (0 unknown).
 * Returns "" to go on, or the reason to stop.
 */
function decide(phase, mine, siteNow, live) {
  if (!mine || !mine.time || !live) return "";
  if (live > mine.time) return "the live site already has a newer version";
  if (phase === "start" && superseded(mine.sha, siteNow) && mine.time - live <= START_SLACK) {
    return "«site» moved on and the live site is less than 4 minutes behind this version";
  }
  return "";
}

function stop(mine, why) {
  console.log(`[superseded] ${mine.sha.slice(0, 10)} stops: ${why}`);
  process.exit(75);
}

/** Checks once at the start, then every `everyMs` only for a newer live version. */
function watch(everyMs = 15000) {
  const mine = ownSite();
  if (!mine) return null;
  const why = decide("start", mine, remoteSiteSync(), liveTimeSync());
  if (why) stop(mine, why);
  console.log(`[superseded] ${mine.sha.slice(0, 10)} builds and goes out unless a newer version is already live`);
  let busy = false;
  const t = setInterval(() => {
    if (busy) return;
    busy = true;
    liveTime((live) => { busy = false; const w = decide("run", mine, "", live); if (w) stop(mine, w); });
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

module.exports = { watch, finalCheck, ownSite, ownSiteCommit, parseLsRemote, parseLive, superseded, decide, START_SLACK };
