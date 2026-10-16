import { indicatorTool } from './indicator.js';
import { bindingTool, marketProviders } from './market-binding.js';

async function applyView(host, input) {
  try { return await host.views.apply(input); }
  catch (error) {
    if (error.code === 'version_conflict') {
      let version;
      try { version = (await host.views.inspect({ surface: 'canvas' })).version; }
      catch { /* Preserve the original conflict if the current view is unavailable. */ }
      error.details = { ...error.details, ...(version === undefined ? {} : { current_version: version }), next_action: { tool: 'canvas_inspect', arguments: {} } };
      error.message += `${version === undefined ? '' : `；当前版本 ${version}`}；先调用 canvas_inspect，核对最新布局后合并剩余操作，用新 command_id 和最新 expected_version 提交；不要并行复用旧版本。`;
    }
    throw error;
  }
}
export function createCapabilities(host) {
  return [
    { name: 'canvas_inspect', execute: async (_args, signal) => ({ ...await host.views.inspect({ surface: 'canvas' }, { signal }), market_sources: await marketProviders(host) }) },
    bindingTool(host),
    { name: 'canvas_apply', execute: args => applyView(host, { surface: 'canvas', commandId: args.command_id, expectedVersion: args.expected_version, operations: args.operations }) },
    { name: 'canvas_focus', execute: args => applyView(host, { surface: 'canvas', commandId: args.command_id, expectedVersion: args.expected_version, operations: [{ op: 'focus', id: args.chart_id, mode: args.mode ?? 'center' }] }) },
    { name: 'chart_script', execute: (args, signal) => args.action === 'read'
      ? host.views.inspect({ surface: 'indicator', scriptId: args.script_id }, { signal })
      : applyView(host, Object.fromEntries(Object.entries({ surface: 'indicator', action: args.action, commandId: args.command_id, expectedVersion: args.expected_version, chartId: args.chart_id, scriptId: args.script_id, artifact: args.artifact, parameters: args.parameters }).filter(([, value]) => value !== undefined))) },
    indicatorTool(host),
  ];
}
