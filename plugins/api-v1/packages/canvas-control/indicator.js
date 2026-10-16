import { check, digest } from '@sesame/plugin-sdk/protocol';
import { publishIndicator } from './artifact-io.js';

export function indicatorTool(host) {
  return { name: 'indicator_publish', execute: async (args, signal) => {
    const value = args.definition, implementation = value.implementation;
    check(implementation.kind === 'code' && implementation.language === 'javascript' || implementation.kind === 'series' && implementation.updateMode === 'static', 'Indicator runtime does not support this implementation', 'UNSUPPORTED_CAPABILITY');
    check(value.panes.filter(pane => pane.placement === 'main').length <= 1 && new Set(value.panes.map(pane => pane.id)).size === value.panes.length, 'Indicator pane identities must be unique');
    check(new Set(value.series.map(series => series.id)).size === value.series.length && value.series.every(series => value.panes.some(pane => pane.id === series.paneId)), 'Indicator series must have unique IDs and declared panes');
    check(implementation.kind !== 'code' || Object.hasOwn(args.files ?? {}, implementation.entry), `Indicator entry file is missing: put files[${JSON.stringify(implementation.entry)}] beside definition at the top level; see resources/indicator-publish.json`);
    const dependencies = [...(implementation.dependencies ?? []), ...(implementation.kind === 'series' ? [implementation.initial] : []), ...value.inputs.filter(input => input.data).map(input => input.data)];
    for (const ref of dependencies) await host.resources.read(ref, { part: 'manifest' });
    const files = implementation.kind === 'series' && !Object.keys(args.files ?? {}).length ? { 'definition.json': JSON.stringify(value) } : args.files;
    return publishIndicator(host, args.operation_id, { kind: 'indicator', schemaVersion: '1.0.0', content: value, dependencies: [...new Map(dependencies.map(ref => [digest(ref), ref])).values()] }, files, signal);
  } };
}
