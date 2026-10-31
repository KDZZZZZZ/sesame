import { invokeValue } from '@sesame/plugin-sdk/capabilities';
import { check } from './shared.js';
import { verifyRevisions } from './workflow-mechanics.js';

const names = value => Array.isArray(value) && value.length <= 256 && new Set(value).size === value.length && value.every(name => typeof name === 'string' && name.length > 0 && name.length <= 150);
const executionHelp = 'Get a producer-returned binding, e.g. sesame/portfolio-execution#portfolio_execution_configure({backend:"mt5"}); its portfolio_execution_context supplies this contract. Other implementations of the same contract are valid. Available declarations: host.capabilities.list/plugin_discover; missing package: plugin_catalog. Native account identity alone is insufficient.';
async function available(host, id) {
  let entry;
  try { entry = await host.plugins.read(id, { part: 'status' }); }
  catch (error) { if (!['NOT_FOUND', 'not_found', 'PLUGIN_NOT_FOUND', 'plugin_not_found'].includes(error.code)) throw error; }
  check(entry && entry.state !== 'disabled' && entry.runtime_status !== 'failed', 'PREREQUISITE_REQUIRED', `Required plugin ${id} is absent, disabled or failed. Read its installed status with plugin_discover; use plugin_catalog for published packages if absent. A matching enabled implementation is required before saving the plan.`);
  return entry;
}
const revision = entry => ({ id: entry.id, digest: entry.digest });
export async function catalog(host, pluginId) {
  const items = []; let cursor;
  do { const page = await host.capabilities.list({ ...(pluginId ? { pluginId } : {}), limit: 200, ...(cursor ? { cursor } : {}) }); items.push(...page.items); cursor = page.nextCursor; } while (cursor);
  return items.filter(item => item.consumers.includes('agent'));
}
export async function declaredCalls(host, tools, plugins) {
  const declarations = (await catalog(host)).filter(item => plugins.includes(item.pluginId));
  return tools.map(name => {
    const matches = declarations.filter(item => item.localId === name);
    check(matches.length === 1, 'TOOL_NOT_DELEGATABLE', `Select one explicitly declared capability for ${name}`);
    return { pluginId: matches[0].pluginId, capabilityId: matches[0].localId };
  });
}
export const requirePlugins = (host, ids) => Promise.all(ids.map(id => available(host, id)));
export async function verifyComposition(host, selection) {
  await verifyRevisions(selection?.revisions, id => available(host, id));
}
export async function bindExecution(host, input, signal) {
  check(input && typeof input === 'object' && !Array.isArray(input), 'EXECUTION_REQUIRED', `execution requires {plugin_id,context_tool,apply_tool,arguments?}. ${executionHelp}`);
  const { plugin_id: pluginId, context_tool: contextTool, apply_tool: applyTool, arguments: args = {} } = input;
  const entry = await available(host, pluginId), caps = await catalog(host, pluginId);
  check(caps.some(item => item.localId === contextTool) && caps.some(item => item.localId === applyTool) && contextTool !== applyTool, 'TOOL_NOT_DELEGATABLE', `Execution requires distinct declared capabilities ${pluginId}#${contextTool} and ${pluginId}#${applyTool}. ${executionHelp}`);
  check(args && typeof args === 'object' && !Array.isArray(args) && Buffer.byteLength(JSON.stringify(args)) <= 4000 && !['action', 'run', 'history_days'].some(key => Object.hasOwn(args, key)), 'INVALID_ARGUMENT', 'Use bounded capability binding arguments without workflow action fields');
  const identity = await invokeValue(host, `${pluginId}#${contextTool}`, { ...args, action: 'identity' }, { signal });
  const issues = [], tools = identity?.tools, readTools = identity?.readTools, rules = identity?.quantityRules;
  if (!identity?.account || typeof identity.account.accountId !== 'string' || !identity.account.accountId) issues.push('account.accountId: nonempty configured account ID');
  if (!names(tools) || !tools.includes(contextTool) || !tools.includes(applyTool)) issues.push('tools: unique complete nested-call names including the selected context and apply');
  if (!names(readTools) || !readTools.includes(contextTool) || readTools.includes(applyTool) || !names(tools) || !readTools.every(name => tools.includes(name))) issues.push('readTools: unique subset of tools including context and excluding apply');
  if (!rules || typeof rules.unit !== 'string' || !rules.unit.length || rules.unit.length > 40 || typeof rules.signed !== 'boolean' || typeof rules.integer !== 'boolean') issues.push('quantityRules: {unit:nonempty string,signed:boolean,integer:boolean}');
  if (!identity?.taskContext || typeof identity.taskContext !== 'object' || Array.isArray(identity.taskContext) || Buffer.byteLength(JSON.stringify(identity.taskContext)) > 8000) issues.push('taskContext: frozen binding object, at most 8KB');
  check(!issues.length, 'SOURCE_DATA_INVALID', `${pluginId}#${contextTool} action=identity does not satisfy the execution contract. Missing or invalid: ${issues.join('; ')}. ${executionHelp}`);
  const declarations = await catalog(host), dependencies = new Map([[entry.id, entry]]), allowedCalls = [];
  for (const tool of identity.tools) {
    const matches = declarations.filter(value => value.localId === tool);
    check(matches.length === 1, 'PREREQUISITE_REQUIRED', `Execution capability unavailable or ambiguous: ${tool}`);
    const owner = await available(host, matches[0].pluginId);
    dependencies.set(owner.id, owner); allowedCalls.push({ pluginId: owner.id, capabilityId: tool });
  }
  const fillSources = identity.fillSources ?? [];
  check(Array.isArray(fillSources) && fillSources.length <= 16 && fillSources.every(source => dependencies.has(source?.pluginId) && typeof source.provider === 'string' && source.provider.length > 0 && source.provider.length <= 200), 'SOURCE_DATA_INVALID', 'Fill sources must name a selected producer plugin and exact external provider');
  return structuredClone({ pluginId, contextTool, applyTool, arguments: args, account: identity.account, context: identity.taskContext,
    tools: identity.tools, readTools: identity.readTools, allowedCalls, quantityRules: rules, accountProvider: identity.accountProvider ?? null, fillSources,
    plugins: [...dependencies.keys()], revisions: [...dependencies.values()].map(revision) });
}
export const executionCall = (host, execution, kind, args, signal) => invokeValue(host,
  `${execution.pluginId}#${kind === 'apply' ? execution.applyTool : execution.contextTool}`, { ...execution.arguments, ...args }, { signal });
