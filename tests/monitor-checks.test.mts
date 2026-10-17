import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  ciFindings, commandFindings, deployFindings, feedFindings, hasDown, mergeFindings,
  pageFindings, repoFindings, summarize, workerFindings, worst, type Finding,
} from '../scripts/monitor/checks';

/**
 * المراقب التقني — دقة الحكم أهم من أي حاجة تانية.
 * لو المراقب غلط، إما هيرعب المستخدم على الفاضي أو هيسيب عطل حقيقي يمرق.
 * الاختبارات دي ما بتلمسش الشبكة ولا الملفات: منطق خالص بس.
 */

const NOW = 1_800_000_000_000;

test('صفحة واقعة = down، وبطيئة = warn، وسليمة = مفيش', () => {
  const out = pageFindings([
    { name: 'الرئيسية', path: '/', ok: true, status: 200, ms: 120 },
    { name: 'الأخبار', path: '/news/', ok: false, status: 500, ms: 30 },
    { name: 'خريطة الموقع', path: '/sitemap.xml', ok: true, status: 200, ms: 12_000 },
  ]);
  assert.equal(out.length, 2);
  assert.ok(out.some((f) => f.id === 'page:/news/' && f.level === 'down'));
  assert.ok(out.some((f) => f.id === 'slow:/sitemap.xml' && f.level === 'warn'));
  assert.ok(out[0].detail.includes('500'), 'التفصيل لازم يقول كود الرد');
});

test('صفحة مردّتش خالص (كود 0) = واقعة، والتفصيل يقول كده', () => {
  const out = pageFindings([{ name: 'الرئيسية', path: '/', ok: false, status: 0, ms: 15_000 }]);
  assert.equal(out[0].level, 'down');
  assert.match(out[0].detail, /مردّش/);
});

test('الأخبار: فاضي / قديم / طازة', () => {
  assert.equal(feedFindings(0, NOW, 6)[0].id, 'feed:missing');
  const old = feedFindings(NOW - 9 * 3600_000, NOW, 6);
  assert.equal(old[0].id, 'feed:stale');
  assert.match(old[0].title, /9 ساعة/);
  assert.equal(feedFindings(NOW - 60_000, NOW, 6).length, 0, 'خبر عمره دقيقة مش مشكلة');
});

test('بوت الأخبار: نبض طازة = تمام، نايم/متقفّل/فاضي = واقعة', () => {
  const fresh = workerFindings({ enabled: true, lastChecked: NOW - 60_000, apiCallsToday: 31 }, NOW, 20, 0);
  assert.equal(fresh.length, 0, 'بوت بينبض كل دقيقة مش مشكلة');

  const stopped = workerFindings({ enabled: false, lastChecked: NOW - 60_000, apiCallsToday: 0 }, NOW, 20, 0);
  assert.equal(stopped[0].id, 'worker:disabled');
  assert.equal(stopped[0].level, 'down');

  const idle = workerFindings({ enabled: true, lastChecked: NOW - 45 * 60_000, apiCallsToday: 5 }, NOW, 20, 0);
  assert.equal(idle[0].id, 'worker:stalled');
  assert.equal(idle[0].level, 'down');
  assert.match(idle[0].title, /45 دقيقة/);

  const missing = workerFindings({ enabled: null, lastChecked: 0, apiCallsToday: 0 }, NOW, 20, 0);
  assert.equal(missing[0].id, 'worker:nostate');
  assert.equal(missing[0].level, 'down', 'حالة البوت مش بتتقرا = عطل حقيقي مش تحذير');
});

test('استهلاك البوت: تنبيه قبل ما يوصل الحد، وسكوت لو الحد مش معروف', () => {
  const near = workerFindings({ enabled: true, lastChecked: NOW, apiCallsToday: 420 }, NOW, 20, 400);
  assert.equal(near.length, 1);
  assert.equal(near[0].id, 'worker:apicap');
  assert.equal(near[0].level, 'warn', 'قرب الحد مش عطل — تحذير بس');
  assert.equal(workerFindings({ enabled: true, lastChecked: NOW, apiCallsToday: 420 }, NOW, 20, 0).length, 0, 'apiWarnAt=0 يعني متبلّغش');
});

test('الحد بين «طبيعي» و«متأخر» في النشر', () => {
  assert.equal(deployFindings(0, 40).length, 0);
  assert.equal(deployFindings(39 * 60_000, 40).length, 0, 'تحت الحد = تمام');
  const over = deployFindings(90 * 60_000, 40);
  assert.equal(over[0].level, 'down');
  assert.match(over[0].detail, /90 دقيقة/);
});

test('تشغيلات فشلت: القديم بره النافذة مايزعّجش', () => {
  const out = ciFindings([
    { name: 'Publishing checks', at: NOW - 60_000, url: 'u1' },
    { name: 'Ringside News', at: NOW - 20 * 3600_000, url: 'u2' },
  ], NOW, 6);
  assert.equal(out.length, 1, 'فشل من 20 ساعة مش مشكلة دلوقتي');
  assert.equal(out[0].id, 'ci:Publishing checks');
});

test('حالة الريبو: ورا GitHub، ولا كوميتات مش مرفوعة، ولا ريبة', () => {
  assert.equal(repoFindings({ branch: 'main', ahead: 0, behind: 0, dirty: 3 }).length, 0);
  const behind = repoFindings({ branch: 'main', ahead: 0, behind: 7, dirty: 0 });
  assert.equal(behind[0].id, 'repo:behind');
  assert.match(behind[0].title, /7 كوميت/);
  const ahead = repoFindings({ branch: 'main', ahead: 2, behind: 0, dirty: 0 });
  assert.equal(ahead[0].id, 'repo:ahead', 'شغل مش مرفوع لازم يتنبّه عليه');
  assert.equal(repoFindings({ branch: 'main', ahead: 0, behind: 0, dirty: 500 })[0].id, 'repo:dirty');
});

test('أمر فشل: الاسم والتفصيل من آخر السطور', () => {
  const out = commandFindings([
    { name: 'الاختبارات', code: 0, tail: 'ok' },
    { name: 'البناء', code: 1, tail: 'line1\nline2\nError: something broke\nmore' },
  ]);
  assert.equal(out.length, 1);
  assert.equal(out[0].level, 'down');
  assert.match(out[0].title, /البناء فشل/);
  assert.match(out[0].detail, /something broke/);
});

test('تتبّع المشكلة: بيفضل فاكر امتى بدأت، ويعرف الجديد واللي اتصلّح', () => {
  const first: Finding[] = [{ id: 'page:/news/', level: 'down', title: 'الأخبار واقعة', detail: '500' }];
  const r1 = mergeFindings([], first, NOW);
  assert.equal(r1.current[0].since, NOW);
  assert.equal(r1.appeared.length, 1);

  // نفس المشكلة بعد ١٠ دقايق: نفس since، ومفيش «جديد»
  const later = NOW + 600_000;
  const r2 = mergeFindings(r1.current, first, later);
  assert.equal(r2.current[0].since, NOW, 'since لازم يفضل زي ما هو');
  assert.equal(r2.appeared.length, 0, 'مش جديدة');

  // اتصلّحت
  const r3 = mergeFindings(r1.current, [], later);
  assert.equal(r3.current.length, 0);
  assert.equal(r3.resolved.length, 1);
  assert.equal(r3.resolved[0].id, 'page:/news/');
});

test('الحكم النهائي: أعلى خطورة هي اللي تحكم', () => {
  const warn: Finding[] = [{ id: 'a', level: 'warn', title: 't', detail: 'd' }];
  const down: Finding[] = [{ id: 'b', level: 'down', title: 't', detail: 'd' }];
  assert.equal(worst([]), 'ok');
  assert.equal(worst(warn), 'warn');
  assert.equal(worst([...warn, ...down]), 'down');
  assert.equal(hasDown(warn), false, 'تحذير مش سبب يزعّج المستخدم بنفس القوة');
  assert.equal(hasDown(down), true);
});

test('الملخّص بيتقرا بالمصري', () => {
  assert.equal(summarize([]), 'تمّت المراجعة — مفيش مشاكل');
  assert.match(summarize([{ id: 'a', level: 'down', title: 't', detail: 'd' }]), /1 مشكلة واقعة/);
  assert.match(summarize([
    { id: 'a', level: 'down', title: 't', detail: 'd' },
    { id: 'b', level: 'warn', title: 't', detail: 'd' },
  ]), /1 مشكلة واقعة · 1 تحذير/);
});
