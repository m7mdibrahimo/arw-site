// INCIDENTS #1474: «Playback Check» died with a bare «fetch failed» because Chrome took more than 30 s to open its port.
import { test } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { waitForDevtools, CHROME_START_TRIES } from "../scripts/check-playback.ts";

test("a slow Chrome gets up to 60 s to open its debugging port", () => {
  assert.ok(CHROME_START_TRIES * 500 >= 60000);
});

test("waitForDevtools returns null instead of throwing when nothing listens", async () => {
  assert.equal(await waitForDevtools(9, 2, 10), null);
});

test("waitForDevtools returns the version once the port answers", async () => {
  const srv = http.createServer((_q, r) => { r.setHeader("content-type", "application/json"); r.end('{"webSocketDebuggerUrl":"ws://x"}'); });
  await new Promise<void>(r => srv.listen(0, "127.0.0.1", () => r()));
  const port = (srv.address() as any).port;
  const v = await waitForDevtools(port, 5, 10);
  srv.close();
  assert.equal(v.webSocketDebuggerUrl, "ws://x");
});
