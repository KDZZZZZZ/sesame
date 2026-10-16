export function createTools({ runtime, conversationId, define, Type, optional, string }) {
  return [
    define('data_sources', '列出统一数据服务已接入的数据源。缓存、权限和证据由宿主管理。', {}, () => runtime.data.sources()),
    define('data_query', '按需获取数据并返回有界预览与短期 query_id。MT5 自动补齐缓存，网页支持 HTTP/HTTPS 公网与内网来源。需要分析或引用时立即 data_snapshot，再 data_read；has_more=true 表示范围未完整返回。', {
      source: Type.Union(['dataset', 'mt5', 'web'].map(Type.Literal)), dataset_id: optional('已有数据 ID'), url: optional('网页或数据文件 URL'),
      symbol: optional('精确 MT5 品种'), period: optional('MT5 周期，如 H1'),
      from: Type.Optional(Type.Integer({ minimum: 0 })), to: Type.Optional(Type.Integer({ minimum: 1 })), time_field: optional('已有数据的时间列；数值为秒，字符串按明确时区解析'),
      fields: Type.Optional(Type.Array(Type.String({ minLength: 1, maxLength: 200 }), { maxItems: 128 })),
      limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 100000 })), offset: Type.Optional(Type.Integer({ minimum: 0 })),
      freshness_ms: Type.Optional(Type.Integer({ minimum: 0, maximum: 86400000 })),
    }, (args, signal) => runtime.data.query(args, conversationId, signal)),
    define('data_snapshot', '冻结本会话 data_query 的完整结果，返回可供 data_read、研究报告与判断复盘引用的 dataset_id；不会重新获取或替换当时的数据。', {
      query_id: string('刚才查询返回的 query_id'), title: string('数据快照名称'),
    }, args => runtime.data.snapshot(args.query_id, conversationId, args.title)),
  ];
}
