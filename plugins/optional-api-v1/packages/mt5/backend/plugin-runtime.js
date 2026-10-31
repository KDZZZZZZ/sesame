import { MT5 } from './service.js';
import { MT5ConfigImports } from './config-import.js';
import { MT5AutoConnection } from './auto-connect.js';
import { MT5MarketProvider, MT5AccountProvider } from './providers.js';
import { providerOperations, providerCall, datasetQuery, runQuery, runWatch, paginate } from './sources.js';
import { requireValue } from './support.js';
import { records } from './records.js';
import { protectRun, cleanupRun } from './lifecycle.js';
import { NativeRunObserver } from './run-observer.js';
import { instance, setInstance } from '../state.js';
import { createCapabilities as official } from '../tools/official/index.js';
import { createCapabilities as charts } from '../tools/charts/index.js';
import { createCapabilities as editor } from '../tools/editor/index.js';
import { createCapabilities as python } from '../tools/python/index.js';
import { createCapabilities as system } from '../tools/system/index.js';
import { createCapabilities as tester } from '../tools/tester/index.js';
import { createCapabilities as trading } from '../tools/trading/index.js';
import { createCapabilities as deployment } from '../tools/deployment/index.js';
import { createCapabilities as authoring } from '../tools/authoring/index.js';
import { createCapabilities as configuration } from '../tools/configuration.js';
import { createCapabilities as evidence } from '../tools/evidence.js';
import { createCapabilities as strategy } from '../tools/strategy.js';
import { createCapabilities as dependencies } from '../tools/dependencies.js';
import { createCapabilities as tradingContext } from '../tools/trading-context.js';
import { createPositionCapabilities } from '../positions.js';
import { createExecutionCapabilities } from './execution-adapter.js';

const factories = [official, charts, editor, python, system, tester, trading, deployment, authoring, configuration, evidence, strategy, dependencies, tradingContext, createPositionCapabilities, createExecutionCapabilities];
const mainOnly = new Set(['mt5_deployment', 'mt5_settings', 'mt5_update_configuration', 'mt5_import_configuration', 'mt5_start_terminal', 'mt5_connect', 'mt5_trading_permissions', 'mt5_trading_prepare', 'mt5_dependencies', 'dependencies.configure']);
async function activate(host, options = {}) {
  const mt5 = await new MT5(host, options).init();
  const imports = new MT5ConfigImports(host, Date.now, () => mt5.official.settings().account);
  const service = { mt5, imports, providers: { market: new MT5MarketProvider(mt5), account: new MT5AccountProvider(mt5) } };
  try {
    mt5.runObserver = new NativeRunObserver(host, mt5); setInstance(host, service);
    await mt5.deployments.flushObservations();
    for (const value of mt5.deployments.list()) if (['preparing', 'attaching', 'running', 'unknown'].includes(value.status)) await mt5.runObserver.deployment(value, true);
    for (const value of mt5.tester.list()) if (['queued', 'running', 'canceling', 'unknown'].includes(value.status)) await mt5.runObserver.backtest(mt5.tester.get(value.id), true);
    if (!options.disabled && options.autoConnect !== false) { mt5.monitor = new MT5AutoConnection(host, mt5).start(); mt5.runObserver.start(); }
    return { ready: true };
  } catch (error) { await mt5.close(); setInstance(host, null); throw error; }
}
async function dispose(host) {
  const service = instance(host), { mt5 } = service;
  mt5.host = host; mt5.official.host = host; mt5.runObserver.host = host;
  if (mt5.monitor) mt5.monitor.host = host;
  await mt5.monitor?.close();
  for (const provider of Object.values(service.providers)) provider.dispose();
  await mt5.close(); await mt5.runObserver?.close();
  setInstance(host, null); records(host).close(); return { closed: true };
}
export async function executeCapability(host, name, input, signal, executionContext) {
  if (name === 'activate') return activate(host, input.config ?? {});
  if (name === 'dispose') return dispose(host);
  const service = instance(host), { mt5, imports } = service;
  if (name === 'beforeAgentTurn') return { parts: imports.prepare(input.messageId, input.conversation, input.parts, input.source, input.metadata ?? {}) };
  if (name === 'beforeConfigChange') { requireValue(!mt5.tester.pending.size, 'MT5 Tester 进行中，请待操作结束后修改配置', 409, 'mt5_busy'); return {}; }
  if (name === 'beforeDeactivate') { requireValue(!mt5.deployments.list().some(value => ['preparing', 'attaching', 'running', 'unknown'].includes(value.status)), '仍有运行中或状态未确认的 MT5 EA；必须保留插件观察与管理通道', 409, 'ACTIVE_RUNS'); return {}; }
  if (name === 'configChanged') { mt5.monitor?.settingsChanged(); return {}; }
  if (name === 'beforeRunRelease') { const protection = await protectRun(host, mt5, input.runId); await cleanupRun(host, mt5, input.runId, protection); return protection; }
  if (name === 'datasets.query') return datasetQuery(host, service, input);
  if (name === 'runs.query') return runQuery(service, input);
  if (name === 'runs.watch') return runWatch(service, input, signal);
  if (name === 'bars.query') { const value = await mt5.market.query(input.query); signal?.throwIfAborted(); const { bars, ...metadata } = value; return paginate(bars, input.page ?? {}, { metadata }); }
  for (const [domain, operations] of Object.entries(providerOperations)) {
    const operation = name.startsWith(`${domain}.`) ? name.slice(domain.length + 1) : '';
    if (operations.includes(operation)) return providerCall(service, domain, operation, input, signal);
  }
  if (mainOnly.has(name)) requireValue(host.context.kind === 'main', 'This MT5 capability requires the main conversation', 403, 'FORBIDDEN');
  const handler = factories.flatMap(factory => factory(host, mt5, imports)).find(item => item.name === name);
  requireValue(handler, `Missing MT5 capability implementation: ${name}`, 500, 'BINDING_NOT_FOUND');
  return handler.execute(input, signal, executionContext);
}
