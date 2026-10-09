import { check, digest, validateFinancialData } from '@sesame/plugin-sdk/protocol';

export function indicatorTool(host) {
  const { define, Type, string } = host.tools;
  const ref = Type.Object({ id: string('成果 ID'), revision: string('固定修订'), digest: string('SHA-256 摘要'), kind: string('成果类别'), schemaVersion: Type.Literal('1.0.0') }, { additionalProperties: false });
  const choice = values => Type.Union(values.map(Type.Literal));
  const definition = Type.Object({ schemaVersion: Type.Literal('1.0.0'), title: string('指标名称'), description: Type.Optional(string('说明')), parameters: Type.Array(Type.Object({ id: string('参数 ID'), type: choice(['integer', 'decimal', 'boolean', 'string', 'enum']), required: Type.Boolean(), title: string('参数标题'), default: Type.Optional(Type.Unknown()), min: Type.Optional(string('十进制下限')), max: Type.Optional(string('十进制上限')), choices: Type.Optional(Type.Array(Type.String())) }, { additionalProperties: false })),
    inputs: Type.Array(Type.Object({ id: string('输入 ID'), kind: choice(['bars', 'quotes', 'data']), binding: choice(['chart', 'fixed']), series: Type.Optional(Type.Object({}, { additionalProperties: true })), data: Type.Optional(ref), lookback: Type.Integer({ minimum: 0, maximum: 50000 }), forming: choice(['include', 'closed_only']) }, { additionalProperties: false })),
    panes: Type.Array(Type.Object({ id: string('视区 ID'), placement: choice(['main', 'separate']), title: Type.Optional(string('视区名称')) }, { additionalProperties: false }), { maxItems: 5 }),
    series: Type.Array(Type.Object({ id: string('序列 ID'), title: string('序列名称'), paneId: string('实际视区 ID'), type: choice(['line', 'area', 'histogram', 'markers']), unit: string('单位'), scale: Type.Object({ mode: choice(['price', 'independent']), scaleId: string('刻度 ID') }, { additionalProperties: false }), style: Type.Object({ color: Type.String({ pattern: '^#[0-9a-fA-F]{6}$' }), width: Type.Optional(Type.Number({ minimum: 1, maximum: 8 })), lineStyle: Type.Optional(choice(['solid', 'dashed', 'dotted'])) }, { additionalProperties: false }) }, { additionalProperties: false }), { maxItems: 12 }),
    implementation: Type.Union([Type.Object({ kind: Type.Literal('code'), entry: string('files中的入口相对路径'), language: Type.Literal('javascript'), runtime: Type.Literal('sesame-indicator/1'), dependencies: Type.Array(ref) }, { additionalProperties: false }), Type.Object({ kind: Type.Literal('series'), initial: ref, updateMode: Type.Literal('static') }, { additionalProperties: false })]),
  }, { additionalProperties: false });
  return define('indicator_publish', '发布标准 indicator@1 成果。JavaScript 模块须 export compute(input)，输出标准 points/markers；forming 输入、独立 pane 和缺失值由定义明确。固定序列引用已有 DataRef；不将静态数据冒充实时。TypeScript/stream 尚无执行器，不能使用。', { operation_id: Type.String({ pattern: '^[A-Za-z0-9_-]{16,128}$' }), definition, files: Type.Optional(Type.Record(Type.String(), Type.String({ maxLength: 32768 }), { maxProperties: 16 })) }, args => {
    const value = args.definition, implementation = value.implementation;
    check(implementation.kind === 'code' && implementation.language === 'javascript' || implementation.kind === 'series' && implementation.updateMode === 'static', 'Indicator runtime does not support this implementation', 'UNSUPPORTED_CAPABILITY');
    check(value.panes.filter(pane => pane.placement === 'main').length <= 1 && new Set(value.panes.map(pane => pane.id)).size === value.panes.length, 'Indicator pane identities must be unique');
    check(new Set(value.series.map(series => series.id)).size === value.series.length && value.series.every(series => value.panes.some(pane => pane.id === series.paneId)), 'Indicator series must have unique IDs and declared panes');
    check(implementation.kind !== 'code' || Object.hasOwn(args.files ?? {}, implementation.entry), 'Indicator entry file is missing');
    const dependencies = [...(implementation.dependencies ?? []), ...(implementation.kind === 'series' ? [implementation.initial] : []), ...value.inputs.filter(input => input.data).map(input => input.data)];
    for (const ref of dependencies) host.artifacts.read(ref);
    const blobs = Object.entries(args.files ?? {}).map(([path, content]) => ({ path, mediaType: 'text/javascript', ...host.artifacts.blob(content) }));
    return host.artifacts.publish({ operationId: args.operation_id, manifest: { kind: 'indicator', schemaVersion: '1.0.0', content: value, dependencies: [...new Map(dependencies.map(ref => [digest(ref), ref])).values()], blobs } });
  });
}
