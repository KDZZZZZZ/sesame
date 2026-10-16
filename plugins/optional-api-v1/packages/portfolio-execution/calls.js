import { invokeValue } from '@sesame/plugin-sdk/capabilities';

export async function pluginStatus(host, pluginId) {
  try { return await host.plugins.read(pluginId, { part: 'status' }); }
  catch (error) { if (['NOT_FOUND', 'not_found', 'PLUGIN_NOT_FOUND', 'plugin_not_found'].includes(error.code)) return undefined; throw error; }
}

export async function requirePlugin(host, pluginId) {
  const status = await pluginStatus(host, pluginId);
  if (!status || status.state === 'disabled' || status.runtime_status === 'failed') throw Object.assign(new Error(`Enable the configured ${pluginId} plugin before execution`), { code: 'PREREQUISITE_REQUIRED' });
  return status;
}

// Stable capability IDs preserve the selected plugin boundary; the SDK drains
// asynchronous Run results and propagates cancellation through public ports.
export const invoke = (host, pluginId, capabilityId, input, signal) => invokeValue(host, `${pluginId}#${capabilityId}`, input, { signal });
