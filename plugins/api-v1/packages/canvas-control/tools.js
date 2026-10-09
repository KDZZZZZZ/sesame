import { indicatorTool } from './indicator.js';
import { bindingTool, marketProviders } from './market-binding.js';
export function createTools(host) {
  const { define, Type } = host.tools;
  const choice = values => Type.Union(values.map(Type.Literal));
  const string = description => Type.String({ description, minLength: 1, maxLength: 100 });
  const optional = description => Type.Optional(string(description));
  const common = { command_id: Type.String({ description: '本次操作唯一 ID，至少 16 字符；重试保持不变', minLength: 16, maxLength: 100, pattern: '^[a-zA-Z0-9_-]+$' }), expected_version: Type.Integer({ minimum: 1 }) };
  const path = Type.String({ pattern: '^[01]{0,31}$', description: '根路径为空字符串；0 是左/上子区，1 是右/下子区' });
  const tiles = Type.Array(Type.Union([
    Type.Object({ path, chart_id: string('图表 ID') }, { additionalProperties: false }),
    Type.Object({ path, axis: choice(['x', 'y']), ratio: Type.Number({ exclusiveMinimum: 0, exclusiveMaximum: 1, description: '左侧或上侧区域所占比例' }) }, { additionalProperties: false }),
  ]), { maxItems: 63, description: '完整的比例平铺树，必须包含所有图表且不重复；空图表场景使用空数组' });
  const ref = Type.Object({ id: string('成果 ID'), revision: string('固定修订'), digest: string('SHA-256 摘要'), kind: string('成果类别'), schemaVersion: Type.Literal('1.0.0') }, { additionalProperties: false });
  const provider = Type.Object({ pluginId: string('已加载插件 ID'), providerId: string('提供方 ID') }, { additionalProperties: false });
  const binding = Type.Union([Type.Null(), Type.Object({ provider, connection: Type.Optional(Type.Object({ id: string('连接 ID'), revision: string('连接修订') }, { additionalProperties: false })), instrument: Type.Object({ sourceId: string('来源 ID'), instrumentId: string('来源内品种 ID') }, { additionalProperties: false }), spec: Type.Object({ timeframe: string('提供方声明的周期，如 1m/1h/1d/1mo'), priceBasis: string('提供方声明的价格口径'), adjustment: string('复权口径'), session: string('交易时段口径'), calendarRevision: Type.Unknown() }, { additionalProperties: false }) }, { additionalProperties: false })]);
  const chart = Type.Object({
    binding: Type.Optional(binding), symbol: optional('仅显示标签；数据身份由 binding 决定'), style: Type.Optional(choice(['candles', 'bars', 'line', 'area'])),
    x: Type.Optional(Type.Number({ minimum: -20000, maximum: 20000 })), y: Type.Optional(Type.Number({ minimum: -20000, maximum: 20000 })),
    width: Type.Optional(Type.Number({ minimum: 360, maximum: 5000 })), height: Type.Optional(Type.Number({ minimum: 240, maximum: 5000 })),
    ...Object.fromEntries(['volume', 'averages', 'markers', 'logarithmic', 'collapsed', 'locked'].map(k => [k, Type.Optional(Type.Boolean())])),
    sync_group: Type.Optional(Type.String({ description: '默认独立；仅用户明确要求联动拖动/缩放时设置相同非空分组；空字符串取消联动', maxLength: 32 })),
  }, { additionalProperties: false });
  return [
    define('canvas_inspect', '查看工作台版本、图表、布局、指标实例、前端渲染回执及已加载 market_providers 身份/能力。新行情图先 market_instruments 搜索，再 canvas_binding 生成完整绑定；没有近期客户端回执表示尚未确认渲染。', {}, () => ({ ...host.layout.inspect(), market_providers: marketProviders(host) })),
    bindingTool(host),
    define('canvas_apply', '原子批量修改工作台。workspace 调整三个水平窗口宽度或定位；其余图表操作仅在最左侧图表区内。用户锁定或正在拖动的图表会返回冲突，须重读后处理。不触发交易。', {
      ...common,
      operations: Type.Array(Type.Object({ op: choice(['add', 'update', 'remove', 'panels', 'focus', 'arrange', 'workspace', 'reorder', 'dock', 'tile']), id: optional('目标图表 ID；add 可省略'), target_id: optional('reorder 的交换目标或 dock 的插入参照图表'), side: Type.Optional(choice(['left', 'right', 'top', 'bottom'])), tiles: Type.Optional(tiles), groups: Type.Optional(Type.Array(Type.Array(string('图表 ID'), { minItems: 1, maxItems: 32 }), { minItems: 1, maxItems: 32 })), chart: Type.Optional(chart),
        workspace: Type.Optional(Type.Object({ column: Type.Optional(choice(['charts', 'agents', 'research'])), widths: Type.Optional(Type.Object(Object.fromEntries(['charts', 'agents', 'research'].map(key => [key, Type.Optional(Type.Union([Type.Number({ minimum: 320, maximum: 3000 }), Type.Null()]))])), { additionalProperties: false })) }, { additionalProperties: false })),
        panels: Type.Optional(Type.Object({ agents: Type.Optional(Type.Boolean()), account: Type.Optional(Type.Boolean()) }, { additionalProperties: false })),
        mode: Type.Optional(choice(['center', 'maximize', 'restore', 'auto'])), columns: Type.Optional(Type.Union([Type.Integer({ minimum: 1, maximum: 4 }), Type.Null()])),
        height: Type.Optional(Type.Union([Type.Number({ minimum: 1, maximum: 1000000 }), Type.Null()], { description: '仅 tile：展开图表区的内容高度（像素），超出视口允许纵向滚动；省略保留，null 恢复自适应' })),
      }, { additionalProperties: false }), { minItems: 1, maxItems: 64 }),
    }, args => host.layout.apply(args)),
    define('canvas_focus', '先定位最左侧图表窗口，再定位其中的指定图表；最大化仅填满图表窗口，不覆盖 Agents 或研究窗口。', { ...common, chart_id: string('图表 ID'), mode: Type.Optional(choice(['center', 'maximize', 'restore'])) },
      args => host.layout.apply({ command_id: args.command_id, expected_version: args.expected_version, operations: [{ op: 'focus', id: args.chart_id, mode: args.mode ?? 'center' }] })),
    define('chart_script', '读取、挂载或移除不可变指标成果。每张图保留独立实例和参数；仅支持宿主声明的代码语言及静态序列。先用 indicator_publish 交付标准成果，再指定 ArtifactRef 挂载。', {
      action: choice(['read', 'put', 'remove']), command_id: Type.Optional(common.command_id), expected_version: Type.Optional(Type.Integer({ minimum: 1 })),
      chart_id: optional('目标图表 ID'), script_id: optional('读取、替换或移除的指标实例 ID'), artifact: Type.Optional(ref), parameters: Type.Optional(Type.Record(Type.String(), Type.Unknown())),
    }, args => host.layout.script(args)),
    indicatorTool(host),
  ];
}
