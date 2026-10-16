import { readFileSync } from 'node:fs';
import { graph as sourceGraph } from '@sesame/plugin-sdk/svl';
import { readBytes, writeWorkspace } from './artifact-io.js';

const asset = path => readFileSync(new URL(path, import.meta.url), 'utf8');
const json = value => JSON.stringify(value).replace(/</g, '\\u003c').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');
const escape = value => String(value).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export function backtestTemplate(host) {
  return { name: 'report_backtest_template', execute: async (args, signal) => {
    const { content, blobs } = await host.resources.read(args.strategy_source, { part: 'manifest' });
    if (args.strategy_source.kind !== 'strategy.source') throw new Error('A fixed strategy.source is required');
    const blob = blobs.find(item => item.path === content.sourcePath);
    if (!blob) throw new Error('Strategy source bytes are missing');
    const source = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(await readBytes(host, args.strategy_source, blob.path, signal)));
    const graph = sourceGraph(source);
    if (graph.sourceDigest !== content.sourceDigest) throw new Error('SVL graph must match the published source digest');
    if (new Set(args.parameters).size !== args.parameters.length) throw new Error('Parameter names must be unique');
    const config = { title: args.title, summary: args.summary, dataId: args.data_id, parameters: args.parameters, selectionMetric: args.selection_metric ?? 'sharpe', selectionRule: args.selection_rule, sourceNote: args.source_note, currency: args.currency, source: args.strategy_source, graph, definition: source, demo: args.demo === true };
    const tokens = { LOCALE: args.locale ?? 'en', TITLE: escape(args.title), STYLES: asset('assets/editorial.css') + '\n' + asset('assets/backtest.css'), KIT: asset('assets/report-kit.js'), CHARTS: asset('assets/editorial-charts.js'), EXPLORER: asset('assets/backtest-explorer.js'), CONFIG: json(config) };
    const html = asset('templates/backtest.html').replace(/\{\{(LOCALE|TITLE|STYLES|KIT|CHARTS|EXPLORER|CONFIG)\}\}/g, (_, key) => tokens[key]);
    if (Buffer.byteLength(html) > 1024 * 1024) throw new Error('This source exceeds the inline report budget; package the exact source/graph as report assets in a custom editable report');
    const written = await writeWorkspace(host, args.output_path, html, signal);
    return { path: written.path, sourceDigest: graph.sourceDigest, publish: { strategy_source: args.strategy_source, features: ['interactive', 'strategy_details'], data_id: args.data_id }, next: 'Edit interpretation, add actual equity/trade evidence as needed, then report_publish with strategy_source and the fixed data binding. Check the exact published ref.' };
  } };
}
