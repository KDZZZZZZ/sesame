import { REPORT_CALLS } from './team.js';

import { check, configuredModel as selectModel, uniqueCalls, verifyRevisions, researchSafeCapability } from './workflow-mechanics.js';
export { check } from './workflow-mechanics.js';
const readOnly = researchSafeCapability;

async function plugin(host, id) {
  let value;
  try { value = await host.plugins.read(id, { part: 'status' }); }
  catch (error) { throw Object.assign(new Error(`Required plugin ${id} is unavailable: ${error.message}`), { code: 'DEPENDENCY_UNAVAILABLE' }); }
  check(value.state !== 'disabled' && value.runtime_status !== 'failed' && value.agent_scope !== 'main', 'DEPENDENCY_UNAVAILABLE', `Required plugin ${id} must be enabled and usable by a research Agent.`);
  return value;
}
async function catalog(host, pluginId) {
  const items = []; let cursor;
  do {
    const page = await host.capabilities.list({ pluginId, limit: 200, ...(cursor ? { cursor } : {}) });
    items.push(...page.items); cursor = page.nextCursor;
  } while (cursor);
  return items.filter(cap => cap.consumers.includes('agent'));
}
export const configuredModel = (host, selection) => selectModel(host, selection, { required: 'DEPENDENCY_UNAVAILABLE', unavailable: 'DEPENDENCY_UNAVAILABLE', changed: 'DEPENDENCY_UNAVAILABLE' });
export async function selectResearch(host, selection) {
  const entries = await Promise.all(selection.plugins.map(id => plugin(host, id)));
  const declarations = (await Promise.all(entries.map(entry => catalog(host, entry.id)))).flat()
    .filter(cap => entries.find(entry => entry.id === cap.pluginId).delegatable_tools?.includes(cap.localId));
  const requested = selection.tools ?? declarations.filter(readOnly).map(cap => cap.id);
  const calls = requested.map(name => {
    const candidates = declarations.filter(cap => cap.id === name || cap.localId === name);
    check(candidates.length === 1, 'DEPENDENCY_UNAVAILABLE', `Select one declared research capability for ${name}; qualified pluginId#capabilityId avoids ambiguity.`);
    const cap = candidates[0];
    check(readOnly(cap), 'READ_ONLY_RESEARCH', `Research cannot use ${cap.id}: it declares trading, configuration, process, workspace editing or workflow control effects.`);
    return { pluginId: cap.pluginId, capabilityId: cap.localId };
  });
  if (entries.length) calls.push({ pluginId: 'sesame/plugin-manager', capabilityId: 'plugin_read' });
  return freezeSelection(host, [...new Set([...selection.plugins, ...calls.map(call => call.pluginId)])], calls);
}
async function freezeSelection(host, plugins, calls) {
  const entries = await Promise.all(plugins.map(id => plugin(host, id)));
  for (const entry of entries) {
    const declared = await catalog(host, entry.id);
    for (const call of calls.filter(call => call.pluginId === entry.id)) {
      check(declared.some(cap => cap.localId === call.capabilityId) && entry.delegatable_tools?.includes(call.capabilityId), 'DEPENDENCY_UNAVAILABLE', `Required Agent capability ${entry.id}#${call.capabilityId} is unavailable.`);
    }
  }
  const allowedCalls = uniqueCalls(calls);
  return { plugins, allowedCalls, revisions: entries.map(entry => ({ id: entry.id, digest: entry.digest })) };
}
export const reportSelection = host => freezeSelection(host, [...new Set(REPORT_CALLS.map(call => call.pluginId))], REPORT_CALLS);
export const synthesisSelection = (host, research) => freezeSelection(host, research.plugins,
  research.allowedCalls.filter(call => call.pluginId === 'sesame/plugin-manager' && call.capabilityId === 'plugin_read'));
export async function verifySelection(host, selection) {
  await verifyRevisions(selection.revisions, id => plugin(host, id), { code: 'DEPENDENCY_UNAVAILABLE' });
  await freezeSelection(host, selection.plugins, selection.allowedCalls);
}
