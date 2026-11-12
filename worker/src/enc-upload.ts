/** «ارفع ملف من جهازك» on the panel's «سيرفر التفريغ» page (owner 2026-11-12: «انا مش شايف خيار ارفع من جهازك خالص»).
 *
 *  The old way was a link to the machine's own file page through a free tunnel (trycloudflare); on a machine where the
 *  tunnel never came up (Connecticut, 2026-11-12: «failed to request quick Tunnel … Client.Timeout») there was no link
 *  and no way to upload at all. Now the file goes from the owner's browser to the site's own storage (R2 arw-media,
 *  under enc-up/<random>/, in 20 MB parts through this worker), and the machine fetches it from here (fetch-up.sh in the
 *  machine's bundle): the same name replaces what was there (a short copy), its language is set, subtitles start.
 *  While a file is going up the machine is told to stay on (KV tools:upload-hold); the copy here is deleted once the
 *  machine has it, and anything left is swept after 3 days. */

export interface EncUpEnv { MEDIA?: R2Bucket; ANALYTICS?: D1Database; PUSH_KV: KVNamespace }

export const ENC_UP_PART = 20 * 1024 * 1024;           // every part but the last is exactly this (R2 needs equal parts)
export const ENC_UP_MAX = 30 * 1024 * 1024 * 1024;     // a 1080p show is ~10 GB; more than this is a mistake
const PREFIX = "enc-up/";
const EXT = /\.(mkv|mp4|ts|avi|mka|m4a|mp3|aac|opus|wav|flac|mov|webm|m4v)$/i;
const LANGS = ["en", "es", "ja", "enja", "enes"];
const HOLD_TTL = 600;

/** the file's own name, safe as a name on the machine: no folders, no control or shell-quoting characters */
export function encUpName(raw: unknown): string | null {
  const n = String(raw || "").split(/[\\/]/).pop()!.replace(/[\u0000-\u001f"'`$\\<>|*?]/g, "").trim().slice(0, 160);
  return n && !n.startsWith(".") && EXT.test(n) ? n : null;
}
export const encUpKeyOk = (k: unknown) => typeof k === "string" && /^enc-up\/[a-f0-9]{32}\/[^/]{1,160}$/.test(k) && !k.includes("..");
const rand = () => [...crypto.getRandomValues(new Uint8Array(16))].map(b => b.toString(16).padStart(2, "0")).join("");

type J = (body: any, status?: number) => Response;

/** the panel's side (already checked for the «tools» permission): start / part / done / abort */
export async function encUploadStudio(request: Request, env: EncUpEnv, path: string, url: URL, json: J): Promise<Response | null> {
  if (!path.startsWith("/api/studio/tools/server/upload/") || request.method !== "POST") return null;
  if (!env.MEDIA || !env.ANALYTICS) return json({ success: false, error: "التخزين مش متاح دلوقتي" }, 503);
  const what = path.slice("/api/studio/tools/server/upload/".length);
  if (what === "part") {
    const key = url.searchParams.get("key"), id = url.searchParams.get("uploadId") || "", n = Number(url.searchParams.get("n"));
    if (!encUpKeyOk(key) || !id || !Number.isInteger(n) || n < 1 || n > 10000) return json({ success: false, error: "جزء مش صحيح" }, 400);
    const buf = await request.arrayBuffer();
    if (!buf.byteLength || buf.byteLength > ENC_UP_PART) return json({ success: false, error: "حجم الجزء مش صحيح" }, 400);
    const part = await env.MEDIA.resumeMultipartUpload(key!, id).uploadPart(n, buf);
    await env.PUSH_KV.put("tools:upload-hold", "1", { expirationTtl: HOLD_TTL });
    return json({ success: true, n, etag: part.etag });
  }
  const b: any = await request.json().catch(() => ({}));
  if (what === "start") {
    const name = encUpName(b.name), size = Number(b.size);
    if (!name) return json({ success: false, error: "ده مش ملف فيديو أو صوت (mkv / mp4 / mka / m4a / mp3 …)" }, 400);
    if (!(size > 0) || size > ENC_UP_MAX) return json({ success: false, error: "حجم الملف مش مظبوط" }, 400);
    const key = `${PREFIX}${rand()}/${name}`;
    const up = await env.MEDIA.createMultipartUpload(key, { httpMetadata: { contentType: "application/octet-stream" }, customMetadata: { at: String(Date.now()) } });
    await env.PUSH_KV.put("tools:upload-hold", "1", { expirationTtl: HOLD_TTL });
    return json({ success: true, key, uploadId: up.uploadId, partSize: ENC_UP_PART, name });
  }
  if (!encUpKeyOk(b.key) || !b.uploadId) return json({ success: false, error: "رفع مش معروف" }, 400);
  const up = env.MEDIA.resumeMultipartUpload(b.key, String(b.uploadId));
  if (what === "abort") {
    await up.abort().catch(() => {});
    await env.PUSH_KV.delete("tools:upload-hold");
    return json({ success: true });
  }
  if (what === "done") {
    const parts = (Array.isArray(b.parts) ? b.parts : []).map((p: any) => ({ partNumber: Number(p.partNumber), etag: String(p.etag || "") }))
      .filter((p: any) => p.partNumber >= 1 && p.etag).sort((x: any, y: any) => x.partNumber - y.partNumber);
    if (!parts.length) return json({ success: false, error: "مفيش أجزاء" }, 400);
    const obj = await up.complete(parts);
    const file = String(b.key).split("/").pop()!;
    const lang = LANGS.includes(b.lang) ? b.lang : "en";
    await env.ANALYTICS.prepare("INSERT INTO enc_cmds (kind, data, created) VALUES (?, ?, ?)")
      .bind("fetch", JSON.stringify({ file, key: b.key, size: obj.size, lang }), Date.now()).run();
    await env.PUSH_KV.delete("tools:upload-hold");
    return json({ success: true, file, size: obj.size });
  }
  return json({ success: false, error: "طلب مش معروف" }, 404);
}

/** the machine's side (already checked for the tools key): the file (ranges too — aria2 fetches it in pieces), and
 *  «I have it» (the copy here goes) */
export async function encUploadMachine(request: Request, env: EncUpEnv, path: string, url: URL, json: J): Promise<Response | null> {
  if (path !== "/tools/arw-fetch" && path !== "/tools/arw-fetched") return null;
  const key = url.searchParams.get("key");
  if (!env.MEDIA || !encUpKeyOk(key)) return new Response("not found", { status: 404 });
  if (path === "/tools/arw-fetched") { await env.MEDIA.delete(key!); return json({ success: true }); }
  const range = request.headers.get("Range");
  const obj = await env.MEDIA.get(key!, range ? { range: request.headers } : {});
  if (!obj || !("body" in obj) || !obj.body) return new Response("not found", { status: 404 });
  const h = new Headers({ "Content-Type": "application/octet-stream", "Accept-Ranges": "bytes", "Cache-Control": "no-store" });
  const r: any = obj.range;
  if (range && r) {
    const start = r.offset ?? (r.suffix != null ? obj.size - r.suffix : 0);
    const len = r.length ?? (r.suffix != null ? r.suffix : obj.size - start);
    h.set("Content-Range", `bytes ${start}-${start + len - 1}/${obj.size}`);
    h.set("Content-Length", String(len));
    return new Response(obj.body, { status: 206, headers: h });
  }
  h.set("Content-Length", String(obj.size));
  return new Response(obj.body, { status: 200, headers: h });
}

/** files the machine never took (it was off for days, or the owner gave up): gone after 3 days */
export async function encUploadSweep(env: EncUpEnv, now = Date.now()) {
  if (!env.MEDIA) return;
  let cursor: string | undefined;
  do {
    const l = await env.MEDIA.list({ prefix: PREFIX, cursor, include: ["customMetadata"] } as R2ListOptions);
    const old = l.objects.filter(o => now - (Number(o.customMetadata?.at) || o.uploaded.getTime()) > 3 * 86400_000).map(o => o.key);
    if (old.length) await env.MEDIA.delete(old);
    cursor = l.truncated ? l.cursor : undefined;
  } while (cursor);
}
