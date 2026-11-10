/** The owner's rented encoding machine (reports/سيرفر-التفريغ) as it really is.
 *
 *  2026-11-10: a machine rented at 08:49 was «running» on the rental site, but its setup had stopped on a failed
 *  download (johnvansickle.com answered 415), so it never sent a heartbeat. The panel showed «السيرفر مقفول» (it reads
 *  the heartbeat) while «شغّل السيرفر» answered «السيرفر شغال أصلًا» (it read the rental site) — every press, forever,
 *  with the machine billed by the hour doing nothing. The rental site's «running» is only half: a machine counts as on
 *  when it answers. One that doesn't answer is given time to set itself up, then restarted once, then put away. */

export const ENC_BEAT_MS = 3 * 60_000;     // a heartbeat this fresh = the machine answers (it sends one every 30 s)
export const ENC_SETUP_MS = 25 * 60_000;   // a new machine sets itself up in ~10 minutes
export const ENC_SILENT_MS = 15 * 60_000;  // one that answered before is back within a few minutes of a start
export const ENC_REBOOT_MS = 2 * 3600_000; // one restart per machine in this long, then it's put away

export type EncHealth = "off" | "ok" | "setting-up" | "stuck";
export interface EncBeat { at: number; iid: string }
export interface EncState { health: EncHealth; since: number; knew: boolean }

/** the one machine in a /instances/<id>/ answer (an object, or a list of one) */
export function encInstOf(body: any): any {
  const i = body && (body.instances && !Array.isArray(body.instances) ? body.instances : Array.isArray(body.instances) ? body.instances[0] : null);
  return i && i.id ? i : null;
}

export const encUp = (inst: any) => !!inst && (inst.actual_status === "running" || inst.actual_status === "loading");

/** off: not running at the rental site. ok: it answers. setting-up: running, silent, still within its time.
 *  stuck: running, silent past its time. knew = this machine has answered before (its setup is done). */
export function encHealth(inst: any, beat: EncBeat | null, startedAt: number, now: number): EncState {
  if (!encUp(inst)) return { health: "off", since: 0, knew: false };
  const knew = !!beat && beat.iid === String(inst.id);
  if (beat && now - beat.at < ENC_BEAT_MS && (knew || !beat.iid)) return { health: "ok", since: beat.at, knew: true };
  const since = Math.max((Number(inst.start_date) || 0) * 1000, Number(startedAt) || 0, knew ? beat!.at : 0);
  return { health: !since || now - since >= (knew ? ENC_SILENT_MS : ENC_SETUP_MS) ? "stuck" : "setting-up", since, knew };
}

/** what to do with a stuck machine: restart it once (a failed setup runs again, a hung program starts again); still
 *  silent after that → a machine that never answered is deleted (nothing of his is on it), one that did is stopped
 *  (its disk and setup are kept). rebootMark = KV tools:enc-reboot «<id>:<ms>» */
export function encStuckStep(st: EncState, inst: any, rebootMark: string | null, now: number): "reboot" | "delete" | "stop" | null {
  if (st.health !== "stuck") return null;
  const [rid, rat] = String(rebootMark || "").split(":");
  if (!(rid === String(inst.id) && now - Number(rat) < ENC_REBOOT_MS)) return "reboot";
  return st.knew ? "stop" : "delete";
}

export const encMinutes = (ms: number) => Math.max(1, Math.round(ms / 60_000));

const short = (n: string) => String(n || "").replace(/\s*\(.*\)$/, "") || "جهاز";
const joinAr = (a: string[]) => a.length < 2 ? (a[0] || "") : `${a.slice(0, -1).join("، ")} و${a[a.length - 1]}`;

/** why none of his list could be started, machine by machine: busy with another renter, or its price went up past
 *  what he approved (card > 20¢ an hour or data > $5/TB) */
export function encBusyText(rs: { name: string; why: "busy" | "price" }[]): string {
  const busy = rs.filter(r => r.why === "busy").map(r => short(r.name)), dear = rs.filter(r => r.why === "price").map(r => short(r.name));
  const parts: string[] = [];
  if (busy.length) parts.push(`${joinAr(busy)} ${busy.length > 1 ? "مشغولين" : "مشغول"} مع ناس تانيين`);
  if (dear.length) parts.push(`${joinAr(dear)} ${dear.length > 1 ? "أسعارهم زادت" : "سعره زاد"} عن اللي وافقت عليه`);
  return parts.length ? parts.join("، و") : "مفيش جهاز في قائمتك";
}
