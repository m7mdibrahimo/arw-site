import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import matter from 'gray-matter';

/**
 * المراقب التقني (scripts/monitor/watch.ts): بناء الموقع محمي من ملفاته، وتقاريره بره git،
 * وملف خدمة الماك سليم. حارس «أوبن كود» اتشال نهائيًا بطلب المالك (2026-10-28).
 */

const ROOT = process.cwd();
const read = (p: string) => fs.readFileSync(path.join(ROOT, p), 'utf-8');

test('reports وscripts متجاهلين في Eleventy — أي ملف .md جديد مايكسّرش البناء', () => {
  const ignore = read('.eleventyignore');
  for (const dir of ['reports/', 'scripts/', 'tests/', 'editorial/']) {
    assert.ok(
      ignore.split('\n').map((l) => l.trim()).includes(dir),
      `${dir} لازم يكون في .eleventyignore — وإلا ملف واحد فيه نقطتين زيادة بيكسّر بناء الموقع كله`,
    );
  }
});

test('لا أثر لحارس «أوبن كود» — المالك ألغاه نهائيًا', () => {
  for (const f of ['.github/workflows/hourly-guard.yml', '.github/workflows/guard-heartbeat.yml', 'scripts/monitor/run-round.sh', '.opencode']) {
    assert.ok(!fs.existsSync(path.join(ROOT, f)), `${f} اتشال بطلب المالك (2026-10-28) — مايرجعش`);
  }
});

test('مجلد التقارير متجاهل في git — المراقب مالوش يدفع لوجات', () => {
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

test('سكربت التركيب بيتصرّف من غير تسريب وملف الخدمة سليم', () => {
  const out = execFileSync('bash', ['scripts/monitor/install-macos.sh', '--status'], { encoding: 'utf-8' });
  assert.ok(out.length > 0);
  const plist = execFileSync('bash', ['scripts/monitor/install-macos.sh', '--print'], { encoding: 'utf-8' });
  assert.match(plist, /<key>Label<\/key>/);
  assert.match(plist, /watch\.ts/);
  const tmp = path.join(ROOT, 'reports/guard/.plist-check.xml');
  fs.mkdirSync(path.dirname(tmp), { recursive: true }); // reports/ is gitignored: absent on a fresh checkout
  fs.writeFileSync(tmp, plist);
  try {
    // plutil exists on a Mac only, and the tests also run on ubuntu-latest (INCIDENTS #862). The portable
    // checks below run everywhere; a Mac still lints with plutil.
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
