import { AsyncLocalStorage } from 'node:async_hooks';
import { canonical } from '@sesame/plugin-sdk/protocol';

const queues = new Map(), ownership = new AsyncLocalStorage();

// Only one account's trading mutation is serialized. A portfolio batch retains
// this lock across its orders; nested service writes reuse the active lock.
// Research, observation and other accounts do not wait for this critical section.
export async function withAccountLock(host, record, action) {
  const key = canonical([host.storage.directory, record.backend, record.account.accountId,
    record.account.server ?? null, record.account.connectionId ?? null]);
  const current = ownership.getStore();
  if (current?.active && current.key === key) return action();
  const previous = queues.get(key), token = { key, active: true };
  const next = Promise.resolve(previous).catch(() => {}).then(() => ownership.run(token, async () => {
    try { return await action(); }
    finally { token.active = false; }
  }));
  queues.set(key, next);
  try { return await next; }
  finally { if (queues.get(key) === next) queues.delete(key); }
}
