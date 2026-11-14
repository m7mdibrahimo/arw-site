import test from "node:test";
import assert from "node:assert/strict";
import { autoFix, definiteSurnames, fixDefiniteSurnames } from "../scripts/news-qa.ts";

// «الكراوس يغادر قبل نحو عام» went live after «سيث كراوس» in the same story (Seth Krauss / TKO, INCIDENTS #1303)
test("«ال» glued to a surname that follows a first name is dropped", () => {
  const body = "أعلن سيث كراوس رحيله عن TKO.\n\nالكراوس يغادر قبل نحو عام من موعد انتهاء عقده.";
  assert.deepEqual(definiteSurnames(body), ["كراوس"]);
  assert.match(autoFix(body), /\n\nكراوس يغادر/);
  assert.equal(fixDefiniteSurnames("وجه نيك نيميث رسالة لعائلة الهاردي قبل مواجهة جيف هاردي"), "وجه نيك نيميث رسالة لعائلة هاردي قبل مواجهة جيف هاردي");
  assert.equal(fixDefiniteSurnames("شكر سيث كراوس زملاءه، ووجه والكراوس رسالة للكراوس"), "شكر سيث كراوس زملاءه، ووجه وكراوس رسالة لكراوس");
});

test("ordinary words with «ال» after a name stay", () => {
  for (const t of [
    "فاز جون سينا ثم أعلن الحكم الفائز رسميا",
    "شرح مارك هنري بنود اتفاق النوستالجيا مع WWE",
    "سيث رولينز يغادر الحلبة",
  ]) assert.equal(fixDefiniteSurnames(t), t);
});
