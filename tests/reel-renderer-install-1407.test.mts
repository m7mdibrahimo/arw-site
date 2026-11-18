// INCIDENTS #1407: every reel render failed from 2026-11-17 22:37 UTC because onnxruntime-node (a dependency of
// the hyperframes video renderer) downloads an extra CUDA build from a GitHub release in its postinstall, and that
// release (v1.21.1) was removed (404). The runners have no GPU, so the CUDA build is never used. Any workflow that
// installs the renderer must skip that download, or one missing upstream file stops every reel again.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";

const dir = ".github/workflows";
const withRenderer = readdirSync(dir)
  .filter((f) => /\.ya?ml$/.test(f))
  .map((f) => ({ f, text: readFileSync(`${dir}/${f}`, "utf-8") }))
  .filter(({ text }) => /npm (install|i|ci)\b[^\n]*hyperframes@/.test(text));

test("the reel workflows still install the renderer (the test is not looking at nothing)", () => {
  const names = withRenderer.map(({ f }) => f).sort();
  assert.ok(names.includes("auto-show-reel.yml"), names.join(", "));
  assert.ok(names.includes("generate-reel.yml"), names.join(", "));
});

test("every step that installs the renderer skips onnxruntime's CUDA download", () => {
  for (const { f, text } of withRenderer) {
    // split into steps; check the step whose command installs hyperframes
    const steps = text.split(/\n(?=\s*- name:)/);
    const installs = steps.filter((s) => /npm (install|i|ci)\b[^\n]*hyperframes@/.test(s));
    assert.ok(installs.length > 0, f);
    for (const s of installs) {
      assert.match(s, /ONNXRUNTIME_NODE_INSTALL_CUDA:\s*skip\b/, `${f}: the renderer install must set ONNXRUNTIME_NODE_INSTALL_CUDA: skip`);
    }
  }
});
