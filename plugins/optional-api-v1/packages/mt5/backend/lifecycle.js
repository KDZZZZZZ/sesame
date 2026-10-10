import { promises as fs } from 'node:fs';
import { join, relative, isAbsolute } from 'node:path';
import { digest, requireValue, taskRunId } from './support.js';

const active = value => ['preparing', 'attaching', 'running', 'unknown'].includes(value.status);

export async function settleRun(mt5, runId) {
  taskRunId(runId);
  const promises = [];
  for (const [id, job] of mt5.jobs) if (mt5.storage.get('mt5_build', id).owner_run_id === runId) { job.controller.abort(); promises.push(job.promise); }
  for (const [id, job] of mt5.tester.pending) if (mt5.storage.get('mt5_backtest', id).owner_run_id === runId) { job.controller.abort(); promises.push(job.promise); }
  await Promise.allSettled(promises);
  requireValue(!mt5.storage.list('mt5_build').some(row => row.owner_run_id === runId && row.cleanup_failed), 'MT5 编译环境尚未确认清理，任务现场必须保留', 503, 'runtime_cleanup_failed');
  requireValue(!mt5.storage.list('mt5_pass').some(row => row.owner_run_id === runId && (row.cleanup_failed || row.status === 'unknown' && row.process_id)), 'MT5 Tester 原生进程尚待核对，任务现场必须保留', 503, 'runtime_cleanup_failed');
}

async function file(path, expected) {
  const info = await fs.lstat(path);
  requireValue(info.isFile() && !info.isSymbolicLink() && info.size <= 32 * 1024 * 1024, 'MT5 成果必须是有界普通文件');
  const bytes = await fs.readFile(path);
  requireValue(!expected || digest(bytes) === expected, 'MT5 成果字节摘要不匹配');
  return bytes;
}

export async function protectRun(host, mt5, runId) {
  await settleRun(mt5, runId);
  const cached = mt5.storage.get('sealed_run', runId, true);
  if (cached) return cached.protection;
  const builds = mt5.storage.list('mt5_build').filter(row => row.owner_run_id === runId);
  const backtests = mt5.storage.list('mt5_backtest').filter(row => row.owner_run_id === runId);
  const passes = mt5.storage.list('mt5_pass').filter(row => row.owner_run_id === runId);
  const deployments = mt5.deployments.list().filter(active);
  const commands = mt5.storage.list('mt5_command').filter(row => row.owner_run_id === runId);
  const blobs = [], resources = [];
  const blob = (path, bytes, mediaType = 'application/json') => blobs.push({ path, mediaType, ...host.artifacts.blob(bytes) });
  const json = (path, value) => blob(path, JSON.stringify(value));
  for (const build of builds) {
    json(`builds/${build.id}.json`, build);
    json(`sources/${build.project_id}-${build.revision}.json`, mt5.storage.get('mt5_revision', `${build.project_id}:${build.revision}`));
    if (build.status === 'succeeded') {
      const path = join(mt5.storage.directory, 'mt5/builds', build.id, 'Experts/Strategy.ex5');
      blob(`builds/${build.id}.ex5`, await file(path, build.ex5_sha256), 'application/octet-stream');
      const manifestPath = join(mt5.storage.directory, 'mt5/builds', build.id, 'manifest.json');
      blob(`builds/${build.id}-manifest.json`, await file(manifestPath));
      resources.push({ id: build.id, path, digest: build.ex5_sha256, reason: deployments.some(row => row.build_id === build.id) ? 'Observed MT5 deployment depends on this frozen EX5' : 'Frozen EX5 retained for explicit future Tester/deployment use' });
    }
  }
  for (const backtest of backtests) json(`backtests/${backtest.id}.json`, backtest);
  for (const pass of passes) {
    json(`passes/${pass.id}.json`, pass);
    for (const datasetId of pass.dataset_ids ?? []) {
      const dataset = host.datasets.read(datasetId), { rows, ...metadata } = dataset;
      json(`datasets/${datasetId}/metadata.json`, metadata);
      // Independent chunks keep both the artifact and each blob bounded.
      for (let i = 0; i < rows.length; i += 10000) json(`datasets/${datasetId}/${i}.json`, rows.slice(i, i + 10000));
    }
  }
  for (const command of commands) json(`commands/${command.id}.json`, command);
  requireValue(blobs.length <= 256, 'MT5 任务成果超过单次清理预算；保留现场以便分批归档');
  // Multiple builds of one revision share the exact same source bytes.
  const uniqueBlobs = [...new Map(blobs.map(item => [item.path, item])).values()];
  const artifacts = uniqueBlobs.length ? [host.artifacts.publish({ operationId: `seal-${runId}`, manifest: { kind: 'resource', schemaVersion: '1.0.0',
    content: { format: 'sesame.mt5.native-task/1', runId, description: 'Frozen native MT5 records and evidence; original language and validation scopes retained.' }, blobs: uniqueBlobs, dependencies: [] } })] : [];
  const protection = { artifacts, resources };
  mt5.storage.put('sealed_run', { id: runId, protection, sealedAt: new Date().toISOString() });
  return protection;
}

async function removeOwned(root, path) {
  const child = relative(root, path);
  requireValue(child && !child.startsWith('..') && !isAbsolute(child), 'MT5 清理路径超出插件私有目录');
  const info = await fs.lstat(path).catch(error => { if (error.code !== 'ENOENT') throw error; return null; });
  if (!info) return;
  requireValue(!info.isSymbolicLink() && await fs.realpath(path) === path, 'MT5 清理路径不能被链接重定向');
  await fs.rm(path, { recursive: true });
}

export async function cleanupRun(host, mt5, runId, protection) {
  await settleRun(mt5, runId);
  const sealed = mt5.storage.get('sealed_run', runId, true);
  protection ??= sealed?.protection;
  requireValue(sealed && JSON.stringify(sealed.protection) === JSON.stringify(protection), '需要已封存的 MT5 成果才能清理任务');
  for (const ref of protection.artifacts) host.artifacts.read(ref);
  for (const resource of protection.resources) await file(resource.path, resource.digest);
  const root = mt5.storage.directory;
  for (const build of mt5.storage.list('mt5_build').filter(row => row.owner_run_id === runId)) {
    const directory = join(root, 'mt5/builds', build.id);
    if (build.status !== 'succeeded') {
      // The sealed artifact retains diagnostics and source evidence. Failed or
      // canceled task intermediates have no native consumer after settlement.
      await removeOwned(root, directory);
      mt5.storage.delete('mt5_build', build.id);
      continue;
    }
    const entries = await fs.readdir(directory, { withFileTypes: true }).catch(error => { if (error.code !== 'ENOENT') throw error; return []; });
    for (const entry of entries) {
      const path = join(directory, entry.name);
      if (entry.name === 'Experts' && build.status === 'succeeded') {
        for (const name of await fs.readdir(path)) if (name !== 'Strategy.ex5') await removeOwned(root, join(path, name));
      } else await removeOwned(root, path);
    }
    mt5.storage.put('mt5_build', { ...build, archived_artifact: protection.artifacts[0] ?? null, intermediate_files_removed: true });
  }
  for (const pass of mt5.storage.list('mt5_pass').filter(row => row.owner_run_id === runId)) {
    await removeOwned(root, join(root, 'mt5/backtests', pass.id));
    mt5.storage.put('mt5_pass', { ...pass, archived_artifact: protection.artifacts[0] ?? null, intermediate_files_removed: true });
  }
  for (const kind of ['mt5_checkout', 'mt5_command']) for (const row of mt5.storage.list(kind)) if (row.owner_run_id === runId) mt5.storage.delete(kind, row.id);
}
