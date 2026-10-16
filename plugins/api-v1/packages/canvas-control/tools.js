import { indicatorTool } from './indicator.js';
import { bindingTool, marketProviders } from './market-binding.js';
export function createCapabilities(host) {
  return [
    { name: 'canvas_inspect', execute: async (_args, signal) => ({ ...await host.views.inspect({ surface: 'canvas' }, { signal }), market_sources: await marketProviders(host) }) },
    bindingTool(host),
    { name: 'canvas_apply', execute: args => host.views.apply({ surface: 'canvas', commandId: args.command_id, expectedVersion: args.expected_version, operations: args.operations }) },
    { name: 'canvas_focus', execute: args => host.views.apply({ surface: 'canvas', commandId: args.command_id, expectedVersion: args.expected_version, operations: [{ op: 'focus', id: args.chart_id, mode: args.mode ?? 'center' }] }) },
    { name: 'chart_script', execute: (args, signal) => args.action === 'read'
      ? host.views.inspect({ surface: 'indicator', scriptId: args.script_id }, { signal })
      : host.views.apply(Object.fromEntries(Object.entries({ surface: 'indicator', action: args.action, commandId: args.command_id, expectedVersion: args.expected_version, chartId: args.chart_id, scriptId: args.script_id, artifact: args.artifact, parameters: args.parameters }).filter(([, value]) => value !== undefined))) },
    indicatorTool(host),
  ];
}
