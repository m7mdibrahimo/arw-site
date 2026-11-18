import { test } from "node:test";
import assert from "node:assert/strict";
import { applyCorrections } from "../scripts/news-qa.ts";

// INCIDENTS #1401: «بايج بوم», a dropped «مع/في» before «برنامج», «يذكر ان» without hamza.
test("Big Boom is «بيج بوم»", () => {
  assert.equal(applyCorrections("أوضح بايج بوم أنه"), "أوضح بيج بوم أنه");
});
test("«حديثه برنامج» gets «مع», «أشار سابقا برنامج» gets «في»", () => {
  assert.equal(applyCorrections("وفي حديثه برنامج The Nikki & Brie Show"), "وفي حديثه مع برنامج The Nikki & Brie Show");
  assert.equal(applyCorrections("وكان دانيلسون قد أشار سابقا برنامج The Masked Man Show"), "وكان دانيلسون قد أشار سابقا في برنامج The Masked Man Show");
  assert.equal(applyCorrections("وفي حديثه مع برنامج X"), "وفي حديثه مع برنامج X");
  assert.equal(applyCorrections("حديثه برنامجا"), "حديثه برنامجا");
});
test("«يذكر ان / سبق له ان» get the hamza", () => {
  assert.equal(applyCorrections("يذكر ان بانك سبق له ان ظهر"), "يذكر أن بانك سبق له أن ظهر");
  assert.equal(applyCorrections("يذكر انه"), "يذكر انه");
});
