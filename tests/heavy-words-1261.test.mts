import { test } from "node:test";
import assert from "node:assert/strict";
import { applyCorrections } from "../scripts/news-qa.ts";
import { fixEnglishNames, normalizeEnglishTitle } from "../scripts/english-edition.ts";

test("#1261 «نكوص … بوعده» becomes «تراجع … عن وعده»", () => {
  assert.equal(
    applyCorrections("تشيلسي غرين تؤكد نكوص فندق بلازا بوعده بعد اتهامها"),
    "تشيلسي غرين تؤكد تراجع فندق بلازا عن وعده بعد اتهامها",
  );
  assert.equal(applyCorrections("ونكص بوعده للجماهير"), "وتراجع عن وعده للجماهير");
  assert.equal(applyCorrections("لن ينكص بالتزامه"), "لن يتراجع عن التزامه");
});

test("#1261 a rule without named parts still works as before", () => {
  assert.equal(applyCorrections("في الفاعليات"), "في الفعاليات");
});

test("#1261 «Standard Has Raised» → «Has Risen», a real object stays", () => {
  assert.equal(
    fixEnglishNames(normalizeEnglishTitle("Chelsea Green Admits Her Match Standard Has Raised in WWE")),
    "Chelsea Green Admits Her Match Standard Has Risen in WWE",
  );
  assert.equal(fixEnglishNames("My standard has raised, and I haven't met it."), "My standard has risen, and I haven't met it.");
  assert.equal(fixEnglishNames("WWE has raised the bar again."), "WWE has raised the bar again.");
  assert.equal(fixEnglishNames("The prices have raised the eyebrows of fans."), "The prices have raised the eyebrows of fans.");
});
