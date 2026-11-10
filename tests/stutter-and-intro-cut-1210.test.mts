import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { applyCorrections, checkArticle, BLOCKING_QA_CODES, RETRYABLE_QA_CODES } from "../scripts/news-qa.ts";
import { metaDescription } from "../lib/meta-description.cjs";

const codes = (body: string) => checkArticle("كايل فليتشر يتحدث عن اعتزال آدم كوبلاند", body, []).map((i: any) => i.code);

test("a word typed half then whole («للعالع العالم») blocks publishing and is retried (INCIDENTS #1210)", () => {
  assert.ok(codes("وأود حقا أن أواجهه مرة أخرى لكي أثبت للعالع العالم أجمع أنني الأفضل.").includes("stuttered_word"));
  assert.ok(BLOCKING_QA_CODES.includes("stuttered_word"));
  assert.ok(RETRYABLE_QA_CODES.includes("stuttered_word"));
  // names and real pairs stay: «كيلر كيلي», «لايلا وايلد», «كتابة كتابه»
  for (const ok of ["واجه كيلر كيلي في النزال.", "تواجه لايلا وايلد منافستها.", "يعمل على كتابة كتابه الثاني."]) assert.ok(!codes(ok).includes("stuttered_word"), ok);
});

test("no published Arabic story has a stuttered word", () => {
  const dir = path.join(process.cwd(), "content/news");
  const re = /(?<![ء-ي])(?:[وفبكل]?(?:ال|لل)|[وفبكل])?([ء-ي])([ء-ي]{2,})\1\s+(?:[فبكل]?(?:ال|لل)|[فبكل])?\1\2(?!\1)[ء-ي](?![ء-ي])/;
  const bad = fs.readdirSync(dir).filter((f) => f.endsWith(".md") && re.test(fs.readFileSync(path.join(dir, f), "utf8")));
  assert.deepEqual(bad, []);
});

test("literal idioms and «السماح لـ» are corrected before publishing", () => {
  assert.equal(applyCorrections("خرجت سالما وقطعة واحدة"), "خرجت سالما");
  assert.equal(applyCorrections("يحمل البطولة حول وطيئه"), "يحمل البطولة حول خصره");
  assert.equal(applyCorrections("ليس لديه خطط للسماح لخسارة أوبا فيمي"), "ليس لديه خطط للسماح بخسارة أوبا فيمي");
  assert.equal(applyCorrections("كودي رودز ووزيلا فاتو"), "كودي رودز وزيلا فاتو");
});

test("an English description never stops on «…, but according to X.» (INCIDENTS #1210)", () => {
  const d = metaDescription("Oba Femi continues to make a strong impression on WWE television, but according to Dave Meltzer, the company has no immediate plans to let him suffer a clean defeat. During the November 9, 2026, episode of WWE RAW, Femi faced Bron Breakker.");
  assert.ok(!/according to Dave Meltzer\.$/.test(d), d);
  assert.match(d, /clean defeat\.$/);
  const dir = path.join(process.cwd(), "content/news-en");
  const bad = fs.readdirSync(dir).filter((f) => /^description: ".*, (?:but|and|yet) (?:according to|per) [^,]{0,60}\."$/m.test(fs.readFileSync(path.join(dir, f), "utf8")));
  assert.deepEqual(bad, []);
});

test("an English description never stops on a helping verb («…was not.», «…should have.»)", () => {
  const a = metaDescription("According to Wrestling Observer Radio, Oba Femi's recent call-out of Roman Reigns following his victory over Bronson Reed at WWE Money in the Bank was not part of a long-term booking plan. Dave Meltzer reported that Femi reacted to the crowd.");
  assert.match(a, /long-term booking plan\.$/);
  const b = metaDescription("Jonathan Coachman claimed that Brian James, known as Road Dogg, was fired from WWE because he supported Chelsea Green and believed the company should have done more to push her as a top star in the women's division going forward.");
  assert.ok(!/\b(?:should have|was|was not)\.$/.test(b), b);
  const dir = path.join(process.cwd(), "content/news-en");
  const bad = fs.readdirSync(dir).filter((f) => /^description: ".* (?:was not|should have|would have|could have|has not|had not)\."$/m.test(fs.readFileSync(path.join(dir, f), "utf8")));
  assert.deepEqual(bad, []);
});
