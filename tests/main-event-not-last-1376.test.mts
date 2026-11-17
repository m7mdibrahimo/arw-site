import { test } from "node:test";
import assert from "node:assert/strict";
import { mainEventNotLastResult } from "../scripts/news-qa.ts";

const glossary = { "Iyo Sky": "آيو سكاي", "Raquel Rodriguez": "راكيل رودريغيز", "Carmelo Hayes": "كارميلو هايز", "Cruz Montana": "كروز مونتانا", "The Usos": "ذا أوسوز", "LA Knight": "ال ايه نايت", "The Miz": "ذا ميز" };
const src = `LA Knight def. The Miz
Women's Intercontinental Championship: Iyo Sky (w/ Becky Lynch) def. Raquel Rodriguez (c) (w/ Liv Morgan & Roxanne Perez) to win the title
946 (Carmelo Hayes & Cruz Montana) def. The Usos (Jey Uso & Jimmy Uso)`;

const wrong = `**المواجهة الأولى: نزال لتحديد الأفضلية في WarGames**
واجه فريق ذا أوسوز فريق كارميلو هايز وكروز مونتانا.

**المواجهة الثانية: نزال فردي**
واجه ال ايه نايت خصمه ذا ميز.

**الحدث الرئيسي (Main Event): نزال على بطولة WWE للقارات للسيدات**
فازت آيو سكاي على راكيل رودريغيز.`;

const right = `**المواجهة الأولى: نزال فردي**
واجه ال ايه نايت خصمه ذا ميز.

**المواجهة الثانية: نزال على بطولة WWE للقارات للسيدات**
فازت آيو سكاي على راكيل رودريغيز.

**الحدث الرئيسي (Main Event): نزال لتحديد الأفضلية في WarGames**
فاز فريق 946 (كارميلو هايز وكروز مونتانا) على ذا أوسوز.`;

test("WWE Raw 16 Nov: a mid-card match called the main event while the last result is elsewhere (INCIDENTS #1376)", () => {
  assert.equal(mainEventNotLastResult(wrong, src, glossary), "Carmelo Hayes");
});

test("the report whose main event is the source's last result passes", () => {
  assert.equal(mainEventNotLastResult(right, src, glossary), null);
});

test("a dark match after the show, unknown names, or no main event are left alone", () => {
  assert.equal(mainEventNotLastResult(right, src + "\nDark match: The Miz def. LA Knight", glossary), null);
  assert.equal(mainEventNotLastResult(wrong, "Someone Unknown def. Other Guy", glossary), null);
  assert.equal(mainEventNotLastResult(wrong.replace("الحدث الرئيسي (Main Event)", "المواجهة الثالثة"), src, glossary), null);
});

test("a source line labelled «main event» wins over a later result", () => {
  const s = "Main Event: Iyo Sky def. Raquel Rodriguez\nLA Knight def. The Miz";
  assert.equal(mainEventNotLastResult(wrong, s, glossary), null);
});
