// A second copy of the site's pictures (owner 2026-10-13: «تحافظ علي الموقع العمر كله من كل شئ», INCIDENTS #483). Since
// INCIDENTS #313 the pictures live only in R2 «arw-media» — one wrong delete, one bug in a cleanup job, and every picture of
// the site is gone. Every hour the pictures that are new or changed are copied to «arw-media-backup», a few hundred at a
// time. The backup never deletes anything: a picture removed from the site stays in the backup.

export interface BackupEnv { MEDIA?: R2Bucket; MEDIA_BACKUP?: R2Bucket }

/** What is backed up: the site's pictures and the panel's own backups. Reels (videos/) are made again from the shows. */
export const BACKUP_PREFIXES = ["content/", "backups/"];

async function listAll(bucket: R2Bucket, prefix: string): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  let cursor: string | undefined;
  do {
    const page = await bucket.list({ prefix, cursor, limit: 1000 });
    for (const o of page.objects) out.set(o.key, o.etag);
    cursor = page.truncated ? page.cursor : undefined;
  } while (cursor);
  return out;
}

/** The keys to copy: missing from the backup, or changed since (another etag). */
export function toCopy(main: Map<string, string>, backup: Map<string, string>): string[] {
  return [...main].filter(([k, etag]) => backup.get(k) !== etag).map(([k]) => k);
}

export async function backupMedia(env: BackupEnv, maxCopies = 250): Promise<{ copied: number; waiting: number; total: number }> {
  if (!env.MEDIA || !env.MEDIA_BACKUP) return { copied: 0, waiting: 0, total: 0 };
  let copied = 0, waiting = 0, total = 0;
  for (const prefix of BACKUP_PREFIXES) {
    const [main, backup] = await Promise.all([listAll(env.MEDIA, prefix), listAll(env.MEDIA_BACKUP, prefix)]);
    total += main.size;
    const keys = toCopy(main, backup);
    for (const key of keys) {
      if (copied >= maxCopies) { waiting++; continue; }
      const obj = await env.MEDIA.get(key);
      if (!obj) continue;
      await env.MEDIA_BACKUP.put(key, obj.body, { httpMetadata: obj.httpMetadata, customMetadata: obj.customMetadata });
      copied++;
    }
  }
  return { copied, waiting, total };
}
