export function createTools({ runtime, conversationId, define, Type }) {
  const choice = values => Type.Union(values.map(Type.Literal));
  const string = description => Type.String({ description, minLength: 1, maxLength: 100 });
  const optional = description => Type.Optional(string(description));
  const common = { command_id: Type.String({ description: '本次操作唯一 ID，至少 16 字符；重试保持不变', minLength: 16, maxLength: 100, pattern: '^[a-zA-Z0-9_-]+$' }), expected_version: Type.Integer({ minimum: 1 }) };
  const path = Type.String({ pattern: '^[01]{0,31}$', description: '根路径为空字符串；0 是左/上子区，1 是右/下子区' });
  const tiles = Type.Array(Type.Union([
    Type.Object({ path, chart_id: string('图表 ID') }, { additionalProperties: false }),
    Type.Object({ path, axis: choice(['x', 'y']), ratio: Type.Number({ exclusiveMinimum: 0, exclusiveMaximum: 1, description: '左侧或上侧区域所占比例' }) }, { additionalProperties: false }),
  ]), { maxItems: 63, description: '完整的比例平铺树，必须包含所有图表且不重复；空图表场景使用空数组' });
  const chart = Type.Object({
    symbol: optional('精确券商品种'), period: Type.Optional(choice('M1 M2 M3 M4 M5 M6 M10 M12 M15 M20 M30 H1 H2 H3 H4 H6 H8 H12 D1 W1 MN1'.split(' '))), style: Type.Optional(choice(['candles', 'bars', 'line', 'area'])),
    x: Type.Optional(Type.Number({ minimum: -20000, maximum: 20000 })), y: Type.Optional(Type.Number({ minimum: -20000, maximum: 20000 })),
    width: Type.Optional(Type.Number({ minimum: 360, maximum: 5000 })), height: Type.Optional(Type.Number({ minimum: 240, maximum: 5000 })),
    ...Object.fromEntries(['volume', 'averages', 'markers', 'logarithmic', 'collapsed', 'locked'].map(k => [k, Type.Optional(Type.Boolean())])),
    sync_group: Type.Optional(Type.String({ description: '默认独立；仅用户明确要求联动拖动/缩放时设置相同非空分组；空字符串取消联动', maxLength: 32 })),
  }, { additionalProperties: false });
  return [
    define('canvas_inspect', '查看水平工作台的版本、三个窗口宽度、图表 ID、布局、脚本与前端渲染回执。修改前先读取；没有近期客户端回执表示尚未确认渲染。', {}, () => runtime.canvas.inspect(conversationId)),
    define('canvas_apply', '原子批量修改工作台。workspace 调整三个水平窗口宽度或定位；其余图表操作仅在最左侧图表区内。用户锁定或正在拖动的图表会返回冲突，须重读后处理。不触发交易。', {
      ...common,
      operations: Type.Array(Type.Object({ op: choice(['add', 'update', 'remove', 'panels', 'focus', 'arrange', 'workspace', 'reorder', 'dock', 'tile']), id: optional('目标图表 ID；add 可省略'), target_id: optional('reorder 的交换目标或 dock 的插入参照图表'), side: Type.Optional(choice(['left', 'right', 'top', 'bottom'])), tiles: Type.Optional(tiles), groups: Type.Optional(Type.Array(Type.Array(string('图表 ID'), { minItems: 1, maxItems: 32 }), { minItems: 1, maxItems: 32 })), chart: Type.Optional(chart),
        workspace: Type.Optional(Type.Object({ column: Type.Optional(choice(['charts', 'agents', 'research'])), widths: Type.Optional(Type.Object(Object.fromEntries(['charts', 'agents', 'research'].map(key => [key, Type.Optional(Type.Union([Type.Number({ minimum: 320, maximum: 3000 }), Type.Null()]))])), { additionalProperties: false })) }, { additionalProperties: false })),
        panels: Type.Optional(Type.Object({ agents: Type.Optional(Type.Boolean()), account: Type.Optional(Type.Boolean()) }, { additionalProperties: false })),
        mode: Type.Optional(choice(['center', 'maximize', 'restore', 'auto'])), columns: Type.Optional(Type.Union([Type.Integer({ minimum: 1, maximum: 4 }), Type.Null()])),
        height: Type.Optional(Type.Union([Type.Number({ minimum: 1, maximum: 1000000 }), Type.Null()], { description: '仅 tile：展开图表区的内容高度（像素），超出视口允许纵向滚动；省略保留，null 恢复自适应' })),
      }, { additionalProperties: false }), { minItems: 1, maxItems: 64 }),
    }, args => runtime.canvas.apply(args, conversationId)),
    define('canvas_focus', '先定位最左侧图表窗口，再定位其中的指定图表；最大化仅填满图表窗口，不覆盖 Agents 或研究窗口。', { ...common, chart_id: string('图表 ID'), mode: Type.Optional(choice(['center', 'maximize', 'restore'])) },
      args => runtime.canvas.apply({ command_id: args.command_id, expected_version: args.expected_version, operations: [{ op: 'focus', id: args.chart_id, mode: args.mode ?? 'center' }] }, conversationId)),
    define('chart_script', '发布、读取或移除图表代码曲线。JavaScript/TypeScript 源码是 indicator(bars, parameters) 函数体，return 曲线数组；每组含 title、type(line/area/histogram)、color、pane(0主图/1–4副图)、data[{time,value}]。bars 使用券商时间 Unix 秒及 OHLCV。代码在无网络隔离 Worker 运行，不访问宿主。Python 等研究结果使用 language=series 绑定最终数值；发布到主工作区，子任务清理不影响它。', {
      action: choice(['read', 'put', 'remove']), command_id: Type.Optional(common.command_id), expected_version: Type.Optional(Type.Integer({ minimum: 1 })),
      chart_id: optional('目标图表 ID'), script_id: optional('读取、替换或移除的脚本 ID'), title: optional('曲线名称'),
      language: Type.Optional(choice(['javascript', 'typescript', 'series'])), source: Type.Optional(Type.String({ description: '函数体源码，最多 32 KiB', minLength: 1, maxLength: 32768 })), parameters: Type.Optional(Type.Record(Type.String(), Type.Unknown())),
      series: Type.Optional(Type.Array(Type.Object({ title: Type.String({ maxLength: 100 }), type: Type.Optional(choice(['line', 'area', 'histogram'])), color: optional('#RRGGBB'), pane: Type.Optional(Type.Integer({ minimum: 0, maximum: 4 })), data: Type.Array(Type.Object({ time: Type.Integer({ minimum: 0 }), value: Type.Number() }, { additionalProperties: false }), { maxItems: 50000 }) }, { additionalProperties: false }), { maxItems: 12 })),
    }, args => runtime.canvas.script(args, conversationId)),
  ];
}
