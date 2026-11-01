import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pruneRedirectStubs } from "../lib/redirects.cjs";

const stub = '<!doctype html><html><head><link rel="canonical" href="/x/"><meta name="robots" content="noindex"><meta http-equiv="refresh" content="0;url=/x/"></head></html>';

test("over the file budget the oldest «/content/news» redirect pages go first and real pages stay (INCIDENTS #1004)", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "prune-"));
  for (const n of ["2026-08-05-a", "2026-08-06-b", "2026-09-01-c"]) {
    fs.mkdirSync(path.join(dir, "content/news", n), { recursive: true });
    fs.writeFileSync(path.join(dir, "content/news", n, "index.html"), stub);
  }
  fs.mkdirSync(path.join(dir, "content/news/real"), { recursive: true });
  fs.writeFileSync(path.join(dir, "content/news/real/index.html"), "<html>" + "x".repeat(5000) + "</html>");
  assert.equal(pruneRedirectStubs(dir, 100, 100), 0);
  assert.equal(pruneRedirectStubs(dir, 102, 100), 2);
  assert.ok(!fs.existsSync(path.join(dir, "content/news/2026-08-05-a")));
  assert.ok(!fs.existsSync(path.join(dir, "content/news/2026-08-06-b")));
  assert.ok(fs.existsSync(path.join(dir, "content/news/2026-09-01-c/index.html")));
  assert.ok(fs.existsSync(path.join(dir, "content/news/real/index.html")));
  assert.equal(pruneRedirectStubs(dir, 150, 100), 1); // only one stub left; the real page is never touched
});
