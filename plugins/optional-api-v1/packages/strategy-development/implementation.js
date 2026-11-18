import { readFile, realpath, stat } from 'node:fs/promises';
import { isAbsolute, relative, resolve, sep } from 'node:path';
import { digest } from '@sesame/plugin-sdk/protocol';
import { isRef, publishRecord, readRecord, requireThat } from './records.js';
import { loadProject, saveProject } from './project.js';

const NATIVE = 'strategy-development.native-source';
const author = 'sesame/strategy-authoring#';
export async function immediate(host, id, args, signal) {
  const result = await host.capabilities.invoke(id, args, { signal });
  requireThat(result.type === 'result', id + ' must return an immediate result.');
  return result.value;
}

async function workspaceText(host, path, maxBytes) {
  requireThat(host.context.workspaceRoot, 'Open a task workspace to import strategy files.');
  const root = await realpath(host.context.workspaceRoot);
  const actual = await realpath(resolve(root, path));
  const part = relative(root, actual);
  requireThat(part && part !== '..' && !part.startsWith('..' + sep) && !isAbsolute(part), 'Select a file inside the current workspace.');
  const info = await stat(actual);
  requireThat(info.isFile() && info.size <= maxBytes, 'Strategy file is missing or too large.');
  return new TextDecoder('utf-8', { fatal: true }).decode(await readFile(actual));
}

export async function materialize(host, text, suffix, signal) {
  const path = 'development-' + digest(text).slice(7) + suffix;
  try {
    requireThat(await workspaceText(host, path, 4 * 1024 * 1024) === text, 'The generated workspace file was edited. Preserve it and supply the edited file explicitly.');
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    try { await immediate(host, 'sesame/workspace#write', { path, content: text, overwrite: false }, signal); }
    catch (writeError) {
      // Another invocation can be materializing identical content at this path.
      try { if (await workspaceText(host, path, 4 * 1024 * 1024) === text) return path; } catch {}
      throw writeError;
    }
  }
  return path;
}

export async function nativePath(host, ref, signal) {
  const source = await readRecord(host, ref, NATIVE);
  requireThat(typeof source.text === 'string' && digest(source.text) === source.hash, 'Native source digest mismatch.');
  return materialize(host, source.text, '.py', signal);
}

export async function buildProject(host, input, signal) {
  const project = await loadProject(host, input.project_ref), previous = project.implementation ?? {};
  const implementation = { ...previous };
  const key = input.operation_id, structure = project.structure;
  requireThat(!(input.native_template && input.native_source_path), 'Choose a packaged template or an authored native source for this build.');
  let sourcePath = input.source_path;
  if (!sourcePath && !input.native_template && !previous.sourceRef && structure.starterSource)
    sourcePath = await materialize(host, JSON.stringify(structure.starterSource, null, 2), '.svl.json', signal);
  if (sourcePath) {
    const source = JSON.parse(await workspaceText(host, sourcePath, 1024 * 1024));
    if (input.source_path && !project.strategyIdChosen && !previous.sourceRef && !project.parentSourceRef) {
      structure.strategyId = source.strategyId;
      if (structure.starterSource) structure.starterSource.strategyId = source.strategyId;
      project.strategyIdChosen = true;
    }
    requireThat(source.strategyId === structure.strategyId, 'Set design.strategyId to the strategyId in the authored SVL source.');
    const parent = previous.sourceRef ?? project.parentSourceRef;
    const result = await immediate(host, author + 'strategy_publish', { source_path: sourcePath,
      title: input.title ?? structure.strategyId, change_summary: input.change_summary ?? project.revision.reason,
      operation_id: key + ':svl', ...(parent ? { parent } : {}) }, signal);
    requireThat(isRef(result.ref, 'strategy.source') && result.sourceDigest, 'SVL publisher did not return a fixed validated source.');
    if (result.sourceDigest !== previous.sourceDigest) {
      delete implementation.replay;
      delete implementation.methodCheck;
      delete implementation.temporalCheck;
    }
    Object.assign(implementation, { sourceRef: result.ref, sourceDigest: result.sourceDigest, sourcePath,
      scope: input.source_path ? 'authored_svl' : structure.sourceScope });
  }
  if (input.replay_path) {
    requireThat(implementation.sourceRef, 'Publish an SVL source before replay.');
    const replay = await immediate(host, author + 'strategy_replay', { source: implementation.sourceRef,
      fixture_path: input.replay_path, operation_id: key + ':replay' }, signal);
    requireThat(replay.nativeEngineExecuted === false && isRef(replay.evidence, 'resource'), 'SVL replay did not produce fixed event evidence.');
    if (digest(implementation.replay?.ref ?? null) !== digest(replay.evidence)) delete implementation.temporalCheck;
    implementation.replay = { ref: replay.evidence, status: replay.status, validationScope: replay.validationScope, nativeEngineExecuted: false };
  }
  let methodPath = input.workflow_path;
  if (!methodPath && structure.workflowFixture && implementation.sourceRef) {
    const fixture = { ...structure.workflowFixture, strategySource: implementation.sourceRef };
    methodPath = await materialize(host, JSON.stringify(fixture), '.workflow.json', signal);
  }
  if (methodPath) {
    const fixture = JSON.parse(await workspaceText(host, methodPath, 4 * 1024 * 1024));
    requireThat(implementation.sourceRef && digest(fixture.strategySource) === digest(implementation.sourceRef), 'The workflow fixture must use this exact SVL source.');
    const checked = await immediate(host, author + 'strategy_workflow', { fixture_path: methodPath, operation_id: key + ':methods' }, signal);
    requireThat(checked.nativeEngineExecuted === false && isRef(checked.evidence, 'resource'), 'The method fixture must return fixed evaluation evidence.');
    implementation.methodCheck = { ref: checked.evidence, validationScope: checked.validationScope, nativeEngineExecuted: false };
  }
  if (input.native_source_path || input.native_template) {
    requireThat(!input.native_template || input.native_template === 'forecast_buffer', 'Unknown native research template.');
    const text = input.native_template ? await readFile(new URL('./templates/forecast_buffer.py', import.meta.url), 'utf8')
      : await workspaceText(host, input.native_source_path, 1024 * 1024);
    requireThat(text.trim(), 'The authored Backtrader strategy file is empty.');
    implementation.nativeSourcePath = input.native_source_path ?? await materialize(host, text, '.py', signal);
    implementation.nativeTemplate = input.native_template ?? null;
    implementation.nativeHash = digest(text);
    if (implementation.nativeHash !== previous.nativeHash)
      implementation.nativeSourceRef = await publishRecord(host, NATIVE, { text, hash: implementation.nativeHash, target: 'backtrader' }, key + ':python');
  }
  requireThat(implementation.sourceRef || implementation.nativeSourceRef, 'Supply the authored source for the selected models.');
  const changed = previous.nativeHash !== implementation.nativeHash || previous.sourceDigest !== implementation.sourceDigest;
  return saveProject(host, { ...project, implementation, ...(changed ? { experiment: null, protocol: null, parameterTrial: null } : {}) }, input.project_ref, key);
}
