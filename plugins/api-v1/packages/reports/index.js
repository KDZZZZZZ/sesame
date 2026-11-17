import { reportStyleCapabilities } from './report-styles.js';
import { renderReport } from './report-provider.js';
import { prepareReport } from './report-prepare.js';
import { componentCapabilities } from './component-tools.js';

export function createCapabilities(host) {
  return [
    ...componentCapabilities(host),
    ...reportStyleCapabilities(host),
    { name: 'report_read', execute: async (args, signal) => {
      if (!args.ref) return host.data.query({ source: { providerId: 'host#artifacts', revision: 'host:2' }, input: { kind: 'report' }, limit: args.limit ?? 30, ...(args.cursor ? { cursor: args.cursor } : {}) }, { signal });
      const manifest = await host.resources.read(args.ref, { part: 'manifest' }), metadata = await host.resources.read(args.ref, { part: 'metadata' });
      return { ...metadata, manifest, ...(args.include_checks ? { checks: (await host.resources.read(args.ref, { part: 'receipts' })).items } : {}) };
    } },
    { name: 'report_check', execute: (args, signal) => host.views.inspect({ surface: 'artifact', ref: args.ref }, { signal }) },
    { name: 'report_export_check', execute: (args, signal) => host.views.inspect({ surface: 'report-export', ref: args.ref }, { signal }) },
    { name: 'report_render', execute: (args, signal) => renderReport(host, args, signal) },
    { name: 'report_prepare', execute: (args, signal) => prepareReport(host, args, signal) },
  ];
}
