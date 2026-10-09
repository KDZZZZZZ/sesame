import { MT5 } from './backend/service.js';
import { MT5ConfigImports } from './backend/config-import.js';
import { MT5AutoConnection } from './backend/auto-connect.js';
import { MT5MarketProvider, MT5AccountProvider, marketDescriptor, accountDescriptor } from './backend/providers.js';
import { migrate } from './backend/migration.js';
import { requireValue } from './backend/support.js';
import { protectRun, cleanupRun } from './backend/lifecycle.js';
import { NativeRunObserver } from './backend/run-observer.js';
import { instance, setInstance } from './state.js';
import { createTools as official } from './tools/official/index.js';
import { createTools as charts } from './tools/charts/index.js';
import { createTools as editor } from './tools/editor/index.js';
import { createTools as python } from './tools/python/index.js';
import { createTools as system } from './tools/system/index.js';
import { createTools as tester } from './tools/tester/index.js';
import { createTools as trading } from './tools/trading/index.js';
import { createTools as deployment } from './tools/deployment/index.js';
import { createTools as authoring } from './tools/authoring/index.js';
import { createTools as configuration } from './tools/configuration.js';
import { createTools as evidence } from './tools/evidence.js';
import { createTools as strategy } from './tools/strategy.js';

export function createTools(host) {
  const { mt5, imports } = instance(host);
  return [official, charts, editor, python, system, tester, trading, deployment, authoring, configuration, evidence, strategy].flatMap(factory => factory(host, mt5, imports));
}

export async function activate(host, options = {}) {
  await migrate(host);
  const mt5 = await new MT5(host, options).init();
  const imports = new MT5ConfigImports(host);
  const disposers = [];
  try {
    mt5.runObserver = new NativeRunObserver(host, mt5);
    for (const value of mt5.deployments.list()) if (['preparing', 'attaching', 'running', 'unknown'].includes(value.status)) mt5.runObserver.deployment(value, true);
    for (const value of mt5.tester.list()) if (['queued', 'running', 'canceling', 'unknown'].includes(value.status)) mt5.runObserver.backtest(mt5.tester.get(value.id), true);
    setInstance(host, { mt5, imports });
    disposers.push(host.providers.register(marketDescriptor, new MT5MarketProvider(mt5)));
    disposers.push(host.providers.register(accountDescriptor, new MT5AccountProvider(mt5)));
    disposers.push(host.datasets.registerSource('bars', 'MT5 券商墙钟历史 K 线；查询可下载至插件持久缓存', async (input, signal) => {
      signal?.throwIfAborted();
      const result = await mt5.market.query(input); signal?.throwIfAborted();
      return { rows: result.bars, offset_applied: true, has_more: result.has_more, next_before: result.next_before,
        provenance: { kind: 'observed', provider: 'sesame/mt5', source: `${result.server}/${result.symbol}/${result.period}`, acquired_at: result.updated_at, time_basis: result.time_basis, known_issues: ['Historical native cache uses numeric prices and tick volume; use the market provider for typed field availability.'] } };
    }, { identity: () => [mt5.official.config.version, mt5.official.config.account] }));
    if (!options.disabled && options.autoConnect !== false) { mt5.monitor = new MT5AutoConnection(host, mt5).start(); mt5.runObserver.start(); }
  } catch (error) { await Promise.allSettled(disposers.reverse().map(dispose => dispose())); await mt5.close(); setInstance(host, null); throw error; }
  return {
    beforeMessage: ({ messageId, conversation, parts, source, metadata = {} }) => imports.prepare(messageId, conversation, parts, source, metadata),
    beforeConfiguration() { requireValue(!mt5.tester.pending.size, 'MT5 Tester 进行中，请待操作结束后修改配置', 409, 'mt5_busy'); },
    beforeDeactivate() { requireValue(!mt5.deployments.list().some(value => ['preparing', 'attaching', 'running', 'unknown'].includes(value.status)), '仍有运行中或状态未确认的 MT5 EA；必须保留插件观察与管理通道', 409, 'ACTIVE_RUNS'); },
    configurationChanged() { mt5.monitor?.settingsChanged(); },
    cleanupRun: (runId, protection) => cleanupRun(host, mt5, runId, protection),
    protectArtifacts: runId => protectRun(host, mt5, runId),
    async dispose() {
      await mt5.monitor?.close();
      await mt5.runObserver?.close();
      await Promise.allSettled(disposers.reverse().map(dispose => dispose()));
      await mt5.close(); setInstance(host, null);
    },
  };
}
