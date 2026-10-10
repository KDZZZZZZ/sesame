import test from 'node:test';
import assert from 'node:assert/strict';
import { startDecisionBridge } from '../packages/strategy-authoring/lib/decision-bridge.js';

test('local backend bridge authenticates and returns a queued job without waiting for a model', async t => {
  const calls = [], job = { id: 'job', request: { requestId: 'request', program: { failurePolicy: 'halt_new_risk' }, scope: { runId: 'run' }, inputs: [] }, status: 'queued', output: null };
  const decisions = { submit: body => { calls.push(body); return job; }, get: id => { assert.equal(id, 'job'); return job; }, timeline: (scope, asOf) => ({ scope, asOf, signals: [], modelInvocations: 0 }) };
  const bridge = await startDecisionBridge(decisions); t.after(() => bridge.close());
  const headers = { authorization: `Bearer ${bridge.token}`, 'content-type': 'application/json' };
  assert.match(bridge.endpoint, /^http:\/\/127\.0\.0\.1:/);
  assert.equal((await fetch(`${bridge.endpoint}/health`)).status, 401);
  assert.equal((await fetch(`${bridge.endpoint}/health`, { headers: { ...headers, origin: 'https://example.invalid' } })).status, 401);
  assert.equal(calls.length, 0);
  const queued = await fetch(`${bridge.endpoint}/requests`, { method: 'POST', headers, body: JSON.stringify({ requestId: 'request' }) });
  assert.equal(queued.status, 202); assert.equal((await queued.json()).status, 'queued'); assert.equal(calls.length, 1);
  const status = await (await fetch(`${bridge.endpoint}/requests/job`, { headers })).json(); assert.equal(status.output, null);
  const replay = await (await fetch(`${bridge.endpoint}/timeline`, { method: 'POST', headers, body: JSON.stringify({ jobId: 'job', asOf: { basis: 'utc', unixMs: 100 } }) })).json();
  assert.equal(replay.modelInvocations, 0);
  assert.equal((await fetch(`${bridge.endpoint}/health`, { method: 'DELETE', headers })).status, 405);
  assert.equal((await fetch(`${bridge.endpoint}/requests`, { method: 'POST', headers, body: '{invalid' })).status, 422);
});

test('bridge failures return bounded errors and never leak backend error text', async t => {
  const bridge = await startDecisionBridge({ submit: () => { throw new Error('private provider credential'); } }); t.after(() => bridge.close());
  const response = await fetch(`${bridge.endpoint}/requests`, { method: 'POST', headers: { authorization: `Bearer ${bridge.token}` }, body: '{}' });
  assert.equal(response.status, 422); assert.equal((await response.text()).includes('credential'), false);
});

test('backend cancellation and invalidation forward an explicit historical UTC clock unchanged', async t => {
  const asOf = { basis: 'utc', unixMs: 1020 }, evidence = [{ id: 'frozen-evidence' }], scope = { runId: 'historical-run' }, calls = [];
  const job = { id: 'job', request: { requestId: 'request', program: { failurePolicy: 'halt_new_risk' }, scope, inputs: evidence.map(ref => ({ ref })) }, status: 'canceled', output: null };
  const bridge = await startDecisionBridge({ get: () => job,
    cancel: (...args) => { calls.push(['cancel', ...args]); return job; },
    invalidate: (...args) => { calls.push(['invalidate', ...args]); return { epoch: 1 }; },
  }); t.after(() => bridge.close());
  const headers = { authorization: `Bearer ${bridge.token}`, 'content-type': 'application/json' };
  const post = (path, body) => fetch(`${bridge.endpoint}/${path}`, { method: 'POST', headers, body: JSON.stringify(body) });
  assert.equal((await post('cancel', { jobId: 'job', reason: 'Stop waiting', asOf })).status, 200);
  assert.equal((await post('invalidate', { jobId: 'job', reason: 'Historical context changed', asOf })).status, 200);
  assert.deepEqual(calls, [['cancel', 'job', 'Stop waiting', asOf], ['invalidate', scope, 'Historical context changed', evidence, asOf]]);
});
