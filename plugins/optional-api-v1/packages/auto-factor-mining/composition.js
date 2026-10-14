import { canonical, check, text } from './shared.js';

const list = (value, name, max) => {
  check(Array.isArray(value) && value.length <= max && new Set(value).size === value.length, 'INVALID_ARGUMENT', `${name} must contain at most ${max} distinct entries`);
  return value.map(value => { check(text(value, name, 150) === value, 'INVALID_ARGUMENT', `${name} must use exact names`); return value; });
};
export function inspectPlugin(host, id) {
  check(typeof host.plugins?.inspect === 'function', 'HOST_UPGRADE_REQUIRED', 'Plugin composition requires current plugin discovery metadata');
  let entry;
  try { entry = host.plugins.inspect(id); } catch { check(false, 'RESEARCH_PLUGIN_UNAVAILABLE', `Selected plugin is not installed: ${id}`); }
  check(entry?.id === id && ['mounted', 'discoverable'].includes(entry.state) && entry.runtime_status !== 'failed' && entry.agent_scope !== 'main', 'RESEARCH_PLUGIN_UNAVAILABLE', `Selected plugin cannot run in background Agents: ${id}`);
  check(Array.isArray(entry.delegatable_tools), 'HOST_UPGRADE_REQUIRED', 'Upgrade Sesame to expose delegatable_tools before selecting research capabilities');
  check(typeof entry.version === 'string' && typeof entry.digest === 'string', 'RESEARCH_PLUGIN_UNAVAILABLE', `Plugin has no stable version/digest: ${id}`);
  return entry;
}
export function resolveResearch(host, input) {
  if (input === undefined) return { plugins: [], tools: [], descriptors: [] };
  check(input && typeof input === 'object' && !Array.isArray(input) && Object.keys(input).every(key => ['plugins', 'tools'].includes(key)), 'INVALID_ARGUMENT', 'research accepts plugins and optional tools');
  const plugins = list(input.plugins, 'research.plugins', 32), entries = plugins.map(id => inspectPlugin(host, id));
  const available = new Map();
  for (const entry of entries) for (const name of entry.delegatable_tools) {
    check(!available.has(name), 'RESEARCH_TOOL_AMBIGUOUS', `Tool name is supplied by multiple selected plugins: ${name}`); available.set(name, entry.id);
  }
  const tools = input.tools === undefined ? [...available.keys()] : list(input.tools, 'research.tools', 61);
  for (const name of tools) {
    check(available.has(name) || !entries.some(entry => entry.tools?.includes(name)), 'RESEARCH_TOOL_MAIN_ONLY', `Tool cannot run in a background Agent: ${name}`);
    check(available.has(name), 'RESEARCH_TOOL_UNAVAILABLE', `Tool does not belong to a selected plugin: ${name}`);
  }
  check(tools.length <= 61, 'RESEARCH_TOOL_LIMIT', 'Select at most 61 research tools, leaving space for workflow handoffs and the evaluator');
  return { plugins, tools, descriptors: entries.map(({ id, version, digest }) => ({ id, version, digest })) };
}
export function verifyResearch(host, frozen) {
  if (!frozen) return;
  const current = resolveResearch(host, { plugins: frozen.plugins, tools: frozen.tools });
  check(canonical(current.descriptors) === canonical(frozen.descriptors), 'RESEARCH_PLUGIN_CHANGED', 'Selected research plugin changed; restore its frozen version or start a new run');
}
export function taskPlugins(evaluator, research, { reporter = false, finalizer = false } = {}) {
  const plugins = reporter ? [] : [...new Set([evaluator.plugin_id, ...(!finalizer ? research?.plugins ?? [] : [])])];
  check(plugins.length <= 32, 'PLUGIN_BUDGET_EXCEEDED', 'Selected evaluator and research plugins exceed the host limit of 32 unique plugins per task');
  return plugins;
}
export function resolveEvaluator(host, input) {
  check(input && typeof input === 'object' && !Array.isArray(input) && Object.keys(input).every(key => ['plugin_id', 'tool', 'arguments'].includes(key)), 'EVALUATOR_REQUIRED', 'Select evaluator: {plugin_id, tool, arguments?}; no evaluator is chosen implicitly');
  const pluginId = text(input.plugin_id, 'evaluator.plugin_id', 150), tool = text(input.tool, 'evaluator.tool', 150), entry = inspectPlugin(host, pluginId);
  check(entry.delegatable_tools.includes(tool), 'EVALUATOR_UNAVAILABLE', 'Evaluator tool must belong to the selected plugin and support background invocation');
  const args = input.arguments ?? {};
  check(args && typeof args === 'object' && !Array.isArray(args) && Buffer.byteLength(JSON.stringify(args)) <= 16000, 'INVALID_ARGUMENT', 'evaluator.arguments must be a JSON object <=16KB');
  return { plugin_id: pluginId, tool, arguments: structuredClone(args), descriptor: { id: entry.id, version: entry.version, digest: entry.digest } };
}
export function verifyEvaluator(host, frozen) {
  check(frozen, 'EVALUATOR_REQUIRED', 'This legacy run has no independently selected evaluator; start a new run with evaluator configuration');
  const current = resolveEvaluator(host, { plugin_id: frozen.plugin_id, tool: frozen.tool, arguments: frozen.arguments });
  check(canonical(current.descriptor) === canonical(frozen.descriptor), 'EVALUATOR_CHANGED', 'Selected evaluator changed; restore the frozen version or start a new run');
}
