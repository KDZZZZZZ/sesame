import { check, canonical } from '@sesame/plugin-sdk/protocol';

const summary = descriptor => ({ ...descriptor, provider: { pluginId: descriptor.pluginId, providerId: descriptor.id } });
const unknown = reason => ({ status: 'unknown', reason });

export function marketTools(host) {
  const { define, Type, string } = host.tools;
  const choice = values => Type.Union(values.map(Type.Literal));
  const provider = Type.Object({ pluginId: string('data_providers 返回的插件 ID'), providerId: string('提供方 ID') }, { additionalProperties: false });
  const connection = Type.Object({ id: string('已有连接 ID'), revision: string('该连接的精确修订') }, { additionalProperties: false });
  const instrument = Type.Object({ sourceId: string('搜索返回的来源 ID'), instrumentId: string('搜索返回的来源内品种 ID') }, { additionalProperties: false });
  return [
    define('data_providers', '列出当前已加载的行情/账户提供方、准确 provider 身份、能力和连接要求。不连接或安装来源；空列表时先发现并加载对应插件。行情品种用 market_instruments 查询。', {
      contract: Type.Optional(choice(['sesame.market', 'sesame.account'])),
    }, args => ({ providers: host.providers.list(args.contract).filter(item => ['sesame.market', 'sesame.account'].includes(item.contract)).map(summary) })),
    define('market_instruments', '通过公开行情契约搜索或描述真实品种，同时返回当前 connection 修订、来源时间口径与可用周期。每次临时只读绑定并释放。search 最多返回 limit 项；has_more 时缩小 query，不把失效游标交给模型。describe 使用搜索返回的精确 InstrumentRef。', {
      action: choice(['search', 'describe']), provider,
      connection: Type.Optional(connection), configuration: Type.Optional(Type.Record(Type.String(), Type.Unknown(), { description: '仅提供方声明的公开绑定选项；不放登录口令或凭据。已有配置默认复用。' })),
      query: Type.Optional(Type.String({ maxLength: 200, description: 'search 的名称/代码；空串读取默认第一页' })),
      limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 200, description: 'search 结果上限，默认 20；不会遍历整个来源目录' })),
      asset_classes: Type.Optional(Type.Array(choice(['equity', 'future', 'option', 'fx', 'crypto', 'index', 'fund', 'other']), { maxItems: 8 })),
      venues: Type.Optional(Type.Array(string('来源的交易场所标识'), { maxItems: 16 })), instrument: Type.Optional(instrument),
    }, async (args, signal) => {
      const fields = ['action', 'provider', 'connection', 'configuration', ...(args.action === 'search' ? ['query', 'limit', 'asset_classes', 'venues'] : ['instrument'])];
      check(Object.keys(args).every(key => fields.includes(key)), 'This instrument action contains fields for another action');
      const descriptor = host.providers.list('sesame.market').find(item => item.pluginId === args.provider.pluginId && item.id === args.provider.providerId);
      check(descriptor, 'The selected market provider is not loaded; use data_providers and plugin_load first', 'NOT_FOUND');
      if (args.action === 'describe') check(args.instrument, 'describe requires the exact InstrumentRef returned by search');
      const bound = await host.providers.bind(args.provider, { ...(args.connection ? { connection: args.connection } : {}), ...(args.configuration ? { configuration: args.configuration } : {}) }, signal);
      try {
        check(!descriptor.instanceId || bound.instanceId === descriptor.instanceId, 'Provider changed after discovery; retry with its current descriptor', 'CONNECTION_CHANGED');
        const context = { provider: args.provider, connection: bound.connection ?? null, health: bound.health ?? 'unknown', source_ids: bound.sourceIds ?? [], descriptor: summary(descriptor) };
        if (args.action === 'search') {
          const limit = args.limit ?? 20;
          const result = await host.providers.call(bound.bindingId, 'searchInstruments', { query: args.query ?? '', ...(args.asset_classes ? { assetClasses: args.asset_classes } : {}), ...(args.venues ? { venues: args.venues } : {}), page: { limit } }, { signal });
          check(Array.isArray(result.data?.items) && result.data.items.length <= limit, 'Provider returned an invalid or unbounded instrument page', 'INVALID_PROVIDER_DATA');
          return { ...context, items: result.data.items, has_more: Boolean(result.data.nextCursor), snapshot_id: result.data.snapshotId ?? null, pagination: 'bounded_search_refine_query', meta: result.meta };
        }
        const result = await host.providers.call(bound.bindingId, 'describeInstrument', { instrument: args.instrument }, { signal });
        check(canonical(result.data.ref) === canonical(args.instrument), 'Provider described another instrument', 'INSTRUMENT_MISMATCH');
        return { ...context, instrument: result.data, series_options: { timeframes: result.data.features?.timeframes ?? [], priceBases: result.data.features?.priceBases ?? descriptor.priceBases ?? [], adjustments: result.data.features?.adjustments ?? descriptor.adjustments ?? [], sessions: result.data.features?.sessions ?? descriptor.sessions ?? [], calendarRevision: result.data.calendar ?? unknown('Provider did not publish a calendar revision') }, meta: result.meta };
      } finally { await host.providers.unbind(bound.bindingId); }
    }),
  ];
}
