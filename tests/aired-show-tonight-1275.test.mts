import { test } from "node:test";
import assert from "node:assert/strict";
import { analyzeShowTiming, dropTonightForAiredShow } from "../scripts/fightful-watcher.ts";

const src = "Mila Moore Joins The Dollhouse On 11/12 TNA iMPACT";

test("#1275: a show dated before the story's day is past, not tonight", () => {
  const t = analyzeShowTiming(src, "2026-11-13T04:40:23");
  assert.equal(t.isTonight, false);
  assert.equal(t.isPast, true);
  assert.equal(analyzeShowTiming(src, "2026-11-12T18:00:00").isTonight, true);
});

test("#1275: «الليلة» after an aired show's name is dropped", () => {
  assert.equal(
    dropTonightForAiredShow("ميلا مور تنضم إلى فريق ذا دول هاوس في عرض TNA iMPACT الليلة", "2026-11-13T04:40:23", src),
    "ميلا مور تنضم إلى فريق ذا دول هاوس في عرض TNA iMPACT",
  );
  assert.equal(
    dropTonightForAiredShow("ظهرت في عرض WWE RAW الليلة، وقالت إنها جاهزة", "2026-11-13T04:40:23", "Liv Morgan Appears On 11/12 WWE Raw"),
    "ظهرت في عرض WWE RAW، وقالت إنها جاهزة",
  );
});

test("#1275: same-day shows and quotes keep «الليلة»", () => {
  assert.equal(dropTonightForAiredShow("في عرض TNA iMPACT الليلة", "2026-11-12T15:00:00", src), "في عرض TNA iMPACT الليلة");
  assert.equal(dropTonightForAiredShow("قال: أنا جاهز الليلة", "2026-11-13T04:40:23", src), "قال: أنا جاهز الليلة");
});

import { fixTonightAired, fixEnglishNames } from "../scripts/english-edition.ts";
test("#1275: English «Tonight's <show> served/aired» becomes «This week's»", () => {
  assert.equal(fixTonightAired("Tonight's TNA Impact served as the go-home show for Destination X."), "This week's TNA Impact served as the go-home show for Destination X.");
  assert.equal(fixEnglishNames("Tonight's AEW Dynamite and AEW Collision airing November 11, 2026, emanated live."), "This week's AEW Dynamite and AEW Collision airing November 11, 2026, emanated live.");
  assert.equal(fixTonightAired("Tonight's Raw will feature a title match."), "Tonight's Raw will feature a title match.");
  assert.equal(fixTonightAired('He said "Tonight\'s Raw was great" afterwards.'), 'He said "Tonight\'s Raw was great" afterwards.');
});
