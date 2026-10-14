// A visitor told when someone answers their comment (owner 2026-10-14: «عايز يجي تنبيه للمتابع لما يعمل تعليق وانا ارد
// عليه … او اي حد يرد عليه عموما يجيله تنبيه او اشعار»).
//
// No account: the visitor's browser makes a secret key the first time it comments (localStorage), sends it with each
// comment, and only its hash is kept with the comment (comments.owner). With the same key the browser asks for the
// answers to its comments (POST /comments/inbox), on every page of the site (assets/features.js) and from its
// service worker (sw.js) when a push wakes it.
//
// The push itself is the web's standard one with no message in it (no encryption needed): the site's own key pair
// (VAPID, made here the first time and kept in KV, nothing to set up by hand) signs a call to the browser's push
// service, which wakes sw.js; sw.js then asks the inbox and shows «عرب راسلنج رد على تعليقك».
//
//   GET  /comments/push-key   the site's public key, for the browser's subscription
//   POST /comments/push       {k, endpoint}: this browser's push address, kept for its key (KV, 180 days)

const VAPID_KV = "comments:vapid";
const SUB_KV = (owner: string) => `comments:push:${owner}`;
const SUBJECT = "https://arab-wrestling.com";
// the browsers' push services, and nothing else (the worker never calls an address a page made up)
const PUSH_HOSTS = /(^|\.)(fcm\.googleapis\.com|push\.services\.mozilla\.com|web\.push\.apple\.com|notify\.windows\.com|push\.apple\.com)$/;

export const b64u = (buf: ArrayBuffer | Uint8Array) =>
  btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

/** A visitor's key → what is kept with their comments (never the key itself) */
export const OWNER_KEY = /^[A-Za-z0-9_-]{20,64}$/;
export async function ownerOf(k: unknown): Promise<string> {
  if (!OWNER_KEY.test(String(k || ""))) return "";
  const h = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`arw-comments|${k}`)));
  return Array.from(h.slice(0, 16), b => b.toString(16).padStart(2, "0")).join("");
}

type Stored = { priv: JsonWebKey; pub: string };
/** The site's VAPID key pair: made once, then always the same one (every subscription is tied to it) */
export async function vapidKeys(kv: KVNamespace): Promise<{ pub: string; key: CryptoKey }> {
  let raw = await kv.get(VAPID_KV);
  if (!raw) {
    const pair = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]) as CryptoKeyPair;
    const priv = await crypto.subtle.exportKey("jwk", pair.privateKey) as JsonWebKey;
    const pub = b64u(await crypto.subtle.exportKey("raw", pair.publicKey) as ArrayBuffer);
    await kv.put(VAPID_KV, JSON.stringify({ priv, pub }));
    raw = (await kv.get(VAPID_KV)) || JSON.stringify({ priv, pub }); // two at once: the one kept wins
  }
  const s = JSON.parse(raw) as Stored;
  const key = await crypto.subtle.importKey("jwk", s.priv, { name: "ECDSA", namedCurve: "P-256" }, false, ["sign"]);
  return { pub: s.pub, key };
}

export function validEndpoint(endpoint: unknown): string {
  try {
    const u = new URL(String(endpoint || ""));
    return u.protocol === "https:" && PUSH_HOSTS.test(u.hostname) && u.href.length < 1024 ? u.href : "";
  } catch { return ""; }
}

/** Keeps a browser's push address for a visitor (the 3 newest: a phone and a computer or two) */
export async function savePush(kv: KVNamespace, owner: string, endpoint: string) {
  const list: string[] = JSON.parse((await kv.get(SUB_KV(owner))) || "[]");
  const next = [endpoint, ...list.filter(e => e !== endpoint)].slice(0, 3);
  await kv.put(SUB_KV(owner), JSON.stringify(next), { expirationTtl: 180 * 86400 });
}

/** One empty push, signed with the site's key; the push service's answer (201 sent, 404/410 gone) */
export async function pushOnce(kv: KVNamespace, endpoint: string, f: typeof fetch = fetch): Promise<number> {
  const { pub, key } = await vapidKeys(kv);
  const enc = (o: unknown) => b64u(new TextEncoder().encode(JSON.stringify(o)));
  const unsigned = `${enc({ typ: "JWT", alg: "ES256" })}.${enc({ aud: new URL(endpoint).origin, exp: Math.floor(Date.now() / 1000) + 12 * 3600, sub: SUBJECT })}`;
  const sig = await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, key, new TextEncoder().encode(unsigned));
  const r = await f(endpoint, { method: "POST", headers: { TTL: "86400", Urgency: "normal", Authorization: `vapid t=${unsigned}.${b64u(sig)}, k=${pub}`, "Content-Length": "0" } });
  return r.status;
}

/** Wakes every browser a visitor asked to be told on; addresses that are gone are forgotten */
export async function notifyOwner(kv: KVNamespace, owner: string, f: typeof fetch = fetch): Promise<number> {
  if (!owner) return 0;
  const list: string[] = JSON.parse((await kv.get(SUB_KV(owner))) || "[]");
  if (!list.length) return 0;
  const keep: string[] = [];
  let sent = 0;
  for (const e of list) {
    try {
      const s = await pushOnce(kv, e, f);
      if (s === 404 || s === 410) continue;
      if (s >= 200 && s < 300) sent++;
      keep.push(e);
    } catch { keep.push(e); }
  }
  if (keep.length !== list.length) {
    if (keep.length) await kv.put(SUB_KV(owner), JSON.stringify(keep), { expirationTtl: 180 * 86400 });
    else await kv.delete(SUB_KV(owner));
  }
  return sent;
}
