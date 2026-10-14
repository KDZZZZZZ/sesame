import { check, payload } from './shared.js';

const names = value => Array.isArray(value) && value.length <= 64 && new Set(value).size === value.length && value.every(name => typeof name === 'string' && name.length > 0 && name.length <= 150);
function available(host, id) {
  let entry;
  try { entry = host.plugins.inspect(id); } catch { /* Return an actionable prerequisite. */ }
  check(entry && entry.state !== 'disabled' && entry.runtime_status !== 'failed' && entry.agent_scope !== 'main', 'PREREQUISITE_REQUIRED', `Select an available delegatable plugin: ${id}`);
  check(Array.isArray(entry.delegatable_tools), 'HOST_UPGRADE_REQUIRED', 'Plugin composition requires the host delegatable_tools metadata');
  return entry;
}
const revision = entry => ({ id: entry.id, digest: entry.digest });
export function selectResearch(host, input = {}) {
  const ids = input.plugins ?? [];
  check(names(ids) && ids.length <= 24, 'INVALID_ARGUMENT', 'Choose at most 24 unique installed research plugin IDs');
  const entries = ids.map(id => available(host, id)), allowed = [...new Set(entries.flatMap(entry => entry.delegatable_tools))];
  const tools = input.tools ?? allowed;
  check(names(tools) && tools.every(name => allowed.includes(name)), 'TOOL_NOT_DELEGATABLE', 'Research tools must belong to selected plugins and be available to subagents');
  return { plugins: [...ids], tools: [...tools], revisions: entries.map(revision) };
}
export function verifyComposition(host, selection) {
  for (const frozen of selection?.revisions ?? []) {
    const current = available(host, frozen.id);
    check(current.digest === frozen.digest, 'PLUGIN_CHANGED', `Selected plugin changed; reconfigure this plan: ${frozen.id}`);
  }
}
export async function bindExecution(host, input, signal) {
  check(input && typeof input === 'object' && !Array.isArray(input), 'EXECUTION_REQUIRED', 'Select an execution capability with plugin_id, context_tool, apply_tool and its binding arguments');
  const { plugin_id: pluginId, context_tool: contextTool, apply_tool: applyTool, arguments: args = {} } = input;
  const entry = available(host, pluginId);
  check(entry.delegatable_tools.includes(contextTool) && entry.delegatable_tools.includes(applyTool) && contextTool !== applyTool, 'TOOL_NOT_DELEGATABLE', 'Execution context/apply tools must be distinct delegatable tools of the selected plugin');
  check(host.plugins.isActive(pluginId), 'PREREQUISITE_REQUIRED', `Load the selected execution plugin first: ${pluginId}`);
  check(args && typeof args === 'object' && !Array.isArray(args) && Buffer.byteLength(JSON.stringify(args)) <= 4000 && !['action', 'run', 'history_days'].some(key => Object.hasOwn(args, key)), 'INVALID_ARGUMENT', 'Use bounded capability binding arguments without workflow action fields');
  const identity = payload(await host.tools.call({ pluginId, name: contextTool, arguments: { ...args, action: 'identity' } }, signal));
  check(identity?.account && typeof identity.account.accountId === 'string' && identity.account.accountId, 'SOURCE_DATA_INVALID', 'Execution capability must identify its configured account');
  check(names(identity.tools) && names(identity.readTools) && identity.tools.includes(contextTool) && identity.tools.includes(applyTool)
    && identity.readTools.includes(contextTool) && !identity.readTools.includes(applyTool) && identity.readTools.every(name => identity.tools.includes(name)), 'SOURCE_DATA_INVALID', 'Execution capability must declare complete tools and its read-only subset');
  const catalog = host.plugins.discover('').items;
  const dependencies = new Map([[entry.id, entry]]);
  for (const tool of identity.tools) {
    const owners = catalog.filter(value => value.tools?.includes(tool));
    check(owners.length === 1, 'PREREQUISITE_REQUIRED', `Execution tool unavailable or ambiguous: ${tool}`);
    const owner = available(host, owners[0].id);
    check(owner.delegatable_tools.includes(tool), 'TOOL_NOT_DELEGATABLE', `Execution dependency is main-only: ${tool}`);
    check(host.plugins.isActive(owner.id), 'PREREQUISITE_REQUIRED', `Load the chosen execution dependency first: ${owner.id}`);
    dependencies.set(owner.id, owner);
  }
  const rules = identity.quantityRules;
  check(rules && typeof rules.unit === 'string' && rules.unit.length > 0 && rules.unit.length <= 40 && typeof rules.signed === 'boolean' && typeof rules.integer === 'boolean', 'SOURCE_DATA_INVALID', 'Execution capability must declare its quantity unit and numeric constraints');
  check(identity.taskContext && typeof identity.taskContext === 'object' && !Array.isArray(identity.taskContext) && Buffer.byteLength(JSON.stringify(identity.taskContext)) <= 8000, 'SOURCE_DATA_INVALID', 'Execution capability must supply bounded frozen task context');
  const fillSources = identity.fillSources ?? [];
  check(Array.isArray(fillSources) && fillSources.length <= 16 && fillSources.every(source => dependencies.has(source?.pluginId) && typeof source.provider === 'string' && source.provider.length > 0 && source.provider.length <= 200), 'SOURCE_DATA_INVALID', 'Fill sources must name a selected producer plugin and exact external provider');
  return structuredClone({ pluginId, contextTool, applyTool, arguments: args, account: identity.account, context: identity.taskContext,
    tools: identity.tools, readTools: identity.readTools, quantityRules: rules, accountProvider: identity.accountProvider ?? null, fillSources,
    plugins: [...dependencies.keys()], revisions: [...dependencies.values()].map(revision) });
}

export function executionCall(host, execution, kind, args, signal) {
  return host.tools.call({ pluginId: execution.pluginId, name: kind === 'apply' ? execution.applyTool : execution.contextTool,
    arguments: { ...execution.arguments, ...args } }, signal).then(payload);
}
