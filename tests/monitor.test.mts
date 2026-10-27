import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import matter from 'gray-matter';

/**
 * حارس اللفة الساعية.
 *
 * الدرس اللي دفعنا لكتابة الملف ده: ملف الوكيل `.opencode/agents/site-guard.md` كان فيه
 * `description:` جواه نقطتين من غير تنصيص، و`permalink:false` مكانش موجود، و`.opencode/`
 * مكانش متجاهل في `.eleventyignore` — فـ**بناء الموقع كله وقع**. الاختبار الأول هنا
 * بيمنع تكرار ده تحديدًا، بنفس المكتبة اللي Eleventy بيستخدمها.
 */

const ROOT = process.cwd();
const read = (p: string) => fs.readFileSync(path.join(ROOT, p), 'utf-8');
const AGENT_FILE = '.opencode/agents/site-guard.md';

test('ملف الوكيل YAML سليم — البناء ميتكسرش بسببه', () => {
  const raw = read(AGENT_FILE);
  // نفس المكتبة اللي Eleventy بتقرا بيها الـfrontmatter
  let parsed: matter.GrayMatterFile<string>;
  assert.doesNotThrow(() => { parsed = matter(raw); }, 'frontmatter ملف الوكيل لازم يكون YAML سليم');
  assert.ok(parsed!.data, 'لازم يكون فيه frontmatter');
  assert.equal(parsed!.data.permalink, false, 'permalink:false يمنع إنه يطلع صفحة في الموقع');
  assert.equal(parsed!.data.eleventyExcludeFromCollections, true);
});

test('.opencode و reports متجاهلين في Eleventy — أي ملف .md جديد مايكسّرش البناء', () => {
  const ignore = read('.eleventyignore');
  for (const dir of ['.opencode/', 'reports/', 'scripts/', 'tests/', 'editorial/']) {
    assert.ok(
      ignore.split('\n').map((l) => l.trim()).includes(dir),
      `${dir} لازم يكون في .eleventyignore — وإلا ملف واحد فيه نقطتين زيادة بيكسّر بناء الموقع كله`,
    );
  }
});

test('ملف الوكيل موجود وبيحدد الموديل ووضع التشغيل', () => {
  const agent = read(AGENT_FILE);
  assert.match(agent, /mode:\s*primary/);
  assert.match(agent, /model:\s*opencode\//);
  const steps = Number(agent.match(/steps:\s*(\d+)/)?.[1] || 0);
  assert.ok(steps >= 150, 'اللفة ٦ خطوات وبتقرا وتعدّل كتير — محتاجة خطوات كفاية');
});

test('الممنوعات المطلقة موجودة كلها في ملف الوكيل', () => {
  const agent = read(AGENT_FILE);
  for (const rule of [
    'NEVER CHANGE WHAT A VISITOR SEES',
    'force-push',
    'delete stories or shows',
    'touch secrets',
    'post to social media',
    'spend Gemini requests',
  ]) {
    assert.ok(agent.includes(rule), `المنع ناقص: ${rule}`);
  }
  // الروابط الزحمة اتحطت ٣ مرات — السبب لازم يفضل مكتوب
  assert.match(agent, /#274/);
  assert.match(agent, /#594/);
  // الأقسام الأربعة اللي المالك عايزها في جوجل + «عن العرض»
  for (const section of ['عروض المصارعة', 'مكتبة العروض', 'الأخبار', 'نوستالجيا', 'عن العرض']) {
    assert.ok(agent.includes(section), `القسم لازم يفضل مذكور: ${section}`);
  }
  // الإصلاح من الجذر: الحالة + السبب + اختبار
  assert.match(agent, /FIXED AT THE ROOT/);
  assert.match(agent, /editorial\/corrections\.json/);
  assert.match(agent, /scripts\/wrestler-names\.json/);
});

test('صلاحيات الوكيل: كاملة، والممنوعات بس هي المرفوضة', () => {
  const agent = read(AGENT_FILE);
  assert.match(agent, /action:\s*"\*"\n\s*resource:\s*"\*"\n\s*effect:\s*allow/);
  assert.ok(agent.indexOf('effect: allow') < agent.indexOf('effect: deny'), 'المنع لازم يجي بعد السماح');
  for (const pattern of ['git push --force\\*', 'sudo \\*', 'rm -rf \\*', '\\*\\.env', 'gh secret \\*', '\\*GEMINI_API_KEY\\*']) {
    assert.match(agent, new RegExp(pattern), `قاعدة المنع ناقصة: ${pattern}`);
  }
  // التعديل مسموح (بيصلّح الأخبار في مكانها)
  assert.match(agent, /Fix in place keeping the SAME URL/);
});

test('الوكيل بيعمل commit بس — الدفع في الـworkflow', () => {
  const agent = read(AGENT_FILE);
  assert.match(agent, /إنت مش بتدفع في الجلسة دي/, 'لازم يبقى مكتوب صراحة إنه مابيدفعش');
  const wf = read('.github/workflows/hourly-guard.yml');
  assert.match(wf, /pre-push/, 'الـworkflow بيحط حاجز يمنع الدفع من الوكيل');
  assert.match(wf, /git push origin HEAD:main/, 'والـworkflow نفسه هو اللي بيدفع');
});

test('سكربت اللفة بيجهّز البيئة وبيشغّل الوكيل من غير أسئلة', () => {
  const sh = read('scripts/monitor/run-round.sh');
  assert.match(sh, /npm ci/, 'لازم يركّب الحزم');
  assert.match(sh, /worker\/package\.json/, 'ولازم يركّب حزم الـworker كمان');
  assert.match(sh, /--auto/, 'مفيش حد يرد على الأسئلة');
  assert.match(sh, /--standalone/, 'مطلوب على سيرفرات CI');
  assert.match(sh, /for M in "\$\{MODELS\[@\]\}"/, 'لو موديل فشل، اللفة ماتقفش');
  assert.match(sh, /run_with_timeout/, 'لازم مهلة — لفة معلّقة بتقفل السيرفر');
  assert.match(sh, /-eq 124/, 'لو المهلة خلصت مايجرّبش موديل تاني (هيضيّع مهلة كمان)');
  // أسماء الموديلات لازم تكون حقيقية: أي اسم غلط بيرجع «Model unavailable» وبيضيّع محاولة
  assert.doesNotMatch(sh, /muse-spark|longcat|cat-jam/, 'أسماء موديلات قديمة/غير موجودة — بتفشل فورًا');
  assert.match(sh, /opencode\/glm-5\.3-flash-free/, 'لازم بديل مجاني حقيقي');
  assert.match(sh, /last-round\.json/);
  assert.doesNotMatch(sh, /git push/, 'السكربت مايدفعش — الدفع في الـworkflow');
});

test('الـworkflow: الدقيقة ٥، مفتاح تشغيل، وبوابة قبل الدفع', () => {
  const wf = read('.github/workflows/hourly-guard.yml');
  assert.match(wf, /cron:\s*'5 \* \* \* \*'/);
  assert.match(wf, /vars\.ARW_GUARD_ENABLED == 'true'/);
  // كرون GitHub بيتأخر في المستودع ده — لازم مُشغّل احتياطي ببوابة ٥٥ دقيقة
  assert.match(wf, /workflow_run:/, 'لازم مُشغّل احتياطي، الكرون لوحده مش مضمون');
  assert.match(wf, /workflows: \["SEO New Shows"\]/);
  assert.match(wf, /-ge 55/, 'البوابة: لفة واحدة كل ٥٥ دقيقة على الأقل');
  assert.match(wf, /needs: preflight/);
  assert.match(wf, /concurrency:/);
  assert.match(wf, /contents:\s*write/);
  assert.match(wf, /workflow_dispatch/);
  assert.match(wf, /opencode auth import/);
  assert.doesNotMatch(wf, /echo\s+"\$\{?OPENCODE_AUTH/, 'ممنوع طباعة التوثيق');
  assert.doesNotMatch(wf, /GEMINI_API_KEY/, 'مفتاح Gemini مش بيتحط في بيئة اللفة');
  // البوابة: الدفع مشروط بنجاح الاختبارات والبناء
  assert.match(wf, /steps\.gate_tests\.outcome/, 'لازم بوابة اختبارات');
  assert.match(wf, /steps\.gate_build\.outcome/, 'لازم بوابة بناء');
  assert.match(wf, /if: steps\.decide\.outputs\.push == 'yes'/, 'الدفع مشروط بقرار البوابة');
  // لفة فشلت نصّها مايتدفعش
  assert.match(wf, /steps\.round\.outcome.*!= "success"|steps\.round\.outcome.*== 'failure'/, 'لازم يمنع دفع لفة فاشلة');
  assert.match(wf, /timeout-minutes:\s*\d+/, 'اللفة ١٠-٢٥ دقيقة — محتاجة مهلة');
});

test('مجلد التقارير متجاهل في git — لفة الحارس مالهاش تدفع لوجات', () => {
  const gi = read('.gitignore');
  assert.ok(
    gi.split('\n').map((l) => l.trim()).includes('reports/'),
    'reports/ لازم يكون في .gitignore — أول لفة دفعت last-round.json للمستودع بالغلط',
  );
  // وملف التقارير نفسه مش متتبّع
  try {
    execFileSync('git', ['ls-files', '--error-unmatch', 'reports/guard/last-round.json'], { stdio: 'pipe' });
    assert.fail('reports/guard/last-round.json لسه متتبّع في git');
  } catch (e: any) {
    assert.notEqual(e.status, 0, 'الملف لازم يكون بره git');
  }
});

test('حارس الحارس: بيكتشف لو اللفة وقفت ساكتة', () => {
  const hb = read('.github/workflows/guard-heartbeat.yml');
  assert.match(hb, /cron:\s*'\d+ \* \* \* \*'/, 'لازم يشتغل كل ساعة');
  assert.match(hb, /ARW_GUARD_ENABLED/, 'لازم يشتكي لو المفتاح مقفول');
  assert.match(hb, /hourly-guard\.yml\/runs/, 'لازم يقرا تشغيلات اللفة');
  assert.match(hb, /180/, 'الحد ٣ ساعات — بعده يعتبره واقف');
  assert.match(hb, /::error::/, 'الفشل هو قناة التنبيه');
});

test('سكربت التركيب بيتصرّف من غير تسريب وملف الخدمة سليم', () => {
  const out = execFileSync('bash', ['scripts/monitor/install-macos.sh', '--status'], { encoding: 'utf-8' });
  assert.ok(out.length > 0);
  const plist = execFileSync('bash', ['scripts/monitor/install-macos.sh', '--print'], { encoding: 'utf-8' });
  assert.match(plist, /<key>Label<\/key>/);
  assert.match(plist, /watch\.ts/);
  const tmp = path.join(ROOT, 'reports/guard/.plist-check.xml');
  fs.writeFileSync(tmp, plist);
  try {
    // plutil exists on a Mac only, but the guard runs on ubuntu-latest — this line made every hourly-guard
    // round fail (INCIDENTS #862). The portable checks below run everywhere; a Mac still lints with plutil.
    assert.match(plist, /^<\?xml version="1\.0"/);
    assert.match(plist, /<plist version="1\.0">[\s\S]*<\/plist>\s*$/);
    assert.equal((plist.match(/<dict>/g) || []).length, (plist.match(/<\/dict>/g) || []).length);
    assert.equal((plist.match(/<array>/g) || []).length, (plist.match(/<\/array>/g) || []).length);
    try {
      execFileSync('plutil', ['-lint', tmp], { encoding: 'utf-8' });
    } catch (e: any) {
      if (e?.code !== 'ENOENT') throw e;
    }
  } finally {
    fs.rmSync(tmp, { force: true });
  }
});
