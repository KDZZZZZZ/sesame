import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createExecutionCapabilities as mt5Capabilities } from '../packages/mt5/backend/execution-adapter.js';
import { createExecutionCapabilities as qmtCapabilities } from '../packages/qmt/execution-adapter.js';
import { records, closeRecords } from '../packages/qmt/records.js';
import { parseYaml } from '../../protocol/directory.mjs';
import { Value } from '@sesame/plugin-sdk/schema/value';

function fixture(t, backend, changeRevision = false) {
  const context = { kind: 'subagent', pluginId: 'sesame/' + backend, sessionId: 'child', runId: 'workflow-run', ownerSessionId: 'parent' };
  const host = { context }, calls = [];
  const name = backend + '_execution_snapshot';
  const controller = 'sesame/trading-decision#trading_decision_workflow_execute';
  const reader = 'sesame/portfolio-execution#portfolio_execution_context';
  const proof = {
    workflow: { runId: context.runId, sessionId: context.sessionId, ownerSessionId: context.ownerSessionId },
    caller: { pluginId: 'sesame/portfolio-execution', capabilityId: reader, sessionId: context.sessionId, runId: context.runId },
    chain: [controller, reader, context.pluginId + '#' + name].map(capabilityId => ({ capabilityId, pluginId: capabilityId.split('#')[0] })),
  };
  let tools, account;
  if (backend === 'mt5') {
    account = { accountId: '123', server: 'fixture', revision: '1' };
    const config = { version: 1, account: { login: '123', server: 'fixture' } };
    const data = { account_info: { login: '123', server: 'fixture' }, terminal_info: { connected: true },
      positions_get: [], orders_get: [], history_deals_get: [], history_orders_get: [] };
    tools = mt5Capabilities(host, { deployments: { list: () => [] }, official: {
      settings: () => config,
      call: async ({ tool }) => {
        calls.push(tool);
        if (changeRevision) config.version++;
        return { status: 'returned', result: { result: data[tool] } };
      },
    } });
  } else {
    account = { accountId: '123', connectionId: 'fixture', revision: '1' };
    context.storageRoot = mkdtempSync(join(tmpdir(), 'workflow-snapshot-'));
    t.after(() => { closeRecords(host); rmSync(context.storageRoot, { recursive: true, force: true }); });
    const config = { id: 'local', version: 1, account_id: '123', connection_id: 'fixture' };
    records(host).put('configuration', config);
    tools = qmtCapabilities(host, () => ({
      async native(action) {
        calls.push(action);
        if (changeRevision) records(host).put('configuration', { ...config, version: 2 });
        const connection = { id: 'fixture', revision: '1' };
        return action === 'asset' ? { connection, asset: { account_id: '123' } } : { connection, items: [] };
      },
    }));
  }
  const invoke = (cap, input, provenance) => tools.find(tool => tool.name === backend + '_execution_' + cap)
    .execute(input, undefined, { provenance });
  return { invoke, proof, account, calls };
}

for (const backend of ['mt5', 'qmt']) {
  test(backend + ' reads a whole-account snapshot through the authenticated portfolio workflow', async t => {
    const f = fixture(t, backend);
    const input = { history_days: 3, expected_account: f.account };
    const path = new URL('../packages/' + backend + '/tools/' + backend + '_execution_snapshot.yaml', import.meta.url);
    const schema = parseYaml(readFileSync(path), path.pathname).inputSchema;
    assert.ok(Value.Check(schema, input));
    assert.equal(Value.Check(schema, { ...input, symbol: 'TEST' }), false);
    assert.equal(Value.Check(schema, { expected_account: { accountId: '123' } }), false);
    const result = await f.invoke('snapshot', input, f.proof);
    assert.deepEqual(result.account, f.account);
    assert.deepEqual(result.positions, []);
    assert.ok(f.calls.length > 0);
  });

  test(backend + ' rejects an unbound, stale or misrouted workflow before native reads', async t => {
    const f = fixture(t, backend);
    for (const mutate of [
      p => { delete p.workflow; }, p => { p.workflow.ownerSessionId = 'other'; },
      p => { p.workflow.sessionId = 'other'; }, p => { p.workflow.runId = 'other'; },
      p => { p.caller.sessionId = 'other'; }, p => { p.caller.capabilityId = 'other#cap'; },
      p => { p.caller.pluginId = 'other'; }, p => { p.caller.runId = 'other'; },
      p => { p.chain.shift(); }, p => { p.chain[0].capabilityId = 'sesame/trading-decision#other'; },
      p => { p.chain[1].capabilityId = 'sesame/portfolio-execution#portfolio_execution_apply'; },
      p => { p.chain[2].capabilityId = 'sesame/' + backend + '#' + backend + '_trading_context'; },
      p => { p.agent = { sessionId: 'other' }; },
    ]) {
      const proof = structuredClone(f.proof); mutate(proof);
      await assert.rejects(f.invoke('snapshot', { expected_account: f.account }, proof), { code: 'FORBIDDEN' });
    }
    for (const key of Object.keys(f.account)) {
      await assert.rejects(f.invoke('snapshot', { expected_account: { ...f.account, [key]: 'changed' } }, f.proof),
        { code: 'ACCOUNT_MISMATCH' });
    }
    await assert.rejects(f.invoke('snapshot', {}, f.proof), { code: 'FORBIDDEN' });
    await assert.rejects(f.invoke('snapshot', { expected_account: f.account, symbol: 'TEST' }, f.proof), { code: 'INVALID_ARGUMENT' });
    await assert.rejects(f.invoke('identity', {}, f.proof), { code: 'FORBIDDEN' });
    assert.deepEqual(f.calls, []);
  });

  test(backend + ' stops the workflow snapshot when configuration changes during its first read', async t => {
    const f = fixture(t, backend, true);
    await assert.rejects(f.invoke('snapshot', { expected_account: f.account }, f.proof), { code: 'CONNECTION_CHANGED' });
    assert.deepEqual(f.calls, [backend === 'mt5' ? 'account_info' : 'asset']);
  });
}
