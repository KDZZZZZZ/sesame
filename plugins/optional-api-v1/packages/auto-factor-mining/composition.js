import { canonical, check, text } from './shared.js';

export const KNOWLEDGE_READER = Object.freeze({ pluginId: 'sesame/plugin-manager', capabilityId: 'plugin_read' });
// Frozen classifications come from installed manifests, never from caller input.
// Native plugin contracts are audited behavior promises, not a code sandbox.
export const hasResearchDataAccess = research => Boolean(research?.generalDataPlugins?.length) || (research?.tools ?? []).some(id =>
  id !== `${KNOWLEDGE_READER.pluginId}#${KNOWLEDGE_READER.capabilityId}` && !research.inputOnlyTools?.includes(id));
const emptyList = value => value === undefined || Array.isArray(value) && value.length === 0;
const generalDataEntry = entry => !emptyList(entry.hooks);
function inputOnly({ capability, entry }) {
  const access = capability.researchDataAccess;
  if (!access || access.schemaVersion !== 1 || access.reads !== 'input-only' || !['none', 'derived-artifacts-only'].includes(access.writes)
    || Object.keys(access).some(key => !['schemaVersion', 'reads', 'writes'].includes(key))) return false;
  if (capability.kind !== 'function' || capability.execution !== 'immediate' || (capability.transport ?? 'json') !== 'json'
    || capability.binding?.type !== 'native' || typeof capability.binding.name !== 'string'
    || Object.keys(capability.binding).some(key => !['type', 'name'].includes(key))) return false;
  if (!emptyList(capability.requires) || !emptyList(capability.allowedCalls) || capability.collaboration !== undefined
    || capability.resumable === true) return false;
  // Activation, providers and retained data can bypass a selected function's input.
  if (!['hooks', 'sources', 'services', 'stateCollections'].every(key => emptyList(entry[key]))) return false;
  // No wildcard write/read effects: derived artifacts are created only from this
  // invocation's supplied input/result, including cleanup of its own new blobs.
  return Array.isArray(capability.effects) && capability.effects.every(effect => access.writes === 'derived-artifacts-only'
    && ['resources.create', 'resources.publish'].includes(effect));
}
export function knowledgeCalls(host, research) {
  if (!research?.plugins?.length) return [];
  const entry = inspectPlugin(host, KNOWLEDGE_READER.pluginId);
  check(entry.capabilities.some(capability => capability.id === KNOWLEDGE_READER.capabilityId && capability.consumers.includes('agent')), 'RESEARCH_PLUGIN_UNAVAILABLE', 'Selected research methods require sesame/plugin-manager#plugin_read to read their declared knowledge.');
  return [KNOWLEDGE_READER];
}

const list = (value, name, max) => {
  check(Array.isArray(value) && value.length <= max && new Set(value).size === value.length, 'INVALID_ARGUMENT', `${name} must contain at most ${max} distinct entries`);
  return value.map(value => { check(text(value, name, 150) === value, 'INVALID_ARGUMENT', `${name} must use exact names`); return value; });
};
export function inspectPlugin(host, id) {
  check(typeof host.plugins?.read === 'function', 'HOST_UPGRADE_REQUIRED', 'Plugin composition requires declared capability manifests');
  let entry;
  try { const manifest = host.plugins.read(id, { part: 'manifest' }), status = host.plugins.read(id, { part: 'status' }); entry = { ...status, ...manifest, digest: manifest.revision }; } catch { check(false, 'RESEARCH_PLUGIN_UNAVAILABLE', `Selected plugin is not installed: ${id}`); }
  check(entry?.id === id && ['mounted', 'discoverable'].includes(entry.state) && entry.runtime_status !== 'failed' && entry.agent_scope !== 'main', 'RESEARCH_PLUGIN_UNAVAILABLE', `Selected plugin cannot run in background Agents: ${id}`);
  check(Array.isArray(entry.capabilities), 'HOST_UPGRADE_REQUIRED', 'Selected plugin requires a complete capability manifest');
  check(typeof entry.version === 'string' && typeof entry.digest === 'string', 'RESEARCH_PLUGIN_UNAVAILABLE', `Plugin has no stable version/digest: ${id}`);
  return entry;
}
export function resolveResearch(host, input) {
  if (input === undefined) return { plugins: [], tools: [], descriptors: [] };
  check(input && typeof input === 'object' && !Array.isArray(input) && Object.keys(input).every(key => ['plugins', 'tools'].includes(key)), 'INVALID_ARGUMENT', 'research accepts plugins and optional tools');
  const plugins = list(input.plugins, 'research.plugins', 32), entries = plugins.map(id => inspectPlugin(host, id));
  const available = new Map();
  for (const entry of entries) for (const capability of entry.capabilities.filter(value => value.consumers.includes('agent'))) {
    const name = `${entry.id}#${capability.id}`;
    check(!available.has(name), 'RESEARCH_TOOL_AMBIGUOUS', `Tool name is supplied by multiple selected plugins: ${name}`); available.set(name, { entry, capability });
  }
  const tools = input.tools === undefined ? [...available.keys()] : list(input.tools, 'research.tools', 61);
  for (const name of tools) {
    check(available.has(name) || !entries.some(entry => entry.capabilities.some(value => `${entry.id}#${value.id}` === name)), 'RESEARCH_TOOL_MAIN_ONLY', `Capability does not allow Agent consumers: ${name}`);
    check(available.has(name), 'RESEARCH_TOOL_UNAVAILABLE', `Tool does not belong to a selected plugin: ${name}`);
  }
  check(tools.length <= 61, 'RESEARCH_TOOL_LIMIT', 'Select at most 61 research tools, leaving space for workflow handoffs and the evaluator');
  const inputOnlyTools = tools.filter(name => inputOnly(available.get(name)));
  const generalDataPlugins = entries.filter(generalDataEntry).map(entry => entry.id);
  return { plugins, tools, descriptors: entries.map(({ id, version, digest }) => ({ id, version, digest })),
    ...(inputOnlyTools.length ? { inputOnlyTools } : {}), ...(generalDataPlugins.length ? { generalDataPlugins } : {}) };
}
export function verifyResearch(host, frozen) {
  if (!frozen) return;
  const current = resolveResearch(host, { plugins: frozen.plugins, tools: frozen.tools });
  check(canonical(current.descriptors) === canonical(frozen.descriptors), 'RESEARCH_PLUGIN_CHANGED', 'Selected research plugin changed; restore its frozen version or start a new run');
  check(canonical(current.inputOnlyTools ?? []) === canonical(frozen.inputOnlyTools ?? []), 'RESEARCH_PLUGIN_CHANGED', 'Selected research data access changed; start a new run with the current plugin declaration');
  check(canonical(current.generalDataPlugins ?? []) === canonical(frozen.generalDataPlugins ?? []), 'RESEARCH_PLUGIN_CHANGED', 'Selected research plugin data entry points changed; start a new run with the current plugin declaration');
}
export function taskPlugins(evaluator, research) {
  const plugins = [...new Set([evaluator.plugin_id, ...(research?.plugins ?? []), ...(research?.plugins?.length ? [KNOWLEDGE_READER.pluginId] : [])])];
  check(plugins.length <= 32, 'PLUGIN_BUDGET_EXCEEDED', 'Selected evaluator and research plugins exceed the host limit of 32 unique plugins per task');
  return plugins;
}
export function resolveEvaluator(host, input) {
  check(input && typeof input === 'object' && !Array.isArray(input) && Object.keys(input).every(key => ['plugin_id', 'tool', 'arguments'].includes(key)), 'EVALUATOR_REQUIRED', 'Select evaluator: {plugin_id, tool, arguments?}; no evaluator is chosen implicitly');
  const pluginId = text(input.plugin_id, 'evaluator.plugin_id', 150), tool = text(input.tool, 'evaluator.tool', 150), entry = inspectPlugin(host, pluginId);
  check(entry.capabilities.some(value => value.id === tool && value.consumers.includes('host')), 'EVALUATOR_UNAVAILABLE', 'Evaluator capability must belong to the selected plugin and allow host composition');
  const args = input.arguments ?? {};
  check(args && typeof args === 'object' && !Array.isArray(args) && Buffer.byteLength(JSON.stringify(args)) <= 16000, 'INVALID_ARGUMENT', 'evaluator.arguments must be a JSON object <=16KB');
  return { plugin_id: pluginId, tool, arguments: structuredClone(args), descriptor: { id: entry.id, version: entry.version, digest: entry.digest } };
}
export function verifyEvaluator(host, frozen) {
  check(frozen, 'EVALUATOR_REQUIRED', 'This legacy run has no independently selected evaluator; start a new run with evaluator configuration');
  const current = resolveEvaluator(host, { plugin_id: frozen.plugin_id, tool: frozen.tool, arguments: frozen.arguments });
  check(canonical(current.descriptor) === canonical(frozen.descriptor), 'EVALUATOR_CHANGED', 'Selected evaluator changed; restore the frozen version or start a new run');
}
