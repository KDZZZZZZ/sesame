import { workspacePath, writeWorkspace, snapshotWorkspace } from './files.js';
import { ownership } from './records.js';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readTree, id, now, requireValue } from './support.js';
import { DEFAULT_RISK_LIMITS, SDK_VERSION, projectFiles, riskLimits, stableJSON, strategyImplementation } from './contracts.js';
import { visualTemplate } from './visual/index.js';

const here = fileURLToPath(new URL('.', import.meta.url));
const texts = files => Object.fromEntries(Object.entries(files).map(([name, bytes]) => [name, bytes.toString('utf8')]));
export const buildHeader = key => `#define PRODUCT_BUILD_ID "${key}"\n#define PRODUCT_SDK_VERSION "${SDK_VERSION}"\n`;

// The facade owns the host, store and source assets. Loading stays relative to
// this package's backend so independently installed packages use their own SDK.
export async function init(mt5) {
  mt5.legacyTemplate = projectFiles(texts(await readTree(join(here, 'template'))));
  mt5.template = projectFiles(visualTemplate());
  mt5.sdk = texts(await readTree(join(here, 'sdk')));
}

export function list(mt5) { return mt5.storage.list('mt5_project'); }

export function project(mt5, key) {
  const project = mt5.storage.get('mt5_project', key);
  const revision = mt5.storage.get('mt5_revision', `${key}:${project.revision}`);
  return { ...project, files: revision.files, rules: revision.rules, engine: revision.engine ?? null, strategy_contract: revision.strategy_contract ?? null, svl_source: revision.svl_source ?? null, implementation: mt5.validateSource(project, revision), builds: mt5.storage.list('mt5_build').filter(build => build.project_id === key), backtests: mt5.tester.list(key) };
}

export function create(mt5, title) {
  requireValue(typeof title === 'string' && title.trim().length > 0 && title.length <= 120, '工程名称需要 1–120 个字符');
  const key = id('project'), timestamp = now();
  return mt5.storage.transaction(() => {
    mt5.storage.put('mt5_revision', { id: `${key}:1`, project_id: key, revision: 1, ...mt5.template, created_at: timestamp });
    return mt5.storage.put('mt5_project', { id: key, version: 1, title: title.trim(), revision: 1, source_digest: mt5.template.source_digest,
      sdk_version: SDK_VERSION, template_version: mt5.template.strategy_contract.template_version, test_risk_limits: { ...DEFAULT_RISK_LIMITS }, created_at: timestamp, updated_at: timestamp });
  });
}

export function configure(mt5, key, limits, expectedVersion) {
  const project = mt5.storage.get('mt5_project', key);
  requireValue(expectedVersion === project.version, '工程已更新，请刷新后重试', 409, 'version_conflict');
  return mt5.storage.put('mt5_project', { ...project, version: project.version + 1, test_risk_limits: riskLimits(limits), updated_at: now() });
}

export function validateSource(mt5, project, source) {
  if (project.translation) {
    requireValue(source.source_digest === project.source_digest, '翻译成果的代码不能原地改写；先修订 SVL 并登记新的翻译', 409, 'translation_changed');
    return { status: 'translated_unverified', pending_modules: [], translation: project.translation };
  }
  if (project.template_version) {
    requireValue(source.strategy_contract?.template_version === project.template_version, '新工程必须保留 strategy.json 模块契约及模板版本');
    // Compare with the project's own initial revision so later template upgrades
    // cannot silently change an existing project's platform-owned entry points.
    const initial = mt5.storage.get('mt5_revision', `${project.id}:1`);
    requireValue(source.files['Experts/Strategy.mq5'] === initial.files['Experts/Strategy.mq5'] && Object.keys(source.files).filter(p => p.startsWith('Experts/')).length === 1, 'EA 入口由平台维护；请在 Include/Strategy 中实现扩展');
    const platformNodes = rules => rules.nodes.filter(n => n.id.startsWith('platform.')).sort((a, b) => a.id.localeCompare(b.id));
    requireValue(stableJSON(platformNodes(source.rules)) === stableJSON(platformNodes(initial.rules)), '平台规则节点不能修改、删除或新增；请使用策略自己的节点 ID');
  }
  return strategyImplementation(source);
}

export async function checkout(mt5, host, key, signal, conversationId) {
  const project = mt5.project(key), checkoutId = id('checkout');
  const relativePath = `projects/${key}/${checkoutId}`, relativeSdk = `inputs/mt5-sdk/${SDK_VERSION}`;
  const path = workspacePath(host,relativePath), sdkPath = workspacePath(host,relativeSdk);
  const files = Object.fromEntries(Object.entries(project.files).map(([name, content]) => [`${relativePath}/${name}`, content]));
  for (const [name, content] of Object.entries({ ...mt5.sdk, 'Build.mqh': buildHeader('unbuilt') })) files[`${relativeSdk}/Include/Product/${name}`] = content;
  // These are ordinary host files. Save checks the SDK against its package source.
  for (const [name, content] of Object.entries(files)) await writeWorkspace(host, name, content, signal);
  requireValue(typeof conversationId === 'string' && conversationId, 'Checkout 需要会话身份');
  const checkout = { ...ownership(host), id: checkoutId, project_id: key, conversation_id: conversationId, revision: project.revision, path, sdk_path: sdkPath };
  mt5.storage.put('mt5_checkout', checkout);
  return checkout;
}

export async function save(mt5, host, checkoutId, signal, conversationId) {
  const checkout = mt5.storage.get('mt5_checkout', checkoutId);
  requireValue(conversationId && checkout.conversation_id === conversationId, '只能保存当前会话的 checkout', 403);
  const expectedSdk = Object.fromEntries(Object.entries({ ...mt5.sdk, 'Build.mqh': buildHeader('unbuilt') }).map(([name, content]) => [`Include/Product/${name}`, content]));
  const actualSdk = texts(await snapshotWorkspace(host,checkout.sdk_path));
  requireValue(stableJSON(actualSdk) === stableJSON(expectedSdk), '工作区 SDK 已修改；请重新 checkout 恢复 SDK，再保存策略源码', 409, 'sdk_changed');
  const validated = projectFiles(texts(await snapshotWorkspace(host,checkout.path)));
  signal?.throwIfAborted();
  return mt5.storage.transaction(() => {
    const project = mt5.storage.get('mt5_project', checkout.project_id);
    requireValue(project.revision === checkout.revision, '另一个会话已保存新版本；请重新 checkout 并合并修改', 409, 'revision_conflict');
    mt5.validateSource(project, validated);
    const previous = mt5.storage.get('mt5_revision', `${project.id}:${project.revision}`);
    if (project.source_digest === validated.source_digest && previous.engine?.digest === validated.engine?.digest) return project;
    const revision = project.revision + 1, timestamp = now();
    mt5.storage.put('mt5_revision', { id: `${project.id}:${revision}`, project_id: project.id, revision, ...validated, created_at: timestamp });
    mt5.storage.put('mt5_checkout', { ...checkout, revision });
    return mt5.storage.put('mt5_project', { ...project, version: project.version + 1, revision, source_digest: validated.source_digest, updated_at: timestamp });
  });
}
