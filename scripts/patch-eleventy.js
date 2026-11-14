const fs = require('fs');
const path = require('path');

const cmdPath = process.argv[2] || path.join(__dirname, '..', 'node_modules', '@11ty', 'eleventy', 'cmd.cjs'); // (argv[2]: a copy to patch, for the tests)

// Eleventy runs in a child process with a bigger stack and heap. The child used to be reported as «exit 0» when it was
// KILLED (out of memory gives no exit code, only a signal): `res.status ?? 0` made Cloudflare deploy a half-written
// _site as a success — no news, show or English pages, no build.json — for an hour (INCIDENTS #489). A killed child is
// now a failed build, so the last good deployment stays live and the failure is visible.
// The heap went from 6 GB to 7 GB when the build crossed 6 GB (INCIDENTS #1301: every Cloudflare and GitHub build died
// «JavaScript heap out of memory» at ~5.7 GB and the site stayed 50+ minutes on one version). Cloudflare's build
// machine has 8 GB. An older patch (any heap) is cut out and replaced, also in a cached node_modules.
const PATCH = `if (process.env.INCREASED_STACK !== "1") {
  const cp = require("child_process");
  const res = cp.spawnSync(process.execPath, ["--stack-size=4096", "--max-old-space-size=7168", ...process.argv.slice(1)], {
    stdio: "inherit",
    env: { ...process.env, INCREASED_STACK: "1" }
  });
  if (res.error || res.signal || typeof res.status !== "number") {
    console.error("[eleventy] the build process was killed (" + (res.signal || (res.error && res.error.message) || "no exit code") + ") - probably out of memory");
    process.exit(1);
  }
  process.exit(res.status);
}
`;
const START = 'if (process.env.INCREASED_STACK !== "1") {';

if (fs.existsSync(cmdPath)) {
  let content = fs.readFileSync(cmdPath, 'utf8');
  if (content.includes(PATCH)) {
    // already the current patch
  } else {
    // an older patch (it exits 0 for a killed child, or a smaller heap) is cut out and replaced
    const at = content.indexOf(START);
    if (at !== -1) {
      for (const tail of ['process.exit(res.status ?? 0);\n}\n', 'process.exit(res.status);\n}\n']) {
        const end = content.indexOf(tail, at);
        if (end !== -1) { content = content.slice(0, at) + content.slice(end + tail.length); break; }
      }
    }
    if (content.startsWith('#!/usr/bin/env node')) {
      const idx = content.indexOf('\n');
      content = content.slice(0, idx + 1) + PATCH + content.slice(idx + 1);
    } else {
      content = PATCH + content;
    }
    fs.writeFileSync(cmdPath, content, 'utf8');
    console.log('[patch-eleventy] Successfully patched @11ty/eleventy/cmd.cjs for --stack-size=4096 and a failing exit when the build is killed');
  }
}
