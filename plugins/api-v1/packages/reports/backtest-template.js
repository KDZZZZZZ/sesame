import { readFileSync } from 'node:fs';

const asset = path => readFileSync(new URL(path, import.meta.url), 'utf8');
const json = value => JSON.stringify(value).replace(/</g, '\\u003c').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');
const escape = value => String(value).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export function backtestTemplate(host, refSchema) {
  const { define, Type, string } = host.tools;
  return define('report_backtest_template', 'Create an editable Strategy report with the graph derived from an exact SVL source, a symbol/timeframe heatmap of preselected optimization winners, all-trial inspection and parameter sensitivity charts. Read report-writing/backtest.md for frozen row fields and selection rules. This renders results; it never runs or optimizes a strategy.', {
    output_path: string('Workspace HTML path'), title: string('Strategy report title'), summary: string('Finding supported by actual results'),
    strategy_source: refSchema(Type, 'strategy.source'), data_id: string('Fixed report data binding containing all trials; see backtest.md'),
    parameters: Type.Array(string('Parameter key in each row.parameters'), { minItems: 1, maxItems: 32 }),
    selection_metric: Type.Optional(Type.Union(['sharpe', 'max_drawdown_pct', 'net_profit'].map(value => Type.Literal(value)))),
    selection_rule: string('Prespecified optimization objective, sample, constraints and tie-break; selected rows must already be recorded upstream'),
    source_note: string('Engine, data range, sample split, costs, currency, metric definitions and limitations'),
    currency: string('One common profit currency for these rows; split different currencies into separate comparisons'),
    locale: Type.Optional(Type.Union([Type.Literal('en'), Type.Literal('zh-CN')])), demo: Type.Optional(Type.Boolean()),
  }, async (args, signal) => {
    const artifact = host.artifacts.read(args.strategy_source), { content, blobs } = artifact.manifest;
    if (artifact.ref.kind !== 'strategy.source') throw new Error('A fixed strategy.source is required');
    const blob = blobs.find(item => item.path === content.sourcePath);
    if (!blob) throw new Error('Strategy source bytes are missing');
    const source = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(host.artifacts.readBlob(blob)));
    const graph = host.svl.graph(source);
    if (graph.sourceDigest !== content.sourceDigest) throw new Error('SVL graph must match the published source digest');
    if (new Set(args.parameters).size !== args.parameters.length) throw new Error('Parameter names must be unique');
    const config = { title: args.title, summary: args.summary, dataId: args.data_id, parameters: args.parameters, selectionMetric: args.selection_metric ?? 'sharpe', selectionRule: args.selection_rule, sourceNote: args.source_note, currency: args.currency, source: args.strategy_source, graph, definition: source, demo: args.demo === true };
    const tokens = { LOCALE: args.locale ?? 'en', TITLE: escape(args.title), STYLES: asset('assets/editorial.css') + '\n' + asset('assets/backtest.css'), KIT: asset('assets/report-kit.js'), CHARTS: asset('assets/editorial-charts.js'), EXPLORER: asset('assets/backtest-explorer.js'), CONFIG: json(config) };
    const html = asset('templates/backtest.html').replace(/\{\{(LOCALE|TITLE|STYLES|KIT|CHARTS|EXPLORER|CONFIG)\}\}/g, (_, key) => tokens[key]);
    if (Buffer.byteLength(html) > 1024 * 1024) throw new Error('This source exceeds the inline report budget; package the exact source/graph as report assets in a custom editable report');
    await host.workspace.file('write', args.output_path, html, signal);
    return { path: args.output_path, sourceDigest: graph.sourceDigest, publish: { strategy_source: args.strategy_source, features: ['interactive', 'strategy_details'], data_id: args.data_id }, next: 'Edit interpretation, add actual equity/trade evidence as needed, then report_publish with strategy_source and the fixed data binding. Check the exact published ref.' };
  });
}
