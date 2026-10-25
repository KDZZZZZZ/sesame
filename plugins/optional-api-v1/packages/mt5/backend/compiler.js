import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import { ownership } from './records.js';
import { readArtifact } from './resource-io.js';
import { id, now, digest, requireValue } from './support.js';
import { SDK_VERSION, projectFiles, stableJSON } from './contracts.js';
import { compilerDependencies, fileManifest, compileNative } from './native.js';
import { discoverDependencies, prerequisite } from './dependencies.js';
import { buildHeader } from './projects.js';
import { GENERATED_FILE } from './visual/generate.js';
import { prepareLiveEntry } from './deployments.js';

// Dependency discovery, queue and jobs all use the original facade state.
// Neither this module nor projects creates another store or compiler queue.
export function discover(mt5) {
  const dependencies = discoverDependencies(mt5.host, mt5.options);
  mt5.native = dependencies.native; mt5.compilerEnvironment = dependencies.environment;
  // Activation only discovers; compilation verifies actual native execution.
  mt5.compilerReady = Boolean(mt5.native && compilerDependencies(mt5.compilerEnvironment));
}

export function recover(mt5) {
  for (const build of mt5.storage.list('mt5_build')) if (['queued', 'compiling'].includes(build.status)) {
    mt5.storage.put('mt5_build', { ...build, status: 'failed', completed_at: now(), diagnostics: '应用重启，未自动重放编译。', ex5_sha256: null });
  }
}

export function queueBuild(mt5, key, revision, conversationId = null, host = mt5.host) {
  requireValue(!mt5.closing, 'MT5 模块正在关闭', 503);
  discover(mt5);
  if (!mt5.compilerReady) throw prerequisite(mt5, 'local-compiler');
  const project = mt5.storage.get('mt5_project', key);
  requireValue(Number.isInteger(revision) && revision > 0, '需要明确的源码 revision');
  const source = mt5.storage.get('mt5_revision', `${key}:${revision}`);
  const validated = projectFiles(source.files), implementation = mt5.validateSource(project, validated);
  if (validated.engine) requireValue(source.engine?.digest === validated.engine.digest && source.generated_source === validated.generated_source, '冻结源码与生成物身份不一致，请重新保存源码', 409, 'engine_mismatch');
  const owner = conversationId ? ownership(host) : {};
  return mt5.storage.put('mt5_build', { ...owner, conversation_id: conversationId, id: id('build'), project_id: project.id, revision, source_digest: source.source_digest, sdk_version: SDK_VERSION,
    implementation, translation: project.translation ?? null, translation_mode: project.translation_mode ?? null, engine_digest: validated.engine?.digest ?? null, generated_digest: validated.engine?.generated_digest ?? null, status: 'queued', manifest_digest: null, ex5_sha256: null, diagnostics: '', created_at: now(), completed_at: null });
}

export function startBuild(mt5, buildId, signal) {
  if (mt5.jobs.has(buildId)) return mt5.jobs.get(buildId).promise;
  const build = mt5.storage.get('mt5_build', buildId);
  if (build.status !== 'queued') return Promise.resolve(build);
  const controller = new AbortController();
  const abort = () => controller.abort(); signal?.addEventListener('abort', abort, { once: true });
  if (signal?.aborted) abort();
  // ponytail: one compiler job at a time; parallelize only after measuring demand.
  const promise = mt5.tail.then(() => mt5.compile(build, controller.signal)).finally(() => { signal?.removeEventListener('abort', abort); mt5.jobs.delete(buildId); });
  mt5.jobs.set(buildId, { controller, promise }); mt5.tail = promise.catch(() => {});
  return promise;
}

export async function compile(mt5, build, signal) {
  const directory = join(mt5.storage.directory, 'mt5/builds', build.id);
  try {
    signal.throwIfAborted();
    mt5.storage.put('mt5_build', { ...build, status: 'compiling' });
    await fs.mkdir(directory, { recursive: true, mode: 0o700 });
    // Never modify the terminal's library. Every build gets its own frozen copy.
    await fileManifest(mt5.native.include);
    await fs.cp(mt5.native.include, join(directory, 'Include'), { recursive: true, errorOnExist: true, force: false });
    for (const namespace of ['Strategy', 'Product']) await fs.rm(join(directory, 'Include', namespace), { recursive: true, force: true });
    const revision = mt5.storage.get('mt5_revision', `${build.project_id}:${build.revision}`);
    const checked = projectFiles(revision.files);
    if (build.engine_digest) requireValue(checked.engine?.digest === build.engine_digest && checked.generated_source === revision.generated_source, '编译前源码与 IR 身份不一致', 409, 'engine_mismatch');
    const files = { ...revision.files, ...Object.fromEntries(Object.entries({ ...mt5.sdk, 'Build.mqh': buildHeader(build.id) }).map(([name, content]) => [`Include/Product/${name}`, content])) };
    if (revision.translation) {
      const translation = (await readArtifact(mt5.host, revision.translation)).manifest.content;
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
    await fs.mkdir(join(directory, '.compiler')); await fs.copyFile(mt5.native.editor, compiler);
    const manifest = { build_id: build.id, source_digest: build.source_digest, engine_digest: build.engine_digest, generated_digest: build.generated_digest, sdk_version: SDK_VERSION, compiler_sha256: digest(await fs.readFile(compiler)), files: await fileManifest(directory) };
    build.manifest_digest = digest(stableJSON(manifest));
    const manifestText = JSON.stringify(manifest, null, 2);
    await fs.writeFile(join(directory, 'manifest.json'), manifestText);
    const result = await compileNative({ ...mt5.native, editor: compiler }, directory, signal, digest(manifestText), build.owner_run_id, mt5.compilerEnvironment);
    build = { ...build, status: result.success ? 'succeeded' : 'failed', diagnostics: result.diagnostics, ex5_sha256: result.ex5_sha256, execution: result.execution };
  } catch (error) {
    build = { ...build, status: error.code === 'runtime_cleanup_failed' ? 'unknown' : signal.aborted ? 'canceled' : 'failed', diagnostics: error.message, ex5_sha256: null, ...(error.code === 'runtime_cleanup_failed' ? { cleanup_failed: true } : {}) };
    if (error.code === 'runtime_cleanup_failed') { mt5.storage.put('mt5_build', { ...build, completed_at: now() }); throw error; }
  }
  return mt5.storage.put('mt5_build', { ...build, completed_at: now() });
}
