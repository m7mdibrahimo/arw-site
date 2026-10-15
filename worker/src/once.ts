// Table setup, run once per isolate and remembered only after it worked (2026-10-15). A promise shared between requests
// stays pending for ever when the request that started it is cut off (a visitor leaving the page): the Workers runtime
// never settles one request's I/O inside another. Every later request then waited on it, so the community stayed on
// «جار الاتصال…» and the panel's «الأعضاء» kept spinning. Now each request that finds it not done runs it itself (every
// step is «IF NOT EXISTS», or an ALTER whose failure is fine), and the first one that finishes marks it done.
const done = new WeakMap<object, Set<string>>();
export async function once(db: object, key: string, run: () => Promise<unknown>): Promise<void> {
  if (done.get(db)?.has(key)) return;
  await run();
  let s = done.get(db);
  if (!s) done.set(db, (s = new Set()));
  s.add(key);
}
