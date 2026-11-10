import { test } from 'node:test';
import assert from 'node:assert/strict';
import { titleCauseNotInSource } from '../scripts/news-qa';

const SRC = "Brett Lauderdale Feels There's No Reason For A Wrestler To Sign With MLW, They Also Have A Clause That Says You Can't Wrestle For GCW";

test('#1192: «بسبب» joining two separate claims of the source title is blocked', () => {
  assert.ok(titleCauseNotInSource('بريت لودرديل: لا يوجد سبب يدفع أي مصارع للتوقيع مع اتحاد MLW بسبب بند يمنعهم من المشاركة في عروض GCW', SRC));
});

test('#1192: the two claims kept separate pass', () => {
  assert.equal(titleCauseNotInSource('بريت لودرديل: لا يوجد سبب يدفع أي مصارع للتوقيع مع اتحاد MLW، وعقوده تمنع المشاركة في عروض GCW', SRC), null);
});

test('#1192: a cause the source title gives is fine', () => {
  assert.equal(titleCauseNotInSource('اتحاد TNA يعلن غياب ريكي سوسا بسبب إصابة', 'TNA Announces Ricky Sosa Is Out Due To Injury, Also Updates Card'), null);
  assert.equal(titleCauseNotInSource('آنا جاي تخضع لعملية جراحية بسبب إصابة في الكتف', 'Anna Jay Set To Undergo Surgery For Shoulder Injury'), null);
});
