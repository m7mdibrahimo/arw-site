// Writes lib/first-commit.json: for every page under content/ that reached the repo MORE than 30 minutes after its own
// `date` (and carries no published_at / created_at stamp), the time of its first git commit — when it really went up.
// lib/page-dates.cjs reads it for datePublished and the other head dates (INCIDENTS #1257).
// Needs the full history (not a shallow clone). Run it again by hand any time: node scripts/first-commit-map.mjs
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const git = (...a) => execFileSync("git", ["-c", "core.quotepath=off", ...a], { cwd: ROOT, encoding: "utf8", maxBuffer: 1 << 28 });

// The oldest commit reachable must be the repo's real first commit, not a shallow clone's cut-off point.
const [rootSha, rootAt] = git("log", "--reverse", "--format=%H %cI").split("\n")[0].split(" ");
const shallowFile = path.resolve(ROOT, git("rev-parse", "--git-path", "shallow").trim());
if (fs.existsSync(shallowFile) && fs.readFileSync(shallowFile, "utf8").includes(rootSha)) {
  console.error("shallow clone: the first commit of a file is unknown here — run it in a full clone");
  process.exit(1);
}
// Pages added on the repo's first day were moved in from the old site: their commit is not when they went up.
const firstDay = rootAt.slice(0, 10);

const added = {};
let at = "";
for (const line of git("log", "--diff-filter=A", "--name-only", "--format=@@%cI", "--", "content/").split("\n")) {
  if (line.startsWith("@@")) at = line.slice(2);
  else if (line.endsWith(".md")) added[line] = at; // newest first: the last one seen is the first add
}

const field = (fm, k) => ((fm.match(new RegExp(`^${k}:[ \\t]*(.*)$`, "m")) || [])[1] || "").trim().replace(/^(["'])(.*)\1$/, "$2");
const out = {};
for (const [file, when] of Object.entries(added).sort()) {
  const abs = path.join(ROOT, file);
  if (!fs.existsSync(abs) || when.slice(0, 10) <= firstDay) continue;
  const fm = (fs.readFileSync(abs, "utf8").match(/^---\r?\n([\s\S]*?)\r?\n---/) || [])[1] || "";
  if (field(fm, "published_at") || field(fm, "created_at")) continue;
  const date = Date.parse(field(fm, "date"));
  const commit = Date.parse(when);
  if (Number.isFinite(date) && commit - date > 30 * 60_000) out[file] = new Date(commit).toISOString();
}
fs.writeFileSync(path.join(ROOT, "lib/first-commit.json"), JSON.stringify(out, null, 1) + "\n");
console.log(`lib/first-commit.json: ${Object.keys(out).length} pages`);
