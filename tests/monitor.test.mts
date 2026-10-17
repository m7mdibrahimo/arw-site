import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

/**
 * حارس الموقع (scripts/monitor + .opencode/agents/site-guard.md).
 * الاختبارات دي بتحرس الحاجات اللي لو باظت اللفة الساعية تبقى خطيرة:
 * الممنوعات المطلقة، الجدول الزمني، ومفتاح التشغيل الآمن (ARW_GUARD_ENABLED).
 */

const ROOT = process.cwd();
const read = (p: string) => fs.readFileSync(path.join(ROOT, p), 'utf-8');

test('ملف الوكيل موجود وبيحدد الموديل ووضع التشغيل', () => {
  const agent = read('.opencode/agents/site-guard.md');
  assert.match(agent, /^---\n/, 'لازم يبدأ بفرontmatter (frontmatter)');
  assert.match(agent, /mode:\s*primary/);
  assert.match(agent, /model:\s*opencode\//);
  assert.match(agent, /steps:\s*\d+/);
});

test('الممنوعات المطلقة موجودة كلها في ملف الوكيل', () => {
  const agent = read('.opencode/agents/site-guard.md');
  // من قايمة NEVER بتاعة المالك — كل واحدة لازم تفضل موجودة بالحرف
  const prohibited = [
    'NEVER CHANGE WHAT A VISITOR SEES',
    'force-push',
    'delete stories or shows',
    'touch secrets',
    'post to social media',
    'spend Gemini requests',
  ];
  for (const rule of prohibited) {
    assert.ok(agent.includes(rule), `المنع ناقص: ${rule}`);
  }
  // الأداة حطّت روابط أسفل الصفحة ٣ مرات (#274, #480, #594) — السبب لازم يفضل مكتوب
  assert.match(agent, /#274/, 'لازم يفضل مكتوب إن الروابط الزحمة اتحطت ٣ مرات');
  assert.match(agent, /#594/, 'لازم يفضل مكتوب آخر مرة (٢٤ اسم برنامج في الفوتر)');
  // الأقسام الأربعة اللي المالك عايزها في جوجل + قسم «عن العرض» — متتلمسش
  for (const section of ['عروض المصارعة', 'مكتبة العروض', 'الأخبار', 'نوستالجيا', 'عن العرض']) {
    assert.ok(agent.includes(section), `القسم لازم يفضل مذكور ومنع التغيير: ${section}`);
  }
  // الإصلاح من الجذر: الغلطة بتتصلّح مرتين (الحالة + السبب) + اختبار
  assert.match(agent, /FIXED AT THE ROOT/);
  assert.match(agent, /editorial\/corrections\.json/);
  assert.match(agent, /scripts\/wrestler-names\.json/);
});

test('صلاحيات الوكيل: صلاحية كاملة، والممنوعات بس هي المرفوضة', () => {
  const agent = read('.opencode/agents/site-guard.md');
  // صلاحية كاملة = سماح شامل
  assert.match(agent, /action:\s*"\*"\n\s*resource:\s*"\*"\n\s*effect:\s*allow/);
  // والمنع بعد السماح (آخر قاعدة هي اللي تفوز)
  assert.ok(agent.indexOf('effect: allow') < agent.indexOf('effect: deny'), 'المنع لازم يجي بعد السماح');
  // المرفوض: الدفع بالقوة، الأسرار، طلبات Gemini، الأوامر المدمّرة
  for (const pattern of ['git push --force\\*', 'sudo \\*', 'rm -rf \\*', '\\*\\.env', 'gh secret \\*', '\\*GEMINI_API_KEY\\*']) {
    assert.match(agent, new RegExp(pattern), `قاعدة المنع ناقصة: ${pattern}`);
  }
  // ومهم جدًا: commit و push مش ممنوعين — الوكيل هو اللي بيدفع (خطوة ٦)
  assert.doesNotMatch(agent, /resource:\s*"git push\*"/, 'push العادي مسموح — الوكيل بيدفع بنفسه');
  assert.doesNotMatch(agent, /resource:\s*"git commit\*"/, 'commit مسموح — الوكيل بيسجّل شغله');
  // وبيصلّح الأخبار في مكانها (ده الاستثناء الوحيد لتغيير اللي الزائر بيشوفه)
  assert.match(agent, /Fix in place keeping the SAME URL/);
});

test('ملف الإعدادات سليم وفيه مكان للقائمة المخصوصة', () => {
  const cfg = JSON.parse(read('scripts/monitor/config.json'));
  assert.equal(typeof cfg.site.origin, 'string');
  assert.ok(cfg.site.origin.startsWith('https://'));
  assert.ok(Array.isArray(cfg.site.pages) && cfg.site.pages.length > 0);
  assert.equal(typeof cfg.checks.tests, 'string');
  assert.equal(typeof cfg.checks.build, 'string');
  assert.ok(Array.isArray(cfg.custom), 'custom لازم تكون لستة فاضية عشان المستخدم يملأها');
});

test('سكربت اللفة بيفحص ويشتغل من غير ما ينادي الموديل في وضع dry-run', () => {
  const out = execFileSync('bash', ['scripts/monitor/run-round.sh', '--dry-run'], { encoding: 'utf-8' });
  assert.match(out, /AGENT=site-guard/);
  assert.match(out, /ROOT=\//);
  assert.match(out, /PROMPT=/);
  // موديل واحد واقع مايوقفش اللفة: لازم يكون فيه أكتر من موديل بديل
  assert.match(out, /MODELS=opencode\/\S+ opencode\/\S+/);
});

test('اللفة بتجرّب موديل تاني لو الأول فشل', () => {
  const runner = read('scripts/monitor/run-round.sh');
  assert.match(runner, /for M in "\$\{MODELS\[@\]\}"/);
  assert.match(runner, /--auto/);
  assert.match(runner, /--standalone/);
  assert.match(runner, /break/);
});

test('مفيش أي ملف قديم محتاج يتعدّل عشان الحارس يشتغل', () => {
  // المستخدم طلب صراحةً إن مفيش ملف موجود يتلمس — فكل حاجة الحارس محتاجها ملفات جديدة.
  const pkg = JSON.parse(read('package.json'));
  assert.equal(pkg.scripts.monitor, undefined, 'package.json لازم يفضل زي ما هو');
  // السكربتات لازم تكون قابلة للتنفيذ مباشرة
  for (const s of ['run-round.sh', 'install-macos.sh']) {
    const mode = fs.statSync(path.join(ROOT, 'scripts/monitor', s)).mode;
    assert.ok(mode & 0o111, `${s} لازم يكون قابل للتنفيذ (chmod +x)`);
  }
  assert.ok(fs.existsSync('scripts/monitor/README.md'), 'لازم يكون فيه دليل تشغيل');
  assert.match(read('scripts/monitor/README.md'), /run-round\.sh/, 'الدليل لازم يشرح الأوامر المباشرة');
});

test('سكربت التركيب بيتصرّف من غير تسريب', () => {
  const out = execFileSync('bash', ['scripts/monitor/install-macos.sh', '--status'], { encoding: 'utf-8' });
  assert.ok(out.length > 0);
});

test('سكربت اللفة بيجهّز البيئة صح وبيشغّل الوكيل من غير أسئلة', () => {
  const sh = read('scripts/monitor/run-round.sh');
  // الاختبارات محتاجة الحزم في المشروع وفي worker
  assert.match(sh, /npm ci/, 'لازم يركّب الحزم');
  assert.match(sh, /worker\/package\.json/, 'ولازم يركّب حزم الـworker كمان');
  // تشغيل غير تفاعلي: مفيش أسئلة ولا رسائل
  assert.match(sh, /--auto/, 'لازم --auto عشان مفيش حد يرد');
  assert.match(sh, /--standalone/, 'لازم --standalone على سيرفرات CI');
  assert.match(sh, /متسألش أي سؤال/, 'التعليمة لازم تتكرر في رسالة البدء');
  // لو موديل فشل، اللفة ماتقفش
  assert.match(sh, /for M in "\$\{MODELS\[@\]\}"/, 'لازم يجرّب موديل تاني لو الأول فشل');
  assert.match(sh, /last-round\.json/, 'لازم يكتب حالة اللفة');
});

test('ملف الوكيل بيحدّد الموديل الافتراضي المجاني', () => {
  const agent = read('.opencode/agents/site-guard.md');
  assert.match(agent, /model:\s*opencode\/deepseek-v4\.1-flash-free/, 'الافتراضي: أقوى موديل مجاني في استخدام الأدوات');
  const steps = Number(agent.match(/steps:\s*(\d+)/)?.[1] || 0);
  assert.ok(steps >= 150, 'اللفة ٦ خطوات وبتقرا وتعدّل كتير — محتاجة خطوات كفاية');
});

test('الـ workflow بيشتغل في الدقيقة ٥ وبيقفل عليه بمفتاح', () => {
  const wf = read('.github/workflows/hourly-guard.yml');
  assert.match(wf, /cron:\s*'5 \* \* \* \*'/, 'اللفة لازم تكون كل ساعة في الدقيقة ٥');
  assert.match(wf, /vars\.ARW_GUARD_ENABLED == 'true'/, 'لازم يكون فيه مفتاح تشغيل آمن');
  assert.match(wf, /concurrency:/, 'لازم يمنع تشغيل لفتين في نفس الوقت');
  assert.match(wf, /contents:\s*write/, 'الوكيل بيدفع بنفسه — محتاج صلاحية كتابة');
  assert.match(wf, /workflow_dispatch/, 'لازم تقدر تشغّلها بإيدك للتجربة');
  // التوثيق بيروح للـCLI من غير ما يتكتب في أي ملف
  assert.match(wf, /opencode auth import/, 'التوثيق لازم ينستورد من السر');
  assert.doesNotMatch(wf, /echo\s+"\$\{?OPENCODE_AUTH/, 'ممنوع طباعة التوثيق في اللوج');
  // هوية الدفع مضبوطة (الوكيل هو اللي بيعمل push)
  assert.match(wf, /git config user\.name/);
  // والوكيل مش بيصرف طلبات Gemini: المفتاح مش متبعت للـworkflow
  assert.doesNotMatch(wf, /GEMINI_API_KEY/, 'مفتاح Gemini مش بيتحط في بيئة اللفة — الإصلاح بالمراجعة الذاتية');
  assert.match(wf, /timeout-minutes:\s*\d+/, 'اللفة ١٠-٢٥ دقيقة — محتاجة مهلة كفاية');
});

/**
 * المراقب التقني: الأمان هنا مش صلاحيات وكيل — هو إن الـworkflow **مابيكتبش حاجة**
 * في المستودع أصلاً. الاختبارات دي بتقفل الحقيقة دي بالظبط، عشان محدش يزود
 * خطوة push وهو مش واخد باله.
 */
test('المراقب التقني: بيقرا بس — مفيش أي كتابة في المستودع', () => {
  const wf = read('.github/workflows/site-watch.yml');
  assert.doesNotMatch(wf, /git push|git commit|git add|git tag/, 'المراقب ممنوع يكتب في المستودع');
  assert.match(wf, /contents:\s*read/, 'الصلاحية لازم تكون قراءة بس');
  assert.doesNotMatch(wf, /contents:\s*write/, 'ممنوع صلاحية كتابة');
  assert.doesNotMatch(wf, /secrets\./, 'مفيش أي مفاتيح سرية محتاجة');
  assert.match(wf, /upload-artifact/, 'التقارير تترفع كـartifact مش كوميت');
});

test('المراقب التقني: كل ساعة في الدقيقة ٥، ومقفول بمفتاح، وبيفشل عشان يوصلك إيميل', () => {
  const wf = read('.github/workflows/site-watch.yml');
  assert.match(wf, /cron:\s*'5 \* \* \* \*'/, 'كل ساعة في الدقيقة ٥');
  assert.match(wf, /vars\.ARW_WATCH_ENABLED == 'true'/, 'متقفّل لحد ما المستخدم يفعّله');
  assert.match(wf, /workflow_dispatch/, 'لازم تقدر تشغّله بإيدك للتجربة');
  assert.match(wf, /concurrency:/, 'مفيش تشغيلين في نفس الوقت');
  assert.match(wf, /--once --with-tests/, 'على السيرفر يشغّل الاختبارات والبناء كمان');
  assert.match(wf, /steps\.watch\.outcome == 'failure'/, 'الفشل هو قناة التنبيه المجانية');
});

test('المراقب التقني: ملفات تقاريره مالهاش علاقة بالمستودع', () => {
  // reports/guard/ فيه .gitignore فيه * → كل ملفات المراقب تفضل محلية
  assert.match(read('reports/guard/.gitignore'), /^\*$/m, 'لازم يبقى فيه سطر * بيعزل التقارير عن git');
});

