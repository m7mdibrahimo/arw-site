import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { closeOpenQuoteLines } from "../scripts/english-edition.ts";
import { endProseParagraphs } from "../scripts/news-qa.ts";
const require = createRequire(import.meta.url);
const { metaDescription } = require("../lib/meta-description.cjs");

test("#1408: a description never stops inside «Money in the Bank»", () => {
  const d = metaDescription("Following a run as a fan favorite, Tiffany Stratton shifted her alignment at WWE Crown Jewel by attacking Chelsea Green and cashing in her Money in the Bank contract to capture the WWE Women's Championship.\n\nStratton has worked most of her WWE career as a villain.");
  assert.doesNotMatch(d, /Money\.$/);
  assert.equal(d, "Following a run as a fan favorite, Tiffany Stratton shifted her alignment at WWE Crown Jewel by attacking Chelsea Green.");
});

test("#1408: an English quote line left open is closed", () => {
  assert.equal(closeOpenQuoteLines('Intro.\n\n> "I am broken. Send pictures.\n\nMore.'), 'Intro.\n\n> "I am broken. Send pictures."\n\nMore.');
  assert.equal(closeOpenQuoteLines('> "Closed already."'), '> "Closed already."');
  assert.equal(closeOpenQuoteLines('> “Curly open'), '> “Curly open”');
});

test("#1408: an Arabic prose paragraph with no full stop gets one; winner and quote lines stay", () => {
  const p = "وخلال عرض WWE SmackDown، تعاملت ستراتون بقسوة مع غرين، وأخبرتها أنها ستظل محصورة في منطقة الطعام في كواليس العروض";
  assert.equal(endProseParagraphs(p), p + ".");
  const q = "وقالت في حديثها عن تدخلها في المواجهة قائلة: «أنا هنا بهدف واحد وهو تحقيق الفوز ولا شيء غير ذلك أبدا»";
  assert.equal(endProseParagraphs(q), q + ".");
  const done = "تحدثت عن ذلك في المقابلة وقالت إنها تحب هذه الملابس كثيرا وتريد ارتداءها دائما في العروض القادمة.»";
  assert.equal(endProseParagraphs(done), done);
  const win = "🏆 **الفائز:** فريق داربي ألين وستيفن بوردن وكريستيان كيج وآدم كوبلاند وآخرين من نجوم الاتحاد";
  assert.equal(endProseParagraphs(win), win);
  const bq = "> «أنا أعرف أنني أفضل كشخصية شريرة، وأجيد تماما التعامل بقسوة والتحدث بحدة مع الآخرين في كل مكان»";
  assert.equal(endProseParagraphs(bq), bq);
});
