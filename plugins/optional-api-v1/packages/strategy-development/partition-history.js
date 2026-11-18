import { digest } from '@sesame/plugin-sdk/protocol';
import { isRef } from './records.js';

const intervals = { type: 'array', items: { type: 'array', minItems: 2, maxItems: 2, items: { type: 'integer' } } };
const record = properties => ({ type: 'object', properties, required: Object.keys(properties), additionalProperties: false });
export const partitionCollection = {
  name: 'experiment_partitions', schemaVersion: '1.0.0', mode: 'document', access: 'private',
  schema: { type: 'object', anyOf: [
    record({ development: intervals, holdout: intervals }),
    record({ fingerprint: { type: 'string', pattern: '^sha256:[a-f0-9]{64}$' } }),
  ] },
};

function fail(code, message) { throw Object.assign(new Error(message), { code }); }
const token = value => typeof value === 'string' && value.trim().length > 0;
const overlaps = ([start, end], first, last) => start <= last && first <= end;

// Closed UTC millisecond intervals are stored as a sorted union. Preserve
// unobserved gaps even when two callers use different snapshot IDs or cadences.
function include(ranges, first, last) {
  if (ranges.some(([start, end]) => start <= first && last <= end)) return ranges;
  const merged = [];
  for (const range of [...ranges, [first, last]].sort((a, b) => a[0] - b[0])) {
    const prior = merged.at(-1);
    if (prior && range[0] <= prior[1] + 1) prior[1] = Math.max(prior[1], range[1]);
    else merged.push([...range]);
  }
  return merged;
}

async function read(host, key) {
  try { return await host.state.read(key); }
  catch (error) {
    if (error.code !== 'NOT_FOUND') throw error;
    if (error.details?.deleted) fail('PARTITION_HISTORY_UNAVAILABLE', 'The project partition history was deleted. Restore it before reusing any research partition.');
    return null;
  }
}

/** Reserve a range before dispatch. One index protects all immutable branches
 * of the project; a separate small receipt makes admission exactly replayable.
 * Repeated development on an already covered interval only needs a receipt. */
export async function reservePartition(host, projectKey, role, partition, selectionRef, operationId) {
  if (!token(projectKey) || !token(operationId) || !['development', 'holdout'].includes(role) || !isRef(partition?.ref, 'data') ||
      !Number.isSafeInteger(partition.first) || !Number.isSafeInteger(partition.last) || partition.first > partition.last ||
      (role === 'holdout' ? !isRef(selectionRef, 'resource') : selectionRef != null))
    fail('INVALID_PARTITION', 'A reservation requires a project, original operation, fixed data, ordered UTC boundaries and, for holdout, a frozen selection.');
  const { first, last, ref } = partition;
  const key = { collection: partitionCollection.name, key: 'ranges-' + digest(projectKey).slice(7) };
  const receipt = { collection: key.collection, key: 'receipt-' + digest([projectKey, role, operationId]).slice(7) };
  const fingerprint = digest([role, ref, first, last, selectionRef ?? null]);
  for (;;) {
    const prior = await read(host, receipt);
    if (prior) {
      if (prior.value.fingerprint !== fingerprint) fail('IDEMPOTENCY_CONFLICT', 'This operation already reserved a different partition or frozen candidate.');
      return;
    }
    const index = await read(host, key);
    const ranges = index?.value ?? { development: [], holdout: [] };
    const inHoldout = ranges.holdout.some(range => overlaps(range, first, last));
    const inDevelopment = role === 'holdout' && ranges.development.some(range => overlaps(range, first, last));
    if (inHoldout || inDevelopment) {
      // Another invocation of this exact request may have committed between
      // the receipt and index reads. Resolve its identity before refusing it.
      const concurrent = await read(host, receipt);
      if (concurrent?.value.fingerprint === fingerprint) return;
      if (concurrent) fail('IDEMPOTENCY_CONFLICT', 'This operation reserved different inputs concurrently.');
      fail('PARTITION_ALREADY_OBSERVED', inHoldout ? 'This range has already been reserved for holdout in this project.' :
        'This range has already been used for development in this project. Choose an untouched holdout.');
    }
    const merged = include(ranges[role], first, last);
    const changes = [{ op: 'put', key: receipt, expectedVersion: 0, value: { fingerprint } }];
    if (merged !== ranges[role]) changes.push({ op: 'put', key, expectedVersion: index?.version ?? 0, value: { ...ranges, [role]: merged } });
    try { await host.state.commit(changes); return; }
    catch (error) {
      if (error.code !== 'VERSION_CONFLICT') throw error;
      // Re-read winners and the current merged ranges after a concurrent CAS.
    }
  }
}
