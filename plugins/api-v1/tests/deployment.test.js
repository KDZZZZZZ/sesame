import { mt5Import, mt5Path, hostForStore } from './mt5-host.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join, win32 } from 'node:path';
import { tmpdir } from 'node:os';
import { Store, digest, id } from './mt5-host.js';
const { Deployments, initialized, prepareLiveEntry } = await mt5Import('deployments.js');
const { ENTRY } = await mt5Import('visual/index.js');
const { correlatedTrace } = await mt5Import('strategy.js');
const { SDK_VERSION } = await mt5Import('contracts.js');
const { terminalConfig } = await mt5Import('terminal.js');
const { MT5Official } = await mt5Import('official.js');

test('deployments freeze tested parameters, bind accounts, verify initialization and never replay an uncertain attach', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'deployment-')), store = new Store(directory), prefix = process.env.MT5AGENT_WINEPREFIX;
  process.env.MT5AGENT_WINEPREFIX = directory;
  const project = { id: id('project'), title: 'Fixture' }, build = { id: id('build'), project_id: project.id, revision: 1, status: 'succeeded', live_capable: true, sdk_version: SDK_VERSION, ex5_sha256: digest('fixture-ex5') };
  const pass = { id: id('pass'), build_id: build.id, status: 'succeeded', artifact_digest: build.ex5_sha256, config: { symbol: 'EURUSD', period: 'H1' }, parameters: { InpPeriod: 20 }, risk_limits: { max_risk_per_trade_pct: .5, max_daily_loss_pct: 2, max_open_positions: 1, max_lots: '.1' } };
  for (const [kind, value] of [['mt5_project', project], ['mt5_build', build], ['mt5_pass', pass]]) store.put(kind, value);
  await mkdir(join(directory, 'mt5/builds', build.id, 'Experts'), { recursive: true }); await writeFile(join(directory, 'mt5/builds', build.id, 'Experts/Strategy.ex5'), 'fixture-ex5');
  const scope = { server: 'Demo', login: '7001', key: 'test' }, calls = []; let unknown = false, indexed = [];
  const workspace = process.platform === 'win32'
    ? { mql5_folder: win32.join(directory, 'Terminal', 'MQL5'), common_folder: win32.join(directory, 'Common') }
    : { mql5_folder: 'C:\\Terminal\\MQL5', common_folder: 'C:\\Common' };
  const client = { workspace: { structuredContent: { workspace } } };
  const official = {
    storage: hostForStore(store).storage, config: { account: scope }, deploymentAccess: () => ({ blocked_reason: null }), callDeployment: MT5Official.prototype.callDeployment,
    redact: value => value, client: () => client,
    call: async command => {
      const previous = store.get('mt5_command', command.command_id, true); if (previous) return previous;
      calls.push(command);
      const result = { id: command.command_id, status: 'returned', result: { structuredContent: { ok: true } } };
      store.put('mt5_command', result); return result;
    },
  };
  const market = {
    connected: async () => ({ scope, info: { terminal: { experts_trade_allowed: true, mcp_trade_allowed: true }, account: { type: 'demo' } } }),
    read: async tool => tool === 'list_available_mql5_programs' ? { programs: indexed.map(path => ({ type: 'Expert', path })) } : ({ parameters: ['InpPeriod', 'Product_RunId', 'Product_EnableLive', 'Product_AccountLogin', 'Product_AccountServer', 'Product_MaxRiskPct', 'Product_MaxDailyLossPct', 'Product_MaxPositions', 'Product_MaxLots'].map(name => ({ name })) }),
  };
  const deploy = new Deployments({ storage: hostForStore(store).storage, host: hostForStore(store), official, market });
  deploy.attach = async (d, params) => {
    calls.push({ tool: 'native_startup', arguments: { expert_path: d.expert_path, inputs: params } });
    assert.equal(params.InpPeriod, 20); assert.equal(params.Product_AccountLogin, '7001'); assert.equal(params.Product_AccountServer, 'Demo');
    assert.equal(params.Product_MaxRiskPct, .5); assert.equal(params.Product_EnableLive, true);
    if (unknown) throw new Error('Native startup response lost');
    await mkdir(d.output_path, { recursive: true });
    await writeFile(join(d.output_path, 'trace.ndjson'), [
      { seq: 1, build_id: build.id, kind: 'lifecycle', node_id: 'platform.permissions', value: { trade_allowed: true, dll_allowed: false, chart_id: '1234' } },
      { seq: 2, build_id: build.id, kind: 'lifecycle', value: 'initialized' },
    ].map(JSON.stringify).join('\n') + '\n');
    return { chart_id: '1234' };
  };

  try {
    const expected = { ...scope, artifact_digest: build.ex5_sha256 };
    // A frozen build is mountable only once it is staged and the running terminal lists it.
    assert.deepEqual((await deploy.check(pass.id)).reasons, ['终端尚未识别冻结构建，需要自动准备']);
    const expert = await deploy.stage(build); assert.ok(expert.endsWith(`MT5Agent\\${build.id}.ex5`));
    assert.equal((await deploy.check(pass.id)).ready, false, 'a staged file the terminal has not indexed is not enough');
    indexed = [expert.toUpperCase()]; assert.equal(await deploy.stage(build), expert, 'staging is idempotent');
    assert.equal((await deploy.check(pass.id)).ready, true);
    const stagedFile = deploy.staged(build).dest;
    await writeFile(stagedFile, 'modified-ex5');
    assert.deepEqual((await deploy.check(pass.id)).reasons, ['终端目录中的冻结 EX5 已被改动']);
    await assert.rejects(deploy.stage(build), /终端目录中的冻结 EX5 已被改动/);
    await assert.rejects(deploy.mount(pass.id, 'tampered-request-0001', expected), /终端目录中的冻结 EX5 已被改动/);
    assert.equal(await readFile(stagedFile, 'utf8'), 'modified-ex5', 'preparation never overwrites a changed terminal artifact');
    assert.equal(calls.length, 0, 'a changed terminal artifact never opens or attaches a chart');
    await writeFile(stagedFile, 'fixture-ex5');
    await assert.rejects(deploy.mount(pass.id, 'mismatch-request-0001', { ...expected, login: 'other' }), /账户或构建/); assert.equal(calls.length, 0);
    // A single explicit action stages/indexes the EA and mounts it. Concurrent
    // duplicate requests share preparation and never open a second chart.
    indexed = [];
    deploy.refreshPrograms = async () => { await new Promise(resolve => setImmediate(resolve)); indexed = [expert]; return { restarted: true, verified: true }; };
    const runtime = { assertIdle() {}, exclusive: async fn => fn() };
    const [running, duplicate] = await Promise.all([1, 2].map(() => deploy.requestMount(pass.id, 'request-00000000000001', expected, runtime, 'conv_main')));
    assert.equal(duplicate.id, running.id); assert.equal(deploy.preparations().length, 1);
    assert.equal((await deploy.requestMount(pass.id, 'request-00000000000001', expected, runtime)).id, running.id);
    assert.equal(running.status, 'running'); assert.equal(calls.length, 1);
    assert.equal((await deploy.mount(pass.id, 'request-00000000000001', expected)).id, running.id); assert.equal(calls.length, 1);
    assert.equal((await deploy.check(pass.id)).ready, false, 'only one managed strategy per account is allowed');
    const stopped = await deploy.stop(running.id); assert.equal(stopped.status, 'stopped'); assert.equal(await readFile(join(stopped.output_path, 'stop'), 'utf8'), 'stop');
    await deploy.stop(running.id); assert.equal(calls.length, 2);
    store.put('mt5_preparation', { id: 'prep_interrupted', request_key: 'request-interrupted-0001', source_pass_id: pass.id, source_artifact_digest: pass.artifact_digest, ...scope, status: 'interrupted', reason: 'interrupted before mounting' });
    await assert.rejects(deploy.requestMount(pass.id, 'request-interrupted-0001', expected, runtime), /interrupted/);
    assert.equal(calls.length, 2, 'an interrupted mount intent is not resumed by reloading or retrying its key');
    unknown = true;
    const lost = await deploy.mount(pass.id, 'request-00000000000002', expected); assert.equal(lost.status, 'unknown');
    await deploy.mount(pass.id, 'request-00000000000002', expected); assert.equal(calls.length, 3, 'lost attach response is never replayed');
    assert.ok(calls.every(c => ['native_startup', 'chart_remove_expert'].includes(c.tool)));
    assert.ok(calls.filter(c => c.tool === 'native_startup').every(c => c.arguments.expert_path === expert), 'every mount uses the one staged build');
    const source = await readFile(mt5Path('template/Experts/Strategy.mq5'), 'utf8');
    const upgrade = prepareLiveEntry(source); assert.equal(upgrade.live, true); assert.ok(upgrade.source.includes('ProductExecutionAllowed()'));
    assert.equal(prepareLiveEntry('void OnTick() {}').live, false);
    // Initialization evidence: template lifecycle record, or a visual-engine handler event after "init".
    const permission = { seq: 0, node_id: 'platform.permissions', value: { trade_allowed: true, dll_allowed: false } };
    const visual = (seq, kind) => ({ seq, kind: 'event', node_id: 'platform.visual', value: { event: seq, kind } });
    assert.equal(initialized([permission, { seq: 1, kind: 'lifecycle', value: 'initialized' }]), true);
    assert.equal(initialized([visual(1, 'init')]), false, 'OnInit started but may still fail');
    assert.equal(initialized([visual(1, 'init'), { seq: 2, kind: 'condition', node_id: 'signal.n52', value: {} }]), false, 'init-time rules are not a later handler');
    assert.equal(initialized([permission, visual(1, 'init'), visual(40, 'timer')]), true);
    assert.equal(initialized([visual(5, 'timer')]), false, 'a stray handler without an init record is not proof');
    assert.equal(initialized([visual(1, 'init'), visual(40, 'timer')]), false, 'initialization without real per-EA trading permission is not running');
    assert.equal(initialized([{ ...permission, value: { trade_allowed: false, dll_allowed: false } }, visual(1, 'init'), visual(40, 'timer')]), false);
    // Engine-generated entries carry the compact Tester-only guard and upgrade the same way.
    const generated = prepareLiveEntry(ENTRY);
    assert.equal(generated.live, true); assert.ok(generated.source.includes('ProductExecutionAllowed()') && !generated.source.includes('MQL_TESTER'));
  } finally { await deploy.close(); store.close(); if (prefix === undefined) delete process.env.MT5AGENT_WINEPREFIX; else process.env.MT5AGENT_WINEPREFIX = prefix; await rm(directory, { recursive: true, force: true }); }
});

test('a fill inherits only the decision identified by its real order or deal, never a nearby signal', () => {
  const events = [
    { seq: 1, kind: 'condition', decision_id: 'other', value: true },
    { seq: 2, kind: 'condition', decision_id: 'actual', value: true },
    { seq: 3, kind: 'request_result', decision_id: 'actual', value: { deal: '55', order: '4' } },
    { seq: 4, kind: 'transaction', decision_id: '', value: { deal: '55', order: '4' } },
  ];
  assert.deepEqual(correlatedTrace({ ticket: '55', order: '4' }, events).map(e => e.seq), [2, 3, 4]);
  assert.deepEqual(correlatedTrace({ ticket: '56', order: '5' }, events), []);
});

test('automatic preparation upgrades the exact tested revision and parameters, preserves risk and never deploys', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'deployment-prepare-')), store = new Store(directory), prefix = process.env.MT5AGENT_WINEPREFIX;
  process.env.MT5AGENT_WINEPREFIX = directory;
  const workspace = process.platform === 'win32' ? { mql5_folder: win32.join(directory, 'Terminal', 'MQL5') } : { mql5_folder: 'C:\\Terminal\\MQL5' };
  let indexed = [];
  const build = { id: 'build_old', project_id: 'project_old', revision: 3, status: 'succeeded', ex5_sha256: digest('old') };
  const limits = { max_risk_per_trade_pct: .2, max_daily_loss_pct: 1, max_open_positions: 1, max_lots: .1 };
  const pass = { id: 'pass_old', build_id: build.id, status: 'succeeded', artifact_digest: build.ex5_sha256, config: { symbol: 'EURUSD', period: 'H1' }, parameters: { Lookback: 17 }, risk_limits: limits };
  store.put('mt5_build', build); store.put('mt5_pass', pass);
  const calls = [], scope = { server: 'Demo', login: '7001' }, states = new Map();
  const official = { config: { account: scope, allow_trading: false, version: 1 }, deploymentAccess: () => ({ blocked_reason: null }), redact: x => x, client: () => ({ workspace: { structuredContent: { workspace } } }),
    configure: async input => { calls.push('authorize'); Object.assign(official.config, input); } };
  const upgraded = { ...build, id: 'build_new', ex5_sha256: digest('new'), sdk_version: SDK_VERSION, live_capable: true };
  await mkdir(join(directory, 'mt5/builds/build_new/Experts'), { recursive: true }); await writeFile(join(directory, 'mt5/builds/build_new/Experts/Strategy.ex5'), 'new');
  const mt5 = { storage: hostForStore(store).storage, host: hostForStore(store), official, market: { connected: async () => ({ scope, info: { terminal: { experts_trade_allowed: true, mcp_trade_allowed: true }, account: { type: 'demo' } } }),
      read: async () => ({ programs: indexed.map(path => ({ type: 'Expert', path })) }) },
    queueBuild: (project, revision) => { assert.equal(project, build.project_id); assert.equal(revision, 3); calls.push('compile'); return upgraded; },
    startBuild: async () => store.put('mt5_build', upgraded),
    tester: { queue: (key, config, space, owner, risk) => { assert.equal(key, upgraded.id); assert.deepEqual(config.parameters, pass.parameters); assert.deepEqual(risk, limits); assert.deepEqual(space, {}); calls.push('backtest'); return { id: 'bt_new' }; },
      start: async () => ({ status: 'succeeded', passes: [store.put('mt5_pass', { ...pass, id: 'pass_new', build_id: upgraded.id, artifact_digest: upgraded.ex5_sha256 })] }) },
  };
  const deploy = new Deployments(mt5); mt5.deployments = deploy;
  // The running terminal lists the staged build only after a refresh restart.
  deploy.refreshPrograms = async () => { calls.push('restart'); indexed = [deploy.staged(upgraded).expert]; return { restarted: true, verified: true }; };
  const runtime = { assertIdle() {}, exclusive: async fn => fn(), plugins: { state: key => states.get(key) ?? 'disabled', policy: () => ({ version: 1 }), configure: (key, state) => states.set(key, state) } };
  const input = { pass_id: pass.id, ...scope, artifact_digest: pass.artifact_digest, authorize_trading: true };
  try {
    assert.throws(() => deploy.prepare({ ...input, authorize_trading: false }, 'prepare-denied-0001', runtime), /明确/); assert.equal(states.size, 0);
    const pending = deploy.prepare(input, 'prepare-approved-0001', runtime); await deploy.close();
    const result = store.get('mt5_preparation', pending.id);
    assert.equal(result.status, 'ready'); assert.equal(result.pass_id, 'pass_new'); assert.equal(result.check.ready, true);
    assert.deepEqual(calls, ['compile', 'backtest', 'restart']); assert.equal(store.list('mt5_deployment').length, 0);
    assert.equal(official.config.allow_trading, false); assert.equal(states.size, 0, 'preparation never enables broad trading or host plugins');
    assert.equal(await readFile(deploy.staged(upgraded).dest, 'utf8'), 'new');
    assert.equal(deploy.prepare(input, 'prepare-approved-0001', runtime).id, pending.id); assert.equal(calls.length, 3);
    const ini = terminalConfig({ account: { ...scope, password: 'test-secret' }, startup_ini: '[Common]\nProxyEnable=0\n[StartUp]\nExpert=Unwanted\n[Experts]\nAllowDllImport=1' }, true);
    assert.match(ini, /Enabled=1\r\nAllowLiveTrading=1/); assert.doesNotMatch(ini, /Unwanted|AllowDllImport=1|\[StartUp\]/);
  } finally { await deploy.close(); store.close(); if (prefix === undefined) delete process.env.MT5AGENT_WINEPREFIX; else process.env.MT5AGENT_WINEPREFIX = prefix; await rm(directory, { recursive: true, force: true }); }
});
