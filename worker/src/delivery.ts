// GitHub's SHA precondition provides an atomic claim across workers and dashboards.
// An interrupted send is never automatically retried: its outcome may be public.
export interface DeliveryEnv {
  GITHUB_OWNER: string; GITHUB_REPO: string; GITHUB_BRANCH: string; GITHUB_TOKEN: string;
}
export interface DeliveryResult {
  ok: boolean; status?: string; error?: string; ambiguous?: boolean; id?: string;
}
interface Receipt {
  key: string; owner: string; status: 'sending' | 'sent' | 'failed' | 'uncertain';
  updatedAt: number; retryAt?: number; id?: string; error?: string;
}
export async function deliverOnce(
  env: DeliveryEnv, key: string, send: () => Promise<DeliveryResult>,
  options: { force?: boolean; retryMs?: number } = {},
): Promise<DeliveryResult> {
  const hash = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(key))))
    .map(b => b.toString(16).padStart(2, '0')).join('');
  const url = `https://api.github.com/repos/${env.GITHUB_OWNER}/${env.GITHUB_REPO}/contents/_data/deliveries/${hash}.json`;
  const headers = { Authorization: `Bearer ${env.GITHUB_TOKEN}`, Accept: 'application/vnd.github+json', 'User-Agent': 'arw-site-bot', 'Content-Type': 'application/json' };
  const read = async (): Promise<{ sha?: string; value?: Receipt }> => {
    const r = await fetch(`${url}?ref=${env.GITHUB_BRANCH}`, { headers });
    if (r.status === 404) return {};
    if (!r.ok) throw new Error(`Delivery state unavailable (${r.status})`);
    const d: any = await r.json();
    const bytes = Uint8Array.from(atob(d.content.replace(/\n/g, '')), c => c.charCodeAt(0));
    return { sha: d.sha, value: JSON.parse(new TextDecoder().decode(bytes)) };
  };
  const write = async (value: Receipt, sha?: string): Promise<boolean> => {
    const bytes = new TextEncoder().encode(JSON.stringify(value));
    const content = btoa(Array.from(bytes, b => String.fromCharCode(b)).join(''));
    const r = await fetch(url, { method: 'PUT', headers, body: JSON.stringify({
      message: `chore(publish): delivery ${value.status} [skip ci]`, branch: env.GITHUB_BRANCH, sha, content,
    }) });
    if (r.status === 409 || r.status === 422) return false;
    if (!r.ok) throw new Error(`Delivery state save failed (${r.status})`);
    return true;
  };
  const owner = crypto.randomUUID();
  let claimed = false;
  for (let i = 0; i < 5; i++) {
    const { sha, value } = await read();
    if (value?.status === 'sent' && !options.force) return { ok: true, status: 'already_sent', id: value.id };
    if (value?.status === 'sending' || value?.status === 'uncertain') {
      return { ok: false, status: 'uncertain', ambiguous: true, error: 'عملية سابقة قيد التنفيذ أو نتيجتها غير مؤكدة؛ راجع المنصة قبل إعادة النشر.' };
    }
    if (value?.retryAt && value.retryAt > Date.now() && !options.force) return { ok: false, status: 'rate_limited', error: value.error };
    if (await write({ key, owner, status: 'sending', updatedAt: Date.now() }, sha)) { claimed = true; break; }
  }
  if (!claimed) return { ok: false, status: 'busy', error: 'تعذر حجز عملية النشر؛ حاول لاحقًا.' };
  let result: DeliveryResult;
  try { result = await send(); }
  catch { result = { ok: false, ambiguous: true, error: 'انقطع الاتصال أثناء النشر؛ يلزم التحقق من المنصة.' }; }
  for (let i = 0; i < 5; i++) {
    const { sha, value } = await read();
    if (value?.owner !== owner) throw new Error('Delivery ownership changed');
    if (await write({ key, owner, status: result.ok ? 'sent' : result.ambiguous ? 'uncertain' : 'failed',
      updatedAt: Date.now(), retryAt: !result.ok ? Date.now() + (options.retryMs ?? 5 * 60_000) : undefined,
      id: result.id, error: result.error }, sha)) return result;
  }
  // Leave the sending receipt in place if acknowledgement storage fails.
  throw new Error('تعذر حفظ نتيجة النشر؛ تم منع إعادة النشر التلقائي لتجنب التكرار.');
}

export async function authorizeAdmin(request: Request, env: DeliveryEnv): Promise<boolean> {
  const token = request.headers.get('Authorization');
  if (!token?.startsWith('Bearer ') || token.length < 15) return false;
  // A real, correctly-scoped Actions token got rejected in production by a single
  // failed fetch here more than once — this is a plain read of the caller's own repo
  // permissions, not a mutation, so retrying costs nothing and avoids treating one
  // transient GitHub API hiccup as "not authorized" for an otherwise-valid token.
  // With dozens of bot workflows hitting api.github.com concurrently, GitHub's
  // secondary rate limiting (403, sometimes 429) is a real, recurring case here —
  // not just 5xx/network errors — so it must be retried too, with backoff so an
  // immediate retry doesn't just hit the same rate limit again.
  const retryableStatus = (status: number) => status >= 500 || status === 403 || status === 429;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const r = await fetch(`https://api.github.com/repos/${env.GITHUB_OWNER}/${env.GITHUB_REPO}`, {
        headers: { Authorization: token, Accept: 'application/vnd.github+json', 'User-Agent': 'arw-site-bot' },
      });
      if (!r.ok) {
        if (attempt < 2 && retryableStatus(r.status)) {
          await new Promise(res => setTimeout(res, 500 * (attempt + 1)));
          continue;
        }
        return false;
      }
      const repo: any = await r.json();
      return repo.permissions?.push === true || repo.permissions?.admin === true;
    } catch (e) {
      if (attempt < 2) {
        await new Promise(res => setTimeout(res, 500 * (attempt + 1)));
        continue;
      }
      return false;
    }
  }
  return false;
}
