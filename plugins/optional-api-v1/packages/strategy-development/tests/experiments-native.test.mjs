import test from 'node:test';
import assert from 'node:assert/strict';
import { cp, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { runExperiments } from '../experiments.js';

const root = process.env.SESAME_HOST_ROOT, python = process.env.SESAME_QUANT_PYTHON;
const packages = fileURLToPath(new URL('../../', import.meta.url));
test('installed Backtrader runs 200 real Cerebro passes and confirms one frozen selection on later demo bars', {
  skip: !root || !python, timeout: 240000,
}, async t => {
  const { Store } = await import(pathToFileURL(join(root, 'modules/agent/store.js')));
  const { Runtime } = await import(pathToFileURL(join(root, 'modules/agent/runtime.js')));
  const { createHostContextV2 } = await import(pathToFileURL(join(root, 'modules/plugins/host-v2/context.js')));
  const directory = await mkdtemp(join(tmpdir(), 'sesame-native-parameter-search-'));
  const store = new Store(join(directory, 'app'));
  const runtime = await new Runtime(store, { piDir: join(directory, 'pi'), officialPluginsDirectory: join(directory, 'empty') }).init();
  t.after(async () => { await runtime.close(); store.close(); await rm(directory, { recursive: true, force: true }); });
  const workspace = runtime.workspaces.root('conv_main');
  for (const name of ['backtrader', 'strategy-development']) {
    const draft = join(workspace, 'draft-' + name);
    await cp(join(packages, name), draft, { recursive: true });
    const tested = await runtime.plugins.manager.test('conv_main', { path: draft });
    assert.equal(tested.passed, true, JSON.stringify(tested));
    const installed = await runtime.plugins.manager.install('conv_main', { path: draft, digest: tested.digest });
    assert.equal(installed.runtime_status, 'ready');
    runtime.plugins.activate('conv_main', installed.id);
  }
  const host = createHostContextV2(runtime, runtime.plugins.entry('sesame/strategy-development'), 'conv_main');
  function bars(name, initialDay, slope) {
    const rows = Array.from({ length: 30 }, (_, i) => ({
      datetime: new Date(Date.UTC(2025, 0, initialDay + i)).toISOString(),
      open: String(100 + slope * i), high: String(102 + slope * i), low: String(99 + slope * i), close: String(101 + slope * i), volume: '1000',
    }));
    return runtime.contractArtifacts.publish({ id: 'fixture/demo-bars', version: '1.0.0', digest: 'sha256:' + 'a'.repeat(64) }, {
      operationId: name, manifest: { kind: 'data', schemaVersion: '1.0.0', content: {
        format: 'json-rows', path: 'rows.json', rowCount: rows.length, columns: Object.keys(rows[0]), provenance: { kind: 'demo' },
      }, dependencies: [], blobs: [{ path: 'rows.json', mediaType: 'application/json', ...runtime.contractArtifacts.blob(JSON.stringify(rows)) }] },
    });
  }
  const development = bars('development', 1, 1), holdout = bars('independent', 40, -1);
  const file = join(workspace, 'Grid.py');
  await writeFile(file, [
    'import backtrader as bt',
    'class Grid(bt.Strategy):',
    "    params = (('entry', 1), ('size', 1))",
    '    def next(self):',
    '        if len(self) == self.p.entry: self.buy(size=self.p.size)',
    '        elif len(self) == 24 and self.position: self.close()',
  ].join('\n'));
  const request = {
    backend: 'backtrader', operation_id: 'controlled-native-search', title: 'Fictional data, native grid search', development,
    strategy_path: 'Grid.py', class_name: 'Grid', python_path: python, max_trials: 200,
    parameter_space: { size: Array.from({ length: 10 }, (_, i) => i + 1), entry: Array.from({ length: 20 }, (_, i) => i + 1) },
    config: { capital: '10000', commission: '0.001', slippage: '0.0005', feed: { timeframe: 'days', compression: 1 } },
    objective: { metric: 'netReturn', direction: 'maximize' }, constraints: [{ metric: 'maxDrawdown', op: '<=', value: 0.10 }],
  };
  const search = await runExperiments(host, request);
  assert.equal(search.status, 'selected', JSON.stringify({ gaps: search.gaps, failedRuns: runtime.runs.list({}).filter(run => run.error).map(({ capabilityId, status, error }) => ({ capabilityId, status, error })) }));
  assert.equal(search.counts.completed, 200); assert.equal(search.counts.uncompleted, 0); assert.equal(search.batches.length, 4);
  assert.deepEqual(search.best.parameters, { entry: 1, size: 10 }); assert.ok(search.best.metrics.netReturn > 0); assert.equal(search.best.metrics.closedTrades, 1);
  assert.equal(search.holdout, null);
  const selection = runtime.contractArtifacts.read(search.selectionRef).manifest;
  assert.equal(selection.provenance.kind, 'demo');
  for (const batch of search.batches) {
    const actual = runtime.contractArtifacts.read(batch.resultRef).manifest.content;
    assert.equal(actual.engine.version, '1.9.78.123'); assert.equal(actual.optimizer.method, 'Cerebro.optstrategy');
  }
  await writeFile(file, 'raise RuntimeError("authored file was changed after parameter selection")');
  const confirm = { backend: 'backtrader', operation_id: 'native-independent-confirmation', selection_ref: search.selectionRef, holdout, python_path: python };
  const tested = await runExperiments(host, confirm);
  assert.equal(tested.status, 'completed', JSON.stringify(tested.gaps));
  assert.ok(tested.holdout.metrics.netReturn < 0); assert.equal(tested.holdout.metrics.closedTrades, 1);
  assert.deepEqual(tested.best, search.best);
  const summary = await runExperiments(host, confirm);
  assert.deepEqual(summary.holdout.resultRef, tested.holdout.resultRef);
  assert.equal(runtime.runs.list({ capabilityId: 'sesame/backtrader#backtrader_optimize' }).length, 4);
  assert.equal(runtime.runs.list({ capabilityId: 'sesame/backtrader#backtrader_backtest' }).length, 1);
  const robust = await runExperiments(host, { ...request, operation_id: 'native-neighborhood', max_trials: 15,
    strategy_path: 'strategy-frozen-' + search.source.digest.slice(7) + '.py', source_digest: search.source.digest,
    parameter_space: { entry: [1, 2, 3, 4, 5], size: [1, 2, 3] }, selection: { method: 'neighborhood_worst' },
    holdout: bars('fresh-independent', 80, -1) });
  assert.equal(robust.status, 'completed', JSON.stringify(robust.gaps));
  assert.deepEqual(robust.pointBest.parameters, { entry: 1, size: 3 });
  assert.deepEqual(robust.best.parameters, { entry: 2, size: 2 });
  assert.equal(robust.selectionCoverage.supportedCenters, 3); assert.equal(robust.selectionCoverage.observedPoints, 15);
  assert.equal(robust.robustCandidate.supportCount, 5);
  assert.equal(robust.robustCandidate.worstScore, Math.min(robust.best.score, ...robust.developmentNeighbors.map(n => n.score)));
  assert.equal(robust.holdout.metrics.closedTrades, 1); assert.ok(robust.holdout.metrics.netReturn < 0);
  assert.equal(runtime.runs.list({ capabilityId: 'sesame/backtrader#backtrader_optimize' }).length, 5);
  assert.equal(runtime.runs.list({ capabilityId: 'sesame/backtrader#backtrader_backtest' }).length, 2);
  t.diagnostic(JSON.stringify({ engine: 'Cerebro 1.9.78.123', provenance: 'demo', trials: search.counts.completed, batches: search.batches.length,
    parameters: search.best.parameters, developmentNetReturn: search.best.metrics.netReturn, independentNetReturn: tested.holdout.metrics.netReturn,
    robust: { trials: robust.counts.completed, pointBest: robust.pointBest.parameters, selected: robust.best.parameters,
      supportedCenters: robust.selectionCoverage.supportedCenters, measuredWorst: robust.robustCandidate.worstScore, independentNetReturn: robust.holdout.metrics.netReturn } }));
});
