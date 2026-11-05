import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
const { charsetFirst } = createRequire(import.meta.url)("../lib/charset-first.cjs");

test("«<meta charset>» moves to the start of <head> (browsers look only in the first 1024 bytes)", () => {
  const page = `<!DOCTYPE html><html lang="ar"><head><script>${"x".repeat(3000)}</script>\n<meta charset="UTF-8">\n<title>ع</title></head><body>✓ شاهدته</body></html>`;
  const out = charsetFirst(page);
  assert.ok(out.indexOf('<meta charset="UTF-8">') < 1024);
  assert.equal(out.match(/<meta charset/gi)!.length, 1);
  assert.ok(out.includes("<head><meta charset=\"UTF-8\"><script>"));
  assert.equal(charsetFirst(out), out);
  assert.equal(charsetFirst("<p>no head</p>"), "<p>no head</p>");
  // a page that had none gets one
  assert.ok(charsetFirst("<html><head><title>t</title></head></html>").startsWith('<html><head><meta charset="UTF-8"><title>'));
});
