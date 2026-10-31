/** Real installed HostContext configuration path; no QMT SDK or broker calls. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { cp, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = process.env.SESAME_HOST_ROOT, pluginId = 'sesame/qmt';
const packageRoot = fileURLToPath(new URL('../packages/qmt', import.meta.url));

test('QMT shared configuration preserves existing contracts except the explicitly typed history extension', async () => {
  const manifest = JSON.parse(await readFile(join(packageRoot, 'capabilities.json'), 'utf8'));
  const baseline = JSON.parse(await readFile(new URL('../../api-v1/tests/fixtures/plugin-boundaries-baseline.json', import.meta.url), 'utf8'));
  const original = baseline.packages.find(item => item.manifest.id === pluginId).declaration;
  const existing = manifest.capabilities.filter(item => original.capabilities.some(prior => prior.id === item.id));
  assert.deepEqual(existing.map(({ configurationRequirements: _requirements, ...item }) => {
    const prior = original.capabilities.find(row => row.id === item.id);
    if (item.id === 'qmt_trading_context') return { ...item, outputSchema: prior.outputSchema };
    if (['qmt_trading_order', 'qmt_trading_cancel'].includes(item.id)) {
      assert.match(item.description, /does not establish this chain/);
      assert.doesNotMatch(item.description, /or legacy runtime-signed executor intent/);
      return { ...item, description: prior.description };
    }
    return item;
  }), original.capabilities);
  const contextOutput = existing.find(item => item.id === 'qmt_trading_context').outputSchema.oneOf[1];
  assert.ok(contextOutput.required.includes('historicalOrders'));
  assert.equal(contextOutput.properties.historyCoverage.properties.historicalOrders.properties.status.const, 'unavailable');
  assert.equal(contextOutput.properties.historyCoverage.properties.complete.const, false);
  assert.deepEqual(manifest.capabilities.filter(item => !existing.includes(item)).map(item => item.id), ['configuration.read', 'configuration.update',
    ...['identity', 'snapshot', 'prepare', 'submit', 'recover', 'command', 'cancel'].map(operation => `qmt_execution_${operation}`)]);
  for (const id of ['configuration.read', 'configuration.update']) {
    const capability = manifest.capabilities.find(item => item.id === id);
    assert.deepEqual(capability.consumers, ['host']); assert.equal(capability.execution, 'immediate');
  }
  assert.deepEqual(manifest.configuration.fields.map(item => item.id), ['python_path', 'userdata_directory', 'account_id', 'broker', 'market_port', 'sector']);
  assert.equal(new Set(manifest.configuration.fields.map(item => JSON.stringify([item.binding.read, item.binding.update, item.binding.versionPath]))).size, 1);
});

test('installed QMT shared configuration preserves one authority, CAS, read-only discovery, scoped requirements and restart receipts', { skip: !root, timeout: 90000 }, async t => {
  const { Store } = await import(pathToFileURL(join(root, 'modules/agent/store.js')));
  const { Runtime } = await import(pathToFileURL(join(root, 'modules/agent/runtime.js')));
  const { createHostContextV2 } = await import(pathToFileURL(join(root, 'modules/plugins/host-v2/context.js')));
  const directory = await mkdtemp(join(tmpdir(), 'qmt-shared-config-')), python = join(directory, 'never-executed-python.exe');
  let store, runtime, main, qmt, privateRecords, processCalls = 0;
  const open = async () => {
    store = new Store(join(directory, 'app'));
    runtime = await new Runtime(store, { piDir: join(directory, 'pi'), officialPluginsDirectory: join(directory, 'empty') }).init();
    const handler = runtime.capabilities.handler.bind(runtime.capabilities);
    runtime.capabilities.handler = (target, ...args) => target.descriptor.id === 'host.process.exec'
      ? () => { processCalls++; throw new Error('Configuration must not start a process'); } : handler(target, ...args);
    main = createHostContextV2(runtime, runtime.capabilities.hostEntry, 'conv_main');
  };
  const contexts = async () => {
    qmt = createHostContextV2(runtime, runtime.plugins.entry(pluginId), 'conv_main');
    privateRecords = await import(pathToFileURL(join(runtime.plugins.entry(pluginId).root, 'records.js')));
  };
  const close = async () => { if (qmt) privateRecords?.closeRecords(qmt); qmt = null; await runtime?.close(); runtime = null; store?.close(); store = null; };
  const call = async (id, input, context = qmt) => {
    // Fixture-only internal host entry; public plugin ports cannot self-assign
    // consumer or principal to invoke these configuration UI services.
    const result = context.context.pluginId === 'host'
      ? await runtime.capabilities.invoke(id, input, { consumer: 'host' }, runtime.authority.bind({ ...context.context, consumer: 'host' }, runtime.capabilities.hostEntry))
      : await context.capabilities.invoke(id, input);
    assert.equal(result.type, 'result'); return result.value;
  };
  const catalog = async (context = main) => (await call('host.configuration.catalog', { plugin_id: pluginId }, context)).items[0];
  const fields = value => Object.fromEntries(value.fields.map(item => [item.id, item]));
  const config = async () => (await call(`${pluginId}#configuration.read`, {}, qmt)).configuration;
  const apply = (command_id, expected_version, values) => call('host.configuration.apply', { plugin_id: pluginId, command_id, expected_version, values }, main);
  const readiness = (id, input) => qmt.capabilities.check(`${pluginId}#${id}`, input);
  const missing = result => result.requirements.filter(item => !item.optional && !item.available).map(item => item.field).sort();
  try {
    await writeFile(python, 'Fixture only: this file must never execute.');
    await open();
    const draft = join(runtime.workspaces.root('conv_main'), 'qmt'); await cp(packageRoot, draft, { recursive: true });
    const installed = await main.plugins.install({ path: draft }); assert.equal(installed.plugin.runtime_status, 'ready');
    await main.plugins.setEnabled(pluginId, true, { scope: 'session' }); await contexts();

    await t.test('service reads and environment checks do not probe or turn optional Python into a prerequisite', async () => {
      const service = createHostContextV2(runtime, runtime.plugins.entry(pluginId));
      await assert.rejects(catalog(service), { code: 'CAPABILITY_FORBIDDEN' });
      const serviceOwner = createHostContextV2(runtime, runtime.capabilities.hostEntry);
      const initial = fields(await catalog(serviceOwner));
      assert.equal(initial.python_path.configured, false); assert.equal(initial.account_id.configured, false);
      assert.equal(initial.sector.value, '沪深京A股'); assert.equal(initial.sector.expected_version, 1);
      assert.equal(initial.sector.clearable, false);
      assert.equal(initial.market_port.clearable, true);
      const checked = await readiness('qmt_environment', { action: 'verify', python_path: python });
      assert.equal(checked.available, true); assert.equal(checked.requirements[0].optional, true);
      assert.equal(checked.requirements[0].available, false);
      const serviceQmt = createHostContextV2(runtime, runtime.plugins.entry(pluginId));
      assert.equal((await call(`${pluginId}#configuration.read`, {}, serviceQmt)).configuration.version, 1);
      await assert.rejects(call(`${pluginId}#configuration.update`, { command_id: 'qmt-service-denied-01', expected_version: 1, changes: { market_port: 58610 } }, serviceQmt), { code: 'AUTHORITY_REQUIRED' });
      await assert.rejects(call('host.configuration.apply', { plugin_id: pluginId, command_id: 'qmt-service-denied-02', expected_version: 1, values: { market_port: 58610 } }, service), { code: 'CAPABILITY_FORBIDDEN' });
      await assert.rejects(call('host.configuration.apply', { plugin_id: pluginId, command_id: 'qmt-service-denied-03', expected_version: 1, values: { market_port: 58610 } }, serviceOwner), { code: 'FORBIDDEN' });
      assert.equal(processCalls, 0);
    });

    await t.test('market settings save independently while platform gates, original operation receipts and CAS remain enforced', async () => {
      const values = { python_path: python, market_port: 58610 }, command = 'qmt-shared-market-save-01';
      const result = await apply(command, 1, values); assert.equal(result.status, 'applied');
      assert.equal(fields(result.catalog).market_port.value, 58610); assert.equal(fields(result.catalog).account_id.configured, false);
      assert.equal((await config()).version, 2);
      await apply(command, 1, values); assert.equal((await config()).version, 2);
      const legacy = await call(`${pluginId}#qmt_configure`, { operation_id: command, expected_version: 1, changes: values }, qmt);
      const publicConfig = await config();
      assert.equal(publicConfig.id, '[redacted]'); assert.equal(publicConfig.connection_id, '[redacted]');
      const { id: localId, connection_id: connectionId, ...nativeFields } = legacy;
      const { id: _redactedId, connection_id: _redactedConnection, ...declaredFields } = publicConfig;
      assert.deepEqual(nativeFields, declaredFields); assert.equal(localId, 'local');
      assert.match(connectionId, /^qmt-[0-9a-f-]+$/);
      await assert.rejects(apply(command, 2, { market_port: 58611 }), { code: 'idempotency_conflict' });
      await assert.rejects(apply('qmt-shared-stale-save-01', 1, { market_port: 58611 }), { code: 'version_conflict' });
      assert.equal((await config()).version, 2);
      assert.equal((await readiness('qmt_read', { action: 'quotes', symbols: ['600000.SH'] })).available, true);
      assert.deepEqual(missing(await readiness('qmt_read', { action: 'asset' })), ['account_id', 'userdata_directory']);
      if (process.platform === 'win32') {
        const bound = await call(`${pluginId}#market_bind`, { binding: {} }, qmt);
        assert.equal(bound.health, 'configured');
        await call(`${pluginId}#market_unbind`, { binding: bound }, qmt);
      } else {
        await assert.rejects(call(`${pluginId}#market_bind`, { binding: {} }, qmt), {
          code: 'PREREQUISITE_REQUIRED', message: /native Windows x64.*macOS and Linux are not QMT hosts/
        });
        const inspection = await qmt.capabilities.invoke(`${pluginId}#qmt_environment`, { action: 'inspect' });
        assert.equal(inspection.type, 'run');
        const inspected = await qmt.runs.wait(inspection.run, { until: 'settled', timeoutMs: 30000 });
        assert.equal(inspected.reason, 'settled'); assert.equal(inspected.run.status, 'completed', JSON.stringify(inspected.run.error));
        const environment = inspected.run.output;
        assert.equal(environment.platform, process.platform); assert.equal(environment.supported_platform, 'win32-x64');
        assert.ok(environment.missing.includes('Native Windows x64 host'));
        assert.equal(environment.sdk_verified, false); assert.equal(environment.terminal_started, false);
      }
      assert.equal(processCalls, 0);
    });

    await t.test('account and optional display fields do not gate market reads, and null keeps the original clear semantics', async () => {
      await apply('qmt-shared-account-save-01', 2, { account_id: '00123', userdata_directory: directory, broker: 'Fixture broker' });
      assert.equal((await config()).account_id, '00123');
      await apply('qmt-shared-market-clear-01', 3, { market_port: null });
      assert.equal((await config()).market_port, null);
      assert.deepEqual(missing(await readiness('qmt_read', { action: 'quotes', symbols: ['600000.SH'] })), ['market_port']);
      assert.equal((await readiness('qmt_read', { action: 'asset' })).available, true);
      const accounts = await readiness('account_listAccounts', { binding: {}, query: {}, page: { limit: 10 } });
      assert.equal(accounts.available, true);
      await apply('qmt-shared-broker-clear-01', 4, { broker: null });
      const withoutBroker = await readiness('account_listAccounts', { binding: {}, query: {}, page: { limit: 10 } });
      assert.equal(withoutBroker.available, true); assert.equal(withoutBroker.requirements.find(item => item.field === 'broker').optional, true);
      await apply('qmt-shared-market-save-02', 5, { market_port: 58610 });
      await apply('qmt-shared-account-clear-01', 6, { account_id: null });
      assert.equal((await config()).account_id, null);
      assert.equal((await readiness('qmt_read', { action: 'quotes', symbols: ['600000.SH'] })).available, true);
      assert.deepEqual(missing(await readiness('qmt_read', { action: 'asset' })), ['account_id']);
      const old = await call(`${pluginId}#qmt_configure`, { operation_id: 'legacy-account-restore', expected_version: 7, changes: { account_id: '00123' } }, qmt);
      assert.equal(old.account_id, '00123'); assert.equal(old.version, 8);
      await assert.rejects(apply('qmt-shared-sector-clear-01', 8, { sector: null }));
      assert.equal((await config()).sector, '沪深京A股'); assert.equal((await config()).version, 8);
    });

    await t.test('saved configuration reads and retained receipts do not need a live Python path', async () => {
      await rm(python);
      const saved = fields(await catalog()); assert.equal(saved.python_path.value, python); assert.equal(saved.python_path.configured, true);
      await apply('qmt-shared-python-clear-01', 8, { python_path: null });
      assert.equal((await readiness('qmt_trading_context', { action: 'identity' })).available, true);
      assert.deepEqual(missing(await readiness('qmt_trading_context', { action: 'snapshot' })), ['python_path']);
      const receipt = { id: 'stored-unknown', status: 'outcome_unknown' };
      privateRecords.records(qmt).put('qmt_commands', receipt);
      assert.deepEqual(await call(`${pluginId}#qmt_command`, { operation_id: receipt.id }, qmt), receipt);
      const savedConfig = await config(), identity = (await call(`${pluginId}#qmt_execution_identity`, {})).account;
      assert.equal(identity.accountId, savedConfig.account_id); assert.equal(identity.revision, String(savedConfig.version));
      assert.notEqual(identity.connectionId, '[redacted]');
      const binding = { connection: { id: identity.connectionId, revision: identity.revision }, account: { connectionId: identity.connectionId, accountId: identity.accountId } };
      const closed = { operationId: 'stored-close', positionId: 'fixture-position', status: 'closed', requestedQuantity: { value: '100', unit: 'share' }, observedAt: 1 };
      privateRecords.records(qmt).put('position_closes', { id: closed.operationId, binding, receipt: closed });
      const retained = await runtime.capabilities.invoke(`${pluginId}#positions_read_receipt`, { binding, operationId: closed.operationId }, { consumer: 'host' }, runtime.authority.bind({ ...main.context, consumer: 'host' }, runtime.capabilities.hostEntry));
      assert.equal(retained.type, 'result'); assert.deepEqual(retained.value, closed);
      assert.equal(processCalls, 0);
    });

    const prior = await config(); await close(); await open(); await contexts();
    assert.deepEqual(await config(), prior); assert.equal(fields(await catalog()).account_id.value, '00123');
    // The original command receipt survives reopening both stores; applying it
    // again cannot restore old values over newer revisions.
    await apply('qmt-shared-market-save-01', 1, { python_path: python, market_port: 58610 });
    assert.deepEqual(await config(), prior);
    await assert.rejects(apply('qmt-shared-restart-stale', 1, { market_port: 58611 }), { code: 'version_conflict' });
    assert.equal(processCalls, 0);
  } finally {
    await close(); assert.equal(dirname(directory), resolve(tmpdir())); await rm(directory, { recursive: true, force: true });
  }
});
