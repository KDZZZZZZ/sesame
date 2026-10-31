import { REPORT_CALLS } from './team.js';

import { check, configuredModel as selectModel, uniqueCalls, verifyRevisions, researchSafeCapability } from './workflow-mechanics.js';
export { check } from './workflow-mechanics.js';
// These reviewed functions have narrow public inputs but declare their real
// internal process/cache effects. Never grant a generic shell/config tool.
const reviewedResearch = {
  // Public manifests and declared knowledge only; no installation/configuration.
  'sesame/plugin-manager#plugin_read': [],
  'sesame/rss-collect#parse_feed': ['resources.read', 'process', 'filesystem', 'resources.publish'],
  'sesame/web-extract#extract_webpage': ['resources.read', 'process', 'filesystem', 'resources.publish'],
  'sesame/financial-research#financial_research_query': ['network', 'resources.publish', 'plugin.state.write'],
  'sesame/financial-research#financial_research_read': [],
  'sesame/data-access#data_read': ['data.query', 'resource.read', 'filesystem.write'],
  // Freeze queried rows or verified execution output. state.write is limited
  // to the capture's idempotency record; these functions do not run commands.
  'sesame/data-access#data_snapshot': ['data.query', 'resource.create', 'artifact.publish', 'state.write'],
  'sesame/data-access#market_read': ['data.query', 'resource.create', 'artifact.publish', 'state.write'],
  'sesame/data-access#research_register': ['data.query', 'resource.create', 'artifact.publish', 'state.write'],
  // Reviewed deterministic input-only math. Empty effects on an unknown tool
  // still do not imply safety. The fixed-ref adapter publishes only its actual
  // derived result with the original fixed inputs, not arbitrary resources.
  'sesame/historical-evidence#historical_evidence_match': [],
  'sesame/historical-evidence#historical_evidence_calibrate': [],
  'sesame/historical-evidence#historical_evidence_from_ref': ['resources.read', 'resources.create', 'resources.publish'],
};
export const readOnly = cap => researchSafeCapability(cap) || cap.kind === 'function' && Object.hasOwn(reviewedResearch, cap.id)
  && JSON.stringify([...(cap.effects ?? [])].sort()) === JSON.stringify([...reviewedResearch[cap.id]].sort());

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
  const pluginIds = plugins.filter(id => id !== 'host');
  const entries = await Promise.all(pluginIds.map(id => plugin(host, id)));
  const hostCalls = calls.filter(call => call.pluginId === 'host');
  if (hostCalls.length) {
    const declared = await catalog(host, 'host');
    for (const call of hostCalls) check(['reports.describe', 'reports.publish'].includes(call.capabilityId)
      && declared.some(cap => cap.localId === call.capabilityId), 'DEPENDENCY_UNAVAILABLE',
    `Required host report capability host.${call.capabilityId} is unavailable; this workflow needs Sesame >=0.3.0-dev.2.`);
  }
  for (const entry of entries) {
    const declared = await catalog(host, entry.id);
    for (const call of calls.filter(call => call.pluginId === entry.id)) {
      check(declared.some(cap => cap.localId === call.capabilityId) && entry.delegatable_tools?.includes(call.capabilityId), 'DEPENDENCY_UNAVAILABLE', `Required Agent capability ${entry.id}#${call.capabilityId} is unavailable.`);
    }
  }
  const allowedCalls = uniqueCalls(calls);
  return { plugins: pluginIds, allowedCalls, revisions: entries.map(entry => ({ id: entry.id, digest: entry.digest })) };
}
export const reportSelection = host => freezeSelection(host, [...new Set(REPORT_CALLS.map(call => call.pluginId))], REPORT_CALLS);
export const synthesisSelection = (host, research) => freezeSelection(host, research.plugins,
  research.allowedCalls.filter(call => call.pluginId === 'sesame/plugin-manager' && call.capabilityId === 'plugin_read'));
export async function stageSelection(host, research, phase) {
  let calls;
  if (phase === 'scope') {
    calls = [{ pluginId: 'host', capabilityId: 'reports.describe' }, { pluginId: 'sesame/plugin-manager', capabilityId: 'plugin_read' }, { pluginId: 'sesame/reports', capabilityId: 'report_structure' }];
  } else if (phase === 'analysis') {
    const declarations = (await Promise.all(research.plugins.map(id => catalog(host, id)))).flat();
    calls = research.allowedCalls.filter(call => {
      const cap = declarations.find(value => value.id === `${call.pluginId}#${call.capabilityId}`);
      return cap && !cap.effects?.includes('network');
    });
  } else return research;
  return freezeSelection(host, [...new Set([...research.plugins, ...calls.map(call => call.pluginId)])], calls);
}
export async function verifySelection(host, selection) {
  await verifyRevisions(selection.revisions, id => plugin(host, id), { code: 'DEPENDENCY_UNAVAILABLE' });
  await freezeSelection(host, selection.plugins, selection.allowedCalls);
}
