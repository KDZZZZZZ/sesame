export function createTools(host) {
  const { define, Type, string, optional } = host.tools;
  const conversationId = host.scope.conversationId;
  const box = host.workspace;
  return [
    define('data_sources', '列出统一数据服务已接入的数据源。缓存、权限和证据由宿主管理。', {}, () => host.datasets.sources()),
    define('data_query', '按插件数据源声明获取有界预览与短期 query_id。arguments 传该来源自身的查询字段。需要分析或引用时立即 data_snapshot，再 data_read；has_more=true 表示范围未完整返回。', {
      source: Type.String({ description: 'data_sources 返回的数据来源 ID' }), dataset_id: optional('已有数据 ID'), arguments: Type.Optional(Type.Record(Type.String(), Type.Unknown(), { description: '插件来源自己的查询字段；不得覆盖 source、limit、offset 等宿主分页参数' })),
      from: Type.Optional(Type.Integer({ minimum: 0 })), to: Type.Optional(Type.Integer({ minimum: 1 })), time_field: optional('已有数据的时间列；数值为秒，字符串按明确时区解析'),
      fields: Type.Optional(Type.Array(Type.String({ minLength: 1, maxLength: 200 }), { maxItems: 128 })),
      limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 100000 })), offset: Type.Optional(Type.Integer({ minimum: 0 })),
      freshness_ms: Type.Optional(Type.Integer({ minimum: 0, maximum: 86400000 })),
    }, ({ arguments: fields = {}, ...args }, signal) => {
      if (Object.keys(fields).some(key => ['source', 'dataset_id', 'arguments', 'time_field', 'fields', 'limit', 'offset', 'freshness_ms'].includes(key))) throw new Error('来源参数不能覆盖宿主查询字段');
      return host.datasets.query({ ...fields, ...args }, signal);
    }),
    define('data_snapshot', '冻结本会话 data_query 的完整结果，返回可供 data_read、研究报告与判断复盘引用的 dataset_id；不会重新获取或替换当时的数据。', {
      query_id: string('刚才查询返回的 query_id'), title: string('数据快照名称'),
    }, args => host.datasets.snapshot(args.query_id, args.title)),
  ];
}
