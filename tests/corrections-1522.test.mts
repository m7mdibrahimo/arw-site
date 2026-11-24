import { test } from "node:test";
import assert from "node:assert/strict";
import { applyCorrections } from "../scripts/news-qa.ts";

// INCIDENTS #1522: «كيرديت» بدل «كريديت» في اسم صالة ليبرتي فيرست كريديت يونيون أرينا.
test("Credit is written كريديت", () => {
  assert.equal(applyCorrections("في صالة ليبرتي فيرست كيرديت يونيون أرينا"), "في صالة ليبرتي فيرست كريديت يونيون أرينا");
  assert.equal(applyCorrections("ليبرتي فيرست كريديت يونيون"), "ليبرتي فيرست كريديت يونيون");
});
