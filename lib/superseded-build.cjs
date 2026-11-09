// A Cloudflare build of the «site» branch stops itself the moment «site» points at a newer commit (INCIDENTS #1183).
//
// The site's build takes 4-5 minutes on Cloudflare and the bots' news kept it busy nearly all the time, so a show saved
// from the panel waited for the bots' build to finish and then for its own: 5 to 10 minutes before it was on the site.
// Now a panel save moves «site» at once (.github/workflows/site-branch.yml), and the build that was running checks every
// few seconds whether it is still the newest: when it is not, it ends as a failed build, so Cloudflare never deploys the
// older version and starts on the newest one (whatever the running one had is in the newer one too: «site» is always
// the latest main). A last check right before the build ends means an older version never overwrites a newer one.
//
// Only a build of a «site» commit (its message carries «site-of: <main commit>») is watched; a local build, a test
// or a build of main never is. When GitHub can't be asked (no network, no git), the build simply goes on.
const { execFile, execFileSync } = require("child_process");

const PUBLIC_REPO = "https://github.com/m7mdibrahimo/arw-site.git";
const SHA = /^[0-9a-f]{40}$/;

function git(args) {
  try { return execFileSync("git", args, { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], timeout: 20000 }).trim(); } catch { return ""; }
}

/** This build's own «site» commit, or "" when this is not a build of the «site» branch. */
function ownSiteCommit(read = git) {
  if (!/^site-of: [0-9a-f]{40}\b/m.test(read(["log", "-1", "--format=%B"]))) return "";
  const head = read(["rev-parse", "HEAD"]);
  return SHA.test(head) ? head : "";
}

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

/** true when «site» on GitHub is a different commit than this build's: a newer version is waiting to be built. */
const superseded = (mine, now) => Boolean(mine && SHA.test(now) && now !== mine);

function stop(mine, now) {
  console.log(`[superseded] «site» moved to ${now.slice(0, 10)} while ${mine.slice(0, 10)} was building: this build stops so Cloudflare builds the newer version (it has everything this one had)`);
  process.exit(75);
}

/** Checks every `everyMs` (between the build's busy stretches) and stops the build when it is no longer the newest. */
function watch(everyMs = 10000) {
  const mine = ownSiteCommit();
  if (!mine) return null;
  console.log(`[superseded] watching «site» while ${mine.slice(0, 10)} builds`);
  let busy = false;
  const t = setInterval(() => {
    if (busy) return;
    busy = true;
    remoteSite((now) => { busy = false; if (superseded(mine, now)) stop(mine, now); });
  }, everyMs);
  t.unref();
  return mine;
}

/** The last check, right before the build ends and Cloudflare deploys it. */
function finalCheck() {
  const mine = ownSiteCommit();
  if (!mine) return;
  const now = remoteSiteSync();
  if (superseded(mine, now)) stop(mine, now);
}

module.exports = { watch, finalCheck, ownSiteCommit, parseLsRemote, superseded };
