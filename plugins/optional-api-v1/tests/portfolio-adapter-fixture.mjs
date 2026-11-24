import {readPackageDirectory} from '../../protocol/directory.mjs';
/** Isolated native boundary fixture: exercise the real adapters against existing
 * scripted native envelopes, never a terminal, worker, AppData or real account. */
import { readFileSync } from 'node:fs';
import { createExecutionAdapter as mt5Adapter } from '../packages/mt5/backend/execution-adapter.js';
import { createExecutionAdapter as qmtAdapter } from '../packages/qmt/execution-adapter.js';

export const manifests = Object.fromEntries(['mt5', 'qmt'].map(backend => [backend, readPackageDirectory(new URL(`../packages/${backend}/`, import.meta.url)).capabilities]));
export function declaredPlugins(read = async () => ({})) {
  return async (id, options = {}) => {
    const status = await read(id, { part: 'status' }), backend = id.split('/').at(-1);
    const version = status?.version ?? (backend === 'mt5' ? '2.1.7' : '2.0.0');
    return options.part === 'manifest' ? { ...structuredClone(manifests[backend]), id, version } : { ...status, version };
  };
}

export function nativeAdapterFixture(host, { now = Date.now } = {}) {
  const invoke = host.capabilities.invoke;
  host.plugins.read = declaredPlugins(host.plugins.read);
  const call = async (backend, name, input, signal) => (await invoke(`sesame/${backend}#${name}`, input, { signal })).value;
  const official = {
    settings: async () => (await call('mt5', 'mt5_settings', {})).settings,
    catalog: (server, query, signal) => call('mt5', 'mt5_catalog', { server, query }, signal),
    call: (args, _owner, signal) => call('mt5', args.tool === 'order_send' ? 'mt5_trade' : 'mt5_python', args, signal),
    command: command_id => call('mt5', 'mt5_command', { command_id }), redact: value => value,
  };
  const adapters = {
    mt5: mt5Adapter(host, { official }, { now, prepare: (_host, _mt5, args, signal) => call('mt5', 'mt5_trading_prepare', args, signal) }),
    qmt: qmtAdapter(host, {
      native: (action, args, signal) => call('qmt', 'qmt_read', { action, ...args }, signal),
      command: (action, args, signal) => call('qmt', action === 'order' ? 'qmt_order' : 'qmt_cancel', args, signal),
      commandRecord: operation_id => call('qmt', 'qmt_command', { operation_id }),
    }, { now, account: async () => { const { configuration: c } = await call('qmt', 'qmt_environment', { action: 'inspect' }); return { accountId: c.account_id, connectionId: c.connection_id, revision: String(c.version) }; } }),
  };
  host.capabilities.invoke = async (id, input, options = {}) => {
    const [plugin, name] = id.split('#'), backend = plugin.split('/').at(-1), prefix = `${backend}_execution_`;
    if (!name.startsWith(prefix)) return invoke(id, input, options);
    return { type: 'result', value: await adapters[backend][name.slice(prefix.length)](input, options.signal) };
  };
  return host;
}

export function delegated(backend, account) {
  const execution = { pluginId: 'sesame/portfolio-execution', applyTool: 'portfolio_execution_apply', contextTool: 'portfolio_execution_context', account, context: { backend, account } };
  return { provenance: { agent: { pluginId: 'fixture/workflow', status: 'running', sessionId: 'child', taskId: 'task', runId: 'task', input: {
    role: 'executor', runId: 'run', tradingPlan: { id: 'plan', ownerConversationId: 'owner', account }, execution,
  } }, chain: [
    { pluginId: 'fixture/workflow', capabilityId: 'fixture/workflow#apply' },
    { pluginId: 'sesame/portfolio-execution', capabilityId: 'sesame/portfolio-execution#portfolio_execution_apply' },
    { pluginId: `sesame/${backend}`, capabilityId: `sesame/${backend}#${backend}_execution_submit` },
  ] } };
}
