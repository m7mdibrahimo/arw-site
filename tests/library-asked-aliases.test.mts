import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

// INCIDENTS #1019: every program's alternate names carry «عرض X مترجم» and «عرض X الاخير» (head/structured data only)
test("library aliases generate the مترجم / الاخير forms for every program", () => {
  const src = readFileSync("eleventy.config.js", "utf8");
  const line = src.split("\n").find((l) => l.includes("const asked = askName"));
  assert.ok(line);
  for (const part of ['askName + " مترجم"', 'askName + " الاخير"', 'askName + " الاخير مترجم"']) assert.ok(line.includes(part), part);
});
