const fs = require('fs');
const path = require('path');

const cmdPath = path.join(__dirname, '..', 'node_modules', '@11ty', 'eleventy', 'cmd.js');

if (fs.existsSync(cmdPath)) {
  let content = fs.readFileSync(cmdPath, 'utf8');
  if (!content.includes('INCREASED_STACK')) {
    const patch = `if (process.env.INCREASED_STACK !== "1") {
  const cp = require("child_process");
  const res = cp.spawnSync(process.execPath, ["--stack-size=4096", ...process.argv.slice(1)], {
    stdio: "inherit",
    env: { ...process.env, INCREASED_STACK: "1" }
  });
  process.exit(res.status ?? 0);
}
`;
    if (content.startsWith('#!/usr/bin/env node')) {
      const idx = content.indexOf('\n');
      content = content.slice(0, idx + 1) + patch + content.slice(idx + 1);
    } else {
      content = patch + content;
    }
    fs.writeFileSync(cmdPath, content, 'utf8');
    console.log('[patch-eleventy] Successfully patched @11ty/eleventy/cmd.js for --stack-size=4096');
  }
}
