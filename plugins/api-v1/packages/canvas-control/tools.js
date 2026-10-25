import { indicatorTool } from './indicator.js';
import { bindingTool, marketProviders } from './market-binding.js';
import { DRAWING_COMMAND_SCHEMA, drawingSchemaError } from './drawing-schema.js';
import { drawingFromSource } from './drawing-code.js';

async function applyView(host, input, signal) {
  try { return await host.views.apply(input, { signal }); }
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
    { name: 'canvas_recover_source', execute: (args, signal) => applyView(host, Object.fromEntries(Object.entries({ surface: 'canvas-source', action: 'recover', commandId: args.command_id, expectedVersion: args.expected_version, chartId: args.chart_id, expectedChart: args.expected_chart, timeBasis: args.time_basis }).filter(([, value]) => value !== undefined)), signal) },
    { name: 'chart_drawing', execute: (args, signal) => {
      const error = drawingSchemaError(DRAWING_COMMAND_SCHEMA, args);
      if (error) throw Object.assign(Error(`Invalid drawing request: ${error}`), { code: 'INVALID_ARGUMENT' });
      if (args.source !== undefined) drawingFromSource(args.source);
      return args.action === 'read'
        ? host.views.inspect({ surface: 'drawing', chartId: args.chart_id, drawingId: args.drawing_id }, { signal })
        : applyView(host, Object.fromEntries(Object.entries({ surface: 'drawing', action: args.action, commandId: args.command_id, expectedVersion: args.expected_version, clientId: args.client_id, chartId: args.chart_id, drawingId: args.drawing_id, expectedRevision: args.expected_revision, expectedAttachment: args.expected_attachment, binding: args.binding, targetBinding: args.target_binding, drawing: args.drawing, source: args.source }).filter(([, value]) => value !== undefined)), signal);
    } },
    indicatorTool(host),
  ];
}
