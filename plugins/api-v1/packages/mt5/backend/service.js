import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readTree } from './support.js';
import { id, now, digest, requireValue } from './support.js';
import { DEFAULT_RISK_LIMITS, SDK_VERSION, projectFiles, riskLimits, stableJSON, strategyImplementation } from './contracts.js';
import { compilerDependencies, fileManifest, compileNative } from './native.js';
import { discoverDependencies, prerequisite } from './dependencies.js';
import { MT5Official } from './official.js';
import { Tester } from './tester.js';
import { visualTemplate } from './visual/index.js';
import { GENERATED_FILE } from './visual/generate.js';
import { Market } from './market.js';
import { LiveMarket } from './live.js';
import { Deployments, prepareLiveEntry } from './deployments.js';

const here = fileURLToPath(new URL('.', import.meta.url));
const texts = files => Object.fromEntries(Object.entries(files).map(([name, bytes]) => [name, bytes.toString('utf8')]));
const buildHeader = key => `#define PRODUCT_BUILD_ID "${key}"\n#define PRODUCT_SDK_VERSION "${SDK_VERSION}"\n`;

export class MT5 {
  constructor(host, options = {}) { this.host = host; this.storage = host.storage; this.options = options; this.jobs = new Map(); this.tail = Promise.resolve(); }
  async init() {
    this.legacyTemplate = projectFiles(texts(await readTree(join(here, 'template'))));
    this.template = projectFiles(visualTemplate());
    this.sdk = texts(await readTree(join(here, 'sdk')));
    const dependencies = discoverDependencies(this.host, this.options);
    this.native = dependencies.native; this.compilerEnvironment = dependencies.environment;
    // Activation is discovery only. A compilation/probe request may inspect an
    // native compiler request verifies the actual execution; activation only discovers.
    this.compilerReady = Boolean(this.native && compilerDependencies(this.compilerEnvironment));
    this.official = await new MT5Official(this.host, this.native).init();
    this.market = new Market(this);
    this.live = new LiveMarket(this);
    this.deployments = new Deployments(this);
    this.tester = new Tester(this).init();
    for (const build of this.storage.list('mt5_build')) if (['queued', 'compiling'].includes(build.status)) {
      this.storage.put('mt5_build', { ...build, status: 'failed', completed_at: now(), diagnostics: '应用重启，未自动重放编译。', ex5_sha256: null });
    }
    return this;
  }
  status() {
    const compile = Boolean(this.compilerReady);
    return { installed: Boolean(this.native), compile, tester: Boolean(this.tester?.available()), deploy: Boolean(this.native), sdk_version: SDK_VERSION,
      reason: compile ? '已发现编译入口；Tester、账户连接和交易权限须分别核验。' : '可编辑独立工程；运行 mt5_dependencies inspect 先复用已有安装，再按缺项安装与配置。',
      dependencies: { tool: 'mt5_dependencies', action: 'inspect', probe: true } };
  }
  list() { return this.storage.list('mt5_project'); }
  project(key) {
    const project = this.storage.get('mt5_project', key);
    const revision = this.storage.get('mt5_revision', `${key}:${project.revision}`);
    return { ...project, files: revision.files, rules: revision.rules, engine: revision.engine ?? null, strategy_contract: revision.strategy_contract ?? null, svl_source: revision.svl_source ?? null, implementation: this.validateSource(project, revision), builds: this.storage.list('mt5_build').filter(build => build.project_id === key), backtests: this.tester.list(key) };
  }
  create(title) {
    requireValue(typeof title === 'string' && title.trim().length > 0 && title.length <= 120, '工程名称需要 1–120 个字符');
    const key = id('project'), timestamp = now();
    return this.storage.transaction(() => {
      this.storage.put('mt5_revision', { id: `${key}:1`, project_id: key, revision: 1, ...this.template, created_at: timestamp });
      return this.storage.put('mt5_project', { id: key, version: 1, title: title.trim(), revision: 1, source_digest: this.template.source_digest,
        sdk_version: SDK_VERSION, template_version: this.template.strategy_contract.template_version, test_risk_limits: { ...DEFAULT_RISK_LIMITS }, created_at: timestamp, updated_at: timestamp });
    });
  }
  configure(key, limits, expectedVersion) {
    const project = this.storage.get('mt5_project', key);
    requireValue(expectedVersion === project.version, '工程已更新，请刷新后重试', 409, 'version_conflict');
    return this.storage.put('mt5_project', { ...project, version: project.version + 1, test_risk_limits: riskLimits(limits), updated_at: now() });
  }
  validateSource(project, source) {
    if (project.translation) {
      requireValue(source.source_digest === project.source_digest, '翻译成果的代码不能原地改写；先修订 SVL 并登记新的翻译', 409, 'translation_changed');
      return { status: 'translated_unverified', pending_modules: [], translation: project.translation };
    }
    if (project.template_version) {
      requireValue(source.strategy_contract?.template_version === project.template_version, '新工程必须保留 strategy.json 模块契约及模板版本');
      // Compare with the project's own initial revision so later template upgrades
      // cannot silently change an existing project's platform-owned entry points.
      const initial = this.storage.get('mt5_revision', `${project.id}:1`);
      requireValue(source.files['Experts/Strategy.mq5'] === initial.files['Experts/Strategy.mq5'] && Object.keys(source.files).filter(p => p.startsWith('Experts/')).length === 1, 'EA 入口由平台维护；请在 Include/Strategy 中实现扩展');
      const platformNodes = rules => rules.nodes.filter(n => n.id.startsWith('platform.')).sort((a, b) => a.id.localeCompare(b.id));
      requireValue(stableJSON(platformNodes(source.rules)) === stableJSON(platformNodes(initial.rules)), '平台规则节点不能修改、删除或新增；请使用策略自己的节点 ID');
    }
    return strategyImplementation(source);
  }
  async checkout(box, key, signal, conversationId) {
    const project = this.project(key), checkoutId = id('checkout');
    const path = `/work/projects/${key}/${checkoutId}`;
    const sdkPath = `/work/inputs/mt5-sdk/${SDK_VERSION}`;
    const files = Object.fromEntries(Object.entries(project.files).map(([name, content]) => [path.slice(6) + '/' + name, content]));
    for (const [name, content] of Object.entries({ ...this.sdk, 'Build.mqh': buildHeader('unbuilt') })) files[`${sdkPath.slice(6)}/Include/Product/${name}`] = content;
    // One transactional workspace write imports the editable project and read-only SDK together.
    await box.file('write_tree', '/work', files, signal, true);
    requireValue(typeof conversationId === 'string' && conversationId, 'Checkout 需要会话身份');
    const checkout = { ...this.host.workspace.owner(conversationId), id: checkoutId, project_id: key, conversation_id: conversationId, revision: project.revision, path, sdk_path: sdkPath };
    this.storage.put('mt5_checkout', checkout);
    return checkout;
  }
  async save(box, checkoutId, signal, conversationId) {
    const checkout = this.storage.get('mt5_checkout', checkoutId);
    requireValue(conversationId && checkout.conversation_id === conversationId, '只能保存当前会话的 checkout', 403);
    const validated = projectFiles(texts(await box.snapshot(checkout.path)));
    signal?.throwIfAborted();
    return this.storage.transaction(() => {
      const project = this.storage.get('mt5_project', checkout.project_id);
      requireValue(project.revision === checkout.revision, '另一个会话已保存新版本；请重新 checkout 并合并修改', 409, 'revision_conflict');
      this.validateSource(project, validated);
      const previous = this.storage.get('mt5_revision', `${project.id}:${project.revision}`);
      if (project.source_digest === validated.source_digest && previous.engine?.digest === validated.engine?.digest) return project;
      const revision = project.revision + 1, timestamp = now();
      this.storage.put('mt5_revision', { id: `${project.id}:${revision}`, project_id: project.id, revision, ...validated, created_at: timestamp });
      this.storage.put('mt5_checkout', { ...checkout, revision });
      return this.storage.put('mt5_project', { ...project, version: project.version + 1, revision, source_digest: validated.source_digest, updated_at: timestamp });
    });
  }
  queueBuild(key, revision, conversationId = null) {
    requireValue(!this.closing, 'MT5 模块正在关闭', 503);
    const dependencies = discoverDependencies(this.host, this.options);
    this.native = dependencies.native; this.compilerEnvironment = dependencies.environment;
    this.compilerReady = Boolean(this.native && compilerDependencies(this.compilerEnvironment));
    if (!this.compilerReady) throw prerequisite(this, 'local-compiler');
    const project = this.storage.get('mt5_project', key);
    requireValue(Number.isInteger(revision) && revision > 0, '需要明确的源码 revision');
    const source = this.storage.get('mt5_revision', `${key}:${revision}`);
    const validated = projectFiles(source.files), implementation = this.validateSource(project, validated);
    if (validated.engine) requireValue(source.engine?.digest === validated.engine.digest && source.generated_source === validated.generated_source, '冻结源码与生成物身份不一致，请重新保存源码', 409, 'engine_mismatch');
    const ownership = conversationId ? this.host.workspace.owner(conversationId) ?? {} : {};
    return this.storage.put('mt5_build', { ...ownership, conversation_id: conversationId, id: id('build'), project_id: project.id, revision, source_digest: source.source_digest, sdk_version: SDK_VERSION,
      implementation, translation: project.translation ?? null, translation_mode: project.translation_mode ?? null, engine_digest: validated.engine?.digest ?? null, generated_digest: validated.engine?.generated_digest ?? null, status: 'queued', manifest_digest: null, ex5_sha256: null, diagnostics: '', created_at: now(), completed_at: null });
  }
  startBuild(buildId, signal) {
    if (this.jobs.has(buildId)) return this.jobs.get(buildId).promise;
    const build = this.storage.get('mt5_build', buildId);
    if (build.status !== 'queued') return Promise.resolve(build);
    const controller = new AbortController();
    const abort = () => controller.abort(); signal?.addEventListener('abort', abort, { once: true });
    if (signal?.aborted) abort();
    // ponytail: one compiler job at a time; parallelize only after measuring demand.
    const promise = this.tail.then(() => this.compile(build, controller.signal)).finally(() => { signal?.removeEventListener('abort', abort); this.jobs.delete(buildId); });
    this.jobs.set(buildId, { controller, promise }); this.tail = promise.catch(() => {});
    return promise;
  }
  async compile(build, signal) {
    const directory = join(this.storage.directory, 'mt5/builds', build.id);
    try {
      signal.throwIfAborted();
      this.storage.put('mt5_build', { ...build, status: 'compiling' });
      await fs.mkdir(directory, { recursive: true, mode: 0o700 });
      // Never modify the terminal's library. Every build gets its own frozen copy.
      await fileManifest(this.native.include);
      await fs.cp(this.native.include, join(directory, 'Include'), { recursive: true, errorOnExist: true, force: false });
      for (const namespace of ['Strategy', 'Product']) await fs.rm(join(directory, 'Include', namespace), { recursive: true, force: true });
      const revision = this.storage.get('mt5_revision', `${build.project_id}:${build.revision}`);
      const checked = projectFiles(revision.files);
      if (build.engine_digest) requireValue(checked.engine?.digest === build.engine_digest && checked.generated_source === revision.generated_source, '编译前源码与 IR 身份不一致', 409, 'engine_mismatch');
      const files = { ...revision.files, ...Object.fromEntries(Object.entries({ ...this.sdk, 'Build.mqh': buildHeader(build.id) }).map(([name, content]) => [`Include/Product/${name}`, content])) };
      if (revision.translation) {
        const translation = this.host.artifacts.read(revision.translation).manifest.content;
        // Agent translations are immutable. Lifecycle adaptation must be visible
        // in a new translation, never an implicit compiler source rewrite.
        build.live_capable = translation.mode === 'live' && files['Experts/Strategy.mq5'].includes('ProductExecutionAllowed()');
        build.source_map = translation.sourceMap;
      } else {
        const entry = prepareLiveEntry(files['Experts/Strategy.mq5']);
        files['Experts/Strategy.mq5'] = entry.source; build.live_capable = entry.live;
      }
      if (checked.engine) {
        files[GENERATED_FILE] = checked.generated_source;
        files['engine.json'] = JSON.stringify(checked.engine);
        build.source_map = checked.engine.source_map;
      }
      for (const [name, content] of Object.entries(files)) { await fs.mkdir(join(directory, name, '..'), { recursive: true }); await fs.writeFile(join(directory, name), content); }
      const compiler = join(directory, '.compiler/MetaEditor64.exe');
      await fs.mkdir(join(directory, '.compiler')); await fs.copyFile(this.native.editor, compiler);
      const manifest = { build_id: build.id, source_digest: build.source_digest, engine_digest: build.engine_digest, generated_digest: build.generated_digest, sdk_version: SDK_VERSION, compiler_sha256: digest(await fs.readFile(compiler)), files: await fileManifest(directory) };
      build.manifest_digest = digest(stableJSON(manifest));
      const manifestText = JSON.stringify(manifest, null, 2);
      await fs.writeFile(join(directory, 'manifest.json'), manifestText);
      const result = await compileNative({ ...this.native, editor: compiler }, directory, signal, digest(manifestText), build.owner_run_id, this.compilerEnvironment);
      build = { ...build, status: result.success ? 'succeeded' : 'failed', diagnostics: result.diagnostics, ex5_sha256: result.ex5_sha256, execution: result.execution };
    } catch (error) {
      build = { ...build, status: error.code === 'runtime_cleanup_failed' ? 'unknown' : signal.aborted ? 'canceled' : 'failed', diagnostics: error.message, ex5_sha256: null, ...(error.code === 'runtime_cleanup_failed' ? { cleanup_failed: true } : {}) };
      if (error.code === 'runtime_cleanup_failed') { this.storage.put('mt5_build', { ...build, completed_at: now() }); throw error; }
    }
    return this.storage.put('mt5_build', { ...build, completed_at: now() });
  }
  async close() {
    this.closing = true;
    for (const job of this.jobs.values()) job.controller.abort();
    // Stop subscribers, then abort their I/O before awaiting any feed jobs.
    const live = this.live.close(), market = this.market.close(), official = this.official.close();
    await Promise.allSettled([live, market, official, this.tester.close(), this.deployments.close(), ...[...this.jobs.values()].map(job => job.promise)]);
  }
}
