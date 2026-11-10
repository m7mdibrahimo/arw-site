// «شغّل السيرفر» (2026-11-10): a rented machine «running» at the rental site that never answered (its setup stopped on a
// failed download) made the button say «السيرفر شغال أصلًا» on every press while the panel showed «مقفول». A machine
// counts as on only when it answers; a silent one gets its time to set up, one restart, then is put away.
import test from 'node:test';
import assert from 'node:assert/strict';
import { encInstOf, encHealth, encStuckStep, encBusyText, ENC_SETUP_MS, ENC_SILENT_MS, ENC_REBOOT_MS } from '../worker/src/enc-machine';

const NOW = 1_794_295_000_000;
const MIN = 60_000;
const inst = (o: any = {}) => ({ id: 60032016, actual_status: 'running', start_date: (NOW - 26 * MIN) / 1000, ...o });

test('the case that broke: rented 26 minutes ago, never answered → stuck, not «already running»', () => {
  const st = encHealth(inst(), { at: NOW - 140 * MIN, iid: '57000000' }, NOW - 26 * MIN, NOW);
  assert.equal(st.health, 'stuck');
  assert.equal(st.knew, false);
  assert.equal(encStuckStep(st, inst(), null, NOW), 'reboot');
});

test('a machine that answers is on, whatever else', () => {
  assert.equal(encHealth(inst(), { at: NOW - 30_000, iid: '60032016' }, 0, NOW).health, 'ok');
  // a heartbeat without a number (an old bundle) still counts while fresh
  assert.equal(encHealth(inst(), { at: NOW - 30_000, iid: '' }, 0, NOW).health, 'ok');
});

test('a fresh heartbeat from another machine does not make this one on', () => {
  assert.notEqual(encHealth(inst(), { at: NOW - 30_000, iid: '111' }, 0, NOW).health, 'ok');
});

test('a new machine gets its setup time before anything is done', () => {
  const st = encHealth(inst({ start_date: (NOW - 10 * MIN) / 1000 }), null, 0, NOW);
  assert.equal(st.health, 'setting-up');
  assert.equal(encStuckStep(st, inst(), null, NOW), null);
  assert.equal(encHealth(inst({ start_date: (NOW - ENC_SETUP_MS - 1) / 1000 }), null, 0, NOW).health, 'stuck');
});

test('a known machine just started again (start_date old) is judged from the press, not from its last heartbeat', () => {
  const old = inst({ start_date: (NOW - 3 * 86400_000) / 1000 });
  assert.equal(encHealth(old, { at: NOW - 5 * 3600_000, iid: '60032016' }, NOW - 2 * MIN, NOW).health, 'setting-up');
  const st = encHealth(old, { at: NOW - 5 * 3600_000, iid: '60032016' }, NOW - ENC_SILENT_MS - MIN, NOW);
  assert.equal(st.health, 'stuck');
  assert.equal(st.knew, true);
});

test('restarted once; still silent → a never-answered machine is deleted, a known one stopped', () => {
  const st = encHealth(inst(), null, NOW - 30 * MIN, NOW);
  assert.equal(encStuckStep(st, inst(), `60032016:${NOW - 30 * MIN}`, NOW), 'delete');
  const known = encHealth(inst(), { at: NOW - 40 * MIN, iid: '60032016' }, NOW - 30 * MIN, NOW);
  assert.equal(encStuckStep(known, inst(), `60032016:${NOW - 30 * MIN}`, NOW), 'stop');
  // a restart of another machine, or long ago, doesn't count
  assert.equal(encStuckStep(st, inst(), `999:${NOW - 30 * MIN}`, NOW), 'reboot');
  assert.equal(encStuckStep(st, inst(), `60032016:${NOW - ENC_REBOOT_MS - 1}`, NOW), 'reboot');
});

test('off at the rental site is off', () => {
  assert.equal(encHealth(inst({ actual_status: 'exited' }), null, 0, NOW).health, 'off');
  assert.equal(encHealth(null, null, 0, NOW).health, 'off');
  assert.equal(encStuckStep(encHealth(null, null, 0, NOW), null, null, NOW), null);
});

test('the rental site answers with an object or a list of one', () => {
  assert.equal(encInstOf({ instances: { id: 5 } }).id, 5);
  assert.equal(encInstOf({ instances: [{ id: 6 }] }).id, 6);
  assert.equal(encInstOf({ instances: [] }), null);
  assert.equal(encInstOf({ instances: { error: 'x' } }), null);
  assert.equal(encInstOf(null), null);
});

test('why his list could not start, machine by machine', () => {
  assert.equal(encBusyText([{ name: 'بنسلفانيا (٣٠٦٠)', why: 'busy' }, { name: 'كاليفورنيا (٣٠٦٠)', why: 'price' }, { name: 'كندا (٣٠٦٠ تي)', why: 'busy' }]),
    'بنسلفانيا وكندا مشغولين مع ناس تانيين، وكاليفورنيا سعره زاد عن اللي وافقت عليه');
  assert.equal(encBusyText([{ name: 'كندا (٣٠٦٠ تي)', why: 'busy' }]), 'كندا مشغول مع ناس تانيين');
  assert.equal(encBusyText([]), 'مفيش جهاز في قائمتك');
});

test('how much of a show subtitles cover: RAW 2026-11-09 came out 10 minutes of a 3-hour show', async () => {
  const { srtMinutes, ENC_SHORT_MIN } = await import('../worker/src/enc-machine');
  const raw = '106\n00:09:56,500 --> 00:09:56,660\nYeah!\n\n107\n00:09:56,880 --> 00:09:58,200\nWe did it this and now!\n';
  assert.equal(srtMinutes(raw), 10);
  assert.ok(srtMinutes(raw) < ENC_SHORT_MIN);
  assert.equal(srtMinutes('1\n02:58:10,000 --> 02:58:12,500\nGoodnight!\n'), 178);
  assert.equal(srtMinutes(''), 0);
});
