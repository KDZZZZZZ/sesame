import { check, canonical } from '@sesame/plugin-sdk/protocol';

const summary = descriptor => ({ ...descriptor, provider: { pluginId: descriptor.pluginId, providerId: descriptor.id } });
export const marketProviders = host => host.providers.list('sesame.market').map(summary);

function select(requested, choices, name) {
  check(Array.isArray(choices) && choices.every(value => typeof value === 'string'), `Provider ${name} declaration is invalid`, 'INVALID_PROVIDER_DATA');
  if (requested !== undefined) {
    check(!choices.length || choices.includes(requested), `Unsupported ${name}: ${requested}. Declared choices: ${choices.join(', ')}`, 'UNSUPPORTED_CAPABILITY');
    return requested;
  }
  check(choices.length === 1, `Choose ${name} explicitly. ${choices.length ? 'Declared choices: ' + choices.join(', ') : 'Provider did not declare a default; read that provider plugin guidance.'}`, 'INVALID_ARGUMENT');
  return choices[0];
}

export function bindingTool(host) {
  const { define, Type, string } = host.tools;
  const provider = Type.Object({ pluginId: string('data_providers/canvas_inspect 返回的插件 ID'), providerId: string('提供方 ID') }, { additionalProperties: false });
  const connection = Type.Object({ id: string('前一次发现返回的连接 ID'), revision: string('前一次发现返回的精确连接修订') }, { additionalProperties: false });
  const instrument = Type.Object({ sourceId: string('market_instruments 搜索返回的来源 ID'), instrumentId: string('来源内品种 ID') }, { additionalProperties: false });
  return define('canvas_binding', '为行情图生成可直接放入 canvas_apply.chart.binding 的完整绑定。临时连接当前提供方、描述精确品种，固定真实 connection revision；仅自动选择唯一声明的价格/复权/时段口径，保留日历 unknown。不会修改图表、启动持续订阅或执行交易；实际渲染仍检查 canvas_inspect 回执。', {
    provider, instrument, timeframe: string('品种声明的标准周期，如 1h/15m；不要传 MT5 H1/M15'), connection: Type.Optional(connection),
    configuration: Type.Optional(Type.Record(Type.String(), Type.Unknown(), { description: '仅提供方公开的绑定选项；不含凭据。' })),
    price_basis: Type.Optional(Type.Union(['bid', 'ask', 'mid', 'last'].map(Type.Literal))),
    adjustment: Type.Optional(Type.Union(['none', 'forward', 'backward'].map(Type.Literal))), session: Type.Optional(string('提供方的交易时段 ID；有多个或未声明时需明确指定')),
  }, async (args, signal) => {
    const descriptor = host.providers.list('sesame.market').find(item => item.pluginId === args.provider.pluginId && item.id === args.provider.providerId);
    check(descriptor, 'Market provider is not loaded; use data_providers and plugin_load first', 'NOT_FOUND');
    check(descriptor.capabilities.some(value => value === 'bars.history' || value === 'bars.subscribe'), 'Provider has no candle/bar capability', 'UNSUPPORTED_CAPABILITY');
    const bound = await host.providers.bind(args.provider, { ...(args.connection ? { connection: args.connection } : {}), ...(args.configuration ? { configuration: args.configuration } : {}) }, signal);
    try {
      check(!descriptor.instanceId || bound.instanceId === descriptor.instanceId, 'Provider changed after discovery; retry with its current descriptor', 'CONNECTION_CHANGED');
      const result = await host.providers.call(bound.bindingId, 'describeInstrument', { instrument: args.instrument }, { signal });
      const instrument = result.data, features = instrument.features ?? {};
      check(canonical(instrument.ref) === canonical(args.instrument), 'Provider described another instrument', 'INSTRUMENT_MISMATCH');
      check(features.timeframes?.includes(args.timeframe), `Unsupported timeframe ${args.timeframe}; declared: ${(features.timeframes ?? []).join(', ')}`, 'UNSUPPORTED_CAPABILITY');
      check(!args.configuration || !Object.keys(args.configuration).length || bound.connection, 'Provider must return a persistent connection identity for configured chart bindings', 'UNSUPPORTED_CAPABILITY');
      const spec = { timeframe: args.timeframe, priceBasis: select(args.price_basis, features.priceBases ?? descriptor.priceBases ?? [], 'price_basis'), adjustment: select(args.adjustment, features.adjustments ?? descriptor.adjustments ?? [], 'adjustment'), session: select(args.session, features.sessions ?? descriptor.sessions ?? [], 'session'), calendarRevision: instrument.calendar ?? { status: 'unknown', reason: 'Provider did not publish a calendar revision' } };
      check(['value', 'unknown', 'not_applicable', 'unsupported'].includes(spec.calendarRevision.status), 'Provider calendar must have an explicit value status', 'INVALID_PROVIDER_DATA');
      const binding = { provider: args.provider, ...(bound.connection ? { connection: bound.connection } : {}), instrument: instrument.ref, spec };
      return { binding, chart: { symbol: instrument.symbol, binding, volume: true }, instrument, meta: result.meta, validation: { scope: 'provider_description', marketDataRead: false, rendered: false }, capabilities: descriptor.capabilities };
    } finally { await host.providers.unbind(bound.bindingId); }
  });
}
