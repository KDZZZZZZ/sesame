const pending = new Map();

/** Durable operation identity; unfinished attempts are reconciled by each action. */
export function operation(host, id, fingerprint, action) {
  const identity = `${host.context.storageRoot}\0${id}`;
  const run = async () => {
    const key = { collection: 'operations', key: id };
    let record;
    try { record = await host.state.read(key); }
    catch (error) { if (error.code !== 'NOT_FOUND') throw error; }
    if (record && record.value.fingerprint !== fingerprint) throw Object.assign(new Error('Operation ID was reused with different inputs'), { code: 'IDEMPOTENCY_CONFLICT' });
    if (record?.value.status === 'completed') return record.value.result;
    if (!record) {
      const saved = await host.state.commit([{ op: 'put', key, expectedVersion: 0, value: { fingerprint, status: 'running' } }], { operationId: `reserve:${id}` });
      record = saved.entries[0];
    }
    const result = await action();
    await host.state.commit([{ op: 'put', key, expectedVersion: record.version, value: { fingerprint, status: 'completed', result } }], { operationId: `complete:${id}` });
    return result;
  };
  const task = (pending.get(identity) ?? Promise.resolve()).catch(() => {}).then(run);
  const tail = task.catch(() => {});
  pending.set(identity, tail);
  void tail.finally(() => { if (pending.get(identity) === tail) pending.delete(identity); });
  return task;
}
